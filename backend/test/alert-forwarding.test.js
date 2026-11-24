const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalize } = require("../src/services/alert-worker");

const time = "2026-01-01T00:00:00.000Z";
const position = {id:0,deviceId:65,serverTime:time,fixTime:time,valid:true,latitude:24.86,longitude:67.05,speed:10};
const envelope = {position,device:{id:65}};

test("Traccar pre-persistence position uses a stable reserved queue key",()=>{
  const item=normalize(envelope);
  assert.equal(item.source,"position");
  assert.equal(item.device,65);
  assert.ok(BigInt(item.id)<0n);
  assert.equal(normalize({...envelope,device:{id:65,lastUpdate:time}}).id,item.id);
  assert.notEqual(normalize({position:{...position,longitude:67.06}}).id,item.id);
  const persisted=normalize({...envelope,position:{...position,id:55}});
  assert.equal(persisted.id,55);
  assert.equal(persisted.data.fix,item.data.fix);
});

test("only wrapped positions qualify and existing validation still applies",()=>{
  assert.equal(normalize(position),null);
  for(const patch of [{id:-1},{id:undefined},{id:"0"},{deviceId:0},{valid:false},{serverTime:"invalid"},{latitude:91}]){
    assert.equal(normalize({...envelope,position:{...position,...patch}}),null);
  }
  assert.equal(normalize({...envelope,device:{id:66}}),null);
});

test("events still require their original persisted IDs and matching positions",()=>{
  const event={id:12,type:"ignitionOn",deviceId:65,eventTime:time,positionId:55};
  const linked={...position,id:55};
  assert.equal(normalize({event,position:linked}).data.type,"ignition_on");
  assert.equal(normalize({event:{...event,id:0},position:linked}),null);
  assert.equal(normalize({event,position}),null);
  assert.deepEqual(normalize({event:{...event,type:"deviceMoving"}}),{ignored:true});
});
