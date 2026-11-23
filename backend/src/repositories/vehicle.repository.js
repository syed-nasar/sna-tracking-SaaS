
const pool = require("../config/db");

const VEHICLE_FIELDS = `
  id,
  tenant_id,
  traccar_device_id,
  gps_installed_at,
  name,
  registration_number,
  make,
  model,
  status,
  image_url,
  image_type
`;

async function getVehiclesByTenant(tenantId, includeOperations = false) {
  if (includeOperations) {
    const result = await pool.query(
      `SELECT v.*, g.name AS group_name, d.id AS driver_id, d.full_name AS driver_name
       FROM vehicles v
       LEFT JOIN vehicle_groups g ON (g.id, g.tenant_id) = (v.group_id, v.tenant_id)
       LEFT JOIN driver_assignments a ON (a.vehicle_id, a.tenant_id) = (v.id, v.tenant_id)
         AND a.ended_at IS NULL
       LEFT JOIN drivers d ON (d.id, d.tenant_id) = (a.driver_id, a.tenant_id)
       WHERE v.tenant_id = $1 ORDER BY v.id`,
      [tenantId]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT ${VEHICLE_FIELDS}
     FROM vehicles
     WHERE tenant_id = $1
     ORDER BY id`,
    [tenantId]
  );

  return result.rows;
}

async function getVehicleById(tenantId, vehicleId) {
  const result = await pool.query(
    `SELECT ${VEHICLE_FIELDS}
     FROM vehicles
     WHERE tenant_id = $1
       AND id = $2`,
    [tenantId, vehicleId]
  );

  return result.rows[0] || null;
}

async function createVehicle(tenantId, details, client = pool) {
  const result = await client.query(
    `INSERT INTO vehicles (
       tenant_id,
       traccar_device_id,
       name,
       registration_number,
       make,
       model,
       image_url,
       image_type,
       gps_installed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       CASE WHEN $2::bigint IS NULL THEN NULL ELSE clock_timestamp() END)
     RETURNING ${VEHICLE_FIELDS}`,
    [
      tenantId,
      details.traccarDeviceId,
      details.name,
      details.registrationNumber,
      details.make,
      details.model,
      details.imageUrl ?? null,
      details.imageType ?? null,
    ]
  );

  return result.rows[0];
}

async function updateVehicle(tenantId, vehicleId, details) {
  const result = await pool.query(
    `UPDATE vehicles
     SET
       name = $3,
       registration_number = $4,
       make = $5,
       model = $6,
       status = $7,
       image_url = $8,
       image_type = $9,
       updated_at = NOW()
     WHERE tenant_id = $1
       AND id = $2
     RETURNING ${VEHICLE_FIELDS}`,
    [
      tenantId,
      vehicleId,
      details.name,
      details.registrationNumber,
      details.make,
      details.model,
      details.status,
      details.imageUrl ?? null,
      details.imageType ?? null,
    ]
  );

  return result.rows[0] || null;
}

module.exports = {
  getVehiclesByTenant,
  getVehicleById,
  createVehicle,
  updateVehicle,
};
