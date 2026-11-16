/**
 * The cast of the primordial soup. Each species has its own silhouette (spine profile), palette,
 * pattern and organs. Herbivores are cool greens and violets with soft round bodies; carnivores are
 * hot reds and oranges with pointed bodies, jaws and spikes, so threats read at a glance.
 * Pure data and a generator: no THREE. Part positions are rough; the caller snaps them to the membrane.
 */
import { CELL_FORMAT, CELL_VERSION, shiftHue } from "./cell-format.js";
import { dietOf } from "./part-defs.js";

/** Part slots: `t` runs 0 (tail) to 1 (head); `side` is 1 / -1 for the flanks and 0 for the tip on the spine. */
export const SPECIES = {
  drifter: {
    name: "Drifter",
    diet: "plant",
    threat: false,
    weight: 0.42,
    nodes: [[-0.95, 0, 0.34], [-0.35, 0, 0.62], [0.3, 0, 0.66], [0.9, 0, 0.36]],
    palettes: [{ base: 0xa8d93f, pattern: 0xeef59c, accent: 0xff9e4a }, { base: 0x8fd35a, pattern: 0xf6f0a0, accent: 0xff7e8a }],
    pattern: "spots",
    parts: [{ id: "filter", t: 1, side: 0 }, { id: "eye", t: 0.72, side: 1 }, { id: "eye", t: 0.72, side: -1, optional: true }, { id: "cilia", t: 0.2, side: 1 }, { id: "cilia", t: 0.2, side: -1 }],
    eyeColor: 0x3ca98b,
  },
  slipper: {
    name: "Slipper",
    diet: "plant",
    threat: false,
    weight: 0.3,
    nodes: [[-1.3, 0, 0.2], [-0.65, 0.05, 0.34], [0, -0.04, 0.42], [0.65, 0.04, 0.36], [1.25, 0, 0.18]],
    palettes: [{ base: 0x4fcf86, pattern: 0x1d7a55, accent: 0xe8ff9a }, { base: 0x62d6a8, pattern: 0x1e6f5f, accent: 0xfff29a }],
    pattern: "stripes",
    parts: [{ id: "filter", t: 1, side: 0 }, { id: "flagellum", t: 0, side: 0 }, { id: "eye", t: 0.78, side: 1 }],
    eyeColor: 0x2e9c74,
  },
  twinbulb: {
    name: "Twinbulb",
    diet: "plant",
    threat: false,
    weight: 0.28,
    nodes: [[-1.15, 0, 0.3], [-0.7, 0, 0.56], [-0.1, 0, 0.3], [0.5, 0, 0.52], [1.05, 0, 0.28]],
    palettes: [{ base: 0xa98af0, pattern: 0xe6d8ff, accent: 0x8cf0d0 }, { base: 0xb7a0f5, pattern: 0xffd8f2, accent: 0xa4f5c8 }],
    pattern: "glow",
    parts: [{ id: "filter", t: 1, side: 0 }, { id: "cilia", t: 0.78, side: 1 }, { id: "cilia", t: 0.78, side: -1 }, { id: "eye", t: 0.3, side: 1 }],
    eyeColor: 0x6a58c8,
  },
  gnasher: {
    name: "Gnasher",
    diet: "meat",
    threat: true,
    weight: 0.55,
    nodes: [[-1.1, 0, 0.34], [-0.4, 0, 0.64], [0.4, 0, 0.5], [1.2, 0, 0.13]],
    palettes: [{ base: 0xe2455f, pattern: 0x6a1330, accent: 0xffb36a }, { base: 0xd9383f, pattern: 0x57101f, accent: 0xffc36a }],
    pattern: "stripes",
    parts: [{ id: "jaw", t: 1, side: 0 }, { id: "spike", t: 0.45, side: 1 }, { id: "spike", t: 0.45, side: -1 }, { id: "spike", t: 0.1, side: 1, optional: true }, { id: "spike", t: 0.1, side: -1, optional: true }, { id: "eye", t: 0.78, side: 1 }],
    eyeColor: 0xe2342f,
  },
  stinger: {
    name: "Stinger",
    diet: "meat",
    threat: true,
    weight: 0.45,
    nodes: [[-1.6, 0, 0.14], [-0.9, 0.1, 0.28], [-0.2, -0.08, 0.34], [0.5, 0.08, 0.3], [1.2, 0, 0.16]],
    palettes: [{ base: 0xff7f3a, pattern: 0x4a1c12, accent: 0xffe08a }, { base: 0xf26a3d, pattern: 0x3a1410, accent: 0xffd36a }],
    pattern: "spots",
    parts: [{ id: "jaw", t: 1, side: 0 }, { id: "flagellum", t: 0, side: 0 }, { id: "spike", t: 0.58, side: 1 }, { id: "spike", t: 0.58, side: -1 }, { id: "spike", t: 0.3, side: 1 }, { id: "spike", t: 0.3, side: -1 }, { id: "eye", t: 0.85, side: 1 }, { id: "eye", t: 0.85, side: -1 }],
    eyeColor: 0xff3b2f,
  },
  tyrant: {
    name: "Tyrant",
    diet: "meat",
    threat: true,
    alpha: true,
    weight: 0,
    nodes: [[-1.5, 0, 0.34], [-0.7, 0, 0.78], [0.3, 0, 0.86], [1.1, 0, 0.5], [1.7, 0, 0.2]],
    palettes: [{ base: 0xa3205a, pattern: 0xff8a3d, accent: 0xffd36a }],
    pattern: "glow",
    parts: [{ id: "jaw", t: 1, side: 0 }, { id: "spike", t: 0.75, side: 1 }, { id: "spike", t: 0.75, side: -1 }, { id: "spike", t: 0.45, side: 1 }, { id: "spike", t: 0.45, side: -1 }, { id: "spike", t: 0.15, side: 1 }, { id: "spike", t: 0.15, side: -1 }, { id: "eye", t: 0.8, side: 1 }, { id: "eye", t: 0.8, side: -1 }, { id: "flagellum", t: 0, side: 0 }],
    eyeColor: 0xff2a2a,
  },
};

const pickWeighted = (ids, rng) => {
  const total = ids.reduce((sum, id) => sum + SPECIES[id].weight, 0);
  let roll = rng() * total;
  for (const id of ids) {
    roll -= SPECIES[id].weight;
    if (roll <= 0) return id;
  }
  return ids[ids.length - 1];
};

export const speciesOfDiet = (diet) => Object.keys(SPECIES).filter((id) => SPECIES[id].diet === diet && !SPECIES[id].alpha);

/** Choose a species id for a diet (or the alpha). */
export function chooseSpecies(diet, rng, alpha = false) {
  if (alpha) return "tyrant";
  return pickWeighted(speciesOfDiet(diet), rng);
}

/**
 * A cell-record-shaped description of one individual. Each individual gets a slightly different
 * length, girth and hue so no two look identical, while the species stays unmistakable.
 */
export function speciesRecord(speciesId, rng) {
  const sp = SPECIES[speciesId];
  const lengthJitter = 0.9 + rng() * 0.2,
    girth = 0.92 + rng() * 0.16;
  const nodes = sp.nodes.map(([x, y, r]) => ({ x: x * lengthJitter, y, r: r * girth }));
  const tailX = nodes[0].x,
    headX = nodes[nodes.length - 1].x;
  const palette = sp.palettes[Math.floor(rng() * sp.palettes.length)];
  const hue = (rng() - 0.5) * 0.05;
  const widest = Math.max(...nodes.map((n) => n.r));
  const parts = sp.parts
    .filter((p) => !p.optional || rng() > 0.35)
    .map((p, i) => ({
      id: p.id,
      x: tailX + (headX - tailX) * p.t,
      y: p.side * widest * 1.2,
      rotation: 0,
      scale: p.id === "spike" ? 0.8 + rng() * 0.3 : p.id === "eye" ? 0.9 : 1,
      pairId: i,
    }));
  return {
    format: CELL_FORMAT,
    version: CELL_VERSION,
    stage: "npc",
    name: sp.name,
    tier: 1,
    scale: 1,
    body: { nodes, pattern: sp.pattern, paintStrokes: [] },
    colors: { base: shiftHue(palette.base, hue), pattern: palette.pattern, accent: palette.accent },
    parts,
    diet: dietOf(parts.map((p) => p.id)),
    speciesId,
  };
}
