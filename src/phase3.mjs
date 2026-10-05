// Phase-3 capabilities have no verified tools/list names. These strings are the
// historical placeholders from PR #3. They are not an allow-list.

export const PHASE3_PLACEHOLDERS = Object.freeze([
  "get_part_trace",
  "list_life_limits",
  "get_record_text",
  "list_asset_records",
  "get_doc_type_registry",
  "list_certificates",
]);

const PLACEHOLDER_SET = new Set(PHASE3_PLACEHOLDERS);

export const PHASE3_CAPABILITIES = Object.freeze([
  { id: "trace", status: "waiting_on_arm_pure_read_tool", tools: [] },
  { id: "life_limits", status: "waiting_on_arm_pure_read_tool", tools: [] },
  { id: "stored_text", status: "waiting_on_arm_pure_read_tool", tools: [] },
  { id: "gap_inputs", status: "waiting_on_required_doc_list", tools: [] },
]);

export function isPhase3Placeholder(name) {
  return PLACEHOLDER_SET.has(name);
}
