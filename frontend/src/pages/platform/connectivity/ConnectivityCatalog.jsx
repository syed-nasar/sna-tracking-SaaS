import { useState } from "react";
import { platformApi } from "../../../services/api";
import {
  buttonClass, Input, Lookup, Notes, Pagination, panelClass, primaryClass, ReadState, Select,
} from "./connectivity-ui";
import { labelOptions, message, root, useConnectivityGet } from "./connectivity-data";

export default function ConnectivityCatalog({ type, onChanged }) {
  const operators = type === "operators";
  const title = operators ? "Mobile operators" : "Connectivity plans";
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState({ q: "", offset: 0 });
  const [editing, setEditing] = useState(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error: listError } = useConnectivityGet(`/${type}`, filter, revision);

  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form);
    values.isActive = form.has("isActive");
    if (!operators) {
      values.customerVisible = form.has("customerVisible");
      if (editing) delete values.operatorId;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editing) await platformApi.patch(`${root}/${type}/${editing.id}`, values);
      else await platformApi.post(`${root}/${type}`, values);
      setRevision((current) => current + 1);
      setEditing(undefined);
      setNotice(operators ? "Operator saved." : "Plan saved.");
      onChanged();
    } catch (error) {
      setError(message(error, "Could not save the catalog record."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panelClass}>
      <header className="flex flex-wrap justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" className={primaryClass} onClick={() => setEditing(null)}>
          {operators ? "New operator" : "New plan"}
        </button>
      </header>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        setFilter({ q: new FormData(event.currentTarget).get("q"), offset: 0 });
      }}>
        <Input name="q" label={`Search ${title.toLowerCase()}`} maxLength={150} />
        <button className={buttonClass}>Search</button>
      </form>
      {notice && <p role="status" className="text-positive">{notice}</p>}
      <ReadState data={data} error={listError} empty={data?.data.length === 0} />
      <ul className="divide-y divide-line">
        {data?.data.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="break-words">{entry.name} · {entry.isActive ? "Active" : "Inactive"}</span>
            <button type="button" className={buttonClass} onClick={() => setEditing(entry)} aria-label={`Edit ${entry.name}`}>Edit</button>
          </li>
        ))}
      </ul>
      <Pagination result={data} offset={filter.offset} onChange={(offset) => setFilter({ ...filter, offset })} />
      {editing !== undefined && (
        <form key={editing?.id ?? "new"} className="space-y-3 border-t border-line pt-4" onSubmit={save}>
          <h3 className="font-semibold">{editing ? "Edit" : "Add"} {operators ? "operator" : "plan"}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="name" label="Name" value={editing?.name} maxLength={150} required />
            {operators ? <>
              <Input name="countryCode" label="Country code" value={editing?.countryCode} maxLength={2} required />
              <Input name="mcc" label="MCC" value={editing?.mcc} maxLength={3} />
              <Input name="mnc" label="MNC" value={editing?.mnc} maxLength={3} />
              <Input name="supportContact" label="Support contact" value={editing?.supportContact} maxLength={255} />
            </> : <>
              {!editing && <Lookup path="/operators" params={{ active: "true" }} name="operatorId" label="Operator" required />}
              <Input name="scope" label="Country or roaming scope" value={editing?.scope} maxLength={150} />
              <Input name="allowanceMb" label="Data allowance (MB)" type="number" min="0" value={editing?.allowanceMb} />
              <Input name="validityDays" label="Validity (days)" type="number" min="1" max="3660" value={editing?.validityDays} required />
              <Select name="billingCycle" label="Billing cycle" choices={labelOptions(["prepaid", "monthly", "quarterly", "annual"])}
                value={editing?.billingCycle ?? "prepaid"} required />
              <Input name="currency" label="Currency code" maxLength={3} value={editing?.currency} required />
              <Input name="recurringCost" label="Recurring cost" type="number" min="0" step="0.01" value={editing?.recurringCost} />
              <Input name="customerPrice" label="Customer price" type="number" min="0" step="0.01" value={editing?.customerPrice} />
              <Input name="activationFee" label="Activation fee" type="number" min="0" step="0.01" value={editing?.activationFee} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="customerVisible" defaultChecked={editing?.customerVisible} /> Show plan name to customers</label>
            </>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? true} /> Active</label>
          </div>
          {!operators && <Notes value={editing?.notes} />}
          {error && <p role="alert" className="text-negative">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={primaryClass} disabled={busy}>{operators ? "Save operator" : "Save plan"}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => { setEditing(undefined); setError(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
