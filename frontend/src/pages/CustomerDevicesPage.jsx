import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TenantLayout from "../components/TenantLayout";
import { PageHeader } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

export default function CustomerDevicesPage() {
  const { session } = useAuth();
  const title = session.profile.customerType === "personal" ? "My GPS Devices" : "Fleet GPS Devices";
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState("");
  const [connectivity, setConnectivity] = useState(null);
  const [connectivityError, setConnectivityError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get("/vehicles/devices", { signal: controller.signal }).then(({ data }) => setDevices(data))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load GPS devices.");
      });
    tenantApi.get("/connectivity", { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setConnectivity(new Map(data.map((item) => [item.deviceId, item]))); })
      .catch(() => { if (!controller.signal.aborted) setConnectivityError(true); });
    return () => controller.abort();
  }, []);

  return (
    <TenantLayout title={title}>
      <main className="mx-auto max-w-5xl space-y-5 p-5 sm:p-8">
        <PageHeader title={title} compact>
          <Link className="control" to="/vehicles">View vehicles</Link>
        </PageHeader>
        {error && <p role="alert" className="text-negative">{error}</p>}
        {!devices && !error && <p role="status">Loading GPS devices…</p>}
        {devices?.length === 0 && <p className="text-muted">There are no GPS devices allocated to this account.</p>}
        <ul className="grid gap-4 sm:grid-cols-2">
          {devices?.map((device) => {
            const sim = connectivity?.get(device.id);
            return (
            <li className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-5" key={device.id}>
              <h2 className="break-words font-semibold">
                {device.deviceName || [device.manufacturer, device.model].filter(Boolean).join(" ") || "GPS device"}
              </h2>
              {device.uniqueId && <p className="break-all text-sm text-muted">{device.uniqueId}</p>}
              <dl className="grid gap-3 text-sm">
                <div><dt className="text-muted">Inventory status</dt><dd className="capitalize">{device.lifecycleStatus}</dd></div>
                <div><dt className="text-muted">Live GPS status</dt><dd className="capitalize">{device.gpsStatus}</dd></div>
                <div><dt className="text-muted">Vehicle</dt><dd className="break-words">{device.vehicleName || "Uninstalled"}</dd></div>
              </dl>
              <section className="space-y-2 border-t border-line pt-3 text-sm">
                <h3 className="font-semibold">SIM connectivity</h3>
                {connectivityError || (connectivity && (!sim || sim.carrierStatus === "unavailable")) ? (
                  <p className="text-muted">Connectivity information unavailable.</p>
                ) : !connectivity ? (
                  <p role="status" className="text-muted">Loading connectivity…</p>
                ) : (
                  <dl className="grid gap-2">
                    <div><dt className="text-muted">Operator</dt><dd>{sim.operatorName || "Unrecorded"}</dd></div>
                    {sim.maskedSimReference && <div><dt className="text-muted">SIM reference</dt><dd>{sim.maskedSimReference}</dd></div>}
                    {sim.planName && <div><dt className="text-muted">Connectivity plan</dt><dd className="break-words">{sim.planName}</dd></div>}
                    {sim.expiresAt && <div><dt className="text-muted">Planned expiry</dt>
                      <dd>{sim.expiresAt.slice(0, 10)} UTC · {sim.daysRemaining <= 0 ? "Expired" : `${sim.daysRemaining} days remaining`}</dd></div>}
                    <div><dt className="text-muted">Carrier status and usage</dt><dd>Not integrated</dd></div>
                  </dl>
                )}
              </section>
            </li>
            );
          })}
        </ul>
      </main>
    </TenantLayout>
  );
}
