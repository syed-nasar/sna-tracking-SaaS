import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/WorkspaceUi";
import { Filter, Paging, ReadState, Table } from "./PlatformOperationsUi";
import { date, field, label, panel, usePlatformRead } from "./platform-operations-data";

export default function PlatformCustomers() {
  const [params,setParams]=useSearchParams();
  const result=usePlatformRead("/platform/tenants",params.toString(),250);
  const set=(key,value)=>setParams(previous=>{
    const next=new URLSearchParams(previous);
    if(key!=="offset") next.delete("offset");
    if(key==="ownership"&&value!=="reseller") next.delete("resellerId");
    if(value) next.set(key,value); else next.delete(key);
    return next;
  },{replace:true});
  const options=[
    ["type","Customer type",["personal","business"]],
    ["status","Account status",["active","suspended","inactive"]],
    ["ownership","Ownership",[["direct","Direct SNA"],["reseller","Reseller-owned"]]],
  ];
  return <main className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
    <PageHeader title="Customers"><Link className="control" to="/platform/tenants/new">Create Customer</Link></PageHeader>
    <section className={panel}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">Search customers
          <input className={field} maxLength={150} placeholder="Name, slug or contact email" value={params.get("q")??""}
            onChange={e=>set("q",e.target.value)} /></label>
        {options.map(([name,title,values])=><Filter key={name} name={name} title={title} values={values}
          value={params.get(name)} onChange={e=>set(name,e.target.value)} />)}
        {params.get("ownership")!=="direct" && <label className="grid gap-1 text-sm">Reseller ID
          <input className={field} inputMode="numeric" maxLength={19} value={params.get("resellerId")??""}
            onChange={e=>set("resellerId",e.target.value.replace(/\D/g,""))} /></label>}
        <button className="control" onClick={()=>setParams({}, {replace:true})}>Clear filters</button>
      </div>
      <ReadState result={result}>{({data,pagination})=><>
        <p className="text-sm text-muted" role="status">{pagination.total} matching customers</p>
        <Table rows={data} empty="No customers match these filters." columns={[
          ["Customer",r=><Link className="text-accent" to={`/platform/tenants/${r.id}`}>{r.name}</Link>],
          ["Slug",r=>r.slug],["Contact",r=>r.email??"Unavailable"],["Type",r=>label(r.customer_type)],
          ["Status",r=>label(r.status)],["Ownership",r=>r.reseller_id?
            <Link className="text-accent" to={`/platform/resellers/${r.reseller_id}`}>{r.reseller_name}</Link>:"Direct SNA"],
          ["Created",r=>date(r.created_at)],
        ]} />
        <Paging pagination={pagination} change={value=>set("offset",value)} />
      </>}</ReadState>
    </section>
  </main>;
}
