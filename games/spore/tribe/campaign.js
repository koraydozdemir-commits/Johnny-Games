/**
 * Tribal Stage campaign: the five rival tribes, diplomacy, the village economy, equipment tiers and
 * the ways the stage can end. Pure data and decisions (no scene), so every number is unit tested and
 * tuned in one place.
 */
import { GIFT, SOCIAL_GAIN, SOCIAL_MISS, TOOLS, TOOL_IDS, clampRelation } from "./rules.js";
import { JOBS } from "./life.js";

/**
 * The five rivals. Each one wants something different, which makes each one a different problem:
 * - music, gift: how much a song or a gift moves them (1 = normal)
 * - trade: they deal in goods (or any ally does)
 * - raid: seconds between raids while they dislike you ([min, max]); null = they never raid
 * - hutHp: how much harder their hut is to bring down
 * - arms: what their members carry, by member index
 * - calm: the relation their temper cools back to (they never warm up on their own past it)
 */
export const RIVALS = {
  traders: {
    name: "Traders",
    icon: "🧺",
    color: 0xd6a03f,
    diet: "omni",
    mood: "Shrewd",
    start: 10,
    music: 0.9,
    gift: 1.35,
    trade: true,
    raid: null,
    hutHp: 1,
    arms: [null],
    members: 5,
    calm: 0,
    hint: "They deal in goods: trade food for tools, and gifts go a long way. They only fight back.",
  },
  musicians: {
    name: "Musicians",
    icon: "🎶",
    color: 0x8a5fd0,
    diet: "plant",
    mood: "Festive",
    start: 15,
    music: 1.5,
    gift: 0.7,
    trade: false,
    raid: null,
    hutHp: 1,
    arms: ["horn", null],
    members: 5,
    calm: 0,
    hint: "They live for music: every song counts for half again. Gifts of food impress them less.",
  },
  hunters: {
    name: "Hunters",
    icon: "🏹",
    color: 0x4f9a5a,
    diet: "meat",
    mood: "Hungry",
    start: -5,
    music: 0.9,
    gift: 1.25,
    trade: false,
    raid: [150, 210],
    raidWhenHungry: true,
    hutHp: 1.1,
    arms: ["spear", null],
    members: 5,
    calm: -5,
    hunt: true,
    hint: "They hunt the same herds as you. Feed them and they settle; let them starve and they raid.",
  },
  defenders: {
    name: "Defenders",
    icon: "🛡",
    color: 0x5b7fa6,
    diet: "plant",
    mood: "Guarded",
    start: -10,
    music: 1,
    gift: 1,
    trade: false,
    raid: null,
    hutHp: 2,
    palisade: true,
    retaliate: true,
    arms: ["spear"],
    members: 6,
    calm: -10,
    hint: "A palisade doubles their hut's strength. They never raid, but strike back hard when hit.",
  },
  warriors: {
    name: "Warriors",
    icon: "⚔",
    color: 0xc9483c,
    diet: "meat",
    mood: "Warlike",
    start: -35,
    music: 0.65,
    gift: 0.85,
    trade: false,
    raid: [110, 160],
    hutHp: 1.25,
    arms: ["axe", "spear", null],
    members: 6,
    calm: -35,
    raidsRivals: true,
    hint: "They raid you and your friends. Music moves them slowly; peace costs food, war costs blood.",
  },
};
/** Nearest village first: the friendlier rivals live close, the warriors furthest away. */
export const RIVAL_ORDER = ["traders", "musicians", "hunters", "defenders", "warriors"];

/* ---- your village -------------------------------------------------------------------------- */
/** The chief's hut: upgrading it makes room for more of your tribe and makes it tougher. */
export const HUT_LEVELS = [
  { level: 1, cost: 0, room: 0, hp: 1 },
  { level: 2, cost: 45, room: 2, hp: 1.5 },
  { level: 3, cost: 90, room: 4, hp: 2 },
];
export const hutLevel = (n) => HUT_LEVELS[Math.max(0, Math.min(HUT_LEVELS.length - 1, (n | 0) - 1))];
/** Members (eggs included) the village can hold. */
export const villageRoom = (settled, level = 1, houses = 0) => 6 + 3 * Math.max(0, settled) + hutLevel(level).room + HOUSE_ROOM * Math.max(0, houses);

/**
 * Village structures besides tool shacks. Dwellings make room for more of the tribe. Decorations lift
 * the village's spirit: members resting at home heal faster with each one.
 */
export const HOUSE_ROOM = 2;
export const STRUCTURES = {
  house: { name: "Dwelling", icon: "🏠", cost: [30, 45, 60], max: 3, desc: "Room for " + HOUSE_ROOM + " more of your tribe." },
  totem: { name: "Totem pole", icon: "🗿", cost: [15, 25], max: 2, decor: true, desc: "Carved ancestors watch over the village." },
  banner: { name: "Tribe banner", icon: "🚩", cost: [10, 15], max: 2, decor: true, desc: "Your colours, flying high." },
  flowers: { name: "Flower bed", icon: "🌼", cost: [8, 10, 12], max: 3, decor: true, desc: "Bright blooms by the paths." },
  lookout: { name: "Lookout", icon: "🗼", cost: [25, 35], max: 2, desc: "Defenders keep watch from it and spot raiders sooner." },
  garden: { name: "Garden", icon: "🌱", cost: [18, 26], max: 2, desc: "A tended patch: foragers harvest it again and again." },
  dance: { name: "Dancing ground", icon: "🥁", cost: [20], max: 1, decor: true, desc: "A ring of drums where the tribe celebrates." },
};
export const STRUCTURE_IDS = Object.keys(STRUCTURES);
/** What the next one of a structure costs, or null at the limit. */
export const structureCost = (id, built) => (built >= STRUCTURES[id].max ? null : STRUCTURES[id].cost[Math.min(built, STRUCTURES[id].cost.length - 1)]);
/** Healing at home: +15% per decoration, up to +90%. */
export const spiritHeal = (decorations) => 1 + 0.15 * Math.min(6, Math.max(0, decorations));

/** Jobs a member can be given (see life.js): kept here under their old name for the HUD and tests. */
export const ROLES = JOBS;

/** Equipment: every shack starts at tier 1 and can be upgraded once. */
export const TIER_NAMES = ["", "Stone", "Bronze"];
export const upgradeCost = (tool) => Math.round(TOOLS[tool].cost * 1.6);
/** What tier 2 does for each kind of tool. */
export const TIER2 = { fight: 1.5, music: 1.5, village: 1.5 };
export const tierMult = (tool, tier) => (tool && tier >= 2 ? TIER2[TOOLS[tool].kind] : 1);

/** Where a new shack can go: near the hut, on dry ground, clear of everything else. */
export const PLACE = { min: 6, max: 24, gap: 3.6 };
export function canPlace(at, home, taken, height) {
  const d = Math.hypot(at.x - home.x, at.z - home.z);
  if (d < PLACE.min) return "Too close to the hut.";
  if (d > PLACE.max) return "Too far from the village.";
  if (height(at.x, at.z) < 0.3) return "Too wet to build on.";
  for (const t of taken) if (Math.hypot(at.x - t.x, at.z - t.z) < (t.r || PLACE.gap)) return "Something is already there.";
  return null;
}

/**
 * Food upkeep: every adult eats one portion a minute. Children are fed by the tribe for free.
 * @returns {{ eat:number, short:number }}  what was eaten, and how much was missing
 */
export const UPKEEP_EVERY = 60;
export function upkeep(food, adults) {
  const eat = Math.min(food, adults);
  return { eat, short: adults - eat };
}

/* ---- diplomacy -------------------------------------------------------------------------- */
/** How a call answered at a rival's fire moves them, by their taste for music. */
export function musicAnswer(relation, rival, players, tierBonus = 1) {
  if (players <= 0) return clampRelation(relation - SOCIAL_MISS);
  return clampRelation(relation + SOCIAL_GAIN * rival.music * tierBonus * Math.min(4, players) ** 0.8);
}
/** How far a gift of food moves them. A gift to a tribe you are fighting stops the fighting. */
export function giftAnswer(relation, rival, meat = false) {
  return clampRelation(relation + GIFT.relation * rival.gift * (meat && rival.hunt ? 1.2 : 1));
}
/** Making peace with a tribe that is furious with you, or at war: food, then a clean slate. */
export const peaceCost = (rival) => (rival.name === "Warriors" ? 35 : 20);
export const PEACE_RELATION = -15;
export const canMakePeace = (tr) => tr.status === "neutral" && (tr.relation <= -50 || tr.war > 0);

/**
 * What you can trade with a tribe: traders always, allies once allied. Food for a tool you haven't
 * built (they build the shack for you), at a price that falls as they like you more.
 */
export function tradeOffers(tr, rival, owned) {
  if (!(rival.trade || tr.status === "allied") || tr.status === "conquered") return [];
  if (tr.status === "neutral" && tr.relation < -10) return [];
  const discount = tr.status === "allied" ? 0.5 : 0.85 - Math.max(0, tr.relation) / 400;
  return TOOL_IDS.filter((id) => !owned[id]).map((id) => ({ tool: id, price: Math.max(8, Math.round(TOOLS[id].cost * discount)) }));
}

/** Recruiting a member of an allied tribe into yours. */
export const RECRUIT_COST = 15;
export const canRecruit = (tr, theirAlive) => tr.status === "allied" && theirAlive > 2;

/** Raiding a rival's food store: what each raider can carry home. */
export const RAID_TAKE = 6;

/* ---- the rivals' own lives (simulated whether you are watching or not) -------------------- */
export const RIVAL_CAP = 8;
const GROW_AT = 24;
/**
 * One step of a rival's life. Pure: returns what happened so the scene can show it.
 * @param {{food:number, relation:number, status:string, war:number, alive:number, raidClock:number, hungry?:boolean}} tr
 * @param {object} rival  from RIVALS
 * @param {number} dt
 * @param {() => number} rand
 * @returns {{ grow?:boolean, raid?:boolean, hungry?:boolean }}
 */
export function stepRival(tr, rival, dt, rand = Math.random) {
  const ev = {};
  if (tr.status === "conquered") return ev;
  // Food: they gather and hunt for themselves, and eat as they go.
  tr.food = Math.max(0, Math.min(80, tr.food + dt * (0.09 * tr.alive - 0.05 * tr.alive)));
  if (tr.food >= GROW_AT && tr.alive < RIVAL_CAP) {
    tr.food -= GROW_AT * 0.75;
    ev.grow = true;
  }
  tr.hungry = tr.food < 6;
  if (tr.status !== "neutral") return ev;
  // Tempers cool: a slighted tribe drifts back toward its usual mood, never warmer than it.
  if (tr.war <= 0 && tr.relation < rival.calm) tr.relation = Math.min(rival.calm, tr.relation + dt * 0.04);
  // Raids on your village.
  const angry = tr.relation < -10 || (rival.raidWhenHungry && tr.hungry && tr.relation < 20);
  if (rival.raid && angry && tr.alive >= 2 && tr.war <= 0 && !tr.peace) {
    tr.raidClock -= dt;
    if (tr.raidClock <= 0) {
      tr.raidClock = rival.raid[0] + rand() * (rival.raid[1] - rival.raid[0]);
      ev.raid = true;
    }
  }
  if (tr.peace) tr.peace = Math.max(0, tr.peace - dt);
  return ev;
}

/**
 * The warriors pick on the other tribes too. Called now and then; returns the victim (an index) or
 * -1. Your allies are fair game, which is when they call on you for help.
 */
export function rivalRaidTarget(tribes, from, rand = Math.random) {
  const options = tribes.map((t, i) => ({ t, i })).filter(({ t, i }) => i !== from && t.status !== "conquered" && t.alive > 0);
  if (!options.length) return -1;
  return options[Math.floor(rand() * options.length)].i;
}

/* ---- the end of the stage ---------------------------------------------------------------- */
/**
 * How your tribe won the island, and the trait it carries into the next stage.
 * @param {{status:string}[]} tribes
 */
export function victoryPath(tribes) {
  const allied = tribes.filter((t) => t.status === "allied").length;
  const conquered = tribes.filter((t) => t.status === "conquered").length;
  if (allied + conquered < tribes.length || !tribes.length) return null;
  if (conquered === 0)
    return { path: "peace", trait: "Diplomatic", icon: "🎶", title: "A tribe of friends", text: "Every neighbour is your ally. Your tribe is known for its music and its open hands." };
  if (allied === 0)
    return { path: "conquest", trait: "Warlike", icon: "⚔", title: "Masters of the island", text: "Every neighbour has fallen. Your tribe is feared from shore to shore." };
  return { path: "balance", trait: "Industrious", icon: "⚖", title: "A tribe to be reckoned with", text: "Some neighbours are friends and some have fallen. Your tribe is respected, and busy." };
}

/* ---- customisation ---------------------------------------------------------------------- */
export const TRIBE_COLORS = [0x3fa9d6, 0xe0703a, 0x3fc26e, 0xd94f8a, 0xe8c547, 0x7d6bd6, 0xf2f2f2, 0x2f3d4f];
export const HUT_STYLES = {
  dome: { name: "Dome", desc: "A low, round roof of woven reeds." },
  cone: { name: "Cone", desc: "A tall, pointed thatch." },
  long: { name: "Longhouse", desc: "A long, gabled lodge." },
};
/** A tribe name the player typed: trimmed, shortened, letters, numbers, spaces and a little punctuation. */
export function cleanName(raw, fallback) {
  const s = String(raw ?? "")
    .replace(/[^\p{L}\p{N} '\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return s || fallback;
}
