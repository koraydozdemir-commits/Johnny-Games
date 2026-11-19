import { test } from "node:test";
import assert from "node:assert/strict";
import { cityPower, planNation, strengthOf } from "../civ/ai.js";
import { createDiplomacy, declareWar, makeAlliance, YOU } from "../civ/diplomacy.js";

const city = (id, owner, extra = {}) => ({ id, owner, type: "economic", plots: ["house", null, null, null, null, null], turrets: 1, hall: 1, hallHp: 1, turretHp: 1, faith: 2, coastal: false, continent: 0, trade: {}, conv: {}, ...extra });
const nations = [{ id: "n0", type: "military" }, { id: "n1", type: "economic" }, { id: "n2", type: "religious" }];
function world(over = {}) {
  const cities = over.cities || [city(0, YOU), city(1, "n0"), city(2, "n1"), city(3, "n2"), city(4, null, { turrets: 0, hallHp: 0.4 }), city(5, null, { turrets: 3, faith: 6 })];
  const dip = over.dip || createDiplomacy(nations, { n0: -20, n1: 10, n2: 0 });
  return {
    time: 600,
    grace: false,
    dip,
    cities,
    geysers: [],
    nations: [{ id: YOU, type: "economic", alive: true, strength: 6, cities: 1 }, ...nations.map((n) => ({ ...n, alive: true, strength: strengthOf(cities.filter((c) => c.owner === n.id), 2), cities: cities.filter((c) => c.owner === n.id).length }))],
    buyoutCost: () => 200,
    vehicleCost: 110,
    rand: () => 0.05,
    ...over,
  };
}
const me = (id, type, money = 500, extra = {}) => ({ id, type, money, vehicles: 1, cap: 3, cities: [city(1, id, { type, plots: [null, null, null, null, null, null] })], ...extra });
const kinds = (list) => list.map((i) => i.k);

test("a city's power counts turrets and walls", () => {
  assert.ok(cityPower(city(0, "n0", { turrets: 3 })) > cityPower(city(0, "n0", { turrets: 0 })));
  assert.ok(cityPower(city(0, "n0", { hallHp: 0.2 })) < cityPower(city(0, "n0")));
  assert.ok(strengthOf([city(0, "n0")], 5) > strengthOf([city(0, "n0")], 0));
});

test("the militarist attacks the weakest city it can reach, and builds soldiers and defences", () => {
  const w = world();
  const plan = planNation(me("n0", "military"), w);
  const target = plan.find((i) => i.k === "target");
  assert.equal(target.kind, "attack");
  assert.equal(target.city, 4, "the broken independent city is the easiest prey");
  assert.ok(kinds(plan).includes("vehicle"), "it keeps making vehicles");
  assert.ok(plan.some((i) => i.k === "build" && i.role === "factory"), "factories first");
});

test("at war, the militarist goes for the enemy's cities, not the independents'", () => {
  const dip = createDiplomacy(nations, { n0: -20, n1: 10, n2: 0 });
  declareWar(dip, "n0", "n2");
  const plan = planNation(me("n0", "military"), world({ dip }));
  assert.equal(plan.find((i) => i.k === "target").city, 3);
});

test("the militarist picks a fight with a weaker neighbour, not in the early grace, and not an ally", () => {
  const w = world();
  w.nations.find((n) => n.id === "n1").strength = 1;
  assert.ok(planNation(me("n0", "military", 500, { vehicles: 3 }), w).some((i) => i.k === "war" && i.on === "n1"));
  assert.ok(!planNation(me("n0", "military", 500, { vehicles: 1 }), w).some((i) => i.k === "war"), "not before it has an army");
  assert.ok(!planNation(me("n0", "military"), { ...w, grace: true }).some((i) => i.k === "war"), "no wars in the grace period");
  const dip = createDiplomacy(nations, { n0: -20, n1: 80, n2: 0 });
  makeAlliance(dip, "n0", "n1");
  w.dip = dip;
  w.nations.find((n) => n.id === "n2").strength = 99;
  assert.ok(!planNation(me("n0", "military"), w).some((i) => i.k === "war" && i.on === "n1"), "never against an ally");
});

test("a militarist losing a war asks for peace; a winner does not", () => {
  const dip = createDiplomacy(nations, { n0: -20, n1: 10, n2: 0 });
  declareWar(dip, "n0", "n2");
  const w = world({ dip });
  w.nations.find((n) => n.id === "n2").strength = 999;
  assert.ok(planNation(me("n0", "military"), w).some((i) => i.k === "peace" && i.with === "n2"));
  w.nations.find((n) => n.id === "n2").strength = 1;
  assert.ok(!planNation(me("n0", "military"), w).some((i) => i.k === "peace"));
});

test("the zealot converts the weakest faith, builds temples, and does not preach to the devout", () => {
  const cities = [city(0, YOU), city(1, "n2", { type: "religious" }), city(4, null, { faith: 2 }), city(5, null, { faith: 7 })];
  const w = world({ cities });
  const plan = planNation(me("n2", "religious"), w);
  const target = plan.find((i) => i.k === "target");
  assert.equal(target.kind, "convert");
  assert.equal(target.city, 4, "the independent city with the weakest faith");
  assert.ok(plan.some((i) => i.k === "build" && i.role === "temple"), "temples first");
  const devout = world({ cities: [city(0, YOU, { devout: true, faith: 9 }), city(1, "n2", { type: "religious" })] });
  const t2 = planNation(me("n2", "religious"), devout).find((i) => i.k === "target");
  assert.ok(t2, "still has someone to preach to");
});

test("a converted city is answered: temples and missionaries sent back", () => {
  const mine = { ...me("n2", "religious", 300), cities: [city(1, "n2", { type: "religious", conv: { you: 60 }, threatened: "religious" })] };
  const plan = planNation(mine, world());
  assert.ok(plan.some((i) => i.k === "build" && i.role === "temple" && i.city === 1));
  assert.ok(plan.some((i) => i.k === "counter" && i.city === 1));
  const raided = { ...me("n0", "military", 300), cities: [city(1, "n0", { threatened: "military", turrets: 1 })] };
  const plan2 = planNation(raided, world());
  assert.ok(plan2.some((i) => i.k === "turret") && plan2.some((i) => i.k === "defend"));
});

test("the merchant makes deals, keeps money back, buys ready cities and never starts a war", () => {
  const cities = [city(0, YOU, { trade: { n1: 100 } }), city(2, "n1"), city(4, null)];
  const w = world({ cities, rand: () => 0.01 });
  const plan = planNation(me("n1", "economic", 900, { cities: [city(2, "n1")] }), w);
  assert.ok(plan.some((i) => i.k === "deal"), "agreements with the others");
  assert.ok(plan.some((i) => i.k === "buy" && i.city === 0), "buys the city whose trade is complete");
  assert.ok(!plan.some((i) => i.k === "war"), "never starts a war");
  const poor = planNation(me("n1", "economic", 150, { cities: [city(2, "n1")] }), w);
  assert.ok(!poor.some((i) => i.k === "build" || i.k === "vehicle" || i.k === "hall"), "a poor merchant saves rather than spends");
  // At war it asks for peace.
  const dip = createDiplomacy(nations, { n0: -20, n1: 10, n2: 0 });
  declareWar(dip, "n1", "n0");
  assert.ok(planNation(me("n1", "economic"), world({ dip, rand: () => 0.01 })).some((i) => i.k === "peace" && i.with === "n0"));
  // Wealthy merchants make you offers.
  const offers = planNation(me("n1", "economic", 900), world({ cities: [city(0, YOU), city(7, YOU), city(2, "n1")], rand: () => 0.01 })).filter((i) => i.k === "offer");
  assert.ok(offers.some((o) => o.kind === "buyout" && o.amount > 0));
});

test("personalities differ: the same world gives each nation its own plan", () => {
  const w = world();
  const shapes = ["n0", "n1", "n2"].map((id, i) => JSON.stringify(planNation(me(id, nations[i].type, 500), w).map((x) => x.k + ":" + (x.kind || x.role || ""))));
  assert.equal(new Set(shapes).size, 3, shapes.join("\n"));
});

test("the militarist demands tribute from a weak neighbour it dislikes; friends offer alliances and deals", () => {
  const w = world({ rand: () => 0.01, youVehicles: 0 });
  w.nations.find((n) => n.id === "n0").strength = 80;
  const mil = planNation({ ...me("n0", "military", 500), cities: [city(1, "n0", { turrets: 3 }), city(8, "n0", { turrets: 3 })] }, w);
  assert.ok(mil.some((i) => i.k === "offer" && i.kind === "tribute"));
  const dip = createDiplomacy(nations, { n0: -20, n1: 70, n2: 0 });
  const eco = planNation(me("n1", "economic", 500), world({ dip, rand: () => 0.01 }));
  assert.ok(eco.some((i) => i.k === "offer" && i.kind === "alliance"), "a friend proposes an alliance");
});

test("everyone leans on a nation that is taking over the planet", () => {
  const cities = [city(0, YOU), city(1, "n1"), city(2, "n1"), city(3, "n1"), city(4, "n1"), city(5, "n0"), city(6, "n2"), city(7, null)];
  const w = world({ cities, rand: () => 0.01 });
  w.nations.find((n) => n.id === "n1").strength = 15;
  const mil = planNation(me("n0", "military", 500, { vehicles: 4, cities: [city(5, "n0")] }), w);
  assert.ok(mil.some((i) => i.k === "war" && i.on === "n1" && /leader/.test(i.why)), "the militarist goes for the leader");
  const rel = planNation(me("n2", "religious", 500, { cities: [city(6, "n2", { type: "religious" })] }), w);
  assert.equal(rel.find((i) => i.k === "target").city > 0, true);
  // A merchant past half the planet stops buying.
  const rich = [city(0, YOU, { trade: { n1: 100 } }), ...[1, 2, 3, 4, 5].map((i) => city(i, "n1"))];
  const eco = planNation(me("n1", "economic", 3000, { cities: rich.filter((c) => c.owner === "n1") }), world({ cities: rich, rand: () => 0.01 }));
  assert.ok(!eco.some((i) => i.k === "buy"), "no monopoly");
});
