/**
 * Encounters: rare moments where the player decides what happens next.
 *
 * Each one plays out in the world first (a rival prowling round your nest, a lost youngster crying
 * near you) and only offers a choice, as a few small buttons, once you are there. Every choice has a
 * different, lasting outcome, written here as data the stage applies: acts for the ledger
 * (identity.js), acts for the other species' memory (memory.js), a chronicle line, and an effect.
 * Pure data and functions; the stage spawns the creatures and shows the buttons.
 */

export const ENCOUNTERS = {
  rival: {
    id: "rival",
    // A territorial creature claims the ground round your nest, eyeing your larder.
    choices: [
      { id: "defend", icon: "🛡", label: "Defend the nest" },
      { id: "move", icon: "🧭", label: "Move the nest" },
      { id: "coexist", icon: "🤝", label: "Let it stay" },
    ],
  },
  stray: {
    id: "stray",
    // A youngster of another species, separated from its own, crying for them.
    choices: [
      { id: "guide", icon: "🐾", label: "Lead it home" },
      { id: "hunt", icon: "🍖", label: "Hunt it" },
    ],
  },
};
export const ENCOUNTER_IDS = Object.keys(ENCOUNTERS);

/**
 * What each outcome does. ledger: acts counted; memory: the act the other species remembers;
 * effect: what the stage changes; text(name): the chronicle line.
 */
export const OUTCOMES = {
  rival: {
    // Fight it off: the ground is yours, but its kind will remember.
    defend: { ledger: ["defended"], memory: "kill", icon: "🛡", text: (n) => "Held the nest against a " + n + "." },
    // It won: it eats from the larder and leaves.
    lost: { ledger: [], memory: null, effect: { larder: -4 }, icon: "🥀", text: (n) => "A " + n + " drove your family from the larder." },
    // Give way: safe, but the larder is left behind and the family has to trek to a new nest.
    move: { ledger: ["fled"], memory: null, effect: { larder: "all", migrate: true }, icon: "🧭", text: (n) => "Gave the nest up to a " + n + " and moved on." },
    // Share the ground: it settles nearby. It helps against raiders, and helps itself to your food.
    coexist: { ledger: ["befriended"], memory: "coexist", effect: { neighbour: true }, icon: "🤝", text: (n) => "Let a " + n + " settle beside the nest." },
    // Nobody came: it raids the larder and wanders off.
    ignored: { ledger: [], memory: null, effect: { larder: -3 }, icon: "🥀", text: (n) => "A " + n + " raided the larder while the nest stood empty." },
  },
  stray: {
    guide: { ledger: ["defended", "befriended"], memory: "rescue", icon: "🐾", text: (n) => "Led a lost young " + n + " home." },
    hunt: { ledger: ["hunts"], memory: "kill", icon: "🍖", text: (n) => "Hunted a lost young " + n + "." },
    ignored: { ledger: [], memory: null, icon: "🌫", text: null },
  },
};

/** Timing, in seconds. Rare on purpose: a moment, not a chore. */
export const ENCOUNTER_TIMING = {
  first: [360, 540], // after arriving in a region
  gap: [600, 960], // between encounters
  approach: 45, // how long a rival prowls before it gets to the larder
  decide: 60, // how long a choice stays open once you are there
  neighbourSteal: 150, // a neighbour helps itself to one food this often (if the larder has some)
};

const between = ([a, b], rand) => a + rand() * (b - a);

/** Encounter bookkeeping for a save. Unknown or broken fields fall back to defaults. */
export function readEncounters(raw, rand = Math.random) {
  const d = raw && typeof raw === "object" ? raw : {};
  const count = (k) => (Number.isFinite(d.done?.[k]) ? Math.max(0, d.done[k] | 0) : 0);
  const n = d.neighbour;
  return {
    clock: Number.isFinite(d.clock) && d.clock > 0 ? Math.min(d.clock, ENCOUNTER_TIMING.gap[1]) : between(ENCOUNTER_TIMING.first, rand),
    last: ENCOUNTER_IDS.includes(d.last) ? d.last : null,
    done: Object.fromEntries(ENCOUNTER_IDS.map((k) => [k, count(k)])),
    // A creature that settled beside your nest: which species, and where.
    neighbour: n && (n.kind === "nest" || n.kind === "wild") && Number.isFinite(n.index) && Number.isFinite(n.x) && Number.isFinite(n.z) ? { kind: n.kind, index: n.index | 0, x: n.x, z: n.z, region: String(n.region || "") } : null,
  };
}

/**
 * Whether an encounter can start now, and which.
 * @param {object} s  readEncounters() state
 * @param {{atHome:boolean, brain:number, busy:boolean, night:boolean, nestDist:number, rivalSource:boolean, strayNear:boolean}} ctx
 *   busy: a raid, a migration, courtship, an encounter or the intro is under way
 */
export function pickEncounter(s, ctx, rand = Math.random) {
  if (s.clock > 0 || ctx.busy || ctx.night) return null;
  const ok = {
    rival: ctx.atHome && ctx.brain >= 2 && ctx.nestDist < 70 && ctx.rivalSource && !s.neighbour,
    stray: ctx.strayNear,
  };
  // Prefer the one not seen last time.
  const options = ENCOUNTER_IDS.filter((id) => ok[id]).sort((a, b) => (a === s.last) - (b === s.last) || s.done[a] - s.done[b]);
  if (!options.length) return null;
  return options[0] === s.last && options.length > 1 ? options[1] : options[0];
}

/** An encounter happened: count it and wait a good while before the next. */
export function encounterDone(s, id, rand = Math.random) {
  s.last = id;
  s.done[id] = (s.done[id] || 0) + 1;
  s.clock = between(ENCOUNTER_TIMING.gap, rand);
}

/** Nothing suitable came up: look again soon. */
export const retryLater = (s) => (s.clock = 30);
