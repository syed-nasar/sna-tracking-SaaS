
BEGIN;

CREATE TABLE platform_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform_admin_id BIGINT NOT NULL
        REFERENCES platform_admins(id) ON DELETE RESTRICT,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_logs_admin
ON platform_audit_logs(platform_admin_id, created_at DESC);

CREATE INDEX idx_platform_audit_logs_resource
ON platform_audit_logs(resource_type, resource_id, created_at DESC);

COMMIT;
