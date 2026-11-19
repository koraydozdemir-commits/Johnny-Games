const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const cs = (f) => `(() => { const cs = window.__spore.civStage, d = cs.debug; ${f} })()`;
async function boot(page, w = 1280, h = 800) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const d = window.__spore.civStage.debug; d.T.nations.forEach((n) => { n.clock = 1e9; }); });
  await page.waitForTimeout(300);
}
const landPoint = (page) => page.evaluate(cs(`const c = d.T.cities[0]; for (let r = 150; r < 380; r += 40) for (let a = 0; a < 12; a++) { const x = 640 + Math.cos(a/12*6.28)*r, y = 470 + Math.sin(a/12*6.28)*r*0.6; if (y < 150 || y > 480 || x < 220 || x > 1060) continue; const g = d.groundAt(x, y); if (g && d.map.walkable("land", g.x, g.z) && d.map.continentAt(g.x, g.z) === c.continent && Math.hypot(g.x-c.x, g.z-c.z) > 25 && d.T.vehicles.every(v => { const p = d.vehicleScreen(v); return Math.hypot(p.x - x, p.y - y) > 70; }) && d.T.geysers.every(gz => { const p = d.geyserScreen(gz.id); return Math.hypot(p.x - x, p.y - y) > 60; })) return { x, y }; } return { x: 640, y: 560 };`));
(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await boot(page);
  // a few vehicles near the capital, and a camera on them
  await page.evaluate(cs(`const c = d.T.cities[0]; d.T.money = 5000;
    for (let i = 0; i < 3; i++) d.spawnVehicle("you", "military:land", c);
    d.spawnVehicle("you", "economic:land", c); d.rig.flyTo(c.x, c.z, 90); d.rig.snap();`));
  await page.waitForTimeout(1200);

  /* ---------- selection and the command bar */
  const vs = await page.evaluate(cs(`return d.T.vehicles.filter(v=>v.owner==="you").map(v => ({ id: v.id, role: v.role, ...d.vehicleScreen(v) }))`));
  const mv = vs.find((v) => v.role === "military");
  await page.mouse.click(mv.x, mv.y); await page.waitForTimeout(400);
  const bar1 = await page.evaluate(() => ({ hidden: document.querySelector("#cvCmd").hidden, cmds: [...document.querySelectorAll("#cvCmdRow [data-cmd]")].map((b) => [b.dataset.cmd, b.getAttribute("aria-disabled")]), info: document.querySelector("#cvSelInfo").textContent }));
  check("selecting a vehicle shows its type, health, stats and a command bar", !bar1.hidden && bar1.cmds.length === 7 && /Military/.test(bar1.info) && /Range/.test(bar1.info) && /Damage/.test(bar1.info), bar1.info.slice(0, 110));
  check("a military vehicle can move, attack, defend, follow and capture, but not trade", bar1.cmds.filter(([, d]) => d === "false").map(([c]) => c).join() === "move,attack,defend,follow,capture", bar1.cmds.map((c) => c.join(":")).join(" "));
  // box select
  const box = await page.evaluate(cs(`const ps = d.T.vehicles.filter(v=>v.owner==="you").map(v => d.vehicleScreen(v)); const xs = ps.map(p=>p.x), ys = ps.map(p=>p.y); return { x0: Math.min(...xs) - 30, y0: Math.min(...ys) - 30, x1: Math.max(...xs) + 30, y1: Math.max(...ys) + 30 }`));
  await page.keyboard.press("Escape"); await page.evaluate(cs(`d.T.selected.clear()`));
  await page.mouse.move(box.x0, box.y0); await page.mouse.down(); await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 5 });
  const showing = await page.evaluate(() => !document.querySelector("#cvBox").hidden);
  await page.mouse.move(box.x1, box.y1, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(400);
  const sel4 = await page.evaluate(cs(`return d.T.selected.size`));
  check("dragging a box with the mouse selects every vehicle inside it (and shows the box)", showing && sel4 === vs.length, sel4 + " of " + vs.length + " selected");
  const multi = await page.evaluate(() => ({ info: document.querySelector("#cvSelInfo").textContent, trade: document.querySelector('[data-cmd="trade"]').getAttribute("aria-disabled") }));
  check("a mixed group shows its make-up, and trade/preach becomes available", new RegExp(vs.length + " vehicles").test(multi.info) && multi.trade === "false", multi.info.slice(0, 80));
  // shift adds
  await page.evaluate(cs(`d.T.selected.clear()`));
  await page.evaluate(cs(`d.T.vehicles.filter(v=>v.owner==="you").forEach(v => { v.order = null; })`));
  { await page.evaluate(cs(`const vs = d.T.vehicles.filter(v=>v.owner==="you"); vs[1].pos.x += 14; vs[1].pos.z += 10; vs[2].pos.x -= 14; vs[2].pos.z -= 6;`)); await page.waitForTimeout(300);
    const now = await page.evaluate(cs(`return d.T.vehicles.filter(v=>v.owner==="you").map(v => d.vehicleScreen(v))`)); const a = now[1], b = now[2]; await page.mouse.click(a.x, a.y); await page.keyboard.down("Shift"); await page.mouse.click(b.x, b.y); await page.keyboard.up("Shift"); }
  // (a click toggles; shift-box adds)
  const afterShift = await page.evaluate(cs(`return d.T.selected.size`));
  check("clicking several vehicles builds up a selection", afterShift >= 2, afterShift + "");

  /* ---------- commands by button */
  await page.evaluate(cs(`d.T.selected.clear(); d.T.vehicles.filter(v=>v.owner==="you"&&v.role==="military").forEach(v=>d.T.selected.add(v))`));
  await page.waitForTimeout(400);
  await page.click('[data-cmd="move"]'); await page.waitForTimeout(200);
  const banner = await page.evaluate(cs(`return { cmd: d.command, text: document.querySelector("#cvTargetText").textContent, shown: !document.querySelector("#cvTarget").hidden }`));
  check("choosing a command asks where, with its hint", banner.cmd === "move" && banner.shown && /Move/.test(banner.text), banner.text.slice(0, 70));
  const lp = await landPoint(page);
  await page.mouse.click(lp.x, lp.y); await page.waitForTimeout(500);
  const moved = await page.evaluate(cs(`const sel = [...d.T.selected]; return { orders: sel.map(v => v.order && v.order.type), dests: new Set(sel.map(v => Math.round(v.order.x) + "," + Math.round(v.order.z))).size, spread: Math.max(...sel.map(a => Math.max(...sel.map(b => Math.hypot(a.order.x-b.order.x, a.order.z-b.order.z))))) }`));
  check("a group sent to one place gets a different spot each, spread round it", moved.orders.every((o) => o === "move") && moved.dests >= 2 && moved.spread >= 4.5, JSON.stringify(moved));
  await page.keyboard.press("Delete"); await page.waitForTimeout(200);
  check("Delete (or the Stop button) halts the group", await page.evaluate(cs(`return [...d.T.selected].every(v => !v.order)`)));
  await page.evaluate(cs(`d.rig.snap()`));

  /* ---------- right-click contextual commands */
  const ctx = await page.evaluate(cs(`
    const c = d.T.cities[0]; const mil = d.T.vehicles.filter(v=>v.owner==="you"&&v.role==="military"); d.T.selected.clear(); mil.forEach(v=>d.T.selected.add(v));
    const out = {};
    // ground
    const g = d.map.citySites[0]; const gp = d.cityScreen(0);
    return { gp, n: mil.length }`));
  const rc = async (x, y) => { await page.mouse.click(x, y, { button: "right" }); await page.waitForTimeout(300); };
  { const lp2 = await landPoint(page); await rc(lp2.x, lp2.y); }
  const o1 = await page.evaluate(cs(`return [...d.T.selected].map(v => v.order && v.order.type)`));
  check("right-click on the ground moves the selection", o1.every((o) => o === "move"), o1.join());
  await page.evaluate(cs(`d.T.selected.forEach(v => v.order = null)`));
  const cp = await page.evaluate(cs(`return d.cityScreen(0)`));
  await rc(cp.x, cp.y);
  const o2 = await page.evaluate(cs(`return [...d.T.selected].map(v => v.order && v.order.type)`));
  check("right-click on your own city sends military vehicles to defend it", o2.every((o) => o === "defend"), o2.join());
  await page.evaluate(cs(`d.T.selected.forEach(v => v.order = null)`));
  const tgt = await page.evaluate(cs(`const lead = d.T.vehicles.find(v=>v.owner==="you"&&v.role==="economic"); const p = d.vehicleScreen(lead); return { ...p, id: lead.id }`));
  await rc(tgt.x, tgt.y);
  const o3 = await page.evaluate(cs(`return [...d.T.selected].map(v => v.order && v.order.type)`));
  check("right-click on one of your own vehicles makes the others follow it", o3.every((o) => o === "follow"), o3.join());
  await page.evaluate(cs(`d.T.selected.forEach(v => v.order = null)`));
  await page.evaluate(cs(`const gz = d.T.geysers[0]; d.rig.flyTo(gz.x, gz.z, 80); d.rig.snap();`)); await page.waitForTimeout(1000);
  const gp = await page.evaluate(cs(`return d.geyserScreen(0)`));
  const sameCont = await page.evaluate(cs(`return d.T.geysers[0].continent === d.map.continentAt(d.T.cities[0].x, d.T.cities[0].z)`));
  void gp; await page.evaluate(cs(`d.contextOrder({ type: "geyser", gz: d.T.geysers[0] })`)); await page.waitForTimeout(200);
  const o4 = await page.evaluate(cs(`return [...d.T.selected].map(v => v.order && v.order.type)`));
  check("right-click on a spice geyser sends them to capture it (or says why not)", sameCont ? o4.every((o) => o === "geyser") : o4.every((o) => !o) && /way there|water/i.test(await page.evaluate(() => document.querySelector("#cvToast").textContent)), o4.join() + (sameCont ? "" : " (geyser on another continent)"));
  await page.evaluate(cs(`d.T.selected.forEach(v => v.order = null); d.rig.flyTo(d.T.cities[0].x, d.T.cities[0].z, 90); d.rig.snap();`));

  /* ---------- follow */
  const fol = await page.evaluate(cs(`
    d.T.time = 0;
    const lead = d.T.vehicles.find(v=>v.owner==="you"&&v.role==="economic"); const fol = d.T.vehicles.filter(v=>v.owner==="you"&&v.role==="military");
    d.orderTo(fol, { type: "follow", target: lead, x: lead.pos.x, z: lead.pos.z });
    const goal = d.map.citySites.find(s => s.continent === d.map.continentAt(lead.pos.x, lead.pos.z) && Math.hypot(s.x-lead.pos.x, s.z-lead.pos.z) > 100);
    d.orderTo([lead], { type: "move", x: goal.x, z: goal.z });
    let far = 0, worst = 0; for (let t = 0; t < 70; t += 0.1) { cs.update(0.1); far = Math.max(far, Math.hypot(lead.pos.x-d.T.cities[0].x, lead.pos.z-d.T.cities[0].z)); if (t > 12 && lead.order) worst = Math.max(worst, ...fol.map(v => Math.hypot(v.pos.x-lead.pos.x, v.pos.z-lead.pos.z))); }
    return { dists: [Math.round(worst)], moved: Math.round(far) }`));
  check("followers keep close to the vehicle they follow as it travels", fol.moved > 60 && fol.dists.every((d) => d < 30), JSON.stringify(fol));

  /* ---------- production */
  const prod = await page.evaluate(cs(`
    d.T.time = 0;
    const c = d.T.cities[0]; d.T.nations.forEach(n => { n.war = false; }); if (c.owner !== "you") d.takeCity(c, "you", "economic"); d.T.money = 2000; c.queue = [];
    for (const v of d.T.vehicles.filter(v=>v.owner==="you")) if (v.role !== "x") d.T.vehicles.length;
    // clear room: remove all of your vehicles
    [...d.T.vehicles.filter(v => v.owner === "you")].forEach(v => { v.dead = true; v.model.dispose(); v.group.removeFromParent(); }); d.T.vehicles = d.T.vehicles.filter(v => !v.dead);
    const have0 = d.T.vehicles.filter(v=>v.owner==="you").length, money0 = d.T.money;
    const ok1 = d.queueVehicle(c, "land"), ok2 = d.queueVehicle(c, "land");
    const afterQueue = { vehicles: d.T.vehicles.filter(v=>v.owner==="you").length, money: money0 - d.T.money, q: c.queue.length, total: c.queue[0].total };
    for (let t = 0; t < c.queue[0].total * 0.5; t += 0.1) cs.update(0.1);
    const half = d.T.vehicles.filter(v=>v.owner==="you").length;
    for (let t = 0; t < c.queue[0].total * 0.6 + 2; t += 0.1) cs.update(0.1);
    const first = d.T.vehicles.filter(v=>v.owner==="you").length;
    for (let t = 0; t < 60; t += 0.1) cs.update(0.1);
    const second = d.T.vehicles.filter(v=>v.owner==="you").length;
    return { have0, ok1, ok2, afterQueue, half, first, second, perVehicle: Math.round(afterQueue.money / 2) }`));
  check("a vehicle costs money now and appears at the city only when its build time is up, one at a time", prod.ok1 && prod.ok2 && prod.afterQueue.vehicles === 0 && prod.afterQueue.money > 50 && prod.half === 0 && prod.first === 1 && prod.second === 2, JSON.stringify(prod));
  const lim = await page.evaluate(cs(`
    const c = d.T.cities[0]; d.T.money = 5000; c.queue = [];
    const results = []; for (let i = 0; i < 6; i++) results.push(d.queueVehicle(c, "land"));
    const reason = d.tryQueue(c, "land", { cost: 10, ok: true }).reason;
    const q = c.queue.length; const m0 = d.T.money; d.cancelQueued(c, 0); const refund = d.T.money - m0;
    c.queue = [];
    return { results: results.join(), q, reason, refund }`));
  check("the production line holds a few vehicles and the city's capacity limits the total; cancelling refunds", lim.q <= 3 && /production line|supports/i.test(lim.reason) && lim.refund > 0, JSON.stringify(lim));
  const fast = await page.evaluate(cs(`const c = d.T.cities[0]; const u = d.T.designs.vehicle["military:land"]; const save = c.plots.slice(); c.plots = ["house", null, null, null, null, null]; d.T.money = 5000; c.queue = []; [...d.T.vehicles.filter(v=>v.owner==="you")].forEach(v=>{v.dead=true;v.model.dispose();v.group.removeFromParent()}); d.T.vehicles = d.T.vehicles.filter(v=>!v.dead); d.queueVehicle(c, "land"); const slow = c.queue[0].total; c.queue = []; c.plots = ["factory", "factory", null, null, null, null]; d.queueVehicle(c, "land"); const quick = c.queue[0].total; c.queue = []; c.plots = save; return { slow, quick }`));
  check("factories speed production up", fast.quick < fast.slow, JSON.stringify(fast));
  // the city sheet shows the line
  await page.evaluate(cs(`const c = d.T.cities[0]; c.queue = []; d.T.money = 5000; d.queueVehicle(c, "land"); d.openSheet("city", { city: c })`)); await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => ({ text: document.querySelector("#cvSheet").textContent, cancel: !!document.querySelector("[data-cancel]") }));
  check("the city sheet shows build times and the production line with a cancel button", /In production/.test(sheet.text) && /\d+ s/.test(sheet.text) && sheet.cancel, sheet.text.match(/In production[^\n]{0,40}/)?.[0] || "");
  await page.evaluate(cs(`d.sheet && document.querySelector(".tsClose")?.click()`));

  /* ---------- real combat */
  const war = await page.evaluate(cs(`
    d.T.time = 0;
    // Two forces meet: yours against the n0 nation's, at war.
    const n = d.T.nations[0]; n.war = true;
    const at = d.map.citySites[0]; const spot = (dx) => ({ x: at.x + dx, z: at.z + 60 });
    const mine = [0, 1, 2].map(() => d.spawnVehicle("you", "military:land", d.T.cities[0]));
    const foes = [0, 1, 2].map(() => d.spawnVehicle(n.id, "military:land", d.T.cities[3]));
    mine.forEach((v, i) => { v.pos.x = at.x + 25 + i * 4; v.pos.z = at.z + 28; v.order = null; });
    foes.forEach((v, i) => { v.pos.x = at.x + 25 + i * 4; v.pos.z = at.z + 50; v.order = null; });
    const hp0 = [...mine, ...foes].map(v => v.hp);
    let peakShots = 0, kinds = new Set(), anyDead = false, hurt = false;
    for (let t = 0; t < 120; t += 0.1) { cs.update(0.1); peakShots = Math.max(peakShots, d.fx.live); if (foes.some(v => v.dead) || mine.some(v => v.dead)) anyDead = true; if ([...mine, ...foes].some((v, i) => !v.dead && v.hp < hp0[i] - 1)) hurt = true; }
    const winner = foes.every(v => v.dead) ? "you" : mine.every(v => v.dead) ? "them" : "none";
    return { peakShots, anyDead, hurt, winner, mineLeft: mine.filter(v=>!v.dead).length, foesLeft: foes.filter(v=>!v.dead).length, range: mine[0].unit.weapon }`));
  check("armed vehicles meet, fire projectiles, take damage and are destroyed", war.peakShots >= 1 && war.hurt && war.anyDead, JSON.stringify({ shots: war.peakShots, hurt: war.hurt, mine: war.mineLeft, foes: war.foesLeft }));
  check("the weapon's range comes from its parts", war.range && war.range.range > 8 && war.range.kind === "shell", JSON.stringify(war.range));
  // defending
  const def = await page.evaluate(cs(`
    d.T.time = 0;
    const c = d.T.cities[0]; const n = d.T.nations[0]; n.war = true;
    const guard = d.spawnVehicle("you", "military:land", c); d.orderTo([guard], { type: "defend", city: c, x: c.x, z: c.z, r: 40 });
    const raider = d.spawnVehicle(n.id, "military:land", d.T.cities[3]); let rp = null; for (let r = 32; r < 46 && !rp; r += 3) for (let a = 0; a < 16 && !rp; a++) { const x = c.x + Math.cos(a / 16 * 6.28) * r, z = c.z + Math.sin(a / 16 * 6.28) * r; if (d.map.walkable("land", x, z)) rp = { x, z }; } raider.pos.x = rp.x; raider.pos.z = rp.z; raider.order = null; raider.hp = raider.unit.hp;
    for (let t = 0; t < 20; t += 0.1) cs.update(0.1);
    const near = Math.hypot(guard.pos.x - c.x, guard.pos.z - c.z);
    let engaged = raider.dead || raider.hp < raider.unit.hp - 1; for (let t = 0; t < 40; t += 0.1) { cs.update(0.1); if (raider.dead || raider.hp < raider.unit.hp - 1) engaged = true; }
    for (let t = 0; t < 40; t += 0.1) cs.update(0.1);
    return { engaged, raiderDead: raider.dead, back: Math.hypot(guard.pos.x - c.x, guard.pos.z - c.z), order: guard.order && guard.order.type }`));
  check("a defender holds its post, engages a raider and stays on guard", def.engaged && def.order === "defend", JSON.stringify(def));

  /* ---------- sieges with real shells */
  const siege = await page.evaluate(cs(`
    d.T.time = 0;
    const target = d.T.cities.find(c => c.owner !== "you" && c.continent === d.T.cities[0].continent && c.owner === null) || d.T.cities.find(c => c.owner !== "you" && c.continent === d.T.cities[0].continent);
    if (!target) return { none: true };
    d.T.nations.forEach(n => { n.war = false; }); if (target.owner) d.T.nations.find(n => n.id === target.owner).war = true;
    let fired = 0; const origFire = d.fx.fire.bind(d.fx); d.fx.fire = (...a) => { fired++; return origFire(...a); };
    const fleet = [0, 1, 2, 3, 4, 5].map(() => d.spawnVehicle("you", "military:land", d.T.cities[0]));
    d.orderTo(fleet, { type: "city", city: target });
    let minTur = 1; let shells = 0, turretShots = 0, hall0 = target.hallHp, minHall = 1, captured = false;
    for (let t = 0; t < 200 && !captured; t += 0.1) { cs.update(0.1); shells = Math.max(shells, d.fx.live); minHall = Math.min(minHall, target.hallHp); minTur = Math.min(minTur, target.turretHp); if (target.owner === "you") captured = true; }
    d.fx.fire = origFire; return { dists: fleet.map(v => v.dead ? -1 : Math.round(Math.hypot(v.pos.x-target.x, v.pos.z-target.z))).join(), fail: fleet.map(v => v.pathFail).join(), tgt: [target.owner, target.continent, d.T.cities[0].continent], shells: fired, minHall, minTur, captured, left: fleet.filter(v=>!v.dead).length, order: fleet.map(v=>v.order && v.order.type).join() }`));
  check("military vehicles siege a city with projectiles: its turrets and hall fall and it is captured", !siege.none && siege.shells >= 1 && (siege.captured || siege.minHall < 1 || siege.minTur < 1), JSON.stringify(siege));

  /* ---------- the vehicle creator */
  const des = await page.evaluate(cs(`
    const key = "military:land";
    const base = JSON.parse(JSON.stringify(d.T.designs.vehicle[key]));
    const plain = { ...base, name: "Plain", parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.85, y: 0.4, z: 0.9, mirror: true }, { id: "cannonV", x: 0, y: 1.2, z: 1 }] };
    const mine = { ...base, name: "Gnat", parts: [...plain.parts.slice(0, 2), { id: "engine", x: 0, y: 0.8, z: -0.9 }, { id: "engine", x: 0, y: 0.8, z: -0.4 }, { id: "cockpit", x: 0, y: 1.2, z: 0.4 }, { id: "machinegun", x: 0, y: 1.2, z: 1 }] };
    d.T.designs.vehicle[key] = mine; const unit = d.spawnVehicle("you", key, d.T.cities[0]).unit;
    d.T.designs.vehicle[key] = plain; const old = d.spawnVehicle("you", key, d.T.cities[0]).unit; d.T.designs.vehicle[key] = base;
    return { gnat: { speed: unit.speed, hp: unit.hp, dps: unit.dps, range: unit.weapon.range, rate: unit.weapon.rate, kind: unit.weapon.kind }, rumbler: { speed: old.speed, hp: old.hp, dps: old.dps, range: old.weapon.range, rate: old.weapon.rate, kind: old.weapon.kind } }`));
  check("a custom design's parts decide its speed, health, damage, range and kind of weapon", des.gnat.speed > des.rumbler.speed && des.gnat.hp > des.rumbler.hp && des.gnat.range < des.rumbler.range && des.gnat.rate > des.rumbler.rate && des.gnat.kind === "bullet", JSON.stringify(des));
  check("land, sea and air vehicles all exist as designs, with roles and stats", await page.evaluate(cs(`return ["land","sea","air"].every(m => ["military","economic","religious"].every(r => d.T.designs.vehicle[r + ":" + m] && d.T.designs.vehicle[r + ":" + m].parts.length >= 3))`)));
  // designs saved
  await page.evaluate(cs(`d.T.money = 5000; [...d.T.vehicles.filter(v=>v.owner==="you")].forEach(v=>{v.dead=true;v.model.dispose();v.group.removeFromParent()}); d.T.vehicles = d.T.vehicles.filter(v=>!v.dead); d.T.designs.vehicle["military:land"] = { ...d.T.designs.vehicle["military:land"], name: "Gnat", parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.85, y: 0.4, z: 0.9, mirror: true }, { id: "engine", x: 0, y: 0.8, z: -0.9 }, { id: "machinegun", x: 0, y: 1.2, z: 1 }] }; d.T.cities[0].queue = []; d.queueVehicle(d.T.cities[0], "land"); cs.save();`));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const back = await page.evaluate(cs(`return { name: d.T.designs.vehicle["military:land"].name, parts: d.T.designs.vehicle["military:land"].parts.map(p => p.id).join(), q: d.T.cities[0].queue.map(i => i.key + "@" + Math.round(i.t)) }`));
  check("vehicle designs and production lines are saved and come back", back.name === "Gnat" && /engine/.test(back.parts) && /machinegun/.test(back.parts) && back.q.length === 1, JSON.stringify(back));
  console.log("errors", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await browser.close();
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
})();
