/**
 * Cities, roads and spice vents on the planet's surface.
 *
 * A city is drawn in layers so that distance can drop the expensive ones: the "always" layer (a levelled
 * pad, the territory ring and its owner's colour) is a handful of cheap meshes; the "detail" layer (the
 * player's designed buildings, a culture's houses, roads, decorations) is only shown when the camera is
 * near; and between them a "proxy" (one tall marker in the owner's colour) stands in at middle distance.
 * Houses and decorations are kits of primitives merged to one geometry per variant and drawn with one
 * instanced mesh each, so a city of thirty buildings is a handful of draw calls.
 *
 * Everything conforms to the planet: flat shapes are built from points sampled on the terrain, and models
 * stand on the local frame (see planet-render.js placeOnPlanet).
 */
import * as THREE from "three";
import { mergePieces } from "../gfx/geom-utils.js";
import { DECOR_PRIMS, kitFor, layoutCity, CITY } from "./culture.js";
import { placeOnPlanet, worldAt, frameQuat } from "./planet-render.js";

const TAU = Math.PI * 2;
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();

/* --------------------------------------------------------------------- conforming flat shapes */
/** Ground height at a map point, never below the waterline (cities stand on land). */
const ground = (map, x, z) => Math.max(0.05, map.heightAt(x, z));

function toBuffer(positions, normals, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  g.setIndex(Array.isArray(indices) ? indices : new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}
/** A filled disc lying on the ground: concentric rings of terrain samples. */
export function groundDisc(map, cx, cz, radius, lift = 0.2, segments = 36, rings = 3) {
  const pos = [],
    nor = [],
    idx = [];
  const push = (x, z) => {
    worldAt(map, x, z, ground(map, x, z) + lift, _w);
    pos.push(_w.x, _w.y, _w.z);
    _n.copy(_w).normalize();
    nor.push(_n.x, _n.y, _n.z);
  };
  push(cx, cz);
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segments; s++) push(cx + Math.cos((s / segments) * TAU) * radius * (r / rings), cz + Math.sin((s / segments) * TAU) * radius * (r / rings));
  for (let s = 0; s < segments; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segments));
  for (let r = 1; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = 1 + (r - 1) * segments + s,
        b = 1 + (r - 1) * segments + ((s + 1) % segments),
        c = a + segments,
        d = b + segments;
      idx.push(a, c, b, b, c, d);
    }
  return toBuffer(pos, nor, idx);
}
/** A ribbon of the given width following a path of map points (closed for a ring). */
export function groundRibbon(map, pts, width, lift = 0.25, closed = false) {
  const pos = [],
    nor = [],
    idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)],
      b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0],
      dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    for (const side of [-1, 1]) {
      const x = pts[i][0] - dz * side * width * 0.5,
        z = pts[i][1] + dx * side * width * 0.5;
      worldAt(map, x, z, ground(map, x, z) + lift, _w);
      pos.push(_w.x, _w.y, _w.z);
      _n.copy(_w).normalize();
      nor.push(_n.x, _n.y, _n.z);
    }
  }
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = i * 2,
      b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  return toBuffer(pos, nor, idx);
}
/** Several ribbons merged into one geometry. */
function mergeBuffers(list) {
  const clean = list.filter(Boolean);
  if (!clean.length) return null;
  let pc = 0,
    ic = 0;
  for (const g of clean) {
    pc += g.attributes.position.count;
    ic += g.index.count;
  }
  const pos = new Float32Array(pc * 3),
    nor = new Float32Array(pc * 3),
    idx = new Uint32Array(ic);
  let po = 0,
    io = 0;
  for (const g of clean) {
    pos.set(g.attributes.position.array, po * 3);
    nor.set(g.attributes.normal.array, po * 3);
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + po;
    po += g.attributes.position.count;
    io += g.index.count;
    g.dispose();
  }
  return toBuffer(pos, nor, idx);
}

/* ---------------------------------------------------------------------------------- kits */
const slotColor = (palette, slot) => palette[slot] ?? palette.wall;
function primitiveGeometry([shape, w, h, d, x, y, z, , seg]) {
  let g;
  switch (shape) {
    case "box":
      g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
      break;
    case "cyl":
      g = new THREE.CylinderGeometry(w / 2, w / 2, h, seg || 10).translate(0, h / 2, 0);
      break;
    case "cone":
      g = new THREE.ConeGeometry(w / 2, h, seg || 10).translate(0, h / 2, 0);
      if (seg === 4) g.rotateY(Math.PI / 4);
      break;
    case "sphere":
      g = new THREE.SphereGeometry(0.5, seg || 10, Math.max(6, Math.round((seg || 10) * 0.7))).scale(w, h, d).translate(0, h / 2, 0);
      break;
    case "dome":
      g = new THREE.SphereGeometry(0.5, seg || 12, 6, 0, TAU, 0, Math.PI / 2).scale(w, h * 2, d);
      break;
    default:
      g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  }
  return g.translate(x, y, z);
}
/** Merge a kit's primitives into one vertex-coloured geometry in a culture's palette. */
export function kitGeometry(prims, palette) {
  return mergePieces(prims.map((p) => ({ geometry: primitiveGeometry(p), color: slotColor(palette, p[7]) })));
}

/* ------------------------------------------------------------------------------- city art */
/**
 * @param {THREE.Scene} scene
 * @param {object} map
 * @param {{ quality?: string }} [o]
 */
export function createCityArt(scene, map, { quality = "medium" } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, flatShading: true });
  const plainMat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  const roadMat = plainMat(0x6f685c, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const plazaMat = plainMat(0xcfc4a8, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const kitCache = new Map();
  const ownMaterials = [];
  const geometries = [];
  const kitFor3d = (culture) => {
    const key = culture.key + ":" + culture.style + ":" + culture.palette.wall + ":" + culture.palette.accent;
    let k = kitCache.get(key);
    if (!k) {
      const kit = kitFor(culture.style);
      k = { houses: kit.houses.map((h) => kitGeometry(h, culture.palette)), crown: kitGeometry(kit.crown, culture.palette), decor: {} };
      for (const id of new Set(kit.decor)) k.decor[id] = kitGeometry(DECOR_PRIMS[id], culture.palette);
      geometries.push(...k.houses, k.crown, ...Object.values(k.decor));
      kitCache.set(key, k);
    }
    return k;
  };

  const q = new THREE.Quaternion(),
    yq = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0),
    mat4 = new THREE.Matrix4(),
    sc = new THREE.Vector3(),
    tint = new THREE.Color();

  /** Stand instances on the ground and fill an InstancedMesh. */
  function instancedAt(geometry, list, heightOf = null) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
    list.forEach((p, i) => {
      const gh = ground(map, p.x, p.z);
      worldAt(map, p.x, p.z, gh + (heightOf ? heightOf(p) : 0), _w);
      frameQuat(map, p.x, p.z, q);
      yq.setFromAxisAngle(up, p.yaw || 0);
      q.multiply(yq);
      mat4.compose(_w, q, sc.setScalar(p.scale ?? 1));
      mesh.setMatrixAt(i, mat4);
      tint.setScalar(p.tint ?? 1);
      mesh.setColorAt(i, tint);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Build a city's scenery (everything but the designed buildings, which the stage adds to `view.detail`).
   * @param {object} city  { id, x, z, name, pop, plots, turrets }
   * @param {{ culture:object, ownerColor:number, spots:object, pop:number }} o
   * @returns {{ detail:THREE.Group, always:THREE.Group, proxy:THREE.Group, layout:object, crownAt:(h:number)=>void, dispose:()=>void }}
   */
  function build(city, { culture, ownerColor, spots, pop }) {
    const always = new THREE.Group(),
      detail = new THREE.Group(),
      proxy = new THREE.Group();
    always.name = "cityAlways";
    detail.name = "cityDetail";
    proxy.name = "cityProxy";
    const own = [];
    const mats = [];
    const addMesh = (parent, geo, mat, order = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = order;
      parent.add(m);
      own.push(geo);
      return m;
    };
    const ownerMat = plainMat(ownerColor, { emissive: ownerColor, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    mats.push(ownerMat);
    // Always: territory disc and a bright boundary ring in the owner's colour.
    const territory = plainMat(ownerColor, { transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mats.push(territory);
    addMesh(always, groundDisc(map, city.x, city.z, CITY.plaza + 17, 0.35, 40, 3), territory, 1);
    const boundary = [];
    for (let i = 0; i < 64; i++) boundary.push([city.x + Math.cos((i / 64) * TAU) * (CITY.plaza + 17), city.z + Math.sin((i / 64) * TAU) * (CITY.plaza + 17)]);
    addMesh(always, groundRibbon(map, boundary, 1.3, 0.45, true), ownerMat, 2);

    // Detail: plaza, wall ring, roads, houses, decorations.
    addMesh(detail, groundDisc(map, city.x, city.z, CITY.plaza, 0.12, 40, 3), plazaMat);
    const wall = [];
    for (let i = 0; i < 64; i++) wall.push([city.x + Math.cos((i / 64) * TAU) * CITY.plaza, city.z + Math.sin((i / 64) * TAU) * CITY.plaza]);
    addMesh(detail, groundRibbon(map, wall, 1.0, 0.5, true), ownerMat, 2);
    const layout = layoutCity({ id: city.id, name: city.name, pop }, spots, culture);
    const roads = layout.roads.map((r) => groundRibbon(map, r.pts.map(([x, z]) => [city.x + x, city.z + z]), r.width, 0.22, !!r.ring && false));
    const merged = mergeBuffers(roads);
    if (merged) addMesh(detail, merged, roadMat);
    const kits = kitFor3d(culture);
    const houses = layout.houses.map((h) => ({ x: city.x + h.x, z: city.z + h.z, yaw: h.yaw, scale: h.scale, tint: h.tint, variant: h.variant }));
    kits.houses.forEach((geo, v) => {
      const list = houses.filter((h) => h.variant === v);
      if (list.length) detail.add(instancedAt(geo, list));
    });
    const decorByKind = new Map();
    for (const d of layout.decor) {
      if (!decorByKind.has(d.kind)) decorByKind.set(d.kind, []);
      decorByKind.get(d.kind).push({ x: city.x + d.x, z: city.z + d.z, yaw: d.yaw, scale: culture.scale });
    }
    for (const [kind, list] of decorByKind) if (kits.decor[kind]) detail.add(instancedAt(kits.decor[kind], list));

    // Proxy: a pillar in the owner's colour, visible from afar, with the culture's crown on top.
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.4, 11, 8).translate(0, 5.5, 0), ownerMat);
    own.push(pillar.geometry);
    placeOnPlanet(map, pillar, city.x, city.z, ground(map, city.x, city.z));
    proxy.add(pillar);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8).translate(0, 12, 0), plainMat(culture.palette.glow, { emissive: culture.palette.glow, emissiveIntensity: 0.5 }));
    mats.push(cap.material);
    own.push(cap.geometry);
    placeOnPlanet(map, cap, city.x, city.z, ground(map, city.x, city.z));
    proxy.add(cap);

    scene.add(always, detail, proxy);
    const view = {
      always,
      detail,
      proxy,
      layout,
      /** Put the culture's crown on the hall, given the hall's height. */
      crownAt(hallHeight, scale = 1) {
        const crown = new THREE.Mesh(kits.crown, material);
        placeOnPlanet(map, crown, city.x, city.z, ground(map, city.x, city.z) + hallHeight);
        crown.scale.setScalar(culture.scale * scale);
        detail.add(crown);
      },
      dispose() {
        scene.remove(always, detail, proxy);
        own.forEach((g) => g.dispose());
        mats.forEach((m) => m.dispose());
        for (const g of [always, detail]) g.traverse((o) => o.isInstancedMesh && o.dispose());
      },
    };
    return view;
  }

  /** A road between two cities, laid over the land in between. */
  function buildRoad(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(d / 6));
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push([a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps]);
    // Keep out of the cities' plazas: start and end at their gates.
    const t0 = (CITY.plaza + 2) / d,
      t1 = 1 - (CITY.plaza + 2) / d;
    const clipped = pts.filter((_, i) => i / steps >= t0 && i / steps <= t1);
    if (clipped.length < 2) return null;
    const mesh = new THREE.Mesh(groundRibbon(map, clipped, 1.4, 0.2, false), roadMat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  return {
    build,
    buildRoad,
    material,
    dispose() {
      geometries.forEach((g) => g.dispose());
      material.dispose();
      roadMat.dispose();
      plazaMat.dispose();
      ownMaterials.forEach((m) => m.dispose());
    },
  };
}

/* --------------------------------------------------------------------------------- spice vents */
/** The look of a spice geyser: a vent, a plume or a derrick, and a beacon you can see across the planet. */
export function createSpiceArt(scene, map) {
  const geo = {
    vent: new THREE.CylinderGeometry(1.4, 2.4, 0.9, 10).translate(0, 0.45, 0),
    plume: new THREE.ConeGeometry(1.2, 5, 10, 1, true).translate(0, 2.5, 0),
    derrick: new THREE.CylinderGeometry(0.35, 1.3, 5, 4).translate(0, 2.5, 0),
    flag: new THREE.PlaneGeometry(1.5, 0.95),
    beacon: new THREE.CylinderGeometry(0.35, 0.9, 34, 8, 1, true).translate(0, 17, 0),
    pad: new THREE.RingGeometry(5.6, 7.1, 32).rotateX(-Math.PI / 2),
  };
  const mat = {
    vent: new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9, flatShading: true }),
    plume: new THREE.MeshBasicMaterial({ color: 0xffa14a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    derrick: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.8, flatShading: true }),
  };
  /** @returns {{group:THREE.Group, plume:THREE.Mesh|null, dispose:()=>void}} */
  function build(g, ownerColor) {
    const group = new THREE.Group();
    const gh = ground(map, g.x, g.z);
    const root = new THREE.Group();
    placeOnPlanet(map, root, g.x, g.z, gh);
    const vent = new THREE.Mesh(geo.vent, mat.vent);
    root.add(vent);
    const own = [];
    const beaconColor = g.owner ? ownerColor : 0xffa14a;
    const beaconMat = new THREE.MeshBasicMaterial({ color: beaconColor, transparent: true, opacity: g.owner ? 0.4 : 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    own.push(beaconMat);
    const beacon = new THREE.Mesh(geo.beacon, beaconMat);
    beacon.frustumCulled = false;
    root.add(beacon);
    const padMat = new THREE.MeshBasicMaterial({ color: beaconColor, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
    own.push(padMat);
    const pad = new THREE.Mesh(geo.pad, padMat);
    pad.position.y = 0.4;
    root.add(pad);
    let plume = null;
    if (g.owner) {
      const tower = new THREE.Mesh(geo.derrick, mat.derrick);
      root.add(tower);
      const flagMat = new THREE.MeshStandardMaterial({ color: ownerColor, roughness: 0.8, side: THREE.DoubleSide });
      own.push(flagMat);
      const flag = new THREE.Mesh(geo.flag, flagMat);
      flag.position.set(0.8, 4.6, 0);
      root.add(flag);
    } else {
      plume = new THREE.Mesh(geo.plume, mat.plume);
      root.add(plume);
    }
    group.add(root);
    scene.add(group);
    return {
      group,
      plume,
      beacon,
      dispose() {
        scene.remove(group);
        own.forEach((m) => m.dispose());
      },
    };
  }
  return {
    build,
    dispose() {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => m.dispose());
    },
  };
}
