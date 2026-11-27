import { test } from "node:test";
import assert from "node:assert/strict";
import { CIV_TIPS, TRIBE_TIPS, createStageCoach } from "../tutorials.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
/** Run a coach for some seconds and collect what it showed. */
function run(tips, seconds, ctx, { fresh = true, storage = memory() } = {}) {
  const shown = [];
  const coach = createStageCoach({ tips, key: "k", storage, fresh, toast: (text) => shown.push(text) });
  for (let t = 0; t < seconds; t += 0.1) coach.tick(0.1, () => ctx(t));
  return shown;
}

test("tips stay short: one line on a phone", () => {
  for (const tip of [...TRIBE_TIPS, ...CIV_TIPS]) {
    const texts = typeof tip.text === "function" ? ["meat", "plant", "omni"].map((diet) => tip.text({ diet, babyCost: 5 })) : typeof tip.text === "string" ? [tip.text] : Object.values(tip.text);
    for (const t of texts) assert.ok(t.length <= 52, tip.id + ": " + t);
  }
});

test("the Tribal Stage teaches its first steps one tip at a time", () => {
  const shown = run(TRIBE_TIPS, 240, (t) => ({ playing: true, selected: t > 30 ? 1 : 0, food: 10, babyCost: 5, diet: "omni", legacy: 2 }));
  assert.equal(shown.length, TRIBE_TIPS.length, "every tip, once");
  assert.match(shown[0], /look around/);
  assert.equal(new Set(shown).size, shown.length);
});

test("the coach waits while a sheet is open, and never runs for an old save", () => {
  assert.deepEqual(run(CIV_TIPS, 60, () => ({ playing: false })), []);
  assert.deepEqual(run(CIV_TIPS, 60, () => ({ playing: true }), { fresh: false }), []);
});

test("after a reload a fresh stage's coach carries on where it was", () => {
  const storage = memory();
  const first = run(CIV_TIPS, 20, () => ({ playing: true, selected: 0, cityOpened: false }), { storage });
  const rest = run(CIV_TIPS, 240, () => ({ playing: true, selected: 0, cityOpened: false }), { storage, fresh: false });
  assert.ok(first.length >= 1);
  // The tip on screen at the reload shows again; nothing else repeats.
  assert.equal(new Set([...first, ...rest]).size, CIV_TIPS.length);
  assert.ok(first.length + rest.length <= CIV_TIPS.length + 1);
  assert.deepEqual(run(CIV_TIPS, 60, () => ({ playing: true }), { storage, fresh: false }), [], "done for good");
});
