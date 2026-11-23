const express = require("express");
const { requirePlatformAuth } = require("../middleware/platform-auth.middleware");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const v = require("../services/connectivity-validation");
const catalog = require("../services/connectivity-catalog.service");
const sims = require("../services/sim-inventory.service");
const assignments = require("../services/sim-assignment.service");
const periods = require("../services/sim-period.service");

const platform = express.Router();
platform.use(requirePlatformAuth);
const actor = (req) => req.platformAuth.adminId;

for (const type of ["operators", "plans"]) {
  platform.get(`/${type}`, v.handle(async (req, res) => res.json(await catalog.listCatalog(type, req.query))));
  platform.get(`/${type}/:id`, v.handle(async (req, res) => res.json(await catalog.getCatalog(type, v.id(req.params.id)))));
  platform.post(`/${type}`, v.handle(async (req, res) =>
    res.status(201).json(await catalog.saveCatalog(type, null, req.body, actor(req)))));
  platform.patch(`/${type}/:id`, v.handle(async (req, res) =>
    res.json(await catalog.saveCatalog(type, v.id(req.params.id), req.body, actor(req)))));
}

platform.get("/summary", v.handle(async (_req, res) => res.json(await sims.summary())));
platform.patch("/settings", v.handle(async (req, res) => res.json(await sims.setWarningDays(req.body, actor(req)))));
platform.get("/device-options", v.handle(async (req, res) => res.json(await assignments.deviceChoices(req.query))));
platform.get("/sims", v.handle(async (req, res) => res.json(await sims.listSims(req.query))));
platform.post("/sims", v.handle(async (req, res) => res.status(201).json(await sims.saveSim(null, req.body, actor(req)))));
platform.get("/sims/:id", v.handle(async (req, res) => res.json(await sims.getSim(v.id(req.params.id)))));
platform.patch("/sims/:id", v.handle(async (req, res) => res.json(await sims.saveSim(v.id(req.params.id), req.body, actor(req)))));
platform.patch("/sims/:id/lifecycle", v.handle(async (req, res) => res.json(await sims.setLifecycle(v.id(req.params.id), req.body, actor(req)))));
platform.put("/sims/:id/assignment", v.handle(async (req, res) =>
  res.json(await assignments.changeAssignment(v.id(req.params.id), req.body, actor(req)))));

for (const [path, kind] of [["periods", "plan"], ["renewals", "renewal"]]) {
  platform.post(`/sims/:id/${path}`, v.handle(async (req, res) => {
    const result = await periods.recordPeriod(v.id(req.params.id), kind, req.body, actor(req));
    return res.status(result.replayed ? 200 : 201).json(result);
  }));
}
for (const kind of ["assignments", "periods", "audit"]) {
  platform.get(`/sims/:id/${kind}`, v.handle(async (req, res) =>
    res.json(await periods.history(v.id(req.params.id), kind, req.query))));
}

const tenant = express.Router();
tenant.use(requireAuth, authorize("vehicles:read"));
tenant.get("/", v.handle(async (req, res) => res.json(await sims.tenantConnectivity(req.auth.tenantId))));
tenant.get("/:deviceId", v.handle(async (req, res) =>
  res.json(await sims.tenantConnectivity(req.auth.tenantId, v.id(req.params.deviceId)))));

module.exports = { platform, tenant };
