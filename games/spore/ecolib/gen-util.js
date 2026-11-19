/**
 * Geometry toolkit for the ecosystem library's procedural assets. Every function returns "pieces"
 * ({ geometry, color | colorAt, matrix }) that mergePieces turns into one vertex-coloured mesh, so an
 * asset is a single draw call. All models stand on y = 0, centred on x/z, in metres.
 *
 * A build context `c` carries the seeded random stream and the level of detail: c.seg(n) and c.cnt(n)
 * scale segment and element counts down for the reduced LOD, so the same generator makes both.
 */
import * as THREE from "three";
import { makeRng } from "../cell-format.js";
import { matrixOf, taperedTube } from "../gfx/geom-utils.js";

export { matrixOf };
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Build context: seeded rng helpers and LOD scaling (lod 0 = full detail, 1 = reduced). */
export function ctxOf(seed, lod = 0) {
  const rng = makeRng(seed);
  return {
    rng,
    lod,
    r: (a, b) => a + (b - a) * rng(),
    seg: (n) => Math.max(3, Math.round(n * (lod ? 0.5 : 1))),
    cnt: (n) => Math.max(1, Math.round(n * (lod ? 0.5 : 1))),
    pick: (l) => l[Math.floor(rng() * l.length)],
    sign: () => (rng() < 0.5 ? -1 : 1),
  };
}

export const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
export const mixc = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp01(t)).getHex();
const mixColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), clamp01(t));
/** Vertical colour gradient from y0 to y1 (piece space). */
export const gradY = (lo, hi, y0, y1) => (x, y) => mixColor(lo, hi, (y - y0) / (y1 - y0 || 1));

/** A lumpy sphere (foliage clump, boulder, puffball). Lumps are seeded, so the shape is stable. */
export function blob(c, radius, color, m, o = {}) {
  const { squash = 1, lump = 0.18, detail = c.lod ? 0 : 1, light, flat = false } = o;
  let geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const k = [c.rng() * 6, c.rng() * 6, c.rng() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const bump = 1 + lump * (Math.sin(x * 4.1 / radius + k[0]) * Math.cos(y * 3.3 / radius + k[1]) + 0.5 * Math.sin(z * 5.2 / radius + k[2]));
    pos.setXYZ(i, x * bump, y * bump * squash, z * bump);
  }
  if (flat && geo.index) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  return { geometry: geo, color, colorAt: light ? gradY(color, light, -radius, radius) : undefined, matrix: matrix(m) };
}
const matrix = (m) => (m && m.isMatrix4 ? m : matrixOf(m || {}));

/** A cone standing on y = 0. */
export function cone(c, r, h, color, m, o = {}) {
  const g = new THREE.ConeGeometry(r, h, c.seg(o.seg || 8), 1, !!o.open).translate(0, h / 2, 0);
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, 0, h) : undefined, matrix: matrix(m) };
}
/** A cylinder (or frustum) from radius r0 at the bottom to r1 at the top, standing on y = 0. */
export function cyl(c, r0, r1, h, color, m, o = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, c.seg(o.seg || 8), 1).translate(0, h / 2, 0);
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, 0, h) : undefined, matrix: matrix(m) };
}
/** A tapered tube through points [x,y,z], radius r0 at the start to r1 at the end. */
export function limb(c, pts, r0, r1, color, o = {}) {
  const g = taperedTube(pts.map((p) => (p.isVector3 ? p : V(...p))), (t) => r0 + (r1 - r0) * t, { radial: c.seg(o.radial || 6), segments: o.segments || (c.lod ? 4 : 8) });
  const top = Math.max(...pts.map((p) => (p.isVector3 ? p.y : p[1])));
  const low = Math.min(...pts.map((p) => (p.isVector3 ? p.y : p[1])));
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, low, top) : undefined, matrix: matrix(o.m) };
}
/** A flat curved blade (grass, frond leaf, reed): h tall, w wide at the base, bending sideways by `bend`. */
export function blade(c, h, w, bend, color, m, o = {}) {
  const n = c.lod ? 3 : 6;
  const pos = [],
    idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = bend * t * t * h,
      cy = h * t,
      half = (w / 2) * (o.taper === false ? 1 : 1 - t * 0.92);
    pos.push(cx - half, cy, 0, cx + half, cy, 0);
  }
  for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, 0, h) : undefined, matrix: matrix(m) };
}
/** A faceted crystal: a prism with a pointed top (two pieces). */
export function crystal(c, r, h, color, m, o = {}) {
  const sides = o.sides || 6,
    shaft = h * (o.shaft ?? 0.72);
  const mm = matrix(m);
  const body = new THREE.CylinderGeometry(r * (o.taper ?? 1), r, shaft, sides, 1).translate(0, shaft / 2, 0);
  const tip = new THREE.ConeGeometry(r * (o.taper ?? 1), h - shaft, sides, 1).translate(0, shaft + (h - shaft) / 2, 0);
  const at = o.tipColor ? gradY(color, o.tipColor, 0, h) : undefined;
  return [
    { geometry: body, color, colorAt: at, matrix: mm },
    { geometry: tip, color: o.tipColor || color, colorAt: at, matrix: mm },
  ];
}
/** A faceted rock: flat-shaded, squashed and jittered. */
export function rock(c, radius, color, m, o = {}) {
  return blob(c, radius, color, m, { lump: o.lump ?? 0.28, detail: c.lod ? 0 : o.detail ?? 1, flat: true, squash: o.squash ?? 0.7, light: o.light });
}
/** A flat disc / pad / mushroom cap base, standing on y = 0. */
export function disc(c, r, h, color, m, o = {}) {
  return cyl(c, r, r * (o.top ?? 0.9), h, color, m, { seg: o.seg || 14, tip: o.tip });
}
/** A dome (half sphere) standing on y = 0: mushroom caps, mounds, anemone bodies. */
export function dome(c, r, h, color, m, o = {}) {
  const g = new THREE.SphereGeometry(r, c.seg(o.seg || 14), c.seg(o.rings || 8), 0, TAU, 0, o.arc ?? Math.PI / 2);
  g.scale(1, h / r, 1);
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, 0, h) : o.rim ? gradY(o.rim, color, 0, h) : undefined, matrix: matrix(m) };
}
/** A lathe solid from [radius, y] pairs (bottom to top): stalks, vases, bulbs, columns. */
export function lathe(c, profile, color, m, o = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), c.seg(o.seg || 12));
  const top = profile.at(-1)[1];
  return { geometry: g, color, colorAt: o.tip ? gradY(color, o.tip, profile[0][1], top) : undefined, matrix: matrix(m) };
}
export const box = (c, w, h, d, color, m, o = {}) => ({ geometry: new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, colorAt: o.tip ? gradY(color, o.tip, 0, h) : undefined, matrix: matrix(m) });
export const sphere = (c, r, color, m, o = {}) => ({ geometry: new THREE.SphereGeometry(r, c.seg(o.seg || 10), c.seg(o.rings || 8)), color, matrix: matrix(m) });
export const torus = (c, R, r, color, m) => ({ geometry: new THREE.TorusGeometry(R, r, c.seg(6), c.seg(14)), color, matrix: matrix(m) });

/** Rotate a direction by `angle` away from itself, around a random axis perpendicular to it. */
function deflect(dir, angle, around, tmp = new THREE.Quaternion()) {
  const axis = V(0, 1, 0).cross(dir);
  if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
  axis.normalize().applyAxisAngle(dir, around);
  return dir.clone().applyQuaternion(tmp.setFromAxisAngle(axis, angle)).normalize();
}

/**
 * A recursive branching structure (trees, coral, antlers, root systems). Branches are tapered tubes;
 * `leaf(c, tip, dir, level, size)` is called at branch ends for foliage. Returns pieces.
 * o: levels, len, r (trunk radius), spread (rad), shrink (length factor), thin (radius factor),
 *    kids [min,max], up (0..1 bias towards vertical), curl (rad), color, tip (colour of twig ends),
 *    trunkBare (fraction of the trunk with no side branches), leaf, leafFrom (first level that leafs)
 */
export function branches(c, o) {
  const pieces = [];
  const { levels = 3, len = 3, r = 0.2, spread = 0.7, shrink = 0.68, thin = 0.55, kids = [2, 3], up = 0.35, curl = 0.25, color = 0x6b4e32, tip, trunkBare = 0.35, leaf, leafFrom = levels, budget = 400 } = o;
  let used = 0;
  const grow = (origin, dir, length, radius, level) => {
    if (used++ > budget) return;
    const bend = deflect(dir, curl * (c.rng() - 0.5) * 2, c.rng() * TAU);
    const mid = origin.clone().addScaledVector(dir, length * 0.5).addScaledVector(bend, length * 0.08);
    const end = origin.clone().addScaledVector(bend, length);
    pieces.push(limb(c, [origin, mid, end], radius, Math.max(0.012, radius * thin), color, { radial: level === 0 ? 7 : 5, tip, segments: 4 }));
    if (leaf && level >= leafFrom) pieces.push(...[].concat(leaf(c, end, bend, level, length)));
    if (level >= levels) return;
    const n = c.cnt(kids[0] + Math.floor(c.rng() * (kids[1] - kids[0] + 1)));
    for (let i = 0; i < n; i++) {
      const t = level === 0 ? trunkBare + (1 - trunkBare) * (i / Math.max(1, n)) : 0.55 + 0.45 * (i / Math.max(1, n));
      const from = origin.clone().lerp(end, Math.min(1, t));
      let d = deflect(bend, spread * (0.7 + c.rng() * 0.6), (i / n) * TAU + c.rng() * 1.4);
      d.lerp(V(0, 1, 0), up).normalize();
      grow(from, d, length * shrink * (0.85 + c.rng() * 0.3), radius * thin, level + 1);
    }
  };
  grow(V(0, 0, 0), V(0, 1, 0), len, r, 0);
  return pieces;
}

/** Scatter `n` copies of a piece-making function on a disc (grass tufts, pebble beds, flower patches). */
export function scatter(c, n, radius, make, o = {}) {
  const out = [];
  for (let i = 0; i < c.cnt(n); i++) {
    const a = c.rng() * TAU,
      d = Math.sqrt(c.rng()) * radius;
    out.push(...[].concat(make(Math.cos(a) * d, Math.sin(a) * d, i, a)));
  }
  return out;
}

/** Place a piece (or pieces) at x,y,z with a yaw and uniform scale: the common case for scatter(). */
export function placed(piece, x, y, z, yaw = 0, s = 1) {
  const mm = matrixOf({ x, y, z, ry: yaw, sx: s });
  return [].concat(piece).map((p) => ({ ...p, matrix: p.matrix ? mm.clone().multiply(p.matrix) : mm }));
}

export const TAU_ = TAU;
