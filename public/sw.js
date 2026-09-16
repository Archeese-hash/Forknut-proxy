importScripts("/controller/controller.sw.js");

// Forknut v6: force the browser to treat this worker as the current deployment.


self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  try {
    if ($scramjetController.shouldRoute(event)) {
      event.respondWith($scramjetController.route(event));
    }
  } catch (error) {
    console.error("[Forknut] Service worker routing error:", error);
  }
});
