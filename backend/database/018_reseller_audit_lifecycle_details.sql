BEGIN;
-- Existing events remain unchanged. New reseller customer lifecycle actions retain their reason.
ALTER TABLE reseller_audit ADD COLUMN lifecycle_details jsonb
  CHECK (lifecycle_details IS NULL OR jsonb_typeof(lifecycle_details) = 'object');
COMMIT;
