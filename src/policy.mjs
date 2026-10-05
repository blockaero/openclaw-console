// Phase-2 read names from the reconciled smoke plan (section 13).
// Doc-derived. Not a live tools/list. Do not add trace, expiry, or OCR names here.

export const PROTOCOL_VERSION = "2025-03-26";

export const CLIENT_INFO = Object.freeze({
  name: "arm-readonly-guard",
  version: "0.0.0-scaffold",
});

export const PHASE2_TOOLS = Object.freeze([
  "get_pulse_head",
  "get_account_pulse",
  "get_standing_playbook",
  "get_deliverable_rollup",
  "list_work_items",
  "list_priority_part_lists",
  "get_project_status",
  "registry_insights",
]);

export const PHASE2_SET = new Set(PHASE2_TOOLS);

export const LIST_TOOLS = new Set(["list_work_items", "list_priority_part_lists"]);

export const RECORD_TYPES = Object.freeze({
  get_pulse_head: "pulse_head",
  get_account_pulse: "account_pulse",
  get_standing_playbook: "standing_playbook",
  get_deliverable_rollup: "deliverable_rollup",
  list_work_items: "work_item",
  list_priority_part_lists: "priority_part_list",
  get_project_status: "project_status",
  registry_insights: "registry_insights",
});

export const CLASSIFICATIONS = Object.freeze([
  "aerodrome_data",
  "commercial_data",
  "compliance_data",
  "design_data",
  "logistics_data",
  "maintenance_records",
  "work_item",
  "status",
  "part_list",
  "unknown",
]);

// Names the smoke plan hard-bans or drops. An advertised name outside PHASE2_TOOLS
// also halts, including names that are not in this list.
export const FORBIDDEN_TOOLS = Object.freeze([
  "get_briefing",
  "report_runtime_usage",
  "complete_work_item",
  "post_session_message",
  "put_pulse_head",
  "send_records_request",
  "notify_user",
  "ledger_commit",
  "form_0",
  "party_stamp",
  "commit_work_plan",
  "approve_documents",
]);

const BANNED_TOKENS = new Set([
  "claim",
  "complete",
  "commit",
  "approve",
  "attach",
  "mint",
  "invite",
  "register",
  "harvest",
  "offer",
]);

export const CAPS = Object.freeze({
  maxPagesPerListTool: 10,
  maxRecordsPerTool: 200,
  maxJsonBytesPerAccount: 32 * 1024 * 1024,
  pulseMaxBytes: 256 * 1024,
});

export const RETRY_WAITS_MS = Object.freeze([5_000, 10_000, 20_000]);

export const NO_RETRY_STATUSES = new Set([400, 401, 403, 404]);

// Decision 5: the client never sends these. One server-generated last-seen
// timestamp is the only handshake write, and the server generates it.
export const CLIENT_WRITE_KEYS = new Set([
  "last_briefing",
  "last_briefing_version",
  "last_briefing_at",
  "last_briefing_via",
  "last_seen_at",
  "last_used_at",
  "runtime_usage",
  "report_runtime_usage",
  "processing",
  "processing_enqueued",
  "enqueue",
  "claim",
  "complete",
  "counters",
  "counter",
]);

export function isPhase2Tool(name) {
  return PHASE2_SET.has(name);
}

export function isMutatorName(name) {
  if (typeof name !== "string" || name.length === 0) return true;
  if (PHASE2_SET.has(name)) return false;
  if (FORBIDDEN_TOOLS.includes(name)) return true;
  if (name.startsWith("propose_")) return true;
  return name.split("_").some((token) => BANNED_TOKENS.has(token));
}

export function checkToolsList(advertisedNames) {
  if (!Array.isArray(advertisedNames)) {
    return { ok: false, extras: [], reason: "tools_list_not_an_array" };
  }
  const extras = [];
  const seen = new Set();
  for (const name of advertisedNames) {
    if (typeof name !== "string" || seen.has(name)) {
      extras.push(name);
      continue;
    }
    seen.add(name);
    if (!PHASE2_SET.has(name)) extras.push(name);
  }
  if (extras.length > 0) {
    return { ok: false, extras, reason: "tools_list_not_a_subset" };
  }
  return { ok: true, extras: [], advertised: [...advertisedNames] };
}

export function findClientWriteKeys(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) findClientWriteKeys(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (CLIENT_WRITE_KEYS.has(key)) found.push(key);
      findClientWriteKeys(child, found);
    }
  }
  return found;
}
