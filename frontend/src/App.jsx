
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import VehiclesPage from "./pages/VehiclesPage";
import LiveTrackingPage from "./pages/LiveTrackingPage";
import AccountPage from "./pages/AccountPage";
import UserManagementPage from "./pages/UserManagementPage";
import FleetOperationsPage from "./pages/FleetOperationsPage";
import CustomerDevicesPage from "./pages/CustomerDevicesPage";

import PlatformDashboard from "./pages/platform/PlatformDashboard";
import TenantDetails from "./pages/platform/TenantDetails";
import CompanyOnboarding from "./pages/platform/CompanyOnboarding";
import InvitationAcceptance from "./pages/InvitationAcceptance";
import DeviceInventoryPage from "./pages/platform/DeviceInventoryPage";
import SimConnectivityPage from "./pages/platform/SimConnectivityPage";
import BillingPage from "./pages/billing/BillingPage";
import CustomerBillingPage from "./pages/billing/CustomerBillingPage";
import { PrintableInvoice } from "./pages/billing/BillingInvoices";

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
            element={<LiveTrackingPage />}
          />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/users" element={<UserManagementPage />} />
          <Route path="/fleet" element={<FleetOperationsPage />} />
          <Route path="/devices" element={<CustomerDevicesPage />} />
          <Route path="/billing" element={<CustomerBillingPage />} />
          <Route path="/billing/invoices/:id/print" element={<PrintableInvoice platform={false} />} />
        </Route>

        {/* Platform Admin routes */}
        <Route element={<ProtectedRoute type="platform" />}>
          <Route path="/platform/devices" element={<DeviceInventoryPage />} />
          <Route path="/platform/connectivity" element={<SimConnectivityPage />} />
          <Route path="/platform/billing" element={<BillingPage />} />
          <Route path="/platform/billing/invoices/:id/print" element={<PrintableInvoice platform />} />
          <Route
            path="/platform/dashboard"
            element={<PlatformDashboard />}
          />

          <Route
            path="/platform/tenants/new"
            element={<CompanyOnboarding />}
          />

          <Route
            path="/platform/tenants/:id"
            element={<TenantDetails />}
          />
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
