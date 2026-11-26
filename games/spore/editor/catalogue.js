/**
 * Search, filters and sorting for the parts catalogues. Pure: the editors describe each part with
 * a few plain fields and get back the list to show.
 *
 * An entry: { id, name, section, cost, unlocked, seen, abilities: {key: level}, diet?, order }
 * `order` is the catalogue's own order (sections, then how the designers listed them).
 */

/** Lower-case, accent-free, for forgiving matching ("Bite" finds "bite", "Grazing beak" finds "beak"). */
const fold = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Does a part match a search? Every word must match its name, section or one of its abilities. */
export function matches(entry, query, words = {}) {
  const q = fold(query).trim();
  if (!q) return true;
  // A part nobody has seen yet keeps its name secret, so only its section can match.
  const hay = fold([entry.seen === false ? "" : entry.name, words[entry.section] || entry.section, ...Object.keys(entry.abilities || {}).filter((k) => entry.abilities[k] > 0).map((k) => words[k] || k), entry.diet ? words[entry.diet] || entry.diet : ""].join(" "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export const FILTERS = ["all", "unlocked", "locked", "recent"];
export const SORTS = ["default", "name", "cost", "ability"];

/**
 * @param {object[]} entries
 * @param {{ query?: string, filter?: string, ability?: string|null, sortKey?: string, diet?: string|null, sort?: string, recent?: string[], words?: object }} o
 */
export function browse(entries, o = {}) {
  const recent = o.recent || [];
  let list = entries.filter((e) => matches(e, o.query || "", o.words || {}));
  if (o.filter === "unlocked") list = list.filter((e) => e.unlocked);
  else if (o.filter === "locked") list = list.filter((e) => !e.unlocked);
  else if (o.filter === "recent") list = list.filter((e) => recent.includes(e.id));
  if (o.ability) list = list.filter((e) => (e.abilities?.[o.ability] || 0) > 0);
  if (o.diet) list = list.filter((e) => e.diet === o.diet);
  const byOrder = (a, b) => a.order - b.order;
  const sorters = {
    default: byOrder,
    name: (a, b) => (a.seen === false) - (b.seen === false) || fold(a.name).localeCompare(fold(b.name)) || byOrder(a, b),
    cost: (a, b) => (a.cost || 0) - (b.cost || 0) || byOrder(a, b),
    // Strongest first in the chosen ability, or in all of them added up.
    ability: (a, b) => power(b, o.sortKey || o.ability) - power(a, o.sortKey || o.ability) || byOrder(a, b),
  };
  if (o.filter === "recent") list.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
  else list.sort(sorters[o.sort] || byOrder);
  return list;
}
const power = (e, key) => (key ? e.abilities?.[key] || 0 : Object.values(e.abilities || {}).reduce((s, v) => s + (v > 0 ? v : 0), 0));
