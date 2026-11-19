/**
 * Flora generators: trees, bushes, grasses, flowers, succulents, crystalline and alien plants.
 * Each generator is an archetype taking a parameter object `p` and a build context `c`; the catalogue
 * instantiates them many times with different parameters, so shape, height, branching, silhouette,
 * foliage arrangement and colour all differ from asset to asset.
 */
import { TAU_ as TAU, V, blade, blob, box, branches, cone, crystal, cyl, dome, lathe, limb, matrixOf, mixc, placed, scatter, shade, sphere } from "./gen-util.js";

const d = (p, k, v) => (p[k] === undefined ? v : p[k]);
/** n blades fanned around the origin. */
function bladeFan(c, n, h, w, bend, color, tip, radius = 0.1, tilt = 0.25) {
  const out = [];
  for (let i = 0; i < c.cnt(n); i++) {
    const a = (i / n) * TAU + c.rng() * 0.6;
    const hh = h * (0.65 + c.rng() * 0.5);
    const r = radius * (0.3 + c.rng());
    out.push(blade(c, hh, w, bend * (0.5 + c.rng()), color, matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r, ry: -a, rz: -tilt * c.rng() * 2 }), { tip }));
  }
  return out;
}

/* ============================== trees =============================== */

export const TREE_GENERATORS = {
  /** Stacked cone tiers: pines, firs, spruces. */
  conifer(p, c) {
    const h = d(p, "h", 10),
      tiers = c.cnt(d(p, "tiers", 6)),
      wide = d(p, "wide", 2.2),
      trunkR = h * 0.022;
    const out = [cyl(c, trunkR * 1.4, trunkR * 0.6, h * 0.4, d(p, "trunk", 0x5b4129), null, { seg: 6 })];
    for (let i = 0; i < tiers; i++) {
      const t = i / Math.max(1, tiers - 1);
      const y = h * (0.14 + 0.78 * t * 0.92),
        r = wide * Math.pow(1 - t * 0.92, d(p, "taper", 0.9)) + 0.15,
        ch = (h * d(p, "tierH", 0.3)) / (1 + t * 0.5);
      out.push(cone(c, r, ch, mixc(d(p, "c1", 0x2f6b3a), d(p, "c2", 0x4f8f4f), t), matrixOf({ y, ry: i * 0.7 }), { seg: d(p, "sides", 9), tip: d(p, "tip", undefined) }));
      if (d(p, "snow", 0) > 0) out.push(cone(c, r * 0.8, ch * 0.5, 0xf2f6fb, matrixOf({ y: y + ch * 0.55, ry: i * 0.7 }), { seg: d(p, "sides", 9) }));
    }
    out.push(cone(c, wide * 0.08, h * 0.12, d(p, "c2", 0x4f8f4f), matrixOf({ y: h * 0.93 }), { seg: 5 }));
    return out;
  },
  /** A forking trunk carrying big clumps of foliage: oaks, maples, lindens. */
  broadleaf(p, c) {
    const h = d(p, "h", 8),
      forks = c.cnt(d(p, "forks", 3)),
      crownR = d(p, "crownR", 2.4),
      tr = d(p, "trunkR", h * 0.04);
    const out = [limb(c, [V(0, 0, 0), V(c.r(-0.2, 0.2), h * 0.25, 0), V(c.r(-0.3, 0.3), h * 0.5, c.r(-0.3, 0.3))], tr * 1.3, tr * 0.8, d(p, "trunk", 0x6b4e32), { radial: 7 })];
    const top = V(0, h * 0.48, 0);
    for (let i = 0; i < forks; i++) {
      const a = (i / forks) * TAU + c.rng(),
        rr = crownR * 0.55;
      const end = V(Math.cos(a) * rr, h * d(p, "crownY", 0.78) + c.r(-0.4, 0.4), Math.sin(a) * rr);
      out.push(limb(c, [top, top.clone().lerp(end, 0.5).add(V(0, 0.2, 0)), end], tr * 0.7, tr * 0.3, d(p, "trunk", 0x6b4e32), { radial: 5 }));
      const n = c.cnt(d(p, "clumps", 3));
      for (let k = 0; k < n; k++) out.push(blob(c, crownR * c.r(0.42, 0.7), mixc(d(p, "c1", 0x3f8f45), d(p, "c2", 0x6bb04a), c.rng()), matrixOf({ x: end.x + c.r(-1, 1) * crownR * 0.35, y: end.y + c.r(-0.3, 0.9) * crownR * 0.4, z: end.z + c.r(-1, 1) * crownR * 0.35 }), { squash: d(p, "flat", 0.8), light: d(p, "light", undefined) }));
    }
    return out;
  },
  /** Visible twig structure with leaves at the tips: birches, gnarled oaks, dead snags. */
  branchy(p, c) {
    const leafR = d(p, "leafR", 0.45),
      kind = d(p, "leaf", "blob");
    const leaf = kind === "none" ? null : (cc, tipPos, dir, level) => (kind === "needle" ? bladeFan(cc, 5, leafR * 2, 0.06, 0.2, d(p, "c1", 0x4f8f4f), d(p, "c2", 0x9ad06a), 0.12).map((b) => ({ ...b, matrix: matrixOf({ x: tipPos.x, y: tipPos.y, z: tipPos.z }).multiply(b.matrix) })) : kind === "pod" ? [sphere(cc, leafR * 0.5, d(p, "c2", 0xe28a3c), matrixOf({ x: tipPos.x, y: tipPos.y - leafR * 0.4, z: tipPos.z, sy: 1.4 }), { seg: 7 })] : [blob(cc, leafR * cc.r(0.7, 1.2), mixc(d(p, "c1", 0x4a9a48), d(p, "c2", 0x86c25a), cc.rng()), matrixOf({ x: tipPos.x, y: tipPos.y, z: tipPos.z }), { squash: 0.7, detail: 0 })]);
    return branches(c, { levels: d(p, "levels", 3), len: d(p, "len", 3.2), r: d(p, "r", 0.2), spread: d(p, "spread", 0.75), shrink: d(p, "shrink", 0.7), thin: d(p, "thin", 0.55), kids: d(p, "kids", [2, 3]), up: d(p, "up", 0.35), curl: d(p, "curl", 0.3), color: d(p, "trunk", 0x6b4e32), tip: d(p, "bark", undefined), trunkBare: d(p, "bare", 0.4), leaf, leafFrom: d(p, "leafFrom", d(p, "levels", 3)), budget: 260 });
  },
  /** A curving trunk and a crown of arching fronds. */
  palm(p, c) {
    const h = d(p, "h", 9),
      curve = d(p, "curve", 1.2),
      tr = d(p, "trunkR", h * 0.025);
    const pts = [V(0, 0, 0), V(curve * 0.15, h * 0.35, 0), V(curve * 0.55, h * 0.7, 0), V(curve, h, 0)];
    const out = [limb(c, pts, tr * 1.5, tr, d(p, "trunk", 0x7a5a3a), { radial: 7, segments: c.lod ? 5 : 12 })];
    const top = pts[3];
    const n = c.cnt(d(p, "fronds", 9)),
      L = d(p, "frondLen", 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.3;
      out.push(blade(c, L * c.r(0.85, 1.15), d(p, "frondW", 0.55), d(p, "droop", 0.8), mixc(d(p, "c1", 0x2f8a3c), d(p, "c2", 0x6bc04a), c.rng()), matrixOf({ x: top.x, y: top.y, z: top.z, ry: a, rz: -d(p, "tilt", 0.9) + c.r(-0.2, 0.2) }), { tip: d(p, "c2", 0x6bc04a), taper: false }));
    }
    for (let i = 0; i < c.cnt(d(p, "nuts", 3)); i++) out.push(sphere(c, h * 0.016, d(p, "nutC", 0x6a4a28), matrixOf({ x: top.x + c.r(-0.2, 0.2), y: top.y - 0.25, z: top.z + c.r(-0.2, 0.2) }), { seg: 6 }));
    return out;
  },
  /** A fat bottle trunk with a sparse crown: baobabs and bottle trees. */
  bulbous(p, c) {
    const h = d(p, "h", 7),
      b = d(p, "bulge", 1.5),
      neck = d(p, "neck", 0.4);
    const out = [lathe(c, [[0.01, 0], [b * 0.85, 0.05 * h], [b, h * 0.28], [b * 0.7, h * 0.55], [b * neck, h * 0.85], [b * neck * 0.8, h]], d(p, "trunk", 0x8a7a64), null, { seg: 12, tip: d(p, "bark", undefined) })];
    const top = V(0, h, 0);
    const n = c.cnt(d(p, "crown", 4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng(),
        e = V(Math.cos(a) * b * 1.1, h + c.r(0.5, 1.6), Math.sin(a) * b * 1.1);
      out.push(limb(c, [top, top.clone().lerp(e, 0.5).add(V(0, 0.3, 0)), e], b * neck * 0.35, b * 0.07, d(p, "trunk", 0x8a7a64)));
      out.push(blob(c, b * d(p, "tuft", 0.6), mixc(d(p, "c1", 0x6a9a3c), d(p, "c2", 0x9ac04a), c.rng()), matrixOf({ x: e.x, y: e.y + 0.2, z: e.z }), { squash: 0.55 }));
    }
    return out;
  },
  /** A leaning trunk under a flat layered canopy: acacias and savanna trees. */
  umbrella(p, c) {
    const h = d(p, "h", 7),
      lean = d(p, "lean", 0.9),
      R = d(p, "spreadR", 4.5),
      layers = c.cnt(d(p, "layers", 3));
    const top = V(lean, h, 0);
    const out = [limb(c, [V(0, 0, 0), V(lean * 0.2, h * 0.4, 0.1), V(lean * 0.7, h * 0.8, -0.1), top], h * 0.035, h * 0.02, d(p, "trunk", 0x5f4630), { radial: 6 })];
    for (let i = 0; i < c.cnt(4); i++) {
      const a = (i / 4) * TAU + 0.5;
      out.push(limb(c, [V(top.x, top.y - 0.6, top.z), V(top.x + Math.cos(a) * R * 0.3, top.y + 0.1, top.z + Math.sin(a) * R * 0.3), V(top.x + Math.cos(a) * R * 0.6, top.y + 0.3, top.z + Math.sin(a) * R * 0.6)], 0.12, 0.04, d(p, "trunk", 0x5f4630), { radial: 4 }));
    }
    for (let i = 0; i < layers; i++) out.push(dome(c, R * (1 - i * 0.22), d(p, "thick", 0.7) * (1 - i * 0.15), mixc(d(p, "c1", 0x7a9a3c), d(p, "c2", 0xa8b84a), i / layers), matrixOf({ x: top.x, y: top.y + 0.2 + i * 0.35, z: top.z }), { seg: 16, tip: d(p, "c2", 0xa8b84a) }));
    return out;
  },
  /** A domed crown with long hanging strands: willows and weeping trees. */
  weeping(p, c) {
    const h = d(p, "h", 9),
      R = d(p, "domeR", 3.5);
    const out = [limb(c, [V(0, 0, 0), V(0.15, h * 0.3, 0), V(0, h * 0.62, 0.1)], h * 0.04, h * 0.025, d(p, "trunk", 0x5a4a34), { radial: 7 })];
    out.push(blob(c, R, d(p, "c1", 0x6a9a4a), matrixOf({ y: h * 0.7 }), { squash: 0.55, light: d(p, "c2", 0x9ac06a) }));
    const n = c.cnt(d(p, "strands", 18)),
      L = d(p, "len", 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.2,
        x = Math.cos(a) * R * 0.92,
        z = Math.sin(a) * R * 0.92,
        l = L * c.r(0.6, 1);
      out.push(limb(c, [V(x, h * 0.66, z), V(x * 1.08, h * 0.66 - l * 0.4, z * 1.08), V(x * 1.04, h * 0.66 - l, z * 1.04)], 0.07, 0.02, d(p, "c1", 0x6a9a4a), { radial: 3, tip: d(p, "c2", 0x9ac06a) }));
    }
    return out;
  },
  /** A tall slim stack of foliage: cypresses and poplars. */
  columnar(p, c) {
    const h = d(p, "h", 14),
      w = d(p, "w", 1.6),
      n = c.cnt(d(p, "puffs", 7));
    const out = [cyl(c, h * 0.02, h * 0.012, h * 0.3, d(p, "trunk", 0x5a4630), null, { seg: 5 })];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1),
        r = w * (0.55 + 0.45 * Math.sin(Math.min(1, t * 1.1 + 0.15) * Math.PI)) * (1 - t * 0.25);
      out.push(blob(c, r, mixc(d(p, "c1", 0x2c5a34), d(p, "c2", 0x5a8f46), t), matrixOf({ x: c.r(-0.1, 0.1), y: h * (0.2 + 0.78 * t), z: c.r(-0.1, 0.1) }), { squash: d(p, "stretch", 1.5) }));
    }
    return out;
  },
  /** A twisting trunk with pods spiralling up it: alien corkscrew trees. */
  spiralTree(p, c) {
    const h = d(p, "h", 9),
      turns = d(p, "turns", 2.5),
      R = d(p, "coil", 0.9);
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push(V(Math.cos(t * turns * TAU) * R * (1 - t * 0.6), t * h, Math.sin(t * turns * TAU) * R * (1 - t * 0.6)));
    }
    const out = [limb(c, pts, h * 0.035, h * 0.012, d(p, "trunk", 0x6a4a6a), { radial: 6, segments: 18, tip: d(p, "tip", undefined) })];
    const n = c.cnt(d(p, "pods", 9));
    for (let i = 0; i < n; i++) {
      const t = 0.25 + 0.75 * (i / n),
        a = t * turns * TAU + 0.6;
      const x = Math.cos(a) * R * (1 - t * 0.6) * 1.9,
        z = Math.sin(a) * R * (1 - t * 0.6) * 1.9;
      out.push(limb(c, [V(Math.cos(a - 0.6) * R * (1 - t * 0.6), t * h, Math.sin(a - 0.6) * R * (1 - t * 0.6)), V(x * 0.8, t * h + 0.2, z * 0.8)], 0.05, 0.03, d(p, "trunk", 0x6a4a6a), { radial: 4 }));
      out.push(blob(c, d(p, "podR", 0.5) * (1.1 - t * 0.5), mixc(d(p, "c1", 0xc060d0), d(p, "c2", 0xff9ae0), c.rng()), matrixOf({ x, y: t * h + 0.2, z }), { squash: 0.8, detail: 0 }));
    }
    return out;
  },
  /** Several arms curling out then up, each tipped with a tuft: candelabra trees. */
  candelabra(p, c) {
    const h = d(p, "h", 8),
      n = c.cnt(d(p, "arms", 5)),
      L = d(p, "armLen", 3);
    const out = [cyl(c, h * 0.05, h * 0.035, h * 0.4, d(p, "trunk", 0x6a5a40), null, { seg: 7 })];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.4,
        s = V(0, h * c.r(0.28, 0.4), 0),
        e = V(Math.cos(a) * L * c.r(0.8, 1.2), h * c.r(0.85, 1.1), Math.sin(a) * L * c.r(0.8, 1.2));
      const m = s.clone().lerp(e, 0.5);
      m.x += Math.cos(a) * L * 0.3;
      m.y -= 0.3;
      out.push(limb(c, [s, m, e], h * 0.028, h * 0.012, d(p, "trunk", 0x6a5a40), { radial: 5 }));
      out.push(...bladeFan(c, d(p, "tuft", 8), d(p, "tuftLen", 1.3), 0.2, 0.4, d(p, "c1", 0x4a9a58), d(p, "c2", 0xa8e070), 0.12, 0.5).map((b) => ({ ...b, matrix: matrixOf({ x: e.x, y: e.y, z: e.z }).multiply(b.matrix) })));
    }
    return out;
  },
  /** A rough straight trunk crowned by a burst of arching fronds: tree ferns. */
  fernTree(p, c) {
    const h = d(p, "h", 6);
    const out = [];
    const rings = c.cnt(d(p, "rings", 12));
    for (let i = 0; i < rings; i++) out.push(cyl(c, h * 0.045, h * 0.04, h / rings, mixc(0x4a3a2a, 0x7a6244, i % 2), matrixOf({ y: (i * h) / rings }), { seg: 7 }));
    const n = c.cnt(d(p, "fronds", 10));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.3;
      out.push(blade(c, d(p, "frondLen", 3), d(p, "frondW", 0.7), d(p, "droop", 0.9), mixc(d(p, "c1", 0x3a8a4a), d(p, "c2", 0x8ad06a), c.rng()), matrixOf({ y: h, ry: a, rz: -c.r(0.35, 0.9) }), { tip: d(p, "c2", 0x8ad06a), taper: false }));
    }
    return out;
  },
  /** A trunk of branches ending in faceted crystals: crystal trees. */
  crystalTree(p, c) {
    const col = d(p, "c1", 0x7ad8ff),
      tip = d(p, "c2", 0xffffff);
    return branches(c, { levels: d(p, "levels", 2), len: d(p, "len", 3), r: d(p, "r", 0.18), spread: d(p, "spread", 0.8), kids: [2, 3], up: 0.3, color: d(p, "trunk", 0x5a6a8a), leaf: (cc, e, dir) => crystal(cc, d(p, "gem", 0.22), d(p, "gemH", 1.1), col, matrixOf({ x: e.x, y: e.y, z: e.z, rx: dir.z * 0.6, rz: -dir.x * 0.6 }), { sides: d(p, "sides", 6), tipColor: tip }), leafFrom: d(p, "levels", 2), budget: 120 });
  },
  /** Branches hung with glowing pods on stalks: alien lantern trees. */
  podTree(p, c) {
    const col = d(p, "c1", 0xffb84a),
      glow = d(p, "c2", 0xfff0a0);
    return branches(c, {
      levels: d(p, "levels", 2),
      len: d(p, "len", 3.4),
      r: d(p, "r", 0.2),
      spread: d(p, "spread", 1.0),
      up: 0.1,
      color: d(p, "trunk", 0x4a3a52),
      leafFrom: d(p, "levels", 2),
      budget: 120,
      leaf: (cc, e) => {
        const n = cc.cnt(d(p, "pods", 3)),
          o = [];
        for (let i = 0; i < n; i++) {
          const x = e.x + cc.r(-0.4, 0.4),
            z = e.z + cc.r(-0.4, 0.4),
            drop = cc.r(0.5, 1.4);
          o.push(limb(cc, [V(x, e.y, z), V(x, e.y - drop, z)], 0.025, 0.02, d(p, "trunk", 0x4a3a52), { radial: 3, segments: 2 }));
          o.push(blob(cc, d(p, "podR", 0.26), mixc(col, glow, cc.rng()), matrixOf({ x, y: e.y - drop - 0.2, z, sy: 1.2 }), { detail: 0, lump: 0.08 }));
        }
        return o;
      },
    });
  },
  /** Stilt roots arching down to the mud under a rounded crown: mangroves. */
  mangrove(p, c) {
    const h = d(p, "h", 6),
      n = c.cnt(d(p, "roots", 8)),
      R = d(p, "spreadR", 2.6);
    const out = [limb(c, [V(0, h * 0.2, 0), V(0.1, h * 0.55, 0), V(0, h * 0.8, 0)], h * 0.05, h * 0.03, d(p, "trunk", 0x5a4a34))];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.4,
        r1 = R * c.r(0.8, 1.2);
      out.push(limb(c, [V(0, h * 0.5, 0), V(Math.cos(a) * r1 * 0.5, h * 0.62, Math.sin(a) * r1 * 0.5), V(Math.cos(a) * r1, h * 0.18, Math.sin(a) * r1), V(Math.cos(a) * r1 * 1.02, 0, Math.sin(a) * r1 * 1.02)], h * 0.025, h * 0.012, d(p, "trunk", 0x5a4a34), { radial: 4 }));
    }
    for (let i = 0; i < c.cnt(4); i++) out.push(blob(c, R * 0.55, mixc(d(p, "c1", 0x3a7a46), d(p, "c2", 0x5a9a4a), c.rng()), matrixOf({ x: c.r(-1.2, 1.2), y: h * 0.9 + c.r(-0.3, 0.6), z: c.r(-1.2, 1.2) }), { squash: 0.7 }));
    return out;
  },
  /** A flared, buttressed trunk with a wide high crown: rainforest emergents. */
  buttress(p, c) {
    const h = d(p, "h", 18),
      fins = c.cnt(d(p, "fins", 5)),
      R = d(p, "crownR", 5);
    const out = [cyl(c, h * 0.03, h * 0.018, h * 0.78, d(p, "trunk", 0x6a5a48), null, { seg: 8 })];
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * TAU + c.rng() * 0.3;
      out.push(box(c, h * 0.13, h * 0.2, h * 0.012, d(p, "trunk", 0x6a5a48), matrixOf({ x: Math.cos(a) * h * 0.04, z: Math.sin(a) * h * 0.04, ry: -a, rz: 0 })));
    }
    for (let i = 0; i < c.cnt(5); i++) out.push(blob(c, R * c.r(0.5, 0.8), mixc(d(p, "c1", 0x2a6a38), d(p, "c2", 0x4a9a4a), c.rng()), matrixOf({ x: c.r(-1, 1) * R * 0.55, y: h * 0.85 + c.r(-0.5, 1.5), z: c.r(-1, 1) * R * 0.55 }), { squash: 0.55 }));
    return out;
  },
};

/* ===================== bushes, grasses, flowers, others ====================== */

export const PLANT_GENERATORS = {
  /** A cluster of foliage clumps, optionally dotted with berries. */
  bush(p, c) {
    const R = d(p, "r", 0.8),
      n = c.cnt(d(p, "clumps", 6));
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng(),
        rr = i === 0 ? 0 : R * c.r(0.3, 0.6);
      out.push(blob(c, R * c.r(0.45, 0.7), mixc(d(p, "c1", 0x3f8f52), d(p, "c2", 0x6bb04a), c.rng()), matrixOf({ x: Math.cos(a) * rr, y: R * 0.35, z: Math.sin(a) * rr }), { squash: d(p, "squash", 0.8), light: d(p, "light", d(p, "c2", 0x6bb04a)) }));
    }
    const berries = c.cnt(d(p, "berries", 0));
    for (let i = 0; i < berries; i++) {
      const a = c.rng() * TAU,
        e = c.r(0.2, 1.2);
      out.push(sphere(c, R * 0.1, d(p, "berryC", 0xe0405a), matrixOf({ x: Math.cos(a) * R * 0.85, y: R * (0.25 + e * 0.4), z: Math.sin(a) * R * 0.85 }), { seg: 6, rings: 4 }));
    }
    return out;
  },
  /** Thin woody stems radiating out with small leaf tufts: heath, sagebrush, thorn scrub. */
  scrub(p, c) {
    const out = [];
    const n = c.cnt(d(p, "stems", 9)),
      h = d(p, "h", 0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng(),
        lean = c.r(0.15, 0.7),
        e = V(Math.cos(a) * h * lean, h * c.r(0.7, 1.1), Math.sin(a) * h * lean);
      out.push(limb(c, [V(0, 0, 0), e.clone().multiplyScalar(0.55).setY(e.y * 0.55), e], 0.03, 0.01, d(p, "trunk", 0x6a5a40), { radial: 3, segments: 3 }));
      out.push(blob(c, d(p, "leafR", 0.18), mixc(d(p, "c1", 0x7a9a5a), d(p, "c2", 0xb8c880), c.rng()), matrixOf({ x: e.x, y: e.y, z: e.z }), { detail: 0, squash: 0.8 }));
      if (d(p, "thorns", 0)) out.push(cone(c, 0.012, 0.09, 0xd8c8a8, matrixOf({ x: e.x * 0.6, y: e.y * 0.6, z: e.z * 0.6, rz: 1 }), { seg: 3 }));
    }
    return out;
  },
  /** A tuft of grass blades. */
  grassTuft(p, c) {
    return bladeFan(c, d(p, "n", 20), d(p, "h", 0.6), d(p, "w", 0.075), d(p, "bend", 0.35), d(p, "c1", 0x6a9a3a), d(p, "c2", 0xb8d868), d(p, "radius", 0.14), d(p, "tilt", 0.25));
  },
  /** Tall reeds or bulrushes with seed heads. */
  reeds(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 9)),
      h = d(p, "h", 1.8);
    for (let i = 0; i < n; i++) {
      const a = c.rng() * TAU,
        r = c.r(0.02, d(p, "radius", 0.28)),
        hh = h * c.r(0.7, 1.15);
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      out.push(blade(c, hh, d(p, "w", 0.06), c.r(-0.15, 0.15), d(p, "c1", 0x6a8a3a), matrixOf({ x, z, ry: c.rng() * TAU }), { tip: d(p, "c2", 0xa8c068), taper: true }));
      if (d(p, "heads", 1) && i % 2 === 0) out.push(cyl(c, 0.04, 0.035, hh * 0.18, d(p, "headC", 0x6a4428), matrixOf({ x: x + hh * 0.02, y: hh * 0.62, z }), { seg: 5 }));
    }
    return out;
  },
  /** A stem with a ring of petals around a centre; leaves at the base. */
  flower(p, c) {
    const h = d(p, "h", 0.5),
      n = c.cnt(d(p, "petals", 6)),
      pl = d(p, "petalLen", 0.14);
    const out = [limb(c, [V(0, 0, 0), V(0.03, h * 0.5, 0), V(0.02, h, 0)], 0.012, 0.01, d(p, "stem", 0x4a8a3a), { radial: 3, segments: 3 })];
    for (let i = 0; i < c.cnt(d(p, "leaves", 2)); i++) out.push(blade(c, h * 0.5, 0.09, 0.3, d(p, "stem", 0x4a8a3a), matrixOf({ y: h * 0.1, ry: i * 2.6, rz: -0.7 }), { taper: true }));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      out.push(blade(c, pl, d(p, "petalW", 0.07), d(p, "cup", 0.2), mixc(d(p, "c1", 0xe0507a), d(p, "c2", 0xffb0c8), i % 2), matrixOf({ x: 0.02, y: h, ry: a, rz: -d(p, "open", 1.1) }), { tip: d(p, "c2", 0xffb0c8), taper: false }));
    }
    out.push(sphere(c, pl * 0.32, d(p, "centre", 0xffd84a), matrixOf({ x: 0.02, y: h + 0.01 }), { seg: 6, rings: 4 }));
    return out;
  },
  /** A patch of small flowers on thin stems (meadow flowers, wildflowers). */
  flowerPatch(p, c) {
    const out = [];
    out.push(...bladeFan(c, d(p, "grass", 10), d(p, "h", 0.35) * 0.9, 0.04, 0.3, d(p, "stem", 0x5a9a3a), 0x9ac05a, d(p, "radius", 0.3)));
    scatter(c, d(p, "n", 7), d(p, "radius", 0.3), (x, z, i) => {
      const hh = d(p, "h", 0.35) * c.r(0.8, 1.3);
      out.push(...placed([limb(c, [V(0, 0, 0), V(0.02, hh, 0)], 0.008, 0.007, d(p, "stem", 0x5a9a3a), { radial: 3, segments: 2 }), blob(c, d(p, "headR", 0.05), mixc(d(p, "c1", 0xe0507a), d(p, "c2", 0xffe08a), (i % 3) / 2), matrixOf({ y: hh }), { detail: 0, lump: 0.05 })], x, 0, z, 0, 1));
      return [];
    });
    return out;
  },
  /** Arching feathery fronds: ferns. */
  fern(p, c) {
    const out = [];
    const n = c.cnt(d(p, "fronds", 9)),
      L = d(p, "len", 1.1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.3;
      out.push(blade(c, L * c.r(0.75, 1.1), d(p, "w", 0.28), d(p, "droop", 0.7), mixc(d(p, "c1", 0x3a8a4a), d(p, "c2", 0x7ac05a), c.rng()), matrixOf({ ry: a, rz: -c.r(0.3, 0.75) }), { tip: d(p, "c2", 0x7ac05a), taper: false }));
    }
    return out;
  },
  /** A rosette of thick pointed leaves: agaves, aloes, rosette succulents. */
  succulent(p, c) {
    const out = [];
    const n = c.cnt(d(p, "leaves", 14)),
      L = d(p, "len", 0.5);
    for (let ring = 0; ring < 3; ring++)
      for (let i = 0; i < Math.ceil(n / 3); i++) {
        const a = (i / Math.ceil(n / 3)) * TAU + ring * 0.8;
        out.push(cone(c, d(p, "thick", 0.07), L * (1 - ring * 0.2), mixc(d(p, "c1", 0x6a9a7a), d(p, "c2", 0xa8d0a0), ring / 2), matrixOf({ y: ring * 0.04, ry: a, rz: -(0.35 + ring * 0.35) * d(p, "open", 1) }), { seg: 4, tip: d(p, "tip", 0xc86a6a) }));
      }
    return out;
  },
  /** Cactus family: columns with arms, barrels, paddle stacks. */
  cactus(p, c) {
    const kind = d(p, "kind", "column"),
      col = d(p, "c1", 0x4a8a5a),
      h = d(p, "h", 1.6);
    const out = [];
    if (kind === "barrel") {
      out.push(lathe(c, [[0.01, 0], [h * 0.4, h * 0.1], [h * 0.48, h * 0.5], [h * 0.3, h * 0.92], [0.01, h]], col, null, { seg: 14, tip: d(p, "c2", 0x7ab07a) }));
      for (let i = 0; i < c.cnt(d(p, "spines", 10)); i++) out.push(cone(c, 0.012, 0.1, 0xf4ecd0, matrixOf({ x: Math.cos(i) * h * 0.4, y: h * (0.2 + (i % 5) * 0.14), z: Math.sin(i) * h * 0.4, rz: -Math.cos(i), rx: Math.sin(i) }), { seg: 3 }));
      if (d(p, "bloom", 1)) out.push(sphere(c, h * 0.1, d(p, "bloomC", 0xff6a9a), matrixOf({ y: h * 0.96 }), { seg: 6, rings: 4 }));
    } else if (kind === "paddle") {
      const n = c.cnt(d(p, "pads", 5));
      let at = V(0, 0, 0),
        rot = 0;
      for (let i = 0; i < n; i++) {
        const s = h * 0.4 * (1 - i * 0.1);
        out.push(sphere(c, s, mixc(col, d(p, "c2", 0x7ab07a), i / n), matrixOf({ x: at.x, y: at.y + s * 1.1, z: at.z, sx: 0.9, sy: 1.25, sz: 0.18, ry: rot }), { seg: 10 }));
        at = V(at.x + Math.cos(rot) * s * 0.7 * c.sign(), at.y + s * 1.5, at.z);
        rot += c.r(-0.9, 0.9);
      }
    } else {
      out.push(cyl(c, h * 0.1, h * 0.085, h, col, null, { seg: 10, tip: d(p, "c2", 0x7ab07a) }), dome(c, h * 0.085, h * 0.08, d(p, "c2", 0x7ab07a), matrixOf({ y: h }), { seg: 8 }));
      const arms = c.cnt(d(p, "arms", 2));
      for (let i = 0; i < arms; i++) {
        const s = i % 2 ? 1 : -1,
          y = h * (0.35 + i * 0.12),
          l = h * 0.4;
        out.push(limb(c, [V(0, y, 0), V(s * l * 0.7, y, 0), V(s * l, y + l * 0.5, 0), V(s * l, y + l * 1.1, 0)], h * 0.07, h * 0.06, col, { radial: 7, tip: d(p, "c2", 0x7ab07a) }));
      }
    }
    return out;
  },
  /** A low tangle of curling vines. */
  vineTangle(p, c) {
    const out = [];
    const n = c.cnt(d(p, "vines", 8)),
      R = d(p, "r", 0.7);
    for (let i = 0; i < n; i++) {
      const a = c.rng() * TAU;
      const pts = [];
      for (let k = 0; k < 5; k++) pts.push(V(Math.cos(a + k * 0.9 * c.sign()) * R * (0.3 + k * 0.18), 0.05 + Math.abs(Math.sin(k * 1.3 + i)) * R * 0.5, Math.sin(a + k * 0.9) * R * (0.3 + k * 0.18)));
      out.push(limb(c, pts, 0.03, 0.012, d(p, "c1", 0x4a7a3a), { radial: 4, segments: 8 }));
      out.push(blob(c, 0.09, d(p, "c2", 0x7ab04a), matrixOf({ x: pts[4].x, y: pts[4].y, z: pts[4].z }), { detail: 0 }));
    }
    return out;
  },
  /** A glowing bulb on a stalk, ringed with leaves: alien bulb plants. */
  bulbPlant(p, c) {
    const h = d(p, "h", 1);
    const out = [limb(c, [V(0, 0, 0), V(c.r(-0.15, 0.15), h * 0.5, 0), V(c.r(-0.1, 0.1), h, 0)], 0.04, 0.03, d(p, "stem", 0x4a8a6a), { radial: 5 })];
    out.push(blob(c, d(p, "bulbR", 0.28), d(p, "c1", 0x8affc0), matrixOf({ y: h + 0.15 }), { squash: 1.2, light: d(p, "c2", 0xe0fff0), lump: 0.08 }));
    for (let i = 0; i < c.cnt(d(p, "spots", 5)); i++) out.push(sphere(c, 0.05, d(p, "spotC", 0xff7ab0), matrixOf({ x: Math.cos(i * 2.4) * 0.24, y: h + 0.15 + Math.sin(i * 1.7) * 0.2, z: Math.sin(i * 2.4) * 0.24 }), { seg: 5, rings: 4 }));
    out.push(...bladeFan(c, d(p, "leaves", 4), h * 0.5, 0.14, 0.5, d(p, "stem", 0x4a8a6a), d(p, "c1", 0x8affc0), 0.05, 0.9));
    return out;
  },
  /** Curling tendrils tipped with beads: sea-anemone-like land plants. */
  tendril(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 9)),
      L = d(p, "len", 1.1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU,
        s = c.sign();
      const pts = [V(0, 0, 0), V(Math.cos(a) * L * 0.2, L * 0.5, Math.sin(a) * L * 0.2), V(Math.cos(a) * L * 0.5, L * 0.95, Math.sin(a) * L * 0.5), V(Math.cos(a + 0.5 * s) * L * 0.7, L * 0.8, Math.sin(a + 0.5 * s) * L * 0.7)];
      out.push(limb(c, pts, 0.045, 0.012, d(p, "c1", 0xb05ac0), { radial: 4, tip: d(p, "c2", 0xffa0e0) }));
      out.push(sphere(c, 0.05, d(p, "bead", 0xffe070), matrixOf({ x: pts[3].x, y: pts[3].y, z: pts[3].z }), { seg: 6, rings: 4 }));
    }
    return out;
  },
  /** A radial star of spikes: star flowers, sea-urchin plants. */
  starFlower(p, c) {
    const out = [];
    const n = c.cnt(d(p, "spikes", 12));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      out.push(cone(c, 0.04, d(p, "len", 0.45), mixc(d(p, "c1", 0xff9a4a), d(p, "c2", 0xffe08a), i % 2), matrixOf({ y: 0.1, ry: a, rz: -(1.0 + (i % 3) * 0.15) }), { seg: 4 }));
    }
    out.push(sphere(c, 0.1, d(p, "centre", 0x5a2a6a), matrixOf({ y: 0.1 }), { seg: 7, rings: 5 }));
    return out;
  },
  /** Stalks topped with glassy crystal buds: crystalline plants. */
  crystalBloom(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng(),
        r = i === 0 ? 0 : c.r(0.1, d(p, "radius", 0.35)),
        h = d(p, "h", 0.9) * c.r(0.6, 1.15);
      out.push(...crystal(c, d(p, "w", 0.09), h, d(p, "c1", 0xa0e8ff), matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r, rx: c.r(-0.25, 0.25), rz: c.r(-0.25, 0.25) }), { sides: d(p, "sides", 6), tipColor: d(p, "c2", 0xffffff), shaft: d(p, "shaft", 0.7) }));
    }
    return out;
  },
  /** A coiled stalk ending in a pod: spiral alien plants. */
  spiralPod(p, c) {
    const h = d(p, "h", 1.1),
      turns = d(p, "turns", 3);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(V(Math.cos(t * turns * TAU) * 0.2 * (1 - t * 0.5), t * h, Math.sin(t * turns * TAU) * 0.2 * (1 - t * 0.5)));
    }
    const out = [limb(c, pts, 0.035, 0.015, d(p, "c1", 0x4a9a8a), { radial: 4, segments: 14 })];
    out.push(blob(c, d(p, "podR", 0.2), d(p, "c2", 0xff8a5a), matrixOf({ y: h + 0.1 }), { squash: 1.3, detail: 0, lump: 0.06 }));
    return out;
  },
  /** Arching stalks hung with bioluminescent lanterns. */
  lantern(p, c) {
    const out = [];
    const n = c.cnt(d(p, "stalks", 4)),
      h = d(p, "h", 1.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng(),
        e = V(Math.cos(a) * h * 0.6, h * c.r(0.6, 0.9), Math.sin(a) * h * 0.6);
      out.push(limb(c, [V(0, 0, 0), V(e.x * 0.3, e.y * 1.1, e.z * 0.3), e], 0.03, 0.015, d(p, "c1", 0x3a6a6a), { radial: 4 }));
      out.push(blob(c, d(p, "bulbR", 0.15), d(p, "c2", 0x9affd0), matrixOf({ x: e.x, y: e.y - 0.15, z: e.z }), { detail: 0, light: 0xffffff, lump: 0.05 }));
    }
    return out;
  },
};
export { shade };
