import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLY_AT, DEAL_INCOME, PERSONALITY, YOU, accepts, alliesOf, allied, atWar, baseRelation, bump, canAlly, canDeal, cannotDeclare, createDiplomacy, dealIncomeOf, declareWar, endAlliance, hasDeal, joiners, makeAlliance, makeDeal, makeOffer, makePeace, pairKey, react, readDiplomacy, rel, relationWord, setRel, settle, soureAlliances, tributeDemand, warsOf } from "../civ/diplomacy.js";

const nations = [{ id: "n0", type: "military" }, { id: "n1", type: "economic" }, { id: "n2", type: "religious" }];
const fresh = () => createDiplomacy(nations, { n0: -20, n1: 10, n2: 0 });
const typeOf = (id) => nations.find((n) => n.id === id).type;

test("every pair has a feeling to begin with, shaped by what each nation is", () => {
  const d = fresh();
  assert.equal(pairKey("n1", "n0"), pairKey("n0", "n1"));
  assert.equal(rel(d, YOU, "n0"), -20);
  assert.equal(rel(d, "n0", "n2"), baseRelation("military", "religious"));
  assert.ok(rel(d, "n0", "n2") < 0, "militarists and zealots despise each other");
  assert.ok(baseRelation("economic", "economic") > 0, "merchants like merchants");
  assert.ok(PERSONALITY.economic.peace > PERSONALITY.military.peace && PERSONALITY.military.aggression > PERSONALITY.economic.aggression);
});

test("war, peace and alliances change what is possible", () => {
  const d = fresh();
  assert.equal(cannotDeclare(d, YOU, "n0"), "");
  declareWar(d, YOU, "n0");
  assert.ok(atWar(d, YOU, "n0") && rel(d, YOU, "n0") <= -30);
  assert.match(cannotDeclare(d, YOU, "n0"), /already/i);
  assert.equal(accepts(d, nations[0], "deal"), false, "no deals during a war");
  makePeace(d, YOU, "n0");
  assert.ok(!atWar(d, YOU, "n0") && rel(d, YOU, "n0") >= -10);
  // An alliance needs warm feelings.
  assert.equal(canAlly(d, YOU, "n1"), false);
  setRel(d, YOU, "n1", ALLY_AT);
  assert.ok(canAlly(d, YOU, "n1"));
  makeAlliance(d, YOU, "n1");
  assert.ok(allied(d, YOU, "n1") && alliesOf(d, YOU).join() === "n1");
  assert.match(cannotDeclare(d, YOU, "n1"), /ally/i);
  assert.equal(relationWord(d, YOU, "n1"), "Allied");
  // Going to war ends it.
  declareWar(d, YOU, "n1");
  assert.ok(!allied(d, YOU, "n1") && atWar(d, YOU, "n1"));
  assert.deepEqual(warsOf(d, YOU).sort(), ["n1"]);
});

test("trade agreements pay both sides while they last, and stop in a war", () => {
  const d = fresh();
  assert.ok(canDeal(d, YOU, "n1"));
  makeDeal(d, YOU, "n1");
  assert.ok(hasDeal(d, YOU, "n1") && rel(d, YOU, "n1") > 10);
  const pay = dealIncomeOf(d, YOU, ["n0", "n1", "n2"]);
  assert.ok(pay >= DEAL_INCOME);
  assert.equal(dealIncomeOf(d, YOU, ["n0", "n2"]), 0, "a nation that has fallen pays nothing");
  assert.equal(dealIncomeOf(d, "n1", [YOU, "n0"]), pay, "both sides are paid alike");
  declareWar(d, YOU, "n1");
  assert.ok(!hasDeal(d, YOU, "n1"), "war ends the deal");
  assert.equal(dealIncomeOf(d, YOU, ["n1"]), 0);
  // An alliance pays more.
  const e = fresh();
  makeDeal(e, YOU, "n1");
  const plain = dealIncomeOf(e, YOU, ["n1"]);
  setRel(e, YOU, "n1", 70);
  makeAlliance(e, YOU, "n1");
  assert.ok(dealIncomeOf(e, YOU, ["n1"]) > plain);
});

test("proposals: friends and the peaceable say yes, enemies and the bellicose do not", () => {
  const d = fresh();
  assert.equal(accepts(d, nations[1], "gift"), true);
  assert.equal(accepts(d, nations[1], "deal"), true, "the merchant likes a deal");
  assert.equal(accepts(d, nations[0], "deal"), false, "the militarist (-20) wants none");
  setRel(d, YOU, "n2", 70);
  assert.equal(accepts(d, nations[2], "alliance", 0.1), true);
  assert.equal(accepts(d, nations[2], "alliance", 0.99), false, "even friends sometimes refuse");
  declareWar(d, YOU, "n0");
  const merchantPeace = fresh();
  declareWar(merchantPeace, YOU, "n1");
  assert.ok(accepts(merchantPeace, nations[1], "peace", 0.3), "a merchant takes peace readily");
  assert.equal(accepts(d, nations[0], "peace", 0.9), false, "a militarist, not on a bad roll");
  assert.equal(accepts(fresh(), nations[1], "peace", 0.1), false, "nothing to make peace over");
});

test("allies join wars on their friend's side, and sour alliances break", () => {
  const d = fresh();
  setRel(d, "n1", "n2", 70);
  makeAlliance(d, "n1", "n2");
  const joined = joiners(d, ["n0", "n1", "n2"], "n0", "n1", () => 0.1);
  assert.deepEqual(joined, [{ id: "n2", against: "n0" }], "the ally of the attacked joins against the aggressor");
  assert.deepEqual(joiners(d, ["n0", "n1", "n2"], "n0", "n1", () => 0.99), [], "not always");
  setRel(d, "n1", "n2", 20);
  assert.deepEqual(soureAlliances(d), [["n1", "n2"]]);
  assert.ok(!allied(d, "n1", "n2"));
  makeAlliance(d, "n1", "n2");
  endAlliance(d, "n1", "n2");
  assert.ok(rel(d, "n1", "n2") < 70, "ending an alliance costs goodwill");
});

test("things that happen change how nations feel", () => {
  const d = fresh();
  const before = rel(d, YOU, "n1");
  react(d, [YOU, "n0", "n1", "n2"], typeOf, { kind: "trade", by: YOU, to: "n1" });
  assert.ok(rel(d, YOU, "n1") > before);
  react(d, [YOU, "n0", "n1", "n2"], typeOf, { kind: "gift", by: YOU, to: "n1" });
  assert.ok(rel(d, YOU, "n1") > before + 10);
  const z = rel(d, YOU, "n0"),
    zz = rel(d, YOU, "n2");
  react(d, [YOU, "n0", "n1", "n2"], typeOf, { kind: "preach", by: YOU, to: "n0" });
  react(d, [YOU, "n0", "n1", "n2"], typeOf, { kind: "preach", by: YOU, to: "n2" });
  assert.ok(z - rel(d, YOU, "n0") > zz - rel(d, YOU, "n2") - 1e-9 || rel(d, YOU, "n0") < z, "preaching annoys people");
  // A conquest is noticed by everyone, and the victim's friends most.
  const e = fresh();
  setRel(e, "n1", "n2", 70);
  makeAlliance(e, "n1", "n2");
  const bystander = rel(e, "n0", "n2"),
    friend = rel(e, "n0", "n1");
  react(e, ["n0", "n1", "n2", YOU], typeOf, { kind: "conquest", by: "n0", to: "n1" });
  assert.ok(rel(e, "n0", "n1") <= friend - 20);
  assert.ok(rel(e, "n0", "n2") <= bystander - 15, "the victim's ally minds most");
  assert.ok(rel(e, "n0", YOU) < -20 + 1e-9 || rel(e, "n0", YOU) <= 0);
});

test("feelings settle toward their natural level over time, never during a war", () => {
  const d = fresh();
  setRel(d, "n0", "n2", 40);
  settle(d, nations, 100, 0.2);
  assert.ok(rel(d, "n0", "n2") < 40, "false friendship fades toward the natural dislike");
  declareWar(d, "n1", "n2");
  const r = rel(d, "n1", "n2");
  settle(d, nations, 100, 0.2);
  assert.equal(rel(d, "n1", "n2"), r, "a war does not cool by itself");
  makeDeal(d, "n0", "n1");
  assert.ok(bump(d, "n0", "n1", 0) !== undefined);
});

test("saved diplomacy is read safely", () => {
  const ids = [YOU, "n0", "n1", "n2"];
  const raw = { rel: { "n0|n1": 12.34, "bad|key": 5, "n0|n9": 3 }, war: { "n0|you": true, "n1|you": "yes" }, allies: { "n1|n2": true }, deals: { "n0|n1": true, "zzz": true } };
  const d = readDiplomacy(raw, ids);
  assert.equal(d.rel["n0|n1"], 12.3);
  assert.ok(!("bad|key" in d.rel) && !("n0|n9" in d.rel));
  assert.deepEqual(Object.keys(d.war), ["n0|you"]);
  assert.deepEqual(Object.keys(d.allies), ["n1|n2"]);
  assert.deepEqual(Object.keys(d.deals), ["n0|n1"]);
  assert.deepEqual(readDiplomacy(null, ids), { rel: {}, war: {}, allies: {}, deals: {} });
});

test("offers carry what is on the table", () => {
  const o = makeOffer("buyout", "n1", { city: 3, amount: 400, text: "We offer 400 for Elum." });
  assert.equal(o.kind, "buyout");
  assert.ok(o.ttl > 0 && o.city === 3);
  assert.ok(tributeDemand(1000) >= 60 && tributeDemand(10) === 60);
});
