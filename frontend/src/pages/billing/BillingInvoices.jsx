import { useRef,useState } from "react";
import { Link,useParams } from "react-router-dom";
import { Button,DataList,Feedback,History,Input,Pagination,Panel,ReadState,ReasonForm,Select,TenantLookup } from "./BillingUi";
import { dataFrom,money,title,useBillingGet,useBillingWrite,useRequestKey,utcDay } from "./billing-data";

const lineKinds = ["hardware_sale","hardware_rental","connectivity","discount","tax","adjustment"];
const statuses = ["draft","issued","partially_paid","paid","overdue","void"];
const statusChoices = statuses.map((status) => [status,title(status)]);

function LineEditor({ formValues = [], children, onSave, busy, label, allowEmpty = false }) {
  const initial = allowEmpty || formValues.length ? formValues : [{}];
  const [rows,setRows] = useState(() => initial.map((line,index) => ({ ...line,key:index })));
  const nextId = useRef(initial.length);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const values = dataFrom(event);
    const lines = rows.map(({ key }) => Object.fromEntries(["kind","description","quantity","unitPrice"]
      .map((name) => [name,values[`${key}-${name}`]])));
    onSave(values,lines);
  }}>
    {children}
    <p className="text-sm text-muted">Enter discounts and tax as explicit positive amounts. Discounts are subtracted.</p>
    {rows.map((row,index) => <fieldset className="grid items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-2" key={row.key}>
      <legend className="px-1 text-sm text-muted">Line {index+1}</legend>
      <Select name={`${row.key}-kind`} label="Line type" choices={lineKinds.map((kind) => [kind,title(kind)])} value={row.kind ?? lineKinds[0]} />
      <Input name={`${row.key}-description`} label="Line description" value={row.description} required maxLength={250} />
      <Input name={`${row.key}-quantity`} label="Quantity" type="number" min="1" max="1000000" value={row.quantity ?? 1} required />
      <Input name={`${row.key}-unitPrice`} label="Unit price" value={row.unit_price} inputMode="decimal" required />
      <Button type="button" disabled={busy} onClick={() => setRows((list) => list.filter((line) => line.key!==row.key))}>Remove line</Button>
    </fieldset>)}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || rows.length>=50} onClick={() => {
        const key = nextId.current++;
        setRows((list) => [...list,{ key }]);
      }}>Add line</Button>
      <Button primary disabled={busy || (!allowEmpty && !rows.length)}>{label}</Button>
    </div>
  </form>;
}

function InvoiceContent({ invoice }) {
  return <div className="space-y-4">
    <DataList values={[
      ["Customer",invoice.tenant_name],["Status",title(invoice.status)],["Currency",invoice.currency],
      ["Issue date (UTC)",invoice.issued_on],["Due date (UTC)",invoice.due_on],
      ["Service period",invoice.period_start ? `${invoice.period_start} to ${invoice.period_end} (exclusive)` : null],
      ["Corrects invoice",invoice.corrects_invoice_id && `#${invoice.corrects_invoice_id}`],
    ]} />
    <div className="overflow-x-auto">
      <table className="w-full min-w-[430px] text-left text-sm">
        <thead className="border-b border-line"><tr>
          {["Description","Quantity","Unit price","Amount"].map((column) => <th className="p-2 font-semibold" key={column}>{column}</th>)}
        </tr></thead>
        <tbody>{invoice.lines.map((line) => <tr className="border-b border-line" key={line.id}>
          <td className="break-words p-2"><p>{line.description}</p><p className="text-xs opacity-70">{title(line.kind)}</p></td>
          <td className="p-2">{line.quantity}</td><td className="p-2">{money(line.unit_price,invoice.currency)}</td>
          <td className="p-2">{money(line.amount,invoice.currency)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <DataList values={[
      ["Invoice total",money(invoice.total,invoice.currency)],["Recorded payments",money(invoice.collected,invoice.currency)],
      ["Outstanding balance",invoice.status==="void" ? "Voided" : money(invoice.balance,invoice.currency)],
    ]} />
  </div>;
}

function Payments({ invoice,revision,write,platform }) {
  const [offset,setOffset] = useState(0);
  const path = `/invoices/${invoice.id}/payments`;
  const result = useBillingGet(path,{ offset },revision,platform);
  return <section className="space-y-3 border-t border-line pt-4">
    <h3 className="font-semibold">Payment history</h3>
    <ReadState {...result} empty={result.data?.data.length===0} emptyText="No payments recorded." />
    <ul className="divide-y divide-line text-sm">
      {result.data?.data.map((payment) => <li key={payment.id} className="space-y-2 break-words py-2">
        <p>{money(payment.amount,payment.currency)} · {payment.paid_on} UTC · {title(payment.method)}
          {payment.reversed_at ? " · Reversed" : ""}</p>
        {platform && <>
          {payment.external_reference && <p className="text-muted">Reference {payment.external_reference}</p>}
          {payment.notes && <p className="text-muted">{payment.notes}</p>}
          {payment.reversal_reason && <p className="text-muted">{payment.reversal_reason}</p>}
          {!payment.reversed_at && <ReasonForm label="Reverse payment" busy={write.busy}
            onSave={(data,onSaved) => write.submit("post",`${path}/${payment.id}/reverse`,data,onSaved)} />}
        </>}
      </li>)}
    </ul>
    <Pagination result={result.data} offset={offset} onChange={setOffset} />
  </section>;
}

export function InvoiceDetails({ id,onChanged,platform = true }) {
  const [revision,setRevision] = useState(0);
  const [editing,setEditing] = useState(false);
  const [paying,setPaying] = useState(false);
  const path = `/invoices/${id}`;
  const { data:invoice,error } = useBillingGet(path,undefined,revision,platform);
  const write = useBillingWrite(() => { setRevision((value) => value+1); onChanged?.(); });
  const paymentKey = useRequestKey();
  return <Panel>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="break-words text-lg font-semibold">{invoice?.invoice_number || `Invoice #${id}`}</h2>
      {invoice?.issued_on && <Link className="text-sm text-accent" to={`${platform ? "/platform" : ""}/billing/invoices/${id}/print`}>
        Printable invoice
      </Link>}
    </div>
    <ReadState data={invoice} error={error} />
    <Feedback {...write} />
    {invoice && <>
      <InvoiceContent invoice={invoice} />
      {platform && <>
        {invoice.snapshots?.length>0 && <details className="text-sm">
          <summary className="cursor-pointer text-accent">Installed GPS billing snapshot</summary>
          <p className="break-words">Tracker IDs {invoice.snapshots.map((row) => row.device_id).join(", ")}</p>
          <p className="text-muted">First 100 claims shown. Voiding releases coverage while retaining the audit record.</p>
        </details>}
        {invoice.status==="draft" && <>
          <Button onClick={() => setEditing((value) => !value)}>Edit manual lines</Button>
          {editing && <LineEditor formValues={invoice.lines.filter((line) => lineKinds.includes(line.kind))}
            allowEmpty={Boolean(invoice.subscription_id)} busy={write.busy} label="Save manual lines"
            onSave={(_values,lines) => write.submit("patch",path+"/lines",{ lines },() => setEditing(false))} />}
          <form className="grid items-end gap-3 border-t border-line pt-4 sm:grid-cols-2" onSubmit={(event) => {
            event.preventDefault(); void write.submit("post",path+"/finalize",dataFrom(event));
          }}>
            <Input name="issuedOn" label="Issue date (UTC)" type="date" value={utcDay()} required />
            <Input name="dueOn" label="Due date (UTC, optional)" type="date" />
            <Button primary disabled={write.busy}>Finalize invoice</Button>
          </form>
        </>}
        {["issued","partially_paid","overdue"].includes(invoice.status) && <>
          <Button primary onClick={() => setPaying((value) => !value)}>Record manual payment</Button>
          {paying && <form className="grid items-end gap-3 sm:grid-cols-2" onSubmit={(event) => {
            event.preventDefault();
            void write.submit("post",path+"/payments",paymentKey.prepare({ ...dataFrom(event),currency:invoice.currency }),() => {
              paymentKey.reset();setPaying(false);
            });
          }}>
            <Input name="amount" label={`Payment amount (${invoice.currency})`} inputMode="decimal" required />
            <Input name="paidOn" label="Payment date (UTC)" type="date" value={utcDay()} required />
            <Select name="method" label="Payment method" choices={[["cash","Cash"],["bank_transfer","Bank transfer"],["cheque","Cheque"],["other","Other"]]} />
            <Input name="externalReference" label="External reference" maxLength={120} />
            <Input name="notes" label="Internal payment notes" maxLength={500} />
            <Button primary disabled={write.busy}>Save payment</Button>
          </form>}
        </>}
        {invoice.status!=="void" && invoice.collected==="0.0000" && <ReasonForm label="Void invoice" busy={write.busy}
          onSave={(data,onSaved) => write.submit("post",path+"/void",data,onSaved)} />}
      </>}
      <Payments invoice={invoice} revision={revision} write={write} platform={platform} />
      {platform && <History resource="invoice" id={id} revision={revision} />}
    </>}
  </Panel>;
}

export function PrintableInvoice({ platform }) {
  const { id } = useParams();
  const { data:invoice,error } = useBillingGet(`/invoices/${id}`,undefined,0,platform);
  return <main className="invoice-print min-h-screen bg-canvas p-5 text-ink print:bg-white print:text-black">
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={platform ? "/platform/billing" : "/billing"} className="text-accent">Back to billing</Link>
        {invoice?.issued_on && <Button onClick={() => window.print()}>Print invoice</Button>}
      </div>
      <header><p>SNA Technologies</p><h1 className="text-2xl font-bold">{invoice?.invoice_number || "Invoice"}</h1></header>
      <ReadState data={invoice} error={error} />
      {invoice?.issued_on && <InvoiceContent invoice={invoice} />}
      {invoice && !invoice.issued_on && <p>This draft has no issued document.</p>}
    </div>
  </main>;
}

export default function BillingInvoices({ initialInvoice,initialTenant }) {
  const [query,setQuery] = useState({ tenantId:initialTenant?.id,offset:0 });
  const [revision,setRevision] = useState(0);
  const [selected,setSelected] = useState(initialInvoice || null);
  const [creating,setCreating] = useState(false);
  const refresh = () => setRevision((value) => value+1);
  const result = useBillingGet("/invoices",query,revision);
  const write = useBillingWrite(refresh);
  const invoiceKey = useRequestKey();
  return <div className="grid items-start gap-5 xl:grid-cols-2">
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <Button primary onClick={() => setCreating((value) => !value)}>New one-time invoice</Button>
      </div>
      <Feedback {...write} />
      {creating && <LineEditor busy={write.busy} label="Save one-time draft" onSave={(values,lines) => {
        const payload = invoiceKey.prepare({ tenantId:values.tenantId,currency:values.currency,correctsInvoiceId:values.correctsInvoiceId,lines });
        void write.submit("post","/invoices",payload,(invoice) => { invoiceKey.reset();setCreating(false);setSelected(invoice.id); });
      }}>
        <TenantLookup required />
        <Input name="currency" label="Currency code" maxLength={3} value="PKR" required />
        <Input name="correctsInvoiceId" label="Voided invoice ID to correct (optional)" inputMode="numeric" />
      </LineEditor>}
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault();setQuery({ ...dataFrom(event),offset:0 }); }}>
        <TenantLookup value={initialTenant?.id} currentLabel={initialTenant?.name} blank="All customers" />
        <Select name="status" label="Invoice status" choices={statusChoices} blank="All statuses" />
        <Button>Filter invoices</Button>
      </form>
      <ReadState {...result} empty={result.data?.data.length===0} />
      <ul className="divide-y divide-line">
        {result.data?.data.map((row) => <li key={row.id} className="py-2">
          <button className="w-full break-words text-left font-semibold hover:text-accent" onClick={() => setSelected(row.id)}>
            {row.invoice_number || `Draft #${row.id}`} · {row.tenant_name}
          </button>
          <p className="text-sm text-muted">{title(row.status)} · {money(row.total,row.currency)}</p>
        </li>)}
      </ul>
      <Pagination result={result.data} offset={query.offset} onChange={(offset) => setQuery({ ...query,offset })} />
    </Panel>
    {selected && <InvoiceDetails key={selected} id={selected} onChanged={refresh} />}
  </div>;
}
