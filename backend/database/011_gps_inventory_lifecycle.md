# GPS inventory migration 011

Apply after migrations 001–010, before starting the Step 37 backend. Use the normal PostgreSQL backup and deployment process, and run the migration with error stopping enabled.

```powershell
psql -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/011_gps_inventory_lifecycle.sql
```

The transaction adds a local inventory ID. Existing Traccar IDs, vehicle associations, and the composite allocation foreign key are preserved. Attached devices start as installed. Allocated, unattached devices start as reserved, with inactive devices kept faulty. Unallocated active devices start as available. The migration records a baseline event with the known association and leaves the original installation date unknown. Plan a maintenance window for the schema changes and baseline backfill.

In **GPS Device Inventory**, open each legacy record and use **Verify Traccar identifier** to store its existing identifier. This is optional for continued tracking and requires a reachable Traccar server. Resolve reported identifier conflicts in the source records before retrying. For new hardware, create an inventory record with its identifier and link the existing Traccar device by ID. Linking verifies the identifier and leaves the Traccar record untouched. The existing explicit platform **create** API remains available for deliberate provisioning. If Traccar reports an uncertain result, check Traccar before retrying and register or link the existing device if present.

Allocation reserves a device for one active tenant. Installation is the only operation that moves it to installed. Remove it before releasing or transferring it across tenants. Within the same tenant, moving it to another vehicle can be done in one operation. Platform administrators can remove a device from a suspended account. A faulty device may retain its reservation while it is repaired. Retiring requires an unallocated device and is terminal.

For new or changed installations, tracking waits for a Traccar position whose server receipt time and fix time are both later than the installation. This prevents a last-known fix from an earlier installation from crossing an allocation boundary. Existing mappings keep their current last-known position behavior until the association changes. Match server clocks and verify a new fix after the first installation.
