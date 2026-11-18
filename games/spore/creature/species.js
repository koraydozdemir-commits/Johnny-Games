/**
 * Land species. Each nest belongs to one species generated from a seed, so the island's cast is the
 * same every time for a given save. A species' look comes from its seed and evolution; its level
 * (1..5) sets its size, health and how good it is at what it does, and follows the player's brain.
 * Herbivores are cool greens and blues, carnivores warm reds and oranges, omnivores golds and teals,
 * so diet reads at a glance just as in the cell stage.
 */
import { makeRng } from "../cell-format.js";
import { armPairsOf, creaturePartIds, validateCreature } from "./format.js";
import { abilitiesOf, creaturePart } from "./parts.js";
import { npcHealth } from "./balance.js";

const PALETTES = {
  plant: [
    { base: 0x6fc79a, pattern: 0xe9f6c8, accent: 0x4a8fd8 },
    { base: 0x7fb6e8, pattern: 0xe4f1ff, accent: 0x9be38a },
    { base: 0xa58be0, pattern: 0xf0e6ff, accent: 0x7fe0c0 },
  ],
  meat: [
    { base: 0xe2574a, pattern: 0x5a1a1a, accent: 0xffc46a },
    { base: 0xf08a3c, pattern: 0x4a2412, accent: 0xfff0a0 },
    { base: 0xb8445e, pattern: 0x2e1020, accent: 0xff9a5a },
  ],
  omni: [
    { base: 0xe8c34a, pattern: 0x5a4210, accent: 0x6fd4c8 },
    { base: 0x4fbfb2, pattern: 0x14403c, accent: 0xffd36a },
  ],
};
const PATTERNS = ["speckle", "stripes", "spots", "gradient"];
const MOUTHS = { plant: ["beak", "fluteBeak", "trunk"], meat: ["jaws", "tuskMaw", "mandibles"], omni: ["snout", "crusher", "sawBeak"] };
const EXTRAS = {
  plant: ["graspers", "frill", "plumeTail", "shell", "wings", "horns", "sail", "crest", "fanFins", "fanTail", "antlers", "glowOrbs", "rattleTail", "doeEyes", "ears", "plates", "knobs", "paw"],
  meat: ["claws", "pincers", "spines", "horns", "tailClub", "venomSac", "quills", "bladeArms", "stinger", "acidGland", "bugEyes", "plates", "antennae"],
  omni: ["claws", "graspers", "frill", "spines", "plumeTail", "tailClub", "tentacles", "quills", "crest", "stinger", "glowOrbs", "stalkEyes", "antennae", "knobs", "paw"],
};
const FEET = { plant: ["pads", "hooves", "webbed", "stompers"], meat: ["talons", "pads", "stompers"], omni: ["pads", "hooves", "talons", "webbed"] };
const SYLLABLES = ["ka", "ro", "mi", "zu", "tel", "vor", "nax", "pli", "dun", "sha", "gre", "bo", "lun", "tik", "ar", "quo", "fen", "dra"];

/** Body scale by level: a level-1 creature is about your hatchling's size. */
export const LEVEL_SCALE = [0, 0.95, 1.08, 1.22, 1.36, 1.5];

/**
 * A species' strengths at a level, keeping its look. Social moves it is best at are trained up to its
 * level, meat eaters bite harder, and it grows. Rogues are a third bigger and much tougher.
 * @param {object} sp a species from generateSpecies, evolveSpecies or generateRogue
 * @param {number} level 1..5
 */
export function atLevel(sp, level) {
  level = Math.max(1, Math.min(5, Math.round(level)));
  const abilities = abilitiesOf(creaturePartIds(sp.record), sp.record.legs.length, armPairsOf(sp.record));
  const social = ["sing", "dance", "charm", "pose"].map((k) => ({ k, v: abilities[k] })).sort((a, b) => b.v - a.v);
  social.slice(0, 2).forEach(({ k }) => (abilities[k] = Math.min(5, Math.max(abilities[k], level))));
  if (sp.diet !== "plant") abilities.bite = Math.min(5, Math.max(abilities.bite, Math.ceil(level * 0.8)));
  if (sp.rogue) abilities.bite = Math.min(5, Math.max(abilities.bite, level + 1));
  let scale = LEVEL_SCALE[level] * (sp.sizeJitter || 1);
  if (sp.rogue) scale *= 1.3;
  // Health comes from the balance model (level, armour, role), not from size.
  const role = sp.role || (sp.rogue ? "rogue" : sp.diet === "plant" ? "grazer" : sp.diet === "meat" ? "predator" : "standard");
  const maxHealth = npcHealth(level, abilities.health, role);
  return { ...sp, level, abilities, favourite: social.slice(0, 3).map((s) => s.k), scale, maxHealth };
}

/**
 * Personalities change how a species takes to you: how patient it is in a social round, how much a
 * fumbled move costs, how warmly it starts, and whether it can be stared down.
 */
export const PERSONALITIES = {
  shy: { name: "Shy", ask: 1.25, miss: 1.4, start: -0.05, resolve: 0.7, fearsBig: true },
  proud: { name: "Proud", ask: 1, miss: 1, start: 0, resolve: 1.1 },
  playful: { name: "Playful", ask: 0.8, miss: 0.8, start: 0.05, resolve: 0.9 },
  fierce: { name: "Fierce", ask: 0.9, miss: 1.2, start: -0.05, resolve: 1.2 },
  curious: { name: "Curious", ask: 1.1, miss: 0.8, start: 0.1, resolve: 0.85 },
};
const PERSONALITY_BY_DIET = { plant: ["shy", "playful", "curious", "proud"], omni: ["curious", "playful", "proud", "fierce", "shy"], meat: ["fierce", "proud", "fierce", "curious"] };
/** A species' personality: fixed by its seed (no random draw, so its look never changes). */
export const personalityOf = (seed, diet) => {
  const list = PERSONALITY_BY_DIET[diet] || PERSONALITY_BY_DIET.omni;
  return list[(Math.imul(seed >>> 0, 2654435761) >>> 0) % list.length];
};

/** A species for a nest. diet: plant | meat | omni. level: 1..5 (higher grows more parts). */
export function generateSpecies(seed, diet, level) {
  const ring = Math.max(1, Math.min(5, level)); // how many parts it starts with
  const rng = makeRng(seed >>> 0);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const name = (() => {
    const n = 2 + Math.floor(rng() * 2);
    let w = "";
    for (let i = 0; i < n; i++) w += pick(SYLLABLES);
    return w[0].toUpperCase() + w.slice(1);
  })();
  const count = 4 + Math.floor(rng() * 3);
  const spine = [];
  const bulk = 0.32 + rng() * 0.3;
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    spine.push({ x: -1.5 + 3 * u, y: Math.sin(u * Math.PI) * (0.1 + rng() * 0.35) + (u > 0.75 ? rng() * 0.4 : 0), r: (0.22 + Math.sin(u * Math.PI) * bulk) * (0.85 + rng() * 0.3) });
  }
  const pairs = rng() < 0.15 ? 1 : rng() < 0.75 ? 2 : 3;
  const legs = [];
  for (let i = 0; i < pairs; i++) legs.push({ t: pairs === 1 ? 0.45 : 0.22 + (i / (pairs - 1)) * 0.56, length: 0.8 + rng() * 0.8 });
  const better = ring >= 3 ? 1 : 0;
  const mouth = MOUTHS[diet][ring >= 5 && rng() < 0.6 ? 2 : better && rng() < 0.6 ? 1 : 0];
  const parts = [
    { id: mouth, t: 1, angle: 0 },
    { id: rng() < 0.25 + ring * 0.08 ? "stalkEyes" : "eyes", t: 0.91, angle: 0.5 + rng() * 0.3 },
  ];
  const extras = [...EXTRAS[diet]].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(ring / 2) + (rng() < 0.4 ? 1 : 0));
  const arms = [];
  for (const id of extras) {
    const slot = creaturePart(id).slot;
    if (slot === "eye") {
      parts[1].id = id;
      continue;
    }
    if (slot === "hand") {
      // Hands come with a pair of arms to carry them, up on the chest.
      if (!arms.length) arms.push(newArm(rng, id));
      continue;
    }
    parts.push({ id, t: slot === "back" ? 0.35 + rng() * 0.3 : 0.45 + rng() * 0.3, angle: slot === "back" ? 0 : Math.PI / 2 - 0.2 });
  }
  const record = validateCreature({
    name,
    colors: { ...pick(PALETTES[diet]) },
    pattern: pick(PATTERNS),
    spine,
    legs,
    foot: pick(FEET[diet]),
    parts,
    arms,
  });
  const sizeJitter = 0.9 + rng() * 0.2;
  return atLevel(
    {
      id: "sp" + seed,
      name,
      diet,
      record,
      sizeJitter,
      members: 3 + Math.min(3, Math.floor(rng() * 2) + Math.floor(ring / 2)),
      // Carnivores attack on sight; omnivores turn hostile if you linger; herbivores flee or fight back.
      temper: diet === "meat" ? "hostile" : diet === "omni" ? "wary" : "skittish",
      personality: personalityOf(seed, diet),
    },
    ring,
  );
}

/** An epic creature: one huge, very strong individual with no nest. level 4 or 5. */
export function generateEpic(seed, level) {
  const sp = generateSpecies(seed, "meat", Math.min(5, level));
  sp.name = "Great " + sp.name;
  sp.scale = 4 + (level - 4) * 0.6;
  sp.maxHealth = npcHealth(level, 1, "apex");
  sp.abilities.bite = 5;
  sp.members = 1;
  sp.epic = true;
  return sp;
}

/** Rare parts only rogues carry: beating one is the surest way to get them. */
/** A pair of arms on the front of the chest, with a little variety in reach and pose. */
function newArm(rng, hand) {
  return { t: 0.74 + rng() * 0.08, angle: 1.55 + rng() * 0.35, length: 0.8 + rng() * 0.5, bend: (rng() - 0.5) * 0.8, hand };
}
/** Put a hand on a record: on its arms if it has some, else on a new pair. */
function giveHand(record, rng, hand) {
  record.arms ||= [];
  if (record.arms.length) record.arms[0].hand = hand;
  else record.arms.push(newArm(rng, hand));
}
export const ROGUE_PARTS = ["bladeArms", "acidGland", "wings", "antlers", "sail", "glowOrbs", "stinger", "fanTail"];
/**
 * A rogue: a lone, extra-tough wanderer with no nest that carries one rare part. Always hostile.
 * @param {number} seed
 * @param {number} level 1..5 (use atLevel to move it to another level later)
 */
export function generateRogue(seed, level) {
  const diet = seed % 3 === 0 ? "omni" : "meat";
  const sp = generateSpecies(seed, diet, level);
  const rng = makeRng((seed ^ 0x5f3759df) >>> 0);
  const rare = ROGUE_PARTS[Math.floor(rng() * ROGUE_PARTS.length)];
  const record = JSON.parse(JSON.stringify(sp.record));
  const slot = creaturePart(rare).slot;
  if (slot === "hand") giveHand(record, rng, rare);
  else {
    if (slot === "tail") record.parts = record.parts.filter((p) => creaturePart(p.id)?.slot !== "tail");
    const [t, angle] = SLOT_SPOT[slot] || [0.5, 0];
    record.parts.push({ id: rare, t, angle });
  }
  record.colors = { base: 0x5b4f66, belly: 0xa89aa8, pattern: 0x1d1622, accent: 0xff5a3c };
  return atLevel({ ...sp, id: "rogue" + seed, name: "Rogue " + sp.name, record: validateCreature(record), members: 1, temper: "hostile", rogue: true, rare }, sp.level);
}

const SLOT_SPOT = { side: [0.55, Math.PI / 2 - 0.2], back: [0.45, 0], tail: [0, 0], eye: [0.91, 0.62], mouth: [1, 0] };
const hashId = (id) => [...String(id)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/**
 * One step of evolution, as in Spore when the player's brain grows: the species picks up a new part
 * (or a better mouth), grows a little bigger and gets better at what it already does. Deterministic
 * per species and step, so a saved island evolves the same way when it is loaded again.
 * @param {object} sp a species from generateSpecies (or a previous evolveSpecies)
 * @returns {object} a new species object; the id, name and diet never change
 */
export function evolveSpecies(sp) {
  const generation = (sp.generation || 1) + 1;
  const rng = makeRng((hashId(sp.id) + generation * 7919) >>> 0);
  const record = JSON.parse(JSON.stringify(sp.record));
  const owned = new Set(creaturePartIds(validateCreature(record)));
  // Every second generation the mouth improves, if there is a better one for this diet.
  const better = MOUTHS[sp.diet][1];
  if (generation % 2 === 0 && better && !owned.has(better)) {
    record.parts = record.parts.map((p) => (creaturePart(p.id)?.slot === "mouth" ? { ...p, id: better } : p));
  } else {
    // A species with arms already has hands; it won't trade them for different ones.
    const pool = [...EXTRAS[sp.diet], "stalkEyes"].filter((id) => !owned.has(id) && !(creaturePart(id).slot === "hand" && record.arms?.length));
    if (pool.length) {
      const id = pool[Math.floor(rng() * pool.length)];
      const slot = creaturePart(id).slot;
      if (slot === "hand") giveHand(record, rng, id);
      else {
        if (slot === "eye") record.parts = record.parts.filter((p) => creaturePart(p.id)?.slot !== "eye");
        if (slot === "tail") record.parts = record.parts.filter((p) => creaturePart(p.id)?.slot !== "tail");
        const [t, angle] = SLOT_SPOT[slot] || [0.5, 0];
        record.parts.push({ id, t: t + (rng() - 0.5) * 0.12, angle });
      }
    }
  }
  if (generation === 3 && record.legs.length < 3 && rng() < 0.5) record.legs.push({ t: 0.5, length: record.legs[0]?.length || 1 });
  record.spine = record.spine.map((n) => ({ ...n, r: n.r * 1.04 }));
  // Each generation looks a little bigger; its strengths come from its level.
  return atLevel({ ...sp, record: validateCreature(record), sizeJitter: (sp.sizeJitter || 1) * 1.03, generation }, sp.level || 1);
}

/**
 * The level a species asks for in a social move: one below its own level (so a creature of your
 * level is a fair match), never more than it can do itself, and at least 1.
 */
export const socialNeed = (sp, move) => Math.max(1, Math.min(5, (sp.level || 1) - 1, sp.abilities[move] || 1));
