import { useEffect, useRef, useState } from "react";
import { tenantApi } from "../services/api";

const field = "w-full rounded-lg border border-white/15 bg-[#090d16] px-3 py-2";
const button = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50";

export default function VehicleOperations({ vehicle, canManage, onClose, onSaved }) {
  const dialog = useRef(null);
  const [groups, setGroups] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    const config = { signal: controller.signal };
    Promise.all([tenantApi.get("/fleet/groups", config), tenantApi.get("/fleet/drivers", config)])
      .then(([groupResponse, driverResponse]) => {
        setGroups(groupResponse.data);
        setDrivers(driverResponse.data.filter((driver) => driver.isActive));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load fleet options.");
      });
    return () => controller.abort();
  }, [canManage]);

  async function save(event, driverOnly) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    setSaving(true);
    const path = `/fleet/vehicles/${vehicle.id}`;
    try {
      if (driverOnly) {
        await tenantApi.put(`${path}/driver`, { driverId: fields.get("driverId") || null });
      } else {
        await tenantApi.patch(`${path}/details`, {
          groupId: fields.get("groupId") || null,
          fleetNumber: fields.get("fleetNumber"),
          operationalNotes: fields.get("operationalNotes"),
        });
      }
      setNotice(driverOnly ? "Driver assignment saved." : "Operational details saved.");
      void onSaved();
    } catch (error) {
      setError(error.response?.data?.message || "Could not save vehicle operations.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="vehicle-operations-title"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg space-y-4 overflow-y-auto rounded-xl border border-white/15 bg-[#111827] p-5 text-white backdrop:bg-black/70">
      <header className="flex items-start justify-between gap-3">
        <h2 id="vehicle-operations-title" className="break-words text-lg font-bold">{vehicle.name} operations</h2>
        <button type="button" className="rounded border border-white/15 px-3 py-1" onClick={onClose}>Close</button>
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-400">Vehicle group</dt><dd className="break-words">{vehicle.groupName || "Ungrouped"}</dd></div>
        <div><dt className="text-slate-400">Assigned driver</dt><dd className="break-words">{vehicle.driverName || "Unassigned"}</dd></div>
        <div><dt className="text-slate-400">Fleet number</dt><dd className="break-words">{vehicle.fleetNumber || "Unspecified"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-400">Operational notes</dt><dd className="whitespace-pre-wrap break-words">{vehicle.operationalNotes || "No notes"}</dd></div>
      </dl>
      {canManage && groups && drivers && (
        <>
          <form onSubmit={(event) => save(event, false)} className="space-y-3 border-t border-white/10 pt-4">
            <label className="block space-y-1">Group
              <select className={field} name="groupId" defaultValue={vehicle.groupId ?? ""}>
                <option value="">Ungrouped</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1">Fleet number
              <input className={field} name="fleetNumber" maxLength={50} defaultValue={vehicle.fleetNumber ?? ""} />
            </label>
            <label className="block space-y-1">Operational notes
              <textarea className={field} name="operationalNotes" maxLength={2000} rows={3} defaultValue={vehicle.operationalNotes ?? ""} />
            </label>
            <button className={button} disabled={saving}>Save details</button>
          </form>
          <form onSubmit={(event) => save(event, true)} className="space-y-3 border-t border-white/10 pt-4">
            <label className="block space-y-1">Driver
              <select className={field} name="driverId" defaultValue={vehicle.driverId ?? ""}>
                <option value="">Unassigned</option>
                {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
              </select>
            </label>
            <button className={button} disabled={saving}>Save driver assignment</button>
          </form>
        </>
      )}
      {canManage && !groups && !error && <p role="status">Loading fleet options…</p>}
      {notice && <p role="status" className="text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </dialog>
  );
}
