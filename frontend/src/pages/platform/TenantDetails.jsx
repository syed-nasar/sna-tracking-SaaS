
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import InvitationDelivery from "./InvitationDelivery";
import useInvitationStatus from "./useInvitationStatus";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import { platformApi } from "../../services/api";

const inputClass =
  "w-full rounded-xl border border-line bg-field px-4 py-3 text-sm text-ink outline-none transition focus:border-accent-line";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString();
}

function CustomerTypeBadge({ type }) {
  const isPersonal = type === "personal";
  const Icon = isPersonal ? UserRound : Building2;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        isPersonal
          ? "bg-special-soft text-special"
          : "bg-accent-soft text-accent"
      }`}
    >
      <Icon size={14} />
      {isPersonal ? "Personal" : "Business"}
    </span>
  );
}

export default function TenantDetails() {
  const { id } = useParams();
  return <CustomerDetails key={id} id={id} />;
}

function CustomerDetails({ id }) {
  const [tenant, setTenant] = useState(null);
  const lifecycleRequest = useRef(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    customer_type: "business",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [reissuing, setReissuing] = useState(false);

  const [reissuedInvitation, setReissuedInvitation] =
    useState(null);
  const invitationStatus = useInvitationStatus(id,reissuedInvitation);
  const reissuedToken = reissuedInvitation?.invitation?.manualToken ?? reissuedInvitation?.invitation?.developmentToken;

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadTenant = async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      setReissuedInvitation(null);
      setCopied(false);

      try {
        const response = await platformApi.get(
          `/platform/tenants/${id}`
        );

        if (cancelled) return;

        const item = response.data;

        setTenant(item);

        setForm({
          name: item.name || "",
          email: item.email || "",
          phone: item.phone || "",
          customer_type: item.customer_type || "business",
        });
      } catch (err) {
        if (!cancelled) {
          setTenant(null);
          setError(
            err.response?.data?.message ||
              "Unable to load customer details"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadTenant();

    return () => {
      cancelled = true;
      lifecycleRequest.current?.abort();
    };
  }, [id]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Customer name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await platformApi.patch(
        `/platform/tenants/${id}`,
        {
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
        }
      );

      const updatedTenant = response.data;

      setTenant(current=>({...current,...updatedTenant}));

      setForm({
        name: updatedTenant.name || "",
        email: updatedTenant.email || "",
        phone: updatedTenant.phone || "",
        customer_type:
          updatedTenant.customer_type || "business",
      });

      setSuccess(
        "Customer information updated successfully."
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to update customer"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async () => {
    if (tenant?.id !== id || saving || updatingStatus || reissuing) return;
    const nextStatus =
      tenant.status === "active"
        ? "suspended"
        : "active";

    const confirmed = window.confirm(
      nextStatus === "suspended"
        ? `Suspend ${tenant.name}? Its users will lose API access until reactivated.`
        : `Activate ${tenant.name}?`
    );

    if (!confirmed) return;
    const reason = window.prompt("Administrative reason (required, up to 500 characters)");
    if (reason===null) return;
    if (!reason.trim() || reason.trim().length>500) { setError("Enter an administrative reason."); return; }

    setUpdatingStatus(true);
    setError("");
    setSuccess("");
    lifecycleRequest.current?.abort();
    const controller = new AbortController();
    lifecycleRequest.current = controller;

    try {
      const response = await platformApi.patch(
        `/platform/tenants/${id}/status`,
        { status: nextStatus, version: tenant.version, reason:reason.trim() },
        { signal: controller.signal }
      );

      if (controller.signal.aborted) return;
      setTenant(current=>({...current,...response.data}));

      setSuccess(
        nextStatus === "active"
          ? "Customer activated successfully."
          : "Customer suspended successfully."
      );
      try {
        const {data} = await platformApi.get(`/platform/tenants/${id}`, { signal: controller.signal });
        if (!controller.signal.aborted) setTenant(data);
      } catch {
        if (!controller.signal.aborted) setError("Customer status changed, but details could not refresh. Reload the page to see the latest activity.");
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err.response?.data?.message ||
          "Unable to change customer status"
      );
    } finally {
      if (!controller.signal.aborted) setUpdatingStatus(false);
    }
  };

  const handleReissueInvitation = async () => {
    if (reissuing || saving || updatingStatus) return;

    const confirmed = window.confirm(
      "Reissue the initial administrator invitation? " +
        "All previous unused invitations for this " +
        "administrator will be invalidated."
    );

    if (!confirmed) return;

    setReissuing(true);
    setReissuedInvitation(null);
    setCopied(false);
    setError("");
    setSuccess("");

    try {
      const response = await platformApi.post(
        `/platform/tenants/${id}/invitations/reissue`
      );

      setReissuedInvitation(response.data);

      setSuccess(
        response.data.message
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to reissue invitation"
      );
    } finally {
      setReissuing(false);
    }
  };

  const handleCopyToken = async (value) => {
    const token = value ?? reissuedToken;

    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError(
        "Automatic copying failed. Select and copy the token manually."
      );
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 bg-canvas text-muted">
        <LoaderCircle
          className="animate-spin"
          size={24}
        />
        Loading customer details...
      </div>
    );
  }

  const isPersonal = tenant?.customer_type === "personal";
  const CustomerIcon = isPersonal ? UserRound : Building2;

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/platform/customers"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-ink"
        >
          <ArrowLeft size={17} />
          Back to Customers
        </Link>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-negative-line bg-negative-soft p-4 text-sm text-negative"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-positive-line bg-positive-soft p-4 text-sm text-positive"
          >
            {success}
          </div>
        )}

        {!tenant ? (
          <div className="rounded-panel border border-line bg-panel p-8 text-muted">
            Customer details unavailable.
          </div>
        ) : (
          <>
            <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <div
                  className={`rounded-panel p-4 ${
                    isPersonal
                      ? "bg-special-soft text-special"
                      : "bg-accent-soft text-accent"
                  }`}
                >
                  <CustomerIcon size={30} />
                </div>

                <div>
                  <p className="mb-1 text-sm text-accent">
                    Customer Management
                  </p>

                  <h1 className="text-3xl font-bold">
                    {tenant.name}
                  </h1>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-subtle">
                      {tenant.slug}
                    </p>

                    <CustomerTypeBadge
                      type={tenant.customer_type}
                    />
                  </div>
                </div>
              </div>

              <span
                className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${
                  tenant.status === "active"
                    ? "bg-positive-soft text-positive"
                    : tenant.status === "suspended"
                      ? "bg-caution-soft text-caution"
                      : "bg-hover text-muted"
                }`}
              >
                {tenant.status}
              </span>
            </div>

            <section className="mb-6 space-y-3 rounded-panel border border-line bg-panel p-4">
              <h2 className="font-semibold">Account operations</h2>
              <p>Ownership {tenant.reseller_id?<Link className="text-accent" to={`/platform/resellers/${tenant.reseller_id}`}>{tenant.reseller_name}</Link>:"Direct SNA"}</p>
              <p>Vehicles {tenant.vehicle_count} ({tenant.active_vehicle_count} active)</p>
              <p>Trackers {tenant.allocated_gps_count} allocated, {tenant.installed_gps_count} installed</p>
              <p>Subscription {tenant.subscription_status??"No subscription"}{" "}
                <Link className="text-accent" to={`/platform/billing?tab=subscriptions&tenantId=${tenant.id}`}>Manage subscription</Link>
                {" "}<Link className="text-accent" to={`/platform/billing?tab=invoices&tenantId=${tenant.id}`}>Customer invoices</Link>
              </p>
              <h3 className="font-semibold">Tenant administrators</h3>
              {tenant.administrators?.length?<ul className="space-y-1">
                {tenant.administrators.map(admin=><li key={admin.id} className="break-words text-sm">
                  {admin.full_name} ({admin.email}){" \u00B7 "}{admin.is_active?"Active":"Inactive"}
                  {admin.used_at?` \u00B7 invitation accepted ${formatDate(admin.used_at)}`:
                    admin.expires_at?` \u00B7 invitation expires ${formatDate(admin.expires_at)}`:""}
                </li>)}</ul>:<p>No tenant administrators listed.</p>}
              <h3 className="font-semibold">Recent administrative activity</h3>
              {tenant.recent_activity?.length?<ul className="text-sm">
                {tenant.recent_activity.map(event=><li key={event.id}>{formatDate(event.created_at)}{" \u00B7 "}{event.action}</li>)}
              </ul>:<p>No activity recorded.</p>}
              <Link className="text-accent" to={`/platform/audit?tenantId=${tenant.id}`}>Customer audit events</Link>
            </section>
            <div className="grid gap-6 lg:grid-cols-3">
              <section className="rounded-panel border border-line bg-panel p-7 lg:col-span-2">
                <h2 className="mb-6 text-lg font-bold">
                  Customer Information
                </h2>

                <form
                  onSubmit={handleSave}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="customer-name"
                      className="mb-2 block text-sm text-secondary"
                    >
                      {form.customer_type === "personal"
                        ? "Full Name"
                        : "Company Name"}
                    </label>

                    <input
                      id="customer-name"
                      name="name"
                      required
                      maxLength={150}
                      value={form.name}
                      onChange={handleChange}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="customer-email"
                      className="mb-2 block text-sm text-secondary"
                    >
                      Contact Email
                    </label>

                    <input
                      id="customer-email"
                      name="email"
                      type="email"
                      maxLength={255}
                      value={form.email}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="customer@example.com"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="customer-phone"
                      className="mb-2 block text-sm text-secondary"
                    >
                      Phone Number
                    </label>

                    <input
                      id="customer-phone"
                      name="phone"
                      maxLength={30}
                      value={form.phone}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="+92..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={
                      saving ||
                      updatingStatus ||
                      reissuing
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-sm font-semibold transition hover:bg-action-hover disabled:opacity-50"
                  >
                    {saving ? (
                      <LoaderCircle
                        size={17}
                        className="animate-spin"
                      />
                    ) : (
                      <Save size={17} />
                    )}

                    {saving
                      ? "Saving..."
                      : "Save Changes"}
                  </button>
                </form>
              </section>

              <div className="space-y-6">
                <section className="rounded-panel border border-line bg-panel p-6">
                  <h2 className="mb-5 font-bold">
                    Customer Details
                  </h2>

                  <div className="space-y-5 text-sm">
                    <div>
                      <p className="mb-1 text-subtle">
                        Tenant ID
                      </p>

                      <p className="font-semibold">
                        #{tenant.id}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-subtle">
                        Customer Type
                      </p>

                      <CustomerTypeBadge
                        type={tenant.customer_type}
                      />
                    </div>

                    <div>
                      <p className="mb-1 text-subtle">
                        Tenant Slug
                      </p>

                      <p className="break-all font-semibold">
                        {tenant.slug}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-subtle">
                        Created
                      </p>

                      <p>
                        {formatDate(tenant.created_at)}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-subtle">
                        Last Updated
                      </p>

                      <p>
                        {formatDate(tenant.updated_at)}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-panel border border-line bg-panel p-6">
                  <h2 className="mb-3 font-bold">
                    Account Status
                  </h2>

                  <p className="mb-5 text-sm leading-6 text-muted">
                    {tenant.status === "active"
                      ? "This customer currently has access to the platform."
                      : "This customer is not currently active."}
                  </p>

                  <button
                    type="button"
                    onClick={handleStatusChange}
                    disabled={
                      updatingStatus ||
                      saving ||
                      reissuing
                    }
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${
                      tenant.status === "active"
                        ? "border border-caution-line bg-caution-soft text-caution hover:bg-caution-soft"
                        : "border border-positive-line bg-positive-soft text-positive hover:bg-positive-soft"
                    }`}
                  >
                    {updatingStatus ? (
                      <LoaderCircle
                        size={17}
                        className="animate-spin"
                      />
                    ) : tenant.status === "active" ? (
                      <ShieldAlert size={17} />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}

                    {tenant.status === "active"
                      ? "Suspend Customer"
                      : "Activate Customer"}
                  </button>
                </section>
              </div>
            </div>

            <section className="mt-6 rounded-panel border border-line bg-panel p-7">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-accent-soft p-3 text-accent">
                  <KeyRound size={22} />
                </div>

                <div>
                  <h2 className="text-lg font-bold">
                    Administrator Invitation
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-muted">
                    Reissue the invitation for this
                    customer's initial inactive
                    administrator. This invalidates all
                    previous unused invitations for that
                    administrator.
                  </p>
                </div>
              </div>

              <InvitationDelivery invitation={invitationStatus?.invitation} error={invitationStatus?.error} />
              <button
                type="button"
                onClick={handleReissueInvitation}
                disabled={
                  reissuing ||
                  saving ||
                  updatingStatus ||
                  tenant.status !== "active" ||
                  !invitationStatus?.invitation?.canResend
                }
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-sm font-semibold transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reissuing ? (
                  <LoaderCircle
                    size={17}
                    className="animate-spin"
                  />
                ) : (
                  <KeyRound size={17} />
                )}

                {reissuing
                  ? "Reissuing Invitation..."
                  : "Resend / Reissue Invitation"}
              </button>

              <p className="mt-3 text-xs text-subtle">
                Available only while the customer is
                active and exactly one initial tenant
                administrator is inactive. Once the
                administrator activates their account,
                reissue is no longer available through
                this endpoint.
              </p>

              {reissuedToken && invitationStatus?.invitation?.state!=="closed" && (
                <div className="mt-6 rounded-xl border border-caution-line bg-caution-soft p-5">
                  <p className="text-sm font-semibold text-caution">
                    New Invitation Created
                  </p>

                  <p className="mt-2 text-sm text-secondary">
                    Administrator:{" "}
                    {reissuedInvitation.administrator
                      ?.email || "-"}
                  </p>

                  <p className="mt-1 text-sm text-secondary">
                    Expires:{" "}
                    {formatDate(
                      reissuedInvitation.invitation
                        ?.expiresAt
                    )}
                  </p>

                  {reissuedToken && (
                    <>
                      <p className="mt-4 text-xs leading-5 text-caution">
                        Copy the token now and share it privately with the administrator.
                      </p>

                      <div className="mt-3 select-all break-all rounded-lg bg-canvas p-4 font-mono text-xs text-ink">
                        {reissuedToken}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyToken()}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-ink transition hover:bg-hover"
                      >
                        <Copy size={16} />
                        {copied
                          ? "Copied"
                          : "Copy Token"}
                      </button>
                      {reissuedInvitation.invitation.activationLink&&<button type="button" className="control ml-2"
                        onClick={()=>handleCopyToken(reissuedInvitation.invitation.activationLink)}>Copy Activation Link</button>}

                      <Link
                        to="/accept-invitation"
                        className="ml-3 inline-flex rounded-lg border border-line px-4 py-2 text-sm text-accent transition hover:bg-hover"
                      >
                        Open Acceptance Page
                      </Link>
                    </>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
