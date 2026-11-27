/**
 * The galaxy, from one seed. Everything is deterministic and lazy: the galaxy map (star positions,
 * kinds, names) is cheap and made at once; a star's planets are made only when that system is opened,
 * and a planet's ecosystem only when the planet is explored. Each level has its own sub-seed, so
 * changing or renaming one thing never reshuffles anything else.
 *
 * Coherence rules: a star's light and an orbit's distance set a planet's temperature; temperature and
 * water set its type and climate; climate sets its plants; plants set how many herbivores it can feed;
 * herbivores set its predators. Gravity changes how its creatures are built (squat legs, or long ones).
 */
import { generateSpecies } from "../../creature/species.js";
import { hashSeed, makeName, rng32, roman } from "../../galaxy/names.js";
import { armPoint } from "./armshape.js";

export const GALAXY_VERSION = 2;
export const STAR_COUNT = 1400;
/** Galaxy radius, in light years, for the map's scale bar and distances. */
export const GALAXY_LY = 90000;

export const STAR_KINDS = {
  red: { name: "Red dwarf", color: "#ff7a5c", lum: 0.04, size: 0.55, weight: 38, planets: [1, 4] },
  orange: { name: "Orange star", color: "#ffb36b", lum: 0.35, size: 0.8, weight: 22, planets: [2, 6] },
  yellow: { name: "Yellow star", color: "#ffe9a3", lum: 1, size: 1, weight: 18, planets: [3, 8] },
  white: { name: "White star", color: "#f4f6ff", lum: 4, size: 1.3, weight: 11, planets: [2, 6] },
  blue: { name: "Blue giant", color: "#8fb8ff", lum: 25, size: 1.9, weight: 6, planets: [1, 4] },
  binary: { name: "Binary pair", color: "#ffd9c2", lum: 1.5, size: 1.1, weight: 5, planets: [2, 5] },
};
const KIND_IDS = Object.keys(STAR_KINDS);
const ARMS = ["Ember Reach", "Azure Spiral", "Verdant Arm", "Violet Drift"];

/**
 * The galaxy map: every star's position (galaxy units, radius 1), kind, brightness and name.
 * @param {number} seed
 */
export function makeGalaxy(seed) {
  const r = rng32(hashSeed("galaxy", seed));
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const twist = 3 + r() * 1.4,
    armCount = 4,
    spin = r() * Math.PI * 2;
  const stars = [];
  const pickPos = []; // the unconfined positions starting systems are chosen from (as the full build does)
  for (let i = 0; i < STAR_COUNT; i++) {
    let x, y, arm, dist;
    if (i < STAR_COUNT * 0.16) {
      // The core: a dense bulge.
      dist = Math.abs(gauss()) * 0.16;
      const a = r() * Math.PI * 2;
      x = Math.cos(a) * dist;
      y = Math.sin(a) * dist * 0.85;
      arm = -1;
    } else {
      arm = i % armCount;
      dist = 0.12 + Math.sqrt(r()) * 0.88;
      const v = spin + (arm / armCount) * Math.PI * 2 + dist * twist;
      const off = gauss() * (0.32 * (1 - dist) + 0.12);
      const jx = gauss() * 0.025, jy = gauss() * 0.025;
      pickPos[i] = { x: Math.cos(v + off) * dist + jx, y: Math.sin(v + off) * dist + jy };
      ({ x, y } = armPoint(dist, v, off, twist));
      if (dist < 0.24) {
        const f = 1 - (dist - 0.12) / (0.24 - 0.12);
        x += jx * f;
        y += jy * f;
      }
    }
    let roll = r() * 100,
      kind = "red";
    for (const k of KIND_IDS) {
      roll -= STAR_KINDS[k].weight;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const sector = arm < 0 ? "Galactic Core" : dist > 0.82 ? "Outer Rim" : ARMS[arm];
    stars.push({ id: i, x, y, kind, mag: 0.4 + r() * 0.6, name: makeName("star", hashSeed(seed, i)), sector, arm });
  }
  const starts = pickStarts(seed, stars.map((s, i) => (pickPos[i] ? { ...s, ...pickPos[i] } : s)));
  for (const id of starts) stars[id].start = true;
  const shape = { twist, spin, arms: armCount };
  // The core: reserved for a future empire (the Grox). Kept as data so territory can grow from it.
  const core = { radius: CORE_RADIUS, owner: "keis", systems: stars.filter((s) => Math.hypot(s.x, s.y) < CORE_RADIUS).map((s) => s.id) };
  return { seed, version: GALAXY_VERSION, stars, arms: ARMS, shape, starts, core };
}

/** Nothing begins inside this radius: the bright core is someone else's. */
export const CORE_RADIUS = 0.12;
/** Starting systems lie between these distances from the centre (galaxy radius 1). */
export const START_BAND = [0.5, 0.9];
export const START_COUNT = 10;
/**
 * The starting systems: ten stars in the middle and outer arms, spread over all four arms, of varied
 * kinds, never close to each other. Chosen by their own sub-seed, so star positions never change.
 */
function pickStarts(seed, stars) {
  const r = rng32(hashSeed("starts", seed));
  const ok = new Set(["yellow", "orange", "white", "red", "binary", "blue"]);
  const pool = stars.filter((s) => {
    const d = Math.hypot(s.x, s.y);
    return s.sector !== "Galactic Core" && d > START_BAND[0] && d < START_BAND[1] && ok.has(s.kind);
  });
  // Shuffle (Fisher-Yates, seeded), then take greedily: different arms first, then varied colours, spaced apart.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = [];
  const perArm = {};
  const kinds = {};
  for (let gap = 0.2; picked.length < START_COUNT && gap > 0.04; gap *= 0.8)
    for (const s of pool) {
      if (picked.length >= START_COUNT) break;
      if (picked.includes(s)) continue;
      if (picked.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < gap)) continue;
      if ((perArm[s.sector] || 0) >= Math.ceil(START_COUNT / 4) + (gap < 0.12 ? 1 : 0)) continue;
      if ((kinds[s.kind] || 0) >= 3 && gap > 0.1) continue;
      picked.push(s);
      perArm[s.sector] = (perArm[s.sector] || 0) + 1;
      kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    }
  return picked.map((s) => s.id);
}

/**
 * Terraforming level, T0 to T5: how much life a world can hold. Natural worlds reach T3 at most;
 * T4 and T5 are for worlds that have been terraformed (Space Stage).
 */
export function terraformLevel(planet) {
  if (Number.isInteger(planet.tLevel)) return planet.tLevel;
  const h = planet.habit || 0;
  return h > 0.62 ? 3 : h > 0.35 ? 2 : h > 0.08 ? 1 : 0;
}

/** The star nearest a point (galaxy units), within `max`. */
export function starNear(galaxy, x, y, max = 0.03) {
  let best = null,
    bd = max;
  for (const s of galaxy.stars) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) (bd = d), (best = s);
  }
  return best;
}
export const lightYears = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y) * GALAXY_LY);

/* ---- planets ------------------------------------------------------------------------------- */
export const PLANET_TYPES = {
  terrestrial: { name: "Terrestrial", icon: "🌍", colors: ["#2f6fb3", "#4e9a4a", "#c9b27a", "#f2f2f2"] },
  oceanic: { name: "Oceanic", icon: "🌊", colors: ["#1d4f8f", "#2f7cc4", "#6fb1d9", "#e9f4ff"] },
  jungle: { name: "Jungle", icon: "🌴", colors: ["#1f5a3a", "#2f8a3e", "#6bbf4a", "#245f9a"] },
  swamp: { name: "Swamp", icon: "🐸", colors: ["#3c4a2a", "#5d6b33", "#7f8a4a", "#3f5f5a"] },
  desert: { name: "Desert", icon: "🏜", colors: ["#c98a4a", "#e0b070", "#a8643a", "#f2d9a0"] },
  tundra: { name: "Tundra", icon: "🌲", colors: ["#7f8f86", "#a9b8a6", "#d9e4e0", "#4f6f7a"] },
  ice: { name: "Ice", icon: "🧊", colors: ["#cfe8f5", "#9cc9e6", "#ffffff", "#6fa3c9"] },
  frozen: { name: "Frozen", icon: "❄", colors: ["#e8f2f7", "#b8d0de", "#8faabd", "#ffffff"] },
  volcanic: { name: "Volcanic", icon: "🌋", colors: ["#2a1a17", "#4a2a22", "#ff6a2a", "#7a3a2a"] },
  toxic: { name: "Toxic", icon: "☣", colors: ["#6a7a2a", "#9ab03a", "#4a5a2a", "#c9d85a"] },
  rocky: { name: "Rocky", icon: "🪨", colors: ["#7a6a5a", "#9a8a7a", "#5a4a3a", "#b8a898"] },
  barren: { name: "Barren", icon: "🌑", colors: ["#6f6f6f", "#8f8f8f", "#4f4f4f", "#a8a8a8"] },
  gas: { name: "Gas giant", icon: "🪐", colors: ["#c9a06a", "#e0c48f", "#a8784a", "#f2e0b8"] },
  crystal: { name: "Crystalline", icon: "💎", colors: ["#7a5ad0", "#b89af2", "#4a3a9a", "#e6dcff"] },
};
const LIFE_TYPES = new Set(["terrestrial", "oceanic", "jungle", "swamp", "desert", "tundra", "ice", "toxic", "crystal"]);

/** Atmospheres and what they mean for life. */
const ATMOS = {
  none: { name: "None", life: 0 },
  thin: { name: "Thin", life: 0.4 },
  breathable: { name: "Breathable", life: 1 },
  dense: { name: "Dense", life: 0.7 },
  toxic: { name: "Toxic", life: 0.3 },
  methane: { name: "Methane", life: 0.2 },
  hydrogen: { name: "Hydrogen", life: 0 },
};

/**
 * A star's planetary system: made when the system is first opened.
 * @param {number} seed   the universe's galaxy seed
 * @param {object} star   from makeGalaxy().stars
 */
export function makeSystem(seed, star) {
  const r = rng32(hashSeed("system", seed, star.id));
  const kind = STAR_KINDS[star.kind];
  const [lo, hi] = kind.planets;
  const count = lo + Math.floor(r() * (hi - lo + 1));
  const frost = 2.7 * Math.sqrt(kind.lum);
  const planets = [];
  let orbit = 0.25 + r() * 0.25;
  for (let i = 0; i < count; i++) {
    orbit *= 1.45 + r() * 0.55;
    planets.push(makePlanet(seed, star, i, orbit, frost, r));
  }
  // A starting system always has one T3 world, on the orbit nearest the star's comfortable distance.
  if (star.start) {
    const ideal = Math.sqrt(kind.lum);
    let best = 0;
    planets.forEach((p, i) => Math.abs(Math.log(p.orbit / ideal)) < Math.abs(Math.log(planets[best].orbit / ideal)) && (best = i));
    planets[best] = makeHomeworld(seed, star, best, ideal);
  }
  return {
    starId: star.id,
    star,
    companion: star.kind === "binary" ? { color: "#ff9a7a", size: 0.6 } : null,
    planets,
  };
}

function makePlanet(seed, star, index, orbit, frost, sysRng) {
  const r = rng32(hashSeed("planet", seed, star.id, index));
  const kind = STAR_KINDS[star.kind];
  // Equilibrium temperature: 278 K at 1 AU from a sun-like star, plus greenhouse.
  const kelvin = 278 * Math.pow(kind.lum, 0.25) / Math.sqrt(orbit);
  let type;
  const giant = orbit > frost && r() < 0.62;
  let radius = giant ? 3 + r() * 8 : 0.3 + Math.pow(r(), 1.4) * 1.6;
  let temp = kelvin - 273;
  const wetness = r();
  if (giant) type = "gas";
  else if (r() < 0.015) type = "crystal";
  else if (temp > 330) type = r() < 0.6 ? "volcanic" : "barren";
  else if (temp > 110) type = r() < 0.4 ? "toxic" : r() < 0.6 ? "desert" : r() < 0.6 ? "volcanic" : "barren";
  else if (temp > 40) type = wetness > 0.7 ? "jungle" : wetness > 0.45 ? "toxic" : wetness > 0.2 ? "desert" : "rocky";
  else if (temp > -10) type = radius < 0.4 ? "rocky" : wetness > 0.78 ? "oceanic" : wetness > 0.55 ? "terrestrial" : wetness > 0.4 ? "jungle" : wetness > 0.28 ? "swamp" : "desert";
  else if (temp > -60) type = wetness > 0.5 ? "tundra" : wetness > 0.25 ? "ice" : "rocky";
  else type = wetness > 0.4 ? "frozen" : r() < 0.5 ? "ice" : "barren";
  // Small worlds can't hold air.
  let atmo;
  if (type === "gas") atmo = "hydrogen";
  else if (radius < 0.35 || type === "barren") atmo = r() < 0.7 ? "none" : "thin";
  else if (type === "toxic") atmo = "toxic";
  else if (type === "volcanic") atmo = r() < 0.5 ? "toxic" : "dense";
  else if (type === "frozen" || type === "ice") atmo = r() < 0.5 ? "thin" : "methane";
  else if (type === "crystal") atmo = "thin";
  else atmo = r() < 0.72 ? "breathable" : r() < 0.5 ? "dense" : "thin";
  // Greenhouse: dense and toxic air keep heat in.
  if (atmo === "dense" || atmo === "toxic") temp += 25 + r() * 40;
  const water = type === "oceanic" ? 0.8 + r() * 0.18 : type === "terrestrial" ? 0.45 + r() * 0.3 : type === "jungle" || type === "swamp" ? 0.3 + r() * 0.3 : type === "tundra" ? 0.15 + r() * 0.2 : type === "ice" || type === "frozen" ? 0.05 + r() * 0.15 : type === "desert" ? r() * 0.08 : 0;
  const density = type === "gas" ? 0.25 : type === "crystal" ? 1.4 : 0.8 + r() * 0.4;
  const gravity = Math.round(radius * density * 100) / 100;
  // Habitability: a comfortable temperature, water and air.
  const comfort = Math.max(0, 1 - Math.abs(temp - 15) / 55);
  // No air, no life: however warm and wet the rock.
  const habit = LIFE_TYPES.has(type) && ATMOS[atmo].life > 0 ? Math.max(0, Math.min(1, comfort * 0.5 + Math.min(water, 0.6) * 0.5 + ATMOS[atmo].life * 0.35 - Math.max(0, gravity - 2) * 0.2)) : 0;
  const biodiversity = habit > 0.1 ? Math.min(1, habit * (0.5 + r() * 0.7)) : 0;
  const habitability = habit > 0.62 ? "Easily habitable" : habit > 0.35 ? "Difficult to inhabit" : habit > 0.08 ? "Hostile" : "Lifeless";
  const hazards = [];
  if (temp > 60) hazards.push("Scorching heat");
  if (temp < -40) hazards.push("Deadly cold");
  if (type === "volcanic") hazards.push("Lava flows");
  if (atmo === "toxic") hazards.push("Acid rain");
  if (star.kind === "blue" || (atmo === "none" && orbit < 1)) hazards.push("Radiation");
  if (gravity > 2) hazards.push("Crushing gravity");
  if (type === "gas" || (atmo === "dense" && r() < 0.5)) hazards.push("Superstorms");
  if (type === "desert" && r() < 0.5) hazards.push("Sandstorms");
  const RES = { gas: ["Hydrogen", "Helium-3"], volcanic: ["Metals", "Sulphur"], ice: ["Water ice"], frozen: ["Water ice", "Methane"], desert: ["Minerals", "Silica"], crystal: ["Crystals", "Rare earths"], rocky: ["Metals", "Minerals"], barren: ["Metals"], toxic: ["Sulphur", "Spice"], jungle: ["Timber", "Spice"], swamp: ["Peat", "Spice"], oceanic: ["Salt", "Water"], terrestrial: ["Timber", "Metals", "Water"], tundra: ["Timber", "Minerals"] };
  const resources = RES[type].filter(() => r() < 0.85);
  if (r() < 0.06) resources.push("Spice");
  const moons = type === "gas" ? 2 + Math.floor(r() * 10) : r() < 0.45 ? Math.floor(r() * 3) + (r() < 0.3 ? 1 : 0) : 0;
  const rings = type === "gas" ? r() < 0.5 : r() < 0.04;
  const name = r() < 0.55 ? star.name.replace(/ \d+$/, "") + " " + roman(index) : makeName("planet", hashSeed(seed, star.id, index));
  void sysRng;
  return {
    id: star.id + ":" + index,
    starId: star.id,
    index,
    name,
    type,
    orbit: Math.round(orbit * 100) / 100,
    radius: Math.round(radius * 100) / 100,
    gravity,
    temp: Math.round(temp),
    atmosphere: ATMOS[atmo].name,
    water: Math.round(water * 100) / 100,
    clouds: atmo === "none" ? 0 : Math.min(1, 0.15 + r() * 0.6 + (atmo === "dense" ? 0.3 : 0)),
    rings,
    moons,
    habitability,
    habit: Math.round(habit * 100) / 100,
    biodiversity: Math.round(biodiversity * 100) / 100,
    resources,
    hazards,
    danger: Math.min(5, hazards.length + (gravity > 1.6 ? 1 : 0)),
    surfaceSeed: hashSeed("surface", seed, star.id, index),
    // Future stages: colonies need habitability and resources; terraforming moves temp and water.
    terraform: { temp: Math.round(temp), water: Math.round(water * 100) / 100, atmosphere: ATMOS[atmo].name },
  };
}

/** Types a starting world can be: all of them have oceans, land and plants. */
const HOME_TYPES = ["terrestrial", "jungle", "oceanic", "swamp", "terrestrial", "tundra", "jungle", "terrestrial"];
const HOME_TEMP = { terrestrial: [8, 24], jungle: [22, 34], oceanic: [12, 26], swamp: [18, 30], tundra: [-6, 6] };
const HOME_WATER = { terrestrial: [0.45, 0.7], jungle: [0.35, 0.55], oceanic: [0.72, 0.86], swamp: [0.4, 0.6], tundra: [0.3, 0.5] };
const CLIMATE = { terrestrial: "Temperate", jungle: "Tropical", oceanic: "Maritime", swamp: "Humid", tundra: "Cool" };
const HOME_TEXT = {
  terrestrial: "Rolling continents and blue seas under a breathable sky. Forests, grasslands and warm shallows teem with simple life.",
  jungle: "A steaming world wrapped in rainforest. Warm rivers run into shallow tropical seas full of tiny life.",
  oceanic: "Almost all ocean, with chains of green islands. Warm currents carry rich soups of microscopic life.",
  swamp: "Wetlands, deltas and misty mangrove coasts. Murky, nutrient-rich waters are perfect for early life.",
  tundra: "A cool world of pine forests and grey seas. Life clusters in the sheltered bays and around warm springs.",
};
/** A T3 starting world: breathable air, a comfortable climate, oceans, land and a stable ecosystem. */
function makeHomeworld(seed, star, index, orbit) {
  const r = rng32(hashSeed("homeworld", seed, star.id));
  const type = HOME_TYPES[Math.floor(r() * HOME_TYPES.length)];
  const span = (a) => a[0] + r() * (a[1] - a[0]);
  const temp = Math.round(span(HOME_TEMP[type]));
  const water = Math.round(span(HOME_WATER[type]) * 100) / 100;
  const radius = Math.round((0.85 + r() * 0.45) * 100) / 100;
  const gravity = Math.round(radius * (0.85 + r() * 0.25) * 100) / 100;
  const habit = Math.round((0.78 + r() * 0.17) * 100) / 100;
  const moons = r() < 0.35 ? 0 : r() < 0.75 ? 1 : 2;
  const RES = { jungle: ["Timber", "Spice"], swamp: ["Peat", "Spice"], oceanic: ["Salt", "Water"], terrestrial: ["Timber", "Metals", "Water"], tundra: ["Timber", "Minerals"] };
  return {
    id: star.id + ":" + index,
    starId: star.id,
    index,
    name: makeName("planet", hashSeed("home", seed, star.id)),
    type,
    orbit: Math.round(orbit * 100) / 100,
    radius,
    gravity,
    temp,
    atmosphere: "Breathable",
    water,
    clouds: Math.round((0.3 + r() * 0.35) * 100) / 100,
    rings: false,
    moons,
    habitability: "Easily habitable",
    habit,
    biodiversity: Math.round((0.65 + r() * 0.3) * 100) / 100,
    resources: RES[type],
    hazards: [],
    danger: 0,
    surfaceSeed: hashSeed("surface", seed, star.id, index),
    terraform: { temp, water, atmosphere: "Breathable" },
    tLevel: 3,
    homeworld: true,
    climate: CLIMATE[type],
    description: HOME_TEXT[type],
  };
}

/* ---- ecosystems --------------------------------------------------------------------------------- */
const BIOME = {
  terrestrial: { habitats: ["Grasslands", "Forests", "Coasts", "Hills"], palette: null },
  oceanic: { habitats: ["Shallows", "Reefs", "Island shores", "Kelp beds"], palette: [0x3f9cc9, 0xcfefff, 0x2a6f9a] },
  jungle: { habitats: ["Canopy", "Undergrowth", "River banks", "Clearings"], palette: [0x3fae5a, 0xf2e05a, 0xd9483f] },
  swamp: { habitats: ["Bogs", "Mangroves", "Mudflats", "Reed beds"], palette: [0x6b7a3a, 0xc9c98a, 0x4a3a2a] },
  desert: { habitats: ["Dunes", "Mesas", "Salt flats", "Oases"], palette: [0xd9a05a, 0xf2e0b8, 0x8a4a2a] },
  tundra: { habitats: ["Taiga", "Frozen plains", "Fjords", "Lichen fields"], palette: [0x8fa0a8, 0xf2f2f2, 0x5a6f7a] },
  ice: { habitats: ["Ice shelves", "Ice caves", "Snowfields", "Thermal vents"], palette: [0xcfe8f5, 0xffffff, 0x6fa3c9] },
  toxic: { habitats: ["Acid pools", "Fungal fields", "Sulphur vents", "Spore forests"], palette: [0x9ab03a, 0x5a2a6a, 0xe0f25a] },
  crystal: { habitats: ["Crystal spires", "Glass plains", "Geodes", "Prism caves"], palette: [0xb89af2, 0xe6dcff, 0x4a3a9a] },
};
const PLANT_KINDS = {
  terrestrial: ["Tree", "Shrub", "Grass", "Flower"],
  oceanic: ["Kelp", "Coral", "Seagrass", "Algae"],
  jungle: ["Giant tree", "Vine", "Fern", "Flower"],
  swamp: ["Reed", "Mangrove", "Bog moss", "Lily"],
  desert: ["Cactus", "Succulent", "Thornbush", "Dry grass"],
  tundra: ["Conifer", "Lichen", "Moss", "Berry shrub"],
  ice: ["Frost moss", "Ice lichen", "Snow bloom", "Vent algae"],
  toxic: ["Fungus", "Spore cap", "Acid weed", "Gas bladder"],
  crystal: ["Crystal bloom", "Glass reed", "Prism moss", "Geode fungus"],
};
const TEMPERAMENTS = { shy: "Shy", proud: "Proud", playful: "Playful", fierce: "Fierce", curious: "Curious" };
const LANDMARKS = {
  terrestrial: ["a great waterfall", "a stone arch", "a crater lake", "a canyon"],
  oceanic: ["a coral atoll", "a deep trench", "a whirlpool", "an archipelago"],
  jungle: ["a sunken temple of roots", "a giant hollow tree", "a misty gorge", "a river delta"],
  swamp: ["a sinking forest", "a methane marsh", "a mud volcano", "a black lake"],
  desert: ["a glass desert", "a dune sea", "a salt pan", "wind-carved pillars"],
  tundra: ["a frozen waterfall", "an ice-bound fjord", "a geyser field", "a boulder plain"],
  ice: ["an ice cathedral", "a frozen ocean", "blue ice caves", "a cryovolcano"],
  toxic: ["an acid lake", "a fungal tower", "a sulphur geyser", "a glowing swamp"],
  crystal: ["a crystal forest", "a singing canyon", "a prism lake", "a shard field"],
  volcanic: ["a lava lake", "a towering caldera", "obsidian fields", "a fire fountain"],
  rocky: ["a vast crater", "a rift valley", "a mesa range", "a boulder field"],
  barren: ["an ancient impact basin", "dust plains", "a shattered ridge", "a silent crater"],
  frozen: ["a methane sea", "a nitrogen glacier", "a frozen geyser", "ice plains"],
  gas: ["a great storm", "banded clouds", "a polar vortex", "lightning fields"],
};

/** Recolour a generated creature for its world, and build it for the gravity there. */
function adapt(record, planet, r) {
  const pal = BIOME[planet.type]?.palette;
  if (pal && r() < 0.8) record.colors = { base: pal[0], pattern: pal[1], accent: pal[2] };
  if (planet.gravity > 1.4) record.legs = record.legs.map((l) => ({ ...l, length: Math.max(0.6, l.length * 0.75) }));
  else if (planet.gravity < 0.6) record.legs = record.legs.map((l) => ({ ...l, length: Math.min(1.8, l.length * 1.3) }));
  return record;
}

/**
 * A planet's living things, made when it is explored. Built from the creature stage's own species
 * generator, so every organism is made of real parts, with a real diet and anatomy.
 * Food chain: plants → herbivores (about one per plant) → predators (about one per three herbivores).
 */
export function makeEcosystem(seed, planet) {
  const out = { plants: [], species: [], landmarks: [] };
  const r = rng32(hashSeed("eco", seed, planet.id));
  const lm = LANDMARKS[planet.type] || LANDMARKS.rocky;
  const nLand = 1 + Math.floor(r() * 3);
  const lmStart = Math.floor(r() * lm.length);
  for (let i = 0; i < nLand; i++) out.landmarks.push({ id: planet.id + ":l" + i, name: lm[(lmStart + i) % lm.length], kind: "landmark" });
  if (planet.biodiversity <= 0) return out;
  const nPlants = Math.max(1, Math.round(1 + planet.biodiversity * 7));
  const kinds = PLANT_KINDS[planet.type] || PLANT_KINDS.terrestrial;
  const habitats = BIOME[planet.type]?.habitats || ["Plains"];
  for (let i = 0; i < nPlants; i++) {
    const ps = hashSeed("plant", seed, planet.id, i);
    const pr = rng32(ps);
    const kind = kinds[Math.floor(pr() * kinds.length)];
    const fruit = pr() < 0.55;
    const pal = BIOME[planet.type]?.palette || [0x4e9a4a, 0xf2d27a, 0xd9483f];
    out.plants.push({
      id: planet.id + ":p" + i,
      kind: "plant",
      name: makeName("plant", ps),
      type: kind,
      habitat: habitats[Math.floor(pr() * habitats.length)],
      color: "#" + [pal[0], 0x3f8f4a, 0x6bbf4a, 0x2f6a3a][Math.floor(pr() * 4)].toString(16).padStart(6, "0"),
      accent: "#" + pal[2].toString(16).padStart(6, "0"),
      fruit: fruit ? (pr() < 0.5 ? "Edible fruit" : pr() < 0.5 ? "Seed pods" : "Sweet nectar") : "None",
      needs: (planet.temp < -10 ? "Cold-hardy" : planet.temp > 40 ? "Heat-loving" : "Temperate") + ", " + (planet.water > 0.4 ? "wet" : "dry") + " ground",
      height: Math.round((0.2 + pr() * (/tree|Mangrove|Conifer|Kelp/i.test(kind) ? 30 : 3)) * 10) / 10,
      rarity: i === nPlants - 1 && pr() < 0.4 ? "Rare" : "Common",
    });
  }
  // Animals: herbivores fed by the plants, predators fed by the herbivores, omnivores between.
  const herb = Math.max(1, Math.round(nPlants * (0.6 + planet.biodiversity * 0.6)));
  const pred = Math.max(planet.biodiversity > 0.25 ? 1 : 0, Math.round(herb / 3));
  const omni = Math.round(planet.biodiversity * 3 * r());
  const plan = [...Array(herb).fill("plant"), ...Array(omni).fill("omni"), ...Array(pred).fill("meat")];
  plan.forEach((diet, i) => {
    const ss = hashSeed("species", seed, planet.id, i);
    const sr = rng32(ss);
    const level = 1 + Math.floor(sr() * (1 + planet.biodiversity * 4));
    const sp = generateSpecies(ss, diet, Math.min(5, level));
    const record = adapt(JSON.parse(JSON.stringify(sp.record)), planet, sr);
    const size = Math.round((0.3 + sr() * (diet === "meat" ? 4 : 3)) * 10) / 10;
    const rare = sr() < 0.12 + (diet === "meat" ? 0.05 : 0);
    const danger = diet === "meat" ? Math.min(5, 2 + Math.round(size)) : diet === "omni" ? Math.min(4, 1 + Math.round(size / 2)) : size > 2.5 ? 2 : 1;
    const name = makeName("species", ss);
    record.name = name;
    const habitat = habitats[Math.floor(sr() * habitats.length)];
    const role = diet === "meat" ? (size > 3 ? "Apex predator" : "Predator") : diet === "omni" ? "Omnivore" : size > 2.6 ? "Giant grazer" : "Grazer";
    out.species.push({
      id: planet.id + ":s" + i,
      kind: "species",
      name,
      diet,
      role,
      record,
      habitat,
      temperament: TEMPERAMENTS[sp.personality] || "Curious",
      rarity: rare ? "Rare" : "Common",
      danger,
      size,
      description: describe({ name, diet, role, habitat, size, planet, temperament: TEMPERAMENTS[sp.personality] || "Curious" }),
    });
  });
  return out;
}
function describe(s) {
  const food = s.diet === "meat" ? "hunts the smaller grazers" : s.diet === "omni" ? "eats whatever it finds, plant or animal" : "grazes on the local plants";
  const size = s.size > 3 ? "A huge" : s.size > 1.5 ? "A sturdy" : "A small";
  const grav = s.planet.gravity > 1.4 ? " Built low and heavy for the strong gravity." : s.planet.gravity < 0.6 ? " Long-limbed and light in the weak gravity." : "";
  return `${size} ${s.temperament.toLowerCase()} ${s.role.toLowerCase()} of the ${s.habitat.toLowerCase()} that ${food}.${grav}`;
}

/**
 * The universe's home world: the most habitable terrestrial-type planet near the middle of an arm.
 * Searched in a fixed order, so it is the same for a given seed every time.
 */
export function findHomeWorld(galaxy) {
  const candidates = galaxy.stars
    .filter((s) => (s.kind === "yellow" || s.kind === "orange") && Math.hypot(s.x, s.y) > 0.35 && Math.hypot(s.x, s.y) < 0.7)
    .slice(0, 160);
  let best = null;
  for (const star of candidates) {
    const sys = makeSystem(galaxy.seed, star);
    for (const p of sys.planets) if (p.biodiversity > 0 && (!best || p.habit > best.planet.habit)) best = { star, planet: p };
    if (best && best.planet.habit > 0.75) break;
  }
  // Every galaxy has one: if the search came up empty, the first candidate's first planet will do.
  if (!best) {
    const star = candidates[0] || galaxy.stars[0];
    best = { star, planet: makeSystem(galaxy.seed, star).planets[0] };
  }
  return { starId: best.star.id, planetId: best.planet.id };
}
