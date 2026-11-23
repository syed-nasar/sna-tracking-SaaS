BEGIN;

CREATE TABLE mobile_operators (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    country_code CHAR(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    mcc CHAR(3) CHECK (mcc ~ '^[0-9]{3}$'),
    mnc VARCHAR(3) CHECK (mnc ~ '^[0-9]{2,3}$'),
    support_contact VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mobile_operators_name_idx ON mobile_operators (country_code, lower(name));

CREATE TABLE connectivity_plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id BIGINT NOT NULL REFERENCES mobile_operators(id),
    name VARCHAR(150) NOT NULL,
    scope VARCHAR(150),
    allowance_mb INTEGER CHECK (allowance_mb >= 0),
    validity_days INTEGER NOT NULL CHECK (validity_days BETWEEN 1 AND 3660),
    billing_cycle VARCHAR(12) NOT NULL CHECK (billing_cycle IN ('prepaid','monthly','quarterly','annual')),
    recurring_cost NUMERIC(12,2) CHECK (recurring_cost >= 0),
    customer_price NUMERIC(12,2) CHECK (customer_price >= 0),
    activation_fee NUMERIC(12,2) CHECK (activation_fee >= 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    customer_visible BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connectivity_plans_name_idx ON connectivity_plans (operator_id, lower(name));

CREATE TABLE sim_cards (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id BIGINT REFERENCES mobile_operators(id),
    label VARCHAR(150) NOT NULL,
    iccid VARCHAR(22) UNIQUE CHECK (iccid ~ '^[0-9]{18,22}$'),
    imsi VARCHAR(15) CHECK (imsi ~ '^[0-9]{5,15}$'),
    msisdn VARCHAR(16) CHECK (msisdn ~ '^\+?[0-9]{5,15}$'),
    form_factor VARCHAR(10) CHECK (form_factor IN ('physical','esim')),
    lifecycle VARCHAR(12) NOT NULL DEFAULT 'available'
        CHECK (lifecycle IN ('available','reserved','active','suspended','faulty','retired')),
    purchased_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    supplier_reference VARCHAR(150),
    purchase_cost NUMERIC(12,2) CHECK (purchase_cost >= 0),
    currency CHAR(3) CHECK (currency ~ '^[A-Z]{3}$'),
    CHECK (purchase_cost IS NULL OR currency IS NOT NULL),
    notes VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sim_cards_operator_idx ON sim_cards (operator_id);
CREATE INDEX sim_cards_lifecycle_idx ON sim_cards (lifecycle, id);

CREATE TABLE sim_device_assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sim_id BIGINT NOT NULL REFERENCES sim_cards(id),
    device_id BIGINT NOT NULL REFERENCES gps_devices(id),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    started_by BIGINT NOT NULL REFERENCES platform_admins(id),
    ended_by BIGINT REFERENCES platform_admins(id),
    start_reason VARCHAR(500) NOT NULL,
    end_reason VARCHAR(500),
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK (num_nonnulls(ended_at, ended_by, end_reason) IN (0,3))
);
CREATE UNIQUE INDEX sim_assignments_current_sim_idx ON sim_device_assignments (sim_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX sim_assignments_current_device_idx ON sim_device_assignments (device_id) WHERE ended_at IS NULL;
CREATE INDEX sim_assignments_history_idx ON sim_device_assignments (sim_id, id DESC);
CREATE INDEX sim_assignments_device_history_idx ON sim_device_assignments (device_id, id DESC);

CREATE TABLE sim_plan_periods (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sim_id BIGINT NOT NULL REFERENCES sim_cards(id),
    plan_id BIGINT NOT NULL REFERENCES connectivity_plans(id),
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('plan','renewal')),
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > starts_at),
    superseded_at TIMESTAMPTZ CHECK (superseded_at > starts_at AND superseded_at < expires_at),
    terms JSONB NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
    request_key VARCHAR(80) NOT NULL,
    expected_period_id BIGINT REFERENCES sim_plan_periods(id),
    provider_reference VARCHAR(150),
    notes VARCHAR(1000),
    recorded_by BIGINT NOT NULL REFERENCES platform_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sim_id, starts_at),
    UNIQUE (sim_id, request_key),
    EXCLUDE USING gist (
        int8range(sim_id, sim_id, '[]') WITH &&,
        tstzrange(starts_at, COALESCE(superseded_at, expires_at), '[)') WITH &&
    )
);
CREATE UNIQUE INDEX sim_plan_period_provider_idx ON sim_plan_periods (sim_id, lower(provider_reference))
    WHERE provider_reference IS NOT NULL;
CREATE INDEX sim_plan_period_plan_idx ON sim_plan_periods (plan_id);

CREATE TABLE sim_audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sim_id BIGINT NOT NULL REFERENCES sim_cards(id),
    platform_admin_id BIGINT NOT NULL REFERENCES platform_admins(id),
    action VARCHAR(30) NOT NULL CHECK (action IN (
        'created','updated','lifecycle_changed','assigned','unassigned','replaced','moved','plan_changed','renewed'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sim_audit_history_idx ON sim_audit_events (sim_id, id DESC);

CREATE TABLE sim_connectivity_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    warning_days INTEGER NOT NULL DEFAULT 7 CHECK (warning_days BETWEEN 1 AND 365)
);
INSERT INTO sim_connectivity_settings DEFAULT VALUES;

COMMIT;
