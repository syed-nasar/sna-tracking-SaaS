const { fail, parseId, InventoryError } = require("./gps-inventory.service");

function text(max, required = false) {
  return (raw) => {
    if (raw == null && !required) return null;
    if (typeof raw !== "string" || raw.includes("\0") || raw.trim().length > max ||
        (required && !raw.trim())) fail(400, "Invalid text field.");
    return raw.trim() || null;
  };
}

function pattern(regex, transform = (value) => value, optional = true) {
  return (raw) => {
    const value = text(80, !optional)(raw);
    if (value === null) return null;
    const normalized = transform(value);
    if (!regex.test(normalized)) fail(400, "Invalid field format.");
    return normalized;
  };
}

function choice(values, optional = false) {
  return (value) => {
    if (optional && (value == null || value === "")) return null;
    if (!values.includes(value)) fail(400, "Unsupported option.");
    return value;
  };
}

function integer(min, max, optional = false) {
  return (value) => {
    if (optional && (value == null || value === "")) return null;
    if ((typeof value !== "number" && (typeof value !== "string" || !/^\d{1,10}$/.test(value))) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
      fail(400, "Invalid number.");
    }
    return Number(value);
  };
}

function money(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") fail(400, "Invalid amount.");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(String(value))) fail(400, "Invalid amount.");
  return String(value);
}

function boolean(value) {
  if (typeof value !== "boolean") fail(400, "Use a boolean value.");
  return value;
}

function reason(value) {
  return text(500, true)(value).replace(/\+?(?:\d[ -]?){4,}\d/g, "[redacted identifier]").slice(0, 500);
}

function date(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) fail(400, "Use YYYY-MM-DD.");
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail(400, "Invalid calendar date.");
  return value;
}

function id(value) {
  const result = parseId(value);
  if (!result) fail(400, "Invalid record ID.");
  return result;
}

function optionalId(value) {
  return value == null || value === "" ? null : id(value);
}

function fields(body, schema, required = []) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !Object.keys(body).length || required.some((key) => !Object.hasOwn(body, key))) {
    fail(400, "Missing required fields.");
  }
  return Object.fromEntries(Object.entries(body).map(([key, value]) => {
    if (!Object.hasOwn(schema, key)) fail(400, "Unsupported field.");
    try {
      return [key, schema[key](value)];
    } catch (error) {
      if (error instanceof InventoryError) fail(400, `${key}: ${error.message}`);
      throw error;
    }
  }));
}

function queryPage(query, allowed) {
  if (Object.keys(query).some((key) => !["limit", "offset", ...allowed].includes(key))) fail(400, "Unsupported filter.");
  return { limit: integer(1, 100)(query.limit ?? 25), offset: integer(0, 1000000)(query.offset ?? 0) };
}

function page(rows, { limit, offset }) {
  return { data: rows.slice(0, limit), pagination: { limit, offset, hasMore: rows.length > limit } };
}

function handle(operation) {
  return async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      return await operation(req, res);
    } catch (error) {
      if (error instanceof InventoryError) return res.status(error.status).json({ message: error.message });
      if (["23505", "23503", "23P01", "40P01", "40001"].includes(error.code)) {
        const messages = {
          sim_cards_iccid_key: "This ICCID is already registered.",
          sim_plan_period_provider_idx: "This provider reference has already been recorded for this SIM.",
          mobile_operators_name_idx: "This operator name is already registered in that country.",
          connectivity_plans_name_idx: "This plan name is already registered for that operator.",
          sim_assignments_current_sim_idx: "This SIM already has an active assignment.",
          sim_assignments_current_device_idx: "The device already has an active SIM.",
        };
        return res.status(409).json({ message: messages[error.constraint] || "A related record changed. Refresh and try again." });
      }
      console.error("Connectivity operation failed:", error.code || error.name);
      return res.status(500).json({ message: "Connectivity operation failed." });
    }
  };
}

module.exports = { text, pattern, choice, integer, money, boolean, reason, date, id, optionalId, fields, queryPage, page, handle };
