const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");
const { requirePlatformAuth } = require("../middleware/platform-auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { geometry } = require("../services/alert-geometry");
const { ingest } = require("../services/alert-worker");
const { smtpEnabled } = require("../services/alert-email");
const { nativeEnabled } = require("../services/alert-geofence-sync");

const tenant = express.Router();
const platform = express.Router();
const source = express.Router();
const types = ["entry","exit","overspeed","offline","online","ignition_on","ignition_off","low_battery","power_disconnected"];
const severities = ["info","warning","critical"];
const id = value => (typeof value === "string" || Number.isSafeInteger(value)) &&
  /^[1-9]\d{0,18}$/.test(String(value)) && BigInt(value) <= 9223372036854775807n;
const invalid = (res, message = "Invalid alert settings") => res.status(400).json({message});
const missing = res => res.status(404).json({message:"Alert resource not found"});
const name = value => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100;
const write = authorize("vehicles:write");
tenant.use(requireAuth, authorize("vehicles:read"));
platform.use(requirePlatformAuth);

async function transaction(work) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
const audit = (db, auth, action, target) => db.query(
  "INSERT INTO alert_config_audit(tenant_id,actor_id,action,target_id) VALUES($1,$2,$3,$4)",
  [auth.tenantId,auth.userId,action,target]);

tenant.get("/settings", async (req,res) => {
  const {tenantId,userId} = req.auth;
  const [fences,rules,vehicles,groups,pref] = await Promise.all([
    pool.query(`SELECT g.id,g.name,g.description,g.geometry,g.enabled,
      CASE WHEN s.status='failed' THEN 'failed'
        WHEN s.revision=g.revision THEN s.status ELSE 'pending' END AS sync_status,
      ARRAY(SELECT vehicle_id FROM alert_geofence_vehicles a WHERE a.geofence_id=g.id ORDER BY vehicle_id) AS vehicles
      FROM alert_geofences g LEFT JOIN alert_geofence_sync s ON s.geofence_id=g.id
      WHERE g.tenant_id=$1 ORDER BY g.id DESC LIMIT 500`,[tenantId]),
    pool.query("SELECT id,name,description,type,severity,enabled,in_app,email,cooldown,threshold,vehicle_id,group_id FROM alert_rules WHERE tenant_id=$1 ORDER BY id DESC LIMIT 500",[tenantId]),
    pool.query("SELECT id,name FROM vehicles WHERE tenant_id=$1 ORDER BY name,id",[tenantId]),
    pool.query("SELECT id,name FROM vehicle_groups WHERE tenant_id=$1 ORDER BY name,id",[tenantId]),
    pool.query("SELECT in_app,email FROM alert_preferences WHERE user_id=$1",[userId]),
  ]);
  res.json({fences:fences.rows,rules:rules.rows,vehicles:vehicles.rows,groups:groups.rows,
    inApp:pref.rows[0]?.in_app ?? true,email:pref.rows[0]?.email ?? false,
    smtpEnabled:smtpEnabled(),nativeGeofences:nativeEnabled()});
});
tenant.put("/preferences",async (req,res) => {
  if (typeof req.body?.inApp !== "boolean" || typeof req.body?.email !== "boolean") return invalid(res);
  await transaction(async db => {
    await db.query(`INSERT INTO alert_preferences(user_id,in_app,email) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET in_app=excluded.in_app,email=excluded.email`,[req.auth.userId,req.body.inApp,req.body.email]);
    await audit(db,req.auth,"preferences_updated",req.auth.userId);
  });
  res.sendStatus(204);
});
async function saveFence(req,res) {
  const {tenantId} = req.auth;
  const targetId = req.params.id;
  const b = req.body ?? {};
  const shape = geometry(b.geometry);
  if ((targetId && !id(targetId)) || !name(b.name) || !shape ||
      typeof b.description !== "string" || b.description.length>500 ||
      typeof b.enabled !== "boolean" || !Array.isArray(b.vehicles) ||
      b.vehicles.length>2000 || !b.vehicles.every(id)) return invalid(res,"Invalid geofence or geometry");
  const vehicleIds = [...new Set(b.vehicles.map(String))];
  const result = await transaction(async db => {
    const authorized = await db.query("SELECT id FROM vehicles WHERE tenant_id=$1 AND id=ANY($2::bigint[]) FOR KEY SHARE",[tenantId,vehicleIds]);
    if(authorized.rowCount!==vehicleIds.length) return "vehicle";
    const values=[tenantId,b.name.trim(),b.description,shape,b.enabled];
    const sql=targetId
      ? `UPDATE alert_geofences SET name=$2,description=$3,geometry=$4,enabled=$5,revision=revision+1,
        updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$6 RETURNING id`
      : "INSERT INTO alert_geofences(tenant_id,name,description,geometry,enabled) VALUES($1,$2,$3,$4,$5) RETURNING id";
    const row = (await db.query(sql,targetId?[...values,targetId]:values)).rows[0];
    if(!row) return null;
    await db.query("DELETE FROM alert_geofence_vehicles WHERE tenant_id=$1 AND geofence_id=$2",[tenantId,row.id]);
    await db.query(`INSERT INTO alert_geofence_vehicles(tenant_id,geofence_id,vehicle_id)
      SELECT $1,$2,unnest($3::bigint[])`,[tenantId,row.id,vehicleIds]);
    await audit(db,req.auth,targetId?"geofence_updated":"geofence_created",row.id);
    return row;
  });
  if(result==="vehicle") return invalid(res,"One or more vehicles are unavailable");
  if(!result) return missing(res);
  res.status(targetId?200:201).json(result);
}
tenant.post("/geofences",write,saveFence);
tenant.put("/geofences/:id",write,saveFence);
async function saveRule(req,res) {
  const {tenantId} = req.auth;
  const targetId = req.params.id;
  const b = req.body ?? {};
  if ((targetId && !id(targetId)) || !name(b.name) || !types.includes(b.type) ||
      (b.description!=null && (typeof b.description!=="string" || b.description.length>500)) ||
      !severities.includes(b.severity) || typeof b.enabled!=="boolean" || typeof b.inApp!=="boolean" || typeof b.email!=="boolean" ||
      !Number.isInteger(b.cooldown) || b.cooldown<0 || b.cooldown>86400 ||
      !Number.isInteger(b.threshold) || b.threshold<1 ||
      b.threshold>(b.type==="overspeed"?500:b.type==="offline"?10080:100) ||
      (b.vehicleId!=null && !id(b.vehicleId)) || (b.groupId!=null && !id(b.groupId)) ||
      (b.vehicleId!=null && b.groupId!=null)) return invalid(res);
  const result=await transaction(async db=>{
    for(const [table,scopeId] of [["vehicles",b.vehicleId],["vehicle_groups",b.groupId]]){
      if(scopeId!=null && !(await db.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR KEY SHARE`,[tenantId,scopeId])).rowCount) return "scope";
    }
    const values=[tenantId,b.name.trim(),b.type,b.severity,b.enabled,b.inApp,b.cooldown,b.threshold,b.vehicleId??null,b.groupId??null,b.email,b.description??""];
    const sql=targetId
      ? `UPDATE alert_rules SET name=$2,type=$3,severity=$4,enabled=$5,in_app=$6,cooldown=$7,threshold=$8,
        vehicle_id=$9,group_id=$10,email=$11,description=$12,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$13 RETURNING id`
      : "INSERT INTO alert_rules(tenant_id,name,type,severity,enabled,in_app,cooldown,threshold,vehicle_id,group_id,email,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id";
    const row=(await db.query(sql,targetId?[...values,targetId]:values)).rows[0];
    if(row) await audit(db,req.auth,targetId?"rule_updated":"rule_created",row.id);
    return row;
  });
  if(result==="scope") return invalid(res,"Vehicle or group is unavailable");
  if(!result) return missing(res);
  res.status(targetId?200:201).json(result);
}
tenant.post("/rules",write,saveRule);
tenant.put("/rules/:id",write,saveRule);
for(const [path,table] of [["geofences","alert_geofences"],["rules","alert_rules"]]){
  tenant.delete(`/${path}/:id`,write,async(req,res)=>{
    if(!id(req.params.id)) return invalid(res);
    const removed=await transaction(async db=>{
      const out=await db.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=$2`,[req.auth.tenantId,req.params.id]);
      if(out.rowCount) await audit(db,req.auth,`${path}_deleted`,req.params.id);
      return out.rowCount;
    });
    if(!removed) return missing(res);
    res.sendStatus(204);
  });
}
function history(notifications){
  return async(req,res)=>{
    const {tenantId,userId}=req.auth;
    const {before,type,severity,vehicle,unread,from,to}=req.query;
    if((before!=null&&!id(before)) || (vehicle!=null&&!id(vehicle)) ||
       (type!=null&&!types.includes(type)) || (severity!=null&&!severities.includes(severity)) ||
       (unread!=null&&!["true","false"].includes(unread)) ||
       [from,to].some(v=>v!=null&&(typeof v!=="string"||!Number.isFinite(Date.parse(v))||v.length>32))) return invalid(res);
    const params=[tenantId];
    const clauses=["e.tenant_id=$1"];
    const add=(sql,value)=>{params.push(value);clauses.push(sql.replace("?",`$${params.length}`));};
    if(notifications) add("n.user_id=?",userId);
    const alias=notifications?"n":"e";
    if(before) add(`${alias}.id < ?`,before);
    if(type) add("e.type=?",type);
    if(severity) add("e.severity=?",severity);
    if(vehicle) add("e.vehicle_id=?",vehicle);
    if(from) add("e.occurred_at>=?",new Date(from));
    if(to) add("e.occurred_at<=?",new Date(to));
    if(notifications && unread!=null) clauses.push(unread==="true"?"n.read_at IS NULL":"n.read_at IS NOT NULL");
    const result=await pool.query(`SELECT ${alias}.id,e.id AS event_id,e.type,e.severity,e.vehicle_id,e.vehicle_name,e.message,e.occurred_at
      ${notifications?",n.read_at":""} FROM alert_events e
      ${notifications?"JOIN alert_notifications n ON n.event_id=e.id AND n.tenant_id=e.tenant_id":""}
      WHERE ${clauses.join(" AND ")} ORDER BY ${alias}.id DESC LIMIT 31`,params);
    const items=result.rows.slice(0,30);
    res.json({items,next:result.rows.length>30?items.at(-1).id:null});
  };
}
tenant.get("/history",history(false));
tenant.get("/history/:id",async(req,res)=>{
  if(!id(req.params.id)) return invalid(res);
  const result=await pool.query(`SELECT e.id,e.type,e.severity,e.vehicle_name,e.message,e.occurred_at,v.id AS vehicle_id
    FROM alert_events e LEFT JOIN vehicles v ON v.id=e.vehicle_id AND v.tenant_id=e.tenant_id
    WHERE e.tenant_id=$1 AND e.id=$2`,[req.auth.tenantId,req.params.id]);
  if(!result.rowCount) return missing(res);
  res.json(result.rows[0]);
});
tenant.get("/notifications",history(true));
tenant.get("/notifications/unread",async(req,res)=>{
  const result=await pool.query("SELECT count(*)::integer AS count FROM alert_notifications WHERE tenant_id=$1 AND user_id=$2 AND read_at IS NULL",[req.auth.tenantId,req.auth.userId]);
  res.json(result.rows[0]);
});
tenant.patch("/notifications/read-all",async(req,res)=>{
  await pool.query("UPDATE alert_notifications SET read_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2 AND read_at IS NULL",[req.auth.tenantId,req.auth.userId]);
  res.sendStatus(204);
});
tenant.patch("/notifications/:id",async(req,res)=>{
  if(!id(req.params.id)||typeof req.body?.read!=="boolean") return invalid(res);
  const result=await pool.query("UPDATE alert_notifications SET read_at=CASE WHEN $4 THEN COALESCE(read_at,clock_timestamp()) ELSE NULL END WHERE tenant_id=$1 AND user_id=$2 AND id=$3",[req.auth.tenantId,req.auth.userId,req.params.id,req.body.read]);
  if(!result.rowCount) return missing(res);
  res.sendStatus(204);
});
platform.get("/",async(_req,res)=>{
  const [result,email,worker,sync]=await Promise.all([
    pool.query(`SELECT status,count(*)::integer AS count,max(received_at) AS latest,
      count(*) FILTER(WHERE status='pending' AND attempts>0)::integer AS retrying
      FROM alert_ingestion GROUP BY status`),
    pool.query("SELECT status,count(*)::integer AS count FROM alert_email_delivery GROUP BY status"),
    pool.query("SELECT last_success_at FROM alert_worker_health WHERE worker='ingestion'"),
    pool.query("SELECT status,count(*)::integer AS count FROM alert_geofence_sync GROUP BY status"),
  ]);
  res.json({ingestion:result.rows,email:email.rows,lastWorkerSuccess:worker.rows[0]?.last_success_at??null,
    geofenceSync:sync.rows,nativeGeofences:nativeEnabled(),
    smtpEnabled:smtpEnabled(),workerEnabled:Boolean(process.env.ALERT_FORWARD_TOKEN?.length>=32)});
});
source.post("/",ingest);
module.exports={tenant,platform,source};
