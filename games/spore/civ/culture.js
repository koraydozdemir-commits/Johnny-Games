/**
 * Civilization cultures: how a nation's cities look, derived from its species. Pure data and decisions
 * (no THREE), so the rules for "this species builds this way" are tested and the 3D code only draws.
 *
 * A culture has an architectural style (what the houses, towers and the hall's crown are made of), a
 * palette (taken from the species' own colours), a scale, and a set of decorations. A species' body
 * decides the style: many legs raise buildings on stilts, wings favour spires, a meat-eater builds
 * fortress walls and angular roofs, a plant-eater domes and hives, and so on. The nations get different
 * styles from one another (see chooseStyles), so a glance at a city says whose it is.
 *
 * Buildings are kits of simple primitives [shape, w, h, d, x, y(bottom), z, slot, segments]; the view
 * merges them into one geometry per kit and draws every house of a style with a single instanced mesh.
 */
import { hashSeed, rng32 } from "../galaxy/names.js";
import { adjust, mix } from "../ecolib/color.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

export const STYLE_IDS = ["dome", "spire", "terrace", "stilt", "hive", "fortress", "arch"];
export const STYLES = {
  dome: { name: "Domed", blurb: "round walls under smooth domes" },
  spire: { name: "Spired", blurb: "tall, slender towers and needle roofs" },
  terrace: { name: "Terraced", blurb: "stepped, stacked halls" },
  stilt: { name: "Stilted", blurb: "pods raised high on legs" },
  hive: { name: "Hive", blurb: "clustered bulbs and egg-shaped homes" },
  fortress: { name: "Fortress", blurb: "heavy walls, parapets and towers" },
  arch: { name: "Colonnaded", blurb: "open pillars carrying flat roofs" },
};

/* ------------------------------------------------------------------------------ species traits */
/**
 * What a species' body says about how it would build.
 * @param {{record?:object, diet?:string}} species
 */
export function traitsOf(species = {}) {
  const r = species.record || {};
  const parts = (r.parts || []).map((p) => String(p.id));
  const has = (re) => parts.some((id) => re.test(id));
  const spine = r.spine || [];
  const length = spine.length ? Math.abs(spine[spine.length - 1].x - spine[0].x) : 3;
  const bulk = spine.reduce((m, s) => Math.max(m, s.r || 0), 0.4);
  return {
    diet: species.diet || "omni",
    legs: (r.legs || []).length || 2,
    arms: (r.arms || []).length,
    winged: has(/wing|fanFins|glow/i),
    armoured: has(/shell|plates|spines|quills|horns|antlers|knobs|tailClub|claws|pincers|bladeArms|stinger/i),
    ornate: has(/frill|sail|crest|plumeTail|fanTail|antennae|glowOrbs/i),
    long: length > 3.2,
    bulk,
  };
}

/** How well a style suits a body: higher is a better fit. */
function styleScores(t) {
  const meat = t.diet === "meat",
    plant = t.diet === "plant";
  return {
    dome: 1 + (plant ? 1.2 : 0) + (t.bulk > 0.7 ? 0.6 : 0) + (t.ornate ? 0.3 : 0),
    spire: 1 + (t.winged ? 1.6 : 0) + (t.ornate ? 0.8 : 0) + (t.long ? 0.3 : 0),
    terrace: 1 + (t.diet === "omni" ? 0.9 : 0) + (t.arms >= 2 ? 0.8 : 0) + (t.bulk > 0.8 ? 0.3 : 0),
    stilt: 1 + (t.legs >= 3 ? 1.7 : 0) + (t.long ? 0.6 : 0),
    hive: 1 + (plant ? 0.7 : 0) + (t.legs >= 3 ? 0.4 : 0) + (t.armoured ? 0.5 : 0) + (t.bulk > 0.75 ? 0.4 : 0),
    fortress: 1 + (meat ? 1.5 : 0) + (t.armoured ? 1.3 : 0) + (t.arms >= 2 ? 0.3 : 0),
    arch: 1 + (t.ornate ? 0.8 : 0) + (t.arms >= 2 ? 0.7 : 0) + (plant ? 0.3 : 0) + (t.winged ? 0.3 : 0),
  };
}

/**
 * Give several nations different styles: each takes the style that suits its species best among those not
 * yet taken, in the order given (the player first, so the player always gets its best fit).
 * @param {Array<{key:string, traits:object, seed:number}>} list
 * @returns {Map<string,string>} key to style id
 */
export function chooseStyles(list) {
  const taken = new Set();
  const out = new Map();
  for (const item of list) {
    const r = rng32(hashSeed("style", item.seed));
    const scores = styleScores(item.traits);
    let best = null,
      bs = -Infinity;
    for (const id of STYLE_IDS) {
      if (taken.has(id)) continue;
      const s = scores[id] + r() * 0.45;
      if (s > bs) {
        bs = s;
        best = id;
      }
    }
    best = best || STYLE_IDS[0];
    taken.add(best);
    out.set(item.key, best);
  }
  return out;
}

/* ---------------------------------------------------------------------------------- palettes */
/**
 * A culture's colours. `accent` is the nation's own colour (the flag, trim and glow), the rest come from the
 * species' body colours so the city looks like its people.
 */
export function paletteOf(species = {}, accent = 0x3fa9d6, { muted = false } = {}) {
  const c = species.record?.colors || {};
  const base = c.base ?? 0xcfc2a2,
    belly = c.belly ?? mix(base, 0xffffff, 0.5),
    pattern = c.pattern ?? 0xf2eadb;
  const palette = {
    wall: mix(mix(belly, 0xf0e9d8, 0.55), base, 0.12),
    roof: adjust(mix(base, accent, 0.28), { sat: 0.95, light: 0.92 }),
    trim: mix(accent, pattern, 0.2),
    accent,
    stone: mix(0xb9b2a4, base, 0.1),
    glow: mix(0xfff1a8, accent, 0.25),
  };
  if (muted) {
    // Independent cities: weathered, no national colour.
    palette.wall = mix(palette.wall, 0xa9a396, 0.6);
    palette.roof = mix(palette.roof, 0x7a6f62, 0.65);
    palette.trim = 0x8c8577;
    palette.accent = 0x9aa3ab;
    palette.glow = 0xe6dfc8;
  }
  return palette;
}

/* ------------------------------------------------------------------------------------- kits */
/** Primitive: [shape, w, h, d, x, y (bottom), z, slot, segments?]. Units: metres at scale 1. */
const K = {
  dome: {
    houses: [
      [["cyl", 2.0, 1.2, 2.0, 0, 0, 0, "wall", 14], ["dome", 2.3, 1.0, 2.3, 0, 1.2, 0, "roof", 16], ["sphere", 0.3, 0.3, 0.3, 0, 2.15, 0, "accent", 8]],
      [["cyl", 2.6, 0.9, 2.6, 0, 0, 0, "wall", 14], ["dome", 2.9, 1.4, 2.9, 0, 0.9, 0, "roof", 16], ["cyl", 0.5, 0.5, 0.5, 1.5, 0, 0.4, "stone", 8]],
      [["cyl", 1.5, 2.2, 1.5, 0, 0, 0, "wall", 12], ["dome", 1.8, 1.4, 1.8, 0, 2.2, 0, "roof", 14], ["cone", 0.2, 0.9, 0.2, 0, 3.5, 0, "trim", 6]],
    ],
    crown: [["dome", 1.6, 1.0, 1.6, 0, 0, 0, "accent", 14], ["cone", 0.25, 1.4, 0.25, 0, 0.95, 0, "glow", 6]],
    decor: ["banner", "lantern"],
    scale: 1,
  },
  spire: {
    houses: [
      [["box", 1.7, 1.5, 1.7, 0, 0, 0, "wall"], ["cone", 2.0, 2.6, 2.0, 0, 1.5, 0, "roof", 4]],
      [["box", 1.2, 3.0, 1.2, 0, 0, 0, "wall"], ["cone", 1.6, 2.2, 1.6, 0, 3.0, 0, "roof", 6], ["box", 0.5, 0.5, 0.2, 0.55, 1.2, 0.55, "trim"]],
      [["cyl", 1.4, 1.2, 1.4, 0, 0, 0, "wall", 6], ["cone", 1.8, 3.4, 1.8, 0, 1.2, 0, "roof", 6], ["sphere", 0.28, 0.28, 0.28, 0, 4.55, 0, "glow", 6]],
    ],
    crown: [["cone", 0.7, 4.0, 0.7, 0, 0, 0, "accent", 6], ["cyl", 1.2, 0.18, 1.2, 0, 0.9, 0, "glow", 14]],
    decor: ["banner", "obelisk"],
    scale: 0.95,
  },
  terrace: {
    houses: [
      [["box", 2.6, 0.9, 2.6, 0, 0, 0, "wall"], ["box", 1.9, 0.9, 1.9, 0, 0.9, 0, "wall"], ["box", 1.2, 0.9, 1.2, 0, 1.8, 0, "roof"]],
      [["box", 3.0, 0.8, 2.2, 0, 0, 0, "wall"], ["box", 3.2, 0.18, 2.4, 0, 0.8, 0, "trim"], ["box", 1.6, 1.0, 1.4, -0.4, 0.98, 0, "wall"]],
      [["box", 2.4, 0.8, 2.4, 0, 0, 0, "wall"], ["box", 1.8, 0.8, 1.8, 0, 0.8, 0, "wall"], ["box", 1.2, 0.8, 1.2, 0, 1.6, 0, "wall"], ["box", 0.7, 1.0, 0.7, 0, 2.4, 0, "roof"]],
    ],
    crown: [["box", 1.8, 0.5, 1.8, 0, 0, 0, "accent"], ["box", 1.1, 0.5, 1.1, 0, 0.5, 0, "accent"], ["box", 0.5, 1.2, 0.5, 0, 1.0, 0, "glow"]],
    decor: ["banner", "brazier"],
    scale: 1.05,
  },
  stilt: {
    houses: [
      [["cyl", 0.22, 1.5, 0.22, -0.7, 0, -0.7, "stone", 6], ["cyl", 0.22, 1.5, 0.22, 0.7, 0, -0.7, "stone", 6], ["cyl", 0.22, 1.5, 0.22, -0.7, 0, 0.7, "stone", 6], ["cyl", 0.22, 1.5, 0.22, 0.7, 0, 0.7, "stone", 6], ["box", 2.2, 1.1, 2.2, 0, 1.5, 0, "wall"], ["box", 2.5, 0.3, 2.5, 0, 2.6, 0, "roof"]],
      [["cyl", 0.2, 2.2, 0.2, -0.6, 0, 0, "stone", 6], ["cyl", 0.2, 2.2, 0.2, 0.6, 0, 0, "stone", 6], ["sphere", 2.1, 1.7, 2.1, 0, 2.2, 0, "wall", 12], ["dome", 1.5, 0.6, 1.5, 0, 3.7, 0, "roof", 12]],
      [["cyl", 0.24, 2.8, 0.24, -0.5, 0, -0.5, "stone", 6], ["cyl", 0.24, 2.8, 0.24, 0.5, 0, -0.5, "stone", 6], ["cyl", 0.24, 2.8, 0.24, 0, 0, 0.6, "stone", 6], ["cyl", 1.6, 1.3, 1.6, 0, 2.8, 0, "wall", 8], ["cone", 1.9, 1.0, 1.9, 0, 4.1, 0, "roof", 8]],
    ],
    crown: [["cyl", 0.25, 2.2, 0.25, 0, 0, 0, "stone", 6], ["sphere", 1.1, 1.1, 1.1, 0, 2.2, 0, "glow", 10]],
    decor: ["lantern", "banner"],
    scale: 1,
  },
  hive: {
    houses: [
      [["sphere", 2.2, 1.9, 2.2, 0, 0, 0, "wall", 12], ["sphere", 1.0, 0.9, 1.0, 0, 1.7, 0, "roof", 10]],
      [["sphere", 1.7, 1.6, 1.7, -0.7, 0, 0, "wall", 10], ["sphere", 1.5, 1.4, 1.5, 0.8, 0, 0.2, "wall", 10], ["sphere", 1.1, 1.0, 1.1, 0, 1.2, 0, "roof", 10]],
      [["sphere", 1.8, 3.0, 1.8, 0, 0, 0, "wall", 12], ["cyl", 2.0, 0.16, 2.0, 0, 1.3, 0, "trim", 14], ["sphere", 0.6, 0.6, 0.6, 0, 2.9, 0, "glow", 8]],
    ],
    crown: [["sphere", 2.0, 2.6, 2.0, 0, 0, 0, "accent", 12], ["sphere", 0.6, 0.6, 0.6, 0, 2.5, 0, "glow", 8]],
    decor: ["lantern", "bulb"],
    scale: 1,
  },
  fortress: {
    houses: [
      [["box", 2.2, 1.5, 2.2, 0, 0, 0, "wall"], ["box", 2.5, 0.25, 2.5, 0, 1.5, 0, "stone"], ["box", 0.5, 0.5, 0.5, -1.0, 1.75, -1.0, "stone"], ["box", 0.5, 0.5, 0.5, 1.0, 1.75, 1.0, "stone"]],
      [["cyl", 2.0, 2.6, 2.0, 0, 0, 0, "wall", 10], ["cyl", 2.4, 0.3, 2.4, 0, 2.6, 0, "stone", 10], ["cone", 1.6, 0.9, 1.6, 0, 2.9, 0, "roof", 10]],
      [["box", 2.6, 1.1, 1.8, 0, 0, 0, "wall"], ["cone", 2.8, 1.0, 2.0, 0, 1.1, 0, "roof", 4], ["box", 0.9, 1.9, 0.9, 1.0, 0, -0.6, "stone"]],
    ],
    crown: [["cyl", 1.8, 0.4, 1.8, 0, 0, 0, "stone", 8], ["cyl", 0.16, 3.0, 0.16, 0, 0.4, 0, "stone", 6], ["box", 1.4, 0.8, 0.08, 0.8, 2.4, 0, "accent"]],
    decor: ["banner", "brazier"],
    scale: 1.05,
  },
  arch: {
    houses: [
      [["cyl", 0.3, 1.7, 0.3, -0.9, 0, -0.9, "stone", 8], ["cyl", 0.3, 1.7, 0.3, 0.9, 0, -0.9, "stone", 8], ["cyl", 0.3, 1.7, 0.3, -0.9, 0, 0.9, "stone", 8], ["cyl", 0.3, 1.7, 0.3, 0.9, 0, 0.9, "stone", 8], ["box", 2.5, 0.3, 2.5, 0, 1.7, 0, "roof"], ["box", 1.1, 1.0, 1.1, 0, 0, 0, "wall"]],
      [["box", 2.8, 1.1, 1.6, 0, 0, 0, "wall"], ["cyl", 0.26, 1.7, 0.26, -1.3, 0, 1.0, "stone", 8], ["cyl", 0.26, 1.7, 0.26, 1.3, 0, 1.0, "stone", 8], ["box", 3.0, 0.3, 2.2, 0, 1.7, 0.1, "roof"]],
      [["cyl", 2.2, 0.35, 2.2, 0, 0, 0, "stone", 12], ["cyl", 0.26, 2.0, 0.26, 0.8, 0.35, 0.8, "stone", 8], ["cyl", 0.26, 2.0, 0.26, -0.8, 0.35, 0.8, "stone", 8], ["cyl", 0.26, 2.0, 0.26, 0.8, 0.35, -0.8, "stone", 8], ["cyl", 0.26, 2.0, 0.26, -0.8, 0.35, -0.8, "stone", 8], ["dome", 2.4, 0.9, 2.4, 0, 2.35, 0, "roof", 12]],
    ],
    crown: [["cyl", 0.22, 1.8, 0.22, -0.7, 0, 0, "stone", 8], ["cyl", 0.22, 1.8, 0.22, 0.7, 0, 0, "stone", 8], ["box", 1.8, 0.3, 0.5, 0, 1.8, 0, "accent"], ["sphere", 0.45, 0.45, 0.45, 0, 2.1, 0, "glow", 8]],
    decor: ["banner", "obelisk"],
    scale: 1,
  },
};
/** The kit for a style: house variants, the hall's crown, the decorations it likes. */
export const kitFor = (style) => K[style] || K.dome;

/** Decoration primitives, drawn in the nation's colours. */
export const DECOR_PRIMS = {
  banner: [["cyl", 0.12, 3.2, 0.12, 0, 0, 0, "stone", 5], ["box", 1.1, 0.7, 0.06, 0.58, 2.4, 0, "accent"]],
  lantern: [["cyl", 0.1, 2.0, 0.1, 0, 0, 0, "stone", 5], ["sphere", 0.5, 0.55, 0.5, 0, 2.0, 0, "glow", 8]],
  obelisk: [["box", 0.5, 2.6, 0.5, 0, 0, 0, "stone"], ["cone", 0.5, 0.7, 0.5, 0, 2.6, 0, "accent", 4]],
  brazier: [["cyl", 0.5, 0.8, 0.5, 0, 0, 0, "stone", 7], ["cone", 0.55, 0.8, 0.55, 0, 0.8, 0, "glow", 6]],
  bulb: [["cyl", 0.12, 1.4, 0.12, 0, 0, 0, "stone", 5], ["sphere", 0.7, 0.9, 0.7, 0, 1.4, 0, "accent", 8]],
};

/* ---------------------------------------------------------------------------------- cultures */
/**
 * The culture of one nation.
 * @param {{key:string, species?:object, accent:number, style:string, seed?:number, muted?:boolean}} o
 */
export function makeCulture({ key, species = {}, accent, style, seed = 0, muted = false }) {
  const t = traitsOf(species);
  const kit = kitFor(style);
  const r = rng32(hashSeed("culture", key, seed));
  // The body's bulk sets how big its buildings stand; ornate species decorate more.
  const scale = clamp(kit.scale * (0.9 + t.bulk * 0.3) * (0.96 + r() * 0.08), 0.85, 1.3);
  return {
    key,
    style,
    styleName: STYLES[style].name,
    palette: paletteOf(species, accent, { muted }),
    scale,
    decor: kit.decor,
    ornate: t.ornate ? 1.4 : 1,
    traits: t,
  };
}

/** A short description of a culture for the city sheet ("Domed, from a bulky plant-eater"). */
export const describeCulture = (c) => `${c.styleName} · ${STYLES[c.style].blurb}`;

/* --------------------------------------------------------------------------------- city layout */
export const CITY = { plaza: 15, plotRing: 9, turretRing: 15, hall: 4.6, ringRoad: 6.4 };

/**
 * Lay out a city's own buildings, roads and decorations around its hall, in metres from the centre. Seeded
 * by the city, so every city is different, but the same city always looks the same. The six building plots
 * and three turret spots (the player's designed buildings) are left clear.
 * @param {{id:number, pop:number, plots:Array, turrets:number}} city
 * @param {{plotAngle:(k:number)=>number, turretAngle:(k:number)=>number, plots:number, turretSlots:number}} spots
 * @param {object} culture
 */
export function layoutCity(city, spots, culture) {
  const r = rng32(hashSeed("citylayout", city.id, culture.style, city.name || ""));
  const kinds = ["organic", "concentric", "grid"];
  const kind = kinds[Math.floor(r() * kinds.length)];
  const rotation = r() * TAU;
  const want = clamp(Math.round(6 + (city.pop || 4) * 1.3 + r() * 3), 6, 26);
  // Straight roads out from the hall to each plot and turret, and a ring round the hall.
  const roads = [];
  for (let k = 0; k < spots.plots; k++) {
    const a = spots.plotAngle(k);
    roads.push({ pts: [[Math.cos(a) * CITY.hall * 0.95, Math.sin(a) * CITY.hall * 0.95], [Math.cos(a) * (CITY.plotRing - 1.9), Math.sin(a) * (CITY.plotRing - 1.9)]], width: 1.25 });
  }
  for (let k = 0; k < spots.turretSlots; k++) {
    const a = spots.turretAngle(k);
    roads.push({ pts: [[Math.cos(a) * CITY.plaza * 0.78, Math.sin(a) * CITY.plaza * 0.78], [Math.cos(a) * (CITY.plaza + 9), Math.sin(a) * (CITY.plaza + 9)]], width: 1.5, gate: true });
  }
  const ring = [];
  for (let i = 0; i <= 28; i++) ring.push([Math.cos((i / 28) * TAU) * CITY.ringRoad, Math.sin((i / 28) * TAU) * CITY.ringRoad]);
  roads.push({ pts: ring, width: 1.0, ring: true });

  const keepClear = [];
  for (let k = 0; k < spots.plots; k++) keepClear.push({ x: Math.cos(spots.plotAngle(k)) * CITY.plotRing, z: Math.sin(spots.plotAngle(k)) * CITY.plotRing, r: 3.6 });
  for (let k = 0; k < spots.turretSlots; k++) keepClear.push({ x: Math.cos(spots.turretAngle(k)) * CITY.turretRing, z: Math.sin(spots.turretAngle(k)) * CITY.turretRing, r: 3.1 });
  const roadClear = (x, z) => {
    for (const road of roads) {
      if (road.ring) {
        if (Math.abs(Math.hypot(x, z) - CITY.ringRoad) < 1.5) return false;
        continue;
      }
      const [a, b] = road.pts;
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) < road.width * 0.5 + 1.15) return false;
    }
    return true;
  };
  const houses = [];
  const place = (x, z) => {
    const d = Math.hypot(x, z);
    if (d < CITY.hall + 1.4 || d > CITY.plaza - 1.7) return false;
    if (keepClear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) return false;
    if (!roadClear(x, z)) return false;
    if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 2.7)) return false;
    return true;
  };
  for (let guard = 0; houses.length < want && guard < want * 40; guard++) {
    let x, z, yaw;
    if (kind === "concentric") {
      const rings = [CITY.ringRoad + 2.2, CITY.ringRoad + 5.6, CITY.plaza - 2.3];
      const rad = rings[Math.floor(r() * rings.length)];
      const a = r() * TAU;
      x = Math.cos(a) * rad;
      z = Math.sin(a) * rad;
      yaw = -a + Math.PI / 2;
    } else if (kind === "grid") {
      const g = 3.0;
      const gx = Math.round(((r() * 2 - 1) * CITY.plaza) / g) * g,
        gz = Math.round(((r() * 2 - 1) * CITY.plaza) / g) * g;
      x = gx * Math.cos(rotation) - gz * Math.sin(rotation);
      z = gx * Math.sin(rotation) + gz * Math.cos(rotation);
      yaw = -rotation;
    } else {
      const a = r() * TAU,
        rad = Math.sqrt(r()) * (CITY.plaza - 2) ;
      x = Math.cos(a) * rad;
      z = Math.sin(a) * rad;
      yaw = Math.atan2(-x, -z) + (r() - 0.5) * 0.7;
    }
    if (!place(x, z)) continue;
    const d = Math.hypot(x, z);
    // Taller buildings near the heart, low ones at the edge; the variants of a style are its short, wide and tall forms.
    const variant = d < CITY.ringRoad + 2.5 ? (r() < 0.6 ? 2 : 0) : r() < 0.22 ? 2 : r() < 0.5 ? 1 : 0;
    houses.push({ x, z, yaw, variant, scale: culture.scale * (0.82 + r() * 0.4) * (d < CITY.ringRoad + 2.5 ? 1.12 : 1), tint: 0.9 + r() * 0.18 });
  }
  // Decorations stand on the plaza's rim between the turret gates.
  const decor = [];
  const n = 8 + (culture.ornate > 1 ? 4 : 0);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU + rotation * 0.15;
    if (spots.turretSlots && Array.from({ length: spots.turretSlots }, (_, k) => Math.abs(Math.atan2(Math.sin(a - spots.turretAngle(k)), Math.cos(a - spots.turretAngle(k))))).some((d) => d < 0.3)) continue;
    decor.push({ kind: culture.decor[i % culture.decor.length], x: Math.cos(a) * (CITY.plaza - 0.9), z: Math.sin(a) * (CITY.plaza - 0.9), yaw: -a });
  }
  return { kind, houses, decor, roads, rotation };
}

/**
 * Roads between cities: each city links to its nearest neighbours on the same continent, where the way
 * is open land. Returns index pairs (each pair once).
 * @param {Array<{x:number,z:number,continent:number}>} sites
 * @param {(x:number,z:number)=>boolean} landOk
 */
export function roadLinks(sites, landOk, { perCity = 2, maxLen = 200 } = {}) {
  const seen = new Set();
  const links = [];
  sites.forEach((a, i) => {
    const near = sites
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) }))
      .filter((c) => c.j !== i && sites[c.j].continent === a.continent && c.d <= maxLen)
      .sort((p, q) => p.d - q.d);
    let made = 0;
    for (const c of near) {
      if (made >= perCity) break;
      const key = i < c.j ? i + ":" + c.j : c.j + ":" + i;
      const b = sites[c.j];
      let open = true;
      const steps = Math.ceil(c.d / 5);
      for (let s = 1; s < steps && open; s++) open = landOk(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps);
      if (!open) continue;
      made++;
      if (!seen.has(key)) {
        seen.add(key);
        links.push([i, c.j]);
      }
    }
  });
  return links;
}
