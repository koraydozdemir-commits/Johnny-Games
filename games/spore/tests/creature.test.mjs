import { test } from "node:test";
import assert from "node:assert/strict";
import { CREATURE_CARDS, TRAIT_COLORS, creatureCard } from "../traits.js";
import { LIMITS, creatureFromCell, creaturePartIds, validateCreature } from "../creature/format.js";
import { abilitiesOf, creaturePart, dietOfParts } from "../creature/parts.js";
import { designCost } from "../creature/editor.js";

test("the Creature card follows alliances versus extinctions", () => {
  assert.equal(creatureCard(0, 8), "predator");
  assert.equal(creatureCard(8, 0), "charmer");
  assert.equal(creatureCard(4, 4), "adaptable");
  assert.equal(creatureCard(0, 0), "adaptable");
  assert.equal(CREATURE_CARDS.predator.color, TRAIT_COLORS.red);
  assert.equal(CREATURE_CARDS.charmer.color, TRAIT_COLORS.green);
  assert.equal(CREATURE_CARDS.adaptable.color, TRAIT_COLORS.blue);
});

test("a cell crawls out with its diet's mouth, eyes, pads and two leg pairs", () => {
  const cell = { name: "Zib", diet: "meat", colors: { base: 1, pattern: 2, accent: 3 }, body: { nodes: [{ x: -1, r: 0.4 }, { x: 0, r: 0.6 }, { x: 1, r: 0.4 }] }, parts: [{ id: "spike" }] };
  const c = creatureFromCell(cell);
  assert.equal(c.name, "Zib");
  assert.equal(c.legs.length, 2);
  assert.equal(c.foot, "pads");
  assert.equal(dietOfParts(c.parts.map((p) => p.id)), "meat");
  assert.ok(c.parts.some((p) => p.id === "spines"), "cell spikes become back spines");
  assert.equal(c.spine.length, 5);
});

test("validation repairs broken records", () => {
  const r = validateCreature({ spine: [{ x: 9, r: 5 }], legs: Array(9).fill({ t: 2, length: 9 }), parts: [{ id: "jaws" }, { id: "beak" }, { id: "nope" }], foot: "jaws" });
  assert.ok(r.spine.length >= LIMITS.minNodes);
  assert.ok(r.spine.every((n) => n.r <= LIMITS.maxR && n.x <= 3));
  assert.equal(r.legs.length, LIMITS.maxLegPairs);
  assert.ok(r.legs.every((l) => l.t <= 0.95 && l.length <= LIMITS.maxLeg));
  assert.equal(r.parts.filter((p) => creaturePart(p.id).slot === "mouth").length, 1, "one mouth only");
  assert.equal(r.foot, "pads", "a mouth cannot be a foot");
});

test("abilities take the best part, not the sum", () => {
  const a = abilitiesOf(["claws", "pincers", "pads"], 2);
  assert.equal(a.strike, 4);
  assert.ok(a.speed >= 1);
});

test("DNA cost charges new parts, hands, limbs and vertebrae only", () => {
  const base = creatureFromCell({ diet: "plant" });
  assert.equal(designCost(base, base), 0);
  const more = validateCreature({ ...base, parts: [...base.parts, { id: "spines", t: 0.5, angle: 0 }], legs: [...base.legs, { t: 0.5, length: 1 }] });
  assert.equal(designCost(base, more), creaturePart("spines").cost + 8);
  const armed = validateCreature({ ...base, arms: [{ t: 0.75, angle: 1.6, length: 1, hand: "claws" }] });
  assert.equal(designCost(base, armed), 8 + creaturePart("claws").cost, "an arm pair plus its hands");
  const pawed = validateCreature({ ...base, arms: [{ t: 0.75, angle: 1.6, length: 1, hand: "paw" }] });
  assert.equal(designCost(base, pawed), 8, "paws are free");
  const fewer = validateCreature({ ...base, parts: base.parts.slice(0, 1) });
  assert.equal(designCost(base, fewer), 0, "removing is free");
  assert.deepEqual(creaturePartIds(base).sort(), ["beak", "eyes", "pads"]);
});

import { atLevel, evolveSpecies, generateSpecies, socialNeed } from "../creature/species.js";
test("species evolve deterministically and keep their level", () => {
  const sp = generateSpecies(1234, "plant", 2);
  const a = evolveSpecies(evolveSpecies(sp)),
    b = evolveSpecies(evolveSpecies(sp));
  assert.equal(a.generation, 3);
  assert.deepEqual(a.record, b.record, "same seed, same evolution");
  assert.equal(a.name, sp.name);
  assert.ok(a.scale > sp.scale && a.maxHealth > sp.maxHealth);
  const move = sp.favourite[0];
  assert.equal(a.level, sp.level);
  assert.equal(socialNeed(a, move), socialNeed(sp, move), "evolving changes the look, not the challenge");
  assert.ok(socialNeed(sp, move) < sp.level || sp.level === 1, "a species asks for one below its level");
});

test("species level up and down with the player and keep their look", () => {
  const sp = generateSpecies(4321, "meat", 2);
  let last = null;
  for (let level = 1; level <= 5; level++) {
    const s = atLevel(sp, level);
    assert.equal(s.level, level);
    assert.deepEqual(s.record, sp.record, "same creature, different strength");
    assert.equal(s.name, sp.name);
    if (last) {
      assert.ok(s.scale > last.scale && s.maxHealth > last.maxHealth, "higher levels are bigger and tougher");
      assert.ok(s.abilities.bite >= last.abilities.bite);
      assert.ok(socialNeed(s, s.favourite[0]) >= socialNeed(last, last.favourite[0]));
    }
    last = s;
  }
  assert.equal(atLevel(sp, 9).level, 5, "clamped to 1..5");
  assert.equal(atLevel(sp, -2).level, 1);
  assert.equal(socialNeed(atLevel(sp, 1), atLevel(sp, 1).favourite[0]), 1);
  assert.equal(socialNeed(atLevel(sp, 5), atLevel(sp, 5).favourite[0]), 4, "never more than one below the top");
});

test("arms are jointed limbs with a grasper or a foot on the end", () => {
  const base = creatureFromCell({ diet: "meat" });
  const r = validateCreature({
    ...base,
    arms: [
      { t: 2, angle: -9, length: 99, bend: 4, hand: "pincers" },
      { t: 0.5, angle: 1, length: 1, hand: "hooves" },
      { t: 0.5, angle: 1, length: 1, hand: "pincers" },
    ],
  });
  assert.equal(r.arms.length, 2, "two pairs at most");
  assert.deepEqual(r.arms[0], { t: 0.95, angle: 2.5, length: 1.8, bend: 1, hand: "pincers" }, "clamped onto the flank");
  assert.equal(r.arms[1].hand, "hooves", "feet can go on arms");
  assert.equal(validateCreature({ ...base, arms: [{ hand: "spines" }] }).arms[0].hand, "paw", "only graspers and feet fit");
  assert.equal(validateCreature({ ...base, arms: [{ hand: null }] }).arms[0].hand, null, "an arm may have no hand");
  assert.ok(creaturePartIds(r).includes("pincers") && creaturePartIds(r).includes("hooves"));
  const ab = abilitiesOf(creaturePartIds(r), r.legs.length, r.arms.length);
  assert.equal(ab.strike, 4, "hands count once they are on an arm");
  assert.ok(ab.charm >= 1 && ab.dance >= 1, "arms let you wave and hug");
  assert.equal(abilitiesOf(["pincers"], 2, 0).strike, 4);
});

test("old saves' single-piece arms become arm pairs holding the same hands", () => {
  const base = creatureFromCell({ diet: "omni" });
  const old = validateCreature({
    ...base,
    parts: [...base.parts, { id: "arm", t: 0.6, angle: -1.4, scale: 1.2, bend: 0.5 }, { id: "bladeArms", t: 0.5, angle: 1.3 }],
  });
  assert.equal(old.parts.some((p) => ["arm", "bladeArms"].includes(p.id)), false, "no longer body parts");
  assert.deepEqual(
    old.arms.map((a) => a.hand),
    ["paw", "bladeArms"],
  );
  assert.equal(old.arms[0].angle, 1.4, "mirrored pairs keep their flank");
  assert.ok(Math.abs(old.arms[0].length - 1.08) < 1e-9, "size carries over as reach");
  assert.equal(old.arms[0].bend, 0.5);
});

test("eyes left at the old default spot move up onto the head", () => {
  const r = validateCreature({ ...creatureFromCell({ diet: "plant" }), parts: [{ id: "beak", t: 1, angle: 0 }, { id: "eyes", t: 0.86, angle: 0.75 }] });
  assert.deepEqual([r.parts[1].t, r.parts[1].angle], [0.92, 0.62]);
  const moved = validateCreature({ ...r, parts: [{ id: "eyes", t: 0.8, angle: 0.75 }] });
  assert.deepEqual([moved.parts[0].t, moved.parts[0].angle], [0.8, 0.75], "eyes the player placed stay put");
});
