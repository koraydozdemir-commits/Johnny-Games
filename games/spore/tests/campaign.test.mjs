import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUT_LEVELS,
  PEACE_RELATION,
  RIVALS,
  RIVAL_ORDER,
  RECRUIT_COST,
  canMakePeace,
  canPlace,
  canRecruit,
  cleanName,
  giftAnswer,
  musicAnswer,
  peaceCost,
  rivalRaidTarget,
  stepRival,
  tierMult,
  tradeOffers,
  upgradeCost,
  upkeep,
  victoryPath,
  villageRoom,
} from "../tribe/campaign.js";
import { TOOL_IDS, readTribeSave } from "../tribe/rules.js";

const seq = (...v) => {
  let i = 0;
  return () => v[i++ % v.length];
};

test("five distinct rivals, each a different problem", () => {
  assert.deepEqual([...RIVAL_ORDER].sort(), Object.keys(RIVALS).sort());
  assert.equal(RIVAL_ORDER.length, 5);
  const r = RIVALS;
  assert.ok(r.musicians.music > r.traders.music && r.musicians.music > r.warriors.music, "musicians love songs most");
  assert.ok(r.traders.gift > r.musicians.gift, "traders value gifts over musicians");
  assert.ok(r.traders.trade && !r.warriors.trade);
  assert.equal(r.defenders.raid, null, "defenders never raid");
  assert.equal(r.defenders.hutHp, 2, "and their palisade doubles the hut");
  assert.ok(r.warriors.start < 0 && r.warriors.raid[0] < r.hunters.raid[0], "warriors start hostile and raid most");
  for (const k of RIVAL_ORDER) assert.ok(r[k].hint && r[k].icon && r[k].members >= 4 && ["plant", "meat", "omni"].includes(r[k].diet));
});

test("a song moves musicians most, the warriors least; a miss always hurts", () => {
  const m = musicAnswer(0, RIVALS.musicians, 2),
    t = musicAnswer(0, RIVALS.traders, 2),
    w = musicAnswer(0, RIVALS.warriors, 2);
  assert.ok(m > t && t > w && w > 0);
  assert.ok(musicAnswer(0, RIVALS.traders, 2, 1.5) > t, "bronze instruments play louder");
  assert.ok(musicAnswer(0, RIVALS.musicians, 0) < 0);
  // About a dozen good answers befriend a neutral tribe: not a one-tap win, not a grind.
  let rel = 0,
    n = 0;
  while (rel < 100 && n < 50) (rel = musicAnswer(rel, RIVALS.traders, 2)), n++;
  assert.ok(n >= 6 && n <= 14, "answers needed: " + n);
});

test("gifts, peace and trade", () => {
  assert.ok(giftAnswer(0, RIVALS.traders) > giftAnswer(0, RIVALS.musicians));
  assert.ok(giftAnswer(0, RIVALS.hunters, true) > giftAnswer(0, RIVALS.hunters, false), "hunters like meat");
  assert.ok(peaceCost(RIVALS.warriors) > peaceCost(RIVALS.traders));
  assert.equal(canMakePeace({ status: "neutral", relation: -60, war: 0 }), true);
  assert.equal(canMakePeace({ status: "neutral", relation: 10, war: 12 }), true);
  assert.equal(canMakePeace({ status: "neutral", relation: 10, war: 0 }), false);
  assert.equal(canMakePeace({ status: "conquered", relation: -100, war: 9 }), false);
  assert.ok(PEACE_RELATION < 0 && PEACE_RELATION > -50);
  const owned = Object.fromEntries(TOOL_IDS.map((id) => [id, id === "axe" ? 1 : 0]));
  const offers = tradeOffers({ status: "neutral", relation: 20 }, RIVALS.traders, owned);
  assert.equal(offers.length, TOOL_IDS.length - 1, "everything you haven't built");
  assert.ok(!offers.some((o) => o.tool === "axe"));
  assert.deepEqual(tradeOffers({ status: "neutral", relation: 20 }, RIVALS.warriors, owned), [], "warriors don't trade");
  assert.deepEqual(tradeOffers({ status: "neutral", relation: -40 }, RIVALS.traders, owned), [], "not while angry");
  const ally = tradeOffers({ status: "allied", relation: 100 }, RIVALS.warriors, owned);
  assert.ok(ally.length && ally.every((o, i) => o.price <= offers[i].price), "allies trade, and cheaper");
  assert.equal(canRecruit({ status: "allied" }, 4), true);
  assert.equal(canRecruit({ status: "allied" }, 2), false);
  assert.equal(canRecruit({ status: "neutral" }, 6), false);
  assert.ok(RECRUIT_COST > 0);
});

test("the village: hut levels, room, placement, upkeep, tiers", () => {
  assert.equal(villageRoom(0, 1), 6);
  assert.equal(villageRoom(2, 3), 6 + 6 + 4);
  assert.ok(HUT_LEVELS[2].cost > HUT_LEVELS[1].cost && HUT_LEVELS[2].hp > HUT_LEVELS[1].hp);
  const flat = () => 1,
    home = { x: 0, z: 0 };
  assert.equal(canPlace({ x: 10, z: 0 }, home, [], flat), null);
  assert.match(canPlace({ x: 3, z: 0 }, home, [], flat), /close/);
  assert.match(canPlace({ x: 40, z: 0 }, home, [], flat), /far/);
  assert.match(canPlace({ x: 10, z: 0 }, home, [], () => 0), /wet/);
  assert.match(canPlace({ x: 10, z: 0 }, home, [{ x: 11, z: 0 }], flat), /already/);
  assert.deepEqual(upkeep(10, 4), { eat: 4, short: 0 });
  assert.deepEqual(upkeep(2, 5), { eat: 2, short: 3 });
  for (const id of TOOL_IDS) assert.ok(upgradeCost(id) > 0);
  assert.equal(tierMult("axe", 1), 1);
  assert.equal(tierMult("axe", 2), 1.5);
  assert.equal(tierMult(null, 2), 1);
});

test("rivals live on their own: they grow, cool off, get hungry and raid", () => {
  const tr = { food: 23, relation: -60, status: "neutral", war: 0, alive: 4, raidClock: 5 };
  let grew = 0,
    raids = 0;
  for (let i = 0; i < 600; i++) {
    const ev = stepRival(tr, RIVALS.warriors, 1, seq(0.5));
    if (ev.grow) (grew++, tr.alive++);
    if (ev.raid) raids++;
  }
  assert.ok(grew >= 1, "they grow");
  assert.ok(raids >= 3 && raids <= 6, "warriors raid every two minutes or so: " + raids);
  assert.ok(tr.relation > -60 && tr.relation <= RIVALS.warriors.calm + 1e-9, "tempers cool, but only to their usual mood");
  // A content tribe of traders never raids.
  const tt = { food: 10, relation: 30, status: "neutral", war: 0, alive: 5, raidClock: 1 };
  for (let i = 0; i < 400; i++) assert.ok(!stepRival(tt, RIVALS.traders, 1).raid);
  // Hungry hunters raid even when they don't mind you much.
  const hh = { food: 0, relation: 5, status: "neutral", war: 0, alive: 1, raidClock: 1 };
  hh.alive = 3;
  let hr = 0;
  for (let i = 0; i < 300; i++) {
    hh.food = 0;
    if (stepRival(hh, RIVALS.hunters, 1, seq(0.5)).raid) hr++;
  }
  assert.ok(hr >= 1);
  // Peace holds off raids for its while.
  const pp = { food: 10, relation: -80, status: "neutral", war: 0, alive: 5, raidClock: 1, peace: 100 };
  for (let i = 0; i < 90; i++) assert.ok(!stepRival(pp, RIVALS.warriors, 1).raid);
  assert.equal(stepRival({ status: "conquered", food: 0 }, RIVALS.warriors, 1).grow, undefined);
  assert.equal(rivalRaidTarget([{ status: "neutral", alive: 3 }, { status: "conquered", alive: 0 }, { status: "allied", alive: 2 }], 0, seq(0.9)), 2);
  assert.equal(rivalRaidTarget([{ status: "neutral", alive: 3 }], 0), -1);
});

test("three ways to win, each with its own trait", () => {
  assert.equal(victoryPath([{ status: "allied" }, { status: "neutral" }]), null);
  assert.equal(victoryPath([]), null);
  assert.equal(victoryPath([{ status: "allied" }, { status: "allied" }]).path, "peace");
  assert.equal(victoryPath([{ status: "conquered" }, { status: "conquered" }]).path, "conquest");
  const b = victoryPath([{ status: "allied" }, { status: "conquered" }]);
  assert.equal(b.path, "balance");
  assert.ok(b.trait && b.title && b.text);
});

test("tribe names are cleaned, and saves migrate from v1", () => {
  assert.equal(cleanName("  The <b>Moon</b>  people!! ", "X"), "The bMoonb people");
  assert.equal(cleanName("", "Fallback"), "Fallback");
  assert.equal(cleanName("a".repeat(40), "X").length, 22);
  const v1 = readTribeSave({ v: 1, food: 30, tools: { horn: true }, units: [{ chief: true, tool: "horn" }, {}], tribes: [{ relation: 40, status: "allied", alive: 4, hut: 1 }], won: false });
  assert.equal(v1.v, 2);
  assert.equal(v1.tools.horn, 1);
  assert.equal(v1.hutLevel, 1);
  assert.equal(v1.units[1].from, -1);
  assert.equal(v1.tribes[0].status, "allied");
  const v2 = readTribeSave({ food: 5, tools: { axe: 2 }, units: [{ chief: true, from: 3 }], hutLevel: 9, shacks: { axe: { x: 5, z: "nope" }, horn: { x: 3, z: 4, hp: 0.5 } }, look: { name: "Ok", color: 999999999, style: "castle" }, path: "peace" });
  assert.equal(v2.tools.axe, 2);
  assert.equal(v2.hutLevel, 3);
  assert.deepEqual(Object.keys(v2.shacks), ["horn"]);
  assert.equal(v2.look.style, "cone");
  assert.equal(v2.look.color, 0xffffff);
  assert.equal(v2.units[0].from, 3);
  assert.equal(v2.path, "peace");
});

test("village structures, decorations and roles", async () => {
  const { STRUCTURES, ROLES, structureCost, spiritHeal, villageRoom, HOUSE_ROOM } = await import("../tribe/campaign.js");
  const { TOOLS, DAMAGE } = await import("../tribe/rules.js");
  assert.equal(villageRoom(0, 1, 2), 6 + 2 * HOUSE_ROOM, "dwellings make room");
  assert.equal(structureCost("house", 0), 30);
  assert.equal(structureCost("house", 2), 60);
  assert.equal(structureCost("house", 3), null, "at the limit");
  for (const [id, st] of Object.entries(STRUCTURES)) assert.ok(st.max >= 1 && st.cost.length >= 1 && st.icon && st.desc, id);
  assert.equal(spiritHeal(0), 1);
  assert.ok(spiritHeal(3) > spiritHeal(1));
  assert.equal(spiritHeal(20), spiritHeal(6), "capped");
  assert.deepEqual(Object.keys(ROLES).slice(0, 1).concat(["gather", "guard"].filter((r) => ROLES[r])), ["free", "gather", "guard"], "older saves' roles still exist");
  assert.ok(TOOLS.club.cost < TOOLS.axe.cost && DAMAGE.club > DAMAGE.none && DAMAGE.club < DAMAGE.axe, "clubs: the cheap first weapon");
});
