import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGrip, jetStep, movementOf, spinStep } from "../cell/movement.js";

test("a flagellum gives the highest, steadiest top speed but turns wide", () => {
  const plain = movementOf(["filter"]),
    flag = movementOf(["filter", "flagellum"]),
    cilia = movementOf(["filter", "cilia"]);
  assert.ok(flag.top > plain.top * 1.4, "flagellum is clearly faster");
  assert.ok(flag.top > cilia.top);
  assert.ok(flag.turnMax < plain.turnMax && flag.turnMax < cilia.turnMax, "and turns wider");
  assert.equal(flag.constantThrust, true);
  assert.equal(cilia.constantThrust, false);
});

test("cilia turn faster, respond faster and grip the water", () => {
  const plain = movementOf(["filter"]),
    cilia = movementOf(["filter", "cilia"]);
  assert.ok(cilia.turnMax > plain.turnMax * 1.5);
  assert.ok(cilia.turnResponse > plain.turnResponse);
  assert.ok(cilia.grip > plain.grip);
  assert.ok(cilia.top > plain.top, "and a little faster");
  assert.ok(cilia.top < movementOf(["filter", "flagellum"]).top);
});

test("a jet is a movement part with automatic bursts, and no other cell has them", () => {
  assert.equal(movementOf(["filter", "cilia"]).jet, null);
  const m = movementOf(["filter", "jet"]);
  assert.ok(m.jet && m.jet.power > 0);
  let timer = 0,
    fired = 0;
  for (let i = 0; i < 600; i++) {
    const r = jetStep(timer, 1 / 60, 1, m.jet);
    timer = r.timer;
    if (r.fired) fired++;
  }
  assert.ok(fired >= 5 && fired <= 10, "about one burst every second and a half: " + fired);
  assert.equal(jetStep(0, 0.1, 0, m.jet).fired, false, "no bursts while drifting");
});

test("spin has inertia: it builds up rather than snapping", () => {
  let spin = 0;
  spin = spinStep(spin, 2, 3, 1 / 60);
  assert.ok(spin > 0 && spin < 0.2);
  for (let i = 0; i < 300; i++) spin = spinStep(spin, 2, 3, 1 / 60);
  assert.ok(Math.abs(spin - 2) < 0.01);
});

test("grip sheds sideways drift faster than forward speed", () => {
  const v = { x: 1, y: 1 };
  applyGrip(v, 0, 3, 0.5); // heading along x: x is forward, y is sideways
  assert.equal(v.x, 1);
  assert.ok(v.y < 0.3);
});

test("bigger cells are faster in absolute terms", () => {
  assert.ok(movementOf(["filter"], { size: 3 }).top > movementOf(["filter"], { size: 1 }).top * 1.5);
});
