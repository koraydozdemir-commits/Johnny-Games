/**
 * Catalogue row helper. A row is `[category, id, name, generator, params, meta]`, where meta is the compact
 * string described in schema.js with biome and terrain shorthands (below) so tables stay readable.
 * Pure data: no THREE.
 */
import { parseMeta } from "./schema.js";

const BIOME = { tf: "temperate_forest", rf: "rainforest", gr: "grassland", sv: "savanna", de: "desert", tu: "tundra", ta: "taiga", sw: "swamp", al: "alpine", vo: "volcanic", fu: "fungal", cr: "crystalline", sh: "shallows", dp: "deep_ocean", cf: "coral_reef", fw: "freshwater", wl: "wasteland", an: "alien_lush" };
const TERRAIN = { so: "soil", sa: "sand", ro: "rock", sn: "snow", ic: "ice", mu: "mud", as: "ash", cy: "crystal", sl: "shallows", sb: "seabed" };
const expand = (list, map) => list.split(",").map((s) => map[s.trim()] || s.trim()).join(",");

/**
 * Build an asset record.
 * meta: "biomes | tempLo-tempHi | terrains | sizeLo-sizeHi | rarity | density | variants | description"
 * `gen` is "family.generator", e.g. "tree.conifer" (see library.js for the families).
 */
export function row(category, id, name, gen, params, meta) {
  const parts = meta.split("|");
  parts[0] = expand(parts[0], BIOME);
  parts[2] = expand(parts[2], TERRAIN);
  parts[4] = { c: "common", u: "uncommon", r: "rare", q: "unique" }[parts[4].trim()] || parts[4];
  parts[5] = { s: "sparse", t: "scattered", c: "common", d: "dense", k: "clustered" }[parts[5].trim()] || parts[5];
  return { id, name, category, gen, params, ...parseMeta(parts.join("|")), kind: "flora" };
}
export const withKind = (rows, kind) => rows.map((r) => ({ ...r, kind }));
