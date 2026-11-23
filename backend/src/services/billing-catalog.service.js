const b = require("./billing-common");
const { pool, v, fail, transaction, audit } = b;

const planFields = {
  code: v.pattern(/^[A-Z0-9_-]{1,50}$/, (s) => s.toUpperCase(), false),
  name: v.text(150, true), description: v.text(1000),
  audience: v.choice(["personal", "business", "both"]),
};
const versionFields = {
  effectiveOn: b.date, intervalMonths: v.integer(1, 60), currency: b.currency,
  basePrice: b.money, excessPrice: b.money, includedDevices: v.integer(0, 1000000),
  deviceLimit: v.integer(1, 1000000, true), userLimit: v.integer(1, 1000000, true),
  features: b.features, trialDays: v.integer(0, 365), graceDays: v.integer(0, 365),
  paymentDays: v.integer(0, 365),
};
const versionSelect = `v.id, v.plan_id, v.effective_on::text, v.interval_months, v.currency, v.base_price,
  v.excess_price, v.included_devices, v.device_limit, v.user_limit, v.features,
  v.trial_days, v.grace_days, v.payment_days`;

async function plans(query) {
  const paging = v.queryPage(query, ["q", "archived"]);
  const q = (v.text(150)(query.q) || "").toLowerCase();
  const archived = v.choice(["true", "false"], true)(query.archived);
  const { rows } = await pool.query(
    `SELECT p.*, current_version.id AS current_version_id FROM billing_plans p
     LEFT JOIN LATERAL (SELECT id FROM billing_plan_versions
       WHERE plan_id=p.id AND effective_on<=${b.UTC_TODAY} ORDER BY effective_on DESC LIMIT 1) current_version ON TRUE
     WHERE strpos(lower(concat_ws(' ',p.name,p.code)), $1)>0
       AND ($2::boolean IS NULL OR (p.archived_at IS NOT NULL)=$2)
     ORDER BY p.id DESC LIMIT $3 OFFSET $4`,
    [q, archived, paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

async function savePlan(id, body, admin) {
  const value = v.fields(body, id ? {
    name: planFields.name, description: planFields.description, archived: v.boolean,
  } : planFields, id ? [] : ["code", "name", "audience"]);
  return transaction(async (client) => {
    let result;
    if (!id) {
      result = await client.query(
        "INSERT INTO billing_plans(code,name,description,audience) VALUES($1,$2,$3,$4) RETURNING *",
        [value.code, value.name, value.description ?? null, value.audience]
      );
    } else {
      const { rows: [old] } = await client.query("SELECT * FROM billing_plans WHERE id=$1 FOR UPDATE", [id]);
      if (!old) fail(404, "Plan not found.");
      result = await client.query(
        `UPDATE billing_plans SET name=$2, description=$3,
         archived_at=CASE WHEN $4 THEN COALESCE(archived_at,now()) ELSE NULL END WHERE id=$1 RETURNING *`,
        [id, value.name ?? old.name, Object.hasOwn(value, "description") ? value.description : old.description,
          value.archived ?? Boolean(old.archived_at)]
      );
    }
    const plan = result.rows[0];
    await audit(client, admin, null, "plan", plan.id, id ? "plan_updated" : "plan_created", { fields: Object.keys(value) });
    return plan;
  });
}

async function versions(planId, query) {
  const paging = v.queryPage(query, []);
  const { rows } = await pool.query(
    `SELECT ${versionSelect} FROM billing_plan_versions v WHERE plan_id=$1 ORDER BY effective_on DESC LIMIT $2 OFFSET $3`,
    [planId, paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

async function publishVersion(planId, body, admin) {
  const x = v.fields(body, versionFields,
    ["effectiveOn", "intervalMonths", "currency", "basePrice", "excessPrice", "includedDevices"]);
  for (const amount of [x.basePrice, x.excessPrice]) b.currencyScale(amount, x.currency);
  if (x.deviceLimit != null && x.deviceLimit < x.includedDevices) fail(400, "Device limit must cover included devices.");
  return transaction(async (client) => {
    const { rows: [plan] } = await client.query("SELECT id, archived_at FROM billing_plans WHERE id=$1 FOR UPDATE", [planId]);
    if (!plan) fail(404, "Plan not found.");
    if (plan.archived_at) fail(409, "Unarchive the plan before publishing a price.");
    const { rows: [version] } = await client.query(
      `INSERT INTO billing_plan_versions AS v (plan_id,effective_on,interval_months,currency,base_price,excess_price,
       included_devices,device_limit,user_limit,features,trial_days,grace_days,payment_days,published_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${versionSelect}`,
      [planId,x.effectiveOn,x.intervalMonths,x.currency,x.basePrice,x.excessPrice,x.includedDevices,
        x.deviceLimit ?? null,x.userLimit ?? null,JSON.stringify(x.features ?? []),x.trialDays ?? 0,x.graceDays ?? 0,
        x.paymentDays ?? 14,admin]
    );
    await audit(client, admin, null, "plan", planId, "price_published", { versionId: version.id, effectiveOn: x.effectiveOn });
    return version;
  });
}

async function licenseList(query) {
  const paging = v.queryPage(query, ["tenantId"]);
  const { rows } = await pool.query(
    `SELECT l.*, l.starts_on::text, l.ends_on::text, t.name AS tenant_name FROM billing_enterprise_licenses l
     JOIN tenants t ON t.id=l.tenant_id WHERE ($1::bigint IS NULL OR l.tenant_id=$1)
     ORDER BY l.id DESC LIMIT $2 OFFSET $3`, [v.optionalId(query.tenantId), paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

async function licenseSave(id, body, admin) {
  const values = v.fields(body, id ? { archived: v.boolean } : {
    tenantId: v.id, reference: (raw) => {
      const value = v.text(100,true)(raw);
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) fail(400, "Use letters, digits, hyphens, or underscores.");
      return value;
    },
    deployment: v.choice(["hosted", "self_hosted"]), deviceLimit: v.integer(1, 1000000, true),
    userLimit: v.integer(1, 1000000, true), startsOn: b.date, endsOn: v.date, notes: v.text(500),
  }, id ? ["archived"] : ["tenantId", "reference", "deployment", "startsOn"]);
  if (values.endsOn && values.endsOn < values.startsOn) fail(400, "License end precedes its start.");
  return transaction(async (client) => {
    const { rows: [license] } = id ?
      await client.query("UPDATE billing_enterprise_licenses SET archived=$2 WHERE id=$1 RETURNING *", [id, values.archived]) :
      await client.query(
        `INSERT INTO billing_enterprise_licenses (tenant_id,reference,deployment,device_limit,user_limit,starts_on,ends_on,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [values.tenantId,values.reference,values.deployment,values.deviceLimit ?? null,values.userLimit ?? null,
          values.startsOn,values.endsOn ?? null,values.notes ?? null]
      );
    if (!license) fail(404, "License metadata not found.");
    await audit(client, admin, license.tenant_id, "license", license.id, id ? "license_status_changed" : "license_created",
      { deployment: license.deployment, archived: license.archived });
    return license;
  });
}

module.exports = { plans, savePlan, versions, publishVersion, licenseList, licenseSave };
