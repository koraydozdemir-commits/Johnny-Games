const { open } = require("./harness.cjs");
const OUT = require("os").tmpdir() + "/spore-e2e-";
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  → " + extra : ""));
};
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

async function boot(page) {
  await page.goto("http://spore.test/games/Spore.html?debug", { waitUntil: "load" });
  await page.waitForFunction(() => window.__spore, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__spore.closeStartScreen();
    window.__spore.startCreatureStage(false, false);
    const i = document.getElementById("intro");
    if (i) i.style.display = "none";
  });
  await page.waitForFunction(() => window.__spore.creatureEditor && !window.__spore.creatureEditor.closed, null, { timeout: 30000 });
  await page.click("#ceCancel");
  await page.waitForTimeout(800);
}
const setMouth = (page, id) =>
  page.evaluate((id) => {
    const stage = window.__spore.creatureStage;
    const P = stage.debug.P;
    const rec = JSON.parse(JSON.stringify(P.record));
    const MOUTHS = ["beak", "grinder", "shears", "fluteBeak", "trunk", "jaws", "fangs", "snapper", "tuskMaw", "mandibles", "snout", "bill", "crusher", "tongue", "sawBeak"];
    rec.parts = rec.parts.filter((p) => !MOUTHS.includes(p.id));
    rec.parts.push({ id, t: 1, angle: 0, scale: 1 });
    stage.applyDesign(rec, P.dna);
    return { id: P.mouthId, diet: P.diet, bite: P.abilities.bite };
  }, id);

(async () => {
  const { browser, page, errors } = await open({ width: 1280, height: 800 });
  await boot(page);
  const brain = await page.evaluate(() => window.__spore.creatureStage.debug.P.brain);
  const levelFactor = 1 + 0.25 * (brain - 1);

  // ---- Bite damage and cooldown follow the mouth ----------------------------------------
  const bite = async (id) => {
    await setMouth(page, id);
    return page.evaluate(() => {
      const d = window.__spore.creatureStage.debug;
      const P = d.P;
      const n = [...d.npcs].find((x) => !x.following && !x.family && !x.dead && x.nest && !(x.nest.cowed > 0));
      if (!n) return { err: "no npc" };
      P.pos.set(n.pos.x - 1.2, 0, n.pos.z);
      P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
      P.sneaking = false;
      P.cooldowns.bite = 0;
      P.pending = null;
      P.target = null;
      d.select(n);
      n.health = n.maxHealth;
      const before = n.health;
      d.useAbility("bite");
      return { dmg: before - n.health, cd: P.cooldowns.bite, lvl: P.abilities.bite };
    });
  };
  const abilityScale = (l) => 0.7 + 0.15 * Math.max(1, Math.min(5, l));
  const STATS = { jaws: [1.0, 1.0], fangs: [0.85, 1.3], snapper: [1.35, 0.65], tuskMaw: [1.25, 0.85], mandibles: [1.0, 1.05], beak: [0.8, 1.0], shears: [1.0, 1.35] };
  const dmgs = {};
  for (const id of Object.keys(STATS)) {
    const r = await bite(id);
    dmgs[id] = r;
    const expected = 14 * levelFactor * abilityScale(r.lvl) * STATS[id][0];
    check(`${id}: bite hits for ${expected.toFixed(1)}`, !r.err && near(r.dmg, expected), `dealt ${r.dmg?.toFixed?.(2)}, level ${r.lvl}`);
    check(`${id}: bite recovers in ${(1 / STATS[id][1]).toFixed(2)}s`, near(r.cd, 1 / STATS[id][1], 0.03), `cooldown ${r.cd?.toFixed?.(2)}`);
  }
  check("a snapper bites harder but slower than jaws", dmgs.snapper.dmg > dmgs.jaws.dmg && dmgs.snapper.cd > dmgs.jaws.cd);
  check("needle fangs bite faster than jaws", dmgs.fangs.cd < dmgs.jaws.cd);

  // ---- Diet gating and meal size ---------------------------------------------------------
  const meal = async (id, kind) => {
    const set = await setMouth(page, id);
    const r = await page.evaluate((kind) => {
      const d = window.__spore.creatureStage.debug;
      const P = d.P;
      P.pos.set(d.region.nest.x + 45, 0, d.region.nest.z);
      P.target = null;
      P.hunger = 20;
      P.health = 40;
      P.carry = { kind, drag: null, mesh: null };
      const dna = P.dna;
      d.doCarry();
      return { gained: P.hunger - 20, heal: P.health - 40, dna: P.dna - dna, carrying: !!P.carry };
    }, kind);
    return { ...set, ...r };
  };
  let m = await meal("jaws", "meat");
  check("carnivore eats meat (22 hunger)", near(m.gained, 22) && !m.carrying, JSON.stringify(m));
  m = await meal("jaws", "fruit");
  check("carnivore cannot eat fruit", m.gained === 0, JSON.stringify(m));
  m = await meal("beak", "meat");
  check("herbivore cannot eat meat", m.gained === 0, JSON.stringify(m));
  m = await meal("beak", "fruit");
  check("herbivore eats fruit (18 hunger)", near(m.gained, 18), JSON.stringify(m));
  m = await meal("grinder", "fruit");
  check("grinder feeds 35% more from plants (24.3)", near(m.gained, 18 * 1.35, 0.03), `gained ${m.gained.toFixed(2)}`);
  check("grinder's Forager special adds DNA (+3 not +1)", m.dna === 3, `dna +${m.dna}`);
  m = await meal("mandibles", "meat");
  check("mandibles feed 30% more from meat (28.6)", near(m.gained, 22 * 1.3, 0.03), `gained ${m.gained.toFixed(2)}`);
  check("mandibles' Devour heals 1.75x (6 × 1.3 × 1.75 ≈ 13.7)", near(m.heal, 6 * 1.3 * 1.75, 0.04), `healed ${m.heal.toFixed(2)}`);
  m = await meal("snout", "meat");
  check("omnivore eats meat, less efficiently (17.6)", near(m.gained, 22 * 0.8, 0.03), `gained ${m.gained.toFixed(2)}`);
  m = await meal("snout", "fruit");
  check("omnivore eats fruit, less efficiently (14.4)", near(m.gained, 18 * 0.8, 0.03), `gained ${m.gained.toFixed(2)}`);

  // ---- Social opening warmth -------------------------------------------------------------
  const opening = async (id) => {
    await setMouth(page, id);
    return page.evaluate(() => {
      const d = window.__spore.creatureStage.debug;
      const P = d.P;
      const n = [...d.npcs].find((x) => x.nest && x.nest.status === "neutral" && !x.member?.friend && !x.epic && !x.rogue && !x.raider && !x.dead);
      if (!n) return { err: "no neutral npc" };
      for (const o of d.npcs) if (o.nest === n.nest) o.social = null;
      n.nest.gifted = false;
      n.nest.snub = 0;
      n.nest.angry = 0;
      P.pos.set(n.pos.x - 2.5, 0, n.pos.z);
      P.heading = Math.atan2(-(n.pos.z - P.pos.z), n.pos.x - P.pos.x);
      P.target = null;
      P.pending = null;
      P.cooldowns.sing = 0;
      P.sneaking = false;
      d.select(n);
      d.useAbility("sing");
      const p = n.social?.progress;
      for (const o of d.npcs) if (o.nest === n.nest) o.social = null;
      return { p, charm: P.abilities.charm };
    });
  };
  const flute = await opening("fluteBeak"),
    jaws = await opening("jaws"),
    snout = await opening("snout");
  console.log("   opening warmth:", JSON.stringify({ flute, jaws, snout }));
  const clampedAny = [flute.p, jaws.p, snout.p].some((v) => v <= 0.05 || v >= 0.6);
  if (!clampedAny) {
    check("social mouth (Flute Beak + Lure) opens warmer than Hunter Jaws", flute.p - jaws.p > 0.12, `diff ${(flute.p - jaws.p).toFixed(3)}, expected ≈ 0.135`);
    check("the baseline snout sits between them", snout.p < flute.p && snout.p > jaws.p);
  } else check("opening warmth measured (not clamped)", false, "values hit the clamp");

  // ---- Snatch reach ----------------------------------------------------------------------
  const snatch = async (id) => {
    await setMouth(page, id);
    return page.evaluate(() => {
      const d = window.__spore.creatureStage.debug;
      const P = d.P;
      P.pos.set(d.region.nest.x + 45, 0, d.region.nest.z);
      d.carcasses.length = 0;
      d.dropCarcass?.(P.pos.x + 3.6, P.pos.z);
      return { carcasses: d.carcasses.length };
    });
  };
  console.log("   (snatch setup)", JSON.stringify(await snatch("snout")));

  console.log("page errors:", errors.slice(0, 5));
  check("no page errors", errors.length === 0);
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASH", e.stack || e.message); process.exit(2); });
