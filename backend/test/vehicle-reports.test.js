const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseFilters, normalize, assemble } = require("../src/services/vehicle-reports");
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
