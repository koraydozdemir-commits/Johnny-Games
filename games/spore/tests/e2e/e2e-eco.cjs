const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : "")); };
async function run(label, w, h, touch) {
  console.log(`\n== ${label} ${w}x${h} ==`);
  const { browser, page, errors } = await open({ width: w, height: h, touch, dpr: 1 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.openEcoLibrary(); });
  await page.waitForSelector(".ecl .eclTile", { timeout: 10000 });
  await page.waitForTimeout(6000); // software rendering bakes thumbnails slowly
  const tabs = await page.$$eval(".eclTabs button", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ")));
  check("seven tabs with counts", tabs.length === 7 && /Trees\s*40/.test(tabs[0]), tabs.join(" | "));
  const thumbs = await page.evaluate(() => [...document.querySelectorAll(".eclTile img")].filter((i) => i.src.startsWith("data:image/png")).length);
  check("visible tiles get baked thumbnails", thumbs >= 6, thumbs + " baked");
  // Search
  await page.fill("#eclQ", "crystal");
  await page.waitForTimeout(1800);
  const n1 = await page.$$eval(".eclTile", (t) => t.length);
  check("search narrows the list", n1 > 0 && n1 < 40, n1 + " trees match 'crystal'");
  await page.fill("#eclQ", "zzzz");
  await page.waitForTimeout(300);
  check("empty search says so", (await page.textContent(".eclEmpty")).includes("Nothing matches"));
  await page.fill("#eclQ", "");
  // Tabs + sub filter + biome + rarity
  await page.click('.eclTabs [data-tab="fungi"]');
  await page.waitForTimeout(300);
  check("Fungi tab lists 30", (await page.$$eval(".eclTile", (t) => t.length)) === 30);
  await page.click('.eclSub [data-cat="giantFungus"]');
  await page.waitForTimeout(200);
  check("sub-filter Giant fungus lists 10", (await page.$$eval(".eclTile", (t) => t.length)) === 10);
  await page.click('.eclSub [data-cat=""]');
  await page.selectOption("#eclBiome", "fungal");
  await page.selectOption("#eclRarity", "rare");
  await page.waitForTimeout(300);
  const filtered = await page.$$eval(".eclTile", (t) => t.map((x) => x.getAttribute("aria-label")));
  check("biome + rarity filters combine", filtered.length > 0 && filtered.every((l) => /rare/.test(l)), filtered.length + " rare fungal fungi");
  await page.selectOption("#eclBiome", "");
  await page.selectOption("#eclRarity", "");
  // Select an asset and inspect details
  await page.click('.eclTabs [data-tab="trees"]');
  await page.waitForTimeout(300);
  await page.click('.eclTile[data-id="baobab_giant"]');
  await page.waitForTimeout(900);
  const det = await page.textContent("#eclDetail");
  check("detail shows name, description and size", /Giant Baobab/.test(det) && /water-store/.test(det) && /7–13 m/.test(det));
  check("detail shows compatibility, terrain, temperature and LODs", /Compatible biomes/.test(det) && /Savanna/.test(det) && /Terrain/.test(det) && /LOD 0: \d+ tris/.test(det) && /LOD 2: \d+ tris/.test(det));
  check("native biomes are marked", (await page.$$eval(".eclBiomes li.native", (l) => l.length)) === 2);
  const canvas = await page.evaluate(() => { const c = document.querySelector(".eclTurn"); return c ? [c.width, c.height] : null; });
  check("a 3D preview canvas is running", canvas && canvas[0] > 100, JSON.stringify(canvas));
  await page.click('[data-v="1"]');
  await page.waitForTimeout(300);
  check("variants can be switched", (await page.getAttribute('[data-v="1"]', "aria-pressed")) === "true");
  await page.screenshot({ path: OUT + `eco-ui-${label}.png` });
  if (w >= 900) { await page.click('.eclTabs [data-tab="rocks"]'); await page.waitForTimeout(5000); await page.screenshot({ path: OUT + `eco-ui-${label}-rocks.png` }); await page.click('.eclTabs [data-tab="trees"]'); await page.waitForTimeout(300); }
  // A creature
  if (w < 900) await page.click("#eclBack"); // the detail sheet covers the tabs on narrow screens
  await page.click('.eclTabs [data-tab="creatures"]');
  await page.waitForTimeout(300);
  await page.click('.eclTile[data-id="antlerback"]');
  await page.waitForTimeout(900);
  const cdet = await page.textContent("#eclDetail");
  check("creature detail shows diet, habitat and its generator seed", /Herbivore/.test(cdet) && /Habitat/.test(cdet) && /seed 4103/.test(cdet));
  if (w < 900) { await page.click("#eclBack"); await page.waitForTimeout(200); check("Back returns to the list on narrow screens", await page.isVisible("#eclGrid")); }
  // Escape closes
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  if (w < 900) { /* first Escape may only close a detail sheet */ }
  const stillOpen = await page.$(".ecl");
  if (stillOpen) { await page.keyboard.press("Escape"); await page.waitForTimeout(500); }
  check("Escape closes the library and frees it", (await page.$(".ecl")) === null);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
const which = process.argv[2] || "all";
(async () => {
  if (which === "all" || which === "desktop") await run("desktop", 1280, 800, false);
  if (which === "all" || which === "ipad") await run("ipad", 1024, 768, true);
  if (which === "all" || which === "phone") await run("phone", 390, 844, true);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
