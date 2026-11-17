
const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const pool = require("../config/db");

const router = express.Router();

const invitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many invitation attempts. Try again later.",
  },
});

router.use(invitationLimiter);

// POST /api/auth/invitations/accept
router.post("/accept", async (req, res) => {
  const { token, password } = req.body || {};

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      message: "Invalid invitation or password",
    });
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  let client;

  try {
    // Hash before opening the transaction to reduce
    // database lock duration.
    const passwordHash = await bcrypt.hash(password, 12);

    client = await pool.connect();
    await client.query("BEGIN");

    const invitationResult = await client.query(
      `SELECT
         i.id,
         i.tenant_id,
         i.user_id,
         i.expires_at,
         i.used_at
       FROM user_invitations i
       WHERE i.token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    if (invitationResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Invalid or expired invitation",
      });
    }

    const invitation = invitationResult.rows[0];

    if (
      invitation.used_at !== null ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Invalid or expired invitation",
      });
    }

    const tenantResult = await client.query(
      `SELECT id, status
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [invitation.tenant_id]
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

    const userResult = await client.query(
      `SELECT id, tenant_id, role, is_active
       FROM users
       WHERE id = $1
         AND tenant_id = $2
       FOR UPDATE`,
      [invitation.user_id, invitation.tenant_id]
    );

    if (
      userResult.rows.length === 0 ||
      userResult.rows[0].is_active ||
      userResult.rows[0].role !== "tenant_admin"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Invitation cannot be accepted",
      });
    }

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           is_active = true,
           updated_at = NOW()
       WHERE id = $2
         AND tenant_id = $3`,
      [
        passwordHash,
        invitation.user_id,
        invitation.tenant_id,
      ]
    );

    await client.query(
      `UPDATE user_invitations
       SET used_at = NOW()
       WHERE user_id = $1
         AND tenant_id = $2
         AND used_at IS NULL`,
      [invitation.user_id, invitation.tenant_id]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Invitation accepted successfully",
      accountActivated: true,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Invitation rollback failed:",
          rollbackError.message
        );
      }
    }

    console.error(
      "Invitation acceptance failed:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to accept invitation",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
