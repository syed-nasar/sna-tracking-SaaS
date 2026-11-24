
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { lazy, Suspense } from "react";

import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import PlatformAlertDiagnostics from "./pages/platform/PlatformAlertDiagnostics";
import PlatformLayout from "./components/PlatformLayout";
import { StateNotice } from "./components/WorkspaceUi";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import VehiclesPage from "./pages/VehiclesPage";
import AccountPage from "./pages/AccountPage";
import UserManagementPage from "./pages/UserManagementPage";
import FleetOperationsPage from "./pages/FleetOperationsPage";
import CustomerDevicesPage from "./pages/CustomerDevicesPage";

import PlatformDashboard from "./pages/platform/PlatformDashboard";
import TenantDetails from "./pages/platform/TenantDetails";
import CompanyOnboarding from "./pages/platform/CompanyOnboarding";
import InvitationAcceptance from "./pages/InvitationAcceptance";
import CustomerBillingPage from "./pages/billing/CustomerBillingPage";
import { PrintableInvoice } from "./pages/billing/BillingInvoices";

const LiveTrackingPage = lazy(() => import("./pages/LiveTrackingPage"));
const VehicleReportsPage = lazy(() => import("./pages/VehicleReportsPage"));
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

  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
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
            <Route path="/platform/devices" element={<DeferredPage><DeviceInventoryPage /></DeferredPage>} />
            <Route path="/platform/connectivity" element={<DeferredPage><SimConnectivityPage /></DeferredPage>} />
            <Route path="/platform/billing" element={<DeferredPage><BillingPage /></DeferredPage>} />
            <Route path="/platform/dashboard" element={<PlatformDashboard />} />
            <Route path="/platform/alerts" element={<PlatformAlertDiagnostics />} />
            <Route path="/platform/tenants/new" element={<CompanyOnboarding />} />
            <Route path="/platform/tenants/:id" element={<TenantDetails />} />
          </Route>
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
