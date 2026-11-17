import { test } from "node:test";
import assert from "node:assert/strict";
import { leadTarget, resolveCollisions, steerHeading, wrapAngle } from "../cell-physics.js";

const body = (x, y, r = 0.5, mass = 1, vx = 0, vy = 0) => ({ pos: { x, y }, vel: { x: vx, y: vy }, r, mass });

test("four stacked cells end up not overlapping", () => {
  const cells = [body(0, 0), body(0, 0), body(0.01, 0), body(0, 0.01)];
  for (let i = 0; i < 30; i++) resolveCollisions(cells);
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const d = Math.hypot(cells[i].pos.x - cells[j].pos.x, cells[i].pos.y - cells[j].pos.y);
      assert.ok(d >= cells[i].r + cells[j].r - 1e-3, `cells ${i} and ${j} overlap (${d.toFixed(3)})`);
    }
});

test("a heavy cell barely moves when a light one bumps it", () => {
  const big = body(0, 0, 1, 10),
    small = body(1.4, 0, 0.5, 1, -2, 0);
  resolveCollisions([big, small]);
  assert.ok(Math.abs(big.pos.x) < Math.abs(small.pos.x - 1.4), "the light cell takes most of the push");
  assert.ok(small.vel.x > -2, "the light cell is slowed or bounced");
});

test("steering turns gradually instead of snapping", () => {
  const vel = { x: 0, y: 0 };
  const h = steerHeading(vel, 0, -5, 0, 0.1, { turnRate: 2 });
  assert.ok(Math.abs(h - 0.2) < 1e-6 || Math.abs(h + 0.2) < 1e-6, "turns at most turnRate*dt");
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
});

test("predators aim ahead of moving prey", () => {
  const aim = leadTarget({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 2 }, 2);
  assert.ok(aim.y > 0);
});

import { capsuleGap, pointCapsuleGap } from "../cell-physics.js";
test("capsule hitboxes cover the whole length of a long cell", () => {
  const long = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, r: 0.3, half: 1, angle: 0, mass: 1 };
  // A point near the tail end touches the cell even though it's far from the centre.
  assert.ok(pointCapsuleGap(-1.2, 0, long) < 0);
  assert.ok(pointCapsuleGap(0, 0.5, long) > 0);
  const other = { pos: { x: 1.2, y: 0.5 }, r: 0.3, half: 0, angle: 0 };
  assert.ok(capsuleGap(long, other) < 0.05, "a cell bumping the head end counts as touching");
});
test("long cells side by side are pushed apart along their length", () => {
  const a = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, r: 0.3, half: 1, angle: 0, mass: 1 };
  const b = { pos: { x: 0.9, y: 0.4 }, vel: { x: 0, y: 0 }, r: 0.3, half: 1, angle: 0, mass: 1 };
  for (let i = 0; i < 20; i++) resolveCollisions([a, b]);
  assert.ok(capsuleGap(a, b) > -1e-3);
});
