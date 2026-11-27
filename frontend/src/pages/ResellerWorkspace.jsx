import { useEffect,useState } from "react";
import { Building2,ChartNoAxesCombined,Cpu,Palette,UserPlus } from "lucide-react";
import { Link,useLocation,useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { MetricCard,PageHeader,StateNotice } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import { brandAsset } from "../context/brand";
import { platformApi,resellerApi } from "../services/api";
import CompanyOnboarding from "./platform/CompanyOnboarding";

const panel="min-w-0 rounded-panel border border-line bg-panel p-4";
const field="control w-full min-w-0";
const button="control";
const groups=[{name:"Reseller",items:[
  {to:"/reseller/dashboard",label:"Dashboard",icon:ChartNoAxesCombined},
  {to:"/reseller/customers",label:"Customers",icon:Building2},
  {to:"/reseller/customers/new",label:"Create Customer",icon:UserPlus},
  {to:"/reseller/inventory",label:"GPS Inventory",icon:Cpu},
  {to:"/reseller/settings",label:"Brand & domain",icon:Palette},
]}];
const orgFields=[["legal_name","Legal name"],["display_name","Display name"],["contact_email","Contact email"],["contact_phone","Contact phone"]];
const adminFields=[["full_name","Administrator name"],["email","Administrator email"]];
const brandFields=[["display_name","Brand name"],["primary_color","Primary color (#RRGGBB)"],["accent_color","Accent color (#RRGGBB)"],
  ["support_email","Support email"],["support_phone","Support phone"],["support_website","HTTPS support website"],["welcome","Welcome message"]];
const statusLabel=value=>String(value??"manual").replaceAll("_"," ");
const date=value=>value?new Date(value).toLocaleString():"—";
const errorText=error=>error.response?.data?.message||"The operation could not be completed.";

function useResource(client,url,version){
  const [result,setResult]=useState(null);
  useEffect(()=>{
    if(!url)return;
    const controller=new AbortController();
    client.get(url,{signal:controller.signal}).then(({data})=>{
      if(!controller.signal.aborted)setResult({url,data});
    }).catch(error=>{if(!controller.signal.aborted)setResult({url,error:errorText(error)});});
    return ()=>controller.abort();
  },[client,url,version]);
  return result?.url===url?result:null;
}
function Form({title,fields,initial={},submit,label="Save",children,disabled}){
  return <form className={`${panel} grid gap-3`} onSubmit={e=>{e.preventDefault();submit(Object.fromEntries(new FormData(e.currentTarget)));}}>
    <h2 className="font-semibold">{title}</h2>
    <div className="grid gap-2 sm:grid-cols-2">{fields.map(([key,name])=>
      <label key={key} className="grid gap-1 text-sm">{name}<input name={key} className={field} maxLength={500} defaultValue={initial[key]??""} /></label>)}</div>
    {children}
    <button type="submit" className={`${button} w-fit`} disabled={disabled}>{label}</button>
  </form>;
}
function ManualInvitation({invitation}){
  const [feedback,setFeedback]=useState("");
  if(!invitation)return null;
  const token=invitation.manualToken??invitation.developmentToken;
  const link=invitation.activationLink;
  const copy=async value=>{
    try {await navigator.clipboard.writeText(value);setFeedback("Copied.");}
    catch {setFeedback("Select and copy the value manually.");}
  };
  return <section className={panel}>
    <p role="status">Invitation {statusLabel(invitation.deliveryStatus)} · expires {date(invitation.expiresAt)}</p>
    {token&&<><label className="mt-2 grid gap-1 text-sm">Manual invitation token
      <textarea className="control w-full break-all font-mono" readOnly value={token} /></label>
      <p className="text-sm text-muted">Share privately using the activation page.</p>
      <button type="button" className={button} onClick={()=>void copy(token)}>Copy token</button>
      {invitation.acceptancePath&&<Link className="ms-2 text-accent" to={invitation.acceptancePath}>Open activation page</Link>}
      {link&&<label className="mt-2 grid gap-1 text-sm">Activation link
        <textarea className="control w-full break-all" readOnly value={link} /></label>}
      {link&&<button type="button" className={button} onClick={()=>void copy(link)}>Copy activation link</button>}
      {feedback&&<p role="status">{feedback}</p>}</>}
  </section>;
}
function Metrics({data}){
  if(!data)return null;
  return <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
    {Object.entries(data.counts).map(([key,value])=><MetricCard key={key} title={key==="total"?"Total customers":`${key} customers`} value={value} />)}
    {Object.entries(data.inventory).map(([key,value])=><MetricCard key={key} title={`${key} GPS devices`} value={value} />)}
  </section>;
}
function Audit({rows}){
  return <section className={panel}><h2 className="font-semibold">Recent activity</h2>
    {!rows.length&&<p className="text-muted">No activity recorded.</p>}
    <ul className="divide-y divide-line">{rows.map(row=><li key={row.id} className="flex flex-wrap gap-2 py-2 text-sm">
      <span className="grow">{row.action.replaceAll(/[._]/g," ")}</span><time dateTime={row.created_at}>{date(row.created_at)}</time>
    </li>)}</ul>
  </section>;
}
function Settings({data,client,base,operate,busy,platform}){
  const [preview,setPreview]=useState(null);
  const r=data.reseller,d=data.domain;
  const brand=preview??data.brand;
  const call=(method,url,body,confirm)=>operate(async()=>{
    if(body instanceof FormData)await client[method](url,body,{headers:{"Content-Type":"multipart/form-data"}});
    else await client[method](url,...(body===undefined?[]:[body]));
    if(url.endsWith("/branding")||url.includes("/branding/assets"))window.dispatchEvent(new Event("sna:brand-updated"));
  },confirm);
  return <>
    <Form key={r.updated_at} title="Brand identity" fields={brandFields} initial={r} disabled={busy}
      submit={body=>call("put",base+"/branding",body)}>
      <button className={`${button} w-fit`} type="button" onClick={e=>{
        const data=Object.fromEntries(new FormData(e.currentTarget.form));
        setPreview({...brand,...data,primary_color:/^#[a-f0-9]{6}$/i.test(data.primary_color)?data.primary_color:null});
      }}>Preview colors and name</button>
      <button className={`${button} w-fit`} type="button"
        onClick={()=>{setPreview(null);call("put",base+"/branding",{display_name:r.legal_name},"Reset optional branding settings?");}}>Reset optional branding</button>
    </Form>
    <section className={panel} aria-label="Brand preview">
      <div className="flex items-center gap-2"><span className="size-7 rounded-full border border-line" style={{backgroundColor:brand?.primary_color??"#2459bf"}} />
        {brandAsset(brand,"logo")&&<img alt="" src={brandAsset(brand,"logo")} className="size-10 object-contain" />} <strong>{brand?.display_name||r.display_name}</strong>
      </div>
      <p className="text-sm text-muted">{brand?.welcome}</p>
      <Link className="text-accent" to={`/r/${r.slug}/login`}>Open customer sign-in</Link>
    </section>
    <section className={panel}><h2 className="font-semibold">Brand images</h2>
      {["logo","dark-logo","favicon"].map(kind=><form key={kind} className="mt-2 flex flex-wrap items-center gap-2" onSubmit={e=>{
        e.preventDefault();call("put",base+"/branding/assets/"+kind,new FormData(e.currentTarget));}}>
        <label className="grid flex-1 gap-1 text-sm">{kind}<input className="max-w-full" type="file" name="asset" accept="image/png" required /></label>
        <button type="submit" className={button} disabled={busy}>Upload PNG</button>
        {data.brand?.assets.includes(kind)&&<button type="button" className={button} disabled={busy}
          onClick={()=>call("delete",base+"/branding/assets/"+kind,undefined,"Remove this image?")}>Remove</button>}
      </form>)}
    </section>
    <Form title="Custom domain" fields={[["hostname","Public hostname"]]} initial={d??{}} key={d?.hostname||"domain"} disabled={busy}
      label="Save and issue challenge" submit={body=>call("put",base+"/domain",body,d?"Replace the existing domain challenge?":null)}>
      {d&&<div className="space-y-2 text-sm"><p>Status {d.status}</p>
        {d.status==="pending"&&<><p>Add a DNS TXT record at <code className="break-all">_sna-fleet-verification.{d.hostname}</code> with this value.</p>
          <code className="block break-all">sna-fleet={d.challenge}</code>
          <button type="button" className={button} disabled={busy} onClick={()=>call("post",base+"/domain/verify",{})}>Verify DNS ownership</button></>}
        <button type="button" className={button} disabled={busy} onClick={()=>call("delete",base+"/domain",undefined,"Remove this domain and its verification?")}>Remove domain</button>
        {platform&&d.status!=="disabled"&&<button type="button" className={`${button} ms-2`} disabled={busy}
          onClick={()=>call("patch",base+"/domain/revoke",{},"Revoke this domain?")}>Revoke</button>}
      </div>}
    </Form>
  </>;
}

export default function ResellerWorkspace({platform=false,onboard=false}){
  const {session}=useAuth();
  const {id}=useParams();
  const {pathname}=useLocation();
  const client=platform?platformApi:resellerApi;
  const base=platform?id?`/platform/resellers/${id}`:"/platform/resellers":"/reseller";
  const list=platform&&!id;
  const customers=!platform&&pathname==="/reseller/customers";
  const customer=!platform&&id&&!onboard;
  const inventory=!platform&&pathname==="/reseller/inventory";
  const settings=!platform&&pathname==="/reseller/settings";
  const [search,setSearch]=useState("");
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("");
  const [version,setVersion]=useState(0);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [manual,setManual]=useState(null);
  const [history,setHistory]=useState(null);
  const detailUrl=list||customers||customer||inventory||onboard?null:platform?base:base+"/dashboard";
  const resourceUrl=list?`${base}?q=${encodeURIComponent(query)}&status=${filter}`:
    customers?`${base}/customers?q=${encodeURIComponent(query)}`:
    customer?`${base}/customers/${id}`:inventory?`${base}/inventory`:detailUrl;
  const main=useResource(client,resourceUrl,version);
  const inv=useResource(client,platform&&id?base+"/inventory":inventory?base+"/customers":null,version);
  const customerInvite=useResource(client,customer?`${base}/customers/${id}/invitations/status`:null,version);
  const operate=async(work,confirm)=>{
    if(busy||(confirm&&!window.confirm(confirm)))return;
    setBusy(true);setError("");setNotice("");
    try {const result=await work();if(result?.invitation)setManual(result.invitation);setNotice("Changes saved.");setVersion(n=>n+1);}
    catch(error){setError(errorText(error));}
    finally{setBusy(false);}
  };
  const listed=main?.data?.items??[];
  const data=main?.data;
  const content=<main className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6">
    <PageHeader title={list?"Resellers":customers?"Reseller customers":customer?"Customer details":inventory?"Reseller GPS inventory":settings?"Brand & domain":platform?"Reseller details":"Reseller dashboard"} />
    {error&&<StateNotice error>{error}</StateNotice>}{notice&&<p role="status">{notice}</p>}
    {manual&&<ManualInvitation key={manual.id} invitation={manual} />}
    {main?.error&&<StateNotice error>{main.error}</StateNotice>}
    {!main&&resourceUrl&&<StateNotice loading>Loading…</StateNotice>}
    {list&&<Form title="Create reseller" fields={[["slug","Reseller slug"],...orgFields,["admin_name","Administrator name"],["admin_email","Administrator email"]]}
      disabled={busy} label="Create reseller" submit={({admin_name,admin_email,...org})=>operate(async()=>
        (await client.post(base,{...org,administrator:{full_name:admin_name,email:admin_email}})).data)} />}
    {(list||customers)&&<section className={panel}>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setQuery(search);}}>
        <label className="grid grow gap-1 text-sm">Search<input className={field} value={search} onChange={e=>setSearch(e.target.value)} /></label>
        {list&&<label className="grid gap-1 text-sm">Status<select className={button} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>}
        <button className={button}>Search</button>
      </form>
      {!listed.length&&main?.data&&<p className="mt-2 text-muted">No matching records.</p>}
      <ul className="mt-3 divide-y divide-line">{listed.map(row=><li key={row.id} className="flex flex-wrap gap-2 py-2 text-sm">
        <Link className="grow font-medium text-accent" to={`${list?base:base+"/customers"}/${row.id}`}>{row.display_name??row.name}</Link>
        <span>{row.customer_type??`${row.customers} customers · ${row.devices} devices`}</span><span>{row.status}</span>
      </li>)}</ul>
    </section>}
    {customer&&data&&<section className={panel}>
      <h2 className="text-lg font-semibold">{data.name}</h2>
      <p className="text-sm text-muted">{data.slug} · {data.customer_type} · {data.status}</p>
      <p className="text-sm">{data.email||"No contact email"} · {data.phone||"No phone"}</p>
      <p className="mt-2 text-sm">Administrator invitation {customerInvite?.data?.invitation?.state??"unavailable"}
        {" · "}{statusLabel(customerInvite?.data?.invitation?.deliveryStatus)}</p>
      <p className="text-sm text-muted">Expires {date(customerInvite?.data?.invitation?.expiresAt)}</p>
      <button className={button} type="button" disabled={busy||!customerInvite?.data?.invitation?.canResend}
        onClick={()=>operate(async()=>(await client.post(`${base}/customers/${id}/invitations/reissue`,{})).data,"Resend the initial administrator invitation?")}>Resend invitation</button>
      <button className={`${button} ms-2`} type="button" disabled={busy}
        onClick={()=>operate(()=>client.patch(`${base}/customers/${id}/status`,{status:data.status==="active"?"suspended":"active"}),"Change customer access status?")}>
        {data.status==="active"?"Suspend customer":"Reactivate customer"}</button>
    </section>}
    {detailUrl&&data&&<>
      <Metrics data={data} />
      {platform&&<Form key={data.reseller.updated_at} title="Organization" fields={orgFields.filter(([key])=>key!=="display_name")}
        initial={data.reseller} disabled={busy} submit={body=>operate(()=>client.patch(base,{...body,status:data.reseller.status}))}>
        <p className="text-sm">{data.reseller.status} · {data.reseller.slug}</p>
        <button type="button" className={`${button} w-fit`} onClick={()=>operate(()=>client.patch(base,{...data.reseller,
          status:data.reseller.status==="active"?"suspended":"active"}),"Change reseller administrative access? Customer telemetry and access will continue.")}>
          {data.reseller.status==="active"?"Suspend reseller":"Reactivate reseller"}</button>
      </Form>}
      {platform&&<><Form title="Invite administrator" fields={adminFields} label="Create invitation" disabled={busy}
        submit={body=>operate(async()=>(await client.post(base+"/admins",body)).data)} />
        <section className={panel}><h2 className="font-semibold">Administrators</h2><ul className="divide-y divide-line">
          {data.emailAvailability!=="ready"&&<li className="py-2 text-sm text-muted">Email {statusLabel(data.emailAvailability)}</li>}
          {data.admins.map(a=><li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 grow break-words">{a.full_name} · {a.email} · {a.activated?"Activated":statusLabel(a.delivery_status)}</span>
            {!a.activated&&<button type="button" className={button} disabled={busy||!a.enabled} onClick={()=>operate(async()=>
              (await client.post(`${base}/admins/${a.id}/invitation`,{})).data,"Resend this invitation?")}>Resend</button>}
            <button type="button" className={button} disabled={busy} onClick={()=>operate(()=>client.patch(`${base}/admins/${a.id}`,{enabled:!a.enabled}),"Change administrator access?")}>{a.enabled?"Disable":"Enable"}</button>
          </li>)}</ul></section>
        <section className={panel}><h2 className="font-semibold">Inventory assignment</h2>
          {inv?.error&&<StateNotice error>{inv.error}</StateNotice>}
          <ul className="divide-y divide-line">{inv?.data?.items.map(d=><li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="grow">{d.device_name||d.unique_identifier||`Device ${d.id}`} · {d.lifecycle_status}</span>
            {d.lifecycle_status==="available"&&<button className={button} type="button" disabled={busy || (!d.reseller_id && !d.allocation_ready)} onClick={()=>operate(()=>
              client.put(`${base}/inventory/${d.id}`,{assign:d.reseller_id==null}),"Change reseller inventory assignment?")}>{d.reseller_id?"Return to platform":"Assign to reseller"}</button>}
          </li>)}</ul>
        </section>
      </>}
      {(platform||settings)&&<Settings data={data} client={client} base={base} operate={operate} busy={busy} platform={platform} />}
      <Audit rows={data.audit} />
    </>}
    {inventory&&main?.data&&<section className={panel}>
      {!listed.length&&<p className="text-muted">No assigned devices.</p>}
      <ul className="divide-y divide-line">{listed.map(d=><li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <span className="grow">{d.device_name||d.unique_identifier||`Device ${d.id}`} · {d.lifecycle_status}{d.customer?` · ${d.customer}`:""}</span>
        <button className={button} type="button" onClick={()=>operate(async()=>{setHistory((await client.get(`${base}/inventory/${d.id}/history`)).data.items);})}>History</button>
        {!d.allocation_ready&&d.lifecycle_status==="available"&&<span className="text-muted">Platform provisioning required</span>}
        {d.lifecycle_status==="available"&&d.allocation_ready&&<form className="flex flex-wrap gap-2" onSubmit={e=>{
          e.preventDefault();const tenantId=new FormData(e.currentTarget).get("tenantId");
          void operate(()=>client.post(`${base}/inventory/${d.id}/allocation`,{tenantId}),"Allocate this available device?");
        }}>
          <select name="tenantId" aria-label="Customer" className={button} required><option value="">Select customer</option>
            {inv?.data?.items.filter(t=>t.status==="active").map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button className={button} disabled={busy}>Allocate</button>
        </form>}
      </li>)}</ul>
      {history&&<section className="mt-4"><h2 className="font-semibold">Selected device history</h2>
        {!history.length?<p className="text-muted">No customer allocation history.</p>:<ul>{history.map((row,i)=><li key={i}>{row.action} · {date(row.created_at)}</li>)}</ul>}
      </section>}
    </section>}
  </main>;
  if(platform)return content;
  return <AppShell reseller title="Reseller workspace" workspace={session?.profile?.display_name??session?.profile?.slug} groups={groups}>
    {onboard?<CompanyOnboarding reseller />:content}
  </AppShell>;
}
