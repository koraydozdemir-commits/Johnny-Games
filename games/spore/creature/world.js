/**
 * The Creature Stage's regions (see regions.js). Each is a landmass ringed by shore: the coast's open
 * meadows, the forest's dense woods, the swamp's pools, the badlands' mesas, the volcanic highlands'
 * lava. One region is active at a time; heightAt, PEAKS and the rest describe the active one.
 * Props are instanced (a few draw calls for hundreds of trees and tufts), collisions use a coarse
 * grid plus the solid cores of mountains and lava, and a day/night cycle moves the sun.
 */
import * as THREE from "three";
import { makeRng } from "../cell-format.js";
import { REGIONS, regionById } from "./regions.js";
import { getHomeworld, themeRegion } from "../ecolib/homeworld.js";
import { populate, regionSeed as planetRegionSeed } from "../ecolib/ecosystem.js";
import { createLibrary } from "../ecolib/library.js";
import { createEcoInstancer } from "../ecolib/instancer.js";
import { mix as mixHex } from "../ecolib/color.js";

export const ISLAND = { shore: 205, size: 480, nest: { x: 0, z: 178 }, beach: 178 };
const TAU = Math.PI * 2;

/*
 * Mountains: overlapping peaks make ranges. A peak rises h metres over radius r: smooth hills
 * (gentle foothills, steep flanks, rounded top), flat-topped mesas, or a volcano with a crater.
 * Past SOLID_RISE metres it is a wall.
 */
const SOLID_RISE = 3.2;
const smooth = (k) => k * k * (3 - 2 * k);
const PROFILE = {
  smooth,
  mesa: (k) => smooth(Math.min(1, k / 0.3)),
  volcano: (k) => (k < 0.82 ? smooth(k) : smooth(0.82) - (k - 0.82) * 1.9),
};
/** The active region's settings, peaks and pools (live bindings: they change with the region). */
export let REGION = REGIONS[0];
/** What the most recently built world was made from (for tests and debugging): region, planet and its flora. */
let INFO = null;
export const worldInfo = () => INFO;
export let PEAKS = [];
/** Swamp pools (water) and lava pools: depressions; lava ones are also walls. */
export let POOLS = [];
let SOLIDS = [];

/** Make a region the active one: terrain, peaks and pools. createIsland calls this. */
export function setRegion(id) {
  // Every stage builds its land from here, so the homeworld's colours, sky, water and relief reach all of them.
  REGION = themeRegion(regionById(id), getHomeworld());
  PEAKS = REGION.peaks.map((p) => {
    const f = PROFILE[p.profile || REGION.profile || "smooth"];
    // Solve f(k) = SOLID_RISE / h for the solid core's radius (f rises monotonically to its top).
    const v = SOLID_RISE / p.h;
    let lo = 0,
      hi = 0.8;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < v) lo = mid;
      else hi = mid;
    }
    return { ...p, f, solid: p.r * (1 - lo) };
  });
  // Pools come from their own random stream, so the rest of the region generates the same way.
  const rng = makeRng(REGION.seed + 7);
  POOLS = [];
  const want = (REGION.pools || 0) + (REGION.lava || 0);
  for (let tries = 0; POOLS.length < want && tries < 4000; tries++) {
    const lava = POOLS.length >= (REGION.pools || 0);
    const a = rng() * TAU,
      d = 30 + Math.sqrt(rng()) * (ISLAND.beach - 45),
      r = lava ? 6 + rng() * 7 : 7 + rng() * 11;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    if (Math.hypot(x - ISLAND.nest.x, z - ISLAND.nest.z) < 40 + r) continue; // keep the arrival clear
    if (PEAKS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r)) continue;
    if (POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r + 8)) continue;
    POOLS.push({ x, z, r, kind: lava ? "lava" : "water", depth: lava ? 1.4 : 1.6 + rng() * 1.2 });
  }
  SOLIDS = [...PEAKS.map((p) => ({ x: p.x, z: p.z, solid: p.solid })), ...POOLS.filter((p) => p.kind === "lava").map((p) => ({ x: p.x, z: p.z, solid: p.r * 0.78 }))];
  return REGION;
}
setRegion("coast");

/** How far the mountains lift the ground here (0 on the plains). */
function mountainRise(x, z) {
  let best = 0;
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= p.r) continue;
    const k = 1 - d / p.r;
    // Craggy detail grows towards the top, so the foothills stay smooth and the walls stay put.
    const crag = (Math.sin(x * 0.31 + p.z) * Math.cos(z * 0.27 + p.x) + Math.sin((x - z) * 0.17) * 0.6) * 0.06 * p.h * k * k;
    best = Math.max(best, p.h * p.f(k) + crag);
  }
  return best;
}
/** How far pools sink the ground here. */
function poolDip(x, z) {
  let dip = 0;
  for (const p of POOLS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r) dip = Math.max(dip, (p.depth + 1.4) * smooth(1 - d / p.r));
  }
  return dip;
}
/** The pool at (x, z), if any. */
export function poolAt(x, z) {
  for (const p of POOLS) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  return null;
}

/** Distance from (x, z) to the nearest wall (mountain core or lava); negative inside one. */
export function mountainClear(x, z) {
  let best = Infinity;
  for (const p of SOLIDS) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.solid);
  return best;
}

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const noise = Math.sin(x * 0.045) * 1.6 + Math.cos(z * 0.05 + 1.3) * 1.3 + Math.sin((x + z) * 0.09) * 0.6 + Math.cos(x * 0.13 - z * 0.07) * 0.35;
  if (d > ISLAND.shore) return 1.2 - (d - ISLAND.shore) * 0.12 + noise * 0.2; // slopes into the sea
  const inland = 1 - d / ISLAND.shore;
  // Rolling ground: a rise inland (hilly in the forest, nearly flat in the swamp) and soft swells.
  return 1.2 + Math.pow(inland, 1.2) * REGION.hills + noise * (0.35 + inland * 0.5) * REGION.roughness + mountainRise(x, z) - (POOLS.length ? poolDip(x, z) : 0);
}

/** What kind of ground this is, for labels. */
const AREA_NAMES = {
  coast: ["Beach", "Plains", "Foothills", "Mountains"],
  forest: ["Shore", "Woods", "Hills", "Mountains"],
  swamp: ["Mudflats", "Marsh", "Rises", "Crags"],
  badlands: ["Red sands", "Canyons", "Scree", "Mesa"],
  volcanic: ["Black sands", "Ash fields", "Slopes", "Volcano"],
};
export function areaAt(x, z) {
  const names = AREA_NAMES[REGION.id] || AREA_NAMES.coast;
  if (Math.hypot(x, z) > ISLAND.beach - 4) return names[0];
  const pool = POOLS.length ? poolAt(x, z) : null;
  if (pool) return pool.kind === "lava" ? "Lava" : "Pools";
  const rise = mountainRise(x, z);
  return rise > SOLID_RISE ? names[3] : rise > 0.6 ? names[2] : names[1];
}

/** The ground colour at a spot, for the terrain and the maps. Writes into `c` and returns it. */
const COL = {};
export function groundColor(x, z, c) {
  const k = REGION.colors;
  const themed = REGION.id + (REGION.themeKey || "");
  if (COL.region !== themed) {
    COL.region = themed;
    for (const name of ["sand", "grassLight", "grassDark", "dirt", "rock", "cliff", "snow", "seabed"]) COL[name] = new THREE.Color(k[name]);
    COL.mud = new THREE.Color(0x4a4230);
    COL.ash = new THREE.Color(0x2a2522);
  }
  const band = (v, a, b) => THREE.MathUtils.smoothstep(v, a, b);
  const d = Math.hypot(x, z),
    rise = mountainRise(x, z);
  // Big soft patches of lighter and darker ground.
  const patch = 0.5 + 0.5 * Math.sin(x * 0.035 + Math.cos(z * 0.028) * 2) * Math.cos(z * 0.031 - x * 0.012);
  c.copy(COL.grassDark).lerp(COL.grassLight, patch);
  c.lerp(COL.dirt, band(rise, 0.6, 2.4) * 0.6);
  c.lerp(COL.rock, band(rise, 2, 5));
  c.lerp(COL.cliff, band(rise, 9, 16) * 0.7);
  c.lerp(COL.snow, band(rise, 21, 27));
  if (POOLS.length) {
    const p = poolAt(x, z);
    if (p) c.lerp(p.kind === "lava" ? COL.ash : COL.mud, smooth(Math.min(1, (1 - Math.hypot(x - p.x, z - p.z) / p.r) * 2.2)));
  }
  c.lerp(COL.sand, band(d, ISLAND.beach - 8, ISLAND.beach + 4));
  if (d > ISLAND.shore) c.copy(COL.seabed);
  return c;
}

function terrainMesh(segments) {
  const geo = new THREE.PlaneGeometry(ISLAND.size, ISLAND.size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position,
    colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(),
    t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    groundColor(x, z, c);
    const n = Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.05 + Math.sin(x * 0.31 + z * 0.27) * 0.04;
    t.copy(c).offsetHSL(0, 0, n);
    colors.set([t.r, t.g, t.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
}

/** Coarse grid of round obstacles for cheap collision tests. */
function obstacleGrid() {
  const cells = new Map(),
    size = 12;
  const key = (x, z) => Math.floor(x / size) + "," + Math.floor(z / size);
  const near = function* (x, z) {
    const cx = Math.floor(x / size),
      cz = Math.floor(z / size);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = cells.get(cx + i + "," + (cz + j));
        if (list) yield* list;
      }
  };
  return {
    add(o) {
      const k = key(o.x, o.z);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(o);
    },
    /** Push a circle (x, z, r) out of any obstacle it overlaps. Returns the corrected position. */
    resolve(x, z, r) {
      for (const o of near(x, z)) {
        const dx = x - o.x,
          dz = z - o.z,
          d = Math.hypot(dx, dz),
          min = o.r + r;
        if (d < min && d > 1e-4) {
          x = o.x + (dx / d) * min;
          z = o.z + (dz / d) * min;
        }
      }
      return { x, z };
    },
    /** True when nothing in the grid is within r of (x, z). */
    free(x, z, r) {
      for (const o of near(x, z)) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
      return true;
    },
  };
}

/**
 * Push a circle out of the mountains' solid cores. Peaks in a range overlap, so leaving one can mean
 * landing in the next: push out of the deepest overlap each time until clear.
 */
function resolveMountains(x, z, r) {
  for (let pass = 0; pass < 8; pass++) {
    let worst = null,
      depth = 0;
    for (const p of SOLIDS) {
      const over = p.solid + r - Math.hypot(x - p.x, z - p.z);
      if (over > depth) {
        depth = over;
        worst = p;
      }
    }
    if (!worst) break;
    const dx = x - worst.x,
      dz = z - worst.z,
      d = Math.hypot(dx, dz);
    // Out from the centre; from dead centre, out towards the shore side of the island.
    const ux = d > 1e-4 ? dx / d : worst.x / (Math.hypot(worst.x, worst.z) || 1),
      uz = d > 1e-4 ? dz / d : worst.z / (Math.hypot(worst.x, worst.z) || 1);
    x = worst.x + ux * (worst.solid + r + 1e-3);
    z = worst.z + uz * (worst.solid + r + 1e-3);
  }
  if (mountainClear(x, z) >= r) return { x, z };
  // Deep in the crook between two peaks: take the nearest clear spot round about (rare).
  for (let rad = 1; rad < 80; rad += 1.5)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU,
        cx = x + Math.cos(a) * rad,
        cz = z + Math.sin(a) * rad;
      if (mountainClear(cx, cz) >= r + 1e-3) return { x: cx, z: cz };
    }
  return { x, z };
}

/**
 * Turn a walking direction aside when a mountain wall lies just ahead, so creatures go round
 * ranges instead of grinding against them. Returns a unit direction.
 */
export function steerAround(x, z, dx, dz, r = 1, look = 9) {
  const len = Math.hypot(dx, dz) || 1;
  let ux = dx / len,
    uz = dz / len;
  let worst = null,
    worstT = Infinity;
  for (const p of SOLIDS) {
    const cx = p.x - x,
      cz = p.z - z;
    const along = cx * ux + cz * uz;
    if (along <= 0 || along > look + p.solid) continue;
    const side = cx * uz - cz * ux; // + : the peak is to the right of the path
    if (Math.abs(side) < p.solid + r + 1.5 && along < worstT) {
      worstT = along;
      worst = side;
    }
  }
  if (worst === null) return { x: ux, z: uz };
  // Swing along the wall, away from the side the peak is on.
  const s = worst >= 0 ? -1 : 1;
  const tx = -uz * s,
    tz = ux * s;
  const bx = ux * 0.35 + tx,
    bz = uz * 0.35 + tz,
    bl = Math.hypot(bx, bz);
  return { x: bx / bl, z: bz / bl };
}

export function createIsland(scene, quality = "medium", regionId = "coast") {
  setRegion(regionId);
  const rng = makeRng(REGION.seed);
  const look = REGION.colors;
  const group = new THREE.Group();
  scene.add(group);
  const terrain = terrainMesh(quality === "low" ? 110 : quality === "medium" ? 140 : 180);
  group.add(terrain);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(700, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: REGION.water ?? 0x2f8fc0, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 }));
  sea.position.y = 0.2;
  group.add(sea);

  const grid = obstacleGrid();
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3(),
    yAxis = new THREE.Vector3(0, 1, 0);
  const start = ISLAND.nest;
  const wet = (x, z, pad = 0) => POOLS.length > 0 && POOLS.some((pl) => Math.hypot(x - pl.x, z - pl.z) < pl.r + pad);
  const isOpen = (x, z, clear = 4, inland = ISLAND.beach - 2) => Math.hypot(x, z) < inland && mountainClear(x, z) > clear && grid.free(x, z, clear) && !wet(x, z, clear);
  /** A random open spot between minD and maxD from the centre, clear of the listed places. */
  const spot = (minD, maxD, clear = 3, away = [], gap = 0) => {
    for (let tries = 0; tries < 80; tries++) {
      const a = rng() * TAU,
        d = Math.sqrt(minD * minD + rng() * (maxD * maxD - minD * minD)); // even over the area
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (mountainClear(x, z) <= clear || !grid.free(x, z, clear) || wet(x, z, clear)) continue;
      if (away.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r ?? gap))) continue;
      return { x, z };
    }
    return null;
  };
  const scaleQ = quality === "low" ? 0.6 : quality === "medium" ? 0.8 : 1;
  const instanced = (geometry, material, list, place) => {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((o, i) => {
      place(o);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };

  /**
   * Trees by region: broadleaf (coast), broadleaf and conifers (forest), mangroves (swamp), cacti
   * (badlands), charred trunks (volcanic). Sets each tree's kind.
   */
  function plantTrees(list) {
    const kind = REGION.trees.kind;
    list.forEach((t, i) => (t.kind = kind === "forest" ? (i % 2 ? "conifer" : "broadleaf") : kind));
    const of = (k) => list.filter((t) => t.kind === k);
    const trunkMat = new THREE.MeshStandardMaterial({ color: look.trunk });
    const leafMat = new THREE.MeshStandardMaterial({ color: look.leaf, flatShading: true });
    const ground = (o) => heightAt(o.x, o.z) - 0.2;
    const broad = of("broadleaf");
    if (broad.length) {
      instanced(new THREE.CylinderGeometry(0.35, 0.55, 5, 7).translate(0, 2.5, 0), trunkMat, broad, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s);
      });
      instanced(new THREE.IcosahedronGeometry(2.8, 1), leafMat, broad, (o) => {
        p.set(o.x, heightAt(o.x, o.z) + 5.6 * o.s, o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.set(o.s, o.s * 0.85, o.s);
      });
    }
    const conifers = of("conifer");
    if (conifers.length) {
      instanced(new THREE.CylinderGeometry(0.3, 0.5, 7, 7).translate(0, 3.5, 0), trunkMat, conifers, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s * 1.1);
      });
      // Three stacked cones make a fir.
      const fir = mergeGeometries([0, 1, 2].map((k) => new THREE.ConeGeometry(2.6 - k * 0.65, 3.4, 8).translate(0, 3.4 + k * 2.2, 0)));
      instanced(fir, new THREE.MeshStandardMaterial({ color: new THREE.Color(look.leaf).offsetHSL(0.03, -0.05, -0.06), flatShading: true }), conifers, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s * 1.1);
      });
    }
    const mangroves = of("mangrove");
    if (mangroves.length) {
      // Splayed roots and a short trunk under a broad, low canopy.
      const roots = mergeGeometries([0, 1, 2, 3].map((k) => new THREE.CylinderGeometry(0.12, 0.22, 2.4, 5).translate(0, 1.0, 0).rotateZ(0.5).rotateY((k / 4) * TAU)).concat([new THREE.CylinderGeometry(0.35, 0.5, 3.6, 7).translate(0, 2.4, 0)]));
      instanced(roots, trunkMat, mangroves, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s);
      });
      instanced(new THREE.IcosahedronGeometry(2.6, 1), leafMat, mangroves, (o) => {
        p.set(o.x, heightAt(o.x, o.z) + 4.4 * o.s, o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.set(o.s * 1.45, o.s * 0.5, o.s * 1.45);
      });
    }
    const cacti = of("cactus");
    if (cacti.length) {
      const cactus = mergeGeometries([
        new THREE.CylinderGeometry(0.42, 0.48, 4.2, 9).translate(0, 2.1, 0),
        new THREE.CylinderGeometry(0.26, 0.28, 1.6, 8).translate(0, 0.8, 0).rotateZ(-0.0).translate(0.9, 2.0, 0),
        new THREE.CylinderGeometry(0.28, 0.28, 0.9, 8).rotateZ(Math.PI / 2).translate(0.55, 1.8, 0),
        new THREE.CylinderGeometry(0.24, 0.26, 1.3, 8).translate(-0.85, 2.9, 0),
        new THREE.CylinderGeometry(0.26, 0.26, 0.8, 8).rotateZ(Math.PI / 2).translate(-0.5, 2.5, 0),
      ]);
      instanced(cactus, new THREE.MeshStandardMaterial({ color: mixHex(0x5b8a46, look.leaf, 0.75), roughness: 0.8 }), cacti, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s * 0.9);
      });
    }
    const charred = of("charred");
    if (charred.length) {
      const snag = mergeGeometries([
        new THREE.CylinderGeometry(0.22, 0.5, 5.5, 6).translate(0, 2.75, 0),
        new THREE.CylinderGeometry(0.08, 0.16, 2, 5).translate(0, 1, 0).rotateZ(0.9).translate(0.2, 3.6, 0),
        new THREE.CylinderGeometry(0.07, 0.14, 1.6, 5).translate(0, 0.8, 0).rotateZ(-1).translate(-0.15, 4.2, 0),
      ]);
      instanced(snag, new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 1 }), charred, (o) => {
        p.set(o.x, ground(o), o.z);
        q.setFromAxisAngle(yAxis, o.r);
        s.setScalar(o.s);
      });
    }
  }

  /* Nest sites: twelve, spread out over the plains, listed nearest your nest first. */
  let nestSites = [];
  {
    let gap = 46;
    for (let tries = 0; nestSites.length < 12 && tries < 6000; tries++) {
      if (tries % 400 === 399) gap *= 0.95; // loosen up if the island is getting full
      const at = spot(28, ISLAND.beach - 10, 12, [{ ...start, r: 52 }, ...nestSites.map((n) => ({ ...n, r: gap }))]);
      if (at) nestSites.push(at);
    }
    nestSites = nestSites.map((n) => ({ ...n, d: Math.hypot(n.x - start.x, n.z - start.z) })).sort((a, b) => a.d - b.d);
    nestSites.forEach((n, i) => {
      n.rank = i;
      delete n.d;
    });
  }
  const keepClear = [{ ...start, r: 18 }, ...nestSites.map((n) => ({ ...n, r: 13 }))];

  /* Rock outcrops: clusters of tall, sheer stones. Nothing climbs them; you go round. */
  const stones = [];
  const outcrops = [];
  for (let i = 0; i < Math.round(REGION.outcrops * (0.7 + 0.3 * scaleQ)) && outcrops.length < REGION.outcrops; i++) {
    const c = spot(20, ISLAND.beach - 8, 7, [...keepClear.map((k) => ({ ...k, r: k.r + 6 })), ...outcrops.map((o) => ({ ...o, r: 26 }))]);
    if (!c) continue;
    outcrops.push(c);
    const count = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      const a = rng() * TAU,
        d = k === 0 ? 0 : 1.8 + rng() * 2.6;
      stones.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, s: (k === 0 ? 2.4 : 1.3) + rng() * 1.2, tall: 1.4 + rng() * 0.9, r: rng() * TAU, tilt: (rng() - 0.5) * 0.25 });
    }
  }
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  instanced(stoneGeo, new THREE.MeshStandardMaterial({ color: look.stone, flatShading: true, roughness: 0.95 }), stones, (o) => {
    p.set(o.x, heightAt(o.x, o.z) + o.s * o.tall * 0.55, o.z);
    q.setFromEuler(new THREE.Euler(o.tilt, o.r, -o.tilt * 0.6));
    s.set(o.s, o.s * o.tall, o.s * 0.9);
  });
  stones.forEach((o) => grid.add({ x: o.x, z: o.z, r: o.s * 0.95 }));

  // Loose boulders on the plains and scree at the mountains' feet.
  const boulders = [];
  for (let i = 0; i < Math.round(40 * scaleQ); i++) {
    const b = spot(15, ISLAND.beach - 4, 2, keepClear);
    if (b) boulders.push({ ...b, s: 0.5 + rng() * 0.8, r: rng() * TAU });
  }
  for (const pk of PEAKS)
    for (let k = 0; k < Math.round(6 * scaleQ); k++) {
      const a = rng() * TAU,
        d = pk.solid + 1.5 + rng() * 5;
      const x = pk.x + Math.cos(a) * d,
        z = pk.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < ISLAND.beach && mountainClear(x, z) > 1) boulders.push({ x, z, s: 0.7 + rng() * 1.1, r: rng() * TAU });
    }
  instanced(stoneGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(look.stone).offsetHSL(0, -0.03, 0.05), flatShading: true }), boulders, (o) => {
    p.set(o.x, heightAt(o.x, o.z) + o.s * 0.3, o.z);
    q.setFromEuler(new THREE.Euler(o.r, o.r * 2, 0));
    s.set(o.s, o.s * 0.7, o.s);
  });
  boulders.forEach((o) => grid.add({ x: o.x, z: o.z, r: o.s * 0.9 }));

  /* Trees: a few groves and lone trees. The plains stay open. */
  const trees = [];
  for (let g = 0; g < REGION.trees.groves; g++) {
    const c = spot(20, ISLAND.beach - 12, 6, keepClear);
    if (!c) continue;
    const count = Math.round((REGION.trees.perGrove + rng() * 4) * scaleQ) + 1;
    for (let k = 0; k < count; k++) {
      const a = rng() * TAU,
        d = rng() * 9;
      const x = c.x + Math.cos(a) * d,
        z = c.z + Math.sin(a) * d;
      if (isOpen(x, z, 1.5) && !keepClear.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) trees.push({ x, z, s: 0.8 + rng() * 0.6, r: rng() * TAU });
    }
  }
  for (let i = 0; i < Math.round(REGION.trees.lone * scaleQ); i++) {
    const t = spot(15, ISLAND.beach - 6, 3, keepClear);
    if (t) trees.push({ ...t, s: 0.9 + rng() * 0.6, r: rng() * TAU });
  }
  plantTrees(trees);
  trees.forEach((o) => grid.add({ x: o.x, z: o.z, r: (o.kind === "cactus" ? 0.6 : 0.8) * o.s }));

  // Beach palms (on the coast).
  const palms = [];
  for (let i = 0; REGION.palms && i < Math.round(45 * scaleQ); i++) {
    const a = rng() * TAU,
      d = ISLAND.beach + 2 + rng() * 18;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    if (Math.hypot(x - start.x, z - start.z) > 14 && mountainClear(x, z) > 2) palms.push({ x, z, s: 0.8 + rng() * 0.5, r: rng() * TAU });
  }
  instanced(new THREE.CylinderGeometry(0.22, 0.38, 6, 6).translate(0, 3, 0), new THREE.MeshStandardMaterial({ color: mixHex(0x9a7a52, look.trunk, 0.6) }), palms, (o) => {
    p.set(o.x, heightAt(o.x, o.z) - 0.2, o.z);
    q.setFromEuler(new THREE.Euler(0.12, o.r, 0.1));
    s.setScalar(o.s);
  });
  instanced(new THREE.ConeGeometry(2.6, 1.2, 7), new THREE.MeshStandardMaterial({ color: mixHex(0x4fa64a, look.leaf, 0.85), flatShading: true }), palms, (o) => {
    p.set(o.x + 0.4 * o.s, heightAt(o.x, o.z) + 6.1 * o.s, o.z);
    q.setFromAxisAngle(yAxis, o.r);
    s.set(o.s, o.s, o.s);
  });
  palms.forEach((o) => grid.add({ x: o.x, z: o.z, r: 0.5 * o.s }));

  /* Grass tufts: three blades each, scattered thick over the plains (no collisions). */
  {
    const blade = new THREE.ConeGeometry(0.09, 0.75, 3).translate(0, 0.37, 0);
    const parts = [0, 1, 2].map((k) => blade.clone().rotateZ((k - 1) * 0.35).rotateY(k * 2.1).translate((k - 1) * 0.12, 0, 0));
    const tuftGeo = mergeGeometries(parts);
    const tufts = [];
    const want = Math.round((quality === "low" ? 350 : quality === "medium" ? 800 : 1400) * REGION.tufts);
    for (let i = 0; tufts.length < want && i < want * 3; i++) {
      const a = rng() * TAU,
        d = Math.sqrt(rng()) * (ISLAND.beach - 6);
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (mountainRise(x, z) < 1.2 && !wet(x, z, -1.5)) tufts.push({ x, z, s: 0.7 + rng() * 0.8, r: rng() * TAU, shade: rng() });
    }
    const mesh = instanced(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), tufts, (o) => {
      p.set(o.x, heightAt(o.x, o.z) - 0.05, o.z);
      q.setFromAxisAngle(yAxis, o.r);
      s.set(o.s, o.s * (0.8 + o.shade * 0.5), o.s);
    });
    const col = new THREE.Color();
    // Each region's grass: lush green, olive marsh grass, dry red-brown scrub, grey ash.
    const tint = { coast: [0.26, 0.5, 0.36], forest: [0.3, 0.5, 0.3], swamp: [0.2, 0.42, 0.3], badlands: [0.08, 0.45, 0.42], volcanic: [0.07, 0.12, 0.3] }[REGION.id];
    // On a homeworld the grass takes the planet's foliage colour (keeping the region's small differences).
    const pv = REGION.homeworld?.vegetation;
    if (pv) {
      tint[0] = (((pv.hue + (tint[0] - 0.3) * 120) % 360) + 360) % 360 / 360;
      tint[1] = Math.min(0.85, tint[1] * (pv.sat / 0.45));
      tint[2] = Math.min(0.6, Math.max(0.08, tint[2] * (pv.light / 0.38)));
    }
    tufts.forEach((o, i) => mesh.setColorAt(i, col.setHSL(tint[0] + o.shade * 0.05, tint[1], tint[2] + o.shade * 0.12)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Fruit bushes: food for plant eaters. Fruit regrows.
  const bushes = [];
  for (let i = 0; i < Math.round(REGION.bushes * scaleQ); i++) {
    const b = spot(10, ISLAND.beach + 12, 2.5, [{ ...start, r: 6 }]);
    if (b) bushes.push(b);
  }
  // Two right next to your nest so the first meal is easy to find, and one or two by every nest.
  bushes.push({ x: start.x + 7, z: start.z - 5 }, { x: start.x - 8, z: start.z - 3 });
  for (const n of nestSites)
    for (let k = 0; k < 2; k++) {
      const a = rng() * TAU;
      const x = n.x + Math.cos(a) * (8 + rng() * 6),
        z = n.z + Math.sin(a) * (8 + rng() * 6);
      if (isOpen(x, z, 1.5, ISLAND.beach + 12)) bushes.push({ x, z });
    }
  instanced(new THREE.IcosahedronGeometry(1.2, 1), new THREE.MeshStandardMaterial({ color: look.bush, flatShading: true }), bushes, (o) => {
    p.set(o.x, heightAt(o.x, o.z) + 0.6, o.z);
    q.identity();
    s.set(1.2, 0.9, 1.2);
  });
  const fruits = [];
  bushes.forEach((b) => {
    for (let f = 0; f < 3; f++) {
      const a = (f / 3) * TAU + rng();
      const x = b.x + Math.cos(a) * 1.1,
        z = b.z + Math.sin(a) * 1.1;
      fruits.push({ x, z, y: heightAt(b.x, b.z) + 0.9 + rng() * 0.5, alive: true, regrow: 0 });
    }
  });
  // Fruit up in two trees of every three, as in Spore: knock it down (charge, bite or strike the
  // trunk) or be tall enough to reach it.
  const fruitTrees = trees.filter((t, i) => i % 3 !== 2 && (t.kind === "broadleaf" || t.kind === "mangrove"));
  fruitTrees.forEach((t) => {
    const ground = heightAt(t.x, t.z);
    for (let f = 0; f < 3; f++) {
      const a = t.r + (f / 3) * TAU;
      const reachOut = t.kind === "mangrove" ? 3.2 : 2.5;
      const x = t.x + Math.cos(a) * reachOut * t.s,
        z = t.z + Math.sin(a) * reachOut * t.s;
      const hangY = ground + (t.kind === "mangrove" ? 3.6 : 4.6) * t.s;
      fruits.push({ x, z, y: hangY, alive: true, regrow: 0, tree: t, hangY, groundY: heightAt(x, z) + 0.32, hanging: true, vy: 0, rot: 0 });
    }
  });
  /* Water and lava. Swamp pools are murky; lava glows and pulses (and is a wall). */
  const pulsing = [];
  for (const pl of POOLS) {
    const lava = pl.kind === "lava";
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(pl.r * (lava ? 0.86 : 0.98), 28).rotateX(-Math.PI / 2),
      lava ? new THREE.MeshBasicMaterial({ color: 0xff6a1a, fog: true }) : new THREE.MeshStandardMaterial({ color: mixHex(0x4f6142, REGION.water ?? 0x4f6142, 0.5), transparent: true, opacity: 0.86, roughness: 0.2 }),
    );
    disc.position.set(pl.x, lava ? 0.45 : 0.26, pl.z);
    group.add(disc);
    if (lava) pulsing.push(disc);
  }
  for (const pk of PEAKS)
    if (pk.profile === "volcano") {
      // The crater glows.
      const glow = new THREE.Mesh(new THREE.CircleGeometry(pk.r * 0.16, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a24 }));
      glow.position.set(pk.x, heightAt(pk.x, pk.z) + 0.3, pk.z);
      group.add(glow);
      pulsing.push(glow);
    }
  // Reeds round the swamp's pools and along its shore.
  if (REGION.reeds) {
    const reeds = [];
    const rr = makeRng(REGION.seed + 11);
    for (const pl of POOLS)
      for (let k = 0; k < Math.round(pl.r * 2.2 * scaleQ); k++) {
        const a = rr() * TAU,
          d = pl.r * (0.75 + rr() * 0.4);
        reeds.push({ x: pl.x + Math.cos(a) * d, z: pl.z + Math.sin(a) * d, s: 0.8 + rr() * 0.7, r: rr() * TAU });
      }
    const reed = mergeGeometries([0, 1, 2, 3].map((k) => new THREE.CylinderGeometry(0.03, 0.05, 2.2, 4).translate(0, 1.1, 0).rotateZ((k - 1.5) * 0.12).translate((k - 1.5) * 0.15, 0, 0)));
    instanced(reed, new THREE.MeshStandardMaterial({ color: mixHex(0x8a9a4a, look.leaf, 0.6) }), reeds, (o) => {
      p.set(o.x, Math.max(0.2, heightAt(o.x, o.z)) - 0.1, o.z);
      q.setFromAxisAngle(yAxis, o.r);
      s.setScalar(o.s);
    });
  }
  const fruitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshStandardMaterial({ color: look.fruit, roughness: 0.35, emissive: new THREE.Color(look.fruit).multiplyScalar(0.22) }), fruits.length);
  group.add(fruitMesh);
  const syncFruit = () => {
    fruits.forEach((f, i) => {
      const sc = f.alive ? 1 : 0.0001;
      m.compose(p.set(f.x, f.y, f.z), q.identity(), s.set(sc, sc, sc));
      fruitMesh.setMatrixAt(i, m);
    });
    fruitMesh.instanceMatrix.needsUpdate = true;
  };
  syncFruit();

  /* Nest visuals: a twig ring with eggs. */
  const nestGeo = new THREE.TorusGeometry(2.4, 0.45, 6, 18).rotateX(Math.PI / 2);
  const nestMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
  const eggGeo = new THREE.SphereGeometry(0.45, 10, 8).scale(1, 1.25, 1);
  const makeNestMesh = (x, z, eggColor) => {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z) + 0.2, z);
    g.add(new THREE.Mesh(nestGeo, nestMat));
    const eggMat = new THREE.MeshStandardMaterial({ color: eggColor, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const e = new THREE.Mesh(eggGeo, eggMat);
      e.position.set(Math.cos(i * 2.1) * 0.7, 0.4, Math.sin(i * 2.1) * 0.7);
      g.add(e);
    }
    group.add(g);
    return g;
  };

  /* Fossils: half-buried skeletons in sandy mounds. Stand on one to dig up a creature part. */
  const bonePiles = [];
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xefe3c4, roughness: 0.7 });
  const moundMat = new THREE.MeshStandardMaterial({ color: 0xc9b07c, roughness: 1, flatShading: true });
  const dugMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffe69a, transparent: true, opacity: 0.85 });
  const moundGeo = new THREE.IcosahedronGeometry(1.6, 1).scale(1.3, 0.38, 1.1);
  const ribGeo = new THREE.TorusGeometry(0.55, 0.06, 6, 14, Math.PI);
  const spineGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 8).rotateZ(Math.PI / 2);
  const skullGeo = new THREE.SphereGeometry(0.42, 14, 10).scale(1.25, 0.85, 0.9);
  const socketGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const glintGeo = new THREE.OctahedronGeometry(0.22, 0);
  const holeGeo = new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2);
  const boneSpots = [];
  for (let i = 0; i < 16; i++) {
    const b = spot(15, ISLAND.beach - 4, 3, [...keepClear, ...boneSpots.map((o) => ({ ...o, r: 22 }))]);
    if (b) boneSpots.push(b);
  }
  // Two or three more near every nest and around your own, so there is always one close by.
  [start, ...nestSites].forEach((site) => {
    const count = 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < count; k++)
      for (let tries = 0; tries < 30; tries++) {
        const a = rng() * TAU,
          d = 11 + rng() * 13;
        const x = site.x + Math.cos(a) * d,
          z = site.z + Math.sin(a) * d;
        if (isOpen(x, z, 2.5, ISLAND.shore - 8) && boneSpots.every((b) => Math.hypot(b.x - x, b.z - z) > 7)) {
          boneSpots.push({ x, z });
          break;
        }
      }
  });
  boneSpots.forEach((b, i) => {
    const g = new THREE.Group();
    g.position.set(b.x, heightAt(b.x, b.z), b.z);
    g.rotation.y = rng() * TAU;
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.position.y = 0.05;
    g.add(mound);
    // The skeleton pokes out of the sand: a row of ribs, a spine and a skull.
    const bones = new THREE.Group();
    const spineMesh = new THREE.Mesh(spineGeo, boneMat);
    spineMesh.position.set(0, 0.45, 0);
    bones.add(spineMesh);
    for (let k = 0; k < 4; k++) {
      const rib = new THREE.Mesh(ribGeo, boneMat);
      rib.position.set(-0.6 + k * 0.38, 0.1, 0);
      rib.rotation.y = Math.PI / 2;
      rib.scale.setScalar(1 - Math.abs(k - 1.5) * 0.15);
      bones.add(rib);
    }
    const skull = new THREE.Mesh(skullGeo, boneMat);
    skull.position.set(1.25, 0.3, 0);
    skull.rotation.z = -0.3 + (i % 3) * 0.15;
    bones.add(skull);
    for (const z of [-0.16, 0.16]) {
      const eye = new THREE.Mesh(socketGeo, dugMat);
      eye.position.set(1.55, 0.42, z);
      bones.add(eye);
    }
    g.add(bones);
    // A slow golden glint marks an undug fossil from a distance.
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.y = 2.3;
    g.add(glint);
    const hole = new THREE.Mesh(holeGeo, dugMat);
    hole.position.y = 0.06;
    hole.visible = false;
    g.add(hole);
    group.add(g);
    bonePiles.push({ x: b.x, z: b.z, mesh: g, mound, bones, glint, hole, taken: false, dig: 0 });
  });
  /** Mark a fossil as dug: the mound is gone, a dark hole is left. */
  const markDug = (b) => {
    b.taken = true;
    b.mound.visible = false;
    b.bones.visible = false;
    b.glint.visible = false;
    b.hole.visible = true;
  };

  /* The homeworld's own flora and rocks, from the shared library (see ecolib/): varied species laid out by
     biome, tinted to the planet's foliage and stone, instanced and level-of-detail managed. */
  let scenery = null,
    sceneryLibrary = null,
    sceneryFacts = null;
  const hw = REGION.homeworld;
  if (hw && hw.plantDensity > 0) {
    sceneryLibrary = createLibrary();
    // Draw distance follows the region's own fog, and detail steps down early: draw calls matter on tablets.
    scenery = createEcoInstancer(group, sceneryLibrary, { lodNear: 30, lodFar: 75, cullDistance: Math.min(260, REGION.fog[1] + 10) });
    const v = hw.vegetation;
    const palette = { hue: v.hue, sat: Math.min(1.6, Math.max(0.3, v.sat / 0.45)), light: Math.min(1.5, Math.max(0.4, v.light / 0.38)) };
    const stone = mixHex(0xffffff, hw.terrain.mineralColor, 0.5);
    const wanted = quality === "low" ? 450 : quality === "medium" ? 800 : 1300;
    const grown = populate(hw, planetRegionSeed(hw, REGION.id), {
      radius: ISLAND.beach - 6,
      count: wanted,
      speciesCap: quality === "low" ? 26 : quality === "medium" ? 38 : 50,
      maxVariants: 2,
      isOpen: (x, z) => isOpen(x, z, 1.2),
      avoid: keepClear.map((k) => ({ ...k, r: k.r + 2 })),
    });
    const list = [];
    for (const p of grown.placements) {
      const isRock = ["rocks", "decor"].includes(p.layer);
      const y = heightAt(p.x, p.z) - (p.layer === "rocks" ? p.size * 0.06 : 0);
      list.push({ ...p, y, palette, tint: isRock ? stone : undefined });
      // Trunks and big stones are solid: the creatures steer around them.
      if (p.layer === "trees" || p.layer === "smallTrees") grid.add({ x: p.x, z: p.z, r: Math.min(1.6, Math.max(0.35, p.size * 0.03)) });
      else if (p.layer === "rocks" && p.size > 2.2) grid.add({ x: p.x, z: p.z, r: p.size * 0.3 });
    }
    scenery.set(list);
    scenery.updateFocus(start.x, start.z, { force: true });
    let h = 2166136261;
    for (const p of list) h = Math.imul(h ^ (Math.round(p.x * 10) + Math.round(p.z * 10) * 7 + p.id.length * 131), 16777619);
    sceneryFacts = { placements: list.length, species: new Set(list.map((p) => p.id)).size, hash: h >>> 0 };
  }
  INFO = { regionId: REGION.id, planetId: hw?.planetId ?? null, themeKey: REGION.themeKey ?? null, leaf: REGION.colors.leaf, grass: REGION.colors.grassLight, skyDay: REGION.sky.day, water: REGION.water ?? null, scenery: sceneryFacts };

  /* Lighting and day/night. */
  const lit = REGION.light; // the homeworld's star and sky, when there is one
  const hemi = new THREE.HemisphereLight(lit?.hemi ?? 0xdff4ff, lit?.ground ?? 0x6b5a3a, 1.05);
  const sun = new THREE.DirectionalLight(lit?.sun ?? 0xfff1d6, 1.6);
  const sunK = lit?.sunIntensity ?? 1;
  const hemiDay = new THREE.Color(lit?.hemi ?? 0xdff4ff),
    hemiNight = new THREE.Color(0x6f86c8),
    sunDay = new THREE.Color(lit?.sun ?? 0xfff1d6),
    sunNight = new THREE.Color(0x9fb4ff);
  scene.add(hemi, sun);
  const skyDay = new THREE.Color(REGION.sky.day),
    skyDusk = new THREE.Color(REGION.sky.dusk),
    skyNight = new THREE.Color(REGION.sky.night);
  scene.background = skyDay.clone();
  // Open regions see far (spot the mountains and the next nest); the forest and swamp close in.
  scene.fog = new THREE.Fog(skyDay.clone(), REGION.fog[0], REGION.fog[1]);
  const DAY_LENGTH = lit?.dayLength ?? 300; // seconds for a full day
  let clock = DAY_LENGTH * 0.3;

  const resolve = (x, z, r) => {
    const a = grid.resolve(x, z, r);
    return resolveMountains(a.x, a.z, r);
  };

  // Where you arrive (the south shore) and where a migration leaves for the next region (the far north).
  const exitSpot = (() => {
    let best = null;
    for (let rad = 0; rad < 60 && !best; rad += 3)
      for (let k = 0; k < 16 && !best; k++) {
        const x = Math.cos((k / 16) * TAU) * rad,
          z = -ISLAND.beach + 14 + Math.sin((k / 16) * TAU) * rad;
        if (isOpen(x, z, 6, ISLAND.beach + 4)) best = { x, z };
      }
    return best || { x: 0, z: -ISLAND.beach + 14 };
  })();
  return {
    region: REGION,
    exitSpot,
    group,
    fruits,
    nestSites,
    bonePiles,
    markDug,
    makeNestMesh,
    resolve,
    /** True when (x, z) is open plains: inland, off the mountains and clear of rocks and trees. */
    isOpen,
    /**
     * Knock the fruit out of any fruit tree whose trunk is within reach of (x, z).
     * @returns {{x:number,z:number}|null} the tree that was hit, if any fruit fell
     */
    shakeTree(x, z, reach) {
      let hit = null;
      for (const f of fruits) {
        if (!f.tree || !f.hanging || !f.alive) continue;
        if (Math.hypot(f.tree.x - x, f.tree.z - z) > reach + 0.8 * f.tree.s) continue;
        f.hanging = false;
        f.vy = -0.5 - Math.random();
        f.rot = 90;
        hit = f.tree;
      }
      return hit;
    },
    /** The nearest tree with fruit still up in it, within range. */
    fruitTreeNear(x, z, range) {
      for (const f of fruits) if (f.tree && f.hanging && f.alive && Math.hypot(f.tree.x - x, f.tree.z - z) < range) return f.tree;
      return null;
    },
    syncFruit,
    /** 0..1 through the day; night when > 0.62. */
    get timeOfDay() {
      return (clock % DAY_LENGTH) / DAY_LENGTH;
    },
    /** Jump the clock to a point in the day (0..1), e.g. after sleeping through the night. */
    setTimeOfDay(t) {
      clock = Math.floor(clock / DAY_LENGTH) * DAY_LENGTH + ((t % 1) + 1) % 1 * DAY_LENGTH;
    },
    get isNight() {
      const t = (clock % DAY_LENGTH) / DAY_LENGTH;
      return t > 0.62 && t < 0.97;
    },
    update(dt, focus) {
      clock += dt;
      scenery?.updateFocus(focus.x, focus.z);
      const t = (clock % DAY_LENGTH) / DAY_LENGTH; // 0 dawn, 0.25 noon, 0.62 dusk, 0.8 midnight
      const sunHeight = Math.sin(t * TAU * 0.8 + 0.1);
      const daylight = THREE.MathUtils.clamp(sunHeight * 1.6 + 0.2, 0.08, 1);
      sun.position.set(focus.x + Math.cos(t * TAU) * 60, Math.max(8, sunHeight * 80), focus.z + 30);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.target.updateMatrixWorld();
      // Night is properly dark and moonlit blue; day is warm.
      sun.intensity = (0.1 + daylight * 1.55) * sunK;
      hemi.intensity = 0.24 + daylight * 0.86;
      const moon = 1 - THREE.MathUtils.smoothstep(daylight, 0.15, 0.6);
      hemi.color.copy(hemiDay).lerp(hemiNight, moon);
      sun.color.copy(sunDay).lerp(sunNight, moon);
      const sky = scene.background;
      if (daylight > 0.6) sky.copy(skyDay);
      else if (daylight > 0.25) sky.copy(skyDusk).lerp(skyDay, (daylight - 0.25) / 0.35);
      else sky.copy(skyNight).lerp(skyDusk, daylight / 0.25);
      scene.fog.color.copy(sky);
      let moved = false;
      fruits.forEach((f) => {
        if (!f.alive) {
          if ((f.regrow -= dt) <= 0) {
            moved = f.alive = true;
            if (f.tree) Object.assign(f, { y: f.hangY, hanging: true, vy: 0 }); // grows back up in the tree
          }
          return;
        }
        if (f.vy) {
          // Falling: drops, bounces once and settles.
          f.vy -= 20 * dt;
          f.y += f.vy * dt;
          if (f.y <= f.groundY) {
            f.y = f.groundY;
            f.vy = f.vy < -4 ? -f.vy * 0.3 : 0;
          }
          moved = true;
        } else if (f.tree && !f.hanging && (f.rot -= dt) <= 0) {
          // Fallen fruit nobody ate rots away and grows back in the tree.
          f.alive = false;
          f.regrow = 20;
          moved = true;
        }
      });
      if (moved) syncFruit();
      pulsing.forEach((m, i) => m.material.color.setHSL(0.05 + 0.015 * Math.sin(clock * 1.7 + i), 1, 0.5 + 0.06 * Math.sin(clock * 2.3 + i * 1.3)));
      bonePiles.forEach((b) => {
        if (b.taken) return;
        b.glint.rotation.y += dt * 1.6;
        b.glint.position.y = 2.3 + Math.sin(clock * 2 + b.x) * 0.2;
        b.glint.scale.setScalar(0.8 + 0.25 * Math.sin(clock * 3.1 + b.z));
      });
    },
    dispose() {
      scenery?.dispose();
      sceneryLibrary?.clear();
      scene.remove(group, hemi, sun);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
      scene.fog = null;
    },
  };
}

/** Join non-indexed-compatible geometries into one (position + normal only). */
function mergeGeometries(list) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = flat.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3),
    nor = new Float32Array(count * 3);
  let at = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, at * 3);
    nor.set(g.attributes.normal.array, at * 3);
    at += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}
