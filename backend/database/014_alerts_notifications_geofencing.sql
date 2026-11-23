BEGIN;
CREATE TABLE alert_geofences (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id),
 name varchar(100) NOT NULL,
 description varchar(500) NOT NULL DEFAULT '',
 geometry jsonb NOT NULL CHECK (geometry->>'type' IN ('circle','polygon')),
 enabled boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,tenant_id)
);
CREATE INDEX alert_geofences_tenant_idx ON alert_geofences(tenant_id,id);
CREATE TABLE alert_geofence_vehicles (
 tenant_id bigint NOT NULL,
 geofence_id bigint NOT NULL,
 vehicle_id bigint NOT NULL,
 PRIMARY KEY(geofence_id,vehicle_id),
 FOREIGN KEY(geofence_id,tenant_id) REFERENCES alert_geofences(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(vehicle_id,tenant_id) REFERENCES vehicles(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX alert_fence_vehicle_idx ON alert_geofence_vehicles(tenant_id,vehicle_id);
CREATE TABLE alert_geofence_sync (
 geofence_id bigint PRIMARY KEY,
 marker uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 remote_id bigint UNIQUE,
 revision bigint,
 synchronized_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed','removed'))
);
CREATE INDEX alert_fence_sync_due_idx ON alert_geofence_sync(available_at,geofence_id) WHERE status<>'removed';
CREATE TABLE alert_rules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id),
 name varchar(100) NOT NULL,
 description varchar(500) NOT NULL DEFAULT '',
 type text NOT NULL CHECK (type IN ('entry','exit','overspeed','offline','online','ignition_on','ignition_off','low_battery','power_disconnected')),
 severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
 enabled boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 in_app boolean NOT NULL,
 email boolean NOT NULL DEFAULT false,
 cooldown integer NOT NULL CHECK (cooldown BETWEEN 0 AND 86400),
 threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 10080),
 vehicle_id bigint,
 group_id bigint,
 CHECK(num_nonnulls(vehicle_id,group_id)<=1),
 FOREIGN KEY(vehicle_id,tenant_id) REFERENCES vehicles(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(group_id,tenant_id) REFERENCES vehicle_groups(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX alert_rules_tenant_idx ON alert_rules(tenant_id,type) WHERE enabled;
CREATE TABLE alert_preferences (
 user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 in_app boolean NOT NULL DEFAULT true,
 email boolean NOT NULL DEFAULT false
);
CREATE TABLE alert_ingestion (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source text NOT NULL,
 external_id bigint NOT NULL,
 device_id bigint NOT NULL,
 event_time timestamptz NOT NULL,
 data jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0,
 outcome text,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','quarantined','failed')),
 UNIQUE(source,external_id)
);
CREATE INDEX alert_ingestion_pending_idx ON alert_ingestion(available_at,id) WHERE status='pending';
CREATE TABLE alert_worker_health (
 worker text PRIMARY KEY,
 last_success_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE alert_state (
 vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
 state_key text NOT NULL,
 installed_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,
 value boolean NOT NULL,
 PRIMARY KEY(vehicle_id,state_key)
);
CREATE TABLE alert_offline_due (
 vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
 rule_id bigint NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
 installed_at timestamptz NOT NULL,
 outage_at timestamptz NOT NULL,
 due_at timestamptz NOT NULL,
 PRIMARY KEY(vehicle_id,rule_id)
);
CREATE INDEX alert_offline_due_idx ON alert_offline_due(due_at);
CREATE TABLE alert_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id),
 rule_id bigint NOT NULL,
 vehicle_id bigint REFERENCES vehicles(id) ON DELETE SET NULL,
 vehicle_name text NOT NULL,
 type text NOT NULL,
 severity text NOT NULL,
 message text NOT NULL,
 occurred_at timestamptz NOT NULL,
 UNIQUE(id,tenant_id)
);
CREATE INDEX alert_events_history_idx ON alert_events(tenant_id,id DESC);
CREATE INDEX alert_events_cooldown_idx ON alert_events(rule_id,vehicle_id,occurred_at DESC);
CREATE TABLE alert_notifications (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL,
 user_id bigint NOT NULL,
 event_id bigint NOT NULL,
 read_at timestamptz,
 UNIQUE(user_id,event_id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,tenant_id) REFERENCES alert_events(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX alert_notification_history_idx ON alert_notifications(tenant_id,user_id,id DESC);
CREATE INDEX alert_notification_unread_idx ON alert_notifications(tenant_id,user_id) WHERE read_at IS NULL;
CREATE TABLE alert_email_delivery (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL,
 user_id bigint NOT NULL,
 event_id bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled','uncertain')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,event_id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,tenant_id) REFERENCES alert_events(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX alert_email_pending_idx ON alert_email_delivery(available_at,id) WHERE status='pending';
CREATE TABLE alert_config_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id),
 actor_id bigint,
 action text NOT NULL,
 target_id bigint,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
