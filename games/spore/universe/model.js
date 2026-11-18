/**
 * Universes: separate playthroughs, each with its own galaxy seed, species, stages, discoveries and
 * Sporepedia. The game in play keeps reading and writing its usual "johnny-spore-…" keys; a universe
 * that isn't being played is parked whole in IndexedDB (see store.js). This module is the pure part:
 * metadata, summaries, export and import validation. No storage access, so it is fully testable.
 */
export const ACTIVE_UNIVERSE_KEY = "johnny-spore-universe";
export const EXPORT_FORMAT = "johnny-spore-universe";
export const EXPORT_VERSION = 1;
export const UNIVERSE_VERSION = 1;
/** Keys that are shared by every universe (settings), or that belong to the universe system itself. */
export const SHARED_KEYS = new Set(["johnny-spore-quality", "johnny-spore-settings", ACTIVE_UNIVERSE_KEY, "johnny-spore-slot"]);
const PREFIX = "johnny-spore-";
/** An imported file can't be bigger than this (characters of JSON). */
export const IMPORT_LIMIT = 6_000_000;

/** Whether a storage key is part of a universe's game state. */
export const isGameKey = (k) => typeof k === "string" && k.startsWith(PREFIX) && !SHARED_KEYS.has(k) && !k.startsWith("johnny-spore-slot");

export const newId = (rand = Math.random) => "u" + Date.now().toString(36) + Math.floor(rand() * 1e9).toString(36);
export const newSeed = (rand = Math.random) => 1 + Math.floor(rand() * 2147483646);

/** A universe's name the player typed: trimmed, shortened, no markup. */
export function cleanUniverseName(raw, fallback = "New universe") {
  const s = String(raw ?? "")
    .replace(/[<>"`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return s || fallback;
}
/** "Name", "Name (2)", "Name (3)"…: never two universes with the same name. */
export function uniqueName(name, taken) {
  const base = cleanUniverseName(name).replace(/ \(\d+\)$/, "");
  const set = new Set(taken.map((n) => n.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; i < 999; i++) {
    const n = (base.slice(0, 26) + " (" + i + ")").trim();
    if (!set.has(n.toLowerCase())) return n;
  }
  return base + " " + Date.now();
}

/** Metadata for a new universe. */
export function newUniverse({ name, seed, now = Date.now(), rand = Math.random }) {
  return { id: newId(rand), v: UNIVERSE_VERSION, name: cleanUniverseName(name), seed: seed || newSeed(rand), createdAt: now, lastPlayed: now, playtime: 0, thumb: null, home: null };
}
/** Read stored metadata defensively. */
export function readMeta(m) {
  if (!m || typeof m !== "object" || typeof m.id !== "string" || !/^u[a-z0-9]{4,30}$/.test(m.id)) return null;
  const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    id: m.id,
    v: UNIVERSE_VERSION,
    name: cleanUniverseName(m.name, "Universe"),
    seed: Math.max(1, Math.floor(n(m.seed, 1))) % 2147483647 || 1,
    createdAt: n(m.createdAt),
    lastPlayed: n(m.lastPlayed),
    playtime: Math.max(0, n(m.playtime)),
    thumb: typeof m.thumb === "string" && m.thumb.startsWith("data:image/") && m.thumb.length < 200_000 ? m.thumb : null,
    // Where its species began, for the universe's card: names only.
    home: m.home && typeof m.home === "object" && typeof m.home.planet === "string" ? { planet: cleanUniverseName(m.home.planet, "Home"), star: cleanUniverseName(m.home.star, "Unknown star"), t: 3 } : null,
  };
}

const parse = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};
/**
 * What a universe holds, from its game keys, for its card: species, stage and progress.
 * @param {Object<string,string>} keys
 */
export function summarize(keys) {
  const civ = parse(keys["johnny-spore-civ-stage"]);
  const tribe = parse(keys["johnny-spore-tribe-stage"]);
  const creature = parse(keys["johnny-spore-creature-stage"]);
  const cell = parse(keys["johnny-spore-cell-stage"]);
  if (civ && Array.isArray(civ.cities) && civ.cities.length) {
    const yours = civ.cities.filter((c) => c?.owner === "you").length;
    return { stage: "Civilization", icon: "🏛", species: tribe?.look?.name || creature?.record?.name || "Your nation", detail: civ.won ? "The world is united" : yours + " / " + civ.cities.length + " cities", progress: civ.won ? 1 : yours / civ.cities.length };
  }
  if (tribe && Array.isArray(tribe.tribes)) {
    const settled = tribe.tribes.filter((t) => t?.status === "allied" || t?.status === "conquered").length;
    return {
      stage: "Tribal",
      icon: "⛺",
      species: tribe.look?.name || creature?.record?.name || "Your tribe",
      detail: tribe.won ? "Island settled" : settled + " / " + tribe.tribes.length + " tribes settled",
      progress: 0.66 + 0.34 * (tribe.won ? 1 : settled / Math.max(1, tribe.tribes.length)),
    };
  }
  if (creature && creature.record) {
    const brain = Math.max(1, Math.min(5, creature.brain || 1));
    return { stage: "Creature", icon: "🦎", species: creature.record.name || "Your creature", detail: "Brain level " + brain + " / 5", progress: 0.33 + 0.33 * ((brain - 1) / 4) };
  }
  if (cell) {
    const tier = cell.tier || cell.state?.tier || 1;
    return { stage: "Cell", icon: "◉", species: cell.cellName || cell.state?.cellName || "Your cell", detail: "Growth stage " + tier + " / 4", progress: 0.33 * ((tier - 1) / 4) };
  }
  return { stage: "New", icon: "✦", species: "Not yet evolved", detail: "A new beginning", progress: 0 };
}

/** A portable copy of a universe. */
export function exportUniverse(meta, keys, pedia, now = Date.now()) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    universe: { name: meta.name, seed: meta.seed, createdAt: meta.createdAt, playtime: meta.playtime, thumb: meta.thumb || null },
    keys: Object.fromEntries(Object.entries(keys).filter(([k]) => isGameKey(k))),
    pedia: pedia || null,
  };
}

/**
 * Check an imported file before anything is written. Never throws.
 * @param {string} text
 * @returns {{ ok:true, universe:object, keys:Object<string,string>, pedia:object|null } | { ok:false, error:string }}
 */
export function validateImport(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "The file is empty." };
  if (text.length > IMPORT_LIMIT) return { ok: false, error: "The file is too big to be a universe save." };
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "That isn't a universe save: the file isn't valid JSON." };
  }
  if (!d || typeof d !== "object" || d.format !== EXPORT_FORMAT) return { ok: false, error: "That isn't a Johnny Games Spore universe file." };
  if (!Number.isInteger(d.version) || d.version < 1) return { ok: false, error: "The file has no version, so it can't be read safely." };
  if (d.version > EXPORT_VERSION) return { ok: false, error: "This universe was saved by a newer version of the game." };
  if (!d.keys || typeof d.keys !== "object" || Array.isArray(d.keys)) return { ok: false, error: "The file is missing its game data." };
  const keys = {};
  for (const [k, v] of Object.entries(d.keys)) {
    if (!isGameKey(k) || typeof v !== "string") continue; // anything else is ignored, never written
    if (k.length > 80) continue;
    keys[k] = v;
  }
  // Every stage save inside must at least be valid JSON.
  for (const k of ["johnny-spore-cell-stage", "johnny-spore-creature-stage", "johnny-spore-tribe-stage", "johnny-spore-civ-stage"])
    if (k in keys && parse(keys[k]) === null) return { ok: false, error: "Part of the save is damaged (" + k.replace(PREFIX, "") + ")." };
  const u = d.universe && typeof d.universe === "object" ? d.universe : {};
  return {
    ok: true,
    universe: { name: cleanUniverseName(u.name, "Imported universe"), seed: Number.isInteger(u.seed) && u.seed > 0 ? u.seed : null, createdAt: Number(u.createdAt) || Date.now(), playtime: Math.max(0, Number(u.playtime) || 0), thumb: typeof u.thumb === "string" && u.thumb.startsWith("data:image/") && u.thumb.length < 200_000 ? u.thumb : null },
    keys,
    pedia: d.pedia && typeof d.pedia === "object" ? d.pedia : null,
  };
}

/** Plain-language play time. */
export function formatPlaytime(seconds) {
  const m = Math.floor(seconds / 60);
  if (m < 1) return "Under a minute";
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h " + (m % 60) + " min";
}
export function formatWhen(t, now = Date.now()) {
  if (!t) return "Never";
  const d = (now - t) / 1000;
  if (d < 90) return "Just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  if (d < 86400 * 7) return Math.round(d / 86400) + " days ago";
  return new Date(t).toLocaleDateString();
}

/* ---- galaxy seed sharing ---------------------------------------------------------------------- */
export const SEED_FORMAT = "johnny-spore-seed";
/** A short code a friend can type: SPORE-XXXXXX. */
export const shareCode = (seed) => "SPORE-" + Math.floor(seed).toString(36).toUpperCase();
/** A typed seed: a number, or a share code. Null if it isn't one. */
export function parseSeed(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let n;
  const m = /^SPORE-([0-9A-Z]{1,7})$/i.exec(t);
  if (m) n = parseInt(m[1], 36);
  else if (/^\d{1,10}$/.test(t)) n = Number(t);
  else return null;
  return Number.isInteger(n) && n >= 1 && n <= 2147483646 ? n : null;
}
export const seedFile = (meta, now = Date.now()) => ({ format: SEED_FORMAT, version: 1, seed: meta.seed, code: shareCode(meta.seed), name: meta.name, exportedAt: now });
export function readSeedFile(text) {
  try {
    const d = JSON.parse(text);
    if (d?.format !== SEED_FORMAT || !Number.isInteger(d.seed) || d.seed < 1 || d.seed > 2147483646) return null;
    return { seed: d.seed, name: cleanUniverseName(d.name ? d.name + " (shared)" : "", "Shared galaxy") };
  } catch (e) {
    return null;
  }
}
