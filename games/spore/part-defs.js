/**
 * Pure data and rules for cell parts. No THREE, no DOM: shared by the cell stage,
 * the saved-cell format and (later) the creature stage.
 */

export const BASE_COLORS = [0x3be0d8, 0x8bd18b, 0xe6a76f, 0xb9a4ef, 0xe17fa9, 0x6ca4e8, 0xffd56d];
export const PATTERN_COLORS = [0x9df6ee, 0x204d88, 0xf3dc9e, 0x8cf0af, 0xef97d0];
export const ACCENT_COLORS = [0xffedbc, 0xff8eae, 0x91f8ed, 0xc9a4ff, 0xffb65c];
export const PATTERNS = ["speckle", "stripes", "spots", "gradient", "glow"];

export const MAX_NODES = 8;
export const MIN_NODES = 2;
export const MAX_COMPLEXITY = 100;

/** `col` is the part's main colour; `cat` groups parts in the editor; `diet` is only set on mouths. */
export const PART_DEFS = [
  { id: "filter", name: "Filter Mite", cat: "Mouths", cost: 0, unlock: 0, complex: 8, diet: "plant", desc: "Herbivore filter. Pulls in floating plant particles at short range.", stats: { bite: 1, feeding: 2 }, col: 0xffb78a },
  { id: "jaw", name: "Jaw", cat: "Mouths", cost: 12, unlock: 12, complex: 15, diet: "meat", attack: 5, desc: "Carnivore mouth. Bites meat chunks and damages enemy cells at close range.", stats: { bite: 5, feeding: 3 }, col: 0xf08b87 },
  { id: "proboscis", name: "Proboscis", cat: "Mouths", cost: 22, unlock: 22, complex: 18, diet: "omni", attack: 2, desc: "Omnivore feeder. Reaches farther and consumes plants or meat.", stats: { bite: 3, feeding: 4 }, col: 0xffc276 },
  { id: "cilia", name: "Cilia Pair", cat: "Locomotion", cost: 12, unlock: 12, complex: 10, turn: 2.4, speed: 0.4, desc: "Grip the water: much faster turning, snappy acceleration and a little extra speed.", stats: { turn: 4, thrust: 1 }, col: 0x91f0d5 },
  { id: "flagellum", name: "Flagellum", cat: "Locomotion", cost: 22, unlock: 22, complex: 12, turn: -0.4, speed: 3, desc: "Steady, constant propulsion: the fastest way to swim and never slows or surges, but it turns wide.", stats: { thrust: 5, turn: 1 }, col: 0x80edf0 },
  { id: "jet", name: "Jet", cat: "Locomotion", cost: 32, unlock: 32, complex: 14, speed: 0.5, desc: "Fires short bursts of thrust by itself while you swim, shoving you forward in surges.", stats: { burst: 4, thrust: 2 }, col: 0x8ce6ff },
  { id: "spike", name: "Spike", cat: "Weapons", cost: 12, unlock: 12, complex: 9, attack: 3, desc: "Hits hard on contact, and hurts any cell that bites or rams you. More spikes, more damage.", stats: { damage: 3 }, col: 0xffa0a4 },
  { id: "poison", name: "Poison Gland", cat: "Weapons", cost: 22, unlock: 22, complex: 15, attack: 2, desc: "Releases drifting clouds of poison behind you. Cells inside lose health and slow down.", stats: { damage: 2, trail: 1 }, col: 0xa8ef8a },
  { id: "electric", name: "Electric Organs", cat: "Weapons", cost: 32, unlock: 32, complex: 16, attack: 5, desc: "Wraps you in a crackling electric field that shocks nearby cells, with a stunning pulse every few seconds.", stats: { shock: 5, radius: 2 }, col: 0x9aaaff },
  { id: "eye", name: "Eye", cat: "Senses", cost: 10, unlock: 10, complex: 8, sight: 4, desc: "Extends the visible radius and maximum camera zoom.", stats: { sight: 4 }, col: 0xffd98a },
  { id: "mito", name: "Mitochondria", cat: "Body", cost: 8, unlock: 8, complex: 7, hp: 2, speed: 1, desc: "Boosts membrane health capacity and sustained metabolism.", stats: { health: 2, thrust: 1 }, col: 0xffb66f },
  { id: "armour", name: "Chitin Plates", cat: "Body", cost: 18, unlock: 18, complex: 12, hp: 5, speed: -1, desc: "Hard shell plates reduce incoming damage, at the expense of speed.", stats: { health: 5, armour: 2 }, col: 0x9bbed3 },
];

export const PART_IDS = PART_DEFS.map((d) => d.id);
export const STARTER_PARTS = ["filter", "cilia", "eye"];

export const partDef = (id) => PART_DEFS.find((d) => d.id === id) || null;

export function dietOf(partIds) {
  const diets = [];
  for (const id of partIds) {
    const d = partDef(id);
    if (d && d.cat === "Mouths") diets.push(d.diet);
  }
  const unique = [...new Set(diets)];
  return unique.includes("omni") || unique.length > 1 ? "omni" : unique[0] || "plant";
}

export const complexityOf = (partIds) => partIds.reduce((sum, id) => sum + (partDef(id)?.complex || 0), 0);

/** Gameplay stats derived from a cell's body and parts. `nodes` are spine nodes `{x, y, r}`. */
export function computeStats(partIds, nodes, vision = 1) {
  let speed = 1.5,
    turn = 1.2,
    damage = 0,
    sight = vision,
    healthBonus = 0,
    armour = 0;
  for (const id of partIds) {
    const d = partDef(id);
    if (!d) continue;
    speed += d.speed || 0;
    turn += d.turn || 0;
    damage += d.attack || 0;
    sight += d.sight || 0;
    healthBonus += d.hp || 0;
    if (id === "armour") armour += 2;
  }
  const length = nodes.length ? Math.abs(nodes[nodes.length - 1].x - nodes[0].x) : 0;
  turn = turn / (1 + length * 0.1 + partIds.length * 0.02);
  return {
    speed: Math.max(0.55, speed),
    turn: Math.max(0.4, turn),
    damage,
    sight,
    healthBonus,
    armour,
    diet: dietOf(partIds),
  };
}
