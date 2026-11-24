import test from "node:test";
import assert from "node:assert/strict";
import { project, sphereSamples, unproject, viewBasis } from "../civ/minimap.js";
import { EVENT_IDS, FIRST_EVENT_AT, WORLD_EVENTS, activeEffects, chooseEvent, nextEventIn, readEvents } from "../civ/events.js";
import { readCivSave } from "../civ/rules.js";

const close = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test("the minimap is a globe: what you look at is in the middle, the far side is hidden", () => {
  const f = { x: 0, y: 0, z: 1 },
    n = { x: 0, y: 1, z: 0 };
  const B = viewBasis(f, n);
  const mid = project(f, B);
  assert.ok(close(mid.x, 0) && close(mid.y, 0) && mid.front);
  const north = project({ x: 0, y: 1, z: 0.2 }, B);
  assert.ok(north.y > 0.9 && close(north.x, 0), "north is up");
  assert.equal(project({ x: 0, y: 0, z: -1 }, B).front, false, "the far side is hidden");
  // Tapping a point comes back to the same place on the sphere.
  for (const d of sphereSamples(50)) {
    const p = project(d, B);
    if (!p.front) continue;
    const back = unproject(p.x, p.y, B);
    assert.ok(close(back.x, d.x, 1e-6) && close(back.y, d.y, 1e-6) && close(back.z, d.z, 1e-6));
  }
  // A tap outside the disc lands on the rim; a degenerate "up" doesn't break it.
  const rim = unproject(3, 0, B);
  assert.ok(close(Math.hypot(rim.x, rim.y, rim.z), 1, 1e-9));
  assert.doesNotThrow(() => viewBasis(f, f));
  const B2 = viewBasis(f, f);
  assert.ok(close(B2.n.x * B2.f.x + B2.n.y * B2.f.y + B2.n.z * B2.f.z, 0));
});

test("sphere samples are spread evenly", () => {
  const s = sphereSamples(1000);
  const north = s.filter((d) => d.y > 0).length;
  assert.ok(Math.abs(north - 500) < 10);
  assert.ok(s.every((d) => close(Math.hypot(d.x, d.y, d.z), 1, 1e-9)));
});

const world = (o = {}) => ({
  time: 700,
  derricks: 2,
  routes: 2,
  wars: 0,
  yourType: "economic",
  cities: [
    { id: 0, name: "Home" },
    { id: 3, name: "Farport" },
  ],
  unhappy: null,
  rivals: [
    { id: "n0", name: "Ulani", war: false },
    { id: "n1", name: "Korr", war: true },
  ],
  ...o,
});

test("world events fit the world, never repeat back to back, and have real effects", () => {
  const r = rng(7);
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 400; i++) {
    const ev = chooseEvent(world(), last, r);
    assert.ok(ev, "something always fits a busy world");
    assert.notEqual(ev.id, last, "never the same twice in a row");
    assert.ok(ev.text && ev.title && ev.icon && ev.effect && Object.keys(ev.effect).length, ev.id + " does something");
    seen.add(ev.id);
    last = ev.id;
  }
  // Every kind but unrest (which needs an unhappy city) turns up in a busy world.
  for (const id of EVENT_IDS.filter((x) => x !== "unrest")) assert.ok(seen.has(id), id + " happens");
  const unhappy = world({ unhappy: { id: 3, name: "Farport" } });
  let unrest = 0;
  for (let i = 0; i < 200; i++) if (chooseEvent(unhappy, null, r)?.id === "unrest") unrest++;
  assert.ok(unrest > 10, "an unhappy city brings protests");
  const ev = WORLD_EVENTS.unrest.make(unhappy);
  assert.equal(ev.effect.city, 3);
  // A lonely world: no rivals, no derricks.
  const quiet = world({ rivals: [], derricks: 0, routes: 0, cities: [] });
  for (let i = 0; i < 50; i++) {
    const e = chooseEvent(quiet, null, r);
    assert.ok(!e || !["expansion", "breakthrough", "tension", "shift", "disaster"].includes(e.id));
  }
});

test("event pacing and running effects", () => {
  assert.ok(FIRST_EVENT_AT >= 180, "the first comes a few minutes in");
  for (let i = 0; i < 20; i++) {
    const g = nextEventIn(Math.random);
    assert.ok(g >= 150 && g <= 300);
  }
  const fx = activeEffects(
    [
      { until: 100, effect: { income: 1.25 } },
      { until: 50, effect: { spice: 0.6 } },
      { until: 100, effect: { happy: 1, price: 1.5 } },
    ],
    60,
  );
  assert.deepEqual(fx, { income: 1.25, spice: 1, price: 1.5, preach: 1, happy: 1 });
  assert.deepEqual(activeEffects(null, 0), { income: 1, spice: 1, price: 1, preach: 1, happy: 0 });
});

test("world events are saved, and old saves load without them", () => {
  const r = readEvents({ next: 900, last: "boom", count: 3, active: [{ id: "boom", until: 950, effect: { income: 1.25 } }, { id: "bogus", until: 1, effect: {} }, null] });
  assert.equal(r.next, 900);
  assert.equal(r.last, "boom");
  assert.equal(r.active.length, 1);
  assert.deepEqual(readEvents(undefined), { next: FIRST_EVENT_AT, last: null, active: [], count: 0 });
  const save = readCivSave({ cities: [{ id: 0, owner: "you", plots: [] }], nations: [] });
  assert.ok(save, "an old save still loads");
  assert.deepEqual(save.events, readEvents(null));
});
