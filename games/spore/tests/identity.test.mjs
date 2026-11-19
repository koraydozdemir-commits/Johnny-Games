import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_PASSIVES,
  COLOR_CARD,
  INSTINCTS,
  INSTINCT_IDS,
  TRIBE_INSTINCT,
  emptyLedger,
  instinctCard,
  instinctFor,
  leaningMoment,
  momentFor,
  profileOf,
  readLedger,
  reasonsFor,
  reputationOf,
  seedLedger,
  traitMods,
} from "../creature/identity.js";
import { attitudeOf, emptyMemory, fade, readMemory, remember, socialBias, wariness } from "../creature/memory.js";
import { tribeLegacy } from "../lineage.js";

const ledger = (o) => ({ ...emptyLedger(), ...o });

test("the instinct follows what the species actually did", () => {
  assert.equal(instinctFor(ledger({ hunts: 25, predatorKills: 4, extinctions: 2 })), "apex");
  assert.equal(instinctFor(ledger({ befriended: 14, alliances: 3, gifts: 4 })), "symbiotic");
  assert.equal(instinctFor(ledger({ hunts: 14, befriended: 12, alliances: 2 })), "packHunter");
  assert.equal(instinctFor(ledger({ escapes: 10, sneaks: 12, ambushes: 2 })), "elusive");
  assert.equal(instinctFor(ledger({ scavenged: 14, meatMeals: 14 })), "scavenger");
  assert.equal(instinctFor(ledger({ defended: 6, familyFed: 12, gifts: 2 })), "nurturing");
  assert.equal(instinctFor(ledger({ intimidations: 8, defended: 4, fightsStarted: 3 })), "territorial");
  assert.equal(instinctFor(ledger({ plantMeals: 20, meatMeals: 18, eggs: 3, migrations: 2 })), "adaptable");
  // With nothing to go on, the species is simply adaptable.
  assert.equal(instinctFor(emptyLedger()), "adaptable");
});

test("two predators can differ: a lone killer and a pack that hunts together", () => {
  const lone = instinctFor(ledger({ hunts: 20, predatorKills: 3, intimidations: 2 }));
  const pack = instinctFor(ledger({ hunts: 20, befriended: 14, alliances: 2 }));
  assert.equal(INSTINCTS[lone].color, "red");
  assert.equal(INSTINCTS[pack].color, "red");
  assert.notEqual(lone, pack);
});

test("every instinct has an upside and a downside, and none is simply better", () => {
  for (const id of INSTINCT_IDS) {
    const c = INSTINCTS[id];
    assert.ok(c.pros.length && c.cons.length, id + " needs pros and cons");
    assert.ok(COLOR_CARD[c.color], id + " maps to a classic card");
    assert.ok(TRIBE_INSTINCT[id], id + " hands the tribe something");
    const m = traitMods(null, id);
    const helps = m.damage > 1 || m.packDamage > 1 || m.homeDamage > 1 || m.intimidate > 1 || m.socialStart > 0 || m.notice < 1 || m.hunger < 1 || m.foodHeal > 1 || m.carrion > 1 || m.sprintDrain < 1 || m.familyRegrow < 1 || m.assist > 0.3;
    const hurts = m.damage < 1 || m.soloDamage < 1 || m.intimidate < 1 || m.socialStart < 0 || m.provoke > 1 || m.raidRate > 1 || m.fear > 0;
    assert.ok(helps, id + " has a real upside");
    assert.ok(hurts, id + " has a real cost");
    const e = TRIBE_INSTINCT[id].effect;
    const tribeCost = (e.damage ?? 1) < 1 || (e.gift ?? 1) < 1 || (e.music ?? 1) < 1 || (e.relation ?? 0) < 0;
    assert.ok(tribeCost, id + " costs something in the Tribal Stage too");
  }
  // Each colour has more than one instinct, so a colour isn't one fixed path.
  for (const col of ["red", "green", "blue"]) assert.ok(INSTINCT_IDS.filter((id) => INSTINCTS[id].color === col).length >= 2, col);
});

test("old saves with a card keep its colour; reasons come from real acts", () => {
  const l = seedLedger({ alliances: 2, extinctions: 0, treated: { a: { friends: 5, kills: 0 }, b: { friends: 3, kills: 1 } }, foods: ["fruit", "meat"], discovered: ["own", "x", "y"], unlockedRegions: ["coast", "forest"] });
  assert.equal(l.befriended, 8);
  assert.equal(l.nestKills, 1);
  assert.equal(l.migrations, 1);
  assert.equal(INSTINCTS[instinctFor(l, { color: "red" })].color, "red");
  assert.equal(instinctFor(l), "symbiotic");
  const why = reasonsFor("symbiotic", l);
  assert.ok(why.some((r) => r.includes("Allied with 2")));
  assert.ok(why.length <= 3);
  const card = instinctCard("symbiotic", l);
  assert.equal(card.color, "#3fc26e");
  assert.ok(card.legacy.text);
  assert.deepEqual(reasonsFor("apex", emptyLedger()), []);
});

test("the ledger reads bad data safely", () => {
  const l = readLedger({ hunts: "7", gifts: -3, bogus: 9, escapes: NaN, befriended: 2.7 });
  assert.equal(l.hunts, 7);
  assert.equal(l.gifts, 0);
  assert.equal(l.escapes, 0);
  assert.equal(l.befriended, 2);
  assert.equal(l.bogus, undefined);
  assert.deepEqual(readLedger(null), emptyLedger());
});

test("reputation takes a real record to build, and fear and trust follow behaviour", () => {
  assert.deepEqual(reputationOf(emptyLedger()), { fear: 0, trust: 0 });
  const tiny = reputationOf(ledger({ hunts: 1 }));
  const killer = reputationOf(ledger({ hunts: 20, predatorKills: 4 }));
  const friend = reputationOf(ledger({ befriended: 15, alliances: 2 }));
  assert.ok(tiny.fear < 0.05, "one kill is not a reputation");
  assert.ok(killer.fear > 0.5 && killer.trust === 0);
  assert.ok(friend.trust > 0.5 && friend.fear === 0);
  assert.ok(profileOf(ledger({ plantMeals: 10, meatMeals: 10 })).breadth > profileOf(ledger({ plantMeals: 20 })).breadth, "a mixed diet is broader");
});

test("trait modifiers combine the Cell card and the instinct", () => {
  const none = traitMods(null, null);
  assert.equal(none.damage, 1);
  assert.equal(none.socialStart, 0);
  for (const id of Object.keys(CELL_PASSIVES)) assert.ok(CELL_PASSIVES[id].pro && CELL_PASSIVES[id].con);
  const m = traitMods("carnivore", "apex");
  assert.ok(Math.abs(m.damage - 1.1 * 1.15) < 1e-9);
  assert.ok(Math.abs(m.fear - 0.5) < 1e-9);
  const g = traitMods("herbivore", "symbiotic");
  assert.ok(Math.abs(g.socialStart - 0.3) < 1e-9);
  assert.equal(g.assist, 0.85);
});

test("first times and milestones become chronicle moments, once", () => {
  assert.equal(momentFor("hunts", 1, "Forest", "forest").key, "first:hunts");
  assert.ok(momentFor("hunts", 1, "in the Deepwood Forest", "forest").text.includes("in the Deepwood Forest"));
  assert.equal(momentFor("hunts", 2, "Forest", "forest"), null);
  assert.equal(momentFor("hunts", 10, "Forest", "forest").key, "milestone:hunts:10");
  assert.equal(momentFor("sneaks", 1, "Forest", "forest"), null);
  assert.equal(leaningMoment("elusive").key, "leaning:elusive");
});

test("the tribe receives the instinct's legacy alongside the other cards", () => {
  const l = tribeLegacy("carnivore", "predator", "apex");
  assert.ok(Math.abs(l.damage - 1.15 * 1.15) < 1e-9);
  assert.equal(l.relation, -10);
  assert.equal(l.lines.length, 3);
  assert.equal(tribeLegacy("carnivore", "predator").lines.length, 2, "no instinct: unchanged");
});

test("memory: grudges fade, but massacres leave a floor; kindness is remembered", () => {
  const m = emptyMemory();
  remember(m, "hurt");
  assert.equal(attitudeOf(m), "neutral");
  fade(m, 600);
  assert.equal(m.g, 0, "a scratch is forgiven");
  remember(m, "killAlpha");
  remember(m, "kill");
  remember(m, "witnessedKill");
  assert.equal(attitudeOf(m), "hostile");
  fade(m, 3600);
  assert.ok(m.g >= 20, "they never fully forget");
  assert.notEqual(attitudeOf(m), "warm");
  const f = emptyMemory();
  remember(f, "rescue");
  remember(f, "gift");
  remember(f, "befriend");
  assert.equal(attitudeOf(f), "warm");
  remember(f, "alliance");
  assert.equal(attitudeOf(f), "loyal");
  assert.ok(socialBias(f) > 0 && socialBias(m) < 0);
  assert.ok(wariness(m) > 1.1 && wariness(emptyMemory()) === 1);
  remember(f, "kill");
  assert.ok(f.t < 60, "harm sours trust fast");
  assert.deepEqual(readMemory({ g: 500, t: -4, fg: 90 }), { g: 100, t: 0, fg: 60, ft: 0 });
  assert.deepEqual(readMemory("junk"), emptyMemory());
});
