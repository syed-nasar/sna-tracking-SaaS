BEGIN;

CREATE TABLE billing_plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(1000),
    audience VARCHAR(12) NOT NULL CHECK (audience IN ('personal','business','both')),
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_plan_versions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES billing_plans(id),
    effective_on DATE NOT NULL,
    interval_months INTEGER NOT NULL CHECK (interval_months BETWEEN 1 AND 60),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    base_price NUMERIC(24,4) NOT NULL CHECK (base_price >= 0),
    excess_price NUMERIC(24,4) NOT NULL CHECK (excess_price >= 0),
    included_devices INTEGER NOT NULL CHECK (included_devices >= 0),
    device_limit INTEGER CHECK (device_limit >= included_devices),
    user_limit INTEGER CHECK (user_limit > 0),
    features JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(features) = 'array'),
    trial_days INTEGER NOT NULL CHECK (trial_days BETWEEN 0 AND 365),
    grace_days INTEGER NOT NULL CHECK (grace_days BETWEEN 0 AND 365),
    payment_days INTEGER NOT NULL CHECK (payment_days BETWEEN 0 AND 365),
    published_by BIGINT NOT NULL REFERENCES platform_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, effective_on)
);

CREATE TABLE billing_subscriptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN
        ('draft','trialing','active','past_due','suspended','cancelled','expired')),
    starts_on DATE NOT NULL,
    next_bill_on DATE NOT NULL CHECK (next_bill_on >= starts_on),
    anchor_on DATE NOT NULL CHECK (anchor_on >= starts_on),
    renewal_mode VARCHAR(10) NOT NULL CHECK (renewal_mode IN ('manual','automatic')),
    trial_ends_on DATE,
    ends_on DATE,
    notice_days INTEGER NOT NULL DEFAULT 7 CHECK (notice_days BETWEEN 0 AND 365),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX billing_subscriptions_current_idx ON billing_subscriptions (tenant_id)
    WHERE status IN ('trialing','active','past_due','suspended');
CREATE INDEX billing_subscriptions_due_idx ON billing_subscriptions (next_bill_on, id);
CREATE INDEX billing_subscriptions_tenant_idx ON billing_subscriptions (tenant_id, id DESC);

CREATE TABLE billing_subscription_terms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subscription_id BIGINT NOT NULL REFERENCES billing_subscriptions(id),
    plan_version_id BIGINT NOT NULL REFERENCES billing_plan_versions(id),
    effective_on DATE NOT NULL,
    base_override NUMERIC(24,4) CHECK (base_override >= 0),
    excess_override NUMERIC(24,4) CHECK (excess_override >= 0),
    override_reason VARCHAR(500),
    approved_by BIGINT NOT NULL REFERENCES platform_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((base_override IS NULL AND excess_override IS NULL) OR
           (override_reason IS NOT NULL AND btrim(override_reason) <> ''))
);
CREATE INDEX billing_terms_effective_idx ON billing_subscription_terms (subscription_id, effective_on DESC, id DESC);

CREATE SEQUENCE billing_invoice_number_seq;
CREATE TABLE billing_invoices (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    subscription_id BIGINT,
    period_start DATE,
    period_end DATE,
    corrects_invoice_id BIGINT,
    request_key VARCHAR(80),
    generation_terms JSONB,
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    invoice_number VARCHAR(40) UNIQUE,
    issued_on DATE,
    due_on DATE,
    voided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by BIGINT NOT NULL REFERENCES platform_admins(id),
    UNIQUE (id, tenant_id),
    UNIQUE (id, currency),
    UNIQUE (subscription_id, period_start),
    UNIQUE (tenant_id, request_key),
    EXCLUDE USING gist (
        int8range(tenant_id, tenant_id, '[]') WITH &&,
        daterange(period_start, period_end, '[)') WITH &&
    ) WHERE (subscription_id IS NOT NULL AND voided_at IS NULL),
    FOREIGN KEY (subscription_id, tenant_id) REFERENCES billing_subscriptions(id, tenant_id),
    FOREIGN KEY (corrects_invoice_id, tenant_id) REFERENCES billing_invoices(id, tenant_id),
    CHECK ((subscription_id IS NULL AND num_nonnulls(period_start,period_end,generation_terms)=0 AND request_key IS NOT NULL)
        OR (subscription_id IS NOT NULL AND num_nonnulls(period_start,period_end,generation_terms)=3
            AND period_end > period_start AND corrects_invoice_id IS NULL)),
    CHECK (num_nonnulls(invoice_number,issued_on,due_on) IN (0,3) AND (due_on IS NULL OR due_on >= issued_on))
);
CREATE INDEX billing_invoices_tenant_idx ON billing_invoices (tenant_id, id DESC);
CREATE INDEX billing_invoices_issue_idx ON billing_invoices (issued_on, currency) WHERE voided_at IS NULL;
CREATE UNIQUE INDEX billing_invoice_correction_idx ON billing_invoices (corrects_invoice_id)
    WHERE corrects_invoice_id IS NOT NULL AND voided_at IS NULL;

CREATE TABLE billing_invoice_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES billing_invoices(id),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('saas_base','saas_excess','hardware_sale','hardware_rental','connectivity','discount','tax','adjustment')),
    description VARCHAR(250) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    unit_price NUMERIC(24,4) NOT NULL CHECK (unit_price >= 0),
    amount NUMERIC(32,4) GENERATED ALWAYS AS
        (CASE WHEN kind='discount' THEN -1 ELSE 1 END * quantity::numeric * unit_price) STORED
);
CREATE INDEX billing_invoice_lines_invoice_idx ON billing_invoice_lines (invoice_id, id);

CREATE TABLE billing_device_snapshots (
    invoice_id BIGINT NOT NULL REFERENCES billing_invoices(id),
    device_id BIGINT NOT NULL REFERENCES gps_devices(id),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL CHECK (ends_on > starts_on),
    released_at TIMESTAMPTZ,
    PRIMARY KEY (invoice_id, device_id),
    EXCLUDE USING gist (
       int8range(device_id, device_id, '[]') WITH &&,
       daterange(starts_on, ends_on, '[)') WITH &&
    ) WHERE (released_at IS NULL)
);

CREATE TABLE billing_payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    amount NUMERIC(24,4) NOT NULL CHECK (amount > 0),
    paid_on DATE NOT NULL,
    method VARCHAR(20) NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','other')),
    external_reference VARCHAR(120),
    notes VARCHAR(500),
    request_key VARCHAR(80) NOT NULL,
    recorded_by BIGINT NOT NULL REFERENCES platform_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES billing_invoices(id, tenant_id),
    FOREIGN KEY (invoice_id, currency) REFERENCES billing_invoices(id, currency),
    UNIQUE (invoice_id, request_key)
);
CREATE INDEX billing_payments_date_idx ON billing_payments (paid_on, currency);
CREATE UNIQUE INDEX billing_payment_reference_idx ON billing_payments (tenant_id, lower(external_reference))
    WHERE external_reference IS NOT NULL;

CREATE TABLE billing_payment_reversals (
    payment_id BIGINT PRIMARY KEY REFERENCES billing_payments(id),
    reason VARCHAR(500) NOT NULL,
    recorded_by BIGINT NOT NULL REFERENCES platform_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_enterprise_licenses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id),
    reference VARCHAR(100) NOT NULL UNIQUE,
    deployment VARCHAR(15) NOT NULL CHECK (deployment IN ('hosted','self_hosted')),
    device_limit INTEGER CHECK (device_limit > 0),
    user_limit INTEGER CHECK (user_limit > 0),
    starts_on DATE NOT NULL,
    ends_on DATE CHECK (ends_on >= starts_on),
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    notes VARCHAR(500)
);
CREATE INDEX billing_license_tenant_idx ON billing_enterprise_licenses (tenant_id, id);

CREATE TABLE billing_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    platform_admin_id BIGINT NOT NULL REFERENCES platform_admins(id),
    tenant_id BIGINT REFERENCES tenants(id),
    resource VARCHAR(20) NOT NULL,
    resource_id BIGINT NOT NULL,
    action VARCHAR(40) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_resource_idx ON billing_events (resource, resource_id, id DESC);
CREATE INDEX billing_events_tenant_idx ON billing_events (tenant_id, id DESC);

CREATE VIEW billing_invoice_balances AS
SELECT i.*, amounts.total, payments.collected, amounts.total-payments.collected AS balance,
    CASE WHEN i.voided_at IS NOT NULL THEN 'void'
         WHEN i.issued_on IS NULL THEN 'draft'
         WHEN payments.collected = amounts.total THEN 'paid'
         WHEN i.due_on < (now() AT TIME ZONE 'UTC')::date THEN 'overdue'
         WHEN payments.collected > 0 THEN 'partially_paid'
         ELSE 'issued' END AS status
FROM billing_invoices i
CROSS JOIN LATERAL (SELECT COALESCE(sum(l.amount),0) AS total FROM billing_invoice_lines l WHERE l.invoice_id=i.id) amounts
CROSS JOIN LATERAL (
    SELECT COALESCE(sum(p.amount),0) AS collected FROM billing_payments p
    WHERE p.invoice_id=i.id AND NOT EXISTS (SELECT 1 FROM billing_payment_reversals r WHERE r.payment_id=p.id)
) payments;

CREATE FUNCTION billing_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Billing history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER billing_versions_immutable BEFORE UPDATE OR DELETE ON billing_plan_versions
    FOR EACH ROW EXECUTE FUNCTION billing_reject_mutation();
CREATE TRIGGER billing_terms_immutable BEFORE UPDATE OR DELETE ON billing_subscription_terms
    FOR EACH ROW EXECUTE FUNCTION billing_reject_mutation();
CREATE TRIGGER billing_payments_immutable BEFORE UPDATE OR DELETE ON billing_payments
    FOR EACH ROW EXECUTE FUNCTION billing_reject_mutation();
CREATE TRIGGER billing_reversals_immutable BEFORE UPDATE OR DELETE ON billing_payment_reversals
    FOR EACH ROW EXECUTE FUNCTION billing_reject_mutation();
CREATE TRIGGER billing_events_immutable BEFORE UPDATE OR DELETE ON billing_events
    FOR EACH ROW EXECUTE FUNCTION billing_reject_mutation();

CREATE FUNCTION billing_guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.voided_at IS NOT NULL OR
       (OLD.issued_on IS NOT NULL AND
         (NEW.voided_at IS NULL OR (to_jsonb(NEW) - 'voided_at') IS DISTINCT FROM (to_jsonb(OLD) - 'voided_at'))) THEN
        RAISE EXCEPTION 'Issued invoice history is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.voided_at IS NOT NULL AND
        EXISTS (SELECT 1 FROM billing_invoice_balances WHERE id=OLD.id AND collected>0) THEN
        RAISE EXCEPTION 'Reverse payments before voiding' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_invoice_history BEFORE UPDATE OR DELETE ON billing_invoices
    FOR EACH ROW EXECUTE FUNCTION billing_guard_invoice();

CREATE FUNCTION billing_guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    frozen BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
        RAISE EXCEPTION 'Invoice lines cannot be moved' USING ERRCODE = '23514';
    END IF;
    SELECT issued_on IS NOT NULL OR voided_at IS NOT NULL INTO frozen FROM billing_invoices
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END FOR UPDATE;
    IF frozen THEN
        RAISE EXCEPTION 'Invoice lines are immutable after issue or void' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_invoice_line_history BEFORE INSERT OR UPDATE OR DELETE ON billing_invoice_lines
    FOR EACH ROW EXECUTE FUNCTION billing_guard_line();

CREATE FUNCTION billing_guard_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    invoice billing_invoices%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Device snapshots are immutable' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO invoice FROM billing_invoices WHERE id=NEW.invoice_id FOR UPDATE;
    IF (TG_OP = 'INSERT' AND (invoice.voided_at IS NOT NULL OR invoice.issued_on IS NOT NULL
        OR invoice.period_start IS DISTINCT FROM NEW.starts_on OR invoice.period_end IS DISTINCT FROM NEW.ends_on
        OR NEW.released_at IS NOT NULL))
        OR (TG_OP = 'UPDATE' AND (invoice.voided_at IS NULL OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
            OR (to_jsonb(NEW)-'released_at') IS DISTINCT FROM (to_jsonb(OLD)-'released_at'))) THEN
        RAISE EXCEPTION 'Invalid billing device snapshot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_snapshot_history BEFORE INSERT OR UPDATE OR DELETE ON billing_device_snapshots
    FOR EACH ROW EXECUTE FUNCTION billing_guard_snapshot();

CREATE FUNCTION billing_guard_payment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    invoice billing_invoices%ROWTYPE;
    remaining NUMERIC;
BEGIN
    SELECT * INTO invoice FROM billing_invoices WHERE id=NEW.invoice_id FOR UPDATE;
    SELECT balance INTO remaining FROM billing_invoice_balances WHERE id=NEW.invoice_id;
    IF invoice.issued_on IS NULL OR invoice.voided_at IS NOT NULL OR
       NEW.paid_on < invoice.issued_on OR NEW.paid_on > (now() AT TIME ZONE 'UTC')::date OR NEW.amount > remaining THEN
        RAISE EXCEPTION 'Payment requires an issued invoice with sufficient balance' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_payment_balance BEFORE INSERT ON billing_payments
    FOR EACH ROW EXECUTE FUNCTION billing_guard_payment_insert();

CREATE FUNCTION billing_lock_reversal_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM i.id FROM billing_invoices i JOIN billing_payments p ON p.invoice_id=i.id
      WHERE p.id=NEW.payment_id FOR UPDATE OF i;
    RETURN NEW;
END;
$$;
CREATE TRIGGER billing_reversal_invoice_lock BEFORE INSERT ON billing_payment_reversals
    FOR EACH ROW EXECUTE FUNCTION billing_lock_reversal_invoice();

COMMIT;
