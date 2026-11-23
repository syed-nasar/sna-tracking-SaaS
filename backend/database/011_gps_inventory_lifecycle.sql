BEGIN;

-- Keep the existing Traccar key and vehicle foreign key intact. An inventory
-- ID lets hardware be recorded before it is registered in Traccar.
ALTER TABLE gps_devices
    ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY,
    ADD COLUMN unique_identifier VARCHAR(100),
    ADD COLUMN device_name VARCHAR(150),
    ADD COLUMN manufacturer VARCHAR(100),
    ADD COLUMN model VARCHAR(100),
    ADD COLUMN serial_number VARCHAR(100),
    ADD COLUMN device_type VARCHAR(100),
    ADD COLUMN purchase_date DATE,
    ADD COLUMN purchase_reference VARCHAR(150),
    ADD COLUMN inventory_notes VARCHAR(2000),
    ADD COLUMN lifecycle_status VARCHAR(20);

ALTER TABLE gps_devices
    DROP CONSTRAINT gps_devices_pkey,
    ADD PRIMARY KEY (id),
    ADD UNIQUE (traccar_device_id),
    ALTER COLUMN traccar_device_id DROP NOT NULL;

-- Existing attached devices must continue tracking, including any registry
-- rows marked inactive by the earlier model.
UPDATE gps_devices d
SET lifecycle_status = CASE
    WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.traccar_device_id = d.traccar_device_id) THEN 'installed'
    WHEN d.status = 'inactive' THEN 'faulty'
    WHEN d.tenant_id IS NOT NULL THEN 'reserved'
    ELSE 'available'
END;

UPDATE gps_devices SET status = CASE
    WHEN lifecycle_status IN ('reserved', 'installed') THEN 'assigned'
    WHEN lifecycle_status IN ('faulty', 'retired') THEN 'inactive'
    ELSE 'available'
END
WHERE status IS DISTINCT FROM CASE
    WHEN lifecycle_status IN ('reserved', 'installed') THEN 'assigned'
    WHEN lifecycle_status IN ('faulty', 'retired') THEN 'inactive'
    ELSE 'available'
END;

ALTER TABLE gps_devices
    ALTER COLUMN lifecycle_status SET NOT NULL,
    ALTER COLUMN lifecycle_status SET DEFAULT 'available',
    ADD CONSTRAINT gps_devices_lifecycle_check CHECK (
        (lifecycle_status = 'available' AND status = 'available' AND tenant_id IS NULL)
        OR (lifecycle_status IN ('reserved', 'installed') AND status = 'assigned' AND tenant_id IS NOT NULL)
        OR (lifecycle_status = 'faulty' AND status = 'inactive')
        OR (lifecycle_status = 'retired' AND status = 'inactive' AND tenant_id IS NULL)
    ),
    ADD CONSTRAINT gps_devices_installed_traccar_check
        CHECK (lifecycle_status <> 'installed' OR traccar_device_id IS NOT NULL),
    ADD CONSTRAINT gps_devices_identifier_check
        CHECK (unique_identifier IS NOT NULL AND btrim(unique_identifier) <> '' OR
               unique_identifier IS NULL AND traccar_device_id IS NOT NULL);

CREATE UNIQUE INDEX gps_devices_unique_identifier_idx ON gps_devices (lower(btrim(unique_identifier)));
CREATE UNIQUE INDEX gps_devices_serial_number_idx ON gps_devices (lower(btrim(serial_number)))
    WHERE serial_number IS NOT NULL;
CREATE INDEX gps_devices_lifecycle_idx ON gps_devices (lifecycle_status, id);

-- A detached vehicle retains its record, images, groups and driver history.
-- Historic mappings have no known installation timestamp; do not invent one.
ALTER TABLE vehicles
    ALTER COLUMN traccar_device_id DROP NOT NULL,
    ADD COLUMN gps_installed_at TIMESTAMPTZ,
    ADD CONSTRAINT vehicles_gps_installation_timestamp_check
        CHECK (traccar_device_id IS NOT NULL OR gps_installed_at IS NULL);

CREATE TABLE gps_device_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES gps_devices(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN (
        'baseline', 'registered', 'linked', 'edited', 'allocated', 'released',
        'transferred', 'installed', 'removed', 'replaced', 'reassigned', 'lifecycle_changed'
    )),
    platform_admin_id BIGINT REFERENCES platform_admins(id) ON DELETE RESTRICT,
    tenant_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((action = 'baseline' AND num_nonnulls(platform_admin_id, tenant_user_id) = 0)
        OR (action <> 'baseline' AND num_nonnulls(platform_admin_id, tenant_user_id) = 1))
);
CREATE INDEX gps_device_events_history_idx ON gps_device_events (device_id, id DESC);

INSERT INTO gps_device_events (device_id, action, details)
SELECT d.id, 'baseline', jsonb_build_object(
    'tenantId', d.tenant_id::text, 'vehicleId', v.id::text,
    'traccarDeviceId', d.traccar_device_id::text, 'lifecycle', d.lifecycle_status
)
FROM gps_devices d LEFT JOIN vehicles v ON v.traccar_device_id = d.traccar_device_id;

COMMIT;
