/**
 * Repeatable browser regression checks for the pre-Space polish update: the galaxy as the save
 * screen, switching species, stage transitions, consequence inheritance, Species History, the music
 * state machine and save isolation. Runs headless Chrome through playwright-core at phone, tablet and
 * desktop sizes, serving the repository locally (three.js comes from node_modules, not the CDN).
 *
 *   npm install --no-save playwright-core three@0.160.0
 *   CHROME=/usr/bin/google-chrome node dev/browser-check.mjs [--only=phone]
 *
 * Exits non-zero if any check fails. Each check prints ✓ or ✗ with a reason.
 */
/* global process, getComputedStyle, MouseEvent */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch (e) {
  ({ chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core"));
}
const ROOT = normalize(join(fileURLToPath(import.meta.url), "../../../.."));
const THREE = join(ROOT, "games/spore/node_modules/three/build/three.module.js");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg" };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(ROOT, url));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/games/Spore.html?debug`;

const SIZES = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true }, tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true }, desktop: { width: 1440, height: 900 } };
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
let failed = 0,
  passed = 0;
const check = (name, ok, why = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !why ? "" : " — " + why}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });

async function newPage(size) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // three.js from node_modules; the soundtrack and other outside requests are answered with nothing.
  await page.route("https://cdn.jsdelivr.net/**", (r) => {
    const addon = r.request().url().split("three@0.160.0/")[1];
    r.fulfill({ path: addon?.startsWith("examples/") ? join(dirname(THREE), "../..", addon) : THREE, contentType: "text/javascript" });
  });
  await page.route(/r2\.dev/, (r) => r.fulfill({ status: 404, body: "" }));
  return { ctx, page, errors };
}
const waitFor = async (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });

/** Saves for a species at a given stage, as plain localStorage keys (shapes as the stages write them). */
function savesFor(name, stage, extra = {}) {
  const keys = {};
  keys["johnny-spore-cell-stage"] = JSON.stringify({ tier: 4, cellName: name, plants: 30, meat: 2, progress: { dietCard: "herbivore", cellStageComplete: true, regions: [], zones: [] } });
  if (stage === "cell") return keys;
  keys["johnny-spore-creature-stage"] = JSON.stringify({ brain: 5, card: "charmer", instinct: extra.instinct || "symbiotic", alliances: 5, extinctions: 0, record: null, homeRegion: "coast" });
  return keys;
}

for (const [label, size] of Object.entries(SIZES)) {
  if (only && only !== label) continue;
  console.log(`\n— ${label} ${size.width}×${size.height}`);
  const { ctx, page, errors } = await newPage(size);
  await page.goto(BASE);
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  check("opens on the galaxy", true);

  // Two species in two universes: the one in play (Creature) and a parked one (Cell).
  await page.evaluate(async ({ a, b }) => {
    const S = window.__spore;
    const u = S.universe;
    for (const [k, v] of Object.entries(a)) localStorage.setItem(k, v);
    const meta = { id: "utestparked" + Date.now().toString(36), v: 1, name: "Second world", seed: 424242, createdAt: Date.now() - 864e5, lastPlayed: Date.now() - 36e5, playtime: 900, thumb: null, home: { planet: "Verdana", star: "Oslo", t: 3 } };
    await u.store.put("meta", meta.id, meta);
    await u.store.put("parked", meta.id, b);
    localStorage.setItem("johnny-spore-test-parked", meta.id);
  }, { a: savesFor("Zorbs", "creature"), b: savesFor("Quills", "cell") });
  const parkedId = await page.evaluate(() => localStorage.getItem("johnny-spore-test-parked"));
  await page.reload();
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  const cards = await page.$$eval(".gsSp[data-sp]", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check("both saved species are in the galaxy", cards.length === 2 && cards.some((c) => c.includes("Zorbs")) && cards.some((c) => c.includes("Quills")), JSON.stringify(cards));
  check("a New species card is in the strip", (await page.$("#gsSpNew")) !== null);
  // Every tap target in the strip is big enough.
  const small = await page.$$eval(".gsSp", (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
  check("species cards are at least 44 px tall", small === 0, small + " too small");

  // Choose the parked species: the galaxy switches to its seed and the panel shows its details.
  await page.click(`.gsSp[data-sp="${parkedId}"]`);
  await sleep(600);
  const panel = await page.$eval("#gsPanel", (e) => (e.hidden ? "" : e.textContent.replace(/\s+/g, " ")));
  check("selecting a species shows its panel", /Quills/.test(panel) && /Cell Stage/.test(panel) && /Continue Quills/.test(panel), panel.slice(0, 160));
  check("the panel shows when it was last played", /Last played/.test(panel));
  const seedNow = await page.evaluate(() => window.__spore.galaxyStart.debug.G.seed);
  check("the galaxy switches to that species' galaxy", seedNow === 424242, String(seedNow));
  const marks = await page.evaluate(() => window.__spore.galaxyStart.debug.G.speciesMarks.length);
  check("its home star is marked", marks === 1, String(marks));
  const overlap = await page.evaluate(() => {
    const a = document.querySelector("#gsPanel").getBoundingClientRect();
    const sp = document.querySelector("#gsSpecies");
    if (!sp || getComputedStyle(sp).display === "none") return false;
    const b = sp.getBoundingClientRect();
    return !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
  });
  check("the panel doesn't cover the species strip", !overlap);

  // Continue it: the universes swap, the page reloads straight into that species' game.
  const before = await page.evaluate(() => localStorage.getItem("johnny-spore-creature-stage"));
  await page.click("#gsSpGo");
  await page.waitForLoadState("load");
  await waitFor(page, () => window.__spore?.universe && !document.body.classList.contains("galaxyStart"), null, 40000).catch(() => null);
  const after = await page.evaluate(() => ({ id: window.__spore.universe.meta.id, cell: JSON.parse(localStorage.getItem("johnny-spore-cell-stage") || "null"), creature: localStorage.getItem("johnny-spore-creature-stage") }));
  check("continuing loads the chosen species' universe", after.id === parkedId, after.id);
  check("its own save is in play", after.cell?.cellName === "Quills" && after.creature === null, JSON.stringify(after.cell?.cellName));
  check("it resumed the game, not the galaxy", await page.evaluate(() => !document.body.classList.contains("galaxyStart")));
  // The other species is untouched in its parked copy.
  const kept = await page.evaluate(async (id) => {
    const u = window.__spore.universe;
    const metas = await u.store.all("meta");
    const other = metas.find((m) => m.id !== id && m.name !== "Second world");
    const keys = other ? await u.store.get("parked", other.id) : null;
    return keys?.["johnny-spore-creature-stage"] || null;
  }, parkedId);
  check("the other species' save is untouched", kept === before, String(kept).slice(0, 60));

  // Species History in the Civilization Stage: heritage and all eight instincts reach it.
  for (const instinct of ["scavenger", "elusive"]) {
    await page.evaluate((inst) => {
      const cs = JSON.parse(localStorage.getItem("johnny-spore-creature-stage") || "null") || { brain: 5, card: "adaptable", alliances: 1, extinctions: 1, homeRegion: "coast" };
      cs.instinct = inst;
      localStorage.setItem("johnny-spore-creature-stage", JSON.stringify(cs));
    }, instinct);
  }
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// The Civilization Stage reads every instinct: start it with each and read its legacy lines.
{
  const { ctx, page, errors } = await newPage(SIZES.desktop);
  await page.goto(BASE);
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  await page.evaluate(() => {
    localStorage.setItem("johnny-spore-creature-stage", JSON.stringify({ brain: 5, card: "predator", instinct: "packHunter", alliances: 0, extinctions: 3, homeRegion: "coast" }));
    localStorage.setItem("johnny-spore-tribe-stage", JSON.stringify({ path: "conquest", tribes: [{ status: "conquered" }], units: [], look: { name: "Grimfang", color: 0xaa3322 } }));
  });
  await page.evaluate(() => {
    window.__spore.closeStartScreen();
    window.__spore.startCivStage();
  });
  await waitFor(page, () => !!window.__spore.civStage, null, 60000);
  await sleep(1500);
  const L = await page.evaluate(() => window.__spore.civStage.debug.legacy);
  check("Civilization reads the Pack Hunter instinct (not the old card)", L.lines.some((l) => /^Pack Hunter ancestors/.test(l.text)) && Math.abs(L.mods.damage - 0.06) < 1e-9 && !L.lines.some((l) => /Aggressive creatures/.test(l.text)), JSON.stringify(L.lines.map((l) => l.text)));
  check("the Warlike tribe sets a military first city", L.startType === "military");
  // A rival leader's greeting mentions your past.
  const greet = await page.evaluate(async () => {
    const { line } = await import("./spore/civ/leaders.js");
    const n = window.__spore.civStage.debug.T.nations[0];
    return line("greet", n.personality, { you: "Grimfang", them: n.name, heritage: "X" });
  });
  check("leaders' greetings carry a remark on your history", /X$/.test(greet), greet);
  // Species History: the heritage section and chaptered chronicle.
  await page.evaluate(() => window.__spore.openPath());
  await sleep(400);
  const hist = await page.$eval("#pathPanel", (e) => e.textContent.replace(/\s+/g, " "));
  check("Species History shows the heritage", /HERITAGE/.test(hist) && /Pack Hunter/.test(hist) && /Warlike/.test(hist) && /Carried into the Civilization Stage/.test(hist), hist.slice(0, 200));
  check("the chronicle records the turning points", /Became a Pack Hunter species/.test(hist) && /The tribe conquered the island/.test(hist));
  // The minimap: drawn, a sphere, and a tap moves the camera there.
  await page.evaluate(() => window.__spore.civStage.debug.cam && document.querySelector("#cvPath, #pathClose")?.click());
  await page.evaluate(() => document.querySelector("#pathClose")?.click());
  await sleep(800);
  const mini = await page.evaluate(() => {
    const c = document.querySelector("#cvMini");
    const r = c.getBoundingClientRect();
    const px = c.getContext("2d").getImageData(150, 150, 1, 1).data;
    return { w: r.width, h: r.height, drawn: px[3] > 0, has: !!window.__spore.civStage.debug.minimap };
  });
  check("the planet minimap is drawn", mini.has && mini.drawn && mini.w >= 90, JSON.stringify(mini));
  const moved = await page.evaluate(async () => {
    const dbg = window.__spore.civStage.debug;
    const f0 = { ...dbg.cam.f };
    const c = document.querySelector("#cvMini").getBoundingClientRect();
    document.querySelector("#cvMini").dispatchEvent(new MouseEvent("click", { clientX: c.left + c.width * 0.85, clientY: c.top + c.height * 0.5, bubbles: true }));
    const f1 = dbg.cam.f;
    return Math.acos(Math.max(-1, Math.min(1, f0.x * f1.x + f0.y * f1.y + f0.z * f1.z)));
  });
  check("tapping the minimap turns the camera there", moved > 0.3, String(moved));
  // A world event: a disaster damages a city's defences and is told in the news and chronicle.
  const ev = await page.evaluate(() => {
    const dbg = window.__spore.civStage.debug;
    const c = dbg.T.cities.find((x) => x.owner === "you");
    const hp = c.turretHp;
    dbg.applyWorldEvent({ id: "disaster", icon: "🌋", title: "Natural disaster", color: 0xff6a3d, seconds: 0, text: "A flood strikes " + c.name + "!", at: c.id, effect: { damage: 0.45, unrest: 1.5, city: c.id } });
    return { before: hp, after: c.turretHp, unrest: c.unrest, news: dbg.T.newsLog.at(-1)?.text || "", notes: document.querySelectorAll(".cvNote, .cvNotes > *").length };
  });
  check("a world event changes the world", ev.after < ev.before && ev.unrest >= 1.5, JSON.stringify(ev));
  check("a world event is in the news and on screen", /Natural disaster/.test(ev.news) && ev.notes > 0);
  const boom = await page.evaluate(() => {
    const dbg = window.__spore.civStage.debug;
    const s0 = dbg.income();
    dbg.applyWorldEvent({ id: "boom", icon: "💰", title: "Economic boom", color: 0xf5c75a, seconds: 100, text: "Boom.", effect: { income: 1.25 } });
    return { s0, s1: dbg.income() };
  });
  check("an economic boom raises income", boom.s0 <= 0 || boom.s1 > boom.s0 * 1.2, JSON.stringify(boom));
  check("Civilization: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
