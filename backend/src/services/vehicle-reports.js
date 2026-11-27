const { createHash } = require("node:crypto");
const pool = require("../config/db");
const { getReport } = require("./traccar.service");

const DAY = 86400000;
const MAX_VEHICLES = 10;
const MAX_POINTS = 40000;
const MAX_RECORDS = 10000;
const TYPES = ["trips", "stops", "mileage", "activity"];
class ReportError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
const reject = (status,message) => { throw new ReportError(status,message); };
const iso = value => new Date(value).toISOString();
const time = value => typeof value==="string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
function filterTime(value) {
  if(typeof value!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return NaN;
  const date=new Date(value.slice(0,10)+"T00:00:00.000Z");
  return Number.isFinite(+date) && date.toISOString().slice(0,10)===value.slice(0,10) ? time(value) : NaN;
}
const numeric = value => Number.isFinite(value) && value>=0;
const id = value => typeof value==="string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n;
const bounded = (value, max, fallback) => value==null ? fallback
  : typeof value==="string" && /^\d{1,9}$/.test(value) && +value>=1 && +value<=max
    ? +value : reject(400,"Invalid pagination.");

function parseFilters(query) {
  const fields=["from","to","timezone","vehicleId","page","limit","sort"];
  if (Object.keys(query).some(key=>!fields.includes(key))) reject(400,"Unsupported report filter.");
  const from=filterTime(query.from),to=filterTime(query.to);
  if (from<0 || !(to>from) || to-from>31*DAY+7200000 || from>Date.now() || to>Date.now()+2*DAY) {
    reject(400,"Choose a valid report period of up to 31 calendar days.");
  }
  const tz=query.timezone??"UTC";
  if(typeof tz!=="string" || tz.length>64) reject(400,"Invalid timezone.");
  let day;
  try {
    const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"});
    day=value=>formatter.format(new Date(value));
  } catch { reject(400,"Invalid timezone."); }
  const vehicles=query.vehicleId==null?[]:Array.isArray(query.vehicleId)?query.vehicleId:[query.vehicleId];
  if(vehicles.length>MAX_VEHICLES || vehicles.some(value=>!id(value))) reject(400,"Select up to 10 valid vehicle IDs.");
  const sort=query.sort??"newest";
  if(!["newest","oldest","distance","duration","vehicle"].includes(sort)) reject(400,"Invalid sort order.");
  return {from,to,timezone:tz,day,vehicles:[...new Set(vehicles)],sort,
    page:bounded(query.page,10000,1),limit:bounded(query.limit,100,25)};
}

async function scope(auth,ids,limit=MAX_VEHICLES+1,search=null) {
  return (await pool.query(`SELECT v.id,v.name,v.registration_number AS registration,
    v.traccar_device_id AS device_id,d.id AS inventory_id,
    v.gps_installed_at::text AS installation,
    extract(epoch FROM v.gps_installed_at)*1000 AS installed_ms
    FROM vehicles v JOIN tenants t ON t.id=v.tenant_id AND t.status='active'
    JOIN users u ON u.tenant_id=t.id AND u.id=$2 AND u.is_active AND u.token_version=$3
      AND u.role IN ('tenant_admin','manager','viewer')
    LEFT JOIN gps_devices d ON d.traccar_device_id=v.traccar_device_id AND d.tenant_id=v.tenant_id
      AND d.lifecycle_status='installed'
    WHERE v.tenant_id=$1 AND ($4::bigint[] IS NULL OR v.id=ANY($4))
      AND ($6::text IS NULL OR strpos(lower(v.name),lower($6))>0 OR strpos(lower(v.registration_number),lower($6))>0)
    ORDER BY v.id LIMIT $5`,[auth.tenantId,auth.userId,auth.tokenVersion,ids.length?ids:null,limit,search])).rows;
}
function eligible(v) { return v.inventory_id!=null && v.installation!=null; }
function vehicle(v) { return {id:v.id,name:v.name,registration:v.registration,historyAvailable:eligible(v)}; }
async function options(auth,query) {
  if(Object.keys(query).some(key=>key!=="q") ||
      (query.q!=null && (typeof query.q!=="string" || query.q.length>100))) reject(400,"Invalid vehicle search.");
  const rows=await scope(auth,[],101,query.q?.trim()||null);
  return {vehicles:rows.slice(0,100).map(vehicle),more:rows.length>100};
}
function point(raw, window, deviceId) {
  const at=time(raw?.fixTime),received=time(raw?.serverTime);
  if(String(raw?.deviceId)!==deviceId || !(at>=window.from&&at<window.to) ||
      !(received>window.installed&&received<=window.now) || at>window.now+60000 ||
      raw.valid!==true || !Number.isFinite(raw.latitude) || Math.abs(raw.latitude)>90 ||
      !Number.isFinite(raw.longitude) || Math.abs(raw.longitude)>180) return null;
  return {id:String(raw.id),at,latitude:raw.latitude,longitude:raw.longitude,
    speed:numeric(raw.speed)?raw.speed*1.852:null,
    ignition:typeof raw.attributes?.ignition==="boolean"?raw.attributes.ignition:null};
}

function distance(a,b) {
  const rad=Math.PI/180;
  const h=Math.sin((b.latitude-a.latitude)*rad/2)**2+
    Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,h)));
}
function routeSample(points) {
  const max=1000;
  const sampled=points.length<=max?points:Array.from({length:max},(_,i)=>points[Math.floor(i*(points.length-1)/(max-1))]);
  return {points:sampled.map(p=>({latitude:p.latitude,longitude:p.longitude,time:iso(p.at),speed:p.speed,segment:p.segment})),
    sampled:sampled.length<points.length,pointCount:points.length};
}
function lowerBound(points,target) {
  let start=0,end=points.length;
  while(start<end){const mid=(start+end)>>1;if(points[mid].at<target) start=mid+1;else end=mid;}
  return start;
}
function normalize(v,window,raw,tripRows,stopRows,tripId) {
  if(raw.length>MAX_POINTS || tripRows.length+stopRows.length>MAX_RECORDS) {
    reject(413,"Too much telemetry. Shorten the date range or select fewer vehicles.");
  }
  const observations=raw.filter(p=>String(p?.deviceId)===v.device_id)
    .map(p=>({at:time(p.fixTime),point:point(p,window,v.device_id)}))
    .filter(p=>Number.isFinite(p.at)).sort((a,b)=>a.at-b.at);
  const output={trips:[],stops:[],omitted:0,zeroDurationIntervals:0,route:null};
  const intervals=[...tripRows.map(row=>({type:"trips",row})),...stopRows.map(row=>({type:"stops",row}))]
    .filter(({row})=>String(row?.deviceId)===v.device_id)
    .map(item=>({...item,start:time(item.row.startTime),end:time(item.row.endTime)}))
    .sort((a,b)=>a.start-b.start || a.end-b.end);
  let previousEnd=-Infinity;
  for(const {row,type,start,end} of intervals){
    if(!(start>=window.from&&end<window.to&&end>=start) || start<previousEnd){output.omitted++;continue;}
    const startIndex=lowerBound(observations,start);
    const endIndex=lowerBound(observations,end+1);
    const candidates=observations.slice(startIndex,endIndex);
    const points=candidates.map(p=>p.point);
    const startId=type==="trips"?row.startPositionId:row.positionId;
    const first=points.find(p=>p?.at===start&&p.id===String(startId));
    const last=points.findLast(p=>p?.at===end&&(type==="stops"||p.id===String(row.endPositionId)));
    if(!first || !last || points.some(p=>!p)){output.omitted++;continue;}
    if(start===end){
      if(!(start>window.installed) || filterTime(row.startTime)!==start || filterTime(row.endTime)!==end ||
          !id(first.id) || !id(last.id)) output.omitted++;
      else output.zeroDurationIntervals++;
      continue;
    }
    previousEnd=end;
    const reportId=createHash("sha256").update(JSON.stringify([v.id,v.installation,type,first.id,last.id,start,end])).digest("hex");
    const duration=(end-start)/1000;
    const record={id:reportId,vehicleId:v.id,vehicle:v.name,registration:v.registration,
      start:iso(start),end:iso(end),duration,day:window.day(start),
      startLocation:[first.latitude,first.longitude],endLocation:[last.latitude,last.longitude],
      quality:"verified_bounds",gaps:0};
    let km=0,idle=0,off=0,classified=0;
    const routePoints=[];
    let previous=null;
    for(const p of points){
      if(previous?.at===p.at) continue;
      if(previous){
        const seconds=(p.at-previous.at)/1000;
        if(seconds>300) record.gaps++;
        else {
          km+=distance(previous,p);
          if(previous.ignition===p.ignition && p.ignition!==null){
            classified+=seconds;
            if(p.ignition===false)off+=seconds;
            else if(previous.speed!=null&&p.speed!=null&&previous.speed<=1&&p.speed<=1)idle+=seconds;
          }
        }
      }
      routePoints.push({...p,segment:record.gaps});
      previous=p;
    }
    if(type==="trips"){
      const speeds=points.flatMap(p=>p.speed==null?[]:[p.speed]);
      const kmRounded=Number(km.toFixed(6));
      Object.assign(record,{distance: record.gaps===routePoints.length-1?null:kmRounded,
        averageSpeed:record.gaps===0?kmRounded/(duration/3600):null,maxSpeed:speeds.length?Math.max(...speeds):null});
      if(tripId===reportId){
        output.route=routeSample(routePoints);
      }
    } else {
      Object.assign(record,{idle:classified>0&&idle>0?idle:null,ignitionOff:classified>0?off:null,
        ignitionCoverage:classified,duration});
    }
    output[type].push(record);
  }
  return output;
}

let active=0;
async function recheck(auth,rows) {
  if(!rows.length)return;
  const current=await scope(auth,rows.map(v=>v.id));
  if(rows.length!==current.length || rows.some((v,i)=>["id","inventory_id","device_id","installation"].some(k=>v[k]!==current[i][k]))) {
    reject(409,"Vehicle access changed while loading the report. Refresh and try again.");
  }
}
async function fetchDataset(auth,filters,tripId) {
  if(active>=3) reject(503,"Reporting is busy. Try again in a moment.");
  active++;
  const controller=new AbortController();
  try {
    const rows=await scope(auth,filters.vehicles);
    if(filters.vehicles.length&&rows.length!==filters.vehicles.length) reject(404,"Vehicle not found.");
    if(rows.length>MAX_VEHICLES) reject(400,"Select up to 10 vehicles for each report.");
    const result={trips:[],stops:[],omitted:0,zeroDurationIntervals:0,route:null,vehicles:rows.map(vehicle),access:rows};
    const deadline=AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]);
    for(const v of rows){
      if(!eligible(v))continue;
      const installed=Number(v.installed_ms);
      const from=Math.max(filters.from,Math.floor(installed)+1);
      const now=Date.now(),to=Math.min(filters.to,now+1);
      if(!(from<to))continue;
      if(!/^[1-9]\d*$/.test(v.device_id) || !Number.isSafeInteger(Number(v.device_id))) continue;
      const params={deviceId:v.device_id,from:iso(from),to:iso(to-1)};
      let reports;
      try {
        reports=await Promise.all(["route","trips","stops"].map(kind=>getReport(kind,params,deadline)));
      } catch(error) {
        if(error.code==="ERR_BAD_RESPONSE" && error.message.includes("maxContentLength")) {
          reject(413,"Traccar could not return this volume. Shorten the date range.");
        }
        reject(502,"Historical telemetry is temporarily unavailable.");
      }
      if(!reports.every(Array.isArray)) reject(502,"Traccar returned an invalid report.");
      const normalized=normalize(v,{from,to,now,installed,day:filters.day},...reports,tripId);
      result.trips.push(...normalized.trips);result.stops.push(...normalized.stops);
      result.omitted+=normalized.omitted;
      result.zeroDurationIntervals+=normalized.zeroDurationIntervals;
      if(normalized.route)result.route=normalized.route;
      if(result.trips.length+result.stops.length>MAX_RECORDS) reject(413,"Too many report rows. Narrow your filters.");
    }
    // Recheck allocation, access, identity and installation after all provider I/O.
    await recheck(auth,rows);
    return result;
  } finally {controller.abort();active--;}
}

function summary(trips,stops) {
  const sum=(rows,field)=>rows.reduce((total,row)=>total+(row[field]??0),0);
  const known=trips.filter(t=>t.distance!=null);
  const speed=trips.flatMap(t=>t.maxSpeed==null?[]:[t.maxSpeed]);
  return {
    distance:known.length?sum(known,"distance"):null,trips:trips.length,moving:sum(trips,"duration"),
    stopped:sum(stops,"duration"),averageDistance:known.length?sum(known,"distance")/known.length:null,
    averageDuration:trips.length?sum(trips,"duration")/trips.length:null,maxSpeed:speed.length?Math.max(...speed):null,
    activeVehicles:new Set([...trips,...stops].map(row=>row.vehicleId)).size,
    idle:stops.some(s=>s.idle!=null)?sum(stops,"idle"):null,
    partialDistance:trips.some(t=>t.distance==null||t.gaps>0),
  };
}
function assemble(dataset,type,filters,paginate=true) {
  const {trips,stops,vehicles,omitted,zeroDurationIntervals=0}=dataset;
  const byVehicle=new Map(vehicles.map(v=>[v.id,{v,trips:[],stops:[],days:new Map()}]));
  const days=new Map();
  for(const trip of trips){
    const entry=byVehicle.get(trip.vehicleId);
    entry.trips.push(trip);
    if(!entry.days.has(trip.day))entry.days.set(trip.day,[]);
    entry.days.get(trip.day).push(trip);
    if(!days.has(trip.day))days.set(trip.day,[]);
    days.get(trip.day).push(trip);
  }
  for(const stop of stops) byVehicle.get(stop.vehicleId).stops.push(stop);
  const activity=[...byVehicle.values()].map(({v,trips:t,stops:s})=>({vehicleId:v.id,vehicle:v.name,registration:v.registration,
    historyAvailable:v.historyAvailable,...summary(t,s)}));
  const mileage=[...byVehicle.values()].flatMap(({v,days})=>[...days].map(([day,t])=>({
    vehicleId:v.id,vehicle:v.name,registration:v.registration,day,...summary(t,[])})));
  const trend=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([day,t])=>({day,...summary(t,[])}));
  const list={trips,stops,mileage,activity}[type];
  const order={
    newest:(a,b)=>(b.start??b.day??"").localeCompare(a.start??a.day??""),
    oldest:(a,b)=>(a.start??a.day??"").localeCompare(b.start??b.day??""),
    distance:(a,b)=>(b.distance??-1)-(a.distance??-1),
    duration:(a,b)=>(b.duration??b.moving)-(a.duration??a.moving),
    vehicle:(a,b)=>a.vehicle.localeCompare(b.vehicle),
  };
  const sorted=[...list].sort(order[filters.sort]);
  const offset=(filters.page-1)*filters.limit;
  return {type,rows:paginate?sorted.slice(offset,offset+filters.limit):sorted,totalRows:sorted.length,
    page:filters.page,limit:filters.limit,totals:summary(trips,stops),trend,vehicles,omitted,zeroDurationIntervals,
    range:{from:iso(filters.from),to:iso(filters.to),timezone:filters.timezone}};
}

module.exports={TYPES,ReportError,reject,parseFilters,options,fetchDataset,assemble,normalize,recheck};
