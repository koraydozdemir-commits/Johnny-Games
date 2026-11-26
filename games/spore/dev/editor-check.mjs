/**
 * Browser regression checks for the editor overhaul: the Creature Creator and the construction
 * workshop (vehicles, buildings), driven with real touch input (Chrome's touch events, so the editors
 * see pointerType "touch") at phone, landscape phone, tablet and desktop sizes.
 *
 *   npm install --no-save playwright-core three@0.160.0
 *   CHROME=/usr/bin/google-chrome node dev/editor-check.mjs [--only=phone]
 *
 * Covers: layout (nothing off screen, bars don't overlap, touch targets), first-time tips, dragging a
 * part from the catalogue onto the body, moving it (one undo step per drag), undo/redo, camera orbit
 * and pinch never changing the design, symmetry, duplicate, painting with the picker, Test leaving
 * the design alone, the leave-without-saving confirmation, draft recovery after a reload, saving,
 * and in the workshop: drag-and-drop placement, moving, single-part paint and the test preview.
 * Exits non-zero if any check fails.
 */
/* global process, getComputedStyle */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = createServer(async (req, res) => {
  const file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
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
const SIZES = {
  phone: { width: 390, height: 844, touch: true },
  landscape: { width: 844, height: 390, touch: true },
  tablet: { width: 820, height: 1180, touch: true },
  desktop: { width: 1440, height: 900 },
};
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

async function newPage(size, keepStorage = null) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.touch, hasTouch: !!size.touch, deviceScaleFactor: 1, storageState: keepStorage || undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ path: THREE, contentType: "text/javascript" }));
  await page.route(/r2\.dev/, (r) => r.fulfill({ status: 404, body: "" }));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errors, cdp };
}
const waitFor = (page, fn, arg, timeout = 40000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });
/** A one-finger touch drag through points, with an optional hold before moving. */
async function touchDrag(cdp, pts, { hold = 0, step = 16 } = {}) {
  const [a] = pts;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
  if (hold) await sleep(hold);
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1],
      p1 = pts[i];
    const n = Math.max(2, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / step));
    for (let k = 1; k <= n; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p0.x + ((p1.x - p0.x) * k) / n, y: p0.y + ((p1.y - p0.y) * k) / n, id: 1 }] });
      await sleep(12);
    }
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(120);
}
async function pinch(cdp, c, from, to) {
  const pts = (d) => [
    { x: c.x - d, y: c.y, id: 1 },
    { x: c.x + d, y: c.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let k = 1; k <= 10; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(from + ((to - from) * k) / 10) });
    await sleep(15);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(120);
}
/** Mouse or touch drag, by the page's input type. */
async function drag(page, cdp, size, pts, opts = {}) {
  if (size.touch) return touchDrag(cdp, pts, opts);
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 10 });
  await page.mouse.up();
  await sleep(120);
}
const tap = async (page, size, sel) => {
  const box = await page.$eval(sel, (e) => {
    e.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (size.touch) await page.touchscreen.tap(box.x, box.y);
  else await page.mouse.click(box.x, box.y);
  await sleep(150);
};
const C = "window.__spore.creatureEditor";
/** A point inside the free area where the canvas itself is under the finger (no panel, no pill). */
const emptySpot = (page, free) =>
  page.evaluate((f) => {
    const canvas = document.querySelector("#scene") || document.querySelector("canvas");
    for (let y = f.bottom - 24; y > f.top + 10; y -= 16)
      for (let x = f.left + 24; x < f.right - 24; x += 20) if (document.elementFromPoint(x, y) === canvas) return { x, y };
    return { x: (f.left + f.right) / 2, y: f.bottom - 20 };
  }, free);

async function openCreature(page) {
  await page.goto(BASE);
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  await page.evaluate(() => {
    const S = window.__spore;
    S.closeStartScreen();
    document.querySelector("#intro").style.display = "none";
    S.startCreatureStage(false, false);
  });
  await waitFor(page, () => !!window.__spore.creatureEditor);
  await sleep(1200);
}
/** Whether any of the elements' rectangles overlap (visible ones only). */
const overlapping = (page, a, b) =>
  page.evaluate(
    ([a, b]) => {
      const ra = document.querySelector(a)?.getBoundingClientRect(),
        rb = document.querySelector(b)?.getBoundingClientRect();
      if (!ra || !rb || !ra.width || !rb.width) return false;
      return !(ra.bottom <= rb.top + 1 || rb.bottom <= ra.top + 1 || ra.right <= rb.left + 1 || rb.right <= ra.left + 1);
    },
    [a, b],
  );

for (const [label, size] of Object.entries(SIZES)) {
  if (only && only !== label) continue;
  console.log(`\n— Creature Creator · ${label} ${size.width}×${size.height}`);
  const { ctx, page, errors, cdp } = await newPage(size);
  await openCreature(page);

  // First-time tips, dismissed for good.
  await sleep(400);
  check("first-time tips appear", (await page.$(".edTips")) !== null);
  await tap(page, size, '.edTips [data-a="off"]');
  check("tips can be turned off for good", (await page.$(".edTips")) === null && (await page.evaluate(() => JSON.parse(localStorage.getItem("johnny-spore-editor-tips") || "{}").off === 1)));

  // Layout: nothing off screen, no overlaps, big enough targets, phone inputs that don't zoom iOS.
  const offscreen = await page.$$eval(".edRoot .edTop button, .edRoot .edModes button, .edRoot .edViewTools button", (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1 || e.getBoundingClientRect().bottom > innerHeight + 1)).map((e) => e.id || e.textContent.trim()));
  check("every bar button is on screen", offscreen.length === 0, offscreen.join(", "));
  const small = await page.$$eval(".edRoot .edTop button, .edRoot .edModes button, .edRoot .edViewTools button, .edRoot .ceRail button", (els) => els.filter((e) => e.offsetParent && Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width) < 40).map((e) => e.id || e.getAttribute("aria-label") || e.textContent.trim()));
  check("touch targets are at least 40 px", small.length === 0, small.join(", "));
  check("the mode bar and the drawer don't overlap", !(await overlapping(page, ".edModes", ".cePanel")));
  check("the top bar and the stats don't overlap", !(await overlapping(page, ".edTop", ".ceStats")));
  const fs = await page.$eval("#ceName", (e) => parseFloat(getComputedStyle(e).fontSize));
  check("text fields are 16 px (no iOS focus zoom)", fs >= 16, String(fs));
  const sb = await page.evaluate(`${C}.debug.screenBounds()`);
  check("the creature sits in the free part of the screen", sb.x0 >= sb.free.left - 40 && sb.x1 <= sb.free.right + 40 && sb.y0 >= sb.free.top - 40 && sb.y1 <= sb.free.bottom + 40, JSON.stringify(sb));

  // Drag a part from the catalogue onto the body (touch: hold, then drag).
  await page.evaluate(() => document.querySelector('.ceRail [data-cat="senses"]').click());
  await sleep(300);
  if (size.touch) await page.evaluate(() => window.__spore.creatureEditor.debug.drawer.set("half"));
  await sleep(350);
  const before = await page.evaluate(`({ n: ${C}.debug.rec.parts.length, h: ${C}.debug.history.size })`);
  const tile = await page.$eval('.cePart:not(.locked)[data-part]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.dataset.part };
  });
  // Aim for the body's middle, a little up the flank.
  const target = await page.evaluate(`(() => { const b = ${C}.debug.screenBounds(); return { x: (b.x0 + b.x1) / 2, y: b.y0 + (b.y1 - b.y0) * 0.3 }; })()`);
  await drag(page, cdp, size, [tile, { x: tile.x + 10, y: tile.y - 30 }, target], { hold: 450 });
  await sleep(300);
  const after = await page.evaluate(`({ n: ${C}.debug.rec.parts.length, h: ${C}.debug.history.size, last: ${C}.debug.rec.parts.at(-1) })`);
  check("dragging a part from the catalogue puts it on the body", after.n === before.n + 1 && after.last.id === tile.id, JSON.stringify({ before, after, tile }));
  check("placing it is one undo step", after.h === before.h + 1, `${before.h} → ${after.h}`);

  // Move it on the body: one drag, one undo step.
  const i = after.n - 1;
  await page.evaluate(`${C}.debug.selectPart(${i})`);
  await sleep(200);
  const p0 = await page.evaluate(`${C}.debug.partScreen(${i})`);
  const s0 = await page.evaluate(`({ t: ${C}.debug.rec.parts[${i}].t, a: ${C}.debug.rec.parts[${i}].angle, h: ${C}.debug.history.size })`);
  await drag(page, cdp, size, [p0, { x: p0.x - 40, y: p0.y + 6 }, { x: p0.x - 70, y: p0.y + 10 }]);
  const s1 = await page.evaluate(`({ t: ${C}.debug.rec.parts[${i}].t, a: ${C}.debug.rec.parts[${i}].angle, h: ${C}.debug.history.size })`);
  check("dragging a placed part moves it", Math.abs(s1.t - s0.t) > 0.02 || Math.abs(s1.a - s0.a) > 0.05, JSON.stringify({ s0, s1, p0 }));
  check("a whole drag is a single undo step", s1.h === s0.h + 1, `${s0.h} → ${s1.h}`);
  await tap(page, size, "#ceUndo");
  const s2 = await page.evaluate(`({ t: ${C}.debug.rec.parts[${i}].t, a: ${C}.debug.rec.parts[${i}].angle })`);
  check("Undo puts it back", Math.abs(s2.t - s0.t) < 1e-6 && Math.abs(s2.a - s0.a) < 1e-6, JSON.stringify({ s0, s2 }));
  await tap(page, size, "#ceRedo");
  const s3 = await page.evaluate(`${C}.debug.rec.parts[${i}].t`);
  check("Redo moves it again", Math.abs(s3 - s1.t) < 1e-6);

  // The camera never changes the design.
  const recJson = await page.evaluate(`JSON.stringify(${C}.debug.rec)`);
  const o0 = await page.evaluate(`({ ...${C}.debug.orbit })`);
  const free = await page.evaluate(`${C}.debug.freeArea()`);
  const empty = await emptySpot(page, free);
  await drag(page, cdp, size, [empty, { x: empty.x + 90, y: empty.y + 10 }]);
  const o1 = await page.evaluate(`({ ...${C}.debug.orbit })`);
  check("dragging empty space turns the camera", Math.abs(o1.yaw - o0.yaw) > 0.2, JSON.stringify({ o0, o1, empty }));
  if (size.touch) {
    const mid = await emptySpot(page, { ...free, left: free.left + 60, right: free.right - 60 });
    await pinch(cdp, mid, 20, 60);
    const o2 = await page.evaluate(`({ ...${C}.debug.orbit })`);
    check("pinching zooms in", o2.dist < o1.dist * 0.8, `${o1.dist} → ${o2.dist}`);
  }
  check("camera moves leave the design alone", (await page.evaluate(`JSON.stringify(${C}.debug.rec)`)) === recJson);
  await page.evaluate(`${C}.debug.setView("reset")`);

  // Symmetry: off, a new flank part is one-sided; Mirror brings its twin back.
  await tap(page, size, "#ceSym");
  const solo = await page.evaluate(`(() => { const E = ${C}.debug; E.placePart("${tile.id}", 0.5, 1.4); return { sym: E.symmetry, part: E.rec.parts.at(-1) }; })()`);
  check("with symmetry off, a part goes on one side only", solo.sym === false && solo.part.solo === true, JSON.stringify(solo));
  const twin = await page.evaluate(`(() => { const E = ${C}.debug; E.toggleSolo(); return E.rec.parts.at(-1).solo; })()`);
  check("Mirror gives it its twin back", twin === undefined);
  await tap(page, size, "#ceSym");
  // Duplicate from the part toolbar.
  const nDup = await page.evaluate(`${C}.debug.rec.parts.length`);
  await page.waitForSelector("#ceCtx:not([hidden])");
  await tap(page, size, '#ceCtx [data-ctx="dup"]');
  check("Copy in the part toolbar duplicates it", (await page.evaluate(`${C}.debug.rec.parts.length`)) === nDup + 1);

  // Paint: drag in the colour pad.
  await tap(page, size, '.edModes [data-mode="paint"]');
  await sleep(300);
  const c0 = await page.evaluate(`({ c: ${C}.debug.rec.colors.base, h: ${C}.debug.history.size })`);
  const pad = await page.$eval(".edSV", (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.3, w: r.width };
  });
  await drag(page, cdp, size, [pad, { x: pad.x + pad.w * 0.5, y: pad.y + 20 }]);
  const c1 = await page.evaluate(`({ c: ${C}.debug.rec.colors.base, h: ${C}.debug.history.size })`);
  check("dragging in the colour pad repaints the creature", c1.c !== c0.c, `${c0.c} → ${c1.c}`);
  check("a colour drag is one undo step", c1.h === c0.h + 1, `${c0.h} → ${c1.h}`);
  await tap(page, size, '[data-scheme="preset:0"]');
  check("a ready-made scheme applies", (await page.evaluate(`${C}.debug.rec.pattern`)) === "stripes");

  // Test: the design is untouched.
  const beforeTest = await page.evaluate(`JSON.stringify(${C}.debug.rec)`);
  await tap(page, size, '.edModes [data-mode="test"]');
  await sleep(300);
  await tap(page, size, '[data-motion="run"]');
  await sleep(900);
  check("Test shows the moves bar", await page.$eval("#ceTestBar", (e) => !e.hidden));
  check("testing doesn't change the design", (await page.evaluate(`JSON.stringify(${C}.debug.rec)`)) === beforeTest);
  await tap(page, size, '.edModes [data-mode="build"]');

  // Leaving with changes asks first.
  await tap(page, size, "#ceCancel");
  check("Cancel with changes asks first", (await page.$(".edModal")) !== null);
  await tap(page, size, '.edModal [data-v="0"]');
  check("Keep editing stays in the editor", (await page.$(".edModal")) === null && (await page.evaluate(`!!${C} && !${C}.closed`)));

  // A reload keeps a draft; opening the editor again offers it back.
  await sleep(1300);
  const drafted = await page.evaluate(`JSON.stringify(${C}.debug.rec)`);
  check("a draft is kept while editing", await page.evaluate(() => !!localStorage.getItem("johnny-spore-editor-draft:creature")));
  await page.evaluate(() => {
    localStorage.setItem("johnny-spore-editor-tips", JSON.stringify({ off: 1 }));
  });
  await openCreature(page);
  check("after a reload the editor offers to recover the draft", await page.$eval("#ceRecover", (e) => !e.hidden));
  await tap(page, size, '#ceRecover [data-r="1"]');
  const recovered = await page.evaluate(`JSON.stringify(${C}.debug.rec)`);
  check("Recover brings the design back", JSON.parse(recovered).parts.length === JSON.parse(drafted).parts.length && JSON.parse(recovered).colors.base === JSON.parse(drafted).colors.base);

  // Save.
  await tap(page, size, "#ceDone");
  await sleep(300);
  const saved = await page.evaluate(() => ({ open: !!document.querySelector(".crEditor"), parts: window.__spore.creatureStage?.debug?.P?.record?.parts?.length, draft: localStorage.getItem("johnny-spore-editor-draft:creature") }));
  check("Save closes the editor and the creature carries the design", !saved.open && saved.parts === JSON.parse(drafted).parts.length, JSON.stringify(saved));
  check("saving clears the draft", saved.draft === null);

  // The creation library: the saved creature is there; duplicate it, then delete the copy.
  await sleep(500);
  await page.evaluate(() => {
    window.__spore.syncPedia?.();
    const id = Object.values(window.__spore.universe.session.pedia.entries).find((e) => e.kind === "creature" && e.owned && e.record)?.id;
    window.__spore.openUniverseScreen("pedia", id);
  });
  await page.waitForSelector("#pdDup", { timeout: 15000 }).catch(() => null);
  const dupOk = (await page.$("#pdDup")) !== null;
  check("the library offers Duplicate for a creation", dupOk);
  if (dupOk) {
    const n0 = await page.evaluate(() => Object.keys(window.__spore.universe.session.pedia.entries).length);
    await tap(page, size, "#pdDup");
    await sleep(300);
    const copy = await page.evaluate(() => Object.values(window.__spore.universe.session.pedia.entries).find((e) => e.id.startsWith("dup:")));
    check("Duplicate makes a separate copy", !!copy && /^Copy of/.test(copy.name) && (await page.evaluate(() => Object.keys(window.__spore.universe.session.pedia.entries).length)) === n0 + 1);
    await tap(page, size, "#pdDelete");
    check("Delete asks first", await page.$eval("#pdConfirm", (e) => !e.hidden));
    await tap(page, size, "#pdYes");
    check("the copy is deleted, the original stays", await page.evaluate((id) => !window.__spore.universe.session.pedia.entries[id] && Object.values(window.__spore.universe.session.pedia.entries).some((e) => e.kind === "creature" && e.owned), copy?.id));
  }
  check("Creature Creator: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ---- the Cell Creator's paint sheet ---------------------------------------------------------- */
for (const [label, size] of Object.entries(SIZES)) {
  if (only && only !== label) continue;
  if (label === "tablet") continue;
  console.log(`\n— Cell Creator paint · ${label}`);
  const { ctx, page, errors, cdp } = await newPage(size);
  await page.goto(BASE);
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  await page.evaluate(() => {
    const S = window.__spore;
    S.closeStartScreen();
    document.querySelector("#intro").style.display = "none";
    S.state.runStarted = true;
    S.progress.editorPass = true;
    S.setEditor(true);
  });
  await sleep(1200);
  await tap(page, size, "#paintTool");
  await sleep(400);
  check("the paint tool opens the paint sheet", (await page.$(".edCellPaint")) !== null);
  const c0 = await page.evaluate(() => window.__spore.state.baseColor);
  const pad = await page.$eval(".edCellPaint .edSV", (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.2, w: r.width };
  });
  await drag(page, cdp, size, [pad, { x: pad.x + pad.w * 0.6, y: pad.y + 10 }]);
  await sleep(200);
  const c1 = await page.evaluate(() => window.__spore.state.baseColor);
  check("dragging the colour pad repaints the cell", c1 !== c0, `${c0} → ${c1}`);
  await page.evaluate(() => document.querySelector("#editorUndo")?.click());
  await sleep(200);
  check("Undo puts the colour back", (await page.evaluate(() => window.__spore.state.baseColor)) === c0);
  if (label === "phone") check("the cell moves up above the sheet", await page.evaluate(() => window.__spore.camera.position.y < -0.5));
  await tap(page, size, "#buildTool");
  check("Build closes the paint sheet", (await page.$(".edCellPaint")) === null);
  check("Cell Creator: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ---- the workshop: vehicles and buildings ---------------------------------------------------- */
for (const [label, size, kind] of [
  ["phone", SIZES.phone, "vehicle"],
  ["landscape", SIZES.landscape, "vehicle"],
  ["tablet", SIZES.tablet, "building"],
  ["desktop", SIZES.desktop, "vehicle"],
]) {
  if (only && only !== label) continue;
  console.log(`\n— ${kind} workshop · ${label}`);
  const { ctx, page, errors, cdp } = await newPage(size);
  await page.addInitScript(() => localStorage.setItem("johnny-spore-editor-tips", JSON.stringify({ off: 1 })));
  await page.goto(BASE);
  await waitFor(page, () => window.__spore?.galaxyStart?.mode === "title");
  await page.evaluate((k) => {
    const S = window.__spore;
    S.closeStartScreen();
    document.querySelector("#intro").style.display = "none";
    S.openDesignEditor(k);
  }, kind);
  await waitFor(page, () => !!window.__spore.modularEditor);
  await sleep(1200);
  const M = "window.__spore.modularEditor";
  const offscreen = await page.$$eval(".edRoot .edTop button, .edRoot .edModes button", (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().bottom > innerHeight + 1)).length);
  check("every bar button is on screen", offscreen === 0, String(offscreen));
  check("the mode bar and the drawer don't overlap", !(await overlapping(page, ".edModes", ".cePanel")));
  // Drag a card onto the model.
  const n0 = await page.evaluate(`${M}.design.parts.length`);
  const card = await page.$eval(".ceCards .cePart", (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const free = await page.evaluate(`${M}.debug.freeArea()`);
  const drop = { x: (free.left + free.right) / 2 + 30, y: (free.top + free.bottom) / 2 };
  await drag(page, cdp, size, [card, { x: card.x + 30, y: card.y - 10 }, drop], { hold: 450 });
  await sleep(300);
  const n1 = await page.evaluate(`${M}.design.parts.length`);
  check("dragging a part from the catalogue onto the model adds it", n1 === n0 + 1, `${n0} → ${n1}`);
  // Move a part on the model: one undo step.
  const idx = n1 - 1;
  const p = await page.evaluate(`${M}.debug.partScreen(${idx})`);
  const before = await page.evaluate(`({ x: ${M}.design.parts[${idx}].x, z: ${M}.design.parts[${idx}].z, h: ${M}.debug.history.size })`);
  await drag(page, cdp, size, [p, { x: p.x + 50, y: p.y }, { x: p.x + 90, y: p.y + 5 }]);
  const after = await page.evaluate(`({ x: ${M}.design.parts[${idx}].x, z: ${M}.design.parts[${idx}].z, h: ${M}.debug.history.size })`);
  check("dragging a part on the model moves it", Math.hypot(after.x - before.x, after.z - before.z) > 0.2, JSON.stringify({ before, after, p, under: await page.evaluate((q) => document.elementFromPoint(q.x, q.y)?.outerHTML.slice(0, 120), p) }));
  check("the move is one undo step", after.h === before.h + 1, `${before.h} → ${after.h}`);
  // Paint one part; stats stay the game's own.
  const st0 = await page.evaluate(`JSON.stringify(${M}.debug.stats())`);
  await tap(page, size, '.edModes [data-mode="paint"]');
  await sleep(250);
  await page.evaluate(`${M}.debug.select(0)`);
  await sleep(200);
  await tap(page, size, '[data-ppaint="accent"]');
  check("a single part can be painted", (await page.evaluate(`${M}.design.parts[0].paint`)) === "accent");
  check("painting doesn't change the stats", (await page.evaluate(`JSON.stringify(${M}.debug.stats())`)) === st0);
  // Test preview leaves the design alone.
  const d0 = await page.evaluate(`JSON.stringify(${M}.design)`);
  await tap(page, size, '.edModes [data-mode="test"]');
  await sleep(900);
  check("the test preview runs", await page.$eval("#mdTestBar", (e) => !e.hidden));
  check("the test preview doesn't change the design", (await page.evaluate(`JSON.stringify(${M}.design)`)) === d0);
  await tap(page, size, '.edModes [data-mode="build"]');
  // Undo everything back, then Cancel leaves without asking.
  await page.evaluate(`(() => { while (${M}.debug.history.size) document.querySelector("#mdUndo").click(); })()`);
  await sleep(400);
  const diff = await page.evaluate(`JSON.stringify(${M}.design)`);
  await tap(page, size, "#mdCancel");
  check("Cancel with nothing changed leaves straight away", (await page.$(".mdEditor")) === null, "modal:" + !!(await page.$(".edModal")) + " " + diff.slice(0, 80));
  check(`${kind} workshop: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
