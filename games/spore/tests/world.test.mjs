import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ISLAND, PEAKS, areaAt, createIsland, heightAt, mountainClear, steerAround } from "../creature/world.js";

const island = () => createIsland(new THREE.Scene(), "low");

test("the island is the same every time, with twelve nests spread over open plains", () => {
  const a = island().nestSites,
    b = island().nestSites;
  assert.deepEqual(a, b);
  assert.equal(a.length, 12);
  a.forEach((n, i) => {
    assert.equal(n.rank, i);
    assert.equal(areaAt(n.x, n.z), "Plains", "nests sit on the plains");
    assert.ok(mountainClear(n.x, n.z) > 10);
    assert.ok(Math.hypot(n.x - ISLAND.nest.x, n.z - ISLAND.nest.z) > 45, "none on top of your first nest");
    a.slice(i + 1).forEach((m) => assert.ok(Math.hypot(n.x - m.x, n.z - m.z) > 30, "nests are spread out"));
  });
  const d = a.map((n) => Math.hypot(n.x - ISLAND.nest.x, n.z - ISLAND.nest.z));
  assert.deepEqual([...d].sort((x, y) => x - y), d, "listed nearest your nest first");
});

test("mountains are walls: nothing can stand inside one", () => {
  const w = island();
  for (const p of PEAKS) {
    for (const [ox, oz] of [[1, 0], [0, -3], [p.solid * 0.9, 0], [-p.solid * 0.7, p.solid * 0.5]]) {
      const at = w.resolve(p.x + ox, p.z + oz, 1);
      assert.ok(mountainClear(at.x, at.z) >= 1 - 1e-6, "pushed clear of every peak in the range");
    }
    assert.ok(heightAt(p.x, p.z) > 15, "and they are tall");
  }
  assert.equal(areaAt(PEAKS[0].x, PEAKS[0].z), "Mountains");
  assert.equal(areaAt(0, ISLAND.beach + 10), "Beach");
});

test("creatures steer round a mountain in their way, and not round one behind their goal", () => {
  const p = PEAKS[10];
  const from = { x: p.x - p.solid - 6, z: p.z + 0.5 };
  const way = steerAround(from.x, from.z, 1, 0, 1, 9);
  assert.ok(Math.abs(way.z) > 0.6, "turns along the wall");
  assert.ok(Math.abs(Math.hypot(way.x, way.z) - 1) < 1e-9);
  const open = steerAround(from.x, from.z, -1, 0, 1, 9);
  assert.deepEqual(open, { x: -1, z: 0 }, "walking away: unchanged");
  const short = steerAround(from.x, from.z, 1, 0, 1, 3);
  assert.deepEqual(short, { x: 1, z: 0 }, "the goal is nearer than the wall");
});

test("fossils and fruit are spread over the island, off the mountains", () => {
  const w = island();
  assert.ok(w.bonePiles.length >= 40);
  w.bonePiles.forEach((b) => assert.ok(mountainClear(b.x, b.z) > 0));
  assert.ok(w.fruits.length > 150);
});

test("fruit trees: bump the trunk and the fruit falls, lands, and grows back in the tree", () => {
  const w = island();
  const hanging = w.fruits.filter((f) => f.tree);
  assert.ok(hanging.length >= 30, "plenty of fruit up in the trees");
  const f = hanging[0],
    t = f.tree;
  assert.ok(f.hanging && f.y > heightAt(t.x, t.z) + 3, "it starts up in the crown");
  assert.equal(w.shakeTree(t.x + 30, t.z, 2), null, "too far away to shake");
  assert.ok(w.fruitTreeNear(t.x + 1, t.z, 3), "a fruit tree close by");
  assert.ok(w.shakeTree(t.x + 1.5, t.z, 2), "bumped (a grove neighbour may shake too)");
  const fell = hanging.filter((g) => g.tree === t);
  fell.forEach((g) => assert.ok(!g.hanging));
  for (let i = 0; i < 120; i++) w.update(1 / 30, { x: 0, z: 0 });
  fell.forEach((g) => assert.ok(Math.abs(g.y - g.groundY) < 1e-6 && g.vy === 0, "landed and still"));
  assert.ok(fell.every((g) => !g.hanging), "nothing left up in that tree");
  // Uneaten fruit rots, then grows back up in the tree.
  for (let i = 0; i < 125 * 4; i++) w.update(1 / 4, { x: 0, z: 0 });
  fell.forEach((g) => assert.ok(g.alive && g.hanging && g.y === g.hangY));
});
