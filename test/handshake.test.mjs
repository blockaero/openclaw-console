import assert from "node:assert/strict";
import test from "node:test";
import { findClientWriteKeys } from "../src/policy.mjs";
import { assertClientInitialize, buildInitializeParams, classifyHandshakeResult } from "../src/handshake.mjs";
import { retryDecision, withRetry } from "../src/retry.mjs";

test("initialize params declare no sampling and no client writes", () => {
  const params = buildInitializeParams();
  assert.equal(params.protocolVersion, "2025-03-26");
  assert.deepEqual(params.capabilities, {});
  assert.equal(params.clientInfo.name, "arm-readonly-guard");
  assert.deepEqual(findClientWriteKeys(params), []);
  assert.equal(JSON.stringify(params).includes("last_briefing"), false);
  assert.equal(JSON.stringify(params).includes("last_seen"), false);
  assert.equal(JSON.stringify(params).includes("sampling"), false);
  assert.doesNotThrow(() => assertClientInitialize(params));
});

test("initialize overrides are refused", () => {
  assert.throws(() => buildInitializeParams({ capabilities: { sampling: {} } }), (error) => error.code === "client_initialize_overrides_refused");
  const params = buildInitializeParams();
  params.capabilities = { roots: {} };
  assert.throws(() => assertClientInitialize(params), (error) => error.code === "client_initialize_mismatch");
});

test("a server-generated last-seen timestamp is the only handshake write", () => {
  const quiet = classifyHandshakeResult({
    protocolVersion: "2025-03-26",
    capabilities: {},
    serverInfo: { name: "arm", version: "0" },
    last_seen_at: "2026-10-05T00:00:00.000Z",
    processing_enqueued: false,
    models_invoked: [],
  });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.write, "server_last_seen");

  const unseen = classifyHandshakeResult({
    protocolVersion: "2025-03-26",
    capabilities: {},
    serverInfo: { name: "arm", version: "0" },
  });
  assert.equal(unseen.ok, true);
  assert.equal(unseen.write, "none_observed");
});

test("briefing, processing, sampling, and status fail the handshake", () => {
  const base = {
    protocolVersion: "2025-03-26",
    capabilities: {},
    serverInfo: { name: "arm", version: "0" },
  };
  for (const extra of [
    { last_briefing_at: "2026-10-05T00:00:00.000Z" },
    { last_briefing_version: 2 },
    { processing_enqueued: true },
    { models_invoked: ["claude"] },
    { capabilities: { sampling: {} } },
    { capabilities: { roots: {} } },
    { status: "active" },
    { last_used_at: "2026-10-05T00:00:00.000Z" },
  ]) {
    const verdict = classifyHandshakeResult({ ...base, ...extra });
    assert.equal(verdict.ok, false, JSON.stringify(extra));
  }
});

test("429 and 503 wait 5s, 10s, then 20s and stop after three attempts", async () => {
  const waits = [];
  let attempts = 0;
  await assert.rejects(
    () => withRetry(async () => {
      attempts += 1;
      return { httpStatus: 503 };
    }, async (ms) => waits.push(ms)),
    (error) => error.code === "halt" && error.failures === 3,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [5_000, 10_000, 20_000]);
  assert.equal(retryDecision(403, 1).retry, false);
  assert.equal(retryDecision(400, 1).retry, false);
});
