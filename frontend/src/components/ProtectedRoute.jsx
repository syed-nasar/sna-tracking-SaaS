
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ type }) {
  const { session } = useAuth();

  if (!session || session.type !== type) {
    return (
      <Navigate
        to={type === "platform" ? "/platform/login" : "/login"}
        replace
      />
    );
  }

  return <Outlet />;
}
