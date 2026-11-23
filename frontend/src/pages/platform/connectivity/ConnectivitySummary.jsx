import { Link } from "react-router-dom";
import { buttonClass, Input, panelClass, ReadState } from "./connectivity-ui";

export default function ConnectivitySummary({ data, error, onSave, busy, compact = false }) {
  return (
    <section className={panelClass} aria-label="Connectivity summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">SIM expiry and lifecycle</h2>
        {compact && <Link to="/platform/connectivity" className="text-sm text-blue-300">Manage SIMs and plans</Link>}
      </div>
      <ReadState data={data} error={error} />
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["Active", data.active], ["Expiring soon", data.expiringSoon], ["Expired", data.expired],
              ["Suspended", data.suspended], ["Faulty", data.faulty],
            ].map(([label, count]) => (
              <div key={label} className="rounded-lg bg-white/5 p-3">
                <dt className="text-slate-400">{label}</dt><dd className="text-xl font-semibold">{count}</dd>
              </div>
            ))}
          </dl>
          {!compact && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault();
              onSave(new FormData(event.currentTarget).get("warningDays"));
            }}>
              <Input name="warningDays" label="Renewal warning days" type="number" min="1" max="365" value={data.warningDays} required />
              <button className={buttonClass} disabled={busy}>Save warning threshold</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
