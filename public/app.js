let controller = null;
let frame = null;

const form = document.getElementById("proxyForm");
const input = document.getElementById("url");
const shell = document.getElementById("shell");
const browser = document.getElementById("browser");
const status = document.getElementById("status");
const homeButton = document.getElementById("homeButton");


function normalizeUrl(value) {
  let url = value.trim();

  if (!url) {
    throw new Error("Enter a website address.");
  }

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  const parsed = new URL(url);

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(
      "Only HTTP and HTTPS URLs are supported."
    );
  }

  return parsed.href;
}


function setStatus(text) {
  if (status) {
    status.textContent = text;
  }
}


async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
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

  /*
   * If the service worker is already controlling
   * the page, use it immediately.
   */
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  /*
   * Wait for the service worker to take control.
   */
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          "Forknut service worker did not take control. Please reload Forknut and try again."
        )
      );
    }, 15000);

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      {
        once: true
      }
    );
  });

  return (
    navigator.serviceWorker.controller ||
    registration.active
  );
}


async function getController() {
  if (controller) {
    return controller;
  }

  setStatus("Starting proxy...");

  const serviceWorker =
    await registerServiceWorker();

  /*
   * Wisp WebSocket address.
   */
  const wispUrl =
    (
      location.protocol === "https:"
        ? "wss"
        : "ws"
    ) +
    "://" +
    location.host +
    "/wisp/";


  /*
   * IMPORTANT:
   *
   * Forknut now uses LIBCURL instead of Epoxy.
   *
   * This must match:
   *
   * /libcurl/index.mjs
   */
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
      "Could not load Libcurl:",
      error
    );

    throw new Error(
      "Forknut could not load its Libcurl transport. Make sure the latest server.js is deployed on Render."
    );
  }


  if (
    typeof LibcurlClient !== "function"
  ) {
    throw new Error(
      "Forknut loaded Libcurl incorrectly."
    );
  }


  /*
   * Create Libcurl transport.
   */
  const transport =
    new LibcurlClient({
      wisp: wispUrl
    });


  /*
   * Initialise transport.
   */
  await transport.init();


  /*
   * Create Scramjet controller.
   */
  controller =
    new $scramjetController.Controller({
      serviceworker: serviceWorker,

      transport: transport,

      config: {
        prefix: "/~/sj/",

        scramjetPath:
          "/scramjet/scramjet.js",

        wasmPath:
          "/scramjet/scramjet.wasm",

        injectPath:
          "/controller/controller.inject.js"
      }
    });


  /*
   * Wait for Scramjet.
   */
  await controller.wait();

  return controller;
}


async function browse(url) {
  try {
    setStatus(
      "Starting Forknut..."
    );

    const sj =
      await getController();


    /*
     * Create the proxy iframe once.
     */
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


      /*
       * Create Scramjet frame.
       */
      frame =
        sj.createFrame(
          iframe,
          {
            plugins: [

              /*
               * Cache resources such as
               * images and scripts.
               */
              new $scramjetUtils.HttpCachePlugin(),


              /*
               * Keep the address/status updated.
               */
              new $scramjetUtils.UrlWatcherPlugin(
                (currentUrl) => {
                  setStatus(
                    currentUrl
                  );
                }
              ),


              /*
               * Catch links that escape
               * the proxy.
               */
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


    /*
     * Show browser.
     */
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


    /*
     * Navigate through Scramjet.
     */
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
 * Search / URL form.
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


/*
 * Initial status.
 */
setStatus("Ready");
