
const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
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
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => String(req.auth.userId),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many password-change attempts. Please try again later." },
});

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
    !value.includes("\0") &&
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

router.get("/me", async (req, res) => {
  try {
    const { tenantId, userId } = req.auth;
    const result = await pool.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.role,
              t.name AS "tenantName", t.slug AS "tenantSlug",
              t.customer_type AS "customerType"
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.tenant_id = $1 AND u.id = $2
         AND u.is_active AND t.status = 'active'`,
      [tenantId, userId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ message: "Account or company is inactive" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Read account failed:", error.code);
    return res.status(500).json({ message: "Failed to load account" });
  }
});

router.patch("/me", async (req, res) => {
  const body = req.body;
  if (!isObject(body) || Object.keys(body).length !== 1 || !validName(body.fullName)) {
    return res.status(400).json({ message: "Enter a full name of 1 to 150 characters" });
  }

  try {
    const { tenantId, userId, tokenVersion } = req.auth;
    const result = await pool.query(
      `UPDATE users SET full_name = $3, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND is_active AND token_version = $4
         AND EXISTS (SELECT 1 FROM tenants WHERE id = $1 AND status = 'active')
       RETURNING ${USER_FIELDS}`,
      [tenantId, userId, body.fullName.trim(), tokenVersion]
    );
    if (!result.rows.length) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Update account failed:", error.code);
    return res.status(500).json({ message: "Failed to update profile" });
  }
});

router.patch("/me/password", passwordChangeLimiter, async (req, res) => {
  const body = req.body;
  if (!isObject(body) || Object.keys(body).length !== 2) {
    return res.status(400).json({ message: "Provide the current and new passwords" });
  }
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== "string" || !currentPassword.length ||
      typeof newPassword !== "string" || [...newPassword].length < 12 ||
      Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({
      message: "Enter your current password and a new password of at least 12 characters and at most 72 UTF-8 bytes",
    });
  }

  try {
    const { tenantId, userId, tokenVersion } = req.auth;
    const result = await pool.query(
      `SELECT password_hash
       FROM users
       WHERE tenant_id = $1 AND id = $2 AND is_active AND token_version = $3
         AND EXISTS (SELECT 1 FROM tenants WHERE id = $1 AND status = 'active')`,
      [tenantId, userId, tokenVersion]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // Only replace the credentials that were read and verified above.
    const updated = await pool.query(
      `UPDATE users SET password_hash = $3, token_version = token_version + 1,
                        updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND is_active
         AND password_hash = $4 AND token_version = $5
         AND EXISTS (SELECT 1 FROM tenants WHERE id = $1 AND status = 'active')`,
      [tenantId, userId, passwordHash, user.password_hash, tokenVersion]
    );
    if (updated.rowCount !== 1) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    return res.status(204).end();
  } catch (error) {
    console.error("Change password failed:", error.code);
    return res.status(500).json({ message: "Failed to change password" });
  }
});

router.use((req, res, next) => {
  if (req.auth.customerType !== "business") {
    return res.status(403).json({ message: "User management requires a Business account" });
  }
  next();
});

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

  let client;
  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const { tenantId, userId, tokenVersion } = req.auth;
    client = await pool.connect();
    await client.query("BEGIN");

    // Administrator updates lock the tenant first, then the affected user.
    const tenant = await client.query(
      `SELECT id FROM tenants
       WHERE id = $1 AND status = 'active' AND customer_type = 'business'
       FOR UPDATE`,
      [tenantId]
    );
    if (!tenant.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "User management requires an active Business account" });
    }

    const actor = await client.query(
      `SELECT id FROM users
       WHERE tenant_id = $1 AND id = $2 AND role = 'tenant_admin'
         AND is_active AND token_version = $3
       FOR UPDATE`,
      [tenantId, userId, tokenVersion]
    );
    if (!actor.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Administrator permission no longer valid" });
    }

    const result = await client.query(
      `INSERT INTO users
         (tenant_id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_FIELDS}`,
      [
        tenantId,
        fullName.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        role,
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        client.release(rollbackError);
        client = null;
      }
    }
    if (error.code === "23505") {
      return res.status(409).json({
        message: "User email already exists in this tenant",
      });
    }

    console.error("Create user failed:", error.message);
    return res.status(500).json({
      message: "Failed to create user",
    });
  } finally {
    if (client) client.release();
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
      `SELECT id, status, customer_type
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [req.auth.tenantId]
    );

    if (
      tenantResult.rows.length === 0 ||
      tenantResult.rows[0].status !== "active" ||
      tenantResult.rows[0].customer_type !== "business"
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "User management requires an active Business account",
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
