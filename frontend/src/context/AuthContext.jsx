
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Navigate, useLocation } from "react-router-dom";

import {
  loginTenant,
  loginPlatform,
  tenantApi,
  platformApi,
  resellerApi,
  loginReseller,
  setActiveAuth,
} from "../services/api";
import { getTokenExpiry, loginContext, loginDestination, readStoredSession, storeSession } from "../services/auth-session";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { key: locationKey } = useLocation();
  const [redirect, setRedirect] = useState(null);
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(readStoredSession);
  const [restoreError, setRestoreError] = useState(false);
  const activeSession = useRef(null);
  const loginAttempt = useRef(null);
  const profileRequest = useRef(null);

  const logout = useCallback((saved) => {
    const previous = activeSession.current ?? saved;
    const destination = loginDestination(previous?.type,previous?.login);
    activeSession.current = null;
    loginAttempt.current = null;
    profileRequest.current?.abort();
    setActiveAuth(null);
    storeSession(null);
    setRestoring(null);
    setRestoreError(false);
    setSession(null);
    setRedirect({locationKey,destination,state:{
      signInType: previous?.type === "reseller" && destination !== "/login" ? "reseller" : null,
      customerType: previous?.login?.customerType,
    }});
  }, [locationKey]);

  const startSession = useCallback((type, token, profile) => {
    const expiresAt = getTokenExpiry(token);
    if (!expiresAt || expiresAt <= Date.now()) throw new Error("Invalid or expired access token");

    profileRequest.current?.abort();
    const login = loginContext(type,profile);
    const next = { id: Symbol(), type, profile, expiresAt, login };
    activeSession.current = next;
    setActiveAuth({ id: next.id, type, token });
    storeSession({ type, token, login });
    setSession(next);
    setRestoring(null);
    setRestoreError(false);
  }, []);

  useEffect(() => {
    if (!restoring) {
      if (!activeSession.current) storeSession(null);
      return;
    }
    if (restoreError) return;
    if (!(getTokenExpiry(restoring.token) > Date.now())) {
      const timer = window.setTimeout(() => logout(restoring),0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const { type, token } = restoring;
    const client = type === "platform" ? platformApi : type === "reseller" ? resellerApi : tenantApi;
    const path = type === "platform" ? "/platform/auth/me" : type === "reseller" ? "/reseller/auth/me" : "/users/me";
    client.get(path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) startSession(type, token, data);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      const status = error.response?.status;
      if (status === 401 || status === 403 || getTokenExpiry(token) <= Date.now()) logout(restoring);
      else setRestoreError(true);
    });

    return () => controller.abort();
  }, [restoring, restoreError, startSession, logout]);

  const refreshTenantProfile = useCallback(async () => {
    const currentSession = activeSession.current;
    if (currentSession?.type !== "tenant") return;

    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;

    try {
      const { data } = await tenantApi.get("/users/me", {
        signal: controller.signal,
        handleSessionError: true,
      });
      if (controller.signal.aborted) return;
      setSession((current) => current?.id === currentSession.id
        ? { ...current, profile: { ...current.profile, ...data } }
        : current);
    } catch (error) {
      const status = error.response?.status;
      if (!controller.signal.aborted && activeSession.current === currentSession &&
          (status === 401 || status === 403)) {
        logout();
      }
    } finally {
      if (profileRequest.current === controller) profileRequest.current = null;
    }
  }, [logout]);

  const signIn = async (type, credentials) => {
    const attempt = Symbol();
    loginAttempt.current = attempt;
    const isPlatform = type === "platform";
    const login = isPlatform ? loginPlatform : type === "reseller" ? loginReseller : loginTenant;
    const data = await login(credentials);
    const profile = isPlatform ? data.admin : data.user;
    if (!data.accessToken || !profile) {
      throw new Error("Invalid authentication response");
    }
    if (loginAttempt.current !== attempt) throw new Error("This sign-in attempt is no longer active.");

    startSession(type, data.accessToken, profile);
    return profile;
  };

  const sessionType = session?.type;
  useEffect(() => {
    if (sessionType !== "tenant" && sessionType !== "reseller") return;

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (sessionType === "tenant") void refreshTenantProfile();
      else void resellerApi.get("/reseller/auth/me").catch(() => {});
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

    let timer;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (session.id !== activeSession.current?.id) return;
        if (session.expiresAt <= Date.now()) logout();
        else schedule();
      }, Math.min(2147483647, Math.max(0, session.expiresAt - Date.now())));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  useEffect(() => {
    const onRejected = (error) => {
      if (error.response?.status === 401 && !error.config?.handleSessionError &&
          activeSession.current && error.config?.authSessionId === activeSession.current.id) {
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
    const resellerInterceptor = resellerApi.interceptors.response.use(response=>response,onRejected);

    return () => {
      tenantApi.interceptors.response.eject(
        tenantInterceptor
      );

      platformApi.interceptors.response.eject(
        platformInterceptor
      );
      resellerApi.interceptors.response.eject(resellerInterceptor);
    };
  }, [logout]);

  if (redirect?.locationKey === locationKey) {
    return <Navigate to={redirect.destination} replace state={redirect.state} />;
  }

  if (restoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-5 text-ink">
        {restoreError ? (
          <div className="space-y-4 rounded-xl border border-line bg-panel p-5">
            <p role="alert">Could not verify your saved session. Check the connection and try again.</p>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-lg bg-action px-4 py-2" onClick={() => setRestoreError(false)}>Retry</button>
              <button className="rounded-lg border border-line-strong px-4 py-2" onClick={() => logout(restoring)}>Sign in again</button>
            </div>
          </div>
        ) : <p role="status">Restoring session…</p>}
      </main>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        signInTenant: (credentials) => signIn("tenant", credentials),
        signInPlatform: (credentials) => signIn("platform", credentials),
        signInReseller: (credentials) => signIn("reseller", credentials),
        refreshTenantProfile,
        logout: () => {
          if (!session || session.id !== activeSession.current?.id) return false;
          logout();
          return true;
        },
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
