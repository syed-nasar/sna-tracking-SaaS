
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react";

import { MetricCard, PageHeader } from "../../components/WorkspaceUi";
import { platformApi } from "../../services/api";
import ConnectivitySummary from "./connectivity/ConnectivitySummary";
import { BillingReport } from "../billing/BillingOverview";
import { useConnectivityGet } from "./connectivity/connectivity-data";

function StatusBadge({ status }) {
  const styles = {
    active: "bg-positive-soft text-positive",
    suspended: "bg-caution-soft text-caution",
    inactive: "bg-hover text-muted",
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
          ? "bg-special-soft text-special"
          : isBusiness
            ? "bg-accent-soft text-accent"
            : "bg-hover text-muted"
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

export default function PlatformDashboard() {
  const connectivity = useConnectivityGet("/summary");
  const navigate = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const loadTenants = async (nextOffset = 0) => {
    setLoading(true);
    setError("");

    try {
      const response = await platformApi.get(
        "/platform/tenants", { params: { offset: nextOffset } }
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
      setPageSize(limit);
      setOffset(nextOffset);
      setHasMore(items.length === limit && limit > 0);
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

  return (
    <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-5 sm:px-7 sm:py-7">
      <PageHeader title="Dashboard Overview" description="Customer accounts, tracker inventory, connectivity and billing.">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => navigate("/platform/devices")}
            className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-secondary hover:bg-hover">
            GPS Device Inventory
          </button>
          <button
            type="button"
            onClick={() =>
              navigate("/platform/tenants/new")
            }
            className="inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-sm font-semibold text-ink transition hover:bg-action-hover"
          >
            <Plus size={18} />
            Create Customer
          </button>

          <button
            type="button"
            onClick={() => loadTenants(offset)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm font-medium text-secondary transition hover:bg-hover disabled:opacity-50"
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
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
            busy={loading}
          title="Loaded Customers"
          value={error ? "—" : statistics.total}
          icon={Users}
          description="Loaded customer accounts"
        />

        <MetricCard
            busy={loading}
          title="Business Customers"
          value={error ? "—" : statistics.business}
          icon={Building2}
          description="Fleet operators"
        />

        <MetricCard
            busy={loading}
          title="Personal Customers"
          value={error ? "—" : statistics.personal}
          icon={UserRound}
          description="Individual vehicle owners"
        />

        <MetricCard
            busy={loading}
          title="Active Customers"
          value={error ? "—" : statistics.active}
          icon={Activity}
          description="Currently active accounts"
        />
      </div>

      {!loading && !error && statistics.total > 0 && (
        <section className="space-y-2 rounded-panel border border-line bg-panel p-4 shadow-panel">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <h2 className="font-semibold">Active customer accounts</h2>
            <p className="text-muted">{statistics.active} of {statistics.total} loaded</p>
          </div>
          <meter min={0} max={statistics.total} value={statistics.active}
            aria-label="Active customer accounts in the loaded page" className="h-2 w-full accent-action" />
        </section>
      )}
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <ConnectivitySummary {...connectivity} compact />
        <BillingReport compact />
      </div>

      <section className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-6">
          <div>
            <h3 className="text-lg font-bold">
              Registered Customers
            </h3>

            <p className="mt-1 text-sm text-subtle">
              Personal and business accounts
              registered on the platform
            </p>
          </div>

          <div className="flex w-full flex-wrap gap-3 sm:w-auto">
            <div className="relative min-w-[180px] flex-1 sm:w-64">
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
                placeholder="Search this page…"
                aria-label="Search customers on this page"
                className="w-full rounded-xl border border-line bg-field py-2.5 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent-line"
              />
            </div>

            <select
              value={customerFilter}
              onChange={(event) =>
                setCustomerFilter(event.target.value)
              }
              aria-label="Filter by customer type"
              className="rounded-xl border border-line bg-field px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-line"
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
            Loading customers...
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="py-20 text-center text-sm text-subtle">
            {error
              ? "Unable to display customers."
              : search || customerFilter !== "all"
                ? "No customers match your filters."
                : "No customers registered yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-hover">
                <tr className="text-xs uppercase tracking-wider text-subtle">
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
                      className="cursor-pointer border-t border-line transition hover:bg-hover focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              isPersonal
                                ? "bg-special-soft text-special"
                                : "bg-accent-soft text-accent"
                            }`}
                          >
                            <Icon size={19} />
                          </div>

                          <div>
                            <p className="font-semibold text-ink">
                              {tenant.name}
                            </p>

                            <p className="mt-1 text-xs text-subtle">
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

                      <td className="px-6 py-5 text-sm text-muted">
                        {tenant.email || "-"}
                      </td>

                      <td className="px-6 py-5">
                        <StatusBadge
                          status={tenant.status}
                        />
                      </td>

                      <td className="px-6 py-5 text-sm text-muted">
                        #{tenant.id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          <p className="text-xs text-subtle">
            Showing {filteredTenants.length} of{" "}
            {tenants.length} loaded customers
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="control" disabled={loading || !offset}
              onClick={() => loadTenants(Math.max(0, offset - pageSize))}>Previous</button>
            <button type="button" className="control" disabled={loading || !hasMore}
              onClick={() => loadTenants(offset + pageSize)}>Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}
