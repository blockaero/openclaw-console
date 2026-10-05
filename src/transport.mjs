// The production MCP URL is recorded so this scaffold can refuse it.
// Nothing in this file opens a socket.

export const PRODUCTION_MCP_URL = "https://agentic-records-manager.com/mcp";

export function refusingTransport() {
  const refuse = async () => {
    const error = new Error("live_arm_call_refused");
    error.code = "live_arm_call_refused";
    throw error;
  };
  return {
    refusesLiveCalls: true,
    endpoint: PRODUCTION_MCP_URL,
    initialize: refuse,
    toolsList: refuse,
    toolsCall: refuse,
  };
}

export function assertTransportNotLive(transport) {
  if (!transport) {
    const error = new Error("transport_missing");
    error.code = "transport_missing";
    throw error;
  }
  if (transport.refusesLiveCalls === true || transport.endpoint === PRODUCTION_MCP_URL) {
    const error = new Error("live_arm_call_refused");
    error.code = "live_arm_call_refused";
    throw error;
  }
  return transport;
}
