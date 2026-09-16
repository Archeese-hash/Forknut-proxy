let controller = null;
let frame = null;
let youtubeFrame = null;

const form =
  document.getElementById("proxyForm");

const input =
  document.getElementById("url");

const shell =
  document.getElementById("shell");

const browser =
  document.getElementById("browser");

const status =
  document.getElementById("status");

const homeButton =
  document.getElementById("homeButton");


function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}


function normalizeUrl(value) {
  let url = value.trim();

  if (!url) {
    throw new Error(
      "Enter a website address."
    );
  }

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  const parsed = new URL(url);

  if (
    !/^https?:$/.test(
      parsed.protocol
    )
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs are supported."
    );
  }

  return parsed.href;
}


/*
 * Try to extract a YouTube video ID
 * from all of the common YouTube URL formats.
 */
function getYouTubeVideoId(value) {
  try {
    const url =
      new URL(value);

    const hostname =
      url.hostname
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/^m\./, "");

    /*
     * youtube.com/watch?v=VIDEO_ID
     */
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

      /*
       * youtube.com/shorts/VIDEO_ID
       */
      const shortsMatch =
        url.pathname.match(
          /^\/shorts\/([A-Za-z0-9_-]{6,20})/
        );

      if (shortsMatch) {
        return shortsMatch[1];
      }

      /*
       * youtube.com/embed/VIDEO_ID
       */
      const embedMatch =
        url.pathname.match(
          /^\/embed\/([A-Za-z0-9_-]{6,20})/
        );

      if (embedMatch) {
        return embedMatch[1];
      }
    }

    /*
     * youtu.be/VIDEO_ID
     */
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
      "YouTube URL parsing error:",
      error
    );
  }

  return null;
}


/*
 * Remove the standalone YouTube player.
 */
function removeYouTubePlayer() {
  if (youtubeFrame) {
    youtubeFrame.remove();
    youtubeFrame = null;
  }
}


/*
 * Show an official YouTube embedded player.
 */
function showYouTubePlayer(videoId) {
  removeYouTubePlayer();

  if (!browser) {
    return;
  }

  const iframe =
    document.createElement("iframe");

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

  iframe.setAttribute(
    "loading",
    "eager"
  );

  /*
   * Official YouTube embed URL.
   *
   * playsinline=1 keeps playback inline on iPad/iPhone.
   * rel=0 limits related videos to the same channel.
   */
  iframe.src =
    "https://www.youtube.com/embed/" +
    encodeURIComponent(videoId) +
    "?playsinline=1&rel=0&controls=1";

  /*
   * Make the player fill the proxy area.
   */
  iframe.style.position =
    "absolute";

  iframe.style.inset =
    "0";

  iframe.style.width =
    "100%";

  iframe.style.height =
    "100%";

  iframe.style.border =
    "0";

  iframe.style.background =
    "#000";

  iframe.style.display =
    "block";

  browser.appendChild(
    iframe
  );

  youtubeFrame =
    iframe;

  shell.classList.add(
    "hidden"
  );

  browser.classList.add(
    "active"
  );

  homeButton.classList.add(
    "visible"
  );

  setStatus(
    "YouTube video"
  );
}


/*
 * Check whether a URL is a YouTube page.
 */
function handlePossibleYouTube(url) {
  const videoId =
    getYouTubeVideoId(url);

  if (!videoId) {
    return false;
  }

  console.log(
    "[Forknut] YouTube video detected:",
    videoId
  );

  showYouTubePlayer(
    videoId
  );

  return true;
}


/*
 * Register Forknut's service worker.
 */
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


/*
 * Start Scramjet.
 */
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


/*
 * Browse a normal website through Scramjet.
 */
async function browse(url) {
  try {
    /*
     * If the user directly enters a YouTube URL,
     * use the embedded player instead of Scramjet.
     */
    if (
      handlePossibleYouTube(url)
    ) {
      return;
    }

    setStatus(
      "Starting proxy..."
    );

    const sj =
      await getController();

    /*
     * Remove a previous YouTube player
     * before loading another normal site.
     */
    removeYouTubePlayer();

    if (!frame) {
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

      frame =
        sj.createFrame(
          iframe,
          {
            plugins: [

              new $scramjetUtils.HttpCachePlugin(),

              new $scramjetUtils.UrlWatcherPlugin(
                (currentUrl) => {

                  console.log(
                    "[Forknut] Current URL:",
                    currentUrl
                  );

                  /*
                   * If Pointercrate or another
                   * website navigates to YouTube,
                   * switch to the official embed.
                   */
                  if (
                    handlePossibleYouTube(
                      currentUrl
                    )
                  ) {
                    return;
                  }

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

    setStatus(
      "Loading " + url
    );

    frame.go(url);

  } catch (error) {

    console.error(
      "Forknut proxy error:",
      error
    );

    setStatus(
      error?.message ||
      "Forknut could not load this website."
    );
  }
}


/*
 * URL search form.
 */
if (form) {
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      try {
        const url =
          normalizeUrl(
            input.value
          );

        await browse(url);

      } catch (error) {

        console.error(
          "Forknut URL error:",
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


/*
 * Home button.
 */
if (homeButton) {
  homeButton.addEventListener(
    "click",
    () => {

      removeYouTubePlayer();

      if (browser) {
        browser.classList.remove(
          "active"
        );
      }

      if (shell) {
        shell.classList.remove(
          "hidden"
        );
      }

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


/*
 * Initial state.
 */
setStatus(
  "Ready"
);
