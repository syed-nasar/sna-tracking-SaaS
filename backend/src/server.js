
require("dotenv").config();

const app = require("./app");
const { startDraftScheduler } = require("./services/billing-scheduler");

const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(
    `SNA Fleet backend running at http://${HOST}:${PORT}`
  );
  startDraftScheduler(process.env.BILLING_AUTO_DRAFT_ACTOR_ID);
});
