// Decision 5 (Todd, 2026-10-05).
// initialize may write one server-generated last-seen timestamp, on the ARM side.
// The client does not send briefing fields, counters, runtime usage, status,
// processing, or its own last-seen value. The handshake starts no processing.

import { CLIENT_INFO, PROTOCOL_VERSION, findClientWriteKeys } from "./policy.mjs";

const ALLOWED_RESULT_KEYS = new Set([
  "protocolVersion",
  "capabilities",
  "serverInfo",
  "instructions",
  "last_seen_at",
  "processing_enqueued",
  "models_invoked",
]);

const HANDSHAKE_FORBIDDEN_KEYS = new Set([
  "last_briefing",
  "last_briefing_version",
  "last_briefing_at",
  "last_briefing_via",
  "runtime_usage",
  "report_runtime_usage",
  "enqueue",
  "processing",
  "last_used_at",
  "counters",
  "counter",
  "sampling",
  "roots",
  "status",
]);

export function buildInitializeParams(overrides) {
  if (overrides !== undefined) {
    const error = new Error("client_initialize_overrides_refused");
    error.code = "client_initialize_overrides_refused";
    throw error;
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { ...CLIENT_INFO },
  };
}

export function assertClientInitialize(params) {
  const expected = buildInitializeParams();
  if (JSON.stringify(params) !== JSON.stringify(expected)) {
    const error = new Error("client_initialize_mismatch");
    error.code = "client_initialize_mismatch";
    throw error;
  }
  const writes = findClientWriteKeys(params);
  if (writes.length > 0) {
    const error = new Error(`client_write_refused:${writes.join(",")}`);
    error.code = "client_write_refused";
    throw error;
  }
  return params;
}

function walkForbidden(value, found) {
  if (Array.isArray(value)) {
    for (const item of value) walkForbidden(item, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (HANDSHAKE_FORBIDDEN_KEYS.has(key)) found.push(key);
    walkForbidden(child, found);
  }
}

export function classifyHandshakeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, reason: "handshake_result_missing", write: "none" };
  }
  const forbidden = [];
  walkForbidden(result, forbidden);
  if (forbidden.length > 0) {
    return { ok: false, reason: `handshake_forbidden:${forbidden[0]}`, write: "none" };
  }
  for (const key of Object.keys(result)) {
    if (!ALLOWED_RESULT_KEYS.has(key)) {
      return { ok: false, reason: `handshake_field:${key}`, write: "none" };
    }
  }
  if (result.processing_enqueued === true) {
    return { ok: false, reason: "handshake_processing", write: "none" };
  }
  if (result.processing_enqueued !== undefined && result.processing_enqueued !== false) {
    return { ok: false, reason: "handshake_processing", write: "none" };
  }
  if (result.models_invoked !== undefined) {
    if (!Array.isArray(result.models_invoked) || result.models_invoked.length > 0) {
      return { ok: false, reason: "handshake_models_invoked", write: "none" };
    }
  }
  if (result.last_seen_at !== undefined && typeof result.last_seen_at !== "string") {
    return { ok: false, reason: "handshake_last_seen_shape", write: "none" };
  }
  if (typeof result.last_seen_at === "string" && result.last_seen_at.length === 0) {
    return { ok: false, reason: "handshake_last_seen_shape", write: "none" };
  }
  return {
    ok: true,
    reason: "decision_5",
    write: result.last_seen_at ? "server_last_seen" : "none_observed",
    last_seen_at: result.last_seen_at ?? null,
  };
}
