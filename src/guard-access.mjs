// Loopback admission for the guard. A refused request is not an ARM call.

export const FORBIDDEN_BIND_PORTS = Object.freeze([8788, 18789, 19789, 18951]);

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function admit({ remoteAddress, origin, authorization }, { token } = {}) {
  if (!LOOPBACK.has(remoteAddress)) {
    return { ok: false, status: 403, reason: "not_loopback" };
  }
  if (origin) return { ok: false, status: 403, reason: "origin_refused" };
  if (!token || authorization !== `Bearer ${token}`) {
    return { ok: false, status: 401, reason: "token_refused" };
  }
  return { ok: true };
}

export function assertBindPort(port) {
  if (FORBIDDEN_BIND_PORTS.includes(port)) {
    const error = new Error(`forbidden_port:${port}`);
    error.code = "forbidden_port";
    throw error;
  }
}

export function secretInBody(body) {
  const serialized = JSON.stringify(body ?? null);
  return serialized.includes("ARM_MCP_PIN") || serialized.includes("armpin_");
}
