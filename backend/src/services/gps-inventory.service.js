const pool = require("../config/db");

class InventoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new InventoryError(status, message);
}

function respondError(res, error) {
  if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
  if (error.code === "23505") return res.status(409).json({ message: "The identifier, registration, or device is already in use." });
  if (error.code === "23503" || error.code === "40P01") {
    return res.status(409).json({ message: "A related record changed. Refresh and try again." });
  }
  console.error("GPS inventory operation failed:", error.code || error.name);
  return res.status(500).json({ message: "GPS inventory operation failed." });
}

function parseId(value) {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isSafeInteger(value))) return null;
  const id = String(value);
  return /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n ? id : null;
}

async function transaction(operation) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

async function lockTenant(client, tenantId, allowInactive = false) {
  const { rows } = await client.query("SELECT id, status FROM tenants WHERE id = $1 FOR SHARE", [tenantId]);
  if (!rows.length) fail(404, "Tenant not found.");
  if (!allowInactive && rows[0].status !== "active") fail(409, "This operation requires an active tenant.");
}

async function event(client, deviceId, action, actor, details) {
  await client.query(
    `INSERT INTO gps_device_events (device_id, action, platform_admin_id, tenant_user_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [deviceId, action, actor.adminId ?? null, actor.userId ?? null, details]
  );
}

function legacyStatus(lifecycle) {
  if (lifecycle === "available") return "available";
  if (lifecycle === "faulty" || lifecycle === "retired") return "inactive";
  return "assigned";
}

async function changeState(client, device, lifecycle, tenantId) {
  await client.query(
    `UPDATE gps_devices SET lifecycle_status = $2, status = $3, tenant_id = $4, updated_at = NOW()
     WHERE id = $1`,
    [device.id, lifecycle, legacyStatus(lifecycle), tenantId]
  );
}

async function changeAllocation({ deviceId, byTraccarId = false, targetTenantId, action, actor }) {
  return transaction(async (client) => {
    if (targetTenantId) await lockTenant(client, targetTenantId);
    const { rows: [device] } = await client.query(
      `SELECT * FROM gps_devices WHERE ${byTraccarId ? "traccar_device_id" : "id"} = $1 FOR UPDATE`,
      [deviceId]
    );
    if (!device) fail(404, "GPS device not found.");
    const previous = device.tenant_id;
    const lifecycle = device.lifecycle_status;
    if (lifecycle === "installed") fail(409, "Remove the device from its vehicle before changing allocation.");
    if (action === "allocated" && (lifecycle !== "available" || previous)) {
      fail(409, "Only available devices can be allocated.");
    }
    if (action === "released" && (!previous || !["reserved", "faulty"].includes(lifecycle))) {
      fail(409, "This device has no releasable allocation.");
    }
    if (action === "transferred" && (lifecycle !== "reserved" || previous === targetTenantId)) {
      fail(409, "Only a reserved device can be transferred to a different tenant.");
    }
    const next = targetTenantId ? "reserved" : lifecycle === "faulty" ? "faulty" : "available";
    await changeState(client, device, next, targetTenantId);
    await event(client, device.id, action, actor, {
      fromTenantId: previous, toTenantId: targetTenantId, fromLifecycle: lifecycle, toLifecycle: next,
    });
    return { id: device.id, traccarDeviceId: device.traccar_device_id, tenantId: targetTenantId,
      lifecycleStatus: next, status: legacyStatus(next) };
  });
}

async function revalidateActor(client, tenantId, actor) {
  if (!actor.userId) return;
  const { rowCount } = await client.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND is_active
       AND token_version = $3 AND role IN ('tenant_admin', 'manager') FOR SHARE`,
    [tenantId, actor.userId, actor.tokenVersion]
  );
  if (!rowCount) fail(403, "Vehicle management permission is no longer valid.");
}

async function reservedDevice(client, tenantId, traccarDeviceId) {
  const { rows: [device] } = await client.query(
    "SELECT * FROM gps_devices WHERE tenant_id = $1 AND traccar_device_id = $2 FOR UPDATE",
    [tenantId, traccarDeviceId]
  );
  if (!device) fail(404, "Allocated GPS device not found.");
  if (device.lifecycle_status !== "reserved") fail(409, "GPS device is already installed or unavailable.");
  return device;
}

async function recordVehicleCreation(tenantId, traccarDeviceId, actor, createVehicle) {
  return transaction(async (client) => {
    await lockTenant(client, tenantId);
    await revalidateActor(client, tenantId, actor);
    const device = await reservedDevice(client, tenantId, traccarDeviceId);
    const vehicle = await createVehicle(client);
    await changeState(client, device, "installed", tenantId);
    await event(client, device.id, "installed", actor, {
      tenantId, vehicleId: vehicle.id, fromLifecycle: "reserved", toLifecycle: "installed",
    });
    return vehicle;
  });
}

async function setInstallation({ tenantId, vehicleId, traccarDeviceId, fromVehicleId, expected, actor, removeDeviceId }) {
  return transaction(async (client) => {
    // Platform administrators can recover an installed device from a suspended account.
    await lockTenant(client, tenantId, !traccarDeviceId && Boolean(actor.adminId));
    await revalidateActor(client, tenantId, actor);

    const { rows: vehicles } = await client.query(
      `SELECT id, traccar_device_id FROM vehicles
       WHERE tenant_id = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE`,
      [tenantId, fromVehicleId ? [vehicleId, fromVehicleId] : [vehicleId]]
    );
    const target = vehicles.find((vehicle) => vehicle.id === vehicleId);
    const source = vehicles.find((vehicle) => vehicle.id === fromVehicleId);
    if (!target || (fromVehicleId && !source)) fail(404, "Vehicle not found.");
    if (expected !== undefined && target.traccar_device_id !== expected) {
      fail(409, "The vehicle's device changed. Refresh and try again.");
    }
    if (source && source.traccar_device_id !== traccarDeviceId) {
      fail(409, "The source vehicle no longer has this device.");
    }
    if (target.traccar_device_id === traccarDeviceId && !removeDeviceId) return;

    const ids = [target.traccar_device_id, traccarDeviceId].filter(Boolean);
    const { rows: devices } = await client.query(
      `SELECT * FROM gps_devices WHERE tenant_id = $1 AND traccar_device_id = ANY($2::bigint[])
       ORDER BY id FOR UPDATE`,
      [tenantId, ids]
    );
    const previous = devices.find((device) => device.traccar_device_id === target.traccar_device_id);
    const next = devices.find((device) => device.traccar_device_id === traccarDeviceId);
    if (removeDeviceId && previous?.id !== removeDeviceId) fail(409, "This installation has already changed.");
    if (traccarDeviceId && !next) fail(404, "Allocated GPS device not found.");
    if (next && next.lifecycle_status !== (source ? "installed" : "reserved")) {
      fail(409, "GPS device is already installed or unavailable.");
    }

    if (source) {
      await client.query(
        `UPDATE vehicles SET traccar_device_id = NULL, gps_installed_at = NULL, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`, [tenantId, source.id]
      );
    }
    await client.query(
      `UPDATE vehicles SET traccar_device_id = $3::bigint,
         gps_installed_at = CASE WHEN $3::bigint IS NULL THEN NULL ELSE clock_timestamp() END,
         updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, target.id, traccarDeviceId]
    );

    if (previous) {
      await changeState(client, previous, "reserved", tenantId);
      await event(client, previous.id, next ? "replaced" : "removed", actor, {
        tenantId, vehicleId: target.id, replacementDeviceId: next?.id ?? null,
        fromLifecycle: "installed", toLifecycle: "reserved",
      });
    }
    if (next) {
      if (!source) await changeState(client, next, "installed", tenantId);
      await event(client, next.id, source ? "reassigned" : "installed", actor, {
        tenantId, vehicleId: target.id, fromVehicleId: source?.id ?? null,
        previousDeviceId: previous?.id ?? null, fromLifecycle: next.lifecycle_status, toLifecycle: "installed",
      });
    }
  });
}

module.exports = {
  InventoryError, fail, respondError, parseId, transaction, event, changeState, changeAllocation,
  recordVehicleCreation, setInstallation,
};
