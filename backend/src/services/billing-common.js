const pool = require("../config/db");
const { fail, transaction, InventoryError } = require("./gps-inventory.service");
const v = require("./connectivity-validation");

const UTC_TODAY = "(now() AT TIME ZONE 'UTC')::date";
const currencies = new Set(Intl.supportedValuesOf("currency"));

function handle(operation) {
  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      return await operation(req, res);
    } catch (error) {
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
      if (["23505", "23503", "23514", "23P01", "40P01", "40001"].includes(error.code)) {
        return res.status(409).json({ message: "Billing state conflicts with an existing record. Refresh and try again." });
      }
      console.error("Billing operation failed:", error.code || error.name);
      return res.status(500).json({ message: "Billing operation failed." });
    }
  };
}

function currency(value) {
  const code = v.pattern(/^[A-Z]{3}$/, (s) => s.toUpperCase(), false)(value);
  if (!currencies.has(code)) fail(400, "Use a supported ISO currency code.");
  return code;
}

function money(value) {
  if (typeof value !== "string" || !/^\d{1,14}(?:\.\d{1,4})?$/.test(value)) {
    fail(400, "Use a non-negative decimal amount supplied as text.");
  }
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(4, "0")}`;
}

function currencyScale(amount, code) {
  if (amount == null) return;
  // PKR ledger amounts support paisa even when the runtime formats PKR as whole rupees.
  const scale = code === "PKR" ? 2 :
    new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
  if (/[1-9]/.test(amount.split(".")[1].slice(scale))) {
    fail(400, `${code} amounts support ${scale} decimal places.`);
  }
}

function optionalMoney(value) {
  return value == null || value === "" ? null : money(value);
}

function date(value) {
  const result = v.date(value);
  if (!result) fail(400, "A calendar date is required.");
  return result;
}

function features(value) {
  if (!Array.isArray(value) || value.length > 30) fail(400, "Provide at most 30 feature codes.");
  return [...new Set(value.map(v.pattern(/^[a-z0-9_-]{1,60}$/, undefined, false)))];
}

function renewalDate(start, anchor, months) {
  const [year, month] = start.split("-").map(Number);
  const day = Number(anchor.slice(-2));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

async function today(client = pool) {
  return (await client.query(`SELECT ${UTC_TODAY}::text AS day`)).rows[0].day;
}

async function audit(client, adminId, tenantId, resource, id, action, details = {}) {
  await client.query(
    `INSERT INTO billing_events (platform_admin_id, tenant_id, resource, resource_id, action, details)
     VALUES ($1,$2,$3,$4,$5,$6)`, [adminId, tenantId, resource, id, action, details]
  );
}

async function lockTenant(client, id) {
  const { rows: [tenant] } = await client.query(
    "SELECT id, name, customer_type, status FROM tenants WHERE id=$1 FOR UPDATE", [id]
  );
  if (!tenant) fail(404, "Tenant not found.");
  return tenant;
}

module.exports = {
  pool, v, fail, transaction, UTC_TODAY, handle, currency, money, currencyScale, optionalMoney, date,
  features, renewalDate, today, audit, lockTenant,
  requestKey: v.pattern(/^[\w-]{8,80}$/, undefined, false),
};
