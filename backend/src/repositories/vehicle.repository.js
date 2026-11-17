
const pool = require("../config/db");

const VEHICLE_FIELDS = `
  id,
  tenant_id,
  traccar_device_id,
  name,
  registration_number,
  make,
  model,
  status,
  image_url,
  image_type
`;

async function getVehiclesByTenant(tenantId) {
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

async function createVehicle(tenantId, details) {
  const result = await pool.query(
    `INSERT INTO vehicles (
       tenant_id,
       traccar_device_id,
       name,
       registration_number,
       make,
       model,
       image_url,
       image_type
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
