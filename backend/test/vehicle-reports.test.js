const { test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/config/db");
const provider = require("../src/services/traccar.service");
let getFixtureReport;
const { mock } = require("node:test");
mock.method(provider,"getReport",(...args)=>getFixtureReport(...args));
const { parseFilters, normalize, assemble, fetchDataset } = require("../src/services/vehicle-reports");
const { exportReport } = require("../src/services/report-export");

const installed = Date.parse("2025-11-02T05:00:00.000Z");
const vehicle = {id:"4",name:"=SUM(1,2)",registration:"TEST",device_id:"65",installation:new Date(installed).toISOString()};
const filters = parseFilters({
  from:"2025-11-02T00:00:00-04:00",to:"2025-11-03T00:00:00-05:00",timezone:"America/New_York",
});
const window = {...filters,installed,from:installed+1,now:filters.to};
const raw = (id,fixTime,serverTime=fixTime) => ({
  id,deviceId:65,fixTime,serverTime,valid:true,latitude:24.86+id/10000,longitude:67,speed:12,
});
const start=raw(1,"2025-11-02T05:30:00.000Z"),end=raw(2,"2025-11-02T06:30:00.000Z");
const middle=raw(3,"2025-11-02T06:00:00.000Z");
const trip = {
  deviceId:65,startPositionId:1,endPositionId:2,startTime:start.fixTime,endTime:end.fixTime,
  distance:1e7,maxSpeed:1e7,
};

test("report periods validate calendar dates and allow a DST-length day",()=>{
  assert.equal(filters.to-filters.from,25*60*60*1000);
  assert.throws(()=>parseFilters({from:"2025-02-30T00:00:00Z",to:"2025-03-03T00:00:00Z"}),{status:400});
  assert.throws(()=>parseFilters({from:"2025-11-10T00:00:00Z",to:"2025-11-01T00:00:00Z"}),{status:400});
});

test("trip normalization rejects previous-installation receipts and foreign device rows",()=>{
  const stale={...middle,serverTime:new Date(installed-1).toISOString()};
  const data=normalize(vehicle,window,[start,stale,end],[trip,{...trip,deviceId:66}],[]);
  assert.equal(data.trips.length,0);
  assert.equal(data.omitted,1);
});

test("overlaps are removed and long telemetry gaps do not add distance",()=>{
  const data=normalize(vehicle,window,[start,middle,end],[trip,trip],[]);
  assert.equal(data.trips.length,1);
  assert.equal(data.omitted,1);
  assert.equal(data.trips[0].distance,null);
  assert.equal(data.trips[0].averageSpeed,null);
  assert.equal(data.trips[0].maxSpeed,22.224);
  const details=normalize(vehicle,window,[start,middle,end],[trip],[],data.trips[0].id);
  assert.deepEqual(details.route.points.map(point=>point.segment),[0,1,2]);
});

test("all export formats use one authorized dataset and preserve DST offsets",async()=>{
  const data=normalize(vehicle,window,[start,middle,end],[trip],[]);
  const report=assemble({...data,vehicles:[vehicle]},"trips",filters,false);
  const csv=(await exportReport(report,"csv")).body.toString();
  assert.match(csv,/'=SUM/);
  assert.match(csv,/01:30:00 GMT-04:00/);
  assert.match(csv,/01:30:00 GMT-05:00/);
  assert.equal((await exportReport(report,"xlsx")).body.subarray(0,2).toString(),"PK");
  assert.equal((await exportReport(report,"pdf")).body.subarray(0,4).toString(),"%PDF");
  await assert.rejects(exportReport({...report,totalRows:501},"pdf"),{status:413});
});

const stationary=raw(77,"2025-11-02T05:17:33.000Z");
const moving=raw(78,"2025-11-02T05:23:14.000Z");
const shortStop={deviceId:65,positionId:77,startTime:stationary.fixTime,endTime:stationary.fixTime};
const shortTrip={deviceId:65,startPositionId:78,endPositionId:78,startTime:moving.fixTime,endTime:moving.fixTime};
const verifiedVehicle={...vehicle,historyAvailable:true};

test("verified zero-duration rows are diagnostic only, preserving the 341-second stop",()=>{
  const first=normalize(vehicle,window,[stationary],[],[shortStop]);
  const second=normalize(vehicle,window,[stationary,moving],[shortTrip],[{...shortStop,endTime:moving.fixTime}]);
  for(const [data,active,stopped] of [[first,0,0],[second,1,341]]){
    const dataset={...data,vehicles:[verifiedVehicle]};
    const report=assemble(dataset,"activity",filters);
    assert.equal(report.omitted,0);
    assert.equal(report.zeroDurationIntervals,1);
    assert.equal(report.totals.activeVehicles,active);
    assert.equal(report.totals.stopped,stopped);
    assert.equal(report.totals.trips,0);
    assert.equal(report.totals.distance,null);
    assert.equal(assemble(dataset,"trips",filters).totalRows,0);
    assert.equal(assemble(dataset,"mileage",filters).totalRows,0);
    assert.equal(assemble(dataset,"stops",filters).totalRows,active);
  }
});

test("unverified or malformed zero-duration rows remain omissions, and foreign rows are ignored",()=>{
  const zeroAt=(value)=>({...shortStop,startTime:value,endTime:value});
  const prior=new Date(installed-1).toISOString();
  for(const [label,row,points,reportWindow] of [
    ["unknown position",{...shortStop,positionId:99},[stationary],window],
    ["foreign referenced point",shortStop,[{...stationary,deviceId:66}],window],
    ["wrong trip end reference",{...shortTrip,endPositionId:77},[moving],window],
    ["before installation",zeroAt(prior),[raw(77,prior)],window],
    ["stale receipt",shortStop,[{...stationary,serverTime:prior}],window],
    ["invalid receipt",shortStop,[{...stationary,serverTime:"invalid"}],window],
    ["outside window",shortStop,[stationary],{...window,to:Date.parse(stationary.fixTime)}],
    ["invalid timestamp",zeroAt("invalid"),[stationary],window],
    ["reversed",{...shortStop,endTime:new Date(installed+1).toISOString()},[stationary],window],
  ]){
    const isTrip=Object.hasOwn(row,"startPositionId");
    const result=normalize(vehicle,reportWindow,points,isTrip?[row]:[],isTrip?[]:[row]);
    assert.equal(result.omitted,1,label);
    assert.equal(result.zeroDurationIntervals,0,label);
  }
  const foreign=normalize(vehicle,window,[stationary],[],[{...shortStop,deviceId:66}]);
  assert.equal(foreign.omitted,0);
  assert.equal(foreign.zeroDurationIntervals,0);

  const overlapping=normalize(vehicle,window,[stationary,moving,middle],[],
    [{...shortStop,endTime:middle.fixTime},{...shortStop,positionId:78,startTime:moving.fixTime,endTime:moving.fixTime}]);
  assert.equal(overlapping.omitted,1);
  assert.equal(overlapping.zeroDurationIntervals,0);
  assert.equal(overlapping.stops.length,1);
});

test("report scope denies unavailable vehicles and rechecks mapping after provider calls",async(t)=>{
  const auth={tenantId:"7",userId:"3",tokenVersion:0};
  const selected={...filters,vehicles:[vehicle.id]};
  const mapping={...vehicle,inventory_id:"36",installed_ms:installed};
  let available=false;
  let providerCalls=0;
  t.mock.method(pool,"query",async (sql,params)=>{
    assert.match(sql,/WHERE v.tenant_id=\$1/);
    assert.equal(params[0],auth.tenantId);
    assert.deepEqual(params[3],[vehicle.id]);
    return {rows:available?[providerCalls?{...mapping,installation:new Date(installed+1000).toISOString()}:mapping]:[]};
  });
  getFixtureReport=async (kind,params)=>{
    providerCalls++;
    assert.equal(params.deviceId,vehicle.device_id);
    assert.ok(Date.parse(params.from)>installed);
    return kind==="route"?[stationary]:kind==="stops"?[shortStop]:[];
  };
  await assert.rejects(fetchDataset(auth,selected),{status:404});
  assert.equal(providerCalls,0);
  available=true;
  await assert.rejects(fetchDataset(auth,selected),{status:409});
  assert.equal(providerCalls,3);
});

test("report feedback distinguishes validated zero durations and conditional warnings",async()=>{
  const {reportFeedback}=await import("../../frontend/src/services/report-feedback.js");
  const result={omitted:0,zeroDurationIntervals:0,totals:{activeVehicles:0},vehicles:[verifiedVehicle]};
  assert.deepEqual(reportFeedback(result),[]);
  assert.match(reportFeedback({...result,omitted:1})[0],/^1 interval was omitted /);
  assert.match(reportFeedback({...result,omitted:2})[0],/^2 intervals were omitted /);
  assert.match(reportFeedback({...result,zeroDurationIntervals:1})[0],/too few verified GPS observations/);
  assert.deepEqual(reportFeedback({...result,zeroDurationIntervals:1,totals:{activeVehicles:1}}),[]);
  assert.match(reportFeedback({...result,vehicles:[verifiedVehicle,{historyAvailable:false}]})[0],/without a verified installation/);
});
