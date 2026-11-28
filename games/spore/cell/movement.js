/**
 * How a cell's parts change the way it swims. Pure data and maths (no THREE, no DOM), shared by the
 * player and by every other cell, so a part does the same thing whoever wears it.
 *
 *  - Flagellum:  pure, constant speed. Highest top speed, never surges or stalls, but turns wide.
 *  - Cilia:      grip. Quick turning, snappy acceleration and a little extra speed.
 *  - Jet:        fires short bursts of thrust on its own while the cell is swimming (no button).
 *  - Mitochondria add a little speed, Chitin plates take a little away.
 *
 * Cells carry inertia: they take time to speed up, to turn, and keep coasting after the push stops.
 */
const count = (ids, id, cap) => Math.min(cap, ids.filter((p) => p === id).length);

/** Speed bonus of n flagella: the first matters most. */
const flagellumSpeed = (n) => (n >= 1 ? 1.0 + (n - 1) * 0.45 : 0);

/**
 * @param {string[]} partIds the ids of every part on the cell
 * @param {{length?: number, size?: number}} o `length` is the body length, `size` the cell's scale
 */
export function movementOf(partIds, { length = 0, size = 1 } = {}) {
  const flag = count(partIds, "flagellum", 2),
    cilia = count(partIds, "cilia", 2),
    jet = count(partIds, "jet", 2),
    mito = count(partIds, "mito", 3),
    armour = count(partIds, "armour", 3);
  // Bigger cells are faster in absolute terms (the camera pulls back as they grow).
  const unit = 0.8 + 0.3 * size;
  const top = Math.max(0.9, 1.9 + flagellumSpeed(flag) + cilia * 0.2 + jet * 0.18 + mito * 0.1 - armour * 0.2) * unit;
  // Water drag: a flagellum glides, cilia bite the water. Thrust is chosen so the cell tops out at `top`.
  const drag = Math.max(0.45, 0.85 - flag * 0.2 + cilia * 0.08 + armour * 0.05);
  const lengthPenalty = 1 + length * 0.1 + partIds.length * 0.02;
  return {
    top,
    drag,
    thrust: top * drag * 1.04,
    // Turning: top angular speed, how quickly the spin builds (inertia), and how fast sideways drift is shed.
    turnMax: Math.max(0.6, (1.5 + cilia * 1.35 - flag * 0.35 - armour * 0.12) / lengthPenalty),
    turnResponse: Math.max(1.6, 3.2 + cilia * 1.1 - flag * 0.7 - armour * 0.3),
    grip: Math.max(0.35, 0.55 + cilia * 0.9 - flag * 0.2),
    constantThrust: flag > 0 && cilia === 0, // no surge-and-glide stroke: steady power
    jet: jet > 0 ? { power: top * 0.62 * (1 + (jet - 1) * 0.35), every: jet > 1 ? 1.0 : 1.35 } : null,
  };
}

/** Turn the current spin toward a wanted spin: heavier, finned or armoured cells take longer. */
export function spinStep(spin, wanted, response, dt) {
  return spin + (wanted - spin) * (1 - Math.exp(-dt * response));
}

/** Shed sideways velocity: the part of `vel` across `heading` decays at `grip` per second. */
export function applyGrip(vel, heading, grip, dt) {
  const c = Math.cos(heading),
    s = Math.sin(heading);
  const fwd = vel.x * c + vel.y * s,
    lat = -vel.x * s + vel.y * c;
  const keep = Math.exp(-grip * dt);
  vel.x = c * fwd - s * lat * keep;
  vel.y = s * fwd + c * lat * keep;
}

/**
 * Jet bursts: call every frame with the cell's timer; returns the new timer and whether a burst fired.
 * Bursts only come while the cell is deliberately swimming (`effort` is 0..1).
 */
export function jetStep(timer, dt, effort, jet) {
  if (!jet) return { timer: 0, fired: false };
  if (effort < 0.35) return { timer: Math.min(timer, jet.every * 0.5), fired: false };
  const t = timer - dt;
  if (t > 0) return { timer: t, fired: false };
  return { timer: jet.every, fired: true };
}
