import { test } from "node:test";
import assert from "node:assert/strict";
import { GRUDGE, attitude, fade, grewUp, grudgeMessage, readMemory, remember } from "../cell/memory.js";

test("a species turns wary after a couple of kills, then feuds", () => {
  const m = readMemory(null);
  assert.equal(remember(m, "bobble", "kill"), null);
  assert.equal(remember(m, "bobble", "kill"), "wary");
  assert.equal(attitude(m.grudges.bobble).label, "wary");
  assert.equal(remember(m, "bobble", "kill"), null);
  assert.equal(remember(m, "bobble", "kill"), "feud");
  assert.equal(attitude(m.grudges.bobble).label, "feud");
  assert.ok(m.grudges.bobble <= GRUDGE.max);
});

test("grudges change behaviour only past the threshold, and more with time", () => {
  assert.deepEqual(attitude(0), { fear: 0, huntRange: 0, huntBigger: 1, label: null });
  const a = attitude(GRUDGE.wary),
    b = attitude(GRUDGE.max);
  assert.ok(a.fear > 0 && b.fear > a.fear);
  assert.ok(b.huntRange > a.huntRange && b.huntBigger > a.huntBigger);
});

test("leaving a species alone lets it forget; growing up halves it", () => {
  const m = readMemory({ grudges: { spiker: 4, gone: 0.01 }, known: ["spiker"] });
  assert.equal(m.grudges.gone, undefined, "tiny grudges are dropped when read");
  fade(m, 60);
  assert.ok(Math.abs(m.grudges.spiker - (4 - GRUDGE.fadePerMinute)) < 1e-9);
  grewUp(m);
  assert.ok(m.grudges.spiker < 2);
  fade(m, 600);
  assert.equal(m.grudges.spiker, undefined);
  // It was announced once already: it can return without telling you again.
  remember(m, "spiker", "kill");
  assert.equal(remember(m, "spiker", "kill"), null);
});

test("bad saves read as an empty memory", () => {
  assert.deepEqual(readMemory({ grudges: { a: "x", b: -2, c: 99 }, known: [3, "c"] }), { grudges: { c: GRUDGE.max }, known: ["c"] });
  assert.deepEqual(readMemory(undefined), { grudges: {}, known: [] });
});

test("the message fits the species", () => {
  assert.match(grudgeMessage("Spikers", "meat", "wary"), /come for you/);
  assert.match(grudgeMessage("Bobbles", "plant", "wary"), /flee on sight/);
  assert.match(grudgeMessage("Spikers", "meat", "feud"), /feud/);
});
