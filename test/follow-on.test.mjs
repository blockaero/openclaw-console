import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { auditCheckpoint, emptyAuditImage } from "../src/auditor.mjs";
import { createGuard } from "../src/guard.mjs";
import { assertBindPort } from "../src/guard-access.mjs";
import { startGuardServer } from "../src/guard-server.mjs";
import { runScriptedJob } from "../src/jobs.mjs";
import { ladderAllows } from "../src/ladder.mjs";
import { isPhase3Placeholder, PHASE3_CAPABILITIES } from "../src/phase3.mjs";
import { runSmoke } from "../src/smoke.mjs";
import { verifyToolsList } from "../src/tools-list.mjs";
import { fakeTransport } from "./helpers.mjs";

const SLOT = "2026-10-05T13:05:00Z";
const C4 = { pass: true, through: "C4" };

function principalImage(principal) {
  const image = emptyAuditImage();
  image.principals = [principal];
  return image;
}

test("tools/list verification records advertised schema fields and halts on one extra name", () => {
  const clean = verifyToolsList({
    tools: [
      { name: "get_pulse_head", inputSchema: { type: "object", properties: {} } },
      { name: "list_work_items", inputSchema: { type: "object", properties: { cursor: { type: "string" } } } },
    ],
  });
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.schemas.list_work_items.named_fields, ["cursor"]);
  assert.deepEqual(clean.schemas.get_pulse_head.named_fields, []);
  assert.equal(Object.hasOwn(clean.schemas.list_work_items.input_schema.properties, "next_cursor"), false);

  const halted = verifyToolsList({ tools: [{ name: "get_pulse_head" }, { name: "get_briefing" }] });
  assert.equal(halted.ok, false);
  assert.deepEqual(halted.callable, []);
  assert.deepEqual(halted.extras, ["get_briefing"]);
});

test("phase-3 placeholder names stay uncallable", () => {
  for (const name of ["get_part_trace", "list_life_limits", "get_record_text", "list_asset_records", "get_doc_type_registry", "list_certificates"]) {
    assert.equal(isPhase3Placeholder(name), true);
    assert.equal(ladderAllows(name, { mode: "smoke" }).ok, false);
  }
  assert.equal(PHASE3_CAPABILITIES.every((capability) => capability.tools.length === 0), true);
  const listed = verifyToolsList({ tools: [{ name: "get_part_trace" }] });
  assert.equal(listed.ok, false);
  assert.deepEqual(listed.callable, []);
});

test("standing jobs need C4, and unattended jobs need C5 plus a receipt", () => {
  assert.equal(ladderAllows("get_pulse_head", { mode: "smoke" }).ok, true);
  assert.equal(ladderAllows("get_pulse_head", { mode: "attended" }).reason, "uncertified");
  assert.equal(ladderAllows("get_pulse_head", { mode: "attended", certification: { get_pulse_head: C4 } }).ok, true);
  assert.equal(ladderAllows("get_pulse_head", {
    mode: "unattended",
    certification: { get_pulse_head: C4 },
  }).reason, "uncertified");
  assert.equal(ladderAllows("get_pulse_head", {
    mode: "unattended",
    certification: { get_pulse_head: { pass: true, through: "C5" } },
  }).reason, "receipt_missing");
  assert.equal(ladderAllows("get_pulse_head", {
    mode: "unattended",
    certification: { get_pulse_head: { pass: true, through: "C5", receipt: true } },
  }).ok, true);
});

test("a certified attended job renders from facts and quarantines when the audit image is missing", async () => {
  const transport = fakeTransport({
    tools: [{ name: "get_pulse_head" }, { name: "get_account_pulse" }],
  });
  const guard = createGuard({ transport, halted: true });
  const certification = { get_pulse_head: C4, get_account_pulse: C4 };
  const missing = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: SLOT,
    guard,
    armReadonlyLevelReady: true,
    certification,
  });
  assert.equal(missing.action, "quarantine");
  assert.equal(missing.verdict, "unverified");
  assert.equal(missing.delivered, false);
  assert.deepEqual(missing.tools, ["get_pulse_head", "get_account_pulse"]);

  const image = emptyAuditImage();
  const rendered = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: SLOT,
    guard: createGuard({
      transport: fakeTransport({ tools: [{ name: "get_pulse_head" }, { name: "get_account_pulse" }] }),
      halted: true,
    }),
    armReadonlyLevelReady: true,
    certification,
    audit: { before: image, mid: structuredClone(image) },
  });
  assert.equal(rendered.action, "rendered");
  assert.equal(rendered.phrase, false);
  assert.equal(rendered.done, false);
  assert.equal(rendered.state, "RENDER");
  assert.equal(rendered.template.includes("Records: 2"), true);
  assert.equal(rendered.template.includes("pulse_head: 1"), true);
});

test("decision 5 allows one last-seen timestamp and fails a briefing write", () => {
  const before = principalImage({
    id: "prin_1",
    last_seen_at: "t0",
    last_briefing_at: null,
    last_briefing_version: null,
    last_briefing_via: null,
    status: "active",
  });
  const seen = principalImage({
    id: "prin_1",
    last_seen_at: "t1",
    last_briefing_at: null,
    last_briefing_version: null,
    last_briefing_via: null,
    status: "active",
  });
  const handshake = auditCheckpoint({
    checkpoint: "after_initialize",
    before,
    after: seen,
    principalId: "prin_1",
  });
  assert.equal(handshake.verdict, "clean");
  assert.equal(handshake.allowed_soft_writes.length, 1);
  assert.equal(handshake.allowed_soft_writes[0].column, "last_seen_at");

  const briefed = principalImage({
    id: "prin_1",
    last_seen_at: "t0",
    last_briefing_at: "t1",
    last_briefing_version: null,
    last_briefing_via: null,
    status: "active",
  });
  const briefing = auditCheckpoint({
    checkpoint: "after_initialize",
    before,
    after: briefed,
    principalId: "prin_1",
  });
  assert.equal(briefing.verdict, "violation");
  assert.equal(briefing.unexpected_deltas[0].what_changed, "last_briefing_at");
});

test("later calls tolerate decision 2 only, and a new login row is not clean", () => {
  const before = emptyAuditImage();
  before.principals = [{
    id: "prin_1",
    last_seen_at: "t0",
    last_briefing_at: null,
    last_briefing_version: null,
    last_briefing_via: null,
    status: "active",
  }];
  const after = structuredClone(before);
  after.principals[0].last_seen_at = "t1";
  after.chat_run_leases = [{
    id: "lease_1",
    principal_id: "prin_1",
    kind: "presence",
    heartbeat_at: "t1",
    started_at: "t1",
    status: "open",
  }];
  const mid = auditCheckpoint({
    checkpoint: "mid",
    before,
    after,
    principalId: "prin_1",
    expectedCalls: 2,
  });
  assert.equal(mid.verdict, "clean");
  assert.equal(mid.pass, true);

  const leaseOnHandshake = auditCheckpoint({
    checkpoint: "after_initialize",
    before,
    after,
    principalId: "prin_1",
  });
  assert.equal(leaseOnHandshake.verdict, "violation");

  const logged = structuredClone(before);
  logged.login_events = [{ id: "login_1" }];
  const login = auditCheckpoint({
    checkpoint: "post",
    before,
    after: logged,
    principalId: "prin_1",
    expectedCalls: 0,
  });
  assert.equal(login.verdict, "flagged_unresolved_login_events");
  assert.equal(login.pass, false);

  const late = structuredClone(before);
  late.pipeline_log = [{ id: "pipe_1" }];
  const retracted = auditCheckpoint({
    checkpoint: "late",
    before,
    after: late,
    principalId: "prin_1",
    expectedCalls: 0,
  });
  assert.equal(retracted.verdict, "retract");
});

test("a credential hash is refused and is not copied into the verdict", () => {
  const image = emptyAuditImage();
  image.principal_credentials = [{ id: "cred_1", principal_id: "prin_1", token_hash: "hash_do_not_copy" }];
  const result = auditCheckpoint({ checkpoint: "baseline", before: image });
  assert.equal(result.verdict, "unverified");
  assert.equal(result.reason, "credential_hash_refused");
  assert.equal(JSON.stringify(result).includes("hash_do_not_copy"), false);
});

test("a clean injected audit still does not pass the smoke without capture", async () => {
  const image = emptyAuditImage();
  const result = await runSmoke({
    armReadonlyLevelReady: true,
    principalId: "prin_1",
    transport: fakeTransport({ tools: [{ name: "get_pulse_head" }] }),
    accounts: [{ account_id: "acct_a", label: "alpha", key_env: "ARM_SMOKE_PIN_A" }],
    audit: {
      before: image,
      afterInitialize: structuredClone(image),
      mid: structuredClone(image),
      post: structuredClone(image),
    },
  });
  assert.equal(result.zero_writes.pass, true);
  assert.equal(result.zero_writes.verdict, "clean");
  assert.equal(result.tv_capture, "not_run");
  assert.equal(result.pass, false);
  assert.equal(result.openclaw_mcp_exercised, false);
});

test("server capability requests halt locally, and the loopback guard refuses a missing token", async () => {
  const transport = fakeTransport({ tools: [{ name: "get_pulse_head" }] });
  const guard = createGuard({ transport, halted: false });
  await guard.precheck();
  const before = transport.calls.length;
  const sampling = guard.ingest({ method: "sampling/createMessage" });
  assert.equal(sampling.reason, "server_capability_halt");
  assert.equal(guard.state, "HALTED");
  await assert.rejects(() => guard.call("get_pulse_head", {}), (error) => error.code === "tool_denied");
  assert.equal(transport.calls.length, before);
  assert.equal(guard.ingest({ method: "resources/read", uri: "arm://account/pulse" }).reason, "resource_refused");

  assert.throws(() => assertBindPort(8788), (error) => error.code === "forbidden_port");
  const halted = createGuard({ transport: fakeTransport(), halted: true });
  const server = await startGuardServer({ token: "armguard_test", guard: halted, port: 0 });
  try {
    const anonymous = await post(server.port, "/v1/precheck", {});
    assert.equal(anonymous.status, 401);
    const opened = await post(server.port, "/v1/precheck", { token: "armguard_test", origin: "https://example.test" });
    assert.equal(opened.status, 403);
    const accepted = await post(server.port, "/v1/precheck", { token: "armguard_test" });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.reason, "halted");
    assert.equal(halted.armCalls, 0);
  } finally {
    await server.close();
  }
});

function post(port, path, { token, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(origin ? { origin } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        });
      });
    });
    request.on("error", reject);
    request.end(JSON.stringify(body ?? {}));
  });
}
