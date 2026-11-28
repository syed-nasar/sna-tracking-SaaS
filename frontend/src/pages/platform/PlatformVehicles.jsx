import { Link,useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/WorkspaceUi";
import { Filter,Paging,ReadState,Table } from "./PlatformOperationsUi";
import { field,label,panel,usePlatformRead } from "./platform-operations-data";

const filters=[
  ["status","Vehicle lifecycle",["active","inactive"]],
  ["type","Customer type",["personal","business"]],
  ["ownership","Ownership",[["direct","Direct SNA"],["reseller","Reseller-owned"]]],
  ["gps","GPS history and installation",[["installed","Installed GPS"],["uninstalled","Without GPS"],
    ["unverified","Installed GPS without verified history"]]],
];
const columns=[
  ["Vehicle",r=>r.name],["Registration",r=>r.registration_number??"Unavailable"],
  ["Customer",r=><Link className="text-accent" to={`/platform/tenants/${r.tenant_id}`}>{r.customer_name}</Link>],
  ["Customer type",r=>label(r.customer_type)],
  ["Ownership",r=>r.reseller_id?
    <Link className="text-accent" to={`/platform/resellers/${r.reseller_id}`}>{r.reseller_name}</Link>:"Direct SNA"],
  ["Lifecycle",r=>label(r.status)],["GPS",r=>r.gps_installed?"Installed":"Uninstalled"],
  ["Trusted history",r=>r.trusted_history?"Available":"Unavailable"],
];

export default function PlatformVehicles() {
  const [params,setParams]=useSearchParams();
  const result=usePlatformRead("/platform/ops/vehicles",params.toString(),250);
  function set(name,value) {
    setParams(previous=>{
      const next=new URLSearchParams(previous);
      if(name!=="offset") next.delete("offset");
      if(name==="ownership"&&value==="direct") next.delete("resellerId");
      if(value) next.set(name,value); else next.delete(name);
      return next;
    },{replace:true});
  }
  return <main className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
    <PageHeader title="Vehicle Directory" />
    <section className={panel}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">Search vehicles
          <input className={field} maxLength={150} placeholder="Name, registration or customer" value={params.get("q")??""}
            onChange={e=>set("q",e.target.value)}/></label>
        {filters.map(([name,title,values])=><Filter key={name} name={name} title={title} values={values}
          value={params.get(name)} onChange={e=>set(name,e.target.value)}/>)}
        {params.get("ownership")!=="direct"&&<label className="grid gap-1 text-sm">Reseller ID
          <input className={field} inputMode="numeric" maxLength={19} value={params.get("resellerId")??""}
            onChange={e=>set("resellerId",e.target.value.replace(/[^0-9]/g,""))}/></label>}
        <button className="control" onClick={()=>setParams({},{replace:true})}>Clear filters</button>
      </div>
      <ReadState result={result}>{({data,pagination})=><>
        <p role="status" className="text-sm text-muted">{pagination.total} matching vehicles</p>
        <Table columns={columns} rows={data} empty="No vehicles match these filters." />
        <Paging pagination={pagination} change={offset=>set("offset",offset)} />
      </>}</ReadState>
    </section>
  </main>;
}
