BEGIN;
CREATE TABLE company_invitation_email (
 invitation_id bigint PRIMARY KEY REFERENCES user_invitations(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('pending','sending','sent','failed','uncertain','cancelled')),
 payload text,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((payload IS NOT NULL) = (status IN ('pending','sending')))
);
CREATE INDEX company_invitation_email_due_idx ON company_invitation_email(available_at,invitation_id)
 WHERE status = 'pending';
CREATE INDEX company_invitation_email_sending_idx ON company_invitation_email(updated_at)
 WHERE status = 'sending';
CREATE INDEX company_invitation_latest_idx ON user_invitations(tenant_id,user_id,id DESC);
COMMIT;
