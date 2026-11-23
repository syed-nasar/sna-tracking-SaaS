const storageKey = "sna-fleet.auth";

export function getTokenExpiry(token) {
  if (typeof token !== "string") return null;
  try {
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(encoded));
    return Number.isFinite(exp) && Number.isFinite(exp * 1000) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function readStoredSession() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey));
    const expiresAt = getTokenExpiry(stored?.token);
    return ["tenant", "platform"].includes(stored?.type) && expiresAt > Date.now()
      ? { type: stored.type, token: stored.token }
      : null;
  } catch {
    return null;
  }
}

export function storeSession(session) {
  try {
    if (session) {
      window.sessionStorage.setItem(storageKey, JSON.stringify({
        type: session.type, token: session.token,
      }));
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Authentication still works in memory when browser storage is unavailable.
  }
}
