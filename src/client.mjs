import { PHASE2_SET, findClientWriteKeys, isPhase2Tool } from "./policy.mjs";
import { assertClientInitialize, buildInitializeParams, classifyHandshakeResult } from "./handshake.mjs";
import { withRetry } from "./retry.mjs";

function deny(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function selectArguments(args, schema) {
  const source = args ?? {};
  if (source && typeof source !== "object") {
    throw deny("arguments_refused");
  }
  const writes = findClientWriteKeys(source);
  if (writes.length > 0) {
    throw deny("client_write_refused", `client_write_refused:${writes[0]}`);
  }
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") {
    if (Object.keys(source).length > 0) {
      throw deny("arguments_refused_schema_unknown");
    }
    return {};
  }
  const selected = {};
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      throw deny("argument_not_in_schema", `argument_not_in_schema:${key}`);
    }
    selected[key] = source[key];
  }
  return selected;
}

export function createClient(transport, { sleep } = {}) {
  return {
    async initialize() {
      const params = buildInitializeParams();
      assertClientInitialize(params);
      const result = await transport.initialize(params);
      const handshake = classifyHandshakeResult(result);
      return { params, result, handshake };
    },

    async toolsList() {
      const listed = await transport.toolsList();
      const tools = Array.isArray(listed?.tools) ? listed.tools : listed;
      return { raw: listed, tools: Array.isArray(tools) ? tools : [] };
    },

    async toolsCall(name, args, schema) {
      if (!isPhase2Tool(name) || !PHASE2_SET.has(name)) {
        throw deny("tool_denied", `tool_denied:${name}`);
      }
      const selected = selectArguments(args, schema);
      const sent = await withRetry(() => transport.toolsCall(name, selected), sleep);
      return sent.result;
    },
  };
}
