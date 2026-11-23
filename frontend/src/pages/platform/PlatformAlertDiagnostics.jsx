import { useEffect, useState } from "react";
import { platformApi } from "../../services/api";

export default function PlatformAlertDiagnostics() {
  const [data,setData]=useState(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=()=>platformApi.get("/platform/alerts",{signal:controller.signal})
      .then(r=>{setData(r.data);setError(false);}).catch(()=>{if(!controller.signal.aborted)setError(true);});
    void refresh();
    const timer=setInterval(refresh,30000);
    return ()=>{clearInterval(timer);controller.abort();};
  },[]);
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">Alert diagnostics</h1>
    {error?<p role="alert">Could not load alert diagnostics.</p>:!data?<p role="status">Loading diagnostics…</p>:
      <section className="rounded-panel border border-line bg-panel p-4">
        <p>{data.workerEnabled?"Telemetry forwarding enabled":"Telemetry forwarding disabled"}</p>
        <p className="text-sm text-muted">{data.lastWorkerSuccess?`Last worker success ${new Date(data.lastWorkerSuccess).toLocaleString()}`:"No successful worker run recorded."}</p>
        {!data.ingestion.length?<p className="text-muted">No telemetry batches recorded.</p>:<dl className="mt-4 space-y-2">
          {data.ingestion.map(row=><div key={row.status} className="flex flex-wrap gap-2"><dt className="capitalize">{row.status}</dt><dd>{row.count} · {new Date(row.latest).toLocaleString()}{row.retrying>0&&` · ${row.retrying} retrying`}</dd></div>)}
        </dl>}
        <h2 className="mt-4 font-semibold">Email delivery</h2>
        <p>{data.smtpEnabled?"SMTP configured":"SMTP disabled"}</p>
        {data.email.map(row=><p key={row.status}>{row.status} · {row.count}</p>)}
        <h2 className="mt-4 font-semibold">Geofence synchronization</h2>
        <p>{data.nativeGeofences?"Traccar synchronization enabled":"Evaluating forwarded positions in SNA"}</p>
        {data.geofenceSync.map(row=><p key={row.status}>{row.status} · {row.count}</p>)}
      </section>}
  </main>;
}
