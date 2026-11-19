/**
 * The Civilization Stage's planet, as data: continents, oceans, mountains, valleys, biomes, city sites,
 * spice geysers and the routes between them. Pure (no THREE, no DOM), deterministic for a planet, so it is
 * unit tested and the 3D view, the minimap and the game rules all read the same world.
 *
 * Space. The game keeps a flat "map" coordinate system (x east, z south, in metres on the surface) so
 * every distance, range and speed in the rules means what it says. The map is a sinusoidal projection of
 * the sphere: x = longitude * R * cos(latitude), z = -latitude * R. Distances along parallels and
 * meridians are true, and the shear between them stays small away from the poles. Polar caps (beyond
 * LAT_MAX) and the date line are open ice and sea that units cannot cross; everything else is playable.
 *
 * The planet is the player's homeworld: its profile (from the universe) decides the land and sea
 * proportions, the biomes and their proportions, the ice line, the relief and every ground colour.
 */
import { hashSeed, rng32 } from "../galaxy/names.js";
import { adjust, mix } from "../ecolib/color.js";
import { BIOME_TERRAIN, SHORE_OF } from "../ecolib/ecosystem.js";
import { cityName } from "./rules.js";

export const PLANET = { R: 260, LAT_MAX: (72 * Math.PI) / 180, CELL: 8 };
const { R, LAT_MAX, CELL } = PLANET;
const HALF_W = Math.PI * R;
const Z_MAX = R * LAT_MAX;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------------- space conversions */
/** Map metres to longitude/latitude (radians). */
export function mapToLonLat(x, z) {
  const lat = clamp(-z / R, -Math.PI / 2, Math.PI / 2);
  const c = Math.max(1e-6, Math.cos(lat));
  return { lon: clamp(x / (R * c), -Math.PI, Math.PI), lat };
}
/** Longitude/latitude (radians) to map metres. */
export const lonLatToMap = (lon, lat) => ({ x: lon * R * Math.cos(lat), z: -lat * R });
/** Unit vector on the sphere (Y is the pole, x east, z south: a right-handed frame at every point). */
export const unitVector = (lon, lat, out = [0, 0, 0]) => {
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -c * Math.sin(lon);
  return out;
};
/** World position of a map point at a height above sea level. */
export function toWorld(x, z, h = 0, out = [0, 0, 0]) {
  const { lon, lat } = mapToLonLat(x, z);
  unitVector(lon, lat, out);
  const r = R + h;
  out[0] *= r;
  out[1] *= r;
  out[2] *= r;
  return out;
}
/** Is a map point inside the playable area (not beyond a polar cap or the date line)? */
export const inBounds = (x, z, margin = 0) => {
  if (Math.abs(z) > Z_MAX - margin) return false;
  const lat = -z / R;
  return Math.abs(x) <= HALF_W * Math.cos(lat) - margin;
};
/** The nearest playable point. */
export function clampToMap(x, z, margin = 6) {
  const nz = clamp(z, -Z_MAX + margin, Z_MAX - margin);
  const lat = -nz / R;
  const lim = Math.max(0, HALF_W * Math.cos(lat) - margin);
  return { x: clamp(x, -lim, lim), z: nz };
}

/* -------------------------------------------------------------------------------- 3D noise */
const hash3 = (s, x, y, z) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t) => t * t * (3 - 2 * t);
export function noise3(s, x, y, z) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const fx = fade(x - x0),
    fy = fade(y - y0),
    fz = fade(z - z0);
  const a = (dz) => {
    const c00 = hash3(s, x0, y0, z0 + dz) * (1 - fx) + hash3(s, x0 + 1, y0, z0 + dz) * fx;
    const c10 = hash3(s, x0, y0 + 1, z0 + dz) * (1 - fx) + hash3(s, x0 + 1, y0 + 1, z0 + dz) * fx;
    return c00 * (1 - fy) + c10 * fy;
  };
  return a(0) * (1 - fz) + a(1) * fz;
}
export function fbm3(s, x, y, z, oct = 4) {
  let v = 0,
    amp = 0.5,
    f = 1,
    norm = 0;
  for (let i = 0; i < oct; i++) {
    v += noise3(s + i * 131, x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/* ------------------------------------------------------------------------------- biomes */
export const BIOME_LABEL = {
  temperate_forest: "Temperate forest",
  rainforest: "Rainforest",
  grassland: "Grassland",
  savanna: "Savanna",
  desert: "Desert",
  tundra: "Tundra",
  taiga: "Taiga",
  swamp: "Swamp",
  alpine: "Mountains",
  volcanic: "Volcanic land",
  fungal: "Fungal forest",
  crystalline: "Crystal fields",
  wasteland: "Wasteland",
  alien_lush: "Alien jungle",
  ice: "Polar ice",
  ocean: "Ocean",
  shallows: "Shallow sea",
};

/** Latitude (radians) beyond which the ground is snow and ice, by temperature band 0 (frozen) .. 4 (scorching). */
const ICE_LAT = [0.35, 0.78, 1.05, 1.23, 9];

/** Coarse sea-level, land and mountain figures other modules (scenery, minimap) share. */
export const TERRAIN = { shore: 1.1, peak: 12, snow: 17, steep: 0.55 };

/* ------------------------------------------------------------------------------- the map */
/**
 * Build the planet for a profile. Deterministic: the same profile always gives the same world. If a
 * seed gives a poor planet (too few continents or city sites) the next seed is tried, up to 24 times.
 * @param {object} profile from planetProfile (ecolib/planet-profile.js)
 * @param {{ seed?: number, cities?: number, spice?: number }} [opts]
 */
export function createPlanetMap(profile, opts = {}) {
  const base = hashSeed("civplanet", profile.planetId, profile.v ?? 1, opts.seed ?? 0);
  let best = null;
  for (let salt = 0; salt < 24; salt++) {
    const map = buildMap(profile, hashSeed(base, salt), opts);
    map.salt = salt;
    if (!best || map.quality > best.quality) best = map;
    if (map.ok) return map;
  }
  return best;
}

function buildMap(profile, seed, opts) {
  const wantCities = opts.cities ?? 12; // the capital and eleven more
  const wantSpice = opts.spice ?? 12;
  const rnd = rng32(hashSeed(seed, "sites"));
  const sCont = hashSeed(seed, "cont"),
    sWarp = hashSeed(seed, "warp"),
    sHill = hashSeed(seed, "hill"),
    sRange = hashSeed(seed, "range"),
    sRidge = hashSeed(seed, "ridge"),
    sValley = hashSeed(seed, "valley"),
    sMoist = hashSeed(seed, "moist"),
    sPatch = hashSeed(seed, "patch"),
    sBiome = hashSeed(seed, "biome");
  const T = profile.terrain,
    V = profile.vegetation;
  const band = profile.temperature.band;
  const relief = clamp(profile.relief, 0.55, 1.4);
  const coverage = clamp(profile.water?.coverage ?? 0.6, 0, 1);
  const landFraction = clamp(0.62 - coverage * 0.45, 0.3, 0.55);
  const iceLat = ICE_LAT[clamp(band, 0, 4)];
  const pads = [];

  /* sea level: the continent-field value that leaves `landFraction` of the playable area as land */
  const contField = (px, py, pz) => {
    const w = 0.2;
    const qx = px + (fbm3(sWarp, px * 1.7, py * 1.7, pz * 1.7, 2) - 0.5) * w;
    const qy = py + (fbm3(sWarp + 7, px * 1.7, py * 1.7, pz * 1.7, 2) - 0.5) * w;
    const qz = pz + (fbm3(sWarp + 13, px * 1.7, py * 1.7, pz * 1.7, 2) - 0.5) * w;
    return fbm3(sCont, qx * 1.45, qy * 1.45, qz * 1.45, 5);
  };
  const thr = (() => {
    const vals = [];
    const n = 2400;
    const v = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      // Fibonacci lattice over the playable latitude band: even by area.
      const sinLat = (((i + 0.5) / n) * 2 - 1) * Math.sin(LAT_MAX);
      const lat = Math.asin(sinLat),
        lon = (i * 2.399963) % TAU;
      unitVector(lon, lat, v);
      vals.push(contField(v[0], v[1], v[2]));
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length * (1 - landFraction))];
  })();

  const v3 = [0, 0, 0];
  /** Height above sea level (negative at sea) before city pads: the natural terrain. */
  function naturalHeight(lon, lat) {
    unitVector(lon, lat, v3);
    const px = v3[0],
      py = v3[1],
      pz = v3[2];
    const e = contField(px, py, pz) - thr;
    let h;
    if (e <= 0) h = -smooth(0, 0.11, -e) * 8;
    else {
      const ramp = smooth(0, 0.035, e);
      const hills = (fbm3(sHill, px * 5.5, py * 5.5, pz * 5.5, 3) - 0.5) * 2.6;
      const range = smooth(0.05, 0.2, e) * (0.3 + 0.7 * smooth(0.32, 0.68, fbm3(sRange, px * 1.3, py * 1.3, pz * 1.3, 2)));
      const ridge = 1 - Math.abs(2 * fbm3(sRidge, px * 3.4, py * 3.4, pz * 3.4, 4) - 1);
      const mount = Math.pow(smooth(0.5, 0.92, ridge), 1.4) * range * 21 * relief;
      // Valleys: along thin lines the lowland sinks, so ranges and plains are cut by long river valleys.
      const valley = smooth(0, 0.09, Math.abs(fbm3(sValley, px * 2.8, py * 2.8, pz * 2.8, 3) - 0.5));
      const lowland = (1.5 + hills + e * 9) * (0.4 + 0.6 * valley);
      h = Math.max(0.03, ramp * lowland + mount);
    }
    // Polar caps: a flat shelf of ice.
    const ice = smooth(LAT_MAX - 0.12, LAT_MAX + 0.02, Math.abs(lat));
    return ice ? lerp(h, 0.7, ice) : h;
  }
  /** Height with the levelled ground under cities and spice geysers. */
  function heightLL(lon, lat) {
    const h = naturalHeight(lon, lat);
    if (!pads.length || Math.abs(lat) > LAT_MAX) return h;
    const x = lon * R * Math.cos(lat),
      z = -lat * R;
    let out = h;
    for (const p of pads) {
      const dx = x - p.x;
      if (dx > p.r1 || dx < -p.r1) continue;
      const d = Math.hypot(dx, z - p.z);
      if (d >= p.r1) continue;
      out += (p.h - out) * (1 - smooth(p.r0, p.r1, d));
    }
    return out;
  }
  const heightAt = (x, z) => {
    const { lon, lat } = mapToLonLat(x, z);
    return heightLL(lon, lat);
  };

  /* biomes: organic patches in the profile's proportions, refined by wetness, latitude and height */
  const sites = (() => {
    const r = rng32(hashSeed(seed, "biomesites"));
    const n = 15;
    const list = [];
    for (let i = 0; i < n; i++) {
      const lat = Math.asin(((i + 0.5) / n) * 2 - 1) + (r() - 0.5) * 0.25;
      const lon = i * 2.399963 + (r() - 0.5) * 0.9;
      list.push({ v: unitVector(lon, clamp(lat, -1.5, 1.5)), biome: null });
    }
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const quota = profile.biomes.map((b) => ({ biome: b.biome, left: Math.max(1, Math.round(b.weight * n)) }));
    for (const s of list) {
      quota.sort((a, b) => b.left - a.left);
      s.biome = quota[0].biome;
      quota[0].left--;
    }
    return list;
  })();
  const hasDesert = band >= 2 && band <= 4;
  function biomeLL(lon, lat, h) {
    unitVector(lon, lat, v3);
    const px = v3[0],
      py = v3[1],
      pz = v3[2];
    if (h <= 0 && Math.abs(lat) < LAT_MAX - 0.1) return { biome: "ocean", terrain: "water", moisture: 1, ice: false, water: true };
    const a = Math.abs(lat);
    if (a > Math.min(iceLat, LAT_MAX - 0.03)) return { biome: "ice", terrain: "snow", moisture: 0.5, ice: true, water: false };
    const wx = px + (noise3(sBiome, px * 2.2, py * 2.2, pz * 2.2) - 0.5) * 0.4,
      wy = py + (noise3(sBiome + 5, px * 2.2, py * 2.2, pz * 2.2) - 0.5) * 0.4,
      wz = pz + (noise3(sBiome + 9, px * 2.2, py * 2.2, pz * 2.2) - 0.5) * 0.4;
    let best = sites[0],
      bd = -2;
    for (const s of sites) {
      const d = s.v[0] * wx + s.v[1] * wy + s.v[2] * wz;
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    let biome = SHORE_OF[best.biome] || best.biome;
    const moisture = fbm3(sMoist, px * 2.3, py * 2.3, pz * 2.3, 3);
    // Wetness and drought bend the patch: forests in the damp, desert in the dry, so no continent is one note.
    if (biome === "grassland" || biome === "savanna") {
      if (moisture > 0.6 && band >= 2 && band <= 3) biome = "temperate_forest";
      else if (moisture < 0.34) biome = hasDesert ? "desert" : "wasteland";
    } else if (biome === "temperate_forest" || biome === "rainforest" || biome === "taiga") {
      if (moisture < 0.27) biome = band >= 3 ? "savanna" : "grassland";
    }
    if (h > TERRAIN.peak && biome !== "volcanic" && biome !== "crystalline") biome = "alpine";
    if (a > iceLat - 0.17 && band <= 2 && biome !== "alpine") biome = "tundra";
    return { biome, terrain: BIOME_TERRAIN[biome] || "soil", moisture, ice: false, water: false };
  }

  /* ground colour: the planet's own palette by biome, height and steepness */
  const seabedShallow = mix(T.seabed, profile.water.color, 0.5);
  const seaDeep = adjust(profile.water.color, { light: 0.55, sat: 1.1 });
  const GROUND = {
    temperate_forest: [mix(T.grassDark, V.leaf, 0.4), mix(T.grassDark, V.leaf2, 0.2)],
    rainforest: [adjust(mix(T.grassDark, V.leaf, 0.6), { light: 0.8 }), mix(T.grassDark, V.leaf, 0.3)],
    grassland: [T.grassLight, T.grassDark],
    savanna: [mix(T.grassLight, T.sand, 0.5), mix(T.grassDark, T.dirt, 0.4)],
    desert: [T.sand, mix(T.sand, T.dirt, 0.5)],
    tundra: [mix(T.snow, T.grassDark, 0.35), mix(T.snow, T.rock, 0.3)],
    taiga: [mix(T.grassDark, V.leaf, 0.3), adjust(mix(T.grassDark, T.rock, 0.3), { light: 0.85 })],
    swamp: [mix(T.dirt, V.leaf, 0.35), adjust(mix(T.dirt, V.leaf, 0.2), { light: 0.7 })],
    alpine: [T.rock, T.cliff],
    volcanic: [adjust(T.rock, { light: 0.6 }), mix(T.dirt, 0x7a2a14, 0.35)],
    fungal: [mix(T.dirt, V.fungus, 0.45), mix(T.grassDark, V.fungus, 0.35)],
    crystalline: [mix(T.rock, V.fungus, 0.4), mix(T.rock, 0xcfd8ff, 0.3)],
    wasteland: [T.dirt, T.rock],
    alien_lush: [mix(T.grassLight, V.leaf2, 0.6), mix(T.grassDark, V.leaf, 0.5)],
    ice: [T.snow, mix(T.snow, 0xcfe4ee, 0.4)],
  };
  /** Ground colour (0xRRGGBB) at a place; `slope` is rise over run (0 flat). */
  function colorLL(lon, lat, h, slope, info = null) {
    if (h <= 0 && Math.abs(lat) < LAT_MAX - 0.1) return mix(seabedShallow, seaDeep, smooth(0.2, 6, -h));
    info = info || biomeLL(lon, lat, h);
    unitVector(lon, lat, v3);
    const n = noise3(sPatch, v3[0] * 24, v3[1] * 24, v3[2] * 24);
    const pair = GROUND[info.biome] || GROUND.grassland;
    let c = mix(pair[0], pair[1], n);
    if (info.biome !== "ice" && info.biome !== "tundra" && h < TERRAIN.shore) c = mix(c, T.sand, smooth(TERRAIN.shore, 0.15, h) * 0.85);
    if (slope > 0.3) c = mix(c, T.cliff, smooth(0.3, 0.7, slope) * 0.8);
    if (band <= 3 && h > TERRAIN.snow - band * 2 && info.biome !== "volcanic") c = mix(c, T.snow, smooth(TERRAIN.snow - band * 2, TERRAIN.snow + 3, h));
    return c;
  }

  /* ---- the coarse grid: land and sea, continents, coast distance ---------------------------- */
  const nx = Math.ceil((2 * HALF_W) / CELL),
    nz = Math.ceil((2 * Z_MAX) / CELL);
  const N = nx * nz;
  const cellX = (i) => -HALF_W + (i + 0.5) * CELL,
    cellZ = (j) => -Z_MAX + (j + 0.5) * CELL;
  const gi = (x) => clamp(Math.floor((x + HALF_W) / CELL), 0, nx - 1),
    gj = (z) => clamp(Math.floor((z + Z_MAX) / CELL), 0, nz - 1);
  const H = new Float32Array(N);
  const inside = new Uint8Array(N);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i,
        x = cellX(i),
        z = cellZ(j);
      if (!inBounds(x, z, 6)) {
        H[k] = -1;
        continue;
      }
      inside[k] = 1;
      const { lon, lat } = mapToLonLat(x, z);
      H[k] = naturalHeight(lon, lat);
    }
  const isLandCell = (k) => inside[k] && H[k] > 0.25;

  // Continents: 4-connected land. "Big" ones are real continents; small ones are islands.
  const label = new Int32Array(N).fill(-1);
  const continents = [];
  const stack = [];
  for (let k0 = 0; k0 < N; k0++) {
    if (label[k0] >= 0 || !isLandCell(k0)) continue;
    const id = continents.length;
    let area = 0,
      sx = 0,
      sz = 0;
    stack.length = 0;
    stack.push(k0);
    label[k0] = id;
    while (stack.length) {
      const k = stack.pop();
      area++;
      const i = k % nx,
        j = (k - i) / nx;
      sx += cellX(i);
      sz += cellZ(j);
      if (i > 0 && label[k - 1] < 0 && isLandCell(k - 1)) ((label[k - 1] = id), stack.push(k - 1));
      if (i < nx - 1 && label[k + 1] < 0 && isLandCell(k + 1)) ((label[k + 1] = id), stack.push(k + 1));
      if (j > 0 && label[k - nx] < 0 && isLandCell(k - nx)) ((label[k - nx] = id), stack.push(k - nx));
      if (j < nz - 1 && label[k + nx] < 0 && isLandCell(k + nx)) ((label[k + nx] = id), stack.push(k + nx));
    }
    continents.push({ id, cells: area, area: area * CELL * CELL, cx: sx / area, cz: sz / area });
  }
  const BIG = 90; // cells (about 5800 square metres): a continent, not an island
  const big = continents.filter((c) => c.cells >= BIG);
  const quality = Math.min(big.length, 6) * 100;

  // Distance from the sea, in metres (chamfer transform), so cities keep off the coast.
  const coast = new Float32Array(N).fill(1e6);
  {
    const q = [];
    for (let k = 0; k < N; k++)
      if (inside[k] && !isLandCell(k)) {
        coast[k] = 0;
        q.push(k);
      }
    for (let head = 0; head < q.length; head++) {
      const k = q[head],
        i = k % nx,
        j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di,
            b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const m = b * nx + a;
          const nd = coast[k] + (di && dj ? CELL * 1.414 : CELL);
          if (nd < coast[m]) {
            coast[m] = nd;
            q.push(m);
          }
        }
    }
  }
  const slopeAtCell = (i, j) => {
    const a = i > 0 ? H[j * nx + i - 1] : H[j * nx + i],
      b = i < nx - 1 ? H[j * nx + i + 1] : H[j * nx + i],
      c = j > 0 ? H[(j - 1) * nx + i] : H[j * nx + i],
      d = j < nz - 1 ? H[(j + 1) * nx + i] : H[j * nx + i];
    return Math.hypot((b - a) / (2 * CELL), (d - c) / (2 * CELL));
  };

  /* ---- city sites ----------------------------------------------------------------------------- */
  const eligible = (k, minCoast = 18) => {
    if (!isLandCell(k) || coast[k] < minCoast) return false;
    const i = k % nx,
      j = (k - i) / nx;
    const h = H[k];
    if (h < 1.4 || h > 12) return false;
    if (slopeAtCell(i, j) > 0.22) return false;
    const lat = Math.abs(-cellZ(j) / R);
    if (lat > Math.min(iceLat - 0.1, LAT_MAX - 0.3)) return false;
    // Keep a margin from the date line so a city never sits on the map edge.
    return inBounds(cellX(i), cellZ(j), 34);
  };
  const cities = [];
  const contOf = (k) => label[k];
  const distMap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const minDistTo = (x, z, list) => {
    let d = Infinity;
    for (const c of list) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    return d;
  };
  const homeCont = [...big].sort((a, b) => b.cells - a.cells)[0];
  if (homeCont) {
    // The capital: flat ground a little inland on the largest continent, near its heart and the warm belt.
    let bestK = -1,
      bestS = -Infinity;
    for (let k = 0; k < N; k++) {
      if (contOf(k) !== homeCont.id || !eligible(k, 24) || coast[k] > 70) continue;
      const i = k % nx,
        j = (k - i) / nx;
      const s = -Math.hypot(cellX(i) - homeCont.cx, cellZ(j) - homeCont.cz) * 0.5 - Math.abs(cellZ(j)) * 0.35 - slopeAtCell(i, j) * 200 + rnd() * 6;
      if (s > bestS) {
        bestS = s;
        bestK = k;
      }
    }
    if (bestK >= 0) {
      const i = bestK % nx,
        j = (bestK - i) / nx;
      cities.push({ x: cellX(i), z: cellZ(j), cont: homeCont.id, k: bestK });
    }
  }
  if (cities.length) {
    // The others: the home continent takes a third, every other continent at least one, spread out.
    const quotas = new Map();
    const others = big.filter((c) => c !== homeCont).sort((a, b) => b.cells - a.cells);
    let left = wantCities - 1;
    quotas.set(homeCont.id, Math.min(Math.max(3, Math.round(left * 0.36)), left));
    left -= quotas.get(homeCont.id);
    for (const c of others) {
      if (left <= 0) break;
      quotas.set(c.id, 1);
      left--;
    }
    const totalOther = others.reduce((s, c) => s + c.cells, 0) || 1;
    for (const c of others) {
      if (left <= 0) break;
      const extra = Math.min(left, Math.round((c.cells / totalOther) * (wantCities - 1 - quotas.size - quotas.get(homeCont.id))));
      quotas.set(c.id, quotas.get(c.id) + extra);
      left -= extra;
    }
    // Anything left over goes to the biggest continents, then to islands.
    const order = [homeCont, ...others];
    for (let t = 0; left > 0 && t < 40; t++) {
      const c = order[t % order.length];
      quotas.set(c.id, (quotas.get(c.id) || 0) + 1);
      left--;
    }
    const place = (cont, sep, minCoast) => {
      let bestK = -1,
        bestScore = -Infinity;
      for (let k = 0; k < N; k++) {
        if (contOf(k) !== cont || !eligible(k, minCoast)) continue;
        const i = k % nx,
          j = (k - i) / nx;
        const x = cellX(i),
          z = cellZ(j);
        const d = minDistTo(x, z, cities);
        if (d < sep) continue;
        // The best spot is far from every city but not absurdly so: an even spread with a little chance.
        const s = Math.min(d, 150) + rnd() * 22 - slopeAtCell(i, j) * 60;
        if (s > bestScore) {
          bestScore = s;
          bestK = k;
        }
      }
      if (bestK < 0) return false;
      const i = bestK % nx,
        j = (bestK - i) / nx;
      cities.push({ x: cellX(i), z: cellZ(j), cont, k: bestK });
      return true;
    };
    for (const sep of [78, 62, 50]) {
      for (const c of order) {
        let have = cities.filter((s) => s.cont === c.id).length;
        while (have < (quotas.get(c.id) || 0) && cities.length < wantCities && place(c.id, sep, 18)) have++;
      }
    }
    // Still short: islands and any continent, then closer together.
    for (const sep of [78, 62, 50, 42]) {
      const pool = [...continents].sort((a, b) => b.cells - a.cells);
      for (const c of pool) {
        if (cities.length >= wantCities) break;
        if (c.cells < 10) continue;
        while (cities.length < wantCities && place(c.id, sep, c.cells < BIG ? 14 : 18));
      }
    }
  }
  // Everyone but the capital in order of distance from it, so the nearest cities are your neighbours.
  const cap = cities[0];
  if (cap) cities.sort((a, b) => (a === cap ? -1 : b === cap ? 1 : distMap(a, cap) - distMap(b, cap)));

  /* ---- levelled ground under cities ------------------------------------------------------------ */
  for (const c of cities) {
    c.h = Math.max(1.6, H[c.k]);
    pads.push({ x: c.x, z: c.z, h: c.h, r0: 22, r1: 40 });
  }
  const recomputeNear = (p) => {
    const i0 = gi(p.x - p.r1),
      i1 = gi(p.x + p.r1),
      j0 = gj(p.z - p.r1),
      j1 = gj(p.z + p.r1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!inside[k]) continue;
        const { lon, lat } = mapToLonLat(cellX(i), cellZ(j));
        H[k] = heightLL(lon, lat);
      }
  };
  pads.forEach(recomputeNear);

  /* ---- the ocean: which water is the open sea, and where each coastal city anchors boats --------- */
  const ocean = new Uint8Array(N);
  {
    // The biggest body of water is the ocean; lakes are the rest.
    const wl = new Int32Array(N).fill(-1);
    let bestId = -1,
      bestN = 0,
      id = 0;
    for (let k0 = 0; k0 < N; k0++) {
      if (!inside[k0] || H[k0] > -0.3 || wl[k0] >= 0) continue;
      let n = 0;
      stack.length = 0;
      stack.push(k0);
      wl[k0] = id;
      while (stack.length) {
        const k = stack.pop();
        n++;
        const i = k % nx,
          j = (k - i) / nx;
        for (const m of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1])
          if (m >= 0 && wl[m] < 0 && inside[m] && H[m] <= -0.3) {
            wl[m] = id;
            stack.push(m);
          }
      }
      if (n > bestN) ((bestN = n), (bestId = id));
      id++;
    }
    for (let k = 0; k < N; k++) if (wl[k] === bestId && bestId >= 0) ocean[k] = 1;
  }
  const anchorFor = (c) => {
    let best = null,
      bd = Infinity;
    const reach = 11; // cells
    const ci = gi(c.x),
      cj = gj(c.z);
    for (let dj = -reach; dj <= reach; dj++)
      for (let di = -reach; di <= reach; di++) {
        const i = ci + di,
          j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const k = j * nx + i;
        if (!ocean[k] || H[k] > -0.8) continue;
        const d = Math.hypot(di, dj) * CELL;
        if (d < bd) {
          bd = d;
          best = { x: cellX(i), z: cellZ(j) };
        }
      }
    return best ? { ...best, dist: bd } : null;
  };
  for (const c of cities) {
    const a = anchorFor(c);
    c.sea = a ? { x: a.x, z: a.z } : null;
    c.coastal = !!a && a.dist <= 90;
    c.coastDist = a ? Math.round(a.dist) : null;
  }

  /* ---- spice geysers ---------------------------------------------------------------------------- */
  const spice = [];
  {
    const dryBiomeBonus = { desert: 1.25, wasteland: 1.2, volcanic: 1.3, alpine: 1.1, crystalline: 1.15 };
    const candidates = [];
    for (let k = 0; k < N; k++) {
      if (!isLandCell(k) || coast[k] < 10) continue;
      const i = k % nx,
        j = (k - i) / nx;
      if (H[k] < 1 || H[k] > 15 || slopeAtCell(i, j) > 0.3) continue;
      const x = cellX(i),
        z = cellZ(j);
      if (!inBounds(x, z, 30)) continue;
      if (Math.abs(-z / R) > Math.min(iceLat - 0.05, LAT_MAX - 0.25)) continue;
      if (minDistTo(x, z, cities) < 40) continue;
      candidates.push({ k, x, z, cont: label[k] });
    }
    const contQuota = new Map();
    const pool = [...continents].filter((c) => c.cells >= 14).sort((a, b) => b.cells - a.cells);
    // Every continent gets one geyser; small ones are the contested prizes you need boats or aircraft for.
    for (const c of pool) if (contQuota.size < wantSpice) contQuota.set(c.id, 1);
    let extra = wantSpice - contQuota.size;
    for (let t = 0; extra > 0 && t < 60; t++) {
      const c = big[t % Math.max(1, big.length)] || pool[0];
      if (!c) break;
      contQuota.set(c.id, (contQuota.get(c.id) || 0) + 1);
      extra--;
    }
    const pick = (cont, sep) => {
      let best = null,
        bs = -Infinity;
      for (const c of candidates) {
        if (c.cont !== cont) continue;
        const d = Math.min(minDistTo(c.x, c.z, spice), 160);
        if (d < sep) continue;
        const ll = mapToLonLat(c.x, c.z);
        const info = biomeLL(ll.lon, ll.lat, H[c.k]);
        // Prefer barren and rugged ground, and the spaces between cities (contested), over a city's backyard.
        const between = Math.min(minDistTo(c.x, c.z, cities), 130);
        const s = d * 0.5 + between * 0.35 + (dryBiomeBonus[info.biome] || 1) * 20 + rnd() * 26;
        if (s > bs) {
          bs = s;
          best = { ...c, biome: info.biome };
        }
      }
      return best;
    };
    for (const sep of [70, 54, 42]) {
      for (const [cont, n] of contQuota) {
        let have = spice.filter((s) => s.cont === cont).length;
        while (have < n && spice.length < wantSpice) {
          const p = pick(cont, sep);
          if (!p) break;
          spice.push({ x: p.x, z: p.z, cont: p.cont, biome: p.biome, k: p.k });
          have++;
        }
      }
    }
    for (const sp of spice) {
      const nearest = minDistTo(sp.x, sp.z, cities);
      const isle = (continents[sp.cont]?.cells || 0) < BIG;
      // Yield: richer far from any capital (contested ground), on islands, and in barren country.
      sp.yield = Math.round(clamp(0.75 + Math.min(1, nearest / 140) * 0.55 + (isle ? 0.3 : 0) + ((dryBiomeBonus[sp.biome] || 1) - 1) * 1.1 + (rnd() - 0.5) * 0.2, 0.7, 2) * 100) / 100;
    }
    for (const sp of spice) pads.push({ x: sp.x, z: sp.z, h: Math.max(1.2, H[sp.k]), r0: 5, r1: 13 });
    spice.slice().forEach((sp) => recomputeNear({ x: sp.x, z: sp.z, r1: 13 }));
  }

  /* ---- walkable cells and routes ---------------------------------------------------------------- */
  const landOk = new Uint8Array(N),
    seaOk = new Uint8Array(N);
  const refreshWalk = () => {
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!inside[k] || !inBounds(cellX(i), cellZ(j), 14)) {
          landOk[k] = seaOk[k] = 0;
          continue;
        }
        landOk[k] = H[k] > 0.25 && slopeAtCell(i, j) < TERRAIN.steep && Math.abs(-cellZ(j) / R) < LAT_MAX - 0.16 ? 1 : 0;
        seaOk[k] = H[k] < -0.4 ? 1 : 0;
      }
  };
  refreshWalk();
  /* ---- passes: every city and geyser must be reachable by land from the rest of its continent ---- */
  // Mountain ridges and narrow necks can cut a continent in two for vehicles. Where they do, a pass is
  // cut straight between the two sites: a corridor of levelled ground that blends back into the hills.
  {
    const comp = new Int32Array(N);
    const labelLand = () => {
      comp.fill(-1);
      let id = 0;
      for (let k0 = 0; k0 < N; k0++) {
        if (!landOk[k0] || comp[k0] >= 0) continue;
        stack.length = 0;
        stack.push(k0);
        comp[k0] = id;
        while (stack.length) {
          const k = stack.pop();
          const i = k % nx;
          if (i > 0 && landOk[k - 1] && comp[k - 1] < 0) ((comp[k - 1] = id), stack.push(k - 1));
          if (i < nx - 1 && landOk[k + 1] && comp[k + 1] < 0) ((comp[k + 1] = id), stack.push(k + 1));
          if (k >= nx && landOk[k - nx] && comp[k - nx] < 0) ((comp[k - nx] = id), stack.push(k - nx));
          if (k < N - nx && landOk[k + nx] && comp[k + nx] < 0) ((comp[k + nx] = id), stack.push(k + nx));
        }
        id++;
      }
    };
    const labelOf = (x, z) => {
      const s = snapCell(x, z, 3);
      return s >= 0 ? comp[s] : -2;
    };
    function snapCell(x, z, reach) {
      const ci = gi(x),
        cj = gj(z);
      let best = -1,
        bd = Infinity;
      for (let dj = -reach; dj <= reach; dj++)
        for (let di = -reach; di <= reach; di++) {
          const i = ci + di,
            j = cj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const k = j * nx + i;
          if (!landOk[k]) continue;
          const d = di * di + dj * dj;
          if (d < bd) ((bd = d), (best = k));
        }
      return best;
    }
    const carve = (a, b) => {
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.ceil(d / 5);
      const ha = Math.max(1.2, heightAt(a.x, a.z)),
        hb = Math.max(1.2, heightAt(b.x, b.z));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        if (landOk[gj(z) * nx + gi(x)]) continue;
        const pad = { x, z, h: Math.max(1.2, ha + (hb - ha) * t), r0: 10, r1: 22 };
        pads.push(pad);
        recomputeNear(pad);
      }
      refreshWalk();
    };
    const groups = new Map();
    for (const s of [...cities, ...spice]) {
      if (!groups.has(s.cont)) groups.set(s.cont, []);
      groups.get(s.cont).push(s);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      for (let round = 0; round < 6; round++) {
        labelLand();
        const anchor = labelOf(list[0].x, list[0].z);
        const stray = list.find((s) => labelOf(s.x, s.z) !== anchor);
        if (!stray) break;
        // Join it to the nearest site that is already connected.
        const joined = list.filter((s) => labelOf(s.x, s.z) === anchor).sort((p, q) => Math.hypot(p.x - stray.x, p.z - stray.z) - Math.hypot(q.x - stray.x, q.z - stray.z))[0];
        carve(joined, stray);
      }
    }
  }
  const airOk = new Uint8Array(N);
  for (let k = 0; k < N; k++) airOk[k] = inside[k] && inBounds(cellX(k % nx), cellZ((k - (k % nx)) / nx), 10) ? 1 : 0;
  const walkGrid = { land: landOk, sea: seaOk, air: airOk };
  /** Can a vehicle of this mode stand at a map point? */
  const walkable = (mode, x, z) => {
    if (!inBounds(x, z, mode === "air" ? 6 : 10)) return false;
    if (mode === "air") return true;
    const h = heightAt(x, z);
    if (mode === "land") return h > 0.2 && walkGrid.land[gj(z) * nx + gi(x)] === 1;
    return h < -0.3 && walkGrid.sea[gj(z) * nx + gi(x)] === 1;
  };
  const snapToWalkable = (mode, x, z, maxCells = 8) => {
    const ci = gi(x),
      cj = gj(z);
    const grid = walkGrid[mode];
    if (grid[cj * nx + ci]) return { i: ci, j: cj };
    let best = null,
      bd = Infinity;
    for (let dj = -maxCells; dj <= maxCells; dj++)
      for (let di = -maxCells; di <= maxCells; di++) {
        const i = ci + di,
          j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !grid[j * nx + i]) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = { i, j };
        }
      }
    return best;
  };
  const losClear = (mode, a, b) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (CELL * 0.6));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!walkable(mode, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };
  /**
   * A route for a vehicle: waypoints from `from` to `to`, or null if it cannot get there (a land vehicle
   * across the sea, a boat inland). Air vehicles fly straight.
   * @returns {Array<{x:number,z:number}>|null}
   */
  function findPath(mode, from, to) {
    if (mode === "air") return [{ x: to.x, z: to.z }];
    if (walkable(mode, from.x, from.z) && walkable(mode, to.x, to.z) && losClear(mode, from, to)) return [{ x: to.x, z: to.z }];
    const s = snapToWalkable(mode, from.x, from.z, 10),
      g = snapToWalkable(mode, to.x, to.z, 10);
    if (!s || !g) return null;
    const grid = walkGrid[mode];
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const sk = s.j * nx + s.i,
      gk = g.j * nx + g.i;
    const heur = (k) => {
      const i = k % nx,
        j = (k - i) / nx;
      const dx = Math.abs(i - g.i),
        dz = Math.abs(j - g.j);
      return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * CELL;
    };
    // A binary heap on f score.
    const heap = [];
    const f = new Float32Array(N);
    const push = (k) => {
      heap.push(k);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (f[heap[p]] <= f[heap[c]]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0],
        last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1,
            r = l + 1;
          let m = c;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    gScore[sk] = 0;
    f[sk] = heur(sk);
    push(sk);
    let found = false;
    while (heap.length) {
      const k = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === gk) {
        found = true;
        break;
      }
      const i = k % nx,
        j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di,
            b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const m = b * nx + a;
          if (!grid[m] || closed[m]) continue;
          // Corners must not cut across blocked cells.
          if (di && dj && (!grid[j * nx + a] || !grid[b * nx + i])) continue;
          const ng = gScore[k] + (di && dj ? CELL * 1.414 : CELL);
          if (ng < gScore[m]) {
            gScore[m] = ng;
            came[m] = k;
            f[m] = ng + heur(m);
            push(m);
          }
        }
    }
    if (!found) return null;
    const cells = [];
    for (let k = gk; k >= 0; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => ({ x: cellX(k % nx), z: cellZ((k - (k % nx)) / nx) }));
    // String-pulling: keep only the corners a vehicle really has to turn at.
    const out = [];
    let at = { x: from.x, z: from.z },
      idx = 0;
    while (idx < pts.length) {
      let far = idx;
      for (let t = pts.length - 1; t > idx; t--)
        if (losClear(mode, at, pts[t])) {
          far = t;
          break;
        }
      out.push(pts[far]);
      at = pts[far];
      idx = far + 1;
    }
    if (out.length) out[out.length - 1] = walkable(mode, to.x, to.z) ? { x: to.x, z: to.z } : out[out.length - 1];
    return out;
  }
  const reachable = (mode, from, to) => mode === "air" || !!findPath(mode, from, to);

  /* ---- names and descriptions ------------------------------------------------------------------- */
  const bigSorted = [...big].sort((a, b) => b.cells - a.cells);
  const continentNames = new Map();
  for (const c of continents) {
    const n = cityName(hashSeed(seed, "continent", c.id));
    continentNames.set(c.id, c.cells >= BIG ? n + (c === bigSorted[0] ? "" : "") : n + " Isle");
  }
  const continentAt = (x, z) => {
    if (!inBounds(x, z, 0)) return -1;
    return label[gj(z) * nx + gi(x)];
  };
  const kmOf = (h) => Math.round(h * 120); // metres of "real" altitude for the readout
  function describe(x, z) {
    const { lon, lat } = mapToLonLat(x, z);
    const h = heightLL(lon, lat);
    const info = biomeLL(lon, lat, h);
    const cont = continentAt(x, z);
    return {
      kind: info.ice ? "ice" : info.water ? (ocean[gj(z) * nx + gi(x)] ? "ocean" : "lake") : "land",
      biome: info.biome,
      label: BIOME_LABEL[info.biome] || info.biome,
      continent: cont >= 0 ? continentNames.get(cont) : null,
      altitude: kmOf(Math.max(0, h)),
      depth: h < 0 ? Math.round(-h * 140) : 0,
      latitude: Math.round((lat * 180) / Math.PI),
      longitude: Math.round((lon * 180) / Math.PI),
      moisture: info.moisture,
    };
  }

  const out = {
    R,
    seed,
    sea: 0,
    profile,
    heightLL,
    heightAt,
    biomeLL,
    colorLL,
    describe,
    continentAt,
    continents: continents.map((c) => ({ ...c, name: continentNames.get(c.id), big: c.cells >= BIG })),
    walkable,
    findPath,
    reachable,
    grid: { nx, nz, cell: CELL, H, label, ocean },
    cellX,
    cellZ,
    citySites: cities.map((c) => ({ x: c.x, z: c.z, h: c.h, continent: c.cont, coastal: c.coastal, coastDist: c.coastDist, sea: c.sea })),
    spiceSites: spice.map((s) => ({ x: s.x, z: s.z, continent: s.cont, biome: s.biome, yield: s.yield })),
    iceLat,
    quality: quality + Math.min(cities.length, wantCities) * 4 + Math.min(spice.length, wantSpice),
    ok: big.length >= 3 && cities.length >= wantCities && spice.length >= Math.min(wantSpice, 9),
  };
  return out;
}

/** What a geyser pays per second: the base rate scaled by its richness. */
export const spiceIncome = (base, geyser) => base * (geyser?.yield ?? 1);
/** Map-space distance. */
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
