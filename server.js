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


/* -------------------------------- */
/* Package paths */
/* -------------------------------- */

function dirOf(packageName) {
  return path.dirname(
    require.resolve(packageName)
  );
}

const controllerPath =
  dirOf(
    "@mercuryworkshop/scramjet-controller"
  );

const utilsPath =
  dirOf(
    "@mercuryworkshop/scramjet-utils"
  );

const libcurlPath =
  dirOf(
    "@mercuryworkshop/libcurl-transport"
  );


/* -------------------------------- */
/* Fastify */
/* -------------------------------- */

const app = Fastify({
  logger: true,

  serverFactory: (handler) => {

    const server =
      http.createServer(
        handler
      );


    /* ------------------------------ */
    /* Wisp WebSocket */
    /* ------------------------------ */

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

            console.log(
              "[Forknut] Wisp connection opened"
            );

            req.url =
              "/wisp/";

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


/* -------------------------------- */
/* Security / cross-origin headers */
/* -------------------------------- */

app.addHook(
  "onSend",
  async (
    request,
    reply
  ) => {

    /*
     * Scramjet needs the page to remain
     * cross-origin isolated.
     *
     * COOP stays the normal Scramjet value.
     */

    reply.header(
      "Cross-Origin-Opener-Policy",
      "same-origin"
    );


    /*
     * IMPORTANT:
     *
     * We are testing credentialless instead
     * of require-corp.
     *
     * This allows compatible cross-origin
     * images/resources to load even when
     * their original server doesn't provide
     * a CORP header.
     */

    reply.header(
      "Cross-Origin-Embedder-Policy",
      "credentialless"
    );


    /*
     * Allow resources served by Forknut itself
     * to be used safely by the proxy shell.
     */

    reply.header(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );


    /*
     * Service worker must never be cached.
     */

    if (
      request.url === "/sw.js"
    ) {

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
  }
);


/* -------------------------------- */
/* Scramjet core */
/* -------------------------------- */

await app.register(
  fastifyStatic,
  {
    root:
      scramjetPath,

    prefix:
      "/scramjet/",

    decorateReply:
      false
  }
);


/* -------------------------------- */
/* Scramjet controller */
/* -------------------------------- */

await app.register(
  fastifyStatic,
  {
    root:
      controllerPath,

    prefix:
      "/controller/",

    decorateReply:
      false
  }
);


/* -------------------------------- */
/* Scramjet utilities */
/* -------------------------------- */

await app.register(
  fastifyStatic,
  {
    root:
      utilsPath,

    prefix:
      "/utils/",

    decorateReply:
      false
  }
);


/* -------------------------------- */
/* Libcurl transport */
/* -------------------------------- */

await app.register(
  fastifyStatic,
  {
    root:
      libcurlPath,

    prefix:
      "/libcurl/",

    decorateReply:
      false
  }
);


/* -------------------------------- */
/* Forknut website */
/* -------------------------------- */

await app.register(
  fastifyStatic,
  {
    root:
      publicPath,

    decorateReply:
      false
  }
);


/* -------------------------------- */
/* Health check */
/* -------------------------------- */

app.get(
  "/health",
  async () => {

    return {
      ok:
        true,

      service:
        "Forknut Proxy",

      scramjet:
        "2.0.67-alpha.2",

      controller:
        "0.0.14",

      transport:
        "libcurl",

      wisp:
        true,

      coep:
        "credentialless"
    };
  }
);


/* -------------------------------- */
/* Start server */
/* -------------------------------- */

const port =
  Number(
    process.env.PORT || 3000
  );


await app.listen({
  host:
    "0.0.0.0",

  port
});


console.log(
  `Forknut Proxy running on port ${port}`
);
