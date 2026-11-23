# SIM and connectivity migration 012

Apply after 011 and before starting the Step 38 backend. Take the normal PostgreSQL backup and run the migration with error stopping enabled.

```powershell
psql -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/012_sim_connectivity_management.sql
```

The migration creates connectivity tables, indexes, and a default seven-day warning threshold in one transaction. It adds foreign keys to GPS inventory and platform administrators. Existing GPS inventory, tenant allocations, vehicle installations, and Traccar data are unchanged. A failed migration rolls back. If application rollback is needed after a successful migration, redeploy the previous application and leave the additive tables in place. Preserve these tables and their history in backups before any separately approved schema removal.

## Setup and lifecycle

In Platform Dashboard, open **Manage SIMs and plans**. Create operators and plans before setting up SIM plan periods. No carrier catalog is seeded. ICCID formatting removes spaces and hyphens. Known ICCIDs are unique, and unknown identifiers can be left blank. Inventory screens show the last four digits of sensitive identifiers and accept replacement values without revealing the stored originals.

| Current lifecycle | Permitted next states |
|---|---|
| Available | Reserved, active, faulty, retired |
| Reserved | Available, active, suspended, faulty, retired |
| Active | Reserved, suspended, faulty, retired |
| Suspended | Reserved, active, faulty, retired |
| Faulty | Available, reserved, active, retired |
| Retired | Terminal |

Returning to available or retiring requires an unassigned SIM. Available and reserved SIMs can receive new assignments. An active SIM can move from its current assignment. Suspended and faulty SIMs can retain their assignments. A replacement, move, or removal records the reason and requires the current destination assignment, so stale controls cannot silently displace a SIM. The target GPS device must be available, reserved, or installed. For an allocated target, its tenant must be active. SIM operations leave GPS and vehicle assignments intact.

## Dates and renewal

Operational dates start at midnight UTC and are stored as `timestamptz`. Expiry is exclusive. A period expiring today is expired from midnight UTC. Expiring soon means 1–N calendar days remaining, using the configured warning threshold.

Plans use MB as the canonical allowance unit. Each recorded period snapshots the plan terms and prices. Plan changes can supersede the preceding period from a later UTC start date. An already recorded start date is immutable. A renewal starts at the latest scheduled period's expiry, or today if that period has expired. Use a stable request key for retries. Each write also provides the latest known period ID; concurrent requests with a stale ID are rejected. An optional provider reference is unique per SIM, ignoring case.

Platform dashboard counts are in-app summaries. Carrier registration, balances, live data usage, email/SMS delivery, and billing are outside this migration. Customer access follows the current GPS allocation and exposes masked connectivity details without purchase or supplier fields. A plan name appears only when its recorded period and current plan both allow customer visibility.
