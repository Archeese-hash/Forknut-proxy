importScripts("/controller/controller.sw.js");

// Forknut v11: image requests get a second chance through the server-side
// image proxy when WebKit/Scramjet cannot deliver the original response.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

function extractOriginalUrl(value) {
  let text = String(value || "");
  const candidates = [];

  for (let pass = 0; pass < 4; pass++) {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const item of matches) {
      try { candidates.push(new URL(item.replace(/[),;]+$/, "")).href); } catch {}
    }
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch { break; }
  }

  try {
    const parsed = new URL(text);
    for (const key of ["imgurl", "mediaurl", "image_url", "url", "src", "u"]) {
      const candidate = parsed.searchParams.get(key);
      if (candidate && /^https?:\/\//i.test(candidate)) candidates.unshift(candidate);
    }
  } catch {}

  const ownHost = self.location.hostname.toLowerCase();
  const scored = [];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (!host || host === ownHost || host.endsWith(".onrender.com")) continue;
      let score = 0;
      if (host === "i.ytimg.com" || host.endsWith(".ytimg.com")) score += 100;
      if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) score += 90;
      if (host === "gstatic.com" || host.endsWith(".gstatic.com")) score += 80;
      if (host === "ggpht.com" || host.endsWith(".ggpht.com")) score += 80;
      if (/[.](jpg|jpeg|png|webp|gif|avif|svg)(?:$|[?#])/i.test(parsed.pathname)) score += 60;
      if (/\/vi(?:_webp)?\//i.test(parsed.pathname)) score += 100;
      if (/\/search(?:[/?]|$)/i.test(parsed.pathname)) score -= 50;
      if (host === "google.com" || host.endsWith(".google.com")) score -= 30;
      scored.push({ href: parsed.href, score });
    } catch {}
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.href || "";
}

function looksLikeImage(response) {
  if (!response) return false;
  if (!response.ok) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  return type.startsWith("image/") || type === "application/octet-stream";
}

async function fallbackImage(request) {
  const original = extractOriginalUrl(request.url);
  // If the Scramjet URL cannot be decoded client-side, let the server do the
  // same extraction. This is important for Google Images URLs, which often
  // contain several layers of encoding.
  const target = original || request.url;

  const endpoint =
    "/__forknut/image?url=" + encodeURIComponent(target);

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
