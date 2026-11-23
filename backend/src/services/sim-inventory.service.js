const pool = require("../config/db");
const { fail, transaction } = require("./gps-inventory.service");
const v = require("./connectivity-validation");

const lifecycles = ["available", "reserved", "active", "suspended", "faulty", "retired"];
const transitions = {
  available: ["reserved", "active", "faulty", "retired"],
  reserved: ["available", "active", "suspended", "faulty", "retired"],
  active: ["reserved", "suspended", "faulty", "retired"],
  suspended: ["reserved", "active", "faulty", "retired"],
  faulty: ["available", "reserved", "active", "retired"],
  retired: [],
};
const simFields = {
  operatorId: ["operator_id", v.optionalId], label: ["label", v.text(150, true)],
  iccid: ["iccid", v.pattern(/^\d{18,22}$/, (value) => value.replace(/[\s-]/g, ""))],
  imsi: ["imsi", v.pattern(/^\d{5,15}$/)],
  msisdn: ["msisdn", v.pattern(/^\+?\d{5,15}$/, (value) => value.replace(/[\s-]/g, ""))],
  formFactor: ["form_factor", v.choice(["physical", "esim"], true)],
  purchasedAt: ["purchased_at", v.date], activatedAt: ["activated_at", v.date],
  supplierReference: ["supplier_reference", v.text(150)], purchaseCost: ["purchase_cost", v.money],
  currency: ["currency", v.pattern(/^[A-Z]{3}$/, (s) => s.toUpperCase())], notes: ["notes", v.text(2000)],
};
const today = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date";
const effectiveEnd = "COALESCE(p.superseded_at, p.expires_at)";
const daysLeft = `((${effectiveEnd} AT TIME ZONE 'UTC')::date - ${today})`;
const masked = (sql) => `CASE WHEN ${sql} IS NOT NULL THEN '••••' || right(${sql}, 4) END`;
const currentPlan = `LEFT JOIN LATERAL (
    SELECT * FROM sim_plan_periods
    WHERE sim_id = s.id AND starts_at <= CURRENT_TIMESTAMP ORDER BY starts_at DESC LIMIT 1
  ) p ON TRUE`;
const latestPlan = `LEFT JOIN LATERAL (
    SELECT id FROM sim_plan_periods WHERE sim_id = s.id ORDER BY starts_at DESC LIMIT 1
  ) planned ON TRUE`;
const inventoryFrom = `FROM sim_cards s
  LEFT JOIN mobile_operators o ON o.id = s.operator_id
  LEFT JOIN sim_device_assignments a ON a.sim_id = s.id AND a.ended_at IS NULL
  LEFT JOIN gps_devices d ON d.id = a.device_id
  ${currentPlan} ${latestPlan}`;
const inventoryFields = `s.id, s.label, s.lifecycle, s.operator_id AS "operatorId", o.name AS "operatorName",
  ${masked("s.iccid")} AS "maskedIccid", ${masked("s.imsi")} AS "maskedImsi", ${masked("s.msisdn")} AS "maskedMsisdn",
  s.form_factor AS "formFactor",
  (s.purchased_at AT TIME ZONE 'UTC')::date::text AS "purchasedAt",
  (s.activated_at AT TIME ZONE 'UTC')::date::text AS "activatedAt",
  s.created_at AS "createdAt", s.updated_at AS "updatedAt",
  a.id AS "assignmentId", a.device_id AS "deviceId", COALESCE(d.device_name, d.unique_identifier) AS "deviceName",
  planned.id AS "latestPeriodId", p.terms->>'name' AS "planName", p.starts_at AS "planStartsAt",
  ${effectiveEnd} AS "expiresAt", ${daysLeft} AS "daysRemaining"`;

async function audit(client, simId, adminId, action, details, reason = null) {
  await client.query(
    `INSERT INTO sim_audit_events (sim_id, platform_admin_id, action, details, reason)
     VALUES ($1,$2,$3,$4,$5)`, [simId, adminId, action, details, reason]
  );
}

async function lockedSim(client, id) {
  const { rows: [sim] } = await client.query(
    "SELECT id, operator_id, lifecycle, purchase_cost, currency FROM sim_cards WHERE id = $1 FOR UPDATE", [id]
  );
  if (!sim) fail(404, "SIM not found.");
  return sim;
}

async function getSim(id, client = pool) {
  const { rows: [sim] } = await client.query(
    `SELECT ${inventoryFields}, s.purchase_cost AS "purchaseCost", s.currency,
         s.supplier_reference AS "supplierReference", s.notes
     ${inventoryFrom} WHERE s.id = $1`, [id]
  );
  if (!sim) fail(404, "SIM not found.");
  return sim;
}

async function listSims(query) {
  const paging = v.queryPage(query, ["q", "lifecycle", "operatorId", "assignment", "expiry", "sort"]);
  const search = (v.text(150)(query.q) || "").toLowerCase();
  const identifierSearch = search.replace(/[\s-]/g, "");
  const lifecycle = v.choice(lifecycles, true)(query.lifecycle);
  const operator = v.optionalId(query.operatorId);
  const assignment = v.choice(["assigned", "unassigned"], true)(query.assignment);
  const expiry = v.choice(["expiring", "expired"], true)(query.expiry);
  const sort = v.choice(["newest", "label", "expiry"])(query.sort ?? "newest");
  const ordering = { newest: "s.id DESC", label: "lower(s.label), s.id", expiry: `${effectiveEnd} NULLS LAST, s.id` };
  const { rows } = await pool.query(
    `SELECT ${inventoryFields} ${inventoryFrom} CROSS JOIN sim_connectivity_settings settings
     WHERE ($1::text = '' OR strpos(lower(concat_ws(' ', s.label, o.name)), $1) > 0
          OR ($2::text <> '' AND strpos(COALESCE(s.iccid,''), $2) > 0))
       AND ($3::text IS NULL OR s.lifecycle = $3)
       AND ($4::bigint IS NULL OR s.operator_id = $4)
       AND ($5::text IS NULL OR (a.id IS NOT NULL) = ($5 = 'assigned'))
       AND ($6::text IS NULL OR (s.lifecycle <> 'retired' AND
         CASE WHEN $6 = 'expired' THEN ${daysLeft} <= 0 ELSE ${daysLeft} BETWEEN 1 AND settings.warning_days END))
     ORDER BY ${ordering[sort]} LIMIT $7 OFFSET $8`,
    [search, /^\d+$/.test(identifierSearch) ? identifierSearch : "", lifecycle, operator, assignment, expiry, paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

async function saveSim(id, body, adminId) {
  const values = v.fields(body, Object.fromEntries(Object.entries(simFields).map(([key, [, validate]]) => [key, validate])),
    id ? [] : ["label"]);
  return transaction(async (client) => {
    const current = id ? await lockedSim(client, id) : null;
    if (values.operatorId && values.operatorId !== current?.operator_id) {
      const { rows: [operator] } = await client.query("SELECT is_active FROM mobile_operators WHERE id = $1 FOR SHARE", [values.operatorId]);
      if (!operator?.is_active) fail(409, "Select an active operator.");
    }
    if (id && Object.hasOwn(values, "operatorId") && current.operator_id !== values.operatorId) {
      const periods = await client.query("SELECT 1 FROM sim_plan_periods WHERE sim_id = $1 LIMIT 1", [id]);
      if (periods.rowCount) fail(409, "The SIM already has plan history and keeps its operator.");
    }
    if ((Object.hasOwn(values, "purchaseCost") ? values.purchaseCost : current?.purchase_cost) != null &&
        !(Object.hasOwn(values, "currency") ? values.currency : current?.currency)) fail(400, "Purchase cost requires a currency.");
    const entries = Object.entries(values).map(([key, value]) => [simFields[key][0], value, ["purchasedAt", "activatedAt"].includes(key)]);
    const placeholder = (index, date) => date ? `($${index}::date::timestamp AT TIME ZONE 'UTC')` : `$${index}`;
    const query = id
      ? `UPDATE sim_cards SET ${entries.map(([column, , date], i) => `${column} = ${placeholder(i + 1, date)}`).join(", ")},
         updated_at = NOW() WHERE id = $${entries.length + 1}`
      : `INSERT INTO sim_cards (${entries.map(([column]) => column).join(", ")})
         VALUES (${entries.map(([, , date], i) => placeholder(i + 1, date)).join(", ")})`;
    const { rows: [sim] } = await client.query(`${query} RETURNING id`, [...entries.map(([, value]) => value), ...(id ? [id] : [])]);
    await audit(client, sim.id, adminId, id ? "updated" : "created", {
      fields: Object.keys(values),
      ...(Object.hasOwn(values, "operatorId") && { fromOperatorId: current?.operator_id, toOperatorId: values.operatorId }),
    });
    return getSim(sim.id, client);
  });
}

async function setLifecycle(id, body, adminId) {
  const { lifecycle, reason } = v.fields(body, {
    lifecycle: v.choice(lifecycles), reason: v.reason,
  }, ["lifecycle", "reason"]);
  return transaction(async (client) => {
    const sim = await lockedSim(client, id);
    if (sim.lifecycle === lifecycle) return getSim(id, client);
    if (!transitions[sim.lifecycle].includes(lifecycle)) fail(409, "This lifecycle transition is not permitted.");
    if (lifecycle === "retired" || lifecycle === "available") {
      const current = await client.query("SELECT 1 FROM sim_device_assignments WHERE sim_id=$1 AND ended_at IS NULL", [id]);
      if (current.rowCount) fail(409, "Remove the current GPS assignment first.");
    }
    await client.query("UPDATE sim_cards SET lifecycle=$2, updated_at=NOW() WHERE id=$1", [id, lifecycle]);
    await audit(client, id, adminId, "lifecycle_changed", { previous: sim.lifecycle, next: lifecycle }, reason);
    return getSim(id, client);
  });
}

async function summary(client = pool) {
  const { rows: [counts] } = await client.query(
    `SELECT settings.warning_days AS "warningDays",
       count(s.id) FILTER (WHERE lifecycle='active')::int AS active,
       count(s.id) FILTER (WHERE lifecycle='suspended')::int AS suspended,
       count(s.id) FILTER (WHERE lifecycle='faulty')::int AS faulty,
       count(s.id) FILTER (WHERE lifecycle <> 'retired' AND ${daysLeft} <= 0)::int AS expired,
       count(s.id) FILTER (WHERE lifecycle <> 'retired' AND ${daysLeft} BETWEEN 1 AND settings.warning_days)::int AS "expiringSoon"
     FROM sim_connectivity_settings settings LEFT JOIN sim_cards s ON TRUE ${currentPlan}
     GROUP BY settings.warning_days`
  );
  return counts;
}

async function setWarningDays(body, adminId) {
  const { warningDays } = v.fields(body, { warningDays: v.integer(1, 365) }, ["warningDays"]);
  return transaction(async (client) => {
    const { rows: [previous] } = await client.query("SELECT warning_days FROM sim_connectivity_settings FOR UPDATE");
    await client.query("UPDATE sim_connectivity_settings SET warning_days = $1", [warningDays]);
    await client.query(`INSERT INTO platform_audit_logs (platform_admin_id, action, resource_type, details)
      VALUES ($1,'updated','connectivity_settings',$2)`, [adminId, { fromWarningDays: previous.warning_days, toWarningDays: warningDays }]);
    return summary(client);
  });
}

async function tenantConnectivity(tenantId, deviceId = null) {
  const { rows } = await pool.query(
    `SELECT d.id AS "deviceId", s.lifecycle, o.name AS "operatorName",
       ${masked("s.iccid")} AS "maskedSimReference",
       CASE WHEN cp.customer_visible AND p.terms->>'customerVisible' = 'true' THEN p.terms->>'name' END AS "planName",
       p.starts_at AS "planStartsAt", ${effectiveEnd} AS "expiresAt", ${daysLeft} AS "daysRemaining",
       CASE WHEN s.id IS NULL THEN 'unavailable' ELSE 'not_integrated' END AS "carrierStatus",
       'not_integrated' AS "usageStatus"
     FROM gps_devices d
     LEFT JOIN sim_device_assignments a ON a.device_id=d.id AND a.ended_at IS NULL
     LEFT JOIN sim_cards s ON s.id=a.sim_id LEFT JOIN mobile_operators o ON o.id=s.operator_id
     ${currentPlan} LEFT JOIN connectivity_plans cp ON cp.id = p.plan_id
     WHERE d.tenant_id=$1 AND ($2::bigint IS NULL OR d.id=$2) ORDER BY d.id`, [tenantId, deviceId]
  );
  if (deviceId && !rows.length) fail(404, "GPS device not found.");
  return deviceId ? rows[0] : rows;
}

module.exports = { audit, lockedSim, getSim, listSims, saveSim, setLifecycle, summary, setWarningDays, tenantConnectivity };
