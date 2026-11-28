/**
 * The small decisions behind how cells hunt and flee, as plain state machines (no THREE, no DOM).
 *
 * What this adds over "swim straight at / away from the target":
 *  - Stamina. Sprinting drains it; an exhausted cell is slow until it has rested, so a chase can be
 *    won (or escaped) by outlasting the other cell.
 *  - Predators give up: after a limit, once the prey is out of sight, or when worn out, they lose
 *    interest for a while instead of tracking you until you die.
 *  - Predators lunge: a short committed burst in a straight line when close and facing the prey.
 *    A prey that steps aside at the right moment makes it miss, and it needs a moment to recover.
 *  - Prey dodge: when a predator is about to strike they sidestep instead of running straight.
 */
export const SPRINT = 1.45; // speed multiplier while sprinting
export const LUNGE = 2.0; // speed multiplier during a lunge
export const LUNGE_TIME = 0.5;
export const RECOVER_TIME = 0.8; // slowed after a lunge
const rand = Math.random;

export function newBrain(rnd = rand) {
  return {
    stamina: 1,
    tired: false,
    tiredFor: 0,
    chaseT: 0,
    giveUpAt: 6.5 + rnd() * 6,
    ignoreUntil: 0,
    lunge: 0,
    lungeCool: 1 + rnd() * 1.5,
    recover: 0,
    dodgeT: 0,
    dodgeCool: 0,
    dodgeSide: 1,
  };
}

/** Drain while sprinting, recover while not. Bigger cells tire more slowly. */
export function staminaStep(b, dt, sprinting, size = 1) {
  if (sprinting && !b.tired) b.stamina -= dt / (3 + 0.5 * size);
  else b.stamina += dt * (b.tired ? 0.16 : 0.26);
  b.stamina = Math.min(1, Math.max(0, b.stamina));
  if (b.stamina <= 0) b.tired = true;
  if (b.tired) b.tiredFor += dt;
  if (b.tired && b.stamina >= 0.4) {
    b.tired = false;
    b.tiredFor = 0;
  }
}

/** Speed multiplier from stamina state alone. */
export const paceOf = (b, sprinting) => (b.tired ? 0.68 : sprinting ? SPRINT : 1) * (b.recover > 0 ? 0.55 : 1);

/**
 * One frame of a chase. Returns { pursue, sprint }. Call `endChase` when the predator is not chasing.
 * @param {{dt:number, now:number, dist:number, sight:number}} o
 */
export function chaseStep(b, o, rnd = rand) {
  if (o.now < b.ignoreUntil) return { pursue: false, sprint: false };
  b.chaseT += o.dt;
  if (o.dist > o.sight * 1.3 || b.chaseT > b.giveUpAt || b.tiredFor > 1.6) {
    b.ignoreUntil = o.now + 5 + rnd() * 4;
    b.chaseT = 0;
    b.giveUpAt = 6.5 + rnd() * 6;
    return { pursue: false, sprint: false };
  }
  return { pursue: true, sprint: !b.tired && o.dist < o.sight * 0.85 };
}
export const endChase = (b) => {
  b.chaseT = Math.max(0, b.chaseT - 0.5);
};

/**
 * Lunge timing. `facing` is cos of the angle between heading and the prey (1 = dead ahead).
 * @returns {boolean} true while the cell is mid-lunge
 */
export function lungeStep(b, { dt, dist, reach, facing }, rnd = rand) {
  if (b.recover > 0) b.recover -= dt;
  if (b.lungeCool > 0) b.lungeCool -= dt;
  if (b.lunge > 0) {
    b.lunge -= dt;
    if (b.lunge <= 0) {
      b.recover = RECOVER_TIME;
      b.lungeCool = 2.4 + rnd() * 1.6;
    }
    return b.lunge > 0;
  }
  if (b.lungeCool <= 0 && !b.tired && b.recover <= 0 && dist < reach * 3.4 && dist > reach * 0.9 && facing > 0.82) {
    b.lunge = LUNGE_TIME;
    return true;
  }
  return false;
}

/**
 * Prey sidestep. When a hunter is closing inside `trigger` distance the prey picks a side and jinks hard
 * for a moment, then can't do it again for a bit. Returns { dodge, side }.
 */
export function dodgeStep(b, { dt, dist, trigger, lunging }, rnd = rand) {
  if (b.dodgeCool > 0) b.dodgeCool -= dt;
  if (b.dodgeT > 0) {
    b.dodgeT -= dt;
    return { dodge: true, side: b.dodgeSide };
  }
  if (b.dodgeCool <= 0 && dist < trigger && (lunging || rnd() < dt * 3)) {
    b.dodgeT = 0.45;
    b.dodgeCool = 1.2 + rnd() * 0.8;
    b.dodgeSide = rnd() < 0.5 ? -1 : 1;
    return { dodge: true, side: b.dodgeSide };
  }
  return { dodge: false, side: b.dodgeSide };
}
