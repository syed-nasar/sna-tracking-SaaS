
const express = require("express");
const router = express.Router();

const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const vehicleRepository = require("../repositories/vehicle.repository");
const traccarService = require("../services/traccar.service");

router.use(requireAuth, authorize("vehicles:read"));

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

function optionalText(value, maxLength) {
  return (
    value === undefined ||
    value === null ||
    (
      typeof value === "string" &&
      value.trim().length <= maxLength
    )
  );
}

// Only permit relative image paths under /vehicle-images/.
// Filenames must be simple, with no path traversal.
function validImageUrl(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  return /^\/vehicle-images\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(
    value
  );
}

function validImageType(value) {
  return (
    value === null ||
    value === undefined ||
    value === "photo" ||
    value === "illustration"
  );
}

function validImageMetadata(imageUrl, imageType) {
  if (
    !validImageUrl(imageUrl) ||
    !validImageType(imageType)
  ) {
    return false;
  }

  const hasUrl =
    typeof imageUrl === "string" &&
    imageUrl.length > 0;

  const hasType =
    imageType === "photo" ||
    imageType === "illustration";

  return (
    (hasUrl && hasType) ||
    (
      (imageUrl === null || imageUrl === undefined) &&
      (imageType === null || imageType === undefined)
    )
  );
}

function formatVehicle(vehicle) {
  return {
    id: vehicle.id,
    tenantId: vehicle.tenant_id,
    name: vehicle.name,
    registrationNumber: vehicle.registration_number,
    make: vehicle.make,
    model: vehicle.model,
    status: vehicle.status,
    traccarDeviceId: vehicle.traccar_device_id,
    imageUrl: vehicle.image_url || null,
    imageType: vehicle.image_type || null,
  };
}

// GET /api/vehicles
router.get("/", async (req, res) => {
  try {
    const vehicles =
      await vehicleRepository.getVehiclesByTenant(
        req.auth.tenantId
      );

    const devices = await traccarService.getDevices();

    const devicesById = new Map(
      devices.map((device) => [
        String(device.id),
        device,
      ])
    );

    const response = vehicles.map((vehicle) => {
      const device = devicesById.get(
        String(vehicle.traccar_device_id)
      );

      return {
        ...formatVehicle(vehicle),
        gpsStatus: device?.status || "unknown",
        lastUpdate: device?.lastUpdate || null,
      };
    });

    return res.json(response);
  } catch (error) {
    console.error(
      "Failed to fetch vehicles:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to fetch vehicles",
    });
  }
});

// GET /api/vehicles/available-devices
router.get("/available-devices", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         gd.traccar_device_id
       FROM gps_devices gd
       WHERE gd.tenant_id = $1
         AND gd.status = 'assigned'
         AND NOT EXISTS (
           SELECT 1
           FROM vehicles v
           WHERE v.traccar_device_id = gd.traccar_device_id
         )
       ORDER BY gd.traccar_device_id`,
      [req.auth.tenantId]
    );

    const devices = await traccarService.getDevices();

    const devicesById = new Map(
      devices.map((device) => [
        String(device.id),
        device,
      ])
    );

    const response = result.rows
      .map((record) => {
        const device = devicesById.get(
          String(record.traccar_device_id)
        );

        if (!device) {
          return null;
        }

        return {
          traccarDeviceId:
            record.traccar_device_id,
          deviceName: device.name,
          uniqueId: device.uniqueId,
          gpsStatus: device.status || "unknown",
          lastUpdate: device.lastUpdate || null,
        };
      })
      .filter(Boolean);

    return res.json(response);
  } catch (error) {
    console.error(
      "Failed to fetch available GPS devices:",
      error.message
    );

    return res.status(500).json({
      message:
        "Failed to fetch available GPS devices",
    });
  }
});

// POST /api/vehicles
router.post(
  "/",
  authorize("vehicles:write"),
  async (req, res) => {
    const body = req.body;

    if (!isObject(body)) {
      return res.status(400).json({
        message: "Invalid request body",
      });
    }

    const allowed = [
      "name",
      "registrationNumber",
      "make",
      "model",
      "traccarDeviceId",
      "imageUrl",
      "imageType",
    ];

    if (
      Object.keys(body).some(
        (key) => !allowed.includes(key)
      ) ||
      !validText(body.name, 150) ||
      !optionalText(body.registrationNumber, 50) ||
      !optionalText(body.make, 100) ||
      !optionalText(body.model, 100) ||
      !validImageMetadata(
        body.imageUrl,
        body.imageType
      )
    ) {
      return res.status(400).json({
        message: "Invalid vehicle details",
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
      // Confirm the device is allocated to this tenant.
      const allocationResult = await pool.query(
        `SELECT traccar_device_id
         FROM gps_devices
         WHERE traccar_device_id = $1
           AND tenant_id = $2
           AND status = 'assigned'`,
        [deviceId, req.auth.tenantId]
      );

      if (allocationResult.rowCount === 0) {
        return res.status(403).json({
          message:
            "GPS device is not allocated to your company",
        });
      }

      // Confirm the device exists in Traccar.
      const devices =
        await traccarService.getDevices();

      const deviceExists = devices.some(
        (device) =>
          String(device.id) === deviceId
      );

      if (!deviceExists) {
        return res.status(404).json({
          message: "Traccar device not found",
        });
      }

      const vehicle =
        await vehicleRepository.createVehicle(
          req.auth.tenantId,
          {
            name: body.name.trim(),
            registrationNumber:
              body.registrationNumber?.trim() ||
              null,
            make:
              body.make?.trim() || null,
            model:
              body.model?.trim() || null,
            traccarDeviceId: deviceId,
            imageUrl: body.imageUrl ?? null,
            imageType: body.imageType ?? null,
          }
        );

      return res
        .status(201)
        .json(formatVehicle(vehicle));
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message:
            "Traccar device or registration number is already assigned",
        });
      }

      if (error.code === "23503") {
        return res.status(409).json({
          message:
            "GPS device allocation is no longer valid",
        });
      }

      console.error(
        "Failed to create vehicle:",
        error.message
      );

      return res.status(500).json({
        message: "Failed to create vehicle",
      });
    }
  }
);

// PATCH /api/vehicles/:id
router.patch(
  "/:id",
  authorize("vehicles:write"),
  async (req, res) => {
    const vehicleId = parsePositiveId(
      req.params.id
    );

    const body = req.body;

    if (!vehicleId || !isObject(body)) {
      return res.status(400).json({
        message: "Invalid request",
      });
    }

    const allowed = [
      "name",
      "registrationNumber",
      "make",
      "model",
      "status",
      "imageUrl",
      "imageType",
    ];

    const keys = Object.keys(body);

    if (
      keys.length === 0 ||
      keys.some(
        (key) => !allowed.includes(key)
      ) ||
      (
        body.name !== undefined &&
        !validText(body.name, 150)
      ) ||
      (
        body.registrationNumber !== undefined &&
        !optionalText(
          body.registrationNumber,
          50
        )
      ) ||
      (
        body.make !== undefined &&
        !optionalText(body.make, 100)
      ) ||
      (
        body.model !== undefined &&
        !optionalText(body.model, 100)
      ) ||
      (
        body.status !== undefined &&
        !["active", "inactive"].includes(
          body.status
        )
      ) ||
      (
        body.imageUrl !== undefined &&
        !validImageUrl(body.imageUrl)
      ) ||
      (
        body.imageType !== undefined &&
        !validImageType(body.imageType)
      )
    ) {
      return res.status(400).json({
        message:
          "Invalid vehicle update fields",
      });
    }

    try {
      const current =
        await vehicleRepository.getVehicleById(
          req.auth.tenantId,
          vehicleId
        );

      if (!current) {
        return res.status(404).json({
          message: "Vehicle not found",
        });
      }

      const imageUrl =
        body.imageUrl !== undefined
          ? body.imageUrl
          : current.image_url;

      const imageType =
        body.imageType !== undefined
          ? body.imageType
          : current.image_type;

      if (
        !validImageMetadata(
          imageUrl,
          imageType
        )
      ) {
        return res.status(400).json({
          message:
            "Image URL and image type must both be provided or both be null",
        });
      }

      const updated =
        await vehicleRepository.updateVehicle(
          req.auth.tenantId,
          vehicleId,
          {
            name:
              body.name !== undefined
                ? body.name.trim()
                : current.name,

            registrationNumber:
              body.registrationNumber !== undefined
                ? body.registrationNumber?.trim() ||
                  null
                : current.registration_number,

            make:
              body.make !== undefined
                ? body.make?.trim() || null
                : current.make,

            model:
              body.model !== undefined
                ? body.model?.trim() || null
                : current.model,

            status:
              body.status !== undefined
                ? body.status
                : current.status,

            imageUrl,
            imageType,
          }
        );

      return res.json(
        formatVehicle(updated)
      );
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message:
            "Registration number already exists in this tenant",
        });
      }

      console.error(
        "Failed to update vehicle:",
        error.message
      );

      return res.status(500).json({
        message: "Failed to update vehicle",
      });
    }
  }
);

// GET /api/vehicles/:id/position
router.get("/:id/position", async (req, res) => {
  const vehicleId = parsePositiveId(
    req.params.id
  );

  if (!vehicleId) {
    return res.status(400).json({
      message: "Invalid vehicle ID",
    });
  }

  try {
    const vehicle =
      await vehicleRepository.getVehicleById(
        req.auth.tenantId,
        vehicleId
      );

    if (!vehicle) {
      return res.status(404).json({
        message: "Vehicle not found",
      });
    }

    const positions =
      await traccarService.getPositions();

    const position = positions.find(
      (item) =>
        String(item.deviceId) ===
        String(vehicle.traccar_device_id)
    );

    if (!position) {
      return res.status(404).json({
        message:
          "No GPS position available for this vehicle",
      });
    }

    return res.json({
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      traccarDeviceId:
        vehicle.traccar_device_id,
      position,
    });
  } catch (error) {
    console.error(
      "Failed to fetch vehicle position:",
      error.message
    );

    return res.status(500).json({
      message:
        "Failed to fetch vehicle position",
    });
  }
});

module.exports = router;
