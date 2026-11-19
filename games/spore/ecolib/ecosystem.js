/**
 * The ecosystem generator: given a planet profile and a seed, decide which library flora grow where, and
 * which creatures live there. Deterministic (no Math.random), so a planet always grows the same forest,
 * and pure (no THREE), so it is tested without a browser.
 *
 * Flora: the planet's biomes are laid out as organic patches (a warped Voronoi map). In each patch,
 * species are drawn by suitability for that biome's temperature and ground, in clusters whose size
 * follows each species' density preference, with natural clearings and thinning, spacing between big
 * trees, a cap on how much one species may dominate, and varied size, rotation and colour.
 *
 * Fauna: herbivores follow the plants, predators follow the herbivores, flyers need air and swimmers
 * need water.
 */
import { hashSeed, rng32 } from "../galaxy/names.js";
import { ASSETS, candidatesFor, pickAsset } from "./catalog.js";
import { DENSITIES } from "./schema.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------------- value noise */
const hash2 = (seed, x, y) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
export function noise2(seed, x, y) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = smooth(x - x0),
    fy = smooth(y - y0);
  const a = hash2(seed, x0, y0),
    b = hash2(seed, x0 + 1, y0),
    c = hash2(seed, x0, y0 + 1),
    d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export const fbm = (seed, x, y, oct = 3) => {
  let v = 0,
    amp = 0.5,
    f = 1,
    norm = 0;
  for (let i = 0; i < oct; i++) {
    v += noise2(seed + i * 101, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
};

/* ------------------------------------------------------------------------ biomes */
/** Ground that goes with each biome. */
export const BIOME_TERRAIN = { desert: "sand", tundra: "snow", taiga: "soil", alpine: "rock", volcanic: "ash", swamp: "mud", wasteland: "rock", crystalline: "crystal", shallows: "sand", fungal: "soil", freshwater: "mud" };
/** What a marine biome looks like on its shore, for the land stages (the water itself is drawn by the world). */
export const SHORE_OF = { shallows: "grassland", coral_reef: "grassland", deep_ocean: "wasteland", freshwater: "swamp" };
const BIOME_TEMP_SHIFT = { alpine: -1, tundra: -1, volcanic: 1, desert: 1, rainforest: 0 };
/** Plant categories each layer of a landscape is made of. */
const LAYERS = [
  { id: "trees", cats: ["tree"], share: 0.1, spacing: 1.1 },
  { id: "smallTrees", cats: ["smallTree", "giantFungus"], share: 0.06, spacing: 0.8 },
  { id: "shrubs", cats: ["bush"], share: 0.16, spacing: 0.4 },
  { id: "grass", cats: ["grass"], share: 0.22, spacing: 0 },
  { id: "flowers", cats: ["flower", "succulent", "alienPlant", "crystalPlant"], share: 0.15, spacing: 0 },
  { id: "fungi", cats: ["mushroom"], share: 0.07, spacing: 0 },
  { id: "rocks", cats: ["rock", "crystal", "formation"], share: 0.12, spacing: 0.7 },
  { id: "decor", cats: ["decor", "prop", "ruin", "fossil"], share: 0.04, spacing: 0.3 },
];
/** Which layer weights the profile's `flora` numbers scale. */
const FLORA_KEY = { trees: "trees", smallTrees: "trees", shrubs: "shrubs", grass: "grass", flowers: "flowers", fungi: "fungi", rocks: null, decor: null };
/** Categories whose models take the planet's foliage colour. */
export const FOLIAGE_CATEGORIES = new Set(["tree", "smallTree", "bush", "grass", "flower", "succulent", "alienPlant", "aquatic"]);
/** Categories that take the planet's rock colour. */
export const ROCK_CATEGORIES = new Set(["rock", "formation", "decor", "ruin", "fossil"]);

/**
 * The planet's biome map for one area: organic patches in the proportions of profile.biomes.
 * @returns {(x:number, z:number) => {biome:string, terrain:string, temperature:number, clearing:number, moisture:number}}
 */
export function biomeMap(profile, seed, radius = 240) {
  const r = rng32(hashSeed("biomemap", seed, profile.planetId));
  const n = 7 + Math.floor(r() * 4);
  // Sites, each given a biome by quota so the proportions match the profile.
  // Sites on a jittered spiral, so every one covers real ground and no biome is lost off the edge.
  const sites = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + (r() - 0.5) * 0.7,
      d = radius * 0.92 * Math.sqrt((i + 0.5) / n) * (0.85 + r() * 0.3);
    sites.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, biome: null });
  }
  // Which site gets which biome is shuffled, so patches are not arranged by weight.
  for (let i = sites.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [sites[i], sites[j]] = [sites[j], sites[i]];
  }
  const quota = profile.biomes.map((b) => ({ biome: b.biome, left: Math.max(1, Math.round(b.weight * n)) }));
  for (const s of sites) {
    quota.sort((a, b) => b.left - a.left);
    s.biome = quota[0].biome;
    quota[0].left--;
  }
  const warp = hashSeed("warp", seed, profile.planetId);
  const clearSeed = hashSeed("clear", seed, profile.planetId);
  const wetSeed = hashSeed("wet", seed, profile.planetId);
  const band = profile.temperature.band;
  return (x, z) => {
    const wx = x + (noise2(warp, x / 70, z / 70) - 0.5) * 90,
      wz = z + (noise2(warp + 7, x / 70, z / 70) - 0.5) * 90;
    let best = sites[0],
      bd = Infinity;
    for (const s of sites) {
      const d = (s.x - wx) ** 2 + (s.z - wz) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    const land = SHORE_OF[best.biome] || best.biome;
    return {
      biome: land,
      water: land !== best.biome ? best.biome : null,
      terrain: BIOME_TERRAIN[land] || "soil",
      temperature: clamp(band + (BIOME_TEMP_SHIFT[land] || 0), 0, 4),
      clearing: fbm(clearSeed, x / 55, z / 55, 3),
      moisture: fbm(wetSeed, x / 90, z / 90, 2),
    };
  };
}

/* -------------------------------------------------------------------------- flora */
/**
 * Plant a landscape.
 * @param {object} profile  from planetProfile
 * @param {number} seed     the area's seed (stable per planet and region)
 * @param {object} o
 * @param {number} o.radius      area radius, metres
 * @param {number} o.count       how many plants to aim for (before the planet's density scales it)
 * @param {(x:number,z:number)=>boolean} [o.isOpen]  false where nothing may grow (water, steep rock)
 * @param {Array<{x:number,z:number,r:number}>} [o.avoid]  places to keep clear (nests, huts)
 * @param {number} [o.speciesCap]  most distinct species to use (each costs draw calls); spread over the layers
 * @param {number} [o.maxVariants] most model variants per species
 * @returns {{ placements: Array<object>, biomeAt: Function, species: string[] }}
 */
export function populate(profile, seed, o) {
  const { radius = 240, count = 800, isOpen = () => true, avoid = [], speciesCap = 999, maxVariants = 3 } = o;
  const r = rng32(hashSeed("populate", seed, profile.planetId));
  const biomeAt = biomeMap(profile, seed, radius);
  const placements = [];
  const used = new Map();
  const bigGrid = new Map();
  const cell = 6;
  const gk = (x, z) => Math.floor(x / cell) + "," + Math.floor(z / cell);
  const crowded = (x, z, rad) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = bigGrid.get(Math.floor(x / cell) + dx + "," + (Math.floor(z / cell) + dz));
        if (list) for (const b of list) if ((b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + rad) ** 2) return true;
      }
    return false;
  };
  const total = LAYERS.reduce((s, l) => s + l.share * (FLORA_KEY[l.id] ? Math.max(0.02, profile.flora[FLORA_KEY[l.id]]) : 1), 0);
  const budget = Math.round(count * clamp(profile.plantDensity, 0.15, 1.3));
  const pickCache = new Map();
  // Each layer may use its share of the species cap (at least three), so the forest stays varied but bounded.
  const layerWeight = LAYERS.map((l) => l.share * (FLORA_KEY[l.id] ? Math.max(0.02, profile.flora[FLORA_KEY[l.id]]) : 1));
  for (const layer of LAYERS) {
    const usedLayer = new Set();
    const layerCap = Math.max(3, Math.round((speciesCap * layerWeight[LAYERS.indexOf(layer)]) / total));
    const w = layer.share * (FLORA_KEY[layer.id] ? Math.max(0.02, profile.flora[FLORA_KEY[layer.id]]) : 1);
    const want = Math.round((budget * w) / total);
    let made = 0,
      guard = 0;
    while (made < want && guard++ < want * 6 + 40) {
      const a = r() * TAU,
        d = Math.sqrt(r()) * radius;
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (!isOpen(x, z) || avoid.some((v) => Math.hypot(v.x - x, v.z - z) < v.r)) continue;
      const env = biomeAt(x, z);
      // Glades: tall growth keeps out of them, everything thins.
      const glade = smoothstep(0.58, 0.72, env.clearing);
      if ((layer.id === "trees" || layer.id === "smallTrees") && r() < glade) continue;
      if (r() < glade * 0.45) continue;
      // Species for this place, with a cap so one never takes over a whole layer.
      let asset = null;
      for (let t = 0; t < 4 && !asset; t++) {
        const e = { biome: env.biome, temperature: env.temperature, terrain: env.terrain };
        const key = layer.id + "|" + env.biome + "|" + env.temperature + "|" + env.terrain;
        let pool = pickCache.get(key);
        if (!pool) pickCache.set(key, (pool = candidatesFor(e, { categories: layer.cats, minWeight: 0.004 }).map((c) => c.asset)));
        let cand = pickAsset(e, r(), { categories: layer.cats });
        if (!cand) break;
        if (usedLayer.size >= layerCap && !usedLayer.has(cand.id)) {
          // The layer has all the species it may use: pick again until one of them suits this spot.
          for (let k = 0; k < 8 && !usedLayer.has(cand.id); k++) cand = pickAsset(e, r(), { categories: layer.cats }) || cand;
          if (!usedLayer.has(cand.id)) continue;
        }
        const share = (used.get(cand.id) || 0) / Math.max(1, made + 8);
        if (share > 0.32 && t < 3) continue;
        asset = cand;
      }
      if (!asset) continue;
      const dens = DENSITIES[asset.density];
      const members = dens.cluster >= 0.9 ? 3 + Math.floor(r() * 5) : dens.cluster >= 0.5 ? 2 + Math.floor(r() * 3) : dens.cluster >= 0.3 ? 1 + Math.floor(r() * 2) : 1;
      const spread = Math.max(0.6, asset.size.max * (0.5 + r() * 0.8));
      for (let m = 0; m < members && made < want + 4; m++) {
        const ma = r() * TAU,
          md = m === 0 ? 0 : Math.sqrt(r()) * spread;
        const px = x + Math.cos(ma) * md,
          pz = z + Math.sin(ma) * md;
        if (m && (!isOpen(px, pz) || avoid.some((v) => Math.hypot(v.x - px, v.z - pz) < v.r))) continue;
        const size = asset.size.min + (asset.size.max - asset.size.min) * (0.15 + 0.85 * Math.pow(r(), 0.8));
        const rad = layer.spacing * size * 0.35;
        if (rad > 0.5 && crowded(px, pz, rad)) continue;
        usedLayer.add(asset.id);
        const p = { id: asset.id, x: px, z: pz, yaw: r() * TAU, size: Math.round(size * 100) / 100, variant: Math.floor(r() * Math.min(asset.variants, maxVariants)), biome: env.biome, layer: layer.id };
        // Small natural differences in brightness so no two look stamped.
        p.shade = Math.round((0.88 + r() * 0.22) * 100) / 100;
        placements.push(p);
        used.set(asset.id, (used.get(asset.id) || 0) + 1);
        if (rad > 0.5) {
          const k = gk(px, pz);
          if (!bigGrid.has(k)) bigGrid.set(k, []);
          bigGrid.get(k).push({ x: px, z: pz, r: rad });
        }
        made++;
      }
    }
  }
  return { placements, biomeAt, species: [...used.keys()] };
}
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* -------------------------------------------------------------------------- fauna */
const ASSET_FAUNA = ASSETS.filter((a) => a.kind === "fauna");
/**
 * Which library creatures live on a planet, with herd sizes. Herbivores are fed by the plants; predators
 * by the herbivores (about one predator species per three prey species); flyers need an atmosphere
 * and swimmers need water. Deterministic for a planet and seed.
 * @returns {{ species: Array<{id:string, category:string, role:string, biome:string, herd:[number,number], rarity:string}>, summary: object }}
 */
export function faunaFor(profile, seed, { maxSpecies = 14 } = {}) {
  if (!profile.habitable) return { species: [], summary: { herbivores: 0, predators: 0 } };
  const r = rng32(hashSeed("fauna", seed, profile.planetId));
  const f = profile.fauna;
  const biomes = profile.biomes;
  const chosen = new Map();
  const add = (cats, n, role) => {
    for (let i = 0; i < n; i++) {
      const bio = biomes[Math.floor(Math.pow(r(), 1.6) * biomes.length)];
      const env = { biome: bio.biome, temperature: profile.temperature.band, terrain: BIOME_TERRAIN[bio.biome] || "soil" };
      const pool = candidatesFor(env, { kind: "fauna", categories: cats, minWeight: 0.003 }).filter((c) => !chosen.has(c.asset.id));
      if (!pool.length) continue;
      const total = pool.reduce((s, c) => s + c.weight, 0);
      let x = r() * total;
      let pick = pool[0].asset;
      for (const c of pool) if ((x -= c.weight) <= 0) { pick = c.asset; break; }
      const sp = pick.params;
      const base = sp.archetype === "smallPrey" ? [3, 6] : sp.archetype === "grazer" ? [4, 7] : sp.archetype === "giant" ? [1, 2] : sp.archetype === "packHunter" ? [3, 4] : sp.archetype === "ambusher" ? [1, 1] : [1, 3];
      chosen.set(pick.id, { id: pick.id, category: pick.category, role: role, biome: bio.biome, herd: base, rarity: pick.rarity });
    }
  };
  const herbs = clamp(Math.round(2 + profile.fertility * 4), 2, 6);
  add(["herbivore", "small"], herbs, "prey");
  add(["omnivore"], Math.round(f.omnivore * 2.5), "forager");
  add(["large"], f.large > 0.2 ? 1 + (r() < 0.4 ? 1 : 0) : 0, "giant");
  const predators = herbs >= 2 ? clamp(Math.round(herbs / 3 + (f.carnivore > 0.35 ? 0.5 : 0)), f.carnivore > 0.1 ? 1 : 0, 3) : 0;
  add(["carnivore"], predators, "predator");
  if (f.flying > 0.15) add(["flying"], 1 + (f.flying > 0.55 ? 1 : 0), "flyer");
  if (f.aquatic > 0.3) add(["aquaticFauna"], 1 + (f.aquatic > 0.7 ? 1 : 0), "swimmer");
  const list = [...chosen.values()].slice(0, maxSpecies);
  return { species: list, summary: { herbivores: list.filter((s) => s.role === "prey" || s.role === "giant").length, predators: list.filter((s) => s.role === "predator").length } };
}

/** Stable seed for one region of one planet. */
export const regionSeed = (profile, regionId) => hashSeed("region", profile.planetId, regionId, profile.v);
export { ASSET_FAUNA };
