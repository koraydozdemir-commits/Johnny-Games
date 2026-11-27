// The arm shaping of the full build (ported from its bundle): each arm is held to a band that never
// touches its neighbour beyond the Crossroads, so arms meet only at the hub.
const iA = (e, t) => (e * t) / Math.sqrt(1 + (e * t) ** 2);
export function armHalf(e, t) {
  const a = (n) => Math.max(0.02, Math.PI / 4 - (t * 0.215) / (2 * iA(n, t)) - 0.035);
  if (e >= 0.24) return a(e);
  const o = Math.max(0, Math.min(1, (e - 0.12) / (0.24 - 0.12)));
  return 0.9 + (a(0.24) - 0.9) * o;
}
export const softClamp = (e, t) => t * Math.tanh(e / t);
/** Where a star at distance `m`, arm angle `v` and angular scatter `o` ends up. */
export function armPoint(m, v, o, twist) {
  const n = v + softClamp(o, armHalf(m, twist));
  return { x: Math.cos(n) * m, y: Math.sin(n) * m };
}
