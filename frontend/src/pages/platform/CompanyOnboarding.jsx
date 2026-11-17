
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  LoaderCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { platformApi } from "../../services/api";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500";

const initialForm = {
  customer_type: "business",
  name: "",
  slug: "",
  email: "",
  phone: "",
  adminFullName: "",
  adminEmail: "",
};

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder = "",
  required = false,
  maxLength,
  hint,
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-sm font-medium text-slate-300"
      >
        {label}
        {required && (
          <span className="ml-1 text-blue-400">*</span>
        )}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className={inputClass}
      />

      {hint && (
        <p className="mt-2 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function CompanyOnboarding() {
  const navigate = useNavigate();

  const [form, setForm] = useState(initialForm);
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const isPersonal = form.customer_type === "personal";

  const handleChange = (event) => {
    const { name, value } = event.target;

    if (name === "name") {
      setForm((previous) => ({
        ...previous,
        name: value,
        slug: slugEdited
          ? previous.slug
          : value
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, ""),
      }));

      return;
    }

    if (name === "slug") {
      setSlugEdited(true);
    }

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const selectCustomerType = (customerType) => {
    setForm((previous) => ({
      ...previous,
      customer_type: customerType,
    }));

    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting || result) return;

    setError("");

    const payload = {
      customer_type: form.customer_type,
      name: form.name.trim(),
      slug: form.slug.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      adminFullName: form.adminFullName.trim(),
      adminEmail: form.adminEmail.trim(),
    };

    if (
      !["personal", "business"].includes(
        payload.customer_type
      )
    ) {
      setError("Please select a valid customer type.");
      return;
    }

    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)
    ) {
      setError(
        "Customer slug must contain lowercase letters, numbers, and single hyphens."
      );
      return;
    }

    setSubmitting(true);

    try {
      const response = await platformApi.post(
        "/platform/tenants/onboard",
        payload
      );

      setResult(response.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to onboard customer. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvitationToken = async () => {
    const token =
      result?.invitation?.developmentToken;

    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError(
        "Unable to copy automatically. Please select and copy the token manually."
      );
    }
  };

  if (result) {
    const token =
      result.invitation?.developmentToken;

    const createdPersonal =
      result.tenant.customer_type === "personal";

    return (
      <main className="min-h-screen bg-[#090d16] px-5 py-12 text-white sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-3xl border border-white/10 bg-[#111827] p-7 sm:p-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={34} />
            </div>

            <p className="mb-2 text-sm font-semibold text-emerald-400">
              {createdPersonal
                ? "Personal Customer Created"
                : "Business Customer Created"}
            </p>

            <h1 className="text-3xl font-bold">
              Onboarding Successful
            </h1>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              The customer account and its initial
              administrator have been created
              successfully.
            </p>

            <div className="mt-8 space-y-5 rounded-2xl border border-white/10 bg-[#0b1220] p-6">
              <div>
                <p className="text-xs text-slate-500">
                  Customer Type
                </p>
                <p className="mt-1 font-semibold">
                  {createdPersonal
                    ? "Personal"
                    : "Business"}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  {createdPersonal
                    ? "Customer Name"
                    : "Company"}
                </p>
                <p className="mt-1 font-semibold">
                  {result.tenant.name}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Customer Slug
                </p>
                <p className="mt-1 font-semibold">
                  {result.tenant.slug}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Administrator
                </p>
                <p className="mt-1 font-semibold">
                  {result.administrator.full_name}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {result.administrator.email}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Invitation Expiration
                </p>
                <p className="mt-1 text-sm">
                  {result.invitation?.expiresAt
                    ? new Date(
                        result.invitation.expiresAt
                      ).toLocaleString()
                    : "Not available"}
                </p>
              </div>
            </div>

            {token ? (
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
                <h2 className="font-semibold text-amber-400">
                  Development Invitation Token
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  This token is shown only for local
                  development. Treat it like a password.
                  Do not publish it or include it in logs.
                </p>

                <div className="mt-4 break-all rounded-xl border border-white/10 bg-[#090d16] p-4 font-mono text-xs text-slate-300">
                  {token}
                </div>

                <button
                  type="button"
                  onClick={copyInvitationToken}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium transition hover:bg-white/10"
                >
                  <Copy size={16} />
                  {copied
                    ? "Copied"
                    : "Copy Invitation Token"}
                </button>

                <p className="mt-4 text-xs leading-5 text-amber-300/80">
                  Invitation delivery is not automated yet.
                  Save this token securely for the
                  invitation acceptance test.
                </p>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-300">
                Invitation created, but no development
                token was returned. Delivery is pending.
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 text-sm text-red-400"
              >
                {error}
              </p>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/platform/tenants/${result.tenant.id}`
                  )
                }
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold transition hover:bg-blue-500"
              >
                View Customer
                <ArrowRight size={17} />
              </button>

              <Link
                to="/platform/dashboard"
                className="inline-flex items-center rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-slate-300 hover:bg-white/5"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#090d16] px-5 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          to="/platform/dashboard"
          className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft size={17} />
          Back to Dashboard
        </Link>

        <div className="mb-9">
          <p className="mb-2 text-sm font-semibold text-blue-400">
            Platform Administration
          </p>

          <h1 className="text-3xl font-bold tracking-tight">
            Onboard New Customer
          </h1>

          <p className="mt-3 text-sm text-slate-400">
            Register an individual vehicle owner or a
            fleet company and create its first
            administrator.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8">
            <h2 className="text-lg font-bold">
              Customer Type
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Choose the type of customer account.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  selectCustomerType("personal")
                }
                aria-pressed={isPersonal}
                className={`rounded-2xl border p-5 text-left transition ${
                  isPersonal
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-white/10 bg-[#0b1220] hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between">
                  <UserRound
                    size={25}
                    className={
                      isPersonal
                        ? "text-blue-400"
                        : "text-slate-400"
                    }
                  />

                  {isPersonal && (
                    <CheckCircle2
                      size={20}
                      className="text-blue-400"
                    />
                  )}
                </div>

                <p className="mt-4 font-semibold">
                  Personal
                </p>

                <p className="mt-2 text-sm text-slate-400">
                  Individual vehicle owners
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  selectCustomerType("business")
                }
                aria-pressed={!isPersonal}
                className={`rounded-2xl border p-5 text-left transition ${
                  !isPersonal
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-white/10 bg-[#0b1220] hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between">
                  <Building2
                    size={25}
                    className={
                      !isPersonal
                        ? "text-blue-400"
                        : "text-slate-400"
                    }
                  />

                  {!isPersonal && (
                    <CheckCircle2
                      size={20}
                      className="text-blue-400"
                    />
                  )}
                </div>

                <p className="mt-4 font-semibold">
                  Business
                </p>

                <p className="mt-2 text-sm text-slate-400">
                  Companies and fleet operators
                </p>
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8">
            <div className="mb-7 flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
                {isPersonal ? (
                  <UserRound size={22} />
                ) : (
                  <Building2 size={22} />
                )}
              </div>

              <div>
                <h2 className="text-lg font-bold">
                  {isPersonal
                    ? "Personal Information"
                    : "Company Information"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isPersonal
                    ? "Individual customer details"
                    : "Fleet operator details"}
                </p>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field
                  label={
                    isPersonal
                      ? "Customer Full Name"
                      : "Company Name"
                  }
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  maxLength={150}
                  placeholder={
                    isPersonal
                      ? "Customer full name"
                      : "Example Logistics"
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <Field
                  label="Customer Slug"
                  name="slug"
                  value={form.slug}
                  onChange={handleChange}
                  required
                  maxLength={100}
                  placeholder={
                    isPersonal
                      ? "customer-name"
                      : "example-logistics"
                  }
                  hint="Used during tenant login. Cannot be changed later."
                />
              </div>

              <Field
                label={
                  isPersonal
                    ? "Customer Email"
                    : "Company Email"
                }
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                maxLength={255}
                placeholder="contact@example.com"
              />

              <Field
                label="Phone Number"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                maxLength={30}
                placeholder="+923001234567"
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8">
            <div className="mb-7 flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
                <UserRound size={22} />
              </div>

              <div>
                <h2 className="text-lg font-bold">
                  Initial Administrator
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isPersonal
                    ? "Personal account administrator"
                    : "First tenant administrator account"}
                </p>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <Field
                label="Administrator Full Name"
                name="adminFullName"
                value={form.adminFullName}
                onChange={handleChange}
                required
                maxLength={150}
                placeholder="Full name"
              />

              <Field
                label="Administrator Email"
                name="adminEmail"
                type="email"
                value={form.adminEmail}
                onChange={handleChange}
                required
                maxLength={255}
                placeholder="admin@example.com"
              />
            </div>

            <div className="mt-7 flex gap-3 rounded-xl border border-blue-500/15 bg-blue-500/5 p-4">
              <ShieldCheck
                size={20}
                className="shrink-0 text-blue-400"
              />

              <p className="text-sm leading-6 text-slate-400">
                The administrator account will remain
                inactive until its invitation is accepted
                and a password is configured.
              </p>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              Fields marked * are required.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-3 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <LoaderCircle
                  size={18}
                  className="animate-spin"
                />
              ) : isPersonal ? (
                <UserRound size={18} />
              ) : (
                <Building2 size={18} />
              )}

              {submitting
                ? "Creating Customer..."
                : "Create Customer"}

              {!submitting && <ArrowRight size={17} />}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
