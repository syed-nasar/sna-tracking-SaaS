
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { lazy, Suspense } from "react";

import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import PlatformAlertDiagnostics from "./pages/platform/PlatformAlertDiagnostics";
import PlatformLayout from "./components/PlatformLayout";
import { StateNotice } from "./components/WorkspaceUi";
import BrandProvider from "./context/BrandProvider";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import VehiclesPage from "./pages/VehiclesPage";
import AccountPage from "./pages/AccountPage";
import UserManagementPage from "./pages/UserManagementPage";
import FleetOperationsPage from "./pages/FleetOperationsPage";
import CustomerDevicesPage from "./pages/CustomerDevicesPage";

import PlatformDashboard from "./pages/platform/PlatformDashboard";
import PlatformCustomers from "./pages/platform/PlatformCustomers";
import PlatformVehicles from "./pages/platform/PlatformVehicles";
import PlatformOperations from "./pages/platform/PlatformOperations";
import PlatformHealth from "./pages/platform/PlatformHealth";
import PlatformAudit from "./pages/platform/PlatformAudit";
import TenantDetails from "./pages/platform/TenantDetails";
import CompanyOnboarding from "./pages/platform/CompanyOnboarding";
import InvitationAcceptance from "./pages/InvitationAcceptance";
import CustomerBillingPage from "./pages/billing/CustomerBillingPage";
import { PrintableInvoice } from "./pages/billing/BillingInvoices";

const LiveTrackingPage = lazy(() => import("./pages/LiveTrackingPage"));
const VehicleReportsPage = lazy(() => import("./pages/VehicleReportsPage"));
const ResellerWorkspace = lazy(() => import("./pages/ResellerWorkspace"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const DeviceInventoryPage = lazy(() => import("./pages/platform/DeviceInventoryPage"));
const SimConnectivityPage = lazy(() => import("./pages/platform/SimConnectivityPage"));
const BillingPage = lazy(() => import("./pages/billing/BillingPage"));

function DeferredPage({ children }) {
  return <Suspense fallback={<main className="p-4 sm:p-7"><StateNotice loading>Loading page…</StateNotice></main>}>
    {children}
  </Suspense>;
}

function HomeRedirect() {
  const { session } = useAuth();

  if (session?.type === "platform") {
    return <Navigate to="/platform/dashboard" replace />;
  }

  if (session?.type === "tenant") {
    return <Navigate to="/dashboard" replace />;
  }
  if(session?.type==="reseller")return <Navigate to="/reseller/dashboard" replace />;

  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <BrandProvider>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route
          path="/login"
          element={<LoginPage key="tenant-login" type="tenant" />}
        />

        <Route
          path="/platform/login"
          element={<LoginPage key="platform-login" type="platform" />}
        />

        <Route
          path="/accept-invitation"
          element={<InvitationAcceptance />}
        />
        <Route path="/r/:brandSlug/login" element={<LoginPage key="branded-login" />} />
        <Route path="/r/:brandSlug/reseller/login" element={<LoginPage key="branded-reseller-login" type="reseller" />} />
        <Route path="/r/:brandSlug/accept-invitation" element={<InvitationAcceptance key="branded-acceptance" />} />
        <Route path="/r/:brandSlug/activate-admin" element={<InvitationAcceptance key="reseller-acceptance" reseller />} />
        <Route path="/reseller/login" element={<LoginPage key="reseller-login" type="reseller" />} />
        <Route element={<ProtectedRoute type="reseller" />}>
          {["dashboard","customers","inventory","settings","customers/:id"].map(path=>
            <Route key={path} path={`/reseller/${path}`} element={<DeferredPage><ResellerWorkspace key={path} /></DeferredPage>} />)}
          <Route path="/reseller/customers/new" element={<DeferredPage><ResellerWorkspace key="create" onboard /></DeferredPage>} />
        </Route>

        {/* Tenant routes */}
        <Route element={<ProtectedRoute type="tenant" />}>
          <Route
            path="/dashboard"
            element={<DashboardPage />}
          />

          <Route
            path="/vehicles"
            element={<VehiclesPage />}
          />

          <Route
            path="/tracking"
            element={<DeferredPage><LiveTrackingPage /></DeferredPage>}
          />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/users" element={<UserManagementPage />} />
          <Route path="/fleet" element={<FleetOperationsPage />} />
          <Route path="/devices" element={<CustomerDevicesPage />} />
          <Route path="/reports" element={<DeferredPage><VehicleReportsPage /></DeferredPage>} />
          <Route path="/alerts" element={<DeferredPage><AlertsPage /></DeferredPage>} />
          <Route path="/notifications" element={<DeferredPage><AlertsPage notifications /></DeferredPage>} />
          <Route path="/alerts/events/:eventId" element={<DeferredPage><AlertsPage /></DeferredPage>} />
          <Route path="/billing" element={<CustomerBillingPage />} />
          <Route path="/billing/invoices/:id/print" element={<PrintableInvoice platform={false} />} />
        </Route>

        {/* Platform Admin routes */}
        <Route element={<ProtectedRoute type="platform" />}>
          <Route path="/platform/billing/invoices/:id/print" element={<PrintableInvoice platform />} />
          <Route element={<PlatformLayout />}>
            <Route path="/platform/resellers" element={<DeferredPage><ResellerWorkspace key="platform-resellers" platform /></DeferredPage>} />
            <Route path="/platform/resellers/:id" element={<DeferredPage><ResellerWorkspace key="platform-reseller" platform /></DeferredPage>} />
            <Route path="/platform/devices" element={<DeferredPage><DeviceInventoryPage /></DeferredPage>} />
            <Route path="/platform/connectivity" element={<DeferredPage><SimConnectivityPage /></DeferredPage>} />
            <Route path="/platform/billing" element={<DeferredPage><BillingPage /></DeferredPage>} />
            <Route path="/platform/dashboard" element={<PlatformDashboard />} />
            <Route path="/platform/customers" element={<PlatformCustomers />} />
            <Route path="/platform/vehicles" element={<PlatformVehicles />} />
            <Route path="/platform/operations" element={<PlatformOperations />} />
            <Route path="/platform/health" element={<PlatformHealth />} />
            <Route path="/platform/audit" element={<PlatformAudit />} />
            <Route path="/platform/alerts" element={<PlatformAlertDiagnostics />} />
            <Route path="/platform/tenants/new" element={<CompanyOnboarding />} />
            <Route path="/platform/tenants/:id" element={<TenantDetails />} />
          </Route>
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      </BrandProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
