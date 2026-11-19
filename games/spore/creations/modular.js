/**
 * Parts for the modular editors: buildings and vehicles (Civilization Stage) and spaceships (Space
 * Stage). One shared shape: each part is a simple solid with a size, a colour slot and what it adds to
 * the design's statistics. A design's stats come only from its parts and its role, so design really
 * changes play: armour makes a tank tougher and slower, more engines make a ship faster, and so on.
 */

/**
 * shape: box · cyl · cone · sphere · dome · torus · wheel · prism · wing · capsule · disc · ring
 * size: [width, height, depth] at scale 1 · paint: base | accent | trim | glass | metal
 * cat: the palette tab it appears under · add: stats it contributes
 */
const P = (id, name, cat, shape, size, paint, add = {}, extra = {}) => ({ id, name, cat, shape, size, paint, add, ...extra });

export const BUILDING_PARTS = [
  P("block", "Block", "Body", "box", [2, 2, 2], "base", { volume: 8 }),
  P("wing", "Wing", "Body", "box", [3, 1.4, 1.6], "base", { volume: 6.7 }),
  P("tower", "Tower", "Body", "cyl", [1.2, 3.2, 1.2], "base", { volume: 3.6 }),
  P("round", "Rotunda", "Body", "cyl", [2.4, 1.6, 2.4], "base", { volume: 7.2 }),
  P("wall", "Wall", "Body", "box", [3, 1.2, 0.3], "trim", { volume: 1 }),
  P("base", "Foundation", "Body", "box", [3.4, 0.4, 3.4], "trim", { volume: 4.6 }),
  P("roof", "Pitched roof", "Roof", "prism", [2.2, 1.1, 2.2], "accent", { beauty: 1 }),
  P("dome", "Dome", "Roof", "dome", [2.2, 1.1, 2.2], "accent", { beauty: 2 }),
  P("spire", "Spire", "Roof", "cone", [0.9, 2.2, 0.9], "accent", { beauty: 2 }),
  P("flat", "Flat roof", "Roof", "box", [2.3, 0.25, 2.3], "trim", { beauty: 0.5 }),
  P("column", "Column", "Detail", "cyl", [0.35, 2, 0.35], "trim", { beauty: 1 }),
  P("arch", "Arch", "Detail", "torus", [1.6, 1.6, 0.3], "trim", { beauty: 1.5 }),
  P("windows", "Window band", "Detail", "box", [2.1, 0.35, 2.1], "glass", { beauty: 1 }),
  P("chimney", "Chimney", "Detail", "cyl", [0.4, 1.4, 0.4], "metal", { industry: 1 }),
  P("bell", "Bell", "Detail", "dome", [0.8, 0.6, 0.8], "metal", { faith: 1 }),
  P("statue", "Statue", "Detail", "capsule", [0.6, 1.4, 0.6], "accent", { beauty: 2 }),
  P("banner", "Banner", "Detail", "box", [0.8, 1.2, 0.08], "accent", { beauty: 1 }),
  P("antenna", "Antenna", "Detail", "cyl", [0.12, 1.8, 0.12], "metal", { tech: 1 }),
  P("cannon", "Cannon", "Defence", "cyl", [0.4, 1.6, 0.4], "metal", { defence: 2 }, { rx: Math.PI / 2 }),
  P("battlement", "Battlements", "Defence", "box", [2.4, 0.5, 2.4], "trim", { defence: 1 }),
];

export const VEHICLE_PARTS = [
  P("body", "Car body", "Chassis", "box", [1.6, 0.7, 2.6], "base", { mass: 3, health: 3 }, { chassis: true }),
  P("hull", "Boat hull", "Chassis", "capsule", [1.4, 0.8, 3.2], "base", { mass: 3, health: 3, float: 1 }, { chassis: true, rx: Math.PI / 2 }),
  P("fuselage", "Fuselage", "Chassis", "capsule", [0.9, 0.9, 3.4], "base", { mass: 2, health: 2 }, { chassis: true, rx: Math.PI / 2 }),
  P("cabin", "Cabin", "Chassis", "box", [1.2, 0.7, 1.2], "glass", { mass: 1 }),
  P("cockpit", "Cockpit", "Chassis", "dome", [1.1, 0.6, 1.1], "glass", { mass: 0.5, health: 1, crew: 1 }),
  P("wheel", "Wheel", "Move", "wheel", [0.8, 0.8, 0.3], "trim", { land: 1, speed: 1 }),
  P("tread", "Tread", "Move", "box", [0.5, 0.6, 2.6], "trim", { land: 1.5, speed: 0.5, health: 1 }),
  P("propeller", "Propeller", "Move", "torus", [0.7, 0.7, 0.15], "metal", { sea: 1, speed: 1 }),
  P("sail", "Sail", "Move", "box", [0.1, 2, 1.4], "accent", { sea: 0.6, speed: 0.6 }),
  P("wingPart", "Wing", "Move", "wing", [3, 0.15, 1.1], "accent", { air: 1, speed: 0.6 }),
  P("jet", "Jet engine", "Move", "cyl", [0.5, 1.2, 0.5], "metal", { air: 0.6, speed: 1.4 }, { rx: Math.PI / 2 }),
  P("engine", "Engine", "Move", "box", [0.9, 0.7, 1.1], "metal", { speed: 1.3, mass: 1.2, engine: 1 }),
  P("cannonV", "Cannon", "Equip", "cyl", [0.3, 1.4, 0.3], "metal", { attack: 2, rng: 14, rof: 1.2 }, { rx: Math.PI / 2 }),
  P("missiles", "Missile pod", "Equip", "box", [0.6, 0.5, 1], "metal", { attack: 3, mass: 1, rng: 22, rof: 0.6 }),
  P("machinegun", "Machine gun", "Equip", "cyl", [0.16, 1, 0.16], "metal", { attack: 1.3, rng: 9, rof: 4 }, { rx: Math.PI / 2 }),
  P("mortar", "Mortar", "Equip", "cyl", [0.5, 0.9, 0.5], "metal", { attack: 2.4, mass: 0.8, rng: 20, rof: 0.5 }),
  P("speaker", "Loudspeaker", "Equip", "cone", [0.8, 0.8, 0.8], "trim", { preach: 2 }, { rx: Math.PI / 2 }),
  P("choir", "Chapel", "Equip", "prism", [1, 1, 1], "accent", { preach: 3, mass: 1 }),
  P("cargo", "Cargo crate", "Equip", "box", [1, 0.8, 1], "trim", { trade: 2, mass: 1 }),
  P("tanker", "Tanker", "Equip", "capsule", [0.8, 0.8, 1.6], "metal", { trade: 3, mass: 1.5 }, { rx: Math.PI / 2 }),
  P("armour", "Armour plate", "Equip", "box", [1.4, 0.2, 1.4], "trim", { health: 3, mass: 1.5 }),
  P("fin", "Fin", "Detail", "wing", [0.1, 0.8, 0.8], "accent", { style: 1 }),
  P("light", "Light", "Detail", "sphere", [0.3, 0.3, 0.3], "glass", { style: 1 }),
  P("flagV", "Flag", "Detail", "box", [0.6, 0.4, 0.05], "accent", { style: 1 }),
];

export const SHIP_PARTS = [
  P("shipHull", "Hull", "Hull", "capsule", [1.6, 1.2, 4], "base", { mass: 3, health: 4 }, { chassis: true, rx: Math.PI / 2 }),
  P("saucer", "Saucer", "Hull", "disc", [4, 0.8, 4], "base", { mass: 3, health: 4 }, { chassis: true }),
  P("pod", "Pod", "Hull", "sphere", [1.6, 1.6, 1.6], "base", { mass: 2, health: 2 }, { chassis: true }),
  P("cockpit", "Cockpit", "Hull", "dome", [1.2, 0.7, 1.2], "glass", { sensors: 1 }),
  P("engine", "Engine", "Drive", "cyl", [0.8, 1.6, 0.8], "metal", { thrust: 2, energy: -0.5 }, { rx: Math.PI / 2 }),
  P("thruster", "Thruster", "Drive", "cone", [0.6, 0.9, 0.6], "metal", { thrust: 1 }, { rx: -Math.PI / 2 }),
  P("shipWing", "Wing", "Drive", "wing", [3.4, 0.15, 1.4], "accent", { handling: 1 }),
  P("ringDrive", "Ring drive", "Drive", "ring", [2.4, 2.4, 0.3], "accent", { thrust: 1.5, range: 1 }),
  P("laser", "Laser", "Systems", "cyl", [0.25, 1.6, 0.25], "metal", { attack: 2 }, { rx: Math.PI / 2 }),
  P("turret", "Turret", "Systems", "dome", [0.9, 0.5, 0.9], "metal", { attack: 3, mass: 1 }),
  P("shield", "Shield emitter", "Systems", "sphere", [0.6, 0.6, 0.6], "glass", { health: 3, energy: -0.5 }),
  P("battery", "Energy cell", "Systems", "box", [0.8, 0.6, 1.2], "accent", { energy: 3, mass: 1 }),
  P("scanner", "Scanner dish", "Systems", "dome", [1.2, 0.4, 1.2], "trim", { sensors: 2, range: 0.5 }),
  P("cargoBay", "Cargo bay", "Systems", "box", [1.4, 1, 1.4], "trim", { cargo: 3, mass: 1.5 }),
  P("finS", "Fin", "Detail", "wing", [0.1, 1, 1], "accent", { handling: 0.5 }),
  P("lightS", "Light", "Detail", "sphere", [0.3, 0.3, 0.3], "glass", {}),
  P("antennaS", "Antenna", "Detail", "cyl", [0.1, 1.6, 0.1], "metal", { sensors: 0.5 }),
];

export const CATALOGS = { building: BUILDING_PARTS, vehicle: VEHICLE_PARTS, ship: SHIP_PARTS };
const INDEX = Object.fromEntries(Object.entries(CATALOGS).map(([k, list]) => [k, Object.fromEntries(list.map((p) => [p.id, p]))]));
export const partOf = (kind, id) => INDEX[kind]?.[id] || null;
export const MAX_PARTS = { building: 40, vehicle: 30, ship: 40 };

/** Roles a design can be given; each kind of design has its own. */
export const ROLES = {
  building: {
    hall: { name: "City hall", icon: "🏛", desc: "The heart of a city. Its style sets your cities' look." },
    house: { name: "House", icon: "🏠", desc: "People live here: more population, more income." },
    factory: { name: "Factory", icon: "🏭", desc: "Makes money, but people don't love living next to it." },
    fun: { name: "Entertainment", icon: "🎡", desc: "Keeps your people happy." },
    temple: { name: "Temple", icon: "⛪", desc: "Faith: protects against conversion, powers missionaries." },
    turret: { name: "Turret", icon: "🗼", desc: "Defends the city from attack." },
  },
  vehicle: {
    military: { name: "Military", icon: "⚔", desc: "Attacks defences and other vehicles. Captures cities by force." },
    economic: { name: "Economic", icon: "💰", desc: "Opens trade routes and buys influence. Needs cargo." },
    religious: { name: "Religious", icon: "🕊", desc: "Preaches to cities to convert them. Needs speakers or a chapel." },
  },
  ship: {
    explorer: { name: "Explorer", icon: "🔭", desc: "Long range, good sensors." },
    warship: { name: "Warship", icon: "⚔", desc: "Weapons and armour." },
    trader: { name: "Trader", icon: "📦", desc: "Cargo and range." },
  },
};

/** A design's sum of part contributions (mirrored parts count twice). */
export function partTotals(design) {
  const t = {};
  for (const p of design.parts) {
    const def = partOf(design.kind, p.id);
    if (!def) continue;
    const k = (p.mirror ? 2 : 1) * Math.max(0.5, Math.min(2, p.s || 1));
    for (const [stat, v] of Object.entries(def.add)) t[stat] = (t[stat] || 0) + v * k;
  }
  return t;
}

/** How a vehicle moves: the propulsion with the most parts decides (land, sea or air). */
export function vehicleMode(design) {
  const t = partTotals(design);
  const opts = [["land", t.land || 0], ["sea", t.sea || 0], ["air", t.air || 0]].sort((a, b) => b[1] - a[1]);
  return opts[0][1] > 0 ? opts[0][0] : null;
}

/**
 * Statistics, 1..10, for a design. Vehicles: speed, power (attack, trade or preaching, by role), health,
 * cost. Buildings: prestige (beauty + volume) and their role's strength. Ships: speed, attack, health,
 * energy, range, sensors, cargo.
 * @returns {{ ok:boolean, problems:string[], stats:object, mode?:string, cost:number }}
 */
export function designStats(design) {
  const t = partTotals(design);
  const problems = [];
  const clamp = (v) => Math.max(1, Math.min(10, Math.round(v * 10) / 10));
  const count = design.parts.reduce((a, p) => a + (p.mirror ? 2 : 1), 0);
  if (design.kind === "building") {
    const role = design.role || "house";
    if (!design.parts.some((p) => partOf("building", p.id)?.cat === "Body")) problems.push("Add a body part (a block, tower or rotunda).");
    if (role === "turret" && !(t.defence > 0)) problems.push("A turret needs a cannon or battlements.");
    const prestige = clamp(1 + (t.beauty || 0) * 0.45 + Math.sqrt(t.volume || 0) * 0.6);
    const roleStat = { hall: prestige, house: clamp(1 + Math.sqrt(t.volume || 0) * 1.1), factory: clamp(3 + (t.industry || 0) * 1.5 + Math.sqrt(t.volume || 0) * 0.4), fun: clamp(2 + (t.beauty || 0) * 0.7), temple: clamp(2 + (t.faith || 0) * 2 + (t.beauty || 0) * 0.3), turret: clamp(1 + (t.defence || 0) * 1.6) }[role];
    return { ok: !problems.length, problems, stats: { prestige, strength: roleStat }, cost: 20 + count * 4 };
  }
  if (design.kind === "vehicle") {
    const role = design.role || "military";
    const mode = vehicleMode(design);
    if (!design.parts.some((p) => partOf("vehicle", p.id)?.chassis)) problems.push("Add a chassis: a car body, boat hull or fuselage.");
    if (!mode) problems.push("Add something to move with: wheels, treads, a propeller, a sail, wings or a jet.");
    const power = role === "military" ? t.attack || 0 : role === "economic" ? t.trade || 0 : t.preach || 0;
    if (!(power > 0)) problems.push({ military: "Military vehicles need a weapon.", economic: "Economic vehicles need cargo.", religious: "Religious vehicles need a loudspeaker or chapel." }[role]);
    const mass = Math.max(1, t.mass || 1);
    const drive = (t.speed || 0) * (mode === "air" ? 1.3 : mode === "sea" ? 1.1 : 1);
    const stats = { speed: clamp(1 + (drive / mass) * 5), power: clamp(1 + power * 1.1), health: clamp(1 + (t.health || 0) * 0.9) };
    return { ok: !problems.length, problems, stats, mode, cost: Math.round(30 + stats.power * 8 + stats.health * 6 + stats.speed * 4 + (mode === "air" ? 40 : mode === "sea" ? 15 : 0)) };
  }
  // Spaceships.
  if (!design.parts.some((p) => partOf("ship", p.id)?.chassis)) problems.push("Add a hull: a hull, saucer or pod.");
  if (!(t.thrust > 0)) problems.push("Add an engine or thruster.");
  const mass = Math.max(1, t.mass || 1);
  const stats = {
    speed: clamp(1 + ((t.thrust || 0) / mass) * 4 + (t.handling || 0) * 0.4),
    attack: clamp(1 + (t.attack || 0) * 0.9),
    health: clamp(1 + (t.health || 0) * 0.8),
    energy: clamp(3 + (t.energy || 0) * 0.9),
    range: clamp(2 + (t.range || 0) * 1.5 + (t.energy || 0) * 0.3),
    sensors: clamp(1 + (t.sensors || 0) * 1.5),
    cargo: clamp(1 + (t.cargo || 0) * 1.2),
  };
  return { ok: !problems.length, problems, stats, cost: 0 };
}

/** Ready-made designs, so every stage has something to start with (and the editors something to open). */
export const STARTER_DESIGNS = {
  building: {
    hall: { kind: "building", v: 1, name: "Town Hall", role: "hall", colors: { base: 0xe8dcc0, accent: 0x3fa9d6, trim: 0x6b5a48 }, parts: [{ id: "base", x: 0, y: 0.2, z: 0 }, { id: "block", x: 0, y: 1.4, z: 0 }, { id: "dome", x: 0, y: 2.4, z: 0 }, { id: "column", x: 1.2, y: 1.4, z: 1.2, mirror: true }, { id: "spire", x: 0, y: 3.6, z: 0 }] },
    house: { kind: "building", v: 1, name: "Cottage", role: "house", colors: { base: 0xf2e6cf, accent: 0xc9483c, trim: 0x6b5a48 }, parts: [{ id: "block", x: 0, y: 1, z: 0 }, { id: "roof", x: 0, y: 2.55, z: 0 }, { id: "chimney", x: 0.6, y: 2.6, z: 0.4 }] },
    factory: { kind: "building", v: 1, name: "Works", role: "factory", colors: { base: 0x9aa3ab, accent: 0x5b7fa6, trim: 0x3a3f45 }, parts: [{ id: "wing", x: 0, y: 0.7, z: 0 }, { id: "flat", x: 0, y: 1.5, z: 0 }, { id: "chimney", x: 0.9, y: 2, z: 0 }, { id: "chimney", x: -0.3, y: 2, z: 0 }] },
    fun: { kind: "building", v: 1, name: "Amphitheatre", role: "fun", colors: { base: 0xffe3a8, accent: 0xd94f8a, trim: 0x8a5fd0 }, parts: [{ id: "round", x: 0, y: 0.8, z: 0 }, { id: "arch", x: 0, y: 2.2, z: 0 }, { id: "banner", x: 1, y: 2, z: 0, mirror: true }] },
    temple: { kind: "building", v: 1, name: "Shrine", role: "temple", colors: { base: 0xf2f2f2, accent: 0xe8c547, trim: 0x8a7a5a }, parts: [{ id: "block", x: 0, y: 1, z: 0 }, { id: "dome", x: 0, y: 2.55, z: 0 }, { id: "bell", x: 0, y: 3.3, z: 0 }, { id: "column", x: 1.1, y: 1, z: 1.1, mirror: true }] },
    turret: { kind: "building", v: 1, name: "Bastion", role: "turret", colors: { base: 0x8a8f96, accent: 0xc9483c, trim: 0x3a3f45 }, parts: [{ id: "tower", x: 0, y: 1.6, z: 0 }, { id: "battlement", x: 0, y: 3.4, z: 0 }, { id: "cannon", x: 0, y: 3.6, z: 0.8 }] },
  },
  vehicle: {
    military: { kind: "vehicle", v: 1, name: "Rumbler", role: "military", colors: { base: 0x6b7a4a, accent: 0xc9483c, trim: 0x2a2f25 }, parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "tread", x: 0.95, y: 0.35, z: 0, mirror: true }, { id: "cannonV", x: 0, y: 1.15, z: 1 }] },
    economic: { kind: "vehicle", v: 1, name: "Hauler", role: "economic", colors: { base: 0xd6a03f, accent: 0x3fa9d6, trim: 0x2a2f25 }, parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.85, y: 0.4, z: 0.9, mirror: true }, { id: "wheel", x: 0.85, y: 0.4, z: -0.9, mirror: true }, { id: "cargo", x: 0, y: 1.35, z: -0.4 }] },
    religious: { kind: "vehicle", v: 1, name: "Herald", role: "religious", colors: { base: 0xf2f2f2, accent: 0x8a5fd0, trim: 0x2a2f25 }, parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.85, y: 0.4, z: 0.9, mirror: true }, { id: "wheel", x: 0.85, y: 0.4, z: -0.9, mirror: true }, { id: "speaker", x: 0, y: 1.3, z: 0.6 }] },
  },
  ship: {
    explorer: { kind: "ship", v: 1, name: "Wanderer", role: "explorer", colors: { base: 0xe6edf2, accent: 0x3fa9d6, trim: 0x2a3540 }, parts: [{ id: "saucer", x: 0, y: 0, z: 0 }, { id: "cockpit", x: 0, y: 0.6, z: 0 }, { id: "engine", x: 0.9, y: -0.1, z: -1.4, mirror: true }, { id: "scanner", x: 0, y: -0.5, z: 0 }, { id: "laser", x: 0, y: 0.1, z: 2 }] },
  },
};
