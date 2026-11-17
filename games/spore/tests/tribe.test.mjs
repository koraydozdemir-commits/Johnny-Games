import { test } from "node:test";
import assert from "node:assert/strict";
import { BABY_COST, TOOLS, canGather, clampRelation, popCap, readTribeSave, relationFace, stageWon, willRaid } from "../tribe/rules.js";

test("the tribe grows with every neighbour won over or conquered", () => {
  assert.equal(popCap(0), 6);
  assert.equal(popCap(2), 12);
  assert.equal(popCap(-1), 6);
  assert.ok(BABY_COST > 0);
  for (const t of Object.values(TOOLS)) assert.ok(t.cost > 0 && t.name && t.icon);
});

test("relations show the same five faces as the creature stage", () => {
  assert.equal(relationFace(-80), "furious");
  assert.equal(relationFace(-20), "annoyed");
  assert.equal(relationFace(0), "neutral");
  assert.equal(relationFace(40), "friendly");
  assert.equal(relationFace(-90, "allied"), "allied");
  assert.equal(clampRelation(250), 100);
  assert.equal(clampRelation(-250), -100);
});

test("diet decides what a tribe can gather", () => {
  assert.equal(canGather("plant", "fruit"), true);
  assert.equal(canGather("plant", "fish"), false);
  assert.equal(canGather("meat", "fish"), true);
  assert.equal(canGather("meat", "fruit"), false);
  assert.equal(canGather("omni", "fruit"), true);
  assert.equal(canGather("omni", "fish"), true);
});

test("only unfriendly tribes with hunters left raid, and the stage is won when none are left neutral", () => {
  assert.equal(willRaid({ status: "neutral", relation: -40, alive: 3 }), true);
  assert.equal(willRaid({ status: "neutral", relation: 5, alive: 3 }), false);
  assert.equal(willRaid({ status: "neutral", relation: -40, alive: 1 }), false);
  assert.equal(willRaid({ status: "allied", relation: -40, alive: 5 }), false);
  assert.equal(stageWon([]), false);
  assert.equal(stageWon([{ status: "allied" }, { status: "conquered" }]), true);
  assert.equal(stageWon([{ status: "allied" }, { status: "neutral" }]), false);
});

test("tribe saves are read defensively", () => {
  assert.equal(readTribeSave("{oops"), null);
  assert.equal(readTribeSave({ food: 5 }), null);
  const d = readTribeSave({ food: 1e9, tools: { axe: 1 }, units: [{ tool: "sword" }, { tool: "horn" }], tribes: [{ relation: 500, status: "evil", alive: 99, hut: 3 }] });
  assert.equal(d.food, 9999);
  assert.deepEqual(d.tools, { axe: true, horn: false });
  assert.equal(d.units[0].chief, true, "a chief is always restored");
  assert.deepEqual(
    d.units.map((u) => u.tool),
    [null, null, "horn"],
  );
  assert.deepEqual(d.tribes[0], { relation: 100, status: "neutral", alive: 8, hut: 1 });
});
