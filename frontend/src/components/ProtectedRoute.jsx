
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ type }) {
  const { session } = useAuth();
  const { pathname, search, hash } = useLocation();

  if (!session || session.type !== type) {
    return (
      <Navigate
        to={type === "platform" ? "/platform/login" : "/login"}
        state={{ returnTo: { pathname, search, hash }, authType: type }}
        replace
      />
    );
  }

  return <Outlet />;
}
