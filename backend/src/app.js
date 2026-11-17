
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");

const platformAuthRoutes = require("./routes/platform-auth.routes");
const platformTenantRoutes = require("./routes/platform-tenant.routes");
const platformDeviceRoutes = require("./routes/platform-device.routes");

const vehicleRoutes = require("./routes/vehicle.routes");
const vehicleImageRoutes = require("./routes/vehicle-image.routes");

const userRoutes = require("./routes/user.routes");

const invitationAcceptanceRouter = require("./routes/invitation-acceptance.routes");

const app = express();

app.disable("x-powered-by");

// Security headers.
app.use(helmet());

// Development frontend origin.
app.use(
  cors({
    origin: "http://127.0.0.1:3001",
  })
);

// Limit JSON request size.
app.use(express.json({ limit: "32kb" }));

// API routes.
app.use("/api/health", healthRoutes);

app.use(
  "/api/auth/invitations",
  invitationAcceptanceRouter
);

app.use("/api/auth", authRoutes);

app.use("/api/platform/auth", platformAuthRoutes);

app.use("/api/platform/tenants", platformTenantRoutes);

app.use("/api/platform/devices", platformDeviceRoutes);

// Vehicle image routes are mounted before
// the existing vehicle routes.
app.use("/api/vehicles", vehicleImageRoutes);

app.use("/api/vehicles", vehicleRoutes);

app.use("/api/users", userRoutes);

// Unknown API endpoint.
app.use((req, res) => {
  return res.status(404).json({
    message: "Endpoint not found",
  });
});

// Centralized error handler.
app.use((error, req, res, next) => {
  console.error(
    "Unhandled API error:",
    error.message
  );

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      message: "Request body too large",
    });
  }

  if (
    error instanceof SyntaxError &&
    error.status === 400
  ) {
    return res.status(400).json({
      message: "Invalid JSON request body",
    });
  }

  return res.status(500).json({
    message: "Internal server error",
  });
});

module.exports = app;
