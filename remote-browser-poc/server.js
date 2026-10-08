import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const accessToken = process.env.POC_ACCESS_TOKEN || "";
const display = process.env.DISPLAY || ":99";
const chromiumBin = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
const startUrl = process.env.BROWSER_START_URL || "https://example.com/";
const ticketLifetimeMs = 60_000;
const tickets = new Map();
const children = [];
let stopping = false;

if (accessToken.length < 32) {
  throw new Error("POC_ACCESS_TOKEN must contain at least 32 characters.");
}

function spawnChild(command, args, label) {
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () => {
    if (!stopping) {
      console.error(label + " failed to start.");
      process.exit(1);
    }
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(label + " exited unexpectedly.");
      process.exit(1);
    }
  });
  children.push(child);
  return child;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectOnce(host, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: targetPort });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function waitForVnc() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await connectOnce("127.0.0.1", 5900);
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error("VNC server did not become ready.");
}

function hasAccess(req) {
  const header = req.get("authorization") || "";
  const candidate = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(accessToken);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createTicket() {
  const now = Date.now();
  for (const [value, expiresAt] of tickets) {
    if (expiresAt <= now) tickets.delete(value);
  }
  const ticket = crypto.randomBytes(32).toString("base64url");
  tickets.set(ticket, now + ticketLifetimeMs);
  return ticket;
}

const app = express();
app.disable("x-powered-by");
app.use((_, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
  );
  next();
});

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "johnny-games-remote-browser-poc" });
});

app.post("/api/session", express.json({ limit: "1kb" }), (req, res) => {
  if (!hasAccess(req)) return res.status(401).json({ error: "Access token is invalid." });
  res.json({ ticket: createTicket(), expiresInSeconds: ticketLifetimeMs / 1000 });
});

app.use("/vendor", express.static(path.join(here, "node_modules", "@novnc", "novnc")));
app.use(express.static(path.join(here, "public"), { index: "index.html" }));

const server = http.createServer(app);
const websocketServer = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols(protocols) {
    return protocols.has("binary") ? "binary" : false;
  }
});

function rejectUpgrade(socket, status, message) {
  socket.write("HTTP/1.1 " + status + " " + message + "\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  let requestUrl;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    return rejectUpgrade(socket, 400, "Bad Request");
  }

  if (requestUrl.pathname !== "/websockify") {
    return rejectUpgrade(socket, 404, "Not Found");
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return rejectUpgrade(socket, 403, "Forbidden");
      }
    } catch {
      return rejectUpgrade(socket, 403, "Forbidden");
    }
  }

  const ticket = requestUrl.searchParams.get("ticket") || "";
  const expiresAt = tickets.get(ticket);
  if (!expiresAt || expiresAt <= Date.now()) {
    tickets.delete(ticket);
    return rejectUpgrade(socket, 401, "Unauthorized");
  }
  tickets.delete(ticket);

  websocketServer.handleUpgrade(req, socket, head, (websocket) => {
    const vnc = net.createConnection({ host: "127.0.0.1", port: 5900 });
    vnc.setNoDelay(true);

    websocket.on("message", (data, isBinary) => {
      if (!isBinary) {
        websocket.close(1003, "Binary VNC data required");
        return;
      }
      if (vnc.writable) vnc.write(data);
    });

    vnc.on("data", (data) => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(data, { binary: true });
      }
    });

    vnc.on("error", () => websocket.close(1011, "Browser stream disconnected"));
    vnc.on("close", () => {
      if (websocket.readyState === WebSocket.OPEN) websocket.close();
    });
    websocket.on("close", () => vnc.destroy());
    websocket.on("error", () => vnc.destroy());
  });
});

async function start() {
  spawnChild("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-noreset", "-ac"], "Xvfb");
  await delay(300);
  spawnChild("x11vnc", ["-display", display, "-localhost", "-rfbport", "5900", "-nopw", "-forever", "-shared", "-noxdamage"], "x11vnc");
  await waitForVnc();
  spawnChild(chromiumBin, [
    "--user-data-dir=/tmp/johnny-games-browser-profile",
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    "--window-size=1280,800",
    "--disable-dev-shm-usage",
    startUrl
  ], "Chromium");

  server.listen(port, "0.0.0.0", () => {
    console.log("Remote browser POC listening on port " + port + ".");
  });
}

function shutdown() {
  stopping = true;
  server.close();
  for (const child of children.reverse()) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The container will stop any remaining child processes.
    }
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start().catch((error) => {
  console.error(error.message);
  shutdown();
  process.exitCode = 1;
});
