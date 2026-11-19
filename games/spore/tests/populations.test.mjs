import { test } from "node:test";
import assert from "node:assert/strict";
import { ECO_EVENTS, addEcoGroup, createEcology, ecoSituation, pickEcoEvent, preyFood, recordKill, saveEcology, startEcoEvent, stepEcology, sustainable } from "../creature/populations.js";

const seeded = (seed = 7) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};
const region = () => [
  { arch: "grazer", size: 5 },
  { arch: "smallPrey", size: 4 },
  { arch: "packHunter", size: 3 },
  { arch: "ambusher", size: 1 },
];
/** Run the ecology for `seconds`, in 5 s steps, collecting every action. */
const run = (e, seconds, spawned = () => false, rand = seeded()) => {
  const out = [];
  for (let t = 0; t < seconds; t += 5) out.push(...stepEcology(e, 5, spawned, rand));
  return out;
};

test("left alone, a region stays in balance: herds and hunters both persist", () => {
  const e = createEcology(region());
  e.nextIn = 1e9; // no events in this test
  const acts = run(e, 30 * 60);
  assert.ok(!acts.some((a) => a.type === "leave"), "nobody dies out: " + JSON.stringify(acts));
  for (const g of e.groups) assert.ok(g.pop >= 1, g.arch + " " + g.pop);
  assert.ok(preyFood(e) > 0.5);
});

test("overhunting thins a herd, drives it off its ground, and finally out", () => {
  const e = createEcology(region());
  e.nextIn = 1e9;
  const acts = [];
  // Kill a grazer every 20 seconds, faster than it can breed.
  for (let t = 0; t < 600 && !e.groups[0].gone; t += 20) {
    recordKill(e, 0, true);
    acts.push(...stepEcology(e, 20, () => true, seeded(t + 1)));
  }
  assert.ok(acts.some((a) => a.type === "migrate" && a.group === 0), "the herd moved away first");
  assert.ok(e.groups[0].gone, "then it left the area");
  assert.equal(sustainable(e.groups[0]), 0);
  assert.ok(acts.some((a) => a.type === "leave" && a.group === 0 && a.why === "hunted"));
});

test("a hunted-out herd comes back once the pressure is off", () => {
  const e = createEcology(region());
  e.nextIn = 1e9;
  e.groups[0].gone = true;
  e.groups[0].pop = 0;
  const acts = run(e, 25 * 60);
  assert.ok(acts.some((a) => a.type === "return" && a.group === 0));
  assert.equal(e.groups[0].gone, false);
});

test("hunters starve and leave when their prey is gone", () => {
  const e = createEcology(region());
  e.nextIn = 1e9;
  e.groups[0].gone = e.groups[1].gone = true;
  e.groups[0].pop = e.groups[1].pop = 0;
  e.groups[0].pressure = e.groups[1].pressure = 99; // and they stay gone
  const acts = run(e, 20 * 60);
  assert.ok(acts.some((a) => a.type === "leave" && a.group === 2 && a.why === "starved"));
});

test("seasons change the food, and with it the herds", () => {
  const lean = createEcology(region()),
    rich = createEcology(region());
  lean.nextIn = rich.nextIn = 1e9;
  lean.groups[0].pop = rich.groups[0].pop = 2;
  startEcoEvent(lean, "shortage", seeded());
  startEcoEvent(rich, "bloom", seeded());
  lean.event.t = rich.event.t = 1e9;
  run(lean, 240, () => true);
  run(rich, 240, () => true);
  assert.ok(lean.lush < 0.7 && rich.lush > 1.4, lean.lush + " " + rich.lush);
  assert.ok(rich.groups[0].pop > lean.groups[0].pop + 0.3, "plenty grows herds faster");
});

test("events fit the situation, never repeat back to back, and end", () => {
  const e = createEcology(region());
  const s = ecoSituation(e);
  assert.ok(ECO_EVENTS.clash.weight(s) > 0, "two predator groups can clash");
  const lone = createEcology([{ arch: "grazer", size: 5 }]);
  assert.equal(ECO_EVENTS.clash.weight(ecoSituation(lone)), 0, "no clash without two fighters");
  e.last = "bloom";
  const rand = seeded(3);
  for (let i = 0; i < 200; i++) assert.notEqual(pickEcoEvent(e, rand), "bloom");
  const start = startEcoEvent(e, "sickness", seeded());
  assert.equal(start.type, "start");
  assert.ok(e.groups[start.group].prey && e.groups[start.group].sick > 0);
  e.event.t = 1;
  const acts = stepEcology(e, 5);
  assert.ok(acts.some((a) => a.type === "end" && a.id === "sickness"));
  assert.equal(e.event, null);
  const arrival = startEcoEvent(e, "predators", seeded());
  assert.equal(arrival.arrive, "packHunter");
  assert.equal(e.event, null, "an arrival is instant, not an ongoing event");
});

test("the ecology saves and restores, and new groups can join", () => {
  const e = createEcology(region());
  recordKill(e, 0, true);
  e.groups[3].gone = true;
  addEcoGroup(e, "packHunter", 3);
  const saved = JSON.parse(JSON.stringify(saveEcology(e)));
  const back = createEcology([...region(), { arch: "packHunter", size: 3 }], saved);
  assert.equal(back.groups[0].pop, 4);
  assert.equal(back.groups[0].pressure, 1);
  assert.equal(back.groups[3].gone, true);
  assert.equal(back.groups.length, 5);
  const junk = createEcology(region(), { lush: "x", groups: [{ pop: -5 }, { pop: 999 }] });
  assert.equal(junk.lush, 1);
  assert.equal(junk.groups[0].pop, 0);
  assert.equal(junk.groups[1].pop, 6);
});
