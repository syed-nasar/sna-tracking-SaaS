import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TenantLayout from "../components/TenantLayout";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const inputClass = "w-full rounded-lg border border-white/15 bg-[#090d16] px-3 py-2 text-white";
const panelClass = "space-y-4 rounded-xl border border-white/10 bg-[#0d1422] p-5";
const buttonClass = "rounded-lg bg-blue-600 px-4 py-2 font-semibold disabled:opacity-50";

export default function AccountPage() {
  const { session, logout, refreshTenantProfile } = useAuth();
  const navigate = useNavigate();
  const isBusiness = session.profile.customerType === "business";
  const title = isBusiness ? "Company Account" : "My Account";
  const [account, setAccount] = useState(null);
  const [fullName, setFullName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [profileResult, setProfileResult] = useState(null);
  const [passwordError, setPasswordError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get("/users/me", { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setAccount(data);
      setFullName(data.fullName);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setLoadError(error.response?.data?.message || "Could not load your account.");
      }
    });
    return () => controller.abort();
  }, []);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileResult(null);
    try {
      const { data } = await tenantApi.patch("/users/me", { fullName: fullName.trim() });
      setFullName(data.fullName);
      void refreshTenantProfile();
      setProfileResult({ message: "Profile saved.", success: true });
    } catch (error) {
      setProfileResult({ message: error.response?.data?.message || "Could not save your profile." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const currentPassword = fields.get("currentPassword");
    const newPassword = fields.get("newPassword");

    if ([...newPassword].length < 12 || new TextEncoder().encode(newPassword).length > 72) {
      setPasswordError("Use at least 12 characters and at most 72 UTF-8 bytes.");
      return;
    }
    if (newPassword !== fields.get("confirmPassword")) {
      setPasswordError("The new passwords must match.");
      return;
    }

    setSavingPassword(true);
    try {
      await tenantApi.patch("/users/me/password", { currentPassword, newPassword });
      form.reset();
      logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setPasswordError(error.response?.data?.message || "Could not change your password.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <TenantLayout title={title}>
      <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {loadError && <p role="alert" className="text-red-300">{loadError}</p>}
        {!account && !loadError && <p role="status">Loading account…</p>}
        {account && (
          <div className="grid gap-6 lg:grid-cols-2">
            <form className={panelClass} onSubmit={saveProfile}>
              <h2 className="text-lg font-semibold">Profile</h2>
              <dl className="space-y-3 text-sm">
                {isBusiness && (
                  <>
                    <div><dt className="text-slate-400">Company</dt><dd className="break-words">{session.profile.tenantName}</dd></div>
                    <div><dt className="text-slate-400">Company slug</dt><dd className="break-words">{session.profile.tenantSlug ?? account.tenantSlug}</dd></div>
                  </>
                )}
                <div><dt className="text-slate-400">Email</dt><dd className="break-all">{session.profile.email}</dd></div>
                <div><dt className="text-slate-400">Role</dt><dd className="capitalize">{session.profile.role.replaceAll("_", " ")}</dd></div>
              </dl>
              <label className="block space-y-1">
                <span>Full name</span>
                <input className={inputClass} autoComplete="name" required maxLength={150}
                  value={fullName} onChange={(event) => setFullName(event.target.value)} />
              </label>
              <button className={buttonClass} disabled={savingProfile || !fullName.trim()}>
                {savingProfile ? "Saving…" : "Save profile"}
              </button>
              {profileResult && (
                <p role={profileResult.success ? "status" : "alert"}
                  className={profileResult.success ? "text-green-300" : "text-red-300"}>
                  {profileResult.message}
                </p>
              )}
            </form>
            <form className={panelClass} onSubmit={changePassword}>
              <h2 className="text-lg font-semibold">Change password</h2>
              <p className="text-sm text-slate-400">Changing your password signs you out of all sessions.</p>
              <fieldset disabled={savingPassword} className="space-y-4">
                <label className="block space-y-1">
                  <span>Current password</span>
                  <input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required />
                </label>
                <label className="block space-y-1">
                  <span>New password</span>
                  <input className={inputClass} name="newPassword" type="password" autoComplete="new-password" required />
                </label>
                <label className="block space-y-1">
                  <span>Confirm new password</span>
                  <input className={inputClass} name="confirmPassword" type="password" autoComplete="new-password" required />
                </label>
                <button className={buttonClass}>{savingPassword ? "Changing…" : "Change password"}</button>
              </fieldset>
              {passwordError && <p role="alert" className="text-red-300">{passwordError}</p>}
            </form>
          </div>
        )}
      </main>
    </TenantLayout>
  );
}
