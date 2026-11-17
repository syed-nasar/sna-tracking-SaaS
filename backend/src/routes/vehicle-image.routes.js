
const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const vehicleRepository = require("../repositories/vehicle.repository");

const imageService = require("../services/vehicle-image.service");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: imageService.MAX_IMAGE_SIZE,
    files: 1,
  },
});

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

async function loadVehicle(req, res, next) {
  const vehicleId = parsePositiveId(req.params.id);

  if (!vehicleId) {
    return res.status(400).json({
      message: "Invalid vehicle ID",
    });
  }

  try {
    const vehicle = await vehicleRepository.getVehicleById(
      req.auth.tenantId,
      vehicleId
    );

    if (!vehicle) {
      return res.status(404).json({
        message: "Vehicle not found",
      });
    }

    req.vehicleRecord = vehicle;

    next();
  } catch (error) {
    next(error);
  }
}

router.use(requireAuth, authorize("vehicles:read"));

// GET /api/vehicles/:id/image
router.get(
  "/:id/image",
  loadVehicle,
  async (req, res, next) => {
    try {
      const vehicle = req.vehicleRecord;

      if (!vehicle.image_url) {
        return res.status(404).json({
          message: "Vehicle image not found",
        });
      }

      const imageBuffer = await imageService.readImage(
        vehicle.image_url
      );

      if (!imageBuffer) {
        return res.status(404).json({
          message: "Vehicle image file not found",
        });
      }

      const format = imageService.detectImageFormat(
        imageBuffer
      );

      if (!format) {
        return res.status(500).json({
          message: "Invalid stored vehicle image",
        });
      }

      res.setHeader(
        "Content-Type",
        imageService.IMAGE_FORMATS[format].mimeType
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      return res.send(imageBuffer);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/vehicles/:id/image
router.post(
  "/:id/image",
  authorize("vehicles:write"),
  loadVehicle,
  (req, res, next) => {
    upload.single("image")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: "Image must be 5 MB or smaller",
          });
        }

        return res.status(400).json({
          message: "Invalid image upload",
        });
      }

      if (error) {
        return next(error);
      }

      next();
    });
  },
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Image file is required",
      });
    }

    const imageType = req.body?.imageType;

    if (!["photo", "illustration"].includes(imageType)) {
      return res.status(400).json({
        message:
          "Image type must be photo or illustration",
      });
    }

    const format = imageService.detectImageFormat(
      req.file.buffer
    );

    if (!format) {
      return res.status(400).json({
        message:
          "Only valid JPG, PNG, or WebP images are allowed",
      });
    }

    let savedImage = null;

    try {
      savedImage = await imageService.saveImage(
        req.file.buffer,
        format
      );

      const current = req.vehicleRecord;

      const updated = await vehicleRepository.updateVehicle(
        req.auth.tenantId,
        current.id,
        {
          name: current.name,
          registrationNumber:
            current.registration_number,
          make: current.make,
          model: current.model,
          status: current.status,
          imageUrl: savedImage.imageUrl,
          imageType,
        }
      );

      if (!updated) {
        await imageService.deleteImage(
          savedImage.imageUrl
        );

        return res.status(404).json({
          message: "Vehicle no longer exists",
        });
      }

      // Remove the previous file only after DB update.
      if (
        current.image_url &&
        current.image_url !== savedImage.imageUrl
      ) {
        try {
          await imageService.deleteImage(
            current.image_url
          );
        } catch (cleanupError) {
          console.error(
            "Old vehicle image cleanup failed:",
            cleanupError.message
          );
        }
      }

      return res.json({
        vehicleId: updated.id,
        imageUrl: updated.image_url,
        imageType: updated.image_type,
        message: "Vehicle image uploaded successfully",
      });
    } catch (error) {
      if (savedImage) {
        try {
          await imageService.deleteImage(
            savedImage.imageUrl
          );
        } catch (cleanupError) {
          console.error(
            "Uploaded image cleanup failed:",
            cleanupError.message
          );
        }
      }

      next(error);
    }
  }
);

// DELETE /api/vehicles/:id/image
router.delete(
  "/:id/image",
  authorize("vehicles:write"),
  loadVehicle,
  async (req, res, next) => {
    try {
      const current = req.vehicleRecord;

      if (!current.image_url) {
        return res.status(404).json({
          message: "Vehicle image not found",
        });
      }

      const updated = await vehicleRepository.updateVehicle(
        req.auth.tenantId,
        current.id,
        {
          name: current.name,
          registrationNumber:
            current.registration_number,
          make: current.make,
          model: current.model,
          status: current.status,
          imageUrl: null,
          imageType: null,
        }
      );

      if (!updated) {
        return res.status(404).json({
          message: "Vehicle no longer exists",
        });
      }

      try {
        await imageService.deleteImage(
          current.image_url
        );
      } catch (cleanupError) {
        console.error(
          "Vehicle image cleanup failed:",
          cleanupError.message
        );
      }

      return res.json({
        vehicleId: updated.id,
        imageUrl: null,
        imageType: null,
        message: "Vehicle image removed successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
