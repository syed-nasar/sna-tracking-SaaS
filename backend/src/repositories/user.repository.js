
const pool = require("../config/db");

const USER_FIELDS = `
  id,
  tenant_id AS "tenantId",
  full_name AS "fullName",
  email,
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

async function getUsersByTenant(tenantId) {
  const result = await pool.query(
    `SELECT ${USER_FIELDS}
     FROM users
     WHERE tenant_id = $1
     ORDER BY id`,
    [tenantId]
  );

  return result.rows;
}

async function getUserById(tenantId, userId) {
  const result = await pool.query(
    `SELECT ${USER_FIELDS}
     FROM users
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );

  return result.rows[0] || null;
}

module.exports = {
  getUsersByTenant,
  getUserById,
  USER_FIELDS,
};
