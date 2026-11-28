# Platform operations and migration 018

Migration 018 adds an optional JSON object to `reseller_audit` for the reason and before/after status of a reseller customer lifecycle action. Existing audit rows remain intact. The platform action uses the existing `platform_audit_logs.details`; a reseller actor cannot use that table's required platform-admin foreign key. The central audit API intentionally excludes free-form reasons and raw JSON payloads.

After owner approval, back up PostgreSQL using the project procedure. Stop the backend, then apply migration 018 from the repository root using an authorized database role. Restart the backend and refresh or rebuild the frontend for the new routes.

```powershell
Set-Location 'G:\Traccar-FleetManagement'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d sna_fleet -v ON_ERROR_STOP=1 -f 'backend/database/018_reseller_audit_lifecycle_details.sql'
if ($LASTEXITCODE -ne 0) { throw 'Migration 018 failed' }
Set-Location '.\backend'
npm.cmd start
```

The schema change is transactional. An application rollback can leave the additive column in place and retain reasons. Dropping it would discard new audit data and requires separate permission. An older app would also restore its older customer session behavior. No new environment variables or Traccar restart are required.

## API

All routes in this table require an active Platform `super_admin`, except the existing scoped reseller lifecycle equivalent.

| Request | Response and filters |
|---|---|
| GET /api/platform/tenants | Existing `data` and `pagination` envelope, with `pagination.total` and `hasMore`. Filters `q`, `type`, `status`, `ownership`, `resellerId`, `limit`, and `offset`. Filters apply before ascending tenant-ID pagination. |
| GET /api/platform/tenants/:id | Profile, ownership, vehicle and GPS counts, latest subscription status, up to 25 administrator summaries, and 12 recent administrative actions. |
| PATCH /api/platform/tenants/:id/status | `{status, version, reason}`, returning the updated status and opaque record version. Use the version from detail. Blank reasons and unsupported transitions are rejected. A stale request or duplicate returns 409. |
| PATCH /api/reseller/customers/:id/status | Same contract within the authenticated reseller scope. The transaction changes status, increments tenant user token versions, and records the actor and reason. Both suspension and reactivation revoke existing versions. |
| GET /api/platform/ops/summary | Platform-wide counts and generation time. Vehicle activity counts the `active` vehicle lifecycle. Linked vehicles missing current installed inventory or a trusted timestamp are counted separately. Provisioning counts refer to current device state. Oldest work is derived from active attempts. Reseller-assigned and customer-allocated GPS counts can overlap. |
| GET /api/platform/ops/provisioning | Current devices with their latest attempt. Filters `status`, `resellerId`, `q`, `stale=yes`, `limit`, and `offset`. Defaults to all unprovisioned states. |
| GET /api/platform/ops/invitations | Latest customer and reseller admin invitations with open or failed delivery, excluding accepted invitations. Filters `kind`, `status`, `limit`, and `offset`. Pending with prior attempts is displayed as retry. |
| GET /api/platform/ops/signals | Independent SIM, billing, and alert summaries with availability status. Existing expiry and due-billing rules are used. |
| GET /api/platform/ops/health | Bounded read probes with timestamps and elapsed time. No recovery actions. |
| GET /api/platform/ops/audit | `data` and `nextCursor`. Filter by UTC `from` and `to` dates (inclusive), `domain`, `action`, `actorType`, `resource`, `resourceId`, `tenantId`, `resellerId` and `limit`. The cursor orders by full timestamp, source, then source ID. |

Generic tenant edits preserve existing contact editing and reject customer-type conversion and status changes. Reseller organization suspension is separate from customer lifecycle actions.

## Diagnostics semantics

- **Healthy** means a probe succeeded or applicable worker progress is recorded without a current degradation signal. HTTP liveness and authenticated provider readiness are distinct checks.
- **Degraded** means an available subsystem reported a partial failure or an explicit work signal such as an expired lease, retry, failed batch, or a pending alert backlog older than two minutes with stale or missing progress.
- **Unavailable** means an authorized probe failed or exceeded its deadline. Each diagnostic group is independent after platform authorization. With a completely unavailable PostgreSQL service, existing database-backed platform authorization fails before diagnostics can run.
- **Disabled** means a feature configuration is off. **Not configured** means required connection or delivery configuration is unavailable. **Unknown** means there is insufficient evidence, including workers with no recorded work.
- Worker poll state is local to the serving backend process. Queue counts are durable. Invitation and alert email status represent recorded delivery evidence. An idle queue or absent recent GPS fixes do not alone prove failure. No test emails are sent by diagnostics.

Audit shows source-qualified IDs, initiating actor, known worker executor, and allowlisted status metadata. It does not export event payloads, contact snapshots, payment details, credentials, or telemetry. Unknown attribution remains unknown.

## Disposable checks

Run the HTTP/database suite only with a fresh database named `step43_test_...` on a non-5432 loopback PostgreSQL port. Set the corresponding test process database connection values and `STEP43_TEST_DB=1`, then run `node --test backend/test/platform-operations.integration.test.js`. The test applies the schema itself. Run browser fixtures using the existing `STEP42_BROWSER_DIST` procedure with a disposable build using API base `/api`.
