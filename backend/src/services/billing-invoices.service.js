const b = require("./billing-common");
const { createHash } = require("node:crypto");
const subscriptions = require("./billing-subscriptions.service");
const { pool, v, fail, transaction, audit } = b;

const kinds = ["hardware_sale","hardware_rental","connectivity","discount","tax","adjustment"];
const statuses = ["draft","issued","partially_paid","paid","overdue","void"];
const projection = `i.id,i.tenant_id,t.name AS tenant_name,i.subscription_id,i.period_start::text,
  i.period_end::text,i.corrects_invoice_id,i.currency,i.invoice_number,i.issued_on::text,
  i.due_on::text,i.voided_at,i.total::numeric(32,4),i.collected::numeric(32,4),i.balance::numeric(32,4),i.status,i.created_at`;

async function lockedInvoice(client, id) {
  const { rows: [row] } = await client.query(
    `SELECT i.*, i.issued_on::text,i.due_on::text FROM billing_invoices i WHERE id=$1 FOR UPDATE`, [id]
  );
  if (!row) fail(404, "Invoice not found.");
  return row;
}

async function invoiceList(query, tenantId) {
  const paging = v.queryPage(query, tenantId ? ["status"] : ["tenantId","status"]);
  const status = v.choice(statuses, true)(query.status);
  const { rows } = await pool.query(
    `SELECT ${projection} FROM billing_invoice_balances i JOIN tenants t ON t.id=i.tenant_id
     WHERE ($1::bigint IS NULL OR i.tenant_id=$1) AND ($2::text IS NULL OR i.status=$2)
      AND (NOT $3::boolean OR i.issued_on IS NOT NULL)
     ORDER BY i.id DESC LIMIT $4 OFFSET $5`,
    [tenantId || v.optionalId(query.tenantId),status,Boolean(tenantId),paging.limit + 1,paging.offset]
  );
  return v.page(rows, paging);
}

async function invoiceDetail(id, tenantId) {
  const { rows: [invoice] } = await pool.query(
    `SELECT ${projection}${tenantId ? "" : ",i.generation_terms"} FROM billing_invoice_balances i
     JOIN tenants t ON t.id=i.tenant_id WHERE i.id=$1 AND ($2::bigint IS NULL OR
       (i.tenant_id=$2 AND i.issued_on IS NOT NULL))`, [id,tenantId ?? null]
  );
  if (!invoice) fail(404, "Invoice not found.");
  const [{ rows: lines }, { rows: payments }] = await Promise.all([
    pool.query("SELECT id,kind,description,quantity,unit_price,amount FROM billing_invoice_lines WHERE invoice_id=$1 ORDER BY id", [id]),
    pool.query(
      `SELECT p.id,p.amount,p.currency,p.paid_on::text,p.method,r.created_at AS reversed_at
       ${tenantId ? "" : ",p.external_reference,p.notes,p.recorded_by,r.reason AS reversal_reason"}
       FROM billing_payments p LEFT JOIN billing_payment_reversals r ON r.payment_id=p.id
       WHERE p.invoice_id=$1 ORDER BY p.id DESC LIMIT 50`, [id]
    ),
  ]);
  const snapshots = tenantId ? [] : (await pool.query(
    `SELECT device_id,starts_on::text,ends_on::text,released_at
      FROM billing_device_snapshots WHERE invoice_id=$1 ORDER BY device_id LIMIT 100`, [id]
  )).rows;
  return { ...invoice, lines, payments, ...(tenantId ? {} : { snapshots }) };
}

async function paymentList(id, query, tenantId) {
  const paging = v.queryPage(query, []);
  const { rowCount } = await pool.query(
    "SELECT 1 FROM billing_invoices WHERE id=$1 AND ($2::bigint IS NULL OR (tenant_id=$2 AND issued_on IS NOT NULL))",
    [id,tenantId ?? null]
  );
  if (!rowCount) fail(404, "Invoice not found.");
  const { rows } = await pool.query(
    `SELECT p.id,p.amount,p.currency,p.paid_on::text,p.method,r.created_at AS reversed_at
     ${tenantId ? "" : ",p.external_reference,p.notes,p.recorded_by,r.reason AS reversal_reason"}
     FROM billing_payments p LEFT JOIN billing_payment_reversals r ON r.payment_id=p.id
     WHERE p.invoice_id=$1 ORDER BY p.id DESC LIMIT $2 OFFSET $3`, [id,paging.limit + 1,paging.offset]
  );
  return v.page(rows, paging);
}

function manualLines(value) {
  if (!Array.isArray(value) || value.length > 50) fail(400, "Use up to 50 manual lines.");
  return value.map((line) => v.fields(line, {
    kind: v.choice(kinds), description:v.text(250,true), quantity:v.integer(1,1000000), unitPrice:b.money,
  }, ["kind","description","quantity","unitPrice"]));
}

async function addLines(client, invoice, lines) {
  for (const line of lines) b.currencyScale(line.unitPrice, invoice.currency);
  if (!lines.length) return;
  await client.query(
    `INSERT INTO billing_invoice_lines (invoice_id,kind,description,quantity,unit_price)
     SELECT $1,kind,description,quantity,"unitPrice"
     FROM jsonb_to_recordset($2::jsonb) AS line(kind text,description text,quantity integer,"unitPrice" numeric)`,
    [invoice.id,JSON.stringify(lines)]
  );
}

async function manualInvoice(body, admin) {
  const values = v.fields(body, {
    tenantId:v.id, currency:b.currency, requestKey:b.requestKey, lines:manualLines, correctsInvoiceId:v.optionalId,
  }, ["tenantId","currency","requestKey","lines"]);
  if (!values.lines.length) fail(400, "Add at least one line.");
  const fingerprint = createHash("sha256").update(JSON.stringify([
    values.currency,values.correctsInvoiceId ?? null,
    values.lines.map((line) => [line.kind,line.description,line.quantity,line.unitPrice]),
  ])).digest("hex");
  return transaction(async (client) => {
    const tenant = await b.lockTenant(client, values.tenantId);
    const { rows: [existing] } = await client.query(
      `SELECT i.id,e.details->>'fingerprint' AS fingerprint FROM billing_invoices i
       LEFT JOIN billing_events e ON e.resource='invoice' AND e.resource_id=i.id AND e.action='manual_draft_created'
       WHERE i.tenant_id=$1 AND i.request_key=$2`,
      [tenant.id,values.requestKey]
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        fail(409, "This request key was used for a different invoice.");
      }
      return { id:existing.id,replayed:true };
    }
    if (values.correctsInvoiceId) {
      const { rows: [original] } = await client.query(
        "SELECT id,currency,voided_at FROM billing_invoices WHERE id=$1 AND tenant_id=$2",
        [values.correctsInvoiceId,tenant.id]
      );
      if (!original) fail(404, "Previous invoice not found.");
      if (!original.voided_at || original.currency !== values.currency) fail(409, "Corrections require a void invoice in the same currency.");
    }
    const { rows: [invoice] } = await client.query(
      `INSERT INTO billing_invoices (tenant_id,currency,request_key,corrects_invoice_id,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING id,currency`, [tenant.id,values.currency,values.requestKey,values.correctsInvoiceId ?? null,admin]
    );
    await addLines(client, invoice, values.lines);
    await audit(client, admin, tenant.id,"invoice",invoice.id,"manual_draft_created",{
      correctsInvoiceId:values.correctsInvoiceId ?? null,manualLineCount:values.lines.length,fingerprint,
    });
    return { id:invoice.id,replayed:false };
  });
}

async function generate(id, body, admin, source = "manual") {
  const { periodStart } = v.fields(body, { periodStart:b.date }, ["periodStart"]);
  return transaction(async (client) => {
    const sub = await subscriptions.lockedSubscription(client,id);
    const { rows: [previous] } = await client.query(
      "SELECT id FROM billing_invoices WHERE subscription_id=$1 AND period_start=$2", [id,periodStart]
    );
    if (previous) return { id:previous.id,replayed:true };
    if (!["trialing","active","past_due"].includes(sub.status) || sub.next_bill_on !== periodStart || periodStart > await b.today(client)) {
      fail(409, "Only the next due period can be drafted for a billable subscription.");
    }
    const tenant = await b.lockTenant(client,sub.tenant_id);
    if (tenant.status !== "active") fail(409, "The tenant is inactive.");
    const terms = await subscriptions.termsFor(client,id,periodStart);
    const periodEnd = b.renewalDate(periodStart,sub.anchor_on,terms.interval_months);
    const snapshot = {
      termId:terms.term_id,planVersionId:terms.id,planName:terms.plan_name,planCode:terms.plan_code,currency:terms.currency,
      intervalMonths:terms.interval_months,basePrice:terms.effective_base,excessPrice:terms.effective_excess,
      includedDevices:terms.included_devices,paymentDays:terms.payment_days,graceDays:terms.grace_days,
    };
    const { rows: [invoice] } = await client.query(
      `INSERT INTO billing_invoices (tenant_id,subscription_id,period_start,period_end,generation_terms,currency,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,currency`,
      [tenant.id,id,periodStart,periodEnd,snapshot,terms.currency,admin]
    );
    const { rows: installed } = await client.query(
      `SELECT d.id FROM gps_devices d JOIN vehicles v
       ON (v.traccar_device_id,v.tenant_id)=(d.traccar_device_id,d.tenant_id)
       WHERE d.tenant_id=$1 AND d.lifecycle_status='installed' ORDER BY d.id FOR SHARE OF d`, [tenant.id]
    );
    const claims = await client.query(
      `INSERT INTO billing_device_snapshots (invoice_id,device_id,starts_on,ends_on)
       SELECT $1,id,$2,$3 FROM unnest($4::bigint[]) AS devices(id) ORDER BY id
       ON CONFLICT DO NOTHING RETURNING device_id`,
      [invoice.id,periodStart,periodEnd,installed.map((row) => row.id)]
    );
    const excess = Math.max(0,claims.rowCount - terms.included_devices);
    await addLines(client, invoice, [
      { kind:"saas_base",description:`${terms.plan_name.slice(0,150)} subscription`,quantity:1,unitPrice:terms.effective_base },
      ...(excess ? [{ kind:"saas_excess",description:"Additional installed GPS devices",quantity:excess,unitPrice:terms.effective_excess }] : []),
    ]);
    await client.query(
      "UPDATE billing_subscriptions SET next_bill_on=$2,status=CASE WHEN status='trialing' THEN 'active' ELSE status END WHERE id=$1",
      [id,periodEnd]
    );
    await audit(client, admin,tenant.id,"invoice",invoice.id,"subscription_draft_generated",{
      subscriptionId:id,periodStart,periodEnd,planVersionId:terms.id,source,installed:installed.length,
      billedDevices:claims.rowCount,excessDevices:excess,alreadyClaimed:installed.length-claims.rowCount,
    });
    return { id:invoice.id,replayed:false };
  });
}

async function generateDue(body, admin, source = "platform_batch") {
  const { limit } = v.fields(body,{ limit:v.integer(1,50) },["limit"]);
  const { rows } = await pool.query(
    `SELECT s.id,s.next_bill_on::text FROM billing_subscriptions s JOIN tenants t ON t.id=s.tenant_id
      WHERE s.renewal_mode='automatic' AND s.status IN ('trialing','active','past_due') AND s.next_bill_on<=${b.UTC_TODAY}
      AND t.status='active' ORDER BY s.next_bill_on,s.id LIMIT $1`, [limit]
  );
  const results = [];
  for (const row of rows) {
    try {
      results.push({ subscriptionId:row.id,...await generate(row.id,{ periodStart:row.next_bill_on },admin,source) });
    } catch (error) {
      if (!(error.status || ["23505","23P01","40P01"].includes(error.code))) throw error;
      results.push({ subscriptionId:row.id,error:error.status ? error.message : "Conflicting billing period." });
    }
  }
  return { results };
}

async function replaceLines(id, body, admin) {
  const { lines } = v.fields(body,{ lines:manualLines },["lines"]);
  await transaction(async (client) => {
    const invoice = await lockedInvoice(client,id);
    if (invoice.issued_on || invoice.voided_at) fail(409, "Only a draft can be edited.");
    if (!invoice.subscription_id && !lines.length) fail(400, "Add at least one line.");
    await client.query("DELETE FROM billing_invoice_lines WHERE invoice_id=$1 AND kind=ANY($2::text[])",[id,kinds]);
    await addLines(client,invoice,lines);
    await audit(client,admin,invoice.tenant_id,"invoice",id,"draft_lines_changed",{ manualLineCount:lines.length });
  });
  return invoiceDetail(id);
}

async function finalize(id, body, admin) {
  const values = v.fields(body,{ issuedOn:b.date,dueOn:v.date },["issuedOn"]);
  await transaction(async (client) => {
    const invoice = await lockedInvoice(client,id);
    if (invoice.voided_at) fail(409, "A void invoice cannot be issued.");
    const { rows: [dates] } = await client.query(
      "SELECT COALESCE($2::date,$1::date+$3::integer)::text AS due",
      [values.issuedOn,values.dueOn ?? null,invoice.generation_terms?.paymentDays ?? 14]
    );
    if (invoice.issued_on) {
      if (invoice.issued_on === values.issuedOn && invoice.due_on === dates.due) return;
      fail(409, "This invoice is already issued.");
    }
    if (values.issuedOn > await b.today(client) || dates.due < values.issuedOn) fail(400,"Check the issue and due dates.");
    const { rows: [totals] } = await client.query(
      `SELECT count(*)::int AS count,
         COALESCE(sum(amount) FILTER (WHERE kind<>'tax'),0)>=0 AND COALESCE(sum(amount),0)>=0 AS valid
       FROM billing_invoice_lines WHERE invoice_id=$1`,[id]
    );
    if (!totals.count || !totals.valid) fail(409,"An issued invoice needs lines and discounts cannot exceed the pre-tax charges.");
    const { rows: [{ seq }] } = await client.query("SELECT nextval('billing_invoice_number_seq')::text AS seq");
    const number = `SNA-${seq.padStart(10,"0")}`;
    await client.query("UPDATE billing_invoices SET invoice_number=$2,issued_on=$3,due_on=$4 WHERE id=$1",[id,number,values.issuedOn,dates.due]);
    await audit(client,admin,invoice.tenant_id,"invoice",id,"invoice_issued",{ number,issuedOn:values.issuedOn,dueOn:dates.due });
  });
  return invoiceDetail(id);
}

async function voidInvoice(id, body, admin) {
  const { reason } = v.fields(body,{ reason:v.text(500,true) },["reason"]);
  await transaction(async (client) => {
    const invoice = await lockedInvoice(client,id);
    if (invoice.voided_at) return;
    const { rows: [{ paid }] } = await client.query("SELECT collected>0 AS paid FROM billing_invoice_balances WHERE id=$1",[id]);
    if (paid) fail(409,"Reverse outstanding payments before voiding.");
    await client.query("UPDATE billing_invoices SET voided_at=now() WHERE id=$1",[id]);
    await client.query("UPDATE billing_device_snapshots SET released_at=now() WHERE invoice_id=$1",[id]);
    await audit(client,admin,invoice.tenant_id,"invoice",id,"invoice_voided",{ reason });
  });
  return invoiceDetail(id);
}

async function recordPayment(id, body, admin) {
  const p = v.fields(body,{
    amount:b.money,currency:b.currency,paidOn:b.date,method:v.choice(["cash","bank_transfer","cheque","other"]),
    externalReference:v.text(120),notes:v.text(500),requestKey:b.requestKey,
  },["amount","currency","paidOn","method","requestKey"]);
  b.currencyScale(p.amount,p.currency);
  return transaction(async (client) => {
    const invoice = await lockedInvoice(client,id);
    const { rows: [existing] } = await client.query(
      "SELECT p.*, p.paid_on::text FROM billing_payments p WHERE invoice_id=$1 AND request_key=$2",[id,p.requestKey]
    );
    if (existing) {
      if (existing.amount !== p.amount || existing.currency !== p.currency || existing.paid_on !== p.paidOn ||
         existing.method !== p.method || existing.external_reference !== (p.externalReference ?? null) ||
         existing.notes !== (p.notes ?? null)) fail(409,"This request key was used for a different payment.");
      return { id:existing.id,replayed:true };
    }
    if (!invoice.issued_on || invoice.voided_at || invoice.currency !== p.currency) fail(409,"Payment requires an issued invoice in the same currency.");
    if (p.paidOn < invoice.issued_on || p.paidOn > await b.today(client)) fail(400,"Payment date must be between issue date and today.");
    const { rows: [{ allowed }] } = await client.query(
      "SELECT $2::numeric>0 AND $2::numeric<=balance AS allowed FROM billing_invoice_balances WHERE id=$1",[id,p.amount]
    );
    if (!allowed) fail(409,"Payment must be positive and cannot exceed the outstanding balance.");
    const { rows: [payment] } = await client.query(
      `INSERT INTO billing_payments (invoice_id,tenant_id,currency,amount,paid_on,method,external_reference,notes,request_key,recorded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [id,invoice.tenant_id,p.currency,p.amount,p.paidOn,p.method,p.externalReference ?? null,p.notes ?? null,p.requestKey,admin]
    );
    await audit(client,admin,invoice.tenant_id,"invoice",id,"payment_recorded",{ paymentId:payment.id,amount:p.amount,currency:p.currency });
    return { id:payment.id,replayed:false };
  });
}

async function reversePayment(id,paymentId,body,admin) {
  const { reason } = v.fields(body,{ reason:v.text(500,true) },["reason"]);
  return transaction(async (client) => {
    const invoice = await lockedInvoice(client,id);
    const { rows: [payment] } = await client.query(
      `SELECT p.id,r.reason AS reversed FROM billing_payments p LEFT JOIN billing_payment_reversals r ON r.payment_id=p.id
       WHERE p.id=$1 AND p.invoice_id=$2`,[paymentId,id]
    );
    if (!payment) fail(404,"Payment not found.");
    if (payment.reversed !== null) {
      if (payment.reversed !== reason) fail(409,"This payment has already been reversed.");
      return { id:paymentId,replayed:true };
    }
    await client.query("INSERT INTO billing_payment_reversals(payment_id,reason,recorded_by) VALUES($1,$2,$3)",[paymentId,reason,admin]);
    await audit(client,admin,invoice.tenant_id,"invoice",id,"payment_reversed",{ paymentId,reason });
    return { id:paymentId,replayed:false };
  });
}

module.exports = { invoiceList,invoiceDetail,paymentList,manualInvoice,generate,generateDue,replaceLines,finalize,voidInvoice,recordPayment,reversePayment };
