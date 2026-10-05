import assert from "node:assert/strict";
import test from "node:test";
import { checkToolsList, isMutatorName } from "../src/policy.mjs";
import { selectArguments } from "../src/client.mjs";
import { createGuard } from "../src/guard.mjs";
import { refusingTransport } from "../src/transport.mjs";
import { fakeTransport, handshakeResult } from "./helpers.mjs";

test("tools/list must be a subset, and a missing name is allowed", () => {
  assert.equal(checkToolsList([]).ok, true);
  assert.equal(checkToolsList(["get_pulse_head"]).ok, true);
  const extra = checkToolsList(["get_pulse_head", "get_briefing"]);
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.extras, ["get_briefing"]);
  assert.equal(checkToolsList(["registry_insight"]).ok, false);
  assert.equal(isMutatorName("registry_insights"), false);
  assert.equal(isMutatorName("claim_work_item"), true);
  assert.equal(isMutatorName("propose_work_item"), true);
});

test("a halted guard does not touch the transport", async () => {
  const transport = fakeTransport();
  const guard = createGuard({ transport });
  const result = await guard.precheck();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "halted");
  assert.equal(transport.calls.length, 0);
  assert.equal(guard.clearHalt({ armReadonlyLevelReady: false }).ok, false);
  assert.equal(transport.calls.length, 0);
});

test("the production transport is refused before any RPC", async () => {
  const transport = refusingTransport();
  let calls = 0;
  const wrapped = {
    refusesLiveCalls: true,
    endpoint: transport.endpoint,
    async initialize() {
      calls += 1;
      return handshakeResult();
    },
    async toolsList() {
      calls += 1;
      return { tools: [] };
    },
    async toolsCall() {
      calls += 1;
      return {};
    },
  };
  const guard = createGuard({ transport: wrapped, halted: false });
  const result = await guard.precheck();
  assert.equal(result.reason, "live_arm_call_refused");
  assert.equal(calls, 0);
  assert.equal(guard.state, "HALTED");
});

test("precheck certifies the intersection and halts before tools/call on an extra name", async () => {
  const transport = fakeTransport({
    tools: [{ name: "get_pulse_head" }, { name: "claim_work_item" }],
  });
  const guard = createGuard({ transport, halted: false });
  const result = await guard.precheck();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "tools_list_not_a_subset");
  assert.deepEqual(transport.calls.map((call) => call.method), ["initialize", "tools/list"]);
  await assert.rejects(() => guard.call("get_pulse_head", {}), (error) => error.code === "tool_denied");
  assert.equal(transport.calls.some((call) => call.method === "tools/call"), false);
});

test("a briefing write on initialize stops the run before tools/list", async () => {
  const transport = fakeTransport({
    initialize: () => handshakeResult({ last_briefing_at: "2026-10-05T00:00:00.000Z" }),
    tools: [{ name: "get_pulse_head" }],
  });
  const guard = createGuard({ transport, halted: false });
  const result = await guard.precheck();
  assert.equal(result.ok, false);
  assert.equal(result.reason.startsWith("handshake_forbidden"), true);
  assert.deepEqual(transport.calls.map((call) => call.method), ["initialize"]);
  assert.deepEqual(findWrites(result.initialize_params), []);
});

test("get_briefing and client write arguments are not sent", async () => {
  const transport = fakeTransport({ tools: [{ name: "get_pulse_head" }] });
  const guard = createGuard({ transport, halted: false });
  const pre = await guard.precheck();
  assert.equal(pre.ok, true);
  const before = transport.calls.length;
  await assert.rejects(() => guard.call("get_briefing", {}), (error) => error.code === "tool_denied");
  await assert.rejects(
    () => guard.call("get_pulse_head", { last_briefing_at: "2026-10-05T00:00:00.000Z" }),
    (error) => error.code === "client_write_refused",
  );
  await assert.rejects(
    () => guard.call("get_pulse_head", { cursor: "page-2" }),
    (error) => error.code === "arguments_refused_schema_unknown",
  );
  assert.equal(transport.calls.length, before);
  const sent = await guard.call("get_pulse_head", {});
  assert.equal(sent.body.id, "get_pulse_head-1");
});

test("one request is in flight, and a second call stays local", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    started = resolve;
  });
  const transport = fakeTransport({
    tools: [{ name: "get_pulse_head" }],
    toolsCall() {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const guard = createGuard({ transport, halted: false });
  await guard.precheck();
  const pending = guard.call("get_pulse_head", {});
  await gate;
  await assert.rejects(() => guard.call("get_pulse_head", {}), (error) => error.code === "one_request_in_flight");
  assert.equal(transport.calls.filter((call) => call.method === "tools/call").length, 1);
  release({ id: "one" });
  const sent = await pending;
  assert.equal(sent.body.id, "one");
});

test("list cursor arguments follow the advertised schema only", () => {
  assert.deepEqual(selectArguments({}, { properties: { cursor: { type: "string" } } }), {});
  assert.deepEqual(selectArguments({ cursor: "n" }, { properties: { cursor: { type: "string" } } }), { cursor: "n" });
  assert.throws(
    () => selectArguments({ next_cursor: "n" }, { properties: { cursor: { type: "string" } } }),
    (error) => error.code === "argument_not_in_schema",
  );
});

function findWrites(params) {
  return JSON.stringify(params).includes("last_briefing") ? ["last_briefing"] : [];
}
