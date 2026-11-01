import express from "express";
import { createServer } from "node:http";
import { createBareServer } from "@tomphttp/bare-server-node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "3000", 10);
const publicDirectory = join(directory, "public");
const databaseUrl = process.env.FIREBASE_DATABASE_URL ||
  "https://johnny-chat-aabd6-default-rtdb.europe-west1.firebasedatabase.app/";
const allowedAnalyticsOrigins = new Set([
  "https://www.johnnystudy.online",
  "https://johnnystudy.online"
]);

// Bare blocks private and non-routable IP destinations by default, including
// DNS results, which prevents the proxy from reaching Render's internal network.
const bare = createBareServer("/bare/");
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2kb" }));
app.use((_, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});

let analyticsDb = null;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const firebaseApp = initializeApp({
      credential: cert(serviceAccount),
      databaseURL: databaseUrl,
      // Firebase rules grant this identity access only to analytics leaves.
      databaseAuthVariableOverride: {
        uid: "johnny-analytics-worker"
      }
    }, "johnny-analytics-api");
    analyticsDb = getDatabase(firebaseApp);
  }
} catch {
  // Keep the proxy online if analytics credentials are missing or malformed.
  console.error("Analytics backend unavailable: check its Render environment settings.");
}

function analyticsCors(request, response, next) {
  const origin = request.get("Origin");
  if (!allowedAnalyticsOrigins.has(origin)) return response.sendStatus(403);
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  next();
}

const rateWindows = new Map();
function limitAnalytics(request, response, next) {
  const now = Date.now();
  const key = request.ip || "unknown";
  let window = rateWindows.get(key);
  if (!window || now - window.start >= 60_000) {
    window = { start: now, count: 0 };
    rateWindows.set(key, window);
  }
  window.count += 1;
  if (rateWindows.size > 5000) {
    for (const [ip, item] of rateWindows) {
      if (now - item.start >= 60_000) rateWindows.delete(ip);
    }
  }
  if (window.count > 40) {
    response.setHeader("Retry-After", "60");
    return response.status(429).json({ error: "Too many analytics events. Try again shortly." });
  }
  next();
}

function validGameName(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 100 &&
    !/[.#$\[\]\/\u0000-\u001f\u007f]/.test(value);
}

function validVisitorId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

app.options("/api/analytics", analyticsCors, (_, response) => response.sendStatus(204));
app.post("/api/analytics", analyticsCors, limitAnalytics, async (request, response) => {
  if (!analyticsDb) return response.status(503).json({ error: "Analytics backend is not configured." });
  const body = request.body;
  if (!body || typeof body !== "object" || !validGameName(body.game)) {
    return response.status(400).json({ error: "Invalid analytics event." });
  }

  const game = body.game.trim();
  try {
    if (body.type === "favorite" && validVisitorId(body.visitor) && typeof body.active === "boolean") {
      const favorite = analyticsDb.ref("favoriteAnalytics").child(game).child(body.visitor);
      if (body.active) await favorite.set(true);
      else await favorite.remove();
      return response.sendStatus(204);
    }

    if (body.type === "play") {
      await analyticsDb.ref("playAnalytics").child(game).push().set({ at: Date.now() });
      return response.sendStatus(204);
    }
  } catch {
    return response.status(503).json({ error: "Analytics could not be recorded." });
  }

  return response.status(400).json({ error: "Invalid analytics event." });
});

app.get("/health", (_, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ ok: true, service: "johnny-games-frogies-proxy", analytics: Boolean(analyticsDb) });
});

app.get("/frog/uv.config.js", (_, response) => {
  response.sendFile(join(publicDirectory, "uv.config.js"));
});
app.use("/frog", express.static(uvPath, { fallthrough: false, immutable: true, maxAge: "1h" }));
app.use(express.static(publicDirectory, { index: "index.html", maxAge: "5m" }));

const server = createServer();

server.on("request", (request, response) => {
  if (bare.shouldRoute(request)) {
    void bare.routeRequest(request, response);
  } else {
    app(request, response);
  }
});

server.on("upgrade", (request, socket, head) => {
  if (bare.shouldRoute(request)) {
    void bare.routeUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Johnny Games Frogies proxy listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    bare.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
