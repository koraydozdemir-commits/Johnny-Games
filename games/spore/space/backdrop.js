// Every star you can see is a star you can visit. The main menu's glittering arms, bulge and halo (about
// 37,500 stars) are real systems too: ids 1400 and up, laid out exactly as the menu draws them, each with
// its own kind, planets and name made from its id. Deterministic from the galaxy's seed.
import { rng32, hashSeed, makeName } from "../galaxy/names.js";
import { armHalf, softClamp } from "./galaxy/armshape.js";
import { STAR_KINDS } from "./galaxy/gen.js";

const TAU = Math.PI * 2;
export const BACKDROP = { arm: 26000, core: 7500, field: 4000 };
const KIND_IDS = Object.keys(STAR_KINDS);
const ARMS = ["Ember Reach", "Azure Spiral", "Verdant Arm", "Violet Drift"];
// The menu's star tints (sRGB-ish), kept so the galaxy keeps its look.
export const TINT = { core: "#fff1d6", gold: "#ffcf7a", warm: "#ffb070", white: "#f2f4ff", blue: "#9fb8ff", violet: "#c4a6ff", pink: "#ffb3e6" };

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Adds the backdrop stars to `galaxy.stars` (once) and returns the rng, ready for the menu's clouds. */
export function addBackdrop(galaxy, col) {
  if (galaxy.backdrop) return galaxy.backdrop;
  const { twist, spin, arms } = galaxy.shape;
  const r = rng32(hashSeed("look", galaxy.seed));
  const ce = () => (r() + r() + r() + r() - 2) / 1.15;
  const armAngle = (i, d) => spin + (i / arms) * TAU + d * twist;
  const first = galaxy.stars.length;
  const T = Object.fromEntries(Object.entries(TINT).map(([k, v]) => [k, col(v)]));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const out = [];
  const add = (x, y, h, tint, size, phase, sector, arm, dist) => {
    const id = first + out.length;
    const kr = (hashSeed("kind", galaxy.seed, id) % 100000) / 1000;
    let roll = kr, kind = "red";
    for (const k of KIND_IDS) {
      roll -= STAR_KINDS[k].weight;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const s = { id, x, y, kind, mag: 0.4 + ((hashSeed("mag", galaxy.seed, id) % 1000) / 1000) * 0.6, sector, arm, backdrop: true, h, tint, size, phase, dist };
    Object.defineProperty(s, "name", { get() { return (this._n ||= makeName("star", hashSeed(galaxy.seed, this.id))); }, enumerable: true });
    out.push(s);
  };
  for (let i = 0; i < BACKDROP.arm; i++) {
    const a = i % arms, d = 0.1 + Math.pow(r(), 1.25) * 0.95, spread = 0.36 * (1 - d) + 0.15;
    const ang = armAngle(a, d) + softClamp(ce() * spread, armHalf(d, twist));
    const j = d < 0.24 ? 0.035 : 0.006;
    const x = Math.cos(ang) * d + ce() * j, y = Math.sin(ang) * d + ce() * j;
    const s = r();
    let c = s < 0.42 ? T.blue : s < 0.68 ? T.violet : s < 0.84 ? T.white : s < 0.93 ? T.gold : T.pink;
    if (d < 0.3) c = mix(T.core, c, smooth(0.1, 0.3, d));
    const big = r() < 0.025;
    const h = ce() * (3.2 * (1 - d) + 0.8);
    add(x, y, h, c, big ? 1.1 + r() * 0.9 : 0.22 + r() * 0.42, r(), Math.hypot(x, y) > 0.82 ? "Outer Rim" : ARMS[a], a, d);
  }
  for (let i = 0; i < BACKDROP.core; i++) {
    const d = Math.abs(ce()) * 0.11, a = r() * TAU;
    const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.9;
    const h = ce() * 4 * (1 - d / 0.3);
    add(x, y, h, r() < 0.5 ? T.core : r() < 0.6 ? T.gold : T.warm, 0.3 + r() * 0.6, r(), "Galactic Core", -1, d);
  }
  for (let i = 0; i < BACKDROP.field; i++) {
    const d = 1.04 + r() * 0.3, a = r() * TAU;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    const h = ce() * 4;
    add(x, y, h, r() < 0.5 ? T.white : r() < 0.5 ? T.gold : T.blue, 0.18 + r() * 0.3, r(), "Outer Rim", -1, d);
  }
  galaxy.stars.push(...out);
  galaxy.backdrop = { first, count: out.length, rng: r };
  return galaxy.backdrop;
}
