import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, "public");

function dirOf(packageName) {
  return path.dirname(require.resolve(packageName));
}

const controllerPath = dirOf("@mercuryworkshop/scramjet-controller");
const utilsPath = dirOf("@mercuryworkshop/scramjet-utils");
const epoxyPath = dirOf("@mercuryworkshop/epoxy-transport");

const patchedControllerPath = path.join(__dirname, ".forknut-controller");

async function prepareWebKitController() {
  await fs.rm(patchedControllerPath, { recursive: true, force: true });
  await fs.cp(controllerPath, patchedControllerPath, { recursive: true });

  const apiFile = path.join(patchedControllerPath, "controller.api.js");
  let source = await fs.readFile(apiFile, "utf8");

  // Preserve the existing WebKit workaround. This diagnostic build does
  // not silently change the Scramjet version or transport.
  const replacements = [
    {
      needle: `return [
{
body: fetchresponse.body,
status: fetchresponse.status,
statusText: fetchresponse.statusText,
headers: fetchresponse.headers.toRawHeaders(),
},
fetchresponse.body instanceof ReadableStream ||
fetchresponse.body instanceof ArrayBuffer
? [fetchresponse.body]
: [],
];`,
      replacement: `let forknetBody = fetchresponse.body;
let forknetTransfer = [];

if (forknetBody instanceof ReadableStream) {
try {
forknetBody = await new Response(forknetBody).arrayBuffer();
} catch (error) {
console.error("[Forknut] WebKit response buffering failed:", error);
throw error;
}
}

if (forknetBody instanceof ArrayBuffer) {
forknetTransfer = [forknetBody];
}

return [
{
body: forknetBody,
status: fetchresponse.status,
statusText: fetchresponse.statusText,
headers: fetchresponse.headers.toRawHeaders(),
},
forknetTransfer,
];`
    },
    {
      needle: `return [response, [response.body]];`,
      replacement: `let forknetTransportBody = response.body;
if (forknetTransportBody instanceof ReadableStream) {
try {
forknetTransportBody = await new Response(forknetTransportBody).arrayBuffer();
} catch (error) {
console.error("[Forknut] WebKit transport buffering failed:", error);
throw error;
}
}

return [
{
...response,
body: forknetTransportBody,
},
forknetTransportBody instanceof ArrayBuffer ? [forknetTransportBody] : [],
];`
    }
  ];

  for (const item of replacements) {
    if (source.includes(item.needle)) source = source.replace(item.needle, item.replacement);
  }

  await fs.writeFile(apiFile, source, "utf8");

  console.log(
    "[Forknut] Diagnostic controller patch:",
    "requestBuffering=" + source.includes("forknetBody = await new Response(forknetBody).arrayBuffer()"),
    "transportBuffering=" + source.includes("forknetTransportBody = await new Response(forknetTransportBody).arrayBuffer()")
  );
}

await prepareWebKitController();

const diagnosticLog = [];
const MAX_LOG = 1000;

function addServerDiagnostic(entry) {
  const item = {
    receivedAt: new Date().toISOString(),
    ...entry
  };
  diagnosticLog.push(item);
  if (diagnosticLog.length > MAX_LOG) diagnosticLog.shift();
  console.log("[Forknut Diagnostic]", item);
}

const app = Fastify({
  logger: true,
  serverFactory: (handler) => {
    const server = http.createServer(handler);

    server.on("upgrade", (req, socket, head) => {
      try {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        if (pathname === "/wisp/") {
          console.log("[Forknut] Wisp connection opened");
          req.url = "/wisp/";
          wisp.routeRequest(req, socket, head);
          return;
        }
        console.log("[Forknut] Rejected WebSocket:", pathname);
        socket.end();
      } catch (error) {
        console.error("[Forknut] Wisp error:", error);
        socket.end();
      }
    });

    return server;
  }
});

app.addHook("onRequest", async (request) => {
  if (request.url.startsWith("/__forknut/")) {
    addServerDiagnostic({
      kind: "SERVER_REQUEST",
      method: request.method,
      url: request.url,
      userAgent: request.headers["user-agent"] || ""
    });
  }
});

app.post("/__forknut/diag", async (request, reply) => {
  let entry = request.body;
  if (typeof entry === "string") {
    try { entry = JSON.parse(entry); } catch {}
  }
  addServerDiagnostic({
    kind: "CLIENT_EVENT",
    entry: entry ?? null
  });
  return reply.code(204).send();
});

app.get("/__forknut/diag", async () => ({
  ok: true,
  count: diagnosticLog.length,
  events: diagnosticLog
}));

app.delete("/__forknut/diag", async () => {
  diagnosticLog.length = 0;
  return { ok: true };
});

app.get("/__forknut/diag.txt", async (request, reply) => {
  return reply
    .type("text/plain; charset=utf-8")
    .send(diagnosticLog.map(x => JSON.stringify(x)).join("\n") || "No diagnostic events yet.");
});

app.get("/health", async () => ({
  ok: true,
  service: "Forknut Proxy",
  scramjet: "2.0.67-alpha.2",
  controller: "0.0.14",
  transport: "epoxy",
  wisp: true,
  coep: "credentialless",
  diagnostic: "v2"
}));

app.addHook("onSend", async (request, reply) => {
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Embedder-Policy", "credentialless");
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");

  if (["/sw.js", "/app.js", "/controller/controller.api.js"].includes(request.url)) {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
  }
});

await app.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scramjet/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: patchedControllerPath,
  prefix: "/controller/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: utilsPath,
  prefix: "/utils/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: epoxyPath,
  prefix: "/epoxy/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: publicPath,
  decorateReply: false
});

const port = Number(process.env.PORT || 3000);

await app.listen({ host: "0.0.0.0", port });

console.log(`Forknut Diagnostic v2 running on port ${port}`);
