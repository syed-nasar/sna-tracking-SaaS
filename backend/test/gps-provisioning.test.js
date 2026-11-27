const { test } = require("node:test");
const assert = require("node:assert/strict");
const { discover, providerFailure } = require("../src/services/gps-provisioning.service");

const device = { unique_identifier: "00Fleet-A" };
const match = { id: 27, uniqueId: "00fleet-a" };

test("discovery preserves leading zeros, rejects ambiguity, and validates complete lists", () => {
  assert.deepEqual(discover([match], device, {}), { match: { id: "27", uniqueId: "00fleet-a" } });
  assert.deepEqual(discover([], device, {}), { match: undefined });
  assert.equal(discover([match, { ...match, id: 28 }], device, {}).code, "ambiguous_match");
  for (const raw of [null, { items: [] }, [{ id: 0, uniqueId: match.uniqueId }], [match, match]]) {
    assert.equal(discover(raw, device, {}).code, "invalid_response");
  }
});

test("verification and manual recovery cannot replace or misidentify the numeric mapping", () => {
  assert.equal(discover([match], { ...device, traccar_device_id: "34" }, {}).code, "missing_device");
  assert.equal(discover([match], { unique_identifier: "other" }, { requested_provider_id: "27" }).code, "identity_mismatch");
});

test("provider errors classify timeout, authentication, duplicate, and validation outcomes", () => {
  assert.equal(providerFailure({ code: "ETIMEDOUT" }, false).code, "provider_timeout");
  assert.equal(providerFailure({ code: "ETIMEDOUT" }, true).code, "uncertain_create");
  for (const [status, code] of [[401,"provider_configuration"],[403,"provider_configuration"],
    [400,"provider_validation"],[409,"provider_duplicate"],[500,"uncertain_create"]]) {
    assert.equal(providerFailure({ response: { status } }, true).code, code);
  }
});
