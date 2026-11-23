const { pool,v } = require("./billing-common");
const { generateDue } = require("./billing-invoices.service");

function startDraftScheduler(configuredActor) {
  if (!configuredActor) return undefined;

  let adminId;
  try {
    adminId = v.id(configuredActor);
  } catch {
    console.error("Billing draft scheduler disabled: invalid platform actor ID.");
    return undefined;
  }

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      const actor = await pool.query(
        "SELECT id FROM platform_admins WHERE id=$1 AND is_active AND role='super_admin'",[adminId]
      );
      if (!actor.rowCount) {
        console.error("Billing draft scheduler skipped: platform actor is unavailable.");
        return;
      }
      const batch = await generateDue({ limit:25 },adminId,"scheduled_batch");
      const conflicts = batch.results.filter((entry) => entry.error).length;
      if (conflicts) console.error("Billing draft scheduler encountered conflicts:",conflicts);
    } catch (error) {
      console.error("Billing draft scheduler failed:",error.code || error.name);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run,15 * 60 * 1000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = { startDraftScheduler };
