/**
 * How a creature's body moves: the body plan, bulk, legs, tail and fins decide its top speed,
 * acceleration, turning, swimming and how noticeable it is. Pure functions of the creature record,
 * shared by the stage (movement) and the editor (the stats readout).
 *
 * Trade-offs, not upgrades: long legs are fast but heavy bodies are slow; more legs accelerate and
 * stay steady but top out lower; a big body hits harder in a charge but is spotted sooner.
 */
import { creaturePartIds } from "./format.js";

/** Body plans by pairs of legs. */
export const PLANS = {
  0: { id: "legless", name: "Legless", top: 3.4, accel: 3.2, turn: 3.0 },
  1: { id: "biped", name: "Biped", top: 5.0, accel: 4.6, turn: 3.6 },
  2: { id: "quadruped", name: "Quadruped", top: 4.8, accel: 6.0, turn: 4.0 },
  3: { id: "hexapod", name: "Hexapod", top: 4.3, accel: 7.4, turn: 4.4 },
};
/** Heavy parts and how much bulk they add. */
const HEAVY = { shell: 0.25, plates: 0.18, stompers: 0.22, tailClub: 0.12, sail: 0.1, antlers: 0.1, tuskMaw: 0.08 };
/** Parts that help in water, and by how much. */
const SWIM = { webbed: 0.35, fanFins: 0.3, tentacles: 0.25 };

/** Body bulk: 1 for a typical hatchling, more for a fat or long body and heavy parts. */
export function bulkOf(record) {
  const volume = record.spine.reduce((v, n) => v + n.r * n.r, 0);
  const parts = creaturePartIds(record).reduce((v, id) => v + (HEAVY[id] || 0), 0);
  return Math.max(0.45, Math.min(2.6, volume / 1.05 + parts));
}

/**
 * Movement profile.
 * @param {object} record a validated creature record
 * @param {object} abilities its abilities (abilitiesOf), for the speed stat
 * @returns {{plan:string, planName:string, top:number, accel:number, turn:number, swim:number, bulk:number, notice:number, chargeMult:number}}
 *   top: walking speed in m/s · accel: how quickly it gets there (per second) · turn: rad/s ·
 *   swim: speed multiplier in deep water · notice: how far away others spot you (×) ·
 *   chargeMult: how hard your weight lands in a charge (×)
 */
export function movementOf(record, abilities) {
  const pairs = Math.min(3, record.legs.length);
  const plan = PLANS[pairs];
  const bulk = bulkOf(record);
  const legLen = pairs ? record.legs.reduce((s, l) => s + (l.length || 1), 0) / pairs : 0;
  const ids = creaturePartIds(record);
  const hasTail = ids.some((id) => ["tailClub", "stinger", "plumeTail", "fanTail", "rattleTail"].includes(id));
  // Longer legs stride further; bulk drags you down; feet add the speed stat as before.
  const stride = pairs ? 1 + 0.35 * (legLen - 1) : 1;
  const weight = 1 / (0.82 + 0.18 * bulk);
  const top = plan.top * stride * weight + (abilities.speed || 0) * 0.8;
  const accel = plan.accel * (0.75 + 0.25 * weight) + (pairs ? 0 : 0.4);
  // A tail is a counterweight: sharper turns. Bulk turns slowly.
  const turn = plan.turn * (hasTail ? 1.15 : 1) * (0.8 + 0.2 * weight);
  let swim = 0.55 + ids.reduce((v, id) => v + (SWIM[id] || 0), 0) + (pairs === 0 ? 0.2 : 0);
  swim = Math.min(1.35, swim);
  // Small, low bodies are noticed later; big ones from further off.
  const notice = Math.max(0.7, Math.min(1.35, 0.72 + 0.28 * bulk + (pairs === 0 ? -0.08 : 0)));
  const chargeMult = Math.max(0.8, Math.min(1.45, 0.75 + 0.3 * bulk));
  return { plan: plan.id, planName: plan.name, top, accel, turn, swim, bulk, notice, chargeMult };
}

/** A 1..5 rating of a movement number, for the editor's bars. */
export function rate(value, lo, hi) {
  return Math.max(1, Math.min(5, Math.round(1 + ((value - lo) / (hi - lo)) * 4)));
}
