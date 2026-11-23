const pool = require("../config/db");
const { fail, transaction } = require("./gps-inventory.service");
const { audit, getSim } = require("./sim-inventory.service");
const v = require("./connectivity-validation");

async function deviceChoices(query) {
  const paging = v.queryPage(query, ["q"]);
  const search = (v.text(150)(query.q) || "").toLowerCase();
  const { rows } = await pool.query(
    `SELECT d.id, COALESCE(d.device_name, d.unique_identifier, 'GPS device #'||d.id) AS name,
       d.lifecycle_status AS lifecycle, t.name AS "tenantName", a.id AS "assignmentId", s.label AS "simLabel"
     FROM gps_devices d LEFT JOIN tenants t ON t.id=d.tenant_id
     LEFT JOIN sim_device_assignments a ON a.device_id=d.id AND a.ended_at IS NULL
     LEFT JOIN sim_cards s ON s.id=a.sim_id
     WHERE d.lifecycle_status IN ('available','reserved','installed') AND (d.tenant_id IS NULL OR t.status='active')
       AND strpos(lower(concat_ws(' ', d.id, d.device_name, d.unique_identifier, t.name)), $1) > 0
     ORDER BY d.id LIMIT $2 OFFSET $3`, [search, paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

async function lockDevices(client, ids, targetId) {
  const before = await client.query("SELECT id, tenant_id FROM gps_devices WHERE id=ANY($1::bigint[])", [ids]);
  if (before.rowCount !== ids.length) fail(404, "GPS device not found.");
  const target = before.rows.find((device) => device.id === targetId);
  if (target?.tenant_id) {
    const { rows: [tenant] } = await client.query("SELECT status FROM tenants WHERE id=$1 FOR SHARE", [target.tenant_id]);
    if (tenant?.status !== "active") fail(409, "The destination device is allocated to an inactive tenant.");
  }
  const { rows } = await client.query(
    "SELECT id, tenant_id, lifecycle_status FROM gps_devices WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE", [ids]
  );
  if (rows.length !== ids.length) fail(404, "GPS device not found.");
  const current = rows.find((device) => device.id === targetId);
  if (current && (current.tenant_id !== target.tenant_id ||
      !["available", "reserved", "installed"].includes(current.lifecycle_status))) {
    fail(409, "The destination GPS device is no longer eligible.");
  }
}

async function changeAssignment(simId, body, adminId) {
  const { action, deviceId, fromDeviceId, expectedAssignmentId, reason } = v.fields(body, {
    action: v.choice(["assign", "replace", "move", "remove"]), deviceId: v.id, fromDeviceId: v.id,
    expectedAssignmentId: v.optionalId, reason: v.reason,
  }, ["action", "deviceId", "expectedAssignmentId", "reason"]);
  if ((action === "move") !== Boolean(fromDeviceId) || fromDeviceId === deviceId ||
      (["replace", "remove"].includes(action) && !expectedAssignmentId) ||
      (action === "assign" && expectedAssignmentId)) fail(400, "Invalid assignment action or expectation.");

  return transaction(async (client) => {
    await lockDevices(client, fromDeviceId ? [fromDeviceId, deviceId] : [deviceId], action === "remove" ? null : deviceId);

    const { rows: [target] } = await client.query(
      "SELECT id, sim_id FROM sim_device_assignments WHERE device_id=$1 AND ended_at IS NULL", [deviceId]
    );
    if ((target?.id ?? null) !== expectedAssignmentId) fail(409, "The destination assignment changed. Refresh and try again.");
    if (target && (action === "remove") !== (target.sim_id === simId)) {
      fail(409, "The selected SIM is already on this device or is no longer assigned there.");
    }

    // Every assignment locks GPS devices by ID, then SIMs by ID.
    const related = [...new Set([simId, target?.sim_id].filter(Boolean))];
    const { rows: sims } = await client.query(
      "SELECT id, lifecycle FROM sim_cards WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE", [related]
    );
    const sim = sims.find((row) => row.id === simId);
    if (!sim) fail(404, "SIM not found.");
    const { rows: [source] } = await client.query(
      "SELECT id, device_id FROM sim_device_assignments WHERE sim_id=$1 AND ended_at IS NULL", [simId]
    );
    const expectedSource = action === "move" ? fromDeviceId : action === "remove" ? deviceId : null;
    if ((source?.device_id ?? null) !== expectedSource) fail(409, "This SIM already has an assignment or its source changed.");
    const eligible = ["available", "reserved", ...(action === "move" ? ["active"] : [])];
    if (action !== "remove" && !eligible.includes(sim.lifecycle)) {
      fail(409, "The SIM lifecycle does not permit this assignment.");
    }
    const closing = [...new Set([source?.id, target?.id].filter(Boolean))];
    const { rows: [time] } = await client.query(
      `SELECT GREATEST(clock_timestamp(), max(started_at))::text AS stamp
       FROM sim_device_assignments WHERE id=ANY($1::bigint[])`, [closing]
    );
    if (closing.length) {
      await client.query(
        `UPDATE sim_device_assignments SET ended_at=$2, ended_by=$3, end_reason=$4
         WHERE id=ANY($1::bigint[])`, [closing, time.stamp, adminId, reason]
      );
    }
    if (action === "remove") {
      await audit(client, simId, adminId, "unassigned", { fromDeviceId: deviceId, assignmentId: target.id }, reason);
    } else {
      const { rows: [assignment] } = await client.query(
        `INSERT INTO sim_device_assignments (sim_id, device_id, started_at, started_by, start_reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`, [simId, deviceId, time.stamp, adminId, reason]
      );
      if (target) {
        await audit(client, target.sim_id, adminId, "replaced", {
          fromDeviceId: deviceId, replacementSimId: simId, assignmentId: target.id,
        }, reason);
      }
      const event = action === "move" ? "moved" : action === "replace" ? "replaced" : "assigned";
      await audit(client, simId, adminId, event, {
        fromDeviceId: source?.device_id ?? null, toDeviceId: deviceId, assignmentId: assignment.id,
        displacedSimId: target?.sim_id ?? null,
      }, reason);
    }
    return getSim(simId, client);
  });
}

module.exports = { changeAssignment, deviceChoices };
