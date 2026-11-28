const pool = require("../config/db");
const { choice,text,page,optionalId } = require("./platform-customers.service");

const vehicles = `SELECT v.id,v.name,v.registration_number,v.status,t.id AS tenant_id,t.name AS customer_name,
  t.customer_type,t.reseller_id,r.display_name AS reseller_name,
  v.traccar_device_id IS NOT NULL AS gps_installed,
  (d.id IS NOT NULL AND v.gps_installed_at IS NOT NULL) AS trusted_history
  FROM vehicles v JOIN tenants t ON t.id=v.tenant_id LEFT JOIN resellers r ON r.id=t.reseller_id
  LEFT JOIN gps_devices d ON d.traccar_device_id=v.traccar_device_id
    AND d.tenant_id=v.tenant_id AND d.lifecycle_status='installed'`;

async function vehicleSummary() {
  const {rows:[result]}=await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE status='active')::int AS active,
    count(*) FILTER(WHERE gps_installed)::int AS with_gps,
    count(*) FILTER(WHERE NOT gps_installed)::int AS without_gps,
    count(*) FILTER(WHERE gps_installed AND NOT trusted_history)::int AS unverified_history
    FROM (${vehicles}) v`);
  return result;
}

async function vehicleDirectory(query) {
  const [limit,offset]=page(query);
  const {rows:[result]}=await pool.query(`WITH matching AS (
    SELECT * FROM (${vehicles}) v WHERE
      ($1='' OR strpos(lower(concat_ws(' ',name,registration_number,customer_name)),$1)>0)
      AND ($2='' OR status=$2) AND ($3='' OR customer_type=$3)
      AND ($4='' OR ($4='direct' AND reseller_id IS NULL) OR ($4='reseller' AND reseller_id IS NOT NULL))
      AND ($5::bigint IS NULL OR reseller_id=$5)
      AND ($6='' OR ($6='installed' AND gps_installed) OR ($6='uninstalled' AND NOT gps_installed)
        OR ($6='unverified' AND gps_installed AND NOT trusted_history))
    ), result_page AS (SELECT * FROM matching ORDER BY id LIMIT $7 OFFSET $8)
    SELECT (SELECT count(*)::int FROM matching) AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object(
        'id',v.id::text,'tenant_id',v.tenant_id::text,'reseller_id',v.reseller_id::text) ORDER BY v.id)
        FROM result_page v),'[]'::jsonb) AS data`,[
    text(query.q).toLowerCase(),choice(query.status,["active","inactive"]),
    choice(query.type,["personal","business"]),choice(query.ownership,["direct","reseller"]),
    optionalId(query.resellerId),choice(query.gps,["installed","uninstalled","unverified"]),limit,offset,
  ]);
  return {data:result.data,pagination:{limit,offset,total:result.total,hasMore:offset+limit<result.total}};
}

module.exports={vehicleSummary,vehicleDirectory};
