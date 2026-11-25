import { useRef, useState } from "react";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ThemeSelector from "./ThemeSelector";
import BrandMark from "./BrandMark";
import { useBrand } from "../context/brand";
import NotificationBell from "./NotificationBell";

function Navigation({ groups, collapsed = false, onNavigate }) {
  return <nav aria-label="Workspace navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
    {groups.filter((group) => group.items.length).map(({ name, items }) => (
      <div key={name} className="space-y-1">
        {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">{name}</p>}
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined} onClick={onNavigate}
            className={`workspace-nav-link relative flex min-h-10 items-center gap-2.5 rounded-lg text-sm font-medium text-secondary hover:bg-hover ${collapsed ? "justify-center px-2" : "px-3"}`}>
            <Icon size={18} aria-hidden="true" className="shrink-0" />
            {!collapsed && <span className="min-w-0 break-words">{label}</span>}
          </NavLink>
        ))}
      </div>
    ))}
  </nav>;
}

export default function AppShell({ children, title, workspace, groups, platform = false, reseller = false }) {
  const { session, logout } = useAuth();
  const identityBrand=useBrand();
  const drawer = useRef(null);
  const openDrawer = useRef(null);
  const accountMenu = useRef(null);
  const profile = session?.profile;
  const collapseKey = platform ? "sna-fleet.platform-sidebar" : "sna-fleet.tenant-sidebar";
  const [collapsed, setCollapsed] = useState(() => {
    try { return sessionStorage.getItem(collapseKey) === "collapsed"; } catch { return false; }
  });
  const home = platform ? "/platform/dashboard" : reseller ? "/reseller/dashboard" : "/dashboard";

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { sessionStorage.setItem(collapseKey, next ? "collapsed" : "expanded"); } catch {
      // Keep the current shell preference in memory.
    }
  }

  function signOut() {
    logout();
  }

  const identity = profile?.fullName || profile?.full_name || (platform ? "Platform administrator" : "Account");
  const initials = identity.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const role = platform ? "Platform administrator" : reseller ? "Reseller administrator" : profile?.role?.replaceAll("_", " ");
  const brand = (compact) => (
    <Link to={home} onClick={() => { if (drawer.current?.open) drawer.current.close(); }}
      className={`flex min-w-0 items-center gap-3 ${compact ? "justify-center" : ""}`} aria-label={`${identityBrand?.display_name||"SNA Fleet"} home`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-action"><BrandMark brand={identityBrand} size={18} /></span>
      {!compact && <span className="min-w-0">
        <span className="block truncate text-sm font-bold tracking-tight">{identityBrand?.display_name||"SNA Fleet"}</span>
        <span className="block truncate text-xs text-muted">{workspace}</span>
      </span>}
    </Link>
  );

  return <div data-collapsed={collapsed} className="workspace-shell min-h-screen bg-canvas text-ink">
    <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-panel focus:p-3">Skip to content</a>
    <aside className="workspace-sidebar fixed inset-y-0 start-0 z-40 hidden flex-col border-r border-line bg-nav lg:flex">
      <div className="flex h-16 shrink-0 items-center px-4">{brand(collapsed)}</div>
      <Navigation groups={groups} collapsed={collapsed} />
      <div className="border-t border-line p-2.5">
        <button type="button" className="control w-full" aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>
          {collapsed ? <PanelLeftOpen size={17} /> : <><PanelLeftClose size={17} /> Collapse</>}
        </button>
      </div>
    </aside>
    <dialog ref={drawer} aria-label="Workspace navigation"
      onClose={() => openDrawer.current?.focus()}
      className="fixed inset-y-0 start-0 m-0 h-dvh max-h-none w-[min(85vw,17rem)] max-w-none border-r border-line bg-nav text-ink open:flex open:flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        {brand(false)}
        <button type="button" autoFocus aria-label="Close navigation" className="control" onClick={() => drawer.current.close()}><X size={17} /></button>
      </div>
      <Navigation groups={groups} onNavigate={() => drawer.current.close()} />
    </dialog>
    <div className="workspace-content">
      <header className="workspace-topbar sticky top-0 z-30 flex min-h-16 items-center justify-between gap-2 border-b border-line bg-panel px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <button ref={openDrawer} type="button" aria-label="Open sidebar" aria-haspopup="dialog"
            className="control px-2 lg:hidden" onClick={() => drawer.current.showModal()}><Menu size={19} /></button>
          <div className="min-w-0">
            <p className="hidden truncate text-[11px] text-muted sm:block">{workspace}</p>
            <p className="truncate text-sm font-semibold" title={title}>{title}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeSelector />
          {!platform && !reseller && <NotificationBell />}
          <details ref={accountMenu} className="relative" onKeyDown={(event) => {
            if (event.key === "Escape" && accountMenu.current.open) {
              accountMenu.current.open = false;
              accountMenu.current.querySelector("summary")?.focus();
              event.stopPropagation();
            }
          }} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }}>
            <summary aria-label="Account menu" className="control list-none px-2 [&::-webkit-details-marker]:hidden">
              <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-[10px] font-bold text-accent">{initials}</span>
              <ChevronDown size={14} className="hidden sm:block" aria-hidden="true" />
            </summary>
            <div className="absolute end-0 top-full mt-2 w-56 max-w-[80vw] space-y-1 rounded-panel border border-line bg-panel p-2 shadow-panel">
              <div className="border-b border-line px-2 pb-2">
                <p className="break-words text-sm font-semibold">{identity}</p>
                <p className="break-words text-xs capitalize text-muted">{role}</p>
              </div>
              {!platform && !reseller && <Link to="/account" onClick={() => { accountMenu.current.open = false; }}
                className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-hover"><UserRound size={16} /> Account settings</Link>}
              {identityBrand?.support_email&&<a className="block rounded-lg p-2 text-sm hover:bg-hover"
                href={`mailto:${identityBrand.support_email}`}>Email support</a>}
              {identityBrand?.support_phone&&<a className="block rounded-lg p-2 text-sm hover:bg-hover"
                href={`tel:${identityBrand.support_phone}`}>Call support</a>}
              {identityBrand?.support_website&&<a className="block rounded-lg p-2 text-sm hover:bg-hover"
                href={identityBrand.support_website} target="_blank" rel="noreferrer">Support website</a>}
              <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-hover">
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </details>
        </div>
      </header>
      <div id="workspace-content" tabIndex={-1} className="outline-none">{children}</div>
    </div>
  </div>;
}
