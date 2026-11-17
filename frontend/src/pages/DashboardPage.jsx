
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Activity,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import TenantLayout from "../components/TenantLayout";
import { tenantApi } from "../services/api";

function StatCard({ title, value, icon: Icon, description }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111827] p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-slate-400">{title}</span>

        <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
          <Icon size={21} />
        </div>
      </div>

      <p className="text-3xl font-bold tracking-tight text-white">
        {value}
      </p>

      <p className="mt-2 text-xs text-slate-500">
        {description}
      </p>
    </div>
  );
}

function VehicleStatus({ status }) {
  const normalized = String(status || "unknown").toLowerCase();

  const style =
    normalized === "active"
      ? "bg-emerald-500/10 text-emerald-400"
      : normalized === "inactive"
        ? "bg-slate-500/10 text-slate-400"
        : "bg-amber-500/10 text-amber-400";

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
      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
        {/* Page Heading */}
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-blue-400">
              {labels.eyebrow}
            </p>

            <h2 className="text-3xl font-bold tracking-tight">
              {labels.heading}
            </h2>

            <p className="mt-3 text-sm text-slate-400">
              Welcome, {profile?.fullName || "User"}.{" "}
              {labels.welcome}
            </p>
          </div>

          <button
            type="button"
            onClick={loadVehicles}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              size={17}
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

        {/* Statistics */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            title={labels.totalTitle}
            value={loading || error ? "—" : counts.total}
            icon={Truck}
            description={labels.totalDescription}
          />

          <StatCard
            title="Active Vehicles"
            value={loading || error ? "—" : counts.active}
            icon={Activity}
            description={labels.activeDescription}
          />

          <StatCard
            title="Inactive Vehicles"
            value={loading || error ? "—" : counts.inactive}
            icon={ShieldCheck}
            description={labels.inactiveDescription}
          />
        </div>

        {/* Vehicles Table */}
        <section className="mt-9 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-6">
            <div>
              <h3 className="text-lg font-bold">
                {labels.tableTitle}
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                {labels.tableDescription}
              </p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search vehicles..."
                className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="m-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
              <LoaderCircle
                size={22}
                className="animate-spin"
              />
              Loading vehicles...
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-slate-500">
              Unable to display vehicles. Try Refresh.
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="py-16 px-6 text-center text-sm text-slate-500">
              {search
                ? "No vehicles match your search."
                : labels.emptyMessage}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left">
                <thead className="bg-white/[0.025] text-xs uppercase tracking-wider text-slate-500">
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
                      className="border-t border-white/5 transition hover:bg-white/[0.025]"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-400">
                            <Truck size={19} />
                          </div>

                          <span className="font-semibold">
                            {vehicle.name ||
                              `Vehicle ${vehicle.id}`}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-5 text-sm text-slate-400">
                        {vehicle.registrationNumber || "—"}
                      </td>

                      <td className="px-6 py-5">
                        <VehicleStatus
                          status={vehicle.status}
                        />
                      </td>

                      <td className="px-6 py-5 text-sm text-slate-400">
                        #{vehicle.id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
            <p className="text-xs text-slate-500">
              Showing {error ? 0 : filteredVehicles.length} of{" "}
              {error ? 0 : vehicles.length} vehicles
            </p>

            <span className="text-xs text-slate-600">
              SNA Fleet Management
            </span>
          </div>
        </section>
      </main>
    </TenantLayout>
  );
}
