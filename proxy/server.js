import express from "express";
import { createServer } from "node:http";
import { createBareServer } from "@tomphttp/bare-server-node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "3000", 10);
const publicDirectory = join(directory, "public");
const databaseUrl = process.env.FIREBASE_DATABASE_URL ||
  "https://johnny-chat-aabd6-default-rtdb.europe-west1.firebasedatabase.app/";
const adminPasswordHash = process.env.ADMIN_PASSWORD_SHA256 || "";
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
app.use(express.json({ limit: "8mb" }));
app.use((_, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});

let analyticsDb = null;
let adminDb = null;
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
    // Separate privileged connection for chat and ad records; analytics keeps its restricted auth override.
    const adminApp = initializeApp({
      credential: cert(serviceAccount),
      databaseURL: databaseUrl
    }, "johnny-admin-api");
    adminDb = getDatabase(adminApp);
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
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  next();
}


function apiCors(request, response, next) {
  const origin = request.get("Origin");
  if (!allowedAnalyticsOrigins.has(origin)) return response.sendStatus(403);
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Cache-Control", "no-store");
  next();
}
function passwordMatches(password) {
  if (!adminPasswordHash || typeof password !== "string" || password.length < 8 || password.length > 256) return false;
  const actual = createHash("sha256").update(password, "utf8").digest();
  let expected;
  try { expected = Buffer.from(adminPasswordHash, "hex"); } catch { return false; }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function requireAdmin(request, response, next) {
  const header = request.get("Authorization") || "";
  const password = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!passwordMatches(password)) return response.sendStatus(401);
  next();
}
app.options("/api/admin/verify", apiCors, (_, response) => response.sendStatus(204));
app.post("/api/admin/verify", apiCors, (request, response) => {
  if (!adminPasswordHash) return response.status(503).json({ error: "Admin authentication is not configured on the proxy." });
  if (!passwordMatches(request.body && request.body.password)) return response.sendStatus(401);
  response.sendStatus(204);
});
const chatRateWindows = new Map();
function limitChat(request, response, next) {
  const now = Date.now();
  const key = request.ip || "unknown";
  let window = chatRateWindows.get(key);
  if (!window || now - window.start >= 60_000) {
    window = { start: now, count: 0 };
    chatRateWindows.set(key, window);
  }
  window.count += 1;
  if (window.count > 20) return response.status(429).json({ error: "Chat rate limit reached. Try again shortly." });
  next();
}
app.options("/api/chat", apiCors, (_, response) => response.sendStatus(204));
app.get("/api/chat", apiCors, async (_, response) => {
  if (!adminDb) return response.status(503).json({ error: "Firebase service account is not configured." });
  try {
    const snapshot = await adminDb.ref("chat").orderByKey().limitToLast(100).get();
    response.json(snapshot.exists() ? snapshot.val() : {});
  } catch {
    response.status(503).json({ error: "Chat messages could not be loaded." });
  }
});
app.post("/api/chat", apiCors, limitChat, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: "Firebase service account is not configured." });
  const body = request.body || {};
  const name = typeof body.n === "string" ? body.n.trim().slice(0, 12) : "";
  const message = typeof body.m === "string" ? body.m.trim().slice(0, 200) : "";
  if (!name || !/[a-z0-9]/i.test(name) || !message) return response.status(400).json({ error: "Invalid chat message." });
  try {
    await adminDb.ref("chat").push().set({ n: name, m: message, t: Date.now() });
    response.sendStatus(204);
  } catch {
    response.status(503).json({ error: "Chat message could not be sent." });
  }
});
app.options("/api/chat/:key", apiCors, (_, response) => response.sendStatus(204));
app.delete("/api/chat/:key", apiCors, requireAdmin, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: "Firebase service account is not configured." });
  const key = request.params.key;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return response.sendStatus(400);
  try {
    await adminDb.ref("chat").child(key).remove();
    response.sendStatus(204);
  } catch {
    response.status(503).json({ error: "The chat message could not be deleted." });
  }
});
app.options("/api/ads", apiCors, (_, response) => response.sendStatus(204));
app.get("/api/ads", apiCors, async (_, response) => {
  if (!adminDb) return response.status(503).json({ error: "Firebase service account is not configured." });
  try {
    const snapshot = await adminDb.ref("ads").get();
    response.json(snapshot.exists() ? snapshot.val() : {});
  } catch {
    response.status(503).json({ error: "Advertisement settings could not be loaded." });
  }
});
app.put("/api/ads", apiCors, requireAdmin, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: "Firebase service account is not configured." });
  const data = request.body;
  if (!data || typeof data !== "object" || Array.isArray(data)) return response.sendStatus(400);
  try {
    await adminDb.ref("ads").set(data);
    response.sendStatus(204);
  } catch {
    response.status(503).json({ error: "Advertisement settings could not be saved." });
  }
});

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
app.get("/api/analytics", analyticsCors, async (_, response) => {
  if (!analyticsDb) return response.status(503).json({ error: "Analytics backend is not configured." });
  try {
    const [favoritesSnapshot, playsSnapshot] = await Promise.all([
      analyticsDb.ref("favoriteAnalytics").get(),
      analyticsDb.ref("playAnalytics").get()
    ]);
    response.json({
      favorites: favoritesSnapshot.exists() ? favoritesSnapshot.val() : {},
      plays: playsSnapshot.exists() ? playsSnapshot.val() : {}
    });
  } catch {
    response.status(503).json({ error: "Analytics could not be loaded." });
  }
});
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
  response.json({ ok: true, service: "johnny-games-frogies-proxy", analytics: Boolean(analyticsDb), adminApi: Boolean(adminDb) });
});

app.get("/frog/uv.config.js", (_, response) => {
  response.sendFile(join(publicDirectory, "uv.config.js"));
});
app.use("/frog", express.static(uvPath, { fallthrough: false, immutable: true, maxAge: "1h" }));
app.use(express.static(publicDirectory, { index: "index.html", maxAge: "5m" }));

// Expire chat messages on the server so cleanup does not depend on an open chat tab.
const CHAT_RETENTION_MS = 6 * 60 * 60 * 1000;
async function cleanupExpiredChat() {
  if (!adminDb) return;
  try {
    const chatRef = adminDb.ref("chat");
    const snapshot = await chatRef.get();
    if (!snapshot.exists()) return;
    const now = Date.now();
    const expired = {};
    snapshot.forEach((child) => {
      const message = child.val();
      const timestamp = Number(message && message.t) || 0;
      if (timestamp > 0 && now - timestamp > CHAT_RETENTION_MS) {
        expired[child.key] = null;
      }
    });
    if (Object.keys(expired).length) await chatRef.update(expired);
  } catch (error) {
    console.error("Chat expiry sweep failed:", error && error.message ? error.message : "unknown error");
  }
}
const chatCleanupTimer = setInterval(cleanupExpiredChat, 5 * 60 * 1000);
chatCleanupTimer.unref();
void cleanupExpiredChat();

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
