const storageKey = "sna-fleet.auth";

export function loginContext(type, profile) {
  return {
    resellerSlug: type === "tenant" ? profile?.resellerSlug : type === "reseller" ? profile?.slug : null,
    customerType: type === "tenant" ? profile?.customerType : null,
  };
}

export function loginDestination(type, context = {}, { protectedRoute = false } = {}) {
  const slug = context?.resellerSlug;
  if (["tenant", "reseller"].includes(type) && typeof slug === "string" &&
      slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return `/r/${slug}/login`;
  }
  if (protectedRoute && type === "platform") return "/platform/login";
  if (protectedRoute && type === "reseller") return "/reseller/login";
  return "/login";
}

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
    return ["tenant", "platform", "reseller"].includes(stored?.type) && typeof stored.token === "string"
      ? { type: stored.type, token: stored.token, login: stored.login }
      : null;
  } catch {
    return null;
  }
}

export function storeSession(session) {
  try {
    if (session) {
      window.sessionStorage.setItem(storageKey, JSON.stringify({
        type: session.type, token: session.token, login: session.login,
      }));
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Authentication still works in memory when browser storage is unavailable.
  }
}
