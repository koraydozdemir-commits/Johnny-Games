/**
 * The Global Sporepedia: every creation from every universe, in one place that outlives the universes.
 * Kept in its own IndexedDB store. Entries are copies of a universe's own creations, keyed by universe
 * and entry, so updating a creation in its universe updates its global copy, and deleting a universe
 * leaves its creations here unless the player chooses to remove them.
 */
import { CREATION_KINDS } from "../creations/format.js";

export const GLOBAL_KINDS = new Set(["cell", "creature", "building", "vehicle", "ship", "plant"]);
const keyOf = (universeId, entryId) => universeId + "|" + entryId;

/** A universe's creation, as stored globally. Only designs are kept (never generated things). */
export function toGlobal(meta, entry, now = Date.now()) {
  if (!entry?.owned || !GLOBAL_KINDS.has(entry.kind)) return null;
  const design = entry.record || entry.design || null;
  if (!design) return null;
  return {
    gid: keyOf(meta.id, entry.id),
    id: keyOf(meta.id, entry.id),
    kind: entry.kind,
    owned: true,
    name: entry.customName || entry.name,
    sub: (CREATION_KINDS[entry.kind]?.name || entry.kind) + " · " + meta.name,
    universeId: meta.id,
    universe: meta.name,
    record: entry.kind === "creature" || entry.kind === "cell" ? design : undefined,
    design: entry.kind !== "creature" && entry.kind !== "cell" ? design : undefined,
    thumb: entry.thumb || null,
    diet: entry.diet,
    stage: entry.stage,
    gen: entry.gen,
    place: entry.place,
    at: entry.at || now,
    savedAt: now,
  };
}

export async function putGlobal(store, meta, entry) {
  const g = toGlobal(meta, entry);
  if (!g) return null;
  const old = await store.get("global", g.gid);
  // Global favourites and renames are the player's own: keep them across updates.
  if (old) (g.fav = old.fav), (g.customName = old.customName);
  await store.put("global", g.gid, g);
  return g;
}
export const listGlobal = async (store) => (await store.all("global")).filter((g) => g && typeof g.gid === "string");
export async function updateGlobal(store, g) {
  await store.put("global", g.gid, g);
}
/** Remove one universe's creations from the global collection (only when the player asks to). */
export async function removeUniverseCreations(store, universeId) {
  const all = await listGlobal(store);
  let n = 0;
  for (const g of all)
    if (g.universeId === universeId) {
      await store.del("global", g.gid);
      n++;
    }
  return n;
}
/** The global collection in the shape the Sporepedia screen reads. */
export function asPedia(list) {
  const entries = {};
  for (const g of list) entries[g.gid] = g;
  return { v: 1, seed: 0, entries, log: [], recent: [], visited: {}, milestones: {}, global: true };
}
