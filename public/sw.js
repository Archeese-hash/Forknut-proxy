importScripts(
  "/controller/controller.sw.js"
);

self.addEventListener(
  "install",
  () => {
    self.skipWaiting();
  }
);

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      self.clients.claim()
    );
  }
);

self.addEventListener(
  "fetch",
  event => {
    try {
      if (
        $scramjetController.shouldRoute(
          event
        )
      ) {
        event.respondWith(
          $scramjetController.route(
            event
          ).catch(error => {
            console.error(
              "[Forknut Diagnostic] Service worker route failed:",
              error
            );
            throw error;
          })
        );
      }
    } catch (error) {
      console.error(
        "[Forknut Diagnostic] Service worker fetch handling failed:",
        error
      );
    }
  }
);
