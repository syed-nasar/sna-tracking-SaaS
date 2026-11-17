
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  loginTenant,
  loginPlatform,
  tenantApi,
  platformApi,
  setTenantAccessToken,
  setPlatformAccessToken,
  clearAccessTokens,
} from "../services/api";

const AuthContext = createContext(null);

function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number"
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);

  const logout = useCallback(() => {
    clearAccessTokens();
    setSession(null);
  }, []);

  const signInTenant = async (credentials) => {
    const data = await loginTenant(credentials);

    if (!data.accessToken || !data.user) {
      throw new Error("Invalid authentication response");
    }

    const expiresAt = getTokenExpiry(data.accessToken);

    if (!expiresAt || expiresAt <= Date.now()) {
      throw new Error("Invalid or expired access token");
    }

    clearAccessTokens();
    setTenantAccessToken(data.accessToken);

    setSession({
      type: "tenant",
      profile: data.user,
      expiresAt,
    });

    return data.user;
  };

  const signInPlatform = async (credentials) => {
    const data = await loginPlatform(credentials);

    if (!data.accessToken || !data.admin) {
      throw new Error("Invalid authentication response");
    }

    const expiresAt = getTokenExpiry(data.accessToken);

    if (!expiresAt || expiresAt <= Date.now()) {
      throw new Error("Invalid or expired access token");
    }

    clearAccessTokens();
    setPlatformAccessToken(data.accessToken);

    setSession({
      type: "platform",
      profile: data.admin,
      expiresAt,
    });

    return data.admin;
  };

  useEffect(() => {
    if (!session) return;

    const remaining = session.expiresAt - Date.now();

    if (remaining <= 0) {
      logout();
      return;
    }

    const timer = window.setTimeout(logout, remaining);

    return () => window.clearTimeout(timer);
  }, [session, logout]);

  useEffect(() => {
    const onRejected = (error) => {
      if (error.response?.status === 401) {
        logout();
      }

      return Promise.reject(error);
    };

    const tenantInterceptor =
      tenantApi.interceptors.response.use(
        (response) => response,
        onRejected
      );

    const platformInterceptor =
      platformApi.interceptors.response.use(
        (response) => response,
        onRejected
      );

    return () => {
      tenantApi.interceptors.response.eject(
        tenantInterceptor
      );

      platformApi.interceptors.response.eject(
        platformInterceptor
      );
    };
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        session,
        signInTenant,
        signInPlatform,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}
