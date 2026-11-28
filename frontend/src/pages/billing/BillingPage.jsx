import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import BillingPlans from "./BillingPlans";
import BillingSubscriptions from "./BillingSubscriptions";
import BillingInvoices from "./BillingInvoices";
import { BillingLicenses,BillingReport } from "./BillingOverview";
import { Button } from "./BillingUi";
import { PageHeader } from "../../components/WorkspaceUi";

const tabs = [["overview","Overview"],["plans","Plans"],["subscriptions","Subscriptions"],["invoices","Invoices"],["licenses","Licensing"]];

export default function BillingPage() {
  const [params] = useSearchParams();
  const requestedTab=params.get("tab");
  const [tab,setTab] = useState(tabs.some(([id])=>id===requestedTab)?requestedTab:"overview");
  const [invoice,setInvoice] = useState(null);
  const requestedTenant=params.get("tenantId");
  const [tenant,setTenant] = useState(/^[1-9][0-9]{0,18}$/.test(requestedTenant??"")?{id:requestedTenant,name:`Customer #${requestedTenant}`}:null);
  return <main className="bg-canvas text-ink">
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8">
      <Link className="text-sm text-accent" to="/platform/dashboard">Platform dashboard</Link>
      <PageHeader title="Subscriptions & Billing" compact />
      <nav className="flex flex-wrap gap-2" aria-label="Billing administration">
        {tabs.map(([id,label]) => <Button key={id} aria-pressed={tab===id}
          primary={tab===id} onClick={() => { setTab(id);setInvoice(null);setTenant(null); }}>{label}</Button>)}
      </nav>
      {tab==="overview" && <BillingReport onCustomer={(customer) => { setTenant(customer);setTab("invoices"); }} />}
      {tab==="plans" && <BillingPlans />}
      {tab==="subscriptions" && <BillingSubscriptions initialTenant={tenant} onInvoice={(id) => { setInvoice(id);setTab("invoices"); }} />}
      {tab==="invoices" && <BillingInvoices initialInvoice={invoice} initialTenant={tenant} />}
      {tab==="licenses" && <BillingLicenses />}
    </div>
  </main>;
}
