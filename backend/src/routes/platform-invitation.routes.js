
const express = require("express");
const crypto = require("node:crypto");
const pool = require("../config/db");
const { configStatus, queueInvitation, manualInvitation } = require("../services/company-invitation-email");
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

const latestInvitation = `SELECT i.id,i.expires_at,i.used_at,
  i.created_at>clock_timestamp()-interval '60 seconds' AS recently_issued,
  u.id AS user_id,u.is_active,u.role,t.status AS tenant_status,t.customer_type,d.status AS delivery_status
  FROM user_invitations i JOIN users u ON u.id=i.user_id AND u.tenant_id=i.tenant_id
  JOIN tenants t ON t.id=i.tenant_id LEFT JOIN company_invitation_email d ON d.invitation_id=i.id
  WHERE i.tenant_id=$1 AND i.user_id=(SELECT user_id FROM user_invitations WHERE tenant_id=$1 ORDER BY id LIMIT 1)
  ORDER BY i.id DESC LIMIT 1`;

function summarize(row) {
  const availability = row.customer_type === "business" ? configStatus() : "manual";
  return {
    id:row.id,
    expiresAt:row.expires_at,
    state:row.is_active || row.used_at ? "closed" : row.expires_at.getTime()<=Date.now() ? "expired" : "open",
    deliveryStatus:row.delivery_status ?? (availability==="ready"?"manual":availability),
    emailAvailability:availability,
    canResend:row.tenant_status==="active" && row.role==="tenant_admin" && !row.is_active && !row.used_at,
  };
}

router.get("/:tenantId/invitations/status",async(req,res)=>{
  const tenantId = parseId(req.params.tenantId);
  if (!tenantId) return res.status(400).json({message:"Invalid tenant ID"});
  const {rows:[row]} = await pool.query(latestInvitation,[tenantId]);
  res.set("Cache-Control","no-store");
  return res.json({invitation:row ? summarize(row) : null});
});

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
        `SELECT id, name, slug, status, customer_type
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

      const {rows:[candidate]} = await client.query(latestInvitation,[tenantId]);
      if (candidate) await client.query("SELECT invitation_id FROM company_invitation_email WHERE invitation_id=$1 FOR UPDATE",[candidate.id]);
      const {rows:[latest]} = await client.query(latestInvitation,[tenantId]);
      if (!latest || latest.used_at || latest.is_active || latest.role!=="tenant_admin") {
        await client.query("ROLLBACK");
        return res.status(409).json({message:"No open initial administrator invitation"});
      }
      const unexpired = latest.expires_at.getTime()>Date.now();
      if (unexpired && ["pending","sending"].includes(latest.delivery_status) &&
          (latest.delivery_status==="sending" || configStatus()==="ready")) {
        await client.query("COMMIT");
        res.set("Cache-Control","no-store");
        return res.status(202).json({message:"Invitation email is already queued",invitation:summarize(latest)});
      }
      if (unexpired && latest.recently_issued) {
        await client.query("ROLLBACK");
        res.set("Retry-After","60");
        return res.status(429).json({message:"Wait one minute between invitation reissues."});
      }

      // Only reissue for the original inactive administrator.
      const adminResult = await client.query(
        `SELECT id, email, role, is_active
         FROM users
         WHERE tenant_id = $1
           AND id = $2 AND role = 'tenant_admin'
           AND is_active = false
         ORDER BY id
         FOR UPDATE`,
        [tenantId,latest.user_id]
      );

      if (adminResult.rows.length !== 1) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message:
            "Exactly one inactive tenant administrator is required",
        });
      }

      const administrator = adminResult.rows[0];

      await client.query(`UPDATE company_invitation_email SET status='cancelled',payload=NULL,
        updated_at=clock_timestamp() WHERE invitation_id=$1 AND status='pending'`,[latest.id]);

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
      const deliveryStatus = await queueInvitation(client,invitation.id,token,tenant.customer_type==="business");

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
          deliveryStatus,
          ...manualInvitation(token),
        },
      };

      res.set("Cache-Control","no-store");
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
