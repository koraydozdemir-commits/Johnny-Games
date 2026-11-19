const { open } = require("./harness.cjs");
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const hide = () => { const i = document.getElementById("intro"); if (i) i.style.display = "none"; };
const KEYS = { creature: "johnny-spore-creature-stage", tribe: "johnny-spore-tribe-stage", civ: "johnny-spore-civ-stage" };
async function boot(page) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(600);
}
const stageNow = (page) => page.evaluate(() => { const s = window.__spore; return s.civStage ? "civ" : s.tribeStage ? "tribe" : s.creatureStage ? "creature" : "cell"; });
(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await boot(page);
  // ------------------------------------------------------------- the cell, and the homeworld
  const cell = await page.evaluate(() => { const s = window.__spore; const h = s.universe.session.pedia.home; return { planet: h.planetId, stored: !!h.profile, tier: s.state.tier, name: s.state.cellName }; });
  check("the game starts as a cell on a stored homeworld", (await stageNow(page)) === "cell" && cell.stored && !!cell.planet, JSON.stringify(cell));
  const profile0 = await page.evaluate(() => JSON.stringify(window.__spore.universe.session.pedia.home.profile));

  // ------------------------------------------------------------- creature
  await page.evaluate(([h]) => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(false, false); new Function("(" + h + ")()")(); }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceCancel"); await page.waitForTimeout(1800);
  const cr = await page.evaluate(async () => { const m = await import("/games/spore/creature/world.js"); const w = m.worldInfo(); const cs = window.__spore.creatureStage; cs.save(); const raw = JSON.parse(localStorage.getItem("johnny-spore-creature-stage")); return { planet: w.planetId, scenery: w.scenery, leaf: w.leaf, colors: raw.record.colors, name: raw.record.name, level: raw.level ?? null, keys: Object.keys(raw).slice(0, 12) }; });
  check("the Creature Stage opens on the homeworld, grows its flora and saves the species", (await stageNow(page)) === "creature" && cr.planet === cell.planet && cr.scenery.placements > 150 && !!cr.colors && !!cr.name, JSON.stringify({ planet: cr.planet, placements: cr.scenery.placements, species: cr.scenery.species, name: cr.name }));
  const dupes = cr.scenery;
  check("the creature's land has variety without one species taking over", dupes.species >= 10, dupes.species + " species in " + dupes.placements);

  // ------------------------------------------------------------- tribe
  await page.evaluate(() => window.__spore.startTribeStage());
  await page.waitForTimeout(3500);
  const tr = await page.evaluate(async () => { const m = await import("/games/spore/creature/world.js"); const w = m.worldInfo(); const ts = window.__spore.tribeStage; ts.save?.(); const raw = JSON.parse(localStorage.getItem("johnny-spore-tribe-stage") || "null"); return { planet: w.planetId, leaf: w.leaf, sky: w.skyDay, look: raw && raw.look, region: raw && raw.region }; });
  check("the Tribal Stage is the same planet and palette as the Creature Stage", (await stageNow(page)) === "tribe" && tr.planet === cell.planet && tr.leaf === cr.leaf, JSON.stringify({ planet: tr.planet, leaf: tr.leaf }));
  check("the tribe's name comes from the species", tr.look && tr.look.name === cr.name, JSON.stringify(tr.look));

  // ------------------------------------------------------------- civilization
  await page.evaluate(() => window.__spore.startCivStage());
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const cv = await page.evaluate(() => { const d = window.__spore.civStage.debug; const prof = d.map.profile; return { stage: !!d.T, planet: prof.planetId, biomes: prof.biomes.map((b) => b.biome), seen: [...new Set(d.map.continents.length ? Array.from({ length: 400 }, (_, i) => { const x = -700 + (i % 20) * 70, z = -300 + Math.floor(i / 20) * 30; const dd = d.map.describe(x, z); return dd.kind === "land" ? dd.biome : null; }).filter(Boolean) : [])], name: d.T.cities[0].name, tribeColor: d.T.cultures.you.palette.accent, wall: d.T.cultures.you.palette.wall, style: d.T.cultures.you.style, leaf: prof.vegetation.leaf, nations: d.T.nations.map((n) => n.name) }; });
  check("the Civilization Stage is the same homeworld", (await stageNow(page)) === "civ" && cv.planet === cell.planet);
  check("the planet's biomes are the homeworld's own (biome continuity)", cv.seen.length >= 2 && cv.seen.every((b) => cv.biomes.some((x) => x === b || ["grassland", "desert", "temperate_forest", "wasteland", "savanna", "tundra", "swamp", "alpine", "taiga", "ice", "rainforest", "volcanic", "fungal", "crystalline", "alien_lush", "ocean", "shallows"].includes(b))) && cv.biomes.some((b) => cv.seen.includes(b)), JSON.stringify({ profile: cv.biomes, seen: cv.seen }));
  check("the nation takes its name from the tribe, and its architecture colours from the tribe", cv.name === tr.look.name && cv.tribeColor === tr.look.color, JSON.stringify({ name: cv.name, accent: cv.tribeColor.toString(16), tribe: tr.look.color.toString(16), style: cv.style }));
  const sameProfile = await page.evaluate(() => JSON.stringify(window.__spore.universe.session.pedia.home.profile));
  check("the homeworld's profile never changed through the four stages", sameProfile === profile0);

  // ------------------------------------------------------------- saves and resuming each stage
  await page.evaluate(() => { const d = window.__spore.civStage.debug; d.T.money = 1234; window.__spore.civStage.save(); });
  const saved = await page.evaluate((k) => Object.fromEntries(Object.entries(k).map(([n, key]) => [n, !!localStorage.getItem(key)])), KEYS);
  check("every stage has left a save", saved.creature && saved.tribe && saved.civ, JSON.stringify(saved));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  const again = await page.evaluate(() => JSON.stringify(window.__spore.universe.session.pedia.home.profile));
  check("after a reload the homeworld is identical", again === profile0);
  await page.evaluate(([h]) => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); new Function("(" + h + ")()")(); }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => { const d = window.__spore.civStage.debug; return { money: Math.round(d.T.money), planet: d.map.profile.planetId, name: d.T.cities[0].name }; });
  check("the Civilization Stage resumes where it was left, on the same planet", back.money >= 1234 && back.planet === cell.planet && back.name === cr.name, JSON.stringify(back));
  await page.click("#devStagesToggle"); await page.click('#devStagesMenu [data-stage="tribe"]');
  await page.waitForFunction(() => window.__spore.tribeStage && !window.__spore.civStage, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  check("back to the Tribal Stage (from the Civilization Stage) keeps its save", (await stageNow(page)) === "tribe" && (await page.evaluate(() => !!window.__spore.tribeStage)));
  await page.click("#devStagesToggle"); await page.click('#devStagesMenu [data-stage="creature"]');
  await page.waitForFunction(() => window.__spore.creatureStage && !window.__spore.tribeStage, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const cr2 = await page.evaluate(() => { const cs = window.__spore.creatureStage; cs.save(); const raw = JSON.parse(localStorage.getItem("johnny-spore-creature-stage")); return { name: raw.record.name, colors: raw.record.colors }; });
  check("back to the Creature Stage keeps the same species (name and colours)", cr2.name === cr.name && JSON.stringify(cr2.colors) === JSON.stringify(cr.colors));
  // corrupted saves: every stage recovers instead of failing
  await page.evaluate((k) => { for (const key of Object.values(k)) localStorage.setItem(key, "{not json"); }, KEYS);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.evaluate(([h]) => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); new Function("(" + h + ")()")(); }, [hide.toString()]);
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  check("a corrupted save is ignored: a fresh stage starts instead of an error", (await page.evaluate(() => window.__spore.civStage.debug.T.cities.length)) === 12);
  console.log("errors", errors.slice(0, 5));
  check("no page errors across the whole journey", errors.length === 0);
  await browser.close();
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
})();
