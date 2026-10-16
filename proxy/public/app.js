const address = document.getElementById("address");
const frame = document.getElementById("site");
const status = document.getElementById("status");
const uvConfig = window["__uv$config"];
if (!uvConfig) {
  status.textContent = "Proxy files did not load. Reload this page and try again.";
  address.disabled = true;
  document.querySelector(".go").disabled = true;
} else {
  document.getElementById("addressForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void navigate(address.value);
  });

  document.getElementById("back").addEventListener("click", () => {
    try { frame.contentWindow.history.back(); } catch { /* No page is loaded yet. */ }
  });

  document.getElementById("forward").addEventListener("click", () => {
    try { frame.contentWindow.history.forward(); } catch { /* No page is loaded yet. */ }
  });

  document.getElementById("reload").addEventListener("click", () => {
    try { frame.contentWindow.location.reload(); } catch { /* No page is loaded yet. */ }
  });

  frame.addEventListener("load", () => {
    try {
      const current = new URL(frame.contentWindow.location.href);
      if (current.pathname.startsWith(uvConfig.prefix)) {
        address.value = uvConfig.decodeUrl(current.pathname.slice(uvConfig.prefix.length));
        status.textContent = "Ready";
      }
    } catch {
      status.textContent = "Page loaded. Some sites may restrict proxy access.";
    }
  });
}

function normalizeAddress(value) {
  const input = value.trim();
  if (!input) return "https://example.com/";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return new URL(input).href;
  if (/^[^\s]+\.[^\s]+$/.test(input)) return new URL("https://" + input).href;
  return "https://www.google.com/search?q=" + encodeURIComponent(input);
}

async function navigate(value) {
  let target;
  try {
    target = normalizeAddress(value);
    const url = new URL(target);
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new Error("Only web addresses can be opened.");
    }
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser does not support the service worker required by the proxy.");
    }

    status.textContent = "Starting secure browser…";
    address.value = url.href;
    const registration = await navigator.serviceWorker.register("/frog/sw.js", {
      scope: uvConfig.prefix,
    });
    await waitForActiveWorker(registration);
    status.textContent = "Loading " + url.hostname + "…";
    frame.src = uvConfig.prefix + uvConfig.encodeUrl(url.href);
  } catch (error) {
    status.textContent = error.message || "This address could not be opened.";
  }
}

function waitForActiveWorker(registration, timeoutMs = 15000) {
  const worker = registration.active || registration.installing || registration.waiting;
  if (!worker) {
    return Promise.reject(new Error("The proxy service worker did not start."));
  }
  if (worker.state === "activated") return Promise.resolve(worker);

  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
    };
    const onStateChange = () => {
      if (worker.state === "activated") {
        cleanup();
        resolve(worker);
      } else if (worker.state === "redundant") {
        cleanup();
        reject(new Error("The proxy service worker failed to activate."));
      }
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The proxy service worker took too long to start. Please reload and try again."));
    }, timeoutMs);
    worker.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

