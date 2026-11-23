
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
  setActiveAuth,
} from "../services/api";
import { getTokenExpiry, readStoredSession, storeSession } from "../services/auth-session";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(readStoredSession);
  const [restoreError, setRestoreError] = useState(false);
  const activeSession = useRef(null);
  const loginAttempt = useRef(null);
  const profileRequest = useRef(null);

  const logout = useCallback(() => {
    activeSession.current = null;
    loginAttempt.current = null;
    profileRequest.current?.abort();
    setActiveAuth(null);
    storeSession(null);
    setRestoring(null);
    setRestoreError(false);
    setSession(null);
  }, []);

  const startSession = useCallback((type, token, profile) => {
    const expiresAt = getTokenExpiry(token);
    if (!expiresAt || expiresAt <= Date.now()) throw new Error("Invalid or expired access token");

    profileRequest.current?.abort();
    const next = { id: Symbol(), type, profile, expiresAt };
    activeSession.current = next;
    setActiveAuth({ id: next.id, type, token });
    storeSession({ type, token });
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

    const controller = new AbortController();
    const { type, token } = restoring;
    const client = type === "platform" ? platformApi : tenantApi;
    const path = type === "platform" ? "/platform/auth/me" : "/users/me";
    client.get(path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) startSession(type, token, data);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      const status = error.response?.status;
      if (status === 401 || status === 403 || getTokenExpiry(token) <= Date.now()) logout();
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
    const data = await (isPlatform ? loginPlatform(credentials) : loginTenant(credentials));
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

    return () => {
      tenantApi.interceptors.response.eject(
        tenantInterceptor
      );

      platformApi.interceptors.response.eject(
        platformInterceptor
      );
    };
  }, [logout]);

  if (restoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090d16] p-5 text-white">
        {restoreError ? (
          <div className="space-y-4 rounded-xl border border-white/10 bg-[#111827] p-5">
            <p role="alert">Could not verify your saved session. Check the connection and try again.</p>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-lg bg-blue-600 px-4 py-2" onClick={() => setRestoreError(false)}>Retry</button>
              <button className="rounded-lg border border-white/20 px-4 py-2" onClick={logout}>Sign in again</button>
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
