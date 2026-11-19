const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, w, h, expectSide) {
  console.log(`\n== ${label} ${w}x${h} ==`);
  const { browser, ctx, page, errors } = await open({ width: w, height: h, touch: true, dpr: 2 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(false, false);
    const i = document.getElementById("intro");
    if (i) i.style.display = "none";
  });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const swipe = async (x0, y0, x1, y1, steps = 14, hold = 0) => {
    await touch("touchStart", x0, y0);
    if (hold) await sleep(hold);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await sleep(16);
    }
    await touch("touchEnd");
    await sleep(350);
  };
  const ed = (fn) => page.evaluate((src) => new Function("ed", "return (" + src + ")(ed)")(window.__spore.creatureEditor.debug), fn.toString());

  // Count pointerdowns that reach the 3D canvas (a scroll must never reach it).
  await page.evaluate(() => {
    window.__canvasDown = 0;
    window.__spore.renderer.domElement.addEventListener("pointerdown", () => window.__canvasDown++);
  });
  const layout = await page.evaluate(() => document.querySelector(".crEditor").classList.contains("side"));
  check(`layout is ${expectSide ? "side panel" : "bottom sheet"}`, layout === expectSide);

  await page.tap('.ceRail [data-cat="mouth"]');
  await page.waitForTimeout(300);

  // Tap selects (and previews) without equipping.
  await page.tap('.cePart[data-part="jaws"]');
  await page.waitForTimeout(250);
  let st = await ed((d) => ({ focus: d.focusId, preview: d.previewId, real: d.rec.parts.map((p) => p.id) }));
  check("a tap selects and previews a mouth, without equipping", st.focus === "jaws" && st.preview === "jaws" && st.real.includes("beak"), JSON.stringify(st));
  // The Equip button is a proper touch target.
  const btn = await page.locator("#ceInfo [data-act=equip]").boundingBox();
  check("Equip is at least 44px tall (touch target)", btn && btn.height >= 44, btn && btn.height + "px");
  await page.tap("#ceInfo [data-act=equip]");
  await page.waitForTimeout(250);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("tap Equip swaps the mouth", st.includes("jaws") && !st.includes("beak"), st.join());
  const tileBox = await page.locator('.cePart[data-part="snout"]').boundingBox();
  check("tiles are at least 44px (touch target)", tileBox.width >= 44 && tileBox.height >= 44, `${Math.round(tileBox.width)}x${Math.round(tileBox.height)}`);

  // Scrolling the catalogue must not rotate the creature or touch the canvas.
  await page.tap('.ceRail [data-cat="mouth"]');
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => { const g = document.querySelector(".ceGrid"); return { top: g.scrollTop, left: g.scrollLeft, scrollable: g.scrollHeight > g.clientHeight + 4 || g.scrollWidth > g.clientWidth + 4 }; });
  const gb = await page.locator(".ceGrid").boundingBox();
  const cx = gb.x + gb.width * 0.5,
    cy = gb.y + Math.min(gb.height * 0.5, 60);
  const modeBefore = await ed((d) => ({ rec: JSON.stringify(d.rec), preview: d.previewId }));
  if (expectSide) await swipe(cx, gb.y + gb.height - 20, cx, gb.y + 20); // finger up: scrolls the list down
  else await swipe(gb.x + gb.width - 30, cy, gb.x + 20, cy); // finger left: scrolls the row along
  const afterScroll = await page.evaluate(() => { const g = document.querySelector(".ceGrid"); return { top: g.scrollTop, left: g.scrollLeft, down: window.__canvasDown }; });
  console.log("   scroll:", JSON.stringify({ before, afterScroll }));
  if (before.scrollable) check("swiping along the grid scrolls it natively", expectSide ? afterScroll.top > before.top : afterScroll.left > before.left);
  else console.log("   (mouth grid fits without scrolling at this size; native-scroll check not applicable)");
  check("scrolling the catalogue never reaches the 3D canvas (no rotation)", afterScroll.down === 0, "canvas pointerdowns: " + afterScroll.down);
  const modeAfter = await ed((d) => ({ rec: JSON.stringify(d.rec), preview: d.previewId }));
  check("scrolling did not equip, drag or preview anything by accident", modeAfter.rec === modeBefore.rec && modeAfter.preview === modeBefore.preview);
  st = await ed((d) => d.rec.parts.map((p) => p.id));

  // Drag a tile onto the creature with a finger: pull across the grid's scroll axis.
  await page.tap('.ceRail [data-cat="mouth"]');
  await page.waitForTimeout(250);
  await page.locator('.cePart[data-part="snout"]').scrollIntoViewIfNeeded(); // a user scrolls to a tile before dragging it
  await page.waitForTimeout(200);
  const t = await page.locator('.cePart[data-part="snout"]').boundingBox();
  const sx = t.x + t.width / 2,
    sy = t.y + t.height / 2;
  const target = await page.evaluate(() => { const d = window.__spore.creatureEditor.debug; const a = d.handleScreen(2); return { x: a.x, y: a.y }; }); // the middle of the torso, wherever the layout put it
  await swipe(sx, sy, target.x, target.y, 18);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("dragging a tile across the scroll axis drops it on the creature", st.includes("snout") && !st.includes("jaws"), st.join());
  check("tap-to-select remains an alternative to dragging (verified above)", true);

  // Locked tiles show a card but cannot be dragged.
  await page.locator('.cePart[data-part="tuskMaw"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const lt = await page.locator('.cePart[data-part="tuskMaw"]').boundingBox();
  await swipe(lt.x + lt.width / 2, lt.y + lt.height / 2, target.x, target.y, 14);
  st = await ed((d) => d.rec.parts.map((p) => p.id));
  check("a locked tile cannot be dragged onto the body", !st.includes("tuskMaw"), st.join());

  // Pinching the page is suppressed.
  const prevented = await page.evaluate(() => {
    const ev = new Event("gesturestart", { cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check("pinch-zoom gestures are cancelled while the editor is open", prevented);
  const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
  check("viewport disallows user scaling", /user-scalable=no/.test(meta) && /maximum-scale=1/.test(meta), meta);

  // The creature preview is large, and sits in the free space: not under the panel or the stats.
  await page.waitForTimeout(1200); // the framing eases in
  const sb = await ed((d) => d.screenBounds());
  const freeW = sb.free.right - sb.free.left;
  const width = sb.x1 - sb.x0;
  console.log("   creature on screen:", JSON.stringify({ w: Math.round(width), freeW: Math.round(freeW), frac: +(width / freeW).toFixed(2), rect: [sb.x0, sb.y0, sb.x1, sb.y1].map(Math.round), free: Object.values(sb.free).map(Math.round) }));
  check("the creature fills at least 55% of the free width", width / freeW >= 0.55, (width / freeW).toFixed(2));
  const m = 6;
  check("and sits fully inside the free area (clear of panel, stats and top bar)", sb.x0 >= sb.free.left - m && sb.x1 <= sb.free.right + m && sb.y0 >= sb.free.top - m && sb.y1 <= sb.free.bottom + m);
  await page.screenshot({ path: OUT + `e2e-touch-${label}.png` });
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

(async () => {
  await run("ipad-landscape", 1024, 768, true);
  await run("ipad-portrait", 768, 1024, false);
  await run("phone", 390, 844, false);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
