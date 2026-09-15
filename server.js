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

function dirOf(packageName) {
  return path.dirname(
    require.resolve(packageName)
  );
}

const controllerPath =
  dirOf("@mercuryworkshop/scramjet-controller");

const utilsPath =
  dirOf("@mercuryworkshop/scramjet-utils");

const epoxyPath =
  dirOf("@mercuryworkshop/epoxy-transport");


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
            "WebSocket error:",
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
==================================================
IMPORTANT
==================================================

DO NOT SET:

Cross-Origin-Embedder-Policy

DO NOT SET:

Cross-Origin-Opener-Policy

We are deliberately leaving these headers OFF.

This allows normal cross-origin resources inside
Scramjet pages, including:

images
videos
game assets
fonts
CSS
JavaScript
audio

Scramjet's service worker/controller handles the
proxying itself.
==================================================
*/


/*
==================================================
SCRAMJET
==================================================
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
==================================================
CONTROLLER
==================================================
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
==================================================
UTILS
==================================================
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
==================================================
EPOXY
==================================================
*/

await app.register(
  fastifyStatic,
  {
    root: epoxyPath,
    prefix: "/epoxy/",
    decorateReply: false
  }
);


/*
==================================================
FORKNUT WEBSITE
==================================================
*/

await app.register(
  fastifyStatic,
  {
    root: publicPath,
    decorateReply: false
  }
);


/*
==================================================
HEALTH CHECK
==================================================
*/

app.get(
  "/health",
  async () => {

    return {
      ok: true,
      service: "Forknut Proxy",
      scramjet: "2.0.67-alpha.2",
      transport: "epoxy",
      crossOriginIsolation: false
    };

  }
);


/*
==================================================
START
==================================================
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
