
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginDestination } from "../services/auth-session";

export default function ProtectedRoute({ type }) {
  const { session } = useAuth();
  const { pathname, search, hash } = useLocation();

  if (!session || session.type !== type) {
    return (
      <Navigate
        to={loginDestination(type,undefined,{protectedRoute:true})}
        state={{ returnTo: { pathname, search, hash }, authType: type }}
        replace
      />
    );
  }

  return <Outlet />;
}
