const pool = require("../config/db");
const { geofenceRequest } = require("./traccar.service");

const nativeEnabled = () => process.env.ALERT_NATIVE_GEOFENCES === "true";
function area(geometry) {
  const format = pair => pair.join(" ");
  if (geometry.type === "circle") return `CIRCLE (${format(geometry.center)}, ${geometry.radius})`;
  return `POLYGON ((${[...geometry.vertices,geometry.vertices[0]].map(format).join(", ")}))`;
}
function remoteInteger(value) {
  return Number.isSafeInteger(value) && value>0;
}
async function project(db,job,request) {
  const local=(await db.query(`SELECT g.*,t.status AS tenant_status FROM alert_geofences g
    JOIN tenants t ON t.id=g.tenant_id WHERE g.id=$1`,[job.geofence_id])).rows[0];
  const marker=`SNA-Alert-${job.marker}`;
  const found=await request("get","geofences",undefined,{keyword:marker,limit:5});
  if(!Array.isArray(found)) throw new Error("Invalid Traccar response");
  const matches=found.filter(row=>row.name===marker);
  if(matches.length>1) throw new Error("Duplicate managed geofence");
  let remote=matches[0];
  if(remote&&!remoteInteger(remote.id)) throw new Error("Invalid Traccar geofence identifier");
  if(!local?.enabled || local.tenant_status!=="active") {
    if(remote) await request("delete",`geofences/${remote.id}`);
    return {id:null,revision:local?.revision??null,status:local?"synced":"removed",changed:Boolean(remote)||job.status!=="synced"};
  }

  const mappings=(await db.query(`SELECT DISTINCT v.traccar_device_id FROM alert_geofence_vehicles a
    JOIN vehicles v ON v.id=a.vehicle_id AND v.tenant_id=a.tenant_id
    JOIN gps_devices d ON v.traccar_device_id=d.traccar_device_id AND v.tenant_id=d.tenant_id
    WHERE a.geofence_id=$1 AND a.tenant_id=$2 AND v.gps_installed_at IS NOT NULL
    AND d.lifecycle_status='installed'`,[local.id,local.tenant_id])).rows;
  const desired=new Set(mappings.map(row=>Number(row.traccar_device_id)));
  if(![...desired].every(remoteInteger)) throw new Error("Invalid Traccar device identifier");
  const shape=area(local.geometry);
  let changed=false;
  if(!remote){
    remote=await request("post","geofences",{name:marker,area:shape});
    if(!remoteInteger(remote?.id)||remote.name!==marker) throw new Error("Invalid created Traccar geofence");
    changed=true;
  } else if(remote.area!==shape){
    await request("put",`geofences/${remote.id}`,{...remote,name:marker,area:shape});
    changed=true;
  }
  const links=await request("get","permissions",undefined,{geofenceId:remote.id,deviceId:0});
  if(!Array.isArray(links)||!links.every(link=>link.geofenceId===remote.id&&remoteInteger(link.deviceId))) {
    throw new Error("Invalid Traccar permission response");
  }
  const current=new Set(links.map(link=>link.deviceId));
  const remove=[...current].filter(deviceId=>!desired.has(deviceId)).map(deviceId=>({deviceId,geofenceId:remote.id}));
  const add=[...desired].filter(deviceId=>!current.has(deviceId)).map(deviceId=>({deviceId,geofenceId:remote.id}));
  for(let i=0;i<remove.length;i+=100) await request("delete","permissions/bulk",remove.slice(i,i+100));
  for(let i=0;i<add.length;i+=100) await request("post","permissions/bulk",add.slice(i,i+100));
  return {id:remote.id,revision:local.revision,status:"synced",
    changed:changed||remove.length>0||add.length>0||job.revision!==local.revision||job.status!=="synced"};
}

async function runGeofenceSync(request=geofenceRequest) {
  // Commit the stable ownership marker before calling the remote API so a retry
  // can find an object even after a lost POST response or process restart.
  await pool.query(`INSERT INTO alert_geofence_sync(geofence_id)
    SELECT id FROM alert_geofences ON CONFLICT(geofence_id) DO NOTHING`);
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    const {rows:[job]}=await db.query(`SELECT s.* FROM alert_geofence_sync s LEFT JOIN alert_geofences g ON g.id=s.geofence_id
      WHERE s.status<>'removed' AND (s.available_at<=clock_timestamp() OR
        (s.status='synced' AND s.revision IS DISTINCT FROM g.revision))
      ORDER BY s.available_at,s.geofence_id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`);
    if(job){
      let output;
      try { output=await project(db,job,request); }
      catch {
        await db.query(`UPDATE alert_geofence_sync SET status='failed',attempts=LEAST(attempts+1,8),
          available_at=clock_timestamp()+make_interval(secs=>LEAST(300,5*power(2,attempts)::integer))
          WHERE geofence_id=$1`,[job.geofence_id]);
      }
      if(output) await db.query(`UPDATE alert_geofence_sync SET remote_id=$2,revision=$3,status=$4,
        synchronized_at=CASE WHEN $5 THEN clock_timestamp() ELSE synchronized_at END,
        attempts=0,available_at=clock_timestamp()+interval '60 seconds' WHERE geofence_id=$1`,
      [job.geofence_id,output.id,output.revision,output.status,output.changed]);
    }
    await db.query("COMMIT");
    return Boolean(job);
  } catch(error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
function startGeofenceSync() {
  if(!nativeEnabled()) return;
  let busy=false;
  const timer=setInterval(async()=>{
    if(busy) return;
    busy=true;
    try {
      for(let i=0;i<10;i++) if(!await runGeofenceSync()) break;
    } catch(error) { console.error("Geofence sync unavailable",error.code??error.name); }
    finally { busy=false; }
  },3000);
  timer.unref();
}
module.exports={nativeEnabled,runGeofenceSync,startGeofenceSync};
