const b = require("./billing-common");
const { pool, v, fail, transaction, audit } = b;

const statuses = ["draft","trialing","active","past_due","suspended","cancelled","expired"];
const currentStatuses = ["trialing", "active", "past_due", "suspended"];
const transitions = {
  draft: ["activate", "cancel"],
  trialing: ["suspend", "cancel", "expire"],
  active: ["suspend", "cancel", "expire"],
  past_due: ["suspend", "cancel", "expire"],
  suspended: ["reactivate", "cancel", "expire"],
  cancelled: ["reactivate"],
  expired: ["reactivate"],
};
const termFields = {
  planVersionId: v.id, baseOverride: b.optionalMoney, excessOverride: b.optionalMoney,
  reason: v.text(500),
};

async function lockedSubscription(client, id) {
  const { rows: [row] } = await client.query(
    `SELECT s.*, s.starts_on::text, s.next_bill_on::text, s.anchor_on::text, s.trial_ends_on::text
     FROM billing_subscriptions s WHERE id=$1 FOR UPDATE`, [id]
  );
  if (!row) fail(404, "Subscription not found.");
  return row;
}

async function checkVersion(client, versionId, tenant, effectiveOn) {
  const { rows: [row] } = await client.query(
    `SELECT p.name AS plan_name,p.audience,p.archived_at,v.*,v.effective_on::text FROM billing_plan_versions v
      JOIN billing_plans p ON p.id=v.plan_id WHERE v.id=$1 FOR SHARE OF p`, [versionId]
  );
  if (!row) fail(404, "Plan version not found.");
  if (row.archived_at || !["both", tenant.customer_type].includes(row.audience)) fail(409, "This plan is unavailable for the customer type.");
  const { rows: [current] } = await client.query(
    `SELECT id FROM billing_plan_versions WHERE plan_id=$1 AND effective_on <= $2
      ORDER BY effective_on DESC LIMIT 1`, [row.plan_id, effectiveOn]
  );
  if (current?.id !== row.id) fail(409, "Choose the published plan version effective on the subscription date.");
  return row;
}

async function appendTerms(client, subscription, values, tenant, effectiveOn, admin) {
  const version = await checkVersion(client, values.planVersionId, tenant, effectiveOn);
  if ((values.baseOverride != null || values.excessOverride != null) && !values.reason) fail(400, "Negotiated pricing requires an approval reason.");
  for (const price of [values.baseOverride, values.excessOverride]) b.currencyScale(price, version.currency);
  const { rows: [term] } = await client.query(
    `INSERT INTO billing_subscription_terms (subscription_id,plan_version_id,effective_on,base_override,excess_override,override_reason,approved_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [
      subscription.id, version.id, effectiveOn, values.baseOverride ?? null, values.excessOverride ?? null, values.reason ?? null, admin,
    ]
  );
  await audit(client, admin, tenant.id, "subscription", subscription.id, "terms_approved", {
    planVersionId: version.id, termId: term.id, effectiveOn, hasOverride: values.baseOverride != null || values.excessOverride != null,
  });
}

async function termsFor(client, id, date) {
  const { rows: [term] } = await client.query(
    `SELECT term.id AS term_id,term.effective_on::text AS term_starts_on,term.base_override,term.excess_override,
       p.name AS plan_name,p.code AS plan_code,p.audience,p.archived_at,v.*,
       COALESCE(term.base_override,v.base_price) AS effective_base,
       COALESCE(term.excess_override,v.excess_price) AS effective_excess
     FROM billing_subscription_terms term JOIN billing_plan_versions v ON v.id=term.plan_version_id
       JOIN billing_plans p ON p.id=v.plan_id
     WHERE term.subscription_id=$1 AND term.effective_on <= $2
     ORDER BY term.effective_on DESC,term.id DESC LIMIT 1`, [id, date]
  );
  if (!term) fail(409, "No subscription terms cover this date.");
  return term;
}

const listing = `SELECT s.id,s.tenant_id,t.name AS tenant_name,s.status,s.starts_on::text,s.next_bill_on::text,
  s.trial_ends_on::text,s.ends_on::text,s.renewal_mode,s.notice_days,
  p.name AS plan_name,v.id AS plan_version_id,v.currency,v.device_limit,v.user_limit,v.features,
  v.grace_days,v.included_devices,v.interval_months,
  COALESCE(term.base_override,v.base_price) AS effective_base,
  COALESCE(term.excess_override,v.excess_price) AS effective_excess,
  (s.next_bill_on-${b.UTC_TODAY}) AS days_to_renewal,
  CASE WHEN s.status IN ('active','past_due','trialing') AND
    (s.status='past_due' OR EXISTS(SELECT 1 FROM billing_invoice_balances i WHERE i.subscription_id=s.id
      AND i.voided_at IS NULL AND i.due_on < ${b.UTC_TODAY} AND i.balance>0)) THEN 'past_due'
    WHEN s.status='trialing' AND s.trial_ends_on <= ${b.UTC_TODAY} THEN 'active'
    ELSE s.status END AS effective_status,
  (SELECT min(i.due_on + COALESCE((i.generation_terms->>'graceDays')::integer,0)) FROM billing_invoice_balances i
    WHERE i.subscription_id=s.id AND i.voided_at IS NULL AND i.due_on < ${b.UTC_TODAY} AND i.balance>0)::text AS grace_until
  FROM billing_subscriptions s JOIN tenants t ON t.id=s.tenant_id
  LEFT JOIN LATERAL (SELECT * FROM billing_subscription_terms st WHERE st.subscription_id=s.id
    AND st.effective_on <= GREATEST(s.starts_on, ${b.UTC_TODAY}) ORDER BY st.effective_on DESC,st.id DESC LIMIT 1) term ON TRUE
  LEFT JOIN billing_plan_versions v ON v.id=term.plan_version_id LEFT JOIN billing_plans p ON p.id=v.plan_id`;

function entitlements(subscription, date) {
  let warning = null;
  if (subscription.effective_status === "past_due") {
    warning = subscription.grace_until && subscription.grace_until >= date ? "payment_grace" : "payment_overdue";
  } else if (["suspended", "cancelled", "expired"].includes(subscription.effective_status)) {
    warning = subscription.effective_status;
  }
  return { policy: "warnings_only", warning, deviceLimit: subscription.device_limit, userLimit: subscription.user_limit,
    features: subscription.features ?? [] };
}

async function subscriptionList(query, tenantId) {
  const paging = v.queryPage(query, tenantId ? [] : ["tenantId", "status"]);
  const { rows } = await pool.query(
    `SELECT * FROM (${listing} WHERE ($1::bigint IS NULL OR s.tenant_id=$1)) subscriptions
     WHERE ($2::text IS NULL OR effective_status=$2)
     ORDER BY CASE WHEN status IN ('trialing','active','past_due','suspended') THEN 0 ELSE 1 END,id DESC LIMIT $3 OFFSET $4`,
    [tenantId || v.optionalId(query.tenantId), v.choice(statuses, true)(query.status), paging.limit + 1, paging.offset]
  );
  const date = await b.today();
  return v.page(rows.map((row) => ({ ...row, entitlements: entitlements(row, date) })), paging);
}

async function subscriptionDetail(id) {
  const { rows: [subscription] } = await pool.query(`${listing} WHERE s.id=$1`, [id]);
  if (!subscription) fail(404, "Subscription not found.");
  const { rows: terms } = await pool.query(
    `SELECT st.id,st.effective_on::text,st.plan_version_id,st.base_override,st.excess_override,st.override_reason,
     st.approved_by,st.created_at,p.name AS plan_name,v.currency
     FROM billing_subscription_terms st JOIN billing_plan_versions v ON v.id=st.plan_version_id JOIN billing_plans p ON p.id=v.plan_id
     WHERE st.subscription_id=$1 ORDER BY st.id DESC LIMIT 50`, [id]
  );
  const date = await b.today();
  return { ...subscription, terms, entitlements: entitlements(subscription, date) };
}

async function createSubscription(body, admin) {
  const values = v.fields(body, {
    ...termFields, tenantId: v.id, startsOn: b.date, renewalMode: v.choice(["manual","automatic"]),
    noticeDays: v.integer(0, 365),
  }, ["tenantId", "startsOn", "planVersionId", "renewalMode"]);
  const id = await transaction(async (client) => {
    const tenant = await b.lockTenant(client, values.tenantId);
    if (tenant.status !== "active") fail(409, "Select an active tenant.");
    const { rows: [sub] } = await client.query(
      `INSERT INTO billing_subscriptions (tenant_id,starts_on,next_bill_on,anchor_on,renewal_mode,notice_days)
       VALUES($1,$2,$2,$2,$3,$4) RETURNING id`, [tenant.id, values.startsOn, values.renewalMode, values.noticeDays ?? 7]
    );
    await audit(client, admin, tenant.id, "subscription", sub.id, "subscription_created", { startsOn: values.startsOn });
    await appendTerms(client, sub, values, tenant, values.startsOn, admin);
    return sub.id;
  });
  return subscriptionDetail(id);
}

async function changeSubscription(id, body, admin) {
  const { action, reason } = v.fields(body, {
    action: v.choice(["activate","suspend","cancel","expire","reactivate"]), reason: v.text(500, true),
  }, ["action","reason"]);
  await transaction(async (client) => {
    const sub = await lockedSubscription(client, id);
    const tenant = await b.lockTenant(client, sub.tenant_id);
    if (!transitions[sub.status].includes(action)) fail(409, "This subscription transition is not permitted.");
    const date = await b.today(client);
    let nextBill = sub.next_bill_on;
    let anchor = sub.anchor_on;
    let trial = sub.trial_ends_on;
    let nextState = { suspend: "suspended", cancel: "cancelled", expire: "expired" }[action];
    if (["activate","reactivate"].includes(action)) {
      if (tenant.status !== "active" || sub.starts_on > date) fail(409, "Activation requires an active tenant and a start date on or before today.");
      const duplicate = await client.query("SELECT 1 FROM billing_subscriptions WHERE tenant_id=$1 AND id<>$2 AND status=ANY($3::text[])",
        [sub.tenant_id,id,currentStatuses]);
      if (duplicate.rowCount) fail(409, "This tenant already has a current hosted subscription.");
      const term = await termsFor(client, id, sub.next_bill_on);
      if (action === "activate") {
        await checkVersion(client, term.id, tenant, sub.starts_on);
        trial = term.trial_days ? (await client.query("SELECT ($1::date+$2::integer)::text AS date", [sub.starts_on,term.trial_days])).rows[0].date : null;
        nextBill = trial ?? sub.starts_on;
        anchor = nextBill;
      } else if (nextBill < date && sub.status !== "suspended") {
        nextBill = date;
        anchor = date;
      }
      const { rows: [{ end }] } = await client.query(
        `SELECT max(period_end)::text AS end FROM billing_invoices WHERE tenant_id=$1 AND subscription_id <> $2 AND voided_at IS NULL`,
        [tenant.id,id]
      );
      if (end && nextBill < end) fail(409, "Another subscription already billed part of this period. Use a start date after its coverage ends.");
      nextState = trial && trial > date ? "trialing" : "active";
    }
    await client.query(
      `UPDATE billing_subscriptions SET status=$2,next_bill_on=$3,anchor_on=$4,trial_ends_on=$5,ends_on=$6 WHERE id=$1`,
      [id,nextState,nextBill,anchor,trial,["cancelled","expired"].includes(nextState) ? date : null]
    );
    await audit(client, admin, tenant.id, "subscription", id, "subscription_status_changed", { from: sub.status,to: nextState,reason });
  });
  return subscriptionDetail(id);
}

async function changeTerms(id, body, admin) {
  const values = v.fields(body, { ...termFields, effectiveOn: b.date }, ["planVersionId","effectiveOn"]);
  await transaction(async (client) => {
    const sub = await lockedSubscription(client, id);
    const tenant = await b.lockTenant(client, sub.tenant_id);
    if (!["draft", ...currentStatuses].includes(sub.status) || values.effectiveOn !== sub.next_bill_on) {
      fail(409, "Plan changes must use the next unbilled period start.");
    }
    await appendTerms(client, sub, values, tenant, values.effectiveOn, admin);
  });
  return subscriptionDetail(id);
}

async function schedule(id, body, admin) {
  const values = v.fields(body, {
    renewalMode: v.choice(["manual","automatic"]), noticeDays: v.integer(0, 365),
  });
  await transaction(async (client) => {
    const sub = await lockedSubscription(client, id);
    await client.query("UPDATE billing_subscriptions SET renewal_mode=$2,notice_days=$3 WHERE id=$1",
      [id,values.renewalMode ?? sub.renewal_mode,values.noticeDays ?? sub.notice_days]);
    await audit(client, admin, sub.tenant_id, "subscription", id, "schedule_updated", values);
  });
  return subscriptionDetail(id);
}

module.exports = { lockedSubscription, termsFor, subscriptionList, subscriptionDetail, createSubscription, changeSubscription, changeTerms, schedule };
