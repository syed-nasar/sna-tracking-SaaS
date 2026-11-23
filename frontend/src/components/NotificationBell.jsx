import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

export default function NotificationBell() {
  const {session}=useAuth();
  return session?.id ? <BellSession key={JSON.stringify([session.profile?.tenantId,session.profile?.id,session.profile?.email])} /> : null;
}

function BellSession() {
  const [count,setCount]=useState(null);
  const [recent,setRecent]=useState(null);
  const [error,setError]=useState(false);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const poll=()=>{
      if(document.hidden) return;
      tenantApi.get("/alerts/notifications/unread",{signal:controller.signal})
        .then(r=>setCount(r.data.count)).catch(()=>{});
    };
    poll();
    const timer=setInterval(poll,60000);
    window.addEventListener("alerts:read",poll);
    document.addEventListener("visibilitychange",poll);
    return ()=>{
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("alerts:read",poll);
      document.removeEventListener("visibilitychange",poll);
    };
  },[]);
  useEffect(()=>{
    if(!open) return;
    const controller=new AbortController();
    tenantApi.get("/alerts/notifications",{signal:controller.signal})
      .then(r=>{setRecent(r.data.items.slice(0,5));setError(false);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[open]);
  return <details className="relative" onToggle={e=>setOpen(e.currentTarget.open)}
    onKeyDown={e=>{if(e.key==="Escape"){e.currentTarget.open=false;e.currentTarget.querySelector("summary").focus();}}}>
    <summary className="control list-none px-2 [&::-webkit-details-marker]:hidden" aria-label={count==null?"Notifications":`Notifications, ${count} unread`}>
      <Bell size={17} aria-hidden="true" />{count>0&&<span className="text-xs">{count>99?"99+":count}</span>}
    </summary>
    <div className="absolute end-0 top-full mt-2 w-64 max-w-[75vw] rounded-panel border border-line bg-panel p-3 shadow-panel">
      <Link to="/notifications" className="font-semibold text-accent" onClick={e=>{e.currentTarget.closest("details").open=false;}}>Notification history</Link>
      {error?<p role="alert">Could not load recent notifications.</p>:!recent?<p role="status">Loading…</p>:!recent.length?<p className="text-muted">No notifications yet.</p>:
        <ul className="mt-2 divide-y divide-line">{recent.map(row=><li key={row.id} className="break-words py-2 text-sm">
          <Link to={`/alerts/events/${row.event_id}`} onClick={e=>{e.currentTarget.closest("details").open=false;}}>{row.message}</Link>
          <span className="block text-muted">{row.vehicle_name} · {row.read_at?"Read":"Unread"}</span>
        </li>)}</ul>}
    </div>
  </details>;
}
