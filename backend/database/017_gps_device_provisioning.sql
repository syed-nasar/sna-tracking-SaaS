BEGIN;

ALTER TABLE gps_devices
  ADD COLUMN provisioning_status text NOT NULL DEFAULT 'legacy'
    CHECK (provisioning_status IN ('legacy','pending','processing','retry','provisioned','failed','conflict')),
  ADD COLUMN provider_verified_at timestamptz,
  ADD COLUMN provider_create_uncertain boolean NOT NULL DEFAULT false,
  ADD CHECK (provisioning_status <> 'provisioned' OR
    (traccar_device_id IS NOT NULL AND unique_identifier IS NOT NULL AND provider_verified_at IS NOT NULL));

CREATE TABLE gps_provisioning_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id bigint NOT NULL REFERENCES gps_devices(id) ON DELETE RESTRICT,
  platform_admin_id bigint NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('provision','verify','manual')),
  status text NOT NULL CHECK (status IN ('pending','processing','retry','provisioned','failed','conflict')),
  requested_provider_id bigint CHECK (requested_provider_id > 0),
  provider_device_id bigint CHECK (provider_device_id > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  next_retry_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((status = 'processing') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((status IN ('provisioned','failed','conflict')) = (completed_at IS NOT NULL)),
  CHECK ((mode = 'manual') = (requested_provider_id IS NOT NULL))
);

CREATE UNIQUE INDEX gps_provisioning_one_active_idx ON gps_provisioning_attempts (device_id)
  WHERE status IN ('pending','processing','retry');
CREATE INDEX gps_provisioning_due_idx ON gps_provisioning_attempts (next_retry_at,id)
  WHERE status IN ('pending','retry');
CREATE INDEX gps_provisioning_lease_idx ON gps_provisioning_attempts (lease_until,id)
  WHERE status = 'processing';
CREATE INDEX gps_provisioning_history_idx ON gps_provisioning_attempts (device_id,id DESC);

CREATE TABLE gps_provisioning_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id bigint NOT NULL REFERENCES gps_provisioning_attempts(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX gps_provisioning_events_attempt_idx ON gps_provisioning_events (attempt_id,id);
COMMIT;
