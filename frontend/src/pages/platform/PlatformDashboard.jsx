
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { platformApi } from "../../services/api";
import ConnectivitySummary from "./connectivity/ConnectivitySummary";
import { useConnectivityGet } from "./connectivity/connectivity-data";
import { useAuth } from "../../context/AuthContext";

function StatusBadge({ status }) {
  const styles = {
    active: "bg-emerald-500/10 text-emerald-400",
    suspended: "bg-amber-500/10 text-amber-400",
    inactive: "bg-slate-500/10 text-slate-400",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${
        styles[status] || styles.inactive
      }`}
    >
      {status || "Unknown"}
    </span>
  );
}

function CustomerTypeBadge({ type }) {
  const isPersonal = type === "personal";
  const isBusiness = type === "business";

  const Icon = isPersonal ? UserRound : Building2;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        isPersonal
          ? "bg-violet-500/10 text-violet-400"
          : isBusiness
            ? "bg-blue-500/10 text-blue-400"
            : "bg-slate-500/10 text-slate-400"
      }`}
    >
      {(isPersonal || isBusiness) && (
        <Icon size={13} />
      )}
      {isPersonal
        ? "Personal"
        : isBusiness
          ? "Business"
          : "Unknown"}
    </span>
  );
}

function StatCard({ title, value, icon: Icon, description }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111827] p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {title}
        </span>

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

export default function PlatformDashboard() {
  const connectivity = useConnectivityGet("/summary");
  const navigate = useNavigate();
  const { session, logout } = useAuth();

  const [tenants, setTenants] = useState([]);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const loadTenants = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await platformApi.get(
        "/platform/tenants"
      );

      const items = response.data?.data;
      const pagination = response.data?.pagination;

      if (!Array.isArray(items)) {
        throw new Error(
          "Unexpected tenant API response"
        );
      }

      setTenants(items);

      const limit = Number(pagination?.limit || 50);
      const offset = Number(pagination?.offset || 0);

      setHasMore(
        items.length === limit &&
        limit > 0 &&
        offset === 0
      );
    } catch (err) {
      setTenants([]);
      setHasMore(false);

      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to load customers"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const statistics = useMemo(() => {
    return {
      total: tenants.length,
      business: tenants.filter(
        (tenant) => tenant.customer_type === "business"
      ).length,
      personal: tenants.filter(
        (tenant) => tenant.customer_type === "personal"
      ).length,
      active: tenants.filter(
        (tenant) => tenant.status === "active"
      ).length,
    };
  }, [tenants]);

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tenants.filter((tenant) => {
      const matchesType =
        customerFilter === "all" ||
        tenant.customer_type === customerFilter;

      const matchesSearch =
        !query ||
        [
          tenant.name,
          tenant.slug,
          tenant.email,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query)
        );

      return matchesType && matchesSearch;
    });
  }, [tenants, search, customerFilter]);

  const handleLogout = () => {
    logout();
    navigate("/platform/login", {
      replace: true,
    });
  };

  const navItems = [
    {
      label: "Overview",
      icon: LayoutDashboard,
      active: true,
    },
    {
      label: "Customers",
      icon: Users,
      active: false,
    },
    {
      label: "Administrators",
      icon: ShieldCheck,
      active: false,
    },
  ];

  return (
    <div className="min-h-screen bg-[#090d16] text-white">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/10 bg-[#0d1422] transition-transform lg:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2.5">
              <Truck size={23} />
            </div>

            <div>
              <h1 className="text-sm font-bold">
                SNA Fleet
              </h1>

              <p className="text-xs text-slate-400">
                Platform Console
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="text-slate-400 lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 pt-7">
          <p className="mb-4 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </p>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  aria-current={
                    item.active ? "page" : undefined
                  }
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
                    item.active
                      ? "bg-blue-600/15 text-blue-400"
                      : "text-slate-500"
                  }`}
                >
                  <Icon size={19} />
                  {item.label}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto border-t border-white/10 p-4">
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
              <ShieldCheck size={21} />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {session?.profile?.fullName || "Platform Admin"}
              </p>

              <p className="truncate text-xs text-slate-500">
                Super Administrator
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/10 bg-[#090d16]/95 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="text-slate-300 lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu size={24} />
            </button>

            <div>
              <p className="text-sm font-semibold">
                Platform Overview
              </p>

              <p className="text-xs text-slate-500">
                SNA Fleet Management
              </p>
            </div>
          </div>

          <span className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400 sm:inline-flex">
            <Activity size={14} />
            Platform Console
          </span>
        </header>

        <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
          <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="mb-2 text-sm font-semibold text-blue-400">
                Administration
              </p>

              <h2 className="text-3xl font-bold tracking-tight">
                Dashboard Overview
              </h2>

              <p className="mt-3 text-sm text-slate-400">
                Manage personal customers and business
                fleets across your tracking platform.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => navigate("/platform/devices")}
                className="rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm text-slate-300 hover:bg-white/10">
                GPS Device Inventory
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate("/platform/tenants/new")
                }
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                <Plus size={18} />
                Create Customer
              </button>

              <button
                type="button"
                onClick={loadTenants}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw
                  size={17}
                  className={
                    loading ? "animate-spin" : ""
                  }
                />
                Refresh
              </button>
            </div>
          </div>

          <div className="mb-6">
            <ConnectivitySummary {...connectivity} compact />
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Customers"
              value={loading ? "-" : statistics.total}
              icon={Users}
              description="Loaded customer accounts"
            />

            <StatCard
              title="Business Customers"
              value={loading ? "-" : statistics.business}
              icon={Building2}
              description="Fleet operators"
            />

            <StatCard
              title="Personal Customers"
              value={loading ? "-" : statistics.personal}
              icon={UserRound}
              description="Individual vehicle owners"
            />

            <StatCard
              title="Active Customers"
              value={loading ? "-" : statistics.active}
              icon={Activity}
              description="Currently active accounts"
            />
          </div>

          {hasMore && !loading && (
            <p className="mt-4 text-xs text-amber-400">
              Showing the first 50 customer records.
              Additional records may exist. Full pagination
              will be added separately.
            </p>
          )}

          <section className="mt-9 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-6">
              <div>
                <h3 className="text-lg font-bold">
                  Registered Customers
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Personal and business accounts
                  registered on the platform
                </p>
              </div>

              <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                <div className="relative min-w-[180px] flex-1 sm:w-64">
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
                    placeholder="Search customers..."
                    aria-label="Search customers"
                    className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500"
                  />
                </div>

                <select
                  value={customerFilter}
                  onChange={(event) =>
                    setCustomerFilter(event.target.value)
                  }
                  aria-label="Filter by customer type"
                  className="rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                >
                  <option value="all">
                    All Customers
                  </option>
                  <option value="business">
                    Business
                  </option>
                  <option value="personal">
                    Personal
                  </option>
                </select>
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
                Loading customers...
              </div>
            ) : filteredTenants.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-500">
                {error
                  ? "Unable to display customers."
                  : search || customerFilter !== "all"
                    ? "No customers match your filters."
                    : "No customers registered yet."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead className="bg-white/[0.025]">
                    <tr className="text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-6 py-4 font-semibold">
                        Customer
                      </th>
                      <th className="px-6 py-4 font-semibold">
                        Type
                      </th>
                      <th className="px-6 py-4 font-semibold">
                        Email
                      </th>
                      <th className="px-6 py-4 font-semibold">
                        Status
                      </th>
                      <th className="px-6 py-4 font-semibold">
                        Tenant ID
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredTenants.map((tenant) => {
                      const isPersonal =
                        tenant.customer_type === "personal";

                      const Icon = isPersonal
                        ? UserRound
                        : Building2;

                      return (
                        <tr
                          key={tenant.id}
                          onClick={() =>
                            navigate(
                              `/platform/tenants/${tenant.id}`
                            )
                          }
                          tabIndex={0}
                          role="link"
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" ||
                              event.key === " "
                            ) {
                              event.preventDefault();
                              navigate(
                                `/platform/tenants/${tenant.id}`
                              );
                            }
                          }}
                          className="cursor-pointer border-t border-white/5 transition hover:bg-white/[0.025] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-500"
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                  isPersonal
                                    ? "bg-violet-500/10 text-violet-400"
                                    : "bg-blue-500/10 text-blue-400"
                                }`}
                              >
                                <Icon size={19} />
                              </div>

                              <div>
                                <p className="font-semibold text-white">
                                  {tenant.name}
                                </p>

                                <p className="mt-1 text-xs text-slate-500">
                                  {tenant.slug}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 py-5">
                            <CustomerTypeBadge
                              type={tenant.customer_type}
                            />
                          </td>

                          <td className="px-6 py-5 text-sm text-slate-400">
                            {tenant.email || "-"}
                          </td>

                          <td className="px-6 py-5">
                            <StatusBadge
                              status={tenant.status}
                            />
                          </td>

                          <td className="px-6 py-5 text-sm text-slate-400">
                            #{tenant.id}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
              <p className="text-xs text-slate-500">
                Showing {filteredTenants.length} of{" "}
                {tenants.length} loaded customers
              </p>

              <span className="text-xs text-slate-600">
                SNA Fleet Platform
              </span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
