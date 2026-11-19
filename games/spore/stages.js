/**
 * Cell Stage progression as data: the four growth stages, who lives in each one, and where every
 * part is unlocked. Pure data and small helpers (no THREE, no DOM) so it can be unit-tested and
 * reused by later stages.
 */

/**
 * Each growth stage has its own residents. The previous stage's residents come back smaller (prey),
 * and the next stage's residents turn up as rare giants, so moving up a stage visibly changes the cast.
 * `scale` is the player's body scale at the start of the stage; species are sized against the stage
 * they are native to, which is what makes old neighbours look tiny later on.
 */
export const GROWTH_STAGES = [
  {
    tier: 1,
    id: "microbe",
    name: "Microbe",
    blurb: "A speck in the tide pool. Graze, dodge the Flickers and find your first parts.",
    foodGoal: 22,
    scale: 1,
    residents: { plant: ["mote", "drifter", "bobble"], meat: ["flicker"] },
    giants: ["gnasher"],
    rewards: [],
  },
  {
    tier: 2,
    id: "protozoan",
    name: "Protozoan",
    blurb: "Last generation's neighbours are now bite-sized. Slippers and Twinbulbs graze while Gnashers patrol.",
    foodGoal: 30,
    scale: 1.35,
    residents: { plant: ["slipper", "twinbulb", "plodder"], meat: ["gnasher"] },
    giants: ["stinger"],
    // The omnivore mouth is guaranteed once the first stage is done.
    rewards: ["proboscis", "mito"],
  },
  {
    tier: 3,
    id: "predator-soup",
    name: "Predator Soup",
    blurb: "Stingers and Lancers rule here, and wide Gliders sweep the water. Grow armour or speed, or become the hunter.",
    foodGoal: 38,
    scale: 1.8,
    residents: { plant: ["glider", "puffkin"], meat: ["stinger", "lancer"] },
    giants: ["bloomback", "maw"],
    rewards: ["armour"],
  },
  {
    tier: 4,
    id: "giant",
    name: "Giant",
    blurb: "Bloombacks and Maws are the giants of the soup. Mate once more and your species can leave the water.",
    foodGoal: 46,
    scale: 2.4,
    residents: { plant: ["bloomback", "drowsel"], meat: ["maw"] },
    giants: [],
    rewards: ["electric"],
  },
];

export const LAST_TIER = GROWTH_STAGES.length;
export const stageFor = (tier) => GROWTH_STAGES[Math.min(LAST_TIER, Math.max(1, tier)) - 1];
export const stageScale = (tier) => stageFor(tier).scale;

/** Species from the stage before this one, shown as small prey. */
export function preyFor(tier) {
  if (tier <= 1) return [];
  const prev = stageFor(tier - 1).residents;
  return [...prev.plant, ...prev.meat];
}

/**
 * Where each part comes from. Mirrors Spore: some parts are found in meteor shards, some are taken
 * from dead cells that carry them, and growing a stage hands one out as a reward.
 *  - starter: available from the start (the herbivore and carnivore mouths, cilia and eyes)
 *  - meteor:  can appear in meteor shards from this stage on
 *  - drop:    species whose bodies drop this part when they die (whoever killed them)
 *  - stage:   unlocked automatically on reaching this stage
 */
export const PART_SOURCES = {
  filter: { starter: true },
  cilia: { starter: true },
  eye: { starter: true },
  jaw: { starter: true },
  proboscis: { stage: 2, meteor: 1, drop: ["lancer"] },
  flagellum: { drop: ["slipper", "flicker", "stinger"] },
  spike: { drop: ["gnasher", "stinger", "lancer"] },
  jet: { meteor: 2, drop: ["maw"] },
  poison: { meteor: 3, drop: ["lancer"] },
  electric: { meteor: 3, drop: ["maw"], stage: 4 },
  mito: { stage: 2, drop: ["bloomback"] },
  armour: { stage: 3, drop: ["glider", "bloomback", "maw"] },
};

/** Parts a meteor shard can contain at this stage, among those still locked. */
export function meteorPool(tier, locked) {
  const pool = locked.filter((id) => PART_SOURCES[id]?.meteor && PART_SOURCES[id].meteor <= tier);
  return pool.length ? pool : locked.filter((id) => !PART_SOURCES[id]?.stage || PART_SOURCES[id].stage <= tier);
}

/** Human hint for a locked part, shown on its silhouette in the editor. */
export function unlockHint(id, speciesName = (s) => s) {
  const src = PART_SOURCES[id] || {};
  const bits = [];
  if (src.drop) bits.push("Dropped by " + src.drop.slice(0, 2).map(speciesName).join(" / "));
  if (src.meteor) bits.push("Meteor shards" + (src.meteor > 1 ? " (stage " + src.meteor + "+)" : ""));
  if (src.stage) bits.push("Reach stage " + src.stage);
  return bits.join(" · ") || "Keep exploring";
}
