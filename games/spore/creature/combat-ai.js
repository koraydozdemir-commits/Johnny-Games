/**
 * Creature combat AI: the decisions, as pure functions, so they can be tested without a browser.
 *
 * Every creature in a fight is in one of nine states. Once a fight begins it commits: it approaches,
 * engages, attacks, repositions and dodges, and only retreats when it is genuinely low on health or
 * hopelessly outmatched (and then only once per fight, to a bounded place, for a bounded time). When it
 * is done it returns to its territory, and it never chases without limit.
 *
 *   idle         nothing going on
 *   alert        has noticed you, not yet decided to fight
 *   approaching  closing in on a target
 *   engaging     in range: circling, waiting for its opening
 *   attacking    winding up or striking
 *   dodging      sidestepping an incoming blow
 *   defending    fighting for a nestmate, packmate or family under attack
 *   retreating   falling back, hurt
 *   returning    walking back to its territory
 *
 * stage.js owns movement and damage; this module owns which state a creature is in and what it intends.
 */
export const STATES = ["idle", "alert", "approaching", "engaging", "attacking", "dodging", "defending", "retreating", "returning"];

/** Base nerve by role: how willing a creature is to keep fighting when hurt. 0..1 */
const ROLE_COURAGE = { prey: 0.2, grazer: 0.5, standard: 0.65, kin: 0.8, predator: 0.8, ambusher: 0.7, guardian: 0.85, giant: 0.8, rogue: 0.95, apex: 1 };
export function courageOf({ role = "standard", alpha = false, epic = false, rogue = false, brave = 0.5 } = {}) {
  const base = epic ? ROLE_COURAGE.apex : rogue ? ROLE_COURAGE.rogue : ROLE_COURAGE[role] ?? 0.65;
  // brave (0..1) is the individual's own temper; alphas lead from the front.
  return Math.max(0, Math.min(1, base + (brave - 0.5) * 0.3 + (alpha ? 0.12 : 0)));
}

/** Health fraction below which a creature falls back: timid ones early, brave ones almost never. */
export const retreatThreshold = (courage) => Math.max(0.05, 0.5 * (1 - courage) + 0.06);

/**
 * Hopelessly outmatched: the foe is so much stronger that fighting on is pointless. Brave creatures
 * need a far bigger gap before they give up.
 * @param {number} ratio foe power / own power (health × damage)
 */
export const outmatched = (ratio, courage) => ratio > 1.8 + courage * 3.2;

/** How far from its territory a creature will chase: bolder and bigger fighters chase further. */
export const chaseLimit = (courage, { rogue = false, epic = false } = {}) => (epic ? 70 : rogue ? 60 : 24 + courage * 22);

/** How long a retreat lasts, seconds: short, so nobody runs off for good. */
export const RETREAT_TIME = [3, 5];
/** After a retreat a creature stays out of the fight this long while it walks home and recovers. */
export const RECOVER_TIME = 9;

/**
 * Decide a creature's state for this moment.
 * @param {object} c
 * @param {string} c.state       its current state
 * @param {boolean} c.hostile    would fight you now (angry nest, hostile temper, rogue, raider…)
 * @param {boolean} c.engaged    has traded blows or been struck recently
 * @param {boolean} c.defending  a nestmate/packmate/family member next to it is under attack
 * @param {number} c.d           distance to its target
 * @param {number} c.reach       its attack reach
 * @param {number} c.aggro       distance at which it notices and commits
 * @param {number} c.hpFrac      health fraction
 * @param {number} c.courage     see courageOf
 * @param {number} c.power       foe power / own power
 * @param {number} c.homeD       distance from its territory
 * @param {number} c.chaseD      distance travelled from where this chase began
 * @param {number} c.leash       chaseLimit
 * @param {boolean} c.winding    mid wind-up or strike
 * @param {number} c.backT       seconds left repositioning after a strike
 * @param {boolean} c.incoming   the foe has just started an attack at it
 * @param {number} c.dodgeCool   seconds until it may dodge again
 * @param {boolean} c.retreated  already fell back once in this fight
 * @param {number} c.retreatT    seconds left in a retreat (0 if none)
 * @returns {{state:string, intent:"hold"|"approach"|"circle"|"retreat"|"return"|"strike"|"sidestep"|"watch", paceK:number, startRetreat:boolean}}
 */
export function decide(c) {
  const out = (state, intent, paceK = 1, startRetreat = false) => ({ state, intent, paceK, startRetreat });
  // Mid-strike is never interrupted by a decision.
  if (c.winding) return out("attacking", "strike", 0);
  // A retreat in progress runs its short course, then it walks home.
  if (c.retreatT > 0) return out("retreating", "retreat", 1.25);
  if (c.state === "retreating" || c.state === "returning") {
    if (c.homeD > 6 && !(c.engaged && c.d < c.reach + 1.2 && c.courage > 0.6)) return out("returning", "return", 0.75);
    if (c.homeD <= 6) return out("idle", "hold", 0);
  }
  const committed = c.hostile || c.engaged || c.defending;
  if (!committed) return c.d < c.aggro * 1.4 ? out("alert", "watch", 0) : out("idle", "hold", 0);

  // Genuinely low or hopelessly outmatched: fall back, once.
  const low = c.hpFrac < retreatThreshold(c.courage);
  if (!c.retreated && (low || outmatched(c.power, c.courage)) && c.engaged) return out("retreating", "retreat", 1.25, true);

  // Chase boundaries: never run on without limit.
  if (c.homeD > c.leash || c.chaseD > c.leash * 1.25) return out("returning", "return", 0.75);
  if (c.d > c.aggro * 1.7 && !c.defending) return out("returning", "return", 0.75);

  if (c.incoming && c.dodgeCool <= 0 && c.d < c.reach + 2.4) return out("dodging", "sidestep", 1.6);
  if (c.backT > 0) return out(c.defending ? "defending" : "engaging", "circle", 0.85);
  if (c.d > c.reach + 0.8) return out(c.defending && !c.hostile && !c.engaged ? "defending" : "approaching", "approach", 1);
  return out(c.defending ? "defending" : "engaging", c.d < c.reach + 0.6 ? "strike" : "circle", 0.8);
}

/** Probability that an engaged creature sidesteps a blow it can see coming (never against ambushes). */
export const dodgeChance = (courage, stunned = false) => (stunned ? 0 : 0.08 + courage * 0.1);

/**
 * The spot a creature should head for when attacking `target`, so a group spreads round the foe
 * instead of piling onto one point. `slot` and `slots` number the attackers.
 */
export function flankPoint(target, from, slot, slots, radius) {
  const base = Math.atan2(from.z - target.z, from.x - target.x);
  // Spread over a half-circle on the attacker's side of the target.
  const spread = slots > 1 ? (slot / (slots - 1) - 0.5) * Math.min(Math.PI * 1.2, 0.8 * slots) : 0;
  return { x: target.x + Math.cos(base + spread) * radius, z: target.z + Math.sin(base + spread) * radius };
}

/**
 * Give each pack member a target and a slot. Members take the nearest threat to the pack (anything
 * hunting the player or a packmate), but at most `perTarget` share one, and they fan out around it.
 * @param {Array<{id:string,x:number,z:number}>} members
 * @param {Array<{id:string,x:number,z:number}>} threats  ordered by priority
 * @returns {Map<string,{target:object, slot:number, slots:number}>}
 */
export function assignPack(members, threats, perTarget = 2) {
  const out = new Map();
  if (!threats.length) return out;
  const taken = new Map();
  const sorted = [...members];
  for (const m of sorted) {
    let best = null,
      bd = Infinity;
    for (const t of threats) {
      const full = (taken.get(t.id) || 0) >= perTarget;
      const d = Math.hypot(t.x - m.x, t.z - m.z) + (full ? 40 : 0);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    taken.set(best.id, (taken.get(best.id) || 0) + 1);
    out.set(m.id, { target: best, slot: taken.get(best.id) - 1, slots: 0 });
  }
  for (const v of out.values()) v.slots = taken.get(v.target.id);
  return out;
}

/** Stuck detection: moved less than `min` metres in a window while wanting to go further. */
export const isStuck = (movedRecently, wantDistance, min = 0.4) => wantDistance > 3 && movedRecently < min;
