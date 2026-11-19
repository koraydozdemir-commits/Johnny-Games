/**
 * The Sporepedia: every creature, species, plant, planet and star a universe has made or found, and
 * the log of its discoveries. One per universe; it never mixes universes. Pure data, so search, sort,
 * discovery rules and validation are tested without a browser.
 *
 * Entries are small: generated things (a planet's species) are stored by reference plus the few
 * fields needed to list and search them; the full object is regenerated from the galaxy seed when
 * opened. Player creations store their design, because nothing else can recreate it.
 */
export const PEDIA_VERSION = 1;
export const PEDIA_FORMAT = "johnny-spore-creation";
const MAX_ENTRIES = 4000;
const MAX_LOG = 400;
const MAX_RECENT = 30;

export const CATEGORIES = [
  { id: "creature", name: "Creatures", icon: "🦎" },
  { id: "species", name: "Species", icon: "🧬" },
  { id: "cell", name: "Cells", icon: "◉" },
  { id: "planet", name: "Planets", icon: "🪐" },
  { id: "star", name: "Stars", icon: "✦" },
  { id: "plant", name: "Plants", icon: "🌿" },
  { id: "discovery", name: "Discoveries", icon: "🔭" },
  { id: "history", name: "Evolution", icon: "📜" },
  { id: "tribal", name: "Tribes", icon: "⛺" },
  { id: "favourites", name: "Favourites", icon: "★" },
  { id: "recent", name: "Recent", icon: "🕘" },
];
const KINDS = new Set(["creature", "species", "cell", "planet", "star", "plant", "discovery", "history", "tribal", "landmark", "building", "vehicle", "ship", "civ", "empire"]);
export const RARITY_ORDER = { Common: 0, Uncommon: 1, Rare: 2, Unique: 3 };
/** A planet's catalogue status. */
export const PLANET_STATUS = ["undiscovered", "discovered", "explored", "catalogued"];

export const emptyPedia = (seed = 0) => ({ v: PEDIA_VERSION, seed, entries: {}, log: [], recent: [], visited: {}, milestones: {} });

/** A player-typed name for an entry. */
export function cleanEntryName(raw, fallback) {
  const s = String(raw ?? "")
    .replace(/[<>"`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return s || fallback;
}

/** Read a stored Sporepedia, keeping what's sound and dropping the rest. */
export function readPedia(raw, seed = 0) {
  let d = raw;
  if (typeof raw === "string") {
    try {
      d = JSON.parse(raw);
    } catch (e) {
      return emptyPedia(seed);
    }
  }
  if (!d || typeof d !== "object" || !d.entries || typeof d.entries !== "object") return emptyPedia(seed);
  const p = emptyPedia(Number.isFinite(d.seed) ? d.seed : seed);
  let n = 0;
  for (const [id, e] of Object.entries(d.entries)) {
    if (n >= MAX_ENTRIES) break;
    if (!e || typeof e !== "object" || e.id !== id || !KINDS.has(e.kind) || typeof e.name !== "string") continue;
    p.entries[id] = { ...e, name: e.name.slice(0, 60), customName: typeof e.customName === "string" ? cleanEntryName(e.customName, "") || undefined : undefined, fav: !!e.fav };
    n++;
  }
  p.log = (Array.isArray(d.log) ? d.log : []).filter((l) => l && typeof l.text === "string" && typeof l.key === "string").slice(-MAX_LOG);
  p.recent = (Array.isArray(d.recent) ? d.recent : []).filter((id) => p.entries[id]).slice(0, MAX_RECENT);
  p.visited = d.visited && typeof d.visited === "object" ? { ...d.visited } : {};
  p.milestones = d.milestones && typeof d.milestones === "object" ? { ...d.milestones } : {};
  // The home world: chosen on the galaxy screen (or found for older universes).
  const h = d.home;
  if (h && Number.isInteger(h.starId) && h.starId >= 0 && typeof h.planetId === "string" && /^\d+:\d+$/.test(h.planetId)) {
    p.home = { starId: h.starId, planetId: h.planetId, chosen: !!h.chosen, at: Number(h.at) || 0 };
    // The homeworld's environment profile is generated once and kept with the universe, so later changes
    // to the generator never alter a world already played (see ecolib/planet-profile.js).
    const pr = h.profile;
    if (pr && typeof pr === "object" && Number.isInteger(pr.v) && pr.planetId === h.planetId && pr.terrain && pr.vegetation && pr.atmosphere && pr.water && Array.isArray(pr.biomes)) p.home.profile = pr;
  }
  return p;
}

export const nameOf = (e) => (e ? e.customName || e.name : "");

/**
 * Add or update an entry. Returns the entry. `owned` marks the player's own creations.
 * @param {object} e  { id, kind, name, at?, owned?, rarity?, origin?, data? }
 */
export function upsert(p, e, now = Date.now()) {
  const old = p.entries[e.id];
  const entry = { ...old, ...e, at: old?.at ?? e.at ?? now, updatedAt: now, fav: old?.fav || false, customName: old?.customName };
  if (!old && Object.keys(p.entries).length >= MAX_ENTRIES) return null;
  p.entries[e.id] = entry;
  return entry;
}

/**
 * Record a discovery: the entry, and (only for moments worth remembering) a log line and a
 * notification. Repeats are silent. Returns the log event, or null.
 * @param {object} e        the entry (see upsert)
 * @param {object} info     { place?:string, climate?:{temp:number,type:string}, danger?:number }
 */
export function discover(p, e, info = {}, now = Date.now()) {
  const first = !p.entries[e.id];
  const entry = upsert(p, { ...e, discoveredAt: p.entries[e.id]?.discoveredAt ?? now, by: p.entries[e.id]?.by ?? "You", place: p.entries[e.id]?.place ?? info.place }, now);
  if (!first || !entry) return null;
  let text = null,
    icon = "🔭",
    key = "found:" + e.id;
  if (e.kind === "star") (text = "Discovered the " + e.name + " system."), (icon = "✦");
  else if (e.kind === "planet") (text = "Discovered the planet " + e.name + "."), (icon = "🪐");
  else if (e.kind === "species") {
    if (e.rarity === "Rare") (text = "A rare creature: the " + e.name + "."), (icon = "💎");
    else if ((info.danger || 0) >= 4) (text = "A dangerous predator: the " + e.name + "."), (icon = "⚠");
    else (text = "First encounter with the " + e.name + "."), (icon = "🧬");
  } else if (e.kind === "plant") {
    if (e.rarity !== "Rare") return null; // ordinary plants are catalogued quietly
    (text = "A unique plant: the " + e.name + "."), (icon = "🌿");
  } else if (e.kind === "landmark") (text = "Found " + e.name[0].toLowerCase() + e.name.slice(1) + (info.place ? " on " + info.place : "") + "."), (icon = "🗺");
  else return null;
  return logEvent(p, { key, text, icon, entry: e.id }, now);
}
/** Firsts that only count once per universe: the first extreme world, the first strange world. */
export function milestone(p, key, text, icon, now = Date.now()) {
  if (p.milestones[key]) return null;
  p.milestones[key] = now;
  return logEvent(p, { key: "m:" + key, text, icon }, now);
}
export function logEvent(p, ev, now = Date.now()) {
  if (p.log.some((l) => l.key === ev.key)) return null;
  const line = { ...ev, at: now };
  p.log.push(line);
  if (p.log.length > MAX_LOG) p.log.splice(0, p.log.length - MAX_LOG);
  upsert(p, { id: "d:" + ev.key, kind: "discovery", name: ev.text, icon: ev.icon, ref: ev.entry || null }, now);
  return line;
}

/** A planet's status moves forward only: undiscovered → discovered → explored → catalogued. */
export function setPlanetStatus(p, planetId, status) {
  const e = p.entries["planet:" + planetId];
  if (!e) return false;
  if (PLANET_STATUS.indexOf(status) <= PLANET_STATUS.indexOf(e.status || "discovered")) return false;
  e.status = status;
  return true;
}
export const planetStatus = (p, planetId) => p.entries["planet:" + planetId]?.status || "undiscovered";

export function toggleFav(p, id) {
  const e = p.entries[id];
  if (!e) return false;
  e.fav = !e.fav;
  return e.fav;
}
export function rename(p, id, name) {
  const e = p.entries[id];
  if (!e) return null;
  const clean = cleanEntryName(name, "");
  e.customName = clean && clean !== e.name ? clean : undefined;
  return nameOf(e);
}
export function markViewed(p, id) {
  if (!p.entries[id]) return;
  p.recent = [id, ...p.recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
}

/**
 * Search, filter and sort.
 * @param {{ cat?:string, text?:string, sort?:"recent"|"name"|"rarity"|"danger"|"oldest", rarity?:string }} q
 */
export function query(p, q = {}) {
  let list;
  if (q.cat === "recent") list = p.recent.map((id) => p.entries[id]).filter(Boolean);
  else {
    list = Object.values(p.entries);
    if (q.cat === "favourites") list = list.filter((e) => e.fav);
    else if (q.cat) list = list.filter((e) => e.kind === q.cat || (q.cat === "discovery" && e.kind === "landmark"));
  }
  if (q.rarity) list = list.filter((e) => (e.rarity || "Common") === q.rarity);
  const text = String(q.text || "").trim().toLowerCase();
  if (text) list = list.filter((e) => [nameOf(e), e.name, e.sub, e.place, e.diet, e.type].some((v) => typeof v === "string" && v.toLowerCase().includes(text)));
  if (q.cat !== "recent") {
    const by = q.sort || "recent";
    const cmp = {
      recent: (a, b) => (b.at || 0) - (a.at || 0),
      oldest: (a, b) => (a.at || 0) - (b.at || 0),
      name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
      rarity: (a, b) => (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0) || nameOf(a).localeCompare(nameOf(b)),
      danger: (a, b) => (b.danger || 0) - (a.danger || 0) || nameOf(a).localeCompare(nameOf(b)),
    }[by];
    list.sort(cmp || ((a, b) => (b.at || 0) - (a.at || 0)));
  }
  return list;
}
export function counts(p) {
  const c = {};
  for (const e of Object.values(p.entries)) c[e.kind] = (c[e.kind] || 0) + 1;
  c.favourites = Object.values(p.entries).filter((e) => e.fav).length;
  c.recent = p.recent.length;
  return c;
}

/** Side-by-side rows for two entries of the same kind. */
export function compareRows(a, b) {
  const rows = {
    creature: [["Diet", "diet"], ["Parts", "parts"], ["Body plan", "plan"], ["Size", "size"], ["Generation", "gen"], ["Stage", "stage"], ["Universe", "universe"]],
    cell: [["Diet", "diet"], ["Parts", "parts"], ["Growth stage", "stage"], ["Generation", "gen"], ["Universe", "universe"]],
    species: [["Diet", "diet"], ["Role", "role"], ["Size", "size"], ["Danger", "danger"], ["Rarity", "rarity"], ["Habitat", "habitat"], ["Temperament", "temperament"], ["Home planet", "place"]],
    planet: [["Type", "sub"], ["Temperature", "temp"], ["Gravity", "gravity"], ["Atmosphere", "atmosphere"], ["Water", "water"], ["Life", "biodiversity"], ["Danger", "danger"], ["Status", "status"]],
    plant: [["Type", "type"], ["Habitat", "habitat"], ["Fruit", "fruit"], ["Needs", "needs"], ["Rarity", "rarity"], ["Planet", "place"]],
    star: [["Kind", "sub"], ["Planets", "planets"], ["Sector", "sector"]],
  }[a.kind];
  if (!rows || a.kind !== b.kind) return [];
  const fmt = (v) => (v === undefined || v === null || v === "" ? "—" : String(v));
  return rows.map(([label, k]) => [label, fmt(a[k]), fmt(b[k])]);
}

/** One creation as a portable file (for sharing later, online or by hand). */
export function exportEntry(e, now = Date.now()) {
  const clean = { ...e };
  delete clean.fav;
  return { format: PEDIA_FORMAT, version: PEDIA_VERSION, exportedAt: now, entry: clean };
}
