/**
 * Universe storage in IndexedDB: metadata, the parked game state of universes not being played, and
 * each universe's Sporepedia. localStorage keeps only the universe in play (as it always has) and the
 * id of the active universe, so the stages need no changes and a big galaxy never fills it.
 *
 * If IndexedDB can't be opened (some private browsing modes), a memory store stands in and
 * `persistent` is false: the game still plays, and the universe screen says other universes won't be
 * kept after closing.
 */
const DB_NAME = "johnny-spore";
const DB_VERSION = 2; // 2: the global creation collection
const STORES = ["meta", "parked", "pedia", "global"];

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}
function memoryStore() {
  const maps = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    persistent: false,
    async get(store, key) {
      return clone(maps[store].get(key));
    },
    async put(store, key, value) {
      maps[store].set(key, clone(value));
    },
    async del(store, key) {
      maps[store].delete(key);
    },
    async all(store) {
      return [...maps[store].values()].map(clone);
    },
  };
}

/** Open the store (once). */
export async function openStore(idb = globalThis.indexedDB || null) {
  if (!idb) return memoryStore();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
      setTimeout(() => reject(new Error("timeout")), 4000);
    });
  } catch (e) {
    return memoryStore();
  }
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  /** Writes resolve only once the transaction has committed, so a parked game is really on disk. */
  const commit = (store, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite");
      fn(t.objectStore(store));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error("write failed"));
      t.onabort = () => reject(t.error || new Error("write aborted (storage may be full)"));
    });
  return {
    persistent: true,
    get: (store, key) => wrap(tx(store, "readonly").get(key)),
    put: (store, key, value) => commit(store, (s) => s.put(value, key)),
    del: (store, key) => commit(store, (s) => s.delete(key)),
    all: (store) => wrap(tx(store, "readonly").getAll()),
  };
}
