
const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getUsersByTenant,
  getUserById,
  USER_FIELDS,
} = require("../repositories/user.repository");

const router = express.Router();

router.use(requireAuth);

const MAX_ID = 9223372036854775807n;
const ROLES = ["tenant_admin", "manager", "viewer"];

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) return null;

  try {
    const id = BigInt(value);
    return id <= MAX_ID ? String(id) : null;
  } catch {
    return null;
  }
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validName(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 150
  );
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

// GET /api/users
router.get("/", authorize("users:read"), async (req, res) => {
  try {
    const users = await getUsersByTenant(req.auth.tenantId);
    return res.json(users);
  } catch (error) {
    console.error("List users failed:", error.message);
    return res.status(500).json({
      message: "Failed to list users",
    });
  }
});

// GET /api/users/:id
router.get("/:id", authorize("users:read"), async (req, res) => {
  const userId = parseId(req.params.id);

  if (!userId) {
    return res.status(400).json({
      message: "Invalid user ID",
    });
  }

  try {
    const user = await getUserById(req.auth.tenantId, userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.json(user);
  } catch (error) {
    console.error("Get user failed:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve user",
    });
  }
});

// POST /api/users
router.post("/", authorize("users:write"), async (req, res) => {
  const body = req.body;

  if (!isObject(body)) {
    return res.status(400).json({
      message: "Invalid request body",
    });
  }

  const allowed = ["fullName", "email", "password", "role"];

  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return res.status(400).json({
      message: "Unsupported user field",
    });
  }

  const { fullName, email, password, role = "viewer" } = body;

  if (
    !validName(fullName) ||
    !validEmail(email) ||
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    !ROLES.includes(role)
  ) {
    return res.status(400).json({
      message: "Invalid user details",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users
         (tenant_id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_FIELDS}`,
      [
        req.auth.tenantId,
        fullName.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        role,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "User email already exists in this tenant",
      });
    }

    console.error("Create user failed:", error.message);
    return res.status(500).json({
      message: "Failed to create user",
    });
  }
});

// PATCH /api/users/:id
router.patch("/:id", authorize("users:write"), async (req, res) => {
  const userId = parseId(req.params.id);
  const body = req.body;

  if (!userId || !isObject(body)) {
    return res.status(400).json({
      message: "Invalid request",
    });
  }

  const allowed = ["fullName", "role", "isActive"];
  const keys = Object.keys(body);

  if (
    keys.length === 0 ||
    keys.some((key) => !allowed.includes(key)) ||
    (body.fullName !== undefined && !validName(body.fullName)) ||
    (body.role !== undefined && !ROLES.includes(body.role)) ||
    (body.isActive !== undefined &&
      typeof body.isActive !== "boolean")
  ) {
    return res.status(400).json({
      message: "Invalid update fields",
    });
  }

  // Existing self-protection.
  if (
    String(req.auth.userId) === userId &&
    (body.role !== undefined || body.isActive === false)
  ) {
    return res.status(403).json({
      message: "Cannot change your own role or deactivate yourself",
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Serialize administrator updates within this tenant.
    // All administrator-removal paths must use this lock.
    const tenantResult = await client.query(
      `SELECT id, status
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [req.auth.tenantId]
    );

    if (
      tenantResult.rows.length === 0 ||
      tenantResult.rows[0].status !== "active"
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Tenant is not active",
      });
    }

    // Recheck the acting administrator after acquiring
    // the tenant lock, to prevent stale authorization.
    const actorResult = await client.query(
      `SELECT role, is_active
       FROM users
       WHERE tenant_id = $1 AND id = $2`,
      [req.auth.tenantId, req.auth.userId]
    );

    if (
      actorResult.rows.length === 0 ||
      actorResult.rows[0].role !== "tenant_admin" ||
      actorResult.rows[0].is_active !== true
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Administrator permission no longer valid",
      });
    }

    const existing = await client.query(
      `SELECT id, full_name, role, is_active
       FROM users
       WHERE tenant_id = $1 AND id = $2
       FOR UPDATE`,
      [req.auth.tenantId, userId]
    );

    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "User not found",
      });
    }

    const current = existing.rows[0];

    const nextRole =
      body.role !== undefined ? body.role : current.role;

    const nextIsActive =
      body.isActive !== undefined
        ? body.isActive
        : current.is_active;

    const removingActiveAdmin =
      current.role === "tenant_admin" &&
      current.is_active === true &&
      (
        nextRole !== "tenant_admin" ||
        nextIsActive === false
      );

    if (removingActiveAdmin) {
      const countResult = await client.query(
        `SELECT COUNT(*)::integer AS active_admin_count
         FROM users
         WHERE tenant_id = $1
           AND role = 'tenant_admin'
           AND is_active = true`,
        [req.auth.tenantId]
      );

      if (countResult.rows[0].active_admin_count <= 1) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message:
            "Cannot remove the last active tenant administrator",
        });
      }
    }

    const result = await client.query(
      `UPDATE users SET
         full_name = $3,
         role = $4,
         is_active = $5,
         updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${USER_FIELDS}`,
      [
        req.auth.tenantId,
        userId,
        body.fullName !== undefined
          ? body.fullName.trim()
          : current.full_name,
        nextRole,
        nextIsActive,
      ]
    );

    await client.query("COMMIT");

    return res.json(result.rows[0]);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "User update rollback failed:",
          rollbackError.message
        );
      }
    }

    console.error("Update user failed:", error.message);

    return res.status(500).json({
      message: "Failed to update user",
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
