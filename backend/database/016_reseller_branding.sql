BEGIN;
CREATE TABLE resellers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 legal_name varchar(150) NOT NULL,
 display_name varchar(100) NOT NULL,
 contact_email varchar(255) NOT NULL,
 contact_phone varchar(30),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 primary_color varchar(7) CHECK(primary_color ~ '^#[0-9a-fA-F]{6}$'),
 accent_color varchar(7) CHECK(accent_color ~ '^#[0-9a-fA-F]{6}$'),
 support_email varchar(255),
 support_phone varchar(30),
 support_website varchar(500),
 welcome varchar(500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE reseller_admins (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reseller_id bigint NOT NULL REFERENCES resellers(id),
 full_name varchar(150) NOT NULL,
 email varchar(255) NOT NULL,
 password_hash text,
 enabled boolean NOT NULL DEFAULT true,
 token_version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(reseller_id,email),
 UNIQUE(id,reseller_id)
);
ALTER TABLE tenants ADD COLUMN reseller_id bigint REFERENCES resellers(id);
CREATE INDEX tenants_reseller_idx ON tenants(reseller_id,id) WHERE reseller_id IS NOT NULL;
ALTER TABLE gps_devices ADD COLUMN reseller_id bigint REFERENCES resellers(id);
CREATE INDEX gps_devices_reseller_idx ON gps_devices(reseller_id,id) WHERE reseller_id IS NOT NULL;
CREATE FUNCTION check_reseller_device_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id IS NOT NULL AND NEW.reseller_id IS DISTINCT FROM
   (SELECT t.reseller_id FROM tenants t WHERE t.id=NEW.tenant_id) THEN
   RAISE EXCEPTION 'Device and customer reseller scopes must match' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER gps_reseller_scope BEFORE INSERT OR UPDATE OF reseller_id,tenant_id ON gps_devices
 FOR EACH ROW EXECUTE FUNCTION check_reseller_device_scope();
ALTER TABLE gps_device_events ADD COLUMN reseller_admin_id bigint REFERENCES reseller_admins(id);
ALTER TABLE gps_device_events DROP CONSTRAINT gps_device_events_check;
ALTER TABLE gps_device_events ADD CONSTRAINT gps_device_events_actor_check CHECK (
 (action='baseline' AND num_nonnulls(platform_admin_id,tenant_user_id,reseller_admin_id)=0)
 OR (action<>'baseline' AND num_nonnulls(platform_admin_id,tenant_user_id,reseller_admin_id)=1)
);
ALTER TABLE user_invitations ADD COLUMN created_by_reseller_admin_id bigint REFERENCES reseller_admins(id);
CREATE TABLE reseller_invitations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reseller_id bigint NOT NULL,
 admin_id bigint NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by bigint NOT NULL REFERENCES platform_admins(id),
 FOREIGN KEY(admin_id,reseller_id) REFERENCES reseller_admins(id,reseller_id)
);
CREATE INDEX reseller_invitations_admin_idx ON reseller_invitations(admin_id,id DESC);
CREATE TABLE reseller_invitation_email (
 invitation_id bigint PRIMARY KEY REFERENCES reseller_invitations(id),
 status text NOT NULL CHECK(status IN ('pending','sending','sent','failed','uncertain','cancelled')),
 payload text,
 attempts int NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((payload IS NOT NULL) = (status IN ('pending','sending')))
);
CREATE INDEX reseller_mail_due_idx ON reseller_invitation_email(available_at) WHERE status='pending';
CREATE TABLE reseller_brand_assets (
 reseller_id bigint NOT NULL REFERENCES resellers(id),
 kind text NOT NULL CHECK(kind IN ('logo','dark-logo','favicon')),
 png bytea NOT NULL CHECK(octet_length(png)<=1048576),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(reseller_id,kind)
);
CREATE TABLE reseller_domains (
 hostname varchar(253) PRIMARY KEY,
 reseller_id bigint NOT NULL UNIQUE REFERENCES resellers(id),
 challenge char(64) NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','disabled')),
 verified_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE reseller_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reseller_id bigint NOT NULL REFERENCES resellers(id),
 platform_admin_id bigint REFERENCES platform_admins(id),
 reseller_admin_id bigint,
 action varchar(80) NOT NULL,
 target_id bigint,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(reseller_admin_id,reseller_id) REFERENCES reseller_admins(id,reseller_id),
 CHECK(num_nonnulls(platform_admin_id,reseller_admin_id)=1)
);
CREATE INDEX reseller_audit_scope_idx ON reseller_audit(reseller_id,id DESC);
COMMIT;
