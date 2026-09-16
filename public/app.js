const input = document.getElementById("urlInput") || document.querySelector('input[type="url"], input[name="url"], input[type="text"]');
const form = document.getElementById("searchForm") || document.querySelector("form");
const status = document.getElementById("status") || document.querySelector(".status");
const browser = document.getElementById("browser");
const shell = document.getElementById("shell");
const homeButton = document.getElementById("homeButton");
const tabsElement = document.getElementById("tabs") || document.querySelector(".tabs");
const newTabButton = document.getElementById("newTabButton") || document.querySelector('[data-action="new-tab"]');
const pointercrateButton = document.getElementById("pointercrateButton") || document.querySelector('[data-site="pointercrate"]');
const gamesButton = document.getElementById("gamesButton") || document.querySelector('[data-action="games"]');

let controller = null;
let nextTabId = 1;
let activeTabId = null;
const tabs = [];
let gameFrame = null;
let gamesOpen = false;

function setStatus(text) {
  if (status) status.textContent = text;
}

function normalizeUrl(value) {
  const text = value.trim();
  if (!text) throw new Error("Enter a website or search term.");

  if (/^https?:\/\//i.test(text)) return new URL(text).href;

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(text)) {
    return "https://" + text;
  }

  return "https://www.google.com/search?q=" + encodeURIComponent(text);
}

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/^m\./, "");

    if (hostname === "youtube.com" || hostname === "youtube-nocookie.com") {
      const videoId = url.searchParams.get("v");
      if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return videoId;

      const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,20})/);
      if (shorts) return shorts[1];

      const embed = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,20})/);
      if (embed) return embed[1];
    }

    if (hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return id;
    }
  } catch (error) {
    console.error("YouTube detection error:", error);
  }

  return null;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none"
  });

  await registration.update().catch(() => {});

  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Forknut's service worker did not take control. Reload Forknut and try again."));
    }, 15000);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });

  return navigator.serviceWorker.controller || registration.active;
}

let controllerPromise = null;

async function getController() {
  if (controller) return controller;
  if (controllerPromise) return controllerPromise;

  controllerPromise = (async () => {
    setStatus("Starting proxy...");

    const serviceWorker = await registerServiceWorker();

    const wispUrl =
      (location.protocol === "https:" ? "wss" : "ws") +
      "://" + location.host + "/wisp/";

    let EpoxyClient;
    try {
      const epoxy = await import("/epoxy/index.mjs");
      EpoxyClient = epoxy.EpoxyClient || epoxy.default;
    } catch (error) {
      console.error("Epoxy loading error:", error);
      throw new Error("Forknut could not load its Epoxy transport.");
    }

    if (typeof EpoxyClient !== "function") {
      throw new Error("Forknut loaded an invalid Epoxy transport.");
    }

    const transport = new EpoxyClient({ wisp: wispUrl });
    await Promise.race([
      transport.init(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Epoxy took too long to start.")), 15000))
    ]);

    const instance = new $scramjetController.Controller({
      serviceworker: serviceWorker,
      transport: transport,
      config: {
        prefix: "/~/sj/",
        scramjetPath: "/scramjet/scramjet.js",
        wasmPath: "/scramjet/scramjet.wasm",
        injectPath: "/controller/controller.inject.js"
      }
    });

    await Promise.race([
      instance.wait(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Scramjet took too long to start. Please reload Forknut.")), 15000))
    ]);

    controller = instance;
    setStatus("Ready");
    return controller;
  })().catch(error => {
    controllerPromise = null;
    setStatus(error?.message || "Forknut could not start.");
    throw error;
  });

  return controllerPromise;
}

function createTab() {
  const tab = {
    id: nextTabId++,
    title: "New Tab",
    url: "",
    frame: null,
    iframe: null,
    youtubeFrame: null
  };

  tabs.push(tab);
  activeTabId = tab.id;
  renderTabs();
  shell.classList.remove("hidden");
  browser.classList.remove("active");
  if (homeButton) homeButton.classList.remove("visible");
  setStatus("Ready");

  if (input) {
    input.value = "";
    input.focus();
  }

  return tab;
}

function getActiveTab() {
  return tabs.find(tab => tab.id === activeTabId);
}

function renderTabs() {
  if (!tabsElement) return;
  tabsElement.innerHTML = "";

  for (const tab of tabs) {
    const element = document.createElement("div");
    element.className = "tab";
    if (tab.id === activeTabId) element.classList.add("active");

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || "New Tab";

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.textContent = "Ã";
    close.title = "Close tab";
    close.addEventListener("click", event => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    element.appendChild(title);
    element.appendChild(close);
    element.addEventListener("click", () => switchTab(tab.id));
    tabsElement.appendChild(element);
  }
}

function switchTab(id) {
  const tab = tabs.find(item => item.id === id);
  if (!tab) return;

  activeTabId = id;
  renderTabs();
  showTab(tab);
  setStatus(tab.url || "Ready");
}

function showTab(tab) {
  if (!browser) return;

  const gamesPanel = document.getElementById("gamesPanel");
  if (gamesPanel) gamesPanel.classList.remove("active");
  gamesOpen = false;
  if (!tab?.url && !tab?.iframe && !tab?.youtubeFrame) {
    shell.classList.remove("hidden");
    browser.classList.remove("active");
    if (homeButton) homeButton.classList.remove("visible");
    return;
  }
  shell.classList.add("hidden");
  browser.classList.add("active");
  if (homeButton) homeButton.classList.add("visible");

  for (const other of tabs) {
    if (other.iframe) other.iframe.style.display = "none";
    if (other.youtubeFrame) other.youtubeFrame.style.display = "none";
  }

  if (tab.iframe) tab.iframe.style.display = "block";
  if (tab.youtubeFrame) tab.youtubeFrame.style.display = "block";
}

function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index === -1) return;

  const tab = tabs[index];
  if (tab.imageObserver) tab.imageObserver.disconnect();
  if (tab.mediaObserver) tab.mediaObserver.disconnect();
  if (tab.iframe) tab.iframe.remove();
  if (tab.youtubeFrame) tab.youtubeFrame.remove();

  tabs.splice(index, 1);

  if (tabs.length === 0) {
    activeTabId = null;
    browser.classList.remove("active");
    const gamesPanel = document.getElementById("gamesPanel");
    if (gamesPanel) gamesPanel.classList.remove("active");
    gamesOpen = false;
    shell.classList.remove("hidden");
    homeButton.classList.remove("visible");
    createTab();
    return;
  }

  if (activeTabId === id) {
    const newIndex = Math.min(index, tabs.length - 1);
    activeTabId = tabs[newIndex].id;
  }

  renderTabs();
  const active = getActiveTab();
  showTab(active);
  setStatus(active?.url || "Ready");
}

function showYouTubePlayer(tab, videoId) {
  if (tab.youtubeFrame) tab.youtubeFrame.remove();

  const iframe = document.createElement("iframe");
  iframe.className = "youtube-frame";
  iframe.title = "YouTube video";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.src =
    "https://www.youtube.com/embed/" +
    encodeURIComponent(videoId) +
    "?playsinline=1&rel=0&controls=1";

  browser.appendChild(iframe);
  tab.youtubeFrame = iframe;
  tab.title = "YouTube";
  renderTabs();
  showTab(tab);
  setStatus("YouTube video");
}


// Automatic image fallback for iPad/WebKit. If Scramjet cannot deliver an
// image resource, retry the original URL through Forknut's server proxy.
function extractOriginalUrl(value) {
  let text = String(value || "");
  const candidates = [];

  // Google Images and Scramjet can encode the real image URL several times.
  // Decode repeatedly, then collect every absolute URL we can find.
  for (let pass = 0; pass < 4; pass++) {
    const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const item of urlMatches) {
      try {
        candidates.push(new URL(item.replace(/[),;]+$/, "")).href);
      } catch {}
    }

    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }

  // Prefer explicit image URL parameters used by Google image results.
  for (const value of [text, String(value || "")]) {
    try {
      const parsed = new URL(value, location.href);
      for (const key of ["imgurl", "mediaurl", "image_url", "url", "src", "u"]) {
        const candidate = parsed.searchParams.get(key);
        if (candidate && /^https?:\/\//i.test(candidate)) {
          candidates.unshift(candidate);
        }
      }
    } catch {}
  }

  // Prefer actual image-CDN URLs over the surrounding Google/YouTube page URL.
  // Scramjet can leave several absolute URLs in a rewritten image request.
  const ownHost = String(location.hostname || "").toLowerCase();
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

function forknetImageEndpoint(original) {
  // IMPORTANT: this code may be inspecting an iframe whose document URL is
  // google.com/pointercrate.com. The fallback endpoint must always go to the
  // actual Forknut app origin, not the proxied site's origin.
  const endpoint = new URL("/__forknut/image", window.location.origin);
  endpoint.searchParams.set("url", original);
  return endpoint.href;
}

function fallbackImageThroughServer(img) {
  if (!img || img.dataset.forknutFallback === "1") return;
  const current = img.getAttribute("src") || img.currentSrc || img.src || "";
  const original = extractOriginalUrl(current);
  if (!original || !/^https?:\/\//i.test(original)) return;
  img.dataset.forknutFallback = "1";
  img.src = forknetImageEndpoint(original);
}

function watchImage(img) {
  if (!img || img.dataset.forknutWatching === "1") return;
  img.dataset.forknutWatching = "1";
  img.addEventListener("error", () => fallbackImageThroughServer(img), { once: true });
  if (img.complete && img.naturalWidth === 0 && img.src) {
    fallbackImageThroughServer(img);
  }
}

function installImageFallback(tab) {
  const iframe = tab?.iframe;
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("img").forEach(watchImage);
    if (!tab.imageObserver) {
      tab.imageObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.("img")) watchImage(node);
            node.querySelectorAll?.("img").forEach(watchImage);
          }
        }
      });
      tab.imageObserver.observe(doc.documentElement || doc, { childList: true, subtree: true });
    }
  } catch {}
}


function youtubeThumbEndpoint(id) {
  return new URL("/__forknut/youtube-thumb/" + encodeURIComponent(id), window.location.origin).href;
}

function youtubeIdFromImage(value) {
  const text = String(value || "");
  const match = text.match(/(?:i\.)?ytimg\.com\/(?:vi|vi_webp)\/([A-Za-z0-9_-]{6,20})/i);
  return match ? match[1] : null;
}

function rewriteMediaImage(img) {
  if (!img || img.dataset.forknutMediaFixed === "1") return;
  const current = img.getAttribute("src") || img.currentSrc || img.src || "";
  if (!current || current.startsWith("data:") || current.startsWith("blob:") || current.startsWith("/__/")) return;

  const ytId = youtubeIdFromImage(current);
  if (ytId) {
    img.dataset.forknutMediaFixed = "1";
    img.src = youtubeThumbEndpoint(ytId);
    return;
  }

  const original = extractOriginalUrl(current);
  if (original && /^https?:\/\//i.test(original)) {
    img.dataset.forknutMediaFixed = "1";
    img.src = forknetImageEndpoint(original);
  }
}

function rewriteBackgroundMedia(element) {
  if (!element || element.dataset.forknutBgFixed === "1") return;
  const style = element.getAttribute("style") || "";
  if (!style.includes("url(")) return;
  const match = style.match(/url\((?:"|')?([^"')]+)(?:"|')?\)/i);
  if (!match) return;
  const raw = match[1];
  const ytId = youtubeIdFromImage(raw);
  let replacement = "";
  if (ytId) replacement = youtubeThumbEndpoint(ytId);
  else {
    const original = extractOriginalUrl(raw);
    if (original) replacement = forknetImageEndpoint(original);
  }
  if (!replacement) return;
  element.dataset.forknutBgFixed = "1";
  element.style.backgroundImage = `url("${replacement.replace(/"/g, '%22')}")`;
}

function installMediaFix(tab) {
  const iframe = tab?.iframe;
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("img").forEach(rewriteMediaImage);
    doc.querySelectorAll("[style*='url(']").forEach(rewriteBackgroundMedia);
    if (!tab.mediaObserver) {
      tab.mediaObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.target) {
            if (mutation.attributeName === "src") rewriteMediaImage(mutation.target);
            if (mutation.attributeName === "style") rewriteBackgroundMedia(mutation.target);
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.("img")) rewriteMediaImage(node);
            if (node.matches?.("[style*='url(']")) rewriteBackgroundMedia(node);
            node.querySelectorAll?.("img").forEach(rewriteMediaImage);
            node.querySelectorAll?.("[style*='url(']").forEach(rewriteBackgroundMedia);
          }
        }
      });
      tab.mediaObserver.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
    }
  } catch (error) {
    console.debug("[Forknut] Media fix unavailable:", error);
  }
}

function openLocalGame(path, title) {
  const gamesPanel = document.getElementById("gamesPanel");
  const gameHub = document.getElementById("gameHub");
  if (!gamesPanel || !gameHub) return;

  gamesOpen = true;
  shell.classList.add("hidden");
  browser.classList.remove("active");
  if (homeButton) homeButton.classList.add("visible");
  gamesPanel.classList.add("active");

  gameHub.innerHTML = `
    <div class="game-view-head">
      <button type="button" id="backToGames" class="game-back">â Games</button>
      <strong>${title}</strong>
    </div>
    <iframe class="local-game-frame" src="${path}" title="${title}" allow="fullscreen; gamepad; autoplay"></iframe>
  `;
  gameFrame = gameHub.querySelector("iframe");
  gameHub.querySelector("#backToGames").addEventListener("click", showGamesHub);
  setStatus(title);
}

function showGamesHub() {
  const gamesPanel = document.getElementById("gamesPanel");
  const gameHub = document.getElementById("gameHub");
  if (!gamesPanel || !gameHub) return;
  gamesOpen = true;
  shell.classList.add("hidden");
  browser.classList.remove("active");
  if (homeButton) homeButton.classList.add("visible");
  gamesPanel.classList.add("active");
  gameHub.innerHTML = `
    <div class="games-heading"><span>ð®</span><div><h2>Games</h2><p>Playable on iPad â no external game site required.</p></div></div>
    <div class="game-grid">
      <button class="game-card" data-local-game="/games/snake.html" data-game-title="Snake"><span>ð</span><strong>Snake</strong><small>Classic touch controls</small></button>
      <button class="game-card" data-local-game="/games/2048.html" data-game-title="2048"><span>ð¢</span><strong>2048</strong><small>Swipe to combine tiles</small></button>
      <button class="game-card" data-local-game="/games/flappy.html" data-game-title="Flappy Fork"><span>ð¤</span><strong>Flappy Fork</strong><small>Tap to fly</small></button>
      <button class="game-card" data-local-game="/games/pong.html" data-game-title="Pong"><span>ð</span><strong>Pong</strong><small>Touch / drag paddle</small></button>
    </div>
  `;
  gameHub.querySelectorAll("[data-local-game]").forEach(card => {
    card.addEventListener("click", () => openLocalGame(card.dataset.localGame, card.dataset.gameTitle));
  });
  setStatus("Games");
}

async function createProxyFrame(tab) {
  const sj = await getController();

  const iframe = document.createElement("iframe");
  iframe.className = "proxy-frame";
  iframe.setAttribute("allow", "fullscreen; autoplay; gamepad; picture-in-picture; encrypted-media");
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("loading", "eager");
  iframe.setAttribute("title", "Forknut Proxy");

  browser.appendChild(iframe);
  tab.iframe = iframe;

  iframe.addEventListener("load", () => {
    setTimeout(() => installImageFallback(tab), 50);
    setTimeout(() => installImageFallback(tab), 500);
    setTimeout(() => installImageFallback(tab), 2000);
    setTimeout(() => installMediaFix(tab), 100);
    setTimeout(() => installMediaFix(tab), 1000);
    setTimeout(() => installMediaFix(tab), 3000);
  });

  tab.frame = sj.createFrame(iframe, {
    plugins: [
      new $scramjetUtils.HttpCachePlugin(),
      new $scramjetUtils.UrlWatcherPlugin(currentUrl => {
        if (tab.id !== activeTabId) return;

        console.log("[Forknut] URL:", currentUrl);

        const videoId = getYouTubeVideoId(currentUrl);
        if (videoId) {
          showYouTubePlayer(tab, videoId);
          return;
        }

        tab.url = currentUrl;

        try {
          tab.title = new URL(currentUrl).hostname.replace(/^www\./, "");
        } catch {
          tab.title = "Forknut";
        }

        renderTabs();
        setStatus(currentUrl);
      }),
      new $scramjetUtils.CatchEscapedLinksPlugin(() => new URL(location.href))
    ]
  });

  return tab;
}

async function browse(url) {
  const tab = getActiveTab();
  if (!tab) return;

  try {
    setStatus("Loading...");

    const videoId = getYouTubeVideoId(url);
    if (videoId) {
      tab.url = url;
      showYouTubePlayer(tab, videoId);
      return;
    }

    if (tab.youtubeFrame) {
      tab.youtubeFrame.remove();
      tab.youtubeFrame = null;
    }

    if (!tab.frame) await createProxyFrame(tab);

    tab.url = url;
    tab.title = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "Loading...";
      }
    })();

    renderTabs();
    showTab(tab);
    setStatus("Loading " + url);
    tab.frame.go(url);
  } catch (error) {
    console.error("[Forknut] Proxy error:", error);
    setStatus(error?.message || "Forknut could not load this website.");
  }
}

if (newTabButton) {
  newTabButton.addEventListener("click", () => createTab());
}

if (form) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await browse(normalizeUrl(input.value));
    } catch (error) {
      console.error("[Forknut] URL error:", error);
      setStatus(error?.message || "Something went wrong.");
    }
  });
}

if (homeButton) {
  homeButton.addEventListener("click", () => {
    const tab = getActiveTab();
    if (tab?.iframe) tab.iframe.style.display = "none";
    if (tab?.youtubeFrame) tab.youtubeFrame.style.display = "none";

    browser.classList.remove("active");
    const gamesPanel = document.getElementById("gamesPanel");
    if (gamesPanel) gamesPanel.classList.remove("active");
    gamesOpen = false;
    shell.classList.remove("hidden");
    homeButton.classList.remove("visible");
    setStatus("Ready");
    if (input) input.focus();
  });
}

if (pointercrateButton) {
  pointercrateButton.addEventListener("click", async () => {
    const tab = getActiveTab();
    if (!tab) return;
    await browse("https://pointercrate.com/demonlist/");
  });
}

if (gamesButton) {
  gamesButton.addEventListener("click", () => {
    showGamesHub();
  });
}

// Local games are intentionally not sent through Scramjet. They are bundled
// with Forknut so they render and remain playable on iPad even when a remote
// game host blocks framing or its assets.

document.querySelectorAll("[data-local-game]").forEach(card => {
  card.addEventListener("click", () => {
    openLocalGame(card.dataset.localGame, card.dataset.gameTitle || "Game");
  });
});

createTab();
setStatus("Ready");
if (input) input.focus();
