
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const IMAGE_DIRECTORY = path.resolve(
  __dirname,
  "../../storage/vehicle-images"
);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_FORMATS = {
  jpeg: {
    extension: "jpg",
    mimeType: "image/jpeg",
  },
  png: {
    extension: "png",
    mimeType: "image/png",
  },
  webp: {
    extension: "webp",
    mimeType: "image/webp",
  },
};

function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
      ])
    )
  ) {
    return "png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

function getImageFilename(imageUrl) {
  if (typeof imageUrl !== "string") {
    return null;
  }

  const match = imageUrl.match(
    /^\/vehicle-images\/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$/
  );

  return match ? match[1] : null;
}

function getImagePath(imageUrl) {
  const filename = getImageFilename(imageUrl);

  if (!filename) {
    return null;
  }

  return path.join(IMAGE_DIRECTORY, filename);
}

async function saveImage(buffer, format) {
  const imageFormat = IMAGE_FORMATS[format];

  if (!imageFormat) {
    throw new Error("Unsupported image format");
  }

  await fs.mkdir(IMAGE_DIRECTORY, {
    recursive: true,
  });

  const filename = `${crypto.randomUUID()}.${imageFormat.extension}`;
  const filePath = path.join(
    IMAGE_DIRECTORY,
    filename
  );

  await fs.writeFile(filePath, buffer, {
    flag: "wx",
  });

  return {
    imageUrl: `/vehicle-images/${filename}`,
    mimeType: imageFormat.mimeType,
  };
}

async function readImage(imageUrl) {
  const filePath = getImagePath(imageUrl);

  if (!filePath) {
    return null;
  }

  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function deleteImage(imageUrl) {
  const filePath = getImagePath(imageUrl);

  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

module.exports = {
  MAX_IMAGE_SIZE,
  IMAGE_FORMATS,
  detectImageFormat,
  saveImage,
  readImage,
  deleteImage,
};
