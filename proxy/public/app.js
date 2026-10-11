const address = document.getElementById("address");
const frame = document.getElementById("site");
const status = document.getElementById("status");

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
    await navigator.serviceWorker.register("/frog/sw.js", {
      scope: __uv$config.prefix,
    });
    await navigator.serviceWorker.ready;
    status.textContent = "Loading " + url.hostname + "…";
    address.value = url.href;
    frame.src = __uv$config.prefix + __uv$config.encodeUrl(url.href);
  } catch (error) {
    status.textContent = error.message || "This address could not be opened.";
  }
}

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
    if (current.pathname.startsWith(__uv$config.prefix)) {
      address.value = __uv$config.decodeUrl(current.pathname.slice(__uv$config.prefix.length));
      status.textContent = "Ready";
    }
  } catch {
    status.textContent = "Page loaded. Some sites may restrict proxy access.";
  }
});
