/**
 * Rival nations' minds. `planNation` looks at a snapshot of the world and returns what the nation wants to do
 * now, as a short list of intents; the stage carries them out (it owns the scene, the money and the vehicles).
 * Pure, so each personality's behaviour is unit tested.
 *
 *   Militarist  builds factories and turrets, makes soldiers, picks on the weakest neighbour it can beat and
 *               takes its cities, defends what it has, makes peace only when it is losing.
 *   Zealot      builds temples, makes missionaries, converts the cities with the weakest faith, answers
 *               conversion of its own cities with temples and counter-preaching.
 *   Merchant    builds factories and entertainment, stockpiles money, trades with everyone, makes agreements and
 *               alliances, buys cities outright when trade is complete, and avoids wars it does not have to fight.
 *
 * All of them develop their cities, build vehicles, answer threats and compete for spice.
 *
 * @typedef {{id:number, owner:string|null, plots:(string|null)[], turrets:number, hall:number, hallHp:number, turretHp:number, faith:number, devout?:boolean, coastal?:boolean, continent:number, trade:Object<string,number>, conv:Object<string,number>, queue?:number, threatened?:string|null}} AiCity
 */
import { PERSONALITY, ALLY_AT, allied, atWar, canAlly, canDeal, hasDeal, rel } from "./diplomacy.js";

/** What a city can withstand: turrets and walls and what is behind them. */
export const cityPower = (c) => (c.turrets || 0) * (c.turretHp ?? 1) * 3 + (c.hallHp ?? 1) * 2 + c.plots.filter(Boolean).length * 0.2 + ((c.hall || 1) - 1);
/** A nation's strength: its cities' power and its fleet. */
export const strengthOf = (cities, vehicles) => cities.reduce((s, c) => s + cityPower(c), 0) + vehicles * 1.2;

/** What each personality builds first, in order, for the empty plots of a city. */
const BUILD_ORDER = {
  military: ["factory", "house", "factory", "fun", "house", "fun"],
  economic: ["factory", "house", "fun", "factory", "house", "factory"],
  religious: ["temple", "house", "fun", "temple", "house", "temple"],
};
/** Money a nation keeps in reserve before spending on improvements. */
const RESERVE = { military: 60, economic: 260, religious: 90 };
const COST = { house: 40, factory: 60, fun: 50, temple: 55, turret: 50 };

/**
 * @param {{id:string, type:string, money:number, vehicles:number, cap:number, cities:AiCity[]}} me
 * @param {{ time:number, grace:boolean, nations:Array<{id:string,type:string,alive:boolean,strength:number,cities:number}>, dip:object, cities:AiCity[], geysers:Array<{owner:string|null}>, buyoutCost:(c:AiCity)=>number, vehicleCost:number, rand?:()=>number }} world
 * @returns {Array<object>} intents
 */
export function planNation(me, world) {
  const rand = world.rand || Math.random;
  const p = PERSONALITY[me.type];
  const out = [];
  const myStrength = strengthOf(me.cities, me.vehicles);
  const others = world.nations.filter((n) => n.id !== me.id && n.alive);
  const rivals = others.filter((n) => !allied(world.dip, me.id, n.id));
  const wars = others.filter((n) => atWar(world.dip, me.id, n.id));

  /* ---- answer threats first: what is being done to my cities decides what I build ---- */
  for (const c of me.cities) {
    if (!c.threatened) continue;
    if (c.threatened === "religious" || Math.max(0, ...Object.entries(c.conv || {}).filter(([k]) => k !== me.id).map(([, v]) => v)) > 25) {
      const free = c.plots.indexOf(null);
      if (free >= 0 && me.money >= COST.temple) out.push({ k: "build", city: c.id, plot: free, role: "temple", why: "answer conversion" });
      out.push({ k: "counter", city: c.id, why: "send missionaries home" });
    } else if (c.turrets < 3 + (c.hall - 1) && me.money >= COST.turret * (me.type === "economic" ? 1.5 : 1)) out.push({ k: "turret", city: c.id, why: "answer a raid" });
  }

  /* ---- develop cities ---- */
  const spare = me.money - RESERVE[me.type];
  if (spare > 0) {
    for (const c of [...me.cities].sort((a, b) => c_empty(b) - c_empty(a))) {
      const free = c.plots.indexOf(null);
      if (free >= 0) {
        const order = BUILD_ORDER[me.type];
        const have = c.plots.filter(Boolean).length;
        const role = order[have % order.length];
        if (me.money >= COST[role]) {
          out.push({ k: "build", city: c.id, plot: free, role });
          break;
        }
      } else if (spare > 220 && c.hall < 3) {
        out.push({ k: "hall", city: c.id });
        break;
      } else if (spare > 160) {
        out.push({ k: "improve", city: c.id });
        break;
      }
    }
    if (me.type === "military") {
      const weak = me.cities.find((c) => c.turrets < 2 + (c.hall - 1));
      if (weak && me.money >= COST.turret + 40) out.push({ k: "turret", city: weak.id });
    }
  }

  /* ---- produce vehicles ---- */
  if (me.vehicles < me.cap && me.money >= world.vehicleCost) {
    // Militarists keep building; merchants only when they can still afford to; everyone keeps a few at home.
    const keep = me.type === "economic" ? RESERVE.economic * 0.6 : 0;
    if (me.money - world.vehicleCost >= keep) out.push({ k: "vehicle", city: pickProducer(me.cities, me.type).id, modeBias: me.type === "military" ? "land" : "any" });
  }

  /* ---- diplomacy ---- */
  if (!world.grace) {
    if (me.type === "military") {
      // Pick on the weakest neighbour it can beat (never an ally); sue for peace only when losing.
      const prey = rivals
        .filter((n) => !atWar(world.dip, me.id, n.id) && n.strength < myStrength * 1.1 && rel(world.dip, me.id, n.id) < 15)
        .sort((a, b) => a.strength - b.strength)[0];
      if (prey && wars.length === 0 && rand() < p.aggression * 0.5) out.push({ k: "war", on: prey.id, why: "weak neighbour" });
      for (const w of wars) if (w.strength > myStrength * 1.8 && rand() < 0.5) out.push({ k: "peace", with: w.id });
    } else if (me.type === "religious") {
      // Holy wars against the militant who threaten it; peace with the penitent.
      const foe = rivals.find((n) => !atWar(world.dip, me.id, n.id) && n.type === "military" && rel(world.dip, me.id, n.id) < -30 && n.strength < myStrength);
      if (foe && rand() < 0.25) out.push({ k: "war", on: foe.id, why: "heresy" });
      for (const w of wars) if (rand() < 0.2 || w.strength > myStrength * 1.4) out.push({ k: "peace", with: w.id });
      const friend = others.find((n) => n.type === "religious" && canAlly(world.dip, me.id, n.id));
      if (friend && rand() < 0.3) out.push({ k: "ally", with: friend.id });
    } else {
      // Merchants: deals with everyone, alliances with the like-minded, gifts to keep the peace, peace at once.
      for (const n of others) if (canDeal(world.dip, me.id, n.id) && !hasDeal(world.dip, me.id, n.id) && rand() < 0.5) out.push({ k: "deal", with: n.id });
      for (const w of wars) if (rand() < 0.6) out.push({ k: "peace", with: w.id });
      const friend = others.find((n) => canAlly(world.dip, me.id, n.id));
      if (friend && rand() < 0.35) out.push({ k: "ally", with: friend.id });
      const sour = others.find((n) => !atWar(world.dip, me.id, n.id) && rel(world.dip, me.id, n.id) < 0 && n.strength > myStrength);
      if (sour && me.money > 200 && rand() < 0.3) out.push({ k: "gift", to: sour.id });
    }
  }

  /* ---- where vehicles go ---- */
  const hostileCities = world.cities.filter((c) => c.owner && c.owner !== me.id && atWar(world.dip, me.id, c.owner));
  const freeCities = world.cities.filter((c) => !c.owner);
  const notMine = world.cities.filter((c) => c.owner !== me.id && !(c.owner && allied(world.dip, me.id, c.owner)));
  if (me.type === "military") {
    const pool = hostileCities.length ? hostileCities : world.grace ? [] : freeCities;
    const best = [...pool].sort((a, b) => cityPower(a) - cityPower(b))[0];
    if (best) out.push({ k: "target", kind: "attack", city: best.id, why: hostileCities.length ? "enemy city" : "independent city" });
  } else if (me.type === "religious") {
    // The weakest faith that is not already devout and not a friend; independents first.
    const pool = (freeCities.length ? freeCities : notMine).filter((c) => !c.devout || c.owner !== me.id);
    const best = [...pool].sort((a, b) => a.faith + (a.owner ? 2 : 0) - (b.faith + (b.owner ? 2 : 0)))[0];
    if (best && !world.grace) out.push({ k: "target", kind: "convert", city: best.id });
    else if (best) out.push({ k: "target", kind: "convert", city: (freeCities[0] || best).id });
  } else {
    // Trade partners: any city of a nation we are not fighting, richest connection first; buy what is ready.
    const pool = notMine.filter((c) => !c.owner || !atWar(world.dip, me.id, c.owner));
    const ready = pool.filter((c) => (c.trade?.[me.id] || 0) >= 100);
    const buy = ready.find((c) => me.money >= world.buyoutCost(c) + RESERVE.economic * 0.3);
    if (buy) out.push({ k: "buy", city: buy.id });
    const best = [...pool].filter((c) => (c.trade?.[me.id] || 0) < 100).sort((a, b) => (b.trade?.[me.id] || 0) - (a.trade?.[me.id] || 0) || cityPower(a) - cityPower(b))[0];
    if (best) out.push({ k: "target", kind: "trade", city: best.id });
  }
  // Everyone defends a city under attack: idle armed vehicles go to it (the stage does this) and allies are asked to help.
  const attacked = me.cities.find((c) => c.threatened === "military");
  if (attacked) out.push({ k: "defend", city: attacked.id });
  // Offers to you.
  if (!world.grace) {
    const you = world.cities.filter((c) => c.owner === "you");
    if (me.type === "economic" && me.money > 420 && you.length > 1 && rand() < 0.2 && !atWar(world.dip, me.id, "you")) {
      const weakest = [...you].sort((a, b) => cityPower(a) - cityPower(b))[0];
      out.push({ k: "offer", kind: "buyout", city: weakest.id, amount: world.buyoutCost(weakest) });
    }
    if (me.type === "military" && rel(world.dip, me.id, "you") < 10 && !atWar(world.dip, me.id, "you") && myStrength > strengthOf(world.cities.filter((c) => c.owner === "you"), world.youVehicles || 0) * 1.5 && rand() < 0.15) out.push({ k: "offer", kind: "tribute" });
    if (rel(world.dip, me.id, "you") >= ALLY_AT - 5 && canAlly(world.dip, me.id, "you") && rand() < 0.2) out.push({ k: "offer", kind: "alliance" });
    if (me.type !== "military" && canDeal(world.dip, me.id, "you") && !hasDeal(world.dip, me.id, "you") && rel(world.dip, me.id, "you") >= 5 && rand() < 0.15) out.push({ k: "offer", kind: "deal" });
  }
  return out;
}

const c_empty = (c) => c.plots.filter((p) => !p).length;
/** The city that should make this nation's vehicles: one of its own kind with the most room. */
function pickProducer(cities, type) {
  return [...cities].sort((a, b) => (b.type === type) - (a.type === type) || (a.queue || 0) - (b.queue || 0))[0];
}
