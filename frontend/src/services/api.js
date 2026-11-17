
import axios from "axios";

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:3000/api",

  timeout: 15000,

  headers: {
    "Content-Type": "application/json",
  },
});

// Separate in-memory tokens for the two authentication systems.
let tenantAccessToken = null;
let platformAccessToken = null;

export function setTenantAccessToken(token) {
  tenantAccessToken = token || null;
}

export function setPlatformAccessToken(token) {
  platformAccessToken = token || null;
}

export function clearAccessTokens() {
  tenantAccessToken = null;
  platformAccessToken = null;
}

// Create separate clients so a platform token is never
// accidentally sent to a tenant endpoint or vice versa.
export const tenantApi = axios.create({
  ...api.defaults,
});

export const platformApi = axios.create({
  ...api.defaults,
});

tenantApi.interceptors.request.use((config) => {
  if (tenantAccessToken) {
    config.headers.set(
      "Authorization",
      `Bearer ${tenantAccessToken}`
    );
  }

  return config;
});

platformApi.interceptors.request.use((config) => {
  if (platformAccessToken) {
    config.headers.set(
      "Authorization",
      `Bearer ${platformAccessToken}`
    );
  }

  return config;
});

// Public authentication endpoints.
export async function loginTenant(credentials) {
  const response = await api.post("/auth/login", credentials);
  return response.data;
}

export async function loginPlatform(credentials) {
  const response = await api.post(
    "/platform/auth/login",
    credentials
  );

  return response.data;
}

export default api;
