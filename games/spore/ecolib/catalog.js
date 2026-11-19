/**
 * The shared ecosystem library: every flora, environment and fauna asset, as plain data. This module
 * has no THREE or DOM dependency, so the catalogue can be validated, searched and used by the planet
 * generator without building any geometry (see library.js for the models).
 */
import { FLORA } from "./catalog-flora.js";
import { ENVIRONMENT, NATURE } from "./catalog-nature.js";
import { FAUNA } from "./catalog-fauna.js";
import { BIOMES, CATEGORIES, TABS, matches, pickBySuitability, suitability, tabOf, validateAsset } from "./schema.js";

/** Every asset record. */
export const ASSETS = [...FLORA, ...NATURE, ...ENVIRONMENT, ...FAUNA].map((a) => ({ ...a, tab: tabOf(a.category) }));
const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export const assetById = (id) => BY_ID.get(id) || null;
export const assetsIn = (category) => ASSETS.filter((a) => a.category === category);
export const assetsInTab = (tab) => ASSETS.filter((a) => a.tab === tab);
export const assetsOfKind = (kind) => ASSETS.filter((a) => a.kind === kind);
export const tabCounts = () => Object.fromEntries(TABS.map((t) => [t.id, assetsInTab(t.id).length]));

/** Search and filter: text, tab, category, biome, rarity. */
export function searchAssets({ q = "", tab = null, category = null, biome = null, rarity = null } = {}) {
  return ASSETS.filter((a) => (!tab || a.tab === tab) && (!category || a.category === category) && (!biome || a.biomes.includes(biome)) && (!rarity || a.rarity === rarity) && matches(a, q));
}

/**
 * Assets that could live in a place, with weights: what the planet generator asks.
 * env = { biome, temperature, terrain }; options: kind, categories, minWeight.
 */
export function candidatesFor(env, { kind = null, categories = null, minWeight = 0.01 } = {}) {
  return ASSETS.filter((a) => (!kind || a.kind === kind) && (!categories || categories.includes(a.category)))
    .map((a) => ({ asset: a, weight: suitability(a, env) }))
    .filter((c) => c.weight >= minWeight)
    .sort((x, y) => y.weight - x.weight);
}
export const pickAsset = (env, rand, opts) => pickBySuitability(candidatesFor(env, { ...opts, minWeight: 0 }).map((c) => c.asset), env, rand);

/** Problems across the whole catalogue (duplicate ids, invalid records). Empty when it is sound. */
export function catalogProblems() {
  const out = [];
  const seen = new Set();
  for (const a of ASSETS) {
    if (seen.has(a.id)) out.push("duplicate id " + a.id);
    seen.add(a.id);
    for (const p of validateAsset(a)) out.push(a.id + ": " + p);
    if (!a.gen || !a.gen.includes(".")) out.push(a.id + ": bad generator");
  }
  return out;
}
export { BIOMES, CATEGORIES, TABS };
