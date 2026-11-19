/**
 * Civilization Stage rules: cities, their economy, vehicles, the three ways to take a city (force,
 * money, faith), spice, rival nations, diplomacy, superweapons and the end of the stage. Pure data and
 * decisions with no scene, so every number is unit tested and tuned in one place.
 *
 * Rates are per second of play. Money is "§" (Sporebucks).
 */
import { designStats, partOf, vehicleMode } from "../creations/modular.js";
import { readDiplomacy } from "./diplomacy.js";

export const CIV_SAVE_KEY = "johnny-spore-civ-stage";
export const CIV_VERSION = 1;
export const YOU = "you";

/** The three kinds of city. A city makes vehicles of its own kind. */
export const CITY_TYPES = {
  military: { name: "Military", icon: "⚔", verb: "Attack", desc: "Builds military vehicles that destroy defences and capture cities by force." },
  economic: { name: "Economic", icon: "💰", verb: "Trade", desc: "Builds economic vehicles that open trade routes. Rich partners can be bought outright." },
  religious: { name: "Religious", icon: "🕊", verb: "Preach", desc: "Builds religious vehicles that preach to a city until it converts." },
};
export const TYPE_IDS = Object.keys(CITY_TYPES);

/* ---- cities ------------------------------------------------------------------------------- */
/** Building plots around each city hall; turrets stand on the wall and are counted separately. */
export const PLOTS = 6;
export const MAX_TURRETS = 3;
export const PLOT_ROLES = ["house", "factory", "fun", "temple"];
export const BUILD_COST = { house: 40, factory: 60, fun: 50, temple: 55, turret: 50 };
export const START_MONEY = 250;
/** Hit points: each turret has its own; the hall falls when they are gone and its own run out. */
export const TURRET_HP = 60;
export const HALL_HP = 200;
export const TURRET_RANGE = 22;
/** Defences heal this fraction of their maximum per second when nobody is attacking. */
export const REPAIR = 0.02;

/**
 * How well a building does its job: its design's strength (1..10) relative to a typical one (5).
 * @param {number} strength
 */
export const designFactor = (strength) => 0.7 + Math.max(1, Math.min(10, strength || 5)) * 0.06;

/**
 * A city's economy from its buildings. `strengths` are the owner's design strengths per role.
 * @param {{plots:(string|null)[], turrets:number, type?:string, unrest?:number}} city  (trade routes are paid separately: tradeIncome)
 * @param {{strengths?:Object<string,number>, incomeBonus?:number, happyBonus?:number}} [owner]
 * @returns {{ pop:number, happiness:number, income:number, faith:number, riot:boolean }}
 */
export function cityEconomy(city, owner = {}) {
  const k = (role) => designFactor(owner.strengths?.[role]);
  const lvl = (k0) => levelFactor(city.levels?.[k0]);
  // Buildings count by how well they have been improved.
  const weight = (role) => city.plots.reduce((sum, p, i) => sum + (p === role ? lvl(i) : 0), 0);
  const houses = weight("house"),
    factories = weight("factory"),
    fun = weight("fun"),
    temples = weight("temple");
  const adj = adjacency(city.plots);
  const hall = Math.max(1, Math.min(HALL_MAX, city.hall || 1));
  const pop = Math.round((2 + houses * 3 * k("house")) * (1 + 0.25 * (hall - 1)));
  // Factories make money but people don't like living next to them; entertainment and temples help. What stands
  // next to what matters too (see adjacency).
  const happiness = Math.max(-5, Math.min(5, Math.round((1 + fun * 2 * k("fun") + temples * 0.5 - factories + adj.happiness + (owner.happyBonus || 0) - (city.unrest || 0)) * 10) / 10));
  const riot = happiness < 0;
  const base = 1.5 + factories * 1.2 * k("factory") + pop * 0.2 + adj.income * k("factory");
  const income = Math.round(base * (riot ? 0.25 : 1) * (1 + (owner.incomeBonus || 0)) * 100) / 100;
  const faith = Math.round((2 + temples * 2 * k("temple") + adj.faith + (city.type === "religious" ? 1 : 0) + (city.devout ? 1 : 0)) * 100) / 100;
  return { pop, happiness, income, faith, riot, upkeep: upkeepOf(city) };
}

/* ---- the city planner: improving, expanding and arranging ------------------------------------- */
export const HALL_MAX = 3;
export const MAX_LEVEL = 3;
/** How much better a building does its work at level 1, 2 and 3. */
export const levelFactor = (level) => 1 + 0.35 * (Math.max(1, Math.min(MAX_LEVEL, level || 1)) - 1);
/** Turret sites grow with the city hall: 3, 4 and 5. */
export const turretSlots = (hall = 1) => MAX_TURRETS + Math.max(0, Math.min(HALL_MAX, hall || 1) - 1);
/** Vehicles a city supports grow with its hall too. */
export const vehicleCapOf = (hall = 1) => VEHICLES_PER_CITY + Math.max(0, Math.min(HALL_MAX, hall || 1) - 1);
/** Cost to improve a building from `level` to the next. */
export const improveCost = (role, level) => Math.round(BUILD_COST[role] * (0.9 + level * 0.55));
/** Cost to expand the city hall from `level` to the next (more people, turret sites and vehicles, tougher walls). */
export const hallCost = (level) => (level <= 1 ? 160 : 340);
/** Money a city's buildings cost to keep every second: bigger and better cities are dearer. */
export function upkeepOf(city) {
  const b = city.plots.reduce((sum, p, i) => sum + (p ? 0.05 * levelFactor(city.levels?.[i]) : 0), 0);
  return Math.round((b + (city.turrets || 0) * 0.1 + ((city.hall || 1) - 1) * 0.12) * 100) / 100;
}
/** Upkeep for each vehicle you field. */
export const VEHICLE_UPKEEP = 0.08;

/**
 * Plots sit in a ring, so each building has two neighbours. What it stands next to changes how it works:
 * factories side by side feed each other, houses by an amusement park are happier and by a factory are not,
 * temples beside houses carry the faith to the people. Returns the total effect and a note for each plot.
 * @param {(string|null)[]} plots
 */
export function adjacency(plots) {
  const n = plots.length;
  const out = { happiness: 0, income: 0, faith: 0, notes: plots.map(() => []) };
  const note = (i, text, good) => out.notes[i].push({ text, good });
  for (let i = 0; i < n; i++) {
    const role = plots[i];
    if (!role) continue;
    for (const j of [(i + 1) % n, (i + n - 1) % n]) {
      const other = plots[j];
      if (!other) continue;
      if (role === "factory" && other === "factory") {
        out.income += 0.18;
        note(i, "Beside another factory: +output", true);
      } else if (role === "house" && other === "fun") {
        out.happiness += 0.3;
        note(i, "Beside entertainment: happier", true);
      } else if (role === "house" && other === "factory") {
        out.happiness -= 0.3;
        note(i, "Beside a factory: smoke and noise", false);
      } else if (role === "temple" && other === "house") {
        out.faith += 0.4;
        note(i, "Beside houses: the faith spreads", true);
      }
    }
  }
  for (const k of ["happiness", "income", "faith"]) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** Maximum hit points of a city's turrets together, and of its hall. */
export function cityDefence(city, strengths = {}) {
  const k = designFactor(strengths.turret);
  const walls = 1 + 0.25 * ((city.hall || 1) - 1);
  return { turretHp: city.turrets * TURRET_HP * k * walls, hallHp: (HALL_HP + city.plots.filter(Boolean).length * 10) * walls, dps: city.turrets * (4 + (strengths.turret || 5) * 0.6) };
}

/** Money it takes to buy a city outright, once its trade with you is complete. */
export const buyoutCost = (econ, relation = 0) => Math.round((80 + econ.pop * 22) * (relation >= 50 ? 0.8 : relation < 0 ? 1.3 : 1));

/**
 * Damage a city. Turrets soak damage first, then the hall. Fractions (0..1) are stored on the city.
 * @returns {{ captured:boolean, turretsDown:boolean }}
 */
export function damageCity(city, dmg, defence) {
  let left = dmg;
  if (city.turrets > 0 && city.turretHp > 0 && defence.turretHp > 0) {
    const pool = city.turretHp * defence.turretHp;
    const take = Math.min(pool, left);
    city.turretHp = Math.max(0, (pool - take) / defence.turretHp);
    left -= take;
  }
  if (left > 0) city.hallHp = Math.max(0, city.hallHp - left / defence.hallHp);
  city.calm = 0;
  return { captured: city.hallHp <= 0, turretsDown: city.turrets === 0 || city.turretHp <= 0 };
}
/** Defences mend while nobody attacks (`calm` counts seconds since the last hit). */
export function repairCity(city, dt) {
  city.calm = (city.calm || 0) + dt;
  if (city.calm < 6) return;
  city.turretHp = Math.min(1, city.turretHp + REPAIR * dt);
  city.hallHp = Math.min(1, city.hallHp + REPAIR * dt);
}
/** Preach to a city: its conversion to `by` rises; everyone else's falls a little. @returns true when it converts */
export function preachTo(city, by, amount) {
  city.conv ||= {};
  city.conv[by] = Math.min(100, (city.conv[by] || 0) + amount);
  return city.conv[by] >= 100;
}
/** A trade delivery. @returns {{ newRoute:boolean, complete:boolean }} */
export function deliverTrade(city, by, amount) {
  city.trade ||= {};
  const before = city.trade[by] || 0;
  city.trade[by] = Math.min(100, before + amount);
  return { newRoute: before === 0, complete: city.trade[by] >= 100 };
}
/**
 * Hand a city to a new owner. What is left depends on how it was won:
 *  - by force: the hall is half wrecked, two buildings are destroyed, improvements are lost, the people are restless;
 *  - by conversion: everything is intact and the faithful are devout (they resist being converted away);
 *  - by purchase: everything is intact and calm, and the sale leaves the city's trade with others in place.
 * @param {() => number} [rand]
 */
export function transferCity(city, owner, method, rand = Math.random) {
  city.owner = owner;
  city.turretHp = 1;
  city.hallHp = method === "military" ? 0.5 : 1;
  city.conv = {};
  city.trade = Object.fromEntries(Object.entries(city.trade || {}).filter(([k]) => k !== owner));
  city.unrest = method === "military" ? 2 : 0;
  city.calm = 0;
  city.devout = method === "religious";
  city.queue = [];
  if (method === "military") {
    const filled = city.plots.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    for (let n = 0; n < 2 && filled.length; n++) {
      const i = filled.splice(Math.floor(rand() * filled.length), 1)[0];
      city.plots[i] = null;
    }
    city.levels = city.plots.map(() => 1);
    city.hall = Math.max(1, (city.hall || 1) - 1);
  }
  return city;
}
/** Unrest after a conquest fades over a few minutes. */
export const calmUnrest = (city, dt) => (city.unrest = Math.max(0, (city.unrest || 0) - dt / 90));

/* ---- vehicles ---------------------------------------------------------------------------- */
/** Each city you own lets you field this many vehicles. */
export const VEHICLES_PER_CITY = 3;
/** Air vehicles are allowed once a nation has this many cities. */
export const AIR_AT = 3;

/**
 * A military design's weapon: its parts' range, rate of fire and kind, averaged by how much attack each part
 * adds, so a machine gun and a mortar on one chassis behave like a mix of both. Shots are projectiles.
 * @returns {{range:number, rate:number, kind:"bullet"|"shell"|"missile"}}
 */
export function weaponOfDesign(design) {
  let w = 0,
    range = 0,
    rate = 0,
    shell = 0,
    missile = 0;
  for (const p of design.parts || []) {
    const def = partOf("vehicle", p.id);
    if (!def?.add.attack) continue;
    const k = def.add.attack * (p.mirror ? 2 : 1);
    w += k;
    range += (def.add.rng || 14) * k;
    rate += (def.add.rof || 1) * k;
    if (p.id === "missiles") missile += k;
    else if (p.id === "mortar" || p.id === "cannonV") shell += k;
  }
  if (!w) return { range: 14, rate: 1, kind: "shell" };
  return { range: Math.round((range / w) * 10) / 10, rate: Math.round((rate / w) * 100) / 100, kind: missile > shell && missile > 0 ? "missile" : shell > 0 ? "shell" : "bullet" };
}

/**
 * Play values for a vehicle design.
 * @returns {{ ok:boolean, role:string, mode:string|null, speed:number, hp:number, dps:number, trade:number, preach:number, cost:number }}
 */
export function vehicleUnit(design, mods = {}) {
  const s = designStats(design);
  const role = design.role;
  const mode = vehicleMode(design);
  const pace = mode === "air" ? 1.25 : mode === "sea" ? 1.05 : 1;
  const power = s.stats.power;
  const weapon = role === "military" ? weaponOfDesign(design) : null;
  return {
    ok: s.ok,
    weapon,
    role,
    mode,
    speed: Math.round((4 + s.stats.speed * 1.3) * pace * 10) / 10,
    hp: Math.round((24 + s.stats.health * 9) * (1 + (mods.health || 0))),
    dps: role === "military" ? Math.round((2 + power * 0.9) * (1 + (mods.damage || 0)) * 10) / 10 : 0,
    // Trade: how much of the way to a full trade partnership one delivery takes you.
    trade: role === "economic" ? Math.round((10 + power * 1.6) * (1 + (mods.social || 0))) : 0,
    // Preaching: conversion per second before the city's faith resists.
    preach: role === "religious" ? Math.round((1 + power * 0.35) * (1 + (mods.social || 0)) * 100) / 100 : 0,
    cost: s.cost,
  };
}

/** Which modes a nation may build, given its city count and whether the city is on the coast. */
export function allowedModes(cityCount, coastal) {
  return ["land", ...(coastal ? ["sea"] : []), ...(cityCount >= AIR_AT ? ["air"] : [])];
}

/** Can a vehicle of this mode reach a city? Sea vehicles need a coastal city; land and air go anywhere on the island. */
export const canReach = (mode, city) => mode !== "sea" || !!city.coastal;

/** Conversion per second a preacher achieves on a city of this faith. */
export const preachRate = (preach, faith) => (preach * 0.6) / Math.max(1, faith);

/* ---- starter vehicles for every role and mode --------------------------------------------- */
const EQUIP = {
  military: [{ id: "cannonV", x: 0, y: 1.15, z: 1 }],
  economic: [{ id: "cargo", x: 0, y: 1.35, z: -0.4 }],
  religious: [{ id: "speaker", x: 0, y: 1.3, z: 0.6 }],
};
const CHASSIS = {
  land: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.85, y: 0.4, z: 0.9, mirror: true }, { id: "wheel", x: 0.85, y: 0.4, z: -0.9, mirror: true }],
  sea: [{ id: "hull", x: 0, y: 0.4, z: 0 }, { id: "propeller", x: 0, y: 0.3, z: -1.7 }, { id: "propeller", x: 0.4, y: 0.3, z: -1.6, mirror: true }],
  air: [{ id: "fuselage", x: 0, y: 0.5, z: 0 }, { id: "wingPart", x: 0, y: 0.5, z: 0 }, { id: "jet", x: 0.7, y: 0.4, z: -0.6, mirror: true }],
};
const LIFT = { land: 0, sea: -0.2, air: -0.35 };
const NAMES = { military: { land: "Rumbler", sea: "Gunboat", air: "Striker" }, economic: { land: "Hauler", sea: "Barge", air: "Courier" }, religious: { land: "Herald", sea: "Chapel Boat", air: "Seraph" } };
/** A ready-made vehicle for a role and mode, in a nation's colours. */
export function starterVehicle(role, mode, colors = { base: 0xd6a03f, accent: 0x3fa9d6, trim: 0x2a2f25 }) {
  return {
    kind: "vehicle",
    v: 1,
    name: NAMES[role][mode],
    role,
    colors: { ...colors },
    parts: [...CHASSIS[mode], ...EQUIP[role].map((p) => ({ ...p, y: p.y + LIFT[mode] }))].map((p) => ({ ry: 0, s: 1, mirror: false, ...p })),
  };
}

/* ---- spice --------------------------------------------------------------------------------- */
export const SPICE_INCOME = 1.1;

/* ---- the player's earlier stages ------------------------------------------------------------- */
/**
 * What the species brings from its earlier stages. The tribal trait sets the first city's kind;
 * cards from every earlier stage each give one lasting bonus.
 * @param {{cellDiet?:string, creatureCard?:string, tribeTrait?:string}} legacy
 */
export function civLegacy(legacy = {}) {
  const startType = { Warlike: "military", Industrious: "economic", Diplomatic: "religious" }[legacy.tribeTrait] || "economic";
  const mods = { damage: 0, health: 0, social: 0, incomeBonus: 0, happyBonus: 0, turret: 0, relation: 0 };
  const lines = [];
  const diet = { carnivore: "meat", herbivore: "plant", omnivore: "omni" }[legacy.cellDiet] || legacy.cellDiet;
  if (diet === "meat") (mods.health += 0.1), lines.push({ icon: "🦈", text: "Carnivore cells: vehicles have 10% more health." });
  else if (diet === "plant") (mods.happyBonus += 1), lines.push({ icon: "🌿", text: "Herbivore cells: every city is a little happier." });
  else if (diet) (mods.incomeBonus += 0.05), lines.push({ icon: "🍽", text: "Omnivore cells: 5% more income." });
  if (legacy.creatureCard === "Aggressive") (mods.damage += 0.15), lines.push({ icon: "🦖", text: "Aggressive creatures: military vehicles hit 15% harder." });
  else if (legacy.creatureCard === "Social") (mods.social += 0.15), lines.push({ icon: "🎵", text: "Social creatures: trade and preaching work 15% faster." });
  else if (legacy.creatureCard) (mods.incomeBonus += 0.05), lines.push({ icon: "🧭", text: "Adaptable creatures: 5% more income." });
  if (legacy.tribeTrait === "Warlike") (mods.turret += 0.2), lines.push({ icon: "⚔", text: "Warlike tribe: you start as a military city, and turrets are 20% stronger." });
  else if (legacy.tribeTrait === "Diplomatic") (mods.relation += 15), lines.push({ icon: "🕊", text: "Diplomatic tribe: you start as a religious city, and every nation likes you a little more." });
  else if (legacy.tribeTrait === "Industrious") (mods.incomeBonus += 0.1), lines.push({ icon: "⚖", text: "Industrious tribe: you start as an economic city, with 10% more income." });
  return { startType, mods, lines };
}

/* ---- nations and diplomacy ----------------------------------------------------------------- */
export const clampRel = (r) => Math.max(-100, Math.min(100, Math.round(r * 10) / 10));
/** How relations move. */
export const DIPLO = { trade: 4, gift: 15, giftCost: 60, preach: -0.5, attack: -40, war: -30, peaceAt: -10, peaceCost: 120, allyAt: 60, drift: 0.05 };
export const relationWord = (r, war) => (war ? "At war" : r >= DIPLO.allyAt ? "Allied" : r >= 20 ? "Friendly" : r > -20 ? "Neutral" : r > -50 ? "Wary" : "Hostile");

/* ---- superweapons ----------------------------------------------------------------------------- */
/** Original names: each takes one city at once, the way your civilization prefers to win. */
export const SUPERWEAPONS = {
  military: { name: "Sky Hammer", icon: "☄", desc: "A strike from orbit flattens a city's defences and its hall: the city is yours." },
  economic: { name: "Golden Handshake", icon: "🤝", desc: "An offer no city council refuses: buy any city at once." },
  religious: { name: "Great Revelation", icon: "✨", desc: "A vision in the sky: a whole city converts at once." },
};
export const SUPER_COST = 400;
export const SUPER_COOLDOWN = 150;
/** The superweapon unlocks when you hold at least half of the planet's cities. */
export const superUnlocked = (yours, total) => total > 0 && yours >= Math.ceil(total / 2);

/** How you have mostly won cities: the kind of superweapon you get and the card you finish with. */
export function dominantMethod(captures, startType) {
  const order = [...TYPE_IDS].sort((a, b) => (captures[b] || 0) - (captures[a] || 0) || (b === startType) - (a === startType));
  return (captures[order[0]] || 0) > 0 ? order[0] : startType;
}

/* ---- the end of the stage ---------------------------------------------------------------------- */
export const CIV_CARDS = {
  military: { name: "Military", icon: "⚔", color: "#ef4b48", text: "Your nation united the world by force. Its fleets carry that reputation to the stars." },
  economic: { name: "Economic", icon: "💰", color: "#f5c75a", text: "Your nation bought its way to unity. Every world is a market, and you know how to sell." },
  religious: { name: "Religious", icon: "🕊", color: "#b58cf0", text: "Your nation united the world in one faith. Its message will travel between stars." },
};
export const civWon = (cities) => cities.length > 0 && cities.every((c) => c.owner === YOU);
/** Planetary domination: hold this share of the planet's cities... */
export const DOMINATION = 0.75;
/**
 * How close you are to uniting the planet. You win by holding every city, or by holding three quarters of
 * them with no rival left that is neither fallen nor your ally: by force, faith, trade or friendship.
 * @param {{ total:number, yours:number, rivals:Array<{alive:boolean, allied:boolean}> }} s
 */
export function dominance({ total, yours, rivals }) {
  const need = Math.ceil(total * DOMINATION);
  const holdouts = rivals.filter((r) => r.alive && !r.allied).length;
  return { need, yours, total, holdouts, won: total > 0 && (yours >= total || (yours >= need && holdouts === 0)), byAlliance: yours < total && yours >= need && holdouts === 0 };
}
export function civArchetype(captures, startType) {
  const id = dominantMethod(captures, startType);
  return { id, ...CIV_CARDS[id] };
}

/* ---- names ------------------------------------------------------------------------------------------ */
const SYL = ["ar", "bel", "cor", "dun", "el", "fal", "gan", "hol", "is", "jor", "kel", "lun", "mar", "nor", "ol", "pel", "quin", "ros", "sal", "tor", "ul", "ven", "wyn", "zar"];
const END = ["ia", "on", "um", "heim", "ford", "polis", "ara", "ix", "and", "eth"];
export function cityName(seed) {
  let s = seed >>> 0 || 1;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = SYL[Math.floor(r() * SYL.length)] + (r() < 0.5 ? SYL[Math.floor(r() * SYL.length)] : "") + END[Math.floor(r() * END.length)];
  return n[0].toUpperCase() + n.slice(1);
}

/* ---- saves ------------------------------------------------------------------------------------------- */
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const ownerOk = (o, nations) => (o === YOU || o === null ? o : typeof o === "string" && nations.includes(o) ? o : null);
/**
 * Read a saved Civilization Stage, tolerating anything missing or malformed. Designs are kept as they
 * are; the stage validates them before use.
 */
export function readCivSave(raw) {
  let d = null;
  try {
    d = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.cities) || !d.cities.length) return null;
  const nations = (Array.isArray(d.nations) ? d.nations : []).slice(0, 4).map((n, i) => ({
    id: typeof n?.id === "string" && /^[a-z0-9]{1,12}$/.test(n.id) ? n.id : "n" + i,
    type: TYPE_IDS.includes(n?.type) ? n.type : TYPE_IDS[i % 3],
    relation: clampRel(num(n?.relation, -100, 100, 0)),
    war: !!n?.war,
    money: num(n?.money, 0, 1e6, 100),
    alive: n?.alive !== false,
  }));
  const ids = nations.map((n) => n.id);
  const cities = d.cities.slice(0, 16).map((c, i) => ({
    id: Number.isInteger(c?.id) ? c.id : i,
    owner: ownerOk(c?.owner ?? null, ids),
    type: TYPE_IDS.includes(c?.type) ? c.type : "economic",
    plots: Array.from({ length: PLOTS }, (_, k) => (PLOT_ROLES.includes(c?.plots?.[k]) ? c.plots[k] : null)),
    turrets: Math.round(num(c?.turrets, 0, MAX_TURRETS + HALL_MAX - 1, 0)),
    turretHp: num(c?.turretHp, 0, 1, 1),
    hallHp: num(c?.hallHp, 0, 1, 1),
    trade: Object.fromEntries(Object.entries(c?.trade && typeof c.trade === "object" ? c.trade : {}).filter(([k]) => k === YOU || ids.includes(k)).map(([k, v]) => [k, num(v, 0, 100, 0)])),
    conv: Object.fromEntries(Object.entries(c?.conv && typeof c.conv === "object" ? c.conv : {}).filter(([k]) => k === YOU || ids.includes(k)).map(([k, v]) => [k, num(v, 0, 100, 0)])),
    unrest: num(c?.unrest, 0, 5, 0),
    levels: Array.from({ length: PLOTS }, (_, k) => Math.round(num(c?.levels?.[k], 1, MAX_LEVEL, 1))),
    hall: Math.round(num(c?.hall, 1, HALL_MAX, 1)),
    devout: !!c?.devout,
    queue: (Array.isArray(c?.queue) ? c.queue : [])
      .slice(0, 3)
      .map((i) => ({ key: typeof i?.key === "string" && /^(military|economic|religious):(land|sea|air)$/.test(i.key) ? i.key : null, cost: num(i?.cost, 0, 5000, 100), total: num(i?.total, 1, 600, 20), t: num(i?.t, 0, 600, 0) }))
      .filter((i) => i.key),
  }));
  // A city can only hold as many turrets as its hall allows.
  for (const c of cities) c.turrets = Math.min(c.turrets, turretSlots(c.hall));
  if (!cities.some((c) => c.owner === YOU)) return null;
  const designs = d.designs && typeof d.designs === "object" ? d.designs : {};
  const dip = d.dip && typeof d.dip === "object" ? readDiplomacy(d.dip, [YOU, ...ids]) : null;
  return {
    v: CIV_VERSION,
    planet: d.planet === 1,
    money: num(d.money, 0, 1e7, START_MONEY),
    startType: TYPE_IDS.includes(d.startType) ? d.startType : "economic",
    nations,
    dip,
    cities,
    geysers: (Array.isArray(d.geysers) ? d.geysers : []).slice(0, 16).map((g) => ({ owner: ownerOk(g?.owner ?? null, ids), hp: num(g?.hp, 0, 1, 1) })),
    vehicles: (Array.isArray(d.vehicles) ? d.vehicles : []).slice(0, 60).map((v) => ({ owner: ownerOk(v?.owner, ids), design: typeof v?.design === "string" ? v.design.slice(0, 40) : null, x: num(v?.x, -900, 900, 0), z: num(v?.z, -900, 900, 0), hp: num(v?.hp, 0, 1, 1), city: Number.isInteger(v?.city) ? v.city : -1 })).filter((v) => v.owner && v.design),
    designs: { building: designs.building && typeof designs.building === "object" ? designs.building : {}, vehicle: designs.vehicle && typeof designs.vehicle === "object" ? designs.vehicle : {} },
    captures: Object.fromEntries(TYPE_IDS.map((t) => [t, Math.round(num(d.captures?.[t], 0, 99, 0))])),
    superCool: num(d.superCool, 0, SUPER_COOLDOWN, 0),
    won: !!d.won,
    card: d.won && TYPE_IDS.includes(d.card) ? d.card : null,
    time: num(d.time, 0, 1e7, 0),
  };
}

/** Income a nation earns from its trade routes with other owners' cities (both sides of a route earn). */
export const ROUTE_INCOME = 0.5;
export function tradeIncome(cities, owner) {
  let routes = 0;
  for (const c of cities) {
    if (c.owner === owner) routes += Object.entries(c.trade || {}).filter(([k, v]) => k !== owner && v > 0).length;
    else if ((c.trade?.[owner] || 0) > 0) routes++;
  }
  return routes * ROUTE_INCOME;
}
