importScripts("/controller/controller.sw.js");

const FORKNUT_DIAG = "/__forknut/diag";

function postDiag(payload) {
  const message = {
    source: "forknut-sw",
    time: new Date().toISOString(),
    ...payload
  };

  console.log("[Forknut SW Diagnostic]", message);

  self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(clients => {
      for (const client of clients) {
        client.postMessage(message);
      }
    })
    .catch(() => {});
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  let shouldRoute = false;

  try {
    shouldRoute = $scramjetController.shouldRoute(event);
  } catch (error) {
    postDiag({
      type: "SW_SHOULD_ROUTE_ERROR",
      url: event.request.url,
      destination: event.request.destination || "",
      error: String(error?.stack || error)
    });
    return;
  }

  if (!shouldRoute) return;

  const request = event.request;
  const started = performance.now();

  postDiag({
    type: "SW_ROUTE_START",
    url: request.url,
    destination: request.destination || "",
    method: request.method
  });

  event.respondWith((async () => {
    try {
      const response = await $scramjetController.route(event);

      const info = {
        type: "SW_ROUTE_RESPONSE",
        url: request.url,
        destination: request.destination || "",
        status: response?.status ?? "?",
        ok: response?.ok ?? "?",
        redirected: response?.redirected ?? "?",
        contentType: response?.headers?.get("content-type") || "",
        contentLength: response?.headers?.get("content-length") || "",
        elapsedMs: Math.round(performance.now() - started)
      };

      postDiag(info);

      // For image/media requests, inspect a CLONE only. The actual response
      // returned to the page is untouched.
      if (
        response &&
        response.body &&
        ["image", "video", "audio", "font"].includes(request.destination)
      ) {
        try {
          const clone = response.clone();
          const buffer = await clone.arrayBuffer();

          postDiag({
            type: "SW_BODY_READ",
            url: request.url,
            destination: request.destination || "",
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            bytes: buffer.byteLength,
            elapsedMs: Math.round(performance.now() - started)
          });
        } catch (bodyError) {
          postDiag({
            type: "SW_BODY_READ_ERROR",
            url: request.url,
            destination: request.destination || "",
            status: response?.status ?? "?",
            contentType: response?.headers?.get("content-type") || "",
            error: String(bodyError?.stack || bodyError),
            elapsedMs: Math.round(performance.now() - started)
          });
        }
      }

      return response;
    } catch (error) {
      postDiag({
        type: "SW_ROUTE_ERROR",
        url: request.url,
        destination: request.destination || "",
        method: request.method,
        error: String(error?.stack || error),
        elapsedMs: Math.round(performance.now() - started)
      });

      throw error;
    }
  })());
});
