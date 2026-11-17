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

test("DNA cost charges new parts, legs and vertebrae only", () => {
  const base = creatureFromCell({ diet: "plant" });
  assert.equal(designCost(base, base), 0);
  const more = validateCreature({ ...base, parts: [...base.parts, { id: "claws", t: 0.6, angle: 1.4 }], legs: [...base.legs, { t: 0.5, length: 1 }] });
  assert.equal(designCost(base, more), creaturePart("claws").cost + 8);
  const fewer = validateCreature({ ...base, parts: base.parts.slice(0, 1) });
  assert.equal(designCost(base, fewer), 0, "removing is free");
  assert.deepEqual(creaturePartIds(base).sort(), ["beak", "eyes", "pads"]);
});

import { evolveSpecies, generateSpecies, socialNeed } from "../creature/species.js";
test("species evolve deterministically and get harder to impress", () => {
  const sp = generateSpecies(1234, "plant", 2);
  const a = evolveSpecies(evolveSpecies(sp)),
    b = evolveSpecies(evolveSpecies(sp));
  assert.equal(a.generation, 3);
  assert.deepEqual(a.record, b.record, "same seed, same evolution");
  assert.equal(a.name, sp.name);
  assert.ok(a.scale > sp.scale && a.maxHealth > sp.maxHealth);
  const move = sp.favourite[0];
  assert.ok(socialNeed(a, move) >= socialNeed(sp, move));
  assert.ok(socialNeed(sp, move) <= sp.ring, "first generation never asks above its ring");
});
