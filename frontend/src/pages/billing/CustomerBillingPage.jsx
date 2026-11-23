import { useState } from "react";
import TenantLayout from "../../components/TenantLayout";
import { useAuth } from "../../context/AuthContext";
import { InvoiceDetails } from "./BillingInvoices";
import { DataList,Pagination,Panel,ReadState } from "./BillingUi";
import { money,title,useBillingGet } from "./billing-data";

export default function CustomerBillingPage() {
  const { session } = useAuth();
  const allowed = session?.profile?.role==="tenant_admin";
  const personal = session?.profile?.customerType==="personal";
  const [offset,setOffset] = useState(0);
  const [selected,setSelected] = useState(null);
  const subscriptions = useBillingGet(allowed ? "/subscriptions" : null,{ limit:1 },0,false);
  const invoices = useBillingGet(allowed ? "/invoices" : null,{ offset },0,false);
  const sub = subscriptions.data?.data[0];
  const label = personal ? "My Billing" : "Company Billing";
  return <TenantLayout title={label}>
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">{label}</h1>
      {!allowed ? <Panel><p>Only your tenant administrator can view billing records.</p></Panel> : <>
        <p className="text-sm text-muted">Online payments are not integrated. Recorded payments appear in each invoice.</p>
        <Panel>
          <h2 className="text-lg font-semibold">Subscription</h2>
          <ReadState {...subscriptions} empty={!sub} emptyText="No subscription recorded." />
          {sub && <DataList values={[
            ["Plan",sub.plan_name],["Status",title(sub.effective_status)],
            ["Next billing date (UTC)",["active","trialing","past_due"].includes(sub.status) ? sub.next_bill_on : "—"],
            ["Price",money(sub.effective_base,sub.currency)],
            ...(!personal ? [["Included devices",sub.included_devices],["User limit",sub.user_limit]] : []),
            ...(sub.trial_ends_on ? [["Trial ends (UTC)",sub.trial_ends_on]] : []),
            ...(sub.grace_until ? [["Payment grace through (UTC)",sub.grace_until]] : []),
            ...(sub.entitlements.warning ? [["Billing notice",title(sub.entitlements.warning)]] : []),
          ]} />}
          {sub && ["active","trialing","past_due"].includes(sub.status) && sub.days_to_renewal <= sub.notice_days &&
            <p role="status" className="text-sm text-accent">{sub.days_to_renewal <= 0
              ? "The scheduled billing date has been reached."
              : `Renewal is scheduled in ${sub.days_to_renewal} day(s).`}</p>}
        </Panel>
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <Panel>
            <h2 className="text-lg font-semibold">Issued invoices</h2>
            <ReadState {...invoices} empty={invoices.data?.data.length===0} emptyText="No invoices issued yet." />
            <ul className="divide-y divide-line">
              {invoices.data?.data.map((row) => <li key={row.id} className="py-2">
                <button className="w-full break-words text-left font-semibold hover:text-accent" onClick={() => setSelected(row.id)}>
                  {row.invoice_number}
                </button>
                <p className="text-sm text-muted">{row.issued_on} UTC · {title(row.status)} · {money(row.total,row.currency)}</p>
              </li>)}
            </ul>
            <Pagination result={invoices.data} offset={offset} onChange={setOffset} />
          </Panel>
          {selected && <InvoiceDetails key={selected} id={selected} platform={false} />}
        </div>
      </>}
    </main>
  </TenantLayout>;
}
