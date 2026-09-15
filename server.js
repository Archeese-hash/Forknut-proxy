import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import http from "node:http";
import path from "node:path";
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

function packagePath(packageName) {
  return path.dirname(
    require.resolve(packageName)
  );
}

const controllerPath =
  packagePath(
    "@mercuryworkshop/scramjet-controller"
  );

const utilsPath =
  packagePath(
    "@mercuryworkshop/scramjet-utils"
  );

const libcurlPath =
  packagePath(
    "@mercuryworkshop/libcurl-transport"
  );

const app = Fastify({
  logger: true,

  serverFactory: (handler) => {
    const server =
      http.createServer(handler);

    server.on(
      "upgrade",
      (req, socket, head) => {
        try {
          const pathname =
            new URL(
              req.url || "/",
              "http://localhost"
            ).pathname;

          if (
            pathname === "/wisp/"
          ) {
            req.url = "/wisp/";

            wisp.routeRequest(
              req,
              socket,
              head
            );
          } else {
            socket.end();
          }
        } catch (error) {
          console.error(
            "Wisp error:",
            error
          );

          socket.end();
        }
      }
    );

    return server;
  }
});


/*
 * Cross-origin isolation
 */
app.addHook(
  "onSend",
  async (_request, reply) => {

    reply.header(
      "Cross-Origin-Opener-Policy",
      "same-origin"
    );

    reply.header(
      "Cross-Origin-Embedder-Policy",
      "require-corp"
    );

  }
);


/*
 * Scramjet
 */
await app.register(
  fastifyStatic,
  {
    root: scramjetPath,
    prefix: "/scramjet/",
    decorateReply: false
  }
);


/*
 * Controller
 */
await app.register(
  fastifyStatic,
  {
    root: controllerPath,
    prefix: "/controller/",
    decorateReply: false
  }
);


/*
 * Utils
 */
await app.register(
  fastifyStatic,
  {
    root: utilsPath,
    prefix: "/utils/",
    decorateReply: false
  }
);


/*
 * LIBCURL
 *
 * This serves:
 *
 * /libcurl/index.mjs
 * /libcurl/index.js
 * and the libcurl WASM files.
 */
await app.register(
  fastifyStatic,
  {
    root: libcurlPath,
    prefix: "/libcurl/",
    decorateReply: false
  }
);


/*
 * Forknut website
 */
await app.register(
  fastifyStatic,
  {
    root: publicPath,
    decorateReply: false
  }
);


/*
 * Health check
 */
app.get(
  "/health",
  async () => {
    return {
      ok: true,
      service: "Forknut Proxy",
      transport: "libcurl",
      scramjet: "2.0.67-alpha.2"
    };
  }
);


/*
 * Start server
 */
const port =
  Number(
    process.env.PORT || 3000
  );

await app.listen({
  host: "0.0.0.0",
  port
});

console.log(
  `Forknut Proxy running on port ${port}`
);
