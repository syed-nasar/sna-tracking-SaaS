
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import {
  Building2,
  Cpu,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  Receipt,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";

const navigationItems = [
  {
    personalLabel: "My Dashboard",
    businessLabel: "Fleet Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    personalLabel: "My Vehicles",
    businessLabel: "Fleet Vehicles",
    path: "/vehicles",
    icon: Truck,
  },
  {
    businessLabel: "Fleet Operations",
    path: "/fleet",
    icon: ClipboardList,
    businessOnly: true,
  },
  {
    personalLabel: "My GPS Devices",
    businessLabel: "Fleet GPS Devices",
    path: "/devices",
    icon: Cpu,
  },
  {
    personalLabel: "My Tracking",
    businessLabel: "Live Fleet Tracking",
    path: "/tracking",
    icon: MapPinned,
  },
  {
    personalLabel: "My Account",
    businessLabel: "Company Account",
    path: "/account",
    icon: UserRound,
  },
  {
    personalLabel: "My Billing",
    businessLabel: "Company Billing",
    path: "/billing",
    icon: Receipt,
    tenantAdmin: true,
  },
  {
    businessLabel: "User Management",
    path: "/users",
    icon: Users,
    businessAdmin: true,
  },
];

export default function TenantLayout({
  children,
  title = "Fleet Console",
}) {
  const navigate = useNavigate();
  const { session, logout, refreshTenantProfile } = useAuth();
  const profile = session?.profile;

  useEffect(() => {
    void refreshTenantProfile();
  }, [refreshTenantProfile]);

  const isPersonal = profile?.customerType === "personal";

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const accountLabels = isPersonal
    ? {
        console: "Personal Console",
        workspace: "Personal Workspace",
        fallbackName: "Personal Account",
        badge: "Personal Account",
      }
    : {
        console: "Fleet Console",
        workspace: "Fleet Workspace",
        fallbackName: "Company",
        badge: "Business Account",
      };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/10 bg-[#0d1422] transition-transform lg:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        {/* Branding */}
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2.5">
              <Truck size={23} />
            </div>

            <div>
              <h1 className="text-sm font-bold">
                SNA Fleet
              </h1>

              <p className="text-xs text-slate-400">
                {accountLabels.console}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="text-slate-400 lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="min-h-0 overflow-y-auto px-4 pt-7">
          <p className="mb-4 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
            {accountLabels.workspace}
          </p>

          <div className="space-y-2">
            {navigationItems.map((item) => {
              if (item.tenantAdmin && profile?.role !== "tenant_admin") return null;
              if (item.businessOnly && profile?.customerType !== "business") return null;
              if (item.businessAdmin &&
                  (profile?.customerType !== "business" || profile?.role !== "tenant_admin")) {
                return null;
              }

              const Icon = item.icon;

              const label = isPersonal
                ? item.personalLabel
                : item.businessLabel;

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                      isActive
                        ? "bg-blue-600/15 text-blue-400"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`
                  }
                >
                  <Icon size={19} />
                  {label}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* User Profile */}
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
              <ShieldCheck size={21} />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {profile?.fullName || "User"}
              </p>

              <p className="truncate text-xs text-slate-500 capitalize">
                {String(
                  profile?.role || "tenant user"
                ).replaceAll("_", " ")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/10 bg-[#090d16]/95 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="text-slate-300 lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu size={24} />
            </button>

            <div>
              <p className="text-sm font-semibold">
                {title}
              </p>

              <p className="text-xs text-slate-500">
                {profile?.tenantName ||
                  accountLabels.fallbackName}
              </p>
            </div>
          </div>

          <span className="hidden items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-400 sm:inline-flex">
            {isPersonal ? (
              <UserRound size={14} />
            ) : (
              <Building2 size={14} />
            )}

            {accountLabels.badge}
          </span>
        </header>

        {children}
      </div>
    </div>
  );
}
