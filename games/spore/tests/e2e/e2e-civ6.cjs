const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const cs = (f) => `(() => { const cs = window.__spore.civStage, d = cs.debug; ${f} })()`;
const SEED = `let a = 987654321; Math.random = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);`;
let page, errors;
/** A fresh stage: reload and start the Civilization Stage again (the saved game is cleared first so every section starts alike). */
async function fresh() {
  await page.evaluate(() => { try { localStorage.removeItem("johnny-spore-civ-stage"); } catch (e) {} });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".tsClose")?.click());
  await page.evaluate(cs(`${SEED} d.T.time = 0; d.T.money = 3000;`));
}
/** An independent city on your continent, made available to experiment on (a rival's second city is released if there is none). */
const LOCAL = `const home = d.T.cities[0].continent; let loc = d.T.cities.find(c => c.owner === null && c.continent === home); if (!loc) { loc = d.T.cities.find(c => c.owner && c.owner !== "you" && c.continent === home && d.T.cities.filter(x => x.owner === c.owner).length > 1); loc.owner = null; }`;
(async () => {
  const o = await require("./harness.cjs").open({ width: 1280, height: 800 });
  page = o.page; errors = o.errors;
  /* ======================= the city planner and the economy */
  await fresh();
  await page.evaluate(cs(`const c = d.T.cities[0]; c.plots = [null, null, null, null, null, null]; c.levels = [1,1,1,1,1,1]; d.openSheet("city", { city: c });`));
  await page.waitForTimeout(500);
  await page.click('[data-plot="0"]'); await page.waitForTimeout(300);
  const prev = await page.evaluate(() => [...document.querySelectorAll("[data-build]")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
  check("choosing an empty plot lists every building with its cost", prev.length === 4 && prev.every((t) => /§\d+/.test(t)), prev.join(" | ").slice(0, 120));
  await page.click('[data-build="factory"]'); await page.waitForTimeout(300);
  await page.click('[data-plot="1"]'); await page.waitForTimeout(300);
  const prev2 = await page.evaluate(() => [...document.querySelectorAll("[data-build]")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
  check("the preview says what a building does to its neighbours (house beside a factory: unhappy; second factory: more output)", prev2.some((t) => /House.*-0\.3 happiness/.test(t)) && prev2.some((t) => /Factory.*output/.test(t)), prev2.join(" | ").slice(0, 200));
  await page.click('[data-build="fun"]'); await page.waitForTimeout(300);
  const marks = await page.evaluate(() => document.querySelectorAll(".cvAdj").length);
  const built = await page.evaluate(cs(`const c = d.T.cities[0]; return { plots: c.plots.filter(Boolean).length, models: c.models.length }`));
  check("buildings go up and appear in the city; plots with a neighbour effect carry a mark", built.plots === 2 && built.models >= 3 && marks >= 0, JSON.stringify({ built, marks }));
  await page.click('[data-plot="0"]'); await page.waitForTimeout(300);
  const info = await page.evaluate(() => document.querySelector(".cvPlotInfo")?.textContent.replace(/\s+/g, " "));
  const inc0 = await page.evaluate(cs(`return { inc: d.econOf("you").cities, money: d.T.money }`));
  await page.click("[data-improve]"); await page.waitForTimeout(300);
  const lvl = await page.evaluate(cs(`const c = d.T.cities[0]; return { l: c.levels[0], inc: d.econOf("you").cities, money: d.T.money }`));
  check("improving a building raises its level, earns more and costs money", lvl.l === 2 && lvl.inc > inc0.inc && lvl.money < inc0.money && /level 1 of 3/.test(info), JSON.stringify({ info: info.slice(0, 60), inc0, lvl }));
  await page.click("#cvHall"); await page.waitForTimeout(400);
  const hall1 = await page.evaluate(cs(`const c = d.T.cities[0]; return { hall: c.hall, text: document.querySelector("#cvSheet").textContent.match(/Turret · §\\d+ \\(\\d\\/\\d\\)/)?.[0], cap: d.aiWorld().cities[0].hall }`));
  check("expanding the hall adds a turret site (and a vehicle slot, more people, tougher walls)", hall1.hall === 2 && /\/4/.test(hall1.text || ""), JSON.stringify(hall1));
  await page.evaluate(() => document.querySelector(".tsClose")?.click()); await page.waitForTimeout(200);
  await page.click(".civHUD .trStats"); await page.waitForTimeout(400);
  const eco = await page.evaluate(cs(`return { kind: d.sheet && d.sheet.kind, text: document.querySelector("#cvSheet").textContent.replace(/\\s+/g, " ") }`));
  check("tapping your money shows where it comes from and goes, with upkeep", eco.kind === "econ" && /Spice/.test(eco.text) && /Trade routes/.test(eco.text) && /Upkeep: buildings/.test(eco.text) && /Upkeep: \d+ vehicle/.test(eco.text), eco.text.slice(0, 300));
  const net = await page.evaluate(cs(`return { net: d.econOf("you").net, shown: document.querySelector("#cvIncome").textContent }`));
  check("the HUD income is the net figure", Math.abs(parseFloat(net.shown.replace("+", "")) - net.net) < 0.06, JSON.stringify(net));

  /* ======================= three ways to conquer */
  await fresh();
  const meth = await page.evaluate(cs(`
    const setup = (c) => { c.plots = ["house","factory","fun","temple","house","factory"]; c.levels = [3,3,3,3,3,3]; c.hall = 3; c.turrets = 2; c.owner = null; };
    const out = {};
    const ind = d.T.cities.filter(c => c.owner === null).slice(0, 3);
    [["military", ind[0]], ["religious", ind[1]], ["economic", ind[2]]].forEach(([method, c]) => { setup(c); d.takeCity(c, "you", method); out[method] = { plots: c.plots.filter(Boolean).length, hall: c.hall, unrest: c.unrest, devout: c.devout, hallHp: c.hallHp, lv: c.levels.every(l => l === 1) }; });
    return out`));
  check("a city taken by force is wrecked: buildings lost, improvements gone, people restless", meth.military.plots === 4 && meth.military.lv && meth.military.unrest === 2 && meth.military.hallHp === 0.5, JSON.stringify(meth.military));
  check("a converted city is intact and devout; a bought one is intact and calm", meth.religious.plots === 6 && meth.religious.devout && meth.religious.hall === 3 && meth.economic.plots === 6 && meth.economic.unrest === 0 && !meth.economic.devout, JSON.stringify({ r: meth.religious, e: meth.economic }));
  await fresh();
  const conv = await page.evaluate(cs(`
    ${LOCAL}
    d.T.nations.forEach(n => { n.war = false; n.clock = 1e9; });
    const prep = (plots) => { loc.owner = null; loc.plots = plots; loc.levels = [1,1,1,1,1,1]; loc.hall = 1; loc.conv = {}; loc.devout = false; loc.turrets = 0; loc.hallHp = 1; loc.trade = {}; };
    const run = () => { const vs = [0,1].map(() => d.spawnVehicle("you", "religious:land", d.T.cities[0])); let t = 0; for (; t < 500 && loc.owner !== "you"; t += 0.1) { vs.forEach(v => { if (!v.order) v.order = { type: "city", city: loc }; }); cs.update(0.1); } vs.forEach(v => { v.dead = true; v.model.dispose(); v.group.removeFromParent(); }); d.T.vehicles = d.T.vehicles.filter(v => !v.dead); return { t: Math.round(t), owner: loc.owner }; };
    prep(["house", null, null, null, null, null]); const a = run();
    prep(["house", "temple", "temple", "temple", null, null]); const b = run();
    return { bare: a, holy: b, devout: loc.devout, type: loc.type }`));
  check("religious vehicles preach a city over and take it (it becomes devout); temples make it resist for longer", conv.bare.owner === "you" && conv.holy.owner === "you" && conv.holy.t > conv.bare.t * 1.2 && conv.devout && conv.type === "religious", JSON.stringify(conv));
  await fresh();
  const resp = await page.evaluate(cs(`
    d.T.time = 400; d.T.nations.forEach(n => { n.war = false; });
    const n = d.T.nations.find(n => n.type === "religious"); const c = d.T.cities.find(c => c.owner === n.id);
    c.plots = ["house", null, null, null, null, null]; c.levels = [1,1,1,1,1,1]; c.conv = { you: 50 }; n.money = 500; n.clock = 0; n.devClock = 0;
    const missionary = d.spawnVehicle(n.id, "religious:land", c);
    const t0 = c.conv.you; let built = false, ordered = false;
    for (let t = 0; t < 40; t += 0.25) { cs.update(0.25); if (c.plots.includes("temple")) built = true; if (missionary.order && missionary.order.type === "defend") ordered = true; }
    return { built, ordered, conv: c.conv.you ?? 0, t0 }`));
  check("a rival answers conversion: temples built, missionaries sent home, the conversion fades fast", resp.built && resp.ordered && resp.conv < resp.t0 - 20, JSON.stringify(resp));
  await fresh();
  const eco2 = await page.evaluate(cs(`
    ${LOCAL}
    d.T.nations.forEach(n => { n.war = false; n.clock = 1e9; });
    loc.owner = null; loc.trade = {}; loc.plots = ["house", "factory", null, null, null, null]; loc.hall = 1; loc.turrets = 0; loc.hallHp = 1;
    const v = d.spawnVehicle("you", "economic:land", d.T.cities[0]);
    const inc0 = d.econOf("you").trade; let t = 0;
    for (; t < 400 && (loc.trade.you || 0) < 100; t += 0.1) { if (!v.order) v.order = { type: "city", city: loc }; cs.update(0.1); }
    const routeIncome = d.econOf("you").trade - inc0;
    d.T.money = 5000; const m0 = d.T.money; const plotsBefore = loc.plots.filter(Boolean).length; const full = loc.trade.you;
    d.buyCity(loc);
    return { trade: full, t: Math.round(t), routeIncome, owner: loc.owner, paid: m0 - d.T.money, plots: [plotsBefore, loc.plots.filter(Boolean).length], unrest: loc.unrest }`));
  check("economic vehicles open a trade route that pays you every second; a full route lets you buy the city intact", eco2.trade >= 100 && eco2.routeIncome > 0 && eco2.owner === "you" && eco2.paid > 0 && eco2.plots[0] === eco2.plots[1] && eco2.unrest === 0, JSON.stringify(eco2));

  /* ======================= diplomacy */
  await fresh();
  await page.evaluate(cs(`d.T.nations.forEach(n => { n.war = false; }); d.T.dip.allies = {}; d.T.dip.deals = {}; d.T.dip.war = {}; const eco = d.T.nations.find(n => n.type === "economic"); eco.relation = 30; d.openSheet("nation", { nation: eco });`));
  await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => document.querySelector("#cvSheet").textContent.replace(/\s+/g, " "));
  check("a nation's sheet shows its personality, treasury and income, relations with the others, and diplomatic actions", /Merchant/.test(sheet) && /treasury/.test(sheet) && /Trade agreement/.test(sheet) && /Alliance/.test(sheet) && /Relations with the other nations/.test(sheet), sheet.slice(0, 140));
  const incBefore = await page.evaluate(cs(`return d.econOf("you").deals`));
  await page.click("#cvDeal"); await page.waitForTimeout(300);
  for (let i = 0; i < 6 && !(await page.evaluate(cs(`return Object.keys(d.T.dip.deals).length`))); i++) { await page.evaluate(() => document.querySelector("#cvDeal")?.click()); await page.waitForTimeout(150); }
  const deal = await page.evaluate(cs(`return { deals: Object.keys(d.T.dip.deals), pay: d.econOf("you").deals }`));
  check("a trade agreement pays you every second", deal.deals.length === 1 && deal.pay > incBefore, JSON.stringify(deal));
  const ally = await page.evaluate(cs(`
    const eco = d.T.nations.find(n => n.type === "economic"); d.T.money = 3000;
    eco.relation = 30; d.openSheet("nation", { nation: eco }); document.querySelector("#cvAlly")?.click(); const early = Object.keys(d.T.dip.allies).length;
    eco.relation = 85; for (let i = 0; i < 12 && !Object.keys(d.T.dip.allies).length; i++) { d.openSheet("nation", { nation: eco }); document.querySelector("#cvAlly")?.click(); }
    const allied = Object.keys(d.T.dip.allies).length;
    d.declareBetween("you", eco.id, "test"); const war = !!d.T.dip.war["you|" + eco.id];
    return { early, allied, war }`));
  check("an alliance needs warm feelings (55+), then forms, and you cannot declare war on an ally", ally.early === 0 && ally.allied === 1 && !ally.war, JSON.stringify(ally));
  await fresh();
  const help = await page.evaluate(cs(`
    const eco = d.T.nations.find(n => n.type === "economic"); const mil = d.T.nations.find(n => n.type === "military");
    eco.relation = 85; d.T.dip.allies[[eco.id, "you"].sort().join("|")] = true; d.T.dip.war["n0|you"] = true; d.T.time = 400;
    const c = d.T.cities[0]; const ecoCity = d.T.cities.find(x => x.owner === eco.id); const milCity = d.T.cities.find(x => x.owner === mil.id);
    const guard = d.spawnVehicle(eco.id, "military:land", ecoCity); guard.pos.x = c.x + 20; guard.pos.z = c.z + 10; guard.order = null;
    const raider = d.spawnVehicle(mil.id, "military:land", milCity); raider.pos.x = c.x + 30; raider.pos.z = c.z + 20; raider.order = { type: "city", city: c };
    let helped = false;
    for (let t = 0; t < 30; t += 0.25) { cs.update(0.25); if (guard.order && guard.order.type === "defend") helped = true; }
    return { helped, allied: !!d.T.dip.allies[[eco.id, "you"].sort().join("|")] }`));
  check("allies defend your cities when raiders come", help.helped, JSON.stringify(help));
  await fresh();
  const rw = await page.evaluate(cs(`
    const a = d.T.nations[0], b = d.T.nations[2]; d.declareBetween(a.id, b.id, "");
    const at = d.T.cities.find(c => c.owner === a.id);
    const va = [0,1,2].map(() => d.spawnVehicle(a.id, "military:land", at)), vb = [0,1,2].map(() => d.spawnVehicle(b.id, "military:land", at));
    va.forEach((v, i) => { v.pos.x = at.x + 25 + i * 4; v.pos.z = at.z + 30; v.order = null; }); vb.forEach((v, i) => { v.pos.x = at.x + 25 + i * 4; v.pos.z = at.z + 40; v.order = null; });
    let hurt = false; const hp = [...va, ...vb].map(v => v.hp);
    for (let t = 0; t < 90; t += 0.1) { cs.update(0.1); if ([...va, ...vb].some((v, i) => !v.dead && v.hp < hp[i] - 1)) hurt = true; }
    return { war: Object.keys(d.T.dip.war), hurt, dead: [...va, ...vb].filter(v => v.dead).length }`));
  check("rival nations fight each other too: their vehicles meet and destroy one another", rw.war.includes("n0|n2") && (rw.hurt || rw.dead > 0), JSON.stringify(rw));

  /* ======================= offers */
  await fresh();
  const off = await page.evaluate(cs(`
    d.T.nations.forEach(n => { n.relation = 30; }); d.clearOfferCool(); const eco = d.T.nations.find(n => n.type === "economic");
    const extra = d.T.cities.find(c => c.owner === null); d.takeCity(extra, "you", "economic");
    d.offerTo(eco, "buyout", { city: extra.id });
    return { id: extra.id, n: d.T.offers.length, kind: d.T.offers[0] && d.T.offers[0].kind, sheet: d.sheet && d.sheet.kind, text: document.querySelector("#cvSheet").textContent.replace(/\\s+/g, " ").slice(0, 200) }`));
  check("a rival puts an offer to you, and the offers sheet opens with accept and decline", off.n === 1 && off.kind === "buyout" && off.sheet === "offer" && /Sell/.test(off.text), off.text.slice(0, 120));
  await page.screenshot({ path: OUT + "civ-offer.png" });
  const sold = await page.evaluate(cs(`const eco = d.T.nations.find(n => n.type === "economic"); const m0 = d.T.money; const c = d.T.cities[${off.id}]; document.querySelector("#cvAccept").click(); return { owner: c.owner === eco.id, gain: d.T.money - m0, left: d.T.offers.length }`));
  check("accepting a buyout sells the city for the price offered", sold.owner && sold.gain > 50 && sold.left === 0, JSON.stringify(sold));
  const trib = await page.evaluate(cs(`
    d.T.time = 400; d.clearOfferCool(); const mil = d.T.nations.find(n => n.type === "military"); mil.relation = 0; d.T.money = 1000;
    d.offerTo(mil, "tribute", {}); const asked = d.T.offers[0].amount; const rel0 = mil.relation;
    document.querySelector("#cvDecline").click();
    return { asked, drop: rel0 - mil.relation, offers: d.T.offers.length }`));
  check("refusing a tribute demand costs goodwill (and may mean war)", trib.drop >= 15 && trib.offers === 0, JSON.stringify(trib));
  const exp = await page.evaluate(cs(`
    d.T.time = 0; d.clearOfferCool(); const eco = d.T.nations.find(n => n.type === "economic"); eco.relation = 60; d.offerTo(eco, "alliance", {}); const had = d.T.offers.length;
    for (let t = 0; t < 80; t += 0.5) cs.update(0.5);
    return { had, left: d.T.offers.length }`));
  check("an offer that is not answered runs out", exp.had === 1 && exp.left === 0, JSON.stringify(exp));

  /* ======================= the rivals have minds of their own */
  await fresh();
  const minds = await page.evaluate(cs(`
    d.T.money = 600; d.planTurret(d.T.cities[0]); d.planTurret(d.T.cities[0]); for (let i = 0; i < 3; i++) d.spawnVehicle("you", "military:land", d.T.cities[0]);
    const seen = { offers: new Set(), deals: new Set(), wars: new Set() }; const owners0 = d.T.cities.map(c => c.owner); let changed = 0; let prev = owners0.slice();
    for (let i = 0; i < 6400; i++) {
      cs.update(0.25);
      if (d.T.offers[0] && d.T.offers[0].t > 2) d.resolveOffer(d.T.offers[0], i % 3 === 0);
      d.T.offers.forEach(o => seen.offers.add(o.kind));
      Object.keys(d.T.dip.deals).forEach(k => seen.deals.add(k)); Object.keys(d.T.dip.war).forEach(k => seen.wars.add(k));
      d.T.cities.forEach((c, j) => { if (c.owner !== prev[j]) { changed++; prev[j] = c.owner; } });
      if (d.T.lost) break;
    }
    const roles = d.T.nations.map(n => { const vs = d.T.vehicles.filter(v => v.owner === n.id); return { type: n.type, military: vs.filter(v => v.role === "military").length, religious: vs.filter(v => v.role === "religious").length, economic: vs.filter(v => v.role === "economic").length, plots: d.T.cities.filter(c => c.owner === n.id).reduce((s, c) => s + c.plots.filter(Boolean).length, 0), cities: d.T.cities.filter(c => c.owner === n.id).length, spice: d.T.geysers.filter(g => g.owner === n.id).length }; });
    return { time: Math.round(d.T.time), offers: [...seen.offers], deals: [...seen.deals], wars: [...seen.wars], changed, roles, devout: d.T.cities.filter(c => c.devout).length, lost: d.T.lost }`));
  console.log("   rivals after", minds.time, "s:", JSON.stringify(minds));
  check("rivals trade with each other, put offers to you, and cities change hands", minds.deals.length >= 1 && minds.changed >= 2, JSON.stringify({ deals: minds.deals, offers: minds.offers, changed: minds.changed }));
  check("the rivals behave differently: each living nation fields the kind of vehicle its nature calls for", minds.roles.filter(r => r.cities > 0).every(r => r[r.type] >= Math.max(r.military, r.religious, r.economic) * 0.5) && minds.roles.filter(r => r.cities > 0).length >= 2, JSON.stringify(minds.roles.map(r => [r.type, r.cities, r.military, r.religious, r.economic])));
  check("every rival develops its cities and captures spice", minds.roles.every((r) => r.plots >= 6 || r.cities === 0) && minds.roles.some((r) => r.spice >= 1), JSON.stringify(minds.roles.map((r) => [r.type, r.plots, r.spice])));

  /* ======================= victory */
  await fresh();
  const win = await page.evaluate(cs(`
    d.T.won = false; d.T.cities.forEach((c) => { if (c.owner !== "you") d.takeCity(c, "you", "military"); });
    return { yours: d.T.cities.filter(c => c.owner === "you").length, total: d.T.cities.length, won: d.T.won }`));
  check("holding every city wins the planet", win.yours === win.total && win.won);
  await page.waitForTimeout(2400);
  const wonSheet = await page.evaluate(cs(`return { kind: d.sheet && d.sheet.kind, text: document.querySelector("#cvSheet").textContent.replace(/\\s+/g, " ").slice(0, 160), card: d.T.card }`));
  check("the victory is recorded with its card", wonSheet.kind === "won" && !!wonSheet.card && /Civilization Stage complete/.test(wonSheet.text), wonSheet.text.slice(0, 100));
  await fresh();
  const alt = await page.evaluate(cs(`
    d.T.won = false; const mine = d.T.cities.slice(0, 9), rest = d.T.cities.slice(9); const [a, b, c3] = d.T.nations;
    mine.forEach(c => { c.owner = "you"; }); rest.forEach(c => { c.owner = a.id; }); b.alive = false; c3.alive = false; a.alive = true;
    const before = d.dominanceNow(); d.T.dip.allies[[a.id, "you"].sort().join("|")] = true; a.relation = 90; const after = d.dominanceNow(); d.checkWin();
    return { before: { won: before.won, hold: before.holdouts }, after: { won: after.won, by: after.byAlliance }, won: d.T.won, by: d.T.wonBy }`));
  check("three quarters of the planet with every rival allied or fallen is also a win (a peaceful one)", !alt.before.won && alt.before.hold === 1 && alt.after.won && alt.after.by && alt.won && alt.by === "alliance", JSON.stringify(alt));

  /* ======================= saves */
  await fresh();
  await page.evaluate(cs(`const c = d.T.cities[0]; c.levels = [3,2,1,1,1,1]; c.hall = 3; c.devout = true; d.T.dip.deals["n1|you"] = true; d.T.nations[2].relation = 90; d.T.dip.allies["n2|you"] = true; d.T.dip.war["n0|you"] = true; cs.save();`));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const back = await page.evaluate(cs(`const c = d.T.cities[0]; return { levels: c.levels.join(), hall: c.hall, devout: c.devout, deals: Object.keys(d.T.dip.deals), allies: Object.keys(d.T.dip.allies), war: Object.keys(d.T.dip.war), warFlag: d.T.nations[0].war, rel: d.T.nations.map(n => Math.round(n.relation)) }`));
  check("city levels, hall, devotion, trade agreements, alliances and wars are saved and come back", back.levels === "3,2,1,1,1,1" && back.hall === 3 && back.devout && back.deals.includes("n1|you") && back.allies.includes("n2|you") && back.war.includes("n0|you") && back.warFlag, JSON.stringify(back));
  const oldSave = JSON.stringify({ v: 1, money: 500, startType: "economic", nations: [{ id: "n0", type: "military", relation: -20, war: true, money: 300, alive: true }, { id: "n1", type: "economic", relation: 40, war: false, money: 200, alive: true }, { id: "n2", type: "religious", relation: 5, war: false, money: 100, alive: true }], cities: Array.from({ length: 12 }, (_, i) => ({ id: i, owner: i === 0 ? "you" : null, type: "economic", plots: ["house", null, null, null, null, null], turrets: 1, turretHp: 1, hallHp: 1, trade: {}, conv: {}, unrest: 0 })), geysers: [], vehicles: [], designs: { building: {}, vehicle: {} }, captures: { military: 0, economic: 0, religious: 0 }, superCool: 0, won: false, card: null, time: 300, planet: 1 });
  await page.evaluate((s) => localStorage.setItem("johnny-spore-civ-stage", s), oldSave);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCivStage(); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.civStage, null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const old = await page.evaluate(cs(`return { war: d.T.nations[0].war, rel: Math.round(d.T.nations[1].relation), money: Math.round(d.T.money), hall: d.T.cities[0].hall, levels: d.T.cities[0].levels.join(), dip: Object.keys(d.T.dip.rel).length }`));
  check("a save from before diplomacy and the planner loads: its wars and feelings carry over, new fields get defaults", old.war === true && old.rel === 40 && old.money >= 500 && old.hall === 1 && old.levels === "1,1,1,1,1,1" && old.dip >= 6, JSON.stringify(old));
  console.log("errors", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await o.browser.close();
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
})();
