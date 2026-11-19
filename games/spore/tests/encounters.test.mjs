import { test } from "node:test";
import assert from "node:assert/strict";
import { ENCOUNTERS, ENCOUNTER_IDS, OUTCOMES, encounterDone, pickEncounter, readEncounters, retryLater } from "../creature/encounters.js";
import { LEDGER_KEYS } from "../creature/identity.js";
import { MEMORY_ACTS } from "../creature/memory.js";

const ctx = (o = {}) => ({ atHome: true, brain: 2, busy: false, night: false, nestDist: 30, rivalSource: true, strayNear: true, ...o });

test("every choice has an outcome, and every outcome is real", () => {
  for (const id of ENCOUNTER_IDS) {
    for (const ch of ENCOUNTERS[id].choices) assert.ok(OUTCOMES[id][ch.id], id + "." + ch.id);
    for (const [k, out] of Object.entries(OUTCOMES[id])) {
      for (const act of out.ledger) assert.ok(LEDGER_KEYS.includes(act), k + " counts a real act");
      if (out.memory) assert.ok(MEMORY_ACTS[out.memory], k + " is remembered");
      if (out.text) assert.ok(out.text("Grazer").includes("Grazer"));
    }
  }
  // The rival's three answers really differ.
  const r = OUTCOMES.rival;
  assert.ok(r.defend.memory === "kill" && r.move.effect.migrate && r.coexist.effect.neighbour);
});

test("encounters wait their turn, respect the moment, and alternate", () => {
  const s = readEncounters(null, () => 0);
  assert.ok(s.clock >= 360, "a quiet start");
  assert.equal(pickEncounter(s, ctx()), null);
  s.clock = 0;
  assert.equal(pickEncounter(s, ctx({ busy: true })), null, "not during a raid or migration");
  assert.equal(pickEncounter(s, ctx({ night: true })), null);
  assert.equal(pickEncounter(s, ctx({ strayNear: false, brain: 1 })), null, "rivals need brain 2");
  assert.equal(pickEncounter(s, ctx({ strayNear: false, atHome: false })), null, "rivals come to your nest");
  const first = pickEncounter(s, ctx());
  encounterDone(s, first, () => 0.5);
  assert.ok(s.clock >= 600);
  s.clock = 0;
  assert.notEqual(pickEncounter(s, ctx()), first, "the other kind next");
  s.neighbour = { kind: "nest", index: 2, x: 1, z: 2 };
  assert.equal(pickEncounter(s, ctx({ strayNear: false })), null, "one neighbour is enough");
  retryLater(s);
  assert.equal(s.clock, 30);
});

test("encounter state survives bad saves", () => {
  const s = readEncounters({ clock: -5, last: "nonsense", done: { rival: "x", stray: 3 }, neighbour: { kind: "nest", index: 4, x: 3, z: "z" } }, () => 0);
  assert.ok(s.clock > 0);
  assert.equal(s.last, null);
  assert.deepEqual(s.done, { rival: 0, stray: 3 });
  assert.equal(s.neighbour, null);
  const ok = readEncounters({ clock: 99, neighbour: { kind: "wild", index: 1, x: 3, z: 4, region: "forest" } });
  assert.deepEqual(ok.neighbour, { kind: "wild", index: 1, x: 3, z: 4, region: "forest" });
  assert.equal(ok.clock, 99);
});
