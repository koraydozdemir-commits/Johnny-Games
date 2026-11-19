const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const hide = () => { const i = document.getElementById("intro"); if (i) i.style.display = "none"; };
async function boot(page) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(600);
}
(async () => {
  const { browser, ctx, page, errors } = await open({ width: 1280, height: 800 });
  await boot(page);

  // 1. The home world's profile exists, is stored with the universe, and is what every stage reads.
  const first = await page.evaluate(async () => {
    const s = window.__spore.universe.session;
    const home = s.pedia.home;
    const { getHomeworld } = await import("/games/spore/ecolib/homeworld.js");
    const hw = getHomeworld();
    return { planetId: home.planetId, stored: !!home.profile, sameObject: hw && hw.planetId === home.planetId, label: hw?.label, veg: hw?.vegetation?.name, sky: hw?.atmosphere?.skyName || hw?.atmosphere?.kind, water: hw?.water?.name, biomes: hw?.biomes?.map((b) => b.biome), profile: home.profile };
  });
  check("the homeworld has a stored profile, shared with the stages", first.stored && first.sameObject, JSON.stringify({ label: first.label, veg: first.veg, sky: first.sky, water: first.water, biomes: first.biomes }));
  await page.waitForTimeout(800); // let the save settle

  // 2. Creature Stage is built from it.
  await page.evaluate(([h]) => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(false, false); new Function("(" + h + ")()")(); }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceCancel");
  await page.waitForTimeout(1500);
  const creature = await page.evaluate(async () => { const m = await import("/games/spore/creature/world.js"); return m.worldInfo(); });
  check("Creature Stage terrain is the homeworld's", creature.planetId === first.planetId && !!creature.themeKey, JSON.stringify(creature));
  check("it grew library flora from the shared library", creature.scenery && creature.scenery.placements > 150 && creature.scenery.species >= 12, JSON.stringify(creature.scenery));
  await page.screenshot({ path: OUT + "planet-creature.png" });
  const fauna = await page.evaluate(() => { const d = window.__spore.creatureStage.debug; return [...d.npcs].map((n) => n.species.libraryId || null).filter(Boolean).length + "/" + d.npcs.size; });
  console.log("   wildlife from the library (live npcs):", fauna);

  // 3. Tribal Stage: same planet, same look.
  await page.evaluate(() => window.__spore.startTribeStage());
  await page.waitForTimeout(3500);
  const tribe = await page.evaluate(async () => { const m = await import("/games/spore/creature/world.js"); return m.worldInfo(); });
  check("Tribal Stage is the same planet and palette", tribe.planetId === first.planetId && tribe.leaf === creature.leaf && tribe.skyDay === creature.skyDay && tribe.water === creature.water, JSON.stringify({ planet: tribe.planetId, leaf: tribe.leaf }));
  await page.screenshot({ path: OUT + "planet-tribe.png" });

  // 4. Civilization Stage.
  await page.evaluate(() => window.__spore.startCivStage());
  await page.waitForTimeout(3500);
  const civ = await page.evaluate(() => { const m = window.__spore.civStage.debug.map; return { planetId: m.profile.planetId, leaf: m.profile.vegetation.leaf, water: m.profile.water.color, sea: m.colorLL(0, 0, -5, 0) }; });
  check("Civilization Stage is the same planet (its own spherical world, built from the same profile)", civ.planetId === first.planetId, JSON.stringify({ planet: civ.planetId, leaf: civ.leaf }));
  await page.screenshot({ path: OUT + "planet-civ.png" });

  // 5. Persistence: reload; same profile, same forest.
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(800);
  const again = await page.evaluate(() => window.__spore.universe.session.pedia.home.profile);
  check("after a reload the stored profile is identical", JSON.stringify(again) === JSON.stringify(first.profile));
  await page.evaluate(([h]) => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(true, false); new Function("(" + h + ")()")(); }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.creatureStage, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const creature2 = await page.evaluate(async () => { const m = await import("/games/spore/creature/world.js"); return m.worldInfo(); });
  check("the same planet grows the same forest on a revisit", creature2.scenery.hash === creature.scenery.hash && creature2.scenery.placements === creature.scenery.placements, `${creature.scenery.hash} vs ${creature2.scenery.hash}`);
  check("and the same colours", creature2.leaf === creature.leaf && creature2.grass === creature.grass && creature2.skyDay === creature.skyDay);

  console.log("page errors:", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
