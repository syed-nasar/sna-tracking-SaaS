const pool = require("../config/db");
const { fail, transaction } = require("./gps-inventory.service");
const v = require("./connectivity-validation");

const catalogs = {
  operators: {
    table: "mobile_operators", singular: "operator", required: ["name", "countryCode"],
    fields: {
      name: ["name", v.text(150, true)], countryCode: ["country_code", v.pattern(/^[A-Z]{2}$/, (s) => s.toUpperCase(), false)],
      mcc: ["mcc", v.pattern(/^\d{3}$/)], mnc: ["mnc", v.pattern(/^\d{2,3}$/)],
      supportContact: ["support_contact", v.text(255)], isActive: ["is_active", v.boolean],
    },
  },
  plans: {
    table: "connectivity_plans", singular: "plan", required: ["operatorId", "name", "validityDays", "billingCycle", "currency"],
    fields: {
      operatorId: ["operator_id", v.id], name: ["name", v.text(150, true)], scope: ["scope", v.text(150)],
      allowanceMb: ["allowance_mb", v.integer(0, 2147483647, true)], validityDays: ["validity_days", v.integer(1, 3660)],
      billingCycle: ["billing_cycle", v.choice(["prepaid", "monthly", "quarterly", "annual"])],
      recurringCost: ["recurring_cost", v.money], customerPrice: ["customer_price", v.money], activationFee: ["activation_fee", v.money],
      currency: ["currency", v.pattern(/^[A-Z]{3}$/, (s) => s.toUpperCase(), false)],
      customerVisible: ["customer_visible", v.boolean], isActive: ["is_active", v.boolean], notes: ["notes", v.text(2000)],
    },
  },
};

function projection(catalog) {
  return ["id", ...Object.entries(catalog.fields).map(([key, [column]]) => `${column} AS "${key}"`)].join(", ");
}

async function listCatalog(type, query) {
  const catalog = catalogs[type];
  const paging = v.queryPage(query, ["q", "active", ...(type === "plans" ? ["operatorId"] : [])]);
  const q = v.text(150)(query.q) || "";
  const active = query.active === undefined ? null : v.choice(["true", "false"])(query.active) === "true";
  const operatorId = type === "plans" ? v.optionalId(query.operatorId) : null;
  const filter = type === "plans" ? "AND ($5::bigint IS NULL OR operator_id = $5)" : "";
  const params = [q.toLowerCase(), active, paging.limit + 1, paging.offset];
  if (type === "plans") params.push(operatorId);
  const { rows } = await pool.query(
    `SELECT ${projection(catalog)} FROM ${catalog.table}
     WHERE strpos(lower(name), $1) > 0 AND ($2::boolean IS NULL OR is_active = $2) ${filter}
     ORDER BY lower(name), id LIMIT $3 OFFSET $4`, params
  );
  return v.page(rows, paging);
}

async function getCatalog(type, id) {
  const catalog = catalogs[type];
  const { rows: [row] } = await pool.query(`SELECT ${projection(catalog)} FROM ${catalog.table} WHERE id = $1`, [id]);
  if (!row) fail(404, "Catalog record not found.");
  return row;
}

async function saveCatalog(type, id, body, adminId) {
  const catalog = catalogs[type];
  const values = v.fields(body, Object.fromEntries(Object.entries(catalog.fields).map(([key, [, validate]]) => [key, validate])),
    id ? [] : catalog.required);
  return transaction(async (client) => {
    if (values.operatorId) {
      const { rows: [operator] } = await client.query("SELECT is_active FROM mobile_operators WHERE id = $1 FOR SHARE", [values.operatorId]);
      if (!operator?.is_active) fail(409, "Select an active operator.");
    }
    const update = Object.entries(values).map(([key, value]) => [catalog.fields[key][0], value]);
    let previous;
    if (id) {
      const { rows: [current] } = await client.query(`SELECT ${projection(catalog)} FROM ${catalog.table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!current) fail(404, "Catalog record not found.");
      previous = current;
      if (values.operatorId && previous.operatorId !== values.operatorId) {
        fail(409, "A plan keeps its operator. Create a new plan for a different operator.");
      }
    }
    const query = id
      ? `UPDATE ${catalog.table} SET ${update.map(([column], index) => `${column} = $${index + 1}`).join(", ")},
         updated_at = NOW() WHERE id = $${update.length + 1}`
      : `INSERT INTO ${catalog.table} (${update.map(([column]) => column).join(", ")})
         VALUES (${update.map((_, index) => `$${index + 1}`).join(", ")})`;
    const { rows: [row] } = await client.query(`${query} RETURNING ${projection(catalog)}`,
      [...update.map(([, value]) => value), ...(id ? [id] : [])]);
    await client.query(
      `INSERT INTO platform_audit_logs (platform_admin_id, action, resource_type, resource_id, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [adminId, id ? "updated" : "created", `connectivity_${catalog.singular}`, row.id,
        { fields: Object.keys(values), fromActive: previous?.isActive, toActive: row.isActive }]
    );
    return row;
  });
}

module.exports = { listCatalog, getCatalog, saveCatalog };
