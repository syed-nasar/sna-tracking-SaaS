
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
  "w-full rounded-xl border border-line bg-field px-4 py-3 text-sm text-ink outline-none transition focus:border-accent-line";

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
        className="mb-2 block text-sm font-medium text-secondary"
      >
        {label}
        {required && (
          <span className="ml-1 text-accent">*</span>
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
        <p className="mt-2 text-xs text-subtle">
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
      <main className="min-h-[calc(100dvh-4rem)] bg-canvas px-5 py-12 text-ink sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-panel border border-line bg-panel p-7 sm:p-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-panel bg-positive-soft text-positive">
              <CheckCircle2 size={34} />
            </div>

            <p className="mb-2 text-sm font-semibold text-positive">
              {createdPersonal
                ? "Personal Customer Created"
                : "Business Customer Created"}
            </p>

            <h1 className="text-3xl font-bold">
              Onboarding Successful
            </h1>

            <p className="mt-3 text-sm leading-6 text-muted">
              The customer account and its initial
              administrator have been created
              successfully.
            </p>

            <div className="mt-8 space-y-5 rounded-panel border border-line bg-field p-6">
              <div>
                <p className="text-xs text-subtle">
                  Customer Type
                </p>
                <p className="mt-1 font-semibold">
                  {createdPersonal
                    ? "Personal"
                    : "Business"}
                </p>
              </div>

              <div>
                <p className="text-xs text-subtle">
                  {createdPersonal
                    ? "Customer Name"
                    : "Company"}
                </p>
                <p className="mt-1 font-semibold">
                  {result.tenant.name}
                </p>
              </div>

              <div>
                <p className="text-xs text-subtle">
                  Customer Slug
                </p>
                <p className="mt-1 font-semibold">
                  {result.tenant.slug}
                </p>
              </div>

              <div>
                <p className="text-xs text-subtle">
                  Administrator
                </p>
                <p className="mt-1 font-semibold">
                  {result.administrator.full_name}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {result.administrator.email}
                </p>
              </div>

              <div>
                <p className="text-xs text-subtle">
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
              <div className="mt-6 rounded-panel border border-caution-line bg-caution-soft p-6">
                <h2 className="font-semibold text-caution">
                  Development Invitation Token
                </h2>

                <p className="mt-2 text-sm leading-6 text-muted">
                  This token is shown only for local
                  development. Treat it like a password.
                  Do not publish it or include it in logs.
                </p>

                <div className="mt-4 break-all rounded-xl border border-line bg-canvas p-4 font-mono text-xs text-secondary">
                  {token}
                </div>

                <button
                  type="button"
                  onClick={copyInvitationToken}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line bg-hover px-4 py-3 text-sm font-medium transition hover:bg-hover"
                >
                  <Copy size={16} />
                  {copied
                    ? "Copied"
                    : "Copy Invitation Token"}
                </button>

                <p className="mt-4 text-xs leading-5 text-caution">
                  Invitation delivery is not automated yet.
                  Save this token securely for the
                  invitation acceptance test.
                </p>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-caution-line bg-caution-soft p-5 text-sm text-caution">
                Invitation created, but no development
                token was returned. Delivery is pending.
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 text-sm text-negative"
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
                className="inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-sm font-semibold transition hover:bg-action-hover"
              >
                View Customer
                <ArrowRight size={17} />
              </button>

              <Link
                to="/platform/dashboard"
                className="inline-flex items-center rounded-xl border border-line px-5 py-3 text-sm font-medium text-secondary hover:bg-hover"
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
    <main className="min-h-[calc(100dvh-4rem)] bg-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link
          to="/platform/dashboard"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-ink"
        >
          <ArrowLeft size={17} />
          Back to Dashboard
        </Link>

        <div className="mb-9">
          <p className="mb-2 text-sm font-semibold text-accent">
            Platform Administration
          </p>

          <h1 className="text-3xl font-bold tracking-tight">
            Onboard New Customer
          </h1>

          <p className="mt-3 text-sm text-muted">
            Register an individual vehicle owner or a
            fleet company and create its first
            administrator.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-negative-line bg-negative-soft p-4 text-sm text-negative"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-panel border border-line bg-panel p-6 sm:p-8">
            <h2 className="text-lg font-bold">
              Customer Type
            </h2>

            <p className="mt-1 text-xs text-subtle">
              Choose the type of customer account.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  selectCustomerType("personal")
                }
                aria-pressed={isPersonal}
                className={`rounded-panel border p-5 text-left transition ${
                  isPersonal
                    ? "border-accent-line bg-accent-soft"
                    : "border-line bg-field hover:border-line-strong"
                }`}
              >
                <div className="flex items-center justify-between">
                  <UserRound
                    size={25}
                    className={
                      isPersonal
                        ? "text-accent"
                        : "text-muted"
                    }
                  />

                  {isPersonal && (
                    <CheckCircle2
                      size={20}
                      className="text-accent"
                    />
                  )}
                </div>

                <p className="mt-4 font-semibold">
                  Personal
                </p>

                <p className="mt-2 text-sm text-muted">
                  Individual vehicle owners
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  selectCustomerType("business")
                }
                aria-pressed={!isPersonal}
                className={`rounded-panel border p-5 text-left transition ${
                  !isPersonal
                    ? "border-accent-line bg-accent-soft"
                    : "border-line bg-field hover:border-line-strong"
                }`}
              >
                <div className="flex items-center justify-between">
                  <Building2
                    size={25}
                    className={
                      !isPersonal
                        ? "text-accent"
                        : "text-muted"
                    }
                  />

                  {!isPersonal && (
                    <CheckCircle2
                      size={20}
                      className="text-accent"
                    />
                  )}
                </div>

                <p className="mt-4 font-semibold">
                  Business
                </p>

                <p className="mt-2 text-sm text-muted">
                  Companies and fleet operators
                </p>
              </button>
            </div>
          </section>

          <section className="rounded-panel border border-line bg-panel p-6 sm:p-8">
            <div className="mb-7 flex items-center gap-3">
              <div className="rounded-xl bg-accent-soft p-3 text-accent">
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
                <p className="mt-1 text-xs text-subtle">
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

          <section className="rounded-panel border border-line bg-panel p-6 sm:p-8">
            <div className="mb-7 flex items-center gap-3">
              <div className="rounded-xl bg-accent-soft p-3 text-accent">
                <UserRound size={22} />
              </div>

              <div>
                <h2 className="text-lg font-bold">
                  Initial Administrator
                </h2>
                <p className="mt-1 text-xs text-subtle">
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

            <div className="mt-7 flex gap-3 rounded-xl border border-accent-line bg-accent-soft p-4">
              <ShieldCheck
                size={20}
                className="shrink-0 text-accent"
              />

              <p className="text-sm leading-6 text-muted">
                The administrator account will remain
                inactive until its invitation is accepted
                and a password is configured.
              </p>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-subtle">
              Fields marked * are required.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-3 rounded-xl bg-action px-6 py-3.5 text-sm font-semibold transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
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
