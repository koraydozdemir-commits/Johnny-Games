/**
 * Heritage: the whole species, from the first cell to the united world, as one identity that every
 * later stage can read. Pure data and decisions (no DOM, no storage), so it is fully testable.
 *
 * What it adds to what the stages already hand on (lineage.js):
 * - all eight Creature Stage instincts carry into the Civilization Stage (before, Civilization only
 *   saw the old three-colour creature card);
 * - rival leaders know your history and say so when you meet;
 * - one combined identity (diet, instinct, tribe, unification) for the species history and the galaxy.
 */
import { DIET_CARDS } from "./traits.js";
import { INSTINCTS } from "./creature/identity.js";

/**
 * What each instinct gives a civilization: one real upside and one real downside each, so no instinct
 * is simply better than another. Effects use the Civilization Stage's existing modifiers:
 * damage, health (vehicles), social (trade and preaching speed), incomeBonus, happyBonus (cities),
 * turret (city defences), relation (every rival's starting mood), spice (derrick output).
 */
export const CIV_INSTINCT = {
  apex: {
    name: "Apex Predator",
    icon: "🦖",
    text: "A legacy of dominance: military vehicles hit 12% harder, but every nation starts 8 warier.",
    effect: { damage: 0.12, relation: -8 },
    remark: { aggressive: "Your kind were hunters long before you built cities. We respect that.", other: "We have heard what your ancestors did to the creatures of this world." },
  },
  packHunter: {
    name: "Pack Hunter",
    icon: "🐺",
    text: "Coordinated war bands: military vehicles hit 6% harder and have 6% more health, but trade and preaching are 5% slower.",
    effect: { damage: 0.06, health: 0.06, social: -0.05 },
    remark: { aggressive: "Your kind hunt together. So do we.", other: "Your people move together, like a pack. It makes us careful." },
  },
  territorial: {
    name: "Territorial",
    icon: "🛡",
    text: "Holds what it has: city turrets are 25% stronger, but trade and preaching are 5% slower.",
    effect: { turret: 0.25, social: -0.05 },
    remark: { aggressive: "We know you guard your borders jealously. So be it.", other: "Your kind has always defended its ground. We will respect your borders." },
  },
  symbiotic: {
    name: "Symbiotic",
    icon: "🤝",
    text: "Lives alongside others: every nation starts 12 friendlier and trade runs 5% faster, but military vehicles hit 6% softer.",
    effect: { relation: 12, social: 0.05, damage: -0.06 },
    remark: { aggressive: "Your kind always needed friends. How touching.", other: "Your people have always lived alongside others. We hope to as well." },
  },
  nurturing: {
    name: "Nurturing",
    icon: "🥚",
    text: "Cares for its own: every city is happier, but income is 3% lower (welfare costs).",
    effect: { happyBonus: 1, incomeBonus: -0.03 },
    remark: { aggressive: "A soft people, raised on care. We shall see.", other: "We hear your cities look after their own. A good sign." },
  },
  elusive: {
    name: "Elusive",
    icon: "🍃",
    text: "Cautious and hard to catch: vehicles have 12% more health, but military vehicles hit 6% softer.",
    effect: { health: 0.12, damage: -0.06 },
    remark: { aggressive: "Your kind always hid from a fight. Will you hide from us?", other: "Your people are hard to read. We will be patient." },
  },
  adaptable: {
    name: "Adaptable",
    icon: "🧭",
    text: "Flexible: 6% more income, and trade and preaching 3% faster, but turrets are 10% weaker.",
    effect: { incomeBonus: 0.06, social: 0.03, turret: -0.1 },
    remark: { aggressive: "A people of no fixed nature. Unpredictable.", other: "Your kind has thrived everywhere. We could learn from you." },
  },
  scavenger: {
    name: "Scavenger",
    icon: "🦴",
    text: "Resourceful: derricks pump 15% more spice, but every nation starts 5 warier.",
    effect: { spice: 0.15, relation: -5 },
    remark: { aggressive: "Your ancestors fed on what others left behind. Keep your hands off ours.", other: "Your people waste nothing. Our merchants have noticed." },
  },
};

/** What leaders say about your tribe's past, if anything. */
const TRIBE_REMARK = {
  peace: "Your tribe made friends of every neighbour, they say.",
  conquest: "Your tribe conquered every neighbour, they say.",
  balance: null,
};

/**
 * A rival leader's remark on your history, appended to their greeting.
 * @param {{instinct?:string|null, tribePath?:string|null}} h
 * @param {string} personality
 */
export function heritageRemark(h, personality) {
  const inst = CIV_INSTINCT[h?.instinct];
  const parts = [];
  if (inst) parts.push(personality === "aggressive" ? inst.remark.aggressive : inst.remark.other);
  const t = TRIBE_REMARK[h?.tribePath];
  if (t && parts.length === 0) parts.push(t);
  return parts.join(" ");
}

/** An instinct id from a creature save: the earned card, else the forming leaning. */
export const instinctOf = (creatureSave) => {
  const id = creatureSave?.instinct || creatureSave?.leaning || null;
  return INSTINCTS[id] ? id : null;
};

const TRIBE_PATH = {
  peace: { name: "Diplomatic", icon: "🎶", text: "united the island through friendship" },
  balance: { name: "Industrious", icon: "⚖", text: "won the island with both friendship and force" },
  conquest: { name: "Warlike", icon: "⚔", text: "conquered the island" },
};
const CIV_METHOD = {
  military: { name: "Military", icon: "⚔", text: "united the world by force" },
  economic: { name: "Economic", icon: "💰", text: "bought its way to a united world" },
  religious: { name: "Religious", icon: "🕊", text: "united the world in one faith" },
};

/**
 * The species as one identity: what each stage made of it, as far as it has got.
 * Every input is optional and tolerant of old or partial saves.
 * @param {{ cell?:{dietCard?:string|null, plants?:number, meat?:number}, creature?:object|null,
 *   tribe?:object|null, civ?:object|null, name?:string }} s
 * @returns {{ name:string, stage:string, diet:object|null, instinct:object|null, tribe:object|null,
 *   civ:object|null, tags:string[], summary:string }}
 */
export function speciesIdentity(s = {}) {
  const out = { name: s.name || "Your species", stage: "cell", diet: null, instinct: null, tribe: null, civ: null, tags: [], summary: "" };
  const d = DIET_CARDS[s.cell?.dietCard];
  if (d) out.diet = { id: s.cell.dietCard, name: d.title, icon: d.icon };
  const cr = s.creature;
  if (cr) {
    out.stage = "creature";
    const id = instinctOf(cr);
    if (id) out.instinct = { id, name: INSTINCTS[id].title, icon: INSTINCTS[id].icon, earned: id === cr.instinct, civ: CIV_INSTINCT[id].text };
    const a = cr.alliances || 0,
      x = cr.extinctions || 0;
    if (a || x) out.creatureRecord = { alliances: a, extinctions: x };
  }
  const tr = s.tribe;
  if (tr && Array.isArray(tr.tribes)) {
    out.stage = "tribe";
    const allied = tr.tribes.filter((t) => t?.status === "allied").length;
    const conquered = tr.tribes.filter((t) => t?.status === "conquered").length;
    const p = TRIBE_PATH[tr.path];
    out.tribe = { path: tr.path || null, name: p?.name || null, icon: p?.icon || "⛺", allied, conquered, total: tr.tribes.length, won: !!tr.path };
  }
  const cv = s.civ;
  if (cv && Array.isArray(cv.cities) && cv.cities.length) {
    out.stage = "civ";
    const caps = cv.captures || {};
    const method = cv.won ? cv.card || null : null;
    out.civ = {
      won: !!cv.won,
      method,
      methodName: CIV_METHOD[method]?.name || null,
      icon: CIV_METHOD[method]?.icon || "🏛",
      captures: { military: caps.military || 0, economic: caps.economic || 0, religious: caps.religious || 0 },
      cities: cv.cities.filter((c) => c?.owner === "you").length,
      total: cv.cities.length,
    };
  }
  // Short identity tags, oldest first: what the species *is*.
  if (out.diet) out.tags.push(out.diet.name);
  if (out.instinct) out.tags.push(out.instinct.name);
  if (out.tribe?.name) out.tags.push(out.tribe.name);
  if (out.civ?.methodName) out.tags.push(out.civ.methodName);
  // One sentence that tells the story so far.
  const bits = [];
  if (out.diet) bits.push("began as " + (/^[aeiou]/i.test(out.diet.name) ? "an " : "a ") + out.diet.name.toLowerCase() + " cell");
  if (out.instinct) bits.push("grew into " + (/^[aeiou]/i.test(out.instinct.name) ? "an " : "a ") + out.instinct.name.toLowerCase() + (out.instinct.earned ? "" : " (still forming)"));
  if (out.tribe?.won && TRIBE_PATH[out.tribe.path]) bits.push(TRIBE_PATH[out.tribe.path].text);
  if (out.civ?.won && CIV_METHOD[out.civ.method]) bits.push("and " + CIV_METHOD[out.civ.method].text);
  out.summary = bits.length ? out.name + " " + bits.join(", ").replace(/, and /, " and ") + "." : "";
  return out;
}

/**
 * The turning points a species' saves prove, for the chronicle: the decisions that shaped it, with
 * what was chosen and what it led to. Keys are stable, so recording them again is harmless.
 */
export function heritageEvents(s = {}) {
  const out = [];
  const cr = s.creature;
  const id = cr?.instinct && INSTINCTS[cr.instinct] ? cr.instinct : null;
  if (id) {
    const c = CIV_INSTINCT[id];
    out.push({ key: "heritage:instinct", stage: "creature", icon: c.icon, major: true, text: "Became " + (/^[aeiou]/i.test(c.name) ? "an " : "a ") + c.name + " species. Later: " + c.text.split(":")[0].toLowerCase() + "." });
  }
  const tr = s.tribe;
  if (tr?.path && TRIBE_PATH[tr.path]) {
    const allied = (tr.tribes || []).filter((t) => t?.status === "allied").length;
    const conquered = (tr.tribes || []).filter((t) => t?.status === "conquered").length;
    out.push({ key: "heritage:tribe", stage: "tribe", icon: TRIBE_PATH[tr.path].icon, major: true, text: `The tribe ${TRIBE_PATH[tr.path].text} (${allied} allied, ${conquered} conquered): a ${TRIBE_PATH[tr.path].name.toLowerCase()} people.` });
  }
  const cv = s.civ;
  if (cv?.won && CIV_METHOD[cv.card]) {
    const caps = cv.captures || {};
    out.push({ key: "heritage:unified", stage: "civ", icon: CIV_METHOD[cv.card].icon, major: true, text: `The nation ${CIV_METHOD[cv.card].text}: ${caps.military || 0} cities taken by force, ${caps.economic || 0} bought, ${caps.religious || 0} converted.` });
  }
  return out;
}
