/**
 * The Cell Stage remembers. Each species keeps a grudge against you: killing its cells raises it,
 * biting them nudges it, and it fades slowly while you leave them alone. Past a threshold the species
 * changes how it treats you: prey learns to flee on sight, and hunters come for you from further off
 * and even when you are a little bigger than they would normally take on. Pure and unit tested; the
 * game applies the effects and saves the numbers with the cell.
 */

export const GRUDGE = {
  kill: 2, // a cell of theirs you killed
  bite: 0.35, // a bite that didn't kill
  max: 10,
  fadePerMinute: 0.6, // while you leave them alone
  wary: 3, // from here they treat you differently
  feud: 7, // and from here, much more so
};

/** A fresh memory, or a saved one cleaned up. */
export function readMemory(saved) {
  const grudges = {};
  for (const [id, v] of Object.entries(saved?.grudges || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0.05) grudges[id] = Math.min(GRUDGE.max, n);
  }
  return { grudges, known: Array.isArray(saved?.known) ? saved.known.filter((s) => typeof s === "string") : [] };
}

/**
 * Something you did to a species. Returns what changed in how it sees you, if anything, so the game
 * can tell you: "wary" (it just crossed the threshold) or "feud" (it now hates you).
 * @param {{grudges:Object<string,number>, known:string[]}} mem
 * @param {string} species
 * @param {"kill"|"bite"} what
 * @returns {null|"wary"|"feud"}
 */
export function remember(mem, species, what) {
  if (!species) return null;
  const before = mem.grudges[species] || 0;
  const after = Math.min(GRUDGE.max, before + (GRUDGE[what] || 0));
  mem.grudges[species] = after;
  if (before < GRUDGE.feud && after >= GRUDGE.feud) return "feud";
  if (before < GRUDGE.wary && after >= GRUDGE.wary && !mem.known.includes(species)) {
    mem.known.push(species); // told once per species; it can fade and return quietly
    return "wary";
  }
  return null;
}

/** Grudges fade over time. Growing into a new stage halves them: the old neighbours are a memory. */
export function fade(mem, seconds) {
  const k = (GRUDGE.fadePerMinute * seconds) / 60;
  for (const id of Object.keys(mem.grudges)) {
    mem.grudges[id] -= k;
    if (mem.grudges[id] <= 0.05) delete mem.grudges[id];
  }
}
export function grewUp(mem) {
  for (const id of Object.keys(mem.grudges)) mem.grudges[id] *= 0.5;
  fade(mem, 0);
}

/**
 * How a species' grudge changes its cells' behaviour toward you.
 * @param {number} grudge
 * @returns {{ fear: number, huntRange: number, huntBigger: number, label: string|null }}
 *   fear: extra distance at which prey flees you (and whether it flees even when you're not bigger);
 *   huntRange: extra distance from which a hunter comes for you;
 *   huntBigger: how much bigger than them you can be and still be hunted (1 = no change)
 */
export function attitude(grudge = 0) {
  if (grudge < GRUDGE.wary) return { fear: 0, huntRange: 0, huntBigger: 1, label: null };
  const k = Math.min(1, (grudge - GRUDGE.wary) / (GRUDGE.max - GRUDGE.wary));
  return { fear: 3 + k * 5, huntRange: 3 + k * 6, huntBigger: 1.25 + k * 0.35, label: grudge >= GRUDGE.feud ? "feud" : "wary" };
}

/** What the game says when a species turns on you. */
export function grudgeMessage(name, diet, change) {
  if (change === "feud") return diet === "meat" ? `The ${name} have sworn a feud: they hunt you wherever you go.` : `The ${name} have had enough of you: they scatter the moment you're near.`;
  return diet === "meat" ? `The ${name} remember what you did. They'll come for you from further off.` : `The ${name} remember you. They flee on sight now.`;
}
