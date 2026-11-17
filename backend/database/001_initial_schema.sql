
BEGIN;

-- 1. Fleet management companies
CREATE TABLE tenants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255),
    phone VARCHAR(30),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users belonging to companies
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id)
        ON DELETE RESTRICT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('tenant_admin', 'manager', 'viewer')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email),
    UNIQUE (id, tenant_id)
);

CREATE INDEX idx_users_tenant_id
ON users(tenant_id);

-- 3. Vehicles mapped to Traccar devices
CREATE TABLE vehicles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id)
        ON DELETE RESTRICT,
    traccar_device_id BIGINT NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    registration_number VARCHAR(50),
    make VARCHAR(100),
    model VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, tenant_id),
    UNIQUE (tenant_id, registration_number)
);

CREATE INDEX idx_vehicles_tenant_id
ON vehicles(tenant_id);

-- 4. Company branding
CREATE TABLE tenant_branding (
    tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id)
        ON DELETE CASCADE,
    display_name VARCHAR(150),
    logo_url TEXT,
    primary_color VARCHAR(7) NOT NULL DEFAULT '#2563EB'
        CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    secondary_color VARCHAR(7) NOT NULL DEFAULT '#111827'
        CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
    custom_domain VARCHAR(255) UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
