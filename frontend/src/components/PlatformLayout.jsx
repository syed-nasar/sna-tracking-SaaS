import { Building2,Cpu, LayoutDashboard, Receipt, ShieldAlert, Signal, UserPlus } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import AppShell from "./AppShell";

const groups = [
  { name: "Platform", items: [
    { to: "/platform/dashboard", label: "Platform Dashboard", icon: LayoutDashboard },
    { to: "/platform/tenants/new", label: "Create Customer", icon: UserPlus },
    { to: "/platform/resellers", label: "Resellers", icon: Building2 },
  ] },
  { name: "Operations", items: [
    { to: "/platform/devices", label: "GPS Device Inventory", icon: Cpu },
    { to: "/platform/connectivity", label: "SIM & Connectivity", icon: Signal },
    { to: "/platform/alerts", label: "Alert diagnostics", icon: ShieldAlert },
  ] },
  { name: "Finance", items: [
    { to: "/platform/billing", label: "Subscriptions & Billing", icon: Receipt },
  ] },
];

export default function PlatformLayout() {
  const { pathname } = useLocation();
  const page = groups.flatMap(({ items }) => items).find(({ to }) => to === pathname);
  return <AppShell platform title={page?.label ?? "Customer details"} workspace="Platform administration" groups={groups}>
    <Outlet />
  </AppShell>;
}
