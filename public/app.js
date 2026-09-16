let controller = null;

let tabs = [];

let activeTabId = null;

let nextTabId = 1;


const form =
  document.getElementById(
    "proxyForm"
  );

const input =
  document.getElementById(
    "url"
  );

const shell =
  document.getElementById(
    "shell"
  );

const browser =
  document.getElementById(
    "browser"
  );

const status =
  document.getElementById(
    "status"
  );

const homeButton =
  document.getElementById(
    "homeButton"
  );

const tabsElement =
  document.getElementById(
    "tabs"
  );

const newTabButton =
  document.getElementById(
    "newTabButton"
  );

const pointercrateButton =
  document.getElementById(
    "pointercrateButton"
  );

const gamesButton =
  document.getElementById(
    "gamesButton"
  );


function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}


/* -------------------------------- */
/* URL handling */
/* -------------------------------- */

function normalizeUrl(value) {
  const text =
    value.trim();

  if (!text) {
    throw new Error(
      "Enter a website or search term."
    );
  }

  if (
    /^https?:\/\//i.test(text)
  ) {
    return new URL(text).href;
  }

  /*
   * Looks like a domain.
   */
  if (
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(
      text
    )
  ) {
    return (
      "https://" +
      text
    );
  }

  /*
   * Otherwise search Google.
   */
  return (
    "https://www.google.com/search?q=" +
    encodeURIComponent(text)
  );
}


/* -------------------------------- */
/* YouTube detection */
/* -------------------------------- */

function getYouTubeVideoId(value) {
  try {
    const url =
      new URL(value);

    const hostname =
      url.hostname
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/^m\./, "");

    if (
      hostname === "youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {

      const videoId =
        url.searchParams.get("v");

      if (
        videoId &&
        /^[A-Za-z0-9_-]{6,20}$/.test(
          videoId
        )
      ) {
        return videoId;
      }

      const shorts =
        url.pathname.match(
          /^\/shorts\/([A-Za-z0-9_-]{6,20})/
        );

      if (shorts) {
        return shorts[1];
      }

      const embed =
        url.pathname.match(
          /^\/embed\/([A-Za-z0-9_-]{6,20})/
        );

      if (embed) {
        return embed[1];
      }
    }

    if (
      hostname === "youtu.be"
    ) {

      const id =
        url.pathname
          .split("/")
          .filter(Boolean)[0];

      if (
        id &&
        /^[A-Za-z0-9_-]{6,20}$/.test(
          id
        )
      ) {
        return id;
      }
    }

  } catch (error) {
    console.error(
      "YouTube detection error:",
      error
    );
  }

  return null;
}


/* -------------------------------- */
/* Service worker */
/* -------------------------------- */

async function registerServiceWorker() {

  if (
    !("serviceWorker" in navigator)
  ) {
    throw new Error(
      "This browser does not support service workers."
    );
  }

  const registration =
    await navigator.serviceWorker.register(
      "/sw.js",
      {
        scope: "/",
        updateViaCache: "none"
      }
    );

  if (
    navigator.serviceWorker.controller
  ) {
    return navigator.serviceWorker.controller;
  }

  await new Promise(
    (resolve, reject) => {

      const timeout =
        setTimeout(
          () => {
            reject(
              new Error(
                "Forknut's service worker did not take control. Reload Forknut and try again."
              )
            );
          },
          15000
        );

      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {

          clearTimeout(
            timeout
          );

          resolve();

        },
        {
          once: true
        }
      );

    }
  );

  return (
    navigator.serviceWorker.controller ||
    registration.active
  );
}


/* -------------------------------- */
/* Scramjet controller */
/* -------------------------------- */

async function getController() {

  if (controller) {
    return controller;
  }

  setStatus(
    "Starting Forknut..."
  );

  const serviceWorker =
    await registerServiceWorker();

  const wispUrl =
    (
      location.protocol === "https:"
        ? "wss"
        : "ws"
    ) +
    "://" +
    location.host +
    "/wisp/";

  let LibcurlClient;

  try {

    const libcurl =
      await import(
        "/libcurl/index.mjs"
      );

    LibcurlClient =
      libcurl.default;

  } catch (error) {

    console.error(
      "Libcurl loading error:",
      error
    );

    throw new Error(
      "Forknut could not load its Libcurl transport."
    );
  }

  if (
    typeof LibcurlClient !==
    "function"
  ) {
    throw new Error(
      "Forknut loaded an invalid Libcurl transport."
    );
  }

  const transport =
    new LibcurlClient({
      wisp: wispUrl
    });

  await transport.init();

  controller =
    new $scramjetController.Controller(
      {
        serviceworker:
          serviceWorker,

        transport:
          transport,

        config: {
          prefix:
            "/~/sj/",

          scramjetPath:
            "/scramjet/scramjet.js",

          wasmPath:
            "/scramjet/scramjet.wasm",

          injectPath:
            "/controller/controller.inject.js"
        }
      }
    );

  await controller.wait();

  return controller;
}


/* -------------------------------- */
/* Create a new tab */
/* -------------------------------- */

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

  activeTabId =
    tab.id;

  renderTabs();

  showTab(tab);

  setStatus(
    "Ready"
  );

  if (input) {
    input.value = "";
    input.focus();
  }

  return tab;
}


/* -------------------------------- */
/* Find active tab */
/* -------------------------------- */

function getActiveTab() {

  return tabs.find(
    tab =>
      tab.id ===
      activeTabId
  );
}


/* -------------------------------- */
/* Render tabs */
/* -------------------------------- */

function renderTabs() {

  if (!tabsElement) {
    return;
  }

  tabsElement.innerHTML = "";

  for (
    const tab of tabs
  ) {

    const element =
      document.createElement(
        "div"
      );

    element.className =
      "tab";

    if (
      tab.id ===
      activeTabId
    ) {
      element.classList.add(
        "active"
      );
    }

    const title =
      document.createElement(
        "div"
      );

    title.className =
      "tab-title";

    title.textContent =
      tab.title ||
      "New Tab";

    const close =
      document.createElement(
        "button"
      );

    close.className =
      "tab-close";

    close.type =
      "button";

    close.textContent =
      "×";

    close.title =
      "Close tab";

    close.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        closeTab(
          tab.id
        );
      }
    );

    element.appendChild(
      title
    );

    element.appendChild(
      close
    );

    element.addEventListener(
      "click",
      () => {
        switchTab(
          tab.id
        );
      }
    );

    tabsElement.appendChild(
      element
    );
  }
}


/* -------------------------------- */
/* Switch tab */
/* -------------------------------- */

function switchTab(id) {

  const tab =
    tabs.find(
      item =>
        item.id === id
    );

  if (!tab) {
    return;
  }

  activeTabId =
    id;

  renderTabs();

  showTab(tab);

  setStatus(
    tab.url ||
    "Ready"
  );
}


/* -------------------------------- */
/* Show tab */
/* -------------------------------- */

function showTab(tab) {

  if (!browser) {
    return;
  }

  shell.classList.add(
    "hidden"
  );

  browser.classList.add(
    "active"
  );

  homeButton.classList.add(
    "visible"
  );

  /*
   * Hide every iframe.
   */

  for (
    const other of tabs
  ) {

    if (
      other.iframe
    ) {
      other.iframe.style.display =
        "none";
    }

    if (
      other.youtubeFrame
    ) {
      other.youtubeFrame.style.display =
        "none";
    }
  }

  /*
   * Show normal proxy iframe.
   */

  if (
    tab.iframe
  ) {
    tab.iframe.style.display =
      "block";
  }

  /*
   * Show YouTube iframe.
   */

  if (
    tab.youtubeFrame
  ) {
    tab.youtubeFrame.style.display =
      "block";
  }
}


/* -------------------------------- */
/* Close tab */
/* -------------------------------- */

function closeTab(id) {

  const index =
    tabs.findIndex(
      tab =>
        tab.id === id
    );

  if (
    index === -1
  ) {
    return;
  }

  const tab =
    tabs[index];

  if (
    tab.iframe
  ) {
    tab.iframe.remove();
  }

  if (
    tab.youtubeFrame
  ) {
    tab.youtubeFrame.remove();
  }

  tabs.splice(
    index,
    1
  );

  /*
   * If there are no tabs left,
   * automatically create a new one.
   */

  if (
    tabs.length === 0
  ) {

    activeTabId =
      null;

    browser.classList.remove(
      "active"
    );

    shell.classList.remove(
      "hidden"
    );

    homeButton.classList.remove(
      "visible"
    );

    createTab();

    return;
  }

  /*
   * If the closed tab was active,
   * switch to another tab.
   */

  if (
    activeTabId === id
  ) {

    const newIndex =
      Math.min(
        index,
        tabs.length - 1
      );

    activeTabId =
      tabs[newIndex].id;
  }

  renderTabs();

  const active =
    getActiveTab();

  showTab(
    active
  );

  setStatus(
    active?.url ||
    "Ready"
  );
}


/* -------------------------------- */
/* Create YouTube player */
/* -------------------------------- */

function showYouTubePlayer(
  tab,
  videoId
) {

  if (
    tab.youtubeFrame
  ) {
    tab.youtubeFrame.remove();
  }

  const iframe =
    document.createElement(
      "iframe"
    );

  iframe.className =
    "youtube-frame";

  iframe.title =
    "YouTube video";

  iframe.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

  iframe.allowFullscreen =
    true;

  iframe.setAttribute(
    "referrerpolicy",
    "strict-origin-when-cross-origin"
  );

  iframe.src =
    "https://www.youtube.com/embed/" +
    encodeURIComponent(videoId) +
    "?playsinline=1&rel=0&controls=1";

  browser.appendChild(
    iframe
  );

  tab.youtubeFrame =
    iframe;

  tab.title =
    "YouTube";

  renderTabs();

  showTab(
    tab
  );

  setStatus(
    "YouTube video"
  );
}


/* -------------------------------- */
/* Create Scramjet iframe */
/* -------------------------------- */

async function createProxyFrame(
  tab
) {

  const sj =
    await getController();

  const iframe =
    document.createElement(
      "iframe"
    );

  iframe.className =
    "proxy-frame";

  iframe.setAttribute(
    "allow",
    "fullscreen; autoplay; gamepad; picture-in-picture; encrypted-media"
  );

  iframe.setAttribute(
    "allowfullscreen",
    ""
  );

  iframe.setAttribute(
    "referrerpolicy",
    "no-referrer"
  );

  iframe.setAttribute(
    "loading",
    "eager"
  );

  iframe.setAttribute(
    "title",
    "Forknut Proxy"
  );

  browser.appendChild(
    iframe
  );

  tab.iframe =
    iframe;

  tab.frame =
    sj.createFrame(
      iframe,
      {
        plugins: [

          new $scramjetUtils.HttpCachePlugin(),

          new $scramjetUtils.UrlWatcherPlugin(
            currentUrl => {

              /*
               * Ignore updates for tabs that
               * are no longer active.
               */

              if (
                tab.id !==
                activeTabId
              ) {
                return;
              }

              console.log(
                "[Forknut] URL:",
                currentUrl
              );

              /*
               * Detect YouTube links.
               */

              const videoId =
                getYouTubeVideoId(
                  currentUrl
                );

              if (
                videoId
              ) {

                showYouTubePlayer(
                  tab,
                  videoId
                );

                return;
              }

              tab.url =
                currentUrl;

              /*
               * Use hostname as the tab name.
               */

              try {

                const url =
                  new URL(
                    currentUrl
                  );

                tab.title =
                  url.hostname
                    .replace(
                      /^www\./,
                      ""
                    );

              } catch {
                tab.title =
                  "Forknut";
              }

              renderTabs();

              setStatus(
                currentUrl
              );
            }
          ),

          new $scramjetUtils.CatchEscapedLinksPlugin(
            () =>
              new URL(
                location.href
              )
          )

        ]
      }
    );

  return tab;
}


/* -------------------------------- */
/* Browse */
/* -------------------------------- */

async function browse(
  url
) {

  const tab =
    getActiveTab();

  if (!tab) {
    return;
  }

  try {

    setStatus(
      "Loading..."
    );

    /*
     * YouTube directly entered
     * into the address/search bar.
     */

    const videoId =
      getYouTubeVideoId(
        url
      );

    if (
      videoId
    ) {

      tab.url =
        url;

      showYouTubePlayer(
        tab,
        videoId
      );

      return;
    }

    /*
     * Remove old YouTube player
     * if this tab had one.
     */

    if (
      tab.youtubeFrame
    ) {

      tab.youtubeFrame.remove();

      tab.youtubeFrame =
        null;
    }

    /*
     * Create the Scramjet frame
     * only once for this tab.
     */

    if (
      !tab.frame
    ) {
      await createProxyFrame(
        tab
      );
    }

    tab.url =
      url;

    tab.title =
      (() => {

        try {

          return new URL(
            url
          ).hostname.replace(
            /^www\./,
            ""
          );

        } catch {

          return "Loading...";

        }

      })();

    renderTabs();

    showTab(
      tab
    );

    setStatus(
      "Loading " +
      url
    );

    tab.frame.go(
      url
    );

  } catch (error) {

    console.error(
      "[Forknut] Proxy error:",
      error
    );

    setStatus(
      error?.message ||
      "Forknut could not load this website."
    );
  }
}


/* -------------------------------- */
/* New tab button */
/* -------------------------------- */

if (
  newTabButton
) {

  newTabButton.addEventListener(
    "click",
    () => {

      createTab();

    }
  );
}


/* -------------------------------- */
/* Search/address bar */
/* -------------------------------- */

if (
  form
) {

  form.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      try {

        const url =
          normalizeUrl(
            input.value
          );

        await browse(
          url
        );

      } catch (error) {

        console.error(
          "[Forknut] URL error:",
          error
        );

        setStatus(
          error?.message ||
          "Something went wrong."
        );
      }

    }
  );
}


/* -------------------------------- */
/* Home button */
/* -------------------------------- */

if (
  homeButton
) {

  homeButton.addEventListener(
    "click",
    () => {

      const tab =
        getActiveTab();

      if (
        tab?.iframe
      ) {
        tab.iframe.style.display =
          "none";
      }

      if (
        tab?.youtubeFrame
      ) {
        tab.youtubeFrame.style.display =
          "none";
      }

      browser.classList.remove(
        "active"
      );

      shell.classList.remove(
        "hidden"
      );

      homeButton.classList.remove(
        "visible"
      );

      setStatus(
        "Ready"
      );

      if (input) {
        input.focus();
      }

    }
  );
}


/* -------------------------------- */
/* Pointercrate button */
/* -------------------------------- */

if (
  pointercrateButton
) {

  pointercrateButton.addEventListener(
    "click",
    async () => {

      const tab =
        getActiveTab();

      if (!tab) {
        return;
      }

      const url =
        "https://pointercrate.com/demonlist/";

      await browse(
        url
      );
    }
  );
}


/* -------------------------------- */
/* Games button */
/* -------------------------------- */

if (
  gamesButton
) {

  gamesButton.addEventListener(
    "click",
    () => {

      const section =
        document.getElementById(
          "gamesSection"
        );

      if (
        section
      ) {

        section.scrollIntoView({
          behavior: "smooth"
        });

      }
    }
  );
}


/* -------------------------------- */
/* Game cards */
/* -------------------------------- */

document
  .querySelectorAll(
    "[data-game]"
  )
  .forEach(
    card => {

      card.addEventListener(
        "click",
        async () => {

          const url =
            card.dataset.game;

          await browse(
            url
          );

        }
      );

    }
  );


/* -------------------------------- */
/* Start Forknut */
/* -------------------------------- */

/*
 * Start with one empty tab.
 */

createTab();

setStatus(
  "Ready"
);
