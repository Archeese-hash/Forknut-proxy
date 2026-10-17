import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { isBlockedHostname, isPublicAddress } from "./lib/security.js";

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

const websocketCounts = new Map();
const MAX_WISP_CONNECTIONS_PER_IP = 12;

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    redact: { paths: ["req.url", "req.headers.cookie", "req.headers.authorization"], censor: "[REDACTED]" }
  },
  serverFactory: (handler) => {
    const server = http.createServer(handler);
    server.on("upgrade", (req, socket, head) => {
      try {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
        const origin = req.headers.origin;
        const host = req.headers.host;
        const originUrl = origin ? new URL(origin) : null;
        const secureOrigin = originUrl && originUrl.host === host && originUrl.protocol === "https:";
        const localOrigin = originUrl && originUrl.host === host && originUrl.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host || "");
        if (pathname !== "/wisp/" || !(secureOrigin || localOrigin)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }

        const ip = req.socket.remoteAddress || "unknown";
        const count = websocketCounts.get(ip) || 0;
        if (count >= MAX_WISP_CONNECTIONS_PER_IP) {
          socket.write("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        websocketCounts.set(ip, count + 1);
        socket.once("close", () => {
          const remaining = Math.max(0, (websocketCounts.get(ip) || 1) - 1);
          if (remaining) websocketCounts.set(ip, remaining);
          else websocketCounts.delete(ip);
        });
        wisp.routeRequest(req, socket, head);
      } catch (error) {
        console.error("[Forknut] Wisp upgrade rejected:", error?.message || error);
        socket.destroy();
      }
    });
    return server;
  }
});

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


const imageRate = new Map();
const IMAGE_RATE_WINDOW_MS = 60_000;
const IMAGE_RATE_LIMIT = 90;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
let activeImageRequests = 0;
const MAX_ACTIVE_IMAGE_REQUESTS = 24;

function allowImageRequest(request) {
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = imageRate.get(key);
  if (!entry || now - entry.started >= IMAGE_RATE_WINDOW_MS) {
    entry = { started: now, count: 0 };
    imageRate.set(key, entry);
  }
  entry.count++;
  // Bound memory if a public service receives many distinct source IPs.
  if (imageRate.size > 5000) {
    for (const [ip, value] of imageRate) {
      if (now - value.started >= IMAGE_RATE_WINDOW_MS) imageRate.delete(ip);
    }
  }
  return entry.count <= IMAGE_RATE_LIMIT;
}

async function resolveSafeUpstream(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP(S) image URLs are allowed.");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) throw new Error("Blocked private/local or IP-literal upstream host.");
  const dns = await import("node:dns/promises");
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error("Blocked upstream hostname resolving to a non-public address.");
  }
  return addresses[0];
}

async function requestPinned(url, headers, maxBytes) {
  const parsed = new URL(url);
  const resolved = await resolveSafeUpstream(url);
  const client = parsed.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = client.request(parsed, {
      method: "GET", headers, timeout: 15_000,
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family)
    }, async response => {
      const status = response.statusCode || 502;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
        return;
      }
      const chunks = [];
      let total = 0;
      try {
        for await (const chunk of response) {
          total += chunk.length;
          if (total > maxBytes) {
            response.destroy();
            throw new Error("Upstream response exceeds the size limit.");
          }
          chunks.push(Buffer.from(chunk));
        }
        resolve({ status, headers: response.headers, body: Buffer.concat(chunks, total) });
      } catch (error) { reject(error); }
    });
    req.setTimeout(15_000, () => req.destroy(new Error("Upstream request timed out.")));
    req.on("error", reject);
    req.end();
  });
}


app.get("/__forknut/image", async (request, reply) => {
  if (!allowImageRequest(request)) {
    return reply.code(429).header("Retry-After", "60").type("text/plain; charset=utf-8").send("Image request rate limit reached. Try again shortly.");
  }
  if (activeImageRequests >= MAX_ACTIVE_IMAGE_REQUESTS) {
    return reply.code(503).header("Retry-After", "5").type("text/plain; charset=utf-8").send("Image service is busy. Try again shortly.");
  }
  activeImageRequests++;
  try {
  const raw = request.query?.url;
  if (!raw || typeof raw !== "string") {
    return reply.code(400).type("text/plain; charset=utf-8").send("Missing image URL.");
  }

  // Accept either a normal image URL or a Scramjet-rewritten URL.
  // Google Images can contain multiple encoded URL layers, so try several
  // decoding passes before giving up.
  let target;
  try {
    let candidate = String(raw);

    // Unwrap nested Forknut/Scramjet image URLs. In particular, Google
    // thumbnails can arrive as: /__forknut/image?url=<encoded URL>.
    for (let i = 0; i < 6; i++) {
      let changed = false;

      try {
        const parsed = new URL(candidate);
        for (const key of ["url", "imgurl", "mediaurl", "image_url", "src", "u"]) {
          const nested = parsed.searchParams.get(key);
          if (nested && /^https?:\/\//i.test(nested)) {
            candidate = nested;
            changed = true;
            break;
          }
        }
      } catch {}

      if (changed) continue;

      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded !== candidate) {
          candidate = decoded;
          changed = true;
        }
      } catch {}

      if (!changed) break;
    }

    // Last-resort extraction of an embedded absolute URL, preserving its
    // query string instead of truncating at '?'.
    const embedded = candidate.match(/https?:\/\/[^\s"'<>]+/i);
    if (embedded && embedded[0] !== candidate) candidate = embedded[0].replace(/[)\],;]+$/, "");

    target = new URL(candidate);
  } catch {
    return reply.code(400).type("text/plain; charset=utf-8").send("Invalid image URL.");
  }

  let current = target;

  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const host = current.hostname.toLowerCase();
      const isGoogleImageHost =
        host === "google.com" || host.endsWith(".google.com") ||
        host === "gstatic.com" || host.endsWith(".gstatic.com") ||
        host === "googleusercontent.com" || host.endsWith(".googleusercontent.com") ||
        host === "ggpht.com" || host.endsWith(".ggpht.com");

      const isYouTubeImageHost =
        host === "i.ytimg.com" || host.endsWith(".ytimg.com") ||
        host === "ytimg.com" || host.endsWith(".googlevideo.com");

      // Image CDNs often reject an iPad/WebKit referrer or a referrer from
      // the CDN itself. Use the site's normal first-party referrer instead.
      let imageReferer = current.origin + "/";
      if (isYouTubeImageHost) imageReferer = "https://www.youtube.com/";
      else if (isGoogleImageHost) imageReferer = "https://www.google.com/";

      const upstream = await requestPinned(current.href, {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "accept": request.headers.accept || "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "referer": imageReferer,
        "accept-language": request.headers["accept-language"] || "en-US,en;q=0.9"
      }, MAX_IMAGE_BYTES);
      const location = upstream.headers.location;
      if (upstream.status >= 300 && upstream.status < 400 && location) {
        current = new URL(location, current.href);
        continue;
      }
      const contentType = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const contentLength = Number(upstream.headers["content-length"] || 0);
      if (upstream.status < 200 || upstream.status >= 300) {
        console.error("[Forknut] Image upstream returned:", upstream.status, current.hostname);
        return reply.code(upstream.status).type("text/plain; charset=utf-8").send(`Upstream image request failed (${upstream.status}).`);
      }
      if (!contentType.startsWith("image/")) {
        return reply.code(415).type("text/plain; charset=utf-8").send("The upstream URL did not return an image.");
      }
      if (contentLength > MAX_IMAGE_BYTES || upstream.body.length > MAX_IMAGE_BYTES) {
        return reply.code(413).type("text/plain; charset=utf-8").send("Image is larger than the 12 MB proxy limit.");
      }
      const buffer = upstream.body;

      return reply
        .code(200)
        .type(contentType)
        .header("Cache-Control", "public, max-age=300")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(buffer);
    }

    throw new Error("Too many upstream redirects.");
  } catch (error) {
    console.error("[Forknut] Image proxy exception:", current?.href || "invalid-url", error);
    return reply.code(502).type("text/plain; charset=utf-8").send(`Image proxy exception: ${String(error?.message || error)}`);
  }
  } finally {
    activeImageRequests = Math.max(0, activeImageRequests - 1);
  }
});


function cleanYoutubeId(value) {
  const text = String(value || "");
  const patterns = [
    /(?:i\.)?ytimg\.com\/(?:vi|vi_webp)\/([A-Za-z0-9_-]{6,20})/i,
    /youtube(?:-nocookie)?\.com\/(?:embed\/|shorts\/|watch[^#]*[?&]v=)([A-Za-z0-9_-]{6,20})/i,
    /youtu\.be\/([A-Za-z0-9_-]{6,20})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = url.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) return v;
      const m = url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,20})/);
      if (m) return m[1];
    }
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return id;
    }
  } catch {}
  return null;
}

app.get("/__forknut/youtube-thumb/:id", async (request, reply) => {
  if (!allowImageRequest(request)) {
    return reply.code(429).header("Retry-After", "60").type("text/plain; charset=utf-8").send("Image request rate limit reached. Try again shortly.");
  }
  const id = String(request.params?.id || "");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return reply.code(400).type("text/plain; charset=utf-8").send("Invalid YouTube video id.");
  }

  const variants = [
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/default.jpg`
  ];

  for (const target of variants) {
    try {
      const upstream = await requestPinned(target, {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "referer": "https://www.youtube.com/",
        "accept-language": "en-US,en;q=0.9"
      }, 5 * 1024 * 1024);
      if (upstream.status < 200 || upstream.status >= 300) continue;
      const contentType = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!contentType.startsWith("image/")) continue;
      const length = Number(upstream.headers["content-length"] || 0);
      if (length > 5 * 1024 * 1024 || upstream.body.length > 5 * 1024 * 1024) continue;
      const buffer = upstream.body;
      if (!buffer.length) continue;
      return reply
        .code(200)
        .type(contentType || "image/jpeg")
        .header("Cache-Control", "public, max-age=3600")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(buffer);
    } catch (error) {
      console.error("[Forknut] YouTube thumbnail error:", error?.message || error);
    }
  }

  return reply.code(404).type("text/plain; charset=utf-8").send("YouTube thumbnail not available.");
});

app.get("/health", async () => ({
  ok: true,
  service: "Forknut Proxy",
  scramjet: "2.0.67-alpha.2",
  controller: "0.0.14",
  transport: "epoxy",
  wisp: true,
  coep: "credentialless",
  diagnostic: true,
  imageProxy: { rateLimitPerMinute: IMAGE_RATE_LIMIT, maxBytes: MAX_IMAGE_BYTES, maxConcurrent: MAX_ACTIVE_IMAGE_REQUESTS, dnsPinned: true },
  wisp: { maxConnectionsPerIp: MAX_WISP_CONNECTIONS_PER_IP, originChecked: true }
}));



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

console.log(`Forknut Proxy running on port ${port}`);
