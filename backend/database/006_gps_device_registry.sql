BEGIN;

-- Central Traccar device inventory. A NULL tenant_id means unallocated.
CREATE TABLE gps_devices (
    traccar_device_id BIGINT PRIMARY KEY
        CHECK (traccar_device_id > 0),
    tenant_id BIGINT REFERENCES tenants(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'assigned', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT gps_devices_allocation_status_check CHECK (
        (tenant_id IS NULL AND status IN ('available', 'inactive'))
        OR
        (tenant_id IS NOT NULL AND status IN ('assigned', 'inactive'))
    ),
    CONSTRAINT gps_devices_id_tenant_unique UNIQUE (traccar_device_id, tenant_id)
);

CREATE INDEX idx_gps_devices_tenant_id ON gps_devices(tenant_id);

-- Backfill devices already linked to existing vehicles.
INSERT INTO gps_devices (traccar_device_id, tenant_id, status)
SELECT traccar_device_id, tenant_id, 'assigned'
FROM vehicles;

-- Enforce that each vehicle's tracker is allocated to the same tenant.
-- PostgreSQL's composite FK also prevents reassignment while a vehicle uses it.
ALTER TABLE vehicles
ADD CONSTRAINT vehicles_gps_device_allocation_fkey
FOREIGN KEY (traccar_device_id, tenant_id)
REFERENCES gps_devices (traccar_device_id, tenant_id)
ON UPDATE RESTRICT
ON DELETE RESTRICT;

COMMIT;
