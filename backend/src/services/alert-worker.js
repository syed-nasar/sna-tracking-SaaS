const { timingSafeEqual } = require("node:crypto");
const pool = require("../config/db");
const { contains, point } = require("./alert-geometry");
const { smtpEnabled } = require("./alert-email");
const { nativeEnabled } = require("./alert-geofence-sync");
const validId = n => Number.isSafeInteger(n) && n > 0;
const finite = n => typeof n === "number" && Number.isFinite(n);
const time = value => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
const eventTypes = new Map([
  ["deviceOffline","offline"],["deviceOnline","online"],["ignitionOn","ignition_on"],
  ["ignitionOff","ignition_off"],["alarm:lowBattery","low_battery"],["alarm:powerCut","power_disconnected"],
  ["geofenceEnter","entry"],["geofenceExit","exit"],
]);
const labels = {
  entry:"Entered geofence",exit:"Exited geofence",overspeed:"Speed threshold exceeded",
  offline:"Tracker went offline",online:"Tracker reconnected",ignition_on:"Ignition turned on",
  ignition_off:"Ignition turned off",low_battery:"Low battery",power_disconnected:"Device power disconnected",
};
function normalize(body) {
  const pos=body?.position ?? (body?.event ? null : body);
  const event=body?.event;
  const input=event ?? pos;
  if(!validId(input?.id)||!validId(input?.deviceId)) return null;
  const occurred=time(event?event.eventTime:pos.serverTime);
  if(!Number.isFinite(occurred)||occurred>Date.now()+60000) return null;
  if(body?.device && body.device.id!==input.deviceId) return null;
  if(pos && pos.deviceId!==input.deviceId) return null;
  const fix=time(pos?.fixTime ?? pos?.deviceTime);
  const received=time(pos?.serverTime);
  const type=eventTypes.get(event?.type==="alarm" ? `alarm:${event.attributes?.alarm}` : event?.type);
  if(event && !type) return {ignored:true};
  if(["entry","exit"].includes(type) && !validId(event.geofenceId)) return null;
  if(["entry","exit"].includes(type) && pos?.valid!==true) return null;
  if(event && !["offline","online"].includes(type) && pos && event.positionId!==pos.id) return null;
  if(!event && (!point([pos.latitude,pos.longitude])||pos.valid!==true||
    !Number.isFinite(fix)||!Number.isFinite(received))) return null;
  return {
    source:event?"event":"position", id:input.id, device:input.deviceId, occurred:new Date(occurred),
    data:{
      type:type??null, fix:Number.isFinite(fix)?fix:null, received:Number.isFinite(received)?received:null,
      fence:["entry","exit"].includes(type)?event.geofenceId:null,
      position:event?null:[pos.latitude,pos.longitude],
      speed:!event&&finite(pos.speed)&&pos.speed>=0&&pos.speed<=1000?pos.speed*1.852:null,
      communication:Number.isFinite(time(body?.device?.lastUpdate))?time(body.device.lastUpdate):null,
    },
  };
}
async function ingest(req,res) {
  const token=process.env.ALERT_FORWARD_TOKEN;
  if(!token || token.length<32) return res.sendStatus(503);
  const expected=Buffer.from(`Bearer ${token}`);
  const provided=Buffer.from(req.get("Authorization")??"");
  if(expected.length!==provided.length||!timingSafeEqual(expected,provided)) return res.sendStatus(401);
  const row=normalize(req.body);
  if(!row) return res.status(400).json({message:"Invalid telemetry envelope"});
  if(row.ignored) return res.sendStatus(204);
  await pool.query(`INSERT INTO alert_ingestion(source,external_id,device_id,event_time,data)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(source,external_id) DO NOTHING`,
  [row.source,row.id,row.device,row.occurred,row.data]);
  res.sendStatus(202);
}
async function transition(db,vehicle,key,at,value,allowInitial=false) {
  const old=(await db.query("SELECT * FROM alert_state WHERE vehicle_id=$1 AND state_key=$2",[vehicle.id,key])).rows[0];
  const sameInstall=old?.installed_at.getTime()===vehicle.gps_installed_at.getTime();
  if(sameInstall&&old.observed_at>=at) return false;
  await db.query(`INSERT INTO alert_state(vehicle_id,state_key,installed_at,observed_at,value) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(vehicle_id,state_key) DO UPDATE SET installed_at=excluded.installed_at,
    observed_at=excluded.observed_at,value=excluded.value`,[vehicle.id,key,vehicle.gps_installed_at,at,value]);
  return sameInstall ? old.value!==value : allowInitial || (key==="connectivity" && !value) || (key.startsWith("speed:") && value);
}
async function publish(db,vehicle,rule,at,message) {
  const result=await db.query(`INSERT INTO alert_events(tenant_id,rule_id,vehicle_id,vehicle_name,type,severity,message,occurred_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (
      SELECT 1 FROM alert_events WHERE rule_id=$2 AND vehicle_id=$3
        AND occurred_at >= $8::timestamptz - make_interval(secs=>$9))
    RETURNING id`,[vehicle.tenant_id,rule.id,vehicle.id,vehicle.name,rule.type,rule.severity,message,at,rule.cooldown]);
  if(rule.in_app&&result.rowCount) await db.query(`INSERT INTO alert_notifications(tenant_id,user_id,event_id)
    SELECT u.tenant_id,u.id,$2 FROM users u LEFT JOIN alert_preferences p ON p.user_id=u.id
    WHERE u.tenant_id=$1 AND u.is_active AND COALESCE(p.in_app,true)`,[vehicle.tenant_id,result.rows[0].id]);
  if(rule.email&&result.rowCount&&smtpEnabled()) await db.query(`INSERT INTO alert_email_delivery(tenant_id,user_id,event_id)
    SELECT u.tenant_id,u.id,$2 FROM users u JOIN alert_preferences p ON p.user_id=u.id
    WHERE u.tenant_id=$1 AND u.is_active AND p.email`,[vehicle.tenant_id,result.rows[0].id]);
}
async function processRow(db,row) {
  const vehicle=(await db.query(`SELECT v.id,v.tenant_id,v.group_id,v.name,v.gps_installed_at,
    (extract(epoch FROM v.gps_installed_at)*1000)::float8 AS installed_ms
    FROM gps_devices d JOIN vehicles v ON v.traccar_device_id=d.traccar_device_id AND v.tenant_id=d.tenant_id
    JOIN tenants t ON t.id=v.tenant_id WHERE d.traccar_device_id=$1 AND d.lifecycle_status='installed'
    AND t.status='active' FOR UPDATE OF v`,[row.device_id])).rows[0];
  const at=row.event_time;
  const data=row.data;
  const connectivity=["offline","online"].includes(data.type);
  if(!vehicle?.gps_installed_at||at.getTime()<=vehicle.installed_ms||
    (connectivity ? !(data.communication>vehicle.installed_ms && data.communication<=at.getTime())
      : !(data.fix>vehicle.installed_ms&&data.received>vehicle.installed_ms&&data.fix<=data.received+60000))) return "quarantined";
  const rules=(await db.query(`SELECT * FROM alert_rules WHERE tenant_id=$1 AND enabled
    AND (vehicle_id IS NULL OR vehicle_id=$2) AND (group_id IS NULL OR group_id=$3)
    AND type=ANY($4::text[]) AND updated_at<=$5`,[vehicle.tenant_id,vehicle.id,vehicle.group_id,
    row.source==="position"?["entry","exit","overspeed"]:[data.type],
    row.source==="position"?new Date(data.fix):at])).rows;
  if(row.source==="position"){
    const latest=(await db.query("SELECT observed_at FROM alert_state WHERE vehicle_id=$1 AND state_key='position' AND installed_at=$2",
      [vehicle.id,vehicle.gps_installed_at])).rows[0];
    const observed=new Date(data.fix);
    if(latest?.observed_at>=observed) return "done";
    await transition(db,vehicle,"position",observed,true);
    if(!nativeEnabled()&&rules.some(rule=>rule.type==="entry"||rule.type==="exit")){
      const fences=(await db.query(`SELECT g.id,g.name,g.geometry,g.revision FROM alert_geofences g
        JOIN alert_geofence_vehicles a ON a.geofence_id=g.id AND a.tenant_id=g.tenant_id
        WHERE a.tenant_id=$1 AND a.vehicle_id=$2 AND g.enabled AND g.updated_at<=$3`,
      [vehicle.tenant_id,vehicle.id,observed])).rows;
      for(const fence of fences){
        const inside=contains(fence.geometry,data.position);
        if(await transition(db,vehicle,`fence:${fence.id}:${fence.revision}`,observed,inside)){
          const type=inside?"entry":"exit";
          for(const rule of rules.filter(r=>r.type===type)) await publish(db,vehicle,rule,at,`${labels[type]}: ${fence.name}`);
        }
      }
    }
    for(const rule of rules.filter(r=>r.type==="overspeed"&&data.speed!=null)){
      const above=data.speed>rule.threshold;
      if(await transition(db,vehicle,`speed:${rule.id}:${rule.threshold}`,observed,above) && above)
        await publish(db,vehicle,rule,at,`${labels.overspeed} (${Math.round(data.speed)} km/h)`);
    }
  } else {
    if(["entry","exit"].includes(data.type)){
      if(!nativeEnabled()) return "done";
      const fence=(await db.query(`SELECT g.name,g.revision FROM alert_geofences g
        JOIN alert_geofence_sync s ON s.geofence_id=g.id AND s.revision=g.revision
        JOIN alert_geofence_vehicles a ON a.geofence_id=g.id AND a.tenant_id=g.tenant_id
        WHERE g.tenant_id=$1 AND a.vehicle_id=$2 AND s.remote_id=$3 AND s.status='synced'
        AND g.enabled AND s.synchronized_at<$4`,[vehicle.tenant_id,vehicle.id,data.fence,new Date(data.fix)])).rows[0];
      if(!fence) return "quarantined";
      if(await transition(db,vehicle,`native-fence:${data.fence}:${fence.revision}`,new Date(data.fix),data.type==="entry",true)){
        for(const rule of rules) await publish(db,vehicle,rule,at,`${labels[data.type]}: ${fence.name}`);
      }
      return "done";
    }
    if(connectivity && !await transition(db,vehicle,"connectivity",at,data.type==="online")) return "done";
    if(data.type==="online") await db.query("DELETE FROM alert_offline_due WHERE vehicle_id=$1",[vehicle.id]);
    for(const rule of rules){
      if(data.type==="offline"&&at.getTime()-data.communication<rule.threshold*60000){
        await db.query(`INSERT INTO alert_offline_due(vehicle_id,rule_id,installed_at,outage_at,due_at)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(vehicle_id,rule_id) DO UPDATE
          SET installed_at=excluded.installed_at,outage_at=excluded.outage_at,due_at=excluded.due_at`,
        [vehicle.id,rule.id,vehicle.gps_installed_at,at,new Date(data.communication+rule.threshold*60000)]);
        continue;
      }
      await publish(db,vehicle,rule,at,labels[data.type]);
    }
  }
  return "done";
}
async function finishOutages(db) {
  const {rows}=await db.query("SELECT * FROM alert_offline_due WHERE due_at<=clock_timestamp() ORDER BY due_at LIMIT 50");
  for(const row of rows){
    const vehicle=(await db.query(`SELECT v.id,v.tenant_id,v.group_id,v.name FROM vehicles v
      JOIN tenants t ON t.id=v.tenant_id JOIN gps_devices d ON d.traccar_device_id=v.traccar_device_id AND d.tenant_id=v.tenant_id
      JOIN alert_state s ON s.vehicle_id=v.id AND s.state_key='connectivity'
      WHERE v.id=$1 AND v.gps_installed_at=$2 AND s.installed_at=$2 AND NOT s.value
      AND t.status='active' AND d.lifecycle_status='installed' FOR UPDATE OF v`,[row.vehicle_id,row.installed_at])).rows[0];
    if(vehicle){
      const rule=(await db.query(`SELECT * FROM alert_rules WHERE id=$1 AND tenant_id=$2 AND enabled
        AND type='offline' AND updated_at<=$3 AND (vehicle_id IS NULL OR vehicle_id=$4)
        AND (group_id IS NULL OR group_id=$5)`,[row.rule_id,vehicle.tenant_id,row.outage_at,vehicle.id,vehicle.group_id])).rows[0];
      if(rule) await publish(db,vehicle,rule,row.due_at,labels.offline);
    }
    await db.query("DELETE FROM alert_offline_due WHERE vehicle_id=$1 AND rule_id=$2",[row.vehicle_id,row.rule_id]);
  }
}
async function runBatch(limit=100) {
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    const lock=await db.query("SELECT pg_try_advisory_xact_lock(940014) AS acquired");
    if(!lock.rows[0].acquired){await db.query("COMMIT");return 0;}
    const {rows}=await db.query(`SELECT * FROM alert_ingestion WHERE status='pending' AND available_at<=clock_timestamp()
      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit]);
    for(const row of rows){
      await db.query("SAVEPOINT alert_row");
      try {
        const status=await processRow(db,row);
        await db.query("UPDATE alert_ingestion SET status=$2,data='{}'::jsonb,outcome=$3 WHERE id=$1",
          [row.id,status,status==="quarantined"?"unverified_installation_or_timestamps":null]);
      } catch(error) {
        await db.query("ROLLBACK TO SAVEPOINT alert_row");
        await db.query(`UPDATE alert_ingestion SET attempts=attempts+1,
          available_at=clock_timestamp()+make_interval(secs=>power(2,attempts+1)::integer),
          status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,outcome=$2 WHERE id=$1`,
        [row.id,/^[A-Z0-9]{5}$/.test(error.code??"")?error.code:"processing_error"]);
      }
      await db.query("RELEASE SAVEPOINT alert_row");
    }
    if(rows.length<limit) await finishOutages(db);
    await db.query(`INSERT INTO alert_worker_health(worker) VALUES('ingestion')
      ON CONFLICT(worker) DO UPDATE SET last_success_at=clock_timestamp()`);
    await db.query("COMMIT");
    return rows.length;
  } catch(error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
function startAlertWorker() {
  if(!(process.env.ALERT_FORWARD_TOKEN?.length>=32)) return;
  let busy=false;
  const timer=setInterval(async()=>{
    if(busy) return;
    busy=true;
    try {
      for (let batch=0;batch<5;batch++) {
        if (await runBatch()<100) break;
      }
    } catch(error){console.error("Alert worker unavailable",error.code??error.name);}
    finally{busy=false;}
  },2000);
  timer.unref();
}
module.exports={ingest,runBatch,startAlertWorker,normalize};
