const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const router = express.Router();
const write = authorize("vehicles:write");
const driverFields = 'id, full_name AS "fullName", phone, license_number AS "licenseNumber", is_active AS "isActive"';

router.use(requireAuth, authorize("vehicles:read"), (req, res, next) => {
  if (req.auth.customerType !== "business") {
    return res.status(403).json({ message: "Fleet operations require a Business account" });
  }
  next();
});

function validId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n;
}

function validText(value, max, required = false) {
  if (value === null) return !required;
  return typeof value === "string" && !value.includes("\0") &&
    value.trim().length <= max && (!required || Boolean(value.trim()));
}

function bodyFields(body, allowed) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).length > 0 && Object.keys(body).every((key) => allowed.includes(key));
}

function failure(res, error) {
  if (error.code === "23505") return res.status(409).json({ message: "A record with that name or assignment already exists" });
  if (error.code === "23503") return res.status(404).json({ message: "Related fleet record was not found" });
  console.error("Fleet operation failed:", error.code);
  return res.status(500).json({ message: "Fleet operation failed" });
}

function notFound(res) {
  return res.status(404).json({ message: "Fleet record not found" });
}

function invalid(res) {
  return res.status(400).json({ message: "Invalid fleet details" });
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

router.get("/groups", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM vehicle_groups WHERE tenant_id = $1 ORDER BY lower(name), id",
      [req.auth.tenantId]
    );
    return res.json(rows);
  } catch (error) {
    return failure(res, error);
  }
});

router.post("/groups", write, async (req, res) => {
  if (!bodyFields(req.body, ["name"]) || !validText(req.body.name, 100, true)) return invalid(res);
  try {
    const { rows } = await pool.query(
      "INSERT INTO vehicle_groups (tenant_id, name) VALUES ($1, $2) RETURNING id, name",
      [req.auth.tenantId, req.body.name.trim()]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return failure(res, error);
  }
});

router.patch("/groups/:id", write, async (req, res) => {
  if (!validId(req.params.id) || !bodyFields(req.body, ["name"]) ||
      !validText(req.body.name, 100, true)) return invalid(res);
  try {
    const { rows } = await pool.query(
      "UPDATE vehicle_groups SET name = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id, name",
      [req.auth.tenantId, req.params.id, req.body.name.trim()]
    );
    return rows.length ? res.json(rows[0]) : notFound(res);
  } catch (error) {
    return failure(res, error);
  }
});

router.delete("/groups/:id", write, async (req, res) => {
  if (!validId(req.params.id)) return invalid(res);
  try {
    const result = await pool.query("DELETE FROM vehicle_groups WHERE tenant_id = $1 AND id = $2",
      [req.auth.tenantId, req.params.id]);
    return result.rowCount ? res.status(204).end() : notFound(res);
  } catch (error) {
    return failure(res, error);
  }
});

router.get("/drivers", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${driverFields} FROM drivers WHERE tenant_id = $1 ORDER BY lower(full_name), id`,
      [req.auth.tenantId]
    );
    return res.json(rows);
  } catch (error) {
    return failure(res, error);
  }
});

function validDriver(body) {
  return bodyFields(body, ["fullName", "phone", "licenseNumber"]) &&
    validText(body.fullName, 150, true) && validText(body.phone ?? null, 30) &&
    validText(body.licenseNumber ?? null, 50);
}

router.post("/drivers", write, async (req, res) => {
  if (!validDriver(req.body)) return invalid(res);
  const { fullName, phone, licenseNumber } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO drivers (tenant_id, full_name, phone, license_number)
       VALUES ($1, $2, $3, $4) RETURNING ${driverFields}`,
      [req.auth.tenantId, fullName.trim(), phone?.trim() || null, licenseNumber?.trim() || null]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return failure(res, error);
  }
});

router.patch("/drivers/:id", write, async (req, res) => {
  if (!validId(req.params.id) || !validDriver(req.body)) return invalid(res);
  const { fullName, phone, licenseNumber } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE drivers SET full_name = $3,
         phone = CASE WHEN $4 THEN $5 ELSE phone END,
         license_number = CASE WHEN $6 THEN $7 ELSE license_number END
       WHERE tenant_id = $1 AND id = $2 RETURNING ${driverFields}`,
      [req.auth.tenantId, req.params.id, fullName.trim(), phone !== undefined, phone?.trim() || null,
        licenseNumber !== undefined, licenseNumber?.trim() || null]
    );
    return rows.length ? res.json(rows[0]) : notFound(res);
  } catch (error) {
    return failure(res, error);
  }
});

router.patch("/drivers/:id/deactivate", write, async (req, res) => {
  if (!validId(req.params.id)) return invalid(res);
  const params = [req.auth.tenantId, req.params.id];
  try {
    const driver = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE drivers SET is_active = FALSE WHERE tenant_id = $1 AND id = $2 RETURNING ${driverFields}`,
        params
      );
      if (!rows.length) return null;
      await client.query(
        `UPDATE driver_assignments SET ended_at = GREATEST(clock_timestamp(), started_at)
         WHERE tenant_id = $1 AND driver_id = $2 AND ended_at IS NULL`, params
      );
      return rows[0];
    });
    return driver ? res.json(driver) : notFound(res);
  } catch (error) {
    return failure(res, error);
  }
});

router.get("/drivers/:id/assignments", async (req, res) => {
  if (!validId(req.params.id)) return invalid(res);
  const before = req.query.before ?? null;
  if (before !== null && !validId(before)) return invalid(res);
  try {
    const params = [req.auth.tenantId, req.params.id];
    const driver = await pool.query("SELECT id FROM drivers WHERE tenant_id = $1 AND id = $2", params);
    if (!driver.rowCount) return notFound(res);
    const { rows } = await pool.query(
      `SELECT a.id, a.vehicle_id AS "vehicleId", v.name AS "vehicleName",
              a.started_at AS "startedAt", a.ended_at AS "endedAt"
       FROM driver_assignments a JOIN vehicles v ON (v.id, v.tenant_id) = (a.vehicle_id, a.tenant_id)
       WHERE a.tenant_id = $1 AND a.driver_id = $2 AND ($3::bigint IS NULL OR a.id < $3)
       ORDER BY a.id DESC LIMIT 51`,
      [...params, before]
    );
    const assignments = rows.slice(0, 50);
    return res.json({ assignments, nextCursor: rows.length > 50 ? assignments.at(-1).id : null });
  } catch (error) {
    return failure(res, error);
  }
});

router.patch("/vehicles/:id/details", write, async (req, res) => {
  const body = req.body;
  if (!validId(req.params.id) || !bodyFields(body, ["groupId", "fleetNumber", "operationalNotes"]) ||
      (body.groupId != null && !validId(body.groupId)) ||
      !validText(body.fleetNumber ?? null, 50) || !validText(body.operationalNotes ?? null, 2000)) {
    return invalid(res);
  }
  try {
    const { tenantId } = req.auth;
    const updated = await transaction(async (client) => {
      if (body.groupId != null) {
        // Group deletion locks the group before clearing its vehicle references.
        const group = await client.query(
          "SELECT id FROM vehicle_groups WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE",
          [tenantId, body.groupId]
        );
        if (!group.rowCount) return false;
      }
      const result = await client.query(
        `UPDATE vehicles SET group_id = CASE WHEN $3 THEN $4 ELSE group_id END,
           fleet_number = CASE WHEN $5 THEN $6 ELSE fleet_number END,
           operational_notes = CASE WHEN $7 THEN $8 ELSE operational_notes END, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, req.params.id, body.groupId !== undefined, body.groupId ?? null,
          body.fleetNumber !== undefined, body.fleetNumber?.trim() || null,
          body.operationalNotes !== undefined, body.operationalNotes?.trim() || null]
      );
      return result.rowCount > 0;
    });
    return updated ? res.status(204).end() : notFound(res);
  } catch (error) {
    return failure(res, error);
  }
});

router.put("/vehicles/:id/driver", write, async (req, res) => {
  const vehicleId = req.params.id;
  if (!validId(vehicleId) || !bodyFields(req.body, ["driverId"]) ||
      (req.body.driverId !== null && !validId(req.body.driverId))) return invalid(res);
  const { driverId } = req.body;
  const { tenantId } = req.auth;
  try {
    const status = await transaction(async (client) => {
      if (driverId !== null) {
        // Serialize assignment with deactivation of the selected driver.
        const driver = await client.query(
          "SELECT is_active FROM drivers WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [tenantId, driverId]
        );
        if (!driver.rowCount) return 404;
        if (!driver.rows[0].is_active) return 409;
      }
      const params = [tenantId, vehicleId];
      const vehicle = await client.query("SELECT id FROM vehicles WHERE tenant_id = $1 AND id = $2 FOR UPDATE", params);
      if (!vehicle.rowCount) return 404;

      const current = await client.query(
        `SELECT driver_id FROM driver_assignments
         WHERE tenant_id = $1 AND vehicle_id = $2 AND ended_at IS NULL`, params
      );
      if ((current.rows[0]?.driver_id ?? null) === driverId) return 204;
      await client.query(
        `WITH changed AS (
           UPDATE driver_assignments SET ended_at = GREATEST(clock_timestamp(), started_at)
           WHERE tenant_id = $1 AND vehicle_id = $2 AND ended_at IS NULL
           RETURNING ended_at
         )
         INSERT INTO driver_assignments (tenant_id, vehicle_id, driver_id, started_at)
         SELECT $1, $2, $3::bigint, COALESCE((SELECT ended_at FROM changed), clock_timestamp())
         WHERE $3::bigint IS NOT NULL`,
        [...params, driverId]
      );
      return 204;
    });
    if (status === 404) return notFound(res);
    if (status === 409) return res.status(409).json({ message: "Driver is inactive" });
    return res.status(204).end();
  } catch (error) {
    return failure(res, error);
  }
});

module.exports = router;
