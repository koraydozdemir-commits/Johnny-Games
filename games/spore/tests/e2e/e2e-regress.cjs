const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""));
};
(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__spore.closeStartScreen(); window.__spore.startCreatureStage(false, false); const i = document.getElementById("intro"); if (i) i.style.display = "none"; });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceDone"); // save the starting design as the editor would
  await page.waitForTimeout(1500);

  const hud = await page.evaluate(() => ({ abilityButtons: [...document.querySelectorAll(".chAb")].map((b) => b.dataset.ab), hungerBar: !!document.querySelector("#chHunger") }));
  check("the abilities HUD renders", hud.abilityButtons.length >= 8 && hud.hungerBar, hud.abilityButtons.join());

  // Walk around for a few seconds.
  const p0 = await page.evaluate(() => ({ x: window.__spore.creatureStage.debug.P.pos.x, z: window.__spore.creatureStage.debug.P.pos.z }));
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.down("d");
  await page.waitForTimeout(1200);
  await page.keyboard.up("d");
  await page.keyboard.up("w");
  const p1 = await page.evaluate(() => ({ x: window.__spore.creatureStage.debug.P.pos.x, z: window.__spore.creatureStage.debug.P.pos.z }));
  check("the creature walks", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);

  // A social round: win a nest over, then check the stage keeps running and saves.
  const social = await page.evaluate(() => {
    const d = window.__spore.creatureStage.debug;
    const n = [...d.npcs].find((x) => x.nest && x.nest.status === "neutral" && !x.member?.friend && !x.epic && !x.rogue && !x.raider && !x.dead);
    if (!n) return { err: "no neutral npc" };
    d.P.pos.set(n.pos.x - 2.5, 0, n.pos.z);
    d.P.heading = Math.atan2(-(n.pos.z - d.P.pos.z), n.pos.x - d.P.pos.x);
    d.select(n);
    d.P.cooldowns.sing = 0;
    d.useAbility("sing");
    const enc = n.social;
    return { started: !!enc, request: enc?.request, progress: enc?.progress };
  });
  check("a social encounter opens with the mouth-adjusted warmth", social.started && social.progress > 0.05, JSON.stringify(social));
  await page.waitForTimeout(500);
  // Every ability can be used (some need parts the starter creature lacks: they must refuse politely, not throw).
  const used = await page.evaluate(() => {
    const d = window.__spore.creatureStage.debug;
    const out = {};
    for (const k of ["bite", "strike", "charge", "spit", "sing", "dance", "charm", "pose"]) {
      d.P.cooldowns[k] = 0;
      try { d.useAbility(k); out[k] = "ok(lvl " + d.P.abilities[k] + ")"; } catch (e) { out[k] = "ERR " + e.message; }
    }
    return out;
  });
  check("all eight abilities run without error", Object.values(used).every((v) => v.startsWith("ok")), JSON.stringify(used));

  // The bite cooldown ring uses the mouth's speed (HUD reads cooldownOf).
  const ring = await page.evaluate(() => {
    const d = window.__spore.creatureStage.debug;
    const n = [...d.npcs].find((x) => !x.following && !x.family && !x.dead && x.nest);
    d.P.pending = null;
    d.P.pos.set(n.pos.x - 1.2, 0, n.pos.z);
    d.P.heading = Math.atan2(-(n.pos.z - d.P.pos.z), n.pos.x - d.P.pos.x);
    d.P.cooldowns.bite = 0;
    d.select(n);
    d.useAbility("bite");
    return d.P.cooldowns.bite;
  });
  check("bite cooldown comes from the equipped mouth", ring > 0.5 && ring <= 1.6, ring.toFixed(2));
  await page.waitForTimeout(600);
  const ringCss = await page.evaluate(() => getComputedStyle(document.querySelector('.chAb[data-ab="bite"] .cd') || document.body).getPropertyValue("--p"));
  console.log("   bite ring --p:", ringCss);

  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "regress-stage.png" });

  // Let the world run: NPCs, weather, ecosystem.
  await page.waitForTimeout(4000);
  const alive = await page.evaluate(() => { const d = window.__spore.creatureStage.debug; return { npcs: d.npcs.size, health: Math.round(d.P.health), hunger: Math.round(d.P.hunger) }; });
  check("the world keeps simulating (NPCs alive, player healthy)", alive.npcs > 0 && alive.health > 0, JSON.stringify(alive));

  // Save is written and well-formed.
  const save = await page.evaluate(() => { window.__spore.creatureStage.save(); return JSON.parse(localStorage.getItem("johnny-spore-creature-stage")); });
  check("the save is written with design, brain, unlocks and treatment", save.record?.parts?.length && save.brain && Array.isArray(save.unlocked) && save.treated !== undefined, Object.keys(save).length + " keys");

  // The existing hand-off to the Tribal Stage still reads the creature.
  const tribe = await page.evaluate(() => { try { window.__spore.startTribeStage(); return "started"; } catch (e) { return "ERR " + e.message; } });
  await page.waitForTimeout(2500);
  check("the Tribal Stage starts from the creature", tribe === "started", tribe);

  console.log("page errors:", errors.slice(0, 6));
  check("no page errors across the whole run", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
