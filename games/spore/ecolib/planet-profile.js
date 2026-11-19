/**
 * A planet's environmental profile: everything the stages and the ecosystem generator need to make a
 * world look and live like *this* planet, from the planet record alone.
 *
 * Every characteristic has its own seeded random stream, so they vary independently: a planet's
 * vegetation colour is not decided by its terrain, nor its sky by its water. Physical data (type,
 * temperature, water, atmosphere, biodiversity, star) biases the odds, never fixes the result, so
 * unusual but coherent combinations turn up: a purple fungal swamp, a red-skied forest, a cyan
 * frozen world with orange moss. The same planet always yields the same profile.
 *
 * Pure (no THREE, no DOM): safe to test, store with a universe, and run anywhere.
 */
import { hashSeed, rng32 } from "../galaxy/names.js";
import { adjust, hexToHsl, hslToHex, mix, withHue } from "./color.js";

export const PROFILE_VERSION = 1;

const pickWeighted = (items, weightOf, r) => {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let x = r() * total;
  for (const it of items) if ((x -= weightOf(it)) <= 0) return it;
  return items.at(-1);
};

/* ---------------------------------------------------------------- vegetation colour */
/** Foliage colours ("photosynthetic pigments"): name, hue, saturation, lightness, base weight. */
export const FOLIAGE = [
  { name: "verdant", hue: 112, sat: 0.45, light: 0.38, w: 34 },
  { name: "olive", hue: 75, sat: 0.5, light: 0.36, w: 9 },
  { name: "teal", hue: 172, sat: 0.5, light: 0.36, w: 8 },
  { name: "azure", hue: 205, sat: 0.55, light: 0.4, w: 6 },
  { name: "violet", hue: 275, sat: 0.45, light: 0.38, w: 13 },
  { name: "magenta", hue: 320, sat: 0.5, light: 0.42, w: 5 },
  { name: "crimson", hue: 355, sat: 0.55, light: 0.4, w: 9 },
  { name: "amber", hue: 28, sat: 0.7, light: 0.44, w: 7 },
  { name: "golden", hue: 50, sat: 0.65, light: 0.46, w: 5 },
  { name: "shadow", hue: 255, sat: 0.14, light: 0.17, w: 3 },
];
const STAR_FOLIAGE = {
  red: { violet: 3, crimson: 2.2, shadow: 4, magenta: 2, verdant: 0.35 },
  orange: { amber: 2, crimson: 1.5, golden: 1.6, olive: 1.3 },
  white: { azure: 2.5, teal: 2, verdant: 0.8 },
  blue: { azure: 3.5, teal: 2.5, violet: 1.5, verdant: 0.4 },
  binary: { amber: 1.5, magenta: 1.5, violet: 1.4 },
};
const TYPE_FOLIAGE = {
  crystal: { violet: 3, azure: 2.5, magenta: 2 },
  toxic: { olive: 3, golden: 2, violet: 1.5 },
  volcanic: { crimson: 3, shadow: 3, amber: 2 },
  jungle: { verdant: 1.6, teal: 1.4 },
  swamp: { olive: 2, teal: 1.4, violet: 1.4 },
  ice: { azure: 2, teal: 1.6, magenta: 1.3 },
  frozen: { azure: 2, teal: 1.6 },
  tundra: { olive: 1.5, teal: 1.3 },
  desert: { olive: 1.6, golden: 1.4, amber: 1.4 },
};

/* ------------------------------------------------------------------------- atmosphere */
const SKY = {
  breathable: { hue: 205, sat: 0.62, day: 0.72, haze: 1, exotic: ["green", 158, "amber", 38, "lilac", 285, "rose", 335] },
  thin: { hue: 222, sat: 0.5, day: 0.3, haze: 0.45, exotic: [] },
  none: { hue: 230, sat: 0.3, day: 0.035, haze: 0.2, exotic: [] },
  dense: { hue: 28, sat: 0.6, day: 0.5, haze: 2.2, exotic: ["rust", 8, "amber", 44] },
  toxic: { hue: 78, sat: 0.6, day: 0.52, haze: 2.4, exotic: ["sickly orange", 28] },
  methane: { hue: 172, sat: 0.5, day: 0.46, haze: 1.8, exotic: ["green", 140] },
  hydrogen: { hue: 40, sat: 0.5, day: 0.5, haze: 2, exotic: [] },
};
const atmosKey = (planet) => String(planet.atmosphere || "breathable").toLowerCase();

/* ---------------------------------------------------------------------------- ground */
const GROUND = {
  terrestrial: { a: 0x86c25a, b: 0x5f9e45, dirt: 0x8e8a5a, rock: 0x8a8576, sand: 0xe3cf95 },
  oceanic: { a: 0x86c25a, b: 0x5f9e45, dirt: 0x8e8a5a, rock: 0x8a8576, sand: 0xf0e0aa },
  jungle: { a: 0x4fae4a, b: 0x2f7a3a, dirt: 0x6a5a3a, rock: 0x6f7566, sand: 0xd8c890 },
  swamp: { a: 0x7f8a4a, b: 0x5a6a3a, dirt: 0x5a4a30, rock: 0x6a6a5a, sand: 0xb8a870 },
  desert: { a: 0xd8b070, b: 0xc08a4a, dirt: 0xa8703a, rock: 0xa07050, sand: 0xecd09a },
  tundra: { a: 0xa8b8a0, b: 0x7f9a8a, dirt: 0x7a7a68, rock: 0x8a8f90, sand: 0xcfd8d0 },
  ice: { a: 0xe0f0f8, b: 0xb8d4e4, dirt: 0x9ab0c0, rock: 0x8aa0b0, sand: 0xf0f8ff },
  frozen: { a: 0xeaf2f7, b: 0xc0d0de, dirt: 0xa0b0c0, rock: 0x8f9eb0, sand: 0xf4f8fb },
  volcanic: { a: 0x4a3a34, b: 0x2e2420, dirt: 0x3a2a24, rock: 0x2a2220, sand: 0x5a4a40 },
  toxic: { a: 0x9ab03a, b: 0x6a7a2a, dirt: 0x6a5a3a, rock: 0x6a6a4a, sand: 0xb8b070 },
  rocky: { a: 0x9a8a78, b: 0x7a6a5a, dirt: 0x6a5a48, rock: 0x7a6a5a, sand: 0xb8a890 },
  barren: { a: 0x8f8f8f, b: 0x6f6f6f, dirt: 0x5f5a55, rock: 0x6a6a6a, sand: 0xa8a8a8 },
  crystal: { a: 0xa890e0, b: 0x7a60c0, dirt: 0x5a4a8a, rock: 0x6a5aa0, sand: 0xd8ccf5 },
};
/** Rock and soil minerals: what colours the stone and dirt. */
const MINERALS = [
  { name: "iron red", color: 0xb0502a, w: 1 },
  { name: "ochre", color: 0xc89a44, w: 1 },
  { name: "slate", color: 0x7a8088, w: 1.2 },
  { name: "basalt", color: 0x3a3a42, w: 0.8 },
  { name: "chalk", color: 0xe0dccc, w: 0.7 },
  { name: "copper green", color: 0x4a9a80, w: 0.5 },
  { name: "violet", color: 0x7a5aa8, w: 0.5 },
  { name: "rust orange", color: 0xd8742a, w: 0.7 },
];
const TYPE_MINERAL = { desert: { "iron red": 4, ochre: 3, "rust orange": 2.5 }, volcanic: { basalt: 5, "rust orange": 2 }, rocky: { slate: 2, "iron red": 1.5 }, barren: { slate: 3, basalt: 2 }, crystal: { violet: 4, chalk: 2 }, ice: { chalk: 3, slate: 2 }, frozen: { chalk: 3, slate: 2 }, toxic: { ochre: 2, "copper green": 2.5 } };

/* ------------------------------------------------------------------------------ water */
const WATER = [
  { name: "blue", color: 0x2f8fc0, w: 5 },
  { name: "deep blue", color: 0x1d5a9a, w: 2 },
  { name: "turquoise", color: 0x2fc0b0, w: 2 },
  { name: "green", color: 0x3a9a6a, w: 1.6 },
  { name: "murky brown", color: 0x7a6a3a, w: 1.2 },
  { name: "purple", color: 0x7a4ab8, w: 0.7 },
  { name: "black", color: 0x1a2028, w: 0.5 },
  { name: "pale cyan", color: 0x9adfe8, w: 0.8 },
  { name: "rose", color: 0xc8509a, w: 0.35 },
];
const TYPE_WATER = { swamp: { green: 4, "murky brown": 4, black: 1 }, frozen: { "pale cyan": 6 }, ice: { "pale cyan": 5, turquoise: 2 }, tundra: { "deep blue": 2, "pale cyan": 2 }, oceanic: { blue: 2, turquoise: 2, "deep blue": 2 }, toxic: { green: 4, purple: 2 }, volcanic: { black: 4, "murky brown": 2 }, crystal: { turquoise: 3, purple: 3 }, jungle: { turquoise: 2, green: 2 } };

/* ----------------------------------------------------------------------------- biomes */
/** Base biome mix for each planet type; the rest of the profile bends it. */
const TYPE_BIOMES = {
  terrestrial: { temperate_forest: 0.34, grassland: 0.34, alpine: 0.1, freshwater: 0.08, shallows: 0.08, savanna: 0.06 },
  oceanic: { shallows: 0.3, coral_reef: 0.2, deep_ocean: 0.2, temperate_forest: 0.12, rainforest: 0.1, grassland: 0.08 },
  jungle: { rainforest: 0.5, swamp: 0.14, freshwater: 0.1, temperate_forest: 0.1, alien_lush: 0.1, grassland: 0.06 },
  swamp: { swamp: 0.5, freshwater: 0.14, rainforest: 0.12, fungal: 0.12, temperate_forest: 0.12 },
  desert: { desert: 0.55, savanna: 0.15, wasteland: 0.16, alpine: 0.06, grassland: 0.08 },
  tundra: { tundra: 0.4, taiga: 0.3, alpine: 0.14, freshwater: 0.08, grassland: 0.08 },
  ice: { tundra: 0.45, alpine: 0.25, crystalline: 0.1, taiga: 0.1, wasteland: 0.1 },
  frozen: { tundra: 0.5, alpine: 0.25, wasteland: 0.15, crystalline: 0.1 },
  volcanic: { volcanic: 0.55, wasteland: 0.25, alpine: 0.1, desert: 0.1 },
  toxic: { fungal: 0.4, wasteland: 0.2, swamp: 0.2, alien_lush: 0.2 },
  rocky: { wasteland: 0.45, alpine: 0.25, desert: 0.15, tundra: 0.15 },
  barren: { wasteland: 0.6, alpine: 0.2, desert: 0.1, volcanic: 0.1 },
  crystal: { crystalline: 0.55, alpine: 0.15, alien_lush: 0.15, wasteland: 0.15 },
};
const BIOME_NOUN = { temperate_forest: "forest world", rainforest: "jungle world", grassland: "grassland world", savanna: "savanna world", desert: "desert world", tundra: "tundra world", taiga: "taiga world", swamp: "swamp world", alpine: "mountain world", volcanic: "volcanic world", fungal: "fungal world", crystalline: "crystal world", shallows: "ocean world", deep_ocean: "ocean world", coral_reef: "reef world", freshwater: "lake world", wasteland: "wasteland", alien_lush: "alien jungle" };

/** Climate label from temperature (°C) and water. */
export function climateOf(temp, water) {
  if (temp > 120) return "scorching";
  if (temp > 55) return water > 0.45 ? "tropical" : "hot arid";
  if (temp > 28) return water > 0.5 ? "humid" : water > 0.2 ? "warm" : "arid";
  if (temp > 2) return water > 0.55 ? "temperate wet" : water > 0.2 ? "temperate" : "semi-arid";
  if (temp > -25) return "cool";
  if (temp > -60) return "subarctic";
  return "polar";
}
/** Band index 0..4 (frozen, cold, temperate, warm, scorching), matching the library's TEMPERATURES. */
export const temperatureBand = (c) => (c < -45 ? 0 : c < 0 ? 1 : c < 28 ? 2 : c < 58 ? 3 : 4);

/**
 * @param {object} planet a planet from galaxy/gen.js (type, temp, water, gravity, atmosphere, biodiversity, surfaceSeed, id)
 * @param {{ star?: {kind?:string, color?:string}, seed?: number }} [o]
 */
export function planetProfile(planet, { star = null, seed = 0 } = {}) {
  const base = hashSeed("profile", seed, planet.surfaceSeed ?? hashSeed(planet.id));
  const R = (tag) => rng32(hashSeed(base, tag));
  const type = GROUND[planet.type] ? planet.type : "rocky";
  const akey = SKY[atmosKey(planet)] ? atmosKey(planet) : "breathable";
  const water = Math.max(0, Math.min(1, planet.water ?? 0));
  const temp = planet.temp ?? 15;
  const bio = Math.max(0, Math.min(1, planet.biodiversity ?? 0));

  /* vegetation palette: its own roll, biased by star, type and atmosphere */
  const rv = R("vegetation");
  const bias = { ...(STAR_FOLIAGE[star?.kind] || {}) };
  for (const [k, v] of Object.entries(TYPE_FOLIAGE[type] || {})) bias[k] = (bias[k] || 1) * v;
  const fol = pickWeighted(FOLIAGE, (f) => f.w * (bias[f.name] || 1), rv);
  const jit = (rv() - 0.5) * 24;
  const leaf = hslToHex(fol.hue + jit, fol.sat * (0.85 + rv() * 0.3), fol.light * (0.9 + rv() * 0.2));
  const leaf2 = adjust(leaf, { hue: 14 * (rv() < 0.5 ? -1 : 1), sat: 1, light: 1.3 });
  // Flowers and fruit sit opposite the foliage on the colour wheel, with a little chance.
  const flowerHue = (fol.hue + 150 + rv() * 120) % 360;
  const flower = hslToHex(flowerHue, 0.65, 0.58);
  const fruit = hslToHex((flowerHue + 30 + rv() * 60) % 360, 0.7, 0.52);
  const vegetation = { name: fol.name, hue: fol.hue + jit, sat: fol.sat, light: fol.light, leaf, leaf2, flower, fruit, trunk: mix(0x6b5236, hslToHex(fol.hue + jit, 0.2, 0.25), 0.25 + rv() * 0.3), fungus: hslToHex((fol.hue + 120 + rv() * 140) % 360, 0.55, 0.55) };

  /* minerals: stone and soil colour */
  const rm = R("mineral");
  const mw = TYPE_MINERAL[type] || {};
  const mineral = rm() < 0.12 ? MINERALS[Math.floor(rm() * MINERALS.length)] : pickWeighted(MINERALS, (m) => m.w * (mw[m.name] || 1), rm);

  /* water */
  const rw = R("water");
  const ww = TYPE_WATER[type] || {};
  const waterPick = rw() < 0.1 ? WATER[Math.floor(rw() * WATER.length)] : pickWeighted(WATER, (w) => w.w * (ww[w.name] || 1), rw);

  /* atmosphere and sky */
  const ra = R("sky");
  const sk = SKY[akey];
  let skyHue = sk.hue + (ra() - 0.5) * 30;
  let skyName = "";
  if (sk.exotic.length && ra() < 0.24) {
    const i = Math.floor(ra() * (sk.exotic.length / 2)) * 2;
    skyName = sk.exotic[i];
    skyHue = sk.exotic[i + 1] + (ra() - 0.5) * 20;
  }
  const dayL = sk.day;
  const skyDay = hslToHex(skyHue, sk.sat, dayL);
  const skyDusk = mix(hslToHex(skyHue + 25, Math.min(0.9, sk.sat + 0.15), dayL * 0.8), 0xf0a274, 0.45);
  const skyNight = hslToHex(skyHue, sk.sat * 0.7, Math.max(0.02, dayL * 0.14));
  const haze = sk.haze;
  const atmosphere = { kind: akey, name: planet.atmosphere || "Breathable", skyName, density: { none: 0, thin: 0.3, breathable: 1, dense: 2, toxic: 1.6, methane: 1.3, hydrogen: 2 }[akey], day: skyDay, dusk: skyDusk, night: skyNight, haze, fog: [Math.round(90 / haze + 10), Math.round(250 / Math.max(0.55, haze * 0.7) + 40)] };

  /* light from the star */
  const rl = R("light");
  const starCol = star?.color ? parseInt(String(star.color).replace("#", ""), 16) : 0xfff1d6;
  const sun = mix(0xfff1d6, starCol, 0.55);
  const lighting = { sun, hemi: mix(0xdff4ff, skyDay, 0.45), ground: mix(0x6b5a3a, mineral.color, 0.35), sunIntensity: Math.round((0.85 + rl() * 0.4) * 100) / 100, dayLength: Math.round(240 + rl() * 120) };

  /* fertility, relief, climate */
  const rf = R("fertility");
  const comfort = Math.max(0, 1 - Math.abs(temp - 18) / 60);
  const fertility = Math.max(0, Math.min(1, bio * 0.55 + water * 0.2 + comfort * 0.15 + (rf() - 0.5) * 0.25));
  const re = R("relief");
  const typeRelief = { volcanic: 1.25, rocky: 1.1, barren: 0.9, crystal: 1.15, desert: 0.8, oceanic: 0.55, swamp: 0.5, tundra: 0.9, ice: 1, frozen: 0.95, jungle: 0.95, terrestrial: 1, toxic: 0.85 }[type];
  const gravityEase = 1 / Math.max(0.6, Math.min(1.6, planet.gravity || 1));
  const relief = Math.round(Math.max(0.35, Math.min(1.7, typeRelief * (0.8 + re() * 0.45) * (0.85 + 0.25 * gravityEase))) * 100) / 100;

  /* biomes: the type's mix, bent by temperature, plus independent rolls for strange ones */
  const rb = R("biomes");
  const mixb = { ...(TYPE_BIOMES[type] || TYPE_BIOMES.rocky) };
  if (temp > 55) {
    mixb.desert = (mixb.desert || 0) + 0.12;
    delete mixb.tundra;
    delete mixb.taiga;
  } else if (temp < -10) {
    delete mixb.rainforest;
    delete mixb.savanna;
    mixb.tundra = (mixb.tundra || 0) + 0.15;
  }
  const lush = bio > 0.25;
  if (lush && rb() < 0.2) mixb.fungal = (mixb.fungal || 0) + 0.12 + rb() * 0.18;
  if (lush && rb() < 0.22) mixb.alien_lush = (mixb.alien_lush || 0) + 0.12 + rb() * 0.2;
  if (rb() < 0.07) mixb.crystalline = (mixb.crystalline || 0) + 0.1 + rb() * 0.18;
  // A wildcard: sometimes one more biome from anywhere, so no two worlds read alike.
  if (rb() < 0.3) {
    const all = ["temperate_forest", "rainforest", "grassland", "savanna", "desert", "tundra", "taiga", "swamp", "alpine", "volcanic", "fungal", "wasteland"];
    const k = all[Math.floor(rb() * all.length)];
    mixb[k] = (mixb[k] || 0) + 0.12;
  }
  // Whatever was added, cold worlds have no jungle and hot worlds no tundra: strange, but still coherent.
  if (temp < -10) for (const k of ["rainforest", "savanna", "swamp", "alien_lush", "fungal"]) if (temp < -40 || k === "rainforest" || k === "savanna") delete mixb[k];
  if (temp > 55) for (const k of ["tundra", "taiga", "alpine"]) delete mixb[k];
  if (!Object.keys(mixb).length) mixb[temp < 0 ? "tundra" : "wasteland"] = 1;
  let entries = Object.entries(mixb).sort((a, b) => b[1] - a[1]);
  const keep = 2 + Math.floor(rb() * 3);
  entries = entries.slice(0, Math.max(Math.min(2, entries.length), keep));
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  const biomes = entries.map(([biome, w]) => ({ biome, weight: Math.round((w / sum) * 1000) / 1000 }));

  /* terrain colours: the type's ground, greened by the world's own foliage where life is thick */
  const rg = R("ground");
  const gb = GROUND[type];
  const cover = Math.max(0, Math.min(1, fertility * 1.1));
  const tint = (c, k) => mix(c, mineral.color, k);
  const grassLight = mix(tint(gb.a, 0.12), adjust(leaf, { light: 1.25 }), cover * (0.55 + rg() * 0.25));
  const grassDark = mix(tint(gb.b, 0.12), adjust(leaf, { light: 0.85 }), cover * (0.55 + rg() * 0.25));
  const terrain = { type, grassLight, grassDark, dirt: tint(gb.dirt, 0.35), rock: tint(gb.rock, 0.4), cliff: adjust(tint(gb.rock, 0.5), { light: 0.8 }), sand: mix(gb.sand, mineral.color, 0.12), seabed: mix(gb.sand, waterPick.color, 0.3), stone: tint(gb.rock, 0.4), snow: type === "volcanic" ? 0xcfc8c4 : 0xf4f7fb, mineral: mineral.name, mineralColor: mineral.color };

  /* what lives here */
  const plantDensity = Math.round(Math.max(0.05, Math.min(1.6, fertility * 1.5 + (type === "jungle" ? 0.3 : 0))) * 100) / 100;
  const hasAir = akey !== "none" && akey !== "hydrogen";
  const flora = { trees: Math.round((plantDensity * (biomes.some((b) => /forest|rainforest|taiga|alien_lush|swamp/.test(b.biome)) ? 1 : 0.35)) * 100) / 100, shrubs: plantDensity, grass: plantDensity * (type === "desert" || type === "barren" ? 0.3 : 1), flowers: plantDensity * 0.6, fungi: plantDensity * (biomes.some((b) => b.biome === "fungal") ? 2 : 0.4), succulents: plantDensity * (temp > 28 ? 1 : 0.15), crystal: biomes.some((b) => b.biome === "crystalline") ? 1 : 0.1, alien: plantDensity * (biomes.some((b) => b.biome === "alien_lush") ? 1.5 : 0.25) };
  const fauna = { herbivore: bio, carnivore: bio * 0.45, omnivore: bio * 0.6, small: bio, large: bio * (0.3 + water * 0.2), flying: hasAir ? bio * (akey === "thin" ? 0.4 : 0.8) : 0, aquatic: bio * (0.2 + water * 0.8) };
  for (const k of Object.keys(fauna)) fauna[k] = Math.round(fauna[k] * 100) / 100;

  const primary = biomes[0].biome;
  const label = bio <= 0 && fertility < 0.12 ? `${cap(mineral.name)} ${BIOME_NOUN[primary] || "world"}` : `${cap(vegetation.name)} ${BIOME_NOUN[primary] || "world"}`;
  return {
    v: PROFILE_VERSION,
    planetId: planet.id,
    type,
    label,
    terrain,
    temperature: { c: temp, band: temperatureBand(temp) },
    climate: climateOf(temp, water),
    atmosphere,
    water: { color: waterPick.color, name: waterPick.name, coverage: water },
    vegetation,
    lighting,
    fertility: Math.round(fertility * 100) / 100,
    relief,
    gravity: planet.gravity ?? 1,
    biomes,
    flora,
    fauna,
    plantDensity,
    habitable: bio > 0,
  };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short, stable fingerprint of what makes this world look different (for tests and the UI). */
export const lookKey = (p) => [p.vegetation.name, p.atmosphere.skyName || p.atmosphere.kind, p.water.name, p.terrain.mineral, p.biomes[0].biome].join("/");

/** Re-exports so callers need one import. */
export { hexToHsl, withHue };
