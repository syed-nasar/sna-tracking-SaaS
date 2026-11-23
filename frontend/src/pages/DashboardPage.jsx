
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  Activity,
  ArrowUpRight,
  Cpu,
  MapPinned,
  Receipt,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { MetricCard, PageHeader } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import TenantLayout from "../components/TenantLayout";
import { tenantApi } from "../services/api";

function VehicleStatus({ status }) {
  const normalized = String(status || "unknown").toLowerCase();

  const style =
    normalized === "active"
      ? "bg-positive-soft text-positive"
      : normalized === "inactive"
        ? "bg-hover text-muted"
        : "bg-caution-soft text-caution";

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${style}`}
    >
      {normalized}
    </span>
  );
}

export default function DashboardPage() {
  const { session } = useAuth();
  const profile = session?.profile;

  const isPersonal = profile?.customerType === "personal";

  const labels = isPersonal
    ? {
        layoutTitle: "My Vehicles",
        eyebrow: "Personal Vehicle Tracking",
        heading: "My Vehicle Dashboard",
        welcome: "Track and manage your personal vehicles.",
        totalTitle: "My Vehicles",
        totalDescription: "Vehicles registered to your account",
        activeDescription: "Your vehicles marked active",
        inactiveDescription: "Your vehicles marked inactive",
        tableTitle: "My Vehicles",
        tableDescription: "Vehicles registered to your account",
        emptyMessage:
          "You haven't added any vehicles yet. Contact SNA Technologies to register your first vehicle and start tracking.",
      }
    : {
        layoutTitle: "Fleet Overview",
        eyebrow: "Fleet Operations",
        heading: "Dashboard Overview",
        welcome: `Manage vehicles for ${
          profile?.tenantName || "your company"
        }.`,
        totalTitle: "Total Vehicles",
        totalDescription: "Vehicles returned for this company",
        activeDescription: "Vehicles marked active",
        inactiveDescription: "Vehicles marked inactive",
        tableTitle: "Company Vehicles",
        tableDescription: "Vehicle records visible to your tenant account",
        emptyMessage: "No vehicles registered for your company yet.",
      };

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await tenantApi.get("/vehicles");
      const payload = response.data;

      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.vehicles)
            ? payload.vehicles
            : null;

      if (!items) {
        throw new Error("Unexpected vehicles API response");
      }

      setVehicles(items);
    } catch (err) {
      setVehicles([]);

      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to load vehicles"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const counts = useMemo(
    () => ({
      total: vehicles.length,
      online: vehicles.filter((vehicle) => vehicle.gpsStatus === "online").length,
      hasGpsStatus: vehicles.some((vehicle) => ["online", "offline"].includes(vehicle.gpsStatus)),

      active: vehicles.filter(
        (vehicle) =>
          String(vehicle.status).toLowerCase() === "active"
      ).length,

      inactive: vehicles.filter(
        (vehicle) =>
          String(vehicle.status).toLowerCase() === "inactive"
      ).length,
    }),
    [vehicles]
  );

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return vehicles;
    }

    return vehicles.filter((vehicle) =>
      [
        vehicle.name,
        vehicle.registrationNumber,
        vehicle.traccarDeviceId,
        vehicle.make,
        vehicle.model,
        vehicle.id,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      )
    );
  }, [vehicles, search]);

  return (
    <TenantLayout title={labels.layoutTitle}>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
        <PageHeader title={labels.heading} description={`Welcome, ${profile?.fullName || "User"}. ${labels.welcome}`}>
          <button
            type="button"
            onClick={loadVehicles}
            disabled={loading}
            className="control"
          >
            <RefreshCw
              size={17}
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </PageHeader>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            busy={loading}
            title={labels.totalTitle}
            value={loading || error ? "—" : counts.total}
            icon={Truck}
            description={labels.totalDescription}
          />

          <MetricCard
            busy={loading}
            title="Active Vehicles"
            value={loading || error ? "—" : counts.active}
            icon={Activity}
            description={labels.activeDescription}
          />

          <MetricCard
            busy={loading}
            title="Inactive Vehicles"
            value={loading || error ? "—" : counts.inactive}
            icon={ShieldCheck}
            description={labels.inactiveDescription}
          />
          <MetricCard busy={loading} title="GPS online" value={error || (counts.total > 0 && !counts.hasGpsStatus) ? "—" : counts.online}
            icon={MapPinned} tone="positive" description="Online according to Traccar" />
        </div>

        <nav aria-label="Quick access" className="mt-4 flex flex-wrap gap-2">
          {[
            ["/tracking", isPersonal ? "My Tracking" : "Live Fleet Tracking", MapPinned],
            ["/vehicles", isPersonal ? "My Vehicles" : "Fleet Vehicles", Truck],
            ["/devices", "GPS Devices", Cpu],
            ...(profile?.role === "tenant_admin" ? [["/billing", "Billing", Receipt]] : []),
          ].map(([path, label, Icon]) => <Link className="control" to={path} key={path}>
            <Icon size={16} aria-hidden="true" />{label}<ArrowUpRight size={13} aria-hidden="true" />
          </Link>)}
        </nav>

        {/* Vehicles Table */}
        <section className="mt-6 overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-6">
            <div>
              <h3 className="text-lg font-bold">
                {labels.tableTitle}
              </h3>

              <p className="mt-1 text-sm text-subtle">
                {labels.tableDescription}
              </p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
              />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search vehicles..."
                className="w-full rounded-xl border border-line bg-field py-2.5 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent-line"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="m-6 rounded-xl border border-negative-line bg-negative-soft p-4 text-sm text-negative"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-20 text-muted">
              <LoaderCircle
                size={22}
                className="animate-spin"
              />
              Loading vehicles...
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-subtle">
              Unable to display vehicles. Try Refresh.
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="py-16 px-6 text-center text-sm text-subtle">
              {search
                ? "No vehicles match your search."
                : labels.emptyMessage}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left">
                <thead className="bg-hover text-xs uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-6 py-4 font-semibold">
                      Vehicle
                    </th>

                    <th className="px-6 py-4 font-semibold">
                      Registration
                    </th>

                    <th className="px-6 py-4 font-semibold">
                      Status
                    </th>

                    <th className="px-6 py-4 font-semibold">
                      Vehicle ID
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredVehicles.map((vehicle) => (
                    <tr
                      key={vehicle.id}
                      className="border-t border-line transition hover:bg-hover"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-accent-soft p-2.5 text-accent">
                            <Truck size={19} />
                          </div>

                          <span className="font-semibold">
                            {vehicle.name ||
                              `Vehicle ${vehicle.id}`}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-5 text-sm text-muted">
                        {vehicle.registrationNumber || "—"}
                      </td>

                      <td className="px-6 py-5">
                        <VehicleStatus
                          status={vehicle.status}
                        />
                      </td>

                      <td className="px-6 py-5 text-sm text-muted">
                        #{vehicle.id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line px-6 py-4">
            <p className="text-xs text-subtle">
              Showing {error ? 0 : filteredVehicles.length} of{" "}
              {error ? 0 : vehicles.length} vehicles
            </p>

            <span className="text-xs text-subtle">
              SNA Fleet Management
            </span>
          </div>
        </section>
      </main>
    </TenantLayout>
  );
}
