const { fail } = require("./gps-inventory.service");

async function changeCustomerStatus(db, tenantId, resellerId, body, recordAudit) {
  const { status, version, reason } = body ?? {};
  if (!["active", "suspended"].includes(status) || typeof version !== "string" ||
      !/^\d{1,10}$/.test(version) || typeof reason !== "string" || reason.includes("\0") ||
      !reason.trim() || reason.trim().length > 500) {
    fail(400, "Specify a status, current record version, and administrative reason (1–500 characters).");
  }
  const { rows: [tenant] } = await db.query(
    `SELECT id,status,xmin::text AS version FROM tenants WHERE id=$1
      AND ($2::bigint IS NULL OR reseller_id=$2) FOR UPDATE`, [tenantId, resellerId]
  );
  if (!tenant) fail(404, "Customer not found.");
  if (tenant.version !== version || tenant.status === status) fail(409, "Customer status changed. Refresh and try again.");
  const { rows: [updated] } = await db.query(
    "UPDATE tenants SET status=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING status,updated_at,xmin::text AS version",
    [tenantId,status]
  );
  await db.query("UPDATE users SET token_version=token_version+1 WHERE tenant_id=$1", [tenantId]);
  await recordAudit(db,{ fromStatus:tenant.status,toStatus:status,reason:reason.trim() });
  return updated;
}

module.exports = { changeCustomerStatus };
