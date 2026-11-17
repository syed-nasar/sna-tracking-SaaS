
-- Migration 007: Vehicle Image Support
-- SNA Fleet Management
--
-- Adds optional image metadata to vehicles.
-- Existing vehicles remain unchanged.
-- No image files are stored in PostgreSQL.

BEGIN;

ALTER TABLE vehicles
ADD COLUMN image_url TEXT;

ALTER TABLE vehicles
ADD COLUMN image_type VARCHAR(20);

ALTER TABLE vehicles
ADD CONSTRAINT vehicles_image_type_check
CHECK (
    image_type IS NULL
    OR image_type IN ('photo', 'illustration')
);

ALTER TABLE vehicles
ADD CONSTRAINT vehicles_image_metadata_check
CHECK (
    (image_url IS NULL AND image_type IS NULL)
    OR
    (
        image_url IS NOT NULL
        AND LENGTH(TRIM(image_url)) > 0
        AND image_type IS NOT NULL
    )
);

COMMIT;
