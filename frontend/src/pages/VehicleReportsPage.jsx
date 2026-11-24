import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import TenantLayout from "../components/TenantLayout";
import { MetricCard, PageHeader, StateNotice } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";
import "leaflet/dist/leaflet.css";

const TYPES={trips:"Trip history",mileage:"Mileage",stops:"Stops",activity:"Fleet activity"};
const panel="min-w-0 rounded-panel border border-line bg-panel p-4";
const field="grid min-w-0 gap-1 text-sm";
const control="control w-full min-w-0";
const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
const decimal=new Intl.NumberFormat(undefined,{maximumFractionDigits:2});
const moment=new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"medium",timeZone:timezone});
const km=n=>n==null?"Unavailable":decimal.format(n)+" km";
const speed=n=>n==null?"Unavailable":decimal.format(n)+" km/h";
const duration=n=>n==null?"Unavailable":n>=3600?`${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`:n>=60?`${Math.floor(n/60)}m ${Math.round(n%60)}s`:`${Math.round(n)}s`;
const dateStamp=value=>[value.getFullYear(),String(value.getMonth()+1).padStart(2,"0"),String(value.getDate()).padStart(2,"0")].join("-");
const localMidnight=value=>{const [y,m,d]=value.split("-").map(Number);return new Date(y,m-1,d);};
const coordinates=p=>p?.map(v=>v.toFixed(5)).join(", ") || "Unavailable";
const errorMessage=e=>e.response?.data?.message||"Unable to load reporting data. Try again.";
const fmtTime=v=>moment.format(new Date(v));

function period(preset) {
  const start=new Date(),end=new Date();
  if(preset==="yesterday") {start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);}
  if(preset==="week")start.setDate(start.getDate()-6);
  if(preset==="month")start.setDate(start.getDate()-29);
  return {start:dateStamp(start),end:dateStamp(end)};
}
function parameters(filters) {
  const from=localMidnight(filters.start);
  const to=localMidnight(filters.end);
  to.setDate(to.getDate()+1);
  const params=new URLSearchParams({from:from.toISOString(),to:to.toISOString(),timezone,sort:filters.sort});
  for(const id of filters.vehicles)params.append("vehicleId",id);
  return params;
}

function Overview({result}) {
  const {totals,trend}=result;
  const metrics=[
    ["GPS distance",km(totals.distance)],["Trips",totals.trips],["Movement",duration(totals.moving)],
    ["Stopped",duration(totals.stopped)],["Average trip distance",km(totals.averageDistance)],
    ["Average trip duration",duration(totals.averageDuration)],["Maximum recorded speed",speed(totals.maxSpeed)],
    ["Vehicles with activity",totals.activeVehicles],["Observed idle",duration(totals.idle)],
  ];
  const largest=Math.max(1,...trend.map(d=>d.distance??0));
  return <>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
      {metrics.map(([label,value])=><MetricCard key={label} title={label} value={value} />)}
    </div>
    {trend.length>0&&<section className={panel}>
      <h2 className="font-semibold">Daily GPS distance and trip count</h2>
      <p className="text-sm text-muted">Trips are grouped by their start date in {timezone}.</p>
      <ul className="mt-3 grid gap-2">
        {trend.map(d=><li key={d.day} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_13rem]">
          <span>{d.day}</span>
          <div className="self-center rounded bg-hover" aria-hidden="true"><div className="h-2 rounded bg-action" style={{width:`${(d.distance??0)*100/largest}%`}} /></div>
          <span className="col-span-2 text-muted sm:col-span-1">{km(d.distance)} · {d.trips} trips{d.partialDistance?" · partial":""}</span>
        </li>)}
      </ul>
    </section>}
    {(totals.partialDistance||result.omitted>0||result.vehicles.some(v=>!v.historyAvailable))&&
      <p role="status" className="text-sm text-muted">Results may be incomplete. {result.omitted>0&&`${result.omitted} intervals were omitted because their bounds were unverified or overlapped. `}
        Vehicles without a verified installation have no historical telemetry. Distance is GPS-derived.</p>}
  </>;
}

const columns={
  trips:[["Start",r=>fmtTime(r.start)],["End",r=>fmtTime(r.end)],["Start coordinates",r=>coordinates(r.startLocation)],
    ["End coordinates",r=>coordinates(r.endLocation)],["GPS distance",r=>km(r.distance)],["Duration",r=>duration(r.duration)],
    ["Average speed",r=>speed(r.averageSpeed)],["Maximum speed",r=>speed(r.maxSpeed)],["GPS coverage",r=>r.gaps?`${r.gaps} gaps`:"Verified bounds"]],
  mileage:[["Trip start date",r=>r.day],["Trips",r=>r.trips],["GPS distance",r=>km(r.distance)],["Movement",r=>duration(r.moving)],["Coverage",r=>r.partialDistance?"Partial":"Recorded"]],
  stops:[["Start",r=>fmtTime(r.start)],["End",r=>fmtTime(r.end)],["Coordinates",r=>coordinates(r.startLocation)],
    ["Stop duration",r=>duration(r.duration)],["Observed idle",r=>duration(r.idle)],["Observed ignition off",r=>duration(r.ignitionOff)]],
  activity:[["Trips",r=>r.trips],["GPS distance",r=>km(r.distance)],["Movement",r=>duration(r.moving)],["Stopped",r=>duration(r.stopped)],
    ["Observed idle",r=>duration(r.idle)],["Max speed",r=>speed(r.maxSpeed)],["History",r=>!r.historyAvailable?"Unavailable":r.partialDistance?"Partial":"Enabled"]],
};
function ReportTable({result,open}) {
  return <div className="overflow-x-auto rounded-panel border border-line" tabIndex={0} aria-label={TYPES[result.type]}>
    <table className="w-full whitespace-nowrap bg-panel text-left text-sm">
      <thead className="bg-hover"><tr><th className="px-3 py-2">Vehicle</th>
        {columns[result.type].map(([name])=><th className="px-3 py-2" key={name}>{name}</th>)}
        {result.type==="trips"&&<th className="px-3 py-2">Details</th>}
      </tr></thead>
      <tbody>{result.rows.map(r=><tr className="border-t border-line" key={r.id??`${r.vehicleId}:${r.day??""}`}>
        <th className="px-3 py-2 font-medium">{r.vehicle}<span className="block text-xs text-muted">{r.registration||"—"}</span></th>
        {columns[result.type].map(([name,value])=><td className="px-3 py-2" key={name}>{value(r)}</td>)}
        {result.type==="trips"&&<td className="px-3 py-2"><button type="button" className="control" onClick={()=>open(r)}>View route</button></td>}
      </tr>)}</tbody>
    </table>
  </div>;
}

function TripRoute({trip,route}) {
  const points=route?.points??[];
  if(!points.length)return <StateNotice>No valid route points are available.</StateNotice>;
  const position=p=>[p.latitude,p.longitude];
  const segments=Object.groupBy(points,p=>p.segment);
  return <>
    <p className="text-sm text-muted">{route.pointCount} recorded points{route.sampled?" · map sampled":""}
      {trip.gaps?` · ${trip.gaps} GPS gaps shown as breaks`:""}</p>
    <div className="fleet-map" data-layer="street"><MapContainer key={trip.id} className="z-0 h-80 rounded-panel" bounds={points.map(position)} boundsOptions={{padding:[24,24],maxZoom:16}}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {Object.entries(segments).map(([id,chunk])=>chunk.length>1&&<Polyline key={id} positions={chunk.map(position)} pathOptions={{color:"#2563eb",weight:4}} />)}
      {[["Start",points[0]],...(points.length>1?[["End",points.at(-1)]]:[])].map(([role,p])=>
        <CircleMarker key={role} center={position(p)} radius={7} pathOptions={{color:role==="Start"?"#15803d":"#b91c1c"}}>
          <Tooltip>{role} · {fmtTime(p.time)} · {speed(p.speed)}</Tooltip>
        </CircleMarker>)}
    </MapContainer></div>
  </>;
}

export default function VehicleReportsPage() {
  const {session}=useAuth();
  const key=JSON.stringify([session?.profile?.tenantId,session?.profile?.id,session?.profile?.email]);
  return <TenantLayout title="Reports & analytics"><ReportWorkspace key={key} /></TenantLayout>;
}
function ReportWorkspace() {
  const [vehicles,setVehicles]=useState(null);
  const [vehicleQuery,setVehicleQuery]=useState("");
  const [draft,setDraft]=useState(()=>({...period("week"),vehicles:[],sort:"newest"}));
  const [preset,setPreset]=useState("week");
  const [filters,setFilters]=useState(null);
  const [type,setType]=useState("trips");
  const [page,setPage]=useState(1);
  const [revision,setRevision]=useState(0);
  const [result,setResult]=useState(null);
  const [selected,setSelected]=useState(null);
  const [details,setDetails]=useState(null);
  const [error,setError]=useState("");
  const [vehicleError,setVehicleError]=useState("");
  const [detailError,setDetailError]=useState("");
  const [exporting,setExporting]=useState("");
  const exportRequest=useRef(null);
  useEffect(()=>()=>exportRequest.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      tenantApi.get("/reports/vehicles",{params:{q:vehicleQuery},signal:controller.signal})
        .then(r=>{if(!controller.signal.aborted){setVehicles(r.data);setVehicleError("");}})
        .catch(e=>{if(!controller.signal.aborted)setVehicleError(errorMessage(e));});
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[revision,vehicleQuery]);
  useEffect(()=>{
    if(!filters)return;
    const controller=new AbortController();
    const params=parameters(filters);
    params.set("page",page);
    tenantApi.get(`/reports/${type}`,{params,signal:controller.signal,timeout:45000})
      .then(r=>{if(!controller.signal.aborted)setResult(r.data);})
      .catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));});
    return ()=>controller.abort();
  },[filters,type,page,revision]);
  useEffect(()=>{
    if(!selected||!filters)return;
    const controller=new AbortController();
    const params=parameters({...filters,vehicles:[selected.vehicleId]});
    tenantApi.get(`/reports/trips/${selected.id}`,{params,signal:controller.signal,timeout:45000})
      .then(r=>{if(!controller.signal.aborted)setDetails(r.data);})
      .catch(e=>{if(!controller.signal.aborted)setDetailError(errorMessage(e));});
    return ()=>controller.abort();
  },[selected,filters]);
  const reset=()=>{setResult(null);setError("");setSelected(null);setDetails(null);setDetailError("");};
  const update=(key,value)=>setDraft({...draft,[key]:value});
  const open=trip=>{setSelected(trip);setDetails(null);setDetailError("");};
  const submit=e=>{
    e.preventDefault();
    reset();setPage(1);
    if(draft.vehicles.length>10){setFilters(null);setError("Select at most 10 vehicles.");return;}
    setFilters({...draft});
  };
  const download=async format=>{
    if(exportRequest.current||!filters)return;
    const controller=new AbortController();
    exportRequest.current=controller;
    setExporting(format);setError("");
    try {
      const {data}=await tenantApi.get(`/reports/exports/${type}/${format}`,{
        params:parameters(filters),responseType:"blob",timeout:60000,signal:controller.signal,
      });
      if(controller.signal.aborted)return;
      const url=URL.createObjectURL(data);
      const link=document.createElement("a");link.href=url;link.download=`sna-${type}.${format}`;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(err){
      if(controller.signal.aborted)return;
      let message="Export failed. Try a shorter date range or fewer vehicles.";
      if(err.response?.data instanceof Blob){try{message=JSON.parse(await err.response.data.text()).message||message;}catch{/* Use fallback. */}}
      setError(message);
    } finally {exportRequest.current=null;if(!controller.signal.aborted)setExporting("");}
  };
  const pageCount=result?Math.max(1,Math.ceil(result.totalRows/result.limit)):1;
  return <main className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6">
    <PageHeader title="Reports & analytics" />
    <form className={`${panel} grid gap-3`} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={field}>Period<select className={control} value={preset} onChange={e=>{setPreset(e.target.value);if(e.target.value!=="custom")setDraft({...draft,...period(e.target.value)});}}>
          <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="custom">Custom</option>
        </select></label>
        <label className={field}>First day<input className={control} type="date" value={draft.start} required onChange={e=>{setPreset("custom");update("start",e.target.value);}} /></label>
        <label className={field}>Last day<input className={control} type="date" min={draft.start} value={draft.end} required onChange={e=>{setPreset("custom");update("end",e.target.value);}} /></label>
        <label className={field}>Sort<select className={control} value={draft.sort} onChange={e=>update("sort",e.target.value)}>
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="vehicle">Vehicle</option><option value="distance">Distance</option><option value="duration">Duration</option>
        </select></label>
      </div>
      <label className={field}>Find a vehicle<input className={control} maxLength={100} value={vehicleQuery} onChange={e=>setVehicleQuery(e.target.value)} /></label>
      <label className={field}>Vehicles<select multiple className={control} size={Math.min(5,Math.max(2,vehicles?.vehicles.length??0))}
        value={draft.vehicles} onChange={e=>{const visible=new Set(vehicles.vehicles.map(v=>v.id));update("vehicles",[
          ...draft.vehicles.filter(id=>!visible.has(id)),...[...e.target.selectedOptions].map(o=>o.value),
        ]);}}>
        {vehicles?.vehicles.map(v=><option key={v.id} value={v.id}>{v.name}{v.registration?` · ${v.registration}`:""}{!v.historyAvailable?" · history unavailable":""}</option>)}
      </select></label>
      {draft.vehicles.length>0&&<div className="flex items-center gap-2 text-sm text-muted">
        <span>{draft.vehicles.length} selected</span><button type="button" className="control" onClick={()=>update("vehicles",[])}>Clear selection</button>
      </div>}
      <p className="text-sm text-muted">Select up to 10 vehicles. Leaving the selection empty includes all vehicles when the fleet fits that limit. Dates use {timezone}.</p>
      {vehicles?.more&&<p className="text-sm text-caution">Showing the first 100 matches. Search by name or registration to narrow the list.</p>}
      {vehicleError&&<p role="alert">{vehicleError}</p>}
      {!vehicles&&!vehicleError&&<StateNotice loading>Loading vehicles…</StateNotice>}
      <div className="flex flex-wrap gap-2"><button className="control" type="submit">Apply filters</button>
        <button type="button" className="control" onClick={()=>{reset();setRevision(v=>v+1);}}>Refresh</button></div>
    </form>
    <nav aria-label="Report type" className="flex flex-wrap gap-2">
      {Object.entries(TYPES).map(([id,label])=><button key={id} className="control aria-pressed:bg-accent-soft aria-pressed:text-accent"
        type="button" aria-pressed={type===id} onClick={()=>{if(type!==id){reset();setPage(1);setType(id);}}}>{label}</button>)}
    </nav>
    {error&&<p role="alert" className="text-negative">{error}</p>}
    {!filters&&!error&&<StateNotice>Apply filters to load {TYPES[type].toLowerCase()}.</StateNotice>}
    {filters&&!result&&!error&&<StateNotice loading>Loading report…</StateNotice>}
    {result&&<>
      <Overview result={result} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="grow text-xl font-semibold">{TYPES[type]}</h2>
        {["csv","xlsx","pdf"].map(format=><button className="control" type="button" key={format} disabled={Boolean(exporting)}
          onClick={()=>void download(format)}>{exporting===format?"Exporting…":`Export ${format.toUpperCase()}`}</button>)}
      </div>
      {result.rows.length?<ReportTable result={result} open={open} />:<StateNotice>No records for the selected vehicles and dates.</StateNotice>}
      {pageCount>1&&<div className="flex flex-wrap items-center gap-2">
        <button className="control" type="button" disabled={page===1} onClick={()=>{reset();setPage(p=>p-1);}}>Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button className="control" type="button" disabled={page>=pageCount} onClick={()=>{reset();setPage(p=>p+1);}}>Next</button>
      </div>}
    </>}
    {selected&&<section className={`${panel} grid gap-3`} aria-label="Trip route">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="text-lg font-semibold">{selected.vehicle} trip route</h2><p className="text-sm text-muted">{fmtTime(selected.start)} · {km(selected.distance)} · {duration(selected.duration)} · {speed(selected.maxSpeed)} max</p></div>
        <button className="control" type="button" onClick={()=>open(null)}>Close route</button>
      </div>
      {detailError?<p role="alert">{detailError}</p>:details?<TripRoute {...details} />:<StateNotice loading>Loading historical route…</StateNotice>}
    </section>}
  </main>;
}
