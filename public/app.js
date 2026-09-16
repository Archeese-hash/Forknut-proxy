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
/* Forknut image/resource diagnostics */
/* -------------------------------- */

const diagnosticEvents = [];
let diagnosticPanel = null;
let diagnosticObserver = null;

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
    "max-height:34vh",
    "overflow:auto",
    "background:rgba(0,0,0,.92)",
    "color:#fff",
    "border:1px solid rgba(255,255,255,.25)",
    "border-radius:10px",
    "padding:10px",
    "font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "display:none",
    "white-space:pre-wrap",
    "word-break:break-all"
  ].join(";");

  document.body.appendChild(diagnosticPanel);
  return diagnosticPanel;
}

function diagnosticLog(type, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    type,
    message,
    ...extra
  };

  diagnosticEvents.push(entry);
  if (diagnosticEvents.length > 100) diagnosticEvents.shift();

  console.log("[Forknut Diagnostic]", entry);

  const panel = ensureDiagnosticPanel();
  panel.style.display = "block";
  panel.textContent = diagnosticEvents
    .slice(-50)
    .map(item => {
      const extraText = Object.entries(item)
        .filter(([key]) => !["time", "type", "message"].includes(key))
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
      return `${item.type} ${item.message}${extraText ? " | " + extraText : ""}`;
    })
    .join("\n");

  try {
    const body = JSON.stringify(entry);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/__forknut/diag",
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch("/__forknut/diag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => {});
    }
  } catch {}
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    return url.href.length > 240 ? url.href.slice(0, 237) + "..." : url.href;
  } catch {
    return String(value || "").slice(0, 240);
  }
}

function watchImage(img, frameUrl) {
  if (!img || img.dataset.forknutDiag === "1") return;
  img.dataset.forknutDiag = "1";

  const report = (type) => {
    diagnosticLog(
      type,
      type === "IMG_OK" ? "image loaded" : "image failed",
      {
        src: shortUrl(img.currentSrc || img.src),
        complete: img.complete,
        width: img.naturalWidth,
        height: img.naturalHeight,
        frame: shortUrl(frameUrl || "")
      }
    );
  };

  img.addEventListener("load", () => report("IMG_OK"), { once: true });
  img.addEventListener("error", () => report("IMG_FAIL"), { once: true });

  if (img.complete) {
    if (img.naturalWidth > 0) report("IMG_OK");
    else report("IMG_FAIL");
  }
}

function inspectFrameResources(tab) {
  const iframe = tab?.iframe;
  if (!iframe) return;

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      diagnosticLog("FRAME", "iframe document is not accessible");
      return;
    }

    diagnosticLog("FRAME", "inspecting proxied document", {
      url: shortUrl(tab.url || win.location.href || "")
    });

    const inspect = () => {
      doc.querySelectorAll("img").forEach(img => watchImage(img, tab.url));

      try {
        const resources = win.performance?.getEntriesByType?.("resource") || [];
        resources.slice(-100).forEach(resource => {
          const name = resource.name || "";
          const type = resource.initiatorType || "";
          if (["img", "image", "video", "audio", "css", "script", "fetch", "xmlhttprequest"].includes(type)) {
            diagnosticLog("RESOURCE", type, {
              url: shortUrl(name),
              duration: Math.round(resource.duration || 0),
              transfer: resource.transferSize ?? "?"
            });
          }
        });
      } catch (error) {
        diagnosticLog("RESOURCE_ERR", "performance resource inspection failed", { error: String(error) });
      }
    };

    inspect();

    if (diagnosticObserver) diagnosticObserver.disconnect();
    diagnosticObserver = new MutationObserver(() => {
      doc.querySelectorAll("img").forEach(img => watchImage(img, tab.url));
    });
    diagnosticObserver.observe(doc.documentElement || doc, {
      childList: true,
      subtree: true
    });

    win.addEventListener("error", event => {
      diagnosticLog("FRAME_ERROR", event.message || "resource error", {
        source: shortUrl(event.filename || ""),
        line: event.lineno || "?",
        column: event.colno || "?"
      });
    }, true);

    win.addEventListener("unhandledrejection", event => {
      diagnosticLog("FRAME_REJECTION", String(event.reason || "unknown rejection"));
    });
  } catch (error) {
    diagnosticLog("FRAME_ERR", "could not inspect iframe", { error: String(error) });
  }
}

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
    setTimeout(() => inspectFrameResources(tab), 250);
    setTimeout(() => inspectFrameResources(tab), 1500);
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
