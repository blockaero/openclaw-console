export function handshakeResult(extra = {}) {
  return {
    protocolVersion: "2025-03-26",
    capabilities: {},
    serverInfo: { name: "arm", version: "test" },
    last_seen_at: "2026-10-05T00:00:00.000Z",
    ...extra,
  };
}

export function fakeTransport(setup = {}) {
  const calls = [];
  return {
    calls,
    async initialize(params) {
      calls.push({ method: "initialize", params });
      return setup.initialize ? setup.initialize(params) : handshakeResult();
    },
    async toolsList() {
      calls.push({ method: "tools/list" });
      return { tools: setup.tools ?? [] };
    },
    async toolsCall(name, args) {
      calls.push({ method: "tools/call", name, args });
      if (setup.toolsCall) return setup.toolsCall(name, args);
      return { id: `${name}-1` };
    },
  };
}
