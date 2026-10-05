// Pure diff of caller-supplied images. No Neon client, no connection string,
// no ARM key. A missing image is unverified, and unverified is not clean.
// login_events stays the open section 14 question: a new row is not clean.

const REQUIRED_TABLES = Object.freeze([
  "principals",
  "principal_credentials",
  "chat_run_leases",
  "pipeline_log",
  "chain_operations",
  "asset_write_ledger",
  "login_events",
  "email_log",
  "arm_agent_runtime_usage",
  "agent_work_items",
  "account_users",
  "part_identities",
  "photo_marking_priors",
  "demo_visits",
  "account_runtime_status",
]);

const LOG_TABLES = Object.freeze([
  "pipeline_log",
  "chain_operations",
  "asset_write_ledger",
  "login_events",
  "email_log",
  "arm_agent_runtime_usage",
]);

const PRINCIPAL_FIELDS = Object.freeze([
  "last_seen_at",
  "last_briefing_version",
  "last_briefing_at",
  "last_briefing_via",
  "status",
]);

const CLAIM_FIELDS = Object.freeze(["claimed_at", "claimed_by", "status", "finished_at", "result"]);

export function emptyAuditImage() {
  return {
    principals: [],
    principal_credentials: [],
    chat_run_leases: [],
    pipeline_log: [],
    chain_operations: [],
    asset_write_ledger: [],
    login_events: [],
    email_log: [],
    arm_agent_runtime_usage: [],
    agent_work_items: [],
    account_users: [],
    part_identities: [],
    photo_marking_priors: [],
    demo_visits: [],
    account_runtime_status: [],
  };
}

function unverified(reason) {
  return {
    pass: false,
    verdict: "unverified",
    reason,
    audit: { table: null, status: "unverified", new_rows: null },
    allowed_soft_writes: [],
    unexpected_deltas: [],
    login_events: [],
  };
}

function containsTokenHash(value) {
  if (Array.isArray(value)) return value.some((item) => containsTokenHash(item));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key === "token_hash" || containsTokenHash(child));
}

function indexRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || map.has(row.id)) return null;
    map.set(row.id, row);
  }
  return map;
}

function fieldChanged(before, after, field) {
  return (before?.[field] ?? null) !== (after?.[field] ?? null);
}

function newIds(beforeMap, afterMap) {
  const ids = [];
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id)) ids.push(id);
  }
  return ids;
}

function loadImage(image) {
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    return { ok: false, reason: "auditor_image_missing" };
  }
  if (image.checksum_unavailable === true) {
    return { ok: false, reason: "checksum_unavailable" };
  }
  if (containsTokenHash(image)) {
    return { ok: false, reason: "credential_hash_refused" };
  }
  const tables = {};
  for (const name of REQUIRED_TABLES) {
    if (!Array.isArray(image[name])) return { ok: false, reason: `table_missing:${name}` };
    const indexed = indexRows(image[name]);
    if (!indexed) return { ok: false, reason: `row_id_missing:${name}` };
    tables[name] = indexed;
  }
  const business = new Map();
  if (image.business_rows !== undefined) {
    if (!Array.isArray(image.business_rows)) return { ok: false, reason: "table_missing:business_rows" };
    const indexed = indexRows(image.business_rows);
    if (!indexed) return { ok: false, reason: "row_id_missing:business_rows" };
    business.rows = indexed;
  }
  return { ok: true, tables, business };
}

export function auditCheckpoint({
  checkpoint,
  before,
  after,
  principalId,
  expectedCalls,
} = {}) {
  if (checkpoint === "baseline") {
    const loaded = loadImage(before);
    if (!loaded.ok) return unverified(loaded.reason);
    return finish({
      verdict: "clean",
      reason: "baseline_saved",
      allowed: [],
      unexpected: [],
      loginIds: [],
      newLogRows: 0,
    });
  }

  const earlier = loadImage(before);
  if (!earlier.ok) return unverified(earlier.reason);
  const later = loadImage(after);
  if (!later.ok) return unverified(later.reason);

  const handshake = checkpoint === "after_initialize";
  const laterCall = checkpoint === "mid" || checkpoint === "post" || checkpoint === "late";
  if (!handshake && !laterCall) return unverified("unknown_checkpoint");

  const unexpected = [];
  const allowed = [];
  let loginIds = [];
  let newPipeline = false;
  let otherNewLogs = 0;
  let touches = 0;

  const beforePrincipals = earlier.tables.principals;
  const afterPrincipals = later.tables.principals;
  for (const id of new Set([...beforePrincipals.keys(), ...afterPrincipals.keys()])) {
    const left = beforePrincipals.get(id);
    const right = afterPrincipals.get(id);
    if (!left || !right) {
      unexpected.push({ table: "principals", id, what_changed: "row" });
      continue;
    }
    for (const field of PRINCIPAL_FIELDS) {
      if (!fieldChanged(left, right, field)) continue;
      const own = id === principalId;
      if (field === "last_seen_at" && own) {
        allowed.push({ class: "last_seen", principal_id: id, table: "principals", column: "last_seen_at" });
        touches += 1;
      } else {
        unexpected.push({ table: "principals", id, what_changed: field });
      }
    }
  }

  const beforeCreds = earlier.tables.principal_credentials;
  const afterCreds = later.tables.principal_credentials;
  for (const id of new Set([...beforeCreds.keys(), ...afterCreds.keys()])) {
    const left = beforeCreds.get(id);
    const right = afterCreds.get(id);
    if (!left || !right) {
      unexpected.push({ table: "principal_credentials", id, what_changed: "row" });
      continue;
    }
    if (!fieldChanged(left, right, "last_used_at")) continue;
    if (!handshake && right.principal_id === principalId) {
      allowed.push({
        class: "last_used",
        principal_id: principalId,
        table: "principal_credentials",
        column: "last_used_at",
      });
      touches += 1;
    } else {
      unexpected.push({ table: "principal_credentials", id, what_changed: "last_used_at" });
    }
  }

  const beforeLeases = earlier.tables.chat_run_leases;
  const afterLeases = later.tables.chat_run_leases;
  for (const id of new Set([...beforeLeases.keys(), ...afterLeases.keys()])) {
    const left = beforeLeases.get(id);
    const right = afterLeases.get(id);
    const row = right ?? left;
    const fields = ["heartbeat_at", "started_at", "status", "kind", "principal_id"];
    const moved = !left || !right || fields.some((field) => fieldChanged(left, right, field));
    if (!moved) continue;
    const presence = row?.principal_id === principalId && row?.kind === "presence";
    if (!handshake && presence) {
      allowed.push({
        class: "presence_lease",
        principal_id: principalId,
        table: "chat_run_leases",
        columns: ["heartbeat_at", "started_at", "status"],
        kind_seen: "presence",
      });
      touches += 1;
    } else {
      unexpected.push({ table: "chat_run_leases", id, what_changed: row?.kind ?? "kind" });
    }
  }

  for (const table of ["account_users", "part_identities"]) {
    noteColumnMoves(earlier.tables[table], later.tables[table], table, "last_seen_at", unexpected);
  }
  noteColumnMoves(earlier.tables.photo_marking_priors, later.tables.photo_marking_priors, "photo_marking_priors", "last_seen", unexpected);
  noteColumnMoves(earlier.tables.demo_visits, later.tables.demo_visits, "demo_visits", "last_seen", unexpected);
  noteColumnMoves(earlier.tables.account_runtime_status, later.tables.account_runtime_status, "account_runtime_status", "status", unexpected);

  for (const id of new Set([...earlier.tables.agent_work_items.keys(), ...later.tables.agent_work_items.keys()])) {
    const left = earlier.tables.agent_work_items.get(id);
    const right = later.tables.agent_work_items.get(id);
    if (!left || !right) {
      unexpected.push({ table: "agent_work_items", id, what_changed: "row" });
      continue;
    }
    for (const field of CLAIM_FIELDS) {
      if (fieldChanged(left, right, field)) unexpected.push({ table: "agent_work_items", id, what_changed: field });
    }
  }

  for (const table of LOG_TABLES) {
    const ids = newIds(earlier.tables[table], later.tables[table]);
    if (table === "login_events") loginIds = ids;
    else if (ids.length > 0) {
      otherNewLogs += ids.length;
      if (table === "pipeline_log") newPipeline = true;
      for (const id of ids) unexpected.push({ table, id, what_changed: "new_row" });
    }
    for (const id of earlier.tables[table].keys()) {
      if (!later.tables[table].has(id)) unexpected.push({ table, id, what_changed: "removed_row" });
    }
  }

  if (Boolean(earlier.business?.rows) !== Boolean(later.business?.rows)) {
    return unverified("table_missing:business_rows");
  }
  if (earlier.business?.rows && later.business?.rows) {
    noteColumnMoves(earlier.business.rows, later.business.rows, "business_rows", "updated_at", unexpected);
  }

  if (laterCall && typeof expectedCalls === "number" && touches > expectedCalls) {
    unexpected.push({ table: "allowed_soft_writes", what_changed: "call_count_mismatch" });
  }

  if (checkpoint === "late" && newPipeline) {
    return finish({
      verdict: "retract",
      reason: "late_processing",
      allowed: handshake ? [] : allowed,
      unexpected,
      loginIds,
      newLogRows: otherNewLogs + loginIds.length + 1,
    });
  }

  const loginOnly = loginIds.length > 0 && unexpected.length === 0;
  if (loginOnly) {
    return finish({
      verdict: "flagged_unresolved_login_events",
      reason: "login_events_unresolved",
      allowed: handshake ? [] : allowed,
      unexpected,
      loginIds,
      newLogRows: loginIds.length,
    });
  }

  if (unexpected.length > 0 || loginIds.length > 0) {
    return finish({
      verdict: "violation",
      reason: unexpected[0]?.what_changed ?? "log_row",
      allowed: handshake ? [] : allowed,
      unexpected,
      loginIds,
      newLogRows: otherNewLogs + loginIds.length,
    });
  }

  if (handshake && allowed.some((row) => row.class !== "last_seen")) {
    return finish({
      verdict: "violation",
      reason: "handshake_wider_than_decision_5",
      allowed: [],
      unexpected: allowed.filter((row) => row.class !== "last_seen"),
      loginIds,
      newLogRows: 0,
    });
  }

  if (laterCall && touches > 0 && typeof expectedCalls !== "number") {
    return unverified("call_count_not_supplied");
  }

  return finish({
    verdict: "clean",
    reason: handshake ? "decision_5" : "decision_2",
    allowed: handshake ? allowed.filter((row) => row.class === "last_seen") : allowed,
    unexpected,
    loginIds,
    newLogRows: 0,
  });
}

function noteColumnMoves(beforeMap, afterMap, table, field, unexpected) {
  for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const left = beforeMap.get(id);
    const right = afterMap.get(id);
    if (!left || !right || fieldChanged(left, right, field)) {
      unexpected.push({ table, id, what_changed: field });
    }
  }
}

function finish({ verdict, reason, allowed, unexpected, loginIds, newLogRows }) {
  const clean = verdict === "clean";
  return {
    pass: clean,
    verdict,
    reason,
    audit: {
      table: null,
      status: clean ? "no_audit_table_use_pipeline_and_chain_logs" : "changed",
      new_rows: newLogRows,
    },
    allowed_soft_writes: allowed,
    unexpected_deltas: unexpected,
    login_events: loginIds.map((id) => ({ id })),
  };
}

export function auditWindow(images, { principalId, expectedCalls } = {}) {
  if (!images) return unverified("auditor_image_missing");
  const checkpoints = [
    ["after_initialize", images.before, images.afterInitialize],
    ["mid", images.before, images.mid],
    ["post", images.mid ?? images.before, images.post],
  ];
  const results = [];
  for (const [checkpoint, before, after] of checkpoints) {
    results.push(auditCheckpoint({ checkpoint, before, after, principalId, expectedCalls }));
  }
  if (images.late) {
    results.push(auditCheckpoint({
      checkpoint: "late",
      before: images.post ?? images.mid ?? images.before,
      after: images.late,
      principalId,
      expectedCalls,
    }));
  }
  const ranked = ["retract", "violation", "flagged_unresolved_login_events", "unverified"];
  for (const verdict of ranked) {
    const found = results.find((result) => result.verdict === verdict);
    if (found) return { ...found, checkpoints: results.map((result) => result.verdict) };
  }
  return { ...results[results.length - 1], checkpoints: results.map((result) => result.verdict), pass: true };
}
