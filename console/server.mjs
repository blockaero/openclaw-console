import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeRun } from "./reader.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const RING = 30;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export function createApp() {
  const batches = [];
  const clients = new Set();
  let running = false;

  function publish(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of clients) response.write(line);
  }

  function upsert(batch) {
    const index = batches.findIndex((item) => item.id === batch.id);
    if (index === -1) {
      batches.push(batch);
      while (batches.length > RING) batches.shift();
    } else {
      batches[index] = batch;
    }
    publish({ type: "batch", batch });
  }

  async function startRun(paceMs) {
    if (running) return { started: false };
    running = true;
    batches.splice(0, batches.length);
    publish({ type: "reset" });
    try {
      await executeRun(
        async (event) => {
          if (event.type === "input") {
            upsert({
              id: event.batchId,
              tool: event.tool,
              title: event.title,
              status: "awaiting_output",
              input: event.input,
              output: null,
            });
            return;
          }
          const current = batches.find((item) => item.id === event.batchId);
          upsert({
            id: event.batchId,
            tool: event.tool,
            title: event.title,
            status: "complete",
            input: current ? current.input : null,
            output: event.output,
          });
        },
        { paceMs },
      );
      publish({ type: "done" });
      return { started: true };
    } finally {
      running = false;
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/api/model-io/stream") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(": ok\n\n");
        clients.add(response);
        for (const batch of batches) {
          response.write(`data: ${JSON.stringify({ type: "batch", batch })}\n\n`);
        }
        request.on("close", () => clients.delete(response));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/model-io/batches") {
        return sendJson(response, 200, { batches, running });
      }

      const batchMatch = url.pathname.match(/^\/api\/model-io\/batches\/([^/]+)$/);
      if (request.method === "GET" && batchMatch) {
        const batch = batches.find((item) => item.id === decodeURIComponent(batchMatch[1]));
        if (!batch) return sendJson(response, 404, { error: "not_found" });
        return sendJson(response, 200, batch);
      }

      if (request.method === "POST" && url.pathname === "/api/reader/run") {
        const body = await readBody(request);
        const paceMs = clampPace(body.paceMs);
        if (running) return sendJson(response, 202, { started: false, running: true });
        // The response returns after the run so a client without SSE can still read it.
        // The browser listens on the stream and does not wait on this body.
        void startRun(paceMs).catch((error) => {
          publish({ type: "error", message: error.message });
        });
        return sendJson(response, 202, { started: true });
      }

      if (request.method === "GET") {
        const filePath = safePublicPath(url.pathname);
        const body = await readFile(filePath);
        response.writeHead(200, { "content-type": types[path.extname(filePath)] || "text/plain" });
        response.end(body);
        return;
      }

      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      sendJson(response, 500, { error: "server_error" });
    }
  });

  return Object.assign(server, { startRun, batches: () => batches });
}

function clampPace(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 550;
  return Math.max(0, Math.min(2000, number));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function safePublicPath(pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(publicDir, requested);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    const error = new Error("bad path");
    error.code = "ENOENT";
    throw error;
  }
  return filePath;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = Number(process.env.PORT || 8788);
  const server = createApp();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`openclaw console http://127.0.0.1:${port}\n`);
  });
}
