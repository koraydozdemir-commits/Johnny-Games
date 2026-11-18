/**
 * Creature Stage parts: what each part does (abilities 0..5) and its original 3D model.
 *
 * Abilities follow Spore's split. Combat: bite, strike, charge, spit. Social: sing, dance, charm,
 * pose. Plus speed, health and sight. A creature's level in an ability is the best level any of its
 * parts gives (not a sum), so one good part decides it.
 *
 * Models are merged vertex-coloured meshes in a fixed convention: the attach point is the origin,
 * +x points outward from the body (forward for mouths), +y is up. The body builder orients them.
 */
import * as THREE from "three";
import { matrixOf, mergePieces, taperedTube } from "../gfx/geom-utils.js";

export const COMBAT = ["bite", "strike", "charge", "spit"];
export const SOCIAL = ["sing", "dance", "charm", "pose"];
export const ABILITY_INFO = {
  bite: { name: "Bite", icon: "🦷", kind: "combat" },
  strike: { name: "Strike", icon: "🗡", kind: "combat" },
  charge: { name: "Charge", icon: "💥", kind: "combat" },
  spit: { name: "Spit", icon: "💧", kind: "combat" },
  sing: { name: "Sing", icon: "🎵", kind: "social" },
  dance: { name: "Dance", icon: "💃", kind: "social" },
  charm: { name: "Charm", icon: "💗", kind: "social" },
  pose: { name: "Pose", icon: "✨", kind: "social" },
};
/** Body stats that aren't moves you aim at someone. */
export const STAT_INFO = {
  speed: { name: "Speed", icon: "💨" },
  health: { name: "Health", icon: "❤" },
  sight: { name: "Sight", icon: "👁" },
  hearing: { name: "Hearing", icon: "👂" },
  sneak: { name: "Sneak", icon: "👣" },
  jump: { name: "Jump", icon: "⤒" },
  glide: { name: "Glide", icon: "🕊" },
};
/** Icon for any ability or stat key. */
export const abilityIcon = (k) => ABILITY_INFO[k]?.icon || STAT_INFO[k]?.icon || "•";

/**
 * slot: where it attaches. mouth = head tip (one only) · eye = upper head, mirrored · side = flank,
 * mirrored · back = along the top · tail = rear tip · foot = end of every leg (one style per creature) ·
 * hand = end of an arm (each arm pair has its own; a foot can go on an arm too, as in Spore).
 */
export const CREATURE_PARTS = [
  // Mouths decide diet.
  { id: "beak", name: "Grazing Beak", slot: "mouth", diet: "plant", cost: 0, abilities: { sing: 1, bite: 1 }, desc: "A flat beak for fruit and leaves." },
  { id: "jaws", name: "Hunter Jaws", slot: "mouth", diet: "meat", cost: 0, abilities: { bite: 2 }, desc: "Sharp jaws for tearing meat." },
  { id: "snout", name: "Rooting Snout", slot: "mouth", diet: "omni", cost: 0, abilities: { bite: 1, sing: 1 }, desc: "Eats anything, does a bit of everything." },
  { id: "fluteBeak", name: "Flute Beak", slot: "mouth", diet: "plant", cost: 15, abilities: { sing: 3, bite: 1 }, desc: "A long hollow beak that carries a melody." },
  { id: "trunk", name: "Curling Trunk", slot: "mouth", diet: "plant", cost: 24, abilities: { sing: 4, charm: 2, bite: 1 }, desc: "A trumpeting trunk that strips branches bare." },
  { id: "tuskMaw", name: "Tusk Maw", slot: "mouth", diet: "meat", cost: 20, abilities: { bite: 4 }, desc: "Heavy tusks. Few things survive a second bite." },
  { id: "mandibles", name: "Mandibles", slot: "mouth", diet: "meat", cost: 26, abilities: { bite: 5, strike: 1 }, desc: "Insect pincer-jaws that scissor shut." },
  { id: "crusher", name: "Crusher Snout", slot: "mouth", diet: "omni", cost: 18, abilities: { bite: 3, sing: 2 }, desc: "A broad snout with grinding plates." },
  { id: "sawBeak", name: "Saw Beak", slot: "mouth", diet: "omni", cost: 24, abilities: { bite: 3, spit: 2, sing: 2 }, desc: "A serrated beak that can hawk up a glob." },
  // Senses.
  { id: "eyes", name: "Round Eyes", slot: "eye", cost: 0, abilities: { sight: 1 }, desc: "Simple eyes." },
  { id: "stalkEyes", name: "Stalk Eyes", slot: "eye", cost: 10, abilities: { sight: 3, pose: 1 }, desc: "Eyes on stalks see danger sooner and look striking." },
  { id: "bugEyes", name: "Compound Eyes", slot: "eye", cost: 16, abilities: { sight: 4, sneak: 1 }, desc: "Faceted eyes that miss nothing." },
  { id: "doeEyes", name: "Doe Eyes", slot: "eye", cost: 14, abilities: { sight: 2, charm: 3 }, desc: "Big lashed eyes nobody can say no to." },
  { id: "antennae", name: "Antennae", slot: "eye", cost: 10, abilities: { sight: 2, charm: 1, sneak: 2, hearing: 2 }, desc: "Feelers that taste the air: creep up on anything, and feel anything creeping up on you." },
  { id: "ears", name: "Leaf Ears", slot: "eye", cost: 10, abilities: { sing: 2, charm: 1, sight: 1, hearing: 4 }, desc: "Big ears: pick up a tune, and hear hunters long before they reach you." },
  // Limbs.
  { id: "paw", name: "Paws", slot: "hand", cost: 0, abilities: { strike: 1, sneak: 1 }, desc: "Simple padded hands." },
  // Flanks: hands and arms.
  { id: "claws", name: "Claws", slot: "hand", cost: 10, abilities: { strike: 2, charm: 1 }, desc: "Curved claws for slashing." },
  { id: "pincers", name: "Pincers", slot: "hand", cost: 18, abilities: { strike: 4 }, desc: "Crushing pincers." },
  { id: "bladeArms", name: "Mantis Blades", slot: "hand", cost: 28, abilities: { strike: 5 }, desc: "Scythes that fold flat when at rest." },
  { id: "graspers", name: "Graspers", slot: "hand", cost: 12, abilities: { charm: 3, strike: 1 }, desc: "Gentle hands, good for grooming friends." },
  { id: "tentacles", name: "Tentacles", slot: "side", cost: 18, abilities: { charm: 2, dance: 3, sneak: 1 }, desc: "Swaying tendrils for a hypnotic dance." },
  { id: "venomSac", name: "Venom Sac", slot: "side", cost: 16, abilities: { spit: 3 }, desc: "Spits venom at a distance." },
  { id: "acidGland", name: "Acid Gland", slot: "side", cost: 28, abilities: { spit: 5 }, desc: "A pressurised gland that fires burning acid." },
  { id: "wings", name: "Little Wings", slot: "side", cost: 20, abilities: { dance: 2, speed: 1, glide: 3 }, desc: "Too small to fly, but they'll carry you a long way from a jump." },
  { id: "fanFins", name: "Fan Fins", slot: "side", cost: 14, abilities: { dance: 3, pose: 1, glide: 1 }, desc: "Leftover fins, now for showing off, and for a short glide." },
  // Back.
  { id: "spines", name: "Back Spines", slot: "back", cost: 8, abilities: { charge: 1, health: 1 }, desc: "A row of spines." },
  { id: "quills", name: "Quills", slot: "back", cost: 16, abilities: { health: 2, strike: 2 }, desc: "A bristling coat that hurts to bite." },
  { id: "horns", name: "Horns", slot: "back", cost: 14, abilities: { charge: 3 }, desc: "Lowered horns for a charging ram." },
  { id: "antlers", name: "Antlers", slot: "back", cost: 24, abilities: { charge: 4, pose: 2 }, desc: "Branching antlers, for rams and for rutting displays." },
  { id: "frill", name: "Display Frill", slot: "back", cost: 12, abilities: { pose: 3, charm: 1 }, desc: "A bright fan that opens for display." },
  { id: "sail", name: "Back Sail", slot: "back", cost: 22, abilities: { pose: 4, health: 1 }, desc: "A tall striped sail, impossible to ignore." },
  { id: "crest", name: "Song Crest", slot: "back", cost: 18, abilities: { sing: 3, pose: 2 }, desc: "A hollow crest that hums when air passes through." },
  { id: "glowOrbs", name: "Glow Orbs", slot: "back", cost: 20, abilities: { charm: 4, pose: 1 }, desc: "Soft lights that pulse to attract friends." },
  { id: "shell", name: "Shell Plates", slot: "back", cost: 15, abilities: { health: 3 }, desc: "Armour plates along the back." },
  { id: "plates", name: "Back Plates", slot: "back", cost: 16, abilities: { health: 2, pose: 2 }, desc: "Tall bony plates in a staggered row." },
  { id: "knobs", name: "Knobs", slot: "back", cost: 6, abilities: { pose: 1, health: 1 }, desc: "Rounded bumps, just for looks. Mostly." },
  // Tail.
  { id: "tailClub", name: "Tail Club", slot: "tail", cost: 14, abilities: { strike: 2, health: 1 }, desc: "A heavy club on the tail." },
  { id: "stinger", name: "Stinger", slot: "tail", cost: 22, abilities: { strike: 3, spit: 2 }, desc: "A curled stinger that drips venom." },
  { id: "plumeTail", name: "Plume Tail", slot: "tail", cost: 12, abilities: { dance: 3, pose: 1 }, desc: "A feathered tail made for dancing." },
  { id: "fanTail", name: "Peacock Fan", slot: "tail", cost: 26, abilities: { dance: 4, pose: 3 }, desc: "A spread of eye-spotted feathers." },
  { id: "rattleTail", name: "Rattle Tail", slot: "tail", cost: 16, abilities: { sing: 3, charm: 1 }, desc: "Shakes out a rhythm." },
  // Feet: one style for every leg.
  { id: "pads", name: "Soft Pads", slot: "foot", cost: 0, abilities: { speed: 1, dance: 1, sneak: 2 }, desc: "Quiet, springy feet for sneaking." },
  { id: "hooves", name: "Hooves", slot: "foot", cost: 12, abilities: { speed: 3, charge: 1, jump: 2 }, desc: "Hard hooves for running and leaping." },
  { id: "talons", name: "Talons", slot: "foot", cost: 14, abilities: { strike: 1, dance: 2, speed: 2, sneak: 2, jump: 2 }, desc: "Gripping talons for stalking and pouncing." },
  { id: "webbed", name: "Webbed Feet", slot: "foot", cost: 12, abilities: { speed: 2, dance: 2, health: 1, sneak: 1, jump: 1 }, desc: "Wide paddles, good on sand." },
  { id: "stompers", name: "Stompers", slot: "foot", cost: 20, abilities: { charge: 3, health: 2 }, desc: "Pillar feet that shake the ground." },
];
/**
 * The editor's part sections, in Spore's order. "limbs" also holds the leg- and arm-pair cards the
 * editor adds; "graspers" are hands, which go on the ends of arms.
 */
export const PART_SECTIONS = [
  ["mouth", "Mouths"],
  ["senses", "Eyes & Senses"],
  ["limbs", "Limbs"],
  ["graspers", "Graspers"],
  ["feet", "Feet"],
  ["weapons", "Weapons"],
  ["details", "Details"],
];
const SECTION_OF = {
  mouth: ["beak", "jaws", "snout", "fluteBeak", "trunk", "tuskMaw", "mandibles", "crusher", "sawBeak"],
  senses: ["eyes", "stalkEyes", "bugEyes", "doeEyes", "antennae", "ears"],
  limbs: ["wings", "fanFins", "tentacles"],
  graspers: ["paw", "graspers", "claws", "pincers", "bladeArms"],
  feet: ["pads", "hooves", "talons", "webbed", "stompers"],
  weapons: ["venomSac", "acidGland", "horns", "antlers", "spines", "quills", "stinger"],
  details: ["frill", "sail", "crest", "glowOrbs", "shell", "plates", "knobs", "tailClub", "plumeTail", "fanTail", "rattleTail"],
};
for (const [section, ids] of Object.entries(SECTION_OF)) for (const id of ids) CREATURE_PARTS.find((p) => p.id === id).section = section;
export const creaturePart = (id) => CREATURE_PARTS.find((p) => p.id === id) || null;
/** Can go on the end of an arm: any grasper, or a foot. */
export const fitsArm = (id) => ["hand", "foot"].includes(creaturePart(id)?.slot);
/** Older saves had arms as single parts; these are the hands they become. */
export const LEGACY_ARM_HANDS = { arm: "paw", claws: "claws", graspers: "graspers", pincers: "pincers", bladeArms: "bladeArms" };
/** What a pair of arms adds on its own, before any hand: arms to wave and to hug with. */
export const ARM_ABILITIES = { dance: 1, charm: 1 };

/** Starting parts on land: the mouth of the cell's diet, eyes and pads. Everything else is found. */
export const STARTER_CREATURE_PARTS = { plant: ["beak", "eyes", "pads"], meat: ["jaws", "eyes", "pads"], omni: ["snout", "eyes", "pads"] };

/** Ability levels for a set of part ids: the best level per ability, capped at 5. */
export function abilitiesOf(partIds, legPairs = 2, armPairs = 0) {
  const out = { bite: 0, strike: 0, charge: 0, spit: 0, sing: 0, dance: 0, charm: 0, pose: 0, speed: 0, health: 0, sight: 0, hearing: 0, sneak: 0, jump: 0, glide: 0 };
  for (const id of partIds) {
    const p = creaturePart(id);
    if (!p) continue;
    for (const [k, v] of Object.entries(p.abilities)) out[k] = Math.min(5, Math.max(out[k], v));
  }
  if (armPairs > 0) for (const [k, v] of Object.entries(ARM_ABILITIES)) out[k] = Math.max(out[k], v);
  // Every creature can do a little of everything with its body alone.
  out.charge = Math.max(out.charge, 1);
  out.dance = Math.max(out.dance, legPairs > 0 ? 1 : 0);
  out.pose = Math.max(out.pose, 1);
  out.hearing = Math.max(out.hearing, 1); // everyone hears a little
  out.sing = Math.max(out.sing, 1);
  out.jump = legPairs > 0 ? Math.max(out.jump, 1) : 0; // anything with legs can hop
  return out;
}
export const dietOfParts = (partIds) => creaturePart(partIds.find((id) => creaturePart(id)?.slot === "mouth"))?.diet || "omni";

/* ---- Models --------------------------------------------------------------- */

const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
/** Colour that runs from `base` to `tip` along x (piece space), for horns, claws and beaks. */
const gradX = (base, tip, x0, x1) => (x) => mix(base, tip, THREE.MathUtils.clamp((x - x0) / (x1 - x0), 0, 1));
const gradY = (base, tip, y0, y1) => (x, y) => mix(base, tip, THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1));
/** A thin flat piece (fin, wing, web) that is visible from both sides. */
const flat = (shape, depth = 0.018) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -depth / 2);
/** A smooth beak/snout shape along +x from a lathe profile of [radius, length] pairs. */
// Profiles run root to tip; the lathe wants them the other way round to face outward.
const lathe = (profile, seg = 18) => new THREE.LatheGeometry(profile.map(([r, l]) => new THREE.Vector2(r, l)).reverse(), seg).rotateZ(-Math.PI / 2);
/** A curved, tapering horn/claw from points, with a gradient from root to tip. */
const curved = (pts, r0, r1, base, tip, o = {}) => ({
  geometry: taperedTube(
    pts.map(([x, y, z = 0]) => new THREE.Vector3(x, y, z)),
    (t) => r0 + (r1 - r0) * t,
    { radial: o.radial || 10, segments: o.segments || 14, swayAmp: o.sway || 0 },
  ),
  colorAt: gradX(base, tip, pts[0][0], pts.at(-1)[0] || 0.001),
  swayMax: o.sway || undefined,
});
const sphere = (r, color, m, seg = 16) => ({ geometry: new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), color, matrix: matrixOf(m || {}) });
/** Every head part has a fleshy socket so it blends into the body. */
const socket = (c, r = 0.21) => sphere(r, shade(c, 0.88), { sx: 0.6 });
/** A glossy eye: white, coloured iris, pupil and a highlight. */
const eyeball = (r, iris, m = {}) => [
  sphere(r, 0xfbfbf6, m),
  sphere(r * 0.62, iris, { ...m, x: (m.x || 0) + r * 0.52, sx: 0.5 }),
  sphere(r * 0.34, 0x0d0d10, { ...m, x: (m.x || 0) + r * 0.72, sx: 0.4 }),
  sphere(r * 0.14, 0xffffff, { ...m, x: (m.x || 0) + r * 0.86, y: (m.y || 0) + r * 0.3, z: (m.z || 0) + r * 0.2 }, 8),
];

/** A finger: a tapering tube that curls down (-y) toward its tip. */
const finger = (z, len, r, base, tip, spread = 0) =>
  curved(
    [
      [0, 0, z],
      [len * 0.45, -len * 0.05, z + spread * 0.5],
      [len * 0.85, -len * 0.3, z + spread],
      [len, -len * 0.55, z + spread],
    ],
    r,
    r * 0.55,
    base,
    tip,
  );
/** Upper eyelid in the body's colour, drawn half-lowered over the eye (for part thumbnails). */
const lid = (c, r, m = {}) => ({
  geometry: new THREE.SphereGeometry(r * 1.08, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(0.42),
  color: shade(c, 0.95),
  matrix: matrixOf(m),
});
const MODELS = {
  /* Mouths */
  beak: (c) => [
    { geometry: lathe([[0, 0.5], [0.06, 0.42], [0.15, 0.25], [0.2, 0.05], [0.18, 0]]), colorAt: gradX(0xe0a64a, 0xffd88a, 0, 0.5), matrix: matrixOf({ y: 0.05, sy: 0.7 }) },
    { geometry: lathe([[0, 0.38], [0.1, 0.22], [0.16, 0.04], [0.14, 0]]), colorAt: gradX(0xc58a35, 0xf0c070, 0, 0.38), matrix: matrixOf({ y: -0.08, sy: 0.5 }) },
    socket(c),
  ],
  fluteBeak: (c) => [
    { geometry: lathe([[0.06, 0.9], [0.05, 0.6], [0.08, 0.3], [0.16, 0.06], [0.15, 0]]), colorAt: gradX(0xe9b85c, 0xfff0b8, 0, 0.9) },
    { geometry: new THREE.TorusGeometry(0.075, 0.025, 8, 16).rotateY(Math.PI / 2), color: 0xffe6a8, matrix: matrixOf({ x: 0.9 }) },
    ...[0.35, 0.5, 0.65].map((x) => sphere(0.025, 0x6a4a20, { x, y: 0.065 }, 8)),
    socket(c),
  ],
  trunk: (c) => [
    { ...curved([[0, 0], [0.3, -0.02], [0.55, -0.12], [0.68, -0.32], [0.62, -0.46]], 0.15, 0.06, shade(c, 0.95), shade(c, 0.75), { segments: 18 }) },
    { geometry: new THREE.TorusGeometry(0.06, 0.02, 8, 14), color: shade(c, 0.6), matrix: matrixOf({ x: 0.6, y: -0.48, rx: Math.PI / 2 }) },
    socket(c, 0.24),
  ],
  jaws: (c) => {
    const pieces = [
      { geometry: lathe([[0.04, 0.5], [0.14, 0.4], [0.2, 0.15], [0.2, 0]]), colorAt: gradX(shade(c, 0.85), 0x8f3b3b, 0, 0.5), matrix: matrixOf({ y: 0.06, sy: 0.55 }) },
      { geometry: lathe([[0.03, 0.44], [0.12, 0.35], [0.17, 0.1], [0.17, 0]]), colorAt: gradX(shade(c, 0.7), 0x6e2a2c, 0, 0.44), matrix: matrixOf({ y: -0.1, sy: 0.45 }) },
      socket(c, 0.23),
    ];
    for (let i = 0; i < 5; i++)
      for (const side of [-1, 1]) pieces.push({ geometry: new THREE.ConeGeometry(0.025, 0.1, 6).rotateZ(Math.PI), color: 0xfff6e0, matrix: matrixOf({ x: 0.1 + i * 0.075, y: 0.0, z: side * (0.13 - i * 0.02) }) });
    return pieces;
  },
  tuskMaw: (c) => [
    { geometry: lathe([[0.06, 0.52], [0.2, 0.4], [0.25, 0.1], [0.24, 0]]), colorAt: gradX(shade(c, 0.75), 0x5e2424, 0, 0.52), matrix: matrixOf({ sy: 0.7 }) },
    ...[-1, 1].map((z) => curved([[0.3, -0.05, z * 0.17], [0.5, 0.0, z * 0.22], [0.62, 0.16, z * 0.2], [0.6, 0.3, z * 0.14]], 0.055, 0.008, 0xf2e3c0, 0xffffff)),
    socket(c, 0.26),
  ],
  mandibles: (c) => [
    sphere(0.2, shade(c, 0.6), { x: 0.1, sx: 0.9, sy: 0.7 }),
    ...[-1, 1].map((z) => curved([[0.12, 0, z * 0.12], [0.35, 0, z * 0.2], [0.52, 0, z * 0.12], [0.58, 0, -z * 0.02]], 0.05, 0.01, 0x4a2a1c, 0xc98a4a, { segments: 16 })),
    ...[-1, 1].map((z) => curved([[0.18, -0.08, z * 0.06], [0.3, -0.2, z * 0.1], [0.36, -0.3, z * 0.08]], 0.025, 0.008, 0x3a2216, 0x8a5a30)),
    socket(c, 0.22),
  ],
  snout: (c) => [
    { geometry: lathe([[0.15, 0.4], [0.17, 0.3], [0.18, 0.1], [0.2, 0]]), color: shade(c, 0.92) },
    sphere(0.15, 0xd98a8a, { x: 0.4, sx: 0.4 }),
    ...[-1, 1].map((z) => sphere(0.035, 0x3a1a1a, { x: 0.46, y: 0.02, z: z * 0.06 }, 8)),
  ],
  crusher: (c) => [
    { geometry: lathe([[0.2, 0.44], [0.24, 0.3], [0.26, 0.1], [0.27, 0]]), color: shade(c, 0.82) },
    { geometry: new THREE.CylinderGeometry(0.17, 0.17, 0.06, 18).rotateZ(Math.PI / 2), color: 0xe8dfc8, matrix: matrixOf({ x: 0.46, sz: 1.3 }) },
    ...[-0.12, 0, 0.12].map((z) => ({ geometry: new THREE.BoxGeometry(0.05, 0.06, 0.08), color: 0xbfb49a, matrix: matrixOf({ x: 0.5, y: -0.08, z }) })),
  ],
  sawBeak: (c) => {
    const pieces = [{ geometry: lathe([[0, 0.62], [0.08, 0.5], [0.16, 0.25], [0.2, 0.05], [0.19, 0]]), colorAt: gradX(0x8a9aa0, 0xdfe8ea, 0, 0.62), matrix: matrixOf({ sy: 0.6 }) }, socket(c)];
    for (let i = 0; i < 6; i++) pieces.push({ geometry: new THREE.ConeGeometry(0.03, 0.08, 4), color: 0xf6f8f8, matrix: matrixOf({ x: 0.1 + i * 0.08, y: 0.1 - i * 0.012 }) });
    pieces.push(sphere(0.07, 0x9be36b, { x: 0.02, y: -0.16, sx: 1.3 }));
    return pieces;
  },
  /* Eyes */
  eyes: (c) => [...eyeball(0.16, 0x5f9a3c), lid(c, 0.16)],
  stalkEyes: (c) => [
    curved([[0, 0], [0.06, 0.18], [0.12, 0.34]], 0.05, 0.03, shade(c, 0.85), shade(c, 1.05)),
    ...eyeball(0.14, 0xd2a020, { x: 0.14, y: 0.42 }),
    lid(c, 0.14, { x: 0.14, y: 0.42 }),
  ],
  bugEyes: () => [
    {
      geometry: new THREE.IcosahedronGeometry(0.17, 2),
      colorAt: (x, y, z, k) => mix(0x2a1440, 0xb05ae0, ((k * 7) % 5) / 5).lerp(new THREE.Color(0x7ad8ff), Math.max(0, y) * 2),
      matrix: matrixOf({ x: 0.04, sx: 0.85 }),
    },
  ],
  doeEyes: (c) => [
    ...eyeball(0.19, 0x8a5a2a),
    lid(c, 0.19),
    { geometry: new THREE.TorusGeometry(0.17, 0.022, 6, 18, Math.PI).rotateY(Math.PI / 2), color: 0x2a1a14, matrix: matrixOf({ x: 0.07 }) },
    ...[-0.6, 0, 0.6].map((a) => ({ geometry: new THREE.ConeGeometry(0.012, 0.1, 4), color: 0x1a1210, matrix: matrixOf({ x: 0.1, y: 0.16, z: a * 0.12, rz: -0.5 }) })),
  ],
  antennae: () =>
    [-1, 1].flatMap((s) => [
      curved([[0, 0, s * 0.05], [0.08, 0.25, s * 0.12], [0.22, 0.45, s * 0.2]], 0.022, 0.014, 0x3a2a30, 0x6a4a5a, { sway: 0.03 }),
      sphere(0.05, 0xffb04a, { x: 0.22, y: 0.46, z: s * 0.2 }, 10),
    ]),
  ears: (c) =>
    [-1, 1].map((s) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.12, 0.1, 0.16, 0.34, 0.04, 0.5);
      shape.bezierCurveTo(-0.06, 0.32, -0.08, 0.12, 0, 0);
      return { geometry: flat(shape, 0.03), colorAt: (x, y) => mix(shade(c, 0.85), 0xffb0a8, Math.max(0, y - 0.1) * 1.6), matrix: matrixOf({ z: s * 0.08, rx: s * 0.4 }) };
    }),
  /* Hands: drawn from the wrist along +x, palm down (-y). They go on the ends of arms. */
  paw: (c) => [
    sphere(0.085, shade(c, 1.02), { x: 0.07, sx: 1.15, sy: 0.7, sz: 1.05 }),
    ...[-1, 0, 1].map((i) => sphere(0.042, shade(c, 1.08), { x: 0.16, y: -0.015, z: i * 0.055, sx: 1.2, sy: 0.85 }, 10)),
    ...[-1, 0, 1].map((i) => sphere(0.022, 0xe9a3a0, { x: 0.18, y: -0.045, z: i * 0.055, sy: 0.5 }, 8)),
  ],
  graspers: (c) => [
    sphere(0.08, shade(c, 1.04), { x: 0.06, sx: 1.1, sy: 0.75, sz: 1.2 }),
    ...[-1, 0, 1].map((i) => finger(i * 0.05, 0.2, 0.026, shade(c, 1.04), 0xffc4b0, i * 0.03)),
    // An opposable thumb, out to one side.
    curved([[0.04, 0, 0.07], [0.1, -0.01, 0.12], [0.16, -0.06, 0.12]], 0.026, 0.016, shade(c, 1.04), 0xffc4b0),
  ],
  claws: (c) => [
    sphere(0.08, shade(c, 0.9), { x: 0.06, sx: 1.1, sy: 0.8 }),
    ...[-1, 0, 1].map((i) => finger(i * 0.055, 0.24, 0.03, 0xd8ccb0, 0xffffff, i * 0.025)),
  ],
  pincers: () => [
    sphere(0.12, 0xc4553b, { x: 0.12, sx: 1.35, sy: 0.85 }),
    curved([[0.22, 0.04], [0.36, 0.1], [0.48, 0.06], [0.54, -0.02]], 0.06, 0.012, 0xd8664a, 0xf2a080),
    curved([[0.22, -0.05], [0.34, -0.1], [0.44, -0.06]], 0.045, 0.01, 0xb04a32, 0xe08a6a),
    ...[0.28, 0.36, 0.44].map((x) => sphere(0.016, 0xfff0e0, { x, y: 0.04 }, 6)),
  ],
  bladeArms: (c) => [
    sphere(0.075, shade(c, 0.8), { x: 0.04 }),
    {
      geometry: (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.03);
        shape.quadraticCurveTo(0.3, 0.06, 0.58, -0.14);
        shape.quadraticCurveTo(0.32, -0.02, 0, -0.04);
        return new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 10 });
      })(),
      colorAt: gradX(0x8aa4ac, 0xeaf6f8, 0, 0.58),
      matrix: matrixOf({ x: 0.05, z: -0.012 }),
    },
    ...[0.18, 0.28, 0.38].map((x) => ({ geometry: new THREE.ConeGeometry(0.014, 0.05, 4), color: 0xf6fbfc, matrix: matrixOf({ x, y: -0.045 - x * 0.08, rz: Math.PI }) })),
  ],
  tentacles: (c) => [0, 1, 2].map((i) => curved([[0, 0, (i - 1) * 0.06], [0.2, -0.1, (i - 1) * 0.1], [0.4, -0.05, (i - 1) * 0.14], [0.58, -0.2, (i - 1) * 0.12]], 0.05, 0.012, shade(c, 0.9), 0xff8fc0, { sway: 0.07, segments: 16 })),
  venomSac: () => [
    { geometry: new THREE.SphereGeometry(0.17, 18, 14), colorAt: (x, y) => mix(0x5fae45, 0xc8ff8a, (y + 0.17) / 0.34), matrix: matrixOf({ x: 0.1, sy: 0.85 }) },
    curved([[0.24, 0], [0.34, 0.02], [0.42, 0.0]], 0.05, 0.015, 0x4f9a3a, 0x8be36b),
  ],
  acidGland: () => [
    { geometry: new THREE.SphereGeometry(0.2, 18, 14), colorAt: (x, y, z, k) => mix(0xd8ff4a, 0xffa020, ((k * 13) % 7) / 7), matrix: matrixOf({ x: 0.12, sx: 1.15 }) },
    ...[0, 1, 2].map((i) => ({ geometry: new THREE.TorusGeometry(0.2, 0.018, 6, 18), color: 0x6a5a20, matrix: matrixOf({ x: 0.02 + i * 0.1, ry: Math.PI / 2, sx: 1 - i * 0.12, sy: 1 - i * 0.12 }) })),
    curved([[0.34, 0], [0.48, 0.03], [0.56, 0.0]], 0.06, 0.02, 0x8a7a30, 0xd8ff4a),
  ],
  wings: () => [
    {
      geometry: (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.bezierCurveTo(0.15, 0.35, 0.45, 0.4, 0.6, 0.15);
        shape.bezierCurveTo(0.45, 0.12, 0.3, -0.05, 0, 0);
        return flat(shape, 0.015);
      })(),
      colorAt: (x) => mix(0xe9f4ff, 0x9fd0ff, x / 0.6),
      matrix: matrixOf({ y: 0.05, rx: Math.PI / 2 }),
    },
  ],
  fanFins: (c) => [
    {
      geometry: (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.absarc(0, 0, 0.36, -0.7, 0.7, false);
        shape.lineTo(0, 0);
        return flat(shape, 0.014);
      })(),
      colorAt: (x, y) => mix(shade(c, 0.9), 0x7fd3ff, Math.hypot(x, y) / 0.36),
      matrix: matrixOf({ rx: Math.PI / 2 }),
    },
    ...[-0.5, -0.17, 0.17, 0.5].map((a) => ({ geometry: new THREE.CylinderGeometry(0.01, 0.014, 0.34, 5).rotateZ(-Math.PI / 2).translate(0.17, 0, 0).rotateY(-a), color: shade(c, 0.6) })),
  ],
  /* Back */
  spines: () => [0, 1, 2].map((i) => curved([[0, (i - 1) * 0.16], [0.18, (i - 1) * 0.16 - 0.04], [0.32, (i - 1) * 0.16 - 0.1]], 0.06, 0.004, 0xd8ccb0, 0xffffff)),
  quills: () =>
    Array.from({ length: 9 }, (_, i) => {
      const y = ((i % 3) - 1) * 0.12,
        z = (Math.floor(i / 3) - 1) * 0.1;
      return curved([[0, y, z], [0.2, y - 0.08, z * 1.4], [0.38, y - 0.2, z * 1.8]], 0.022, 0.003, 0x7a5a40, 0xfaf2de);
    }),
  horns: () => [-1, 1].map((s) => curved([[0, 0, s * 0.1], [0.2, 0.1, s * 0.18], [0.36, 0.28, s * 0.2], [0.4, 0.46, s * 0.14]], 0.08, 0.01, 0xb8a888, 0xfff8e8)),
  antlers: () =>
    [-1, 1].flatMap((s) => [
      curved([[0, 0, s * 0.08], [0.25, -0.05, s * 0.2], [0.5, 0.05, s * 0.32], [0.7, 0.2, s * 0.36]], 0.05, 0.015, 0x6a5038, 0xd8c8a8),
      curved([[0.3, -0.03, s * 0.22], [0.42, 0.12, s * 0.28], [0.5, 0.26, s * 0.26]], 0.03, 0.008, 0x8a6a48, 0xe8d8b8),
      curved([[0.52, 0.06, s * 0.32], [0.62, -0.06, s * 0.42], [0.7, -0.12, s * 0.48]], 0.028, 0.008, 0x8a6a48, 0xe8d8b8),
    ]),
  // A sail-like fan standing up along the spine, so it reads from the side.
  frill: (c) => [
    { geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24, 1, false, 0, Math.PI).rotateX(Math.PI / 2), colorAt: (x, y) => mix(0xff6f9a, 0xffe08a, Math.hypot(x, y) / 0.4), matrix: matrixOf({ x: 0.02 }) },
    { geometry: new THREE.TorusGeometry(0.4, 0.022, 6, 24, Math.PI), color: shade(c, 0.6), matrix: matrixOf({ x: 0.02, rz: -Math.PI / 2 }) },
    ...[-1.2, -0.6, 0, 0.6, 1.2].map((a) => ({ geometry: new THREE.CylinderGeometry(0.01, 0.016, 0.4, 5), color: shade(c, 0.55), matrix: matrixOf({ x: 0.02 + Math.cos(a) * 0.2, y: Math.sin(a) * 0.2, rz: a - Math.PI / 2 }) })),
  ],
  sail: (c) => [
    {
      geometry: (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.4);
        shape.bezierCurveTo(0.5, -0.35, 0.7, 0.1, 0.55, 0.45);
        shape.lineTo(0, 0.4);
        return new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -0.01).rotateZ(0);
      })(),
      colorAt: (x, y) => (Math.floor((y + 0.4) * 9) % 2 ? mix(0xf08a3a, 0xffd06a, x / 0.7) : mix(shade(c, 0.6), 0xd05a2a, x / 0.7)),
    },
    ...[-0.25, -0.05, 0.15, 0.32].map((y) => {
      const len = 0.12 + 0.48 * ((y + 0.4) / 0.85);
      return { geometry: new THREE.CylinderGeometry(0.01, 0.018, len, 5).rotateZ(-Math.PI / 2), color: shade(c, 0.5), matrix: matrixOf({ x: len / 2, y, z: 0.012 }) };
    }),
  ],
  crest: (c) => [
    curved([[0, 0], [0.25, -0.1], [0.45, -0.3], [0.5, -0.5]], 0.12, 0.05, shade(c, 0.9), 0x7fd3ff, { segments: 16 }),
    { geometry: new THREE.TorusGeometry(0.05, 0.015, 6, 12), color: 0x2a4a6a, matrix: matrixOf({ x: 0.5, y: -0.52, rx: Math.PI / 2 }) },
  ],
  glowOrbs: () =>
    [0, 1, 2].flatMap((i) => [
      curved([[0, (i - 1) * 0.18], [0.16, (i - 1) * 0.2], [0.3, (i - 1) * 0.24]], 0.02, 0.012, 0x3a5a4a, 0x6aa080, { sway: 0.04 }),
      sphere(0.075, [0xaaffee, 0xffe6a0, 0xffa8e8][i], { x: 0.33, y: (i - 1) * 0.24 }),
    ]),
  shell: () =>
    [0, 1, 2].map((i) => ({
      geometry: new THREE.SphereGeometry(0.24, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      colorAt: (x, y, z) => mix(0x6e5a3e, 0xc8b088, Math.abs(Math.sin(Math.hypot(x, z) * 30))),
      matrix: matrixOf({ y: (i - 1) * 0.32, sx: 0.4 }).premultiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)),
    })),
  plates: (c) =>
    [-0.32, -0.1, 0.12, 0.32].map((y, i) => {
      const h = 0.28 + (1 - Math.abs(y) * 2) * 0.16;
      const shape = new THREE.Shape();
      shape.moveTo(0, -0.1);
      shape.lineTo(h * 0.7, -0.08);
      shape.lineTo(h, 0);
      shape.lineTo(h * 0.7, 0.08);
      shape.lineTo(0, 0.1);
      return { geometry: flat(shape, 0.035), colorAt: (x) => mix(shade(c, 0.7), 0xe8b060, x / h), matrix: matrixOf({ y, z: (i % 2 ? 1 : -1) * 0.05 }) };
    }),
  knobs: (c) => [-0.2, 0, 0.2].map((y, i) => sphere(0.09 + (i === 1 ? 0.03 : 0), [0xffb04a, 0xff7a6a, 0xffd06a][i], { x: 0.02, y, sx: 0.8 }, 14)).concat([sphere(0.05, shade(c, 0.7), { x: 0.0, y: 0.32 }, 10)]),
  /* Tails */
  tailClub: (c) => [
    curved([[0, 0], [0.22, 0.02], [0.4, 0]], 0.08, 0.05, shade(c, 0.9), shade(c, 0.75)),
    { geometry: new THREE.IcosahedronGeometry(0.18, 1), colorAt: (x, y, z, k) => mix(0x6f5b45, 0x9f8a6a, (k % 3) / 3), matrix: matrixOf({ x: 0.5 }) },
    ...[0, 1, 2, 3].map((i) => ({ geometry: new THREE.ConeGeometry(0.035, 0.12, 5), color: 0xe8dcc0, matrix: matrixOf({ x: 0.5 + Math.cos(i * 1.57) * 0.16, y: Math.sin(i * 1.57) * 0.16, rz: i * 1.57 - Math.PI / 2 }) })),
  ],
  stinger: (c) => [
    curved([[0, 0], [0.25, 0.05], [0.42, 0.22], [0.42, 0.42], [0.3, 0.52]], 0.08, 0.04, shade(c, 0.9), 0x5a3a6a, { segments: 18 }),
    sphere(0.07, 0x7a4a8a, { x: 0.3, y: 0.52 }),
    curved([[0.28, 0.54], [0.2, 0.5], [0.14, 0.42]], 0.035, 0.003, 0x2a1a2a, 0xe8e0f0),
  ],
  plumeTail: () =>
    [0, 1, 2, 3, 4].map((i) => {
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, (i - 2) * 0.07, (i % 2) * 0.03), new THREE.Vector3(0.65, (i - 2) * 0.18, 0)];
      return {
        geometry: taperedTube(pts, (t) => 0.03 * (1 - t * 0.5) + 0.05 * Math.sin(t * Math.PI), { radial: 8, segments: 14, swayAmp: 0.08 }),
        color: [0xff6fa0, 0xffb347, 0xffe36a, 0x7fd3ff, 0xb48bff][i],
        colorTip: 0xffffff,
        swayMax: 0.08,
      };
    }),
  fanTail: () =>
    Array.from({ length: 7 }, (_, i) => {
      const a = (i - 3) * 0.28;
      return [
        curved([[0, 0], [0.35 * Math.cos(a), 0.35 * Math.sin(a) + 0.1], [0.6 * Math.cos(a), 0.6 * Math.sin(a) + 0.25]], 0.012, 0.01, 0x2a6a5a, 0x4ab0a0, { sway: 0.04 }),
        sphere(0.07, 0x2fb08a, { x: 0.6 * Math.cos(a), y: 0.6 * Math.sin(a) + 0.25, sz: 0.3 }),
        sphere(0.035, 0x1a2a8a, { x: 0.6 * Math.cos(a) + 0.01, y: 0.6 * Math.sin(a) + 0.25, sz: 0.4 }, 8),
      ];
    }).flat(),
  rattleTail: (c) => [
    curved([[0, 0], [0.2, 0.02], [0.32, 0.0]], 0.07, 0.05, shade(c, 0.9), shade(c, 0.8)),
    ...[0, 1, 2, 3].map((i) => ({ geometry: new THREE.SphereGeometry(0.07 - i * 0.01, 12, 8), color: i % 2 ? 0xd8c8a0 : 0xb8a07a, matrix: matrixOf({ x: 0.36 + i * 0.08, sx: 0.6 }) })),
  ],
  /* Feet */
  pads: () => [sphere(0.16, 0x5a4a3c, { x: 0.06, sy: 0.4 }), ...[-1, 0, 1].map((i) => sphere(0.05, 0x3a2e26, { x: 0.18, y: -0.03, z: i * 0.07, sy: 0.6 }, 8))],
  hooves: () => [
    { geometry: new THREE.CylinderGeometry(0.12, 0.16, 0.16, 16), colorAt: gradY(0x1f1a16, 0x5a4a3c, -0.08, 0.08), matrix: matrixOf({ y: 0.02 }) },
    { geometry: new THREE.BoxGeometry(0.02, 0.16, 0.2), color: 0x15110e, matrix: matrixOf({ x: 0.13, y: 0.02 }) },
  ],
  talons: () => [-1, 0, 1].map((i) => curved([[0, 0.02, i * 0.04], [0.14, 0.0, i * 0.08], [0.24, -0.06, i * 0.1]], 0.035, 0.004, 0x5a4a3a, 0x1a1512)),
  webbed: () => [
    {
      geometry: (() => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.absarc(0, 0, 0.22, -0.8, 0.8, false);
        shape.lineTo(0, 0);
        return flat(shape, 0.02).rotateX(-Math.PI / 2);
      })(),
      colorAt: (x) => mix(0x6a8a4a, 0xa8c86a, x / 0.22),
    },
    ...[-0.6, 0, 0.6].map((a) => curved([[0, 0.01, 0], [0.1 * Math.cos(a), 0.01, -0.1 * Math.sin(a)], [0.22 * Math.cos(a), 0.0, -0.22 * Math.sin(a)]], 0.018, 0.008, 0x4a6a3a, 0x3a5a2a)),
  ],
  stompers: () => [
    { geometry: new THREE.CylinderGeometry(0.2, 0.24, 0.18, 18), colorAt: gradY(0x3a3028, 0x6a5848, -0.09, 0.09), matrix: matrixOf({ y: 0.04 }) },
    ...[-1, 0, 1].map((i) => sphere(0.06, 0xe8dcc0, { x: 0.2, y: 0.0, z: i * 0.1, sx: 0.8, sy: 0.6 }, 10)),
  ],
};

const modelCache = new Map();
/** A part's model geometry (shared, cached per colour). */
export function partGeometry(id, bodyColor = 0x7fb0d0) {
  const key = id + ":" + bodyColor;
  if (!modelCache.has(key)) {
    const build = MODELS[id];
    const g = mergePieces(build ? build(bodyColor) : [{ geometry: new THREE.SphereGeometry(0.12, 8, 6), color: 0xff00ff }]);
    g.userData.shared = true;
    modelCache.set(key, g);
  }
  return modelCache.get(key);
}
export const PART_MODELS = MODELS; // read-only: for tests and dev tools
