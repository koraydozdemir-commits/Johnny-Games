/**
 * Switching, creating, copying, deleting, exporting and importing universes. The rule that keeps
 * every universe safe: the game in play is copied into IndexedDB (and that write has committed)
 * before a single localStorage key is removed, and a failed switch puts everything back.
 */
import { pedia as pediaApi } from "./pedia-store.js";
import { removeUniverseCreations } from "./global.js";
import { ACTIVE_UNIVERSE_KEY, exportUniverse, isGameKey, newUniverse, readMeta, readSeedFile, uniqueName, validateImport } from "./model.js";

const keysOf = (ls) => {
  const out = [];
  for (let i = 0; i < ls.length; i++) out.push(ls.key(i));
  return out;
};
/** The game in play, as a plain object of its keys. */
export function currentKeys(ls) {
  const out = {};
  for (const k of keysOf(ls)) if (isGameKey(k)) out[k] = ls.getItem(k);
  return out;
}
function clearGame(ls) {
  for (const k of keysOf(ls)) if (isGameKey(k)) ls.removeItem(k);
}
function writeGame(ls, keys) {
  for (const [k, v] of Object.entries(keys)) if (isGameKey(k) && typeof v === "string") ls.setItem(k, v);
}

/**
 * Start-up: find the universe in play, or create one around whatever game is already saved (and
 * turn old save slots into universes of their own). Nothing is deleted until its copy has committed.
 * @returns {Promise<{ meta:object, metas:object[] }>}
 */
export async function bootUniverses(store, ls, { name = "First universe", rand = Math.random } = {}) {
  const metas = (await store.all("meta")).map(readMeta).filter(Boolean);
  let activeId = null;
  try {
    activeId = ls.getItem(ACTIVE_UNIVERSE_KEY);
  } catch (e) {
    /* no storage */
  }
  let meta = metas.find((m) => m.id === activeId);
  if (meta) return { meta, metas };
  // First run with universes (or the active one went missing): the game in play becomes a universe.
  meta = newUniverse({ name: uniqueName(name, metas.map((m) => m.name)), rand });
  await store.put("meta", meta.id, meta);
  metas.push(meta);
  // Old save slots: each parked slot becomes its own universe.
  for (let n = 1; n <= 3; n++) {
    const prefix = "johnny-spore-slot" + n + "::";
    const slotKeys = keysOf(ls).filter((k) => k && k.startsWith(prefix));
    if (!slotKeys.length) continue;
    const keys = Object.fromEntries(slotKeys.map((k) => [k.slice(prefix.length), ls.getItem(k)]));
    const m = newUniverse({ name: uniqueName("Save slot " + n, metas.map((x) => x.name)), rand });
    await store.put("parked", m.id, keys);
    await store.put("meta", m.id, m);
    metas.push(m);
    slotKeys.forEach((k) => ls.removeItem(k));
  }
  ls.setItem(ACTIVE_UNIVERSE_KEY, meta.id);
  ls.removeItem("johnny-spore-slot");
  return { meta, metas };
}

/** Copy the game in play into IndexedDB. */
export async function parkActive(store, ls, meta) {
  const keys = currentKeys(ls);
  await store.put("parked", meta.id, keys);
  const back = await store.get("parked", meta.id);
  if (!back || Object.keys(back).length !== Object.keys(keys).length) throw new Error("The save couldn't be verified.");
  return keys;
}

/**
 * Make another universe the one in play. The caller saves the running game first and reloads after.
 */
export async function activate(store, ls, current, targetId) {
  const target = readMeta(await store.get("meta", targetId));
  if (!target) throw new Error("That universe couldn't be found.");
  const mine = await parkActive(store, ls, current);
  const keys = (await store.get("parked", targetId)) || {};
  try {
    clearGame(ls);
    writeGame(ls, keys);
    ls.setItem(ACTIVE_UNIVERSE_KEY, targetId);
  } catch (e) {
    // Storage full, or a write failed part way: put the game in play back exactly as it was.
    clearGame(ls);
    writeGame(ls, mine);
    ls.setItem(ACTIVE_UNIVERSE_KEY, current.id);
    throw new Error("There isn't enough storage to load that universe.");
  }
  target.lastPlayed = Date.now();
  await store.put("meta", target.id, target);
  // The live keys are now the truth: drop the stale parked copy.
  await store.del("parked", targetId);
  return target;
}

/** A brand-new universe, with its own galaxy seed, becomes the one in play. */
export async function createUniverse(store, ls, current, { name, seed, rand = Math.random } = {}) {
  const metas = (await store.all("meta")).map(readMeta).filter(Boolean);
  const meta = newUniverse({ name: uniqueName(name || "New universe", metas.map((m) => m.name)), seed, rand });
  await parkActive(store, ls, current);
  await store.put("meta", meta.id, meta);
  clearGame(ls);
  ls.setItem(ACTIVE_UNIVERSE_KEY, meta.id);
  return meta;
}

/** The keys of any universe, in play or parked. */
export async function keysFor(store, ls, current, id) {
  return id === current.id ? currentKeys(ls) : (await store.get("parked", id)) || {};
}

/** A copy of a universe (same galaxy seed, same game, same Sporepedia), parked under a new name. */
export async function duplicateUniverse(store, ls, current, id) {
  const src = readMeta(await store.get("meta", id));
  if (!src) throw new Error("That universe couldn't be found.");
  const metas = (await store.all("meta")).map(readMeta).filter(Boolean);
  const copy = { ...newUniverse({ name: uniqueName(src.name + " copy", metas.map((m) => m.name)), seed: src.seed }), playtime: src.playtime, thumb: src.thumb };
  await store.put("parked", copy.id, await keysFor(store, ls, current, id));
  const ped = await pediaApi.get(store, id);
  if (ped) await pediaApi.put(store, copy.id, ped);
  await store.put("meta", copy.id, copy);
  return copy;
}

/**
 * Delete a universe that isn't in play. Its creations stay in the Global Sporepedia unless
 * `removeCreations` is set.
 */
export async function deleteUniverse(store, current, id, { removeCreations = false } = {}) {
  if (id === current.id) throw new Error("You can't delete the universe you're playing. Switch to another one first.");
  await store.del("parked", id);
  await store.del("pedia", id);
  await store.del("meta", id);
  if (removeCreations) await removeUniverseCreations(store, id);
}

export async function renameUniverse(store, id, name) {
  const m = readMeta(await store.get("meta", id));
  if (!m) return null;
  const metas = (await store.all("meta")).map(readMeta).filter((x) => x && x.id !== id);
  m.name = uniqueName(name, metas.map((x) => x.name));
  await store.put("meta", id, m);
  return m;
}

/** The export file's text for a universe. */
export async function exportText(store, ls, current, id) {
  const meta = readMeta(await store.get("meta", id));
  if (!meta) throw new Error("That universe couldn't be found.");
  return JSON.stringify(exportUniverse(meta, await keysFor(store, ls, current, id), await pediaApi.get(store, id)));
}

/** Import a file as a new, parked universe. Never touches any existing universe. */
export async function importText(store, text) {
  // A shared galaxy seed: a fresh universe in the same galaxy.
  const seedFile = readSeedFile(text);
  if (seedFile) {
    const metas = (await store.all("meta")).map(readMeta).filter(Boolean);
    const meta = newUniverse({ name: uniqueName(seedFile.name || "Shared galaxy", metas.map((m) => m.name)), seed: seedFile.seed });
    await store.put("meta", meta.id, meta);
    return meta;
  }
  const r = validateImport(text);
  if (!r.ok) throw new Error(r.error);
  const metas = (await store.all("meta")).map(readMeta).filter(Boolean);
  const meta = { ...newUniverse({ name: uniqueName(r.universe.name, metas.map((m) => m.name)), seed: r.universe.seed || undefined }), playtime: r.universe.playtime, thumb: r.universe.thumb };
  await store.put("parked", meta.id, r.keys);
  if (r.pedia) await pediaApi.put(store, meta.id, r.pedia);
  await store.put("meta", meta.id, meta);
  return meta;
}
