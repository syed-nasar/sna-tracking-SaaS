
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    if (
      !process.env.JWT_SECRET ||
      process.env.JWT_SECRET.length < 32
    ) {
      throw new Error("JWT_SECRET is not configured securely");
    }

    const payload = jwt.verify(
      match[1],
      process.env.JWT_SECRET,
      {
        algorithms: ["HS256"],
        issuer: "sna-fleet-api",
        audience: "sna-fleet-users",
      }
    );

    if (
      typeof payload.sub !== "string" ||
      !/^[1-9]\d*$/.test(payload.sub) ||
      !Number.isSafeInteger(payload.tokenVersion) ||
      payload.tokenVersion < 0
    ) {
      return res.status(401).json({
        message: "Invalid authentication token",
      });
    }

    const result = await pool.query(
      `SELECT
         u.id,
         u.tenant_id,
         u.full_name,
         u.email,
         u.role,
         u.is_active,
         u.token_version,
         t.status AS tenant_status
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [payload.sub]
    );

    const user = result.rows[0];

    if (
      !user ||
      !user.is_active ||
      user.tenant_status !== "active"
    ) {
      return res.status(403).json({
        message: "Account or company is inactive",
      });
    }

    if (payload.tokenVersion !== user.token_version) {
      return res.status(401).json({
        message: "Session expired. Please log in again.",
      });
    }

    req.auth = {
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        message: "Invalid or expired authentication token",
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(500).json({
      message: "Authentication service unavailable",
    });
  }
}

module.exports = { requireAuth };
