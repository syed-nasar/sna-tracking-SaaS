
BEGIN;

-- Create our first development tenant
INSERT INTO tenants (name, slug, email, status)
VALUES (
    'SNA Fleet',
    'sna-fleet',
    'fleet@sna-technologies.com',
    'active'
)
ON CONFLICT (slug) DO NOTHING;

-- Configure default branding
INSERT INTO tenant_branding (
    tenant_id,
    display_name,
    primary_color,
    secondary_color
)
SELECT
    id,
    'SNA Fleet',
    '#2563EB',
    '#111827'
FROM tenants
WHERE slug = 'sna-fleet'
ON CONFLICT (tenant_id) DO NOTHING;

-- Associate our existing Traccar test device
INSERT INTO vehicles (
    tenant_id,
    traccar_device_id,
    name,
    registration_number,
    status
)
SELECT
    id,
    1,
    'SNA Test Vehicle 01',
    'SNA-TEST-001',
    'active'
FROM tenants
WHERE slug = 'sna-fleet'
ON CONFLICT (traccar_device_id) DO NOTHING;

COMMIT;

-- Verify our tenant and vehicle mapping
SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    v.id AS vehicle_id,
    v.name AS vehicle_name,
    v.traccar_device_id
FROM tenants t
JOIN vehicles v ON v.tenant_id = t.id
WHERE t.slug = 'sna-fleet';
