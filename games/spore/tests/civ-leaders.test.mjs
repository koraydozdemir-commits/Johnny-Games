import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONALITIES, availableOptions, answer, cityPrice, incoming, leaderName, peacePrice, personalityFor, respond } from "../civ/leaders.js";
import { nationPlan } from "../civ/rules.js";

const ctx = (o = {}) => ({ personality: "cautious", relation: 0, war: false, met: true, allied: false, pact: false, power: 10, yourPower: 10, money: 200, yourMoney: 500, faith: 0, cities: 3, now: 100, cityPrice: 300, ...o });
const never = () => 0.99,
  always = () => 0;

test("every nation kind gets a fitting personality, and every leader a name", () => {
  for (const type of ["military", "economic", "religious"])
    for (let r = 0; r < 1; r += 0.1) {
      const p = personalityFor(type, r);
      assert.ok(PERSONALITIES[p], p);
      if (type === "military") assert.ok(p === "aggressive" || p === "cautious");
    }
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20; i++) assert.match(leaderName(rand), /^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
});

test("options depend on the situation: unmet, at war, allied, and how many cities they have", () => {
  assert.deepEqual(availableOptions(ctx({ met: false })).map((o) => o.id), ["introduce"]);
  assert.deepEqual(availableOptions(ctx({ war: true })).map((o) => o.id), ["peace", "gift"]);
  const allied = availableOptions(ctx({ allied: true })).map((o) => o.id);
  assert.ok(allied.includes("assist") && !allied.includes("alliance") && !allied.includes("threaten") && !allied.includes("demand"));
  assert.ok(!availableOptions(ctx({ cities: 1 })).some((o) => o.id === "buy"), "won't sell their last city");
  const poor = availableOptions(ctx({ yourMoney: 10 }));
  assert.equal(poor.find((o) => o.id === "gift").ok, false);
  assert.match(poor.find((o) => o.id === "gift").why, /§/);
  const soon = availableOptions(ctx({ allied: true, assistAt: 150 })).find((o) => o.id === "assist");
  assert.equal(soon.ok, false);
});

test("personalities answer differently, and agreements are real effects", () => {
  // Alliance: a friendly leader agrees at relations a cautious one doesn't.
  assert.equal(respond("alliance", ctx({ personality: "friendly", relation: 40 })).accept, true);
  assert.equal(respond("alliance", ctx({ personality: "cautious", relation: 40 })).accept, false);
  assert.equal(respond("alliance", ctx({ personality: "cautious", relation: 40, yourPower: 20 })).accept, true, "a strong friend tips the cautious");
  assert.deepEqual(respond("alliance", ctx({ personality: "friendly", relation: 40 })).effects.allied, true);
  // Trade agreement: the greedy sign almost anything.
  assert.equal(respond("pact", ctx({ personality: "greedy", relation: -5 })).accept, true);
  assert.equal(respond("pact", ctx({ personality: "aggressive", relation: -5 })).accept, false);
  // Threats: the cautious back down before a stronger nation; the aggressive fight.
  const cowed = respond("threaten", ctx({ yourPower: 30 }), never);
  assert.equal(cowed.accept, true);
  assert.ok(cowed.effects.cowed > 0);
  const angry = respond("threaten", ctx({ personality: "aggressive", yourPower: 30, relation: -20 }), never);
  assert.equal(angry.accept, false);
  assert.equal(angry.effects.war, true);
  // Demands: paid by the weak and cautious, never by the aggressive.
  const paid = respond("demand", ctx({ yourPower: 15, money: 200 }));
  assert.equal(paid.accept, true);
  assert.equal(paid.effects.money, 80);
  assert.equal(respond("demand", ctx({ personality: "aggressive", yourPower: 99 })).accept, false);
  // Peace: cheaper when they're losing; the aggressive won't stop while winning.
  assert.ok(peacePrice(ctx({ power: 5, yourPower: 20 })) < peacePrice(ctx({ power: 30, yourPower: 10 })));
  assert.equal(respond("peace", ctx({ personality: "aggressive", war: true, power: 40, yourPower: 10 })).accept, false);
  assert.equal(respond("peace", ctx({ war: true })).effects.peace, true);
  // Buying a city: the greedy sell cheaper; the aggressive only to friends.
  assert.ok(cityPrice({ pop: 10 }, { personality: "greedy", relation: 0 }) < cityPrice({ pop: 10 }, { personality: "aggressive", relation: 0 }));
  assert.equal(respond("buy", ctx({ personality: "aggressive", relation: 10 })).accept, false);
  const bought = respond("buy", ctx({ relation: 10 }));
  assert.equal(bought.accept, true);
  assert.equal(bought.effects.buy, true);
  assert.equal(bought.effects.money, -300);
  // Faith: a devout leader warms to believers and preaches at the rest.
  assert.ok(respond("beliefs", ctx({ personality: "religious", faith: 8 })).effects.relation > 0);
  assert.ok(respond("beliefs", ctx({ personality: "religious", faith: 0 })).effects.preach > 0);
  // Gifts mean more to the greedy.
  assert.ok(respond("gift", ctx({ personality: "greedy" })).effects.relation > respond("gift", ctx({ personality: "religious" })).effects.relation);
  assert.equal(respond("war", ctx()).effects.war, true);
});

test("leaders start conversations: first contact, offers, demands, peace", () => {
  assert.equal(incoming(ctx({ met: false, seen: false })), null, "nobody calls a nation they haven't come across");
  assert.equal(incoming(ctx({ met: false, seen: true })).kind, "greet");
  assert.equal(incoming(ctx({ personality: "friendly", relation: 50 }), always).kind, "alliance");
  assert.equal(incoming(ctx({ personality: "greedy", relation: 10, allied: true }), always).kind, "pact");
  const demand = incoming(ctx({ personality: "aggressive", relation: 0, power: 30, yourPower: 10, yourMoney: 300 }), always);
  assert.equal(demand.kind, "demand");
  const pay = demand.choices.find((c) => c.id === "accept").amount;
  assert.equal(answer(demand, "accept", ctx({ personality: "aggressive" })).effects.money, -pay);
  assert.equal(answer(demand, "decline", ctx({ personality: "aggressive", relation: -10 })).effects.war, true);
  assert.equal(answer(demand, "decline", ctx({ personality: "aggressive", relation: 20 })).effects.war, false, "refusing a friend is only an insult");
  assert.equal(incoming(ctx({ war: true, power: 5, yourPower: 20 }), always).kind, "peace");
  assert.equal(answer({ kind: "alliance", choices: [] }, "accept", ctx()).effects.allied, true);
});

test("personalities change what nations do, not just what they say", () => {
  const base = { type: "military", relation: -40, war: false, money: 0, vehicles: 0, cap: 3 };
  const world = { yourCities: 3, freeCities: 2, rand: always, power: 10, yourPower: 10 };
  assert.equal(nationPlan({ ...base, personality: "aggressive", warAt: PERSONALITIES.aggressive.warAt }, world).declareWar, true);
  assert.equal(nationPlan({ ...base, personality: "cautious", warAt: -30 }, world).declareWar, false, "a cautious leader won't start a war it might lose");
  assert.equal(nationPlan({ ...base, personality: "aggressive", warAt: -30, allied: true }, world).declareWar, false, "allies never attack you");
  assert.equal(nationPlan({ ...base, personality: "aggressive", warAt: -30, cowed: true }, world).declareWar, false);
  // An aggressive economic nation goes to war too.
  assert.equal(nationPlan({ ...base, type: "economic", personality: "aggressive", warAt: -30 }, world).declareWar, true);
  // A devout leader who means to convert you sends its missionaries your way.
  assert.equal(nationPlan({ ...base, type: "religious", relation: 20, personality: "religious", preachYou: true }, { ...world, rand: never }).target, "you");
});
