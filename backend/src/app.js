
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");

const platformAuthRoutes = require("./routes/platform-auth.routes");
const platformTenantRoutes = require("./routes/platform-tenant.routes");
const platformDeviceRoutes = require("./routes/platform-device.routes");

const vehicleRoutes = require("./routes/vehicle.routes");
const vehicleReports = require("./routes/vehicle-reports.routes");
const resellerRoutes = require("./routes/resellers.routes");
const vehicleImageRoutes = require("./routes/vehicle-image.routes");

const userRoutes = require("./routes/user.routes");
const fleetRoutes = require("./routes/fleet.routes");
const connectivityRoutes = require("./routes/connectivity.routes");
const billingRoutes = require("./routes/billing.routes");
const alertRoutes = require("./routes/alerts.routes");

const invitationAcceptanceRouter = require("./routes/invitation-acceptance.routes");

const app = express();

app.disable("x-powered-by");

// Security headers.
app.use(helmet());

// Allow the localhost alias only in development.
const frontendOrigins = ["http://127.0.0.1:3001"];
if (process.env.NODE_ENV === "development") {
  frontendOrigins.push("http://localhost:3001");
}

app.use(
  cors({
    origin: frontendOrigins,
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
app.use("/api/platform/connectivity", connectivityRoutes.platform);
app.use("/api/platform/billing", billingRoutes.platform);

// Vehicle image routes are mounted before
// the existing vehicle routes.
app.use("/api/vehicles", vehicleImageRoutes);

app.use("/api/vehicles", vehicleRoutes);
app.use("/api/reports", vehicleReports);
app.use("/api/platform/resellers", resellerRoutes.platform);
app.use("/api/reseller", resellerRoutes.reseller);
app.use("/api/brands", resellerRoutes.publicApi);
app.use("/api/tenant-brand", resellerRoutes.tenant);

app.use("/api/users", userRoutes);
app.use("/api/fleet", fleetRoutes);
app.use("/api/connectivity", connectivityRoutes.tenant);
app.use("/api/billing", billingRoutes.tenant);
app.use("/api/alerts", alertRoutes.tenant);
app.use("/api/platform/alerts", alertRoutes.platform);
app.use("/api/telemetry/traccar", alertRoutes.source);

// Unknown API endpoint.
app.use((req, res) => {
  return res.status(404).json({
    message: "Endpoint not found",
  });
});

// Centralized error handler.
app.use((error, req, res, next) => {
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

  console.error("Unhandled API error:", error.code || error.name);
  return res.status(500).json({
    message: "Internal server error",
  });
});

module.exports = app;
