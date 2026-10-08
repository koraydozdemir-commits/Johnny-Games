import RFB from "/vendor/core/rfb.js";

const state = document.getElementById("state");
const accessToken = document.getElementById("accessToken");
const gate = document.getElementById("gate");
const screen = document.getElementById("screen");
const connectButton = document.getElementById("connect");
const startButton = document.getElementById("start");
let rfb = null;

function setState(message) {
  state.textContent = message;
}

async function connect() {
  const token = accessToken.value.trim();
  if (!token) {
    setState("Enter the local access token.");
    accessToken.focus();
    return;
  }

  startButton.disabled = true;
  connectButton.disabled = true;
  setState("Requesting a short-lived stream ticket…");

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create a browser session.");

    if (rfb) {
      rfb.disconnect();
      rfb = null;
    }

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = wsProtocol + "//" + location.host + "/websockify?ticket=" + encodeURIComponent(result.ticket);
    rfb = new RFB(screen, wsUrl);
    rfb.scaleViewport = true;
    rfb.focusOnClick = true;
    rfb.showDotCursor = true;
    rfb.addEventListener("connect", () => {
      gate.hidden = true;
      setState("Connected — use Chromium’s address bar and browser controls.");
      connectButton.disabled = false;
    });
    rfb.addEventListener("disconnect", (event) => {
      gate.hidden = false;
      setState(event.detail.clean ? "Disconnected." : "Stream ended. Reconnect to continue.");
      startButton.disabled = false;
      connectButton.disabled = false;
    });
    rfb.addEventListener("credentialsrequired", () => {
      setState("The VNC stream requested unexpected credentials.");
      rfb.disconnect();
    });
    setState("Connecting to Chromium…");
  } catch (error) {
    setState(error.message || "Could not connect.");
    startButton.disabled = false;
    connectButton.disabled = false;
  }
}

startButton.addEventListener("click", connect);
connectButton.addEventListener("click", connect);
accessToken.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

fetch("/health", { cache: "no-store" })
  .then((response) => response.json())
  .then((result) => setState(result.ok ? "Chromium service is ready." : "Browser service unavailable."))
  .catch(() => setState("Waiting for Chromium service…"));
