
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

import PlatformDashboard from "./pages/platform/PlatformDashboard";
import TenantDetails from "./pages/platform/TenantDetails";
import CompanyOnboarding from "./pages/platform/CompanyOnboarding";
import InvitationAcceptance from "./pages/InvitationAcceptance";

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
          element={<LoginPage type="tenant" />}
        />

        <Route
          path="/platform/login"
          element={<LoginPage type="platform" />}
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
        </Route>

        {/* Platform Admin routes */}
        <Route element={<ProtectedRoute type="platform" />}>
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
