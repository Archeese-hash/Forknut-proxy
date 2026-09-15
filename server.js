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
const dirOf = (specifier) => path.dirname(require.resolve(specifier));

const controllerPath = dirOf("@mercuryworkshop/scramjet-controller/dist/controller.api.js");
const utilsPath = dirOf("@mercuryworkshop/scramjet-utils");
const libcurlPath = dirOf("@mercuryworkshop/libcurl-transport");

const app = Fastify({
  logger: true,
  serverFactory: (handler) => {
    const server = http.createServer(handler);

    server.on("upgrade", (req, socket, head) => {
      try {
        const pathname = new URL(req.url || "/", "http://localhost").pathname;
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

// Scramjet requires cross-origin isolation for its WebAssembly runtime.
app.addHook("onSend", async (_request, reply) => {
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Cross-Origin-Embedder-Policy", "require-corp");
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
});

await app.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scramjet/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: controllerPath,
  prefix: "/controller/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: utilsPath,
  prefix: "/utils/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: libcurlPath,
  prefix: "/libcurl/",
  decorateReply: false
});

await app.register(fastifyStatic, {
  root: publicPath,
  decorateReply: false
});

app.get("/health", async () => ({ ok: true, service: "Forknut Proxy" }));

const port = Number(process.env.PORT || 3000);

await app.listen({
  host: "0.0.0.0",
  port
});
