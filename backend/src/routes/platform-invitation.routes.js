
const express = require("express");
const crypto = require("node:crypto");
const pool = require("../config/db");
const {
  requirePlatformAuth,
} = require("../middleware/platform-auth.middleware");

const router = express.Router();

router.use(requirePlatformAuth);

const MAX_ID = 9223372036854775807n;

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    return null;
  }

  try {
    const id = BigInt(value);
    return id <= MAX_ID ? String(id) : null;
  } catch {
    return null;
  }
}

// POST /api/platform/tenants/:tenantId/invitations/reissue
router.post(
  "/:tenantId/invitations/reissue",
  async (req, res) => {
    const tenantId = parseId(req.params.tenantId);

    if (!tenantId) {
      return res.status(400).json({
        message: "Invalid tenant ID",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      // Lock the tenant to serialize invitation reissues.
      const tenantResult = await client.query(
        `SELECT id, name, slug, status
         FROM tenants
         WHERE id = $1
         FOR UPDATE`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Tenant not found",
        });
      }

      const tenant = tenantResult.rows[0];

      if (tenant.status !== "active") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message: "Tenant must be active",
        });
      }

      // Only reissue for the initial inactive administrator.
      const adminResult = await client.query(
        `SELECT id, email, role, is_active
         FROM users
         WHERE tenant_id = $1
           AND role = 'tenant_admin'
           AND is_active = false
         ORDER BY id
         FOR UPDATE`,
        [tenantId]
      );

      if (adminResult.rows.length !== 1) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message:
            "Exactly one inactive tenant administrator is required",
        });
      }

      const administrator = adminResult.rows[0];

      // Invalidate all previous unused invitations
      // for this administrator.
      await client.query(
        `UPDATE user_invitations
         SET used_at = NOW()
         WHERE tenant_id = $1
           AND user_id = $2
           AND used_at IS NULL`,
        [tenantId, administrator.id]
      );

      const invitationResult = await client.query(
        `INSERT INTO user_invitations
           (
             tenant_id,
             user_id,
             token_hash,
             expires_at,
             created_by_platform_admin_id
           )
         VALUES (
           $1,
           $2,
           $3,
           NOW() + INTERVAL '24 hours',
           $4
         )
         RETURNING id, expires_at`,
        [
          tenantId,
          administrator.id,
          tokenHash,
          req.platformAuth.adminId,
        ]
      );

      const invitation = invitationResult.rows[0];

      await client.query(
        `INSERT INTO platform_audit_logs
           (
             platform_admin_id,
             action,
             resource_type,
             resource_id,
             details
           )
         VALUES ($1, $2, 'tenant', $3, $4::jsonb)`,
        [
          req.platformAuth.adminId,
          "tenant.invitation_reissued",
          tenantId,
          JSON.stringify({
            userId: administrator.id,
            invitationId: invitation.id,
          }),
        ]
      );

      await client.query("COMMIT");

      const response = {
        message: "Invitation reissued successfully",
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        administrator: {
          id: administrator.id,
          email: administrator.email,
          role: administrator.role,
          is_active: administrator.is_active,
        },
        invitation: {
          id: invitation.id,
          expiresAt: invitation.expires_at,
          deliveryStatus: "pending",
        },
      };

      // Local development only.
      if (
        process.env.NODE_ENV === "development" &&
        process.env.ALLOW_DEV_INVITATION_TOKEN === "true"
      ) {
        response.invitation.developmentToken = token;
      }

      return res.status(201).json(response);
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
        "Reissue invitation failed:",
        error.message
      );

      return res.status(500).json({
        message: "Failed to reissue invitation",
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);

module.exports = router;
