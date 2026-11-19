/**
 * The homeworld's identity, shared by every stage. When a universe loads, the game sets the profile of
 * the planet the species began on; each stage's terrain then asks for it (see creature/world.js, which
 * Creature, Tribal and Civilization all build their land from), so all of them are the same planet.
 *
 * Regions keep their own character (the forest is still shadier than the coast): a profile does not
 * replace a region's palette, it bends it towards the planet's colours, sky, water and light.
 * Pure data and colour maths (no THREE), so it is testable.
 */
import { adjust, hexToHsl, hslToHex, mix } from "./color.js";

let current = null;
/** Set (or clear, with null) the planet every stage should look like. */
export function setHomeworld(profile) {
  current = profile || null;
}
export const getHomeworld = () => current;

/** Bend a region's foliage-ish colour to the planet's foliage hue, keeping the region's own light and variety. */
function recolourFoliage(hex, v, k) {
  const c = hexToHsl(hex);
  const target = hslToHex(v.hue, Math.min(0.9, c.s * (v.sat / 0.45)), Math.max(0.08, c.l * (v.light / 0.38)));
  return mix(hex, target, k);
}

/**
 * A copy of `region` themed for a planet: ground and stone colours, foliage, fruit, sky by time of day,
 * fog, sea colour and light. Peaks are scaled by the planet's relief (within sensible limits).
 * @param {object} region from creature/regions.js
 * @param {object|null} profile from planetProfile (null returns the region unchanged)
 */
export function themeRegion(region, profile) {
  if (!profile) return region;
  const t = profile.terrain,
    v = profile.vegetation,
    a = profile.atmosphere;
  const c = region.colors;
  const colors = {
    ...c,
    grassLight: mix(c.grassLight, t.grassLight, 0.78),
    grassDark: mix(c.grassDark, t.grassDark, 0.78),
    dirt: mix(c.dirt, t.dirt, 0.65),
    rock: mix(c.rock, t.rock, 0.7),
    cliff: mix(c.cliff, t.cliff, 0.7),
    stone: mix(c.stone, t.stone, 0.7),
    sand: mix(c.sand, t.sand, 0.65),
    seabed: mix(c.seabed, t.seabed, 0.7),
    snow: mix(c.snow, t.snow, 0.5),
    trunk: mix(c.trunk, v.trunk, 0.7),
    leaf: recolourFoliage(c.leaf, v, 0.85),
    bush: recolourFoliage(c.bush, v, 0.85),
    fruit: mix(c.fruit, v.fruit, 0.85),
  };
  const relief = Math.max(0.7, Math.min(1.35, profile.relief));
  return {
    ...region,
    colors,
    sky: { day: mix(region.sky.day, a.day, 0.78), dusk: mix(region.sky.dusk, a.dusk, 0.7), night: mix(region.sky.night, a.night, 0.7) },
    fog: [Math.round(region.fog[0] * 0.5 + a.fog[0] * 0.5), Math.round(region.fog[1] * 0.5 + a.fog[1] * 0.5)],
    water: profile.water.color,
    light: { ...profile.lighting },
    peaks: region.peaks.map((p) => ({ ...p, h: p.h * relief })),
    themeKey: profile.planetId + ":" + profile.v,
    homeworld: profile,
  };
}
export { adjust };
