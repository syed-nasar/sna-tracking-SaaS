
import { useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import {
  ShieldCheck,
  Mail,
  LockKeyhole,
  Building2,
  UserRound,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import ThemeSelector from "../components/ThemeSelector";
import BrandMark from "../components/BrandMark";
import { useBrand, useBrandReady } from "../context/brand";

export default function LoginPage({ type = "tenant" }) {
  const {brandSlug}=useParams();
  return <LoginForm key={brandSlug} type={type} brandSlug={brandSlug} />;
}

function LoginForm({ type,brandSlug }) {
  const { state } = useLocation();
  if (type === "tenant" && brandSlug && state?.signInType === "reseller") type = "reseller";
  const isPlatform = type === "platform";
  const isReseller=type==="reseller";
  const brand=useBrand();
  const brandReady=useBrandReady();
  const slug=brandSlug??brand?.slug;
  const resellerSlug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug??"")?slug:undefined;
  const fleetLogin=resellerSlug?`/r/${resellerSlug}/login`:"/login";
  const resellerLogin=resellerSlug?`/r/${resellerSlug}/reseller/login`:"/reseller/login";

  const { session, signInTenant, signInPlatform,signInReseller } = useAuth();

  const [customerType, setCustomerType] = useState(() => state?.customerType === "business" ? "business" : "personal");

  const [form, setForm] = useState({
    tenantSlug: "",
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const defaultDestination = isPlatform
    ? "/platform/dashboard"
    : isReseller ? "/reseller/dashboard" : "/dashboard";
  const requested = state?.returnTo;
  const pathname = requested?.pathname;
  const validReturn = state?.authType === type && typeof pathname === "string" &&
    pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes("\\") &&
    pathname !== "/login" && pathname !== "/platform/login" &&
    pathname.startsWith("/platform/") === isPlatform &&
    pathname.startsWith("/reseller/") === isReseller && pathname!=="/reseller/login";
  const destination = validReturn ? requested : defaultDestination;

  if (session?.type === type) {
    return <Navigate to={destination} replace />;
  }

  const updateField = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const selectCustomerType = (value) => {
    if (loading) return;

    setCustomerType(value);
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    try {
      const email = form.email.trim();
      const password = form.password;

      if (isPlatform) {
        await signInPlatform({
          email,
          password,
        });
      } else if (isReseller) {
        await signInReseller({slug:resellerSlug??form.tenantSlug.trim().toLowerCase(),email,password});
      } else if (customerType === "business") {
        await signInTenant({
          tenantSlug: form.tenantSlug.trim().toLowerCase(),
          resellerSlug,
          email,
          password,
        });
      } else {
        // Personal customers do not need a tenant slug.
        await signInTenant({
          resellerSlug,
          email,
          password,
        });
      }

    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to sign in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-canvas px-4 pb-8 pt-16 sm:p-10">
      <div className="absolute end-4 top-4"><ThemeSelector /></div>
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="rounded-xl bg-action p-3 text-ink">
            <BrandMark brand={brand} size={27} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
              {brand?.display_name||"SNA Technologies"}
            </p>

            <h1 className="text-xl font-bold text-ink">
              Fleet Management
            </h1>
          </div>
        </div>

        <div className="rounded-panel border border-line bg-panel p-5 shadow-panel sm:p-8">
          <div className="mb-7">
            <div className="mb-4 inline-flex rounded-xl bg-accent-soft p-3 text-accent">
              {isPlatform ? (
                <ShieldCheck size={25} />
              ) : customerType === "personal" ? (
                <UserRound size={25} />
              ) : (
                <Building2 size={25} />
              )}
            </div>

            <h2 className="text-2xl font-bold text-ink">
              {isPlatform
                ? "Platform Administration"
                : isReseller ? "Reseller Administration" : "Welcome back"}
            </h2>

            <p className="mt-2 text-sm text-muted">
              {isPlatform
                ? "Sign in to manage your fleet platform."
                : isReseller ? "Sign in to manage your reseller customers and inventory."
                  : "Sign in to access your fleet dashboard."}
            </p>
          </div>

          {brand?.welcome&&<p className="mb-3 text-sm text-muted">{brand.welcome}</p>}
          {!isPlatform && !isReseller && (
            <div className="mb-7">
              <p className="mb-3 text-sm font-medium text-secondary">
                Account Type
              </p>

              <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-field p-1.5">
                <button
                  type="button"
                  onClick={() => selectCustomerType("personal")}
                  disabled={loading}
                  aria-pressed={customerType === "personal"}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    customerType === "personal"
                      ? "bg-action text-ink shadow-lg shadow-blue-600/20"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`}
                >
                  <UserRound size={17} />
                  Personal
                </button>

                <button
                  type="button"
                  onClick={() => selectCustomerType("business")}
                  disabled={loading}
                  aria-pressed={customerType === "business"}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    customerType === "business"
                      ? "bg-action text-ink shadow-lg shadow-blue-600/20"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`}
                >
                  <Building2 size={17} />
                  Business
                </button>
              </div>

              <p className="mt-3 text-xs text-subtle">
                {customerType === "personal"
                  ? "Personal vehicle owners can sign in using their email and password."
                  : "Business customers sign in using their company slug, email, and password."}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isPlatform && (isReseller || customerType === "business") && (
              <div>
                <label
                  htmlFor="tenantSlug"
                  className="mb-2 block text-sm font-medium text-secondary"
                >
                  {isReseller?"Reseller slug":"Company Slug"}
                </label>

                <div className="relative">
                  <Building2
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle"
                  />

                  <input
                    id="tenantSlug"
                    name="tenantSlug"
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="organization"
                    value={isReseller?(resellerSlug??form.tenantSlug):form.tenantSlug}
                    readOnly={isReseller&&Boolean(resellerSlug)}
                    onChange={updateField}
                    placeholder="your-company"
                    disabled={loading}
                    className="w-full rounded-xl border border-line bg-field py-3 pl-12 pr-4 text-ink outline-none transition placeholder:text-subtle focus:border-accent-line disabled:opacity-60"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-secondary"
              >
                Email Address
              </label>

              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle"
                />

                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={255}
                  autoComplete="username"
                  value={form.email}
                  onChange={updateField}
                  placeholder={
                    isPlatform
                      ? "admin@example.com"
                      : customerType === "personal"
                        ? "name@example.com"
                        : "name@company.com"
                  }
                  disabled={loading}
                  className="w-full rounded-xl border border-line bg-field py-3 pl-12 pr-4 text-ink outline-none transition placeholder:text-subtle focus:border-accent-line disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-secondary"
              >
                Password
              </label>

              <div className="relative">
                <LockKeyhole
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-subtle"
                />

                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={updateField}
                  placeholder="Enter your password"
                  disabled={loading}
                  className="w-full rounded-xl border border-line bg-field py-3 pl-12 pr-4 text-ink outline-none transition placeholder:text-subtle focus:border-accent-line disabled:opacity-60"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-negative-line bg-negative-soft px-4 py-3 text-sm text-negative"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-action px-5 py-3.5 font-semibold text-ink transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <LoaderCircle
                    size={19}
                    className="animate-spin"
                  />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          </form>

          <div className="mt-7 flex flex-wrap justify-center gap-3 border-t border-line pt-6 text-center">
            {(isPlatform || isReseller) ? (
              <Link to={isReseller ? fleetLogin : "/login"} className="text-sm text-muted transition hover:text-accent">
                Switch to Fleet Login
              </Link>
            ) : brandReady && !brand && (
              <Link to="/platform/login" className="text-sm text-muted transition hover:text-accent">
                Platform Administrator Login
              </Link>
            )}
            {!isPlatform&&!isReseller&&<Link to={resellerLogin} className="text-sm text-muted hover:text-accent">
              Reseller Administrator Login
            </Link>}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-subtle">
          © {new Date().getFullYear()} {brand?.display_name||"SNA Technologies"}.
          {brand?.support_email&&<a className="ms-2 text-accent" href={`mailto:${brand.support_email}`}>Support</a>}
          All rights reserved.
        </p>
      </div>
    </main>
  );
}
