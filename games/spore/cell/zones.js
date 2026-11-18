/**
 * The microscopic ocean's zones. The soup gets deeper the further you swim from where life began, with
 * a little noise so the edges wander: sunlit shallows near the start, kelp and thermal vents in the
 * middle depths, then the twilight zone and the abyssal trench. Each zone changes the food on offer,
 * how many hunters live there, how fast DNA comes, and how much light there is. Pure and deterministic.
 */
export const ZONES = {
  shallows: { name: "Sunlit Shallows", icon: "☀", depth: 0, plant: 0.12, hunters: 0, chunks: 1, dna: 1, dark: 0, desc: "Warm, bright water full of algae. Easy grazing, few hunters." },
  kelp: { name: "Kelp Drift", icon: "🌿", depth: 1, plant: 0.2, hunters: 0.05, chunks: 1, dna: 1.1, dark: 0.12, desc: "Drifting kelp fronds. The richest plant food in the soup." },
  vents: { name: "Thermal Vents", icon: "♨", depth: 1, plant: -0.15, hunters: 0.15, chunks: 1.6, dna: 1.25, dark: 0.18, desc: "Hot springs feed swarms of bacteria, and the hunters that eat them." },
  twilight: { name: "Twilight Zone", icon: "🌒", depth: 2, plant: -0.2, hunters: 0.3, chunks: 1.5, dna: 1.35, dark: 0.38, desc: "Light fades. Hunters lurk; dead cells drift down to scavenge." },
  trench: { name: "Abyssal Trench", icon: "🌑", depth: 3, plant: -0.35, hunters: 0.45, chunks: 2.2, dna: 1.6, dark: 0.58, desc: "The deepest dark. Dangerous, but DNA comes fastest here." },
};
export const ZONE_IDS = Object.keys(ZONES);
/** How far from the start the soup reaches its deepest (world units). */
const DEEP_AT = 420;

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash(ix, iy, seed),
    b = hash(ix + 1, iy, seed),
    c = hash(ix, iy + 1, seed),
    d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
/** Depth here, 0 (surface) to 1 (deepest). */
export function depthAt(x, y, seed = 1) {
  const d = Math.hypot(x, y) / DEEP_AT;
  return Math.max(0, Math.min(1, d + (noise(x / 90, y / 90, seed) - 0.5) * 0.35));
}
/** The zone at a point. The start of the game is always the shallows. */
export function zoneAt(x, y, seed = 1) {
  if (Math.hypot(x, y) < 45) return "shallows";
  const depth = depthAt(x, y, seed);
  if (depth < 0.25) return "shallows";
  if (depth < 0.5) return noise(x / 60 + 31, y / 60 - 7, seed + 9) < 0.55 ? "kelp" : "vents";
  if (depth < 0.75) return "twilight";
  return "trench";
}
/** The share of plant food in a zone, for a cell of a given diet (the base share comes from the diet). */
export const plantShareIn = (zone, base) => Math.max(0.12, Math.min(0.9, base + ZONES[zone].plant));
