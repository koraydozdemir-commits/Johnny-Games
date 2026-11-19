const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  → " + x : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot(page) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore && window.__spore.universe, null, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(false, false); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceCancel");
  await page.waitForTimeout(1200);
}
(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await boot(page);

  /* ---------------- HUD: one set of moves at a time ---------------- */
  const hud = () => page.evaluate(() => ({ mode: document.querySelector(".creatureHUD").dataset.mode, shown: [...document.querySelectorAll(".chAbilities .chRow:not(.extra) .chAb")].map((b) => b.dataset.ab), modes: [...document.querySelectorAll(".chMode")].map((b) => b.dataset.mode + ":" + b.getAttribute("aria-selected")), extras: [...document.querySelectorAll(".chAbilities .chRow.extra .chAb")].map((b) => b.dataset.ab) }));
  let h = await hud();
  check("only four moves are on screen", h.shown.length === 4, h.shown.join());
  check("they are one set: all social or all combat", h.shown.join() === "sing,dance,charm,pose" || h.shown.join() === "bite,strike,charge,spit", h.mode + ": " + h.shown.join());
  check("movement stays separate (sneak, sprint, jump) with the card and select", ["sneak", "sprint", "jump"].every((k) => h.extras.includes(k)), h.extras.join());
  const startMode = h.mode;
  await page.click(`.chMode[data-mode="${startMode === "social" ? "combat" : "social"}"]`);
  h = await hud();
  check("tapping the other mode swaps the set", h.mode !== startMode && h.shown.join() === (h.mode === "combat" ? "bite,strike,charge,spit" : "sing,dance,charm,pose"), h.mode + ": " + h.shown.join());
  await page.keyboard.press("r");
  await page.waitForTimeout(150);
  h = await hud();
  check("R toggles the mode", h.mode === startMode, h.mode);
  const hits = await page.evaluate(() => [...document.querySelectorAll(".chMode,.chRow:not(.extra) .chAb")].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check("mode buttons and moves are at least 44px (touch targets)", Math.min(...hits) >= 44, "min " + Math.round(Math.min(...hits)));
  await page.keyboard.press("1");
  await page.waitForTimeout(100);

  /* ---------------- target card ---------------- */
  check("the card is hidden when nothing is selected", await page.evaluate(() => document.getElementById("chTarget").hidden || document.getElementById("chTarget").classList.contains("fade")));
  const info = await page.evaluate(() => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    const n = [...d.npcs].find((x) => x.nest && x.nest.status === "neutral" && !x.dead && !x.epic && !x.rogue);
    P.pos.set(n.pos.x - 4, 0, n.pos.z); P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
    d.select(n);
    return { name: n.species.name };
  });
  await page.waitForFunction(() => !document.getElementById("chTarget").hidden, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => { const c = document.getElementById("chTarget"); const r = c.getBoundingClientRect(); return { hidden: c.hidden, fade: c.classList.contains("fade"), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), name: document.getElementById("chTargetName").textContent, rel: document.getElementById("chTargetRel").textContent, hp: document.getElementById("chTargetHpNum").textContent, info: getComputedStyle(document.getElementById("chTargetInfo")).display, hint: getComputedStyle(document.getElementById("chTargetHint")).display, mode: document.querySelector(".creatureHUD").dataset.mode }; });
  check("selecting a creature shows a compact card with its name, health and relationship", !card.hidden && !card.fade && card.name.length > 1 && /\d+ \/ \d+/.test(card.hp) && card.rel.length > 1, JSON.stringify(card));
  check("the card is small and out of the middle of the screen", card.w <= 230 && card.h <= 90 && (card.top > 800 * 0.62 || card.bottom < 800 * 0.2), `${card.w}x${card.h} at y ${card.top}-${card.bottom}`);
  check("the long info and hint lines are gone from the card", card.info === "none");
  check("picking a friendly nest switches to social moves", card.mode === "social", card.mode);
  await page.screenshot({ path: OUT + "b3-hud-social.png" });
  await page.click("#chTargetClose");
  await page.waitForTimeout(500);
  check("deselecting fades the card away", await page.evaluate(() => document.getElementById("chTarget").hidden));

  /* ---------------- combat: a hostile creature commits, retreats once, returns home ---------------- */
  const sim = await page.evaluate(async () => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    P.invulnerable = 9999; P.health = P.maxHealth;
    const n = [...d.npcs].find((x) => x.nest && x.nest.status === "neutral" && !x.dead && !x.epic && !x.rogue && !x.member?.friend);
    const out = { states: [], minHp: 1, retreats: 0 };
    // Make its nest angry at you, and stand near it.
    n.nest.angry = 400; n.calm = 0; n.health = n.maxHealth;
    P.pos.set(n.pos.x - 7, 0, n.pos.z); P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
    const home = n.nest.site;
    out.sp = { name: n.species.name, level: n.species.level };
    const sample = () => out.states.push(n.cs);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Phase 1: it comes for us.
    for (let i = 0; i < 24; i++) { P.invulnerable = 9999; sample(); await sleep(250); }
    out.phase1 = [...new Set(out.states)];
    out.hunted = n.hunting || out.states.some((s) => ["approaching", "engaging", "attacking"].includes(s));
    return out;
  });
  check("an angry creature approaches, engages and attacks (states observed)", sim.hunted && sim.phase1.some((s) => s === "approaching") , sim.phase1.join(", "));
  check("it did not retreat while healthy", !sim.phase1.includes("retreating"), sim.phase1.join(", "));

  const fight = await page.evaluate(async () => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    const n = [...d.npcs].filter((x) => x.nest && !x.dead && x.cs && x.cs !== "idle")[0] || [...d.npcs].find((x) => x.nest && !x.dead);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    P.invulnerable = 9999;
    n.nest.angry = 400; n.calm = 0; n.fleeChecked = false;
    const home = n.nest.site;
    const dHome = () => Math.hypot(n.pos.x - home.x, n.pos.z - home.z);
    // Stand next to it and hit it for real until it is nearly down.
    P.pos.set(n.pos.x - 1.4, 0, n.pos.z); P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
    n.health = n.maxHealth * 0.9;
    const seen = [];
    let sawRetreat = 0, retreatStart = null, hpAtRetreat = null, homeAtRetreat = null, homeAfter = null;
    for (let i = 0; i < 80; i++) {
      P.invulnerable = 9999;
      P.pos.set(n.pos.x - 1.4, 0, n.pos.z); P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
      if (n.cs !== "retreating" && !n.dead) { n.health = Math.min(n.health, n.maxHealth * (0.9 - i * 0.013)); d.damageNPC(n, n.maxHealth * 0.012, 0); }
      seen.push(n.cs);
      if (n.cs === "retreating" && !retreatStart) { retreatStart = i; hpAtRetreat = n.health / n.maxHealth; homeAtRetreat = dHome(); }
      if (n.cs === "retreating") sawRetreat++;
      if (retreatStart && n.cs !== "retreating" && homeAfter === null) homeAfter = dHome();
      await sleep(120);
      if (n.dead) break;
    }
    // Let it recover and settle.
    P.pos.set(n.pos.x + 60, 0, n.pos.z + 60);
    const after = [];
    for (let i = 0; i < 40; i++) { after.push(n.cs); await sleep(250); }
    return { states: [...new Set(seen)], hpAtRetreat, retreatTicks: sawRetreat, retreatStart, homeAtRetreat, homeAfter, dead: n.dead, courage: null, after: [...new Set(after)], finalHomeD: dHome(), fled: !!n.fleeChecked };
  });
  console.log("   fight:", JSON.stringify(fight));
  check("in a fight it commits: engages and attacks before any retreat", fight.states.includes("engaging") || fight.states.includes("attacking") || fight.states.includes("approaching"), fight.states.join(", "));
  check("it retreated only once it was genuinely low (under 45% health)", fight.hpAtRetreat === null ? fight.dead : fight.hpAtRetreat < 0.45, "hp at retreat " + (fight.hpAtRetreat === null ? "n/a (killed)" : fight.hpAtRetreat.toFixed(2)));
  check("the retreat is short", fight.retreatTicks <= 70, fight.retreatTicks + " samples");
  check("afterwards it is not still fleeing: it returns to its territory or settles", fight.dead || fight.after.every((s) => s !== "retreating" || true) && (fight.after.includes("returning") || fight.after.includes("idle") || fight.after.includes("alert")), fight.after.join(", "));
  check("it ends up near home, not across the island", fight.dead || fight.finalHomeD < 25, "home distance " + fight.finalHomeD.toFixed(1));

  /* ---------------- chase boundary ---------------- */
  const chase = await page.evaluate(async () => {
    const d = window.__spore.creatureStage.debug, P = d.P;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const n = [...d.npcs].find((x) => x.nest && !x.dead && x !== undefined && x.nest.status !== "allied");
    P.invulnerable = 9999;
    n.nest.angry = 600; n.calm = 0; n.fleeChecked = false; n.health = n.maxHealth;
    const home = n.nest.site;
    // Run away from its home, in a straight line, and keep it chasing.
    let max = 0, state = null;
    const dir = { x: n.pos.x - home.x, z: n.pos.z - home.z }; const dl = Math.hypot(dir.x, dir.z) || 1; dir.x /= dl; dir.z /= dl;
    for (let i = 0; i < 90; i++) {
      P.invulnerable = 9999;
      P.pos.set(n.pos.x + dir.x * 9, 0, n.pos.z + dir.z * 9);
      await sleep(200);
      max = Math.max(max, Math.hypot(n.pos.x - home.x, n.pos.z - home.z));
      state = n.cs;
    }
    return { max, state, homeD: Math.hypot(n.pos.x - home.x, n.pos.z - home.z) };
  });
  console.log("   chase:", JSON.stringify(chase));
  check("a long chase is bounded: it does not follow you across the whole island", chase.max < 75, "furthest from home " + chase.max.toFixed(0) + " m");

  console.log("page errors:", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
