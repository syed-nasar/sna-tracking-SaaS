import { useState } from "react";
import {
  buttonClass, Input, Lookup, Pagination, panelClass, primaryClass, ReadState, Select,
} from "../platform/connectivity/connectivity-ui";
import { dataFrom, money, platformRoot, title, useBillingGet } from "./billing-data";

export { Input, Pagination, ReadState, Select };

export function Panel({ children, className = "" }) {
  return <section className={`${panelClass} ${className}`}>{children}</section>;
}

export function Button({ primary, className = "", ...props }) {
  return <button className={`${primary ? primaryClass : buttonClass} ${className}`} {...props} />;
}

export function Feedback({ error,notice }) {
  return <>
    {error && <p role="alert" className="break-words text-red-300">{error}</p>}
    {notice && <p role="status" className="text-emerald-300">{notice}</p>}
  </>;
}

export function TenantLookup(props) {
  return <Lookup apiRoot={platformRoot} path="/tenants" name="tenantId" label="Customer"
    formatOption={(tenant) => `${tenant.name}${tenant.customer_type ? ` · ${tenant.customer_type}` : ""}`} {...props} />;
}

export function VersionLookup({ initialPlan,revision,busy }) {
  const [plan,setPlan] = useState(initialPlan || null);
  const [offset,setOffset] = useState(0);
  const { data,error } = useBillingGet(plan ? `/plans/${plan.id}/versions` : null,{ offset },revision);
  return <div className="space-y-2">
    <Lookup apiRoot={platformRoot} path="/plans" params={{ archived:"false" }} label="SaaS plan"
      value={initialPlan?.id} currentLabel={initialPlan?.name} disabled={busy}
      onChange={(next) => { setPlan(next); setOffset(0); }} required />
    {plan && <>
      <ReadState data={data} error={error} empty={data?.data.length===0} emptyText="Publish a price before assigning this plan." />
      <Select key={`${plan.id}-${offset}`} name="planVersionId" label="Published price"
        choices={(data?.data ?? []).map((version) => [version.id,
          `${version.effective_on} · ${money(version.base_price,version.currency)} / ${version.interval_months} mo`])}
        blank="Select published price" disabled={busy} required />
      {data && (offset > 0 || data.pagination.hasMore) && <Pagination result={data} offset={offset} onChange={setOffset} />}
    </>}
  </div>;
}

export function DataList({ values }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">
    {values.map(([label,value]) => <div key={label} className="min-w-0">
      <dt className="text-slate-400">{label}</dt><dd className="break-words">{value ?? "—"}</dd>
    </div>)}
  </dl>;
}

export function History({ resource,id,revision }) {
  const [offset,setOffset] = useState(0);
  const { data,error } = useBillingGet(`/history/${resource}/${id}`,{ offset },revision);
  return <section className="space-y-2 border-t border-white/10 pt-4">
    <h3 className="font-semibold">Audit history</h3>
    <ReadState data={data} error={error} empty={data?.data.length===0} />
    <ul className="divide-y divide-white/10 text-sm">
      {data?.data.map((entry) => <li className="space-y-1 break-words py-2" key={entry.id}>
        <p className="capitalize">{title(entry.action)}</p>
        <p className="text-slate-400">{new Date(entry.created_at).toLocaleString()} · {entry.actor_name}</p>
        <p className="text-slate-400">{Object.entries(entry.details).map(([key,value]) =>
          `${key}: ${Array.isArray(value) ? value.join(", ") : value ?? "—"}`).join(" · ")}</p>
      </li>)}
    </ul>
    <Pagination result={data} offset={offset} onChange={setOffset} />
  </section>;
}

export function ReasonForm({ label, busy,onSave }) {
  const [confirm,setConfirm] = useState(false);
  if (!confirm) return <Button disabled={busy} onClick={() => setConfirm(true)}>{label}</Button>;
  return <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
    event.preventDefault();
    onSave(dataFrom(event),() => setConfirm(false));
  }}>
    <Input name="reason" label={`Reason to ${label.toLowerCase()}`} required maxLength={500} />
    <Button primary disabled={busy}>Confirm {label.toLowerCase()}</Button>
    <Button type="button" onClick={() => setConfirm(false)}>Cancel</Button>
  </form>;
}
