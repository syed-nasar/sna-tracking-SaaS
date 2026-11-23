import { useRef, useState } from "react";
import { platformApi } from "../../../services/api";
import SimForm from "./SimForm";
import {
  buttonClass, Input, Lookup, Notes, Pagination, panelClass, primaryClass, ReadState, Select,
} from "./connectivity-ui";
import { day, labelOptions, message, root, useConnectivityGet } from "./connectivity-data";

const nextStates = {
  available: ["reserved", "active", "faulty", "retired"],
  reserved: ["available", "active", "suspended", "faulty", "retired"],
  active: ["reserved", "suspended", "faulty", "retired"],
  suspended: ["reserved", "active", "faulty", "retired"],
  faulty: ["available", "reserved", "active", "retired"],
  retired: [],
};

function AssignmentForm({ sim, submit, busy }) {
  const [device, setDevice] = useState(null);
  const canPlace = ["available", "reserved"].includes(sim.lifecycle) || (sim.lifecycle === "active" && sim.deviceId);
  const selected = device && device.id !== sim.deviceId ? device : null;
  const action = sim.deviceId ? "move" : selected?.assignmentId ? "replace" : "assign";
  const label = action === "move" ? "Move SIM" : action === "replace" ? "Replace SIM" : "Assign SIM";
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!selected) return;
      const values = new FormData(event.currentTarget);
      submit("put", "/assignment", {
        action, deviceId: selected.id, expectedAssignmentId: selected.assignmentId,
        ...(sim.deviceId && { fromDeviceId: sim.deviceId }), reason: values.get("reason"),
      }, selected.assignmentId ? `Replace ${selected.simLabel} on ${selected.name}?` :
        sim.deviceId ? `Move this SIM to ${selected.name}?` : null);
    }}>
      {canPlace && <Lookup path="/device-options" label="Destination GPS device" onChange={setDevice} disabled={busy} />}
      {(canPlace || sim.deviceId) && (
        <Input name="reason" label="Assignment reason" maxLength={500} required disabled={busy} />
      )}
      <div className="flex flex-wrap gap-2">
        {canPlace && <button className={primaryClass} disabled={busy || !selected}>{label}</button>}
        {sim.deviceId && (
          <button type="button" className={buttonClass} disabled={busy} onClick={(event) => {
            const form = event.currentTarget.form;
            if (!form.reportValidity()) return;
            submit("put", "/assignment", {
              action: "remove", deviceId: sim.deviceId, expectedAssignmentId: sim.assignmentId,
              reason: new FormData(form).get("reason"),
            }, "Remove this SIM from its GPS device?");
          }}>Remove assignment</button>
        )}
      </div>
      {!canPlace && !sim.deviceId && <p className="text-sm text-slate-400">This lifecycle does not allow a new assignment.</p>}
    </form>
  );
}

function PeriodForm({ sim, submit, busy }) {
  const [kind, setKind] = useState("plan");
  const prepared = useRef(null);
  if (sim.lifecycle === "retired") return <p className="text-sm text-slate-400">Plan history is retained for this retired SIM.</p>;
  if (!sim.operatorId) return <p className="text-sm text-slate-400">Set the SIM operator before assigning a plan.</p>;
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const input = Object.fromEntries(new FormData(event.currentTarget));
      const payload = { ...input, expectedPeriodId: sim.latestPeriodId };
      const signature = JSON.stringify([kind, payload]);
      if (prepared.current?.signature !== signature) prepared.current = { signature, key: crypto.randomUUID() };
      submit("post", kind === "plan" ? "/periods" : "/renewals", {
        ...payload, requestKey: prepared.current.key,
      }, null);
    }}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} aria-pressed={kind === "plan"} onClick={() => setKind("plan")}>Assign or change plan</button>
        <button type="button" className={buttonClass} aria-pressed={kind === "renewal"} disabled={!sim.latestPeriodId}
          onClick={() => setKind("renewal")}>Manual renewal</button>
      </div>
      {kind === "plan" ? (
        <>
          <Lookup path="/plans" params={{ operatorId: sim.operatorId, active: "true" }} name="planId" label="Plan" required disabled={busy} />
          <Input name="startDate" label="Start date (UTC)" type="date" value={new Date().toISOString().slice(0, 10)} required />
        </>
      ) : <p className="text-sm text-slate-400">The renewal starts at the last recorded expiry, or today if that period expired.</p>}
      <Input name="providerReference" label="Provider reference" maxLength={150} />
      <Notes label="Period notes" maxLength={1000} />
      <button className={primaryClass} disabled={busy}>{kind === "plan" ? "Save plan period" : "Record renewal"}</button>
    </form>
  );
}

function History({ simId, revision }) {
  const [kind, setKind] = useState("assignments");
  const [offset, setOffset] = useState(0);
  const { data, error } = useConnectivityGet(`/sims/${simId}/${kind}`, { offset }, revision);
  return (
    <section className="space-y-3 border-t border-white/10 pt-4">
      <h3 className="font-semibold">History</h3>
      <div className="flex flex-wrap gap-2">
        {[["assignments", "Assignment history"], ["periods", "Plan and renewal history"], ["audit", "Audit history"]].map(([id, title]) => (
          <button type="button" className={buttonClass} key={id} aria-pressed={kind === id}
            onClick={() => { setKind(id); setOffset(0); }}>{title}</button>
        ))}
      </div>
      <ReadState data={data} error={error} empty={data?.data.length === 0} />
      <ul className="divide-y divide-white/10 text-sm">
        {data?.data.map((record) => (
          <li key={record.id} className="space-y-1 break-words py-2">
            {kind === "assignments" && <>
              <p className="font-medium">{record.deviceName}</p>
              <p className="text-slate-400">{new Date(record.startedAt).toLocaleString()} · {record.startedByName} · {record.startReason}</p>
              <p className="text-slate-400">{record.endedAt
                ? `${new Date(record.endedAt).toLocaleString()} · ${record.endedByName} · ${record.endReason}` : "Current assignment"}</p>
            </>}
            {kind === "periods" && <>
              <p className="font-medium">{record.terms.name} · {record.kind === "renewal" ? "Renewal" : "Plan period"}</p>
              <p className="text-slate-400">{day(record.startsAt)} to {day(record.expiresAt)} · {record.actorName}</p>
              {record.supersededAt && <p>Superseded {day(record.supersededAt)}</p>}
              <p className="text-slate-400">{record.terms.allowanceMb ?? "Unspecified"} MB · {record.terms.validityDays} days
                {record.terms.recurringCost != null && ` · ${record.terms.recurringCost} ${record.terms.currency} recurring cost`}
                {record.terms.customerPrice != null && ` · ${record.terms.customerPrice} ${record.terms.currency} customer price`}
                {record.terms.activationFee != null && ` · ${record.terms.activationFee} ${record.terms.currency} activation fee`}
              </p>
              {record.providerReference && <p>Reference {record.providerReference}</p>}
              {record.notes && <p>{record.notes}</p>}
            </>}
            {kind === "audit" && <>
              <p className="font-medium capitalize">{record.action.replaceAll("_", " ")}</p>
              <p className="text-slate-400">{new Date(record.createdAt).toLocaleString()} · {record.actorName}</p>
              {record.reason && <p>{record.reason}</p>}
              <p className="text-slate-400">{Object.entries(record.details).filter(([, value]) => value != null)
                .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ")}</p>
            </>}
          </li>
        ))}
      </ul>
      <Pagination result={data} offset={offset} onChange={setOffset} />
    </section>
  );
}

export default function SimDetails({ id, onClose, onChanged }) {
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const { data: sim, error: readError } = useConnectivityGet(`/sims/${id}`, undefined, revision);

  async function run(method, suffix, data) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await platformApi.request({ method, url: `${root}/sims/${id}${suffix}`, data });
      setRevision((version) => version + 1);
      onChanged();
      if (suffix === "") setEditing(false);
      setNotice(result.data.replayed ? "This period was already recorded." : "SIM updated.");
    } catch (error) {
      setError(message(error, "Could not update the SIM."));
    } finally {
      setBusy(false);
    }
  }

  function submit(method, suffix, data, confirmation) {
    if (confirmation) {
      setPending({ method, suffix, data, confirmation });
    } else {
      void run(method, suffix, data);
    }
  }

  return (
    <article className={panelClass}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="break-words text-lg font-semibold">{sim?.label || "SIM details"}</h2>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy || Boolean(pending)} onClick={() => {
            setError("");
            setNotice("");
            setRevision((version) => version + 1);
          }}>Reload details</button>
          <button className={buttonClass} onClick={onClose}>Close details</button>
        </div>
      </header>
      {notice && <p role="status" className="text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="break-words text-red-300">{error}</p>}
      {pending && <div className="space-y-2 rounded-lg border border-amber-400/40 p-3">
        <p className="break-words">{pending.confirmation}</p>
        <div className="flex gap-2">
          <button className={primaryClass} onClick={() => { setPending(null); void run(pending.method, pending.suffix, pending.data); }}>Confirm</button>
          <button className={buttonClass} onClick={() => setPending(null)}>Cancel</button>
        </div>
      </div>}
      <ReadState data={sim} error={readError} />
      {sim && <>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ["Lifecycle", sim.lifecycle], ["Operator", sim.operatorName], ["ICCID", sim.maskedIccid],
            ["IMSI", sim.maskedImsi], ["SIM phone number", sim.maskedMsisdn], ["GPS device", sim.deviceName || (sim.deviceId && `#${sim.deviceId}`)],
            ["Activation date", day(sim.activatedAt)], ["Plan", sim.planName], ["Plan start", day(sim.planStartsAt)],
            ["Planned expiry", day(sim.expiresAt)], ["Days remaining", sim.daysRemaining == null ? "Unrecorded" : Math.max(0, sim.daysRemaining)],
            ["Carrier status and data usage", "Not integrated"],
          ].map(([label, value]) => <div key={label}><dt className="text-slate-400">{label}</dt><dd className="break-words">{value ?? "Unrecorded"}</dd></div>)}
        </dl>
        <button className={buttonClass} disabled={busy || Boolean(pending)} onClick={() => setEditing(true)}>Edit SIM</button>
        {editing && <SimForm sim={sim} busy={busy || Boolean(pending)} onSave={(data) => submit("patch", "", data)} onCancel={() => setEditing(false)} />}
        {nextStates[sim.lifecycle].length > 0 && (
          <section className="space-y-3 border-t border-white/10 pt-4">
            <h3 className="font-semibold">Lifecycle</h3>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              const data = Object.fromEntries(new FormData(event.currentTarget));
              submit("patch", "/lifecycle", data, data.lifecycle === "retired" ? "Retire this SIM permanently?" : null);
            }}>
              <Select name="lifecycle" label="New lifecycle" choices={labelOptions(nextStates[sim.lifecycle]
                .filter((state) => !sim.assignmentId || !["retired", "available"].includes(state)))}
                blank="Select lifecycle" required />
              <Input name="reason" label="Lifecycle reason" maxLength={500} required />
              <button className={buttonClass} disabled={busy || Boolean(pending)}>Save lifecycle</button>
            </form>
          </section>
        )}
        <section className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="font-semibold">GPS assignment</h3>
          <AssignmentForm sim={sim} submit={submit} busy={busy || Boolean(pending)} />
        </section>
        <section className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="font-semibold">Connectivity period</h3>
          <PeriodForm sim={sim} submit={submit} busy={busy || Boolean(pending)} />
        </section>
        <History simId={sim.id} revision={revision} />
      </>}
    </article>
  );
}
