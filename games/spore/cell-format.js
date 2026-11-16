/**
 * The saved cell format. This is the contract between the cell stage and every stage after it:
 * the creature stage loads a cell with `readHandoff()` and rebuilds the body with the same
 * body builder. The module is pure (no THREE, no DOM) so it can be unit-tested in Node.
 *
 * Record shape (version 1):
 * {
 *   format: 'johnny-spore-cell', version: 1, stage: 'cell',
 *   name: string, tier: 1..4, scale: number,
 *   body:   { nodes: [{ x, y, r }], pattern, paintStrokes: [{ x, y, color, size }] },
 *   colors: { base, pattern, accent },                    // 0xRRGGBB integers
 *   parts:  [{ id, x, y, rotation, scale, pairId }],     // x/y in body space, rotation in radians
 *   diet: 'plant' | 'meat' | 'omni',
 *   stats:  { speed, turn, damage, sight, healthBonus, armour }
 * }
 * Body space: x runs tail (-) to head (+) and y is the lateral axis, exactly as in the editor.
 */
import { ACCENT_COLORS, BASE_COLORS, MAX_COMPLEXITY, MAX_NODES, MIN_NODES, PART_IDS, PATTERNS, PATTERN_COLORS, STARTER_PARTS, complexityOf, computeStats, dietOf, partDef } from "./part-defs.js";

export const CELL_FORMAT = "johnny-spore-cell";
export const CELL_VERSION = 1;
export const CELL_STORAGE_KEY = "johnny-spore-cell-record";
export const HANDOFF_STORAGE_KEY = "johnny-spore-creature-handoff";

const LIMITS = { nodeX: 4.2, nodeY: 2.8, radiusMin: 0.12, radiusMax: 1.4, partXY: 5.5, partScaleMin: 0.5, partScaleMax: 2.2, strokeMax: 400 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
const asColor = (v, fallback) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fallback);

export function defaultNodes() {
  return [
    { x: -1.52, y: 0, r: 0.24 },
    { x: -0.92, y: 0, r: 0.52 },
    { x: -0.12, y: 0, r: 0.74 },
    { x: 0.68, y: 0, r: 0.54 },
    { x: 1.32, y: 0, r: 0.24 },
  ];
}

/** Deterministic PRNG so a mate's mutation can be reproduced from a seed. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbToHsl(color) {
  const r = ((color >> 16) & 255) / 255,
    g = ((color >> 8) & 255) / 255,
    b = (color & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min,
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return (v << 16) | (v << 8) | v;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  return (Math.round(f(p, q, h + 1 / 3) * 255) << 16) | (Math.round(f(p, q, h) * 255) << 8) | Math.round(f(p, q, h - 1 / 3) * 255);
}

/** Rotate the hue of an 0xRRGGBB colour by `turns` (1 = full circle), keeping saturation and lightness. */
export function shiftHue(color, turns) {
  const [h, s, l] = rgbToHsl(color);
  return hslToRgb((((h + turns) % 1) + 1) % 1, s, l);
}

/** Build a record from live game state. `src.parts` entries need only `{ id, x, y, rotation, scale, pairId }`. */
export function createCellRecord(src) {
  const nodes = (src.nodes && src.nodes.length >= MIN_NODES ? src.nodes : defaultNodes()).map((n) => ({ x: round(n.x), y: round(n.y), r: round(n.r) }));
  const parts = (src.parts || []).map((p) => ({
    id: p.id,
    x: round(p.x),
    y: round(p.y),
    rotation: round(p.rotation || 0),
    scale: round(p.scale || 1),
    pairId: p.pairId ?? null,
  }));
  const record = {
    format: CELL_FORMAT,
    version: CELL_VERSION,
    stage: "cell",
    name: String(src.name || "Karlets").slice(0, 22),
    tier: clamp(Math.round(src.tier || 1), 1, 4),
    scale: round(src.scale || 1),
    body: { nodes, pattern: src.pattern || "speckle", paintStrokes: (src.paintStrokes || []).map((s) => ({ x: round(s.x), y: round(s.y), color: s.color, size: round(s.size || 0.075) })) },
    colors: { base: src.baseColor ?? BASE_COLORS[0], pattern: src.patternColor ?? PATTERN_COLORS[0], accent: src.accentColor ?? ACCENT_COLORS[0] },
    parts,
  };
  return finishRecord(record, src.vision ?? 1);
}

function finishRecord(record, vision = 1) {
  const ids = record.parts.map((p) => p.id);
  record.diet = dietOf(ids);
  const s = computeStats(ids, record.body.nodes, vision);
  record.stats = { speed: round(s.speed), turn: round(s.turn), damage: s.damage, sight: round(s.sight), healthBonus: s.healthBonus, armour: s.armour };
  return record;
}

/**
 * Validate and sanitise untrusted data (localStorage, an uploaded file, a hand-off).
 * Returns `{ ok: true, record }` or `{ ok: false, errors }`. Out-of-range numbers are clamped rather than rejected.
 */
export function validateCellRecord(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["not an object"] };
  if (raw.format !== CELL_FORMAT) errors.push("wrong format");
  if (!Number.isInteger(raw.version) || raw.version < 1) errors.push("missing version");
  else if (raw.version > CELL_VERSION) errors.push("saved by a newer version of the game");
  if (!raw.body || !Array.isArray(raw.body.nodes) || raw.body.nodes.length < MIN_NODES) errors.push("body needs at least two spine nodes");
  if (errors.length) return { ok: false, errors };

  const nodes = raw.body.nodes.slice(0, MAX_NODES).map((n) => ({
    x: clamp(finite(n?.x, 0), -LIMITS.nodeX, LIMITS.nodeX),
    y: clamp(finite(n?.y, 0), -LIMITS.nodeY, LIMITS.nodeY),
    r: clamp(finite(n?.r, 0.4), LIMITS.radiusMin, LIMITS.radiusMax),
  }));
  const parts = [];
  let complexity = 0;
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    const def = p && PART_IDS.includes(p.id) ? partDef(p.id) : null;
    if (!def || complexity + def.complex > MAX_COMPLEXITY) continue;
    complexity += def.complex;
    parts.push({
      id: def.id,
      x: clamp(finite(p.x, 0), -LIMITS.partXY, LIMITS.partXY),
      y: clamp(finite(p.y, 0), -LIMITS.partXY, LIMITS.partXY),
      rotation: finite(p.rotation, 0),
      scale: clamp(finite(p.scale, 1), LIMITS.partScaleMin, LIMITS.partScaleMax),
      pairId: Number.isFinite(p.pairId) ? p.pairId : null,
    });
  }
  const strokes = (Array.isArray(raw.body.paintStrokes) ? raw.body.paintStrokes : [])
    .slice(0, LIMITS.strokeMax)
    .filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y))
    .map((s) => ({ x: s.x, y: s.y, color: asColor(s.color, ACCENT_COLORS[0]), size: clamp(finite(s.size, 0.075), 0.02, 0.3) }));
  const record = {
    format: CELL_FORMAT,
    version: CELL_VERSION,
    stage: "cell",
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 22) : "Karlets",
    tier: clamp(Math.round(finite(raw.tier, 1)), 1, 4),
    scale: clamp(finite(raw.scale, 1), 0.5, 2.5),
    body: { nodes, pattern: PATTERNS.includes(raw.body.pattern) ? raw.body.pattern : "speckle", paintStrokes: strokes },
    colors: {
      base: asColor(raw.colors?.base, BASE_COLORS[0]),
      pattern: asColor(raw.colors?.pattern, PATTERN_COLORS[0]),
      accent: asColor(raw.colors?.accent, ACCENT_COLORS[0]),
    },
    parts,
  };
  return { ok: true, record: finishRecord(record) };
}

/** Mirror a cell about its spine (the x axis). Reflection turns a rotation `t` into `-t`. */
export function mirrorCellRecord(record) {
  const copy = structuredCloneRecord(record);
  copy.body.nodes.forEach((n) => (n.y = -n.y || 0));
  copy.body.paintStrokes.forEach((s) => (s.y = -s.y || 0));
  copy.parts.forEach((p) => {
    p.y = -p.y || 0;
    p.rotation = -p.rotation || 0;
  });
  return copy;
}

/**
 * A relative of `record`: same diet, same parts, a slightly different body and colour.
 * `strength` scales every jitter (1 = noticeable but clearly the same species).
 */
export function mutateCellRecord(record, rng = Math.random, strength = 1) {
  const copy = structuredCloneRecord(record);
  const jitter = (amount) => (rng() - 0.5) * 2 * amount * strength;
  copy.body.nodes.forEach((n, i, all) => {
    const end = i === 0 || i === all.length - 1;
    n.r = clamp(n.r * (1 + jitter(end ? 0.06 : 0.1)), LIMITS.radiusMin, LIMITS.radiusMax);
    n.y = clamp(n.y + (end ? 0 : jitter(0.05)), -LIMITS.nodeY, LIMITS.nodeY);
  });
  const stretch = 1 + jitter(0.06);
  copy.body.nodes.forEach((n) => (n.x = clamp(n.x * stretch, -LIMITS.nodeX, LIMITS.nodeX)));
  copy.parts.forEach((p) => {
    p.scale = clamp(p.scale * (1 + jitter(0.08)), LIMITS.partScaleMin, LIMITS.partScaleMax);
    p.rotation += jitter(0.08);
  });
  copy.colors.base = shiftHue(copy.colors.base, jitter(0.035));
  copy.colors.pattern = shiftHue(copy.colors.pattern, jitter(0.05));
  if (copy.colors.accent !== record.colors.accent) copy.colors.accent = record.colors.accent;
  return finishRecord(copy);
}

function structuredCloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

export const complexityOfRecord = (record) => complexityOf(record.parts.map((p) => p.id));

/** The cell a brand-new run starts with. */
export function starterCellRecord() {
  return createCellRecord({
    name: "Karlets",
    nodes: defaultNodes(),
    parts: [
      { id: STARTER_PARTS[0], x: 1.13, y: 0, rotation: 0, scale: 1 },
      { id: STARTER_PARTS[1], x: -0.55, y: 0.68, rotation: 2.2, scale: 1 },
      { id: STARTER_PARTS[2], x: 0.45, y: 0.88, rotation: 1.2, scale: 1 },
    ],
    baseColor: BASE_COLORS[0],
    patternColor: PATTERN_COLORS[0],
    accentColor: ACCENT_COLORS[0],
    pattern: "speckle",
  });
}

/* ---- persistence ---------------------------------------------------------------- */

export function storeCellRecord(storage, record) {
  try {
    storage.setItem(CELL_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function readCellRecord(storage) {
  try {
    const raw = JSON.parse(storage.getItem(CELL_STORAGE_KEY) || "null");
    const result = raw ? validateCellRecord(raw) : { ok: false, errors: ["empty"] };
    return result.ok ? result.record : null;
  } catch {
    return null;
  }
}

/**
 * Written when the cell stage is complete. The creature stage reads it with `readHandoff()`.
 * `{ cell, completedAt, stats: { plantsEaten, meatEaten, discoveries, eliteKills }, from: 'cell-stage' }`
 */
export function writeHandoff(storage, record, progress = {}) {
  const payload = {
    from: "cell-stage",
    completedAt: new Date().toISOString(),
    progress: {
      plants: progress.plants | 0,
      meat: progress.meat | 0,
      discoveries: progress.discoveries | 0,
      eliteKills: progress.eliteKills | 0,
      dna: progress.dna | 0,
      unlocked: Array.isArray(progress.unlocked) ? progress.unlocked.filter((id) => PART_IDS.includes(id)) : [],
    },
    cell: record,
  };
  try {
    storage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function readHandoff(storage) {
  try {
    const raw = JSON.parse(storage.getItem(HANDOFF_STORAGE_KEY) || "null");
    if (!raw || raw.from !== "cell-stage") return null;
    const result = validateCellRecord(raw.cell);
    return result.ok ? { ...raw, cell: result.record } : null;
  } catch {
    return null;
  }
}

/** A downloadable copy of a cell, for sharing or backup. */
export function cellToJson(record) {
  return JSON.stringify(record, null, 2);
}

export function cellFromJson(text) {
  try {
    return validateCellRecord(JSON.parse(text));
  } catch {
    return { ok: false, errors: ["not valid JSON"] };
  }
}
