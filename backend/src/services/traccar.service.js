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
  });

  return response.data;
}

module.exports = {
  getDevices,
  getPositions,
  createDevice,
  async geofenceRequest(method,path,data,params) {
    return (await traccarApi.request({method,url:`/api/${path}`,data,params})).data;
  },
};
