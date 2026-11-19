/**
 * The shared ecosystem library's data model: what an asset record is, how it is validated, and how a
 * planet's conditions are scored against it. Pure data and small helpers (no THREE, no DOM), so the
 * catalogue, the browser and the future planet generator all agree and the rules are unit-tested.
 *
 * Assets are data, not code paths: a record names a generator (see gen-*.js) and its parameters, plus
 * the metadata a generator of worlds needs. Adding an asset means adding a row to a catalogue file;
 * nothing in the ecosystem generator changes.
 */

/** Library tabs, and the asset categories that live under each. */
export const TABS = [
  { id: "trees", name: "Trees", categories: ["tree", "smallTree"] },
  { id: "plants", name: "Plants", categories: ["bush", "grass", "flower", "succulent", "crystalPlant", "alienPlant"] },
  { id: "fungi", name: "Fungi", categories: ["mushroom", "giantFungus"] },
  { id: "aquatic", name: "Aquatic", categories: ["aquatic", "coral"] },
  { id: "rocks", name: "Rocks", categories: ["rock", "crystal", "formation"] },
  { id: "environment", name: "Environment", categories: ["fossil", "ruin", "decor", "prop"] },
  { id: "creatures", name: "Creatures", categories: ["herbivore", "carnivore", "omnivore", "small", "large", "flying", "aquaticFauna"] },
];
export const CATEGORY_NAME = {
  tree: "Tree",
  smallTree: "Small tree",
  bush: "Bush",
  grass: "Grass",
  flower: "Flower",
  succulent: "Succulent",
  crystalPlant: "Crystalline plant",
  alienPlant: "Alien plant",
  mushroom: "Mushroom",
  giantFungus: "Giant fungus",
  aquatic: "Aquatic plant",
  coral: "Coral",
  rock: "Rock",
  crystal: "Crystal",
  formation: "Geological formation",
  fossil: "Fossil",
  ruin: "Ruin",
  decor: "Ground decoration",
  prop: "Prop",
  herbivore: "Herbivore",
  carnivore: "Carnivore",
  omnivore: "Omnivore",
  small: "Small creature",
  large: "Large creature",
  flying: "Flying creature",
  aquaticFauna: "Aquatic creature",
};
export const CATEGORIES = Object.keys(CATEGORY_NAME);
export const tabOf = (category) => TABS.find((t) => t.categories.includes(category))?.id || null;
export const FAUNA_CATEGORIES = TABS.find((t) => t.id === "creatures").categories;

/** Biomes a planet can have. Batch 2's planet generator picks from these. */
export const BIOMES = [
  "temperate_forest",
  "rainforest",
  "grassland",
  "savanna",
  "desert",
  "tundra",
  "taiga",
  "swamp",
  "alpine",
  "volcanic",
  "fungal",
  "crystalline",
  "shallows",
  "deep_ocean",
  "coral_reef",
  "freshwater",
  "wasteland",
  "alien_lush",
];
export const BIOME_NAME = Object.fromEntries(BIOMES.map((b) => [b, b.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())]));
export const TERRAINS = ["soil", "sand", "rock", "snow", "ice", "mud", "ash", "crystal", "shallows", "seabed"];
/** Temperature bands, coldest first. An asset lists the range it tolerates; a planet area has one band. */
export const TEMPERATURES = ["frozen", "cold", "temperate", "warm", "scorching"];
export const RARITIES = ["common", "uncommon", "rare", "unique"];
/** How an asset likes to grow: how many neighbours it wants, and how clumped they are. */
export const DENSITIES = {
  sparse: { perHa: 4, cluster: 0 },
  scattered: { perHa: 14, cluster: 0.2 },
  common: { perHa: 40, cluster: 0.4 },
  dense: { perHa: 120, cluster: 0.5 },
  clustered: { perHa: 60, cluster: 0.9 },
};
export const RARITY_WEIGHT = { common: 1, uncommon: 0.45, rare: 0.15, unique: 0.04 };

const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const range = (s) => String(s).split("-").map(Number);

/**
 * Parse a catalogue row's compact metadata string:
 *   "biomes | tempLo-tempHi | terrains | sizeMin-sizeMax | rarity | density | variants | description"
 * Temperatures are band indexes (0 frozen … 4 scorching), sizes are heights in metres.
 */
export function parseMeta(s) {
  const [biomes, temp, terrain, size, rarity, density, variants, ...desc] = String(s).split("|").map((x) => x.trim());
  const [t0, t1] = range(temp);
  const [s0, s1] = range(size);
  return { biomes: list(biomes), temperature: { min: t0, max: t1 ?? t0 }, terrain: list(terrain), size: { min: s0, max: s1 ?? s0 }, rarity, density, variants: +variants, description: desc.join("|").trim() };
}

/** The preferred temperature band of an asset: the middle of what it tolerates. */
export const preferredTemperature = (a) => Math.round((a.temperature.min + a.temperature.max) / 2);

/** Problems with an asset record, as readable strings. Empty means valid. */
export function validateAsset(a) {
  const p = [];
  if (!a || typeof a !== "object") return ["not an object"];
  if (!/^[a-z][a-z0-9_]*$/.test(a.id || "")) p.push("bad id " + a.id);
  if (!a.name || a.name.length > 40) p.push("bad name");
  if (!CATEGORIES.includes(a.category)) p.push("unknown category " + a.category);
  if (!a.biomes?.length || a.biomes.some((b) => !BIOMES.includes(b))) p.push("bad biomes " + a.biomes);
  if (a.terrain.some((t) => !TERRAINS.includes(t)) || !a.terrain.length) p.push("bad terrain " + a.terrain);
  const { min, max } = a.temperature;
  if (![min, max].every((t) => Number.isInteger(t) && t >= 0 && t < TEMPERATURES.length) || min > max) p.push("bad temperature");
  if (!(a.size.min > 0 && a.size.max >= a.size.min)) p.push("bad size");
  if (!RARITIES.includes(a.rarity)) p.push("bad rarity " + a.rarity);
  if (!DENSITIES[a.density]) p.push("bad density " + a.density);
  if (!(Number.isInteger(a.variants) && a.variants >= 1 && a.variants <= 6)) p.push("bad variants");
  if (!a.description || a.description.length < 12) p.push("missing description");
  return p;
}

/**
 * How well an asset suits a place, 0..1. `env` = { biome, temperature (band index), terrain }.
 * Wrong biome or terrain is not impossible, only unlikely: unusual combinations make strange worlds.
 * Rarity scales the result so common species dominate and rare ones turn up occasionally.
 */
export function suitability(a, env) {
  const biome = a.biomes.includes(env.biome) ? 1 : 0.06;
  const terrain = !env.terrain || a.terrain.includes(env.terrain) ? 1 : 0.15;
  let temp = 1;
  if (env.temperature !== undefined) {
    const out = env.temperature < a.temperature.min ? a.temperature.min - env.temperature : env.temperature > a.temperature.max ? env.temperature - a.temperature.max : 0;
    temp = out === 0 ? 1 : Math.pow(0.35, out);
  }
  return biome * terrain * temp * RARITY_WEIGHT[a.rarity];
}

/** Pick one asset from a list by suitability, using a [0,1) random number. Null if nothing suits at all. */
export function pickBySuitability(assets, env, rand) {
  const w = assets.map((a) => suitability(a, env));
  const total = w.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  let r = rand * total;
  for (let i = 0; i < assets.length; i++) {
    r -= w[i];
    if (r <= 0) return assets[i];
  }
  return assets.at(-1);
}

/** Deterministic seed for an asset's variant, so every client builds the same shape. */
export function variantSeed(id, variant) {
  let h = 2166136261;
  for (const ch of id + "#" + variant) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Text search over name, category, biomes, terrain and description. */
export function matches(a, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [a.name, CATEGORY_NAME[a.category], a.category, a.description, a.biomes.map((b) => BIOME_NAME[b]).join(" "), a.terrain.join(" "), a.rarity, TEMPERATURES[preferredTemperature(a)] || ""].join(" ").toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}
