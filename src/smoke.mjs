import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { auditWindow } from "./auditor.mjs";
import { createGuard } from "./guard.mjs";
import { PHASE2_TOOLS, RECORD_TYPES } from "./policy.mjs";
import { scoreModelOutput } from "./score.mjs";
import { assertTransportNotLive, refusingTransport } from "./transport.mjs";

export const SMOKE_STEP_STATUS = Object.freeze({
  arm_read_only_level: "gate",
  mint_and_quiesce: "operator",
  before_image: "pure_function_when_images_supplied",
  initialize_and_tools_list: "injected_transport_only",
  allowlisted_reads: "injected_transport_only",
  mid_image: "pure_function_when_images_supplied",
  model_console_route: "not_in_this_repo",
  local_score: "pure_function_when_model_output_is_supplied",
  after_image: "pure_function_when_images_supplied",
  kill_switch: "operator",
});

function shell(accounts, extra) {
  return {
    schema_version: "openclaw-arm-readonly-smoke/1",
    option: "B",
    openclaw_mcp_exercised: false,
    decisions: "approved-2026-10-05",
    handshake: {
      decision: 5,
      server_may_write: "one_server_generated_last_seen_timestamp",
      client_attempted_briefing_write: false,
      client_attempted_processing_write: false,
    },
    steps: SMOKE_STEP_STATUS,
    accounts: accounts.map((account) => ({
      account_id: account.account_id,
      label: account.label,
      key_env: account.key_env ?? null,
      key_ref: account.key_ref ?? null,
      live_operator_pin_used: false,
      status: "not_run",
    })),
    zero_writes: { pass: false, verdict: "unverified", reason: "not_run" },
    tv_capture: "not_run",
    rollup: {
      accounts_configured: accounts.length,
      accounts_passed: 0,
      accounts_failed: accounts.length,
      pass: false,
    },
    pass: false,
    ...extra,
  };
}

function cursorField(schema) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(properties, "cursor")) return "cursor";
  if (Object.prototype.hasOwnProperty.call(properties, "next_cursor")) return "next_cursor";
  return null;
}

function recordIdentity(payload, tool, index) {
  if (typeof payload?.record_id === "string") return payload.record_id;
  if (typeof payload?.id === "string") return payload.id;
  const digest = createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 16);
  return `${tool}:${index}:${digest}`;
}

function snapshotRecord(tool, payload, index) {
  const recordId = recordIdentity(payload, tool, index);
  return {
    kind: "record",
    source_tool: tool,
    record_type: RECORD_TYPES[tool],
    record_id: recordId,
    payload,
  };
}

async function readTool(guard, name, schema) {
  const field = cursorField(schema);
  const calls = [];
  const payloads = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const args = {};
    if (cursor && field) args[field] = cursor;
    const result = await guard.call(name, args);
    const next = field ? result.body?.[field] : null;
    calls.push({
      tool: name,
      truncated: result.truncated,
      cursor_followed: Boolean(field && next),
      cursor_ignored: !field && Boolean(result.body?.next_cursor || result.body?.cursor),
    });
    if (Array.isArray(result.body?.records)) payloads.push(...result.body.records);
    else if (result.body && typeof result.body === "object") payloads.push(result.body);
    if (!field || typeof next !== "string" || next.length === 0 || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return { calls, payloads };
}

export async function runSmoke(options = {}) {
  const accounts = Array.isArray(options.accounts) ? options.accounts : [];
  if (options.armReadonlyLevelReady !== true) {
    return shell(accounts, {
      blocked_on: "arm_read_only_level",
      fail_reasons: ["arm_read_only_level_not_live"],
    });
  }

  const transport = options.transport ?? refusingTransport();
  try {
    assertTransportNotLive(transport);
  } catch (error) {
    return shell(accounts, { blocked_on: error.code, fail_reasons: [error.code] });
  }

  const guard = options.guard ?? createGuard({
    transport,
    halted: true,
    sleep: options.sleep,
    caps: options.caps,
  });
  const cleared = guard.clearHalt({ armReadonlyLevelReady: true });
  if (!cleared.ok) {
    return shell(accounts, { blocked_on: cleared.reason, fail_reasons: [cleared.reason] });
  }

  const accountResults = [];
  let halted = false;
  for (const account of accounts) {
    if (halted) {
      accountResults.push({
        account_id: account.account_id,
        label: account.label,
        key_env: account.key_env ?? null,
        key_ref: account.key_ref ?? null,
        live_operator_pin_used: false,
        status: "not_run",
        fail_reasons: ["halted_by_earlier_account"],
      });
      continue;
    }
    const pre = await guard.precheck();
    if (!pre.ok) {
      halted = true;
      accountResults.push({
        account_id: account.account_id,
        label: account.label,
        key_env: account.key_env ?? null,
        key_ref: account.key_ref ?? null,
        live_operator_pin_used: false,
        status: "halted",
        handshake: pre.handshake ?? null,
        initialize_params: pre.initialize_params ?? null,
        fail_reasons: [pre.reason],
        forbidden_tools_invoked: [],
      });
      continue;
    }

    const toolCalls = [];
    const records = [];
    const schemas = pre.schemas ?? {};
    try {
      for (const tool of PHASE2_TOOLS) {
        if (!pre.certified.includes(tool)) continue;
        const read = await readTool(guard, tool, schemas[tool]);
        toolCalls.push(...read.calls);
        for (const payload of read.payloads) {
          records.push(snapshotRecord(tool, payload, records.length));
        }
      }
    } catch (error) {
      halted = true;
      accountResults.push({
        account_id: account.account_id,
        label: account.label,
        key_env: account.key_env ?? null,
        key_ref: account.key_ref ?? null,
        live_operator_pin_used: false,
        status: "halted",
        handshake: pre.handshake,
        initialize_params: pre.initialize_params,
        forbidden_tools_invoked: [],
        fail_reasons: [error.code ?? "read_failed"],
      });
      continue;
    }

    const scored = [];
    for (const sample of options.modelOutputs ?? []) {
      if (sample.account_id !== account.account_id) continue;
      scored.push({
        record_id: sample.record_id,
        hallucination: scoreModelOutput(sample),
      });
    }

    accountResults.push({
      account_id: account.account_id,
      label: account.label,
      key_env: account.key_env ?? null,
      key_ref: account.key_ref ?? null,
      live_operator_pin_used: false,
      status: "reads_finished_attestation_open",
      handshake: pre.handshake,
      initialize_params: pre.initialize_params,
      snapshot: {
        tool_calls: toolCalls,
        records,
      },
      model_step: "not_run",
      scored,
      forbidden_tools_invoked: [],
      report_runtime_usage_called: false,
      pass: false,
      fail_reasons: ["model_step_not_run", "tv_capture_not_run"],
    });
    guard.dropPermission();
    guard.clearHalt({ armReadonlyLevelReady: true });
  }

  const failed = accountResults.filter((account) => account.pass !== true).length;
  const zeroWrites = auditWindow(options.audit, {
    principalId: options.principalId,
    expectedCalls: guard.armCalls,
  });
  const tvCapture = options.capture?.confirmed === true ? "pass" : "not_run";
  return {
    ...shell([], {}),
    accounts: accountResults,
    arm_calls: guard.armCalls,
    blocked_on: null,
    zero_writes: zeroWrites,
    tv_capture: tvCapture,
    rollup: {
      accounts_configured: accounts.length,
      accounts_passed: 0,
      accounts_failed: failed,
      pass: false,
    },
    pass: false,
    fail_reasons: [
      zeroWrites.pass ? null : "zero_writes_not_attested",
      tvCapture === "pass" ? null : "tv_capture_not_run",
      "model_step_not_run",
    ].filter(Boolean),
  };
}

async function main() {
  const result = process.argv.includes("--live")
    ? shell([], { blocked_on: "live_arm_call_refused", fail_reasons: ["live_arm_call_refused"] })
    : await runSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
