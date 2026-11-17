
BEGIN;

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20);

UPDATE tenants
SET customer_type = 'business'
WHERE customer_type IS NULL;

ALTER TABLE tenants
ALTER COLUMN customer_type SET DEFAULT 'business';

ALTER TABLE tenants
ALTER COLUMN customer_type SET NOT NULL;

ALTER TABLE tenants
DROP CONSTRAINT IF EXISTS tenants_customer_type_check;

ALTER TABLE tenants
ADD CONSTRAINT tenants_customer_type_check
CHECK (customer_type IN ('personal', 'business'));

COMMIT;
