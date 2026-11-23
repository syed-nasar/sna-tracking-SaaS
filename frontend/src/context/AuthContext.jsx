
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  const tenantSessionId = useRef(null);
  const profileRequest = useRef(null);

  const logout = useCallback(() => {
    tenantSessionId.current = null;
    profileRequest.current?.abort();
    clearAccessTokens();
    setSession(null);
  }, []);

  const refreshTenantProfile = useCallback(async () => {
    const sessionId = tenantSessionId.current;
    if (!sessionId) return;

    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;

    try {
      const { data } = await tenantApi.get("/users/me", {
        signal: controller.signal,
        handleSessionError: true,
      });
      if (controller.signal.aborted) return;
      setSession((current) => current?.id === sessionId
        ? { ...current, profile: { ...current.profile, ...data } }
        : current);
    } catch (error) {
      const status = error.response?.status;
      if (!controller.signal.aborted && tenantSessionId.current === sessionId &&
          (status === 401 || status === 403)) {
        logout();
      }
    } finally {
      if (profileRequest.current === controller) profileRequest.current = null;
    }
  }, [logout]);

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
    const id = Symbol();
    tenantSessionId.current = id;

    setSession({
      id,
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
    tenantSessionId.current = null;
    profileRequest.current?.abort();

    setSession({
      type: "platform",
      profile: data.admin,
      expiresAt,
    });

    return data.admin;
  };

  const sessionType = session?.type;
  useEffect(() => {
    if (sessionType !== "tenant") return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshTenantProfile();
    };
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      profileRequest.current?.abort();
    };
  }, [sessionType, refreshTenantProfile]);

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
      if (error.response?.status === 401 && !error.config?.handleSessionError) {
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
        refreshTenantProfile,
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
