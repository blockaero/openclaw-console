import { CAPS, LIST_TOOLS, PHASE2_TOOLS } from "./policy.mjs";
import { createClient, selectArguments } from "./client.mjs";
import { isPhase3Placeholder } from "./phase3.mjs";
import { verifyToolsList } from "./tools-list.mjs";
import { assertTransportNotLive, refusingTransport } from "./transport.mjs";

function refusal(reason) {
  return { ok: false, reason, arm_calls: 0 };
}

export function createGuard(options = {}) {
  const transport = options.transport ?? refusingTransport();
  const sleep = options.sleep;
  const caps = { ...CAPS, ...options.caps };
  const client = createClient(transport, { sleep });

  let state = options.halted === false ? "PRECHECK" : "HALTED";
  let inFlight = false;
  let certified = new Set();
  let schemas = new Map();
  let armCalls = 0;
  let initializeParams = null;
  const pages = new Map();
  const records = new Map();
  let jsonBytes = 0;
  const errorCounts = new Map();

  function noteError(errorClass) {
    const count = (errorCounts.get(errorClass) ?? 0) + 1;
    errorCounts.set(errorClass, count);
    if (count >= 3) {
      state = "HALTED";
      certified = new Set();
      return true;
    }
    return false;
  }

  async function tracked(fn) {
    if (inFlight) {
      const error = new Error("one_request_in_flight");
      error.code = "one_request_in_flight";
      throw error;
    }
    inFlight = true;
    armCalls += 1;
    try {
      return await fn();
    } finally {
      inFlight = false;
    }
  }

  return {
    get state() {
      return state;
    },
    get armCalls() {
      return armCalls;
    },
    get certified() {
      return [...certified];
    },

    clearHalt({ armReadonlyLevelReady } = {}) {
      if (armReadonlyLevelReady !== true) {
        state = "HALTED";
        return { ok: false, reason: "arm_read_only_level_not_live", state };
      }
      state = "PRECHECK";
      return { ok: true, state };
    },

    dropPermission() {
      certified = new Set();
      if (state !== "HALTED") state = "PRECHECK";
      return { ok: true, state, certified: [] };
    },

    ingest(message) {
      const method = message?.method;
      if (method === "sampling/createMessage" || method === "roots/list") {
        state = "HALTED";
        certified = new Set();
        return { ok: false, reason: "server_capability_halt", state };
      }
      if (method === "notifications/tools/list_changed") {
        this.dropPermission();
        return { ok: true, reason: "permission_dropped", state };
      }
      if (method === "resources/read" || typeof message?.uri === "string") {
        return { ok: false, reason: "resource_refused", state };
      }
      return { ok: false, reason: "method_refused", state };
    },

    async precheck() {
      if (state === "HALTED") return refusal("halted");
      pages.clear();
      records.clear();
      jsonBytes = 0;
      try {
        assertTransportNotLive(transport);
      } catch (error) {
        state = "HALTED";
        return refusal(error.code);
      }

      let handshake;
      try {
        const initialized = await tracked(() => client.initialize());
        handshake = initialized.handshake;
        initializeParams = initialized.params;
      } catch (error) {
        state = "HALTED";
        noteError(error.code ?? "initialize_failed");
        return { ok: false, reason: error.code ?? "initialize_failed", arm_calls: armCalls };
      }
      if (!handshake.ok) {
        state = "HALTED";
        certified = new Set();
        return {
          ok: false,
          reason: handshake.reason,
          handshake,
          initialize_params: initializeParams,
          arm_calls: armCalls,
        };
      }

      let listed;
      try {
        listed = await tracked(() => client.toolsList());
      } catch (error) {
        state = "HALTED";
        noteError(error.code ?? "tools_list_failed");
        return { ok: false, reason: error.code ?? "tools_list_failed", handshake, arm_calls: armCalls };
      }

      const subset = verifyToolsList(listed.raw ?? listed);
      if (!subset.ok) {
        state = "HALTED";
        certified = new Set();
        return {
          ok: false,
          reason: subset.reason,
          extras: subset.extras,
          handshake,
          initialize_params: initializeParams,
          arm_calls: armCalls,
        };
      }

      schemas = new Map();
      for (const tool of listed.tools) {
        if (tool && typeof tool === "object" && typeof tool.name === "string") {
          schemas.set(tool.name, tool.inputSchema);
        }
      }
      certified = new Set(subset.callable);
      state = "FORWARD";
      return {
        ok: true,
        reason: "subset",
        handshake,
        initialize_params: initializeParams,
        advertised: subset.callable,
        certified: PHASE2_TOOLS.filter((name) => certified.has(name)),
        schemas: Object.fromEntries(schemas),
        schema_record: subset.schemas,
        arm_calls: armCalls,
      };
    },

    async call(name, args) {
      if (isPhase3Placeholder(name) || state !== "FORWARD" || !certified.has(name)) {
        const error = new Error(`tool_denied:${name}`);
        error.code = "tool_denied";
        throw error;
      }
      if (LIST_TOOLS.has(name) && (pages.get(name) ?? 0) >= caps.maxPagesPerListTool) {
        const error = new Error("page_cap");
        error.code = "page_cap";
        throw error;
      }
      if ((records.get(name) ?? 0) >= caps.maxRecordsPerTool) {
        const error = new Error("record_cap");
        error.code = "record_cap";
        throw error;
      }
      if (jsonBytes >= caps.maxJsonBytesPerAccount) {
        const error = new Error("byte_cap");
        error.code = "byte_cap";
        throw error;
      }
      try {
        assertTransportNotLive(transport);
      } catch (error) {
        state = "HALTED";
        certified = new Set();
        throw error;
      }

      const schema = schemas.get(name);
      selectArguments(args, schema);
      let body;
      try {
        body = await tracked(() => client.toolsCall(name, args, schema));
      } catch (error) {
        if (error.code !== "one_request_in_flight") {
          state = "HALTED";
          certified = new Set();
          noteError(error.code ?? "tools_call_failed");
        }
        throw error;
      }

      const encoded = JSON.stringify(body ?? null);
      jsonBytes += Buffer.byteLength(encoded);
      const pulseCap = name === "get_account_pulse" && Buffer.byteLength(encoded) >= caps.pulseMaxBytes;
      const truncated = jsonBytes > caps.maxJsonBytesPerAccount || pulseCap || body?.truncated === true;
      if (LIST_TOOLS.has(name)) pages.set(name, (pages.get(name) ?? 0) + 1);
      const pageRecords = Array.isArray(body?.records) ? body.records.length : body ? 1 : 0;
      records.set(name, (records.get(name) ?? 0) + pageRecords);
      return { body, truncated, jsonBytes };
    },
  };
}
