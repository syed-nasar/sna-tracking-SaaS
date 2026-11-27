# GPS device provisioning (migration 017)

Apply after 016. Back up the database using the normal project procedure. Stop the backend gracefully from its running console with Ctrl+C before the migration. Use PostgreSQL 16 tools and an authorized local database role. The commands prompt for credentials when needed.

```powershell
Set-Location 'G:\Traccar-FleetManagement'
$pg = 'C:\Program Files\PostgreSQL\16\bin'
& "$pg\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d sna_fleet -v ON_ERROR_STOP=1 -f 'backend/database/017_gps_device_provisioning.sql'
if ($LASTEXITCODE -ne 0) { throw 'Migration 017 failed' }
& "$pg\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d sna_fleet -v ON_ERROR_STOP=1 -c "SELECT to_regclass('gps_provisioning_attempts'), to_regclass('gps_provisioning_events'); SELECT provisioning_status, count(*) FROM gps_devices GROUP BY provisioning_status;"
Set-Location '.\backend'
npm.cmd start
```

Substitute the configured database role or port if different. In the frontend console, stop the old Vite process with Ctrl+C and run:

```powershell
Set-Location 'G:\Traccar-FleetManagement\frontend'
npm.cmd run dev
```

Traccar configuration and restart are unnecessary. Existing `TRACCAR_BASE_URL`, `TRACCAR_EMAIL`, and `TRACCAR_PASSWORD` are used. Provisioning requires an administrator account on the configured Traccar instance so absence can be established from a global listing. No new environment variables are required for application startup. The migration is transactional. If application rollback is needed, stop the new backend and retain the additive migration, mappings and provisioning audit history. Older application code does not enforce provisioning readiness. Review pending requests before reopening allocations on older code.

## Flow and status

Registration commits the stock row, registration audit and a pending request together. The worker starts with the backend, runs serially in each process, processes at most four jobs per poll and waits 2.5 seconds between polls. Multiple instances coordinate with PostgreSQL row locks and 90-second fenced leases. Graceful shutdown stops scheduling and waits for current work. An interrupted claim is recoverable after lease expiry. Network requests use the existing ten-second timeout, a response size limit and disabled redirects. Discovery uses a full administrator-visible device list so application case-insensitive matching can detect casing variants. No provider requests run in a database transaction.

| State | Meaning |
|---|---|
| Legacy | Existing stock remains as it was before 017. No queue entry is created and no prior verification is inferred. |
| Pending | Durable action is waiting for a worker. |
| Processing | A worker owns a time-limited claim. |
| Retry | Transient or uncertain result. Delays are 5, 10, 20 and 40 seconds across the five-run budget, subject to worker availability. |
| Provisioned | Provider identity and numeric ID were validated and linked under an authorized, current claim. |
| Failed | Permanent failure or retry budget exhausted. An authorized admin can start a fresh bounded request. |
| Conflict | Identity, ownership, local uniqueness or inventory state requires review. |

After a Traccar create intent is persisted, timeout, duplicate, worker crash or persistence failure triggers discovery before further action. If discovery finds the device it can complete the original link. If an uncertain create stays absent, routine retries and manual retry perform discovery only. Investigate the provider outcome before manually linking an eligible existing record. An explicitly rejected create can be retried after correcting its cause. The service never deletes a device as compensation. Retain provider-side uniqueness and coordinate out-of-band provisioning with SNA.

The installed Traccar 6.17.0 JAR was tested with an in-memory H2 database and loopback HTTP. Exact identifier and numeric filters, numeric detail and global listing returned the expected device. Identifier lookup was case-sensitive. An exact duplicate and an invalid create both returned HTTP 400, while a case variant could be created. Provisioning therefore reruns discovery after HTTP 400 before classifying a permanent validation failure. The SNA worker also created and linked one device and reused and linked another against this isolated Traccar instance. Provider timeouts and database write failure recovery are tested with deterministic fixtures. Different Traccar database backends can have different identifier collation behavior.

## Readiness and compatibility

| Inventory case | Allowed behavior |
|---|---|
| New stock pending, failed or conflicted | Review or recover in Platform GPS Inventory. New allocation, reseller stock assignment and installation are blocked. |
| Provisioned available stock | Direct allocation or assignment to an active reseller is allowed under existing scope rules. |
| Linked legacy stock | Verify its existing numeric mapping before new assignment, allocation, transfer or installation. Verification preserves stored identity and may fill a missing legacy identifier. |
| Reserved legacy unlinked stock | Platform may match an existing device by identifier or submit its numeric ID. Automatic creation for allocated or reseller-owned inventory is blocked. Release is available. |
| Installed legacy or conflicted stock | Existing tracking and installation remain in place. Same-ID verification is allowed. Removal is available. A new installation or move requires readiness. |
| Faulty or retired stock | Normal release, return, lifecycle recovery or retirement rules apply. Provisioning is blocked until stock returns to an eligible state. |

SNA queues manual linking as verification of a specified ID. It rejects a different ID for an already linked record. No provisioning operation changes a vehicle link, installation timestamp, reseller or customer ownership, lifecycle, or SIM association. Readiness is enforced in backend mutation paths. Platform and reseller history keep separate actor and scope boundaries.

Platform-only APIs are under `/api/platform/devices`. `POST /inventory` returns the new pending row with HTTP 201. `POST /inventory/:id/provisioning` accepts `provision`, `verify`, or `retry`. `PATCH /inventory/:id/link` queues manual linking. Both return HTTP 202. `GET /inventory/:id/provisioning` returns sanitized history; `GET /provisioning/diagnostics` returns worker and queue information. Legacy `POST /` accepts the existing numeric ID and `POST /create` accepts name and identifier; both now register and queue work with HTTP 202. Consumers should observe the inventory state before allocation.

## Automated verification

From the repository root, use a fresh disposable PostgreSQL 16 database named `step425_test_...` on a loopback port other than 5432. The integration suite applies the schema, adds legacy fixtures before migration 017, and uses an in-process isolated provider fixture. Set `DB_HOST=127.0.0.1`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` as applicable, then:

```powershell
$env:STEP425_TEST_DB = '1'
node --test backend/test/gps-provisioning.test.js backend/test/gps-provisioning.integration.test.js
```

The Chrome suite uses a separate Vite build with `VITE_API_BASE_URL=/api`, served by a disposable fixture API. Set `STEP42_BROWSER_DIST` to its absolute output directory and optionally `STEP42_CHROME` to the executable, then run `node --test backend/test/step42-navigation.browser.test.js`.

## Manual verification after owner approval

1. **Platform Admin, super_admin, Platform → GPS Device Inventory.** Register disposable stock. Confirm pending and provisioned states, numeric mapping and audit. Repeat with a single existing disposable provider record and confirm reuse. Test outage, recovery and retry with an isolated provider.
2. **Platform Admin, super_admin, Platform → GPS Device Inventory and Resellers.** Verify legacy stock before allocating it. Confirm unready stock cannot be allocated or assigned. Verify an installed disposable device and compare the trusted timestamp and SIM assignment before and after. Use diagnostics and attempt history to investigate a controlled conflict.
3. **Reseller Admin, active organization, Reseller → Inventory.** Confirm only owned stock appears. Allocate ready stock to an active customer in the same organization. Confirm unready stock has an explanation and provisioning controls are absent. Repeat with a second disposable reseller to check scope, then verify suspension blocks its admin operations.
4. **Business Tenant Admin or Manager, Business → Vehicles, Tracking, Alerts and Reports.** Install allocated stock, send authorized disposable telemetry and verify the cutoff. Remove and transfer the tracker using the existing lifecycle, then verify earlier telemetry stays isolated from the new installation.
5. **Personal Tenant Admin, Personal → My Vehicles and Tracking.** Verify allocated ready inventory can be installed and tracked. **Business Viewer, Business → Vehicles** must lack installation access. Both customer types must be unable to call platform provisioning endpoints.
6. **Platform Admin, super_admin, Platform → GPS Device Inventory** and **Reseller Admin, Reseller → Inventory.** Check Light, Dark, System and narrow viewport behavior. Confirm pending polling stops when leaving the detail view or reaching a terminal state.
