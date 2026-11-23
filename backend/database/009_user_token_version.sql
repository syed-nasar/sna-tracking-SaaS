
BEGIN;

-- Step 35.3.1
-- Add a token version to tenant users.
--
-- Every newly issued tenant JWT will contain this
-- version. Authentication middleware will compare
-- the JWT version against the database value.
--
-- Incrementing token_version invalidates all
-- previously issued tenant JWTs for that user.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS token_version
INTEGER NOT NULL DEFAULT 0;

-- Prevent negative token versions.
ALTER TABLE users
ADD CONSTRAINT chk_users_token_version_nonnegative
CHECK (token_version >= 0);

COMMIT;
