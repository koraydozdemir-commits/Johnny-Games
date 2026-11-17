import { test } from "node:test";
import assert from "node:assert/strict";
import { GROWTH_STAGES, PART_SOURCES, meteorPool, preyFor, stageFor, unlockHint } from "../stages.js";
import { DIET_CARDS, STAGE_TRACK, TRAIT_COLORS, dietPath } from "../traits.js";
import { SPECIES } from "../species.js";
import { PART_DEFS } from "../part-defs.js";

test("every species named in a stage roster exists and knows its native stage", () => {
  for (const st of GROWTH_STAGES) {
    for (const id of [...st.residents.plant, ...st.residents.meat, ...st.giants]) {
      assert.ok(SPECIES[id], "missing species " + id);
      assert.ok(SPECIES[id].tier >= 1 && SPECIES[id].size, id + " needs tier and size");
    }
  }
});

test("previous stage residents come back as prey", () => {
  assert.deepEqual(preyFor(1), []);
  assert.ok(preyFor(2).includes("mote"));
  assert.equal(stageFor(99).tier, 4);
});

test("every part has an unlock source and drops name real species", () => {
  for (const d of PART_DEFS) {
    assert.ok(PART_SOURCES[d.id], "no source for " + d.id);
    for (const sp of PART_SOURCES[d.id].drop || []) assert.ok(SPECIES[sp], d.id + " drops from unknown " + sp);
  }
  assert.match(unlockHint("spike"), /Dropped by/);
  assert.ok(PART_SOURCES.filter.starter && PART_SOURCES.jaw.starter && !PART_SOURCES.proboscis.starter);
  assert.ok(GROWTH_STAGES[1].rewards.includes("proboscis"), "omnivore mouth is guaranteed after stage 1");
});

test("meteor pools respect stages", () => {
  assert.deepEqual(meteorPool(1, ["jet", "proboscis"]), ["proboscis"]);
  assert.ok(meteorPool(3, ["jet", "poison"]).includes("poison"));
});

test("diet path follows the plant/meat balance", () => {
  assert.equal(dietPath(30, 2), "herbivore");
  assert.equal(dietPath(2, 30), "carnivore");
  assert.equal(dietPath(10, 10), "omnivore");
  assert.equal(dietPath(0, 0), "omnivore");
  assert.ok(DIET_CARDS.herbivore.ability);
});

test("consequence traits follow Spore's colours", () => {
  assert.equal(DIET_CARDS.carnivore.color, TRAIT_COLORS.red);
  assert.equal(DIET_CARDS.herbivore.color, TRAIT_COLORS.green);
  assert.equal(DIET_CARDS.omnivore.color, TRAIT_COLORS.blue);
  assert.equal(STAGE_TRACK[0].id, "cell");
  assert.equal(STAGE_TRACK.length, 5);
});
