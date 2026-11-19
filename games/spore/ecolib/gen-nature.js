/**
 * Generators for fungi, aquatic life, geology and the props that dress a world: archetypes taking a
 * parameter object `p` and a build context `c` (see gen-util.js). The catalogue instantiates each
 * many times with different parameters.
 */
import { TAU_ as TAU, V, blade, blob, box, branches, cone, crystal, cyl, disc, dome, gradY, lathe, limb, matrixOf, mixc, placed, rock, scatter, sphere, torus } from "./gen-util.js";

const d = (p, k, v) => (p[k] === undefined ? v : p[k]);
const strata = (cols, y0, y1) => (x, y) => {
  const t = Math.max(0, Math.min(0.999, (y - y0) / (y1 - y0 || 1)));
  return gradY(cols[Math.floor(t * cols.length)], cols[Math.floor(t * cols.length)], 0, 1)(0, 0);
};
const ripple = (a, b, freq) => (x, y, z) => gradY(a, b, -1, 1)(0, Math.sin(x * freq) * Math.cos(z * freq * 1.3 + y * freq) * 0.9);

/* ================================ fungi ================================= */

const capFor = (c, kind, R, h, col, rim, at) => {
  const m = matrixOf({ y: at });
  if (kind === "flat") return dome(c, R, h * 0.45, col, m, { rim });
  if (kind === "cone") return cone(c, R, h * 1.1, col, m, { seg: 12, tip: rim });
  if (kind === "bell") return dome(c, R * 0.85, h * 1.3, col, m, { rim, arc: 1.9 });
  if (kind === "wavy") return blob(c, R, col, matrixOf({ y: at + h * 0.1 }), { squash: 0.45, lump: 0.28, light: rim });
  return dome(c, R, h, col, m, { rim });
};

export const FUNGUS_GENERATORS = {
  /** One mushroom, or a cluster: cap shape, stalk, gills, ring and spots are all parameters. */
  mushroom(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 1));
    for (let k = 0; k < n; k++) {
      const s = k === 0 ? 1 : c.r(0.45, 0.85);
      const ox = k === 0 ? 0 : Math.cos(k * 2.4) * d(p, "spread", 0.25),
        oz = k === 0 ? 0 : Math.sin(k * 2.4) * d(p, "spread", 0.25);
      const h = d(p, "h", 0.25) * s,
        R = d(p, "capR", 0.14) * s,
        sk = d(p, "stalk", "thin");
      const sr = sk === "thick" ? R * 0.42 : sk === "bulb" ? R * 0.3 : R * 0.2;
      const parts = [];
      if (sk === "bulb") parts.push(lathe(c, [[0.01, 0], [sr * 1.8, h * 0.1], [sr * 1.1, h * 0.4], [sr, h * 0.9], [sr * 0.9, h]], d(p, "stalkC", 0xeee6d2), null, { seg: 8 }));
      else parts.push(cyl(c, sr * 1.15, sr, h, d(p, "stalkC", 0xeee6d2), null, { seg: 7 }));
      parts.push(capFor(c, d(p, "cap", "convex"), R, h * 0.55, d(p, "c1", 0xc8502a), d(p, "c2", 0xf2a070), h * 0.95));
      if (d(p, "gills", 1) && d(p, "cap", "convex") !== "cone") parts.push(disc(c, R * 0.92, h * 0.05, d(p, "gillC", 0xd8c4a0), matrixOf({ y: h * 0.93 }), { seg: 12 }));
      if (d(p, "ring", 0)) parts.push(cyl(c, sr * 1.8, sr * 1.4, h * 0.05, 0xf4eedc, matrixOf({ y: h * 0.55 }), { seg: 8 }));
      const spots = c.cnt(d(p, "spots", 0));
      for (let i = 0; i < spots; i++) {
        const a = c.rng() * TAU,
          e = c.r(0.2, 0.85);
        parts.push(sphere(c, R * 0.09, d(p, "spotC", 0xfaf6ec), matrixOf({ x: Math.cos(a) * R * e, y: h * 0.95 + h * 0.55 * (1 - e * e) * 0.9, z: Math.sin(a) * R * e, sy: 0.5 }), { seg: 5, rings: 4 }));
      }
      out.push(...parts.flatMap((q) => placed(q, ox, 0, oz, 0, 1)));
    }
    return out;
  },
  /** Bracket fungi: half-discs stepping up a stub. */
  shelf(p, c) {
    const out = [cyl(c, d(p, "stubR", 0.14), d(p, "stubR", 0.14) * 0.8, d(p, "stubH", 0.7), d(p, "stub", 0x5a4630), null, { seg: 7 })];
    const n = c.cnt(d(p, "tiers", 4)),
      R = d(p, "r", 0.3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.2;
      out.push(dome(c, R * (1 - i * 0.12), R * 0.22, mixc(d(p, "c1", 0xc87a3a), d(p, "c2", 0xf0c080), i / n), matrixOf({ x: Math.cos(a) * 0.12, y: 0.12 + i * d(p, "stubH", 0.7) * 0.2, z: Math.sin(a) * 0.12, ry: -a, sx: 1, sz: 0.8 }), { rim: d(p, "c2", 0xf0c080), arc: Math.PI / 2 }));
    }
    return out;
  },
  /** A round puffball on a small base. */
  puffball(p, c) {
    const R = d(p, "r", 0.2);
    const out = [blob(c, R, d(p, "c1", 0xece4d0), matrixOf({ y: R * 0.9 }), { squash: d(p, "squash", 0.9), lump: 0.06, light: 0xffffff })];
    out.push(sphere(c, R * 0.12, d(p, "pore", 0x5a4a38), matrixOf({ y: R * 1.85 }), { seg: 5, rings: 4 }));
    for (let i = 0; i < c.cnt(d(p, "babies", 2)); i++) out.push(blob(c, R * 0.45, d(p, "c1", 0xece4d0), matrixOf({ x: Math.cos(i * 3 + 1) * R * 1.5, y: R * 0.4, z: Math.sin(i * 3 + 1) * R * 1.5 }), { lump: 0.06, detail: 0 }));
    return out;
  },
  /** Tall stalk with a netted bell cap and dark slime: stinkhorns. */
  stinkhorn(p, c) {
    const h = d(p, "h", 0.5);
    return [lathe(c, [[0.01, 0], [h * 0.08, h * 0.05], [h * 0.06, h * 0.5], [h * 0.07, h * 0.9]], d(p, "c1", 0xf0e8d0), null, { seg: 8 }), lathe(c, [[h * 0.07, h * 0.8], [h * 0.12, h * 0.92], [h * 0.09, h * 1.05], [0.01, h * 1.1]], d(p, "c2", 0x6a5a2a), null, { seg: 9, tip: d(p, "slime", 0x3a4a20) }), sphere(c, h * 0.1, d(p, "egg", 0xf0ead8), matrixOf({ y: h * 0.02, sy: 0.7 }), { seg: 7 })];
  },
  /** A honeycombed conical cap on a pale stem: morels. */
  morel(p, c) {
    const h = d(p, "h", 0.3);
    return [cyl(c, h * 0.12, h * 0.1, h * 0.55, d(p, "stalkC", 0xe8dcc0), null, { seg: 7 }), { ...cone(c, h * 0.2, h * 0.7, d(p, "c1", 0x8a6a3a), matrixOf({ y: h * 0.45 }), { seg: 10, tip: d(p, "c2", 0x5a4222) }), colorAt: ripple(d(p, "c1", 0x8a6a3a), d(p, "c2", 0x5a4222), 38) }];
  },
  /** Branching coral-like fungus. */
  coralFungus(p, c) {
    return branches(c, { levels: d(p, "levels", 3), len: d(p, "len", 0.3), r: d(p, "r", 0.04), spread: 0.6, shrink: 0.75, thin: 0.7, kids: [2, 3], up: 0.4, curl: 0.2, color: d(p, "c1", 0xe8a0b8), tip: d(p, "c2", 0xfff0d8), trunkBare: 0.15, budget: 140 });
  },
  /** A cluster of cup-shaped fungi. */
  cups(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 6)); i++) {
      const s = c.r(0.5, 1),
        a = c.rng() * TAU,
        r = c.r(0, 0.25);
      out.push(...placed(lathe(c, [[0.01, 0], [0.025 * s, 0.05 * s], [0.07 * s, 0.1 * s], [0.12 * s, 0.17 * s], [0.1 * s, 0.17 * s]], d(p, "c1", 0xe8803a), null, { seg: 9, tip: d(p, "c2", 0xffc070) }), Math.cos(a) * r, 0, Math.sin(a) * r, 0, 1));
    }
    return out;
  },
  /** A giant mushroom: a huge cap with a gill skirt on a thick stalk, sometimes with a ring and glowing underside. */
  giantCap(p, c) {
    const h = d(p, "h", 6),
      R = d(p, "capR", 3.2),
      sr = d(p, "stalkR", h * 0.09);
    const out = [lathe(c, [[sr * 1.9, 0], [sr * 1.2, h * 0.15], [sr, h * 0.5], [sr * 1.05, h * 0.9]], d(p, "stalkC", 0xe6dcc4), null, { seg: 12, tip: d(p, "stalkTip", undefined) })];
    out.push(capFor(c, d(p, "cap", "convex"), R, h * d(p, "capH", 0.28), d(p, "c1", 0x7a4ad0), d(p, "c2", 0xc89aff), h * 0.88));
    out.push(disc(c, R * 0.95, 0.12, d(p, "gillC", 0xd8a0ff), matrixOf({ y: h * 0.87 }), { seg: 18, top: 0.6 }));
    if (d(p, "ring", 1)) out.push(disc(c, sr * 2.4, 0.1, 0xf4eedc, matrixOf({ y: h * 0.62 }), { seg: 12, top: 0.4 }));
    const spots = c.cnt(d(p, "spots", 0));
    for (let i = 0; i < spots; i++) {
      const a = c.rng() * TAU,
        e = c.r(0.25, 0.85);
      out.push(sphere(c, R * 0.1, d(p, "spotC", 0xffffff), matrixOf({ x: Math.cos(a) * R * e, y: h * 0.88 + h * d(p, "capH", 0.28) * (1 - e * e) * 0.95, z: Math.sin(a) * R * e, sy: 0.4 }), { seg: 6, rings: 4 }));
    }
    return out;
  },
  /** Several caps stacked up a stalk like a pagoda. */
  pagoda(p, c) {
    const h = d(p, "h", 8),
      n = c.cnt(d(p, "tiers", 4)),
      R = d(p, "capR", 2.6);
    const out = [cyl(c, h * 0.06, h * 0.035, h, d(p, "stalkC", 0xe0d4bc), null, { seg: 8 })];
    for (let i = 0; i < n; i++) {
      const t = i / n,
        r = R * (1 - t * 0.7);
      out.push(dome(c, r, r * 0.35, mixc(d(p, "c1", 0xd05a4a), d(p, "c2", 0xffa078), t), matrixOf({ y: h * (0.22 + t * 0.7) }), { seg: 14, rim: d(p, "c2", 0xffa078) }));
    }
    return out;
  },
  /** A stalk forking into arms that each carry a cap. */
  forkedCaps(p, c) {
    const h = d(p, "h", 7),
      n = c.cnt(d(p, "arms", 4));
    const out = [limb(c, [V(0, 0, 0), V(0.1, h * 0.35, 0), V(0, h * 0.55, 0)], h * 0.07, h * 0.05, d(p, "stalkC", 0xe6dcc4), { radial: 8 })];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.5,
        e = V(Math.cos(a) * h * 0.3, h * c.r(0.75, 1), Math.sin(a) * h * 0.3);
      out.push(limb(c, [V(0, h * 0.55, 0), V(e.x * 0.5, h * 0.7, e.z * 0.5), e], h * 0.035, h * 0.02, d(p, "stalkC", 0xe6dcc4), { radial: 5 }));
      out.push(dome(c, h * c.r(0.14, 0.22), h * 0.07, mixc(d(p, "c1", 0x2aa88a), d(p, "c2", 0x8affd8), c.rng()), matrixOf({ x: e.x, y: e.y, z: e.z }), { seg: 12, rim: d(p, "c2", 0x8affd8) }));
    }
    return out;
  },
  /** A tall cone-spired fungus, stacked: spire fungi. */
  spire(p, c) {
    const h = d(p, "h", 7);
    const out = [];
    const n = c.cnt(d(p, "tiers", 5));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out.push(cone(c, (h * 0.22) * (1 - t * 0.8), (h * 0.34) * (1 - t * 0.3), mixc(d(p, "c1", 0x9a5ad0), d(p, "c2", 0xe0a8ff), t), matrixOf({ y: h * 0.7 * t, ry: i }), { seg: d(p, "sides", 7) }));
    }
    return out;
  },
  /** A bulbous ball cap on a short stalk: puff-top giants. */
  bulbCap(p, c) {
    const h = d(p, "h", 5),
      R = d(p, "capR", 2);
    const out = [cyl(c, h * 0.12, h * 0.09, h * 0.5, d(p, "stalkC", 0xe0d4bc), null, { seg: 8 })];
    out.push(blob(c, R, d(p, "c1", 0xe8a040), matrixOf({ y: h * 0.5 + R * 0.8 }), { squash: 0.9, lump: 0.1, light: d(p, "c2", 0xffe0a0) }));
    for (let i = 0; i < c.cnt(d(p, "orbs", 5)); i++) out.push(sphere(c, R * 0.16, d(p, "glow", 0xfff0a0), matrixOf({ x: Math.cos(i * 1.7) * R * 0.85, y: h * 0.5 + R * (0.5 + (i % 3) * 0.35), z: Math.sin(i * 1.7) * R * 0.85 }), { seg: 6, rings: 4 }));
    return out;
  },
  /** Huge shelf brackets climbing a thick column. */
  shelfTower(p, c) {
    const h = d(p, "h", 8);
    const out = [cyl(c, h * 0.1, h * 0.07, h, d(p, "stalkC", 0x5a4a40), null, { seg: 8 })];
    const n = c.cnt(d(p, "shelves", 6));
    for (let i = 0; i < n; i++) {
      const a = i * 2.4,
        R = d(p, "capR", 1.8) * (1 - (i / n) * 0.45);
      out.push(dome(c, R, R * 0.28, mixc(d(p, "c1", 0xb05a30), d(p, "c2", 0xf0b070), i / n), matrixOf({ x: Math.cos(a) * h * 0.07, y: h * (0.12 + (i / n) * 0.8), z: Math.sin(a) * h * 0.07, ry: -a, sz: 0.75 }), { rim: d(p, "c2", 0xf0b070) }));
    }
    return out;
  },
};

/* ============================= aquatic & coral ============================= */

export const AQUATIC_GENERATORS = {
  /** Tall wavy kelp strands with leaf blades along them. */
  kelp(p, c) {
    const out = [];
    const n = c.cnt(d(p, "strands", 4)),
      h = d(p, "h", 4);
    for (let i = 0; i < n; i++) {
      const a = c.rng() * TAU,
        r = c.r(0.05, 0.35),
        x0 = Math.cos(a) * r,
        z0 = Math.sin(a) * r,
        hh = h * c.r(0.7, 1.1),
        ph = c.rng() * 6;
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push(V(x0 + Math.sin(k * 0.9 + ph) * 0.25, (k / 6) * hh, z0 + Math.cos(k * 0.7 + ph) * 0.2));
      out.push(limb(c, pts, 0.04, 0.015, d(p, "c1", 0x5a7a2a), { radial: 4, segments: 10 }));
      for (let k = 1; k < c.cnt(d(p, "blades", 6)); k++) {
        const t = k / d(p, "blades", 6),
          at = pts[Math.min(6, Math.round(t * 6))];
        out.push(blade(c, d(p, "bladeLen", 0.9), d(p, "bladeW", 0.22), 0.35, mixc(d(p, "c1", 0x5a7a2a), d(p, "c2", 0x9ab04a), t), matrixOf({ x: at.x, y: at.y, z: at.z, ry: k * 2.1, rz: -0.9 }), { tip: d(p, "c2", 0x9ab04a), taper: false }));
      }
    }
    return out;
  },
  /** Long ribbon blades swaying together: seagrass and eelgrass. */
  seagrass(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 14)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, d(p, "radius", 0.3));
      out.push(blade(c, d(p, "h", 1.1) * c.r(0.6, 1.2), d(p, "w", 0.07), c.r(-0.5, 0.5), d(p, "c1", 0x4a8a5a), matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r, ry: c.rng() * TAU }), { tip: d(p, "c2", 0x9ad08a), taper: true }));
    }
    return out;
  },
  /** A floating pad with a notch, optionally a flower. */
  lilyPad(p, c) {
    const R = d(p, "r", 0.5);
    const out = [];
    const n = c.cnt(d(p, "pads", 1));
    for (let i = 0; i < n; i++) {
      const a = i * 2.4,
        r = i ? R * 1.3 : 0,
        s = i ? 0.75 : 1;
      out.push(...placed([disc(c, R * s, 0.03, mixc(d(p, "c1", 0x3a8a4a), d(p, "c2", 0x6ac060), (i % 3) / 2), null, { seg: 14, top: 1 }), cone(c, R * 0.18 * s, 0.01, d(p, "c1", 0x3a8a4a), matrixOf({ x: R * 0.9 * s, y: 0.025 }), { seg: 3 })], Math.cos(a) * r, 0, Math.sin(a) * r, a, 1));
    }
    if (d(p, "flower", 1)) for (let i = 0; i < 7; i++) out.push(cone(c, 0.05, 0.22, mixc(d(p, "petal", 0xffc0e0), 0xffffff, i % 2), matrixOf({ y: 0.03, ry: (i / 7) * TAU, rz: -0.6 }), { seg: 4 }));
    return out;
  },
  /** A fleshy base ringed with waving tentacles. */
  anemone(p, c) {
    const out = [lathe(c, [[0.01, 0], [d(p, "r", 0.25), 0.04], [d(p, "r", 0.25) * 0.8, d(p, "h", 0.35)], [d(p, "r", 0.25) * 0.9, d(p, "h", 0.35) + 0.03]], d(p, "c1", 0xc85a8a), null, { seg: 10 })];
    const n = c.cnt(d(p, "n", 22));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU,
        ring = i % 2 ? 0.55 : 1,
        L = d(p, "len", 0.45) * (0.7 + (i % 3) * 0.2);
      const r0 = d(p, "r", 0.25) * 0.85 * ring;
      out.push(limb(c, [V(Math.cos(a) * r0, d(p, "h", 0.35), Math.sin(a) * r0), V(Math.cos(a) * (r0 + L * 0.3), d(p, "h", 0.35) + L * 0.6, Math.sin(a) * (r0 + L * 0.3)), V(Math.cos(a + 0.4) * (r0 + L * 0.5), d(p, "h", 0.35) + L, Math.sin(a + 0.4) * (r0 + L * 0.5))], 0.025, 0.008, d(p, "c1", 0xc85a8a), { radial: 3, segments: 4, tip: d(p, "c2", 0xffd0e8) }));
    }
    return out;
  },
  /** Cluster of hollow tube sponges. */
  sponge(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "tubes", 5)); i++) {
      const a = i * 2.4,
        r = i ? c.r(0.15, 0.4) : 0,
        h = d(p, "h", 0.8) * c.r(0.5, 1.1),
        R = d(p, "tubeR", 0.12) * c.r(0.8, 1.3);
      out.push(...placed([lathe(c, [[R * 0.6, 0], [R, h * 0.3], [R * 1.1, h * 0.7], [R * 0.95, h], [R * 0.7, h * 0.97]], mixc(d(p, "c1", 0xe0a040), d(p, "c2", 0xf8d890), i / 5), null, { seg: 9, tip: d(p, "c2", 0xf8d890) }), disc(c, R * 0.7, 0.01, 0x4a2a10, matrixOf({ y: h * 0.96 }), { seg: 8 })], Math.cos(a) * r, 0, Math.sin(a) * r, 0, 1));
    }
    return out;
  },
  /** A flat lattice fan on a stalk: sea fans. */
  seaFan(p, c) {
    const h = d(p, "h", 1),
      R = d(p, "r", 0.55);
    const out = [cyl(c, 0.05, 0.03, h * 0.3, d(p, "c1", 0xd0407a), null, { seg: 5 })];
    out.push({ ...sphere(c, R, d(p, "c1", 0xd0407a), matrixOf({ y: h * 0.3 + R * 0.9, sz: 0.04, sy: 1.1 }), { seg: 16, rings: 10 }), colorAt: ripple(d(p, "c1", 0xd0407a), d(p, "c2", 0xffa0c0), 14) });
    for (let i = 0; i < c.cnt(5); i++) out.push(limb(c, [V(0, h * 0.3, 0), V((i - 2) * R * 0.35, h * 0.3 + R * 1.1, 0)], 0.02, 0.01, d(p, "c1", 0xd0407a), { radial: 3, segments: 2 }));
    return out;
  },
  /** Clustered tube worms with feathery crowns. */
  tubeWorms(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 7)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, 0.3),
        h = d(p, "h", 0.5) * c.r(0.5, 1.1),
        x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      out.push(limb(c, [V(x, 0, z), V(x + 0.04, h * 0.5, z), V(x, h, z + 0.03)], 0.045, 0.035, d(p, "c1", 0xe8e0d0), { radial: 5, segments: 4 }));
      for (let k = 0; k < 5; k++) out.push(cone(c, 0.02, 0.18, mixc(d(p, "c2", 0xe04a5a), 0xffffff, (k % 2) * 0.3), matrixOf({ x, y: h, z, ry: (k / 5) * TAU, rz: -0.7 }), { seg: 3 }));
    }
    return out;
  },
  /** A feather star: a stalk with radiating arms. */
  crinoid(p, c) {
    const out = [limb(c, [V(0, 0, 0), V(0.05, d(p, "h", 0.7) * 0.5, 0), V(0, d(p, "h", 0.7), 0)], 0.03, 0.025, d(p, "c1", 0xf0a030), { radial: 4 })];
    const n = c.cnt(d(p, "arms", 10));
    for (let i = 0; i < n; i++) out.push(blade(c, d(p, "armLen", 0.5), 0.05, 0.6, mixc(d(p, "c1", 0xf0a030), d(p, "c2", 0xffe080), i % 2), matrixOf({ y: d(p, "h", 0.7), ry: (i / n) * TAU, rz: -0.9 }), { taper: true }));
    return out;
  },
  /** A central stem with leafy side-fronds: sea pens. */
  seaPen(p, c) {
    const h = d(p, "h", 0.9);
    const out = [limb(c, [V(0, 0, 0), V(0.03, h * 0.5, 0), V(0, h, 0)], 0.04, 0.02, d(p, "c1", 0xc87aa0), { radial: 5 })];
    const n = c.cnt(d(p, "pairs", 9));
    for (let i = 0; i < n; i++) {
      const t = 0.25 + 0.7 * (i / n);
      for (const s of [-1, 1]) out.push(blade(c, h * 0.3 * (1.1 - t * 0.6), 0.07, 0.3, mixc(d(p, "c1", 0xc87aa0), d(p, "c2", 0xffc8e0), t), matrixOf({ y: h * t, ry: s > 0 ? 0 : Math.PI, rz: -1.1 }), { taper: false }));
    }
    return out;
  },
  /** Branching coral: staghorn, elkhorn, finger. */
  branchCoral(p, c) {
    return branches(c, { levels: d(p, "levels", 3), len: d(p, "len", 0.5), r: d(p, "r", 0.07), spread: d(p, "spread", 0.55), shrink: d(p, "shrink", 0.78), thin: 0.72, kids: d(p, "kids", [2, 3]), up: d(p, "up", 0.5), curl: 0.2, color: d(p, "c1", 0xe8704a), tip: d(p, "c2", 0xffc8a0), trunkBare: 0.2, budget: 180 });
  },
  /** Grooved domed coral: brain coral. */
  brainCoral(p, c) {
    const R = d(p, "r", 0.5);
    return [{ ...blob(c, R, d(p, "c1", 0xc8b04a), matrixOf({ y: R * 0.35 }), { squash: d(p, "squash", 0.7), lump: 0.05, detail: c.lod ? 1 : 2 }), colorAt: ripple(d(p, "c1", 0xc8b04a), d(p, "c2", 0x7a6a22), d(p, "groove", 22)) }];
  },
  /** A flat plate on a stalk: table coral. */
  tableCoral(p, c) {
    const R = d(p, "r", 0.9);
    const out = [cyl(c, R * 0.12, R * 0.09, d(p, "h", 0.5), d(p, "c1", 0x6a8ad0), null, { seg: 7 })];
    for (let i = 0; i < c.cnt(d(p, "plates", 2)); i++) out.push(disc(c, R * (1 - i * 0.35), 0.06, mixc(d(p, "c1", 0x6a8ad0), d(p, "c2", 0xa8c8ff), i / 2), matrixOf({ y: d(p, "h", 0.5) + i * 0.16, ry: i }), { seg: 16, top: 0.85, tip: d(p, "c2", 0xa8c8ff) }));
    return out;
  },
  /** Rounded columns: pillar coral. */
  pillarCoral(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 5)); i++) {
      const a = i * 2.4,
        r = i ? c.r(0.15, 0.5) : 0,
        h = d(p, "h", 0.9) * c.r(0.5, 1.1),
        R = d(p, "colR", 0.12) * c.r(0.8, 1.3);
      out.push(...placed([cyl(c, R * 1.1, R, h, mixc(d(p, "c1", 0x8a5ac0), d(p, "c2", 0xd0a0ff), i / 5), null, { seg: 8 }), dome(c, R, R, d(p, "c2", 0xd0a0ff), matrixOf({ y: h }), { seg: 8 })], Math.cos(a) * r, 0, Math.sin(a) * r, 0, 1));
    }
    return out;
  },
  /** A cluster of glassy bubbles: bubble coral. */
  bubbleCoral(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 12)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, d(p, "r", 0.4)),
        s = c.r(0.07, 0.16);
      out.push(sphere(c, s, mixc(d(p, "c1", 0x8affd0), d(p, "c2", 0xe0fff4), c.rng()), matrixOf({ x: Math.cos(a) * r, y: s + c.r(0, 0.2), z: Math.sin(a) * r }), { seg: 8, rings: 6 }));
    }
    return out;
  },
  /** A ruffled, folded sheet: lettuce / leaf coral. */
  leafCoral(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 7)); i++) {
      const a = (i / 7) * TAU * 1.7;
      out.push(blade(c, d(p, "h", 0.7) * (0.6 + (i % 3) * 0.2), 0.5, 0.4, mixc(d(p, "c1", 0x6ac0a0), d(p, "c2", 0xd0ffe8), (i % 4) / 3), matrixOf({ x: Math.cos(a) * 0.12, z: Math.sin(a) * 0.12, ry: a, rz: -0.25 }), { taper: false }));
    }
    return out;
  },
};

/* ================================== geology ================================= */

export const GEO_GENERATORS = {
  /** One boulder or a heap of them. */
  boulder(p, c) {
    const R = d(p, "r", 0.8),
      n = c.cnt(d(p, "n", 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.4,
        r = i ? R * c.r(0.7, 1.2) : 0,
        s = i ? c.r(0.35, 0.65) : 1;
      out.push(rock(c, R * s, mixc(d(p, "c1", 0x8a8478), d(p, "c2", 0xa8a090), c.rng()), matrixOf({ x: Math.cos(a) * r, y: R * s * 0.35, z: Math.sin(a) * r, ry: c.rng() * 3 }), { squash: d(p, "squash", 0.7), lump: d(p, "lump", 0.28), light: d(p, "moss", undefined) }));
    }
    return out;
  },
  /** A bed of small stones. */
  pebbles(p, c) {
    return scatter(c, d(p, "n", 22), d(p, "radius", 0.9), (x, z) => placed(rock(c, c.r(0.05, d(p, "max", 0.14)), mixc(d(p, "c1", 0x8a8478), d(p, "c2", 0xc8c0aa), c.rng()), matrixOf({ y: 0.03 }), { squash: 0.6, detail: 0 }), x, 0, z, c.rng() * 3));
  },
  /** A wide flat slab, maybe tilted: flagstone, shale plate. */
  slab(p, c) {
    const w = d(p, "w", 2),
      t = d(p, "t", 0.3);
    return [{ ...box(c, w, t, w * d(p, "ratio", 0.7), d(p, "c1", 0x9a9486), matrixOf({ ry: d(p, "yaw", 0.3), rz: d(p, "tilt", 0.1) })), colorAt: strata([d(p, "c1", 0x9a9486), d(p, "c2", 0x7a7466)], 0, t) }];
  },
  /** A tall, jagged spire: a tapering stack of tilting blocks. */
  spire(p, c) {
    const h = d(p, "h", 5),
      n = c.cnt(d(p, "blocks", 6));
    const out = [];
    let y = 0,
      off = V(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const t = i / n,
        bh = (h / n) * c.r(0.9, 1.3),
        R = d(p, "r", 1.2) * (1 - t * 0.85);
      out.push(rock(c, R, mixc(d(p, "c1", 0x7a7468), d(p, "c2", 0xb0a890), t), matrixOf({ x: off.x, y: y + bh * 0.4, z: off.z, ry: i, sy: bh / R }), { squash: 1, lump: 0.22, detail: 0 }));
      y += bh * 0.8;
      off = V(off.x + c.r(-0.12, 0.12) * R, 0, off.z + c.r(-0.12, 0.12) * R);
    }
    return out;
  },
  /** Balanced stones, tallest in the middle. */
  stack(p, c) {
    const out = [];
    let y = 0;
    const n = c.cnt(d(p, "n", 4));
    for (let i = 0; i < n; i++) {
      const R = d(p, "r", 0.7) * (1 - i * 0.18);
      out.push(rock(c, R, mixc(d(p, "c1", 0x8a8478), d(p, "c2", 0xb8b0a0), i / n), matrixOf({ x: c.r(-0.08, 0.08), y: y + R * 0.3, z: c.r(-0.08, 0.08), ry: i * 1.3 }), { squash: 0.6 }));
      y += R * 0.6;
    }
    return out;
  },
  /** A rock arch: two piers and a curved lintel. */
  arch(p, c) {
    const w = d(p, "w", 5),
      h = d(p, "h", 4);
    const col = d(p, "c1", 0xb0805a);
    const out = [];
    for (const s of [-1, 1]) out.push(rock(c, h * 0.35, col, matrixOf({ x: (s * w) / 2, y: h * 0.35, sy: 1.5 }), { squash: 1, lump: 0.2 }));
    out.push({ ...torus(c, w / 2, h * 0.12, col, matrixOf({ y: h * 0.55, sy: (h * 0.8) / (w / 2), rz: 0 })), colorAt: strata([d(p, "c1", 0xb0805a), d(p, "c2", 0xd0a070)], 0, h) });
    return out;
  },
  /** Flat-topped, banded mesa or butte. */
  mesa(p, c) {
    const R = d(p, "r", 3),
      h = d(p, "h", 4);
    const bands = d(p, "bands", [0xb06a3a, 0xd09060, 0x8a4a2a, 0xe0b080]);
    const g = { ...cyl(c, R * 1.15, R * 0.85, h, bands[0], null, { seg: 11 }), colorAt: strata(bands, 0, h) };
    return [g, disc(c, R * 0.86, 0.15, d(p, "top", 0x9a7a4a), matrixOf({ y: h }), { seg: 11 }), rock(c, R * 0.35, bands[1], matrixOf({ x: R * 0.9, y: R * 0.12 }), { squash: 0.6 })];
  },
  /** Hexagonal basalt columns of different heights. */
  basalt(p, c) {
    const out = [];
    const rings = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos((i * TAU) / 6) * 0.62, Math.sin((i * TAU) / 6) * 0.62]), ...(d(p, "big", 1) ? Array.from({ length: 6 }, (_, i) => [Math.cos(((i + 0.5) * TAU) / 6) * 1.2, Math.sin(((i + 0.5) * TAU) / 6) * 1.2]) : [])];
    for (const [x, z] of rings) {
      const h = d(p, "h", 2.4) * c.r(0.35, 1);
      out.push(cyl(c, 0.34, 0.34, h, mixc(d(p, "c1", 0x3a3e46), d(p, "c2", 0x5a606c), c.rng()), matrixOf({ x, z, ry: 0.5 }), { seg: 6 }));
    }
    return out;
  },
  /** A sandstone hoodoo: a pillar with a capstone. */
  hoodoo(p, c) {
    const h = d(p, "h", 4.5);
    const cols = d(p, "bands", [0xd08a5a, 0xe8b080, 0xb86a40]);
    return [{ ...lathe(c, [[h * 0.2, 0], [h * 0.12, h * 0.25], [h * 0.16, h * 0.55], [h * 0.1, h * 0.78], [h * 0.2, h * 0.84], [h * 0.22, h * 0.95], [h * 0.08, h]], cols[0], null, { seg: 10 }), colorAt: strata(cols, 0, h) }];
  },
  /** Stacked rounded blocks: granite tors. */
  tor(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 5));
    for (let i = 0; i < n; i++) {
      const R = d(p, "r", 1.4) * c.r(0.55, 1);
      out.push(rock(c, R, mixc(d(p, "c1", 0x8a8a84), d(p, "c2", 0xb0b0a8), c.rng()), matrixOf({ x: c.r(-1, 1) * 0.8, y: (i / n) * d(p, "h", 3.5) + R * 0.4, z: c.r(-1, 1) * 0.8, ry: c.rng() * 3 }), { squash: 0.65, lump: 0.18 }));
    }
    return out;
  },
  /** Cones of dripped mineral rising from the floor: stalagmite fields. */
  stalagmites(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 7)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, d(p, "radius", 1.2)),
        h = d(p, "h", 2) * c.r(0.3, 1);
      out.push(cone(c, h * 0.16, h, mixc(d(p, "c1", 0xc8c0aa), d(p, "c2", 0xf0ead8), c.rng()), matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r }), { seg: 7 }));
    }
    return out;
  },
  /** A mound with a vent: geysers, fumaroles, mud volcanoes. */
  vent(p, c) {
    const h = d(p, "h", 1.1),
      R = d(p, "r", 1.6);
    return [{ ...cone(c, R, h, d(p, "c1", 0xc8b890), null, { seg: 14 }), colorAt: gradY(d(p, "c1", 0xc8b890), d(p, "c2", 0xf0e8c8), 0, h) }, disc(c, R * 0.22, 0.05, d(p, "hole", 0x3a2a1a), matrixOf({ y: h * 0.985 }), { seg: 10 }), torus(c, R * 0.24, 0.07, d(p, "rim", 0xe8d8a8), matrixOf({ y: h * 0.99, rx: Math.PI / 2 }))];
  },
  /** Stepped terraces of mineral pools. */
  terrace(p, c) {
    const out = [];
    const n = c.cnt(d(p, "steps", 4)),
      R = d(p, "r", 2);
    for (let i = 0; i < n; i++) out.push(disc(c, R * (1 - i * 0.2), 0.16, mixc(d(p, "c1", 0xf0e0c0), d(p, "c2", 0x70d0d8), i / n), matrixOf({ y: i * 0.16, ry: i }), { seg: 13, top: 0.95, tip: d(p, "c2", 0x70d0d8) }));
    return out;
  },
  /** A rocky ridge: a row of tilted slabs. */
  ridge(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 6));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5,
        h = d(p, "h", 2) * (1 - Math.abs(t) * 1.1);
      out.push(rock(c, h * 0.8, mixc(d(p, "c1", 0x7a7468), d(p, "c2", 0xa8a090), c.rng()), matrixOf({ x: t * d(p, "len", 6), y: h * 0.3, z: c.r(-0.2, 0.2), sy: 1.4, ry: c.r(-0.4, 0.4) }), { squash: 1, lump: 0.22, detail: 0 }));
    }
    return out;
  },
  /** A cluster of crystals growing from a point. */
  crystalCluster(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + c.rng() * 0.4,
        lean = i === 0 ? 0 : c.r(0.2, d(p, "lean", 0.6));
      const h = d(p, "h", 1.4) * (i === 0 ? 1 : c.r(0.4, 0.85));
      out.push(...crystal(c, d(p, "w", 0.2) * c.r(0.7, 1.2), h, mixc(d(p, "c1", 0x9a6ae0), d(p, "c2", 0xe0c8ff), c.rng() * 0.6), matrixOf({ x: Math.cos(a) * lean * 0.3, z: Math.sin(a) * lean * 0.3, rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean }), { sides: d(p, "sides", 6), tipColor: d(p, "tip", 0xffffff), shaft: d(p, "shaft", 0.7), taper: d(p, "taper", 1) }));
    }
    out.push(rock(c, d(p, "base", 0.4), d(p, "baseC", 0x5a5460), matrixOf({ y: 0.08 }), { squash: 0.4 }));
    return out;
  },
  /** One enormous crystal spire. */
  crystalSpire(p, c) {
    const out = [...crystal(c, d(p, "w", 0.8), d(p, "h", 6), d(p, "c1", 0x6ad8ff), matrixOf({ rz: d(p, "lean", 0.08) }), { sides: d(p, "sides", 5), tipColor: d(p, "tip", 0xe8fcff), shaft: d(p, "shaft", 0.8) })];
    for (let i = 0; i < c.cnt(3); i++) out.push(...crystal(c, d(p, "w", 0.8) * 0.4, d(p, "h", 6) * 0.35, d(p, "c1", 0x6ad8ff), matrixOf({ x: Math.cos(i * 2.2) * d(p, "w", 0.8) * 1.3, z: Math.sin(i * 2.2) * d(p, "w", 0.8) * 1.3, rz: Math.cos(i) * 0.35, rx: Math.sin(i) * 0.35 }), { sides: d(p, "sides", 5), tipColor: d(p, "tip", 0xe8fcff) }));
    return out;
  },
  /** A low bed of many short crystals. */
  crystalBed(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 18)); i++) {
      const a = c.rng() * TAU,
        r = Math.sqrt(c.rng()) * d(p, "radius", 1);
      out.push(...crystal(c, 0.05 + c.rng() * 0.05, d(p, "h", 0.5) * c.r(0.4, 1.1), mixc(d(p, "c1", 0xff7ac8), d(p, "c2", 0xffd0ec), c.rng()), matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r, rx: c.r(-0.4, 0.4), rz: c.r(-0.4, 0.4) }), { sides: 5, tipColor: 0xffffff }));
    }
    return out;
  },
  /** A split rock with a crystal-lined cavity: geodes. */
  geode(p, c) {
    const R = d(p, "r", 0.7);
    const out = [rock(c, R, d(p, "c1", 0x6a6258), matrixOf({ y: R * 0.5 }), { squash: 0.8, lump: 0.2 })];
    out.push(disc(c, R * 0.62, 0.05, d(p, "inner", 0x3a2a5a), matrixOf({ y: R * 1.05 }), { seg: 10 }));
    for (let i = 0; i < c.cnt(d(p, "n", 9)); i++) {
      const a = (i / 9) * TAU,
        r = R * c.r(0.1, 0.5);
      out.push(...crystal(c, R * 0.07, R * c.r(0.25, 0.45), mixc(d(p, "c2", 0xc080ff), 0xffffff, c.rng() * 0.5), matrixOf({ x: Math.cos(a) * r, y: R * 1.05, z: Math.sin(a) * r, rx: Math.sin(a) * 0.3, rz: -Math.cos(a) * 0.3 }), { sides: 5, tipColor: 0xffffff }));
    }
    return out;
  },
  /** Dark rock veined with glowing cracks: lava rock. */
  lavaRock(p, c) {
    const R = d(p, "r", 0.9);
    const out = [rock(c, R, d(p, "c1", 0x2a2226), matrixOf({ y: R * 0.35 }), { squash: 0.65, lump: 0.32 })];
    for (let i = 0; i < c.cnt(d(p, "veins", 6)); i++) {
      const a = (i / 6) * TAU;
      out.push(limb(c, [V(Math.cos(a) * R * 0.3, R * 0.55, Math.sin(a) * R * 0.3), V(Math.cos(a + 0.3) * R * 0.7, R * 0.4, Math.sin(a + 0.3) * R * 0.7), V(Math.cos(a + 0.2) * R * 0.95, R * 0.12, Math.sin(a + 0.2) * R * 0.95)], 0.035, 0.02, d(p, "glow", 0xff7a1a), { radial: 3, segments: 4 }));
    }
    return out;
  },
  /** Sharp spikes of ice. */
  iceSpikes(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 7)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, 0.7);
      out.push(...crystal(c, d(p, "w", 0.18) * c.r(0.7, 1.3), d(p, "h", 1.8) * c.r(0.35, 1), mixc(d(p, "c1", 0xb8e8ff), 0xffffff, c.rng() * 0.5), matrixOf({ x: Math.cos(a) * r, z: Math.sin(a) * r, rx: c.r(-0.2, 0.2), rz: c.r(-0.2, 0.2) }), { sides: 4, tipColor: 0xffffff, shaft: 0.45 }));
    }
    return out;
  },
};

/* ======================= fossils, ruins, decorations, props ======================= */

export const PROP_GENERATORS = {
  /** A ribcage arching up from a spine. */
  ribcage(p, c) {
    const out = [];
    const n = c.cnt(d(p, "ribs", 7)),
      L = d(p, "len", 3),
      R = d(p, "r", 1.1);
    out.push(limb(c, [V(-L / 2, 0.12, 0), V(0, 0.18, 0), V(L / 2, 0.12, 0)], 0.1, 0.07, d(p, "c1", 0xe8dcc0), { radial: 5 }));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i / (n - 1)) * L,
        k = Math.sin((i / (n - 1)) * Math.PI) * 0.6 + 0.4;
      for (const s of [-1, 1]) out.push(limb(c, [V(x, 0.15, 0), V(x, R * k * 0.8, s * R * k * 0.5), V(x + 0.05, R * k * 0.55, s * R * k * 0.95)], 0.05, 0.025, d(p, "c1", 0xe8dcc0), { radial: 4, segments: 5 }));
    }
    return out;
  },
  /** A skull: braincase, snout and teeth. */
  skull(p, c) {
    const R = d(p, "r", 0.6);
    const col = d(p, "c1", 0xe8dcc0);
    const out = [blob(c, R, col, matrixOf({ y: R * 0.8 }), { squash: 0.85, lump: 0.08 }), blob(c, R * 0.55, col, matrixOf({ x: R * 1.1, y: R * 0.55, sx: 1.6 }), { squash: 0.7, lump: 0.06, detail: 0 })];
    for (const s of [-1, 1]) out.push(sphere(c, R * 0.2, 0x2a2420, matrixOf({ x: R * 0.55, y: R * 1.05, z: s * R * 0.42 }), { seg: 6, rings: 4 }));
    for (let i = 0; i < c.cnt(d(p, "teeth", 6)); i++) out.push(cone(c, R * 0.05, R * 0.2, 0xf6f0e0, matrixOf({ x: R * (0.8 + i * 0.12), y: R * 0.28, z: (i % 2 ? 1 : -1) * R * 0.16, rz: Math.PI }), { seg: 4 }));
    if (d(p, "horn", 0)) out.push(cone(c, R * 0.16, R * 1.1, col, matrixOf({ x: R * 1.4, y: R * 0.95, rz: -0.5 }), { seg: 6 }));
    return out;
  },
  /** A coiled shell: ammonites. */
  ammonite(p, c) {
    const R = d(p, "r", 0.6),
      pts = [];
    const turns = d(p, "turns", 2.4);
    for (let i = 0; i <= 28; i++) {
      const t = i / 28,
        a = t * turns * TAU,
        rr = R * (0.12 + 0.88 * t);
      pts.push(V(Math.cos(a) * rr, R * 1.05, Math.sin(a) * rr));
    }
    return [{ ...limb(c, pts, R * 0.03, R * 0.23, d(p, "c1", 0xc8b898), { radial: 8, segments: 30, m: matrixOf({ rx: Math.PI / 2 - 0.35, y: -R * 0.4 }) }), colorAt: ripple(d(p, "c1", 0xc8b898), d(p, "c2", 0x8a7a5a), 26) }];
  },
  /** A scatter of bones. */
  bones(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 9)); i++) {
      const a = c.rng() * TAU,
        r = c.r(0, d(p, "radius", 0.9)),
        L = c.r(0.3, 0.7);
      out.push(...placed([cyl(c, 0.04, 0.04, L, d(p, "c1", 0xe8dcc0), matrixOf({ rz: Math.PI / 2 }), { seg: 5 }), sphere(c, 0.07, d(p, "c1", 0xe8dcc0), matrixOf({ x: -L / 2, y: 0.04 }), { seg: 5, rings: 4 }), sphere(c, 0.07, d(p, "c1", 0xe8dcc0), matrixOf({ x: L / 2, y: 0.04 }), { seg: 5, rings: 4 })], Math.cos(a) * r, 0.04, Math.sin(a) * r, c.rng() * 3));
    }
    if (d(p, "skull", 1)) out.push(...placed(PROP_GENERATORS.skull({ r: 0.28, teeth: 4 }, c), 0.15, 0, 0.1, 0.8));
    return out;
  },
  /** A curved tusk or horn half-buried. */
  tusk(p, c) {
    const L = d(p, "len", 3);
    return [limb(c, [V(0, 0, 0), V(L * 0.3, L * 0.25, 0), V(L * 0.65, L * 0.3, 0), V(L * 0.95, L * 0.05, 0)], L * 0.07, L * 0.01, d(p, "c1", 0xece0c8), { radial: 8, segments: 14, tip: 0xffffff })];
  },
  /** A fallen petrified or ordinary log with rings on its end. */
  log(p, c) {
    const L = d(p, "len", 3),
      R = d(p, "r", 0.35);
    const out = [cyl(c, R, R * 0.85, L, d(p, "c1", 0x6a5038), matrixOf({ y: R, rz: Math.PI / 2, x: L / 2 }), { seg: 9 })];
    out.push(disc(c, R * 0.95, 0.02, d(p, "ring", 0xc8a070), matrixOf({ x: L + 0.005, y: R, rz: -Math.PI / 2 }), { seg: 9 }));
    for (let i = 0; i < c.cnt(d(p, "moss", 3)); i++) out.push(blob(c, R * 0.35, d(p, "mossC", 0x5a8a3a), matrixOf({ x: L * (0.15 + i * 0.28), y: R * 1.8 }), { squash: 0.4, detail: 0 }));
    for (let i = 0; i < c.cnt(d(p, "stubs", 2)); i++) out.push(cyl(c, R * 0.18, R * 0.1, R * 0.8, d(p, "c1", 0x6a5038), matrixOf({ x: L * (0.3 + i * 0.35), y: R * 1.3, rz: 0.9 + i * 0.3 }), { seg: 5 }));
    return out;
  },
  /** A tree stump with a flat cut and root flare. */
  stump(p, c) {
    const R = d(p, "r", 0.5),
      h = d(p, "h", 0.6);
    const out = [lathe(c, [[R * 1.5, 0], [R * 1.05, h * 0.3], [R, h]], d(p, "c1", 0x6a5038), null, { seg: 10 }), disc(c, R, 0.02, d(p, "ring", 0xd0b080), matrixOf({ y: h }), { seg: 10 })];
    for (let i = 0; i < c.cnt(5); i++) out.push(limb(c, [V(Math.cos(i * 1.3) * R * 0.9, h * 0.3, Math.sin(i * 1.3) * R * 0.9), V(Math.cos(i * 1.3) * R * 1.7, 0.05, Math.sin(i * 1.3) * R * 1.7)], R * 0.2, R * 0.08, d(p, "c1", 0x6a5038), { radial: 4, segments: 3 }));
    return out;
  },
  /** A column, whole or broken, on a base. */
  column(p, c) {
    const h = d(p, "h", 3.2),
      R = d(p, "r", 0.32);
    const col = d(p, "c1", 0xc8c0aa);
    const out = [box(c, R * 3, R * 0.5, R * 3, col), cyl(c, R, R * 0.88, h, col, matrixOf({ y: R * 0.5 }), { seg: d(p, "flutes", 10) })];
    if (d(p, "capital", 1)) out.push(box(c, R * 2.6, R * 0.4, R * 2.6, col, matrixOf({ y: R * 0.5 + h })));
    else out.push(rock(c, R * 0.9, col, matrixOf({ y: R * 0.5 + h }), { squash: 0.5, lump: 0.3, detail: 0 }));
    for (let i = 0; i < c.cnt(d(p, "rubble", 2)); i++) out.push(rock(c, R * c.r(0.3, 0.5), col, matrixOf({ x: c.r(-1.6, 1.6) * R, y: R * 0.15, z: c.r(1, 2) * R }), { squash: 0.6, detail: 0 }));
    return out;
  },
  /** A row of columns with a lintel: colonnades and gateways. */
  colonnade(p, c) {
    const n = c.cnt(d(p, "n", 3)),
      gap = d(p, "gap", 1.8),
      h = d(p, "h", 3);
    const col = d(p, "c1", 0xc8c0aa);
    const out = [];
    for (let i = 0; i < n; i++) out.push(cyl(c, 0.3, 0.26, h * (d(p, "broken", 0) && i === n - 1 ? 0.5 : 1), col, matrixOf({ x: (i - (n - 1) / 2) * gap }), { seg: 9 }));
    out.push(box(c, (n - 1) * gap + 0.9, 0.35, 0.7, col, matrixOf({ y: h })));
    return out;
  },
  /** A crumbling wall segment. */
  wall(p, c) {
    const L = d(p, "len", 4),
      h = d(p, "h", 1.8);
    const out = [];
    const n = c.cnt(d(p, "blocks", 9));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1),
        hh = h * (0.45 + 0.55 * Math.abs(Math.sin(t * 5 + 1)));
      out.push(box(c, L / n * 1.05, hh, 0.5, mixc(d(p, "c1", 0xa8a090), d(p, "c2", 0xc8c0a8), (i % 3) / 2), matrixOf({ x: (t - 0.5) * L, y: 0, ry: c.r(-0.04, 0.04) })));
    }
    return out;
  },
  /** A tall four-sided obelisk or monolith. */
  obelisk(p, c) {
    const h = d(p, "h", 5),
      w = d(p, "w", 0.5);
    const col = d(p, "c1", 0x3a3a46);
    const out = [box(c, w * 2.2, w * 0.6, w * 2.2, d(p, "base", 0x5a5a64)), cyl(c, w * 0.8, w * 0.45, h, col, matrixOf({ y: w * 0.6 }), { seg: d(p, "sides", 4), tip: d(p, "c2", undefined) }), cone(c, w * 0.45, w * 0.9, d(p, "cap", 0xe8c860), matrixOf({ y: w * 0.6 + h }), { seg: d(p, "sides", 4) })];
    if (d(p, "glow", 0)) for (let i = 0; i < 4; i++) out.push(box(c, w * 0.12, h * 0.4, 0.04, d(p, "glowC", 0x7affd8), matrixOf({ x: w * 0.55 * (i % 2 ? 1 : -1) * 0.5, y: h * 0.3, z: w * 0.68 * (i < 2 ? 1 : -1) })));
    return out;
  },
  /** An abstract carved figure on a plinth: statues. */
  statue(p, c) {
    const h = d(p, "h", 3);
    const col = d(p, "c1", 0xb8b0a0);
    return [box(c, h * 0.4, h * 0.18, h * 0.4, d(p, "base", 0x8a8478)), cyl(c, h * 0.12, h * 0.09, h * 0.5, col, matrixOf({ y: h * 0.18 }), { seg: 7 }), blob(c, h * 0.16, col, matrixOf({ y: h * 0.76, sy: 1.05 }), { squash: 1, lump: 0.05, detail: 0 }), limb(c, [V(-h * 0.1, h * 0.62, 0), V(-h * 0.28, h * 0.5, 0.05), V(-h * 0.3, h * 0.78, 0.1)], h * 0.04, h * 0.03, col, { radial: 5 }), limb(c, [V(h * 0.1, h * 0.62, 0), V(h * 0.22, h * 0.45, 0.1)], h * 0.04, h * 0.03, col, { radial: 5 })];
  },
  /** A ring of standing stones. */
  circle(p, c) {
    const out = [];
    const n = c.cnt(d(p, "n", 8)),
      R = d(p, "r", 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU,
        h = d(p, "h", 2) * c.r(0.7, 1.1);
      out.push(rock(c, h * 0.35, mixc(d(p, "c1", 0x8a8a84), d(p, "c2", 0xb0b0a8), c.rng()), matrixOf({ x: Math.cos(a) * R, y: h * 0.45, z: Math.sin(a) * R, sy: h / (h * 0.35) * 0.7, ry: a }), { squash: 1, lump: 0.15, detail: 0 }));
    }
    return out;
  },
  /** A dome-and-spire ruin: a ruined tower or shrine. */
  tower(p, c) {
    const h = d(p, "h", 5),
      R = d(p, "r", 1.3);
    const col = d(p, "c1", 0xb0a890);
    const out = [cyl(c, R, R * 0.85, h, col, null, { seg: 10, tip: d(p, "c2", undefined) }), cyl(c, R * 1.05, R * 1.05, 0.2, d(p, "c2", 0x8a8270), matrixOf({ y: h * 0.45 }), { seg: 10 })];
    for (let i = 0; i < c.cnt(5); i++) {
      const a = (i / 5) * TAU;
      out.push(box(c, 0.5, 0.7, 0.4, col, matrixOf({ x: Math.cos(a) * R * 0.85, y: h, z: Math.sin(a) * R * 0.85, ry: -a })));
    }
    out.push(box(c, 0.5, 1, 0.1, 0x2a2420, matrixOf({ x: R * 0.9, y: 0 })));
    return out;
  },
  /** Scattered leaves, needles or petals on the ground. */
  litter(p, c) {
    return scatter(c, d(p, "n", 26), d(p, "radius", 1), (x, z) => placed(blob(c, c.r(0.06, 0.12), mixc(d(p, "c1", 0xa8702a), d(p, "c2", 0xd0a040), c.rng()), matrixOf({ y: 0.01 }), { squash: 0.08, detail: 0, lump: 0.1 }), x, 0, z, c.rng() * 3));
  },
  /** A low rounded mound: soil, ant hill, snow drift, sand dune. */
  mound(p, c) {
    return [dome(c, d(p, "r", 1), d(p, "h", 0.45), d(p, "c1", 0x7a5a3a), null, { seg: 14, tip: d(p, "c2", 0x9a7a52) }), ...scatter(c, d(p, "n", 4), d(p, "r", 1) * 0.7, (x, z) => placed(rock(c, 0.07, 0x8a8478, matrixOf({ y: 0.03 }), { detail: 0 }), x, d(p, "h", 0.45) * 0.4, z))];
  },
  /** A flat patch of moss, ice or mud. */
  patch(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 6)); i++) {
      const a = i * 2.4,
        r = i ? c.r(0.3, 0.8) * d(p, "r", 1) : 0;
      out.push(...placed(blob(c, d(p, "r", 1) * c.r(0.3, 0.55), mixc(d(p, "c1", 0x4a8a3a), d(p, "c2", 0x7ab050), c.rng()), matrixOf({ y: 0.02 }), { squash: 0.07, lump: 0.25, detail: 1 }), Math.cos(a) * r, 0, Math.sin(a) * r, 0));
    }
    return out;
  },
  /** A heap of shells or beach glass. */
  shells(p, c) {
    return scatter(c, d(p, "n", 12), d(p, "radius", 0.7), (x, z, i) => placed(i % 2 ? cone(c, 0.07, 0.12, mixc(d(p, "c1", 0xf0d8c0), d(p, "c2", 0xe8a0a0), c.rng()), matrixOf({ y: 0.02, rz: 1.2 }), { seg: 6 }) : dome(c, 0.09, 0.07, mixc(d(p, "c1", 0xf0d8c0), d(p, "c2", 0xe8a0a0), c.rng()), null, { seg: 8, rings: 4 }), x, 0, z, c.rng() * 3));
  },
  /** Bleached driftwood: a few forked sticks. */
  driftwood(p, c) {
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "n", 3)); i++) {
      const L = d(p, "len", 2.2) * c.r(0.6, 1.1),
        a = c.rng() * 3;
      out.push(...placed([limb(c, [V(-L / 2, 0.1, 0), V(0, 0.18 + c.r(0, 0.15), 0), V(L / 2, 0.08, c.r(-0.2, 0.2))], 0.09, 0.04, d(p, "c1", 0xc8bca0), { radial: 5 }), limb(c, [V(0, 0.18, 0), V(L * 0.15, 0.55, 0.1)], 0.045, 0.02, d(p, "c1", 0xc8bca0), { radial: 4, segments: 3 })], c.r(-0.4, 0.4), 0, c.r(-0.4, 0.4), a));
    }
    return out;
  },
  /** A carved totem pole with stacked faces. */
  totem(p, c) {
    const h = d(p, "h", 3.5);
    const out = [];
    const n = c.cnt(d(p, "tiers", 4));
    for (let i = 0; i < n; i++) {
      const col = mixc(d(p, "c1", 0x8a5a3a), d(p, "c2", 0xd08a4a), i / n);
      out.push(box(c, 0.55, h / n * 0.95, 0.55, col, matrixOf({ y: (i * h) / n })));
      out.push(box(c, 0.5, 0.08, 0.06, d(p, "eye", 0xf0e0c0), matrixOf({ y: (i * h) / n + h / n * 0.55, z: 0.28 })));
    }
    out.push(cone(c, 0.3, 0.5, d(p, "c2", 0xd08a4a), matrixOf({ y: h }), { seg: 4 }));
    for (const s of [-1, 1]) out.push(box(c, 0.9, 0.12, 0.15, d(p, "c2", 0xd08a4a), matrixOf({ x: s * 0.6, y: h * 0.55, ry: 0 })));
    return out;
  },
  /** A pile of stones marking a place. */
  cairn(p, c) {
    const out = [];
    const n = c.cnt(d(p, "layers", 4));
    for (let i = 0; i < n; i++)
      for (let k = 0; k < Math.max(1, n - i - (c.lod ? 1 : 0)); k++) {
        const a = (k / Math.max(1, n - i)) * TAU,
          r = (n - i - 1) * 0.12 * (k ? 1 : 0.2);
        out.push(rock(c, 0.16 - i * 0.015, mixc(d(p, "c1", 0x8a8478), d(p, "c2", 0xb8b0a0), c.rng()), matrixOf({ x: Math.cos(a) * r, y: i * 0.16 + 0.08, z: Math.sin(a) * r }), { squash: 0.7, detail: 0 }));
      }
    return out;
  },
  /** A shallow ring crater with a raised rim. */
  crater(p, c) {
    const R = d(p, "r", 2.2);
    return [torus(c, R, R * 0.14, d(p, "c1", 0x7a6a5a), matrixOf({ y: R * 0.06, rx: Math.PI / 2, sz: 0.5 })), disc(c, R * 0.95, 0.03, d(p, "floor", 0x4a4036), matrixOf({ y: 0.005 }), { seg: 16 }), ...scatter(c, 6, R * 1.2, (x, z) => placed(rock(c, 0.15, d(p, "c1", 0x7a6a5a), matrixOf({ y: 0.05 }), { detail: 0 }), x, 0, z))];
  },
  /** The wreck of a ship or vehicle: a curved hull with ribs. */
  wreck(p, c) {
    const L = d(p, "len", 5),
      col = d(p, "c1", 0x6a5a4a);
    const out = [];
    const n = c.cnt(d(p, "ribs", 7));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i / (n - 1)) * L,
        k = Math.sin((i / (n - 1)) * Math.PI) * 0.8 + 0.2;
      for (const s of [-1, 1]) out.push(limb(c, [V(x, 0.1, s * 0.15), V(x, 0.9 * k, s * 1.0 * k), V(x, 1.5 * k * (i % 3 ? 0.7 : 1), s * 1.3 * k)], 0.09, 0.05, col, { radial: 4, segments: 4 }));
    }
    out.push(limb(c, [V(-L / 2, 0.1, 0), V(0, 0.05, 0), V(L / 2, 0.12, 0)], 0.14, 0.1, d(p, "c2", 0x4a3a2a), { radial: 5 }));
    out.push(cyl(c, 0.08, 0.06, d(p, "mast", 3), col, matrixOf({ x: L * 0.15, rz: 0.35 }), { seg: 5 }));
    return out;
  },
  /** A bowl of woven twigs: an abandoned nest. */
  nestBowl(p, c) {
    const R = d(p, "r", 0.7);
    const out = [];
    for (let i = 0; i < c.cnt(d(p, "twigs", 22)); i++) {
      const a = (i / 22) * TAU * 2,
        r = R * (0.75 + 0.25 * c.rng()),
        y = 0.04 + (i % 4) * 0.06;
      out.push(limb(c, [V(Math.cos(a) * r, y, Math.sin(a) * r), V(Math.cos(a + 0.5) * r, y + 0.04, Math.sin(a + 0.5) * r), V(Math.cos(a + 1) * r * 0.95, y, Math.sin(a + 1) * r * 0.95)], 0.025, 0.015, mixc(d(p, "c1", 0x7a5a38), d(p, "c2", 0xa88a58), c.rng()), { radial: 3, segments: 3 }));
    }
    for (let i = 0; i < c.cnt(d(p, "eggs", 3)); i++) out.push(sphere(c, 0.1, d(p, "eggC", 0xe8f0e0), matrixOf({ x: Math.cos(i * 2.1) * 0.15, y: 0.1, z: Math.sin(i * 2.1) * 0.15, sy: 1.25 }), { seg: 7, rings: 5 }));
    return out;
  },
};
