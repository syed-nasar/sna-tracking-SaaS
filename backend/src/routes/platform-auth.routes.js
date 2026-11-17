
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");

const pool = require("../config/db");
const {
  requirePlatformAuth,
} = require("../middleware/platform-auth.middleware");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again later.",
  },
});

// Precomputed bcrypt hash used when an email does not exist.
// Keeps the unknown-user path performing a password comparison.
const DUMMY_PASSWORD_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO2P3aQp2uVfO8J6oPj8C1sJxLkzW6e3K";

// POST /api/platform/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password ||
      email.length > 255 ||
      Buffer.byteLength(password, "utf8") > 1024
    ) {
      return res.status(400).json({
        message: "Invalid login request",
      });
    }

    const result = await pool.query(
      `SELECT
         id,
         full_name,
         email,
         password_hash,
         role,
         is_active
       FROM platform_admins
       WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    const admin = result.rows[0];

    const passwordValid = await bcrypt.compare(
      password,
      admin ? admin.password_hash : DUMMY_PASSWORD_HASH
    );

    if (
      !admin ||
      !passwordValid ||
      !admin.is_active ||
      admin.role !== "super_admin"
    ) {
      return res.status(401).json({
        message: "Invalid credentials or account unavailable",
      });
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("JWT_SECRET is not configured securely");
    }

    const accessToken = jwt.sign(
      {},
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        subject: String(admin.id),
        issuer: "sna-fleet-api",
        audience: "sna-fleet-platform",
        expiresIn: "30m",
      }
    );

    return res.json({
      accessToken,
      tokenType: "Bearer",
      expiresIn: 1800,
      admin: {
        id: admin.id,
        fullName: admin.full_name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Platform login error:", error.message);

    return res.status(500).json({
      message: "Platform login failed",
    });
  }
});

// GET /api/platform/auth/me
router.get("/me", requirePlatformAuth, (req, res) => {
  return res.json({
    id: req.platformAuth.adminId,
    fullName: req.platformAuth.fullName,
    email: req.platformAuth.email,
    role: req.platformAuth.role,
  });
});

module.exports = router;
