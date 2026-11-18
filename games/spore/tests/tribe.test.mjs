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
  assert.equal(d.tools.axe, 1, "v1 yes/no tools become tier 1");
  assert.equal(d.tools.horn, 0);
  assert.equal(Object.keys(d.tools).length, 9);
  assert.equal(d.units[0].chief, true, "a chief is always restored");
  assert.deepEqual(
    d.units.map((u) => u.tool),
    [null, null, "horn"],
  );
  assert.deepEqual(d.tribes[0], { relation: 100, status: "neutral", alive: 8, hut: 1, food: 12, war: 0, peace: 0 });
});

import { ASK_TIME, DAMAGE, HUT_DAMAGE, INSTRUMENTS, TOOL_IDS, answerCall, nextAsk } from "../tribe/rules.js";
test("nine tools in three kinds, with weapons that hit differently", () => {
  assert.equal(TOOL_IDS.length, 9);
  assert.deepEqual(INSTRUMENTS, ["horn", "maracas", "didgeridoo"]);
  assert.ok(DAMAGE.axe > DAMAGE.none && HUT_DAMAGE.torch > HUT_DAMAGE.axe);
  assert.ok(ASK_TIME > 2);
});

test("a tribe calls for instruments you own more often, never twice running", () => {
  let n = 0;
  const seq = () => (n = (n * 9301 + 49297) % 233280) / 233280;
  let last = null;
  const counts = { horn: 0, maracas: 0, didgeridoo: 0 };
  for (let i = 0; i < 300; i++) {
    const a = nextAsk(last, ["horn"], seq);
    assert.notEqual(a, last);
    counts[a]++;
    last = a;
  }
  assert.ok(counts.horn > counts.maracas && counts.horn > counts.didgeridoo);
});

test("answering a call raises the mood, missing it lowers it", () => {
  assert.ok(answerCall(0, 1) > 0);
  assert.ok(answerCall(0, 3) > answerCall(0, 1));
  assert.ok(answerCall(0, 0) < 0);
  assert.equal(answerCall(99, 4), 100);
});

test("saves keep every tool, and drop unknown ones", () => {
  const d = readTribeSave({ food: 5, tools: { spear: true, laser: true }, units: [{ chief: true, tool: "torch" }], tribes: [], won: true });
  assert.equal(d.tools.spear, 1);
  assert.equal(d.tools.laser, undefined);
  assert.equal(d.units[0].tool, "torch");
  assert.equal(d.won, true);
});
