import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CIV_SAVE_KEY,
  PLOTS,
  TYPE_IDS,
  YOU,
  allowedModes,
  buyoutCost,
  canReach,
  cityDefence,
  cityEconomy,
  cityName,
  civArchetype,
  civLegacy,
  civWon,
  damageCity,
  deliverTrade,
  dominantMethod,
  nationPlan,
  preachRate,
  preachTo,
  readCivSave,
  repairCity,
  starterVehicle,
  superUnlocked,
  tradeIncome,
  transferCity,
  vehicleUnit,
} from "../civ/rules.js";
import { validateModular } from "../creations/format.js";
import { vehicleMode } from "../creations/modular.js";

const city = (plots = [], extra = {}) => ({ id: 0, owner: YOU, type: "economic", plots: Array.from({ length: PLOTS }, (_, i) => plots[i] || null), turrets: 0, turretHp: 1, hallHp: 1, trade: {}, conv: {}, ...extra });

test("factories make money but upset people; fun and houses fix that", () => {
  const empty = cityEconomy(city());
  assert.ok(cityEconomy(city(["factory"])).income > empty.income);
  const factories = cityEconomy(city(["factory", "factory", "factory"]));
  assert.ok(factories.happiness < 0 && factories.riot, "three factories and nothing else riot");
  const balanced = cityEconomy(city(["factory", "factory", "fun", "house", "house"]));
  assert.ok(!balanced.riot && balanced.pop > empty.pop);
  // A riot cuts income hard.
  const riot = cityEconomy(city(["factory", "factory", "factory", "factory"]));
  const calm = cityEconomy(city(["factory", "factory", "factory", "factory"]), { happyBonus: 4 });
  assert.ok(calm.income > riot.income * 3);
});

test("better building designs do their job better", () => {
  const plain = cityEconomy(city(["factory", "fun"]), { strengths: { factory: 3 } });
  const good = cityEconomy(city(["factory", "fun"]), { strengths: { factory: 9 } });
  assert.ok(good.income > plain.income);
  assert.ok(cityDefence(city([], { turrets: 2 }), { turret: 9 }).turretHp > cityDefence(city([], { turrets: 2 }), { turret: 2 }).turretHp);
  assert.ok(cityEconomy(city(["temple", "temple"])).faith > cityEconomy(city()).faith);
});

test("turrets soak damage before the hall falls, and defences repair when left alone", () => {
  const c = city(["house"], { turrets: 2 });
  const def = cityDefence(c);
  let r = damageCity(c, def.turretHp * 0.5, def);
  assert.equal(c.hallHp, 1);
  assert.ok(!r.turretsDown);
  r = damageCity(c, def.turretHp * 0.5 + def.hallHp * 0.5, def);
  assert.ok(r.turretsDown && Math.abs(c.hallHp - 0.5) < 1e-9 && !r.captured);
  r = damageCity(c, def.hallHp, def);
  assert.ok(r.captured);
  const d = city([], { turrets: 1, turretHp: 0.2, hallHp: 0.4 });
  repairCity(d, 3);
  assert.equal(d.turretHp, 0.2, "no repair right after a hit");
  repairCity(d, 10);
  assert.ok(d.turretHp > 0.2 && d.hallHp > 0.4);
});

test("conversion, trade and buyouts", () => {
  const c = city([], { owner: "n0" });
  assert.equal(preachTo(c, YOU, 60), false);
  assert.equal(preachTo(c, YOU, 50), true);
  assert.ok(preachRate(4, 1) > preachRate(4, 5), "faith resists preaching");
  const t = city([], { owner: "n1" });
  assert.deepEqual(deliverTrade(t, YOU, 40), { newRoute: true, complete: false });
  assert.deepEqual(deliverTrade(t, YOU, 70), { newRoute: false, complete: true });
  const econ = cityEconomy(city(["house", "house"]));
  assert.ok(buyoutCost(econ, 60) < buyoutCost(econ, 0) && buyoutCost(econ, 0) < buyoutCost(econ, -30));
  transferCity(t, YOU, "economic");
  assert.equal(t.owner, YOU);
  assert.equal(t.trade[YOU], undefined);
  const other = city([], { owner: "n1", trade: { [YOU]: 40, n2: 10 } });
  transferCity(other, "n2", "economic");
  assert.deepEqual(other.trade, { [YOU]: 40 }, "your trade survives someone else's takeover");
  const war = city([], { owner: "n2" });
  transferCity(war, YOU, "military");
  assert.ok(war.unrest > 0 && war.hallHp < 1);
});

test("trade routes pay both partners", () => {
  const mine = city([], { trade: { n0: 30 } });
  const theirs = city([], { owner: "n0", trade: { [YOU]: 50 } });
  assert.equal(tradeIncome([mine, theirs], YOU), 1);
  assert.equal(tradeIncome([mine, theirs], "n0"), 1);
  assert.equal(tradeIncome([mine, theirs], "n9"), 0);
});

test("vehicles: every starter works in its role and mode, and stats follow the design", () => {
  for (const role of TYPE_IDS)
    for (const mode of ["land", "sea", "air"]) {
      const d = validateModular(starterVehicle(role, mode), "vehicle");
      assert.equal(vehicleMode(d), mode, role + " " + mode);
      const u = vehicleUnit(d);
      assert.ok(u.ok, role + " " + mode);
      assert.equal(u.role, role);
      assert.ok(u.speed > 0 && u.hp > 0 && u.cost > 0);
      assert.ok(role === "military" ? u.dps > 0 : role === "economic" ? u.trade > 0 : u.preach > 0);
    }
  const base = validateModular(starterVehicle("military", "land"), "vehicle");
  const armed = { ...base, parts: [...base.parts, { id: "cannonV", x: 0.4, y: 1.2, z: 0.8, mirror: true }] };
  assert.ok(vehicleUnit(armed).dps > vehicleUnit(base).dps);
  assert.ok(vehicleUnit(base, { damage: 0.15 }).dps > vehicleUnit(base).dps);
  assert.deepEqual(allowedModes(1, false), ["land"]);
  assert.deepEqual(allowedModes(3, true), ["land", "sea", "air"]);
  assert.ok(!canReach("sea", { coastal: false }) && canReach("air", { coastal: false }));
});

test("earlier stages shape the start", () => {
  assert.equal(civLegacy({ tribeTrait: "Warlike" }).startType, "military");
  assert.equal(civLegacy({ tribeTrait: "Diplomatic" }).startType, "religious");
  assert.equal(civLegacy({ tribeTrait: "Industrious" }).startType, "economic");
  const l = civLegacy({ cellDiet: "meat", creatureCard: "Social", tribeTrait: "Diplomatic" });
  assert.ok(l.mods.health > 0 && l.mods.social > 0 && l.mods.relation > 0);
  assert.equal(l.lines.length, 3);
  assert.equal(civLegacy({}).lines.length, 0);
});

test("rival nations act on their nature", () => {
  const seq = (v) => () => v;
  const base = { relation: 0, war: false, money: 500, vehicles: 0, cap: 3 };
  assert.ok(nationPlan({ ...base, type: "military" }, { yourCities: 1, freeCities: 0, rand: seq(0) }).build);
  assert.equal(nationPlan({ ...base, type: "military", money: 10 }, { yourCities: 1, freeCities: 0 }).build, false);
  // Military nations attack you only at war; hostile ones may declare it.
  assert.equal(nationPlan({ ...base, type: "military" }, { yourCities: 1, freeCities: 2, rand: seq(0.9) }).target, "free");
  const angry = nationPlan({ ...base, type: "military", relation: -60 }, { yourCities: 1, freeCities: 2, rand: seq(0.1) });
  assert.ok(angry.declareWar && angry.target === "you");
  // Religious nations preach to people they don't like; friends are left alone.
  assert.equal(nationPlan({ ...base, type: "religious", relation: 50 }, { yourCities: 2, freeCities: 0, rand: seq(0.1) }).target, null);
  assert.equal(nationPlan({ ...base, type: "religious", relation: -10 }, { yourCities: 2, freeCities: 0, rand: seq(0.1) }).target, "you");
  // Early on, nobody comes for your cities (traders still do).
  const early = { yourCities: 2, freeCities: 1, grace: true, rand: seq(0.1) };
  assert.equal(nationPlan({ ...base, type: "religious", relation: -10 }, early).target, "free");
  assert.equal(nationPlan({ ...base, type: "military", relation: -90 }, early).declareWar, false);
  assert.equal(nationPlan({ ...base, type: "economic" }, early).target, "you");
  assert.equal(nationPlan({ ...base, type: "economic" }, { yourCities: 1, freeCities: 0, rand: seq(0.9) }).target, "you");
});

test("superweapons, victory and the stage card", () => {
  assert.ok(!superUnlocked(4, 10) && superUnlocked(5, 10));
  assert.equal(dominantMethod({ military: 0, economic: 0, religious: 0 }, "religious"), "religious");
  assert.equal(dominantMethod({ military: 1, economic: 3, religious: 0 }, "military"), "economic");
  assert.equal(dominantMethod({ military: 2, economic: 2, religious: 0 }, "economic"), "economic", "ties go to where you started");
  assert.equal(civArchetype({ military: 4 }, "economic").name, "Military");
  assert.ok(civWon([{ owner: YOU }, { owner: YOU }]));
  assert.ok(!civWon([{ owner: YOU }, { owner: "n0" }]) && !civWon([]));
  assert.notEqual(cityName(1), cityName(2));
  assert.match(cityName(7), /^[A-Z][a-z]+$/);
});

test("saves are read safely", () => {
  assert.equal(CIV_SAVE_KEY, "johnny-spore-civ-stage");
  assert.equal(readCivSave("{bad"), null);
  assert.equal(readCivSave({ cities: [] }), null);
  assert.equal(readCivSave({ cities: [{ owner: "n0" }], nations: [{ id: "n0" }] }), null, "a save where you own nothing is no save");
  const s = readCivSave({
    money: 1e12,
    nations: [{ id: "n0", type: "military", relation: -500, war: 1 }, { id: "bad id!" }],
    cities: [{ id: 0, owner: YOU, type: "religious", plots: ["house", "lava", null, "factory"], turrets: 9, hallHp: 3, trade: { n0: 50, evil: 9 } }, { id: 1, owner: "intruder" }],
    vehicles: [{ owner: YOU, design: "military:land", x: 1e9, hp: 0.5 }, { owner: "x", design: "y" }],
    captures: { military: 2, economic: "x" },
    won: true,
    card: "religious",
  });
  assert.equal(s.money, 1e7);
  assert.equal(s.nations[0].relation, -100);
  assert.equal(s.nations[1].id, "n1");
  assert.deepEqual(s.cities[0].plots, ["house", null, null, "factory", null, null]);
  assert.equal(s.cities[0].turrets, 3);
  assert.equal(s.cities[0].hallHp, 1);
  assert.deepEqual(s.cities[0].trade, { n0: 50 });
  assert.equal(s.cities[1].owner, null);
  assert.equal(s.vehicles.length, 1);
  assert.equal(s.vehicles[0].x, 400);
  assert.deepEqual(s.captures, { military: 2, economic: 0, religious: 0 });
  assert.equal(s.card, "religious");
});
