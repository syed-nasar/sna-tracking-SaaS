# Company invitation email

Back up PostgreSQL using the normal process and apply migration 015 after 014. The migration is additive. Restart the backend after migration and configuration.

```powershell
psql -X -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/015_company_invitation_email.sql
psql -X -d sna_fleet -c "SELECT to_regclass('public.company_invitation_email')"
```

Both mail workers use the existing ALERT_SMTP_HOST and ALERT_SMTP_FROM settings. Optional settings are ALERT_SMTP_PORT, ALERT_SMTP_SECURE, ALERT_SMTP_USER and ALERT_SMTP_PASSWORD. The default is port 587 and mandatory STARTTLS. For implicit TLS set ALERT_SMTP_SECURE=true (default port 465).

Automatic Business invitations also require PUBLIC_FRONTEND_URL, the trusted frontend base URL (HTTPS in production), and INVITATION_EMAIL_KEY, a private 32-byte random value encoded as 64 hex characters. Use a separate key from JWT and telemetry credentials. Keep the key available to all API and worker instances. Drain pending deliveries before replacing it. Plaintext activation tokens appear only in memory, in authorized explicitly enabled manual responses, and in the invitation email. Email links pass the token in a URL fragment that the acceptance page clears from the browser address.

Manual token copy remains enabled by NODE_ENV=development plus ALLOW_DEV_INVITATION_TOKEN=true. To explicitly enable platform-admin-only manual delivery in another environment, set ALLOW_MANUAL_INVITATION_TOKEN=true. Share manual links or tokens privately. A link can be copied when PUBLIC_FRONTEND_URL is valid. The invitation expires in 24 hours and the acceptance endpoint consumes it once.

Retryable deliveries stay queued with exponential backoff for up to five attempts. An ambiguous SMTP outcome needs reconciliation and is not automatically retried. Resend keeps an active queued delivery, or rotates the token for a completed, failed, expired, or manual invitation. Token rotations are serialized and limited to one per tenant per minute while the latest invitation is unexpired. Failed email does not revoke activation. Outbox payloads are encrypted and cleared after completion, cancellation, or expiry. Do not put activation URLs, request bodies, or mail credentials in logs.
