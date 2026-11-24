# Step 40 alerts, notifications and geofencing

Apply after migration 013, before enabling telemetry forwarding. Back up via the established PostgreSQL backup process.

```powershell
psql -X -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/014_alerts_notifications_geofencing.sql
psql -X -d sna_fleet -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'alert_%' ORDER BY 1"
```

The migration is additive and transactional. On incident, disable forwarding and restart SNA with the previous application release. Preserve all alert tables for recovery.

## Traccar setup

Set a random secret of at least 32 characters in SNA's `ALERT_FORWARD_TOKEN`. Configure the same Bearer secret on Traccar's position and event forwarding headers. Use an internal network or TLS, and restrict the forwarding path at the reverse proxy to the Traccar host. Never put the secret in a URL. Verify supported keys and payloads against the installed server version.

- Position forwarding uses JSON, `forward.url`, `forward.header`, and bounded `forward.retry.*` settings. Point it at `/api/telemetry/traccar`.
- Event forwarding uses JSON, `event.forward.url`, and `event.forward.header` at the same URL. Ignition and power alarms require the position embedded in the event envelope, including position ID, server receipt, and fix time. Connectivity needs the device's last communication timestamp to be safely after installation.
- Geofences are owned by SNA. By default the worker evaluates boundaries from valid forwarded fixes and leaves Traccar geofence objects untouched.
- For Traccar 6.17 and compatible versions, set `ALERT_NATIVE_GEOFENCES=true` to use native geofence events. The worker uses the existing server-side Traccar credentials for geofence and device-link APIs. Verify their permissions on a disposable Traccar instance first. SNA assigns opaque names, reconciles managed objects and links, and retries failures. Tenant screens show synchronization status. Admin diagnostics show aggregate pending and failed state. The worker rejects events from unrelated geofences and stale revisions. Native enter/exit events require a matching embedded valid position.
- Synchronization is eventual and revisits installed-device links periodically. SNA still checks current installation and tenant assignment at event time, even while Traccar is catching up. Leave SNA users off the underlying Traccar console. To turn off native mode after provisioning, first disable or remove the SNA geofences and verify the worker has removed their managed native objects. Then switch off native mode and re-enable or recreate the SNA geofences for local evaluation.
- A 202 means the normalized input is committed to the queue, including replay duplicates. IDs are scoped by record kind and assume a single durable Traccar database. Coordinate data is stripped after successful handling or quarantine. Timestamps in PostgreSQL use timestamptz, with UTC API serialization and date filters.
- Traccar 6.17 can forward a position before assigning its stored position ID. SNA uses a deterministic negative queue ID for a valid position envelope with ID zero. For those rows, correlate by device and receipt time. A retry with a later positive ID can create a second queue row, and the worker suppresses repeated fixes before evaluating alerts.

A worker claims batches under a transaction-level lock, serializes state and alerts, and retries failures with bounded backoff. Unknown installations and samples predating either the current install receipt or fix boundary are quarantined, including delayed events from prior installations. Legacy associations without a trusted install timestamp continue existing live tracking and are ineligible for alerts until a verified installation is recorded through the existing lifecycle. There is no automatic recovery of unforwarded server events. Replay verified Traccar envelopes using original IDs and timestamps. An operator can reset a reviewed failed queue row to pending after resolving the cause. Never manually reassign quarantined data.

Configure optional email using ALERT_SMTP_HOST, ALERT_SMTP_PORT, ALERT_SMTP_FROM, ALERT_SMTP_SECURE, and optional ALERT_SMTP_USER and ALERT_SMTP_PASSWORD. TLS is required. Email requires both rule enablement and user opt-in. Ambiguous delivery outcomes require provider reconciliation before retry. No location coordinates are emailed.

## Retention

Keep configuration audit and tenant history under the organization's retention rules. Pending payloads are bounded per request but require monitoring of queue age and failed items. After applying your retention policy, remove old processed ingestion rows and obsolete fence state in bounded maintenance batches. Keep deduplication rows through the maximum approved replay window, and do not replay older inputs once their deduplication records have been removed. Do not delete audit rows during routine queue maintenance.
