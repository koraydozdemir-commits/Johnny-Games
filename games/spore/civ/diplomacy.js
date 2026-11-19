/**
 * Diplomacy between every pair of nations, you included: how much each likes the other, who is at war,
 * who is allied, and the trade agreements that pay both sides. Pure data and decisions (no scene), so every
 * rule is unit tested. The state is a plain object that is saved with the game.
 *
 *   rel[pair]    -100..100, how much the two like each other
 *   war[pair]    true while they are fighting
 *   allies[pair] true while allied (allies never fight each other, help in wars and make victory shared)
 *   deals[pair]  true while they have a trade agreement (it pays both while they are at peace)
 *
 * A pair's key is its two ids in order, joined with "|".
 */
export const YOU = "you";
export const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const clamp = (v) => Math.max(-100, Math.min(100, Math.round(v * 10) / 10));

/** What each kind of nation is like to deal with. */
export const PERSONALITY = {
  military: { name: "Militarist", aggression: 0.9, zeal: 0.1, greed: 0.35, peace: 0.15, blurb: "Takes what it wants by force. Respects strength, despises weakness." },
  economic: { name: "Merchant", aggression: 0.12, zeal: 0.1, greed: 0.9, peace: 0.9, blurb: "Prefers deals to wars. Trades with anyone, buys what it can, avoids fights it cannot win cheaply." },
  religious: { name: "Zealot", aggression: 0.4, zeal: 0.95, greed: 0.2, peace: 0.5, blurb: "Spreads its faith city by city. Will not tolerate rival creeds in its lands." },
};
/** How two kinds of nation feel about each other before anything happens between them. */
const BASE = {
  "military|military": -15,
  "military|religious": -25,
  "economic|military": -5,
  "economic|economic": 15,
  "economic|religious": 5,
  "religious|religious": -5,
};
export const baseRelation = (typeA, typeB) => BASE[[typeA, typeB].sort().join("|")] ?? 0;

export const ALLY_AT = 55;
export const DEAL_COST = 60;
export const ALLIANCE_COST = 100;
/** Money a trade agreement pays each side every second. */
export const DEAL_INCOME = 0.9;

/**
 * @param {Array<{id:string, type:string}>} nations the rival nations
 * @param {Object<string,number>} toYou each rival's starting feeling toward you
 */
export function createDiplomacy(nations, toYou = {}) {
  const d = { rel: {}, war: {}, allies: {}, deals: {} };
  for (const n of nations) d.rel[pairKey(YOU, n.id)] = clamp(toYou[n.id] ?? 0);
  for (let i = 0; i < nations.length; i++) for (let j = i + 1; j < nations.length; j++) d.rel[pairKey(nations[i].id, nations[j].id)] = baseRelation(nations[i].type, nations[j].type);
  return d;
}
/** Read a saved diplomacy state, tolerating anything missing. */
export function readDiplomacy(raw, ids) {
  const ok = new Set(ids);
  const valid = (k) => typeof k === "string" && k.split("|").length === 2 && k.split("|").every((x) => ok.has(x));
  const pick = (obj, f) => Object.fromEntries(Object.entries(obj && typeof obj === "object" ? obj : {}).filter(([k, v]) => valid(k) && f(v)).map(([k, v]) => [k, typeof v === "number" ? clamp(v) : true]));
  return { rel: pick(raw?.rel, (v) => Number.isFinite(v)), war: pick(raw?.war, (v) => v === true), allies: pick(raw?.allies, (v) => v === true), deals: pick(raw?.deals, (v) => v === true) };
}

export const rel = (d, a, b) => d.rel[pairKey(a, b)] ?? 0;
export const setRel = (d, a, b, v) => (d.rel[pairKey(a, b)] = clamp(v));
export const bump = (d, a, b, dv) => setRel(d, a, b, rel(d, a, b) + dv);
export const atWar = (d, a, b) => !!d.war[pairKey(a, b)];
export const allied = (d, a, b) => !!d.allies[pairKey(a, b)];
export const hasDeal = (d, a, b) => !!d.deals[pairKey(a, b)];
export const alliesOf = (d, id) => Object.keys(d.allies).filter((k) => d.allies[k] && k.split("|").includes(id)).map((k) => k.split("|").find((x) => x !== id));
export const dealsOf = (d, id) => Object.keys(d.deals).filter((k) => d.deals[k] && k.split("|").includes(id)).map((k) => k.split("|").find((x) => x !== id));
export const warsOf = (d, id) => Object.keys(d.war).filter((k) => d.war[k] && k.split("|").includes(id)).map((k) => k.split("|").find((x) => x !== id));

/** Words for a relationship, in the order of what matters most. */
export function relationWord(d, a, b) {
  if (atWar(d, a, b)) return "At war";
  if (allied(d, a, b)) return "Allied";
  const r = rel(d, a, b);
  if (hasDeal(d, a, b)) return r >= 20 ? "Trade partners" : "Trade agreement";
  return r >= 40 ? "Friendly" : r > -20 ? "Neutral" : r > -50 ? "Wary" : "Hostile";
}

/* ----------------------------------------------------------------------------- actions */
/** Why a nation cannot declare war on another right now ("" if it can). */
export function cannotDeclare(d, a, b) {
  if (atWar(d, a, b)) return "Already at war.";
  if (allied(d, a, b)) return "They are your ally: end the alliance first.";
  return "";
}
/** War breaks out: a deal ends, an alliance ends, and feeling plunges. */
export function declareWar(d, a, b) {
  const k = pairKey(a, b);
  d.war[k] = true;
  delete d.deals[k];
  delete d.allies[k];
  setRel(d, a, b, Math.min(rel(d, a, b), 0) - 30);
}
export function makePeace(d, a, b) {
  delete d.war[pairKey(a, b)];
  setRel(d, a, b, Math.max(rel(d, a, b), -10));
}
/** An alliance is possible between friends who are not fighting. */
export const canAlly = (d, a, b) => !atWar(d, a, b) && !allied(d, a, b) && rel(d, a, b) >= ALLY_AT;
export function makeAlliance(d, a, b) {
  const k = pairKey(a, b);
  d.allies[k] = true;
  delete d.war[k];
  setRel(d, a, b, Math.max(rel(d, a, b), ALLY_AT + 5));
}
export function endAlliance(d, a, b) {
  delete d.allies[pairKey(a, b)];
  bump(d, a, b, -25);
}
/** A trade agreement is possible between nations that are not at war and do not dislike each other. */
export const canDeal = (d, a, b) => !atWar(d, a, b) && !hasDeal(d, a, b) && rel(d, a, b) >= -10;
export function makeDeal(d, a, b) {
  d.deals[pairKey(a, b)] = true;
  bump(d, a, b, 6);
}
export const endDeal = (d, a, b) => delete d.deals[pairKey(a, b)];

/** Money a trade agreement pays you each second, scaled by how warm the partner is. */
export function dealIncomeOf(d, id, aliveIds) {
  let sum = 0;
  for (const other of dealsOf(d, id)) {
    if (!aliveIds.includes(other) || atWar(d, id, other)) continue;
    sum += DEAL_INCOME * (1 + Math.max(0, rel(d, id, other)) / 200) * (allied(d, id, other) ? 1.25 : 1);
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Whether a rival accepts a proposal. Deterministic given the roll: a warmer, more peaceable nation says yes
 * more easily; a nation at war says no.
 * @param {"alliance"|"deal"|"peace"|"gift"} kind
 */
export function accepts(d, nation, kind, roll = 0.5) {
  const p = PERSONALITY[nation.type];
  const r = rel(d, YOU, nation.id);
  if (kind === "gift") return true;
  if (kind === "peace") return atWar(d, YOU, nation.id) && roll < 0.35 + p.peace * 0.5 + Math.max(0, r + 30) / 200;
  if (atWar(d, YOU, nation.id)) return false;
  if (kind === "deal") return canDeal(d, YOU, nation.id) && r + p.greed * 20 >= 5;
  if (kind === "alliance") return canAlly(d, YOU, nation.id) && roll < 0.4 + p.peace * 0.4 + (r - ALLY_AT) / 100;
  return false;
}

/**
 * Who joins a war: when `a` declares on `b`, b's allies side with b (if they do not like a) and a's allies with
 * a (if they do not like b). Returns [{id, against}].
 */
export function joiners(d, ids, a, b, rand = Math.random) {
  const out = [];
  for (const id of ids) {
    if (id === a || id === b) continue;
    if (allied(d, id, b) && rel(d, id, a) < 40 && rand() < 0.75 && !atWar(d, id, a)) out.push({ id, against: a });
    else if (allied(d, id, a) && rel(d, id, b) < 40 && rand() < 0.5 && !atWar(d, id, b) && !allied(d, id, b)) out.push({ id, against: b });
  }
  return out;
}
/** Break alliances that have gone sour (relations under 25); returns the pairs broken. */
export function soureAlliances(d) {
  const broken = [];
  for (const k of Object.keys(d.allies)) {
    const [a, b] = k.split("|");
    if (rel(d, a, b) < 25 || atWar(d, a, b)) {
      delete d.allies[k];
      broken.push([a, b]);
    }
  }
  return broken;
}

/* ----------------------------------------------------------------------------- reactions */
/**
 * Feelings change when things happen. Returns nothing; the relations in `d` are updated.
 * @param {{kind:string, by:string, to?:string, dt?:number}} ev  (dt scales the per-second kinds)
 *   attack (by attacked a city of `to`), conquest (by took a city of `to`), preach (by preaches in a city of `to`, per second),
 *   trade (by trades with a city of `to`, per second), gift (by gave `to` a gift)
 */
export function react(d, ids, typeOf, ev) {
  const { kind, by, to } = ev;
  switch (kind) {
    case "attack":
      bump(d, by, to, -8);
      break;
    case "conquest":
      bump(d, by, to, -20);
      // Everyone takes note of an aggressor, friends of the victim most.
      for (const id of ids) if (id !== by && id !== to) bump(d, id, by, allied(d, id, to) ? -15 : -2);
      break;
    case "preach":
      // Preaching in someone's lands angers them (the zealous least of all: they expect it).
      bump(d, by, to, (typeOf(to) === "religious" ? -0.25 : -0.5) * (ev.dt ?? 1));
      break;
    case "trade":
      bump(d, by, to, 0.4 * (ev.dt ?? 1));
      break;
    case "gift":
      bump(d, by, to, 15);
      break;
  }
}

/**
 * Pair feelings settle toward their natural level (a little each second): enemies cool down, friends drift
 * apart a little, and personalities pull toward their nature. YOU pairs are handled by the stage.
 */
export function settle(d, nations, dt, rate = 0.05) {
  for (let i = 0; i < nations.length; i++)
    for (let j = i + 1; j < nations.length; j++) {
      const a = nations[i],
        b = nations[j];
      if (atWar(d, a.id, b.id)) continue;
      const target = baseRelation(a.type, b.type) + (allied(d, a.id, b.id) ? 40 : 0) + (hasDeal(d, a.id, b.id) ? 15 : 0);
      const r = rel(d, a.id, b.id);
      setRel(d, a.id, b.id, r + Math.sign(target - r) * Math.min(Math.abs(target - r), rate * dt));
    }
}

/* ------------------------------------------------------------------------------- offers */
/**
 * An offer a rival makes to you. `kind` is "buyout" (they offer to buy one of your cities), "alliance",
 * "deal" (a trade agreement) or "tribute" (a militarist demands money or else).
 * @returns {{kind:string, from:string, city?:number, amount?:number, text:string}}
 */
export function makeOffer(kind, from, o = {}) {
  return { id: o.id ?? Math.random().toString(36).slice(2, 7), kind, from, city: o.city ?? null, amount: o.amount ?? 0, text: o.text || "", t: 0, ttl: 70 };
}
/** What a buyout offer pays: the city's worth, scaled up a little for the nation's wealth. */
export const buyoutOffer = (cityValue) => Math.round(cityValue * 1.25);
/** A tribute demand: a slice of your treasury. */
export const tributeDemand = (money) => Math.max(60, Math.round(money * 0.25 / 10) * 10);
