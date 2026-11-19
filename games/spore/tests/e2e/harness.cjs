// Browser test harness: serves the repo through Playwright request routing (no server process) and maps the
// `three` CDN import to a local copy (npm i three@0.160.0 playwright). Usage: const { open } = require("./harness.cjs").
// Environment: SPORE_ROOT (repo root), THREE_PATH (three.module.js).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = process.env.SPORE_ROOT || path.resolve(__dirname, "../../../..");
/** Find the local copy of three.module.js: THREE_PATH, or node_modules/three in this folder or any above it. */
function findThree() {
  if (process.env.THREE_PATH) return process.env.THREE_PATH;
  for (let dir of [process.cwd(), ROOT, __dirname]) {
    for (;;) {
      const f = path.join(dir, "node_modules/three/build/three.module.js");
      if (fs.existsSync(f)) return f;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("three.module.js not found: npm i three@0.160.0 or set THREE_PATH");
}
const THREE = findThree();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

async function open({ width = 1280, height = 800, touch = false, dpr = 1, ua } = {}) {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch, userAgent: ua });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("three@0.160.0")) return route.fulfill({ body: fs.readFileSync(THREE), contentType: "text/javascript", headers: { "access-control-allow-origin": "*" } });
    if (url.hostname === "spore.test") {
      const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || "application/octet-stream" });
      return route.fulfill({ status: 404, body: "not found" });
    }
    return route.abort();
  });
  return { browser, ctx, page, errors };
}
module.exports = { open };
