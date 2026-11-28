import { PageHeader } from "../../components/WorkspaceUi";
import { ReadState } from "./PlatformOperationsUi";
import { date,label,panel,usePlatformRead } from "./platform-operations-data";

const titles={api:"Backend API",postgres:"PostgreSQL",traccar:"Traccar",gps:"GPS provisioning worker",
  alerts:"Telemetry, alerts and notifications",customerEmail:"Customer invitation email",resellerEmail:"Reseller administrator email"};
const counts = data => Object.entries(data??{}).map(([key,value])=>`${label(key)}: ${value}`).join(", ") || "No recorded statuses";

export default function PlatformHealth() {
  const result=usePlatformRead("/platform/ops/health");
  return <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <PageHeader title="System Health"><button className="control" disabled={result.loading} onClick={result.refresh}>Refresh probes</button></PageHeader>
    <ReadState result={result}>{data=><div className="grid gap-4 md:grid-cols-2">
      {Object.entries(titles).map(([key,title])=>{
        const value=data[key];
        return <section key={key} className={panel}>
          <h2 className="font-semibold">{title}</h2>
          <p className="capitalize">{label(value.status)}</p>
          <p className="text-sm text-muted">Checked {date(value.checkedAt)}{value.durationMs!=null?` (${value.durationMs} ms)`:""}</p>
          {key==="api"&&<p>Uptime {value.uptimeSeconds} seconds</p>}
          {value.reachable!==undefined&&<p>HTTP reachability {value.reachable?"confirmed":"unconfirmed"}.
            Authenticated API readiness {value.authenticated?"confirmed":"unconfirmed"}.</p>}
          {value.processLocal&&<div className="space-y-1 text-sm">
            <p>Process local worker {value.processLocal.running?"running":"unconfirmed"}</p>
            <p>Started {date(value.processLocal.startedAt)}</p><p>Last poll {date(value.processLocal.lastPollAt)}</p>
            <p>Last error {date(value.processLocal.lastErrorAt)}</p><p>Oldest work {date(value.oldest_work_at)}</p>
            <p>Outstanding provisioning attempts {value.outstanding}</p>
            <p>Expired claims {value.expired_claims}</p>
            <p>Current devices by provisioning state: {counts(value.device_counts)}</p>
            <p>All recorded attempts by status: {counts(value.counts)}</p>
            <p>Currently provisioned devices with previously failed attempts: {value.recovered_devices}</p>
          </div>}
          {value.forwardingConfigured!==undefined&&<div className="space-y-1 text-sm">
            <p>Forwarding configuration {value.forwardingConfigured?"present":"disabled"}</p>
            <p>Last observed receipt {date(value.last_receipt)}</p><p>Last successful processing {date(value.last_success)}</p>
            <p>{value.pending} pending, {value.retrying} retrying, {value.failed} failed</p>
            <p>Oldest pending receipt {date(value.oldest_pending)}</p>
            <p>Geofence sync {value.nativeGeofences?counts(value.geofences):"disabled; SNA evaluates positions"}</p>
            <p>In-app notifications recorded {value.notifications_recorded}</p>
            <p>Alert email {value.alertEmailConfigured?counts(value.alert_email):"disabled or unconfigured"}</p>
          </div>}
          {Array.isArray(value.counts)&&<ul className="text-sm">{value.counts.map(row=><li key={row.status}>
            {label(row.status)} {row.total} · oldest update {date(row.oldest)} · latest update {date(row.latest)}</li>)}</ul>}
        </section>;
      })}
    </div>}</ReadState>
  </main>;
}
