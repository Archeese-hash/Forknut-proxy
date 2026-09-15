let controller = null;
let frame = null;

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


function normalizeUrl(value) {

  let url =
    value.trim();

  if (!url) {
    throw new Error(
      "Enter a website address."
    );
  }

  if (
    !/^https?:\/\//i.test(url)
  ) {
    url =
      "https://" + url;
  }

  const parsed =
    new URL(url);

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


function setStatus(text) {

  status.textContent =
    text;

}


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
    !navigator.serviceWorker.controller
  ) {

    await new Promise(
      (resolve, reject) => {

        const timeout =
          setTimeout(
            () => {

              reject(
                new Error(
                  "The service worker did not take control. Reload Forknut and try again."
                )
              );

            },
            15000
          );


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

      }
    );

  }


  return (
    navigator.serviceWorker.controller ||
    registration.active
  );

}


async function getController() {

  if (controller) {
    return controller;
  }


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


  /*
   * EPOXY TRANSPORT
   */

  const {
    default: EpoxyClient
  } =
    await import(
      "/epoxy/index.mjs"
    );


  const transport =
    new EpoxyClient({
      wisp: wispUrl
    });


  await transport.init();


  /*
   * SCRAMJET CONTROLLER
   */

  controller =
    new $scramjetController.Controller({

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

    });


  await controller.wait();


  return controller;

}


async function browse(url) {

  try {

    setStatus(
      "Starting proxy..."
    );


    const sj =
      await getController();


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


      /*
       * Do NOT make this iframe credentialless.
       *
       * Scramjet itself needs to manage
       * the proxied site's environment.
       */

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


    frame.go(
      url
    );


  } catch (error) {

    console.error(
      "Forknut proxy error:",
      error
    );


    setStatus(
      error?.message ||
      "Something went wrong."
    );

  }

}


form.addEventListener(
  "submit",
  async (event) => {

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
        error
      );


      setStatus(
        error?.message ||
        "Something went wrong."
      );

    }

  }
);


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


    input.focus();

  }
);


setStatus(
  "Ready"
);
