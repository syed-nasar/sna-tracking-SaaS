import { useEffect } from "react";
import { ClipboardList, Cpu, LayoutDashboard, MapPinned, Receipt, Truck, UserRound, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";
import { Bell, ShieldAlert } from "lucide-react";

export default function TenantLayout({ children, title = "Fleet Console" }) {
  const { session, refreshTenantProfile } = useAuth();
  const profile = session?.profile;
  const personal = profile?.customerType === "personal";
  const business = profile?.customerType === "business";
  const admin = profile?.role === "tenant_admin";

  useEffect(() => { void refreshTenantProfile(); }, [refreshTenantProfile]);

  const groups = [
    { name: personal ? "Workspace" : "Fleet", items: [
      { to: "/dashboard", label: personal ? "My Dashboard" : "Fleet Dashboard", icon: LayoutDashboard },
      { to: "/tracking", label: personal ? "My Tracking" : "Live Fleet Tracking", icon: MapPinned },
      { to: "/vehicles", label: personal ? "My Vehicles" : "Fleet Vehicles", icon: Truck },
      ...(business ? [{ to: "/fleet", label: "Fleet Operations", icon: ClipboardList }] : []),
    ] },
    { name: "Connectivity", items: [
      { to: "/devices", label: personal ? "My GPS Devices" : "Fleet GPS Devices", icon: Cpu },
    ] },
    { name: "Alerts", items: [
      { to: "/alerts", label: "Alerts & Geofences", icon: ShieldAlert },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ] },
    { name: "Account", items: [
      { to: "/account", label: personal ? "My Account" : "Company Account", icon: UserRound },
      ...(admin ? [{ to: "/billing", label: personal ? "My Billing" : "Company Billing", icon: Receipt }] : []),
      ...(business && admin ? [{ to: "/users", label: "User Management", icon: Users }] : []),
    ] },
  ];

  return <AppShell title={title} workspace={profile?.tenantName || (personal ? "Personal workspace" : "Business workspace")} groups={groups}>
    {children}
  </AppShell>;
}
