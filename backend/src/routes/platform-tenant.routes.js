
const express = require("express");
const pool = require("../config/db");
const { customers,detail } = require("../services/platform-customers.service");
const { changeCustomerStatus } = require("../services/customer-lifecycle.service");
const { fail,transaction,respondError } = require("../services/gps-inventory.service");

const platformOnboardingRouter = require(
  "./platform-onboarding.routes"
);

const platformInvitationRouter = require(
  "./platform-invitation.routes"
);

const {
  requirePlatformAuth,
} = require("../middleware/platform-auth.middleware");

const router = express.Router();

router.use(requirePlatformAuth);
router.use((_req,res,next)=>{ res.set("Cache-Control","private, no-store"); next(); });
router.use("/onboard", platformOnboardingRouter);
router.use("/", platformInvitationRouter);

const MAX_ID = 9223372036854775807n;

const SELECT_FIELDS = `
  id, name, slug, email, phone, status,
  customer_type, created_at, updated_at
`;

const VALID_CUSTOMER_TYPES = [
  "personal",
  "business",
];

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
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function validText(value, maxLength) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength;
}

async function audit(client, adminId, action, tenantId, details) {
  await client.query(
    `INSERT INTO platform_audit_logs
       (platform_admin_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, 'tenant', $3, $4::jsonb)`,
    [adminId, action, tenantId, JSON.stringify(details)]
  );
}

router.get("/", async (req,res) => {
  try { res.json(await customers(req.query)); } catch (error) { respondError(res,error); }
});

router.get("/:id", async (req,res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({message:"Invalid tenant ID."});
  try { res.json(await detail(id)); } catch (error) { respondError(res,error); }
});

router.patch("/:id/status", async (req,res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({message:"Invalid tenant ID."});
  try {
    res.json(await transaction(async db => {
      const {rowCount}=await db.query(
        "SELECT id FROM platform_admins WHERE id=$1 AND is_active AND role='super_admin' FOR SHARE",
        [req.platformAuth.adminId]
      );
      if (!rowCount) fail(403,"Platform administrator access denied.");
      return changeCustomerStatus(db,id,null,req.body,(client,details) =>
        audit(client,req.platformAuth.adminId,`tenant.${details.toStatus}`,id,details));
    }));
  } catch (error) { respondError(res,error); }
});

// POST /api/platform/tenants
router.post("/", async (req, res) => {
  const body = req.body;

  if (!isObject(body)) {
    return res.status(400).json({
      message: "Invalid request body",
    });
  }

  const allowed = [
    "name",
    "slug",
    "email",
    "phone",
    "customer_type",
  ];

  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return res.status(400).json({
      message: "Unsupported tenant field",
    });
  }

  const {
    name,
    slug,
    email = null,
    phone = null,
    customer_type = "business",
  } = body;

  if (
    !validText(name, 150) ||
    typeof slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 100 ||
    (email !== null &&
      (!validText(email, 255) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
    (phone !== null && !validText(phone, 30)) ||
    !VALID_CUSTOMER_TYPES.includes(customer_type)
  ) {
    return res.status(400).json({
      message: "Invalid tenant details",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO tenants
         (name, slug, email, phone, customer_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SELECT_FIELDS}`,
      [
        name.trim(),
        slug,
        email ? email.trim() : null,
        phone ? phone.trim() : null,
        customer_type,
      ]
    );

    const tenant = result.rows[0];

    await client.query(
      `INSERT INTO tenant_branding
         (tenant_id, display_name)
       VALUES ($1, $2)`,
      [tenant.id, tenant.name]
    );

    await audit(
      client,
      req.platformAuth.adminId,
      "tenant.created",
      tenant.id,
      {
        name: tenant.name,
        slug: tenant.slug,
        customer_type: tenant.customer_type,
      }
    );

    await client.query("COMMIT");

    return res.status(201).json(tenant);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({
        message: "Tenant slug already exists",
      });
    }

    console.error("Create tenant failed:", error.message);
    return res.status(500).json({
      message: "Failed to create tenant",
    });
  } finally {
    client.release();
  }
});

// PATCH /api/platform/tenants/:id
router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const body = req.body;

  if (!id || !isObject(body)) {
    return res.status(400).json({
      message: "Invalid request",
    });
  }

  if (Object.hasOwn(body,"status")) return res.status(400).json({ message:"Use the customer status action." });
  const allowed = [
    "name",
    "email",
    "phone",
    "customer_type",
  ];

  const keys = Object.keys(body);

  if (
    keys.length === 0 ||
    keys.some((key) => !allowed.includes(key))
  ) {
    return res.status(400).json({
      message: "Invalid update fields",
    });
  }

  if (
    (body.name !== undefined &&
      !validText(body.name, 150)) ||
    (body.email !== undefined &&
      body.email !== null &&
      (!validText(body.email, 255) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) ||
    (body.phone !== undefined &&
      body.phone !== null &&
      !validText(body.phone, 30)) ||
    (body.customer_type !== undefined &&
      !VALID_CUSTOMER_TYPES.includes(body.customer_type))
  ) {
    return res.status(400).json({
      message: "Invalid update values",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const previous = await client.query(
      `SELECT ${SELECT_FIELDS}
       FROM tenants WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (!previous.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Tenant not found",
      });
    }

    const oldTenant = previous.rows[0];
    if (body.customer_type !== undefined && body.customer_type !== oldTenant.customer_type) {
      await client.query("ROLLBACK");
      return res.status(400).json({message:"Customer account-type conversion is not supported."});
    }

    const updated = await client.query(
      `UPDATE tenants SET
         name = $2,
         email = $3,
         phone = $4,
         updated_at = NOW()
       WHERE id = $1
       RETURNING ${SELECT_FIELDS},xmin::text AS version`,
      [
        id,
        body.name !== undefined
          ? body.name.trim()
          : oldTenant.name,
        body.email !== undefined
          ? (body.email === null ? null : body.email.trim())
          : oldTenant.email,
        body.phone !== undefined
          ? (body.phone === null ? null : body.phone.trim())
          : oldTenant.phone,
      ]
    );

    const tenant = updated.rows[0];

    await audit(
      client,
      req.platformAuth.adminId,
      "tenant.updated",
      id,
      {
        before: oldTenant,
        after: tenant,
      }
    );

    await client.query("COMMIT");

    return res.json(tenant);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update tenant failed:", error.message);

    return res.status(500).json({
      message: "Failed to update tenant",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
