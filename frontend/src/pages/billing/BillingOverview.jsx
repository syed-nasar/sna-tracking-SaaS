import { useState } from "react";
import { Link } from "react-router-dom";
import { Button,DataList,Feedback,Input,Pagination,Panel,ReadState,Select,TenantLookup } from "./BillingUi";
import { dataFrom,money,title,useBillingGet,useBillingWrite,utcDay } from "./billing-data";

export function BillingReport({ onCustomer,compact = false }) {
  const [query,setQuery] = useState({});
  const [customer,setCustomer] = useState(null);
  const result = useBillingGet("/report",query);
  const report = result.data;
  return <Panel>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Billing overview</h2>
      {compact && <Link className="text-sm text-accent" to="/platform/billing">Manage billing</Link>}
    </header>
    {!compact && <form className="space-y-3" onSubmit={(event) => { event.preventDefault();setQuery(dataFrom(event)); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="from" label="Report start (UTC)" type="date" />
        <Input name="to" label="Report end (UTC)" type="date" />
      </div>
      <TenantLookup blank="All customers" onChange={setCustomer} />
      <div className="flex flex-wrap gap-2"><Button>Apply report filters</Button>
        {customer && customer.id===query.tenantId && <Button type="button" onClick={() => onCustomer(customer)}>View customer invoices</Button>}
      </div>
    </form>}
    <ReadState {...result} />
    {report && <>
      <p className="text-sm text-muted">{report.from} to {report.to} UTC · Balances as of now</p>
      <DataList values={[["Active subscriptions",report.active],["Renewals due or upcoming",report.upcoming]]} />
      <div className="overflow-x-auto">
        {report.currencies.length ? <table className="w-full min-w-[510px] text-left text-sm">
          <thead><tr>{["Currency","Invoiced","Recorded payments, net","Outstanding","Overdue invoices"].map((label) =>
            <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{report.currencies.map((row) => <tr key={row.currency} className="border-t border-line">
            <td className="p-2">{row.currency}</td><td className="p-2">{money(row.invoiced,row.currency)}</td>
            <td className="p-2">{money(row.collected,row.currency)}</td><td className="p-2">{money(row.outstanding,row.currency)}</td>
            <td className="p-2">{row.overdue}</td>
          </tr>)}</tbody>
        </table> : <p className="text-sm text-muted">No issued invoices or recorded payments in this date range.</p>}
      </div>
      {!compact && <section className="space-y-2">
        <h3 className="font-semibold">Next renewals</h3>
        {report.renewals.length===0 && <p className="text-sm text-muted">No renewals within the configured notice windows.</p>}
        <ul className="divide-y divide-line text-sm">
          {report.renewals.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="break-words">{row.tenant_name} · {row.next_bill_on} UTC · {title(row.renewal_mode)}</span>
            <Button type="button" onClick={() => onCustomer({ id:row.tenant_id,name:row.tenant_name })}>View invoices</Button>
          </li>)}
        </ul>
      </section>}
    </>}
  </Panel>;
}

export function BillingLicenses() {
  const [revision,setRevision] = useState(0);
  const [query,setQuery] = useState({ offset:0 });
  const [creating,setCreating] = useState(false);
  const result = useBillingGet("/licenses",query,revision);
  const write = useBillingWrite(() => setRevision((value) => value+1));
  return <Panel>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Enterprise licensing metadata</h2>
      <Button primary onClick={() => setCreating((value) => !value)}>New license record</Button>
    </div>
    <p className="text-sm text-muted">Hosted and self-hosted records are tracked separately. Limits are informational.</p>
    <Feedback {...write} />
    {creating && <form className="space-y-3 border-y border-line py-4" onSubmit={(event) => {
      event.preventDefault();void write.submit("post","/licenses",dataFrom(event),() => setCreating(false));
    }}>
      <TenantLookup required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="reference" label="License reference" maxLength={100} required />
        <Select name="deployment" label="Deployment" choices={[["hosted","Hosted"],["self_hosted","Self-hosted"]]} />
        <Input name="deviceLimit" label="Device limit" type="number" min="1" />
        <Input name="userLimit" label="User limit" type="number" min="1" />
        <Input name="startsOn" label="Start UTC" type="date" value={utcDay()} required />
        <Input name="endsOn" label="End UTC" type="date" />
        <Input name="notes" label="Internal notes" maxLength={500} />
      </div>
      <Button primary disabled={write.busy}>Save license metadata</Button>
    </form>}
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault();setQuery({ ...dataFrom(event),offset:0 }); }}>
      <TenantLookup blank="All customers" /><Button>Filter licenses</Button>
    </form>
    <ReadState {...result} empty={result.data?.data.length===0} />
    <ul className="divide-y divide-line text-sm">
      {result.data?.data.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-3 py-2">
        <div className="min-w-0 break-words"><p className="font-semibold">{row.reference} · {row.tenant_name}</p>
          <p className="text-muted">{title(row.deployment)} · {row.starts_on} to {row.ends_on || "open ended"} · {row.archived ? "Archived" : "Current"}</p>
          <p className="text-muted">Device limit {row.device_limit ?? "—"} · User limit {row.user_limit ?? "—"}</p>
          {row.notes && <p className="text-muted">{row.notes}</p>}</div>
        <Button disabled={write.busy} onClick={() => write.submit("patch",`/licenses/${row.id}`,{ archived:!row.archived })}>
          {row.archived ? "Restore record" : "Archive record"}
        </Button>
      </li>)}
    </ul>
    <Pagination result={result.data} offset={query.offset} onChange={(offset) => setQuery({ ...query,offset })} />
  </Panel>;
}
