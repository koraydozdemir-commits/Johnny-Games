/**
 * Tribe Stage rules: the numbers and pure decisions, kept apart from the scene so they can be
 * unit tested. (Prototype: one village, three neighbouring tribes, food, hunting, babies and tools.)
 */

export const TRIBE_SAVE_KEY = "johnny-spore-tribe-stage";

export const START_FOOD = 15;
export const BABY_COST = 10;
export const BASE_POP = 6;
export const POP_PER_TRIBE = 3;
export const CARRY = { fruit: 3, fish: 4 };

/**
 * Tools are kept in shacks around the hut; a member holds one at a time (in its hand, if it has arms).
 * As in Spore there are three kinds: weapons, instruments, and tools for the village.
 */
export const TOOLS = {
  axe: { kind: "fight", name: "Axes", icon: "🪓", cost: 20, desc: "Heavy blows: twice the damage up close." },
  spear: { kind: "fight", name: "Spears", icon: "🔱", cost: 25, desc: "Thrown from a distance, so your hunters stay out of reach." },
  torch: { kind: "fight", name: "Torches", icon: "🔥", cost: 30, desc: "Sets huts alight: villages fall three times faster." },
  horn: { kind: "music", name: "Horns", icon: "📯", cost: 20, desc: "An instrument. Other tribes ask for it when you play for them." },
  maracas: { kind: "music", name: "Maracas", icon: "🪇", cost: 25, desc: "An instrument. Other tribes ask for it when you play for them." },
  didgeridoo: { kind: "music", name: "Didgeridoos", icon: "🎺", cost: 30, desc: "An instrument. Other tribes ask for it when you play for them." },
  staff: { kind: "village", name: "Gathering Staffs", icon: "🦯", cost: 20, desc: "Gather and fish twice as fast, and carry more home." },
  healer: { kind: "village", name: "Healing Staffs", icon: "✚", cost: 30, desc: "Heals members fighting nearby." },
};
export const TOOL_IDS = Object.keys(TOOLS);
export const INSTRUMENTS = TOOL_IDS.filter((id) => TOOLS[id].kind === "music");
/** Damage per blow: bare jaws and claws, or a weapon. Spears are thrown. */
export const DAMAGE = { none: 6, axe: 12, spear: 8, torch: 7 };
/** How much of a hut each blow knocks down. */
export const HUT_DAMAGE = { none: 0.025, axe: 0.05, spear: 0.03, torch: 0.12 };
export const GIFT = { food: 10, relation: 18 };
/** A social round: the tribe calls for an instrument, and you have this long to play it. */
export const ASK_TIME = 4.5;
/** How a tribe's mood moves when you answer (per performer holding the instrument) or miss. */
export const SOCIAL_GAIN = 9;
export const SOCIAL_MISS = 7;

/** How many members the tribe can hold: it grows with every tribe befriended or conquered. */
export const popCap = (settled) => BASE_POP + POP_PER_TRIBE * Math.max(0, settled);

export const clampRelation = (r) => Math.max(-100, Math.min(100, r));

/**
 * The face a tribe shows you (the same five as the creature stage).
 * @param {number} relation -100..100
 * @param {"neutral"|"allied"|"conquered"} status
 */
export function relationFace(relation, status = "neutral") {
  if (status === "allied") return "allied";
  if (relation <= -50) return "furious";
  if (relation < -10) return "annoyed";
  if (relation < 25) return "neutral";
  return "friendly";
}

/** Herbivores pick fruit, carnivores fish, omnivores do both. */
export const canGather = (diet, source) => (source === "fruit" ? diet !== "meat" : diet !== "plant");

/** A tribe raids you while it dislikes you and still has hunters to send. */
export const willRaid = (tribe) => tribe.status === "neutral" && tribe.relation < -10 && tribe.alive >= 2;

/** Every neighbouring tribe is either an ally or gone. */
export const stageWon = (tribes) => tribes.length > 0 && tribes.every((t) => t.status !== "neutral");

/**
 * Read a saved tribe game, tolerating anything missing or malformed.
 * @returns {null | { food:number, tools:Object<string, boolean>, units:{tool:string|null, chief:boolean}[], tribes:{relation:number, status:string, alive:number, hut:number}[], won:boolean }}
 */
export function readTribeSave(raw) {
  let d = null;
  try {
    d = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.units)) return null;
  const tool = (t) => (TOOLS[t] ? t : null);
  const units = d.units.slice(0, 24).map((u) => ({ tool: tool(u?.tool), chief: !!u?.chief }));
  if (!units.some((u) => u.chief)) units.unshift({ tool: null, chief: true });
  return {
    food: Math.max(0, Math.min(9999, Math.round(Number(d.food) || 0))),
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, !!d.tools?.[id]])),
    units,
    won: !!d.won,
    tribes: (Array.isArray(d.tribes) ? d.tribes : []).slice(0, 5).map((t) => ({
      relation: clampRelation(Number(t?.relation) || 0),
      status: t?.status === "allied" || t?.status === "conquered" ? t.status : "neutral",
      alive: Math.max(0, Math.min(8, Math.round(Number(t?.alive ?? 5)))),
      hut: Math.max(0, Math.min(1, Number(t?.hut ?? 1))),
    })),
  };
}

/**
 * The next instrument a tribe calls for. Never the same one twice in a row when there is a choice,
 * and the ones you can actually play come up more often, so a tribe is winnable with what you have.
 * @param {string|null} last
 * @param {string[]} owned  instruments your performers are holding
 * @param {() => number} rand
 */
export function nextAsk(last, owned, rand = Math.random) {
  const pool = INSTRUMENTS.filter((id) => id !== last);
  const weighted = pool.flatMap((id) => (owned.includes(id) ? [id, id, id] : [id]));
  return weighted[Math.floor(rand() * weighted.length)] || INSTRUMENTS[0];
}
/** How a call is answered: each performer with the instrument adds to it; nobody, a miss. */
export function answerCall(relation, players) {
  return players > 0 ? clampRelation(relation + SOCIAL_GAIN * Math.min(4, players) ** 0.8) : clampRelation(relation - SOCIAL_MISS);
}
