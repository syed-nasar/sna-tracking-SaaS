
const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

const {
  requirePlatformAuth,
} = require("../middleware/platform-auth.middleware");

const router = express.Router();

router.use(requirePlatformAuth);

const INVITATION_HOURS = 24;

const VALID_CUSTOMER_TYPES = [
  "personal",
  "business",
];

function validText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function validEmail(value) {
  return (
    validText(value, 255) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function validSlug(value) {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

// POST /api/platform/tenants/onboard
router.post("/", async (req, res) => {
  const body = req.body;

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return res.status(400).json({
      message: "Invalid request body",
    });
  }

  const allowedFields = [
    "name",
    "slug",
    "email",
    "phone",
    "adminFullName",
    "adminEmail",
    "customer_type",
  ];

  if (
    Object.keys(body).some(
      (key) => !allowedFields.includes(key)
    )
  ) {
    return res.status(400).json({
      message: "Unsupported onboarding field",
    });
  }

  const {
    name,
    slug,
    email = null,
    phone = null,
    adminFullName,
    adminEmail,
    customer_type = "business",
  } = body;

  if (
    !validText(name, 150) ||
    !validSlug(slug) ||
    (email !== null && !validEmail(email)) ||
    (phone !== null && !validText(phone, 30)) ||
    !validText(adminFullName, 150) ||
    !validEmail(adminEmail) ||
    !VALID_CUSTOMER_TYPES.includes(customer_type)
  ) {
    return res.status(400).json({
      message: "Invalid onboarding details",
    });
  }

  // The raw invitation token is never stored in the database.
  const invitationToken = crypto
    .randomBytes(32)
    .toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(invitationToken)
    .digest("hex");

  // Prevent login until invitation acceptance.
  const disabledPassword = crypto
    .randomBytes(48)
    .toString("hex");

  let client;

  try {
    const passwordHash = await bcrypt.hash(
      disabledPassword,
      12
    );

    client = await pool.connect();
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `INSERT INTO tenants
         (name, slug, email, phone, customer_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id, name, slug, email, phone,
         status, customer_type,
         created_at, updated_at`,
      [
        name.trim(),
        slug,
        email === null
          ? null
          : email.trim().toLowerCase(),
        phone === null ? null : phone.trim(),
        customer_type,
      ]
    );

    const tenant = tenantResult.rows[0];

    await client.query(
      `INSERT INTO tenant_branding
         (tenant_id, display_name)
       VALUES ($1, $2)`,
      [tenant.id, tenant.name]
    );

    const userResult = await client.query(
      `INSERT INTO users
         (
           tenant_id,
           full_name,
           email,
           password_hash,
           role,
           is_active
         )
       VALUES ($1, $2, $3, $4, 'tenant_admin', false)
       RETURNING
         id, tenant_id, full_name,
         email, role, is_active`,
      [
        tenant.id,
        adminFullName.trim(),
        adminEmail.trim().toLowerCase(),
        passwordHash,
      ]
    );

    const administrator = userResult.rows[0];

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
        tenant.id,
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
        "tenant.onboarded",
        tenant.id,
        JSON.stringify({
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          customerType: tenant.customer_type,
          initialAdminId: administrator.id,
          initialAdminEmail: administrator.email,
          invitationId: invitation.id,
        }),
      ]
    );

    await client.query("COMMIT");

    const response = {
      message: "Tenant onboarding created successfully",
      tenant,
      administrator,
      invitation: {
        expiresAt: invitation.expires_at,
        deliveryStatus: "pending",
      },
    };

    // Temporary local-development delivery mechanism.
    // Never enable this in production.
    if (
      process.env.NODE_ENV === "development" &&
      process.env.ALLOW_DEV_INVITATION_TOKEN === "true"
    ) {
      response.invitation.developmentToken =
        invitationToken;
    }

    return res.status(201).json(response);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "Onboarding rollback failed:",
          rollbackError.message
        );
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        message: "Tenant slug or user already exists",
      });
    }

    console.error(
      "Tenant onboarding failed:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to onboard tenant",
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
