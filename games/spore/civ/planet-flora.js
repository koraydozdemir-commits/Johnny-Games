/**
 * The planet's forests, plants and rocks, streamed in around the camera. The surface is cut into square
 * cells; a cell's plants are decided from its position alone (seeded, so a revisited place grows the same
 * forest) the first time it is needed, using the same library, suitability rules and palette as the other
 * stages. Only cells near the camera are alive, up to a budget, and the instancer draws them with
 * level of detail, so a whole planet of forest costs a few dozen draw calls.
 */
import * as THREE from "three";
import { hashSeed, rng32 } from "../galaxy/names.js";
import { candidatesFor } from "../ecolib/catalog.js";
import { DENSITIES } from "../ecolib/schema.js";
import { createLibrary } from "../ecolib/library.js";
import { createEcoInstancer } from "../ecolib/instancer.js";
import { mix } from "../ecolib/color.js";
import { TERRAIN, mapToLonLat, inBounds } from "./planet-map.js";
import { frameQuat, worldAt } from "./planet-render.js";

const CELL = 36;
/** Library plants are modelled at creature scale; a civilization's cities are smaller, so the land is scaled to match them. */
const SCALE = { trees: 0.5, smallTrees: 0.55, shrubs: 0.6, grass: 0.7, flowers: 0.7, rocks: 0.6 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Layers of a landscape: library categories, count per cell at full density, and spacing. */
const LAYERS = [
  { id: "trees", cats: ["tree"], base: 16, spacing: 1.0, pool: 3 },
  { id: "smallTrees", cats: ["smallTree", "giantFungus"], base: 5, spacing: 0.8, pool: 1 },
  { id: "shrubs", cats: ["bush"], base: 18, spacing: 0.35, pool: 2 },
  { id: "grass", cats: ["grass"], base: 16, spacing: 0, pool: 1 },
  { id: "flowers", cats: ["flower", "succulent", "alienPlant", "crystalPlant", "mushroom"], base: 7, spacing: 0, pool: 1 },
  { id: "rocks", cats: ["rock", "crystal", "formation"], base: 6, spacing: 0.6, pool: 2 },
];
/** How much of each layer a biome grows (trees, shrubs, grass, flowers, rocks multiply the layer's count). */
const BIOME_MIX = {
  temperate_forest: { trees: 1.4, smallTrees: 1, shrubs: 1, grass: 0.9, flowers: 0.8, rocks: 0.5 },
  rainforest: { trees: 1.8, smallTrees: 1.2, shrubs: 1.2, grass: 0.7, flowers: 1, rocks: 0.4 },
  taiga: { trees: 1.3, smallTrees: 0.6, shrubs: 0.7, grass: 0.5, flowers: 0.2, rocks: 0.6 },
  alien_lush: { trees: 1.2, smallTrees: 1.2, shrubs: 1.2, grass: 1, flowers: 1.4, rocks: 0.4 },
  fungal: { trees: 0.5, smallTrees: 1.6, shrubs: 0.6, grass: 0.3, flowers: 1.4, rocks: 0.5 },
  grassland: { trees: 0.25, smallTrees: 0.3, shrubs: 0.8, grass: 1.6, flowers: 1.2, rocks: 0.4 },
  savanna: { trees: 0.2, smallTrees: 0.4, shrubs: 0.6, grass: 1.1, flowers: 0.5, rocks: 0.5 },
  swamp: { trees: 0.8, smallTrees: 0.6, shrubs: 0.9, grass: 0.9, flowers: 0.5, rocks: 0.2 },
  tundra: { trees: 0.05, smallTrees: 0.1, shrubs: 0.4, grass: 0.7, flowers: 0.2, rocks: 0.8 },
  desert: { trees: 0.02, smallTrees: 0.1, shrubs: 0.25, grass: 0.15, flowers: 0.5, rocks: 1 },
  wasteland: { trees: 0.02, smallTrees: 0, shrubs: 0.1, grass: 0.05, flowers: 0, rocks: 1.3 },
  alpine: { trees: 0.1, smallTrees: 0.1, shrubs: 0.2, grass: 0.2, flowers: 0.1, rocks: 1.8 },
  volcanic: { trees: 0, smallTrees: 0, shrubs: 0.05, grass: 0, flowers: 0, rocks: 1.6 },
  crystalline: { trees: 0.05, smallTrees: 0.2, shrubs: 0.1, grass: 0.05, flowers: 0.8, rocks: 1.8 },
};
const FALLBACK_MIX = { trees: 0.5, smallTrees: 0.4, shrubs: 0.5, grass: 0.5, flowers: 0.5, rocks: 0.8 };
const PLANT_KEY = { trees: "trees", smallTrees: "trees", shrubs: "shrubs", grass: "grass", flowers: "flowers" };

/** Plant cell (ci, cj): its placements in map space. Pure given the map and pool function. */
export function growCell(map, seed, ci, cj, { density, quality, poolFor, keepClear }) {
  const r = rng32(hashSeed(seed, "cell", ci, cj));
  const x0 = ci * CELL,
    z0 = cj * CELL;
  const out = [];
  const profile = map.profile;
  const placed = [];
  const crowded = (x, z, rad) => placed.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + rad) ** 2);
  for (const layer of LAYERS) {
    if (layer.id === "grass" && quality === "low") continue;
    const flora = PLANT_KEY[layer.id] ? clamp(profile.flora[PLANT_KEY[layer.id]] ?? 1, 0.05, 1.6) : 1;
    const baseCount = layer.base * (layer.id === "rocks" ? 1 : density * flora);
    let guard = 0;
    // The expected count is fractional: its remainder is a chance of one more.
    const mixAt = (biome) => (BIOME_MIX[biome] || FALLBACK_MIX)[layer.id] ?? 0.5;
    const attempts = Math.ceil(baseCount * 1.6) + 2;
    for (let a = 0; a < attempts && guard < attempts; a++) {
      guard++;
      const x = x0 + r() * CELL,
        z = z0 + r() * CELL;
      if (!inBounds(x, z, 12)) continue;
      const { lon, lat } = mapToLonLat(x, z);
      const h = map.heightLL(lon, lat);
      if (h < TERRAIN.shore) continue;
      const info = map.biomeLL(lon, lat, h);
      if (info.ice || info.water) continue;
      const k = mixAt(info.biome);
      // Each attempt is a chance, scaled by what the biome grows here, so patches blend at biome borders.
      if (r() > (baseCount / attempts) * 1.6 * k) continue;
      if (h > TERRAIN.snow + 2 && layer.id !== "rocks") continue;
      if (h > TERRAIN.peak && (layer.id === "trees" || layer.id === "smallTrees")) continue;
      if (keepClear(x, z)) continue;
      const pool = poolFor(layer, info);
      if (!pool.length) continue;
      const asset = pool[Math.floor(r() * pool.length)];
      const dens = DENSITIES[asset.density];
      const members = dens.cluster >= 0.9 ? 2 + Math.floor(r() * 3) : dens.cluster >= 0.5 ? 1 + Math.floor(r() * 2) : 1;
      const spread = Math.max(0.6, asset.size.max * SCALE[layer.id] * (0.5 + r() * 0.6));
      for (let m = 0; m < members; m++) {
        const ma = r() * Math.PI * 2,
          md = m === 0 ? 0 : Math.sqrt(r()) * spread;
        const px = x + Math.cos(ma) * md,
          pz = z + Math.sin(ma) * md;
        if (m && keepClear(px, pz)) continue;
        const size = asset.size.min + (asset.size.max - asset.size.min) * (0.15 + 0.85 * Math.pow(r(), 0.8));
        const rad = layer.spacing * size * SCALE[layer.id] * 0.35;
        if (rad > 0.5 && crowded(px, pz, rad)) continue;
        if (rad > 0.5) placed.push({ x: px, z: pz, r: rad });
        out.push({ id: asset.id, x: px, z: pz, yaw: r() * Math.PI * 2, size: Math.round(size * SCALE[layer.id] * 100) / 100, variant: Math.floor(r() * 3), layer: layer.id, biome: info.biome, shade: Math.round((0.88 + r() * 0.22) * 100) / 100 });
      }
    }
  }
  return out;
}

/**
 * The scenery layer of a planet view.
 * @param {THREE.Scene|THREE.Object3D} parent
 * @param {object} map
 * @param {{ quality?: string, cities?: Array<{x:number,z:number}>, links?: Array<[{x,z},{x,z}]>, spice?: Array<{x:number,z:number}> }} o
 */
export function createPlanetFlora(parent, map, { quality = "medium", cities = [], links = [], spice = [] } = {}) {
  const profile = map.profile;
  const library = createLibrary();
  const opts = { lodNear: 85, lodFar: 190, cullDistance: 300, moveThreshold: 4, spherical: true };
  const instancer = createEcoInstancer(parent, library, opts);
  const seed = hashSeed("civflora", profile.planetId, map.seed);
  const density = clamp(profile.plantDensity, 0.15, 1.3);
  const v = profile.vegetation;
  const palette = { hue: v.hue, sat: clamp(v.sat / 0.45, 0.3, 1.6), light: clamp(v.light / 0.38, 0.4, 1.5) };
  const stone = mix(0xffffff, profile.terrain.mineralColor, 0.5);
  const budget = quality === "low" ? 1300 : quality === "high" ? 4200 : 2500;
  const poolCap = quality === "low" ? 0.6 : 1;
  const pools = new Map();
  /** A small fixed set of species for each (layer, biome): few species per area keeps draw calls low. */
  const poolFor = (layer, info) => {
    const key = layer.id + "|" + info.biome + "|" + info.terrain;
    let pool = pools.get(key);
    if (pool) return pool;
    const env = { biome: info.biome, temperature: profile.temperature.band, terrain: info.terrain };
    const r = rng32(hashSeed(seed, "pool", key));
    // One scan of the library for this place, then a weighted draw without replacement.
    const cands = candidatesFor(env, { categories: layer.cats, minWeight: 0.004 });
    pool = [];
    const want = Math.max(1, Math.round(layer.pool * poolCap));
    const left = cands.slice();
    while (pool.length < want && left.length) {
      const total = left.reduce((sum, c) => sum + c.weight, 0);
      let x = r() * total,
        at = 0;
      for (let i = 0; i < left.length; i++) {
        x -= left[i].weight;
        if (x <= 0) {
          at = i;
          break;
        }
      }
      pool.push(left.splice(at, 1)[0].asset);
    }
    pools.set(key, pool);
    return pool;
  };
  /** Where nothing grows: city grounds, spice vents and the roads between cities. */
  const keepClear = (x, z) => {
    for (const c of cities) {
      const dx = x - c.x,
        dz = z - c.z;
      if (dx * dx + dz * dz < 34 * 34) return true;
    }
    for (const s of spice) {
      const dx = x - s.x,
        dz = z - s.z;
      if (dx * dx + dz * dz < 9 * 9) return true;
    }
    for (const [a, b] of links) {
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < 3.2) return true;
    }
    return false;
  };

  const cells = new Map();
  const make = (ci, cj) => {
    const key = ci + "," + cj;
    let c = cells.get(key);
    if (!c) {
      const raw = growCell(map, seed, ci, cj, { density, quality, poolFor, keepClear });
      const q = new THREE.Quaternion(),
        yq = new THREE.Quaternion(),
        up = new THREE.Vector3(0, 1, 0);
      const list = raw.map((p) => {
        const isRock = p.layer === "rocks";
        const h = map.heightAt(p.x, p.z) - (isRock ? p.size * 0.06 : 0.04);
        const w = worldAt(map, p.x, p.z, h);
        frameQuat(map, p.x, p.z, q);
        yq.setFromAxisAngle(up, p.yaw);
        return { id: p.id, x: w.x, y: w.y, z: w.z, q: q.clone().multiply(yq), size: p.size, variant: p.variant, shade: p.shade, palette, tint: isRock ? stone : undefined, layer: p.layer };
      });
      c = { list, used: 0 };
      cells.set(key, c);
      // Forget cells that haven't been wanted for a long time.
      if (cells.size > 900) {
        const old = [...cells.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 300);
        for (const [k] of old) cells.delete(k);
      }
    }
    return c;
  };

  let frame = 0,
    lastKey = "",
    active = 0,
    pending = false;
  const stats = { cells: 0, placements: 0, species: 0 };
  return {
    instancer,
    stats,
    /**
     * Keep the cells near the focus alive. `dist` is the camera's zoom distance: far out nothing is drawn.
     * New cells are grown a few a frame (`maxNew`), so sweeping across the planet never stalls a frame.
     */
    update(camera, focus, dist, { maxNew = 2 } = {}) {
      frame++;
      const near = dist < 260;
      const radius = clamp(dist * 1.5, 90, 210);
      const ci = Math.floor(focus.x / CELL),
        cj = Math.floor(focus.z / CELL);
      const key = near ? ci + "," + cj + "," + Math.round(radius / 30) : "off";
      if (key !== lastKey || pending) {
        const list = [];
        let fresh = 0;
        pending = false;
        if (near) {
          const n = Math.ceil(radius / CELL);
          const want = [];
          for (let dj = -n; dj <= n; dj++)
            for (let di = -n; di <= n; di++) {
              const d = Math.hypot(di, dj) * CELL;
              if (d <= radius + CELL * 0.7) want.push([ci + di, cj + dj, d]);
            }
          want.sort((a, b) => a[2] - b[2]);
          for (const [a, b] of want) {
            const known = cells.has(a + "," + b);
            if (!known && fresh >= maxNew) {
              pending = true; // grown on a later frame
              continue;
            }
            if (!known) fresh++;
            const c = make(a, b);
            c.used = frame;
            if (list.length + c.list.length > budget) break;
            for (const p of c.list) list.push(p);
          }
        }
        lastKey = key;
        instancer.set(list);
        instancer.update(camera, { force: true }); // clears what is no longer wanted
        active = list.length;
        stats.cells = cells.size;
        stats.placements = active;
        stats.species = new Set(list.map((p) => p.id)).size;
      }
      if (active) {
        const s = instancer.update(camera);
        stats.drawn = s.drawn;
        stats.drawCalls = s.drawCalls;
      } else {
        stats.drawn = 0;
        stats.drawCalls = 0;
      }
    },
    dispose() {
      instancer.dispose();
      library.clear();
    },
  };
}
export { LAYERS, CELL };
