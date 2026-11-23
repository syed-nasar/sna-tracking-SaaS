import { useEffect, useRef, useState } from "react";
import { tenantApi } from "../services/api";

export default function VehicleGpsInstallation({ vehicle, onClose, onSaved }) {
  const dialog = useRef(null);
  const [devices, setDevices] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = vehicle.traccarDeviceId ?? null;
  const options = devices?.filter((device) => device.traccarDeviceId && device.traccarDeviceId !== attached &&
    ["reserved", "installed"].includes(device.lifecycleStatus));
  const chosen = options?.find((device) => device.traccarDeviceId === selected);

  useEffect(() => {
    dialog.current.showModal();
    const controller = new AbortController();
    tenantApi.get("/vehicles/devices", { signal: controller.signal }).then(({ data }) => setDevices(data))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load GPS devices.");
      });
    return () => controller.abort();
  }, []);

  async function save(remove = false) {
    setBusy(true);
    setError("");
    try {
      await tenantApi.put(`/vehicles/${vehicle.id}/gps-device`, {
        traccarDeviceId: remove ? null : chosen.traccarDeviceId,
        expectedDeviceId: attached,
        ...(!remove && chosen.vehicleId && { fromVehicleId: chosen.vehicleId }),
      });
      onSaved();
      onClose();
    } catch (error) {
      setError(error.response?.data?.message || "Could not change the GPS installation.");
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-50";
  return (
    <dialog ref={dialog} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}
      aria-labelledby="gps-installation-title"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg space-y-4 overflow-y-auto rounded-xl border border-line-strong bg-panel p-5 text-ink backdrop:bg-black/70">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="gps-installation-title" className="break-words text-lg font-semibold">GPS device for {vehicle.name}</h2>
        <button type="button" className={button} disabled={busy} onClick={onClose}>Close</button>
      </header>
      <p className="text-sm text-secondary">{attached ? `Installed device #${attached}` : "No GPS device installed."}</p>
      {error && <p role="alert" className="text-negative">{error}</p>}
      {!devices && !error && <p role="status">Loading allocated devices…</p>}
      {options?.length === 0 && <p className="text-sm text-muted">There are no other linked devices available on this account.</p>}
      {options?.length > 0 && (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block space-y-1">Choose GPS device
            <select className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2" disabled={busy}
              value={selected} onChange={(event) => setSelected(event.target.value)} required>
              <option value="">Select device</option>
              {options.map((device) => (
                <option key={device.id} value={device.traccarDeviceId}>
                  {device.deviceName || device.uniqueId || `Device #${device.traccarDeviceId}`}
                  {device.vehicleName ? ` · move from ${device.vehicleName}` : ""}
                </option>
              ))}
            </select>
          </label>
          {chosen?.vehicleName && <p className="break-words text-sm text-caution">This will remove the tracker from {chosen.vehicleName}.</p>}
          <button className={button} disabled={busy || !chosen}>{attached ? "Replace GPS device" : "Install GPS device"}</button>
        </form>
      )}
      {attached && <button type="button" className={button} disabled={busy} onClick={() => save(true)}>Remove GPS device</button>}
    </dialog>
  );
}
