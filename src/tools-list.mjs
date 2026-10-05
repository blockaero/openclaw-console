// Offline tools/list check. The caller supplies a saved payload. This module
// does not send tools/list.

import { checkToolsList } from "./policy.mjs";

const CURSOR_FIELDS = ["cursor", "next_cursor", "page", "limit"];

function toolNames(payload) {
  const tools = Array.isArray(payload?.tools) ? payload.tools : payload;
  if (!Array.isArray(tools)) return { tools: null, names: null };
  const names = tools.map((tool) => (typeof tool === "string" ? tool : tool?.name));
  return { tools, names };
}

function schemaRecord(tool) {
  if (!tool || typeof tool !== "object") {
    return { input_schema: null, named_fields: [] };
  }
  const properties = tool.inputSchema?.properties;
  const named = [];
  if (properties && typeof properties === "object") {
    for (const field of CURSOR_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(properties, field)) named.push(field);
    }
  }
  return { input_schema: tool.inputSchema ?? null, named_fields: named };
}

export function verifyToolsList(payload) {
  const { tools, names } = toolNames(payload);
  if (!names) {
    return { ok: false, reason: "tools_list_not_an_array", extras: [], callable: [], schemas: {} };
  }
  const subset = checkToolsList(names);
  if (!subset.ok) {
    return {
      ok: false,
      reason: subset.reason ?? "tools_list_not_a_subset",
      extras: subset.extras,
      callable: [],
      schemas: {},
    };
  }
  const schemas = {};
  for (const tool of tools) {
    const name = typeof tool === "string" ? tool : tool?.name;
    if (typeof name === "string") schemas[name] = schemaRecord(tool);
  }
  return {
    ok: true,
    reason: "subset",
    extras: [],
    callable: subset.advertised,
    schemas,
  };
}
