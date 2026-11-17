
BEGIN;

CREATE TABLE user_invitations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    tenant_id BIGINT NOT NULL
        REFERENCES tenants(id) ON DELETE CASCADE,

    user_id BIGINT NOT NULL,

    token_hash CHAR(64) NOT NULL UNIQUE,

    expires_at TIMESTAMPTZ NOT NULL,

    used_at TIMESTAMPTZ,

    created_by_platform_admin_id BIGINT
        REFERENCES platform_admins(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_invitation_tenant_user
        FOREIGN KEY (user_id, tenant_id)
        REFERENCES users(id, tenant_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_user_invitations_tenant
ON user_invitations(tenant_id);

CREATE INDEX idx_user_invitations_user
ON user_invitations(user_id);

CREATE INDEX idx_user_invitations_expires
ON user_invitations(expires_at);

COMMIT;
