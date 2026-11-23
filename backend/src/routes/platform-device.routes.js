const express = require("express");
const pool = require("../config/db");
const { requirePlatformAuth } = require("../middleware/platform-auth.middleware");
const traccar = require("../services/traccar.service");
const {
  fail, respondError, parseId, transaction, event, changeState, changeAllocation, setInstallation,
} = require("../services/gps-inventory.service");

const router = express.Router();
router.use(requirePlatformAuth);

const inventoryFields = {
  uniqueId: ["unique_identifier", 100],
  deviceName: ["device_name", 150],
  manufacturer: ["manufacturer", 100],
  model: ["model", 100],
  serialNumber: ["serial_number", 100],
  deviceType: ["device_type", 100],
  purchaseDate: ["purchase_date", 10],
  purchaseReference: ["purchase_reference", 150],
  notes: ["inventory_notes", 2000],
};
const lifecycles = ["available", "reserved", "installed", "faulty", "retired"];
const inventoryProjection = Object.entries(inventoryFields)
  .map(([name, [column]]) => `d.${column}${name === "purchaseDate" ? "::text" : ""} AS "${name}"`).join(", ");
const detailQuery = `SELECT d.id, d.traccar_device_id AS "traccarDeviceId", d.tenant_id AS "tenantId",
  t.name AS "tenantName", d.lifecycle_status AS "lifecycleStatus", d.status,
  v.id AS "vehicleId", v.name AS "vehicleName", v.gps_installed_at AS "installedAt",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt", ${inventoryProjection}
  FROM gps_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
  LEFT JOIN vehicles v ON (v.traccar_device_id, v.tenant_id) = (d.traccar_device_id, d.tenant_id)`;

function validBody(body, keys) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length > 0 && Object.keys(body).every((key) => keys.includes(key));
}

function identifier(value, label = "device ID") {
  const id = parseId(value);
  if (!id) fail(400, `Invalid ${label}.`);
  return id;
}

function pagination(value, max, fallback = 0) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,7}$/.test(value) || Number(value) > max) {
    fail(400, "Invalid pagination.");
  }
  return Number(value);
}

function details(body) {
  if (!validBody(body, Object.keys(inventoryFields))) fail(400, "Invalid inventory fields.");
  return Object.entries(body).map(([key, raw]) => {
    const [column, max] = inventoryFields[key];
    if (raw !== null && (typeof raw !== "string" || raw.includes("\0") || raw.trim().length > max)) {
      fail(400, `Invalid ${key}.`);
    }
    const value = raw?.trim() || null;
    if (key === "uniqueId" && !value) fail(400, "A unique identifier is required.");
    if (key === "purchaseDate" && value) {
      const date = new Date(value + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") ||
          Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
        fail(400, "Invalid purchase date.");
      }
    }
    return [column, value];
  });
}

async function trackedDevices(required = false) {
  try {
    return new Map((await traccar.getDevices()).map((device) => [String(device.id), device]));
  } catch {
    if (required) fail(502, "Traccar is unavailable. Confirm the identifier in Traccar and try again.");
    return null;
  }
}

function trackedIdentity(device) {
  const uniqueId = typeof device?.uniqueId === "string" ? device.uniqueId.trim() : "";
  if (!uniqueId || uniqueId.length > 100 || uniqueId.includes("\0")) {
    fail(409, "The Traccar device has an invalid unique identifier.");
  }
  return uniqueId;
}

function withTelemetry(device, live) {
  return {
    ...device,
    deviceName: device.deviceName || live?.name || null,
    uniqueId: device.uniqueId || live?.uniqueId || null,
    gpsStatus: live?.status || "unknown",
    lastUpdate: live?.lastUpdate || null,
  };
}

async function getDetail(id, client = pool) {
  const { rows: [device] } = await client.query(`${detailQuery} WHERE d.id = $1`, [id]);
  if (!device) fail(404, "GPS device not found.");
  return device;
}

function handle(operation) {
  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      await operation(req, res);
    } catch (error) {
      return respondError(res, error);
    }
  };
}

// Retain the existing list, registration and allocation contracts.
router.get("/", handle(async (_req, res) => {
  const { rows } = await pool.query(`${detailQuery} WHERE d.traccar_device_id IS NOT NULL ORDER BY d.traccar_device_id`);
  const tracked = await trackedDevices();
  res.json(rows.map((device) => withTelemetry(device, tracked?.get(device.traccarDeviceId))));
}));

async function registerLinked(client, device, actor) {
  const traccarId = parseId(device.id);
  if (!traccarId) fail(502, "Traccar returned an invalid device ID.");
  const uniqueId = trackedIdentity(device);
  const { rows: [registered] } = await client.query(
    `INSERT INTO gps_devices (traccar_device_id, unique_identifier, device_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [traccarId, uniqueId, device.name?.slice(0, 150) || null]
  );
  await event(client, registered.id, "registered", actor, { traccarDeviceId: traccarId, toLifecycle: "available" });
  return getDetail(registered.id, client);
}

router.post("/", handle(async (req, res) => {
  if (!validBody(req.body, ["traccarDeviceId"])) fail(400, "Only traccarDeviceId is required.");
  const id = identifier(req.body.traccarDeviceId, "Traccar device ID");
  const tracked = (await trackedDevices(true)).get(id);
  if (!tracked) fail(404, "Traccar device not found.");
  const device = await transaction((client) => registerLinked(client, tracked, req.platformAuth));
  res.status(201).json({ message: "GPS device registered successfully", device: withTelemetry(device, tracked) });
}));

// This legacy action is an explicit administrator request. Inventory CRUD,
// linking, installation, and allocation never create a Traccar device.
router.post("/create", handle(async (req, res) => {
  if (!validBody(req.body, ["name", "uniqueId"])) fail(400, "Invalid GPS device details.");
  const { name, uniqueId } = req.body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 150 || name.includes("\0")) {
    fail(400, "Invalid GPS device name.");
  }
  const [[, identifierValue]] = details({ uniqueId });
  const device = await transaction(async (client) => {
    // A unique local reservation serializes concurrent creates of this identifier.
    const { rows: [reserved] } = await client.query(
      "INSERT INTO gps_devices (unique_identifier, device_name) VALUES ($1, $2) RETURNING id",
      [identifierValue, name.trim()]
    );
    const tracked = await trackedDevices(true);
    if ([...tracked.values()].some((item) => item.uniqueId?.trim().toLowerCase() === identifierValue.toLowerCase())) {
      fail(409, "This identifier already exists in Traccar. Register or link the existing device.");
    }
    let created;
    try {
      created = await traccar.createDevice({ name: name.trim(), uniqueId: identifierValue });
    } catch (error) {
      if ([400, 409].includes(error.response?.status)) fail(409, "Traccar rejected the identifier.");
      fail(502, "Traccar did not confirm creation. Check Traccar before retrying.");
    }
    const id = parseId(created?.id);
    if (!id) fail(502, "Traccar returned an invalid ID. Check Traccar and register the existing device.");
    if (trackedIdentity(created).toLowerCase() !== identifierValue.toLowerCase()) {
      fail(502, "Traccar returned a different identifier. Check Traccar before retrying.");
    }
    await client.query("UPDATE gps_devices SET traccar_device_id = $2 WHERE id = $1", [reserved.id, id]);
    await event(client, reserved.id, "registered", req.platformAuth, { traccarDeviceId: id, toLifecycle: "available" });
    return withTelemetry(await getDetail(reserved.id, client), created);
  });
  res.status(201).json({ message: "GPS device created and registered successfully", device });
}));

router.get("/inventory", handle(async (req, res) => {
  const { q = "", lifecycle = "" } = req.query;
  if (typeof q !== "string" || q.length > 150 || q.includes("\0") ||
      (lifecycle !== "" && !lifecycles.includes(lifecycle))) fail(400, "Invalid search or lifecycle filter.");
  const offset = pagination(req.query.offset, 1000000);
  const limit = pagination(req.query.limit, 100, 25);
  if (!limit) fail(400, "Page size must be at least one.");
  const tracked = await trackedDevices();
  // Include matching live identifiers for pre-011 records that still need reconciliation.
  const search = q.trim().toLowerCase();
  const liveIds = search && tracked ? [...tracked].filter(([, device]) =>
    [device.uniqueId, device.name].some((value) => value?.toLowerCase().includes(search))
  ).map(([id]) => parseId(id)).filter(Boolean) : [];
  const { rows } = await pool.query(`${detailQuery}
    WHERE ($1 = '' OR d.lifecycle_status = $1)
      AND ($2 = '' OR strpos(lower(concat_ws(' ', d.unique_identifier, d.device_name, d.manufacturer,
        d.model, d.serial_number, d.device_type, d.traccar_device_id, t.name)), $2) > 0
        OR d.traccar_device_id = ANY($3::bigint[]))
    ORDER BY d.id DESC LIMIT $4 OFFSET $5`, [lifecycle, search, liveIds, limit + 1, offset]);
  res.json({
    data: rows.slice(0, limit).map((device) => withTelemetry(device, tracked?.get(device.traccarDeviceId))),
    pagination: { limit, offset, hasMore: rows.length > limit },
    traccarAvailable: tracked !== null,
  });
}));

router.post("/inventory", handle(async (req, res) => {
  const fields = details(req.body);
  if (!req.body.uniqueId) fail(400, "A unique identifier is required.");
  const device = await transaction(async (client) => {
    const { rows: [record] } = await client.query(
      `INSERT INTO gps_devices (${fields.map(([field]) => field).join(", ")})
       VALUES (${fields.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
      fields.map(([, value]) => value)
    );
    await event(client, record.id, "registered", req.platformAuth, { toLifecycle: "available" });
    return getDetail(record.id, client);
  });
  res.status(201).json(device);
}));

router.get("/inventory/tenants", handle(async (req, res) => {
  const { q = "" } = req.query;
  if (typeof q !== "string" || q.length > 150 || q.includes("\0")) fail(400, "Invalid tenant search.");
  const { rows } = await pool.query(
    `SELECT id, name, slug, customer_type AS "customerType" FROM tenants
     WHERE status = 'active' AND strpos(lower(concat_ws(' ', name, slug, id)), $1) > 0
     ORDER BY name, id LIMIT 25`, [q.trim().toLowerCase()]
  );
  res.json(rows);
}));

router.get("/inventory/:id", handle(async (req, res) => {
  const device = await getDetail(identifier(req.params.id));
  const tracked = device.traccarDeviceId ? await trackedDevices() : null;
  res.json({ ...withTelemetry(device, tracked?.get(device.traccarDeviceId)), identifierVerified:
    Boolean(device.traccarDeviceId && device.uniqueId) });
}));

router.patch("/inventory/:id", handle(async (req, res) => {
  const id = identifier(req.params.id);
  const fields = details(req.body);
  const device = await transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT id, traccar_device_id, unique_identifier FROM gps_devices WHERE id = $1 FOR UPDATE", [id]
    );
    if (!current) fail(404, "GPS device not found.");
    const unique = fields.find(([column]) => column === "unique_identifier");
    if (unique && current.traccar_device_id && unique[1] !== current.unique_identifier) {
      fail(409, "Use Traccar reconciliation to verify an existing linked identifier.");
    }
    await client.query(
      `UPDATE gps_devices SET ${fields.map(([field], index) => `${field} = $${index + 2}`).join(", ")},
       updated_at = NOW() WHERE id = $1`, [id, ...fields.map(([, value]) => value)]
    );
    await event(client, id, "edited", req.platformAuth, { fields: Object.keys(req.body) });
    return getDetail(id, client);
  });
  res.json(device);
}));

router.patch("/inventory/:id/link", handle(async (req, res) => {
  const id = identifier(req.params.id);
  if (!validBody(req.body, ["traccarDeviceId"])) fail(400, "Specify the existing Traccar device ID.");
  const traccarDeviceId = identifier(req.body.traccarDeviceId, "Traccar device ID");
  const tracked = (await trackedDevices(true)).get(traccarDeviceId);
  if (!tracked) fail(404, "Traccar device not found.");
  const uniqueId = trackedIdentity(tracked);
  const result = await transaction(async (client) => {
    const { rows: [device] } = await client.query("SELECT * FROM gps_devices WHERE id = $1 FOR UPDATE", [id]);
    if (!device) fail(404, "GPS device not found.");
    if (device.lifecycle_status === "retired") fail(409, "Retired devices cannot be linked.");
    if (device.traccar_device_id && device.traccar_device_id !== traccarDeviceId) {
      fail(409, "A linked Traccar ID cannot be replaced.");
    }
    if (device.unique_identifier && device.unique_identifier.toLowerCase() !== uniqueId.toLowerCase()) {
      fail(409, "The inventory identifier does not match the Traccar identifier.");
    }
    if (device.traccar_device_id === traccarDeviceId && device.unique_identifier) return getDetail(id, client);
    await client.query(
      `UPDATE gps_devices SET traccar_device_id = $2, unique_identifier = $3,
       device_name = COALESCE(device_name, $4), updated_at = NOW() WHERE id = $1`,
      [id, traccarDeviceId, uniqueId, tracked.name?.slice(0, 150) || null]
    );
    await event(client, id, "linked", req.platformAuth, { traccarDeviceId });
    return getDetail(id, client);
  });
  res.json(withTelemetry(result, tracked));
}));

router.patch("/inventory/:id/lifecycle", handle(async (req, res) => {
  const id = identifier(req.params.id);
  if (!validBody(req.body, ["lifecycleStatus"])) fail(400, "Specify a lifecycle status.");
  const next = req.body.lifecycleStatus;
  await transaction(async (client) => {
    const { rows: [device] } = await client.query("SELECT * FROM gps_devices WHERE id = $1 FOR UPDATE", [id]);
    if (!device) fail(404, "GPS device not found.");
    const current = device.lifecycle_status;
    const transitions = {
      available: ["faulty", "retired"],
      reserved: ["faulty"],
      installed: [],
      faulty: device.tenant_id ? ["reserved"] : ["available", "retired"],
      retired: [],
    };
    if (!transitions[current].includes(next)) {
      fail(409, "This lifecycle change is invalid. Use allocation and installation actions to change those states.");
    }
    await changeState(client, device, next, device.tenant_id);
    await event(client, id, "lifecycle_changed", req.platformAuth, {
      tenantId: device.tenant_id, fromLifecycle: current, toLifecycle: next,
    });
  });
  res.json(await getDetail(id));
}));

router.patch("/inventory/:id/allocation", handle(async (req, res) => {
  const deviceId = identifier(req.params.id);
  const body = req.body;
  if (!validBody(body, ["action", "tenantId"]) || !["allocate", "release", "transfer"].includes(body.action) ||
      (body.action === "release" && body.tenantId != null)) fail(400, "Invalid allocation action.");
  const targetTenantId = body.action === "release" ? null : identifier(body.tenantId, "tenant ID");
  const actions = { allocate: "allocated", release: "released", transfer: "transferred" };
  res.json(await changeAllocation({ deviceId, targetTenantId, action: actions[body.action], actor: req.platformAuth }));
}));

router.patch("/:id/allocate", handle(async (req, res) => {
  if (!validBody(req.body, ["tenantId"])) fail(400, "Only tenantId is required.");
  const targetTenantId = identifier(req.body.tenantId, "tenant ID");
  const device = await changeAllocation({
    deviceId: identifier(req.params.id, "Traccar device ID"), byTraccarId: true, targetTenantId,
    action: "allocated", actor: req.platformAuth,
  });
  res.json({ message: "GPS device allocated successfully", device: await getDetail(device.id) });
}));

router.get("/inventory/:id/history", handle(async (req, res) => {
  const id = identifier(req.params.id);
  await getDetail(id);
  const before = req.query.before === undefined ? null : identifier(req.query.before, "history cursor");
  const { rows } = await pool.query(
    `SELECT e.id, e.action, e.details, e.created_at AS "createdAt",
            CASE WHEN e.platform_admin_id IS NOT NULL THEN 'platform'
                 WHEN e.tenant_user_id IS NOT NULL THEN 'tenant' ELSE 'migration' END AS "actorType",
            COALESCE(e.platform_admin_id, e.tenant_user_id) AS "actorId",
            COALESCE(p.full_name, u.full_name) AS "actorName"
     FROM gps_device_events e
     LEFT JOIN platform_admins p ON p.id = e.platform_admin_id
     LEFT JOIN users u ON u.id = e.tenant_user_id
     WHERE e.device_id = $1 AND ($2::bigint IS NULL OR e.id < $2)
     ORDER BY e.id DESC LIMIT 51`, [id, before]
  );
  const data = rows.slice(0, 50);
  res.json({ data, nextCursor: rows.length > 50 ? data.at(-1).id : null });
}));

router.get("/inventory/:id/vehicles", handle(async (req, res) => {
  const device = await getDetail(identifier(req.params.id));
  if (!device.tenantId) return res.json([]);
  const { rows } = await pool.query(
    `SELECT id, name, traccar_device_id AS "traccarDeviceId" FROM vehicles
     WHERE tenant_id = $1 ORDER BY name, id`, [device.tenantId]
  );
  res.json(rows);
}));

router.put("/inventory/:id/installation", handle(async (req, res) => {
  const device = await getDetail(identifier(req.params.id));
  if (!validBody(req.body, ["vehicleId", "expectedDeviceId"])) fail(400, "Specify a vehicle or null to remove.");
  if (!device.tenantId || !device.traccarDeviceId) fail(409, "Allocate and link this device first.");
  const remove = req.body.vehicleId === null;
  if (remove && !device.vehicleId) fail(409, "The device is not installed.");
  const vehicleId = remove ? device.vehicleId : identifier(req.body.vehicleId, "vehicle ID");
  const expected = req.body.expectedDeviceId == null ? req.body.expectedDeviceId :
    identifier(req.body.expectedDeviceId, "current GPS device ID");
  await setInstallation({
    tenantId: device.tenantId, vehicleId, traccarDeviceId: remove ? null : device.traccarDeviceId,
    fromVehicleId: !remove && device.vehicleId !== vehicleId ? device.vehicleId : null,
    expected, actor: req.platformAuth, removeDeviceId: remove ? device.id : undefined,
  });
  res.status(204).end();
}));

module.exports = router;
