import { useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../services/api";
import ConnectivityCatalog from "./connectivity/ConnectivityCatalog";
import ConnectivitySummary from "./connectivity/ConnectivitySummary";
import SimDetails from "./connectivity/SimDetails";
import SimForm from "./connectivity/SimForm";
import { PageHeader } from "../../components/WorkspaceUi";
import {
  buttonClass, Input, Lookup, Pagination, panelClass, primaryClass, ReadState, Select,
} from "./connectivity/connectivity-ui";
import { day, labelOptions, lifecycleOptions, message, root, useConnectivityGet } from "./connectivity/connectivity-data";

export default function SimConnectivityPage() {
  const [tab, setTab] = useState("sims");
  const [filter, setFilter] = useState({ offset: 0 });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: list, error: listError } = useConnectivityGet(tab === "sims" ? "/sims" : null, filter, revision);
  const summary = useConnectivityGet("/summary", undefined, revision);
  const refresh = () => setRevision((current) => current + 1);

  async function save(path, data, method) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await platformApi.request({ url: root + path, method, data });
      if (path === "/sims") {
        setRegistering(false);
        setSelected(response.data.id);
      }
      setNotice(path === "/sims" ? "SIM registered." : "Renewal warning threshold saved.");
      refresh();
    } catch (error) {
      setError(message(error, "Could not save connectivity changes."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-canvas text-ink">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-8">
        <Link className="text-sm text-accent" to="/platform/dashboard">Platform dashboard</Link>
        <PageHeader title="SIM & Connectivity" compact>
          {tab === "sims" && <button className={primaryClass} onClick={() => { setRegistering(true); setSelected(null); setError(""); }}>New SIM</button>}
        </PageHeader>
        {notice && <p role="status" className="text-positive">{notice}</p>}
        {error && <p role="alert" className="text-negative">{error}</p>}
        <ConnectivitySummary {...summary} busy={busy} onSave={(warningDays) => save("/settings", { warningDays }, "patch")} />
        <nav aria-label="Connectivity administration" className="flex flex-wrap gap-2">
          {[["sims", "SIM inventory"], ["operators", "Mobile operators"], ["plans", "Connectivity plans"]].map(([id, label]) => (
            <button key={id} className={buttonClass} aria-pressed={tab === id} onClick={() => {
              setTab(id);
              setNotice("");
              setError("");
            }}>{label}</button>
          ))}
        </nav>
        {tab !== "sims" ? <ConnectivityCatalog key={tab} type={tab} onChanged={refresh} /> : (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <section className={panelClass}>
              <h2 className="text-lg font-semibold">SIM inventory</h2>
              <form className="space-y-3" onSubmit={(event) => {
                event.preventDefault();
                setFilter({ ...Object.fromEntries(new FormData(event.currentTarget)), offset: 0 });
              }}>
                <Input name="q" label="Search SIMs" value={filter.q} placeholder="Label, operator, or ICCID" maxLength={150} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select name="lifecycle" label="Lifecycle filter" choices={labelOptions(lifecycleOptions)} value={filter.lifecycle} blank="All statuses" />
                  <Select name="assignment" label="Assignment filter" choices={labelOptions(["assigned", "unassigned"])} value={filter.assignment} blank="All assignments" />
                  <Select name="expiry" label="Expiry filter" choices={[["expiring", "Expiring soon"], ["expired", "Expired"]]} value={filter.expiry} blank="Any expiry" />
                  <Select name="sort" label="Sort inventory" choices={[["newest", "Newest"], ["label", "SIM label"], ["expiry", "Planned expiry"]]} value={filter.sort ?? "newest"} />
                </div>
                <Lookup path="/operators" name="operatorId" label="Operator filter" value={filter.operatorId} blank="All operators" />
                <button className={buttonClass}>Apply filters</button>
              </form>
              <ReadState data={list} error={listError} empty={list?.data.length === 0} emptyText="No SIMs match these filters." />
              <ul className="divide-y divide-line">
                {list?.data.map((sim) => (
                  <li className="py-2" key={sim.id}>
                    <button className="w-full break-words text-left font-semibold hover:text-accent"
                      onClick={() => { setSelected(sim.id); setRegistering(false); }}>{sim.label}</button>
                    <p className="break-words text-sm text-muted">
                      {[sim.maskedIccid, sim.operatorName, sim.lifecycle, sim.deviceName || (sim.deviceId ? `GPS #${sim.deviceId}` : "Unassigned")].filter(Boolean).join(" · ")}
                    </p>
                    {sim.expiresAt && <p className="text-sm text-muted">{sim.daysRemaining <= 0 ? "Expired" : "Planned expiry"} · {day(sim.expiresAt)}</p>}
                  </li>
                ))}
              </ul>
              <Pagination result={list} offset={filter.offset} onChange={(offset) => setFilter({ ...filter, offset })} />
            </section>
            {registering && <section className={panelClass}>
              <h2 className="text-lg font-semibold">Register inventory SIM</h2>
              <SimForm busy={busy} onCancel={() => setRegistering(false)} onSave={(data) => save("/sims", data, "post")} />
            </section>}
            {selected && <SimDetails key={selected} id={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
          </div>
        )}
      </div>
    </main>
  );
}
