import { useState } from "react";
import { Link } from "react-router-dom";
import BillingPlans from "./BillingPlans";
import BillingSubscriptions from "./BillingSubscriptions";
import BillingInvoices from "./BillingInvoices";
import { BillingLicenses,BillingReport } from "./BillingOverview";
import { Button } from "./BillingUi";

const tabs = [["overview","Overview"],["plans","Plans"],["subscriptions","Subscriptions"],["invoices","Invoices"],["licenses","Licensing"]];

export default function BillingPage() {
  const [tab,setTab] = useState("overview");
  const [invoice,setInvoice] = useState(null);
  const [tenant,setTenant] = useState(null);
  return <main className="min-h-screen bg-[#090d16] text-white">
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8">
      <Link className="text-sm text-blue-300" to="/platform/dashboard">Platform dashboard</Link>
      <h1 className="text-2xl font-bold">Subscriptions &amp; Billing</h1>
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
