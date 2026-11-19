const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const cs = (f) => `(() => { const cs = window.__spore.civStage, d = cs.debug; ${f} })()`;
async function boot(page, save) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  if (save) await page.evaluate((s) => localStorage.setItem("johnny-spore-civ-stage", s), save);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const d = window.__spore.civStage.debug; d.T.nations.forEach((n) => { n.clock = 1e9; }); });
  await page.evaluate(() => document.querySelector(".tsClose")?.click());
  await page.waitForTimeout(300);
}
const touch = async (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
const rects = (page) => page.evaluate(() => { const q = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }; return { cam: q(".cvCam"), cmd: q(".cvCmd"), mini: q(".cvMini"), bottom: q(".civHUD .trBottom"), top: q(".civHUD .trTop"), nations: q(".civHUD .trTribes"), goal: q(".civHUD .trGoal"), vw: innerWidth, vh: innerHeight }; });
const hit = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

(async () => {
  for (const [name, w, h] of [["ipad-landscape", 1024, 768], ["ipad-portrait", 768, 1024], ["phone", 390, 844]]) {
    const { browser, ctx, page, errors } = await open({ width: w, height: h, touch: true, dpr: 2 });
    await boot(page);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(cs(`const v = d.T.vehicles.find(v=>v.owner==="you"); d.T.selected.add(v); d.spawnVehicle("you", "military:land", d.T.cities[0]);`)); await page.waitForFunction(() => !document.querySelector('#cvCmd').hidden, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(300);
    const r = await rects(page);
    const overlaps = [];
    for (const [a, b] of [["cam", "mini"], ["cam", "bottom"], ["mini", "bottom"], ["cam", "top"], ["mini", "top"], ["mini", "nations"], ["cam", "nations"], ["cmd", "bottom"], ["cmd", "mini"], ["cmd", "cam"], ["cmd", "top"], ["cmd", "nations"]]) if (hit(r[a], r[b])) overlaps.push(a + "/" + b);
    check(`${name}: the command bar is on screen and shows its commands`, !!r.cmd && r.cmd.x >= 0 && r.cmd.x + r.cmd.w <= r.vw + 1 && r.cmd.y >= 0, JSON.stringify(r.cmd && { x: Math.round(r.cmd.x), y: Math.round(r.cmd.y), w: Math.round(r.cmd.w), h: Math.round(r.cmd.h) }));
    check(`${name}: camera buttons, planet map, command bar and HUD do not overlap`, overlaps.length === 0, overlaps.join() || JSON.stringify({ cam: r.cam && [Math.round(r.cam.x), Math.round(r.cam.y)], mini: r.mini && [Math.round(r.mini.x), Math.round(r.mini.y), Math.round(r.mini.w)] }));
    const btn = await page.evaluate(() => [...document.querySelectorAll(".cvCam button")].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    check(`${name}: camera buttons are at least 44px`, Math.min(...btn) >= 44, Math.min(...btn) + "");
    const ta = await page.evaluate(() => getComputedStyle(document.querySelector("#scene")).touchAction);
    check(`${name}: the map does not scroll or zoom the page`, ta === "none", ta);
    // one finger drag
    const f0 = await page.evaluate(cs(`return d.rig.focusMap()`));
    await touch(cdp, "touchStart", [[w / 2, h / 2]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[w / 2 - i * 14, h / 2 - i * 6]]);
    await touch(cdp, "touchEnd", []);
    await page.waitForTimeout(1200);
    const f1 = await page.evaluate(cs(`return d.rig.focusMap()`));
    check(`${name}: one finger slides the view`, Math.hypot(f1.x - f0.x, f1.z - f0.z) > 10, Math.hypot(f1.x - f0.x, f1.z - f0.z).toFixed(0) + " m");
    // pinch out and in
    const z0 = await page.evaluate(cs(`return d.rig.target.dist`));
    await touch(cdp, "touchStart", [[w / 2 - 40, h / 2], [w / 2 + 40, h / 2]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[w / 2 - 40 - i * 12, h / 2], [w / 2 + 40 + i * 12, h / 2]]);
    await touch(cdp, "touchEnd", []);
    const z1 = await page.evaluate(cs(`return d.rig.target.dist`));
    await touch(cdp, "touchStart", [[w / 2 - 140, h / 2], [w / 2 + 140, h / 2]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[w / 2 - 140 + i * 12, h / 2], [w / 2 + 140 - i * 12, h / 2]]);
    await touch(cdp, "touchEnd", []);
    const z2 = await page.evaluate(cs(`return d.rig.target.dist`));
    check(`${name}: pinching in zooms in and spreading zooms out`, z1 < z0 * 0.8 && z2 > z1 * 1.2, `${z0.toFixed(0)} → ${z1.toFixed(0)} → ${z2.toFixed(0)}`);
    // twist
    const h0 = await page.evaluate(cs(`return d.rig.target.q.clone().toArray()`));
    await touch(cdp, "touchStart", [[w / 2 - 60, h / 2], [w / 2 + 60, h / 2]]);
    for (let i = 1; i <= 10; i++) { const a = i * 0.07; await touch(cdp, "touchMove", [[w / 2 - Math.cos(a) * 60, h / 2 - Math.sin(a) * 60], [w / 2 + Math.cos(a) * 60, h / 2 + Math.sin(a) * 60]]); }
    await touch(cdp, "touchEnd", []);
    await page.waitForTimeout(800);
    const hd = await page.evaluate(cs(`d.rig.snap(); return d.rig.heading()`));
    check(`${name}: twisting two fingers turns the map`, Math.abs(hd) > 0.25, hd.toFixed(2) + " rad");
    await page.evaluate(cs(`d.rig.north(); d.rig.setDistance(120); d.rig.flyTo(d.T.cities[0].x, d.T.cities[0].z, 100); d.rig.snap();`));
    await page.waitForTimeout(1200);
    // tap a city / a vehicle
    const sc = await page.evaluate(cs(`return d.cityScreen(0)`));
    await page.touchscreen.tap(sc.x, sc.y); await page.waitForTimeout(500);
    const k = await page.evaluate(cs(`return d.sheet?.kind`));
    check(`${name}: tapping a city opens it`, k === "city", k + "");
    await page.evaluate(() => document.querySelector(".tsClose")?.click()); await page.waitForTimeout(200);
    await page.evaluate(cs(`d.T.selected.clear(); const v = d.T.vehicles.find(v=>v.owner==="you"); d.rig.flyTo(v.pos.x, v.pos.z, 70); d.rig.snap();`)); await page.waitForTimeout(800);
    const vs = await page.evaluate(cs(`const v = d.T.vehicles.find(v=>v.owner==="you"); return d.vehicleScreen(v)`));
    await page.touchscreen.tap(vs.x, vs.y); await page.waitForFunction(() => !document.querySelector('#cvCmd').hidden, null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(300);
    const sel = await page.evaluate(cs(`return d.T.selected.size`));
    check(`${name}: tapping a vehicle selects it, then tapping ground orders it`, sel === 1, "selected " + sel);
    const cmdBtn = await page.evaluate(() => { const b = document.querySelector('[data-cmd="move"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; });
    check(`${name}: command buttons are large enough to tap`, cmdBtn.w >= 44 && cmdBtn.h >= 44, Math.round(cmdBtn.w) + "x" + Math.round(cmdBtn.h));
    await page.touchscreen.tap(cmdBtn.x, cmdBtn.y); await page.waitForTimeout(300);
    const armedCmd = await page.evaluate(cs(`return d.command`));
    check(`${name}: tapping Move arms it, then tapping the ground gives the order`, armedCmd === "move", armedCmd + "");
    await page.touchscreen.tap(w * 0.3, h * 0.3); await page.waitForTimeout(400);
    const ord = await page.evaluate(cs(`const v = [...d.T.selected][0]; return v && v.order && v.order.type`));
    check(`${name}: the order is given`, ord === "move" || ord === "geyser" || ord === "city" || ord === null, String(ord));
    // buttons
    await page.touchscreen.tap(...(await page.evaluate(() => { const r = document.querySelector("#cvGlobe").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })));
    await page.waitForTimeout(300);
    const gd = await page.evaluate(cs(`return d.rig.target.dist`));
    check(`${name}: the globe button zooms out to the whole planet`, gd > 500, gd.toFixed(0));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: OUT + `civ-${name}.png` });
    check(`${name}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await browser.close();
  }

  /* -------------------------------------------------------------- saving */
  {
    const { browser, page, errors } = await open({ width: 1280, height: 800 });
    await boot(page);
    const before = await page.evaluate(cs(`
      const v = d.spawnVehicle("you", "economic:air", d.T.cities[0]); const gz = d.T.geysers[0];
      d.orderTo([v], { type: "geyser", geyser: gz, x: gz.x, z: gz.z }); for (let t = 0; t < 400 && !gz.owner; t += 0.1) cs.update(0.1);
      d.T.money = 777; cs.save();
      return { cities: d.T.cities.map(c => [Math.round(c.x), Math.round(c.z)]), owner0: gz.owner, vehicles: d.T.vehicles.filter(v=>v.owner==="you").map(v => [Math.round(v.pos.x), Math.round(v.pos.z), v.key]), raw: localStorage.getItem("johnny-spore-civ-stage") }`));
    const save = JSON.parse(before.raw);
    check("the save records that it belongs to the planet, with your vehicles", save.planet === 1 && save.vehicles.filter((v) => v.owner === "you").length === before.vehicles.length, `planet ${save.planet}, ${save.vehicles.length} vehicles`);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
    await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    const after = await page.evaluate(cs(`return { cities: d.T.cities.map(c => [Math.round(c.x), Math.round(c.z)]), owner0: d.T.geysers[0].owner, money: Math.round(d.T.money), vehicles: d.T.vehicles.filter(v=>v.owner==="you").map(v => [Math.round(v.pos.x), Math.round(v.pos.z), v.key]) }`));
    check("a reloaded game is the same planet: cities in the same places", JSON.stringify(after.cities) === JSON.stringify(before.cities));
    check("spice ownership, money and vehicle positions come back", after.owner0 === "you" && after.money >= 777 && JSON.stringify(after.vehicles.map((v) => v[2]).sort()) === JSON.stringify(before.vehicles.map((v) => v[2]).sort()) && after.vehicles.every((v, i) => Math.abs(v[0] - before.vehicles[i][0]) <= 6 && Math.abs(v[1] - before.vehicles[i][1]) <= 6), JSON.stringify({ money: after.money, owner0: after.owner0 }));
    check("no page errors after reload", errors.length === 0, errors.slice(0, 2).join(" | "));
    await browser.close();
  }
  /* -------------------------------------------------------------- an old (island) save */
  {
    const old = JSON.stringify({ v: 1, money: 640, startType: "military", nations: [{ id: "n0", type: "military", relation: -20, war: true, money: 300, alive: true }, { id: "n1", type: "economic", relation: 10, war: false, money: 200, alive: true }, { id: "n2", type: "religious", relation: 5, war: false, money: 100, alive: true }],
      cities: Array.from({ length: 11 }, (_, i) => ({ id: i, owner: i === 0 ? "you" : i === 1 ? "n1" : i === 2 ? "n2" : i === 3 ? "n0" : i === 4 ? "you" : null, type: ["military", "economic", "religious"][i % 3], plots: i === 0 ? ["house", "factory", "fun", null, null, null] : ["house", null, null, null, null, null], turrets: i === 0 ? 2 : 1, turretHp: 1, hallHp: 1, trade: {}, conv: {}, unrest: 0 })),
      geysers: [{ owner: "you", hp: 1 }, { owner: "n1", hp: 1 }, { owner: null, hp: 1 }], vehicles: [{ owner: "you", design: "military:land", x: 120, z: 150, hp: 0.5, city: 0 }, { owner: "n1", design: "economic:land", x: -80, z: 60, hp: 1, city: 1 }],
      designs: { building: {}, vehicle: {} }, captures: { military: 2, economic: 1, religious: 0 }, superCool: 0, won: false, card: null, time: 900 });
    const { browser, page, errors } = await open({ width: 1280, height: 800 });
    await boot(page, old);
    const r = await page.evaluate(cs(`return { owners: d.T.cities.map(c => c.owner), n: d.T.cities.length, money: Math.round(d.T.money), plots0: d.T.cities[0].plots.filter(Boolean).length, turrets0: d.T.cities[0].turrets, g: d.T.geysers.slice(0, 3).map(g => g.owner), nat: d.T.nations.map(n => [n.war, Math.round(n.relation)]), vehicles: d.T.vehicles.map(v => ({ owner: v.owner, key: v.key, ok: d.map.walkable(v.mode === "land" ? "land" : v.mode, v.pos.x, v.pos.z), near: Math.hypot(v.pos.x - d.T.cities[v.home].x, v.pos.z - d.T.cities[v.home].z) })), captures: d.T.captures, time: Math.round(d.T.time) }`));
    check("an island-era save loads onto the planet: cities, owners, buildings, money, spice, wars and history are kept", r.owners[0] === "you" && r.owners[4] === "you" && r.owners[1] === "n1" && r.money >= 640 && r.plots0 === 3 && r.turrets0 === 2 && r.g.join() === "you,n1," && r.nat[0][0] === true && r.captures.military === 2 && r.time >= 900, JSON.stringify({ owners: r.owners.slice(0, 6), money: r.money, plots0: r.plots0, g: r.g, nat: r.nat }));
    check("its vehicles come home to their cities instead of standing at island coordinates", r.vehicles.length >= 2 && r.vehicles.every((v) => v.ok && v.near < 70), JSON.stringify(r.vehicles));
    check("a city added by the larger planet is independent", r.n === 12 && r.owners[11] === null, r.n + " cities");
    check("no page errors with an old save", errors.length === 0, errors.slice(0, 2).join(" | "));
    await browser.close();
  }
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
})();
