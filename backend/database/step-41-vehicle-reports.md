# Step 41 vehicle reports

No PostgreSQL migration or new environment variables are required. The server uses the existing Traccar connection and stores no copies of report routes. The customer UI is at /reports.

## Sources and access

Traccar 6.17 supplies intervals via GET /api/reports/trips and /api/reports/stops and raw points via GET /api/reports/route. See the [versioned Traccar API](https://github.com/traccar/traccar/blob/v6.17.0/openapi.yaml) and [report implementation](https://github.com/traccar/traccar/blob/v6.17.0/src/main/java/org/traccar/reports/common/ReportUtils.java). SNA authorizes the selected vehicle IDs using the signed-in tenant user and the existing vehicles:read permission. It bypasses upstream spreadsheet and cumulative summary endpoints because their data has not been checked against SNA's transfer boundaries.

Reports are available for the current installed interval only, with an installed inventory device allocated to the same tenant and a trusted SNA installation timestamp. An old vehicle loses report access when its tracker is uninstalled. A receiving vehicle can access only fixes and server receipts strictly after its own installation. Legacy mappings without trusted timestamps have no report history. SNA rechecks the installation and user scope after upstream requests and again before an export is sent. No report data is cached. Closed ownership intervals cannot be reconstructed with sufficient timestamp precision from the current lifecycle audit, so historical reads for those intervals are intentionally unavailable.

Intervals must fit fully inside the authorized window and have verifiable boundary positions. Trips use Traccar's start and end position IDs. Stops use the start position ID and matching end fix time. Rows with invalid observations or overlapping accepted intervals are excluded. The initial unknown state and sparse samples can reduce coverage. Start/end locations are coordinates from verified positions. A stop is a Traccar stop. Idle and ignition-off display observed short intervals with explicit matching ignition values, with low reported speeds also required for idle. Unknown telemetry is unavailable.

GPS distance is calculated from adjacent valid positions with gaps of five minutes or less. Larger gaps are omitted from distance and split the route polyline. Average trip speed is unavailable when gaps exist. Maximum speed is the highest available recorded sample speed. Mileage and trend rows group trips by the trip's start date in the selected timezone. Whole trips are counted once, while trips crossing the report boundary are excluded instead of prorated. Fleet totals sum vehicle time and are distinct from elapsed wall time. A vehicle is active in this report when it has a verified trip or stop.

## API and limits

All endpoints are under /api/reports and require tenant authentication.

| Path | Response |
|---|---|
| GET /vehicles?q= | Up to 100 matching vehicles and historical availability |
| GET /trips | Paginated verified trips and period overview |
| GET /trips/:id | A single scoped trip and sampled route (one vehicle required) |
| GET /stops | Paginated stops |
| GET /mileage | Daily distance per vehicle and fleet-wide period totals |
| GET /activity | Period activity per vehicle |
| GET /exports/:type/:format | CSV, XLSX, or PDF for the entire filtered report |

Filters use ISO 8601 instants with offsets, from inclusive and to exclusive. Timezone is an IANA zone (UTC default). Browser presets use local calendar days and compute the next midnight, including DST changes. Pass repeated vehicleId parameters, page (default 1), limit (default 25, maximum 100), and sort (newest, oldest, distance, duration, vehicle). Detail lookups use the original list date range and one vehicle.

Select up to 10 vehicles and 31 calendar days per request. Upstream requests use a 10-second per-request timeout, a 35-second dataset deadline, bounded concurrency, and a 16 MiB per-response ceiling. SNA supports up to 40,000 raw points per vehicle, 10,000 combined intervals, and 1,000 displayed route points. CSV/XLSX exports allow up to 5,000 rows. PDF allows up to 500. Results are retrieved from Traccar for each request, including page navigation and downloads.

## Local verification

Run the focused tests with `node --test backend/test/vehicle-reports.test.js` from the repository root. These tests do not connect to PostgreSQL or Traccar.

Use a disposable tenant and tracker installed through the SNA lifecycle. After a verified trip and stop in Traccar, open Reports & Analytics, select the vehicle and dates, and apply. Verify both interval types, open the trip map, compare mileage and activity totals, and download each export. Test a second tenant or a legacy installation to verify access boundaries. Confirm the previous installation is unavailable after a transfer. GPS gaps, unavailable ignition data, and dates with no complete trips are expected to affect report coverage.
