import { useState } from "react";
import { Button,DataList,Feedback,History,Input,Pagination,Panel,ReadState,Select,TenantLookup,VersionLookup } from "./BillingUi";
import { dataFrom,money,title,useBillingGet,useBillingWrite,utcDay } from "./billing-data";

const states = ["draft","trialing","active","past_due","suspended","cancelled","expired"];
const actions = {
  draft:["activate","cancel"],trialing:["suspend","cancel","expire"],active:["suspend","cancel","expire"],
  past_due:["suspend","cancel","expire"],suspended:["reactivate","cancel","expire"],cancelled:["reactivate"],expired:["reactivate"],
};
const modes = [["manual","Manual"],["automatic","Automatic schedule"]];

function TermsInputs({ revision,busy }) {
  return <>
    <VersionLookup revision={revision} busy={busy} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Input name="baseOverride" label="Negotiated base price" inputMode="decimal" />
      <Input name="excessOverride" label="Negotiated additional device price" inputMode="decimal" />
      <Input name="reason" label="Override approval reason" maxLength={500} />
    </div>
  </>;
}

function SubscriptionDetails({ id,onChanged,onInvoice }) {
  const [revision,setRevision] = useState(0);
  const [editingTerms,setEditingTerms] = useState(false);
  const path = `/subscriptions/${id}`;
  const { data:sub,error } = useBillingGet(path,undefined,revision);
  const write = useBillingWrite(() => { setRevision((value) => value+1); onChanged(); });
  return <Panel>
    <h2 className="break-words text-lg font-semibold">{sub?.tenant_name || "Subscription details"}</h2>
    <ReadState data={sub} error={error} />
    <Feedback {...write} />
    {sub && <>
      <DataList values={[["Plan",sub.plan_name],["Status",title(sub.effective_status)],["Start (UTC)",sub.starts_on],
        ["Next billing date (UTC)",sub.next_bill_on],["Trial ends",sub.trial_ends_on],["Grace through",sub.grace_until],
        ["Base price",money(sub.effective_base,sub.currency)],["Extra device",money(sub.effective_excess,sub.currency)],
        ["Device / user limits",`${sub.device_limit ?? "Unspecified"} / ${sub.user_limit ?? "Unspecified"}`],
        ["Billing warning",title(sub.entitlements.warning)]]} />
      {actions[sub.status].length > 0 && <form key={sub.status} className="space-y-3 border-t border-line pt-4" onSubmit={(event) => {
        event.preventDefault(); void write.submit("patch",path+"/status",dataFrom(event));
      }}>
        <Select name="action" label="Lifecycle action" choices={actions[sub.status].map((action) => [action,title(action)])} blank="Select action" required />
        <Input name="reason" label="Lifecycle reason" required maxLength={500} />
        <Button disabled={write.busy}>Apply lifecycle change</Button>
      </form>}
      <form key={`${sub.renewal_mode}-${sub.notice_days}`} className="grid items-end gap-3 border-t border-line pt-4 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault(); void write.submit("patch",path+"/schedule",dataFrom(event));
      }}>
        <Select name="renewalMode" label="Renewal mode" choices={modes} value={sub.renewal_mode} />
        <Input name="noticeDays" label="Renewal notice days" type="number" min="0" max="365" value={sub.notice_days} required />
        <Button disabled={write.busy}>Save renewal schedule</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {["draft","trialing","active","past_due","suspended"].includes(sub.status) &&
          <Button onClick={() => setEditingTerms((value) => !value)}>Change plan or pricing</Button>}
        {["trialing","active","past_due"].includes(sub.status) && sub.next_bill_on <= utcDay() &&
          <Button primary disabled={write.busy} onClick={() => write.submit("post",path+"/invoices",
            { periodStart:sub.next_bill_on },(invoice) => onInvoice(invoice.id))}>Generate due invoice</Button>}
      </div>
      {editingTerms && <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void write.submit("post",path+"/terms",{ ...dataFrom(event),effectiveOn:sub.next_bill_on },() => setEditingTerms(false));
      }}>
        <p className="text-sm text-muted">Changes take effect at the next unbilled period start, {sub.next_bill_on} UTC.</p>
        <TermsInputs revision={revision} busy={write.busy} />
        <Button primary disabled={write.busy}>Approve new terms</Button>
      </form>}
      <h3 className="font-semibold">Terms history</h3>
      <ul className="space-y-2 text-sm">
        {sub.terms.map((term) => <li key={term.id} className="break-words">
          {term.effective_on} · {term.plan_name} · Version #{term.plan_version_id}
          {term.override_reason && <p className="text-muted">
            Approved by #{term.approved_by} · {term.override_reason}
            {term.base_override != null && ` · Base ${money(term.base_override,term.currency)}`}
            {term.excess_override != null && ` · Extra device ${money(term.excess_override,term.currency)}`}
          </p>}
        </li>)}
      </ul>
      <History resource="subscription" id={sub.id} revision={revision} />
    </>}
  </Panel>;
}

export default function BillingSubscriptions({ onInvoice,initialTenant }) {
  const [revision,setRevision] = useState(0);
  const [query,setQuery] = useState({ tenantId:initialTenant?.id,offset:0 });
  const [selected,setSelected] = useState(null);
  const [creating,setCreating] = useState(false);
  const [batch,setBatch] = useState(null);
  const refresh = () => setRevision((value) => value+1);
  const write = useBillingWrite(refresh);
  const result = useBillingGet("/subscriptions",query,revision);
  return <div className="grid items-start gap-5 xl:grid-cols-2">
    <Panel>
      <h2 className="text-lg font-semibold">Customer subscriptions</h2>
      <div className="flex flex-wrap gap-2">
        <Button primary onClick={() => setCreating(true)}>New subscription</Button>
        <Button disabled={write.busy} onClick={() => write.submit("post","/subscriptions/generate-due",{ limit:25 },setBatch)}>
          Generate automatic due drafts
        </Button>
      </div>
      <Feedback {...write} />
      {batch && <p role="status" className="text-sm text-secondary">Drafts processed: {batch.results.length} · Conflicts: {batch.results.filter((row) => row.error).length}</p>}
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault(); setQuery({ ...dataFrom(event),offset:0 });
      }}>
        <TenantLookup value={initialTenant?.id} currentLabel={initialTenant?.name} blank="All customers" />
        <Select name="status" label="Subscription status" choices={states.map((state) => [state,title(state)])} blank="All statuses" />
        <Button>Filter subscriptions</Button>
      </form>
      {creating && <form className="space-y-3 border-y border-line py-4" onSubmit={(event) => {
        event.preventDefault();
        void write.submit("post","/subscriptions",dataFrom(event),(sub) => { setCreating(false); setSelected(sub.id); });
      }}>
        <TenantLookup required />
        <Input name="startsOn" label="Start date (UTC)" type="date" value={utcDay()} required />
        <Select name="renewalMode" label="Renewal mode" choices={modes} />
        <Input name="noticeDays" label="Renewal notice days" type="number" min="0" max="365" value="7" required />
        <TermsInputs revision={revision} busy={write.busy} />
        <div className="flex flex-wrap gap-2"><Button primary disabled={write.busy}>Create subscription draft</Button>
          <Button type="button" onClick={() => setCreating(false)}>Cancel</Button></div>
      </form>}
      <ReadState {...result} empty={result.data?.data.length===0} />
      <ul className="divide-y divide-line">
        {result.data?.data.map((row) => <li key={row.id} className="py-2">
          <button className="w-full break-words text-left font-semibold hover:text-accent"
            onClick={() => { setSelected(row.id);setCreating(false); }}>{row.tenant_name} · #{row.id}</button>
          <p className="text-sm text-muted">{row.plan_name} · {title(row.effective_status)} · {row.next_bill_on} UTC</p>
        </li>)}
      </ul>
      <Pagination result={result.data} offset={query.offset} onChange={(offset) => setQuery({ ...query,offset })} />
    </Panel>
    {selected && <SubscriptionDetails key={selected} id={selected} onChanged={refresh} onInvoice={onInvoice} />}
  </div>;
}
