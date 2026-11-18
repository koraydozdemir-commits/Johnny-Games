/**
 * Consequence traits, as in Spore.
 *
 * Each stage ends with one card that records how your species behaved, colour-coded the way Spore
 * does it: red for aggressive/carnivore, green for peaceful/herbivore, blue for the balanced omnivore.
 * In the Cell Stage the card comes from what you ate. Every card becomes an ability in the stages
 * that follow, and the cards collected over a whole game form your species' evolution track.
 * Pure data and functions: no THREE, no DOM.
 */

/** 0 = pure herbivore, 1 = pure carnivore. Neutral until something has been eaten. */
export function dietLean(plants, meat) {
  const total = plants + meat;
  return total === 0 ? 0.5 : meat / total;
}

/** Mostly one food type earns that card; a real mix earns the omnivore card. */
export const DIET_THRESHOLDS = { herbivore: 0.25, carnivore: 0.75 };

export function dietPath(plants, meat) {
  const lean = dietLean(plants, meat);
  if (plants + meat === 0) return "omnivore";
  return lean <= DIET_THRESHOLDS.herbivore ? "herbivore" : lean >= DIET_THRESHOLDS.carnivore ? "carnivore" : "omnivore";
}

export const TRAIT_COLORS = { red: "#ef4b48", green: "#3fc26e", blue: "#3f9cf0" };

/** The three Cell Stage consequence traits. */
export const DIET_CARDS = {
  carnivore: {
    id: "carnivore",
    title: "Carnivore",
    trait: "red",
    color: TRAIT_COLORS.red,
    ability: "Feral Roar",
    icon: "🥩",
    text: "A terrifying roar that freezes nearby creatures in place for a few seconds.",
    requirement: "Eat mostly meat (75% or more).",
  },
  omnivore: {
    id: "omnivore",
    title: "Omnivore",
    trait: "blue",
    color: TRAIT_COLORS.blue,
    ability: "Swarm Call",
    icon: "✧",
    text: "Calls a few relatives to your side for a while. They forage with you and gather food.",
    requirement: "Eat a real mix of plants and meat.",
  },
  herbivore: {
    id: "herbivore",
    title: "Herbivore",
    trait: "green",
    color: TRAIT_COLORS.green,
    ability: "Gentle Chorus",
    icon: "🌿",
    text: "A soothing call that calms nearby creatures, so they stop fleeing and let you approach.",
    requirement: "Eat mostly plants (75% or more).",
  },
};

/**
 * The evolution track: one consequence slot per stage. Cell, Creature and Tribal are playable;
 * Civilisation and Space are still to come.
 */
export const STAGE_TRACK = [
  { id: "cell", title: "Cell", status: "playable", icon: "◉" },
  { id: "creature", title: "Creature", status: "playable", icon: "🦎" },
  { id: "tribe", title: "Tribe", status: "playable", icon: "⛺" },
  { id: "civ", title: "Civilization", status: "playable", icon: "🏛" },
  { id: "space", title: "Space", status: "future", icon: "🪐" },
];

/** Creature Stage consequence traits, from how the island's species were handled. */
export const CREATURE_CARDS = {
  predator: { id: "predator", title: "Aggressive", trait: "red", color: TRAIT_COLORS.red, icon: "🦖", ability: "War Cry", text: "Your pack hits harder for a while. Earned by driving species to extinction." },
  charmer: { id: "charmer", title: "Social", trait: "green", color: TRAIT_COLORS.green, icon: "🎶", ability: "Peace Offering", text: "An angry group stops attacking. Earned by befriending species." },
  adaptable: { id: "adaptable", title: "Adaptable", trait: "blue", color: TRAIT_COLORS.blue, icon: "🧭", ability: "Quick Recovery", text: "Heal your whole pack at once. Earned by mixing friendship and force." },
};
/** Mostly extinctions → Aggressive (red), mostly alliances → Social (green), a mix → Adaptable (blue). */
export function creatureCard(alliances, extinctions) {
  const total = alliances + extinctions;
  if (!total) return "adaptable";
  const red = extinctions / total;
  return red >= 0.75 ? "predator" : red <= 0.25 ? "charmer" : "adaptable";
}
