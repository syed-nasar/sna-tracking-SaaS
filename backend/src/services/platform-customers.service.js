const pool = require("../config/db");
const { fail, parseId } = require("./gps-inventory.service");

function choice(value, allowed) {
  if (value === undefined || value === "") return "";
  if (!allowed.includes(value)) fail(400,"Invalid filter.");
  return value;
}

function text(value, max = 150) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > max || value.includes("\0")) fail(400,"Invalid search or filter.");
  return value.trim();
}

function page(query, defaultLimit = 50) {
  function number(value, fallback, min, max) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d{1,7}$/.test(value) || Number(value)<min || Number(value)>max) {
      fail(400,"Invalid pagination.");
    }
    return Number(value);
  }
  return [number(query.limit,defaultLimit,1,100),number(query.offset,0,0,1000000)];
}

function optionalId(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !parseId(value)) fail(400,"Invalid resource identifier.");
  return value;
}

const customerFields = `t.id,t.name,t.slug,t.email,t.phone,t.status,t.customer_type,t.created_at,t.updated_at,
  t.xmin::text AS version,t.reseller_id,r.display_name AS reseller_name,
  CASE WHEN t.reseller_id IS NULL THEN 'direct' ELSE 'reseller' END AS ownership`;

async function customers(query) {
  const args = [text(query.q).toLowerCase(),choice(query.type,["personal","business"]),
    choice(query.status,["active","suspended","inactive"]),choice(query.ownership,["direct","reseller"]),
    optionalId(query.resellerId)];
  const [limit,offset] = page(query);
  const {rows:[result]} = await pool.query(`WITH matching AS (
    SELECT ${customerFields} FROM tenants t LEFT JOIN resellers r ON r.id=t.reseller_id
    WHERE ($1='' OR strpos(lower(concat_ws(' ',t.name,t.slug,t.email)),$1)>0)
      AND ($2='' OR t.customer_type=$2) AND ($3='' OR t.status=$3)
      AND ($4='' OR ($4='direct' AND t.reseller_id IS NULL) OR ($4='reseller' AND t.reseller_id IS NOT NULL))
      AND ($5::bigint IS NULL OR t.reseller_id=$5)
  ), result_page AS (SELECT * FROM matching ORDER BY id LIMIT $6 OFFSET $7)
  SELECT (SELECT count(*)::int FROM matching) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.id::text,'reseller_id',p.reseller_id::text) ORDER BY p.id)
      FROM result_page p),'[]'::jsonb) AS data`,[...args,limit,offset]);
  return {data:result.data,pagination:{limit,offset,returned:result.data.length,total:result.total,hasMore:offset+limit<result.total}};
}

async function detail(id) {
  const {rows:[customer]} = await pool.query(`SELECT ${customerFields},
    (SELECT count(*)::int FROM vehicles v WHERE v.tenant_id=t.id) AS vehicle_count,
    (SELECT count(*)::int FROM vehicles v WHERE v.tenant_id=t.id AND v.status='active') AS active_vehicle_count,
    (SELECT count(*)::int FROM gps_devices d WHERE d.tenant_id=t.id) AS allocated_gps_count,
    (SELECT count(*)::int FROM gps_devices d WHERE d.tenant_id=t.id AND lifecycle_status='installed') AS installed_gps_count,
    (SELECT s.status FROM billing_subscriptions s WHERE s.tenant_id=t.id ORDER BY s.id DESC LIMIT 1) AS subscription_status
    FROM tenants t LEFT JOIN resellers r ON r.id=t.reseller_id WHERE t.id=$1`,[id]);
  if (!customer) fail(404,"Customer not found.");
  const [admins,activity] = await Promise.all([
    pool.query(`SELECT u.id,u.full_name,u.email,u.is_active,i.expires_at,i.used_at
      FROM users u LEFT JOIN LATERAL (SELECT expires_at,used_at FROM user_invitations
        WHERE user_id=u.id ORDER BY id DESC LIMIT 1) i ON true
      WHERE u.tenant_id=$1 AND u.role='tenant_admin' ORDER BY u.id LIMIT 25`,[id]),
    pool.query(`SELECT id::text,action,created_at FROM platform_audit_logs
      WHERE resource_type='tenant' AND resource_id=$1
      UNION ALL SELECT 'reseller:'||id,action,created_at FROM reseller_audit WHERE reseller_id=$2 AND target_id=$1
        AND action IN ('customer.onboarded','customer.active','customer.suspended')
      ORDER BY created_at DESC,id DESC LIMIT 12`,[id,customer.reseller_id]),
  ]);
  return {...customer,administrators:admins.rows,recent_activity:activity.rows};
}

module.exports = { customers,detail,choice,text,page,optionalId };
