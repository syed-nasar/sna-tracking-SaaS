
const express = require("express");
const pool = require("../config/db");

const {
  requirePlatformAuth,
} = require("../middleware/platform-auth.middleware");

const traccarService = require("../services/traccar.service");

const router = express.Router();

router.use(requirePlatformAuth);

const MAX_ID = 9223372036854775807n;

function parsePositiveId(value) {
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

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function databaseError(error) {
  return error.code === "23505";
}

// GET /api/platform/devices
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         gd.traccar_device_id,
         gd.tenant_id,
         gd.status,
         gd.created_at,
         gd.updated_at,
         t.name AS tenant_name
       FROM gps_devices gd
       LEFT JOIN tenants t ON t.id = gd.tenant_id
       ORDER BY gd.traccar_device_id`
    );

    const devices = await traccarService.getDevices();

    const devicesById = new Map(
      devices.map((device) => [
        String(device.id),
        device,
      ])
    );

    const response = result.rows.map((record) => {
      const device = devicesById.get(
        String(record.traccar_device_id)
      );

      return {
        traccarDeviceId: record.traccar_device_id,
        tenantId: record.tenant_id,
        tenantName: record.tenant_name,
        status: record.status,
        deviceName: device?.name || null,
        uniqueId: device?.uniqueId || null,
        gpsStatus: device?.status || "unknown",
        lastUpdate: device?.lastUpdate || null,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      };
    });

    return res.json(response);
  } catch (error) {
    console.error(
      "Failed to list platform devices:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to list GPS devices",
    });
  }
});

// POST /api/platform/devices
// Register an existing Traccar device.
router.post("/", async (req, res) => {
  const body = req.body;

  if (
    !isObject(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      body,
      "traccarDeviceId"
    )
  ) {
    return res.status(400).json({
      message: "Only traccarDeviceId is required",
    });
  }

  const deviceId = parsePositiveId(
    body.traccarDeviceId
  );

  if (!deviceId) {
    return res.status(400).json({
      message: "Invalid Traccar device ID",
    });
  }

  try {
    const devices = await traccarService.getDevices();

    const device = devices.find(
      (item) => String(item.id) === deviceId
    );

    if (!device) {
      return res.status(404).json({
        message: "Traccar device not found",
      });
    }

    const result = await pool.query(
      `INSERT INTO gps_devices (
         traccar_device_id,
         tenant_id,
         status
       )
       VALUES ($1, NULL, 'available')
       RETURNING
         traccar_device_id,
         tenant_id,
         status,
         created_at,
         updated_at`,
      [deviceId]
    );

    const record = result.rows[0];

    return res.status(201).json({
      message: "GPS device registered successfully",
      device: {
        traccarDeviceId: record.traccar_device_id,
        tenantId: record.tenant_id,
        status: record.status,
        deviceName: device.name,
        uniqueId: device.uniqueId,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      },
    });
  } catch (error) {
    if (databaseError(error)) {
      return res.status(409).json({
        message: "GPS device is already registered",
      });
    }

    console.error(
      "Failed to register GPS device:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to register GPS device",
    });
  }
});

// POST /api/platform/devices/create
// Create a device in Traccar and register it in PostgreSQL.
router.post("/create", async (req, res) => {
  const body = req.body;

  if (
    !isObject(body) ||
    Object.keys(body).some(
      (key) => !["name", "uniqueId"].includes(key)
    ) ||
    !validText(body.name, 150) ||
    !validText(body.uniqueId, 100)
  ) {
    return res.status(400).json({
      message: "Invalid GPS device details",
    });
  }

  const name = body.name.trim();
  const uniqueId = body.uniqueId.trim();

  try {
    // Check whether the identifier already exists in Traccar.
    const existingDevices = await traccarService.getDevices();

    const existingDevice = existingDevices.find(
      (device) => device.uniqueId === uniqueId
    );

    if (existingDevice) {
      return res.status(409).json({
        message: "GPS device identifier already exists in Traccar",
      });
    }

    // Create the device in Traccar.
    const device = await traccarService.createDevice({
      name,
      uniqueId,
    });

    const deviceId = parsePositiveId(device?.id);

    if (!deviceId) {
      console.error(
        "Traccar returned an invalid device ID after creation"
      );

      return res.status(502).json({
        message:
          "Traccar created a device but returned an invalid ID. Manual reconciliation is required.",
      });
    }

    try {
      // Register the newly created device as unassigned.
      const result = await pool.query(
        `INSERT INTO gps_devices (
           traccar_device_id,
           tenant_id,
           status
         )
         VALUES ($1, NULL, 'available')
         RETURNING
           traccar_device_id,
           tenant_id,
           status,
           created_at,
           updated_at`,
        [deviceId]
      );

      const record = result.rows[0];

      return res.status(201).json({
        message:
          "GPS device created and registered successfully",
        device: {
          traccarDeviceId: record.traccar_device_id,
          tenantId: record.tenant_id,
          status: record.status,
          deviceName: device.name,
          uniqueId: device.uniqueId,
          gpsStatus: device.status || "unknown",
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        },
      });
    } catch (databaseFailure) {
      console.error(
        "Traccar device created but database registration failed:",
        {
          traccarDeviceId: deviceId,
          error: databaseFailure.message,
        }
      );

      // Do not automatically delete a device from Traccar.
      // The platform administrator can reconcile it safely.
      return res.status(500).json({
        message:
          "Device was created in Traccar but could not be registered in PostgreSQL. Do not retry creation; register the existing device instead.",
        traccarDeviceId: deviceId,
        requiresReconciliation: true,
      });
    }
  } catch (error) {
    console.error(
      "Failed to create Traccar device:",
      error.message
    );

    if (error.response?.status === 400 ||
        error.response?.status === 409) {
      return res.status(409).json({
        message:
          "Traccar rejected the device. Check whether its unique identifier already exists.",
      });
    }

    return res.status(502).json({
      message:
        "Traccar device creation failed or its result could not be confirmed. Check Traccar before retrying.",
    });
  }
});

 // PATCH /api/platform/devices/:id/allocate
 // Allocate an available GPS device to an active tenant.
 router.patch("/:id/allocate", async (req, res) => {
   const deviceId = parsePositiveId(req.params.id);
   const body = req.body;

   if (!deviceId) {
     return res.status(400).json({
       message: "Invalid Traccar device ID",
     });
   }

   if (
     !isObject(body) ||
     Object.keys(body).length !== 1 ||
     !Object.prototype.hasOwnProperty.call(body, "tenantId")
   ) {
     return res.status(400).json({
       message: "Only tenantId is required",
     });
   }

   const tenantId = parsePositiveId(body.tenantId);

   if (!tenantId) {
     return res.status(400).json({
       message: "Invalid tenant ID",
     });
   }

   let client;

   try {
     client = await pool.connect();
     await client.query("BEGIN");

     // Lock the device to prevent simultaneous allocations.
     const deviceResult = await client.query(
       `SELECT traccar_device_id, tenant_id, status
        FROM gps_devices
        WHERE traccar_device_id = $1
        FOR UPDATE`,
       [deviceId]
     );

     if (deviceResult.rowCount === 0) {
       await client.query("ROLLBACK");

       return res.status(404).json({
         message: "GPS device is not registered",
       });
     }

     const device = deviceResult.rows[0];

     if (device.status !== "available" || device.tenant_id !== null) {
       await client.query("ROLLBACK");

       return res.status(409).json({
         message: "GPS device is not available for allocation",
       });
     }

     // Only active tenants can receive GPS devices.
     const tenantResult = await client.query(
       `SELECT id, name, status
        FROM tenants
        WHERE id = $1
        FOR UPDATE`,
       [tenantId]
     );

     if (tenantResult.rowCount === 0) {
       await client.query("ROLLBACK");

       return res.status(404).json({
         message: "Tenant not found",
       });
     }

     const tenant = tenantResult.rows[0];

     if (tenant.status !== "active") {
       await client.query("ROLLBACK");

       return res.status(409).json({
         message: "GPS devices can only be allocated to active tenants",
       });
     }

     const allocationResult = await client.query(
       `UPDATE gps_devices
        SET tenant_id = $1,
            status = 'assigned',
            updated_at = NOW()
        WHERE traccar_device_id = $2
        RETURNING
          traccar_device_id,
          tenant_id,
          status,
          created_at,
          updated_at`,
       [tenantId, deviceId]
     );

     const allocation = allocationResult.rows[0];

     await client.query("COMMIT");

     return res.json({
       message: "GPS device allocated successfully",
       device: {
         traccarDeviceId: allocation.traccar_device_id,
         tenantId: allocation.tenant_id,
         tenantName: tenant.name,
         status: allocation.status,
         createdAt: allocation.created_at,
         updatedAt: allocation.updated_at,
       },
     });
   } catch (error) {
     if (client) {
       try {
         await client.query("ROLLBACK");
       } catch (rollbackError) {
         console.error("Allocation rollback failed:", rollbackError.message);
       }
     }

     console.error("Failed to allocate GPS device:", error.message);

     return res.status(500).json({
       message: "Failed to allocate GPS device",
     });
   } finally {
     if (client) {
       client.release();
     }
   }
 });

module.exports = router;
