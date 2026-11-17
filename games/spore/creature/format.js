/**
 * Creature record v1: everything needed to build, save and hand on a land creature.
 *
 * {
 *   format, version, name,
 *   colors: { base, belly, pattern, accent }, pattern,
 *   spine: [{ x, y, r }]   tail to head, side profile (x forward, y up), radius per vertebra
 *   legs:  [{ t, length, bend }] one mirrored pair per entry, t = 0 tail .. 1 head,
 *          bend -1..1 pushes the knee forward or back
 *   foot:  part id used on every leg
 *   parts: [{ id, t, angle, scale, roll, bend }] angle around the body: 0 top, +-PI/2 flanks, PI belly;
 *          off-midline parts mirror. roll turns a part about its own axis; bend flexes jointed arms.
 * }
 * Pure data: no THREE, no DOM.
 */
import { STARTER_CREATURE_PARTS, creaturePart } from "./parts.js";

export const CREATURE_FORMAT = "johnny-spore-creature";
export const CREATURE_VERSION = 1;
export const CREATURE_SAVE_KEY = "johnny-spore-creature-stage";
export const LIMITS = { minNodes: 3, maxNodes: 8, minR: 0.18, maxR: 0.95, maxLegPairs: 3, maxParts: 14, minLeg: 0.5, maxLeg: 2.2 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
/** Blend two 0xRRGGBB colours. */
export function mixHex(a, b, t) {
  const ch = (c, s) => (c >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** A belly colour that suits a body colour: paler and warmer, like most animals. */
export const defaultBelly = (base) => mixHex(base, 0xfff0d6, 0.55);

/** The cell crawls out of the water: its spine, colours and diet become a four-legged creature. */
export function creatureFromCell(cell, name) {
  const nodes = [...(cell?.body?.nodes || [])].sort((a, b) => a.x - b.x);
  const src = nodes.length >= 2 ? nodes : [{ x: -1, r: 0.4 }, { x: 0, r: 0.6 }, { x: 1, r: 0.4 }];
  const minX = src[0].x,
    maxX = src[src.length - 1].x,
    span = Math.max(0.5, maxX - minX);
  // Re-space to 5 vertebrae across a 3-unit body, keeping the cell's girth profile.
  const spine = [];
  for (let i = 0; i < 5; i++) {
    const u = i / 4,
      x = minX + span * u;
    let r = src[0].r;
    for (let k = 0; k < src.length - 1; k++) if (x >= src[k].x && x <= src[k + 1].x) r = src[k].r + ((x - src[k].x) / Math.max(1e-6, src[k + 1].x - src[k].x)) * (src[k + 1].r - src[k].r);
    if (x >= maxX) r = src[src.length - 1].r;
    spine.push({ x: -1.5 + 3 * u, y: Math.sin(u * Math.PI) * 0.2 + (u > 0.8 ? 0.15 : 0), r: clamp(r * 0.9, 0.25, 0.8) });
  }
  const diet = cell?.diet === "meat" ? "meat" : cell?.diet === "omni" ? "omni" : "plant";
  const [mouth, eyes, foot] = STARTER_CREATURE_PARTS[diet];
  const hadSpikes = (cell?.parts || []).some((p) => p.id === "spike");
  const parts = [
    { id: mouth, t: 1, angle: 0 },
    { id: eyes, t: 0.86, angle: 0.75 },
  ];
  if (hadSpikes && creaturePart("spines")) parts.push({ id: "spines", t: 0.5, angle: 0 });
  return validateCreature({
    format: CREATURE_FORMAT,
    version: CREATURE_VERSION,
    name: name || cell?.name || "Karlets",
    colors: { ...(cell?.colors || { base: 0x3be0d8, pattern: 0x9df6ee, accent: 0xffedbc }) },
    pattern: cell?.body?.pattern || "speckle",
    spine,
    legs: [
      { t: 0.3, length: 1.1 },
      { t: 0.72, length: 1.1 },
    ],
    foot,
    parts,
  });
}

/** Clamp and repair a record so the builder can always draw it. */
export function validateCreature(raw) {
  const r = JSON.parse(JSON.stringify(raw || {}));
  r.format = CREATURE_FORMAT;
  r.version = CREATURE_VERSION;
  r.name = String(r.name || "Karlets").slice(0, 22);
  const c = r.colors || {};
  const base = num(c.base, 0x3be0d8) & 0xffffff;
  r.colors = { base, belly: num(c.belly, defaultBelly(base)) & 0xffffff, pattern: num(c.pattern, 0x9df6ee) & 0xffffff, accent: num(c.accent, 0xffedbc) & 0xffffff };
  r.pattern = r.pattern || "speckle";
  r.spine = (Array.isArray(r.spine) ? r.spine : []).filter((n) => Number.isFinite(n?.x)).sort((a, b) => a.x - b.x);
  while (r.spine.length < LIMITS.minNodes) r.spine.push({ x: (r.spine.at(-1)?.x ?? -1) + 1, y: 0, r: 0.45 });
  r.spine = r.spine.slice(0, LIMITS.maxNodes).map((n) => ({ x: clamp(n.x, -3, 3), y: clamp(n.y || 0, -1, 1.5), r: clamp(n.r || 0.4, LIMITS.minR, LIMITS.maxR) }));
  r.legs = (Array.isArray(r.legs) ? r.legs : []).slice(0, LIMITS.maxLegPairs).map((l) => ({ t: clamp(num(l.t, 0.5), 0.05, 0.95), length: clamp(num(l.length, 1), LIMITS.minLeg, LIMITS.maxLeg), bend: clamp(num(l.bend, 0), -1, 1) }));
  r.foot = creaturePart(r.foot)?.slot === "foot" ? r.foot : "pads";
  const seenMouth = { v: false };
  r.parts = (Array.isArray(r.parts) ? r.parts : [])
    .filter((p) => creaturePart(p.id) && creaturePart(p.id).slot !== "foot")
    .filter((p) => {
      if (creaturePart(p.id).slot !== "mouth") return true;
      if (seenMouth.v) return false;
      return (seenMouth.v = true);
    })
    .slice(0, LIMITS.maxParts)
    .map((p) => ({
      id: p.id,
      t: clamp(num(p.t, 0.5), 0, 1),
      angle: clamp(num(p.angle, 0), -Math.PI, Math.PI),
      scale: clamp(num(p.scale, 1), 0.6, 1.6),
      roll: clamp(num(p.roll, 0), -Math.PI, Math.PI),
      bend: clamp(num(p.bend, 0), -1, 1),
    }));
  return r;
}

/** Part ids in use (foot counted once), for ability totals. */
export const creaturePartIds = (r) => [...r.parts.map((p) => p.id), r.foot];

export const creatureToJson = (r) => JSON.stringify(validateCreature(r));
export function creatureFromJson(text) {
  try {
    return validateCreature(JSON.parse(text));
  } catch (e) {
    return null;
  }
}
