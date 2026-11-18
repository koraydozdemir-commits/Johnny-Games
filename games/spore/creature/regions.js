/**
 * The Creature Stage's regions. Your species starts on the coast; each migration (one per new brain
 * level) leads it into the next region, and regions it has lived in stay open to travel back to.
 * Every region is its own landmass with its own terrain, plants, hazards, nests and wildlife, so
 * different bodies do well in different places.
 *
 * The coast is the original open island, generated exactly as before so older saves line up.
 */

/** Smooth hills (the default), flat-topped mesas, or a volcano with a crater. */
export const PROFILES = ["smooth", "mesa", "volcano"];

export const REGIONS = [
  {
    id: "coast",
    name: "Sunlit Coast",
    blurb: "Open meadows by the sea. A gentle place to start.",
    seed: 20261117,
    hills: 4,
    roughness: 1,
    peaks: [
      { x: -96, z: -96, r: 26, h: 30 },
      { x: -63, z: -122, r: 30, h: 36 },
      { x: -25, z: -140, r: 28, h: 42 },
      { x: 15, z: -137, r: 30, h: 38 },
      { x: 52, z: -118, r: 25, h: 31 },
      { x: -150, z: -24, r: 24, h: 28 },
      { x: -138, z: 13, r: 26, h: 33 },
      { x: -149, z: 47, r: 19, h: 23 },
      { x: 128, z: -56, r: 26, h: 31 },
      { x: 149, z: -22, r: 21, h: 25 },
      { x: -42, z: 8, r: 18, h: 22 },
      { x: 62, z: 30, r: 16, h: 18 },
    ],
    colors: { grassLight: 0x86c25a, grassDark: 0x5f9e45, dirt: 0x8e8a5a, rock: 0x8a8576, cliff: 0x6c665c, snow: 0xf4f7fb, sand: 0xe3cf95, seabed: 0xc9b98a, stone: 0x7f796c, trunk: 0x6f5236, leaf: 0x3f8f45, bush: 0x3f8f52, fruit: 0xff5a7a },
    sky: { day: 0x9fd6ee, dusk: 0xf0a274, night: 0x10203a },
    fog: [90, 240],
    trees: { groves: 14, perGrove: 4, lone: 28, kind: "broadleaf" },
    palms: true,
    outcrops: 22,
    bushes: 95,
    tufts: 1,
    hunger: 1,
    // Wildlife roles that live here, most common first (see ecosystem.js).
    wildlife: ["grazer", "smallPrey", "scavenger", "packHunter"],
  },
  {
    id: "forest",
    name: "Deepwood Forest",
    blurb: "Dense, shady woods full of fruit and full of ambushers.",
    seed: 31117,
    hills: 9,
    roughness: 1.4,
    peaks: [
      { x: -110, z: -70, r: 24, h: 26 },
      { x: -80, z: -100, r: 22, h: 24 },
      { x: 95, z: -95, r: 26, h: 30 },
      { x: 120, z: 40, r: 18, h: 18 },
      { x: -20, z: -30, r: 14, h: 16 },
    ],
    colors: { grassLight: 0x6aa24a, grassDark: 0x3f7a35, dirt: 0x6e6040, rock: 0x7a7468, cliff: 0x5e594f, snow: 0xe8eef2, sand: 0xbfae7a, seabed: 0xa9996e, stone: 0x6f6a5e, trunk: 0x5b4029, leaf: 0x2f7438, bush: 0x2f7a40, fruit: 0xffa53a },
    sky: { day: 0x8fc9b8, dusk: 0xd9926a, night: 0x0d1c26 },
    fog: [55, 170],
    trees: { groves: 34, perGrove: 7, lone: 110, kind: "forest" },
    palms: false,
    outcrops: 10,
    bushes: 120,
    tufts: 1.1,
    hunger: 0.9,
    wildlife: ["smallPrey", "grazer", "ambusher", "scavenger", "giant"],
  },
  {
    id: "swamp",
    name: "Mire Wetlands",
    blurb: "Murky pools and reed beds. Swimmers thrive; heavy walkers struggle.",
    seed: 41117,
    hills: 0.8,
    roughness: 0.6,
    pools: 26,
    peaks: [
      { x: -120, z: -60, r: 16, h: 14 },
      { x: 110, z: -100, r: 14, h: 12 },
    ],
    colors: { grassLight: 0x7f9a4c, grassDark: 0x55703a, dirt: 0x5d5236, rock: 0x6c6a5a, cliff: 0x55534a, snow: 0xdde4e0, sand: 0x8f7f55, seabed: 0x6f6448, stone: 0x5f5d50, trunk: 0x4b3a26, leaf: 0x4a6b33, bush: 0x47693a, fruit: 0xd8f05a },
    sky: { day: 0xa8bfa0, dusk: 0xc9a278, night: 0x101a18 },
    fog: [40, 150],
    trees: { groves: 22, perGrove: 5, lone: 50, kind: "mangrove" },
    palms: false,
    reeds: true,
    outcrops: 6,
    bushes: 80,
    tufts: 1.2,
    hunger: 1,
    wildlife: ["smallPrey", "grazer", "ambusher", "scavenger", "packHunter"],
  },
  {
    id: "badlands",
    name: "Red Badlands",
    blurb: "Dry mesas and canyons. Little fruit, so meat is king; the heat makes you hungry.",
    seed: 51117,
    hills: 3,
    roughness: 1.2,
    profile: "mesa",
    peaks: [
      { x: -90, z: -80, r: 30, h: 20 },
      { x: -40, z: -130, r: 26, h: 22 },
      { x: 60, z: -120, r: 32, h: 24 },
      { x: 120, z: -30, r: 26, h: 20 },
      { x: -140, z: 20, r: 28, h: 22 },
      { x: 40, z: 10, r: 18, h: 14 },
      { x: -50, z: 60, r: 16, h: 12 },
      { x: 110, z: 80, r: 20, h: 16 },
    ],
    colors: { grassLight: 0xc98b55, grassDark: 0xa86a3e, dirt: 0x9a6a44, rock: 0xb0603c, cliff: 0x8e4a30, snow: 0xe8c9a0, sand: 0xe0a86a, seabed: 0xb08a5c, stone: 0x9c5a3c, trunk: 0x6a4a2c, leaf: 0x5f8a45, bush: 0x6a7f3a, fruit: 0xff4f6a },
    sky: { day: 0xf0c995, dusk: 0xf08a5a, night: 0x1e1420 },
    fog: [80, 230],
    trees: { groves: 0, perGrove: 0, lone: 70, kind: "cactus" },
    palms: false,
    outcrops: 30,
    bushes: 30,
    tufts: 0.35,
    hunger: 1.35,
    wildlife: ["smallPrey", "packHunter", "scavenger", "guardian", "grazer"],
  },
  {
    id: "volcanic",
    name: "Ember Highlands",
    blurb: "Black rock, ash and lava. Home of the island's apex creatures.",
    seed: 61117,
    hills: 7,
    roughness: 1.5,
    lava: 14,
    peaks: [
      { x: 0, z: -40, r: 46, h: 56, profile: "volcano" },
      { x: -130, z: -60, r: 22, h: 26 },
      { x: 130, z: -70, r: 24, h: 28 },
      { x: -100, z: 70, r: 18, h: 18 },
    ],
    colors: { grassLight: 0x77705f, grassDark: 0x4f4a42, dirt: 0x4a3f36, rock: 0x3d3a37, cliff: 0x2b2826, snow: 0x6b5a50, sand: 0x2c2a28, seabed: 0x3a3430, stone: 0x302d2b, trunk: 0x2a2220, leaf: 0x5c4a30, bush: 0x5a4a35, fruit: 0xff7a2a },
    sky: { day: 0xb59a88, dusk: 0xd06a42, night: 0x170c0c },
    fog: [50, 180],
    trees: { groves: 6, perGrove: 4, lone: 40, kind: "charred" },
    palms: false,
    outcrops: 26,
    bushes: 45,
    tufts: 0.15,
    hunger: 1.15,
    wildlife: ["guardian", "packHunter", "scavenger", "giant", "smallPrey"],
  },
];

export const REGION_IDS = REGIONS.map((r) => r.id);
export const regionById = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
/** The region a species should be living in at a brain level: one more each level, coast first. */
export const regionForBrain = (brain) => REGIONS[Math.max(0, Math.min(REGIONS.length - 1, brain - 1))].id;
export const regionIndex = (id) => Math.max(0, REGION_IDS.indexOf(id));
