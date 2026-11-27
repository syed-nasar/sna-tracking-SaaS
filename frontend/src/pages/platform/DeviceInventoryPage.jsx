import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformApi } from "../../services/api";
import { PageHeader } from "../../components/WorkspaceUi";

const endpoint = "/platform/devices/inventory";
const separator = " \u00B7 ";
const statuses = ["available", "reserved", "installed", "faulty", "retired"];
const provisioningLabels = { legacy: "Unverified legacy mapping", pending: "Pending", processing: "Processing",
  retry: "Retry scheduled", provisioned: "Provisioned", failed: "Failed", conflict: "Conflict requires review" };
const provisioningActive = (status) => ["pending", "processing", "retry"].includes(status);
const input = "field-control";
const panel = "min-w-0 space-y-4 rounded-panel border border-line bg-panel p-4 shadow-panel sm:p-5";
const action = "control";
const primary = "inline-flex min-h-10 items-center justify-center rounded-lg bg-action px-4 py-2 text-sm font-semibold hover:bg-action-hover disabled:opacity-50";
const attributes = [
  ["uniqueId", "IMEI or unique identifier", 100],
  ["deviceName", "Device name", 150],
  ["manufacturer", "Manufacturer", 100],
  ["model", "Model", 100],
  ["serialNumber", "Serial number", 100],
  ["deviceType", "Device type", 100],
  ["purchaseReference", "Purchase reference", 150],
];

function DeviceForm({ device, busy, onSave, onCancel }) {
  const linked = Boolean(device?.traccarDeviceId);
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      onSave(Object.fromEntries(new FormData(event.currentTarget)));
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {attributes.map(([key, label, max]) => (
          <label className="block space-y-1" key={key}>{label}
            <input className={input} name={key} maxLength={max} defaultValue={device?.[key] ?? ""}
              required={key === "uniqueId" && !linked} disabled={key === "uniqueId" && linked} />
          </label>
        ))}
        <label className="block space-y-1">Purchase date
          <input className={input} name="purchaseDate" type="date" defaultValue={device?.purchaseDate ?? ""} />
        </label>
      </div>
      <label className="block space-y-1">Inventory notes
        <textarea className={input} name="notes" maxLength={2000} rows={3} defaultValue={device?.notes ?? ""} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy}>{device ? "Save device" : "Add inventory device"}</button>
        {onCancel && <button type="button" className={action} disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function TenantChoice({ onChoose, disabled }) {
  const [query, setQuery] = useState("");
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      platformApi.get(`${endpoint}/tenants`, { params: { q: query }, signal: controller.signal })
        .then(({ data }) => {
          setTenants(data);
          setError("");
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not find tenants.");
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <label className="block space-y-1">Find an active tenant
        <input className={input} value={query} maxLength={150} onChange={(event) => {
          setQuery(event.target.value);
          setTenantId("");
          onChoose("");
        }} />
      </label>
      <label className="block space-y-1">Tenant
        <select className={input} value={tenantId} disabled={disabled} onChange={(event) => {
          setTenantId(event.target.value);
          onChoose(event.target.value);
        }}>
          <option value="">Select tenant</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.customerType}, {tenant.slug})</option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    </div>
  );
}

function DeviceHistory({ url, revision }) {
  const [records, setRecords] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    platformApi.get(`${url}/history`, { signal: controller.signal }).then(({ data }) => {
      setRecords(data.data);
      setNext(data.nextCursor);
      setError("");
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load history.");
    });
    return () => controller.abort();
  }, [url, revision]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { data } = await platformApi.get(`${url}/history`, { params: { before: next } });
      setRecords((current) => [...current, ...data.data]);
      setNext(data.nextCursor);
    } catch (error) {
      setError(error.response?.data?.message || "Could not load more history.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-line pt-4">
      <h3 className="font-semibold">Device history</h3>
      {error && <p role="alert" className="text-negative">{error}</p>}
      {!records && !error && <p role="status">Loading history…</p>}
      <ul className="divide-y divide-line text-sm">
        {records?.map((entry) => (
          <li key={entry.id} className="space-y-1 break-words py-2">
            <p className="font-medium capitalize">{entry.action.replaceAll("_", " ")}</p>
            <p className="text-muted">
              {new Date(entry.createdAt).toLocaleString()} · {entry.actorName || "Migration baseline"}
              {entry.actorId ? ` (${entry.actorType} #${entry.actorId})` : ""}
            </p>
            <p className="text-muted">
              {Object.entries(entry.details).filter(([, value]) => value != null).map(([key, value]) =>
                `${key.replace(/([A-Z])/g, " $1")}: ${Array.isArray(value) ? value.join(", ") : value}`
              ).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
      {next && <button className={action} disabled={loadingMore} onClick={loadMore}>Load more history</button>}
    </section>
  );
}

function InstallationControls({ device, url, busy, mutate }) {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState("");
  const canInstall = Boolean(device.tenantId && device.traccarDeviceId &&
    ["reserved", "installed"].includes(device.lifecycleStatus));
  const target = vehicles.find((vehicle) => vehicle.id === vehicleId);

  useEffect(() => {
    if (!canInstall) return;
    const controller = new AbortController();
    platformApi.get(`${url}/vehicles`, { signal: controller.signal }).then(({ data }) => {
      setVehicles(data);
      setError("");
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load vehicles.");
    });
    return () => controller.abort();
  }, [canInstall, url, device.tenantId, device.vehicleId]);

  if (!canInstall) return null;
  return (
    <section className="space-y-3">
      <label className="block space-y-1">Install on vehicle
        <select className={input} value={vehicleId} disabled={busy || !device.allocationReady} onChange={(event) => setVehicleId(event.target.value)}>
          <option value="">Select vehicle</option>
          {vehicles.filter((vehicle) => vehicle.id !== device.vehicleId).map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.name}{vehicle.traccarDeviceId ? " (replace existing device)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={action} disabled={busy || !target || !device.allocationReady} onClick={async () => {
          if (await mutate("put", "/installation", { vehicleId, expectedDeviceId: target.traccarDeviceId })) setVehicleId("");
        }}>{device.vehicleId ? "Move installation" : "Install device"}</button>
        {device.vehicleId && (
          <button className={action} disabled={busy} onClick={() => mutate("put", "/installation", {
            vehicleId: null, expectedDeviceId: device.traccarDeviceId,
          })}>Remove installation</button>
        )}
      </div>
      {error && <p role="alert" className="text-negative">{error}</p>}
    </section>
  );
}

function DeviceDetails({ id, onClose, onChanged }) {
  const [device, setDevice] = useState(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [attempts, setAttempts] = useState([]);
  const [pollPaused, setPollPaused] = useState(false);
  const url = `${endpoint}/${id}`;
  const transitions = {
    available: ["faulty", "retired"],
    reserved: ["faulty"],
    installed: [],
    faulty: device?.tenantId ? ["reserved"] : ["available", "retired"],
    retired: [],
  };

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let polls = 0;
    const load = async () => {
      try {
        const [{ data }, { data: history }] = await Promise.all([
          platformApi.get(url, { signal: controller.signal }),
          platformApi.get(`${url}/provisioning`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setDevice(data);
        setAttempts(history.data);
        if (provisioningActive(data.provisioningStatus)) {
          if (++polls < 30) timer = setTimeout(load, 4000);
          else setPollPaused(true);
        } else if (polls) onChanged();
      } catch (error) {
        if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load device.");
      }
    };
    void load();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, revision, onChanged]);

  async function mutate(method, suffix, data) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await platformApi.request({ method, url: url + suffix, data });
      setPollPaused(false);
      setRevision((value) => value + 1);
      onChanged();
      setNotice(["/link", "/provisioning"].includes(suffix) ? "Provisioning request queued." : "Device updated.");
      return true;
    } catch (error) {
      setError(error.response?.data?.message || "Could not update device.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="break-words text-lg font-bold">Device details {device && `#${device.id}`}</h2>
        <button className={action} onClick={onClose}>Close details</button>
      </header>
      {error && <p role="alert" className="break-words text-negative">{error}</p>}
      {notice && <p role="status" className="text-positive">{notice}</p>}
      {!device && !error && <p role="status">Loading device…</p>}
      {device && (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Inventory lifecycle</dt><dd className="capitalize">{device.lifecycleStatus}</dd></div>
            <div><dt className="text-muted">Live GPS status</dt><dd className="capitalize">{device.gpsStatus}</dd></div>
            <div><dt className="text-muted">Allocated tenant</dt><dd className="break-words">{device.tenantName || "Unallocated"}</dd></div>
            <div><dt className="text-muted">Installed vehicle</dt><dd className="break-words">{device.vehicleName || "Uninstalled"}</dd></div>
            <div><dt className="text-muted">Provisioning</dt><dd role="status">{provisioningLabels[device.provisioningStatus]}</dd></div>
            <div><dt className="text-muted">Last verified</dt><dd>{device.providerVerifiedAt ? new Date(device.providerVerifiedAt).toLocaleString() : "Unavailable"}</dd></div>
            <div><dt className="text-muted">Traccar ID</dt><dd>{device.traccarDeviceId || "Unlinked"}</dd></div>
            <div><dt className="text-muted">Installed at</dt><dd>{device.installedAt ? new Date(device.installedAt).toLocaleString() : "Unavailable"}</dd></div>
          </dl>
          <section className="space-y-2" aria-label="GPS provisioning">
            {!device.allocationReady && <p className="text-sm text-muted">Verify provisioning before assigning, allocating, or installing this device.</p>}
            {attempts[0]?.reason && <p className="text-sm text-caution">{attempts[0].reason}</p>}
            {(pollPaused || error) && <button type="button" className={action} onClick={() => {
              setPollPaused(false);
              setError("");
              setRevision((value) => value + 1);
            }}>Refresh provisioning status</button>}
            {!provisioningActive(device.provisioningStatus) && !["retired", "faulty"].includes(device.lifecycleStatus) && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy} onClick={() => mutate("post", "/provisioning", {
                  action: device.traccarDeviceId ? "verify" : "provision",
                })}>{device.traccarDeviceId ? "Verify existing mapping" : "Provision device"}</button>
                {["failed", "conflict"].includes(device.provisioningStatus) && (
                  <button type="button" className={action} disabled={busy}
                    onClick={() => mutate("post", "/provisioning", { action: "retry" })}>Retry provisioning</button>
                )}
              </div>
            )}
            {!!attempts.length && <details>
              <summary className="cursor-pointer text-sm">Provisioning attempt history</summary>
              <ul className="space-y-2 py-2 text-sm">{attempts.map((attempt) => (
                <li key={attempt.id}>
                  <p>{new Date(attempt.createdAt).toLocaleString()}{separator}{provisioningLabels[attempt.status]}{separator}{attempt.attemptCount} {attempt.attemptCount === 1 ? "run" : "runs"}</p>
                  {attempt.reason && <p className="text-muted">{attempt.reason}</p>}
                  <ul className="ps-4 text-muted">{attempt.events.map((event) => (
                    <li key={event.id}>{new Date(event.createdAt).toLocaleString()}{separator}{event.action.replaceAll("_", " ")}</li>
                  ))}</ul>
                </li>
              ))}</ul>
            </details>}
          </section>
          <DeviceForm key={revision} device={device} busy={busy} onSave={(data) => mutate("patch", "", data)} />
          {(!device.traccarDeviceId || !device.identifierVerified) && !provisioningActive(device.provisioningStatus) && !["retired", "faulty"].includes(device.lifecycleStatus) && (
            <form className="space-y-2 border-t border-line pt-4" onSubmit={(event) => {
              event.preventDefault();
              const traccarDeviceId = new FormData(event.currentTarget).get("traccarDeviceId");
              void mutate("patch", "/link", { traccarDeviceId });
            }}>
              <label className="block space-y-1">Existing Traccar ID
                <input className={input} name="traccarDeviceId" inputMode="numeric" pattern="[0-9]+" required defaultValue={device.traccarDeviceId ?? ""} />
              </label>
              <button className={action} disabled={busy}>{device.traccarDeviceId ? "Verify Traccar identifier" : "Link existing Traccar device"}</button>
            </form>
          )}
          {["available", "reserved"].includes(device.lifecycleStatus) && (
            <section className="space-y-2 border-t border-line pt-4">
              <TenantChoice key={device.tenantId || "unallocated"} disabled={busy || !device.allocationReady} onChoose={setTenantId} />
              <button className={action} disabled={busy || !device.allocationReady || !tenantId || tenantId === device.tenantId}
                onClick={async () => {
                  if (await mutate("patch", "/allocation", {
                    action: device.tenantId ? "transfer" : "allocate", tenantId,
                  })) setTenantId("");
                }}>{device.tenantId ? "Transfer to tenant" : "Allocate to tenant"}</button>
            </section>
          )}
          {device.tenantId && ["reserved", "faulty"].includes(device.lifecycleStatus) && (
            <button className={action} disabled={busy} onClick={() => mutate("patch", "/allocation", { action: "release" })}>
              Release allocation
            </button>
          )}
          <InstallationControls device={device} url={url} busy={busy} mutate={mutate} />
          {transitions[device.lifecycleStatus].length > 0 && (
            <form className="space-y-2" key={device.lifecycleStatus} onSubmit={(event) => {
              event.preventDefault();
              const lifecycleStatus = new FormData(event.currentTarget).get("lifecycleStatus");
              void mutate("patch", "/lifecycle", { lifecycleStatus });
            }}>
              <label className="block space-y-1">Change inventory lifecycle
                <select className={input} name="lifecycleStatus" required defaultValue="">
                  <option value="">Select status</option>
                  {transitions[device.lifecycleStatus].map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <button className={action} disabled={busy}>Save lifecycle</button>
            </form>
          )}
          <DeviceHistory url={url} revision={revision} />
        </>
      )}
    </section>
  );
}

export default function DeviceInventoryPage() {
  const [query, setQuery] = useState({ q: "", lifecycle: "", offset: 0 });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const [registrationNotice, setRegistrationNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    platformApi.get(endpoint, { params: query, signal: controller.signal }).then(({ data }) => {
      setResult(data);
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load inventory.");
    });
    return () => controller.abort();
  }, [query, revision]);

  async function create(data) {
    setBusy(true);
    setError("");
    try {
      const response = await platformApi.post(endpoint, data);
      setCreating(false);
      setSelected(response.data.id);
      setRegistrationNotice("Inventory registered. SNA will provision it before allocation.");
      refresh();
    } catch (error) {
      setError(error.response?.data?.message || "Could not add device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-canvas text-ink">
      <div className="mx-auto max-w-7xl space-y-5 p-5 sm:p-8">
        <Link className="text-sm text-accent" to="/platform/dashboard">Platform dashboard</Link>
        <PageHeader title="GPS Device Inventory" compact>
          <button className={primary} onClick={() => { setCreating(true); setSelected(null); }}>New device</button>
        </PageHeader>
        {registrationNotice && <p role="status" className="text-positive">{registrationNotice}</p>}
        {error && <p role="alert" className="text-negative">{error}</p>}
        {result?.traccarAvailable === false && <p role="status" className="text-caution">Traccar is unavailable. Inventory records are still accessible.</p>}
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <section className={panel}>
            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]" onSubmit={(event) => {
              event.preventDefault();
              setError("");
              setResult(null);
              setQuery({ ...Object.fromEntries(new FormData(event.currentTarget)), offset: 0 });
            }}>
              <input aria-label="Search devices" className={input} name="q" maxLength={150} placeholder="Search inventory" />
              <select aria-label="Filter lifecycle" className={input} name="lifecycle">
                <option value="">All lifecycles</option>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
              <button className={action}>Search</button>
            </form>
            {!result && !error && <p role="status">Loading inventory…</p>}
            {result?.data.length === 0 && <p className="text-sm text-muted">No devices match this search.</p>}
            <ul className="divide-y divide-line">
              {result?.data.map((device) => (
                <li key={device.id} className="py-3">
                  <button className="flex w-full flex-wrap items-start justify-between gap-2 text-left hover:text-accent"
                    onClick={() => { setSelected(device.id); setCreating(false); }}>
                    <span className="min-w-0 break-words font-medium">{device.deviceName || device.uniqueId || `Device #${device.id}`}</span>
                    <span className="text-sm capitalize text-accent">{device.lifecycleStatus}{separator}{provisioningLabels[device.provisioningStatus]}</span>
                  </button>
                  <p className="break-words text-sm text-muted">
                    {[device.uniqueId, device.tenantName, device.vehicleName].filter(Boolean).join(" · ") || "Unallocated"}
                  </p>
                </li>
              ))}
            </ul>
            {result && (
              <div className="flex flex-wrap gap-2">
                <button className={action} disabled={!query.offset} onClick={() => {
                  setQuery({ ...query, offset: Math.max(0, query.offset - result.pagination.limit) });
                  setResult(null);
                }}>Previous</button>
                <button className={action} disabled={!result.pagination.hasMore} onClick={() => {
                  setQuery({ ...query, offset: query.offset + result.pagination.limit });
                  setResult(null);
                }}>Next</button>
              </div>
            )}
          </section>
          {creating && (
            <section className={panel}>
              <h2 className="text-lg font-bold">New inventory device</h2>
              <DeviceForm onSave={create} busy={busy} onCancel={() => setCreating(false)} />
            </section>
          )}
          {selected && <DeviceDetails key={selected} id={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
        </div>
      </div>
    </main>
  );
}
