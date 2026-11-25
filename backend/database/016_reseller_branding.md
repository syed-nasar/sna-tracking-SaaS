# Step 42 reseller operations and white-label branding

## Migration

Back up PostgreSQL, apply migration 016 after 015, then restart the backend and deploy the frontend. Migration 016 is additive to customer and device records. Existing records have a null reseller ID and remain direct SNA customers.

```powershell
psql -X -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/016_reseller_branding.sql
psql -X -d sna_fleet -c "SELECT to_regclass('public.resellers'),to_regclass('public.reseller_domains')"
```

Keep the migration and application deployments coordinated. Roll back application code with the new relations retained. Once reseller customers or allocations exist, older application versions have no reseller management UI, and inventory scope constraints remain in force.

## Ownership and authentication

The hierarchy is SNA Platform, direct customers or reseller organizations, and reseller Personal and Business customers. A reseller organization is separate from a tenant. Platform Admins create organizations and manage administrators, inventory, and domain revocation. Reseller Admins use a separate JWT audience and a workspace under /reseller. They manage their own organization, customers, and eligible stock. Tenant authentication and roles are unchanged. Reseller access does not confer tenant sessions, telemetry, history, reports, or alert access.

The backend assigns a new customer's reseller association from the authenticated reseller. Existing customers remain direct. There is no transfer or impersonation operation. Reseller suspension invalidates all reseller sessions and blocks further reseller administrative operations. Customer logins, alert ingestion, tracker links and installations continue. Customer-level suspension is separate and uses the existing tenant status.

Platform staff assign available unallocated stock to a reseller. Resellers can allocate only this stock to active customers they own. Device and tenant reseller IDs must agree at database level. Device changes use the existing inventory lifecycle and locks. Resellers cannot register, relink, release an installed device, or install it themselves. The customer uses the existing authorized installation flow. History exposed to resellers includes only scoped customer allocation and installation events and omits GPS coordinates.

## Brand and delivery

The presentation resolver uses the authenticated tenant or reseller first, then an explicit /r/:brandSlug public route, then a verified domain lookup from the browser hostname. All other entry points use the default brand, including platform pages, direct customers, and unknown public contexts. Forwarded Host headers do not determine scope or generate URLs. Branded login validates the customer's reseller. A suspended reseller retains its public slug and verified hostname branding so existing customers can sign in. Reseller administrator authentication and invitation eligibility remain separately enforced. Direct Personal customers use the generic login and reseller Personal customers use their branded login. Business customers can also use the generic login with their company slug.

Brand settings are validated text, HTTPS support URLs and hexadecimal colors. Branding adjusts accent tokens while preserving functional status colors. PNG logos and favicons are size- and dimension-bounded, decoded and re-encoded before public serving. Replacement overwrites the relevant asset slot without accepting user file paths. SVG and remote assets are unsupported.

Reseller invitations use separate hashed, expiring, one-time credentials, with encrypted queued delivery and the existing SMTP transport and manual-token configuration from migration 015. Both reseller Personal and Business customer invitations can use that shared delivery channel. The configured PUBLIC_FRONTEND_URL is the only activation origin. Reseller admin links use /r/:slug/activate-admin and customer links use /r/:slug/accept-invitation. Branded mail uses an escaped HTML version with an inline PNG when available, plus plain text. The configured SMTP sender remains the sender. Keep ALERT_SMTP_*, INVITATION_EMAIL_KEY and manual-token configuration as described in the migration 015 runbook. No additional required environment variables are introduced.

Authorized exports resolve the brand from the report tenant. PDF can include a validated logo. PDF and XLSX use contrast-safe brand colors. CSV retains its existing structure with the brand in the existing title cell. Dataset permissions, install cutoffs, pagination, and formula protection continue to apply.

## Domain verification

Create a pending public hostname claim. Publish the challenge shown in the UI as a TXT record at _sna-fleet-verification.<hostname>, then request verification. The backend checks DNS with a bounded resolver and confirms the challenge is unchanged before recording success. Pending and revoked domains cannot resolve a brand. Platform revocation cannot be reversed through reseller APIs; platform staff may replace or remove the revoked claim. Approved domains are public presentation lookups only. Production routing, proxy configuration and TLS are deferred to Step 46.

## APIs

| Prefix | Paths |
|---|---|
| /api/platform/resellers | GET/POST /, GET/PATCH /:id, POST /:id/admins, PATCH /:id/admins/:adminId, POST /:id/admins/:adminId/invitation, GET /:id/inventory, PUT /:id/inventory/:deviceId, PATCH /:id/domain/revoke |
| /api/reseller | POST /auth/login and /auth/accept, GET /auth/me, GET /dashboard, GET/POST /customers, GET /customers/:id, PATCH /customers/:id/status, GET /customers/:tenantId/invitations/status, POST /customers/:tenantId/invitations/reissue, GET /inventory, GET /inventory/:id/history, POST /inventory/:id/allocation |
| Both management prefixes | PUT /branding, PUT/DELETE /branding/assets/:kind, PUT/DELETE /domain, POST /domain/verify; platform paths include /:id |
| Public and customer presentation | GET /api/brands/:slug, GET /api/brands/host/:hostname, GET /api/brands/:slug/assets/:kind, authenticated GET /api/tenant-brand |

## Local verification

Authenticated logout and session invalidation return direct customers and Platform Admins to `/login`. Reseller Personal customers, Business customers, and reseller administrators return to `/r/:slug/login`. The destination is relative, so it remains on the verified custom domain when applicable. Reseller administrators land in reseller sign-in mode. Company sign-in is preselected for a Business customer.

Login and profile restoration return the authenticated account's reseller association independently of public branding. The session record carries a non-sensitive login hint for expiration or restore failures. Clearing a session removes the entire record and the API bearer, and replaces the protected history entry. Missing or malformed hints use `/login`. A direct visit to a protected platform or reseller route without a session still opens that workspace's dedicated sign-in page. A mounted reseller workspace rechecks its session on focus, visibility, and a 30-second visible interval. API requests remain independently authorized throughout.

For the HTTP matrix, prepare an empty disposable PostgreSQL database with the migrations through 016 on a loopback port other than 5432. The test requires a database name starting with `step42_auth_test` and writes only synthetic fixtures. From `backend`, set that database's `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` as applicable, then run:

```powershell
$env:STEP42_INTEGRATION='1'
node --test test/step42-auth.integration.test.js
```

For the browser matrix, build the frontend with `VITE_API_BASE_URL=/api`. Set `STEP42_BROWSER_DIST` to the build directory and optionally `STEP42_CHROME` to the Chrome executable. From `backend`, run `node --test test/step42-navigation.browser.test.js`. It uses an isolated browser profile and loopback fixture APIs. The mocked hostname verifies same-origin navigation. Production DNS routing and TLS remain Step 46 work.

Use a disposable database and a test mail transport. In Platform → Resellers create an organization, invite its administrator, and assign available stock. Activate the reseller administrator privately and sign in at /reseller/login. Configure branding and onboard a Personal and a Business customer. Allocate stock and use the existing customer installation action. Verify customer brand and history at /r/:slug/login, and exercise Light/Dark/System and protected refresh. Verify a second reseller cannot read or mutate those resources. Suspend the reseller and confirm that its administrator loses access while the customer remains signed in. Test domains against a controlled DNS fixture, since live DNS ownership and production routing require environment-specific setup.
