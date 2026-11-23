import { useState } from "react";
import { Button,DataList,Feedback,History,Input,Pagination,Panel,ReadState,Select } from "./BillingUi";
import { dataFrom,money,useBillingGet,useBillingWrite,utcDay } from "./billing-data";

function PlanDetails({ plan,onChanged }) {
  const [revision,setRevision] = useState(0);
  const [offset,setOffset] = useState(0);
  const [editing,setEditing] = useState(false);
  const [publishing,setPublishing] = useState(false);
  const root = `/plans/${plan.id}`;
  const result = useBillingGet(root+"/versions",{ offset },revision);
  const write = useBillingWrite(() => { setRevision((value) => value+1); onChanged(); });
  return <Panel>
    <h2 className="text-lg font-semibold">{plan.name}</h2>
    <DataList values={[["Plan code",plan.code],["Customers",plan.audience],["Status",plan.archived_at ? "Archived" : "Active"],["Description",plan.description]]} />
    <Feedback {...write} />
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setEditing((value) => !value)}>Edit plan</Button>
      <Button disabled={write.busy} onClick={() => write.submit("patch",root,{ archived:!plan.archived_at })}>
        {plan.archived_at ? "Unarchive plan" : "Archive plan"}
      </Button>
      <Button disabled={Boolean(plan.archived_at)} onClick={() => setPublishing((value) => !value)}>Publish price</Button>
    </div>
    {editing && <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); void write.submit("patch",root,dataFrom(event),() => setEditing(false));
    }}>
      <Input name="name" label="Name" value={plan.name} required maxLength={150} />
      <Input name="description" label="Description" value={plan.description} maxLength={1000} />
      <Button primary disabled={write.busy}>Save plan details</Button>
    </form>}
    {publishing && !plan.archived_at && <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={(event) => {
      event.preventDefault();
      const value = dataFrom(event);
      value.features = value.features.split(",").map((feature) => feature.trim()).filter(Boolean);
      void write.submit("post",root+"/versions",value,() => { setPublishing(false); setOffset(0); });
    }}>
      <h3 className="font-semibold">New effective-dated price</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="effectiveOn" label="Effective date (UTC)" type="date" value={utcDay()} required />
        <Input name="intervalMonths" label="Billing interval (months)" type="number" min="1" max="60" value="1" required />
        <Input name="currency" label="Currency code" value="PKR" maxLength={3} required />
        <Input name="basePrice" label="Base price" inputMode="decimal" required />
        <Input name="excessPrice" label="Additional device price" inputMode="decimal" required />
        <Input name="includedDevices" label="Included devices" type="number" min="0" value="0" required />
        <Input name="deviceLimit" label="Device limit" type="number" min="1" />
        <Input name="userLimit" label="User limit" type="number" min="1" />
        <Input name="trialDays" label="Trial days" type="number" min="0" max="365" value="0" required />
        <Input name="graceDays" label="Grace days" type="number" min="0" max="365" value="0" required />
        <Input name="paymentDays" label="Default payment days" type="number" min="0" max="365" value="14" required />
        <Input name="features" label="Feature codes, comma separated" maxLength={1000} />
      </div>
      <Button primary disabled={write.busy}>Publish version</Button>
    </form>}
    <h3 className="font-semibold">Published versions</h3>
    <ReadState {...result} empty={result.data?.data.length===0} />
    <ul className="divide-y divide-white/10 text-sm">
      {result.data?.data.map((version) => <li className="space-y-1 break-words py-2" key={version.id}>
        <p>{version.effective_on} · {money(version.base_price,version.currency)} / {version.interval_months} month(s)</p>
        <p className="text-slate-400">{version.included_devices} included · {money(version.excess_price,version.currency)} per extra device</p>
      </li>)}
    </ul>
    <Pagination result={result.data} offset={offset} onChange={setOffset} />
    <History resource="plan" id={plan.id} revision={revision} />
  </Panel>;
}

export default function BillingPlans() {
  const [revision,setRevision] = useState(0);
  const [query,setQuery] = useState({ offset:0 });
  const [selected,setSelected] = useState(null);
  const [creating,setCreating] = useState(false);
  const refresh = () => setRevision((value) => value+1);
  const result = useBillingGet("/plans",query,revision);
  const write = useBillingWrite(refresh);
  const plan = result.data?.data.find((item) => item.id===selected);
  return <div className="grid items-start gap-5 xl:grid-cols-2">
    <Panel>
      <div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-semibold">Subscription plans</h2>
        <Button primary onClick={() => setCreating(true)}>New plan</Button></div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault(); setQuery({ ...dataFrom(event),offset:0 });
      }}>
        <Input name="q" label="Search plans" maxLength={150} />
        <Select name="archived" label="Plan status" choices={[["false","Active"],["true","Archived"]]} blank="All statuses" />
        <Button>Search</Button>
      </form>
      <Feedback {...write} />
      {creating && <form className="space-y-3 border-y border-white/10 py-4" onSubmit={(event) => {
        event.preventDefault();
        void write.submit("post","/plans",dataFrom(event),(record) => {
          setCreating(false);setSelected(record.id);setQuery({ offset:0 });
        });
      }}>
        <Input name="code" label="Plan code" maxLength={50} required />
        <Input name="name" label="Plan name" maxLength={150} required />
        <Input name="description" label="Description" maxLength={1000} />
        <Select name="audience" label="Customer type" choices={[["both","Personal and Business"],["personal","Personal"],["business","Business"]]} />
        <div className="flex gap-2"><Button primary disabled={write.busy}>Create plan</Button>
          <Button type="button" onClick={() => setCreating(false)}>Cancel</Button></div>
      </form>}
      <ReadState {...result} empty={result.data?.data.length===0} />
      <ul className="divide-y divide-white/10">
        {result.data?.data.map((record) => <li key={record.id} className="py-2">
          <button className="w-full break-words text-left font-semibold hover:text-blue-300"
            onClick={() => { setSelected(record.id);setCreating(false); }}>{record.name}</button>
          <p className="text-sm text-slate-400">{record.code} · {record.audience}{record.archived_at ? " · Archived" : ""}</p>
        </li>)}
      </ul>
      <Pagination result={result.data} offset={query.offset} onChange={(offset) => setQuery({ ...query,offset })} />
    </Panel>
    {plan && <PlanDetails key={plan.id} plan={plan} onChanged={refresh} />}
  </div>;
}
