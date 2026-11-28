const pool = require("../config/db");
const { vehicleSummary } = require("./platform-vehicles.service");
const { diagnostics } = require("./gps-provisioning.service");
const { healthProbe } = require("./traccar.service");
const { configStatus } = require("./company-invitation-email");
const { smtpEnabled } = require("./alert-email");
const sims = require("./sim-inventory.service");
const billing = require("./billing-report.service");
const { choice,text,page,optionalId } = require("./platform-customers.service");

const one = async (sql,args) => (await pool.query(sql,args)).rows[0];
async function summary() {
  const [customers,resellers,vehicles,gps,provisioning] = await Promise.all([
    one(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE customer_type='personal')::int AS personal,
      count(*) FILTER(WHERE customer_type='business')::int AS business,
      count(*) FILTER(WHERE status='active')::int AS active,
      count(*) FILTER(WHERE status='suspended')::int AS suspended,
      count(*) FILTER(WHERE reseller_id IS NULL)::int AS direct,
      count(*) FILTER(WHERE reseller_id IS NOT NULL)::int AS reseller_owned FROM tenants`),
    one(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='active')::int AS active,
      count(*) FILTER(WHERE status='suspended')::int AS suspended FROM resellers`),
    vehicleSummary(),
    one(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE lifecycle_status='available')::int AS available,
      count(*) FILTER(WHERE lifecycle_status='reserved')::int AS reserved,
      count(*) FILTER(WHERE lifecycle_status='installed')::int AS installed,
      count(*) FILTER(WHERE lifecycle_status='faulty')::int AS faulty,
      count(*) FILTER(WHERE lifecycle_status='retired')::int AS retired,
      count(*) FILTER(WHERE tenant_id IS NULL AND reseller_id IS NULL)::int AS platform_stock,
      count(*) FILTER(WHERE reseller_id IS NOT NULL)::int AS reseller_assigned,
      count(*) FILTER(WHERE tenant_id IS NOT NULL)::int AS customer_allocated FROM gps_devices`),
    one(`SELECT COALESCE((SELECT jsonb_object_agg(status,total) FROM
      (SELECT provisioning_status AS status,count(*)::int AS total
       FROM gps_devices GROUP BY provisioning_status) counts),'{}') AS counts,
      min(created_at) AS oldest_work_at FROM gps_provisioning_attempts
      WHERE status IN ('pending','processing','retry')`),
  ]);
  const counts = Object.fromEntries(["pending","processing","retry","provisioned","failed","conflict","legacy"]
    .map(key=>[key,provisioning.counts[key] ?? 0]));
  return {generatedAt:new Date().toISOString(),customers,resellers,vehicles,gps,provisioning:{...provisioning,counts}};
}

async function provisioning(query) {
  const status = choice(query.status,["pending","processing","retry","failed","conflict","legacy","provisioned"]);
  const resellerId = optionalId(query.resellerId);
  const search = text(query.q).toLowerCase();
  const [limit,offset] = page(query,25);
  const {rows} = await pool.query(`SELECT d.id,d.unique_identifier,d.device_name,d.lifecycle_status,d.provisioning_status,
    d.reseller_id,r.display_name AS reseller_name,d.tenant_id,t.name AS customer_name,
    (SELECT e.created_at FROM gps_provisioning_events e WHERE e.attempt_id=a.id AND e.action='processing'
      ORDER BY e.id DESC LIMIT 1) AS last_attempt_at,a.completed_at,a.outcome_code,
    CASE WHEN a.status IN ('pending','retry') THEN a.next_retry_at END AS next_retry_at,
    COALESCE(a.status='processing' AND a.lease_until<=clock_timestamp(),false) AS stale_claim,
    (d.provisioning_status IN ('failed','conflict') AND d.lifecycle_status NOT IN ('faulty','retired')
       AND a.id IS NOT NULL) AS can_retry,
    extract(epoch FROM clock_timestamp()-COALESCE(a.created_at,d.created_at))::bigint AS age_seconds
    FROM gps_devices d LEFT JOIN resellers r ON r.id=d.reseller_id LEFT JOIN tenants t ON t.id=d.tenant_id
    LEFT JOIN LATERAL (SELECT id,status,created_at,completed_at,next_retry_at,lease_until,outcome_code
      FROM gps_provisioning_attempts WHERE device_id=d.id ORDER BY id DESC LIMIT 1) a ON true
    WHERE (($1='' AND d.provisioning_status<>'provisioned') OR d.provisioning_status=$1)
      AND ($2::bigint IS NULL OR d.reseller_id=$2)
      AND ($3='' OR strpos(lower(concat_ws(' ',d.id,d.device_name,d.unique_identifier)),$3)>0)
      AND ($4='' OR (a.status='processing' AND a.lease_until<=clock_timestamp()))
    ORDER BY COALESCE(a.created_at,d.created_at),d.id LIMIT $5 OFFSET $6`,
  [status,resellerId,search,choice(query.stale,["yes"]),limit+1,offset]);
  return {data:rows.slice(0,limit),pagination:{limit,offset,hasMore:rows.length>limit}};
}

const invitationProjection = `WITH latest_customer AS (
  SELECT DISTINCT ON (user_id) id,tenant_id,user_id,created_at,expires_at,used_at FROM user_invitations
  ORDER BY user_id,id DESC
), latest_reseller AS (
  SELECT DISTINCT ON (admin_id) id,admin_id,created_at,expires_at,used_at FROM reseller_invitations
  ORDER BY admin_id,id DESC
), deliveries AS (
  SELECT 'customer' AS kind,i.id,i.tenant_id,t.reseller_id,NULL::bigint AS admin_id,t.name AS target,
    q.status,q.attempts,q.updated_at,q.available_at,i.created_at,i.expires_at,i.used_at
  FROM latest_customer i JOIN company_invitation_email q ON q.invitation_id=i.id JOIN tenants t ON t.id=i.tenant_id
  UNION ALL
  SELECT 'reseller',i.id,NULL,a.reseller_id,a.id,r.display_name,q.status,q.attempts,q.updated_at,
    q.available_at,i.created_at,i.expires_at,i.used_at
  FROM latest_reseller i JOIN reseller_invitation_email q ON q.invitation_id=i.id
    JOIN reseller_admins a ON a.id=i.admin_id JOIN resellers r ON r.id=a.reseller_id
)`;

async function invitations(query) {
  const kind = choice(query.kind,["customer","reseller"]);
  const status = choice(query.status,["pending","retry","sending","failed","uncertain"]);
  const [limit,offset] = page(query,25);
  const {rows} = await pool.query(`${invitationProjection}
    SELECT kind,id,tenant_id,reseller_id,admin_id,target,
      CASE WHEN status='pending' AND attempts>0 THEN 'retry' ELSE status END AS status,
      attempts,updated_at,available_at,expires_at,used_at,
      extract(epoch FROM clock_timestamp()-created_at)::bigint AS age_seconds
    FROM deliveries WHERE used_at IS NULL AND status IN ('pending','sending','failed','uncertain')
      AND ($1='' OR kind=$1) AND ($2='' OR
      CASE WHEN status='pending' AND attempts>0 THEN 'retry' ELSE status END=$2)
    ORDER BY created_at,kind,id LIMIT $3 OFFSET $4`,[kind,status,limit+1,offset]);
  return {data:rows.slice(0,limit),pagination:{limit,offset,hasMore:rows.length>limit}};
}

function bounded(run, timeout = 2800) {
  const start = Date.now();
  return new Promise(resolve=>{
    const finish = (status,data) => {
      clearTimeout(timer);
      resolve({status,checkedAt:new Date().toISOString(),durationMs:Date.now()-start,...data});
    };
    const timer = setTimeout(()=>finish("unavailable"),timeout);
    Promise.resolve().then(run).then(data=>finish(data.status??"healthy",data),()=>finish("unavailable"));
  });
}

const queues = () => one(`SELECT
  (SELECT max(received_at) FROM alert_ingestion) AS last_receipt,
  (SELECT last_success_at FROM alert_worker_health WHERE worker='ingestion') AS last_success,
  (SELECT count(*)::int FROM alert_ingestion WHERE status='pending') AS pending,
  (SELECT count(*)::int FROM alert_ingestion WHERE status='pending' AND attempts>0) AS retrying,
  (SELECT min(received_at) FROM alert_ingestion WHERE status='pending') AS oldest_pending,
  (SELECT count(*)::int FROM alert_ingestion WHERE status='failed') AS failed,
  (SELECT COALESCE(jsonb_object_agg(status,total),'{}') FROM
    (SELECT status,count(*)::int AS total FROM alert_geofence_sync GROUP BY status) g) AS geofences,
  (SELECT count(*)::int FROM alert_notifications) AS notifications_recorded,
  (SELECT COALESCE(jsonb_object_agg(status,total),'{}') FROM
    (SELECT status,count(*)::int AS total FROM alert_email_delivery GROUP BY status) a) AS alert_email`);

let currentHealth;
let lastHealth;
function health() {
  if (lastHealth && Date.now()-lastHealth.time<3000) return Promise.resolve(lastHealth.result);
  if (currentHealth) return currentHealth;
  const forwardingConfigured = Boolean(process.env.ALERT_FORWARD_TOKEN?.length>=32);
  const invitationMode = configStatus();
  const [startedAt,uptimeSeconds] = [new Date(Date.now()-process.uptime()*1000).toISOString(),Math.floor(process.uptime())];
  currentHealth = Promise.all([
    bounded(async()=>{ await pool.query({text:"SELECT 1",query_timeout:1500}); return {}; }),
    bounded(healthProbe),
    bounded(async()=>{
      const row=await one(`SELECT min(a.created_at) FILTER(WHERE a.status IN ('pending','processing','retry')) AS oldest_work_at,
        count(*) FILTER(WHERE a.status='processing' AND a.lease_until<=clock_timestamp())::int AS expired_claims,
        count(*) FILTER(WHERE a.status IN ('pending','processing','retry'))::int AS outstanding,
        count(DISTINCT a.device_id) FILTER(WHERE a.status='failed' AND d.provisioning_status='provisioned')::int AS recovered_devices,
        (SELECT COALESCE(jsonb_object_agg(status,total),'{}') FROM
          (SELECT status,count(*)::int AS total FROM gps_provisioning_attempts GROUP BY status) c) AS counts,
        (SELECT COALESCE(jsonb_object_agg(provisioning_status,total),'{}') FROM
          (SELECT provisioning_status,count(*)::int AS total FROM gps_devices GROUP BY provisioning_status) s) AS device_counts
        FROM gps_provisioning_attempts a JOIN gps_devices d ON d.id=a.device_id`);
      row.device_counts=Object.fromEntries(["pending","processing","retry","provisioned","failed","conflict","legacy"]
        .map(status=>[status,row.device_counts[status]??0]));
      const local={...diagnostics};
      const stale=local.lastPollAt && Date.now()-Date.parse(local.lastPollAt)>120000;
      const recentError=local.lastErrorAt && (!local.lastPollAt || local.lastErrorAt>local.lastPollAt);
      return {...row,processLocal:local,status:!local.running?"unknown":
        stale || row.expired_claims || recentError?"degraded":local.lastPollAt?"healthy":"unknown"};
    }),
    bounded(async()=>{
      const row=await queues();
      const stale=row.oldest_pending && Date.now()-Date.parse(row.oldest_pending)>120000 &&
        (!row.last_success || Date.now()-Date.parse(row.last_success)>120000);
      return {...row,status:!forwardingConfigured?"disabled":stale || row.failed || row.retrying?"degraded":
        row.last_success?"healthy":"unknown",forwardingConfigured,
        nativeGeofences:process.env.ALERT_NATIVE_GEOFENCES==="true",alertEmailConfigured:smtpEnabled()};
    }),
    ...["customer","reseller"].map(kind=>bounded(async()=>{
      const {rows}=await pool.query(`${invitationProjection}
        SELECT status,count(*)::int AS total,min(updated_at) AS oldest, max(updated_at) AS latest
        FROM deliveries WHERE kind=$1 AND used_at IS NULL GROUP BY status`,[kind]);
      return {configuration:invitationMode,counts:rows,status:invitationMode==="smtp_disabled"?"disabled":
        invitationMode!=="ready"?"not_configured":
        rows.some(row=>["failed","uncertain"].includes(row.status))?"degraded":
        rows.some(row=>row.status==="sent")?"healthy":"unknown"};
    })),
  ]).then(([postgres,traccar,gps,alerts,customerEmail,resellerEmail])=>{
    const result={api:{status:"healthy",checkedAt:new Date().toISOString(),startedAt,uptimeSeconds},
      postgres,traccar,gps,alerts,customerEmail,resellerEmail};
    lastHealth={time:Date.now(),result};
    return result;
  }).finally(()=>{currentHealth=null;});
  return currentHealth;
}

async function signals() {
  const [sim,billingSummary,alerts,gps] = await Promise.all([
    bounded(async()=>({data:await sims.summary()})),
    bounded(async()=>({data:await billing.report({})})),
    bounded(async()=>({data:await queues()})),
    bounded(async()=>({data:await one(`SELECT min(created_at) AS oldest_work_at FROM gps_provisioning_attempts
      WHERE status IN ('pending','processing','retry')`)})),
  ]);
  return {sim,billing:billingSummary,alerts,gps};
}

module.exports = { summary,provisioning,invitations,health,signals };
