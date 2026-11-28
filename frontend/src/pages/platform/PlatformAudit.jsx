import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/WorkspaceUi";
import { date,field,label,panel,usePlatformRead } from "./platform-operations-data";
import { Filter, ReadState, Table } from "./PlatformOperationsUi";

export default function PlatformAudit() {
  const [initial]=useSearchParams();
  const [filters,setFilters]=useState(()=>initial.toString());
  const [cursors,setCursors]=useState([null]);
  const params=new URLSearchParams(filters);
  if(cursors.at(-1)) params.set("cursor",cursors.at(-1));
  const result=usePlatformRead("/platform/ops/audit",params.toString());
  return <main className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-6">
    <PageHeader title="Audit Logs" description="Administrative activity. Date filters use UTC." />
    <section className={panel}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{
        event.preventDefault();
        setFilters(new URLSearchParams(new FormData(event.currentTarget)).toString());
        setCursors([null]);
      }} onReset={()=>{setFilters("");setCursors([null]);}}>
        {[["from","From"],["to","Through"]].map(([name,title])=><label key={name} className="grid gap-1 text-sm">
          {title}<input type="date" name={name} className={field}/></label>)}
        <Filter name="domain" title="Domain" values={["platform","customers","invitations","resellers","gps","provisioning","sim","subscriptions","billing"]}/>
        <Filter name="actorType" title="Actor type" values={["platform","reseller","tenant","unknown"]}/>
        {[["action","Action"],["resource","Resource type"],["resourceId","Resource ID"],["tenantId","Customer ID"],["resellerId","Reseller ID"]]
          .map(([name,title])=><label className="grid gap-1 text-sm" key={name}>{title}
            <input className={field} name={name} defaultValue={initial.get(name)??""}
              maxLength={name.endsWith("Id")?19:100} inputMode={name.endsWith("Id")?"numeric":"text"}/></label>)}
        <button className="control">Apply filters</button><button type="reset" className="control">Clear</button>
      </form>
      <ReadState result={result}>{({data,nextCursor})=><>
        <Table rows={data} empty="No matching audit events." columns={[
          ["Time",e=>date(e.at)],["Event",e=>e.id],["Domain",e=>label(e.domain)],["Action",e=>e.action],
          ["Resource",e=>`${label(e.resource)} ${e.resource_id??""}`],
          ["Customer / reseller",e=>[e.tenant_id,e.reseller_id].map(v=>v??"—").join(" / ")],
          ["Initiator",e=>`${label(e.actor_type)} ${e.actor_id??""}`],["Executor",e=>label(e.executor??"unknown")],
          ["Outcome",e=>label(e.outcome)],
        ]}/>
        <div className="flex gap-2">
          <button className="control" disabled={cursors.length===1} onClick={()=>setCursors(value=>value.slice(0,-1))}>Previous</button>
          <button className="control" disabled={!nextCursor} onClick={()=>setCursors(value=>[...value,nextCursor])}>Next</button>
        </div>
      </>}</ReadState>
    </section>
  </main>;
}
