/**
 * One portable format for everything a player makes: cells, creatures, plants, buildings, vehicles and
 * spaceships. A creation is its real design data (never just a picture) inside a versioned envelope, so
 * it can be exported, imported, kept in the Global Sporepedia, shared later, and reopened in its editor.
 */
import { validateCellRecord } from "../cell-format.js";
import { validateCreature } from "../creature/format.js";
import { ROLES, partOf, MAX_PARTS } from "./modular.js";

export const CREATION_FORMAT = "johnny-spore-creation";
export const CREATION_VERSION = 2;
/** Kinds of creation and the editor each one opens in. */
export const CREATION_KINDS = {
  cell: { name: "Cell", icon: "◉", editor: "cell" },
  creature: { name: "Creature", icon: "🦎", editor: "creature" },
  plant: { name: "Plant", icon: "🌿", editor: null },
  building: { name: "Building", icon: "🏛", editor: "building" },
  vehicle: { name: "Vehicle", icon: "🚙", editor: "vehicle" },
  ship: { name: "Spaceship", icon: "🚀", editor: "ship" },
};
const MAX_TEXT = 400_000;

/**
 * Modular designs (buildings, vehicles, spaceships) share one shape: a name, colours and a list of parts
 * placed in 3D. Validation clamps every number and drops unknown fields.
 */
/** The paints a single part can be given (the design's three colours, glass and metal). */
export const PART_PAINTS = ["base", "accent", "trim", "glass", "metal"];

export function validateModular(raw, kind) {
  if (!raw || typeof raw !== "object") throw new Error("Missing design");
  const n = (v, lo, hi, d = 0) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, MAX_PARTS[kind] || 40).map((p) => {
    if (!p || typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(p.id)) throw new Error("Bad part");
    if (!partOf(kind, p.id)) throw new Error("Unknown part " + p.id);
    // paint: optional, the design colour this part uses instead of its own (painting single parts).
    return { id: p.id, x: n(p.x, -20, 20), y: n(p.y, -20, 20), z: n(p.z, -20, 20), ry: n(p.ry, -7, 7), s: n(p.s, 0.2, 4, 1), mirror: !!p.mirror, ...(PART_PAINTS.includes(p.paint) ? { paint: p.paint } : {}) };
  });
  if (!parts.length) throw new Error("A design needs at least one part");
  return {
    kind,
    v: 1,
    name: String(raw.name || "Untitled").replace(/[<>"`\\]/g, "").slice(0, 32) || "Untitled",
    role: ROLES[kind]?.[raw.role] ? raw.role : Object.keys(ROLES[kind] || {})[0] || null,
    colors: { base: n(raw.colors?.base, 0, 0xffffff, 0xcfd8dc) | 0, accent: n(raw.colors?.accent, 0, 0xffffff, 0x3fa9d6) | 0, trim: n(raw.colors?.trim, 0, 0xffffff, 0x263238) | 0 },
    parts,
    // Vehicles: the category the player chose in the editor (land, sea or air), if any.
    ...(kind === "vehicle" && ["land", "sea", "air"].includes(raw.category) ? { category: raw.category } : {}),
  };
}

/** Validate a design of a kind. Throws with a reason if it can't be used. */
export function validateDesign(kind, data) {
  if (kind === "cell") {
    const r = validateCellRecord(data);
    if (!r.ok) throw new Error(r.errors.join(", "));
    return r.record;
  }
  if (kind === "creature") return validateCreature(data);
  if (kind === "plant") {
    if (!data || typeof data.name !== "string" || typeof data.type !== "string") throw new Error("Bad plant");
    return { name: data.name.slice(0, 32), type: data.type.slice(0, 24), habitat: String(data.habitat || "").slice(0, 32), color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#4e9a4a", accent: /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : "#d9483f", fruit: String(data.fruit || "None").slice(0, 24), needs: String(data.needs || "").slice(0, 60) };
  }
  if (kind === "building" || kind === "vehicle" || kind === "ship") return validateModular(data, kind);
  throw new Error("Unknown kind of creation");
}

/** Wrap a design for export or the global collection. */
export function wrapCreation(kind, data, meta = {}, now = Date.now()) {
  return { format: CREATION_FORMAT, version: CREATION_VERSION, kind, exportedAt: now, name: meta.name || data?.name || CREATION_KINDS[kind]?.name || "Creation", from: meta.from || null, thumb: meta.thumb || null, data };
}

/**
 * Read a creation file. Accepts this format, and version 1 Sporepedia exports (which wrapped an entry).
 * Never throws.
 * @returns {{ ok:true, kind:string, name:string, data:object, thumb:string|null } | { ok:false, error:string }}
 */
export function readCreation(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "The file is empty." };
  if (text.length > MAX_TEXT) return { ok: false, error: "That file is too big to be a creation." };
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "That isn't a creation: the file isn't valid JSON." };
  }
  if (!d || d.format !== CREATION_FORMAT) return { ok: false, error: "That isn't a Johnny Games Spore creation." };
  if (!Number.isInteger(d.version) || d.version > CREATION_VERSION) return { ok: false, error: "This creation was saved by a newer version of the game." };
  // Version 1: a Sporepedia entry export.
  let kind = d.kind,
    data = d.data;
  if (d.version === 1 && d.entry) {
    kind = d.entry.kind === "species" ? "creature" : d.entry.kind;
    data = d.entry.record || d.entry.design || null;
  }
  if (!CREATION_KINDS[kind]) return { ok: false, error: "That kind of creation can't be imported (" + String(kind) + ")." };
  try {
    data = validateDesign(kind, data);
  } catch (e) {
    return { ok: false, error: "The design inside is damaged: " + e.message + "." };
  }
  const thumb = typeof d.thumb === "string" && d.thumb.startsWith("data:image/") && d.thumb.length < 200_000 ? d.thumb : null;
  return { ok: true, kind, name: String(d.name || data.name || "Imported").replace(/[<>"`\\]/g, "").slice(0, 32), data, thumb };
}
