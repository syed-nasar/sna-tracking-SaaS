import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TenantLayout from "../components/TenantLayout";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

export default function CustomerDevicesPage() {
  const { session } = useAuth();
  const title = session.profile.customerType === "personal" ? "My GPS Devices" : "Fleet GPS Devices";
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get("/vehicles/devices", { signal: controller.signal }).then(({ data }) => setDevices(data))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load GPS devices.");
      });
    return () => controller.abort();
  }, []);

  return (
    <TenantLayout title={title}>
      <main className="mx-auto max-w-5xl space-y-5 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          <Link className="text-sm text-blue-300" to="/vehicles">View vehicles</Link>
        </div>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {!devices && !error && <p role="status">Loading GPS devices…</p>}
        {devices?.length === 0 && <p className="text-slate-400">There are no GPS devices allocated to this account.</p>}
        <ul className="grid gap-4 sm:grid-cols-2">
          {devices?.map((device) => (
            <li className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-[#111827] p-5" key={device.id}>
              <h2 className="break-words font-semibold">
                {device.deviceName || [device.manufacturer, device.model].filter(Boolean).join(" ") || "GPS device"}
              </h2>
              {device.uniqueId && <p className="break-all text-sm text-slate-400">{device.uniqueId}</p>}
              <dl className="grid gap-3 text-sm">
                <div><dt className="text-slate-400">Inventory status</dt><dd className="capitalize">{device.lifecycleStatus}</dd></div>
                <div><dt className="text-slate-400">Live GPS status</dt><dd className="capitalize">{device.gpsStatus}</dd></div>
                <div><dt className="text-slate-400">Vehicle</dt><dd className="break-words">{device.vehicleName || "Uninstalled"}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </main>
    </TenantLayout>
  );
}
