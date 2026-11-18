/**
 * Save slots. The game always reads and writes its usual keys ("johnny-spore-…"); a slot that isn't
 * being played is parked under "johnny-spore-slotN::<key>". Switching slots parks the current game,
 * brings the chosen one back and reloads the page, so no other code needs to know slots exist.
 *
 * Every function takes the Storage to use, so they can be tested without a browser.
 */

export const SLOT_COUNT = 3;
const PREFIX = "johnny-spore-";
const ACTIVE_KEY = "johnny-spore-slot";
const SAVED_AT_KEY = "johnny-spore-saved-at";
/** Settings shared by every slot. */
const GLOBAL_KEYS = new Set(["johnny-spore-quality", "johnny-spore-settings", ACTIVE_KEY]);
const parked = (n) => ACTIVE_KEY + n + "::";

const keysOf = (store) => {
  const out = [];
  for (let i = 0; i < store.length; i++) out.push(store.key(i));
  return out;
};
const clampSlot = (n) => Math.min(SLOT_COUNT, Math.max(1, Math.round(Number(n)) || 1));

/** The slot being played (1 when none has been chosen yet). */
export function activeSlot(store) {
  try {
    return clampSlot(store.getItem(ACTIVE_KEY) || 1);
  } catch (e) {
    return 1;
  }
}

/** Keys that belong to the game in play (not settings, not parked slots). */
export function gameKeys(store) {
  return keysOf(store).filter((k) => k && k.startsWith(PREFIX) && !GLOBAL_KEYS.has(k) && !k.startsWith(ACTIVE_KEY));
}

/** Record when the game in play was last saved, for the slot list. */
export function markSaved(store, when = Date.now()) {
  try {
    store.setItem(SAVED_AT_KEY, String(when));
  } catch (e) {
    /* storage full or unavailable */
  }
}

const readJSON = (raw) => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

/**
 * What a slot holds, for the settings screen.
 * @returns {{ slot:number, active:boolean, empty:boolean, savedAt:number|null, label:string }}
 */
export function slotSummary(store, n) {
  n = clampSlot(n);
  const active = n === activeSlot(store);
  const get = (k) => store.getItem(active ? k : parked(n) + k);
  const has = active ? gameKeys(store).length > 0 : keysOf(store).some((k) => k.startsWith(parked(n)));
  const civ = readJSON(get("johnny-spore-civ-stage"));
  const tribe = readJSON(get("johnny-spore-tribe-stage"));
  const creature = readJSON(get("johnny-spore-creature-stage"));
  const cell = readJSON(get("johnny-spore-cell-stage"));
  const savedAt = Number(get(SAVED_AT_KEY)) || null;
  let label = "Empty";
  if (civ && Array.isArray(civ.cities)) label = "Civilization Stage · " + civ.cities.filter((c) => c?.owner === "you").length + " / " + civ.cities.length + " cities";
  else if (tribe && Array.isArray(tribe.tribes)) label = "Tribal Stage" + (tribe.look?.name ? " · " + tribe.look.name : "");
  else if (creature) label = "Creature Stage · Brain " + (creature.brain || 1) + (creature.record?.name ? " · " + creature.record.name : "");
  else if (cell) label = "Cell Stage · Tier " + (cell.tier || cell.state?.tier || 1) + (cell.cellName || cell.state?.cellName ? " · " + (cell.cellName || cell.state.cellName) : "");
  else if (has) label = "New game";
  return { slot: n, active, empty: !has, savedAt, label };
}

/** Park the game in play and bring slot n back. The caller reloads the page afterwards. */
export function switchSlot(store, n) {
  n = clampSlot(n);
  const current = activeSlot(store);
  if (n === current) return false;
  for (const k of gameKeys(store)) {
    store.setItem(parked(current) + k, store.getItem(k));
    store.removeItem(k);
  }
  for (const k of keysOf(store).filter((key) => key.startsWith(parked(n)))) {
    store.setItem(k.slice(parked(n).length), store.getItem(k));
    store.removeItem(k);
  }
  store.setItem(ACTIVE_KEY, String(n));
  return true;
}

/** Delete everything in slot n (the game in play too, when n is the active slot). */
export function clearSlot(store, n) {
  n = clampSlot(n);
  const keys = n === activeSlot(store) ? gameKeys(store) : keysOf(store).filter((k) => k.startsWith(parked(n)));
  keys.forEach((k) => store.removeItem(k));
}
