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

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const publicPath = path.join(
  __dirname,
  "public"
);

function dirOf(packageName) {
  return path.dirname(
    require.resolve(packageName)
  );
}

const controllerPath = dirOf(
  "@mercuryworkshop/scramjet-controller"
);

const utilsPath = dirOf(
  "@mercuryworkshop/scramjet-utils"
);

const epoxyPath = dirOf(
  "@mercuryworkshop/epoxy-transport"
);

/*
 * iPad/iOS WebKit does not currently allow a ReadableStream
 * to be transferred through MessagePort. Scramjet 2.x normally
 * puts fetchresponse.body directly in the transfer list.
 *
 * We make a private copy of controller.api.js at startup and
 * change only those response paths to buffer ReadableStreams
 * into ArrayBuffers before MessagePort transfer.
 */
const patchedControllerPath = path.join(
  __dirname,
  ".forknut-controller"
);

async function prepareWebKitController() {
  await fs.rm(
    patchedControllerPath,
    {
      recursive: true,
      force: true
    }
  );

  await fs.cp(
    controllerPath,
    patchedControllerPath,
    {
      recursive: true
    }
  );

  const apiFile = path.join(
    patchedControllerPath,
    "controller.api.js"
  );

  let source = await fs.readFile(
    apiFile,
    "utf8"
  );

  const originalRequestBlock =
`return [
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
];`;

  const webkitRequestBlock =
`let forknetBody = fetchresponse.body;
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
];`;

  if (source.includes(originalRequestBlock)) {
    source = source.replace(
      originalRequestBlock,
      webkitRequestBlock
    );
  } else {
    /*
     * Fallback for a minified/format-shifted build.
     * This targets the same semantic expression without
     * depending on whitespace.
     */
    const responseRegex = /return\s*\[\s*\{\s*body:\s*fetchresponse\.body,\s*status:\s*fetchresponse\.status,\s*statusText:\s*fetchresponse\.statusText,\s*headers:\s*fetchresponse\.headers\.toRawHeaders\(\),\s*\},\s*fetchresponse\.body\s+instanceof\s+ReadableStream\s*\|\|\s*fetchresponse\.body\s+instanceof\s+ArrayBuffer\s*\?\s*\[fetchresponse\.body\]\s*:\s*\[\],\s*\];/s;

    if (responseRegex.test(source)) {
      source = source.replace(
        responseRegex,
        webkitRequestBlock
      );
    }
  }

  /*
   * The controller also transfers transport response bodies.
   * Buffer a ReadableStream there as well for WebKit.
   */
  const originalTransportBlock =
`return [response, [response.body]];`;

  const webkitTransportBlock =
`let forknetTransportBody = response.body;
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
];`;

  if (source.includes(originalTransportBlock)) {
    source = source.replace(
      originalTransportBlock,
      webkitTransportBlock
    );
  }

  await fs.writeFile(
    apiFile,
    source,
    "utf8"
  );

  const requestPatched =
    source.includes("forknetBody = await new Response(forknetBody).arrayBuffer()");

  const transportPatched =
    source.includes("forknetTransportBody = await new Response(forknetTransportBody).arrayBuffer()");

  console.log(
    `[Forknut] WebKit controller patch: request=${requestPatched} transport=${transportPatched}`
  );
}

await prepareWebKitController();

const app = Fastify({
  logger: true,

  serverFactory: (handler) => {
    const server = http.createServer(
      handler
    );

    server.on(
      "upgrade",
      (req, socket, head) => {
        try {
          const pathname =
            new URL(
              req.url || "/",
              "http://localhost"
            ).pathname;

          if (pathname === "/wisp/") {
            console.log(
              "[Forknut] Wisp connection opened"
            );

            req.url = "/wisp/";

            wisp.routeRequest(
              req,
              socket,
              head
            );

            return;
          }

          console.log(
            "[Forknut] Rejected WebSocket:",
            pathname
          );

          socket.end();
        } catch (error) {
          console.error(
            "[Forknut] Wisp error:",
            error
          );

          socket.end();
        }
      }
    );

    return server;
  }
});

app.addHook(
  "onSend",
  async (request, reply) => {
    reply.header(
      "Cross-Origin-Opener-Policy",
      "same-origin"
    );

    reply.header(
      "Cross-Origin-Embedder-Policy",
      "credentialless"
    );

    reply.header(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );

    if (request.url === "/sw.js") {
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );

      reply.header(
        "Pragma",
        "no-cache"
      );

      reply.header(
        "Expires",
        "0"
      );
    }

    if (request.url === "/app.js") {
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );
    }

    if (request.url === "/controller/controller.api.js") {
      reply.header(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );
    }
  }
);

await app.register(
  fastifyStatic,
  {
    root: scramjetPath,
    prefix: "/scramjet/",
    decorateReply: false
  }
);

await app.register(
  fastifyStatic,
  {
    root: patchedControllerPath,
    prefix: "/controller/",
    decorateReply: false
  }
);

await app.register(
  fastifyStatic,
  {
    root: utilsPath,
    prefix: "/utils/",
    decorateReply: false
  }
);

await app.register(
  fastifyStatic,
  {
    root: epoxyPath,
    prefix: "/epoxy/",
    decorateReply: false
  }
);

await app.register(
  fastifyStatic,
  {
    root: publicPath,
    decorateReply: false
  }
);

app.get(
  "/health",
  async () => {
    return {
      ok: true,
      service: "Forknut Proxy",
      scramjet: "2.0.67-alpha.2",
      controller: "0.0.14",
      transport: "epoxy",
      wisp: true,
      coep: "credentialless",
      webkitFix: true
    };
  }
);

const port = Number(
  process.env.PORT || 3000
);

await app.listen({
  host: "0.0.0.0",
  port
});

console.log(
  `Forknut Proxy running on port ${port}`
);
