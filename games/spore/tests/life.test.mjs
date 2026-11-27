import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOBS,
  activityWeights,
  dayPhase,
  expeditionCheck,
  foodMood,
  foodSources,
  forageKinds,
  jobsFor,
  pickActivity,
  readLife,
  speciesStyle,
  topActivity,
  tribePersonality,
  villagePlan,
} from "../tribe/life.js";
import { readTribeSave } from "../tribe/rules.js";

const all = { hunt: true, fish: true, fruit: true, forage: true };
const base = { job: "free", diet: "omni", phase: "day", mood: "ok", priority: "balanced", available: all };
const share = (w, keys) => keys.reduce((a, k) => a + (w[k] || 0), 0) / Object.values(w).reduce((a, v) => a + v, 0);
const FOOD = ["hunt", "fish", "fruit", "forage", "haul"];

test("a loose daily routine from the world clock", () => {
  assert.equal(dayPhase(0.01), "dawn");
  assert.equal(dayPhase(0.25), "day");
  assert.equal(dayPhase(0.55), "evening");
  assert.equal(dayPhase(0.8), "night");
  assert.equal(dayPhase(0.98), "dawn");
  assert.equal(dayPhase(-0.2), "night", "wraps");
});

test("food mood reads the stores against the mouths to feed", () => {
  assert.equal(foodMood(3, 5), "short");
  assert.equal(foodMood(20, 5), "ok");
  assert.equal(foodMood(60, 5), "plenty");
  assert.equal(foodMood(25, 1), "ok", "plenty needs a real stock, not just few mouths");
});

test("diet decides the food sources and the jobs on offer, as before", () => {
  assert.deepEqual(foodSources("plant"), ["fruit", "forage"]);
  assert.deepEqual(foodSources("meat"), ["hunt", "fish", "forage"]);
  assert.equal(foodSources("omni").length, 4);
  assert.ok(!jobsFor("plant").includes("hunt") && !jobsFor("plant").includes("fish"));
  assert.ok(jobsFor("meat").includes("gather"), "meat eaters forage for grubs and eggs");
  assert.deepEqual(forageKinds("meat").filter((k) => k !== "grubs" && k !== "eggs"), []);
  for (const j of ["free", "gather", "guard"]) assert.ok(JOBS[j], "older saves' roles still mean something");
});

test("hungry tribes go out for food; plentiful ones socialise more", () => {
  const short = activityWeights({ ...base, mood: "short" });
  const plenty = activityWeights({ ...base, mood: "plenty" });
  assert.ok(share(short, FOOD) > 0.7, "short of food: most choices are food");
  assert.ok(share(plenty, ["social", "play", "campfire"]) > share(short, ["social", "play", "campfire"]) * 3);
});

test("night is for sleeping (with a watch kept), evening for the fire", () => {
  const night = activityWeights({ ...base, phase: "night" });
  assert.equal(topActivity(night), "sleep");
  assert.ok(share(night, FOOD) < 0.05);
  const guard = activityWeights({ ...base, job: "guard", phase: "night" });
  assert.ok(share(guard, ["watch", "patrol", "campfire"]) > share(guard, ["sleep"]), "defenders keep watch");
  const eve = activityWeights({ ...base, phase: "evening" });
  assert.ok(share(eve, ["campfire", "social"]) > share(eve, FOOD), "evening: back to the fire");
  // Short of food, some still work at night.
  assert.ok(share(activityWeights({ ...base, phase: "night", mood: "short" }), FOOD) > share(night, FOOD) * 3);
});

test("jobs are priorities, food priorities steer the unassigned", () => {
  const fisher = activityWeights({ ...base, job: "fish" });
  assert.equal(topActivity(fisher), "fish");
  const gatherer = activityWeights({ ...base, job: "gather" });
  assert.ok(gatherer.fruit > gatherer.hunt && gatherer.forage > gatherer.fish, "gatherers pick fruit and forage");
  const freeHunt = activityWeights({ ...base, priority: "hunt" });
  assert.equal(topActivity(freeHunt), "hunt");
  assert.ok(share(freeHunt, ["hunt"]) > share(activityWeights(base), ["hunt"]) * 2);
  const guard = activityWeights({ ...base, job: "guard" });
  assert.ok(["patrol", "watch"].includes(topActivity(guard)));
  // A fisher told to prioritise hunting leans that way but still fishes too.
  const f2 = activityWeights({ ...base, job: "fish", priority: "hunt" });
  assert.ok(f2.hunt > fisher.hunt && f2.fish > 0);
});

test("nothing far away when called home, and nothing out of reach is chosen", () => {
  const held = activityWeights({ ...base, homeHold: true, mood: "short" });
  assert.equal(share(held, FOOD), 0);
  const noFish = activityWeights({ ...base, available: { ...all, fish: false } });
  assert.equal(noFish.fish, undefined);
  const herb = activityWeights({ ...base, diet: "plant", priority: "hunt", available: { ...all, haul: true } });
  assert.equal(herb.hunt, undefined);
  assert.equal(herb.haul, undefined, "plant eaters leave carcasses alone");
  assert.equal(herb.fish, undefined);
});

test("crowding spreads the tribe across food sources", () => {
  const w0 = activityWeights(base),
    w1 = activityWeights({ ...base, busy: { fish: 5 } });
  assert.ok(w1.fish < w0.fish / 2);
});

test("children stay home and play", () => {
  const w = activityWeights({ ...base, child: true, mood: "short" });
  assert.equal(share(w, FOOD), 0);
  assert.equal(topActivity(w), "play");
});

test("picking is proportional and always valid", () => {
  const counts = {};
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const k = pickActivity({ a: 3, b: 1 }, rand);
    counts[k] = (counts[k] || 0) + 1;
  }
  assert.ok(counts.a > counts.b * 2 && counts.b > 300);
  assert.equal(pickActivity({}), null);
});

test("expeditions turn for home before anyone is stranded", () => {
  const ok = { t: 20, range: 40, threat: false, phase: "day", weakest: 0.9, left: 3 };
  assert.equal(expeditionCheck(ok), null);
  assert.equal(expeditionCheck({ ...ok, threat: true }), "threat");
  assert.equal(expeditionCheck({ ...ok, phase: "night" }), "night");
  assert.equal(expeditionCheck({ ...ok, weakest: 0.2 }), "hurt");
  assert.equal(expeditionCheck({ ...ok, t: 999 }), "time");
  assert.equal(expeditionCheck({ ...ok, range: 400 }), "far");
});

test("the village grows with the tribe, and only builds what it needs", () => {
  const small = villagePlan(3),
    mid = villagePlan(8, { weapons: true }),
    big = villagePlan(14, { weapons: true, houses: 1 });
  assert.equal(small.shelters, 0, "the chief's hut sleeps a small tribe");
  assert.ok(mid.shelters > 0 && big.shelters > mid.shelters);
  assert.ok(big.storage > small.storage && big.seats > small.seats);
  assert.equal(small.rack, false);
  assert.equal(mid.rack, true);
  assert.equal(small.training, false);
  assert.ok(big.fence > 0 && small.fence === 0);
  assert.ok(villagePlan(14, { houses: 3 }).shelters < villagePlan(14).shelters, "dwellings take sleepers off the shelters");
  assert.equal(villagePlan(6, { style: { herbivore: true } }).garden, 1);
  assert.equal(villagePlan(6).garden, 0);
});

const rec = (over) => ({ diet: "omni", dims: { length: 3.6, height: 1.8 }, arms: 1, parts: [], abilities: {}, colors: { base: 0x336699, pattern: 0x99ccff, accent: 0xffcc00 }, ...over });
test("two species build two different villages", () => {
  const pred = speciesStyle(rec({ diet: "meat", parts: ["horns"] }));
  const herb = speciesStyle(rec({ diet: "plant" }));
  assert.ok(pred.predatory && pred.decor.includes("skulls") && pred.spiky && pred.shelter === "tent");
  assert.ok(herb.herbivore && herb.decor.includes("garden") && herb.shelter === "leaf");
  const tiny = speciesStyle(rec({ dims: { length: 1.6, height: 1 } })),
    huge = speciesStyle(rec({ dims: { length: 5.5, height: 2.6 } }));
  assert.equal(tiny.size, "small");
  assert.equal(huge.size, "large");
  assert.ok(tiny.scale < 1 && huge.scale > 1 && tiny.spacing < huge.spacing);
  assert.equal(speciesStyle(rec({ arms: 0 })).shelter, "mound", "no arms: dug dens, not built huts");
  const social = speciesStyle(rec({ legacy: ["Social"] }));
  assert.ok(social.social && social.decor.includes("streamers"));
  assert.equal(herb.colors.main, 0x336699);
});

test("a character grows out of how the tribe lives", () => {
  assert.equal(tribePersonality({}).leaning, null, "a young tribe has none yet");
  assert.equal(tribePersonality({ kills: 6, conquests: 1 }).leaning, "aggressive");
  assert.equal(tribePersonality({ allies: 1, songs: 4 }).leaning, "peaceful");
  assert.equal(tribePersonality({ guardTime: 600 }).leaning, "defensive");
  assert.equal(tribePersonality({ plentyTime: 900 }).leaning, "prosperous");
  assert.ok(tribePersonality({ kills: 40 }).scores.aggressive <= 1);
});

test("saves: new fields are read safely, old saves gain defaults", () => {
  const life = readLife({ priority: "fish", culture: { kills: "7", nonsense: 3 }, auto: [{ id: "shelter", x: 3, z: 4, k: 1 }, { id: "castle", x: 1, z: 1 }, { id: "rack", x: "no", z: 1 }] });
  assert.equal(life.priority, "fish");
  assert.equal(life.culture.kills, 7);
  assert.equal(life.culture.nonsense, undefined);
  assert.equal(life.auto.length, 1);
  assert.equal(readLife({ priority: "nap" }).priority, "balanced");
  const old = readTribeSave({ food: 5, units: [{ chief: true, role: "gather" }, { role: "guard" }, { role: "hunt" }, { role: "chef" }], structures: [{ id: "lookout", x: 1, z: 2 }] });
  assert.deepEqual(old.units.map((u) => u.role), ["gather", "guard", "hunt", "free"]);
  assert.equal(old.priority, "balanced");
  assert.deepEqual(old.auto, []);
  assert.equal(old.structures[0].id, "lookout");
});

test("someone with a job keeps at it by day, even with the stores stocked", () => {
  const gatherer = activityWeights({ ...base, job: "gather", mood: "plenty" });
  assert.ok(share(gatherer, ["fruit", "forage"]) > 0.5, "a gatherer mostly gathers: " + share(gatherer, ["fruit", "forage"]).toFixed(2));
  const fisher = activityWeights({ ...base, job: "fish", mood: "plenty" });
  assert.equal(topActivity(fisher), "fish");
  // Overflowing stores and night still ease them off.
  assert.ok(share(activityWeights({ ...base, job: "gather", mood: "plenty", full: true }), ["fruit", "forage"]) < share(gatherer, ["fruit", "forage"]));
  assert.equal(topActivity(activityWeights({ ...base, job: "gather", phase: "night", mood: "plenty" })), "sleep");
  // The unassigned still relax when there's plenty.
  assert.ok(share(activityWeights({ ...base, mood: "plenty" }), ["fruit", "forage"]) < 0.3);
});
