importScripts("/controller/controller.sw.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function extractOriginalUrl(value) {
  let text = String(value || "");
  const candidates = [];
  for (let pass = 0; pass < 5; pass++) {
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
  const scored = candidates.map(href => {
    try {
      const u = new URL(href), host = u.hostname.toLowerCase();
      if (!host || host === ownHost || host.endsWith(".onrender.com")) return null;
      let score = 0;
      if (host === "i.ytimg.com" || host.endsWith(".ytimg.com")) score += 200;
      if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) score += 180;
      if (host === "gstatic.com" || host.endsWith(".gstatic.com")) score += 160;
      if (host === "ggpht.com" || host.endsWith(".ggpht.com")) score += 160;
      if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(?:$|[?#])/i.test(u.pathname)) score += 100;
      if (/\/vi(?:_webp)?\//i.test(u.pathname)) score += 200;
      if (/\/search(?:[/?]|$)/i.test(u.pathname)) score -= 100;
      if (host === "google.com" || host.endsWith(".google.com")) score -= 80;
      return { href: u.href, score };
    } catch { return null; }
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  return scored[0]?.href || "";
}

function youtubeId(value) {
  const match = String(value || "").match(/(?:i\.)?ytimg\.com\/(?:vi|vi_webp)\/([A-Za-z0-9_-]{6,20})/i);
  return match ? match[1] : null;
}

async function fallbackImage(request) {
  const id = youtubeId(request.url);
  const target = id
    ? "/__forknut/youtube-thumb/" + encodeURIComponent(id)
    : "/__forknut/image?url=" + encodeURIComponent(extractOriginalUrl(request.url) || request.url);
  try {
    const response = await fetch(target, { cache: "no-store" });
    if (response.ok) return response;
  } catch (error) {
    console.error("[Forknut] media fallback failed", error);
  }
  return null;
}

self.addEventListener("fetch", event => {
  try {
    if (!$scramjetController.shouldRoute(event)) return;
    const request = event.request;
    if (request.destination !== "image") {
      event.respondWith($scramjetController.route(event));
      return;
    }
    event.respondWith((async () => {
      // On iPad/WebKit, a failed/500 Scramjet image is common enough that the
      // first fallback should happen immediately rather than after another
      // route() call that can itself fail while transferring a stream.
      const fallback = await fallbackImage(request);
      if (fallback) return fallback;
      try {
        return await $scramjetController.route(event);
      } catch (error) {
        return new Response("Forknut image unavailable: " + (error?.message || error), { status: 502 });
      }
    })());
  } catch (error) {
    console.error("[Forknut] SW error", error);
  }
});
