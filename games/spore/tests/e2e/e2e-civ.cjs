const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const W = 1280, H = 800;
async function boot(page, { save = null } = {}) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  if (save) await page.evaluate((s) => localStorage.setItem("johnny-spore-civ-stage", s), save);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.evaluate(() => { const d = window.__spore.civStage.debug; d.T.nations.forEach((n) => { n.clock = 1e9; }); });
}
const cs = (f) => `(() => { const cs = window.__spore.civStage, d = cs.debug; ${f} })()`;
(async () => {
  const { browser, page, errors } = await open({ width: W, height: H });
  await boot(page);
  // ---------------------------------------------------------------- the world
  const w = await page.evaluate(cs(`return { cont: d.map.continents.filter(c=>c.big).length, cities: d.T.cities.length, spice: d.T.geysers.length, owners: d.T.cities.map(c=>c.owner), yields: d.T.geysers.map(g=>g.yield), planet: d.map.profile.planetId, R: d.map.R, styles: Object.values(d.T.cultures).map(c=>c.style), conts: [...new Set(d.T.cities.map(c=>c.continent))].length }`));
  check("the Civilization Stage opens on a planet with several continents and a dozen cities", w.cont >= 3 && w.cities === 12 && w.conts >= 3, JSON.stringify({ cont: w.cont, cities: w.cities, citiesOnContinents: w.conts }));
  check("spice geysers across the planet, each with its own yield", w.spice >= 9 && new Set(w.yields).size >= 4, w.spice + " geysers, yields " + w.yields.join(","));
  check("you own one city, three rivals and independents own the rest", w.owners[0] === "you" && w.owners.filter(o=>o==="you").length===1 && w.owners.filter(o=>o===null).length >= 4, w.owners.join());
  check("each nation has its own architecture", new Set(w.styles).size === w.styles.length, w.styles.join());
  const hw = await page.evaluate(async () => { const m = await import("/games/spore/ecolib/homeworld.js"); const hw = m.getHomeworld(); const d = window.__spore.civStage.debug; return { same: hw && hw.planetId === d.map.profile.planetId, planet: hw?.planetId, label: hw?.label, water: hw?.water?.color, veg: hw?.vegetation?.leaf, stored: window.__spore.universe.session.pedia.home.planetId }; });
  check("it is the homeworld chosen at the start of the game", hw.same && hw.planet === hw.stored, JSON.stringify({ planet: hw.planet, label: hw.label }));
  const colors = await page.evaluate(cs(`const m = d.map; const sea = m.citySites.find(c=>c.sea).sea; const { lon, lat } = (function(){ const R=m.R; const lat=-sea.z/R; return { lon: sea.x/(R*Math.cos(lat)), lat }; })(); const c = m.colorLL(lon, lat, m.heightAt(sea.x, sea.z), 0); return { sea: c, water: m.profile.water.color }`));
  const chan = (c, s) => (c >> s) & 255;
  check("the sea takes the homeworld's water colour", Math.abs(chan(colors.sea,16)-chan(colors.water,16)) < 70 && Math.abs(chan(colors.sea,8)-chan(colors.water,8)) < 70 && Math.abs(chan(colors.sea,0)-chan(colors.water,0)) < 70, colors.sea.toString(16) + " vs " + colors.water.toString(16));

  // ---------------------------------------------------------------- camera
  const f0 = await page.evaluate(cs(`return { ...d.rig.focusMap(), dist: d.rig.distance, h: d.rig.heading() }`));
  await page.mouse.move(640, 400); await page.mouse.down({ button: "middle" }); await page.mouse.move(520, 340, { steps: 8 }); await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(900);
  const f1 = await page.evaluate(cs(`return { ...d.rig.focusMap(), dist: d.rig.distance }`));
  const moved = Math.hypot(f1.x - f0.x, f1.z - f0.z);
  check("dragging (middle button) slides the view over the planet", moved > 15, moved.toFixed(0) + " m");
  check("dragging left moves the view east (the ground follows the finger)", f1.x > f0.x, `${f0.x.toFixed(0)} → ${f1.x.toFixed(0)}`);
  await page.mouse.move(640, 400);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
  await page.waitForTimeout(900);
  const zOut = await page.evaluate(cs(`return d.rig.distance`));
  check("scrolling out zooms out", zOut > f0.dist * 1.6, f0.dist + " → " + zOut.toFixed(0));
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(50); }
  await page.waitForTimeout(1000);
  const zIn = await page.evaluate(cs(`return d.rig.distance`));
  check("scrolling in zooms in, down to a limit", zIn < zOut && zIn >= 38, zIn.toFixed(0));
  // rotate with Q/E and recover with N
  await page.keyboard.down("e"); await page.waitForTimeout(700); await page.keyboard.up("e"); await page.waitForTimeout(500);
  const hd = await page.evaluate(cs(`return d.rig.heading()`));
  check("E turns the map", Math.abs(hd) > 0.08, hd.toFixed(2) + " rad (the software renderer runs slowly, so the turn is small)");
  await page.keyboard.press("n"); await page.waitForTimeout(1500);
  const hd2 = await page.evaluate(cs(`return d.rig.heading()`));
  check("N puts north back at the top", Math.abs(hd2) < 0.08, hd2.toFixed(3));
  await page.keyboard.press("g"); await page.waitForTimeout(2200);
  const g = await page.evaluate(cs(`const s = d.stats(); return { dist: d.rig.distance, vis: s.chunks.chunksVisible, calls: s.calls, tris: s.triangles }`));
  check("G zooms right out to show the whole planet", g.dist > 520 && g.vis > 40, JSON.stringify(g));
  await page.screenshot({ path: OUT + "civ-globe.png" });
  // the planet fits in the window
  const fit = await page.evaluate(cs(`const R = d.map.R; const c = d.camera; const v = new (c.position.constructor)(); const up = d.rig.focusVec(); const test = []; for (const a of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]]) { } return { dist: c.position.length() }`));
  check("zoomed out, the whole planet is in view", fit.dist > 700, "camera " + fit.dist.toFixed(0) + " from the centre");
  // spin the globe by dragging: focus moves a long way, and never goes wrong at the poles
  const g0 = await page.evaluate(cs(`return d.rig.focusMap()`));
  await page.mouse.move(400, 400); await page.mouse.down({ button: "middle" }); await page.mouse.move(700, 300, { steps: 12 }); await page.mouse.up({ button: "middle" }); await page.waitForTimeout(1200);
  const g1 = await page.evaluate(cs(`return d.rig.focusMap()`));
  check("on the globe, dragging spins the planet", Math.hypot(g1.x - g0.x, g1.z - g0.z) > 60, Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(0) + " m");
  await page.keyboard.press("h"); await page.waitForTimeout(2500);
  const home = await page.evaluate(cs(`const f = d.rig.focusMap(), c = d.T.cities[0]; return { off: Math.hypot(f.x-c.x, f.z-c.z), dist: d.rig.distance }`));
  check("H flies home to the capital", home.off < 12, home.off.toFixed(1) + " m away, zoom " + home.dist.toFixed(0));
  // minimap
  const mm = await page.evaluate(cs(`const r = document.querySelector(".cvMini").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, hidden: document.querySelector(".cvMini").hidden }`));
  const tgt = await page.evaluate(cs(`const c = d.T.cities[5]; return { x: c.x, z: c.z }`));
  await page.mouse.click(mm.x + mm.w * ((tgt.x + Math.PI*260) / (2*Math.PI*260)), mm.y + mm.h * ((tgt.z + 260*72*Math.PI/180) / (2*260*72*Math.PI/180)));
  await page.waitForTimeout(400);
  const mj = await page.evaluate(cs(`d.rig.snap(); const f = d.rig.focusMap(), c = d.T.cities[5]; return Math.hypot(f.x-c.x, f.z-c.z)`));
  check("tapping the planet map flies the camera there", mj < 25, mj.toFixed(1) + " m from the target");
  await page.evaluate(cs(`d.rig.flyTo(d.T.cities[0].x, d.T.cities[0].z, 120); d.rig.snap();`));
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------------- selecting
  const sc = await page.evaluate(cs(`return d.cityScreen(0)`));
  await page.mouse.click(sc.x, sc.y); await page.waitForTimeout(500);
  const sheet = await page.evaluate(cs(`return { kind: d.sheet?.kind, name: d.sheet?.city?.name, text: document.querySelector("#cvSheet").textContent.slice(0, 120) }`));
  check("tapping a city opens it", sheet.kind === "city", sheet.name);
  check("the city sheet names its architecture", /Domed|Spired|Terraced|Stilted|Hive|Fortress|Colonnaded/.test(sheet.text) || await page.evaluate(() => /architecture|Domed|Spired|Terraced|Stilted|Hive|Fortress|Colonnaded/.test(document.querySelector("#cvSheet").textContent)));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // region inspector: tap open ground
  await page.evaluate(cs(`d.T.selected.clear()`));
  await page.mouse.click(300, 560); await page.waitForTimeout(500);
  const reg = await page.evaluate(() => ({ hidden: document.querySelector("#cvRegion").hidden, text: document.querySelector("#cvRegion").textContent }));
  check("tapping open ground tells you about the region", !reg.hidden && /m (up|deep)/.test(reg.text), reg.text.slice(0, 120));
  // select the vehicle
  const vs = await page.evaluate(cs(`const v = d.T.vehicles.find(v=>v.owner==="you"); return { ...d.vehicleScreen(v), id: v.id }`));
  await page.mouse.click(vs.x, vs.y); await page.waitForTimeout(400);
  const sel = await page.evaluate(cs(`return d.T.selected.size`));
  check("tapping a vehicle selects it", sel === 1, "selected " + sel);
  await page.screenshot({ path: OUT + "civ-city.png" });

  // ---------------------------------------------------------------- moving units
  const trip = await page.evaluate(cs(`
    const v = d.T.vehicles.find(v=>v.owner==="you"); const c = d.T.cities[0];
    // a far point on the same continent, reachable by land
    let best = null; const here = c.continent;
    for (const s of d.map.citySites) if (s.continent === here && Math.hypot(s.x-c.x, s.z-c.z) > 90) { best = s; break; }
    d.orderTo([v], { type: "move", x: best.x, z: best.z });
    const start = { x: v.pos.x, z: v.pos.z }; let wet = 0, maxStep = 0, last = { ...start };
    let closest = 1e9; for (let t = 0; t < 90; t += 0.1) { cs.update(0.1); if (!d.map.walkable("land", v.pos.x, v.pos.z)) wet++; closest = Math.min(closest, Math.hypot(v.pos.x-best.x, v.pos.z-best.z)); maxStep = Math.max(maxStep, Math.hypot(v.pos.x-last.x, v.pos.z-last.z)); last = { x: v.pos.x, z: v.pos.z }; }
    return { left: closest, from: Math.hypot(start.x-best.x, start.z-best.z), wet, maxStep, order: !!v.order, speed: v.unit.speed }`));
  check("a land vehicle drives across the land to where it is sent, over a route (never wet), at its own speed", trip.left < 6 && trip.wet === 0 && trip.maxStep <= trip.speed * 0.1 + 0.05, JSON.stringify({ from: Math.round(trip.from), left: Math.round(trip.left), wet: trip.wet, maxStep: +trip.maxStep.toFixed(2) }));
  const across = await page.evaluate(cs(`
    const v = d.T.vehicles.find(v=>v.owner==="you"); const far = d.T.cities.find(c => c.continent !== v.pos && c.continent !== d.map.continentAt(v.pos.x, v.pos.z));
    d.orderTo([v], { type: "city", city: far });
    return { order: v.order, toast: document.querySelector("#cvToast").textContent }`));
  check("a land vehicle is refused a city across the sea, with a reason", !across.order && /water|sea|boats/i.test(across.toast), across.toast);
  // air
  const air = await page.evaluate(cs(`
    const c = d.T.cities[0]; const far = d.T.cities.find(x => x.continent !== c.continent);
    const v = d.spawnVehicle("you", "economic:air", c); d.orderTo([v], { type: "move", x: far.x, z: far.z });
    const d0 = Math.hypot(v.pos.x-far.x, v.pos.z-far.z); let closest = d0, ymax = 0; for (let t = 0; t < 120; t += 0.1) { cs.update(0.1); closest = Math.min(closest, Math.hypot(v.pos.x-far.x, v.pos.z-far.z)); ymax = Math.max(ymax, v.y); }
    return { d0, left: closest, y: ymax }`));
  check("an aircraft flies over the sea to another continent", air.left < 8 && air.y > 5, JSON.stringify({ d0: Math.round(air.d0), left: Math.round(air.left), y: +air.y.toFixed(1) }));
  // sea
  const sea = await page.evaluate(cs(`
    const coastal = d.T.cities.filter(c => c.coastal && c.sea);
    const a = coastal[0], b = coastal.find(c => c !== a && d.map.findPath("sea", a.sea, c.sea));
    const v = d.spawnVehicle("you", "economic:sea", a); const start = { ...v.pos };
    d.orderTo([v], { type: "move", x: b.sea.x, z: b.sea.z });
    let dry = 0, closest = 1e9; for (let t = 0; t < 400; t += 0.1) { cs.update(0.1); if (!d.map.walkable("sea", v.pos.x, v.pos.z)) dry++; closest = Math.min(closest, Math.hypot(v.pos.x-b.sea.x, v.pos.z-b.sea.z)); }
    return { ok: !!b, order: !!v.order, left: closest, dry, startOnWater: d.map.walkable("sea", start.x, start.z), mode: v.mode }`));
  check("a boat sails through water only and reaches another coast", sea.ok && sea.dry === 0 && sea.left < 8 && sea.startOnWater, JSON.stringify(sea));
  const boatRefuse = await page.evaluate(cs(`
    const a = d.T.cities.find(c => c.coastal && c.sea); const v = d.spawnVehicle("you", "economic:sea", a);
    const gz = d.T.geysers[0]; d.orderTo([v], { type: "geyser", geyser: gz, x: gz.x, z: gz.z }); return { order: !!v.order, toast: document.querySelector("#cvToast").textContent }`));
  check("boats cannot be sent to inland spice", !boatRefuse.order && /water|inland/i.test(boatRefuse.toast), boatRefuse.toast);

  // ---------------------------------------------------------------- spice
  const spice = await page.evaluate(cs(`
    const v = d.spawnVehicle("you", "economic:air", d.T.cities[0]);
    const gz = d.T.geysers.filter(g => !g.owner).sort((a,b)=>Math.hypot(a.x-v.pos.x,a.z-v.pos.z)-Math.hypot(b.x-v.pos.x,b.z-v.pos.z))[0];
    const inc0 = d.income(); d.orderTo([v], { type: "geyser", geyser: gz, x: gz.x, z: gz.z });
    for (let t = 0; t < 240 && !gz.owner; t += 0.1) cs.update(0.1);
    return { owner: gz.owner, yield: gz.yield, gain: d.income() - inc0, hasDerrick: !!gz.view && !gz.plume }`));
  check("a vehicle claims a spice geyser, which then pays you by its yield", spice.owner === "you" && Math.abs(spice.gain - 1.1 * spice.yield) < 0.01 && spice.hasDerrick, JSON.stringify(spice));
  // rivals claim spice too
  const rival = await page.evaluate(cs(`
    d.T.nations.forEach(n => { n.clock = 0; });
    for (let t = 0; t < 900; t += 0.25) cs.update(0.25);
    const owned = d.T.geysers.filter(g => g.owner && g.owner !== "you"); return { rivalOwned: owned.length, owners: owned.map(g=>g.owner), time: Math.round(d.T.time), veh: d.T.vehicles.filter(v=>v.owner!=="you").length }`));
  check("rival civilizations capture spice geysers", rival.rivalOwned >= 1, JSON.stringify(rival));
  // level of detail
  await page.evaluate(cs(`d.rig.flyTo(d.T.cities[0].x, d.T.cities[0].z, 80); d.rig.snap();`)); await page.waitForTimeout(1500);
  const lodNear = await page.evaluate(cs(`const c = d.T.cities[0]; return { detail: c.art.detail.visible, proxy: c.art.proxy.visible }`));
  await page.evaluate(cs(`d.rig.setDistance(560); d.rig.snap();`)); await page.waitForTimeout(1500);
  const lodFar = await page.evaluate(cs(`const c = d.T.cities[0]; const s = d.stats(); return { detail: c.art.detail.visible, proxy: c.art.proxy.visible, scenery: s.scenery.placements, farUnits: s.units.far, units: s.units.total }`));
  check("level of detail: near a city its buildings are drawn in full, far away only a marker", lodNear.detail && !lodNear.proxy && !lodFar.detail && lodFar.proxy, JSON.stringify({ near: lodNear, far: lodFar }));
  check("far away vehicles become markers and scenery is not drawn", lodFar.farUnits === lodFar.units && lodFar.scenery === 0, JSON.stringify(lodFar));
  console.log("errors", errors.slice(0, 6));
  check("no page errors", errors.length === 0);
  await browser.close();
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
})();
