import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import TenantLayout from "../components/TenantLayout";
import { Modal, PageHeader, SearchField, StatusBadge } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const panel = "min-w-0 space-y-4 rounded-panel border border-line bg-panel p-4 shadow-panel sm:p-5";
const field = "field-control";
const action = "control";
const primary = "rounded-lg bg-action px-4 py-2 text-sm font-semibold disabled:opacity-50";

function useFleetDirectory(resource) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get(`/fleet/${resource}`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setItems(data);
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load records.");
    });
    return () => controller.abort();
  }, [resource]);

  async function mutate(method, suffix, body, update) {
    setSaving(true);
    setError("");
    try {
      const { data } = await tenantApi.request({ method, url: `/fleet/${resource}${suffix}`, data: body });
      setItems((current) => update(current, data));
      return true;
    } catch (error) {
      setError(error.response?.data?.message || "Could not save changes.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { items, error, saving, mutate };
}

function Groups({ canManage }) {
  const { items, error, saving, mutate } = useFleetDirectory("groups");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [search, setSearch] = useState("");
  const groups = items?.filter((group) => group.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    const ok = editing
      ? await mutate("patch", `/${editing.id}`, { name }, (groups, group) => groups.map((entry) => entry.id === group.id ? group : entry))
      : await mutate("post", "", { name }, (groups, group) => [...groups, group]);
    if (ok) {
      form.reset();
      setEditing(null);
    }
  }

  async function remove() {
    const ok = await mutate("delete", `/${deleting.id}`, undefined,
      (groups) => groups.filter((group) => group.id !== deleting.id));
    if (ok) {
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
    }
  }

  return (
    <section className={panel}>
      <h2 className="text-lg font-bold">Vehicle groups</h2>
      {canManage && items && (
        <form key={editing?.id ?? "new"} onSubmit={save} className="space-y-3">
          <label className="block space-y-1">Group name
            <input className={field} name="name" maxLength={100} required defaultValue={editing?.name ?? ""} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={primary} disabled={saving}>{editing ? "Save group" : "Create group"}</button>
            {editing && <button type="button" className={action} disabled={saving} onClick={() => setEditing(null)}>Cancel</button>}
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-negative">{error}</p>}
      {!items && !error && <p role="status">Loading groups…</p>}
      {items?.length === 0 && <p className="text-sm text-muted">No vehicle groups yet.</p>}
      {items?.length > 0 && <SearchField label="Search vehicle groups" value={search} onChange={setSearch} />}
      {items?.length > 0 && groups.length === 0 && <p className="text-sm text-muted">No groups match your search.</p>}
      <ul className="divide-y divide-line">
        {groups?.map((group) => (
          <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="min-w-0 break-words font-medium">{group.name}</span>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button className={action} disabled={saving} onClick={() => setEditing(group)}>Edit</button>
                <button className={action} disabled={saving} onClick={() => setDeleting(group)}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && deleting && (
        <Modal labelId="delete-group-title" busy={saving} onClose={() => setDeleting(null)}>
          <div className="space-y-4 p-5">
            <h3 id="delete-group-title" className="break-words font-semibold">Delete {deleting.name}?</h3>
            <p className="text-sm text-muted">Its vehicles will become ungrouped.</p>
            {error && <p role="alert" className="text-negative">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button className={action} disabled={saving} onClick={() => setDeleting(null)}>Cancel</button>
              <button className="control border-negative-line text-negative" disabled={saving} onClick={remove}>Delete group</button>
            </div>
          </div>
        </Modal>
      )}
      <Link to="/vehicles" className="inline-block text-sm text-accent">Manage vehicle assignments</Link>
    </section>
  );
}

function DriverForm({ driver, saving, onSave, onCancel }) {
  return (
    <form className="space-y-3" onSubmit={onSave}>
      <label className="block space-y-1">Full name
        <input className={field} name="fullName" required maxLength={150} defaultValue={driver?.fullName ?? ""} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">Phone
          <input className={field} name="phone" type="tel" maxLength={30} defaultValue={driver?.phone ?? ""} />
        </label>
        <label className="block space-y-1">License number
          <input className={field} name="licenseNumber" maxLength={50} defaultValue={driver?.licenseNumber ?? ""} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={saving}>{driver ? "Save driver" : "Create driver"}</button>
        {driver && <button type="button" className={action} disabled={saving} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function AssignmentHistory({ driver, onClose }) {
  const [records, setRecords] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const url = `/fleet/drivers/${driver.id}/assignments`;

  useEffect(() => {
    const controller = new AbortController();
    tenantApi.get(url, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) {
        setRecords(data.assignments);
        setNextCursor(data.nextCursor);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setError(error.response?.data?.message || "Could not load assignment history.");
    });
    return () => controller.abort();
  }, [url]);

  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const { data } = await tenantApi.get(url, { params: { before: nextCursor } });
      setRecords((current) => [...current, ...data.assignments]);
      setNextCursor(data.nextCursor);
    } catch (error) {
      setError(error.response?.data?.message || "Could not load more assignments.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="break-words font-semibold">{driver.fullName} assignment history</h3>
        <button className={action} onClick={onClose}>Close history</button>
      </div>
      {error && <p role="alert" className="text-negative">{error}</p>}
      {!records && !error && <p role="status">Loading history…</p>}
      {records?.length === 0 && <p className="text-sm text-muted">No assignments yet.</p>}
      <ul className="divide-y divide-line">
        {records?.map((entry) => (
          <li key={entry.id} className="space-y-1 py-2">
            <p className="break-words font-medium">{entry.vehicleName}</p>
            <p className="text-sm text-muted">
              {new Date(entry.startedAt).toLocaleString()} · {entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "Current assignment"}
            </p>
          </li>
        ))}
      </ul>
      {nextCursor && <button className={action} disabled={loadingMore} onClick={loadMore}>Load more</button>}
    </section>
  );
}

function Drivers({ canManage }) {
  const { items, error, saving, mutate } = useFleetDirectory("drivers");
  const [editing, setEditing] = useState(null);
  const [historyId, setHistoryId] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const visibleDrivers = items?.filter((driver) =>
    (!status || driver.isActive === (status === "active")) &&
    [driver.fullName, driver.licenseNumber].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))
  ).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const historyDriver = items?.find((driver) => driver.id === historyId);
  const replaceDriver = (drivers, driver) => drivers.map((entry) => entry.id === driver.id ? driver : entry);

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const ok = editing
      ? await mutate("patch", `/${editing.id}`, data, replaceDriver)
      : await mutate("post", "", data, (drivers, driver) => [...drivers, driver]);
    if (ok) {
      form.reset();
      setEditing(null);
    }
  }

  async function deactivate() {
    if (await mutate("patch", `/${deactivating.id}/deactivate`, undefined, replaceDriver)) {
      if (historyId === deactivating.id) setHistoryVersion((version) => version + 1);
      setDeactivating(null);
    }
  }

  return (
    <section className={panel}>
      <h2 className="text-lg font-bold">Drivers</h2>
      {canManage && items && (
        <DriverForm key={editing?.id ?? "new"} driver={editing} saving={saving} onSave={save} onCancel={() => setEditing(null)} />
      )}
      {error && <p role="alert" className="text-negative">{error}</p>}
      {!items && !error && <p role="status">Loading drivers…</p>}
      {items?.length === 0 && <p className="text-sm text-muted">No drivers yet.</p>}
      {items?.length > 0 && <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,auto)]">
        <SearchField label="Search drivers" value={search} onChange={setSearch} />
        <select className={field} aria-label="Driver status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </div>}
      {items?.length > 0 && visibleDrivers.length === 0 && <p className="text-sm text-muted">No drivers match your filters.</p>}
      <ul className="divide-y divide-line">
        {visibleDrivers?.map((driver) => (
          <li key={driver.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words font-medium">{driver.fullName}</span>
              <StatusBadge tone={driver.isActive ? "positive" : "neutral"}>
                {driver.isActive ? "Active" : "Inactive"}
              </StatusBadge>
            </div>
            {driver.phone && <p className="break-words text-sm text-muted">Phone {driver.phone}</p>}
            {driver.licenseNumber && <p className="break-words text-sm text-muted">License {driver.licenseNumber}</p>}
            <div className="flex flex-wrap gap-2">
              <button className={action} onClick={() => setHistoryId(driver.id)}>Assignment history</button>
              {canManage && <button className={action} disabled={saving} onClick={() => setEditing(driver)}>Edit</button>}
              {canManage && driver.isActive && <button className={action} disabled={saving} onClick={() => setDeactivating(driver)}>Deactivate</button>}
            </div>
          </li>
        ))}
      </ul>
      {canManage && deactivating && (
        <Modal labelId="deactivate-driver-title" busy={saving} onClose={() => setDeactivating(null)}>
          <div className="space-y-4 p-5">
            <h3 id="deactivate-driver-title" className="break-words font-semibold">Deactivate {deactivating.fullName}?</h3>
            <p className="text-sm text-muted">Their current vehicle assignments will end.</p>
            {error && <p role="alert" className="text-negative">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button className={action} disabled={saving} onClick={() => setDeactivating(null)}>Cancel</button>
              <button className="control border-caution-line text-caution" disabled={saving} onClick={deactivate}>Deactivate driver</button>
            </div>
          </div>
        </Modal>
      )}
      {historyDriver && (
        <AssignmentHistory key={`${historyId}-${historyVersion}`} driver={historyDriver} onClose={() => setHistoryId(null)} />
      )}
    </section>
  );
}

export default function FleetOperationsPage() {
  const { session } = useAuth();
  const { customerType, role } = session.profile;
  if (customerType !== "business") return <Navigate to="/vehicles" replace />;
  const canManage = role === "tenant_admin" || role === "manager";
  return (
    <TenantLayout title="Fleet Operations">
      <main className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
        <PageHeader title="Fleet Operations" description="Manage vehicle groups, drivers and assignment history." compact />
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Groups canManage={canManage} />
          <Drivers canManage={canManage} />
        </div>
      </main>
    </TenantLayout>
  );
}
