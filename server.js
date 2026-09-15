import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, "public");

const dirOf = (specifier) =>
  path.dirname(require.resolve(specifier));

const controllerPath = dirOf(
  "@mercuryworkshop/scramjet-controller"
);

const utilsPath = dirOf(
  "@mercuryworkshop/scramjet-utils"
);

const epoxyPath = dirOf(
  "@mercuryworkshop/epoxy-transport"
);

const app = Fastify({
  logger: true,

  serverFactory: (handler) => {
    const server = http.createServer(handler);

    server.on("upgrade", (req, socket, head) => {
      try {
        const pathname = new URL(
          req.url || "/",
          "http://localhost"
        ).pathname;

        if (pathname === "/wisp/") {
          req.url = "/wisp/";
          wisp.routeRequest(req, socket, head);
        } else {
          socket.end();
        }
      } catch {
        socket.end();
      }
    });

    return server;
  }
});

app.addHook("onSend", async (_request, reply) => {
  reply.header(
    "Cross-Origin-Opener-Policy",
    "same-origin"
  );

  reply.header(
    "Cross-Origin-Embedder-Policy",
    "require-corp"
  );

  reply.header(
    "Cross-Origin-Resource-Policy",
    "cross-origin"
  );
});

/*
 * Scramjet
 */
await app.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scramjet/",
  decorateReply: false
});

/*
 * Scramjet controller
 */
await app.register(fastifyStatic, {
  root: controllerPath,
  prefix: "/controller/",
  decorateReply: false
});

/*
 * Scramjet utilities
 */
await app.register(fastifyStatic, {
  root: utilsPath,
  prefix: "/utils/",
  decorateReply: false
});

/*
 * Epoxy transport
 */
await app.register(fastifyStatic, {
  root: epoxyPath,
  prefix: "/epoxy/",
  decorateReply: false
});

/*
 * Forknut website
 */
await app.register(fastifyStatic, {
  root: publicPath,
  decorateReply: false
});

/*
 * Health check
 */
app.get("/health", async () => {
  return {
    ok: true,
    service: "Forknut Proxy"
  };
});

/*
 * Start server
 */
const port = Number(
  process.env.PORT || 3000
);

await app.listen({
  host: "0.0.0.0",
  port
});
