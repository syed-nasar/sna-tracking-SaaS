
import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  Truck,
  ShieldCheck,
  Mail,
  LockKeyhole,
  Building2,
  UserRound,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";

export default function LoginPage({ type = "tenant" }) {
  const isPlatform = type === "platform";
  const { state } = useLocation();

  const { session, signInTenant, signInPlatform } = useAuth();

  const [customerType, setCustomerType] = useState("personal");

  const [form, setForm] = useState({
    tenantSlug: "",
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const defaultDestination = isPlatform
    ? "/platform/dashboard"
    : "/dashboard";
  const requested = state?.returnTo;
  const pathname = requested?.pathname;
  const validReturn = state?.authType === type && typeof pathname === "string" &&
    pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes("\\") &&
    pathname !== "/login" && pathname !== "/platform/login" &&
    pathname.startsWith("/platform/") === isPlatform;
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
      } else if (customerType === "business") {
        await signInTenant({
          tenantSlug: form.tenantSlug.trim().toLowerCase(),
          email,
          password,
        });
      } else {
        // Personal customers do not need a tenant slug.
        await signInTenant({
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
    <main className="flex min-h-screen items-center justify-center bg-[#090d16] px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="rounded-xl bg-blue-600 p-3 text-white">
            <Truck size={27} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">
              SNA Technologies
            </p>

            <h1 className="text-xl font-bold text-white">
              Fleet Management
            </h1>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#111827] p-7 shadow-2xl sm:p-9">
          <div className="mb-7">
            <div className="mb-4 inline-flex rounded-xl bg-blue-500/10 p-3 text-blue-400">
              {isPlatform ? (
                <ShieldCheck size={25} />
              ) : customerType === "personal" ? (
                <UserRound size={25} />
              ) : (
                <Building2 size={25} />
              )}
            </div>

            <h2 className="text-2xl font-bold text-white">
              {isPlatform
                ? "Platform Administration"
                : "Welcome back"}
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              {isPlatform
                ? "Sign in to manage your fleet platform."
                : "Sign in to access your fleet dashboard."}
            </p>
          </div>

          {!isPlatform && (
            <div className="mb-7">
              <p className="mb-3 text-sm font-medium text-slate-300">
                Account Type
              </p>

              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#0b1220] p-1.5">
                <button
                  type="button"
                  onClick={() => selectCustomerType("personal")}
                  disabled={loading}
                  aria-pressed={customerType === "personal"}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    customerType === "personal"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
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
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Building2 size={17} />
                  Business
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {customerType === "personal"
                  ? "Personal vehicle owners can sign in using their email and password."
                  : "Business customers sign in using their company slug, email, and password."}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isPlatform && customerType === "business" && (
              <div>
                <label
                  htmlFor="tenantSlug"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Company Slug
                </label>

                <div className="relative">
                  <Building2
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
                  />

                  <input
                    id="tenantSlug"
                    name="tenantSlug"
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="organization"
                    value={form.tenantSlug}
                    onChange={updateField}
                    placeholder="your-company"
                    disabled={loading}
                    className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-3 pl-12 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-60"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Email Address
              </label>

              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
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
                  className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-3 pl-12 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Password
              </label>

              <div className="relative">
                <LockKeyhole
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
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
                  className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-3 pl-12 pr-4 text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-60"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
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

          <div className="mt-7 border-t border-white/10 pt-6 text-center">
            <Link
              to={isPlatform ? "/login" : "/platform/login"}
              className="text-sm text-slate-400 transition hover:text-blue-400"
            >
              {isPlatform
                ? "Switch to Fleet Login"
                : "Platform Administrator Login"}
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} SNA Technologies.
          All rights reserved.
        </p>
      </div>
    </main>
  );
}
