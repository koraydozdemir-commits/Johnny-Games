/**
 * Species identity: what your species actually does in the Creature Stage, and what it becomes.
 *
 * The stage counts meaningful acts in a ledger (hunts, escapes, gifts, nests defended, carcasses
 * scavenged…). The ledger gives a profile on seven axes; the profile gives
 *  - a live reputation, so the island reacts as you go (prey that keep further off from a hunter,
 *    creatures that wander over to look at a peaceful one),
 *  - an instinct card at the end of the stage (eight of them, each with a real upside and downside),
 *    whose colour is also the classic red / green / blue creature card the later stages read.
 * Earlier cards feed in too: the Cell Stage diet card has passive effects on land.
 *
 * Pure data and functions: no THREE, no DOM. Every number the stage applies comes from traitMods().
 */

/** Every act the ledger counts. Missing ones read as 0, so older saves load cleanly. */
export const LEDGER_KEYS = [
  "hunts", // wild prey and grazers you brought down
  "predatorKills", // hunters, ambushers, guardians, giants, rogues and epics you beat
  "nestKills", // nest members killed
  "extinctions",
  "fightsStarted", // first blow struck at a creature that wasn't after you
  "befriended",
  "alliances",
  "gifts", // food given to other species
  "familyFed", // food given to or stored for your own family
  "escapes", // a hunter lost you
  "ambushes",
  "sneaks",
  "intimidations",
  "defended", // raids driven off, kin and allies saved
  "kinLost",
  "plantMeals",
  "meatMeals",
  "scavenged", // meat from a carcass you didn't make
  "eggs",
  "migrations",
  "discoveries",
  "fled", // ran from a fight while hurt
];

export const emptyLedger = () => Object.fromEntries(LEDGER_KEYS.map((k) => [k, 0]));

/** A stored ledger, with anything unknown or broken dropped. */
export function readLedger(raw) {
  const out = emptyLedger();
  if (!raw || typeof raw !== "object") return out;
  for (const k of LEDGER_KEYS) {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v > 0) out[k] = Math.min(1e6, Math.floor(v));
  }
  return out;
}

/**
 * Saves from before the ledger existed: rebuild what they prove, so the card they earn still
 * reflects how they played.
 * @param {{alliances?:number, extinctions?:number, treated?:object, foods?:string[], discovered?:string[], unlockedRegions?:string[]}} save
 */
export function seedLedger(save = {}) {
  const l = emptyLedger();
  l.alliances = save.alliances || 0;
  l.extinctions = save.extinctions || 0;
  for (const t of Object.values(save.treated || {})) {
    l.befriended += t?.friends || 0;
    l.nestKills += t?.kills || 0;
  }
  const foods = save.foods || [];
  l.plantMeals = foods.filter((f) => /fruit|plant|egg/.test(f)).length * 3;
  l.meatMeals = foods.filter((f) => /meat/.test(f)).length * 3;
  l.discoveries = Math.max(0, (save.discovered || []).length - 1);
  l.migrations = Math.max(0, (save.unlockedRegions || ["coast"]).length - 1);
  return l;
}

/** x/(x+k): rises fast at first, then levels off towards 1. */
const sat = (x, k) => (x <= 0 ? 0 : x / (x + k));

/**
 * The species' leanings, each 0..1.
 * @returns {{predation:number, sociality:number, caution:number, dominance:number, breadth:number, care:number, scavenging:number, roaming:number, acts:number}}
 */
export function profileOf(l) {
  const meals = l.plantMeals + l.meatMeals;
  const mix = meals ? Math.min(l.plantMeals, l.meatMeals) / Math.max(l.plantMeals, l.meatMeals) : 0;
  return {
    predation: sat(l.hunts + l.predatorKills * 2 + l.nestKills + l.extinctions * 3, 14),
    sociality: sat(l.befriended + l.alliances * 3 + l.gifts * 1.5, 10),
    caution: sat(l.escapes * 1.5 + l.ambushes * 0.5 + l.sneaks * 0.25 + l.fled * 0.5, 8),
    dominance: sat(l.intimidations * 1.5 + l.predatorKills * 1.5 + l.fightsStarted * 0.4, 9),
    breadth: sat(l.scavenged * 0.5 + l.eggs * 0.5 + meals * 0.15, 6) * (0.35 + 0.65 * mix),
    care: sat(l.defended * 2 + l.familyFed * 0.6 + l.gifts * 0.3, 8),
    scavenging: sat(l.scavenged, 6),
    roaming: sat(l.migrations * 2 + l.discoveries * 0.3, 10),
    acts: LEDGER_KEYS.reduce((a, k) => a + l[k], 0),
  };
}

export const INSTINCT_COLORS = { red: "#ef4b48", green: "#3fc26e", blue: "#3f9cf0" };
/** Colour → the classic creature card id the Tribal and Civilization stages read. */
export const COLOR_CARD = { red: "predator", green: "charmer", blue: "adaptable" };

/**
 * The instinct cards. Each scores itself from the profile; the highest wins. `fx` are the numbers
 * traitMods() combines (1 = no change for multipliers, 0 for additions). Every card has a cost.
 */
export const INSTINCTS = {
  apex: {
    id: "apex",
    title: "Apex Predator",
    color: "red",
    icon: "🦖",
    blurb: "Hunts whatever it likes. The island has learned to keep its distance.",
    score: (p) => p.predation * 1.1 - p.sociality * 0.6 + p.dominance * 0.3,
    pros: ["Bites hit 15% harder", "Intimidation works far better"],
    cons: ["Prey bolts from much further off", "Every social round starts colder"],
    fx: { damage: 1.15, intimidate: 1.35, fear: 0.35, socialStart: -0.15 },
  },
  packHunter: {
    id: "packHunter",
    title: "Pack Hunter",
    color: "red",
    icon: "🐺",
    blurb: "Hunts together and shares the kill. Strong in a group, ordinary alone.",
    score: (p) => Math.min(p.predation, p.sociality) * 1.5 + p.care * 0.2,
    pros: ["Packmates hit 25% harder", "Your pack rallies to you faster"],
    cons: ["Alone, you hit 10% softer"],
    fx: { packDamage: 1.25, soloDamage: 0.9, fear: 0.15 },
  },
  territorial: {
    id: "territorial",
    title: "Territorial",
    color: "red",
    icon: "🛡",
    blurb: "Holds its ground and stares down anything that comes near the nest.",
    score: (p) => p.dominance * 0.75 + p.care * 0.55 - p.roaming * 0.2,
    pros: ["Near your nest you hit 25% harder", "Intimidation works better"],
    cons: ["Guardians and hunters pick fights with you from further away"],
    fx: { homeDamage: 1.25, intimidate: 1.2, provoke: 1.25 },
  },
  symbiotic: {
    id: "symbiotic",
    title: "Symbiotic",
    color: "green",
    icon: "🤝",
    blurb: "Lives alongside other species. They come when it is in trouble.",
    score: (p) => p.sociality * 1.1 - p.predation * 0.5,
    pros: ["Social rounds start warmer", "Allies rush to help you in a fight"],
    cons: ["Hunters see you as easy prey and notice you from further off", "Bites hit 10% softer"],
    fx: { socialStart: 0.2, assist: 0.85, provoke: 1.15, damage: 0.9 },
  },
  nurturing: {
    id: "nurturing",
    title: "Nurturing",
    color: "green",
    icon: "🥚",
    blurb: "Feeds its young and defends its kin before anything else.",
    score: (p) => p.care * 1.1 + p.sociality * 0.25 - p.predation * 0.3,
    pros: ["Lost family hatch again twice as fast", "Food heals 20% more"],
    cons: ["A thriving nest draws raiders more often"],
    fx: { familyRegrow: 0.5, foodHeal: 1.2, raidRate: 1.35 },
  },
  elusive: {
    id: "elusive",
    title: "Elusive",
    color: "green",
    icon: "🍃",
    blurb: "Survives by never being where the danger is.",
    score: (p) => p.caution * 1.15 - p.dominance * 0.4,
    pros: ["Creatures notice you 25% less far off", "Sprinting tires you a third less"],
    cons: ["Bites hit 10% softer", "Intimidation works worse"],
    fx: { notice: 0.75, sprintDrain: 0.66, damage: 0.9, intimidate: 0.8 },
  },
  adaptable: {
    id: "adaptable",
    title: "Adaptable",
    color: "blue",
    icon: "🧭",
    blurb: "Eats anything, goes anywhere. Never the best at one thing.",
    score: (p) => p.breadth * 1.05 + p.roaming * 0.35 + 0.08, // the fallback when nothing stands out
    pros: ["You get hungry 20% slower", "Food heals 15% more"],
    cons: ["Neither feared nor trusted: social rounds and stare-downs are a little harder"],
    fx: { hunger: 0.8, foodHeal: 1.15, socialStart: -0.05, intimidate: 0.9 },
  },
  scavenger: {
    id: "scavenger",
    title: "Scavenger",
    color: "blue",
    icon: "🦴",
    blurb: "Lets others make the kill, then takes its share.",
    score: (p) => p.scavenging * 1.15 + p.caution * 0.15 - p.dominance * 0.2,
    pros: ["Carcasses heal 60% more", "Hunger drains a little slower"],
    cons: ["Hunters treat you as a rival at every kill", "Social rounds start colder"],
    fx: { carrion: 1.6, hunger: 0.9, provoke: 1.15, socialStart: -0.1 },
  },
};
export const INSTINCT_IDS = Object.keys(INSTINCTS);

/** Below this many meaningful acts, no instinct has formed yet (the HUD shows nothing). */
export const FORMING_AT = 6;

/**
 * The instinct a ledger points to.
 * @param {object} l ledger
 * @param {{color?: "red"|"green"|"blue"}} [opt] restrict to one colour (old saves that already hold a card)
 */
export function instinctFor(l, opt = {}) {
  const p = profileOf(l);
  let best = "adaptable",
    bestScore = -Infinity;
  for (const id of INSTINCT_IDS) {
    if (opt.color && INSTINCTS[id].color !== opt.color) continue;
    const s = INSTINCTS[id].score(p);
    if (s > bestScore + 1e-9) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Where the species is heading while it plays. Sticky: a new leaning has to clearly overtake the
 * current one, so two close instincts don't flicker back and forth. Null until a record has formed.
 */
export function leaningFor(l, current = null) {
  const p = profileOf(l);
  if (p.acts < FORMING_AT) return null;
  const next = instinctFor(l);
  if (!current || !INSTINCTS[current] || next === current) return next;
  return INSTINCTS[next].score(p) > INSTINCTS[current].score(p) + 0.06 ? next : current;
}

/** How each counted act reads on a card, for "Earned by". */
const ACT_TEXT = {
  hunts: (n) => "Hunted " + n + " wild creature" + (n === 1 ? "" : "s"),
  predatorKills: (n) => "Beat " + n + " predator" + (n === 1 ? "" : "s"),
  nestKills: (n) => "Killed " + n + " nest member" + (n === 1 ? "" : "s"),
  extinctions: (n) => "Drove " + n + " species extinct",
  fightsStarted: (n) => "Started " + n + " fight" + (n === 1 ? "" : "s"),
  befriended: (n) => "Befriended " + n + " creature" + (n === 1 ? "" : "s"),
  alliances: (n) => "Allied with " + n + " species",
  gifts: (n) => "Gave " + n + " gift" + (n === 1 ? "" : "s") + " of food",
  familyFed: (n) => "Fed your family " + n + " time" + (n === 1 ? "" : "s"),
  escapes: (n) => "Escaped " + n + " hunter" + (n === 1 ? "" : "s"),
  ambushes: (n) => "Struck from hiding " + n + " time" + (n === 1 ? "" : "s"),
  sneaks: (n) => "Crept unseen " + n + " time" + (n === 1 ? "" : "s"),
  intimidations: (n) => "Stared down " + n + " creature" + (n === 1 ? "" : "s"),
  defended: (n) => "Defended kin and allies " + n + " time" + (n === 1 ? "" : "s"),
  plantMeals: (n) => "Ate " + n + " plant meal" + (n === 1 ? "" : "s"),
  meatMeals: (n) => "Ate " + n + " meat meal" + (n === 1 ? "" : "s"),
  scavenged: (n) => "Scavenged " + n + " carcass" + (n === 1 ? "" : "es"),
  eggs: (n) => "Stole " + n + " egg" + (n === 1 ? "" : "s"),
  migrations: (n) => "Migrated " + n + " time" + (n === 1 ? "" : "s"),
  discoveries: (n) => "Discovered " + n + " species",
  fled: (n) => "Retreated from " + n + " fight" + (n === 1 ? "" : "s"),
};
/** Which acts matter most to each instinct (in order of weight). */
const INSTINCT_ACTS = {
  apex: ["predatorKills", "hunts", "extinctions", "nestKills", "intimidations"],
  packHunter: ["hunts", "befriended", "alliances", "predatorKills", "defended"],
  territorial: ["intimidations", "defended", "predatorKills", "fightsStarted", "familyFed"],
  symbiotic: ["alliances", "befriended", "gifts", "defended"],
  nurturing: ["defended", "familyFed", "gifts", "befriended"],
  elusive: ["escapes", "ambushes", "sneaks", "fled"],
  adaptable: ["plantMeals", "meatMeals", "scavenged", "eggs", "migrations", "discoveries"],
  scavenger: ["scavenged", "escapes", "meatMeals"],
};

/** The acts that earned an instinct, most telling first (up to three). */
export function reasonsFor(id, l) {
  return (INSTINCT_ACTS[id] || [])
    .filter((k) => l[k] > 0)
    .slice(0, 3)
    .map((k) => ACT_TEXT[k](l[k]));
}

/** A full card for the UI: the instinct, why it was earned, and what it does now and later. */
export function instinctCard(id, l) {
  const c = INSTINCTS[id] || INSTINCTS.adaptable;
  return {
    id: c.id,
    title: c.title,
    icon: c.icon,
    color: INSTINCT_COLORS[c.color],
    colorName: c.color,
    blurb: c.blurb,
    pros: c.pros,
    cons: c.cons,
    reasons: l ? reasonsFor(c.id, l) : [],
    legacy: TRIBE_INSTINCT[c.id],
  };
}

/**
 * Live reputation while you play: how feared and how trusted your species is so far.
 * Both 0..1, and both grow only once there is a real record (the first few acts barely count).
 */
export function reputationOf(l) {
  const p = profileOf(l);
  const settle = sat(p.acts, 6); // a handful of acts is not yet a reputation
  return { fear: Math.min(1, (p.predation * 0.8 + p.dominance * 0.4) * settle), trust: Math.min(1, (p.sociality * 1.05 + p.care * 0.2) * settle) };
}

/** Passive effects on land from the Cell Stage card: one upside, one downside each. */
export const CELL_PASSIVES = {
  carnivore: { pro: "Bites hit 10% harder", con: "Plant eaters scatter sooner", fx: { damage: 1.1, fear: 0.15 } },
  herbivore: { pro: "Social rounds start warmer; plants heal 25% more", con: "Bites hit 8% softer", fx: { socialStart: 0.1, plantHeal: 1.25, damage: 0.92 } },
  omnivore: { pro: "You get hungry 15% slower", con: "Each meal heals 10% less", fx: { hunger: 0.85, foodHeal: 0.9 } },
};

const NEUTRAL = {
  damage: 1, // all your attacks
  soloDamage: 1, // your attacks when no pack is with you
  homeDamage: 1, // your attacks near your nest
  packDamage: 1, // your packmates' attacks
  intimidate: 1, // your might in a stare-down
  socialStart: 0, // added to a social round's opening progress
  fear: 0, // added to the live reputation's fear
  notice: 1, // how far others notice you
  provoke: 1, // how far hunters and guardians pick a fight with you
  hunger: 1, // hunger drain
  foodHeal: 1, // healing from every meal
  plantHeal: 1, // healing from plant food
  carrion: 1, // healing from carcasses
  sprintDrain: 1, // stamina used sprinting
  familyRegrow: 1, // time for lost family to hatch again
  raidRate: 1, // how often raiders come (higher = more often)
  assist: 0.3, // chance an ally nearby joins your fight
};
const ADDITIVE = new Set(["socialStart", "fear", "assist"]);

/**
 * Every modifier in force: the Cell card's passives and, once earned, the instinct card's. Assist
 * takes the best value rather than adding (it is a chance).
 * @param {string|null} cellCard herbivore | omnivore | carnivore
 * @param {string|null} instinct an INSTINCTS id, or null before it is earned
 */
export function traitMods(cellCard, instinct) {
  const m = { ...NEUTRAL };
  const apply = (fx) => {
    if (!fx) return;
    for (const [k, v] of Object.entries(fx)) {
      if (k === "assist") m.assist = Math.max(m.assist, v);
      else if (ADDITIVE.has(k)) m[k] += v;
      else m[k] *= v;
    }
  };
  apply(CELL_PASSIVES[cellCard]?.fx);
  apply(INSTINCTS[instinct]?.fx);
  return m;
}

/**
 * What each instinct hands the Tribal Stage, in lineage.js's effect vocabulary. Like the other
 * legacies it is a strength, but with a cost: damage/gift/music multipliers, relation added.
 */
export const TRIBE_INSTINCT = {
  apex: { name: "Apex Predator", icon: "🦖", text: "Fighters hit 15% harder, but rivals start 10 warier.", effect: { damage: 1.15, relation: -10 } },
  packHunter: { name: "Pack Hunter", icon: "🐺", text: "Fighters hit 10% harder, but gifts move rivals 10% less.", effect: { damage: 1.1, gift: 0.9 } },
  territorial: { name: "Territorial", icon: "🛡", text: "Your chief's hut starts at level 2, but songs move rivals 10% less.", effect: { hutLevel: 2, music: 0.9 } },
  symbiotic: { name: "Symbiotic", icon: "🤝", text: "Rivals start 10 friendlier, but fighters hit 10% softer.", effect: { relation: 10, damage: 0.9 } },
  nurturing: { name: "Nurturing", icon: "🥚", text: "Gatherers carry one more food, but fighters hit 5% softer.", effect: { carry: 1, damage: 0.95 } },
  elusive: { name: "Elusive", icon: "🍃", text: "Songs move rivals 15% further, but gifts 10% less.", effect: { music: 1.15, gift: 0.9 } },
  adaptable: { name: "Adaptable", icon: "🧭", text: "Gatherers carry one more food, but songs move rivals 10% less.", effect: { carry: 1, music: 0.9 } },
  scavenger: { name: "Scavenger", icon: "🦴", text: "Gatherers carry one more food, but rivals start 5 warier.", effect: { carry: 1, relation: -5 } },
};

/* ---- moments for the chronicle ------------------------------------------------------------- */
/** First times worth remembering, written from what actually happened. */
const FIRSTS = {
  hunts: { icon: "🍖", text: (r) => "Made a first kill " + r + "." },
  predatorKills: { icon: "⚔", text: (r) => "Brought down a predator " + r + "." },
  befriended: { icon: "💚", text: (r) => "Made a first friend of another species " + r + "." },
  gifts: { icon: "🎁", text: () => "Shared food with another species for the first time." },
  escapes: { icon: "💨", text: (r) => "Escaped a hunter " + r + "." },
  defended: { icon: "🛡", text: () => "Fought off a threat to kin." },
  kinLost: { icon: "🕯", text: () => "Lost one of the family." },
  scavenged: { icon: "🦴", text: () => "Fed on another creature's kill." },
  intimidations: { icon: "😤", text: () => "Stared down a rival without a fight." },
  ambushes: { icon: "👣", text: () => "Struck from hiding." },
  eggs: { icon: "🥚", text: () => "Stole an egg from another nest." },
};
/** Larger milestones: [key, at, icon, text]. */
const MILESTONES = [
  ["hunts", 10, "🍖", (r) => "Ten kills: the herds " + r + " now know your scent."],
  ["hunts", 30, "🦖", () => "Thirty kills. Few creatures still graze near your kind."],
  ["befriended", 10, "🎶", () => "Ten creatures of other species count your kind as friends."],
  ["escapes", 5, "🍃", () => "Five escapes: your kind survives by not being caught."],
  ["scavenged", 8, "🦴", () => "Lives on what others leave behind."],
  ["defended", 4, "🛡", () => "Known for defending its own."],
];

/**
 * The chronicle moment (if any) that the ledger just reached for `key`, or null.
 * @param {string} key the act counted
 * @param {number} count its new total
 * @param {string} where  the place, ready to read: "on the Sunlit Coast", "in the Deepwood Forest"
 * @param {string} regionId
 */
export function momentFor(key, count, where, regionId) {
  if (count === 1 && FIRSTS[key]) return { key: "first:" + key, stage: "creature", icon: FIRSTS[key].icon, text: FIRSTS[key].text(where) };
  const m = MILESTONES.find(([k, at]) => k === key && at === count);
  if (m) return { key: "milestone:" + key + ":" + m[1], stage: "creature", icon: m[2], text: m[3](where, regionId) };
  return null;
}

/** A shift in character, for the chronicle, once the ledger is big enough to mean something. */
const LEANING_TEXT = {
  apex: "Other creatures began to fear your kind.",
  packHunter: "Your kind learned to hunt together.",
  territorial: "Your kind began to hold its ground.",
  symbiotic: "Your kind began to live alongside other species.",
  nurturing: "Your kind put its young first.",
  elusive: "Your kind learned to slip away from danger.",
  adaptable: "Your kind learned to eat whatever it found.",
  scavenger: "Your kind learned to follow the hunters.",
};
export const leaningMoment = (id) => ({ key: "leaning:" + id, stage: "creature", icon: INSTINCTS[id].icon, text: LEANING_TEXT[id] });
