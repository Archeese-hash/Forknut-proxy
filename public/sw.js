importScripts("/controller/controller.sw.js");

// Forknut v7: image requests get a second chance through the server-side
// image proxy when WebKit/Scramjet cannot deliver the original response.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

function extractOriginalUrl(value) {
  const text = String(value || "");

  // Scramjet 2.x normally leaves the original absolute URL encoded at the
  // end of the rewritten path. Keep this deliberately broad because the
  // random path segments can change between requests.
  const encoded = text.match(/((?:https?|ftp)%3A%2F%2F[^?#\s]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {}
  }

  try {
    const decoded = decodeURIComponent(text);
    const match = decoded.match(/((?:https?|ftp):\/\/[^?#\s]+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function looksLikeImage(response) {
  if (!response) return false;
  if (!response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  return type.startsWith("image/") || type === "application/octet-stream";
}

async function fallbackImage(request) {
  const original = extractOriginalUrl(request.url);
  if (!original || !/^https?:\/\//i.test(original)) return null;

  const endpoint =
    "/__forknut/image?url=" + encodeURIComponent(original);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "accept": request.headers.get("accept") || "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      cache: "no-store"
    });

    if (response.ok) return response;
  } catch (error) {
    console.error("[Forknut] Image fallback failed:", error);
  }

  return null;
}

self.addEventListener("fetch", event => {
  try {
    if (!$scramjetController.shouldRoute(event)) return;

    const request = event.request;

    event.respondWith((async () => {
      const isImage = request.destination === "image";

      try {
        const response = await $scramjetController.route(event);

        if (!isImage || looksLikeImage(response)) {
          return response;
        }
      } catch (error) {
        if (!isImage) {
          console.error("[Forknut] Service worker routing error:", error);
          throw error;
        }
      }

      if (isImage) {
        const fallback = await fallbackImage(request);
        if (fallback) return fallback;
      }

      // If it was an image and both paths failed, retry Scramjet's normal
      // route once so its native error response is preserved.
      return $scramjetController.route(event);
    })());
  } catch (error) {
    console.error("[Forknut] Service worker setup error:", error);
  }
});
