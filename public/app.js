let controller = null;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const form = document.getElementById("proxyForm");
const input = document.getElementById("url");
const shell = document.getElementById("shell");
const browser = document.getElementById("browser");
const status = document.getElementById("status");
const homeButton = document.getElementById("homeButton");
const tabsElement = document.getElementById("tabs");
const newTabButton = document.getElementById("newTabButton");
const pointercrateButton = document.getElementById("pointercrateButton");
const gamesButton = document.getElementById("gamesButton");

/* -------------------------------- */
/* Forknut image/resource diagnostics v2 */
/* -------------------------------- */

const diagnosticEvents = [];
let diagnosticPanel = null;
let diagnosticObserver = null;
let diagnosticSeenResources = new Set();
let diagnosticImageCount = 0;
let diagnosticFailureCount = 0;

function ensureDiagnosticPanel() {
  if (diagnosticPanel) return diagnosticPanel;

  diagnosticPanel = document.createElement("div");
  diagnosticPanel.id = "forknutDiagnostics";
  diagnosticPanel.style.cssText = [
    "position:fixed",
    "left:8px",
    "right:8px",
    "bottom:8px",
    "z-index:2147483647",
    "max-height:42vh",
    "overflow:auto",
    "background:rgba(0,0,0,.94)",
    "color:#fff",
    "border:1px solid rgba(255,255,255,.28)",
    "border-radius:12px",
    "padding:10px",
    "font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "display:block",
    "white-space:pre-wrap",
    "word-break:break-all",
    "box-sizing:border-box"
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-weight:700;margin-bottom:7px";
  title.textContent = "Forknut Diagnostic v2";

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px";

  const clear = document.createElement("button");
  clear.textContent = "Clear";
  clear.onclick = () => {
    diagnosticEvents.length = 0;
    diagnosticSeenResources.clear();
    diagnosticImageCount = 0;
    diagnosticFailureCount = 0;
    renderDiagnosticPanel();
  };

  const probe = document.createElement("button");
  probe.textContent = "Probe images";
  probe.onclick = () => {
    const tab = getActiveTab();
    if (tab) inspectFrameResources(tab, true);
  };

  const copy = document.createElement("button");
  copy.textContent = "Copy";
  copy.onclick = async () => {
    const text = diagnosticEvents.map(JSON.stringify).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      diagnosticLog("UI", "diagnostics copied");
    } catch (e) {
      diagnosticLog("UI", "copy failed", { error: String(e) });
    }
  };

  for (const b of [clear, probe, copy]) {
    b.style.cssText = "font:12px -apple-system;padding:5px 8px;border-radius:7px;border:0";
    controls.appendChild(b);
  }

  const summary = document.createElement("div");
  summary.id = "forknutDiagnosticSummary";
  summary.style.cssText = "margin:6px 0;font-weight:600";

  const output = document.createElement("pre");
  output.id = "forknutDiagnosticOutput";
  output.style.cssText = "margin:0;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace";

  diagnosticPanel.append(title, controls, summary, output);
  document.body.appendChild(diagnosticPanel);
  return diagnosticPanel;
}

function renderDiagnosticPanel() {
  const panel = ensureDiagnosticPanel();
  const summary = panel.querySelector("#forknutDiagnosticSummary");
  const output = panel.querySelector("#forknutDiagnosticOutput");

  summary.textContent =
    `Events: ${diagnosticEvents.length} | Images: ${diagnosticImageCount} | Image failures: ${diagnosticFailureCount}`;

  output.textContent = diagnosticEvents
    .slice(-80)
    .map(item => {
      const { time, type, message, ...rest } = item;
      const extras = Object.entries(rest)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
      return `${new Date(time).toLocaleTimeString()} ${type}${message ? " " + message : ""}${extras ? " | " + extras : ""}`;
    })
    .join("\n");
}

function diagnosticLog(type, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    type,
    message,
    ...extra
  };

  diagnosticEvents.push(entry);
  if (diagnosticEvents.length > 300) diagnosticEvents.shift();

  console.log("[Forknut Diagnostic]", entry);
  renderDiagnosticPanel();

  try {
    const body = JSON.stringify(entry);
    fetch("/__forknut/diag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {}
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    return url.href.length > 300 ? url.href.slice(0, 297) + "..." : url.href;
  } catch {
    return String(value || "").slice(0, 300);
  }
}

async function probeImageUrl(url, frameUrl) {
  if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) return;

  try {
    const started = performance.now();
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "include"
    });

    let bytes = "?";
    try {
      const clone = response.clone();
      const buffer = await clone.arrayBuffer();
      bytes = buffer.byteLength;
    } catch {}

    diagnosticLog("IMG_PROBE", "browser fetch result", {
      url: shortUrl(url),
      status: response.status,
      ok: response.ok,
      type: response.type,
      contentType: response.headers.get("content-type") || "",
      contentLength: response.headers.get("content-length") || "",
      bytes,
      elapsedMs: Math.round(performance.now() - started),
      frame: shortUrl(frameUrl || "")
    });
  } catch (error) {
    diagnosticLog("IMG_PROBE_ERROR", "browser fetch threw", {
      url: shortUrl(url),
      error: String(error?.stack || error),
      frame: shortUrl(frameUrl || "")
    });
  }
}

function watchImage(img, frameUrl) {
  if (!img || img.dataset.forknutDiag === "1") return;
  img.dataset.forknutDiag = "1";
  diagnosticImageCount++;

  const src = () => img.currentSrc || img.src || "";

  img.addEventListener("load", () => {
    diagnosticLog("IMG_OK", "image load event", {
      src: shortUrl(src()),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      frame: shortUrl(frameUrl || "")
    });
  });

  img.addEventListener("error", () => {
    diagnosticFailureCount++;
    diagnosticLog("IMG_FAIL", "image error event", {
      src: shortUrl(src()),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      frame: shortUrl(frameUrl || "")
    });
    probeImageUrl(src(), frameUrl);
  });

  if (img.complete) {
    if (img.naturalWidth > 0) {
      diagnosticLog("IMG_OK", "image already complete", {
        src: shortUrl(src()),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      });
    } else if (src()) {
      diagnosticFailureCount++;
      diagnosticLog("IMG_FAIL", "image complete with zero natural size", {
        src: shortUrl(src()),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      });
      probeImageUrl(src(), frameUrl);
    }
  }
}

function inspectFrameResources(tab, forceProbe = false) {
  const iframe = tab?.iframe;
  if (!iframe) return;

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    if (!doc || !win) {
      diagnosticLog("FRAME_ACCESS_ERROR", "iframe document is not accessible");
      return;
    }

    diagnosticLog("FRAME", "inspecting proxied document", {
      url: shortUrl(tab.url || win.location.href || ""),
      readyState: doc.readyState
    });

    doc.querySelectorAll("img").forEach(img => watchImage(img, tab.url));

    const images = [...doc.querySelectorAll("img")];
    diagnosticLog("IMG_SUMMARY", "images found", {
      count: images.length,
      loaded: images.filter(i => i.naturalWidth > 0).length,
      failed: images.filter(i => i.complete && i.naturalWidth === 0).length
    });

    for (const img of images) {
      const src = img.currentSrc || img.src || "";
      if (forceProbe || (src && !diagnosticSeenResources.has(src))) {
        diagnosticSeenResources.add(src);
        if (src && !/^data:/i.test(src) && !/^blob:/i.test(src)) {
          probeImageUrl(src, tab.url);
        }
      }
    }

    try {
      const resources = win.performance?.getEntriesByType?.("resource") || [];

      for (const resource of resources.slice(-150)) {
        const name = resource.name || "";
        const type = resource.initiatorType || "";
        const isInteresting =
          ["img", "image", "video", "audio", "css", "font"].includes(type) ||
          /\.(png|jpe?g|gif|webp|svg|avif|ico|mp4|webm|woff2?|ttf)(\?|#|$)/i.test(name);

        if (!isInteresting || diagnosticSeenResources.has("perf:" + name)) continue;

        diagnosticSeenResources.add("perf:" + name);

        diagnosticLog("RESOURCE", type || "unknown", {
          url: shortUrl(name),
          durationMs: Math.round(resource.duration || 0),
          transferSize: resource.transferSize ?? "?",
          encodedBodySize: resource.encodedBodySize ?? "?",
          decodedBodySize: resource.decodedBodySize ?? "?",
          responseStatus: resource.responseStatus ?? "unsupported"
        });
      }
    } catch (error) {
      diagnosticLog("RESOURCE_ERROR", "performance inspection failed", {
        error: String(error?.stack || error)
      });
    }
  } catch (error) {
    diagnosticLog("FRAME_ERROR", "could not inspect iframe", {
      error: String(error?.stack || error)
    });
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", event => {
    const data = event.data;
    if (!data || data.source !== "forknut-sw") return;

    diagnosticLog(data.type || "SW_MESSAGE", "", {
      url: shortUrl(data.url || ""),
      destination: data.destination || "",
      status: data.status ?? "",
      ok: data.ok ?? "",
      contentType: data.contentType || "",
      contentLength: data.contentLength || "",
      bytes: data.bytes ?? "",
      elapsedMs: data.elapsedMs ?? "",
      error: data.error || ""
    });
  });
}

window.addEventListener("error", event => {
  diagnosticLog("TOP_ERROR", event.message || "window error", {
    source: shortUrl(event.filename || ""),
    line: event.lineno || "",
    column: event.colno || ""
  });
}, true);

window.addEventListener("unhandledrejection", event => {
  diagnosticLog("TOP_REJECTION", "unhandled promise rejection", {
    error: String(event.reason?.stack || event.reason || "")
  });
});

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

async function getController() {
  if (controller) return controller;

  setStatus("Starting Forknut...");

  const serviceWorker = await registerServiceWorker();

  const wispUrl =
    (location.protocol === "https:" ? "wss" : "ws") +
    "://" +
    location.host +
    "/wisp/";

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

  const transport = new EpoxyClient({
    wisp: wispUrl
  });

  await transport.init();

  controller = new $scramjetController.Controller({
    serviceworker: serviceWorker,
    transport: transport,
    config: {
      prefix: "/~/sj/",
      scramjetPath: "/scramjet/scramjet.js",
      wasmPath: "/scramjet/scramjet.wasm",
      injectPath: "/controller/controller.inject.js"
    }
  });

  await controller.wait();
  return controller;
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
  showTab(tab);
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

  shell.classList.add("hidden");
  browser.classList.add("active");
  homeButton.classList.add("visible");

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
  if (tab.iframe) tab.iframe.remove();
  if (tab.youtubeFrame) tab.youtubeFrame.remove();

  tabs.splice(index, 1);

  if (tabs.length === 0) {
    activeTabId = null;
    browser.classList.remove("active");
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
    diagnosticLog("IFRAME", "iframe load event", { url: shortUrl(tab.url || "") });
    setTimeout(() => inspectFrameResources(tab, false), 250);
    setTimeout(() => inspectFrameResources(tab, false), 1500);
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
    const section = document.getElementById("gamesSection");
    if (section) section.scrollIntoView({ behavior: "smooth" });
  });
}

document.querySelectorAll("[data-game]").forEach(card => {
  card.addEventListener("click", async () => {
    await browse(card.dataset.game);
  });
});

createTab();
diagnosticLog("START", "Forknut diagnostic mode enabled");
setStatus("Ready");
