const { open } = require("./harness.cjs");
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
(async () => {
  const { browser, page, errors } = await open({ width: 1100, height: 700 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(false, false); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceCancel");
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async () => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    P.invulnerable = 9999;
    const free = [...d.npcs].filter((x) => x.nest && !x.dead && !x.following && !x.epic && !x.rogue);
    const [a, b, e1, e2] = free;
    // Two packmates, two enemies hunting you.
    for (const m of [a, b]) { m.following = true; m.member && (m.member.friend = true); m.cool = 0; }
    P.pos.set(e1.pos.x - 5, 0, e1.pos.z);
    for (const m of [a, b]) m.pos.set(P.pos.x - 2 + (m === a ? 0 : 1), 0, P.pos.z - 2);
    for (const e of [e1, e2]) { e.nest.angry = 300; e.calm = 0; e.health = e.maxHealth; }
    e2.pos.set(e1.pos.x + 3, 0, e1.pos.z + 3);
    const hp0 = [e1.health, e2.health];
    let plans = new Set(), distinct = 0, slots = new Set(), ticks = 0, stuckSeen = 0;
    for (let i = 0; i < 90; i++) {
      P.invulnerable = 9999;
      const plan = d.packPlan();
      const pa = plan.get(a), pb = plan.get(b);
      if (pa && pb) { ticks++; plans.add(pa.foe === e1 ? "e1" : pa.foe === e2 ? "e2" : "?"); plans.add(pb.foe === e1 ? "e1" : pb.foe === e2 ? "e2" : "?"); if (pa.foe !== pb.foe) distinct++; slots.add(pa.slot + "/" + pa.slots); }
      await sleep(150);
    }
    return { ticks, targets: [...plans], distinct, slots: [...slots], enemyHpLost: [hp0[0] - e1.health, hp0[1] - e2.health], states: [a.cs, b.cs, e1.cs, e2.cs] };
  });
  console.log("   ", JSON.stringify(r));
  check("the pack has a plan when enemies hunt you", r.ticks > 10, r.ticks + " ticks");
  check("packmates spread over the threats (not all on one)", r.distinct > 0 || r.targets.length > 1, JSON.stringify(r.targets));
  check("the pack actually fights: enemies lose health to packmates", r.enemyHpLost[0] + r.enemyHpLost[1] > 0, JSON.stringify(r.enemyHpLost));
  // Left far behind, a follower recovers (stuck nudge / catch-up) rather than staying put.
  const lost = await page.evaluate(async () => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const m = [...d.npcs].find((x) => x.following && !x.dead);
    for (const n of d.npcs) if (n.nest && n !== m) { n.nest.angry = 0; n.hunting = false; }
    P.invulnerable = 9999;
    P.pos.set(m.pos.x + 45, 0, m.pos.z);
    const d0 = Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z);
    for (let i = 0; i < 100; i++) await sleep(200);
    return { d0, d1: Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z) };
  });
  check("a packmate left far behind catches up", lost.d1 < lost.d0 * 0.6, `${lost.d0.toFixed(0)} m → ${lost.d1.toFixed(0)} m`);
  console.log("errors", errors.slice(0, 3));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
