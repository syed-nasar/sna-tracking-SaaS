const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const enabled = process.env.STEP425_TEST_DB === "1";

test("GPS provisioning HTTP and durable queue on disposable PostgreSQL", { skip: !enabled }, async (t) => {
  assert.match(process.env.DB_NAME || "", /^step425_test_[a-z0-9_]+$/);
  assert.equal(process.env.DB_HOST, "127.0.0.1");
  assert.match(process.env.DB_PORT || "", /^\d+$/);
  assert.notEqual(process.env.DB_PORT, "5432");

  const express = require("express");
  const jwt = require("jsonwebtoken");
  process.env.JWT_SECRET = "step425-disposable-fixture-signing-secret";
  const pool = require("../src/config/db");
  const queue = require("../src/services/gps-provisioning.service");
  const { changeAllocation, setInstallation } = require("../src/services/gps-inventory.service");
  const directories = path.join(__dirname, "../database");
  const sql = (statement, args) => pool.query(statement, args);
  const one = async (statement, args) => (await sql(statement, args)).rows[0];
  const dbVersion = await one("SELECT current_setting('server_version_num')::int AS version");
  t.after(() => pool.end());
  assert.ok(dbVersion.version >= 160000 && dbVersion.version < 170000);
  assert.equal((await one("SELECT to_regclass('public.gps_devices') AS present")).present, null);
  const migrations = fs.readdirSync(directories).filter((name) => /^\d{3}.*\.sql$/.test(name)).sort();
  const apply = (file) => sql(fs.readFileSync(path.join(directories, file), "utf8"));
  for (const file of migrations.filter((name) => !/^(002|017)/.test(name))) await apply(file);

  const admin = await one("INSERT INTO platform_admins(full_name,email,password_hash) VALUES ('Fixture','fixture@example.test','unused') RETURNING id");
  const tenant = await one("INSERT INTO tenants(name,slug) VALUES ('Disposable','fixture') RETURNING id");
  const other = await one("INSERT INTO tenants(name,slug) VALUES ('Other disposable','other') RETURNING id");
  const installed = await one(`INSERT INTO gps_devices(traccar_device_id,unique_identifier,status,lifecycle_status,tenant_id)
    VALUES (10,'installed','assigned','installed',$1) RETURNING id`, [tenant.id]);
  const cutoff = "2026-01-02T03:04:05.000Z";
  const vehicle = await one(`INSERT INTO vehicles(tenant_id,traccar_device_id,name,gps_installed_at)
    VALUES ($1,10,'Legacy vehicle',$2) RETURNING id`, [tenant.id, cutoff]);
  const sim = await one("INSERT INTO sim_cards(label) VALUES ('Fixture SIM') RETURNING id");
  await sql(`INSERT INTO sim_device_assignments(sim_id,device_id,started_at,started_by,start_reason)
    VALUES ($1,$2,now(),$3,'fixture')`, [sim.id, installed.id, admin.id]);
  const legacy = await one("INSERT INTO gps_devices(unique_identifier) VALUES ('legacy-stock') RETURNING id");
  const reserved = await one(`INSERT INTO gps_devices(unique_identifier,tenant_id,status,lifecycle_status)
    VALUES ('reserved-stock',$1,'assigned','reserved') RETURNING id`, [tenant.id]);
  await apply(migrations.find((name) => name.startsWith("017")));
  const inventory = (id) => one("SELECT * FROM gps_devices WHERE id=$1", [id]);
  assert.equal((await inventory(legacy.id)).provisioning_status, "legacy");
  assert.equal((await inventory(installed.id)).provider_verified_at, null);
  assert.equal((await one("SELECT count(*)::int AS count FROM gps_provisioning_attempts")).count, 0);
  assert.equal((await one("SELECT sim_id FROM sim_device_assignments WHERE device_id=$1", [installed.id])).sim_id, sim.id);

  const app = express();
  app.use(express.json());
  app.use("/devices", require("../src/routes/platform-device.routes"));
  const resellerRoutes = require("../src/routes/resellers.routes");
  app.use("/platform-resellers", resellerRoutes.platform);
  app.use("/reseller", resellerRoutes.reseller);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const token = (audience) => jwt.sign({}, process.env.JWT_SECRET, {
    audience, issuer: "sna-fleet-api", subject: admin.id, expiresIn: "1h",
  });
  const platformToken = token("sna-fleet-platform");
  const send = (url, body, bearer = platformToken, method = "POST") => fetch(
    `http://127.0.0.1:${server.address().port}/devices${url}`,
    { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + bearer },
      body: body === undefined ? undefined : JSON.stringify(body) }
  );
  const register = async (uniqueId) => {
    const response = await send("/inventory", { uniqueId });
    assert.equal(response.status, 201);
    return response.json();
  };
  const request = (id, action) => send(`/inventory/${id}/provisioning`, { action });
  const scheduleNow = () => sql("UPDATE gps_provisioning_attempts SET next_retry_at=now() WHERE status='retry'");
  const allocation = (deviceId, action, targetTenantId) => changeAllocation({
    deviceId, targetTenantId, action, actor: { adminId: admin.id },
  });
  const devices = [{ id: 10, uniqueId: "installed" }, { id: 11, uniqueId: "00Fleet-a" },
    { id: 12, uniqueId: "legacy-stock" }, { id: 13, uniqueId: "reserved-stock" }];
  let creations = 0;
  let serial = 30;
  const remote = {
    provisioningDevices: async () => devices.slice(),
    createDevice: async ({ uniqueId }) => {
      creations++;
      const created = { id: serial++, uniqueId };
      devices.push(created);
      return created;
    },
  };

  await t.test("platform-only registration, uniqueness, reuse and allocation readiness", async () => {
    for (const audience of ["sna-fleet-users", "sna-fleet-resellers"]) {
      assert.equal((await send("/inventory", { uniqueId: "blocked" }, token(audience))).status, 401);
    }
    assert.equal((await send("/inventory", { uniqueId: "blocked" }, "")).status, 401);
    const pair = await Promise.all([send("/inventory", { uniqueId: "00Fleet-A" }),
      send("/inventory", { uniqueId: "00fleet-a" })]);
    assert.deepEqual(pair.map((response) => response.status).sort(), [201, 409]);
    const record = await pair.find((response) => response.status === 201).json();
    assert.equal(record.provisioningStatus, "pending");
    await assert.rejects(allocation(record.id, "allocated", tenant.id), { status: 409 });
    const manual = await send(`/inventory/${record.id}/link`, { traccarDeviceId: 11 }, platformToken, "PATCH");
    assert.equal(manual.status, 409);
    await queue.processNext(remote);
    assert.equal((await inventory(record.id)).traccar_device_id, "11");
    assert.equal(creations, 0);
    await allocation(record.id, "allocated", tenant.id);
    await allocation(record.id, "transferred", other.id);
    await allocation(record.id, "released", null);
  });

  await t.test("one worker creates, uncertain outcomes rediscover, and lease recovery fences stale workers", async () => {
    const record = await register("new-stock");
    await Promise.all([queue.processNext(remote), queue.processNext(remote)]);
    assert.equal(creations, 1);
    assert.equal((await inventory(record.id)).provisioning_status, "provisioned");

    const uncertain = await register("timeout-stock");
    await queue.processNext({ ...remote, createDevice: async (input) => {
      await remote.createDevice(input);
      throw Object.assign(Error("synthetic timeout"), { code: "ETIMEDOUT" });
    } });
    assert.equal((await inventory(uncertain.id)).provisioning_status, "retry");
    await scheduleNow();
    await queue.processNext(remote);
    assert.equal((await inventory(uncertain.id)).provisioning_status, "provisioned");
    assert.equal(creations, 2);

    const stale = await register("lease-stock");
    let signal;
    let release;
    const started = new Promise((resolve) => { signal = resolve; });
    const paused = new Promise((resolve) => { release = resolve; });
    const first = queue.processNext({ ...remote, provisioningDevices: async () => {
      signal();
      await paused;
      return [];
    } });
    await started;
    try {
      await sql("UPDATE gps_provisioning_attempts SET lease_until=now()-interval '1 second' WHERE device_id=$1", [stale.id]);
      await queue.processNext(remote);
    } finally {
      release();
      await first;
    }
    assert.equal((await inventory(stale.id)).provisioning_status, "provisioned");
    assert.equal(creations, 3);
  });

  await t.test("persistence failure, provider outage, bounded retries and safe manual retry", async () => {
    const record = await register("persistence-stock");
    await queue.processNext({ ...remote, createDevice: async (input) => {
      const created = await remote.createDevice(input);
      await sql(`CREATE FUNCTION fixture_reject_link() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.unique_identifier='persistence-stock' AND NEW.traccar_device_id IS NOT NULL
          THEN RAISE EXCEPTION 'fixture write failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fixture_reject_link BEFORE UPDATE ON gps_devices FOR EACH ROW EXECUTE FUNCTION fixture_reject_link()`);
      return created;
    } });
    assert.equal((await queue.history(record.id))[0].outcomeCode, "local_persistence");
    await sql("DROP TRIGGER fixture_reject_link ON gps_devices");
    await scheduleNow();
    await queue.processNext(remote);
    assert.equal((await inventory(record.id)).provisioning_status, "provisioned");

    const outage = await register("outage-stock");
    const offline = { ...remote, provisioningDevices: async () => { throw Error("offline fixture"); } };
    for (let i = 0; i < 5; i++) {
      await scheduleNow();
      await queue.processNext(offline);
    }
    assert.equal((await inventory(outage.id)).provisioning_status, "failed");
    assert.equal(await queue.processNext(offline), false);
    assert.equal((await request(outage.id, "retry")).status, 202);
    await queue.processNext(remote);
    assert.equal((await inventory(outage.id)).provisioning_status, "provisioned");
  });

  await t.test("duplicate responses rediscover and provider identity conflicts do not retry", async () => {
    const duplicate = await register("provider-duplicate");
    await queue.processNext({ ...remote, createDevice: async ({ uniqueId }) => {
      devices.push({ id: 90, uniqueId });
      throw { response: { status: 409 } };
    } });
    assert.equal((await queue.history(duplicate.id))[0].outcomeCode, "provider_duplicate");
    await scheduleNow();
    await queue.processNext(remote);
    assert.equal((await inventory(duplicate.id)).traccar_device_id, "90");

    const duplicate400 = await register("provider-duplicate-400");
    await queue.processNext({ ...remote, createDevice: async ({ uniqueId }) => {
      devices.push({ id: 91, uniqueId });
      throw { response: { status: 400 } };
    } });
    assert.equal((await inventory(duplicate400.id)).traccar_device_id, "91");

    const conflict = await register("local-duplicate");
    await queue.processNext({ ...remote, provisioningDevices: async () => [{ id: 10, uniqueId: "local-duplicate" }] });
    assert.equal((await queue.history(conflict.id))[0].outcomeCode, "local_conflict");

    const mismatch = await register("provider-mismatch");
    await queue.processNext({ ...remote, createDevice: async () => ({ id: 99, uniqueId: "wrong" }) });
    assert.equal((await queue.history(mismatch.id))[0].outcomeCode, "identity_mismatch");
    assert.equal(await queue.processNext(remote), false);
  });

  await t.test("reseller stock and customer allocation enforce readiness, scope and suspension", async () => {
    const org = await one(`INSERT INTO resellers(slug,legal_name,display_name,contact_email)
      VALUES ('fixture-scope','Fixture','Fixture','fixture-reseller@example.test') RETURNING id,slug`);
    const user = await one(`INSERT INTO reseller_admins(reseller_id,full_name,email,password_hash)
      VALUES ($1,'Fixture','fixture-reseller@example.test','unused') RETURNING *`, [org.id]);
    const customer = await one(`INSERT INTO tenants(name,slug,reseller_id)
      VALUES ('Scoped','fixture-scoped',$1) RETURNING id`, [org.id]);
    const resellerToken = require("../src/services/resellers").resellerToken({ ...user, slug: org.slug });
    const requestScope = (route, bearer, method, payload) => fetch(
      `http://127.0.0.1:${server.address().port}${route}`, {
        method, headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    const stock = await register("reseller-stock");
    const assign = () => requestScope(`/platform-resellers/${org.id}/inventory/${stock.id}`,
      platformToken, "PUT", { assign: true });
    const assignCustomer = (tenantId) => requestScope(`/reseller/inventory/${stock.id}/allocation`,
      resellerToken, "POST", { tenantId });
    assert.equal((await assign()).status, 409);
    await queue.processNext(remote);
    assert.equal((await assign()).status, 204);
    assert.equal((await assignCustomer(other.id)).status, 404);
    await sql("UPDATE resellers SET status='suspended' WHERE id=$1", [org.id]);
    assert.equal((await assignCustomer(customer.id)).status, 401);
    await sql("UPDATE resellers SET status='active' WHERE id=$1", [org.id]);
    assert.equal((await assignCustomer(customer.id)).status, 204);
    assert.equal((await inventory(stock.id)).tenant_id, customer.id);
  });

  await t.test("conflicts preserve inventory and verification preserves installation and SIM", async () => {
    const ambiguous = await register("ambiguous");
    await queue.processNext({ ...remote, provisioningDevices: async () =>
      [{ id: 80, uniqueId: "ambiguous" }, { id: 81, uniqueId: "AMBIGUOUS" }] });
    assert.equal((await queue.history(ambiguous.id))[0].outcomeCode, "ambiguous_match");

    assert.equal((await request(legacy.id, "provision")).status, 202);
    await queue.processNext(remote);
    assert.equal((await inventory(legacy.id)).traccar_device_id, "12");
    assert.equal((await request(reserved.id, "provision")).status, 202);
    await queue.processNext(remote);
    assert.equal((await inventory(reserved.id)).tenant_id, tenant.id);

    assert.equal((await send(`/inventory/${installed.id}/link`, { traccarDeviceId: 12 }, platformToken, "PATCH")).status, 409);
    assert.equal((await request(installed.id, "verify")).status, 202);
    await queue.processNext(remote);
    assert.equal((await inventory(installed.id)).traccar_device_id, "10");
    assert.equal((await one("SELECT gps_installed_at FROM vehicles WHERE id=$1", [vehicle.id])).gps_installed_at.toISOString(), cutoff);
    assert.equal((await one("SELECT sim_id FROM sim_device_assignments WHERE device_id=$1", [installed.id])).sim_id, sim.id);
    assert.equal((await request(installed.id, "verify")).status, 202);
    await queue.processNext({ ...remote, provisioningDevices: async () => [] });
    assert.equal((await queue.history(installed.id))[0].outcomeCode, "missing_device");
    await setInstallation({ tenantId: tenant.id, vehicleId: vehicle.id, traccarDeviceId: null,
      actor: { adminId: admin.id }, removeDeviceId: installed.id });
    await allocation(installed.id, "released", null);
  });
});
