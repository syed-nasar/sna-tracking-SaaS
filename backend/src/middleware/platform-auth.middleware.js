
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function requirePlatformAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      message: "Platform authentication required",
    });
  }

  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET is not configured securely");
    }

    const payload = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "sna-fleet-api",
      audience: "sna-fleet-platform",
    });

    if (
      typeof payload.sub !== "string" ||
      !/^[1-9]\d*$/.test(payload.sub)
    ) {
      return res.status(401).json({
        message: "Invalid platform authentication token",
      });
    }

    const result = await pool.query(
      `SELECT id, full_name, email, role, is_active
       FROM platform_admins
       WHERE id = $1`,
      [payload.sub]
    );

    const admin = result.rows[0];

    if (!admin || !admin.is_active || admin.role !== "super_admin") {
      return res.status(403).json({
        message: "Platform administrator access denied",
      });
    }

    req.platformAuth = {
      adminId: admin.id,
      fullName: admin.full_name,
      email: admin.email,
      role: admin.role,
    };

    return next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        message: "Invalid or expired platform token",
      });
    }

    console.error("Platform authentication error:", error.message);

    return res.status(500).json({
      message: "Platform authentication unavailable",
    });
  }
}

module.exports = { requirePlatformAuth };
