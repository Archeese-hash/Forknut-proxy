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

function captureServerError(kind, error, extra = {}) {
  const err = error || {};
  addServerDiagnostic({
    kind,
    name: err.name || "Error",
    message: String(err.message || err || ""),
    stack: String(err.stack || ""),
    ...extra
  });
}

process.on("uncaughtException", (error) => {
  captureServerError("PROCESS_UNCAUGHT_EXCEPTION", error);
});

process.on("unhandledRejection", (reason) => {
  captureServerError("PROCESS_UNHANDLED_REJECTION", reason);
});

process.on("warning", (warning) => {
  captureServerError("PROCESS_WARNING", warning);
});

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

app.setErrorHandler((error, request, reply) => {
  captureServerError("FASTIFY_ERROR", error, {
    method: request.method,
    url: request.url
  });

  if (!reply.sent) {
    reply.code(error.statusCode && error.statusCode >= 400 ? error.statusCode : 500);
    reply.type("text/plain; charset=utf-8");
    return reply.send(`Forknut server error: ${String(error.message || error)}`);
  }
});

app.get("/__forknut/diag.txt", async (request, reply) => {
  return reply
    .type("text/plain; charset=utf-8")
    .send(diagnosticLog.map(x => JSON.stringify(x)).join("\n") || "No diagnostic events yet.");
});



function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

async function assertSafeUpstream(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Only HTTP(S) image URLs are allowed.");
  }
  if (isBlockedHostname(parsed.hostname) || isPrivateIPv4(parsed.hostname)) {
    throw new Error("Blocked private/local upstream address.");
  }

  try {
    const dns = await import("node:dns/promises");
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    for (const address of addresses) {
      if (isPrivateIPv4(address.address)) {
        throw new Error("Blocked upstream resolving to a private IPv4 address.");
      }
      const value = String(address.address).toLowerCase();
      if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) {
        throw new Error("Blocked upstream resolving to a private IPv6 address.");
      }
    }
  } catch (error) {
    if (String(error?.message || "").startsWith("Blocked upstream")) throw error;
    // DNS lookup failures are reported normally by the route below.
  }
}

app.get("/__forknut/image", async (request, reply) => {
  const raw = request.query?.url;
  if (!raw || typeof raw !== "string") {
    return reply.code(400).type("text/plain; charset=utf-8").send("Missing image URL.");
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    return reply.code(400).type("text/plain; charset=utf-8").send("Invalid image URL.");
  }

  const started = Date.now();
  let current = target;

  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      await assertSafeUpstream(current.href);

      addServerDiagnostic({
        kind: "IMAGE_PROXY_FETCH",
        url: current.href,
        redirect: redirects
      });

      const upstream = await fetch(current.href, {
        redirect: "manual",
        headers: {
          "user-agent": request.headers["user-agent"] || "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
          "accept": request.headers.accept || "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "referer": current.origin + "/"
        }
      });

      const location = upstream.headers.get("location");
      if (upstream.status >= 300 && upstream.status < 400 && location) {
        current = new URL(location, current.href);
        continue;
      }

      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const contentLength = Number(upstream.headers.get("content-length") || 0);

      if (!upstream.ok) {
        const body = (await upstream.text()).slice(0, 1000);
        addServerDiagnostic({
          kind: "IMAGE_PROXY_UPSTREAM_ERROR",
          url: current.href,
          status: upstream.status,
          contentType,
          body,
          elapsedMs: Date.now() - started
        });
        return reply.code(upstream.status).type("text/plain; charset=utf-8").send(`Upstream image error ${upstream.status}: ${body}`);
      }

      if (contentLength > 12 * 1024 * 1024) {
        return reply.code(413).type("text/plain; charset=utf-8").send("Image is larger than the 12 MB diagnostic proxy limit.");
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length > 12 * 1024 * 1024) {
        return reply.code(413).type("text/plain; charset=utf-8").send("Image is larger than the 12 MB diagnostic proxy limit.");
      }

      addServerDiagnostic({
        kind: "IMAGE_PROXY_OK",
        url: current.href,
        status: upstream.status,
        contentType,
        contentLength: upstream.headers.get("content-length") || "",
        bytes: buffer.length,
        elapsedMs: Date.now() - started
      });

      return reply
        .code(200)
        .type(contentType)
        .header("Cache-Control", "public, max-age=300")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(buffer);
    }

    throw new Error("Too many upstream redirects.");
  } catch (error) {
    captureServerError("IMAGE_PROXY_EXCEPTION", error, {
      url: current.href,
      elapsedMs: Date.now() - started
    });
    return reply.code(502).type("text/plain; charset=utf-8").send(`Image proxy exception: ${String(error?.message || error)}`);
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "Forknut Proxy",
  scramjet: "2.0.67-alpha.2",
  controller: "0.0.14",
  transport: "epoxy",
  wisp: true,
  coep: "credentialless",
  diagnostic: "v4-server-exceptions"
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

console.log(`Forknut Diagnostic v4 running on port ${port}`);
