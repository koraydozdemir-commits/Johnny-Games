import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CUTSCENES, beatClock, cutsceneLength, ease, mix, span } from "../cinematics.js";
import { createIsland } from "../creature/world.js";

test("cutscene timelines run forwards and end last; reduced motion is shorter", () => {
  for (const [id, beats] of Object.entries(CUTSCENES)) {
    const times = Object.values(beats);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], id + " beats are in order");
    assert.equal(Math.max(...times), beats.end, id + " ends last");
    assert.ok(cutsceneLength(id, true) < cutsceneLength(id), id);
  }
  // The final brain growth bursts out after it has grown, and the stick is thrown after it is raised.
  assert.ok(CUTSCENES.brainFinal.burst > CUTSCENES.brainFinal.grow);
  assert.ok(CUTSCENES.stickThrow.throw > CUTSCENES.stickThrow.raise && CUTSCENES.stickThrow.apex > CUTSCENES.stickThrow.throw);
  // Two different transitions, not one reused.
  assert.notDeepEqual(Object.keys(CUTSCENES.stickThrow), Object.keys(CUTSCENES.civRise));
});

test("beats fire once each, in time, and skipping finishes them", () => {
  const c = beatClock({ a: 1, b: 2, c: 3 });
  assert.deepEqual(c.crossed(0.5), []);
  assert.deepEqual(c.crossed(2.1), ["a", "b"]);
  assert.deepEqual(c.crossed(2.5), []);
  c.finish();
  assert.deepEqual(c.crossed(9), [], "skipped beats never fire late");
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  assert.equal(ease(0.5), 0.5);
  assert.equal(span(5, 4, 6), 0.5);
  assert.equal(span(1, 2, 2), 0);
  assert.equal(mix(2, 4, 0.25), 2.5);
});

test("fossils: five distinct kinds, varied near each other, and none in later stages", () => {
  const isle = createIsland(new THREE.Scene(), "low", "coast");
  const piles = isle.bonePiles;
  assert.ok(piles.length > 10);
  const kinds = new Set(piles.map((b) => b.kind));
  assert.deepEqual([...kinds].sort(), ["claw", "jaw", "ribcage", "skull", "spine"]);
  // Each kind is built differently (not a recolour): its own mix of shapes.
  const shapes = {};
  for (const b of piles) shapes[b.kind] = b.bones.children.map((m) => m.geometry.type + ":" + m.geometry.uuid).sort().join("|");
  assert.equal(new Set(Object.values(shapes)).size, 5);
  // Every fossil is dug where it stands: centred on its spot, with something to raise.
  for (const b of piles) {
    assert.equal(b.mesh.position.x, b.x);
    assert.equal(b.mesh.position.z, b.z);
    assert.ok(b.bones.children.length > 2);
  }
  // Close neighbours are rarely the same kind.
  let same = 0,
    near = 0;
  piles.forEach((a, i) =>
    piles.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.x - b.x, a.z - b.z) < 40) {
        near++;
        if (a.kind === b.kind) same++;
      }
    }),
  );
  assert.ok(same <= near * 0.25, same + " of " + near);
  // Later stages: no fossils at all, and the island is otherwise the same.
  const later = createIsland(new THREE.Scene(), "low", "coast", { fossils: false });
  assert.equal(later.bonePiles.length, 0);
  assert.deepEqual(later.nestSites, isle.nestSites);
  assert.equal(later.fruits.length, isle.fruits.length);
  // The same fossil spots as always, so old saves' dug fossils still line up.
  const again = createIsland(new THREE.Scene(), "low", "coast");
  assert.deepEqual(
    again.bonePiles.map((b) => [b.x, b.z, b.kind]),
    piles.map((b) => [b.x, b.z, b.kind]),
  );
});
