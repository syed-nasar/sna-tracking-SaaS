const { randomUUID } = require("node:crypto");
const pool = require("../config/db");
const provider = require("./traccar.service");
const { fail, parseId, transaction, event } = require("./gps-inventory.service");

const active = ["pending", "processing", "retry"];
const maxAttempts = 5;
const reasons = {
  provider_unavailable: "Traccar is unavailable.",
  provider_timeout: "Traccar discovery timed out.",
  provider_configuration: "Check the Traccar service URL and administrator credentials.",
  provider_validation: "Traccar rejected the device details.",
  provider_duplicate: "Traccar reported a duplicate identifier. Discovery will retry.",
  invalid_response: "Traccar did not return a complete valid device response.",
  uncertain_create: "Traccar did not confirm creation. Retry runs discovery only.",
  ambiguous_match: "More than one Traccar device matches this identifier.",
  local_conflict: "The identifier or Traccar ID is already linked to another inventory record.",
  missing_device: "No matching Traccar device was found.",
  identity_mismatch: "The Traccar identity does not match the inventory record.",
  local_persistence: "SNA could not persist the provisioning result.",
  ineligible: "The inventory or requesting administrator is no longer eligible.",
};

const outcome = (code, status = "failed") => ({ code, status });
const normalize = (id) => id.trim().toLowerCase();

async function audit(client, id, action, code = null) {
  await client.query(
    "INSERT INTO gps_provisioning_events (attempt_id,action,outcome_code) VALUES ($1,$2,$3)",
    [id, action, code]
  );
}

async function authorized(client, actor) {
  const result = await client.query(
    "SELECT id FROM platform_admins WHERE id=$1 AND is_active AND role='super_admin' FOR SHARE", [actor]
  );
  return result.rowCount > 0;
}

async function enqueue(client, device, actor, mode, action, requestedId = null) {
  if (device.lifecycle_status === "retired" || device.lifecycle_status === "faulty" ||
      (mode === "verify" && !device.traccar_device_id) ||
      (mode === "provision" && (device.traccar_device_id || !device.unique_identifier))) {
    fail(409, "This device is ineligible for the requested provisioning operation.");
  }
  if (active.includes(device.provisioning_status)) fail(409, "A provisioning request is already active.");
  if (!await authorized(client, actor)) fail(403, "Platform administrator permission is no longer valid.");
  const { rows: [attempt] } = await client.query(
    `INSERT INTO gps_provisioning_attempts (device_id,platform_admin_id,mode,status,requested_provider_id)
     VALUES ($1,$2,$3,'pending',$4) RETURNING id`, [device.id, actor, mode, requestedId]
  );
  await client.query("UPDATE gps_devices SET provisioning_status='pending' WHERE id=$1", [device.id]);
  await audit(client, attempt.id, action);
  return attempt.id;
}

async function claim() {
  return transaction(async (client) => {
    const { rows: [device] } = await client.query(
      `SELECT d.*, a.id AS attempt_id FROM gps_provisioning_attempts a JOIN gps_devices d ON d.id=a.device_id
       WHERE (a.status IN ('pending','retry') AND a.next_retry_at<=clock_timestamp())
          OR (a.status='processing' AND a.lease_until<=clock_timestamp())
       ORDER BY a.next_retry_at,a.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`
    );
    if (!device) return null;
    const { rows: [attempt] } = await client.query(
      `UPDATE gps_provisioning_attempts SET status='processing',lease_owner=$2,
         lease_until=clock_timestamp()+interval '90 seconds', attempt_count=attempt_count+1
       WHERE id=$1 AND ((status IN ('pending','retry') AND next_retry_at<=clock_timestamp())
         OR (status='processing' AND lease_until<=clock_timestamp())) RETURNING *`,
      [device.attempt_id, randomUUID()]
    );
    if (!attempt) return null;
    await client.query("UPDATE gps_devices SET provisioning_status='processing' WHERE id=$1", [device.id]);
    await audit(client, attempt.id, "processing");
    return { device, attempt };
  });
}

function sameInventory(before, after) {
  return ["traccar_device_id", "unique_identifier", "tenant_id", "reseller_id", "lifecycle_status"]
    .every((key) => before[key] === after[key]);
}

async function fenced(job, operation) {
  return transaction(async (client) => {
    const { rows: [current] } = await client.query("SELECT * FROM gps_devices WHERE id=$1 FOR UPDATE", [job.device.id]);
    const { rowCount } = await client.query(
      `SELECT id FROM gps_provisioning_attempts WHERE id=$1 AND status='processing'
       AND lease_owner=$2 AND lease_until>clock_timestamp() FOR UPDATE`, [job.attempt.id, job.attempt.lease_owner]
    );
    if (!current || !rowCount) return null;
    const eligible = sameInventory(job.device, current) &&
      !["faulty", "retired"].includes(current.lifecycle_status) && await authorized(client, job.attempt.platform_admin_id);
    return operation(client, current, eligible);
  });
}

function providerFailure(error, creating) {
  const status = error.response?.status;
  if ([401, 403].includes(status)) return outcome("provider_configuration");
  if (creating && status === 409) return outcome("provider_duplicate", "retry");
  if (status === 400 || status === 422) return outcome("provider_validation");
  if (creating) return outcome("uncertain_create", "retry");
  if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code)) return outcome("provider_timeout", "retry");
  if (!status || status === 429 || status >= 500) return outcome("provider_unavailable", "retry");
  return outcome("invalid_response");
}

function identity(raw) {
  const id = parseId(raw?.id);
  const uniqueId = typeof raw?.uniqueId === "string" ? raw.uniqueId.trim() : "";
  return id && uniqueId && uniqueId.length <= 100 && !uniqueId.includes("\0") ? { id, uniqueId } : null;
}

function discover(rows, device, attempt) {
  if (!Array.isArray(rows)) return outcome("invalid_response");
  const devices = rows.map(identity);
  if (devices.some((item) => !item) || new Set(devices.map((item) => item.id)).size !== devices.length) {
    return outcome("invalid_response");
  }
  const expectedId = device.traccar_device_id || attempt.requested_provider_id;
  const selected = expectedId ? devices.find(({ id }) => id === expectedId) : null;
  if (expectedId && !selected) return outcome("missing_device", "conflict");
  const identifier = device.unique_identifier || selected?.uniqueId;
  if (!identifier || (selected && normalize(selected.uniqueId) !== normalize(identifier))) {
    return outcome("identity_mismatch", "conflict");
  }
  const matches = devices.filter(({ uniqueId }) => normalize(uniqueId) === normalize(identifier));
  if (matches.length > 1) return outcome("ambiguous_match", "conflict");
  return { match: matches[0] };
}

async function resolve(job, traccar) {
  const { device, attempt } = job;
  let rows;
  try {
    rows = await traccar.provisioningDevices();
  } catch (error) {
    return providerFailure(error, false);
  }
  if (rows === null) return outcome("provider_configuration");
  const found = discover(rows, device, attempt);
  if (found.code) return found;
  if (found.match) {
    const action = attempt.mode === "manual" ? "manual_recovery_completed" :
      attempt.mode === "verify" ? "provider_identity_verified" : "provider_device_reused";
    return { status: "provisioned", mapping: found.match, action };
  }
  if (device.provider_create_uncertain) return outcome("uncertain_create", "retry");
  if (attempt.mode !== "provision" || device.tenant_id || device.reseller_id ||
      device.lifecycle_status !== "available") return outcome("missing_device", "conflict");

  // Persist intent before POST. A crash or timeout leaves discovery as the only safe next action.
  const allowed = await fenced(job, async (client, current, eligible) => {
    if (!eligible || current.provider_create_uncertain) return false;
    await client.query("UPDATE gps_devices SET provider_create_uncertain=true WHERE id=$1", [device.id]);
    await audit(client, attempt.id, "provider_create_started");
    return true;
  });
  if (!allowed) return outcome("ineligible", "conflict");
  let created;
  try {
    created = await traccar.createDevice({
      name: device.device_name || ("GPS " + device.unique_identifier), uniqueId: device.unique_identifier,
    });
  } catch (error) {
    if (error.response?.status === 400) {
      // Traccar 6.17 uses HTTP 400 for both invalid details and exact duplicates.
      let recheck;
      try {
        recheck = discover(await traccar.provisioningDevices(), device, attempt);
      } catch {
        return outcome("uncertain_create", "retry");
      }
      if (recheck.match) {
        return { status: "provisioned", mapping: recheck.match, action: "provider_device_reused" };
      }
      if (recheck.status === "conflict") return recheck;
      if (recheck.code) return outcome("uncertain_create", "retry");
    }
    const result = providerFailure(error, true);
    // Authentication or a confirmed validation rejection allows a later corrected request.
    return { ...result, clearIntent: ["provider_configuration", "provider_validation"].includes(result.code) };
  }
  const mapping = identity(created);
  if (!mapping || normalize(mapping.uniqueId) !== normalize(device.unique_identifier)) {
    return outcome("identity_mismatch", "conflict");
  }
  return { status: "provisioned", mapping, action: "provider_device_created" };
}

async function finalize(job, result) {
  const { device, attempt } = job;
  return fenced(job, async (client, current, eligible) => {
    if (!eligible) result = outcome("ineligible", "conflict");
    const { mapping, code, action, clearIntent } = result;
    const status = result.status === "retry" && attempt.attempt_count >= maxAttempts ? "failed" : result.status;
    if (mapping) {
      await client.query(
        `UPDATE gps_devices SET traccar_device_id=$2,unique_identifier=COALESCE(unique_identifier,$3),
         provider_verified_at=clock_timestamp(),provider_create_uncertain=false,provisioning_status=$4,
         updated_at=clock_timestamp() WHERE id=$1`, [device.id, mapping.id, mapping.uniqueId, status]
      );
      if (!current.traccar_device_id || !current.unique_identifier) {
        await event(client, device.id, "linked", { adminId: attempt.platform_admin_id }, { traccarDeviceId: mapping.id });
        await audit(client, attempt.id, "provider_mapping_linked");
      }
      await audit(client, attempt.id, action);
    } else {
      await client.query(
        `UPDATE gps_devices SET provisioning_status=$2,
         provider_create_uncertain=provider_create_uncertain AND NOT $3 WHERE id=$1`,
        [device.id, status, Boolean(clearIntent)]
      );
    }
    const backoff = Math.min(300, 5 * 2 ** Math.min(6, attempt.attempt_count - 1));
    await client.query(
      `UPDATE gps_provisioning_attempts SET status=$2,outcome_code=$3,provider_device_id=$4,
         lease_owner=NULL,lease_until=NULL,next_retry_at=clock_timestamp()+$5*interval '1 second',
         completed_at=CASE WHEN $2='retry' THEN NULL ELSE clock_timestamp() END WHERE id=$1`,
      [attempt.id, status, code || null, mapping?.id || null, backoff]
    );
    await audit(client, attempt.id, {
      provisioned: "provisioning_succeeded", retry: "retry_scheduled",
      conflict: "provisioning_conflict", failed: "provisioning_failed",
    }[status], code);
    return true;
  });
}

async function processNext(traccar = provider) {
  const job = await claim();
  if (!job) return false;
  try {
    const eligible = await fenced(job, (_client, _current, valid) => valid);
    const result = !eligible ? outcome("ineligible", "conflict") :
      job.attempt.attempt_count > maxAttempts ? outcome("local_persistence") : await resolve(job, traccar);
    await finalize(job, result);
  } catch (error) {
    await finalize(job, error.code === "23505" ? outcome("local_conflict", "conflict") :
      outcome("local_persistence", "retry"));
  }
  return true;
}

async function history(id) {
  const { rows } = await pool.query(
    `SELECT a.id,a.mode,a.status,a.attempt_count AS "attemptCount",a.outcome_code AS "outcomeCode",
      a.platform_admin_id AS "actorId",a.provider_device_id AS "providerDeviceId",
      a.created_at AS "createdAt",a.completed_at AS "completedAt",a.next_retry_at AS "nextRetryAt",
      COALESCE((SELECT json_agg(e ORDER BY e.id) FROM
        (SELECT action,outcome_code AS "outcomeCode",created_at AS "createdAt",id
         FROM gps_provisioning_events WHERE attempt_id=a.id ORDER BY id DESC LIMIT 50) e),'[]') AS events
      FROM gps_provisioning_attempts a WHERE device_id=$1 ORDER BY id DESC LIMIT 30`, [id]
  );
  return rows.map((row) => ({ ...row, reason: reasons[row.outcomeCode] || null }));
}

const diagnostics = { running: false, startedAt: null, lastPollAt: null, lastErrorAt: null };
function startProvisioningWorker() {
  if (diagnostics.running) return async () => {};
  let stopped = false;
  let timer;
  let work;
  diagnostics.running = true;
  diagnostics.startedAt = new Date().toISOString();
  function tick() {
    work = (async () => {
      try {
        for (let jobs = 0; !stopped && jobs < 4; jobs++) {
          if (!await processNext()) break;
        }
        diagnostics.lastPollAt = new Date().toISOString();
      } catch {
        diagnostics.lastErrorAt = new Date().toISOString();
        console.error("GPS provisioning worker poll failed.");
      }
      if (!stopped) timer = setTimeout(tick, 2500);
    })();
  }
  timer = setTimeout(tick, 2500);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await work;
    diagnostics.running = false;
  };
}

module.exports = { enqueue, processNext, history, startProvisioningWorker, diagnostics, discover, providerFailure };
