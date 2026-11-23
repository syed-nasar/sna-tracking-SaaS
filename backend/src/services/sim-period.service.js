const pool = require("../config/db");
const { fail, transaction } = require("./gps-inventory.service");
const { audit, lockedSim } = require("./sim-inventory.service");
const v = require("./connectivity-validation");

function utcDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function recordPeriod(simId, kind, body, adminId) {
  const renewal = kind === "renewal";
  const input = v.fields(body, {
    ...(renewal ? {} : { planId: v.id, startDate: v.date }),
    expectedPeriodId: v.optionalId, requestKey: v.pattern(/^[\w-]{8,80}$/, undefined, false),
    providerReference: v.text(150), notes: v.text(1000),
  }, ["expectedPeriodId", "requestKey", ...(renewal ? [] : ["planId", "startDate"])]);
  if (!renewal && !input.startDate) fail(400, "A plan start date is required.");
  return transaction(async (client) => {
    const sim = await lockedSim(client, simId);
    const { rows: [existing] } = await client.query(
      "SELECT * FROM sim_plan_periods WHERE sim_id=$1 AND request_key=$2", [simId, input.requestKey]
    );
    if (existing) {
      if (existing.kind !== kind || existing.expected_period_id !== input.expectedPeriodId ||
          (!renewal && (existing.plan_id !== input.planId || utcDay(existing.starts_at) !== input.startDate)) ||
          existing.provider_reference !== (input.providerReference ?? null) || existing.notes !== (input.notes ?? null)) {
        fail(409, "This request key was already used for a different period.");
      }
      return { id: existing.id, replayed: true };
    }
    if (sim.lifecycle === "retired") fail(409, "A retired SIM cannot receive a plan or renewal.");
    const { rows: [latest] } = await client.query(
      `SELECT id, plan_id, starts_at, COALESCE(superseded_at, expires_at) AS effective_end
       FROM sim_plan_periods WHERE sim_id=$1 ORDER BY starts_at DESC LIMIT 1`, [simId]
    );
    if ((latest?.id ?? null) !== input.expectedPeriodId) fail(409, "Plan history changed. Refresh before recording another period.");
    if (renewal && !latest) fail(409, "Assign a plan before recording a renewal.");
    const planId = renewal ? latest.plan_id : input.planId;
    const { rows: [plan] } = await client.query(
      `SELECT p.*, o.is_active AS operator_active FROM connectivity_plans p
       JOIN mobile_operators o ON o.id=p.operator_id WHERE p.id=$1 FOR SHARE OF p,o`, [planId]
    );
    if (!plan) fail(404, "Connectivity plan not found.");
    if (!plan.is_active || !plan.operator_active) fail(409, "Choose a plan from an active operator.");
    if (plan.operator_id !== sim.operator_id) fail(409, "The plan and SIM must use the same operator.");
    const { rows: [{ today }] } = await client.query("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS today");
    const latestEnd = latest ? utcDay(latest.effective_end) : null;
    const start = renewal ? (latestEnd > today ? latestEnd : today) : input.startDate;
    if (start < today || (latest && start <= utcDay(latest.starts_at))) {
      fail(409, "Choose a UTC date on or after today and later than the last recorded period start.");
    }
    if (latest && start < latestEnd) {
      await client.query(
        "UPDATE sim_plan_periods SET superseded_at=$2::date::timestamp AT TIME ZONE 'UTC' WHERE id=$1", [latest.id, start]
      );
    }
    const terms = {
      name: plan.name, operatorId: plan.operator_id, scope: plan.scope, allowanceMb: plan.allowance_mb,
      validityDays: plan.validity_days, billingCycle: plan.billing_cycle, currency: plan.currency,
      recurringCost: plan.recurring_cost, customerPrice: plan.customer_price, activationFee: plan.activation_fee,
      customerVisible: plan.customer_visible,
    };
    const { rows: [period] } = await client.query(
      `INSERT INTO sim_plan_periods (
         sim_id, plan_id, kind, starts_at, expires_at, terms, request_key, expected_period_id, provider_reference, notes, recorded_by
       ) VALUES ($1,$2,$3,$4::date::timestamp AT TIME ZONE 'UTC',
         ($4::date + $5::integer)::timestamp AT TIME ZONE 'UTC',$6,$7,$8,$9,$10,$11)
       RETURNING id, starts_at, expires_at`, [
        simId, planId, kind, start, plan.validity_days, terms, input.requestKey, input.expectedPeriodId,
        input.providerReference ?? null, input.notes ?? null, adminId,
      ]
    );
    await audit(client, simId, adminId, renewal ? "renewed" : "plan_changed", {
      previousPeriodId: latest?.id ?? null, previousPlanId: latest?.plan_id ?? null,
      planId, periodId: period.id, startsAt: period.starts_at, expiresAt: period.expires_at,
    });
    return { id: period.id, replayed: false };
  });
}

const historyQueries = {
  assignments: `SELECT a.id, a.device_id AS "deviceId",
    COALESCE(d.device_name, d.unique_identifier, 'GPS device #'||d.id) AS "deviceName",
    a.started_at AS "startedAt", a.ended_at AS "endedAt", a.start_reason AS "startReason",
    a.end_reason AS "endReason", a.started_by AS "startedBy", a.ended_by AS "endedBy",
    starter.full_name AS "startedByName", ender.full_name AS "endedByName"
    FROM sim_device_assignments a JOIN gps_devices d ON d.id=a.device_id
    JOIN platform_admins starter ON starter.id=a.started_by LEFT JOIN platform_admins ender ON ender.id=a.ended_by`,
  periods: `SELECT a.id, a.plan_id AS "planId", a.kind, a.terms, a.starts_at AS "startsAt",
    a.expires_at AS "expiresAt", a.superseded_at AS "supersededAt", a.provider_reference AS "providerReference",
    a.notes, a.created_at AS "createdAt", a.recorded_by AS "actorId", p.full_name AS "actorName"
    FROM sim_plan_periods a JOIN platform_admins p ON p.id=a.recorded_by`,
  audit: `SELECT a.id, a.action, a.details, a.reason, a.created_at AS "createdAt",
    a.platform_admin_id AS "actorId", p.full_name AS "actorName"
    FROM sim_audit_events a JOIN platform_admins p ON p.id=a.platform_admin_id`,
};

async function history(simId, kind, query) {
  const paging = v.queryPage(query, []);
  const exists = await pool.query("SELECT 1 FROM sim_cards WHERE id=$1", [simId]);
  if (!exists.rowCount) fail(404, "SIM not found.");
  const { rows } = await pool.query(
    `${historyQueries[kind]} WHERE a.sim_id=$1 ORDER BY a.id DESC LIMIT $2 OFFSET $3`,
    [simId, paging.limit + 1, paging.offset]
  );
  return v.page(rows, paging);
}

module.exports = { recordPeriod, history };
