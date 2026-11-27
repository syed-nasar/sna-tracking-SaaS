const axios = require("axios");

const traccarApi = axios.create({
  baseURL: process.env.TRACCAR_BASE_URL,
  timeout: 10000,
  auth: {
    username: process.env.TRACCAR_EMAIL,
    password: process.env.TRACCAR_PASSWORD,
  },
});

async function getDevices() {
  const response = await traccarApi.get("/api/devices");
  return response.data;
}

async function getPositions() {
  const response = await traccarApi.get("/api/positions");
  return response.data;
}

// Create a GPS device in Traccar.
// The uniqueId must match the identifier used by the GPS tracker.
const provisioningOptions = {
  maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
  headers: { Accept: "application/json" },
};

async function provisioningDevices() {
  // In 6.17 filtered lookups are permission-scoped, and all=true is global only for admins.
  const email = process.env.TRACCAR_EMAIL;
  if (!email || !process.env.TRACCAR_PASSWORD || !process.env.TRACCAR_BASE_URL) return null;
  const { data: users } = await traccarApi.get("/api/users", {
    ...provisioningOptions, params: { keyword: email },
  });
  if (!Array.isArray(users) || !users.some((user) =>
    user?.email?.toLowerCase() === email.toLowerCase() && user.administrator === true)) return null;
  const { data } = await traccarApi.get("/api/devices", {
    ...provisioningOptions, params: { all: true, excludeAttributes: true },
  });
  return data;
}

async function createDevice({ name, uniqueId }) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof uniqueId !== "string" ||
    !uniqueId.trim()
  ) {
    throw new Error("Device name and unique ID are required");
  }

  const response = await traccarApi.post("/api/devices", {
    name: name.trim(),
    uniqueId: uniqueId.trim(),
  }, provisioningOptions);

  return response.data;
}

module.exports = {
  getDevices,
  getPositions,
  async getReport(kind, params, signal) {
    const response = await traccarApi.get(`/api/reports/${kind}`, {
      params, signal, maxContentLength: 16 * 1024 * 1024,
      maxRedirects: 0, headers: { Accept: "application/json" },
    });
    return response.data;
  },
  createDevice,
  provisioningDevices,
  async geofenceRequest(method,path,data,params) {
    return (await traccarApi.request({method,url:`/api/${path}`,data,params})).data;
  },
};
