import { Building2,Cpu, LayoutDashboard, Receipt, ShieldAlert, Signal, UserPlus, Users, Activity, ClipboardList, ListChecks, Truck } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import AppShell from "./AppShell";

const groups = [
  { name: "Platform", items: [
    { to: "/platform/dashboard", label: "Platform Dashboard", icon: LayoutDashboard, end: true },
    { to: "/platform/customers", label: "Customers", icon: Users },
    { to: "/platform/tenants/new", label: "Create Customer", icon: UserPlus },
    { to: "/platform/resellers", label: "Resellers", icon: Building2 },
    { to: "/platform/vehicles", label: "Vehicles", title: "Vehicle Directory", icon: Truck, end: true },
  ] },
  { name: "Operations", items: [
    { to: "/platform/devices", label: "GPS Device Inventory", icon: Cpu },
    { to: "/platform/connectivity", label: "SIM & Connectivity", icon: Signal },
    { to: "/platform/operations", label: "Operations Center", icon: ListChecks },
    { to: "/platform/health", label: "System Health", icon: Activity },
    { to: "/platform/audit", label: "Audit Logs", icon: ClipboardList },
    { to: "/platform/alerts", label: "Alert diagnostics", icon: ShieldAlert },
  ] },
  { name: "Finance", items: [
    { to: "/platform/billing", label: "Subscriptions & Billing", icon: Receipt },
  ] },
];

export default function PlatformLayout() {
  const { pathname } = useLocation();
  const page = groups.flatMap(({ items }) => items).find(({ to }) => to === pathname);
  return <AppShell platform title={page?.title ?? page?.label ?? "Customer details"} workspace="Platform administration" groups={groups}>
    <Outlet />
  </AppShell>;
}
