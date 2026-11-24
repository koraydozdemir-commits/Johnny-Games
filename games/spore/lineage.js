/**
 * One species, one story: the consequence traits each stage hands to the next, and the chronicle of
 * everything that happened to the species along the way. Pure data and decisions, so it can be tested
 * and later moved into a per-universe save unchanged.
 */
import { CREATURE_CARDS, DIET_CARDS, creatureCard } from "./traits.js";
import { TRIBE_INSTINCT } from "./creature/identity.js";

export const CHRONICLE_KEY = "johnny-spore-chronicle";
export const CHRONICLE_VERSION = 1;
const MAX_EVENTS = 120;

/**
 * What each earlier stage's card gives the Tribal Stage. Effects:
 * damage ×, gift × (how far gifts move a tribe), music × (how far a song moves it), carry + (food per
 * trip), startTool (a shack to start with), relation + (every rival's first mood), hutLevel (starting).
 */
export const TRIBE_LEGACY = {
  cell: {
    carnivore: { name: "Feral", icon: "🥩", text: "Your tribe's fighters hit 15% harder.", effect: { damage: 1.15 } },
    herbivore: { name: "Gentle", icon: "🌿", text: "Gifts move other tribes 25% further.", effect: { gift: 1.25 } },
    omnivore: { name: "Forager", icon: "✧", text: "Gatherers and fishers carry one more food each trip.", effect: { carry: 1 } },
  },
  creature: {
    predator: { name: "Aggressive", icon: "🦖", text: "You start with a shack of axes.", effect: { startTool: "axe" } },
    charmer: { name: "Social", icon: "🎶", text: "Every rival starts 15 friendlier, and songs move them 10% further.", effect: { relation: 15, music: 1.1 } },
    adaptable: { name: "Adaptable", icon: "🧭", text: "Your chief's hut starts at level 2.", effect: { hutLevel: 2 } },
  },
};
/** The Tribal Stage's own trait, for the stages to come. */
export const TRIBE_TRAITS = {
  peace: { name: "Diplomatic", icon: "🎶", color: "#3fc26e" },
  balance: { name: "Industrious", icon: "⚖", color: "#3f9cf0" },
  conquest: { name: "Warlike", icon: "⚔", color: "#ef4b48" },
};

/**
 * The combined legacy the Tribal Stage starts with.
 * @param {string|null} cellCard      herbivore | omnivore | carnivore
 * @param {string|null} creatureCardId predator | charmer | adaptable
 * @param {string|null} [instinct]   the Creature Stage instinct card (creature/identity.js)
 */
export function tribeLegacy(cellCard, creatureCardId, instinct = null) {
  const out = { damage: 1, gift: 1, music: 1, carry: 0, startTool: null, relation: 0, hutLevel: 1, lines: [] };
  const add = (stage, src) => {
    if (!src) return;
    const e = src.effect;
    if (e.damage) out.damage *= e.damage;
    if (e.gift) out.gift *= e.gift;
    if (e.music) out.music *= e.music;
    if (e.carry) out.carry += e.carry;
    if (e.startTool) out.startTool = e.startTool;
    if (e.relation) out.relation += e.relation;
    if (e.hutLevel) out.hutLevel = Math.max(out.hutLevel, e.hutLevel);
    out.lines.push({ stage, name: src.name, icon: src.icon, text: src.text });
  };
  add("cell", TRIBE_LEGACY.cell[cellCard]);
  add("creature", TRIBE_LEGACY.creature[creatureCardId]);
  add("creature", TRIBE_INSTINCT[instinct]);
  return out;
}

/** The creature card for the tribe: the one earned, or the one the record so far points to. */
export const creatureCardFor = (save) => (save ? (CREATURE_CARDS[save.card] ? save.card : creatureCard(save.alliances || 0, save.extinctions || 0)) : null);

/* ---- the chronicle --------------------------------------------------------------------------- */
const STAGES = ["cell", "creature", "tribe", "civ"];
export const emptyChronicle = () => ({ v: CHRONICLE_VERSION, events: [] });

/** Read a stored chronicle, dropping anything malformed. */
export function readChronicle(raw) {
  let d;
  try {
    d = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return emptyChronicle();
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.events)) return emptyChronicle();
  const events = d.events
    .filter((e) => e && typeof e.key === "string" && typeof e.text === "string" && STAGES.includes(e.stage))
    .slice(-MAX_EVENTS)
    .map((e) => ({ key: e.key.slice(0, 60), stage: e.stage, icon: String(e.icon || "•").slice(0, 4), text: e.text.slice(0, 240), at: Number.isFinite(e.at) ? e.at : 0, ...(e.major ? { major: true } : {}) }));
  return { v: CHRONICLE_VERSION, events };
}

/**
 * Add an event once: the key makes repeats (a reload, a second visit) harmless.
 * @returns {boolean} whether it was new
 */
export function addEvent(ch, ev, at = Date.now()) {
  if (!ev?.key || ch.events.some((e) => e.key === ev.key)) return false;
  if (!STAGES.includes(ev.stage) || typeof ev.text !== "string") return false;
  ch.events.push({ key: ev.key, stage: ev.stage, icon: ev.icon || "•", text: ev.text.slice(0, 240), at, ...(ev.major ? { major: true } : {}) });
  if (ch.events.length > MAX_EVENTS) {
    // Keep the founding moments and the turning points, then the most recent story, in order.
    const keep = new Set([...ch.events.filter((e) => e.key.endsWith(":start") || e.key === "home:begin").slice(0, 4), ...ch.events.filter((e) => e.major || e.key.startsWith("heritage:")).slice(-16)]);
    const rest = ch.events.filter((e) => !keep.has(e)).slice(-(MAX_EVENTS - keep.size));
    const kept = new Set([...keep, ...rest]);
    ch.events = ch.events.filter((e) => kept.has(e));
  }
  return true;
}

/**
 * The events that saves made before the chronicle existed already prove. Used once to fill an empty
 * chronicle, so older games get their story too.
 * @param {{ cell?:{dietCard?:string, cellStageComplete?:boolean}, creature?:object|null, tribe?:object|null, regionName?:(id:string)=>string }} s
 */
export function eventsFromSaves(s) {
  const out = [];
  const name = s.regionName || ((id) => id);
  if (s.cell?.cellStageComplete && DIET_CARDS[s.cell.dietCard]) {
    const c = DIET_CARDS[s.cell.dietCard];
    out.push({ key: "cell:complete", stage: "cell", icon: c.icon, text: "Left the water as " + (/^[aeiou]/i.test(c.title) ? "an " : "a ") + c.title.toLowerCase() + ", earning " + c.ability + "." });
  }
  const cr = s.creature;
  if (cr) {
    out.push({ key: "creature:start", stage: "creature", icon: "🦎", text: "Crawled ashore and built a nest." });
    for (const r of cr.unlockedRegions || []) if (r !== "coast") out.push({ key: "region:" + r, stage: "creature", icon: "🧭", text: "Migrated to the " + name(r) + "." });
    if (cr.brain > 1) out.push({ key: "brain:" + cr.brain, stage: "creature", icon: "🧠", text: "Reached brain level " + cr.brain + "." });
    if (CREATURE_CARDS[cr.card]) out.push({ key: "creature:card", stage: "creature", icon: CREATURE_CARDS[cr.card].icon, text: "Earned the " + CREATURE_CARDS[cr.card].title + " trait." });
  }
  const tr = s.tribe;
  if (tr) {
    out.push({ key: "tribe:start", stage: "tribe", icon: "🛖", text: "Founded a tribe." });
    if (tr.path && TRIBE_TRAITS[tr.path]) out.push({ key: "tribe:won", stage: "tribe", icon: TRIBE_TRAITS[tr.path].icon, text: "Settled the island and earned the " + TRIBE_TRAITS[tr.path].name + " trait." });
  }
  return out;
}

/**
 * Where the species stands in each stage, for the history screen's track.
 * @returns {{ cell:object, creature:object|null, tribe:object|null }}
 */
export function trackSummary({ cellCard = null, cellDone = false, creature = null, tribe = null }) {
  return {
    cell: { card: cellDone ? cellCard : null, leaning: cellCard },
    creature: creature ? { brain: creature.brain || 1, card: CREATURE_CARDS[creature.card] ? creature.card : null, alliances: creature.alliances || 0, extinctions: creature.extinctions || 0 } : null,
    tribe: tribe
      ? {
          allied: tribe.tribes.filter((t) => t.status === "allied").length,
          conquered: tribe.tribes.filter((t) => t.status === "conquered").length,
          total: tribe.tribes.length,
          trait: tribe.path ? TRIBE_TRAITS[tribe.path] : null,
          members: tribe.units?.length || 0,
          hutLevel: tribe.hutLevel || 1,
        }
      : null,
  };
}
