
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  "w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500";

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
          ? "bg-violet-500/10 text-violet-400"
          : "bg-blue-500/10 text-blue-400"
      }`}
    >
      <Icon size={14} />
      {isPersonal ? "Personal" : "Business"}
    </span>
  );
}

export default function TenantDetails() {
  const { id } = useParams();

  const [tenant, setTenant] = useState(null);

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

    if (
      !["personal", "business"].includes(form.customer_type)
    ) {
      setError("Select a valid customer type.");
      return;
    }

    const typeChanged =
      form.customer_type !== tenant.customer_type;

    if (typeChanged) {
      const confirmed = window.confirm(
        `Change customer type from ${
          tenant.customer_type
        } to ${form.customer_type}?\n\n` +
          "The existing tenant ID, slug, administrator, " +
          "and vehicle records will remain unchanged."
      );

      if (!confirmed) return;
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
          customer_type: form.customer_type,
        }
      );

      const updatedTenant = response.data;

      setTenant(updatedTenant);

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

    setUpdatingStatus(true);
    setError("");
    setSuccess("");

    try {
      const response = await platformApi.patch(
        `/platform/tenants/${id}`,
        {
          status: nextStatus,
        }
      );

      setTenant(response.data);

      setSuccess(
        nextStatus === "active"
          ? "Customer activated successfully."
          : "Customer suspended successfully."
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to change customer status"
      );
    } finally {
      setUpdatingStatus(false);
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
        "Administrator invitation reissued successfully."
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

  const handleCopyToken = async () => {
    const token =
      reissuedInvitation?.invitation?.developmentToken;

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
      <div className="flex min-h-screen items-center justify-center gap-3 bg-[#090d16] text-slate-400">
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
    <main className="min-h-screen bg-[#090d16] px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/platform/dashboard"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft size={17} />
          Back to Dashboard
        </Link>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400"
          >
            {success}
          </div>
        )}

        {!tenant ? (
          <div className="rounded-2xl border border-white/10 bg-[#111827] p-8 text-slate-400">
            Customer details unavailable.
          </div>
        ) : (
          <>
            <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <div
                  className={`rounded-2xl p-4 ${
                    isPersonal
                      ? "bg-violet-500/10 text-violet-400"
                      : "bg-blue-600/15 text-blue-400"
                  }`}
                >
                  <CustomerIcon size={30} />
                </div>

                <div>
                  <p className="mb-1 text-sm text-blue-400">
                    Customer Management
                  </p>

                  <h1 className="text-3xl font-bold">
                    {tenant.name}
                  </h1>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-500">
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
                    ? "bg-emerald-500/10 text-emerald-400"
                    : tenant.status === "suspended"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-slate-500/10 text-slate-400"
                }`}
              >
                {tenant.status}
              </span>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <section className="rounded-2xl border border-white/10 bg-[#111827] p-7 lg:col-span-2">
                <h2 className="mb-6 text-lg font-bold">
                  Customer Information
                </h2>

                <form
                  onSubmit={handleSave}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="customer-type"
                      className="mb-2 block text-sm text-slate-300"
                    >
                      Customer Type
                    </label>

                    <select
                      id="customer-type"
                      name="customer_type"
                      value={form.customer_type}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option value="business">
                        Business
                      </option>

                      <option value="personal">
                        Personal
                      </option>
                    </select>

                    <p className="mt-2 text-xs text-slate-500">
                      Changing the customer type does not
                      change the tenant ID or slug.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="customer-name"
                      className="mb-2 block text-sm text-slate-300"
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
                      className="mb-2 block text-sm text-slate-300"
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
                      className="mb-2 block text-sm text-slate-300"
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
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold transition hover:bg-blue-500 disabled:opacity-50"
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
                <section className="rounded-2xl border border-white/10 bg-[#111827] p-6">
                  <h2 className="mb-5 font-bold">
                    Customer Details
                  </h2>

                  <div className="space-y-5 text-sm">
                    <div>
                      <p className="mb-1 text-slate-500">
                        Tenant ID
                      </p>

                      <p className="font-semibold">
                        #{tenant.id}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-slate-500">
                        Customer Type
                      </p>

                      <CustomerTypeBadge
                        type={tenant.customer_type}
                      />
                    </div>

                    <div>
                      <p className="mb-1 text-slate-500">
                        Tenant Slug
                      </p>

                      <p className="break-all font-semibold">
                        {tenant.slug}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-slate-500">
                        Created
                      </p>

                      <p>
                        {formatDate(tenant.created_at)}
                      </p>
                    </div>

                    <div>
                      <p className="mb-1 text-slate-500">
                        Last Updated
                      </p>

                      <p>
                        {formatDate(tenant.updated_at)}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-[#111827] p-6">
                  <h2 className="mb-3 font-bold">
                    Account Status
                  </h2>

                  <p className="mb-5 text-sm leading-6 text-slate-400">
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
                        ? "border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                        : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
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

            <section className="mt-6 rounded-2xl border border-white/10 bg-[#111827] p-7">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
                  <KeyRound size={22} />
                </div>

                <div>
                  <h2 className="text-lg font-bold">
                    Administrator Invitation
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Reissue the invitation for this
                    customer's initial inactive
                    administrator. This invalidates all
                    previous unused invitations for that
                    administrator.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReissueInvitation}
                disabled={
                  reissuing ||
                  saving ||
                  updatingStatus ||
                  tenant.status !== "active"
                }
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                  : "Reissue Invitation"}
              </button>

              <p className="mt-3 text-xs text-slate-500">
                Available only while the customer is
                active and exactly one initial tenant
                administrator is inactive. Once the
                administrator activates their account,
                reissue is no longer available through
                this endpoint.
              </p>

              {reissuedInvitation && (
                <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
                  <p className="text-sm font-semibold text-amber-400">
                    New Invitation Created
                  </p>

                  <p className="mt-2 text-sm text-slate-300">
                    Administrator:{" "}
                    {reissuedInvitation.administrator
                      ?.email || "-"}
                  </p>

                  <p className="mt-1 text-sm text-slate-300">
                    Expires:{" "}
                    {formatDate(
                      reissuedInvitation.invitation
                        ?.expiresAt
                    )}
                  </p>

                  {reissuedInvitation.invitation
                    ?.developmentToken ? (
                    <>
                      <p className="mt-4 text-xs leading-5 text-amber-300">
                        Local development token. Copy
                        it now; it cannot be retrieved
                        after leaving this page. Do not
                        share it publicly or store it
                        in logs.
                      </p>

                      <div className="mt-3 select-all break-all rounded-lg bg-[#090d16] p-4 font-mono text-xs text-white">
                        {
                          reissuedInvitation.invitation
                            .developmentToken
                        }
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyToken}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/5"
                      >
                        <Copy size={16} />
                        {copied
                          ? "Copied"
                          : "Copy Token"}
                      </button>

                      <Link
                        to="/accept-invitation"
                        className="ml-3 inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm text-blue-400 transition hover:bg-white/5"
                      >
                        Open Acceptance Page
                      </Link>
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-amber-300">
                      Invitation delivery is pending.
                      No development token was returned
                      by the backend.
                    </p>
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
