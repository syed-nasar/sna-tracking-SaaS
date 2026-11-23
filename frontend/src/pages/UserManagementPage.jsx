import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import TenantLayout from "../components/TenantLayout";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const roles = [
  ["viewer", "Viewer"],
  ["manager", "Manager"],
  ["tenant_admin", "Tenant administrator"],
];
const inputClass = "w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-ink";
const panelClass = "rounded-xl border border-line bg-panel p-5";

function RoleOptions() {
  return roles.map(([value, label]) => <option key={value} value={value}>{label}</option>);
}

function UserManagement({ profile }) {
  const { refreshTenantProfile } = useAuth();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [updateError, setUpdateError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get("/users", { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setUsers(data);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setLoadError(error.response?.data?.message || "Could not load users.");
        if (error.response?.status === 403) void refreshTenantProfile();
      }
    });
    return () => controller.abort();
  }, [refreshTenantProfile]);

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const fullName = fields.get("fullName").trim();
    const email = fields.get("email").trim();
    const password = fields.get("password");
    const role = fields.get("role");
    setFormError("");
    setNotice("");

    if (!fullName) {
      setFormError("Enter a full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
      setFormError("Use a password of at least 12 characters and at most 72 UTF-8 bytes.");
      return;
    }

    setCreating(true);
    try {
      const { data } = await tenantApi.post("/users", { fullName, email, password, role });
      setUsers((current) => [...current, data]);
      form.reset();
      setNotice(`${data.fullName} was added.`);
    } catch (error) {
      setFormError(error.response?.data?.message || "Could not create the user.");
      if (error.response?.status === 403) void refreshTenantProfile();
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(user, changes) {
    setPendingId(user.id);
    setUpdateError("");
    setNotice("");
    try {
      const { data } = await tenantApi.patch(`/users/${user.id}`, changes);
      setUsers((current) => current.map((entry) => entry.id === data.id ? data : entry));
      setNotice(`${data.fullName} was updated.`);
    } catch (error) {
      setUpdateError(error.response?.data?.message || "Could not update the user.");
      if (error.response?.status === 403) void refreshTenantProfile();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <TenantLayout title="User Management">
      <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
        <h1 className="text-2xl font-bold">User Management</h1>
        {loadError && <p role="alert" className="text-negative">{loadError}</p>}
        {!users && !loadError && <p role="status">Loading users…</p>}
        {notice && <p role="status" className="text-positive">{notice}</p>}
        {users && (
          <>
            <form className={panelClass} onSubmit={createUser} autoComplete="off">
              <h2 className="mb-4 text-lg font-semibold">Add a user</h2>
              <fieldset disabled={creating} className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1">
                  <span>Full name</span>
                  <input className={inputClass} name="fullName" maxLength={150} required />
                </label>
                <label className="space-y-1">
                  <span>Email</span>
                  <input className={inputClass} name="email" type="email" maxLength={255} required />
                </label>
                <label className="space-y-1">
                  <span>Password</span>
                  <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={12} required />
                </label>
                <label className="space-y-1">
                  <span>Role</span>
                  <select className={inputClass} name="role" defaultValue="viewer"><RoleOptions /></select>
                </label>
                <button className="justify-self-start rounded-lg bg-action px-4 py-2 font-semibold disabled:opacity-50">
                  {creating ? "Adding…" : "Add user"}
                </button>
              </fieldset>
              {formError && <p role="alert" className="mt-3 text-negative">{formError}</p>}
            </form>
            <section className={panelClass}>
              <h2 className="mb-4 text-lg font-semibold">Company users</h2>
              {updateError && <p role="alert" className="mb-4 text-negative">{updateError}</p>}
              <ul className="divide-y divide-line">
                {users.map((user) => {
                  const isSelf = String(user.id) === String(profile.id);
                  return (
                    <li key={user.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_13rem_7rem_7rem] md:items-center">
                      <div className="min-w-0">
                        <p className="break-words font-medium">{user.fullName}{isSelf && " (you)"}</p>
                        <p className="break-all text-sm text-muted">{user.email}</p>
                      </div>
                      <select className={inputClass} aria-label={`Role for ${user.email}`} value={user.role}
                        disabled={isSelf || pendingId !== null}
                        onChange={(event) => updateUser(user, { role: event.target.value })}>
                        <RoleOptions />
                      </select>
                      <span className={user.isActive ? "text-positive" : "text-muted"}>
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                      {!isSelf && (
                        <button type="button" disabled={pendingId !== null}
                          aria-label={`${user.isActive ? "Deactivate" : "Activate"} ${user.email}`}
                          className="justify-self-start rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-50"
                          onClick={() => updateUser(user, { isActive: !user.isActive })}>
                          {user.isActive ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </main>
    </TenantLayout>
  );
}

export default function UserManagementPage() {
  const { session } = useAuth();
  const profile = session.profile;
  if (profile.customerType !== "business" || profile.role !== "tenant_admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <UserManagement profile={profile} />;
}
