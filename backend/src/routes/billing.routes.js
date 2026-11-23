const express = require("express");
const { requirePlatformAuth } = require("../middleware/platform-auth.middleware");
const { requireAuth } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { handle,v } = require("../services/billing-common");
const catalog = require("../services/billing-catalog.service");
const subs = require("../services/billing-subscriptions.service");
const invoices = require("../services/billing-invoices.service");
const reports = require("../services/billing-report.service");

const platform = express.Router();
platform.use(requirePlatformAuth);
const actor = (req) => req.platformAuth.adminId;
const id = (req) => v.id(req.params.id);
const reply = (operation, status = 200) => handle(async (req, res) => res.status(status).json(await operation(req)));
const idempotent = (operation) => handle(async (req, res) => {
  const result = await operation(req);
  return res.status(result.replayed ? 200 : 201).json(result);
});

platform.get("/tenants",reply((req) => reports.tenants(req.query)));
platform.get("/report",reply((req) => reports.report(req.query)));
platform.get("/history/:resource/:id",reply((req) => reports.history(
  v.choice(["plan","subscription","invoice","license"])(req.params.resource),id(req),req.query
)));
platform.get("/plans",reply((req) => catalog.plans(req.query)));
platform.post("/plans",reply((req) => catalog.savePlan(null,req.body,actor(req)),201));
platform.patch("/plans/:id",reply((req) => catalog.savePlan(id(req),req.body,actor(req))));
platform.get("/plans/:id/versions",reply((req) => catalog.versions(id(req),req.query)));
platform.post("/plans/:id/versions",reply((req) => catalog.publishVersion(id(req),req.body,actor(req)),201));
platform.get("/licenses",reply((req) => catalog.licenseList(req.query)));
platform.post("/licenses",reply((req) => catalog.licenseSave(null,req.body,actor(req)),201));
platform.patch("/licenses/:id",reply((req) => catalog.licenseSave(id(req),req.body,actor(req))));

platform.get("/subscriptions",reply((req) => subs.subscriptionList(req.query)));
platform.post("/subscriptions",reply((req) => subs.createSubscription(req.body,actor(req)),201));
platform.post("/subscriptions/generate-due",reply((req) => invoices.generateDue(req.body,actor(req))));
platform.get("/subscriptions/:id",reply((req) => subs.subscriptionDetail(id(req))));
platform.patch("/subscriptions/:id/status",reply((req) => subs.changeSubscription(id(req),req.body,actor(req))));
platform.patch("/subscriptions/:id/schedule",reply((req) => subs.schedule(id(req),req.body,actor(req))));
platform.post("/subscriptions/:id/terms",reply((req) => subs.changeTerms(id(req),req.body,actor(req)),201));
platform.post("/subscriptions/:id/invoices",idempotent((req) => invoices.generate(id(req),req.body,actor(req))));

platform.get("/invoices",reply((req) => invoices.invoiceList(req.query)));
platform.post("/invoices",idempotent((req) => invoices.manualInvoice(req.body,actor(req))));
platform.get("/invoices/:id",reply((req) => invoices.invoiceDetail(id(req))));
platform.patch("/invoices/:id/lines",reply((req) => invoices.replaceLines(id(req),req.body,actor(req))));
platform.post("/invoices/:id/finalize",reply((req) => invoices.finalize(id(req),req.body,actor(req))));
platform.post("/invoices/:id/void",reply((req) => invoices.voidInvoice(id(req),req.body,actor(req))));
platform.get("/invoices/:id/payments",reply((req) => invoices.paymentList(id(req),req.query)));
platform.post("/invoices/:id/payments",idempotent((req) => invoices.recordPayment(id(req),req.body,actor(req))));
platform.post("/invoices/:id/payments/:paymentId/reverse",idempotent((req) =>
  invoices.reversePayment(id(req),v.id(req.params.paymentId),req.body,actor(req))));

const tenant = express.Router();
tenant.use(requireAuth,authorize("billing:read"));
tenant.get("/subscriptions",reply((req) => subs.subscriptionList(req.query,req.auth.tenantId)));
tenant.get("/invoices",reply((req) => invoices.invoiceList(req.query,req.auth.tenantId)));
tenant.get("/invoices/:id",reply((req) => invoices.invoiceDetail(id(req),req.auth.tenantId)));
tenant.get("/invoices/:id/payments",reply((req) => invoices.paymentList(id(req),req.query,req.auth.tenantId)));

module.exports = { platform,tenant };
