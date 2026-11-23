BEGIN;

CREATE TABLE vehicle_groups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX vehicle_groups_tenant_name_idx ON vehicle_groups (tenant_id, lower(name));

ALTER TABLE vehicles
    ADD COLUMN group_id BIGINT,
    ADD COLUMN fleet_number VARCHAR(50),
    ADD COLUMN operational_notes VARCHAR(2000),
    ADD CONSTRAINT vehicles_group_fk FOREIGN KEY (group_id, tenant_id)
        REFERENCES vehicle_groups (id, tenant_id) ON DELETE SET NULL (group_id);
CREATE INDEX vehicles_group_idx ON vehicles (tenant_id, group_id) WHERE group_id IS NOT NULL;

CREATE TABLE drivers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    full_name VARCHAR(150) NOT NULL CHECK (btrim(full_name) <> ''),
    phone VARCHAR(30),
    license_number VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (id, tenant_id)
);
CREATE INDEX drivers_tenant_idx ON drivers (tenant_id, id);

CREATE TABLE driver_assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    driver_id BIGINT NOT NULL,
    vehicle_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    FOREIGN KEY (driver_id, tenant_id) REFERENCES drivers(id, tenant_id),
    FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicles(id, tenant_id)
);
CREATE UNIQUE INDEX driver_assignments_current_vehicle_idx
    ON driver_assignments (vehicle_id, tenant_id) WHERE ended_at IS NULL;
CREATE INDEX driver_assignments_driver_history_idx
    ON driver_assignments (tenant_id, driver_id, id DESC);

COMMIT;
