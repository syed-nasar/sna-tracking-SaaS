
const express = require("express");
const { parseId: parsePositiveId, respondError, recordVehicleCreation, setInstallation } = require("../services/gps-inventory.service");
const router = express.Router();

const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const vehicleRepository = require("../repositories/vehicle.repository");
const traccarService = require("../services/traccar.service");

router.use(requireAuth, authorize("vehicles:read"));

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

function positionBelongsToInstallation(position, vehicle) {
  if (!position) return false;
  if (!vehicle.gps_installed_at) return true;
  // Traccar keeps the last fix after a tracker moves to a new vehicle or tenant.
  const installed = new Date(vehicle.gps_installed_at).valueOf();
  return Date.parse(position.serverTime) > installed &&
    Date.parse(position.fixTime ?? position.deviceTime) > installed;
}

function latestPositionsByDevice(positions) {
  const latest = new Map();
  for (const position of positions) {
    const key = String(position.deviceId);
    const received = Date.parse(position.serverTime ?? position.fixTime ?? position.deviceTime);
    const previous = latest.get(key);
    if (!previous || received > previous.received ||
        (Number.isFinite(received) && !Number.isFinite(previous.received))) {
      latest.set(key, { position, received });
    }
  }
  return latest;
}

// GET /api/vehicles
router.get("/", async (req, res) => {
  try {
    const includeOperations = req.auth.customerType === "business";
    const devices = await traccarService.getDevices().catch((error) => {
      console.error("Unable to retrieve GPS device status:", error.code || error.response?.status || "unavailable");
      return [];
    });
    const vehicles = await vehicleRepository.getVehiclesByTenant(req.auth.tenantId, includeOperations);

    const devicesById = new Map(
      devices.map((device) => [
        String(device.id),
        device,
      ])
    );

    const response = vehicles.map((vehicle) => {
      const liveDevice = devicesById.get(
        String(vehicle.traccar_device_id)
      );
      const device = !vehicle.gps_installed_at ||
        Date.parse(liveDevice?.lastUpdate) > new Date(vehicle.gps_installed_at).valueOf()
        ? liveDevice : null;

      return {
        ...formatVehicle(vehicle),
        gpsStatus: device?.status || "unknown",
        lastUpdate: device?.lastUpdate || null,
        ...(includeOperations && {
          groupId: vehicle.group_id,
          groupName: vehicle.group_name,
          driverId: vehicle.driver_id,
          driverName: vehicle.driver_name,
          fleetNumber: vehicle.fleet_number,
          operationalNotes: vehicle.operational_notes,
        }),
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

async function listTenantDevices(req, res, availableOnly = false) {
  res.set("Cache-Control", "private, no-store");
  try {
    const tracked = await traccarService.getDevices().catch(() => []);
    const live = new Map(tracked.map((device) => [String(device.id), device]));
    const result = await pool.query(
      `SELECT d.id, d.traccar_device_id AS "traccarDeviceId",
        d.device_name AS "deviceName", d.unique_identifier AS "uniqueId", d.manufacturer,
        d.model, d.device_type AS "deviceType", d.lifecycle_status AS "lifecycleStatus",
        v.id AS "vehicleId", v.name AS "vehicleName", v.gps_installed_at
       FROM gps_devices d LEFT JOIN vehicles v
         ON (v.traccar_device_id, v.tenant_id) = (d.traccar_device_id, d.tenant_id)
       WHERE d.tenant_id = $1 AND (
         NOT $2::boolean OR (d.lifecycle_status = 'reserved' AND d.traccar_device_id IS NOT NULL AND v.id IS NULL)
       )
       ORDER BY d.id`, [req.auth.tenantId, availableOnly]
    );
    return res.json(result.rows.map(({ gps_installed_at, ...device }) => {
      const info = live.get(device.traccarDeviceId);
      const status = device.vehicleId && (!gps_installed_at ||
        Date.parse(info?.lastUpdate) > new Date(gps_installed_at).valueOf()) ? info : null;
      return {
        ...device, deviceName: device.deviceName || info?.name || null,
        uniqueId: device.uniqueId || info?.uniqueId || null,
        gpsStatus: status?.status || "unknown", lastUpdate: status?.lastUpdate || null,
      };
    }));
  } catch (error) {
    return respondError(res, error);
  }
}

router.get("/available-devices", (req, res) => listTenantDevices(req, res, true));
router.get("/devices", (req, res) => listTenantDevices(req, res));

router.put("/:id/gps-device", authorize("vehicles:write"), async (req, res) => {
  const vehicleId = parsePositiveId(req.params.id);
  const body = req.body;
  if (!vehicleId || !isObject(body) || !Object.hasOwn(body, "traccarDeviceId") ||
      Object.keys(body).some((key) => !["traccarDeviceId", "fromVehicleId", "expectedDeviceId"].includes(key))) {
    return res.status(400).json({ message: "Invalid installation details." });
  }
  const deviceId = body.traccarDeviceId === null ? null : parsePositiveId(body.traccarDeviceId);
  const source = body.fromVehicleId === undefined ? undefined : parsePositiveId(body.fromVehicleId);
  const expected = body.expectedDeviceId == null ? body.expectedDeviceId : parsePositiveId(body.expectedDeviceId);
  if ((body.traccarDeviceId !== null && !deviceId) ||
      (body.fromVehicleId !== undefined && (!source || !deviceId || source === vehicleId)) ||
      (body.expectedDeviceId != null && !expected)) {
    return res.status(400).json({ message: "Invalid installation details." });
  }
  try {
    await setInstallation({
      tenantId: req.auth.tenantId, vehicleId, traccarDeviceId: deviceId,
      fromVehicleId: source, expected, actor: req.auth,
    });
    return res.status(204).end();
  } catch (error) {
    return respondError(res, error);
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

    const deviceId = body.traccarDeviceId == null ? null : parsePositiveId(body.traccarDeviceId);

    if (body.traccarDeviceId != null && !deviceId) {
      return res.status(400).json({
        message: "Invalid Traccar device ID",
      });
    }

    try {
      const create = (client) => vehicleRepository.createVehicle(
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
          },
          client
        );
      const vehicle = deviceId
        ? await recordVehicleCreation(req.auth.tenantId, deviceId, req.auth, create)
        : await create();

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

      return respondError(res, error);
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

router.get("/positions", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const { tenantId } = req.auth;
    const installed = await pool.query(
      "SELECT 1 FROM vehicles WHERE tenant_id = $1 AND traccar_device_id IS NOT NULL LIMIT 1",
      [tenantId]
    );
    if (!installed.rowCount) return res.json([]);
    const positions = await traccarService.getPositions();
    const vehicles = await vehicleRepository.getVehiclesByTenant(tenantId);
    const byDevice = latestPositionsByDevice(positions);
    return res.json(vehicles.flatMap((vehicle) => {
      const position = byDevice.get(String(vehicle.traccar_device_id))?.position;
      return vehicle.traccar_device_id && positionBelongsToInstallation(position, vehicle)
        ? [{ vehicleId: vehicle.id, position }] : [];
    }));
  } catch (error) {
    console.error("Unable to retrieve GPS positions:", error.code || error.response?.status || "unavailable");
    return res.status(502).json({ message: "GPS positions are temporarily unavailable" });
  }
});

// GET /api/vehicles/:id/position
router.get("/:id/position", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
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

    if (!vehicle.traccar_device_id) {
      return res.status(404).json({ message: "No GPS device is installed on this vehicle" });
    }
    const positions = await traccarService.getPositions();
    const current = await vehicleRepository.getVehicleById(req.auth.tenantId, vehicleId);

    const position = current?.traccar_device_id &&
      latestPositionsByDevice(positions).get(String(current.traccar_device_id))?.position;

    if (!positionBelongsToInstallation(position, current)) {
      return res.status(404).json({
        message:
          "No GPS position available for this vehicle",
      });
    }

    return res.json({
      vehicleId: current.id,
      vehicleName: current.name,
      traccarDeviceId:
        current.traccar_device_id,
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
