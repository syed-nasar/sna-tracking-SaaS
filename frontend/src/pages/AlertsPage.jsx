import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Circle, MapContainer, Polygon, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import TenantLayout from "../components/TenantLayout";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const labels = { entry:"Geofence entry", exit:"Geofence exit", overspeed:"Overspeed", offline:"Offline",
  online:"Reconnected", ignition_on:"Ignition on", ignition_off:"Ignition off", low_battery:"Low battery",
  power_disconnected:"Power disconnected" };
const severities = ["info","warning","critical"];
const control = "control w-full min-w-0";
const panel = "min-w-0 rounded-panel border border-line bg-panel p-4";
const blankFence = () => ({name:"",description:"",enabled:true,vehicles:[],geometry:{type:"circle",center:[0,0],radius:200}});
const blankRule = () => ({name:"",description:"",type:"entry",severity:"warning",enabled:true,inApp:true,email:false,threshold:10,cooldown:60,vehicleId:null,groupId:null});
const message = error => error.response?.data?.message || "Could not complete this request. Try again.";

function Field({title,children}) {
  return <label className="grid min-w-0 gap-1 text-sm">{title}{children}</label>;
}
function MapClicks({onPoint}) {
  useMapEvents({click:event=>onPoint([event.latlng.lat,event.latlng.lng])});
  return null;
}
function FenceMap({value,onChange}) {
  const [lat,lon] = value.center || value.vertices?.[0] || [0,0];
  return <div className="space-y-2">
    <MapContainer center={[lat,lon]} zoom={lat||lon?13:2} className="z-0 h-64 rounded-lg">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapClicks onPoint={p=>onChange(value.type==="circle"?{...value,center:p}:{...value,vertices:[...value.vertices,p].slice(0,100)})} />
      {value.type==="circle" ? <Circle center={value.center} radius={value.radius} /> : value.vertices.length>1 && <Polygon positions={value.vertices} />}
    </MapContainer>
    {value.type==="circle" ? <div className="grid gap-2 sm:grid-cols-3">
      {["Latitude","Longitude"].map((title,i)=><Field key={title} title={title}><input className={control} type="number" step="any" required value={value.center[i]} onChange={e=>onChange({...value,center:value.center.map((n,k)=>k===i?Number(e.target.value):n)})} /></Field>)}
      <Field title="Radius in metres"><input className={control} type="number" min="10" max="100000" required value={value.radius} onChange={e=>onChange({...value,radius:Number(e.target.value)})} /></Field>
    </div> : <div className="space-y-2">
      <p className="text-sm text-muted">Select vertices on the map or enter latitude and longitude pairs. The final edge closes automatically.</p>
      {value.vertices.map((pair,index)=><div key={index} className="flex flex-wrap gap-2">
        {pair.map((coordinate,i)=><input key={i} aria-label={`Vertex ${index+1} ${i?"longitude":"latitude"}`} className="control w-28" type="number" step="any" value={coordinate} onChange={e=>onChange({...value,vertices:value.vertices.map((p,k)=>k===index?p.map((n,j)=>j===i?Number(e.target.value):n):p)})} />)}
        <button type="button" className="control" onClick={()=>onChange({...value,vertices:value.vertices.filter((_,i)=>i!==index)})}>Remove vertex {index+1}</button>
      </div>)}
      <button type="button" className="control" disabled={value.vertices.length>=100} onClick={()=>onChange({...value,vertices:[...value.vertices,[0,0]]})}>Add vertex</button>
    </div>}
  </div>;
}
function Settings({data,reload,canWrite,tab,run}) {
  const [draft,setDraft] = useState(null);
  const [query,setQuery] = useState("");
  const [status,setStatus] = useState("");
  if(tab==="preferences") return <section className={panel}>
    <h2 className="font-semibold">Delivery preference</h2>
    {[["inApp","Receive in-app alerts"],["email","Receive email alerts"]].map(([key,label])=><label key={key} className="mt-3 flex gap-2">
      <input type="checkbox" checked={data[key]} onChange={e=>{const value=e.target.checked;void run(async()=>{
        await tenantApi.put("/alerts/preferences",{inApp:data.inApp,email:data.email,[key]:value});await reload();
      });}} /> {label}
    </label>)}
    {!data.smtpEnabled&&<p className="mt-2 text-sm text-muted">Email delivery is currently unavailable.</p>}
  </section>;
  const fence=tab==="geofences";
  const items=(fence?data.fences:data.rules).filter(r=>r.name.toLowerCase().includes(query.toLowerCase())&&(!status||String(r.enabled)===status));
  const update=patch=>setDraft({...draft,...patch});
  const save=e=>{
    e.preventDefault();
    void run(async()=>{
      if(draft.id) await tenantApi.put(`/alerts/${tab}/${draft.id}`,draft);
      else await tenantApi.post(`/alerts/${tab}`,draft);
      await reload();setDraft(null);
    });
  };
  return <div className="grid gap-4">
    <section className={panel} aria-label={tab}>
      <div className="flex flex-wrap items-end gap-2">
        <Field title="Search"><input className={control} value={query} onChange={e=>setQuery(e.target.value)} /></Field>
        <Field title="Status"><select className={control} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option><option value="true">Active</option><option value="false">Disabled</option></select></Field>
        {canWrite&&<button className="control" type="button" onClick={()=>setDraft(fence?blankFence():blankRule())}>Add {fence?"geofence":"rule"}</button>}
      </div>
      {!items.length&&<p className="mt-4 text-muted">No matching {tab}.</p>}
      <ul className="mt-4 divide-y divide-line">
        {items.map(row=><li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="grow"><strong>{row.name}</strong> <span className="text-sm text-muted">{row.enabled?"Active":"Disabled"} · {fence?row.vehicles.map(id=>data.vehicles.find(v=>v.id===id)?.name).filter(Boolean).join(", ")||"No assigned vehicles":labels[row.type]}</span></span>
          {fence&&data.nativeGeofences&&<span className={row.sync_status==="failed"?"text-sm text-danger":"text-sm text-muted"}>
            {row.sync_status==="synced"?"Traccar synchronized":row.sync_status==="failed"?"Traccar sync failed · retry scheduled":"Traccar sync pending"}
          </span>}
          {canWrite&&<><button className="control" type="button" onClick={()=>setDraft({...row,inApp:row.in_app,vehicleId:row.vehicle_id,groupId:row.group_id})}>Edit</button>
            <button className="control" type="button" onClick={()=>{if(window.confirm(`Delete ${row.name}?`))void run(async()=>{await tenantApi.delete(`/alerts/${tab}/${row.id}`);setDraft(null);await reload();});}}>Delete</button></>}
        </li>)}
      </ul>
    </section>
    {draft&&canWrite&&<form className={`${panel} grid gap-3`} onSubmit={save}>
      <h2 className="font-semibold">{draft.id?"Edit":"Create"} {fence?"geofence":"rule"}</h2>
      <Field title="Name"><input className={control} required maxLength={100} value={draft.name} onChange={e=>update({name:e.target.value})} /></Field>
      <label className="flex gap-2"><input type="checkbox" checked={draft.enabled} onChange={e=>update({enabled:e.target.checked})} /> Enabled</label>
      {fence ? <>
        <Field title="Description"><textarea className={control} maxLength={500} value={draft.description} onChange={e=>update({description:e.target.value})} /></Field>
        <Field title="Shape"><select className={control} value={draft.geometry.type} onChange={e=>update({geometry:e.target.value==="circle"?blankFence().geometry:{type:"polygon",vertices:[]}})}><option value="circle">Circle</option><option value="polygon">Polygon</option></select></Field>
        <FenceMap key={draft.id||"new"} value={draft.geometry} onChange={geometry=>update({geometry})} />
        <Field title="Assigned vehicles"><select className={control} multiple value={draft.vehicles} onChange={e=>update({vehicles:[...e.target.selectedOptions].map(o=>o.value)})}>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      </> : <>
        <Field title="Description"><textarea className={control} maxLength={500} value={draft.description} onChange={e=>update({description:e.target.value})} /></Field>
        <Field title="Event type"><select className={control} value={draft.type} onChange={e=>update({type:e.target.value})}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
        <Field title="Severity"><select className={control} value={draft.severity} onChange={e=>update({severity:e.target.value})}>{severities.map(v=><option key={v}>{v}</option>)}</select></Field>
        <Field title="Vehicle scope"><select className={control} value={draft.vehicleId?`v:${draft.vehicleId}`:draft.groupId?`g:${draft.groupId}`:""} onChange={e=>{const [type,id]=e.target.value.split(":");update({vehicleId:type==="v"?id:null,groupId:type==="g"?id:null});}}><option value="">All vehicles</option>{data.vehicles.map(v=><option key={v.id} value={`v:${v.id}`}>{v.name}</option>)}{data.groups.map(g=><option key={g.id} value={`g:${g.id}`}>Group: {g.name}</option>)}</select></Field>
        {["offline","overspeed"].includes(draft.type)&&<Field title={draft.type==="offline"?"Minimum outage minutes":"Speed threshold (km/h)"}><input className={control} required min="1" max={draft.type==="offline"?10080:500} type="number" value={draft.threshold} onChange={e=>update({threshold:Number(e.target.value)})} /></Field>}
        <Field title="Cooldown in seconds"><input className={control} required min="0" max="86400" type="number" value={draft.cooldown} onChange={e=>update({cooldown:Number(e.target.value)})} /></Field>
        <label className="flex gap-2"><input type="checkbox" checked={draft.inApp} onChange={e=>update({inApp:e.target.checked})} /> Send in-app notifications</label>
        <label className="flex gap-2"><input type="checkbox" checked={draft.email} onChange={e=>update({email:e.target.checked})} /> Send email notifications to opted-in users</label>
      </>}
      <div className="flex gap-2"><button className="control" type="submit">Save</button><button className="control" type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
    </form>}
  </div>;
}

function Timeline({notifications,vehicles,run}) {
  const [filters,setFilters] = useState({});
  const [cursor,setCursor] = useState(null);
  const [result,setResult] = useState(null);
  const [version,setVersion] = useState(0);
  const [error,setError] = useState("");
  const endpoint=notifications?"notifications":"history";
  useEffect(()=>{
    const controller=new AbortController();
    tenantApi.get(`/alerts/${endpoint}`,{params:{...filters,before:cursor},signal:controller.signal})
      .then(r=>{setResult(r.data);setError("");})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));});
    return ()=>controller.abort();
  },[cursor,endpoint,filters,version]);
  const filter=(key,value)=>{setResult(null);setCursor(null);setFilters({...filters,[key]:value||undefined});};
  const mark=(id,read)=>void run(async()=>{
    await tenantApi.patch(id?`/alerts/notifications/${id}`:"/alerts/notifications/read-all",{read});
    window.dispatchEvent(new Event("alerts:read"));
    setVersion(v=>v+1);
  });
  return <section className={panel}>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries({type:Object.entries(labels),severity:severities.map(v=>[v,v]),vehicle:vehicles.map(v=>[v.id,v.name]),...(notifications?{unread:[["true","Unread"],["false","Read"]]}:{})}).map(([key,options])=><Field key={key} title={key}><select className={control} onChange={e=>filter(key,e.target.value)}><option value="">All</option>{options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>)}
      <Field title="From date (UTC)"><input className={control} type="date" onChange={e=>filter("from",e.target.value)} /></Field>
      <Field title="Through date (UTC)"><input className={control} type="date" onChange={e=>filter("to",e.target.value?`${e.target.value}T23:59:59.999Z`:"")} /></Field>
    </div>
    {notifications&&<button className="control mt-3" onClick={()=>mark(null,true)}>Mark all read</button>}
    {error?<p role="alert">{error}</p>:!result?<p role="status">Loading alerts…</p>:!result.items.length?<p className="mt-3 text-muted">No matching alerts.</p>:
      <ul className="mt-3 divide-y divide-line">
        {result.items.map(row=><li key={row.id} className="flex flex-wrap items-center gap-2 py-3">
          <div className="min-w-0 grow"><Link className="break-words font-medium text-accent" to={`/alerts/events/${row.event_id}`}>{row.message}</Link>
            <p className="text-sm text-muted">{row.vehicle_name} · {row.severity} · {new Date(row.occurred_at).toLocaleString()}</p>
            {row.vehicle_id&&<Link className="text-sm text-accent" to="/vehicles">Open vehicles</Link>}</div>
          {notifications&&<button className="control" onClick={()=>mark(row.id,!row.read_at)}>{row.read_at?"Mark unread":"Mark read"}</button>}
        </li>)}
      </ul>}
    {(cursor||result?.next)&&<div className="flex gap-2"><button className="control" disabled={!cursor} onClick={()=>{setCursor(null);setResult(null);}}>Newest</button><button className="control" disabled={!result?.next} onClick={()=>{setCursor(result.next);setResult(null);}}>Older</button></div>}
  </section>;
}

function AlertDetail({eventId}) {
  const [event,setEvent]=useState(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    tenantApi.get(`/alerts/history/${encodeURIComponent(eventId)}`,{signal:controller.signal})
      .then(r=>{if(!controller.signal.aborted)setEvent(r.data);})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));});
    return ()=>controller.abort();
  },[eventId]);
  return <TenantLayout title="Alert details"><main className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6">
    <Link className="text-accent" to="/alerts">Alert history</Link>
    <h1 className="text-2xl font-semibold">Alert details</h1>
    {error?<p role="alert">{error}</p>:event?<article className={panel}>
      <h2 className="font-semibold">{event.message}</h2>
      <p className="text-muted">{event.vehicle_name} · {event.severity} · <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time></p>
      {event.vehicle_id&&<Link to="/vehicles" className="text-accent">Open vehicles</Link>}
    </article>:<p role="status">Loading alert…</p>}
  </main></TenantLayout>;
}

export default function AlertsPage({notifications=false}) {
  const {eventId}=useParams();
  const {session}=useAuth();
  const accountKey=JSON.stringify([session?.profile?.tenantId,session?.profile?.id,session?.profile?.email]);
  return eventId ? <AlertDetail key={`${accountKey}:${eventId}`} eventId={eventId} />
    : <AlertWorkspace key={accountKey} notifications={notifications} />;
}

function AlertWorkspace({notifications}) {
  const {session}=useAuth();
  const [tab,setTab]=useState("history");
  const [data,setData]=useState(null);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const sessionId=session?.id;
  const accountKey=JSON.stringify([session?.profile?.tenantId,session?.profile?.id,session?.profile?.email]);
  useEffect(()=>{
    const controller=new AbortController();
    tenantApi.get("/alerts/settings",{signal:controller.signal}).then(r=>setData(r.data))
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));});
    return ()=>controller.abort();
  },[sessionId]);
  const reload=async()=>setData((await tenantApi.get("/alerts/settings")).data);
  const run=async work=>{
    setError("");setNotice("");
    try { await work();setNotice("Changes saved."); } catch(e){setError(message(e));}
  };
  const title=notifications?"Notifications":"Alerts & Geofences";
  return <TenantLayout title={title}><main className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">{title}</h1>
    {!notifications&&<nav aria-label="Alert settings" className="flex flex-wrap gap-2">
      {[["history","Alert history"],["rules","Rules"],["geofences","Geofences"],["preferences","Preferences"]].map(([value,label])=><button key={value} className="control" aria-pressed={tab===value} onClick={()=>{setError("");setNotice("");setTab(value);}}>{label}</button>)}
    </nav>}
    {error&&<p role="alert" className="text-danger">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data&&!error&&<p role="status">Loading alert settings…</p>}
    {data&&(notifications||tab==="history"?<Timeline key={`${accountKey}:${notifications}`} notifications={notifications} vehicles={data.vehicles} run={run} />:
      <Settings key={`${accountKey}:${tab}`} data={data} tab={tab} run={run} reload={reload} canWrite={["tenant_admin","manager"].includes(session?.profile?.role)} />)}
  </main></TenantLayout>;
}
