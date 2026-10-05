import http from "node:http";
import { admit, assertBindPort, secretInBody } from "./guard-access.mjs";

// Loopback listener. It is not started by the smoke or job commands.
// Binding 8788, 18789, 19789, or 18951 is refused. The transport stays the
// guard's transport, which still refuses the production ARM URL.

function send(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(encoded);
}

export function startGuardServer({ token, guard, port = 0 } = {}) {
  assertBindPort(port);
  if (!token || !guard) {
    const error = new Error("guard_server_config");
    error.code = "guard_server_config";
    throw error;
  }
  const server = http.createServer(async (request, response) => {
    const remoteAddress = request.socket.remoteAddress;
    const decision = admit({
      remoteAddress,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
    }, { token });
    if (!decision.ok) {
      send(response, decision.status, { ok: false, reason: decision.reason });
      return;
    }
    if (request.method !== "POST") {
      send(response, 405, { ok: false, reason: "method_refused" });
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      send(response, 400, { ok: false, reason: "body_refused" });
      return;
    }
    if (secretInBody(body)) {
      send(response, 400, { ok: false, reason: "secret_refused" });
      return;
    }
    try {
      if (request.url === "/v1/precheck") {
        send(response, 200, await guard.precheck());
        return;
      }
      if (request.url === "/v1/call") {
        const result = await guard.call(body.name, body.args ?? {});
        send(response, 200, { ok: true, result });
        return;
      }
      if (request.url === "/v1/ingest") {
        send(response, 200, guard.ingest(body));
        return;
      }
      send(response, 404, { ok: false, reason: "method_refused" });
    } catch (error) {
      send(response, 409, { ok: false, reason: error.code ?? "refused" });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}
