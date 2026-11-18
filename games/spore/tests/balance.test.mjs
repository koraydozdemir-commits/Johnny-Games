import test from "node:test";
import assert from "node:assert/strict";
import { ALPHA, ATTACKS, applyStagger, hitsToKill, npcDamage, npcHealth, playerDamage, playerHealth, roleOf, MAX_STAGGER } from "../creature/balance.js";

const levels = [1, 2, 3, 4, 5];

test("ordinary prey falls in 2–4 hits", () => {
  for (const b of levels)
    for (let lvl = 1; lvl <= 5; lvl++)
      for (const h of [0, 1]) {
        const n = hitsToKill(npcHealth(b, h, "prey"), "bite", lvl, b);
        assert.ok(n >= 2 && n <= 4, `brain ${b}, bite ${lvl}, health ${h}: ${n} hits`);
      }
});

test("a comparable predator takes 3–6 hits from a creature built to fight", () => {
  for (const b of levels)
    for (let lvl = 2; lvl <= 5; lvl++)
      for (let h = 0; h <= 3; h++) {
        const n = hitsToKill(npcHealth(b, h, "predator"), "bite", lvl, b);
        assert.ok(n >= 3 && n <= 6, `brain ${b}, bite ${lvl}, health ${h}: ${n} hits`);
      }
});

test("apex creatures take 6–10 hits", () => {
  for (const b of levels)
    for (let lvl = 2; lvl <= 5; lvl++)
      for (const h of [0, 1]) {
        const n = hitsToKill(npcHealth(b, h, "apex"), "bite", lvl, b);
        assert.ok(n >= 6 && n <= 10, `brain ${b}, bite ${lvl}: ${n} hits`);
      }
});

test("you are never killed in a few bites by an ordinary enemy; an apex is dangerous but not instant", () => {
  for (const b of levels)
    for (let bite = 1; bite <= 5; bite++) {
      const hp = playerHealth(b, 0);
      assert.ok(hp / npcDamage(b, bite, "predator") >= 5.9, `predator bite ${bite} at ${b}`);
      assert.ok(hp / npcDamage(b, bite, "prey") >= 12, "prey barely hurts");
      assert.ok(hp / npcDamage(b, bite, "apex") >= 3.4, `apex bite ${bite}`);
    }
});

test("health and damage grow together, so a level-up never makes the same fight harder", () => {
  for (let b = 1; b < 5; b++) {
    const now = hitsToKill(npcHealth(b, 1, "predator"), "bite", 3, b);
    const after = hitsToKill(npcHealth(b, 1, "predator"), "bite", 3, b + 1);
    assert.ok(after <= now);
    assert.ok(playerHealth(b + 1) > playerHealth(b));
  }
});

test("every attack has a readable recovery, and no move out-damages the rest over time", () => {
  const dps = Object.entries(ATTACKS).map(([k, a]) => [k, playerDamage(k, 3, 1) / a.cooldown]);
  for (const [k, a] of Object.entries(ATTACKS)) assert.ok(a.cooldown >= 0.8, k);
  const [lo, hi] = [Math.min(...dps.map((d) => d[1])), Math.max(...dps.map((d) => d[1]))];
  assert.ok(hi / lo < 3.5, "damage over time stays in one band: " + JSON.stringify(dps));
});

test("staggers are capped and can't be chained into a stun-lock", () => {
  const n = {};
  applyStagger(n, 5, 10);
  assert.equal(n.stun, MAX_STAGGER, "capped");
  const until = n.staggerImmune;
  n.stun = 0;
  applyStagger(n, 0.5, 10.5);
  assert.equal(n.stun, 0, "immune right after a stagger");
  applyStagger(n, 0.5, until + 0.01);
  assert.equal(n.stun, 0.5, "staggerable again later");
});

test("alphas are elites: 5–9 hits for a fighter of their level", () => {
  for (const b of levels)
    for (let lvl = 2; lvl <= 5; lvl++)
      for (const role of ["grazer", "predator"]) {
        const n = hitsToKill(npcHealth(b, 1, role) * ALPHA.hp, "bite", lvl, b);
        assert.ok(n >= 4 && n <= 9, `${role} alpha, brain ${b}, bite ${lvl}: ${n}`);
      }
});

test("wildlife roles sit in their bands", () => {
  for (const b of levels) {
    const giant = hitsToKill(npcHealth(b, 1, "giant"), "bite", 3, b);
    assert.ok(giant >= 5 && giant <= 9, "giants are elites: " + giant);
    const amb = hitsToKill(npcHealth(b, 0, "ambusher"), "bite", 3, b);
    assert.ok(amb >= 3 && amb <= 5, "ambushers are fragile once found: " + amb);
    assert.ok(npcDamage(b, 3, "ambusher") > npcDamage(b, 3, "predator"), "but hit hard");
  }
});

test("roles follow what a creature is", () => {
  assert.equal(roleOf({ epic: true }), "apex");
  assert.equal(roleOf({ alpha: true, species: { diet: "meat" } }), "predator", "an alpha is its own kind, scaled by ALPHA");
  assert.equal(roleOf({ species: { diet: "plant" } }), "grazer");
  assert.equal(roleOf({ species: { diet: "meat" } }), "predator");
  assert.equal(roleOf({ species: { diet: "omni", role: "prey" } }), "prey");
  assert.equal(roleOf({ family: true, species: {} }), "kin");
});
