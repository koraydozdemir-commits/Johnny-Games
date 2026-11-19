/**
 * Creature mouths: the one table that decides what a mouth means.
 *
 * The editor reads it to show stats, the stage reads it to resolve bites, meals and social rounds,
 * and the progression reads it to decide which mouths you have earned. Pure data and small helpers
 * (no THREE, no DOM) so it can be unit-tested.
 *
 * Every number is a multiplier on the creature's own baseline (1.0), so a mouth never replaces the
 * creature's levels (bite/sing/charm from `parts.js`), it shapes them:
 *   bite    damage of each bite            rate    bites per second (cooldown = base / rate)
 *   social  how much a social move moves   eat     how much each food kind feeds you (0 = cannot eat it)
 *   reach   extra bite reach, in metres    special one named trick, resolved in stage.js
 *
 * Diet is derived from `eat`, never stored separately: a mouth that feeds on plants and not meat is
 * a herbivore mouth, and so on. A test keeps `diet` in parts.js in step with this.
 */

export const MOUTH_DIETS = ["plant", "meat", "omni"];
export const DIET_NAME = { plant: "Herbivore", meat: "Carnivore", omni: "Omnivore" };

/** What each special does, for the readout. Resolved in creature/stage.js. */
export const SPECIALS = {
  stagger: { name: "Clamp", text: "A bite staggers its target for a moment." },
  gulp: { name: "Devour", text: "Feeding restores extra health." },
  forage: { name: "Forager", text: "Every meal yields a little extra DNA." },
  lure: { name: "Lure", text: "Social rounds start warmer." },
  snatch: { name: "Snatch", text: "Picks up and eats food from further away." },
};

/**
 * @typedef {{ tier:number, bite:number, rate:number, social:number, eat:{plant:number, meat:number},
 *   reach:number, special:string|null, unlock:{brain:number, alliances?:number, kills?:number, foods?:number} }} MouthStats
 * tier 0 is a starter; 1 a basic variation; 2 a specialist; 3 an advanced mouth.
 */
/** @type {Record<string, MouthStats>} */
export const MOUTH_STATS = {
  // Herbivores: gentle bites, good at the plant side of a meal, strong socially.
  beak: { tier: 0, bite: 0.8, rate: 1.0, social: 1.0, eat: { plant: 1.0, meat: 0 }, reach: 0, special: null, unlock: { brain: 1 } },
  grinder: { tier: 1, bite: 0.7, rate: 0.9, social: 0.9, eat: { plant: 1.35, meat: 0 }, reach: 0, special: "forage", unlock: { brain: 2 } },
  shears: { tier: 2, bite: 1.0, rate: 1.35, social: 0.8, eat: { plant: 1.15, meat: 0 }, reach: 0, special: null, unlock: { brain: 3, foods: 3 } },
  fluteBeak: { tier: 2, bite: 0.7, rate: 1.0, social: 1.35, eat: { plant: 1.0, meat: 0 }, reach: 0, special: "lure", unlock: { brain: 3, alliances: 1 } },
  trunk: { tier: 3, bite: 0.65, rate: 0.9, social: 1.25, eat: { plant: 1.25, meat: 0 }, reach: 0.6, special: "snatch", unlock: { brain: 4, alliances: 2 } },
  // Carnivores: hard-hitting, poor at small talk.
  jaws: { tier: 0, bite: 1.0, rate: 1.0, social: 0.8, eat: { plant: 0, meat: 1.0 }, reach: 0, special: null, unlock: { brain: 1 } },
  fangs: { tier: 1, bite: 0.85, rate: 1.3, social: 0.9, eat: { plant: 0, meat: 1.0 }, reach: 0, special: null, unlock: { brain: 2 } },
  snapper: { tier: 2, bite: 1.35, rate: 0.65, social: 0.7, eat: { plant: 0, meat: 1.1 }, reach: 0, special: "stagger", unlock: { brain: 3, kills: 3 } },
  tuskMaw: { tier: 2, bite: 1.25, rate: 0.85, social: 0.9, eat: { plant: 0, meat: 1.0 }, reach: 0.3, special: null, unlock: { brain: 3, kills: 5 } },
  mandibles: { tier: 3, bite: 1.0, rate: 1.05, social: 0.6, eat: { plant: 0, meat: 1.3 }, reach: 0, special: "gulp", unlock: { brain: 4, kills: 8 } },
  // Omnivores: flexible, and never the best at anything.
  snout: { tier: 0, bite: 0.85, rate: 1.0, social: 1.0, eat: { plant: 0.8, meat: 0.8 }, reach: 0, special: null, unlock: { brain: 1 } },
  bill: { tier: 1, bite: 0.7, rate: 1.0, social: 1.1, eat: { plant: 0.9, meat: 0.75 }, reach: 0, special: null, unlock: { brain: 2 } },
  crusher: { tier: 2, bite: 1.0, rate: 0.8, social: 0.9, eat: { plant: 0.85, meat: 0.95 }, reach: 0, special: null, unlock: { brain: 3, foods: 2 } },
  tongue: { tier: 2, bite: 0.6, rate: 1.2, social: 1.15, eat: { plant: 0.8, meat: 0.8 }, reach: 0.9, special: "snatch", unlock: { brain: 3, alliances: 1 } },
  sawBeak: { tier: 3, bite: 1.1, rate: 1.0, social: 0.85, eat: { plant: 1.0, meat: 1.05 }, reach: 0, special: "stagger", unlock: { brain: 4, foods: 3, alliances: 1 } },
};

export const MOUTH_IDS = Object.keys(MOUTH_STATS);
/** The three mouths every creature starts with, one per diet. */
export const STARTER_MOUTHS = MOUTH_IDS.filter((id) => MOUTH_STATS[id].tier === 0);
export const TIER_NAME = ["Starter", "Basic", "Specialist", "Advanced"];

export const isMouth = (id) => id in MOUTH_STATS;
/** Stats for a mouth id, or null for anything that is not a mouth. */
export const mouthStats = (id) => MOUTH_STATS[id] || null;

/** Diet a mouth allows: what it can feed on. */
export function dietOfStats(s) {
  if (!s) return "omni";
  const plant = s.eat.plant > 0,
    meat = s.eat.meat > 0;
  return plant && meat ? "omni" : meat ? "meat" : "plant";
}
export const mouthDiet = (id) => dietOfStats(mouthStats(id));
export const mouthsOfDiet = (diet) => MOUTH_IDS.filter((id) => mouthDiet(id) === diet);

/** What a mouth gives for a kind of food ("plant" | "meat"): the feeding multiplier, 0 if it cannot eat it. */
export const feedsOn = (id, kind) => mouthStats(id)?.eat[kind === "meat" ? "meat" : "plant"] ?? 0;

/** Seconds between bites with this mouth, given the base cooldown. */
export const biteCooldown = (id, base) => base / (mouthStats(id)?.rate || 1);

/* ---- progression ------------------------------------------------------------------------- */

const REQUIREMENT_LABEL = {
  brain: (n) => "Reach brain level " + n,
  alliances: (n) => "Ally with " + n + " species",
  kills: (n) => "Defeat " + n + " creatures",
  foods: (n) => "Taste " + n + " kinds of food",
};

/**
 * What you have achieved, in the terms mouths ask for.
 * @param {{brain?:number, alliances?:number, treated?:Record<string,{kills?:number}>, foods?:Iterable<string>|Set<string>|string[]}} save
 */
export function progressOf(save = {}) {
  const kills = Object.values(save.treated || {}).reduce((n, t) => n + (t?.kills || 0), 0);
  const foods = save.foods ? (save.foods.size ?? [...save.foods].length) : 0;
  return { brain: save.brain || 1, alliances: save.alliances || 0, kills, foods };
}

/** One requirement per line, with how far along you are: [{ key, text, have, need, done }]. */
export function requirementsOf(id, progress) {
  const need = mouthStats(id)?.unlock || {};
  return Object.entries(need)
    .filter(([k, n]) => n > 1 || k !== "brain")
    .map(([key, n]) => {
      const have = Math.min(n, progress?.[key] || 0);
      return { key, text: REQUIREMENT_LABEL[key](n), have, need: n, done: have >= n };
    });
}
export const mouthEarned = (id, progress) => requirementsOf(id, progress).every((r) => r.done);
/** Every mouth the given progress has earned (starters always). */
export const earnedMouths = (progress) => MOUTH_IDS.filter((id) => mouthEarned(id, progress));
/** The mouths that were not earned before `before` but are by `after`: what just unlocked. */
export const newlyEarned = (before, after) => MOUTH_IDS.filter((id) => !mouthEarned(id, before) && mouthEarned(id, after));
/** A line for a locked mouth's card: its requirements in one sentence. */
export const requirementText = (id, progress) =>
  requirementsOf(id, progress)
    .map((r) => (r.need > 1 && r.key !== "brain" ? `${r.text} (${r.have}/${r.need})` : r.text))
    .join(" · ") || "Available from the start";

/* ---- readouts ------------------------------------------------------------------------------- */

/** The rows the editor shows for a mouth, as [key, label, value, unit-less number for comparison]. */
export const MOUTH_ROWS = [
  ["bite", "Bite damage", (s) => s.bite],
  ["rate", "Bite speed", (s) => s.rate],
  ["social", "Social", (s) => s.social],
  ["plant", "Plant eating", (s) => s.eat.plant],
  ["meat", "Meat eating", (s) => s.eat.meat],
  ["reach", "Reach", (s) => s.reach],
];
/** Rows with the value for a mouth. */
export function mouthRows(id) {
  const s = mouthStats(id);
  return s ? MOUTH_ROWS.map(([key, label, get]) => ({ key, label, value: get(s) })) : [];
}
/** Per-row change from the mouth `from` to the mouth `to`. Positive = better. */
export function compareMouths(from, to) {
  const a = mouthRows(from),
    b = mouthRows(to);
  return b.map((row, i) => ({ ...row, from: a[i]?.value ?? 0, delta: row.value - (a[i]?.value ?? 0) }));
}
/** Formats a multiplier as a percentage of baseline: 1.35 → "135%". */
export const pct = (v) => Math.round(v * 100) + "%";
/** Reach reads in metres. */
export const rowText = (key, v) => (key === "reach" ? (v ? "+" + v.toFixed(1) + " m" : "None") : v === 0 && (key === "plant" || key === "meat") ? "Can't eat" : pct(v));
