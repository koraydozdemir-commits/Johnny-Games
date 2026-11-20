/**
 * The Civilization Stage's planet: a real sphere. Everything on it is placed by a direction from the
 * planet's centre (a unit vector) plus the height of the ground there, so cities, buildings, vehicles,
 * spice and borders all sit on the curved surface and wrap all the way round.
 *
 * This module is pure maths (no THREE, no DOM) so it is unit tested:
 *  - seeded noise for continents, oceans, mountains and climate;
 *  - an icosphere (the same one the globe is drawn from);
 *  - surface frames (east/north at a point) and great-circle distance and movement;
 *  - a navigation graph over the sphere (separate land and sea networks, with their connected
 *    landmasses and oceans) and A* routes on it;
 *  - where the cities and the spice go, starting from where the player's village stood.
 */

export const R = 200; // planet radius in world units

/* ---- vectors (plain {x,y,z}) ------------------------------------------------------------------ */
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const norm = (a) => {
  const l = len(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
export const add = (a, b, k = 1) => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
export const scale = (a, k) => v3(a.x * k, a.y * k, a.z * k);
/** Angle between two directions (radians). */
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
/** Distance along the surface between two directions (world units). */
export const arc = (a, b) => angle(a, b) * R;
/** A direction from latitude/longitude in degrees (y is north). */
export function fromLatLon(lat, lon) {
  const la = (lat * Math.PI) / 180,
    lo = (lon * Math.PI) / 180;
  return v3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}
export const latOf = (d) => (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI;

/**
 * The surface frame at a direction: `up` out of the ground, `east` and `north` along it. Near the poles
 * (where north is undefined) it falls back to a stable axis.
 */
export function frameAt(d) {
  const up = norm(d);
  const ref = Math.abs(up.y) > 0.995 ? v3(1, 0, 0) : v3(0, 1, 0);
  const east = norm(cross(ref, up));
  const north = cross(up, east);
  return { up, east, north };
}
/** The direction `x` units east and `z` units north of `d` (for laying out a city around its centre). */
export function offsetDir(d, x, z, f = frameAt(d)) {
  return norm(add(add(scale(f.up, R), f.east, x), f.north, z));
}
/** A tangent direction at `d` pointing toward `t` (the start of the great circle from d to t). */
export function towards(d, t) {
  const p = add(t, d, -dot(t, d));
  const l = len(p);
  if (l < 1e-9) return frameAt(d).north;
  return scale(p, 1 / l);
}
/** Move `dist` world units from `d` along the tangent `fwd`; returns the new direction and the carried-along heading. */
export function step(d, fwd, dist) {
  const a = dist / R;
  const nd = norm(add(scale(d, Math.cos(a)), fwd, Math.sin(a)));
  // Parallel transport: the heading turns with the surface.
  const nf = norm(add(scale(fwd, Math.cos(a)), d, -Math.sin(a)));
  return { d: nd, fwd: nf };
}
/** Rotate a tangent `fwd` at `d` by `rad` (left is positive). */
export function turn(d, fwd, rad) {
  const side = cross(d, fwd);
  return norm(add(scale(fwd, Math.cos(rad)), side, Math.sin(rad)));
}

/* ---- noise --------------------------------------------------------------------------------- */
/** Seeded 3D value noise with smooth interpolation, and fractal sums of it. */
export function makeNoise(seed = 1) {
  const s = (seed >>> 0) * 2654435761;
  const hash = (i, j, k) => {
    let h = (i * 374761393 + j * 668265263 + k * 1274126177 + s) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  function noise(x, y, z) {
    const i = Math.floor(x),
      j = Math.floor(y),
      k = Math.floor(z);
    const fx = fade(x - i),
      fy = fade(y - j),
      fz = fade(z - k);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(hash(i, j, k), hash(i + 1, j, k), fx), l(hash(i, j + 1, k), hash(i + 1, j + 1, k), fx), fy),
      l(l(hash(i, j, k + 1), hash(i + 1, j, k + 1), fx), l(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), fx), fy),
      fz,
    );
  }
  function fbm(x, y, z, octaves = 5) {
    let sum = 0,
      amp = 0.5,
      f = 1,
      norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 5.7) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

/* ---- icosphere ----------------------------------------------------------------------------- */
/**
 * A subdivided icosahedron on the unit sphere. `detail` 5 has 10 242 points, 6 has 40 962.
 * @returns {{ points:Float64Array, faces:Uint32Array, count:number }}
 */
export function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const pts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let lv = 0; lv < detail; lv++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = mid.get(key);
      if (m === undefined) {
        const p = pts[a],
          q = pts[b];
        const x = p[0] + q[0],
          y = p[1] + q[1],
          z = p[2] + q[2],
          l = Math.hypot(x, y, z);
        m = pts.push([x / l, y / l, z / l]) - 1;
        mid.set(key, m);
      }
      return m;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const points = new Float64Array(pts.length * 3);
  pts.forEach((p, i) => points.set(p, i * 3));
  return { points, faces: Uint32Array.from(faces.flat()), count: pts.length };
}

/* ---- the planet ---------------------------------------------------------------------------- */
export const BIOMES = ["deep", "sea", "shallows", "beach", "grass", "forest", "desert", "tundra", "rock", "snow"];
/**
 * Make the planet for a seed. `relief` scales the mountains (the homeworld's relief).
 * @param {number} seed
 * @param {{ relief?:number, landShare?:number }} [o]
 */
export function createPlanet(seed, o = {}) {
  // A world with only one continent would leave nothing overseas (no use for boats or aircraft, and no
  // far-off rivals): such a seed is nudged, the same way every time, until it makes at least two.
  let p = null;
  for (let k = 0; k < 10; k++) {
    p = buildPlanet((seed + k * 7919) >>> 0, o);
    if (p.nav.landC.sizes.filter((s) => s >= 150).length >= 2) break;
  }
  return { ...p, seed };
}
function buildPlanet(seed, o) {
  const relief = Math.max(0.6, Math.min(1.5, o.relief ?? 1));
  const { fbm } = makeNoise(seed);
  const cont = (d) => fbm(d.x * 1.25 + 3.1, d.y * 1.25 - 7.7, d.z * 1.25 + 1.9, 5);
  const ridgeN = (d) => 1 - Math.abs(fbm(d.x * 3.2 - 4.4, d.y * 3.2 + 2.2, d.z * 3.2 + 8.8, 4) * 2 - 1);
  const wetN = (d) => fbm(d.x * 2.1 + 11, d.y * 2.1 + 3, d.z * 2.1 - 6, 3);
  const detailN = (d) => fbm(d.x * 14, d.y * 14, d.z * 14, 2) - 0.5;
  // Sea level so that about a third of the surface is land.
  const nav = icosphere(5);
  const samples = [];
  for (let i = 0; i < nav.count; i += 3) samples.push(cont(v3(nav.points[i * 3], nav.points[i * 3 + 1], nav.points[i * 3 + 2])));
  samples.sort((a, b) => a - b);
  const seaLevel = samples[Math.floor(samples.length * (1 - (o.landShare ?? 0.36)))];

  /** Ground height before any flattening (0 = sea level). */
  function rawHeight(d) {
    const c = cont(d) - seaLevel;
    if (c < 0) return Math.max(-14, c * 60) + detailN(d) * 0.6;
    const inland = Math.min(1, Math.max(0, (c - 0.015) / 0.09));
    const ridge = ridgeN(d);
    return 0.4 + c * 26 + inland * inland * ridge ** 3 * 18 * relief + detailN(d) * 0.9 * (0.4 + inland);
  }
  /** Flat ground for city centres, blended into the land around them. */
  // Cities flatten a radius of 23 (civ/stage.js CITY_FLAT); the fully flat core is the inner 55%.
  const CORE = 23 * 0.55 + 1.5;
  const flats = [];
  function height(d) {
    let h = rawHeight(d);
    for (const f of flats) {
      const a = dot(d, f.d);
      if (a < f.cos) continue;
      const k = 1 - arc(d, f.d) / f.r;
      // The sea stays sea outside the city's core, so harbours stay open water.
      if (k < 0.45 && h < 0) continue;
      const s = k >= 0.45 ? 1 : (k / 0.45) ** 2 * (3 - 2 * (k / 0.45));
      h = h + (f.h - h) * s;
    }
    return h;
  }
  function flatten(d, radius) {
    const h = Math.max(1.4, Math.min(8, rawHeight(d)));
    flats.push({ d, r: radius, cos: Math.cos(radius / R), h });
    return h;
  }
  /** What grows (or doesn't) at a direction and height: by height, latitude and moisture. */
  function biome(d, h = height(d)) {
    if (h < -6) return "deep";
    if (h < -1.2) return "sea";
    if (h < 0.15) return "shallows";
    const lat = Math.abs(d.y);
    if (h > 18 * relief) return "snow";
    if (h > 12.5 * relief) return "rock";
    if (h < 1.0) return "beach";
    if (lat > 0.82) return "snow";
    if (lat > 0.66) return "tundra";
    const wet = wetN(d) + (0.5 - Math.abs(lat - 0.25)) * 0.2;
    if (wet < 0.44 && lat < 0.5) return "desert";
    if (wet > 0.55) return "forest";
    return "grass";
  }

  /* -- the navigation graph: the detail-5 icosphere's points and edges -- */
  const N = nav.count;
  const dirs = new Array(N);
  const hts = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dirs[i] = v3(nav.points[i * 3], nav.points[i * 3 + 1], nav.points[i * 3 + 2]);
    hts[i] = rawHeight(dirs[i]);
  }
  const nbSets = Array.from({ length: N }, () => new Set());
  for (let f = 0; f < nav.faces.length; f += 3) {
    const a = nav.faces[f],
      b = nav.faces[f + 1],
      c = nav.faces[f + 2];
    nbSets[a].add(b).add(c);
    nbSets[b].add(a).add(c);
    nbSets[c].add(a).add(b);
  }
  const nbs = nbSets.map((s) => [...s]);
  // Land: dry ground that isn't too steep a mountain. Sea: water deep enough to sail.
  const land = Uint8Array.from(hts, (h) => (h > 0.35 && h < 12 * relief ? 1 : 0));
  const sea = Uint8Array.from(hts, (h) => (h < -0.8 ? 1 : 0));
  const label = (mask) => {
    const comp = new Int32Array(N).fill(-1);
    const sizes = [];
    for (let i = 0; i < N; i++) {
      if (!mask[i] || comp[i] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [i];
      comp[i] = id;
      while (stack.length) {
        const u = stack.pop();
        size++;
        for (const w of nbs[u])
          if (mask[w] && comp[w] < 0) {
            comp[w] = id;
            stack.push(w);
          }
      }
      sizes.push(size);
    }
    return { comp, sizes };
  };
  const landC = label(land),
    seaC = label(sea);
  // Distance (in graph steps) from the sea, for land nodes: how far inland.
  const inland = new Int32Array(N).fill(-1);
  {
    const q = [];
    for (let i = 0; i < N; i++) if (!land[i]) (inland[i] = 0), q.push(i);
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const w of nbs[u])
        if (inland[w] < 0) {
          inland[w] = inland[u] + 1;
          q.push(w);
        }
    }
  }
  /** The nearest graph node to a direction, optionally only among nodes passing `ok`. */
  function nearestNode(d, ok = null) {
    let best = -1,
      bd = -2;
    for (let i = 0; i < N; i++) {
      if (ok && !ok(i)) continue;
      const k = dot(d, dirs[i]);
      if (k > bd) (bd = k), (best = i);
    }
    return best;
  }
  const passable = (mode, i) => (mode === "air" ? true : mode === "sea" ? !!sea[i] : !!land[i]);
  /** Which landmass or ocean a direction belongs to (for "can this vehicle get there"). */
  function region(mode, d) {
    if (mode === "air") return 0;
    const i = nearestNode(d, (k) => passable(mode, k));
    if (i < 0) return -1;
    return (mode === "sea" ? seaC : landC).comp[i];
  }
  /**
   * A route over the surface for a vehicle of a mode: a list of directions (graph points) from near
   * `a` to near `b`, or null if there is none (another continent, for a land vehicle). Air flies straight.
   */
  function route(mode, a, b) {
    if (mode === "air") return [b];
    const ok = (k) => passable(mode, k);
    const s = nearestNode(a, ok),
      t = nearestNode(b, ok);
    if (s < 0 || t < 0) return null;
    const comp = (mode === "sea" ? seaC : landC).comp;
    if (comp[s] !== comp[t]) return null;
    // A* with great-circle distance; land prefers gentle ground a little.
    const g = new Float64Array(N).fill(Infinity),
      from = new Int32Array(N).fill(-1),
      closed = new Uint8Array(N);
    const heap = [];
    const push = (i, f) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
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
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    g[s] = 0;
    push(s, arc(dirs[s], dirs[t]));
    while (heap.length) {
      const [, u] = pop();
      if (closed[u]) continue;
      if (u === t) break;
      closed[u] = 1;
      for (const w of nbs[u]) {
        if (!ok(w) || closed[w]) continue;
        const cost = arc(dirs[u], dirs[w]) * (mode === "land" ? 1 + Math.max(0, hts[w] - hts[u]) * 0.08 : 1);
        if (g[u] + cost < g[w]) {
          g[w] = g[u] + cost;
          from[w] = u;
          push(w, g[w] + arc(dirs[w], dirs[t]));
        }
      }
    }
    if (from[t] < 0 && s !== t) return null;
    const path = [];
    for (let u = t; u >= 0 && u !== s; u = from[u]) path.push(dirs[u]);
    path.reverse();
    // Drop points the vehicle can cut past (every other one on long straight runs).
    const out = path.filter((_, i) => i % 2 === 1 || i === path.length - 1);
    out.push(b);
    return out;
  }

  /* -- where things go -- */
  /**
   * The home continent's heart: the point of the largest landmass furthest from any coast. Your
   * village stood here, and your first city rises on the same spot.
   */
  function homeSite() {
    let big = 0;
    landC.sizes.forEach((s, i) => s > landC.sizes[big] && (big = i));
    let best = -1;
    for (let i = 0; i < N; i++) {
      if (landC.comp[i] !== big || hts[i] > 7 * relief) continue;
      // Not too close to the poles: a temperate home.
      const score = Math.min(inland[i], 9) - Math.max(0, Math.abs(dirs[i].y) - 0.55) * 30;
      if (best < 0 || score > best.score) best = { i, score };
    }
    return dirs[best.i];
  }
  /**
   * City sites: your capital first, then `nearby` more on the home continent (so land vehicles have
   * somewhere to go from the start), then the rest across the world. Every site is on land, apart
   * from the others, and knows whether it is on the coast (boats reach it) and where boats anchor.
   */
  function citySites(count = 11, nearby = 3, rand = mulberry(seed)) {
    const home = homeSite();
    const homeComp = landC.comp[nearestNode(home, (k) => land[k])];
    const sites = [home];
    const farEnough = (d, gap) => sites.every((s) => arc(s, d) >= gap);
    const candidates = [];
    for (let i = 0; i < N; i++) if (land[i] && hts[i] < 7 * relief && Math.abs(dirs[i].y) < 0.8 && inland[i] >= 1) candidates.push(i);
    const pick = (filter, gap) => {
      const pool = candidates.filter((i) => filter(i) && farEnough(dirs[i], gap));
      if (!pool.length) return false;
      sites.push(dirs[pool[Math.floor(rand() * pool.length)]]);
      return true;
    };
    for (let k = 0; k < nearby; k++) pick((i) => landC.comp[i] === homeComp && arc(dirs[i], home) < 150, 46) || pick((i) => landC.comp[i] === homeComp, 40);
    // The rest: other landmasses first (the larger ones), then anywhere far enough.
    const others = landC.sizes.map((s, id) => ({ s, id })).filter((c) => c.id !== homeComp && c.s >= 20).sort((a, b) => b.s - a.s);
    for (let k = 0; sites.length < count && k < count * 4; k++) {
      const c = others[k % Math.max(1, others.length)];
      if (!(c && pick((i) => landC.comp[i] === c.id, 52))) pick(() => true, 52) || pick(() => true, 34);
    }
    return sites.map((d, i) => describeSite(d, i === 0));
  }
  function describeSite(d, home) {
    const i = nearestNode(d, (k) => land[k]);
    // Boats anchor at the nearest open water within reach of the city.
    // (Outside the flat core a city stands on, which fills in any water: see height().)
    const s = nearestNode(d, (k) => sea[k] && seaC.sizes[seaC.comp[k]] > 40 && arc(dirs[k], d) > CORE);
    const coastal = s >= 0 && arc(dirs[s], d) < 40;
    return { d, home, landmass: landC.comp[i], coastal, anchor: coastal ? dirs[s] : null, ocean: coastal ? seaC.comp[s] : -1 };
  }
  /** Spice geysers: open land, away from cities and from each other. */
  function spiceSites(cities, count = 12, rand = mulberry(seed ^ 0x5eed)) {
    const out = [];
    for (let tries = 0; out.length < count && tries < 6000; tries++) {
      const i = Math.floor(rand() * N);
      if (!land[i] || hts[i] > 6 * relief || Math.abs(dirs[i].y) > 0.8) continue;
      const d = dirs[i];
      if (cities.some((c) => arc(c.d, d) < 26)) continue;
      // Near the cities is where the competition is: most geysers lie within reach of one.
      if (!cities.some((c) => arc(c.d, d) < 90) && rand() < 0.75) continue;
      if (out.some((g) => arc(g, d) < 30)) continue;
      out.push(d);
    }
    return out;
  }
  const isLand = (d) => height(d) > 0.15;

  return {
    R,
    seed,
    relief,
    seaLevel,
    rawHeight,
    height,
    flatten,
    biome,
    isLand,
    region,
    route,
    homeSite,
    citySites,
    spiceSites,
    nav: { count: N, dirs, land, sea, landC, seaC, nearestNode },
  };
}

/** A small seeded random stream. */
export function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A number from a string, for seeding the planet from a region or planet id. */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
