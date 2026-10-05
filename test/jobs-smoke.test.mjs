import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runScriptedJob } from "../src/jobs.mjs";
import { loadArmRoDirection } from "../src/profile.mjs";
import { runSmoke } from "../src/smoke.mjs";
import { scoreModelOutput } from "../src/score.mjs";
import { refusingTransport } from "../src/transport.mjs";
import { createGuard } from "../src/guard.mjs";
import { fakeTransport } from "./helpers.mjs";

const SLOT = "2026-10-05T13:05:00Z";

test("profile direction is tool-less and jobs do not catch up", () => {
  const { profile, jobs } = loadArmRoDirection();
  assert.equal(profile.gateway.port, 19789);
  assert.equal(profile.agents.defaults.heartbeat.every, "0m");
  assert.equal("mcp" in profile, false);
  assert.equal(jobs.exact, true);
  assert.equal(jobs.catch_up, false);
  assert.equal(jobs.tz, "America/Los_Angeles");
  const phase3 = jobs.jobs.find((job) => job.id === "phase3");
  assert.deepEqual(phase3.tools, []);
});

test("the policy hook blocks every tool", async () => {
  const policy = await import("../profiles/arm-ro/policy.mjs");
  assert.deepEqual(policy.trustedToolPolicy(), { block: true, blockReason: "arm-ro: no tools" });
  assert.equal(policy.beforeToolCall().block, true);
  assert.equal(policy.registerTool, undefined);
});

test("a missed slot is not replayed and a halted job does not call ARM", async () => {
  const missed = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: "2026-10-05T14:05:00Z",
  });
  assert.equal(missed.action, "missed");
  assert.equal(missed.reason, "no_catch_up");
  assert.equal(missed.arm_calls, 0);

  const done = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: SLOT,
    doneRunIds: [`j1:example:${SLOT}`],
  });
  assert.equal(done.action, "skip");
  assert.equal(done.arm_calls, 0);

  const transport = fakeTransport({ tools: [{ name: "get_pulse_head" }, { name: "get_account_pulse" }] });
  const blocked = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: SLOT,
    guard: createGuard({ transport, halted: true }),
    armReadonlyLevelReady: false,
  });
  assert.equal(blocked.action, "blocked");
  assert.equal(blocked.reason, "halted");
  assert.equal(transport.calls.length, 0);

  const phase3 = await runScriptedJob({ jobId: "phase3", accountLabel: "example", slotUtc: SLOT, nowUtc: SLOT });
  assert.equal(phase3.reason, "phase3_waiting_on_arm_tool");
  assert.deepEqual(phase3.tools, []);
});

test("an attended slot without a C4 certificate does not call ARM", async () => {
  const transport = fakeTransport({
    tools: [
      { name: "get_pulse_head" },
      { name: "get_account_pulse" },
    ],
  });
  const guard = createGuard({ transport, halted: true });
  const result = await runScriptedJob({
    jobId: "j1",
    accountLabel: "example",
    slotUtc: SLOT,
    nowUtc: SLOT,
    guard,
    armReadonlyLevelReady: true,
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "uncertified");
  assert.equal(result.run_id, `j1:example:${SLOT}`);
  assert.equal(transport.calls.length, 0);
});

test("the default smoke does not call ARM and does not leak a key", async () => {
  const previous = process.env.ARM_SMOKE_PIN_EXAMPLE;
  process.env.ARM_SMOKE_PIN_EXAMPLE = "armpin_do_not_leak";
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    fetches += 1;
    throw new Error("fetch");
  };
  try {
    const transport = fakeTransport();
    const result = await runSmoke({
      accounts: [{ account_id: "acct_example", label: "example", key_env: "ARM_SMOKE_PIN_EXAMPLE" }],
      transport,
    });
    assert.equal(result.pass, false);
    assert.equal(result.openclaw_mcp_exercised, false);
    assert.equal(result.option, "B");
    assert.equal(result.blocked_on, "arm_read_only_level");
    assert.equal(result.handshake.client_attempted_briefing_write, false);
    assert.equal(result.handshake.client_attempted_processing_write, false);
    assert.equal(result.handshake.server_may_write, "one_server_generated_last_seen_timestamp");
    assert.equal(transport.calls.length, 0);
    assert.equal(fetches, 0);
    assert.equal(JSON.stringify(result).includes("armpin_do_not_leak"), false);
    assert.equal(result.accounts[0].key_env, "ARM_SMOKE_PIN_EXAMPLE");
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.ARM_SMOKE_PIN_EXAMPLE;
    else process.env.ARM_SMOKE_PIN_EXAMPLE = previous;
  }
});

test("a ready flag still refuses the production endpoint", async () => {
  const transport = refusingTransport();
  const result = await runSmoke({
    armReadonlyLevelReady: true,
    accounts: [{ account_id: "acct_a", label: "a", key_env: "ARM_SMOKE_PIN_A" }],
    transport,
  });
  assert.equal(result.blocked_on, "live_arm_call_refused");
  assert.equal(result.pass, false);
});

test("injected reads stay in phase-2 order and do not pass the smoke", async () => {
  const transport = fakeTransport({
    tools: [
      { name: "get_project_status" },
      { name: "get_pulse_head" },
      {
        name: "list_work_items",
        inputSchema: { type: "object", properties: { cursor: { type: "string" } }, additionalProperties: false },
      },
    ],
    toolsCall(name, args) {
      if (name === "list_work_items" && !args.cursor) {
        return { records: [{ id: "wi-1" }], cursor: "p2" };
      }
      if (name === "list_work_items") {
        return { records: [{ id: "wi-2" }] };
      }
      return { id: `${name}-row` };
    },
  });
  const result = await runSmoke({
    armReadonlyLevelReady: true,
    transport,
    accounts: [
      { account_id: "acct_a", label: "alpha", key_env: "ARM_SMOKE_PIN_A" },
      { account_id: "acct_b", label: "beta", key_env: "ARM_SMOKE_PIN_B" },
    ],
  });
  assert.equal(result.pass, false);
  assert.equal(result.openclaw_mcp_exercised, false);
  assert.equal(result.tv_capture, "not_run");
  assert.equal(result.zero_writes.pass, false);
  assert.deepEqual(result.accounts.map((account) => account.account_id), ["acct_a", "acct_b"]);
  const names = transport.calls.filter((call) => call.method === "tools/call").map((call) => call.name);
  assert.deepEqual(names, [
    "get_pulse_head",
    "list_work_items",
    "list_work_items",
    "get_project_status",
    "get_pulse_head",
    "list_work_items",
    "list_work_items",
    "get_project_status",
  ]);
  assert.equal(transport.calls.some((call) => call.name === "get_briefing"), false);
  assert.equal(transport.calls.some((call) => call.name === "registry_insights"), false);
  const first = result.accounts[0];
  assert.equal(first.initialize_params.capabilities.sampling, undefined);
  assert.equal(first.handshake.write, "server_last_seen");
  assert.deepEqual(first.snapshot.records.map((record) => record.record_id), [
    "get_pulse_head-row",
    "wi-1",
    "wi-2",
    "get_project_status-row",
  ]);
});

test("a 403 during a read halts that account and is not retried", async () => {
  let calls = 0;
  const transport = fakeTransport({
    tools: [{ name: "get_pulse_head" }],
    toolsCall() {
      calls += 1;
      return { httpStatus: 403 };
    },
  });
  const result = await runSmoke({
    armReadonlyLevelReady: true,
    transport,
    accounts: [
      { account_id: "acct_a", label: "alpha", key_env: "ARM_SMOKE_PIN_A" },
      { account_id: "acct_b", label: "beta", key_env: "ARM_SMOKE_PIN_B" },
    ],
  });
  assert.equal(calls, 1);
  assert.equal(result.accounts[0].status, "halted");
  assert.equal(result.accounts[0].fail_reasons[0], "halt");
  assert.equal(result.accounts[1].status, "not_run");
  assert.equal(result.pass, false);
});

test("an advertised mutator halts before tools/call", async () => {
  const transport = fakeTransport({
    tools: [{ name: "get_pulse_head" }, { name: "get_briefing" }],
  });
  const result = await runSmoke({
    armReadonlyLevelReady: true,
    transport,
    accounts: [
      { account_id: "acct_a", label: "alpha", key_env: "ARM_SMOKE_PIN_A" },
      { account_id: "acct_b", label: "beta", key_env: "ARM_SMOKE_PIN_B" },
    ],
  });
  assert.equal(result.accounts[0].status, "halted");
  assert.equal(result.accounts[1].status, "not_run");
  assert.equal(transport.calls.some((call) => call.method === "tools/call"), false);
});

test("citation scoring accepts a grounded object and rejects an invented identifier", () => {
  const payload = { id: "rec-1", doc_type_code: "FAA-8130" };
  const pass = scoreModelOutput({
    recordId: "rec-1",
    payload,
    modelOutput: {
      record_id: "rec-1",
      summary: "Form FAA-8130 is present.",
      classification: "compliance_data",
      missing_fields: ["cycles"],
      anomalies: [],
      cited_fields: [{ path: "doc_type_code", value: "FAA-8130" }],
    },
  });
  assert.equal(pass.pass, true);

  const fail = scoreModelOutput({
    recordId: "rec-1",
    payload,
    modelOutput: {
      record_id: "rec-1",
      summary: "Serial 123456 is on the form.",
      classification: "unknown",
      missing_fields: ["doc_type_code"],
      anomalies: [],
      cited_fields: [{ path: "serial", value: "123456" }],
    },
  });
  assert.equal(fail.pass, false);
  assert.deepEqual(fail.identifiers_not_in_source, ["123456"]);
  assert.deepEqual(fail.false_missing, ["doc_type_code"]);
  assert.equal(fail.unsupported_citations.length, 1);
});

test("smoke and job commands do not call fetch", () => {
  const smoke = spawnSync(process.execPath, ["src/smoke.mjs", "--live"], { encoding: "utf8" });
  assert.equal(smoke.status, 0);
  const body = JSON.parse(smoke.stdout);
  assert.equal(body.blocked_on, "live_arm_call_refused");
  assert.equal(body.pass, false);

  const jobs = spawnSync(process.execPath, ["src/jobs.mjs"], { encoding: "utf8" });
  assert.equal(jobs.status, 0);
  const catalog = JSON.parse(jobs.stdout);
  assert.equal(catalog.arm_calls, 0);
  assert.equal(catalog.blocked_on, "arm_read_only_level");
});
