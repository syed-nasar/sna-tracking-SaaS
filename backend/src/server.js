
require("dotenv").config();

const app = require("./app");
const { startDraftScheduler } = require("./services/billing-scheduler");
const { startAlertWorker } = require("./services/alert-worker");
const { startAlertEmail } = require("./services/alert-email");
const { startInvitationEmail } = require("./services/company-invitation-email");
const { startGeofenceSync } = require("./services/alert-geofence-sync");

const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(
    `SNA Fleet backend running at http://${HOST}:${PORT}`
  );
  startDraftScheduler(process.env.BILLING_AUTO_DRAFT_ACTOR_ID);
  startAlertWorker();
  startAlertEmail();
  startInvitationEmail();
  startGeofenceSync();
});
