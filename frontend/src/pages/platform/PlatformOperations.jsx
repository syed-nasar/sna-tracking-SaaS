import { Link, useSearchParams } from "react-router-dom";
import { PageHeader, StateNotice } from "../../components/WorkspaceUi";
import { Filter, Paging, ReadState, Table } from "./PlatformOperationsUi";
import { date, field, label, panel, usePlatformRead } from "./platform-operations-data";

export default function PlatformOperations() {
  const [params,setParams]=useSearchParams();
  const mail=params.get("queue")==="invitations";
  const result=usePlatformRead("/platform/ops/"+(mail?"invitations":"provisioning"),params.toString(),200);
  const signals=usePlatformRead("/platform/ops/signals");
  function set(key,value) {
    setParams(prev=>{
      const next=new URLSearchParams(prev);
      if(key!=="offset") next.delete("offset");
      if(value) next.set(key,value); else next.delete(key);
      return next;
    },{replace:true});
  }
  const columns=mail?[
    ["Target",r=><Link className="text-accent" to={r.kind==="customer"?
      `/platform/tenants/${r.tenant_id}`:`/platform/resellers/${r.reseller_id}`}>{r.target}</Link>],
    ["Invitation",r=>`${label(r.kind)} #${r.id}`],["Delivery",r=>label(r.status)],
    ["Attempts",r=>r.attempts],["Last update",r=>date(r.updated_at)],
    ["Next delivery",r=>["pending","retry"].includes(r.status)?date(r.available_at):"None"],
    ["Expires",r=>date(r.expires_at)],["Age (minutes)",r=>Math.floor(r.age_seconds/60)],
  ]:[
    ["Tracker",r=><Link className="text-accent" to={`/platform/devices?deviceId=${r.id}`}>
      {r.device_name??r.unique_identifier??`Device #${r.id}`}</Link>],
    ["Lifecycle",r=>label(r.lifecycle_status)],["Provisioning",r=>label(r.provisioning_status)],
    ["Ownership",r=>r.reseller_name??"Direct SNA"],["Customer",r=>r.customer_name??"Unallocated"],
    ["Last attempt",r=>date(r.last_attempt_at)],["Next scheduled",r=>date(r.next_retry_at)],
    ["Outcome",r=>label(r.outcome_code)],["Recovery",r=>r.stale_claim?"Expired claim":r.can_retry?"Retry available":"—"],
    ["Age (minutes)",r=>Math.floor(r.age_seconds/60)],
  ];
  return <main className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
    <PageHeader title="Operations Center"><button className="control" onClick={()=>{result.refresh();signals.refresh();}}>Refresh</button></PageHeader>
    <section className={panel}>
      <div className="flex flex-wrap gap-2">
        <Link className="control" to="/platform/operations" aria-current={!mail?"page":undefined}>GPS provisioning</Link>
        <Link className="control" to="?queue=invitations" aria-current={mail?"page":undefined}>Invitation delivery</Link>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Filter title="Status" value={params.get("status")} onChange={e=>set("status",e.target.value)}
          values={mail?["pending","retry","sending","failed","uncertain"]:["pending","processing","retry","failed","conflict","legacy","provisioned"]}
          blank={mail?"All open deliveries":"All provisioning work"} />
        {mail?<Filter title="Invitation type" value={params.get("kind")} onChange={e=>set("kind",e.target.value)} values={["customer","reseller"]} />:
          <><label className="grid gap-1 text-sm">Tracker search<input className={field} maxLength={150}
            value={params.get("q")??""} onChange={e=>set("q",e.target.value)} /></label>
          <label className="text-sm"><input type="checkbox" checked={params.get("stale")==="yes"}
            onChange={e=>set("stale",e.target.checked?"yes":"")} /> Expired claims only</label></>}
      </div>
      <ReadState result={result}>{({data,pagination})=><>
        <Table rows={data} rowKey={r=>mail?`${r.kind}:${r.id}`:r.id}
          columns={columns} empty="No matching operational records." />
        <Paging pagination={pagination} change={value=>set("offset",value)} />
      </>}</ReadState>
    </section>
    <section className={panel}>
      <h2 className="font-semibold">Operational signals</h2>
      <ReadState result={signals}>{data=><ul className="space-y-2">
        <li>Oldest outstanding provisioning request {data.gps?.data?
          (data.gps.data.oldest_work_at?date(data.gps.data.oldest_work_at):"None"):"Unavailable"}</li>
        <li><Link className="text-accent" to="/platform/connectivity">SIM expiry</Link>{" "}
          {data.sim.data?`${data.sim.data.expired} expired, ${data.sim.data.expiringSoon} expiring soon`:"Unavailable"}</li>
        <li><Link className="text-accent" to="/platform/alerts">Alerts, geofences and email</Link>{" "}
          {data.alerts.data?`${data.alerts.data.pending} pending, ${data.alerts.data.retrying} retrying, ${data.alerts.data.failed} failed;
            ${data.alerts.data.geofences.failed??0} geofence sync failures and ${data.alerts.data.alert_email.failed??0} email failures`:"Unavailable"}</li>
        <li><Link className="text-accent" to="/platform/billing">Billing</Link>{" "}
          {data.billing.data?`${data.billing.data.upcoming} subscriptions with upcoming billing`:"Unavailable"}</li>
      </ul>}</ReadState>
      {mail&&<StateNotice>Uncertain deliveries require review from the invitation’s existing recovery controls.</StateNotice>}
    </section>
  </main>;
}
