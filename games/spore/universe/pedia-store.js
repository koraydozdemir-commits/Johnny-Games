/** Each universe's Sporepedia, kept in IndexedDB beside its metadata. */
import { readPedia } from "../pedia/model.js";

export const pedia = {
  async get(store, id) {
    const raw = await store.get("pedia", id);
    return raw ? readPedia(raw) : null;
  },
  async put(store, id, p) {
    await store.put("pedia", id, JSON.parse(JSON.stringify(p)));
  },
};
