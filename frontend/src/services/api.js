
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

let activeAuth = null;

export function setActiveAuth(auth) {
  activeAuth = auth;
}

// Create separate clients so a platform token is never
// accidentally sent to a tenant endpoint or vice versa.
export const tenantApi = axios.create({
  ...api.defaults,
});

export const platformApi = axios.create({
  ...api.defaults,
});

for (const [client, type] of [[tenantApi, "tenant"], [platformApi, "platform"]]) {
  client.interceptors.request.use((config) => {
    if (activeAuth?.type === type && !config.headers.has("Authorization")) {
      config.headers.set("Authorization", `Bearer ${activeAuth.token}`);
      config.authSessionId = activeAuth.id;
    }
    return config;
  }, undefined, { synchronous: true });
}

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
