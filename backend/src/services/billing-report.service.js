const b = require("./billing-common");
const { pool, v, fail } = b;

async function tenants(query) {
  const paging = v.queryPage(query, ["q"]);
  const q = (v.text(150)(query.q) || "").toLowerCase();
  const { rows } = await pool.query(
    `SELECT id,name,slug,status,customer_type FROM tenants WHERE strpos(lower(concat_ws(' ',name,slug)), $1)>0
     ORDER BY lower(name),id LIMIT $2 OFFSET $3`, [q,paging.limit + 1,paging.offset]
  );
  return v.page(rows,paging);
}

async function report(query) {
  if (Object.keys(query).some((key) => !["from","to","tenantId"].includes(key))) fail(400,"Invalid report filter.");
  const end = query.to ? b.date(query.to) : await b.today();
  const start = query.from ? b.date(query.from) : end.slice(0,8) + "01";
  if (start > end) fail(400,"Report start must not follow its end.");
  const tenantId = v.optionalId(query.tenantId);
  if (tenantId && !(await pool.query("SELECT 1 FROM tenants WHERE id=$1",[tenantId])).rowCount) fail(404,"Tenant not found.");
  const [financial, subscriptions, upcoming] = await Promise.all([
    pool.query(`WITH amounts AS (
      SELECT currency,sum(total) AS invoiced,sum(balance) AS outstanding,count(*) FILTER(WHERE status='overdue') AS overdue
      FROM billing_invoice_balances
      WHERE issued_on BETWEEN $1 AND $2 AND voided_at IS NULL AND ($3::bigint IS NULL OR tenant_id=$3)
      GROUP BY currency
    ), ledger AS (
      SELECT p.currency,p.amount FROM billing_payments p
      WHERE p.paid_on BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR p.tenant_id=$3)
      UNION ALL
      SELECT p.currency,-p.amount FROM billing_payment_reversals r JOIN billing_payments p ON p.id=r.payment_id
      WHERE (r.created_at AT TIME ZONE 'UTC')::date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR p.tenant_id=$3)
    ), received AS (SELECT currency,sum(amount) AS collected FROM ledger GROUP BY currency)
    SELECT currency,COALESCE(invoiced,0)::numeric(32,4) AS invoiced,
      COALESCE(collected,0)::numeric(32,4) AS collected,
      COALESCE(outstanding,0)::numeric(32,4) AS outstanding,COALESCE(overdue,0)::int AS overdue
    FROM amounts FULL OUTER JOIN received USING(currency) ORDER BY currency`,[start,end,tenantId]),
    pool.query(`SELECT count(*) FILTER(WHERE status IN ('active','past_due','trialing'))::int AS active,
      count(*) FILTER(WHERE status IN ('active','past_due','trialing') AND
        next_bill_on <= ${b.UTC_TODAY}+notice_days)::int AS upcoming
      FROM billing_subscriptions WHERE ($1::bigint IS NULL OR tenant_id=$1)`,[tenantId]),
    pool.query(`SELECT s.id,s.tenant_id,t.name AS tenant_name,s.next_bill_on::text,s.renewal_mode
      FROM billing_subscriptions s JOIN tenants t ON t.id=s.tenant_id
      WHERE s.status IN ('active','past_due','trialing') AND next_bill_on<=${b.UTC_TODAY}+notice_days
        AND ($1::bigint IS NULL OR s.tenant_id=$1) ORDER BY s.next_bill_on,s.id LIMIT 25`,[tenantId]),
  ]);
  return { from:start,to:end,currencies:financial.rows,...subscriptions.rows[0],renewals:upcoming.rows };
}

async function history(resource,id,query) {
  const paging = v.queryPage(query, []);
  const { rows } = await pool.query(
    `SELECT e.id,e.action,e.created_at,e.details - 'fingerprint' AS details, a.full_name AS actor_name
    FROM billing_events e JOIN platform_admins a ON a.id=e.platform_admin_id
    WHERE e.resource=$1 AND e.resource_id=$2 ORDER BY e.id DESC LIMIT $3 OFFSET $4`,
    [resource,id,paging.limit + 1,paging.offset]
  );
  return v.page(rows,paging);
}

module.exports = { tenants, report, history };
