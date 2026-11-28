import { test } from "node:test";
import assert from "node:assert/strict";
import { chaseStep, dodgeStep, lungeStep, newBrain, paceOf, staminaStep } from "../cell/brain.js";

const fixed = (v) => () => v;

test("sprinting drains stamina and an exhausted cell is slow until it recovers", () => {
  const b = newBrain(fixed(0.5));
  for (let i = 0; i < 60 * 8; i++) staminaStep(b, 1 / 60, true, 1);
  assert.equal(b.tired, true);
  assert.ok(paceOf(b, true) < 1, "tired cells are slower than normal");
  for (let i = 0; i < 60 * 10; i++) staminaStep(b, 1 / 60, false, 1);
  assert.equal(b.tired, false);
  assert.ok(paceOf(b, true) > 1.2, "rested cells sprint faster than normal");
});

test("a predator gives up a chase instead of tracking forever", () => {
  const b = newBrain(fixed(0.5));
  let now = 0,
    pursuing = true,
    t = 0;
  while (pursuing && t < 60) {
    now += 1 / 30;
    t += 1 / 30;
    pursuing = chaseStep(b, { dt: 1 / 30, now, dist: 3, sight: 12 }, fixed(0.5)).pursue;
  }
  assert.ok(!pursuing && t < 14, "gave up after " + t.toFixed(1) + "s");
  assert.equal(chaseStep(b, { dt: 1 / 30, now: now + 1, dist: 1, sight: 12 }, fixed(0.5)).pursue, false, "and ignores prey for a while");
  assert.equal(chaseStep(b, { dt: 1 / 30, now: now + 30, dist: 8, sight: 12 }, fixed(0.5)).pursue, true, "before taking an interest again");
});

test("a predator loses prey that gets well out of sight", () => {
  const b = newBrain(fixed(0.5));
  assert.equal(chaseStep(b, { dt: 0.1, now: 1, dist: 20, sight: 12 }, fixed(0.5)).pursue, false);
});

test("a lunge is committed, then the predator has to recover", () => {
  const b = newBrain(fixed(0.5));
  b.lungeCool = 0;
  assert.equal(lungeStep(b, { dt: 0.016, dist: 3, reach: 1, facing: 0.95 }, fixed(0.5)), true);
  let ticks = 0;
  while (lungeStep(b, { dt: 0.05, dist: 3, reach: 1, facing: 0.95 }, fixed(0.5)) && ticks < 100) ticks++;
  assert.ok(ticks >= 8 && ticks <= 11, "about half a second of lunge: " + ticks);
  assert.ok(b.recover > 0, "then recovering");
  assert.ok(paceOf(b, false) < 0.7, "slow while recovering: a chance to get away");
  assert.equal(lungeStep(b, { dt: 0.016, dist: 3, reach: 1, facing: 0.95 }, fixed(0.5)), false, "cannot lunge again straight away");
});

test("no lunge when facing away or too far", () => {
  const b = newBrain(fixed(0.5));
  b.lungeCool = 0;
  assert.equal(lungeStep(b, { dt: 0.016, dist: 3, reach: 1, facing: 0.2 }, fixed(0.5)), false);
  assert.equal(lungeStep(b, { dt: 0.016, dist: 20, reach: 1, facing: 0.99 }, fixed(0.5)), false);
});

test("prey sidestep a lunge and then can't repeat it at once", () => {
  const b = newBrain(fixed(0.5));
  const first = dodgeStep(b, { dt: 0.016, dist: 1.5, trigger: 3, lunging: true }, fixed(0.9));
  assert.equal(first.dodge, true);
  for (let i = 0; i < 40; i++) dodgeStep(b, { dt: 0.016, dist: 1.5, trigger: 3, lunging: true }, fixed(0.9));
  assert.equal(dodgeStep(b, { dt: 0.016, dist: 1.5, trigger: 3, lunging: true }, fixed(0.9)).dodge, false, "on cooldown");
  assert.equal(dodgeStep(newBrain(fixed(0.5)), { dt: 0.016, dist: 9, trigger: 3, lunging: true }).dodge, false, "no dodge from far away");
});
