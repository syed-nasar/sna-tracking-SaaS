const pool = require("../config/db");
const { fail } = require("./gps-inventory.service");
const { choice,text,page,optionalId } = require("./platform-customers.service");

// Columns are deliberately projected before pagination. No raw audit details are returned.
const projection = `WITH events(source,id,at,domain,action,resource,resource_id,tenant_id,reseller_id,
  actor_type,actor_id,executor,outcome) AS (
  SELECT 'platform',e.id,e.created_at,
    CASE WHEN e.action LIKE '%invitation%' THEN 'invitations' WHEN e.resource_type='tenant' THEN 'customers'
      WHEN e.resource_type IN ('operator','plan','connectivity_settings') THEN 'sim' ELSE 'platform' END,
    e.action,CASE WHEN i.id IS NOT NULL THEN 'customer_invitation' ELSE e.resource_type END,
    COALESCE(i.id,e.resource_id),
    CASE WHEN e.resource_type='tenant' THEN e.resource_id ELSE i.tenant_id END,NULL::bigint,
    'platform',e.platform_admin_id,
    CASE WHEN e.action='tenant.invitation_email_attempt' THEN 'invitation_worker' END,
    CASE WHEN e.action LIKE 'tenant.invitation_email_%' AND e.details->>'deliveryStatus'
      IN ('pending','sending','sent','failed','uncertain','cancelled') THEN e.details->>'deliveryStatus' END
  FROM platform_audit_logs e LEFT JOIN user_invitations i
    ON e.action LIKE 'tenant.invitation_%' AND e.resource_type='tenant'
      AND i.tenant_id=e.resource_id AND i.id::text=e.details->>'invitationId'
  UNION ALL
  SELECT 'reseller',e.id,e.created_at,
    CASE WHEN e.action LIKE '%invitation%' OR e.action='admin.invited' THEN 'invitations' ELSE 'resellers' END,e.action,
    CASE WHEN e.action IN ('customer.onboarded','customer.active','customer.suspended') THEN 'tenant'
      WHEN e.action='customer.invitation_reissued' OR e.action LIKE 'tenant.invitation_email_%' THEN 'customer_invitation'
      WHEN e.action='admin.invited' OR e.action LIKE 'admin.invitation_%' THEN 'reseller_invitation'
      WHEN e.action IN ('admin.enabled','admin.disabled') THEN 'reseller_admin'
      WHEN e.action LIKE 'inventory.%' THEN 'gps_device' ELSE 'reseller' END,e.target_id,
    CASE WHEN e.action IN ('customer.onboarded','customer.active','customer.suspended') THEN e.target_id ELSE i.tenant_id END,
    e.reseller_id,CASE WHEN e.platform_admin_id IS NOT NULL THEN 'platform' ELSE 'reseller' END,
    COALESCE(e.platform_admin_id,e.reseller_admin_id),
    CASE WHEN e.action IN ('admin.invitation_sent','admin.invitation_pending','admin.invitation_uncertain',
      'admin.invitation_failed','admin.invitation_cancelled','tenant.invitation_email_attempt',
      'customer.invitation_email_attempt') THEN 'invitation_worker' END,
    CASE WHEN e.action IN ('admin.invitation_sent','admin.invitation_pending','admin.invitation_uncertain',
      'admin.invitation_failed','admin.invitation_cancelled') THEN split_part(e.action,'_',2) END
  FROM reseller_audit e LEFT JOIN user_invitations i
    ON (e.action='customer.invitation_reissued' OR e.action LIKE 'tenant.invitation_email_%') AND i.id=e.target_id
  UNION ALL
  SELECT 'gps',e.id,e.created_at,'gps',e.action,'gps_device',e.device_id,t.id,t.reseller_id,
    CASE WHEN e.platform_admin_id IS NOT NULL THEN 'platform' WHEN e.reseller_admin_id IS NOT NULL THEN 'reseller'
      WHEN e.tenant_user_id IS NOT NULL THEN 'tenant' ELSE 'unknown' END,
    COALESCE(e.platform_admin_id,e.reseller_admin_id,e.tenant_user_id),NULL,NULL
  FROM gps_device_events e LEFT JOIN tenants t ON t.id::text=COALESCE(e.details->>'tenantId',e.details->>'toTenantId',e.details->>'fromTenantId')
  UNION ALL
  SELECT 'provisioning',e.id,e.created_at,'provisioning',e.action,'gps_device',a.device_id,NULL,NULL,
    'platform',a.platform_admin_id,
    CASE WHEN e.action IN ('processing','provider_create_started','provider_mapping_linked','provisioning_succeeded',
      'retry_scheduled','provisioning_conflict','provisioning_failed','provider_device_created',
      'provider_device_reused','provider_identity_verified','manual_recovery_completed') THEN 'provisioning_worker' END,
    CASE WHEN e.outcome_code IN ('provider_unavailable','provider_timeout','provider_configuration','provider_validation',
      'provider_duplicate','invalid_response','uncertain_create','ambiguous_match','local_conflict',
      'missing_device','identity_mismatch','local_persistence','ineligible') THEN e.outcome_code END
  FROM gps_provisioning_events e JOIN gps_provisioning_attempts a ON a.id=e.attempt_id
  UNION ALL
  SELECT 'sim',e.id,e.created_at,'sim',e.action,'sim',e.sim_id,NULL,NULL,'platform',e.platform_admin_id,NULL,NULL
  FROM sim_audit_events e
  UNION ALL
  SELECT 'billing',e.id,e.created_at,CASE WHEN e.resource='subscription' THEN 'subscriptions' ELSE 'billing' END,
    e.action,e.resource,e.resource_id,e.tenant_id,NULL,'platform',e.platform_admin_id,
    CASE WHEN e.details->>'source'='scheduled_batch' THEN 'billing_scheduler' END,NULL
  FROM billing_events e
)`;

function date(value) {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) fail(400,"Invalid audit date.");
  return value;
}
const sources=["platform","reseller","gps","provisioning","sim","billing"];
function decode(value) {
  if (value===undefined) return [null,null,null];
  try {
    if (typeof value!=="string" || value.length>350 || !/^[\w-]+$/.test(value)) throw Error();
    const [at,source,id]=JSON.parse(Buffer.from(value,"base64url").toString());
    if (typeof at!=="string" || !Number.isFinite(Date.parse(at)) || !sources.includes(source) || !optionalId(id)) throw Error();
    return [at,source,id];
  } catch { fail(400,"Invalid audit cursor."); }
}

async function audit(query) {
  const [limit]=page(query,30);
  const from=date(query.from),to=date(query.to);
  if (from && to && from>to) fail(400,"Audit start must precede its end.");
  const args=[from,to,choice(query.domain,["platform","customers","invitations","resellers","gps","provisioning","sim","subscriptions","billing"]),
    text(query.action,100),choice(query.actorType,["platform","reseller","tenant","unknown"]),
    text(query.resource,50),optionalId(query.resourceId),optionalId(query.tenantId),optionalId(query.resellerId),...decode(query.cursor),limit+1];
  const {rows}=await pool.query(`${projection}
    SELECT e.source||':'||e.id AS id,e.at::text AS cursor_at,e.at,e.source,e.id::text AS source_id,e.domain,e.action,
      e.resource,e.resource_id,e.tenant_id,COALESCE(e.reseller_id,t.reseller_id) AS reseller_id,
      e.actor_type,e.actor_id,e.executor,e.outcome FROM events e LEFT JOIN tenants t ON t.id=e.tenant_id
    WHERE ($1::date IS NULL OR e.at>=($1::timestamp AT TIME ZONE 'UTC'))
      AND ($2::date IS NULL OR e.at<(($2::date+1)::timestamp AT TIME ZONE 'UTC'))
      AND ($3='' OR e.domain=$3) AND ($4='' OR e.action=$4) AND ($5='' OR e.actor_type=$5)
      AND ($6='' OR e.resource=$6) AND ($7::bigint IS NULL OR e.resource_id=$7)
      AND ($8::bigint IS NULL OR e.tenant_id=$8) AND ($9::bigint IS NULL OR COALESCE(e.reseller_id,t.reseller_id)=$9)
      AND ($10::timestamptz IS NULL OR (e.at,e.source,e.id)<($10,$11,$12::bigint))
    ORDER BY e.at DESC,e.source DESC,e.id DESC LIMIT $13`,args);
  const result=rows.slice(0,limit);
  const tail=result.at(-1);
  return {data:result.map(({cursor_at,source_id,...event})=>event),nextCursor:rows.length>limit
    ? Buffer.from(JSON.stringify([tail.cursor_at,tail.source,tail.source_id])).toString("base64url") : null};
}

module.exports={ audit };
