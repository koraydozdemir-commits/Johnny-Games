/**
 * Tribe Stage rules: the numbers and pure decisions, kept apart from the scene so they can be
 * unit tested. (Prototype: one village, three neighbouring tribes, food, babies and two tools.)
 */

export const TRIBE_SAVE_KEY = "johnny-spore-tribe-stage";

export const START_FOOD = 15;
export const BABY_COST = 10;
export const BASE_POP = 6;
export const POP_PER_TRIBE = 3;
export const CARRY = { fruit: 3, fish: 4 };

/** Tools are kept in shacks beside the hut; a member holds one at a time. */
export const TOOLS = {
  axe: { name: "Axes", icon: "🪓", cost: 20, desc: "Twice the damage in a fight." },
  horn: { name: "Horns", icon: "📯", cost: 20, desc: "Play for other tribes to win them over." },
};

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
 * @returns {null | { food:number, tools:{axe:boolean, horn:boolean}, units:{tool:string|null, chief:boolean}[], tribes:{relation:number, status:string, alive:number, hut:number}[] }}
 */
export function readTribeSave(raw) {
  let d = null;
  try {
    d = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.units)) return null;
  const tool = (t) => (t === "axe" || t === "horn" ? t : null);
  const units = d.units.slice(0, 24).map((u) => ({ tool: tool(u?.tool), chief: !!u?.chief }));
  if (!units.some((u) => u.chief)) units.unshift({ tool: null, chief: true });
  return {
    food: Math.max(0, Math.min(9999, Math.round(Number(d.food) || 0))),
    tools: { axe: !!d.tools?.axe, horn: !!d.tools?.horn },
    units,
    tribes: (Array.isArray(d.tribes) ? d.tribes : []).slice(0, 5).map((t) => ({
      relation: clampRelation(Number(t?.relation) || 0),
      status: t?.status === "allied" || t?.status === "conquered" ? t.status : "neutral",
      alive: Math.max(0, Math.min(8, Math.round(Number(t?.alive ?? 5)))),
      hut: Math.max(0, Math.min(1, Number(t?.hut ?? 1))),
    })),
  };
}
