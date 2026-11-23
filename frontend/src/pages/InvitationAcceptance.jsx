
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Truck,
} from "lucide-react";

import api from "../services/api";

const inputClass =
  "w-full rounded-xl border border-line bg-field px-4 py-3 text-sm text-ink outline-none transition focus:border-accent-line";

export default function InvitationAcceptance() {
  const navigate = useNavigate();

  const [form, setForm] = useState(() => ({
    token: new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
    password: "",
    confirmPassword: "",
  }));

  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("token")) {
      window.history.replaceState(window.history.state,"",window.location.pathname+window.location.search);
    }
  },[]);

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loading) return;

    setError("");

    const token = form.token.trim();

    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError("Enter a valid 64-character invitation token.");
      return;
    }

    if (form.password.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }

    if (
      new TextEncoder().encode(form.password).length > 72
    ) {
      setError("Password must not exceed 72 UTF-8 bytes.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await api.post(
        "/auth/invitations/accept",
        {
          token,
          password: form.password,
        }
      );

      if (response.data?.accountActivated !== true) {
        throw new Error("Unexpected activation response");
      }

      setForm({
        token: "",
        password: "",
        confirmPassword: "",
      });

      setSuccess(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to accept invitation."
      );
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-12 text-ink">
        <div className="w-full max-w-md rounded-panel border border-line bg-panel p-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-panel bg-positive-soft text-positive">
            <CheckCircle2 size={34} />
          </div>

          <h1 className="text-2xl font-bold">
            Account Activated
          </h1>

          <p className="mt-4 text-sm leading-6 text-muted">
            Your administrator account has been activated
            successfully. You can now sign in using your
            company slug, email, and new password.
          </p>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-action px-5 py-3.5 text-sm font-semibold transition hover:bg-action-hover"
          >
            Continue to Tenant Login
            <ArrowRight size={17} />
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-12 text-ink">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="rounded-xl bg-action p-3">
            <Truck size={25} />
          </div>

          <div>
            <h1 className="text-lg font-bold">
              SNA Fleet
            </h1>
            <p className="text-xs text-muted">
              Fleet Management Platform
            </p>
          </div>
        </div>

        <div className="rounded-panel border border-line bg-panel p-7 sm:p-9">
          <div className="mb-7">
            <div className="mb-5 inline-flex rounded-xl bg-accent-soft p-3 text-accent">
              <KeyRound size={24} />
            </div>

            <h2 className="text-2xl font-bold">
              Activate Your Account
            </h2>

            <p className="mt-3 text-sm leading-6 text-muted">
              Enter your invitation token and create a
              password to activate your Tenant Administrator
              account.
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

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="token"
                className="mb-2 block text-sm font-medium text-secondary"
              >
                Invitation Token
              </label>

              <textarea
                id="token"
                name="token"
                required
                rows={3}
                spellCheck={false}
                autoComplete="off"
                value={form.token}
                onChange={handleChange}
                placeholder="Paste your invitation token"
                className={`${inputClass} resize-none break-all font-mono text-xs`}
              />

              <p className="mt-2 text-xs text-subtle">
                Invitation tokens expire after 24 hours
                and can only be used once.
              </p>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-secondary"
              >
                New Password
              </label>

              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Minimum 12 characters"
                  className={`${inputClass} pr-12`}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-subtle hover:text-ink"
                >
                  {showPassword ? (
                    <EyeOff size={19} />
                  ) : (
                    <Eye size={19} />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-2 block text-sm font-medium text-secondary"
              >
                Confirm Password
              </label>

              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                required
                minLength={12}
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="Re-enter your password"
                className={inputClass}
              />
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-accent-line bg-accent-soft p-4">
              <ShieldCheck
                size={19}
                className="mt-0.5 shrink-0 text-accent"
              />

              <p className="text-xs leading-5 text-muted">
                Your password will be submitted securely
                to the local API for hashing and storage.
                For production, use HTTPS.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-action px-5 py-3.5 text-sm font-semibold transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle
                  size={19}
                  className="animate-spin"
                />
              ) : (
                <LockKeyhole size={19} />
              )}

              {loading
                ? "Activating Account..."
                : "Activate Account"}
            </button>
          </form>

          <div className="mt-7 border-t border-line pt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-accent transition hover:text-accent"
            >
              Already activated? Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
