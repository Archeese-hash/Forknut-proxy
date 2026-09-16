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
setStatus("Ready");
