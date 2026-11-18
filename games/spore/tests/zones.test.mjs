import { test } from "node:test";
import assert from "node:assert/strict";
import { ZONES, ZONE_IDS, depthAt, plantShareIn, zoneAt } from "../cell/zones.js";

test("the soup gets deeper away from the start, and every zone exists", () => {
  assert.equal(zoneAt(0, 0), "shallows");
  assert.equal(zoneAt(30, -20), "shallows", "the start is always calm");
  assert.ok(depthAt(600, 0) > depthAt(150, 0), "deeper further out");
  const seen = new Set();
  for (let r = 0; r < 700; r += 9) for (let a = 0; a < 6.28; a += 0.4) seen.add(zoneAt(Math.cos(a) * r, Math.sin(a) * r));
  assert.deepEqual([...seen].sort(), [...ZONE_IDS].sort());
  assert.equal(zoneAt(321, -77, 5), zoneAt(321, -77, 5), "deterministic");
});

test("deeper zones trade safety for reward", () => {
  const order = ["shallows", "twilight", "trench"];
  for (let i = 1; i < order.length; i++) {
    const a = ZONES[order[i - 1]],
      b = ZONES[order[i]];
    assert.ok(b.hunters > a.hunters && b.dna > a.dna && b.dark > a.dark, order[i]);
  }
  assert.ok(plantShareIn("kelp", 0.55) > plantShareIn("trench", 0.55));
  assert.ok(plantShareIn("trench", 0.3) >= 0.12, "always some plant food");
});
