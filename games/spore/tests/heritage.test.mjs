import test from "node:test";
import assert from "node:assert/strict";
import { CIV_INSTINCT, heritageEvents, heritageRemark, instinctOf, speciesIdentity } from "../heritage.js";
import { INSTINCT_IDS } from "../creature/identity.js";
import { civLegacy } from "../civ/rules.js";
import { line } from "../civ/leaders.js";

test("all eight instincts carry into the Civilization Stage, each with an upside and a downside", () => {
  assert.equal(INSTINCT_IDS.length, 8);
  const seen = new Set();
  for (const id of INSTINCT_IDS) {
    const c = CIV_INSTINCT[id];
    assert.ok(c, id + " has a civ legacy");
    const vals = Object.values(c.effect);
    assert.ok(vals.some((v) => v > 0) && vals.some((v) => v < 0), id + " has both a pro and a con");
    const L = civLegacy({ instinct: id, cellDiet: "omnivore", tribeTrait: "Industrious" });
    for (const [k, v] of Object.entries(c.effect)) assert.ok(Number.isFinite(L.mods[k]) && Math.abs(L.mods[k] - (k === "incomeBonus" ? 0.15 : 0) - v) < 1e-9, id + " sets " + k);
    assert.ok(L.lines.some((l) => l.text.startsWith(c.name)), id + " explains itself");
    seen.add(JSON.stringify(c.effect));
  }
  assert.equal(seen.size, 8, "no two instincts collapse into the same legacy");
});

test("no instinct is simply the best: each one's total effect is modest", () => {
  // A rough budget: positive and negative effects roughly offset (relations scaled to fractions;
  // turrets and spice count half, since they only touch part of the game).
  for (const id of INSTINCT_IDS) {
    const e = CIV_INSTINCT[id].effect;
    const score = Object.entries(e).reduce((s, [k, v]) => s + (k === "relation" ? v / 100 : k === "happyBonus" ? v * 0.05 : k === "turret" || k === "spice" ? v / 2 : v), 0);
    assert.ok(score > -0.05 && score < 0.15, id + " is balanced (" + score.toFixed(3) + ")");
  }
});

test("old saves without an instinct still get the classic card's legacy", () => {
  const L = civLegacy({ creatureCard: "Aggressive" });
  assert.equal(L.mods.damage, 0.15);
  assert.equal(instinctOf(null), null);
  assert.equal(instinctOf({ card: "predator" }), null);
  assert.equal(instinctOf({ leaning: "elusive" }), "elusive");
  assert.equal(instinctOf({ instinct: "scavenger", leaning: "apex" }), "scavenger");
  assert.equal(instinctOf({ instinct: "nonsense" }), null);
});

test("rival leaders remember your past when you meet", () => {
  const r = heritageRemark({ instinct: "apex" }, "aggressive");
  assert.match(r, /hunters/);
  assert.notEqual(heritageRemark({ instinct: "apex" }, "friendly"), r);
  assert.match(heritageRemark({ tribePath: "peace" }, "cautious"), /friends/);
  assert.equal(heritageRemark({}, "cautious"), "");
  const g = line("greet", "friendly", { you: "Zorbs", them: "Ulani", heritage: "Old words." });
  assert.ok(g.endsWith("Old words.") && g.includes("Zorbs"));
  assert.ok(!line("accept", "friendly", { heritage: "Old words." }).includes("Old words"), "only greetings carry it");
});

test("the species identity follows the saves from cell to civilization", () => {
  const cell = { dietCard: "herbivore" };
  const creature = { instinct: "symbiotic", alliances: 4, extinctions: 0 };
  const tribe = { path: "peace", tribes: [{ status: "allied" }, { status: "allied" }] };
  const civ = { won: true, card: "religious", captures: { military: 0, economic: 1, religious: 5 }, cities: [{ owner: "you" }] };
  const a = speciesIdentity({ name: "Zorbs", cell });
  assert.equal(a.stage, "cell");
  assert.deepEqual(a.tags, ["Herbivore"]);
  const b = speciesIdentity({ name: "Zorbs", cell, creature, tribe, civ });
  assert.equal(b.stage, "civ");
  assert.deepEqual(b.tags, ["Herbivore", "Symbiotic", "Diplomatic", "Religious"]);
  assert.match(b.summary, /^Zorbs began as a herbivore cell, grew into a symbiotic, united the island through friendship and united the world in one faith\.$/);
  assert.equal(b.civ.captures.religious, 5);
  const forming = speciesIdentity({ creature: { leaning: "apex" } });
  assert.equal(forming.instinct.earned, false);
  assert.match(forming.summary, /still forming/);
  // Damaged or partial saves never throw.
  assert.doesNotThrow(() => speciesIdentity({ creature: {}, tribe: { tribes: "x" }, civ: { cities: [] } }));
  assert.doesNotThrow(() => speciesIdentity());
});

test("turning points are recorded with what was chosen and what it led to", () => {
  const evs = heritageEvents({
    creature: { instinct: "territorial" },
    tribe: { path: "conquest", tribes: [{ status: "conquered" }, { status: "conquered" }] },
    civ: { won: true, card: "military", captures: { military: 6, economic: 0, religious: 0 } },
  });
  assert.deepEqual(evs.map((e) => e.key), ["heritage:instinct", "heritage:tribe", "heritage:unified"]);
  assert.ok(evs.every((e) => e.major && e.text.length > 20));
  assert.match(evs[1].text, /0 allied, 2 conquered/);
  assert.match(evs[2].text, /6 cities taken by force/);
  assert.deepEqual(heritageEvents({ creature: { leaning: "apex" } }), [], "a forming leaning is not yet a turning point");
});
