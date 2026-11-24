/**
 * Civilization Stage, on a real planet. Your tribe's village has become the first city of a nation on
 * a spherical world you can turn in your hands and zoom down into: continents, oceans, mountains,
 * clouds, day and night. Cities, buildings, roads, citizens, vehicles, spice and borders all stand on
 * the curved surface (see planet.js for the surface coordinates and routes, globe.js for the drawing).
 *
 * Build up cities from your own building designs, field vehicles from your own vehicle designs (land,
 * sea and air), claim spice, and bring every city on the planet under your flag by force, by trade or by
 * faith, while three rival nations try the same.
 *
 * The rules (economy, damage, conversion, trade, diplomacy, the AI's choices) live in ./rules.js and
 * are unit tested; this file is the scene, the controls and the HUD.
 */
import * as THREE from "three";
import { CUTSCENES, ease, mix, span } from "../cinematics.js";
import { generateSpecies } from "../creature/species.js";
import { regionById } from "../creature/regions.js";
import { getHomeworld } from "../ecolib/homeworld.js";
import { buildDesignMesh, designMaterials } from "../creations/mesh.js";
import { validateModular } from "../creations/format.js";
import { ROLES, STARTER_DESIGNS, VEHICLE_CLASSES, designStats, vehicleMode } from "../creations/modular.js";
import { speciesStyle } from "../tribe/life.js";
import { createVillage } from "../tribe/village.js";
import { R, angle, arc, createPlanet, frameAt, mulberry, offsetDir, seedOf, step, towards } from "./planet.js";
import { createGlobe } from "./globe.js";
import {
  AIR_AT,
  BUILD_COST,
  CITY_TYPES,
  CIV_CARDS,
  CIV_SAVE_KEY,
  DIPLO,
  MAX_TURRETS,
  PLOTS,
  PLOT_ROLES,
  START_MONEY,
  SUPERWEAPONS,
  SUPER_COOLDOWN,
  SUPER_COST,
  TURRET_RANGE,
  TYPE_IDS,
  VEHICLES_PER_CITY,
  YOU,
  allowedModes,
  buyoutCost,
  calmUnrest,
  cityDefence,
  cityEconomy,
  cityName,
  civArchetype,
  civLegacy,
  civWon,
  clampRel,
  damageCity,
  deliverTrade,
  dominantMethod,
  nationPlan,
  preachRate,
  preachTo,
  relationWord,
  repairCity,
  starterVehicle,
  superUnlocked,
  tradeIncome,
  transferCity,
  vehicleUnit,
  vehicleTemplates,
  CLASSES_BY_MODE,
  hitMult,
  weaponFor,
  spiceYield,
  geyserRichness,
  marketStep,
  sellSpice,
  spiceCost,
  buildTime,
  deliveryPay,
  QUEUE_MAX,
  DERRICK_UPGRADE,
  SPICE_PRICE,
  ROUTE_INCOME,
} from "./rules.js";
import { createProjectiles } from "./projectiles.js";
import { createThumbs } from "./thumbs.js";
import { installIcons, ico } from "./icons.js";
import { DOMINANT_SHARE, PERSONALITIES, availableOptions, answer, cityPrice, incoming, leaderName, leaderTitle, MESSAGE_TTL, nudge, pairDecision, pairKey, pairRest, personalityFor, respond, silence } from "./leaders.js";
import { heritageRemark } from "../heritage.js";
import { createMinimap } from "./minimap.js";
import { activeEffects, chooseEvent, nextEventIn, readEvents } from "./events.js";

const TAU = Math.PI * 2;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const MODE_ICON = { land: "🚙", sea: "🚤", air: "✈" };
const MODE_NAME = { land: "Land", sea: "Sea", air: "Air" };
/** Most extra vehicle designs you can keep for each role, beside the standard land, sea and air ones. */
const DESIGNS_PER_ROLE = 6;
const clsOf = (unit) => VEHICLE_CLASSES[unit.cls] || null;
const ROLE_ICON = { house: "🏠", factory: "🏭", fun: "🎡", temple: "⛪", turret: "🗼", hall: "🏛" };
/** The three rival nations: one of each kind, from the three tribes that lived nearest. */
const NATION_KINDS = ["military", "economic", "religious"];
const NATION_COLORS = { military: 0xc9483c, economic: 0xd6a03f, religious: 0x8a5fd0 };
const NATION_START = { military: -20, economic: 10, religious: 0 };
const INDEPENDENT_COLOR = 0x9aa3ab;
const RANGE = { land: 12, air: 11, sea: 8 };
const SCALE = { building: 1.35, hall: 1.7, vehicle: 1.35 };
/** How high aircraft fly. */
const AIR_LIFT = 13;
/** A city's ground: flat out to this radius; its wall stands at WALL. */
const CITY_FLAT = 23;
const WALL = 15.5;
/** The camera: from street level to the whole planet. */
const ALT = { min: 14, city: 60, region: 220, max: R * 2.7 };
/** Territory: how far a city's land reaches. */
const TERRITORY = 46;
/** For the first few minutes nobody comes for your cities: time to build up. */
const GRACE = 240;
/** Length of a day on the planet, in seconds (as in globe.js). */
const DAY_SECONDS = 420;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object|null} o.save        from readCivSave
 * @param {string} o.regionId
 * @param {string} o.quality
 * @param {string} o.name              your nation's name
 * @param {number} o.color             your colour (from your tribe)
 * @param {{cellDiet?:string, creatureCard?:string, tribeTrait?:string}} o.legacy
 * @param {object|null} [o.tribe]      the Tribal Stage save: the village your first city grows from
 * @param {object|null} [o.record]     your creature (for your citizens and your village's style)
 * @param {(kind:string, opts?:object) => void} o.sfx
 * @param {(kind:string, design:object, opts:object) => object|null} o.openEditor  the modular editor
 * @param {(kind:string, design:object) => void} [o.onCreation]  a design saved: for the Sporepedia
 * @param {(ev:object) => void} [o.onChronicle]
 * @param {(card:object) => void} [o.onWon]
 * @param {() => void} [o.onSaved]
 * @param {() => void} [o.onSettings]
 * @param {() => void} [o.onHistory]
 * @param {() => void} o.onRestart    start the stage over (after losing every city)
 */
export function createCivStage(o) {
  const canvas = o.renderer.domElement;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 9000);
  const save = o.save || null;
  const legacy = civLegacy(o.legacy || {});
  const mods = legacy.mods;
  const chronicle = (ev) => {
    // Your milestones are kept for the victory screen's look back, as well as the species history.
    if (ev?.text) {
      T.moments.push({ t: Math.round(T.time), icon: ev.icon || "✦", text: ev.text });
      if (T.moments.length > 30) T.moments.splice(0, T.moments.length - 30);
    }
    o.onChronicle?.(ev);
  };
  const myColors = { base: 0xf2efe6, accent: o.color ?? 0x3fa9d6, trim: 0x2f3d4f };

  /* ---- the planet ------------------------------------------------------------------------------ */
  // The homeworld (if a universe is loaded) decides the planet and its colours; otherwise the region.
  const hw = getHomeworld();
  const region = regionById(o.regionId || "coast");
  const seed = save?.seed || seedOf(hw ? "planet:" + hw.planetId : "region:" + (o.regionId || "coast"));
  const planet = createPlanet(seed, { relief: hw?.relief ?? 1 });
  const palette = hw ? { ...region.colors, ...hw.terrain, leaf: hw.vegetation?.leaf ?? region.colors.leaf, trunk: hw.vegetation?.trunk ?? region.colors.trunk } : region.colors;
  const sites = planet.citySites(11, 3);
  // Each city stands on flat ground; the terrain is shaped round it before it's drawn.
  for (const s of sites) planet.flatten(s.d, CITY_FLAT);
  const spiceDirs = planet.spiceSites(sites, 12);
  const globe = createGlobe(scene, planet, { colors: palette, water: hw?.water?.color ?? region.water ?? 0x2f78b8, sky: hw?.atmosphere?.day ?? region.sky?.day ?? 0x8cc8ff, quality: o.quality });
  // (Room round each city for the vehicles that park outside its gate.)
  sites.forEach((s) => globe.clearTrees(s.d, CITY_FLAT + 10));
  spiceDirs.forEach((d) => globe.clearTrees(d, 6));
  globe.placeTrees();
  const HOME = sites[0].d;

  /* ---- state -------------------------------------------------------------------------------- */
  const T = {
    money: save ? save.money : START_MONEY,
    // Spice: pumped by derricks, spent on military vehicles, sold on the world market at `price`.
    spice: save?.spice ?? 20,
    price: save?.price ?? SPICE_PRICE.usual,
    startType: save?.startType || legacy.startType,
    nations: [],
    cities: [],
    geysers: [],
    vehicles: [],
    designs: { building: {}, vehicle: {} },
    captures: save?.captures || { military: 0, economic: 0, religious: 0 },
    superCool: save?.superCool || 0,
    won: !!save?.won,
    card: save?.card || null,
    time: save?.time || 0,
    // Relations between rival nations, by pair ("n0|n1"): rel, war, allied, pact, warFor (seconds).
    pairs: save?.pairs || {},
    newsLog: save?.news || [],
    moments: save?.moments || [],
    // World events: what's running, when the next is due, and the last one (never repeated).
    events: save?.events || readEvents(null),
    selected: new Set(),
    targeting: false,
    lost: false,
  };
  let paused = false,
    nextVehicleId = 1;

  /* ---- designs -------------------------------------------------------------------------------- */
  const tryDesign = (raw, kind) => {
    try {
      return validateModular(raw, kind);
    } catch {
      return null;
    }
  };
  for (const role of Object.keys(ROLES.building)) T.designs.building[role] = tryDesign(save?.designs.building[role], "building") || { ...STARTER_DESIGNS.building[role], colors: { ...myColors } };
  for (const role of TYPE_IDS)
    for (const mode of ["land", "sea", "air"]) {
      const key = role + ":" + mode;
      const saved = tryDesign(save?.designs.vehicle[key], "vehicle");
      T.designs.vehicle[key] = saved && saved.role === role && vehicleMode(saved) === mode ? saved : starterVehicle(role, mode, myColors);
    }
  // Your own extra designs ("military:air:2"): a library of as many as DESIGNS_PER_ROLE per role.
  for (const [key, raw] of Object.entries(save?.designs.vehicle || {})) {
    const m = /^(military|economic|religious):(land|sea|air):(\d{1,2})$/.exec(key);
    const d = m && tryDesign(raw, "vehicle");
    if (!d || d.role !== m[1] || vehicleMode(d) !== m[2] || customKeys(m[1]).length >= DESIGNS_PER_ROLE) continue;
    T.designs.vehicle[key] = d;
  }
  /** Your vehicle designs for a role: the three standard ones (land, sea, air), then your own. */
  function designKeys(role) {
    return Object.keys(T.designs.vehicle)
      .filter((k) => k.startsWith(role + ":"))
      .sort((a, b) => (a.split(":").length - b.split(":").length) || ["land", "sea", "air"].indexOf(a.split(":")[1]) - ["land", "sea", "air"].indexOf(b.split(":")[1]) || a.localeCompare(b, "en", { numeric: true }));
  }
  function customKeys(role) {
    return Object.keys(T.designs.vehicle).filter((k) => k.startsWith(role + ":") && k.split(":").length === 3);
  }
  function freeKey(role, mode) {
    for (let i = 1; i < 99; i++) if (!T.designs.vehicle[`${role}:${mode}:${i}`]) return `${role}:${mode}:${i}`;
    return null;
  }
  const myStrengths = () => {
    const s = {};
    for (const [role, d] of Object.entries(T.designs.building)) s[role] = designStats(d).stats.strength;
    s.turret = (s.turret || 5) * (1 + mods.turret);
    return s;
  };
  let strengths = myStrengths();
  const ownerMods = (owner) => (owner === YOU ? { strengths, incomeBonus: mods.incomeBonus, happyBonus: mods.happyBonus + activeEffects(T.events.active, T.time).happy } : {});
  const unitMods = (owner) => (owner === YOU ? mods : {});

  /* ---- shared materials ------------------------------------------------------------------------ */
  const matCache = new Map();
  function matsFor(colors) {
    const key = colors.base + ":" + colors.accent + ":" + colors.trim;
    if (!matCache.has(key)) matCache.set(key, designMaterials(colors));
    return matCache.get(key);
  }
  const plain = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
  const sharedGeo = {
    vent: new THREE.CylinderGeometry(1.4, 2.2, 0.8, 10),
    plume: new THREE.ConeGeometry(1.1, 5, 10, 1, true),
    derrick: new THREE.CylinderGeometry(0.35, 1.3, 5, 4),
    flag: new THREE.PlaneGeometry(1.4, 0.9),
    ring: new THREE.RingGeometry(1.6, 2.1, 24).rotateX(-Math.PI / 2),
    pad: new THREE.CircleGeometry(2.6, 18).rotateX(-Math.PI / 2),
  };
  const sharedMat = {
    plaza: plain(0xcfc4a8),
    road: plain(0x9a8f78),
    paved: plain(0x8d9096),
    plot: plain(0xa89c80),
    vent: plain(0x6b5a48),
    plume: new THREE.MeshBasicMaterial({ color: 0xffa14a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    derrick: plain(0x3a3f45),
    sel: new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, opacity: 0.9, depthTest: false }),
    foe: new THREE.MeshBasicMaterial({ color: 0xef4b48, transparent: true, opacity: 0.9, depthTest: false }),
  };

  /* ---- placing things on the curved surface ----------------------------------------------------- */
  const M = new THREE.Matrix4();
  /** Stand an object on the ground at a direction, facing a tangent (or a fixed spin), scaled. */
  function stand(obj, d, fwd = null, s = 1, lift = 0, spin = 0) {
    globe.surfaceMatrix(d, fwd, lift, M, s, spin);
    M.decompose(obj.position, obj.quaternion, obj.scale);
    return obj;
  }
  /** World position of a point on the ground at a direction. */
  const ground = (d, lift = 0, out = new THREE.Vector3()) => globe.surfacePoint(d, lift, out);
  /**
   * A curved strip of ground cover between two directions (a road): follows the sphere so it never
   * floats or sinks. Built in world space.
   */
  function stripGeometry(a, b, width, lift = 0.08) {
    const n = Math.max(2, Math.ceil(arc(a, b) / 1.5));
    const posArr = [];
    const idx = [];
    const p = new THREE.Vector3(),
      q = new THREE.Vector3(),
      side = new THREE.Vector3(),
      up = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const d = slerp(a, b, k);
      up.set(d.x, d.y, d.z);
      const t = towards(d, b);
      side.set(t.x, t.y, t.z).cross(up).normalize().multiplyScalar(width / 2);
      ground(d, lift, p);
      q.copy(p).add(side);
      p.sub(side);
      posArr.push(p.x, p.y, p.z, q.x, q.y, q.z);
      if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  /** A disc of ground cover centred on a direction, curved with the planet. */
  function capGeometry(c, radius, lift = 0.05, rings = 5, segs = 36) {
    const f = frameAt(c);
    const posArr = [];
    const idx = [];
    const p = new THREE.Vector3();
    ground(c, lift, p);
    posArr.push(p.x, p.y, p.z);
    for (let r = 1; r <= rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU,
          rr = (r / rings) * radius;
        ground(offsetDir(c, Math.cos(a) * rr, Math.sin(a) * rr, f), lift, p);
        posArr.push(p.x, p.y, p.z);
      }
    const at = (r, s) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
    for (let s = 0; s < segs; s++) idx.push(0, at(1, s + 1), at(1, s));
    for (let r = 1; r < rings; r++)
      for (let s = 0; s < segs; s++) idx.push(at(r, s), at(r, s + 1), at(r + 1, s), at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function slerp(a, b, k) {
    const w = angle(a, b);
    if (w < 1e-6) return a;
    const s = Math.sin(w);
    const ka = Math.sin((1 - k) * w) / s,
      kb = Math.sin(k * w) / s;
    return { x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb };
  }

  /* ---- nations ---------------------------------------------------------------------------------- */
  // Named for the species of the three nearest tribes from the Tribal Stage (same seeds), one of each kind.
  NATION_KINDS.forEach((type, i) => {
    const sp = generateSpecies(90210 + i * 7919, "omni", 1);
    const saved = save?.nations[i];
    // The leader: the same for a nation every game on this planet (from the planet's seed).
    const lr = mulberry((seed ^ ((i + 1) * 40503)) >>> 0);
    const personality = saved?.personality || personalityFor(type, lr());
    T.nations.push({
      id: "n" + i,
      index: i,
      type,
      name: sp.name,
      color: NATION_COLORS[type],
      colors: { base: 0xe8dcc0, accent: NATION_COLORS[type], trim: 0x3a3f45 },
      relation: saved ? saved.relation : clampRel(NATION_START[type] + mods.relation),
      base: clampRel(NATION_START[type] + mods.relation),
      war: saved ? saved.war : false,
      money: saved ? saved.money : 120,
      spice: saved?.spice ?? 0,
      alive: saved ? saved.alive : true,
      species: sp,
      personality,
      leader: { name: leaderName(lr), title: leaderTitle(personality) },
      // Diplomacy: whether you've met, agreements, and what's been said.
      met: !!saved?.met,
      allied: !!saved?.allied,
      pact: !!saved?.pact,
      cowedUntil: saved?.cowedUntil || 0,
      preachUntil: saved?.preachUntil || 0,
      assistAt: 0,
      beliefsAt: 0,
      log: saved?.log || [],
      talkClock: 25 + i * 9,
      clock: 4 + i * 1.3,
      buildClock: 20 + i * 7,
    });
  });
  const nationOf = (id) => T.nations.find((n) => n.id === id) || null;
  const ownerColor = (owner) => (owner === YOU ? myColors.accent : nationOf(owner)?.color ?? INDEPENDENT_COLOR);
  const ownerName = (owner) => (owner === YOU ? "your nation" : owner ? nationOf(owner)?.name + " nation" : "Independent");

  /* ---- cities -------------------------------------------------------------------------------------- */
  // Your capital where your village stood; ten more around the planet: three on your own continent and
  // the rest overseas. Two for each rival nation, the rest independent.
  {
    const owners = [YOU, "n1", null, "n2", "n0", "n1", "n2", "n0", null, null, null];
    sites.forEach((site, i) => {
      const saved = save?.cities[i];
      const owner = saved ? saved.owner : owners[i] === undefined ? null : owners[i];
      const nat = nationOf(owner);
      const type = saved ? saved.type : owner === YOU ? T.startType : nat ? nat.type : TYPE_IDS[i % 3];
      // Rivals start with a working town; independents with a couple of houses and a turret. Your
      // capital is the village itself, with its first house and workshop.
      const startPlots = owner === YOU ? ["house", "factory", null, null, null, null] : nat ? ["house", "factory", "fun", "house", null, null] : ["house", "house", null, null, null, null];
      T.cities.push({
        id: i,
        d: site.d,
        f: frameAt(site.d),
        landmass: site.landmass,
        ocean: site.ocean,
        anchor: site.anchor,
        name: i === 0 ? o.name : cityName(i * 7919 + (o.regionId || "").length),
        owner,
        type,
        plots: saved ? saved.plots : startPlots,
        turrets: saved ? saved.turrets : owner === YOU ? 1 : nat?.type === "military" || !nat ? 2 : 1,
        turretHp: saved ? saved.turretHp : 1,
        hallHp: saved ? saved.hallHp : 1,
        trade: saved ? saved.trade : {},
        conv: saved ? saved.conv : {},
        unrest: saved ? saved.unrest : 0,
        queue: saved?.queue || [],
        coastal: site.coastal,
        group: null,
        calm: 99,
      });
    });
  }
  const yourCities = () => T.cities.filter((c) => c.owner === YOU);
  const citiesOf = (owner) => T.cities.filter((c) => c.owner === owner);
  const capital = () => (T.cities[0].owner === YOU ? T.cities[0] : yourCities()[0] || T.cities[0]);

  const ownerDesign = (owner, role) => {
    if (owner === YOU) return T.designs.building[role];
    const colors = nationOf(owner)?.colors || { base: 0xd9d4c8, accent: INDEPENDENT_COLOR, trim: 0x3a3f45 };
    return { ...STARTER_DESIGNS.building[role], colors };
  };
  /** Where each plot and turret stands, as offsets east/north of the centre (and as directions). */
  const plotXZ = (k) => {
    const a = (k / PLOTS) * TAU + TAU / 12;
    return { x: Math.cos(a) * 9, z: Math.sin(a) * 9 };
  };
  const turretXZ = (k) => {
    const a = (k / MAX_TURRETS) * TAU - Math.PI / 2;
    return { x: Math.cos(a) * WALL, z: Math.sin(a) * WALL };
  };
  const at = (c, p) => offsetDir(c.d, p.x, p.z, c.f);
  const plotSpot = (c, k) => at(c, plotXZ(k));
  const turretSpot = (c, k) => at(c, turretXZ(k));

  /* New buildings rise out of the ground. */
  const rising = [];
  function placeModel(group, design, d, s, faceTo = null, grow = false) {
    const m = buildDesignMesh(design, { materials: matsFor(design.colors) });
    stand(m.root, d, faceTo ? towards(d, faceTo) : null, s);
    group.add(m.root);
    if (grow) {
      m.root.userData.sy = m.root.scale.y;
      m.root.scale.y = 0.01;
      rising.push({ root: m.root, t: 0 });
    }
    return m;
  }

  /* ---- your village, becoming a city ------------------------------------------------------------
     The capital starts as the village you left in the Tribal Stage: the chief's hut, the shelters, the
     store and everything else, laid out as they stood and in your species' style. The city hall rises
     beside the old hut; each building you put up replaces the huts standing on that plot; the chief's
     hut stays as a monument. */
  const tribe = o.tribe || null;
  const villageStyle = (() => {
    const rec = o.record;
    if (!rec) return null;
    const xs = rec.spine?.map((s) => s.x) || [0, 3];
    const maxR = Math.max(0.3, ...(rec.spine || []).map((s) => s.r || 0.4));
    const legLen = Math.max(0, ...(rec.legs || []).map((l) => l.length || 1));
    const diet = (rec.parts || []).some((p) => ["jaws", "fangs", "snapper", "tuskMaw", "mandibles"].includes(p.id)) ? "meat" : (rec.parts || []).some((p) => ["beak", "grinder", "shears", "fluteBeak", "trunk"].includes(p.id)) ? "plant" : "omni";
    return speciesStyle({ diet, dims: { length: Math.max(...xs) - Math.min(...xs), height: maxR * 2 + legLen }, arms: (rec.arms || []).length, parts: (rec.parts || []).map((p) => p.id), colors: rec.colors, legacy: [] });
  })();
  /** The village's pieces as offsets from the chief's hut (tribal HOME was the nest, at 0, 178). */
  const heritage = (() => {
    if (!tribe || !villageStyle) return [];
    const home = { x: 0, z: 178 };
    const list = (tribe.auto || []).filter((a) => ["shelter", "storage", "rack", "craft", "trophy", "garden", "decor", "ring", "training"].includes(a.id)).map((a) => ({ ...a, ex: a.x - home.x, nz: -(a.z - home.z) }));
    const far = Math.max(1, ...list.map((a) => Math.hypot(a.ex, a.nz)));
    // Squeeze the village into the city's walls, keeping its shape.
    const k = Math.min(1, 13 / far);
    return list.map((a) => ({ ...a, ex: a.ex * k, nz: a.nz * k }));
  })();
  /** The chief's hut, as it looked: a cone, dome or longhouse roofed in the tribe's colour. */
  function chiefHut(style, color) {
    const g = new THREE.Group();
    const wall = plain(0xc9a878),
      roof = plain(color);
    if (style === "long") {
      const w = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.3, 3.8), wall);
      w.position.y = 1.15;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 6.8, 3, 1).rotateZ(Math.PI / 2), roof);
      r.position.y = 2.9;
      r.scale.set(1, 0.75, 1);
      r.rotation.x = Math.PI / 6;
      g.add(w, r);
    } else {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 2.4, 10), wall);
      w.position.y = 1.2;
      const r = new THREE.Mesh(style === "dome" ? new THREE.SphereGeometry(3, 12, 8, 0, TAU, 0, Math.PI / 2) : new THREE.ConeGeometry(3.4, 2.8, 10), roof);
      r.position.y = style === "dome" ? 2.2 : 3.7;
      g.add(w, r);
    }
    g.userData.own = [wall, roof];
    return g;
  }
  /** Build the village's pieces (with the Tribal Stage's own builder) into a city's group. */
  function buildHeritage(c, g) {
    if (c.id !== 0 || !tribe || !villageStyle) return [];
    const tmp = new THREE.Group();
    const vil = createVillage({
      scene: tmp,
      heightAt: () => 0,
      mat: (color, extra = {}) => {
        const m = plain(color, extra);
        c.ownMats.push(m);
        return m;
      },
      geo: (gg) => (c.ownGeos.push(gg), gg),
      world: { resolve: (x, z) => ({ x, z }) },
      HOME: { x: 0, z: 0 },
      FIRE: { x: 6, z: -1 },
      PILE: { x: 3, z: 5 },
      style: villageStyle,
      diet: "omni",
      taken: () => [],
      toolMesh: () => new THREE.Group(),
      weapons: () => [],
      regionId: o.regionId || "coast",
    });
    const out = [];
    for (const a of heritage) {
      // A piece standing where a building now stands has been replaced by it.
      if (c.plots.some((role, k) => role && Math.hypot(plotXZ(k).x - a.ex, plotXZ(k).z - a.nz) < 5.5)) continue;
      if (Math.hypot(a.ex, a.nz) < 4.2) continue; // the city hall took the middle
      const p = vil.place(a.id, a.ex, -a.nz, a.k);
      (p.baked || []).forEach((gg) => c.ownGeos.push(gg));
      const mesh = p.mesh;
      mesh.removeFromParent();
      // The village's ground frame (x east, z south) is the planet frame (x west, z north) turned round.
      const spin = mesh.rotation.y + Math.PI;
      const s = mesh.scale.x * 0.75;
      stand(mesh, offsetDir(c.d, a.ex, a.nz, c.f), null, s, 0, spin);
      g.add(mesh);
      out.push(mesh);
    }
    // The chief's hut beside the hall: kept as a monument to where it all began.
    const hut = chiefHut(tribe.look?.style || "cone", tribe.look?.color ?? myColors.accent);
    hut.userData.own.forEach((m) => c.ownMats.push(m));
    hut.traverse((m) => m.geometry && c.ownGeos.push(m.geometry));
    stand(hut, offsetDir(c.d, -5.2, 2.2, c.f), towards(offsetDir(c.d, -5.2, 2.2, c.f), c.d), 0.62);
    g.add(hut);
    return out;
  }

  /* ---- city models: plaza, wall, roads, buildings, turrets ------------------------------------------ */
  const cityLevel = (c) => c.plots.filter(Boolean).length + c.turrets;
  function buildCity(c, grow = null) {
    const before = new Set((c.built || []).map(String));
    if (c.group) {
      c.models.forEach((m) => m.dispose());
      c.ownMats.forEach((m) => m.dispose());
      c.ownGeos.forEach((g) => g.dispose());
      scene.remove(c.group);
    }
    const g = new THREE.Group();
    c.models = [];
    c.ownMats = [];
    c.ownGeos = [];
    const wallMat = plain(ownerColor(c.owner));
    c.ownMats.push(wallMat);
    // The plaza and the roads: earth at first, paved once the city has grown.
    const paved = cityLevel(c) >= 6;
    const plazaGeo = capGeometry(c.d, 5.5, 0.06);
    c.ownGeos.push(plazaGeo);
    g.add(new THREE.Mesh(plazaGeo, sharedMat.plaza));
    const roadMat = paved ? sharedMat.paved : sharedMat.road;
    const road = (to, w = 1.7) => {
      const rg = stripGeometry(c.d, to, w);
      c.ownGeos.push(rg);
      g.add(new THREE.Mesh(rg, roadMat));
    };
    for (let k = 0; k < PLOTS; k++) if (c.plots[k]) road(plotSpot(c, k));
    for (let k = 0; k < c.turrets; k++) road(turretSpot(c, k), 1.4);
    // Gates: the road out of town toward the nearest neighbour.
    const near = T.cities.filter((x) => x !== c).sort((a, b) => arc(a.d, c.d) - arc(b.d, c.d))[0];
    if (near) road(offsetDir(c.d, ...gateXZ(c, near), c.f), 2.2);
    // The wall: a low ring in the owner's colour, following the curve of the ground.
    {
      const pts = [];
      for (let s = 0; s <= 48; s++) {
        const a = (s / 48) * TAU;
        pts.push(ground(offsetDir(c.d, Math.cos(a) * WALL, Math.sin(a) * WALL, c.f), 0.35));
      }
      const wg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.45, 5, true);
      c.ownGeos.push(wg);
      g.add(new THREE.Mesh(wg, wallMat));
    }
    const isNew = (key) => grow === true || (grow && !before.has(key));
    c.built = [];
    c.models.push(placeModel(g, ownerDesign(c.owner, "hall"), c.d, SCALE.hall, null, isNew("hall")));
    c.built.push("hall");
    for (let k = 0; k < PLOTS; k++) {
      const d = plotSpot(c, k);
      if (c.plots[k]) {
        const key = "p" + k + c.plots[k];
        c.models.push(placeModel(g, ownerDesign(c.owner, c.plots[k]), d, SCALE.building, c.d, isNew(key)));
        c.built.push(key);
      } else if (c.id !== 0 || !heritage.length) {
        const pad = new THREE.Mesh(sharedGeo.pad, sharedMat.plot);
        stand(pad, d, null, 1, 0.06);
        g.add(pad);
      }
    }
    for (let k = 0; k < c.turrets; k++) {
      const d = turretSpot(c, k);
      c.models.push(placeModel(g, ownerDesign(c.owner, "turret"), d, SCALE.building * 0.9, c.d, isNew("t" + k)));
      c.built.push("t" + k);
    }
    // Your capital: what is left of the village around it.
    c.heritage = c.owner === YOU || c.id === 0 ? buildHeritage(c, g) : [];
    c.group = g;
    scene.add(g);
    makeLights(c);
  }
  /** Where the gate road leaves a city, toward a neighbour (as east/north offsets). */
  function gateXZ(c, other) {
    const t = towards(c.d, other.d);
    const e = t.x * c.f.east.x + t.y * c.f.east.y + t.z * c.f.east.z,
      n = t.x * c.f.north.x + t.y * c.f.north.y + t.z * c.f.north.z;
    return [e * (WALL + 3), n * (WALL + 3)];
  }

  /* ---- city lights at night, and a beacon to find each city from orbit ---------------------------- */
  const glowTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g2 = cv.getContext("2d");
    const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  function makeLights(c) {
    if (c.lights) {
      scene.remove(c.lights, c.beacon);
      c.lights.material.dispose();
      c.beacon.material.dispose();
    }
    const lm = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc66a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    c.lights = new THREE.Sprite(lm);
    c.lights.position.copy(ground(c.d, 4));
    c.lights.scale.setScalar(26 + cityLevel(c) * 3);
    const bm = new THREE.SpriteMaterial({ map: glowTex, color: ownerColor(c.owner), transparent: true, depthWrite: false, opacity: 0 });
    c.beacon = new THREE.Sprite(bm);
    c.beacon.position.copy(ground(c.d, 6));
    scene.add(c.lights, c.beacon);
  }

  /* ---- territory: each city's land, coloured on the globe right round the curve -------------------- */
  function paintTerritory() {
    const geo = globe.ground.geometry;
    const pos = geo.attributes.position,
      col = geo.attributes.color;
    if (!geo.userData.base) geo.userData.base = col.array.slice();
    const base = geo.userData.base;
    const tint = new THREE.Color(),
      cosT = Math.cos(TERRITORY / R),
      cosB = Math.cos((TERRITORY - 3) / R);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const l = Math.hypot(x, y, z);
      let best = null,
        bd = cosT;
      for (const c of T.cities) {
        const k = (c.d.x * x + c.d.y * y + c.d.z * z) / l;
        if (k > bd) (bd = k), (best = c);
      }
      let r = base[i * 3],
        gg = base[i * 3 + 1],
        b = base[i * 3 + 2];
      if (best) {
        tint.setHex(ownerColor(best.owner));
        // A soft wash inside, a strong line at the border.
        const edge = bd < cosB ? 0.55 : 0.16;
        r += (tint.r - r) * edge;
        gg += (tint.g - gg) * edge;
        b += (tint.b - b) * edge;
      }
      col.setXYZ(i, r, gg, b);
    }
    col.needsUpdate = true;
  }

  /* ---- citizens: little people walking the roads, when you're close enough to see them ------------- */
  const MAX_CITIZENS = 140;
  const citizenGeo = new THREE.CapsuleGeometry(0.28, 0.55, 3, 6).translate(0, 0.55, 0);
  const citizenMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const citizens = new THREE.InstancedMesh(citizenGeo, citizenMat, MAX_CITIZENS);
  citizens.frustumCulled = false;
  citizens.count = 0;
  scene.add(citizens);
  const walkers = []; // { city, from, to, t, speed }
  const citizenColor = new THREE.Color();
  function updateCitizens(dt, focus, alt) {
    if (alt > 150) {
      citizens.count = 0;
      return;
    }
    // People for the cities near the camera: as many as the city has people (a few per thousand).
    const near = T.cities.filter((c) => arc(c.d, focus) < 70);
    let n = 0;
    for (const c of near) {
      const want = Math.min(16, 2 + Math.round(cityEconomy(c, ownerMods(c.owner)).pop / 2));
      const mine = walkers.filter((w) => w.city === c);
      for (let k = mine.length; k < want; k++) walkers.push(newWalker(c));
      for (const w of mine.slice(want)) walkers.splice(walkers.indexOf(w), 1);
    }
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i];
      if (!near.includes(w.city)) {
        walkers.splice(i, 1);
        continue;
      }
      w.t += (dt * w.speed) / Math.max(1, Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z));
      if (w.t >= 1) Object.assign(w, nextLeg(w.city, w.to), { t: 0 });
      if (n >= MAX_CITIZENS) continue;
      const x = w.from.x + (w.to.x - w.from.x) * w.t,
        z = w.from.z + (w.to.z - w.from.z) * w.t;
      const d = offsetDir(w.city.d, x + w.side, z, w.city.f);
      const fwd = towards(d, offsetDir(w.city.d, w.to.x, w.to.z, w.city.f));
      globe.surfaceMatrix(d, fwd, Math.abs(Math.sin(w.t * 40)) * 0.08, M, 1);
      citizens.setMatrixAt(n, M);
      citizens.setColorAt(n, citizenColor.setHex(w.city.owner === YOU ? (o.record?.colors?.base ?? myColors.accent) : ownerColor(w.city.owner)));
      n++;
    }
    citizens.count = n;
    citizens.instanceMatrix.needsUpdate = true;
    if (citizens.instanceColor) citizens.instanceColor.needsUpdate = true;
  }
  /** People go between the hall and the buildings (along the roads), and stroll the plaza. */
  function stops(c) {
    const s = [{ x: 0, z: 0 }];
    c.plots.forEach((role, k) => role && s.push(plotXZ(k)));
    for (let k = 0; k < c.turrets; k++) s.push({ x: turretXZ(k).x * 0.8, z: turretXZ(k).z * 0.8 });
    return s;
  }
  function nextLeg(c, from) {
    const s = stops(c);
    const atHall = Math.hypot(from.x, from.z) < 1;
    const to = atHall ? s[1 + Math.floor(Math.random() * Math.max(1, s.length - 1))] || { x: 3, z: 3 } : { x: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 };
    return { from: { ...from }, to: { ...to } };
  }
  function newWalker(c) {
    const s = stops(c);
    const from = s[Math.floor(Math.random() * s.length)];
    return { city: c, ...nextLeg(c, from), t: Math.random(), speed: 1.2 + Math.random() * 0.8, side: (Math.random() - 0.5) * 0.9 };
  }

  /* ---- spice geysers ------------------------------------------------------------------------------ */
  spiceDirs.forEach((d, i) => {
    const saved = save?.geysers[i];
    // Each geyser has its richness from the planet's seed, so it's the same every time you play it.
    const rich = geyserRichness(mulberry((seed ^ (i * 2654435761)) >>> 0)());
    T.geysers.push({ id: i, d, rich, level: saved?.level || 1, owner: saved ? saved.owner : null, hp: saved ? saved.hp : 1, group: null });
  });
  function buildGeyser(gz) {
    if (gz.group) {
      gz.flagMat?.dispose();
      scene.remove(gz.group);
    }
    const g = new THREE.Group();
    stand(g, gz.d);
    // Richer geysers are wider; better derricks are taller, with a tank for each level.
    const vent = new THREE.Mesh(sharedGeo.vent, sharedMat.vent);
    vent.position.y = 0.4;
    vent.scale.set(0.7 + gz.rich * 0.35, 1, 0.7 + gz.rich * 0.35);
    g.add(vent);
    if (gz.owner) {
      const tower = new THREE.Mesh(sharedGeo.derrick, sharedMat.derrick);
      tower.position.y = 3 * (0.85 + gz.level * 0.15);
      tower.scale.setScalar(0.85 + gz.level * 0.15);
      g.add(tower);
      for (let k = 1; k < gz.level; k++) {
        const tank = new THREE.Mesh(sharedGeo.vent, sharedMat.derrick);
        tank.position.set(k === 1 ? 1.6 : -1.6, 0.9, 0.6);
        tank.scale.set(0.8, 2.2, 0.8);
        g.add(tank);
      }
      gz.flagMat = plain(ownerColor(gz.owner), { side: THREE.DoubleSide });
      const flag = new THREE.Mesh(sharedGeo.flag, gz.flagMat);
      flag.position.set(0.7, 5, 0);
      g.add(flag);
      gz.plume = null;
    } else {
      gz.plume = new THREE.Mesh(sharedGeo.plume, sharedMat.plume);
      gz.plume.position.y = 3;
      g.add(gz.plume);
    }
    gz.group = g;
    scene.add(g);
  }

  /* ---- vehicles ------------------------------------------------------------------------------------ */
  const vehicleDesign = (owner, key) => {
    const [role, mode, extra] = key.split(":");
    if (owner === YOU) return T.designs.vehicle[key] || T.designs.vehicle[role + ":" + mode];
    // Rival nations build from the ready-made classes ("military:land:artillery").
    return starterVehicle(role, mode, nationOf(owner)?.colors, extra);
  };
  /** Where a new vehicle appears for a city: boats at its anchorage, others by its gate. */
  function startFor(city, mode) {
    if (mode === "sea" && city.anchor) return city.anchor;
    const a = Math.random() * TAU;
    const d = offsetDir(city.d, Math.cos(a) * (WALL + 3), Math.sin(a) * (WALL + 3), city.f);
    return mode === "land" && !planet.isLand(d) ? offsetDir(city.d, Math.cos(a) * 6, Math.sin(a) * 6, city.f) : d;
  }
  function spawnVehicle(owner, key, city, d = null, hpFrac = 1) {
    const design = vehicleDesign(owner, key);
    const unit = vehicleUnit(design, unitMods(owner));
    const [role, mode] = key.split(":");
    const start = d || startFor(city, mode);
    const model = buildDesignMesh(design, { materials: matsFor(design.colors) });
    model.root.scale.setScalar(SCALE.vehicle);
    const ring = new THREE.Mesh(sharedGeo.ring, owner === YOU ? sharedMat.sel : sharedMat.foe);
    ring.visible = false;
    ring.renderOrder = 5;
    const g = new THREE.Group();
    g.add(model.root, ring);
    scene.add(g);
    const v = { id: nextVehicleId++, owner, key, role, mode, unit, model, group: g, ring, d: start, fwd: towards(start, city.d), lift: 0, hp: unit.hp * hpFrac, home: city.id, order: null, cool: 0, bob: Math.random() * 10, dead: false, route: null };
    if (Math.abs(v.fwd.x) + Math.abs(v.fwd.y) + Math.abs(v.fwd.z) < 1e-6) v.fwd = frameAt(start).north;
    T.vehicles.push(v);
    placeVehicle(v, 0);
    return v;
  }
  function removeVehicle(v) {
    v.dead = true;
    v.model.dispose();
    scene.remove(v.group);
    T.selected.delete(v);
    T.vehicles = T.vehicles.filter((x) => x !== v);
    if (cam.follow === v) cam.follow = null;
  }
  const vehiclesOf = (owner) => T.vehicles.filter((v) => v.owner === owner && !v.dead);
  const vehicleCap = (owner) => VEHICLES_PER_CITY * citiesOf(owner).length;
  /** The world position of a vehicle (for shots and labels). */
  const vehiclePos = (v, lift = 1.2, out = new THREE.Vector3()) => ground(v.d, v.lift + lift, out);

  /* ---- effects: shots, explosions, pops ----------------------------------------------------------------- */
  const shots = [];
  const shotMat = { you: new THREE.LineBasicMaterial({ color: 0xfff1a8 }), foe: new THREE.LineBasicMaterial({ color: 0xff7b5c }), faith: new THREE.LineBasicMaterial({ color: 0xc9b5ff, transparent: true, opacity: 0.7 }), trade: new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7 }) };
  function shot(a, b, kind) {
    const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const line = new THREE.Line(geo, shotMat[kind]);
    scene.add(line);
    shots.push({ line, t: kind === "faith" || kind === "trade" ? 0.35 : 0.12 });
  }
  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      if ((shots[i].t -= dt) > 0) continue;
      scene.remove(shots[i].line);
      shots[i].line.geometry.dispose();
      shots.splice(i, 1);
    }
  }
  /* ---- explosions --------------------------------------------------------------------------------- */
  const booms = [];
  function boom(p, size = 6) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m);
    s.position.copy(p);
    scene.add(s);
    booms.push({ s, t: 0, size });
  }
  function updateBooms(dt) {
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      b.t += dt / 0.7;
      b.s.scale.setScalar(b.size * (0.4 + b.t * 1.6));
      b.s.material.opacity = Math.max(0, 1 - b.t);
      if (b.t >= 1) {
        scene.remove(b.s);
        b.s.material.dispose();
        booms.splice(i, 1);
      }
    }
  }

  /* ---- projectiles: shells, tracers, artillery, missiles, bombs, torpedoes, flak --------------------- */
  const projectiles = createProjectiles(scene, {
    glowTex,
    onBlast: (p, size, burst) => {
      // Flak bursts in the air; everything else blows up where it lands.
      if (cam.salt < 420) boom(p, burst ? size * 0.8 : size);
    },
  });
  /** Where a vehicle is now, for a shot to home in on (null once it's gone). */
  function aimAt(v) {
    const out = new THREE.Vector3();
    return () => (v.dead ? null : vehiclePos(v, 1.2, out));
  }

  /* ---- HUD ------------------------------------------------------------------------------------------ */
  // The look lives in civ/civ-ui.css (the Civilization Stage's design system); the icons in ./icons.js.
  installIcons();
  const thumbs = createThumbs(o.renderer);
  const calm = () => !!o.reducedMotion?.() || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hud = document.createElement("div");
  hud.className = "tribeHUD civHUD";
  hud.dataset.zoom = "city";
  hud.innerHTML = `
    <div class="trTop">
      <div class="trBox cvRes">
        <b class="trName" id="cvName"></b>
        <div class="trStats">
          <button class="cvEcon cvPill money" id="cvEcon" aria-label="Economy: money, spice and the spice market"><i class="cvPillIc">${ico("money")}</i><b id="cvMoney">0</b><small id="cvIncome"></small><span class="cvDelta" id="cvMoneyDelta"></span></button>
          <button class="cvPill spice" id="cvSpiceBtn" aria-label="Spice: open the spice market"><i class="cvPillIc">${ico("spice")}</i><b id="cvSpice">0</b><span class="cvDelta" id="cvSpiceDelta"></span></button>
          <button class="cvPill cities" id="cvCitiesBtn" aria-label="Cities you hold: see the world"><i class="cvPillIc">${ico("city")}</i><b id="cvCities">0</b></button>
          <span class="cvPill vehicles" title="Vehicles"><i class="cvPillIc">${ico("vehicle")}</i><b id="cvVeh">0</b></span>
        </div>
      </div>
      <button class="trIcon cvRound" id="cvMenu" aria-label="Menu" title="Menu">${ico("menu")}</button>
    </div>
    <div class="trGoal" id="cvGoal" role="status" aria-live="polite"></div>
    <div class="trTribes cvNations" id="cvNations" role="list" aria-label="Rival nations"></div>
    <div class="trMarks" id="cvMarks" aria-hidden="true"></div>
    <div class="cvMini" id="cvMiniWrap"><canvas id="cvMini" width="300" height="300" role="img" aria-label="Planet minimap: tap to look there"></canvas><button class="cvMiniFold" id="cvMiniFold" aria-label="Hide the minimap" aria-pressed="false">${ico("planet")}</button></div>
    <div class="trToast" id="cvToast" role="status" aria-live="polite"></div>
    <div class="cvNotes" id="cvNotes" role="log" aria-live="polite" aria-label="News and messages"></div>
    <div class="trPlace" id="cvTarget" hidden role="status" aria-live="polite"><span id="cvTargetText"></span><button id="cvTargetCancel">Cancel</button></div>
    <div class="cvPeek" id="cvPeek" hidden role="dialog" aria-label="Selected place"></div>
    <div class="trSheet" id="cvSheet" hidden role="dialog"></div>
    <div class="cvBoxRect" id="cvBoxRect" hidden></div>
    <div class="trBottom">
      <div class="cvOrders" id="cvOrders" hidden>
        <div class="cvSelInfo" id="cvSelInfo" aria-live="polite"></div>
        <div class="cvCmds" role="toolbar" aria-label="Orders for the selected vehicles">
          <button data-cmd="guard" aria-label="Guard: hold this spot and fight anything that comes near">${ico("guard")}<small>Guard</small></button>
          <button data-cmd="patrol" aria-label="Patrol: tap a place to patrol between there and here">${ico("patrol")}<small>Patrol</small></button>
          <button data-cmd="formation" aria-label="Change formation">${ico("formation")}<small id="cvFormName">Line</small><span class="cvFormIc" id="cvFormIcon" aria-hidden="true"></span></button>
          <button data-cmd="follow" aria-label="Follow with the camera">${ico("follow")}<small>Follow</small></button>
          <button data-cmd="stop" aria-label="Stop: cancel their orders">${ico("stop")}<small>Stop</small></button>
          <button data-cmd="clear" aria-label="Deselect">${ico("deselect")}<small>Deselect</small></button>
        </div>
      </div>
      <div class="cvUnitRow">
        <button class="trUnit cvBox" id="cvBox" aria-pressed="false" aria-label="Box select: drag a box around your vehicles to select them" title="Box select">${ico("box")}</button>
        <div class="trUnits" id="cvUnits" role="list" aria-label="Your vehicles"></div>
      </div>
      <div class="trActions cvActions">
        <button id="cvAll" aria-label="Select every vehicle">${ico("all")}<small>All</small></button>
        <button id="cvHome" aria-label="Go to your capital">${ico("capital")}<small>Capital</small></button>
        <button id="cvGlobe" aria-label="See the whole planet, or come back down">${ico("planet")}<small id="cvGlobeLabel">Planet</small></button>
        <button id="cvCity" aria-label="Manage the nearest of your cities">${ico("build")}<small>Build</small></button>
        <button id="cvDesigns" aria-label="Design buildings and vehicles">${ico("designs")}<small>Designs</small></button>
        <button id="cvSuper" aria-label="Superweapon">${ico("super")}<small>Super</small></button>
      </div>
    </div>
    <div class="trMenuPanel" id="cvMenuPanel" hidden>
      <button id="cvResume" class="primary">${ico("play")} Resume</button>
      <button id="cvDesignsMenu">${ico("designs")} Designs</button>
      <button id="cvMessages">${ico("mail")} Messages</button>
      <button id="cvWorld">${ico("world")} The world</button>
      <button id="cvHistory">${ico("history")} Species history</button>
      <button id="cvSettings">${ico("gear")} Settings</button>
      <button id="cvHelp">${ico("help")} How to play</button>
    </div>
    <div class="cvVictory" id="cvVictory" hidden role="dialog" aria-label="The world is united"></div>`;
  document.body.appendChild(hud);
  const $h = (q) => hud.querySelector(q);
  $h("#cvName").textContent = o.name;
  let toastT = 0;
  /** A quick hint: a small speech-bubble ribbon under the top bar. World events use notify() instead. */
  function toast(text, seconds = 3) {
    const el = $h("#cvToast");
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    toastT = seconds;
  }
  /** Leader portraits: the nation's species, drawn once. */
  const portraits = new Map();
  const portraitOf = (n) => {
    if (!portraits.has(n)) portraits.set(n, (o.portrait && n.species?.record && o.portrait(n.species.record)) || "");
    return portraits.get(n);
  };
  /* -- notifications: small illustrated cards from the world (news, messages, attacks). Tap to look. -- */
  const notes = [];
  let noteId = 1;
  /**
   * @param {{ text:string, title?:string, icon?:string, nation?:object, level?:"info"|"good"|"warn"|"danger", act?:Function, actLabel?:string, seconds?:number, key?:string }} n
   */
  function notify(n) {
    // One card per key (a city under attack doesn't stack up a card a second).
    if (n.key) {
      const old = notes.find((x) => x.key === n.key);
      if (old) dropNote(old, true);
    }
    const level = n.level || "info";
    const el = document.createElement("div");
    el.className = "cvNote " + level;
    el.setAttribute("role", "status");
    const pic = n.nation ? portraitOf(n.nation) : "";
    const face = n.nation ? (pic ? `<img src="${pic}" alt="">` : CITY_TYPES[n.nation.type].icon) : n.icon && n.icon.startsWith("<") ? n.icon : esc(n.icon || "📰");
    el.innerHTML = `<span class="cvNoteFace"${n.nation ? ` style="--nc:${hex(n.nation.color)}"` : ""}>${face}</span>
      <span class="cvNoteText">${n.title ? `<b>${esc(n.title)}</b>` : ""}<span>${esc(n.text)}</span></span>
      ${n.act ? `<button class="cvNoteGo">${esc(n.actLabel || "Look")}</button>` : ""}<button class="cvNoteX" aria-label="Dismiss">${ico("close")}</button>`;
    const note = { id: noteId++, el, key: n.key, t: n.seconds ?? (level === "danger" ? 9 : level === "warn" ? 7 : 5.5) };
    el.querySelector(".cvNoteX").onclick = () => dropNote(note);
    if (n.act) {
      const go = () => {
        dropNote(note);
        o.sfx("uiSelect");
        n.act();
      };
      el.querySelector(".cvNoteGo").onclick = go;
      el.querySelector(".cvNoteText").onclick = go;
    }
    $h("#cvNotes").prepend(el);
    notes.unshift(note);
    while (notes.length > 3) dropNote(notes[notes.length - 1], true);
    o.sfx(level === "danger" ? "uiAlarm" : "uiNotify");
  }
  function dropNote(note, fast = false) {
    const i = notes.indexOf(note);
    if (i < 0) return;
    notes.splice(i, 1);
    if (fast || calm()) return note.el.remove();
    note.el.classList.add("out");
    setTimeout(() => note.el.remove(), 260);
  }
  function updateNotes(dt) {
    for (const n of [...notes]) if ((n.t -= dt) <= 0) dropNote(n);
  }
  const seenTips = new Set();
  const tipOnce = (key, text, s = 4.5) => {
    if (seenTips.has(key)) return;
    seenTips.add(key);
    toast(text, s);
  };
  const v3s = new THREE.Vector3();
  /** Screen position of a world point; `on` is false behind the camera or behind the planet. */
  function project(p) {
    const facing = v3s.copy(camera.position).sub(p).dot(p) > 0;
    v3s.copy(p).project(camera);
    return { x: (v3s.x * 0.5 + 0.5) * innerWidth, y: (-v3s.y * 0.5 + 0.5) * innerHeight, on: facing && v3s.z < 1 && v3s.z > -1 };
  }
  const projectDir = (d, lift = 0) => project(ground(d, lift));
  function popAt(d, lift, text, cls = "") {
    const p = projectDir(d, lift);
    if (!p.on) return;
    const el = document.createElement("div");
    el.className = "trPop " + cls;
    el.textContent = text;
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    $h("#cvMarks").appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /* ---- orders -------------------------------------------------------------------------------------------- */
  /** Whether a vehicle can get to a place at all: land stays on its continent, boats on their ocean. */
  function reachable(v, d, city = null) {
    if (v.mode === "air") return true;
    if (v.mode === "sea") {
      if (city) return !!city.anchor && city.ocean === (v.ocean ??= planet.region("sea", v.d));
      return planet.region("sea", d) === (v.ocean ??= planet.region("sea", v.d));
    }
    if (city) return city.landmass === (v.landmass ??= planet.region("land", v.d));
    return planet.region("land", d) === (v.landmass ??= planet.region("land", v.d));
  }
  const reachCity = (v, c) => reachable(v, c.d, c);
  /* ---- formations: where each vehicle of a group goes ---------------------------------------------- */
  const FORMATIONS = {
    line: { name: "Line", icon: "▤", hint: "side by side, facing the way they're going: the most guns forward" },
    wedge: { name: "Wedge", icon: "◭", hint: "an arrowhead: the lead vehicle takes the first hits" },
    ring: { name: "Ring", icon: "◯", hint: "a circle round the spot: holds ground from every side" },
  };
  let formation = "line";
  /** Spots for `list` around `d`, in the current formation, facing the way the group travels. */
  function formationSpots(list, d) {
    if (list.length < 2) return list.map(() => d);
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const v of list) (cx += v.d.x), (cy += v.d.y), (cz += v.d.z);
    const centre = { x: cx, y: cy, z: cz };
    const n = arc(norm3(centre), d) > 2 ? towards(d, norm3(centre)) : frameAt(d).north;
    // Facing: away from where they come from.
    const north = { x: -n.x, y: -n.y, z: -n.z };
    const east = { x: north.y * d.z - north.z * d.y, y: north.z * d.x - north.x * d.z, z: north.x * d.y - north.y * d.x };
    const f = { up: d, north, east };
    const gap = 4.5;
    const spots = list.map((v, i) => {
      let x = 0,
        z = 0;
      if (formation === "line") x = (i - (list.length - 1) / 2) * gap;
      else if (formation === "wedge") {
        const k = Math.ceil(i / 2);
        x = (i % 2 ? -1 : 1) * k * gap * 0.8;
        z = -k * gap * 0.8;
      } else {
        const r = Math.max(5, (list.length * gap) / (2 * Math.PI));
        const a = (i / list.length) * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
      return offsetDir(d, x, z, f);
    });
    // Each vehicle takes the free spot nearest to it (so they don't cross over each other).
    const out = new Array(list.length);
    const free = spots.map((_, i) => i);
    list.forEach((v, i) => {
      let best = 0;
      for (let k = 1; k < free.length; k++) if (arc(v.d, spots[free[k]]) < arc(v.d, spots[free[best]])) best = k;
      out[i] = spots[free.splice(best, 1)[0]];
    });
    // A spot a vehicle can't stand on (a boat's spot on land) falls back to the middle.
    return out.map((sp, i) => ((list[i].mode === "land" && !planet.isLand(sp)) || (list[i].mode === "sea" && planet.isLand(sp)) ? d : sp));
  }
  const norm3 = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  function orderTo(list, order) {
    let refused = 0,
      sent = 0;
    for (const v of list) {
      if (v.dead || v.owner !== YOU) continue;
      const ok = order.type === "city" ? reachCity(v, order.city) : order.type === "vehicle" ? hitMult(v.unit, order.target.mode) > 0 : reachable(v, order.d);
      if (!ok) {
        refused++;
        continue;
      }
      v.order = { ...order };
      v.route = null;
      sent++;
    }
    // Groups moving, guarding or patrolling take up the formation.
    const group = list.filter((v) => !v.dead && v.owner === YOU && v.order && (order.type === "move" || order.type === "guard" || order.type === "patrol") && v.order.d === order.d);
    if (group.length > 1) {
      const spots = formationSpots(group, order.d);
      group.forEach((v, i) => {
        v.order.d = spots[i];
        if (order.type === "patrol") v.order.b = spots[i];
      });
    }
    if (refused && order.type === "vehicle") toast(sent ? `${refused} of them can't fight ${order.target.mode === "air" ? "aircraft" : order.target.mode === "sea" ? "ships" : "land vehicles"}.` : `They can't fight ${order.target.mode === "air" ? "aircraft: build fighters, or add flak guns" : order.target.mode === "sea" ? "ships" : "land vehicles"}.`, 4);
    else if (refused) toast(sent ? `${refused} of them can't get there: land vehicles stay on their continent, boats on their sea.` : "They can't get there: land vehicles can't cross the sea. Build boats at a coastal city, or aircraft once you have " + AIR_AT + " cities.", 4.5);
    o.sfx("uiCommand");
    flash(order.type === "city" ? order.city.d : order.d, order.type === "city" ? 5 : 1);
  }
  const flashGeo = new THREE.RingGeometry(2.6, 3.2, 28).rotateX(-Math.PI / 2);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, depthWrite: false });
  let flashMesh = null,
    flashT = 0;
  function flash(d, s = 1) {
    if (!d) return;
    if (!flashMesh) {
      flashMesh = new THREE.Mesh(flashGeo, flashMat);
      scene.add(flashMesh);
    }
    stand(flashMesh, d, null, s, 0.3);
    flashT = 0.6;
  }

  /* ---- camera: from the whole planet down to street level, without a cut ------------------------------
     The camera looks at a point on the surface (`f`, with `n` the way that's "up" on screen). High up it
     looks straight down at the planet; coming down it tilts toward the horizon, so a city is seen in 3D. */
  const cam = { f: HOME, n: frameAt(HOME).north, alt: ALT.city * 1.6, sf: HOME, sn: frameAt(HOME).north, salt: ALT.city * 1.6, follow: null };
  const tangentize = (n, f) => {
    const k = n.x * f.x + n.y * f.y + n.z * f.z;
    const t = { x: n.x - f.x * k, y: n.y - f.y * k, z: n.z - f.z * k };
    const l = Math.hypot(t.x, t.y, t.z);
    return l > 1e-6 ? { x: t.x / l, y: t.y / l, z: t.z / l } : frameAt(f).north;
  };
  const nlerp = (a, b, k) => {
    const x = a.x + (b.x - a.x) * k,
      y = a.y + (b.y - a.y) * k,
      z = a.z + (b.z - a.z) * k;
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  };
  /** Fly the camera to a place (and a height). */
  function focusOn(d, alt = null) {
    cam.follow = null;
    cam.f = d;
    cam.n = tangentize(cam.n, d);
    if (alt) cam.alt = alt;
  }
  const pitchFor = (alt) => {
    const k = 1 - Math.max(0, Math.min(1, (alt - ALT.min) / (ALT.region - ALT.min)));
    return 1.02 * k ** 0.85;
  };
  const camTarget = new THREE.Vector3(),
    camUp = new THREE.Vector3();
  let arrive = o.intro === "arrive" && o.frame ? { t: 0, k: o.reducedMotion?.() ? 1 / 0.6 : 1, frame: o.frame, titled: false } : null;
  if (!arrive) o.frame?.remove();
  else {
    o.frame.title(false);
    hud.classList.add("cine"); // the city labels and buttons come in once the camera has landed
    cam.salt = ALT.max;
  }
  function placeCamera(dt) {
    if (cam.follow && !cam.follow.dead) cam.f = cam.follow.d;
    const k = 1 - Math.exp(-dt * 7);
    cam.sf = nlerp(cam.sf, cam.f, k);
    cam.n = tangentize(cam.n, cam.f);
    cam.sn = tangentize(nlerp(cam.sn, cam.n, k), cam.sf);
    let alt = cam.salt + (cam.alt - cam.salt) * k;
    // Arriving from the Tribal Stage: down out of orbit onto the city where the village stood.
    if (arrive) {
      const a = arrive;
      a.t += dt * a.k;
      const end = CUTSCENES.civArrive.end;
      if (a.t > 0.15) a.frame.flash(false);
      if (a.t > 1.2 && !a.titled) {
        a.titled = true;
        a.frame.title(true, o.name || "Your nation", "Civilization Stage");
      }
      if (a.t > end - 1.2) a.frame.title(false);
      alt = mix(ALT.max, cam.alt, ease(span(a.t, 0.3, end)));
      if (a.t >= end) {
        a.frame.remove();
        arrive = null;
        hud.classList.remove("cine");
        a.after?.();
      }
    }
    cam.salt = alt;
    const p = pitchFor(alt);
    const up = cam.sf,
      n = cam.sn;
    ground(up, 0, camTarget);
    const cp = Math.cos(p),
      sp = Math.sin(p);
    camera.position.set(camTarget.x + (up.x * cp - n.x * sp) * alt, camTarget.y + (up.y * cp - n.y * sp) * alt, camTarget.z + (up.z * cp - n.z * sp) * alt);
    // Never inside a hill.
    const l = camera.position.length();
    const cd = { x: camera.position.x / l, y: camera.position.y / l, z: camera.position.z / l };
    const floor = R + Math.max(0, planet.height(cd)) + 4;
    if (l < floor) camera.position.multiplyScalar(floor / l);
    camUp.set(n.x * cp + up.x * sp, n.y * cp + up.y * sp, n.z * cp + up.z * sp);
    camera.up.copy(camUp);
    camera.lookAt(camTarget);
  }
  const clampAlt = () => (cam.alt = Math.max(ALT.min, Math.min(ALT.max, cam.alt)));
  /** Turn the planet under a screen drag of (dx, dy) pixels. */
  function dragBy(dx, dy) {
    cam.follow = null;
    const p = pitchFor(cam.salt);
    const wpp = (2 * cam.salt * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
    const f = cam.f,
      n = cam.n;
    const east = { x: n.y * f.z - n.z * f.y, y: n.z * f.x - n.x * f.z, z: n.x * f.y - n.y * f.x };
    // High up, the turn is in proportion to the planet's size on screen.
    const ax = Math.min(0.25, (dx * wpp) / R),
      ay = Math.min(0.25, (dy * wpp) / R / Math.max(0.45, Math.cos(p)));
    const nf = { x: f.x - east.x * ax + n.x * ay, y: f.y - east.y * ax + n.y * ay, z: f.z - east.z * ax + n.z * ay };
    const l = Math.hypot(nf.x, nf.y, nf.z);
    cam.f = { x: nf.x / l, y: nf.y / l, z: nf.z / l };
    cam.n = tangentize(n, cam.f);
  }
  /** Turn the view about the point you are looking at. */
  function twist(rad) {
    const f = cam.f,
      n = cam.n;
    const side = { x: f.y * n.z - f.z * n.y, y: f.z * n.x - f.x * n.z, z: f.x * n.y - f.y * n.x };
    const c = Math.cos(rad),
      s = Math.sin(rad);
    cam.n = tangentize({ x: n.x * c + side.x * s, y: n.y * c + side.y * s, z: n.z * c + side.z * s }, f);
  }

  /* ---- input: drag to turn the planet, pinch or scroll to zoom, twist with two fingers ---------------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function groundAt(px, py) {
    ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return globe.pick(ray.ray);
  }
  const pointers = new Map();
  let gesture = null;
  const onDown = (e) => {
    if (paused || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) gesture = { panned: false, pinch: 0, ang: null, box: boxMode || e.shiftKey };
    else if (pointers.size === 2 && gesture) {
      gesture.box = false; // two fingers: back to turning and zooming
      boxRect.hidden = true;
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.ang = Math.atan2(b.y - a.y, b.x - a.x);
      gesture.panned = true;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* already gone */
    }
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.pinch > 0 && d > 0) cam.alt *= gesture.pinch / d;
      gesture.pinch = d;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (gesture.ang != null) {
        let da = ang - gesture.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        twist(-da);
      }
      gesture.ang = ang;
      clampAlt();
      return;
    }
    if (!gesture.panned && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10) return;
    gesture.panned = true;
    if (gesture.box) {
      const x = Math.min(p.sx, e.clientX),
        y = Math.min(p.sy, e.clientY);
      Object.assign(boxRect.style, { left: x + "px", top: y + "px", width: Math.abs(e.clientX - p.sx) + "px", height: Math.abs(e.clientY - p.sy) + "px" });
      boxRect.hidden = false;
      gesture.rect = [x, y, x + Math.abs(e.clientX - p.sx), y + Math.abs(e.clientY - p.sy)];
      return;
    }
    dragBy(dx, dy);
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || !gesture) return;
    if (pointers.size === 0) {
      if (gesture.box && gesture.rect) boxSelect(gesture.rect);
      else if (!gesture.panned && e.type === "pointerup") tap(e.clientX, e.clientY);
      boxRect.hidden = true;
      gesture = null;
    } else if (pointers.size === 1) gesture.ang = null;
  };
  const onWheel = (e) => {
    if (paused || e.target !== canvas) return;
    e.preventDefault();
    cam.alt *= Math.exp(e.deltaY * 0.0014);
    clampAlt();
  };
  const keys = new Set();
  const onKey = (e) => {
    if (paused || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) return;
    if (e.key === "Escape") {
      if (pendingCmd || boxMode) {
        pendingCmd = null;
        setBoxMode(false);
        updateHUD();
      } else if (T.targeting) stopTargeting();
      else if (sheet) closeSheet();
      else T.selected.clear();
      return;
    }
    if (e.key.toLowerCase() === "a" && e.ctrlKey) {
      e.preventDefault();
      selectAll();
      return;
    }
    if (e.key.toLowerCase() === "f" && T.selected.size) {
      // Follow the first selected vehicle.
      cam.follow = [...T.selected][0];
      cam.alt = Math.min(cam.alt, ALT.city);
      return;
    }
    keys.add(e.key.toLowerCase());
  };
  const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
  const onContext = (e) => e.target === canvas && e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("contextmenu", onContext);

  function selectAll() {
    T.selected = new Set(vehiclesOf(YOU));
    o.sfx("uiSelect");
  }
  /** What is under a screen point: a vehicle, a city or a geyser (the nearest on screen), or the ground. */
  function pick(sx, sy) {
    let best = null,
      bestD = 34;
    if (cam.salt < 420)
      for (const v of T.vehicles) {
        if (v.dead) continue;
        const p = project(vehiclePos(v, 1.5));
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (p.on && d < bestD) (best = { type: "vehicle", v }), (bestD = d);
      }
    if (best) return best;
    const g = groundAt(sx, sy);
    // Cities: by their label on screen, or by tapping inside the walls.
    let bc = null,
      bcd = cam.salt > 200 ? 40 : 46;
    for (const c of T.cities) {
      const p = projectDir(c.d, 4);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (p.on && d < bcd) (bc = c), (bcd = d);
      if (!bc && g && arc(g, c.d) < WALL + 1) bc = c;
    }
    if (bc) return { type: "city", c: bc };
    for (const gz of T.geysers) if (g && arc(g, gz.d) < 7) return { type: "geyser", gz };
    return g ? { type: "ground", d: g } : null;
  }
  const boxRect = $h("#cvBoxRect");
  let boxMode = false;
  function setBoxMode(on) {
    boxMode = on;
    $h("#cvBox").setAttribute("aria-pressed", String(on));
    $h("#cvBox").classList.toggle("sel", on);
    if (on) tipOnce("box", "Box select: drag a box around your vehicles. Two fingers still turn and zoom.", 3.5);
  }
  /** Select your vehicles inside a screen rectangle (adding to the selection with Shift held). */
  function boxSelect([x0, y0, x1, y1]) {
    const inside = vehiclesOf(YOU).filter((v) => {
      const p = project(vehiclePos(v, 1.2));
      return p.on && p.x >= x0 - 6 && p.x <= x1 + 6 && p.y >= y0 - 6 && p.y <= y1 + 6;
    });
    if (!keys.has("shift")) T.selected.clear();
    inside.forEach((v) => T.selected.add(v));
    o.sfx("uiSelect");
    toast(inside.length ? `${inside.length} vehicle${inside.length === 1 ? "" : "s"} selected.` : "No vehicles of yours in that box.", 2);
    if (boxMode) setBoxMode(false);
    updateHUD();
  }
  let lastTap = null;
  let pendingCmd = null;
  function tap(sx, sy) {
    $h("#cvMenuPanel").hidden = true;
    const hit = pick(sx, sy);
    if (T.targeting) {
      if (hit?.type === "city") fireSuper(hit.c);
      return;
    }
    if (!hit) return;
    const sel = [...T.selected].filter((v) => !v.dead);
    if (pendingCmd === "patrol" && sel.length && hit.type !== "vehicle") {
      pendingCmd = null;
      const d = hit.type === "city" ? offsetDir(hit.c.d, 0, -(WALL + 5), hit.c.f) : hit.type === "geyser" ? hit.gz.d : hit.d;
      orderTo(sel, { type: "patrol", d, b: d, leg: false });
      sel.forEach((v) => v.order?.type === "patrol" && (v.order.a = v.d));
      toast("Patrolling: they'll go back and forth, fighting anything hostile on the way.", 3);
      return;
    }
    pendingCmd = null;
    if (hit.type === "vehicle") {
      if (hit.v.owner === YOU) {
        // Double tap: every vehicle of that class on screen.
        const now = performance.now();
        if (lastTap && lastTap.v === hit.v && now - lastTap.t < 380) {
          const same = vehiclesOf(YOU).filter((v) => v.unit.cls === hit.v.unit.cls && project(vehiclePos(v, 1.2)).on);
          same.forEach((v) => T.selected.add(v));
          toast(`${same.length} × ${clsOf(hit.v.unit)?.name || "vehicle"} selected.`, 2);
          lastTap = null;
          updateHUD();
          return;
        }
        lastTap = { v: hit.v, t: now };
        if (T.selected.has(hit.v)) T.selected.delete(hit.v);
        else T.selected.add(hit.v);
        o.sfx("uiSelect");
      } else if (sel.some((v) => v.role === "military")) {
        orderTo(
          sel.filter((v) => v.role === "military"),
          { type: "vehicle", target: hit.v, d: hit.v.d },
        );
        declareOn(hit.v.owner, "Your vehicles attacked theirs");
      } else toast(`${clsOf(hit.v.unit) ? "A " + clsOf(hit.v.unit).name.toLowerCase() : `A ${CITY_TYPES[hit.v.role].name.toLowerCase()} vehicle`} of the ${ownerName(hit.v.owner)}${clsOf(hit.v.unit) ? ": " + clsOf(hit.v.unit).good : ""}.`, 3.5);
      return;
    }
    if (hit.type === "city") {
      const c = hit.c;
      if (sel.length && c.owner !== YOU) return orderTo(sel, { type: "city", city: c });
      if (sel.length && c.owner === YOU && sheet?.city !== c) return orderTo(sel, { type: "move", d: offsetDir(c.d, 0, -(WALL + 5), c.f) });
      // Far out, tapping a city takes you to it; either way a small card says what it is.
      if (cam.salt > 260) focusOn(c.d, ALT.city * 1.6);
      if (sheet) closeSheet();
      openPeek({ kind: "city", c });
      return;
    }
    if (hit.type === "geyser") {
      if (sel.length) return orderTo(sel, { type: "geyser", geyser: hit.gz, d: hit.gz.d });
      if (sheet) closeSheet();
      return openPeek({ kind: "geyser", g: hit.gz });
    }
    if (sel.length) orderTo(sel, { type: "move", d: hit.d });
    else if (sheet) closeSheet();
    else if (peekOn) closePeek();
  }
  /* ---- diplomacy: leaders, what they say, and what comes of it ---------------------------------- */
  /** Military strength: what a nation's armed vehicles can do, plus the turrets on its walls. */
  function militaryPower(owner) {
    let p = 0;
    for (const v of T.vehicles) if (!v.dead && v.owner === owner && v.role === "military") p += v.unit.dps * Math.sqrt(v.unit.hp) * 0.25;
    for (const c of T.cities) if (c.owner === owner) p += c.turrets * c.turretHp * 3;
    return Math.round(p * 10) / 10;
  }
  /** How devout your nation is: temples, and religious cities. */
  const yourFaith = () => yourCities().reduce((s, c) => s + c.plots.filter((p) => p === "temple").length * 2 + (c.type === "religious" ? 2 : 0), 0);
  const namesFor = (n) => ({ you: o.name || "your nation", them: n.name, heritage: heritageRemark(o.heritage, n.personality) });
  const leaderLine = (n) => warLine(n);
  const warLine = (n) => ({ aggressive: `Enough talk. The ${n.name} march on ${o.name || "you"}!`, friendly: "You leave us no choice. It is war.", greedy: "You've cost us too much. This is war.", religious: `The heretics must be stopped. War!`, cautious: "We have weighed it, and we must fight. War." })[n.personality] || "War.";
  /** Whether you and a nation have come across each other: your cities or vehicles near theirs. */
  function seenBy(n) {
    const theirs = [...citiesOf(n.id).map((c) => c.d), ...vehiclesOf(n.id).map((v) => v.d)];
    const mine = [...yourCities().map((c) => c.d), ...vehiclesOf(YOU).map((v) => v.d)];
    return theirs.some((a) => mine.some((b) => arc(a, b) < 110));
  }
  /** The cheapest of a nation's cities it would sell (never its last). */
  function cityForSale(n) {
    const list = citiesOf(n.id);
    if (list.length < 2) return null;
    return list
      .slice(1)
      .map((c) => ({ c, price: cityPrice(cityEconomy(c, {}), { personality: n.personality, relation: n.relation }) }))
      .sort((a, b) => a.price - b.price)[0];
  }
  function commsCtx(n, extra = {}) {
    const sale = cityForSale(n);
    return {
      personality: n.personality,
      relation: n.relation,
      war: n.war,
      met: n.met,
      allied: n.allied,
      pact: n.pact,
      power: militaryPower(n.id),
      yourPower: militaryPower(YOU),
      money: n.money,
      yourMoney: T.money,
      faith: yourFaith(),
      cities: citiesOf(n.id).length,
      now: T.time,
      assistAt: n.assistAt,
      beliefsAt: n.beliefsAt,
      cityPrice: sale?.price || 0,
      forces: n.allied && yourCities().length ? helpersOf(n).length : 0,
      ...extra,
    };
  }
  /** The record of what's been said (shown in the conversation's history, and under 📜 Messages). */
  function logTalk(n, who, text, summary = "") {
    n.log.push({ t: Math.round(T.time), who, text, summary });
    if (n.log.length > 30) n.log.splice(0, n.log.length - 30);
  }
  /* -- messages leaders send you: one waiting per nation; left too long, it's taken as a no -- */
  const inbox = [];
  let lastPost = 0;
  const inboxOf = (n) => inbox.find((m) => m.n === n);
  function post(n, msg, urgent = false) {
    if (inboxOf(n)) inbox.splice(inbox.indexOf(inboxOf(n)), 1);
    inbox.push({ n, msg, until: T.time + MESSAGE_TTL });
    lastPost = T.time;
    logTalk(n, "them", msg.text);
    // A card from the leader: their face, who they are, what they want, and a way to answer.
    notify({
      nation: n,
      title: urgent ? `War! The ${n.name} attack you` : `${n.leader.title} ${n.leader.name} · the ${n.name}`,
      text: msg.text,
      level: urgent ? "danger" : msg.kind === "joinWar" || msg.kind === "demand" ? "warn" : "info",
      act: () => openSheet("nation", { nation: n }),
      actLabel: msg.kind === "notice" && !urgent ? "Read" : "Answer",
      seconds: urgent ? 10 : 8,
      key: "msg:" + n.id,
    });
    updateHUD();
  }
  function reply(n, choiceId) {
    const m = inboxOf(n);
    if (!m) return;
    inbox.splice(inbox.indexOf(m), 1);
    if (m.msg.kind === "notice") {
      if (choiceId === "talk") openSheet("nation", { nation: n });
      else closeSheet();
      return;
    }
    if (m.msg.kind === "joinWar") {
      const foe = nationOf(m.msg.enemy);
      const yes = choiceId === "accept" && foe?.alive;
      logTalk(n, "you", yes ? `We stand with you against the ${foe.name}.` : "We'll stay out of it.");
      if (yes) {
        applyEffects(foe, { war: true });
        n.relation = nudge(n.relation, 15);
      } else n.relation = nudge(n.relation, -8);
      const r = { accept: yes, delta: yes ? 15 : -8, text: yes ? "Thank you, friend. Together!" : "We will remember who stood by us.", summary: yes ? `War with the ${foe?.name}. Relations with the ${n.name} +15.` : "Relations −8." };
      pendingReact = yes ? "yes" : "annoyed";
      o.sfx(yes ? "uiYes" : "uiNo");
      logTalk(n, "them", r.text, r.summary);
      sheet = { kind: "nation", nation: n, reply: r };
      renderSheet();
      return;
    }
    const r = { ...answer(m.msg, choiceId, commsCtx(n), namesFor(n)), accept: choiceId === "accept" };
    const label = m.msg.choices.find((c) => c.id === choiceId)?.label || "";
    const before = n.relation;
    logTalk(n, "you", label.replace(/^\S+\s/, ""));
    applyEffects(n, r.effects);
    logTalk(n, "them", r.text, r.summary);
    r.delta = Math.round(n.relation - before);
    pendingReact = r.delta > 0 || r.accept ? "yes" : r.delta < -10 ? "angry" : "annoyed";
    o.sfx(r.delta >= 0 ? "uiYes" : "uiNo");
    sheet = { kind: "nation", nation: n, reply: r };
    renderSheet();
  }
  /** Messages nobody answered: silence is an answer. */
  function updateInbox() {
    for (const m of [...inbox])
      if (T.time > m.until) {
        inbox.splice(inbox.indexOf(m), 1);
        if (m.msg.kind === "notice") continue;
        if (m.msg.kind === "joinWar") {
          m.n.relation = nudge(m.n.relation, -8);
          logTalk(m.n, "them", "(No answer.) We will remember who stood by us.", "Relations −8.");
          continue;
        }
        const r = silence(m.msg, commsCtx(m.n), namesFor(m.n));
        applyEffects(m.n, r.effects);
        logTalk(m.n, "them", "(No answer.) " + r.text, r.summary);
        if (sheet?.nation === m.n) renderSheet();
      }
  }
  /** Say something to a leader (an option from the conversation). */
  function talk(n, option) {
    const ctx = commsCtx(n);
    const opt = availableOptions(ctx).find((x) => x.id === option);
    if (!opt) return;
    if (!opt.ok) return toast(opt.why);
    const sale = option === "buy" ? cityForSale(n) : null;
    const r = respond(option, ctx, Math.random, namesFor(n));
    const before = n.relation;
    logTalk(n, "you", opt.name + (sale ? ` (${sale.c.name}, §${sale.price})` : ""));
    applyEffects(n, r.effects, sale?.c);
    logTalk(n, "them", r.text, r.summary);
    r.delta = Math.round(n.relation - before);
    // The leader acts out the answer: delighted, put out, scared or furious.
    pendingReact = option === "war" ? "angry" : option === "threaten" ? (r.accept ? "scared" : "angry") : option === "demand" ? (r.accept ? "scared" : "annoyed") : r.accept ? "yes" : "no";
    o.sfx(r.accept && option !== "war" ? "uiYes" : "uiNo");
    sheet = { kind: "nation", nation: n, reply: r };
    renderSheet();
  }
  /** Make what was agreed (or threatened) real. */
  function applyEffects(n, e, city = null) {
    if (e.met) n.met = true;
    if (e.relation) n.relation = nudge(n.relation, e.relation);
    if (e.money) {
      T.money += e.money;
      n.money = Math.max(0, n.money - e.money);
    }
    if (e.allied) {
      n.allied = true;
      chronicle({ key: "civ:ally:" + n.id, stage: "civ", icon: "🛡", text: "Allied with the " + n.name + " nation." });
    }
    if (e.pact) {
      n.pact = true;
      chronicle({ key: "civ:pact:" + n.id, stage: "civ", icon: "🤝", text: "Signed a trade agreement with the " + n.name + " nation." });
    }
    if (e.cowed) n.cowedUntil = T.time + e.cowed;
    if (e.preach) n.preachUntil = T.time + e.preach;
    if (e.assistAt) n.assistAt = e.assistAt;
    if (e.beliefsAt) n.beliefsAt = e.beliefsAt;
    if (e.war && !n.war) {
      youAttacked(n);
      n.war = true;
      n.allied = n.pact = false;
      n.relation = nudge(n.relation, DIPLO.war);
      o.sfx("roar");
      chronicle({ key: "civ:war:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: "War with the " + n.name + " nation." });
    }
    if (e.peace) {
      n.war = false;
      n.relation = Math.max(n.relation, DIPLO.peaceAt);
      vehiclesOf(n.id).forEach((v) => (v.order = null));
      vehiclesOf(YOU).filter((v) => v.order?.type === "vehicle" && v.order.target.owner === n.id).forEach((v) => (v.order = null));
      chronicle({ key: "civ:peace:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "🕊", text: "Made peace with the " + n.name + " nation." });
    }
    if (e.assist) sendAssistance(n);
    if (e.buy && city && city.owner === n.id) {
      n.money += -e.money || 0;
      takeCity(city, YOU, "economic");
    }
  }
  /** Your war on a nation: its allies take it badly (and may join in); its enemies like you better for it. */
  function youAttacked(n) {
    for (const m of T.nations) {
      if (!m.alive || m === n) continue;
      const p = T.pairs[pairKey(m.id, n.id)];
      if (p?.allied) {
        m.relation = nudge(m.relation, -25);
        if (m.allied) {
          m.allied = false;
          logTalk(m, "them", `You attacked our allies, the ${n.name}. Our alliance is over.`, "Alliance ended.");
          notify({ nation: m, title: "Alliance over", text: `The ${m.name} end their alliance with you: you attacked their allies.`, level: "warn", act: () => openSheet("nation", { nation: m }), actLabel: "Talk" });
        }
      } else if (p?.war) m.relation = nudge(m.relation, 10);
    }
  }
  /** An ally's help: its idle military vehicles guard your most threatened city for three minutes, or it sends money. */
  const threatenedCity = () =>
    yourCities()
      .map((c) => ({ c, foes: T.vehicles.filter((v) => !v.dead && hostile(YOU, v.owner) && arc(v.d, c.d) < 80).length }))
      .sort((a, b) => b.foes - a.foes)[0]?.c || capital();
  /** An ally's military vehicles that could come to your aid (up to three). */
  const helpersOf = (n, city = threatenedCity()) =>
    vehiclesOf(n.id)
      .filter((v) => v.role === "military" && reachCity(v, city))
      .slice(0, 3);
  function sendAssistance(n) {
    const threatened = threatenedCity();
    const helpers = helpersOf(n, threatened);
    if (helpers.length) {
      helpers.forEach((v, i) => (v.order = { type: "guard", d: offsetDir(threatened.d, (i - 1) * 6, -(WALL + 7), threatened.f), until: T.time + 180 }));
      toast(`${helpers.length} ${n.name} vehicle${helpers.length === 1 ? " is" : "s are"} on the way to guard ${threatened.name}.`, 4);
    } else {
      const gift = Math.min(150, Math.round(n.money * 0.3));
      n.money -= gift;
      T.money += gift;
      toast(`The ${n.name} send §${gift} for your war chest.`, 3.5);
    }
  }
  function declareOn(owner, why) {
    const n = nationOf(owner);
    if (!n || n.war) return;
    n.war = true;
    if (n.allied || n.pact) toast(`You betrayed your ${n.allied ? "alliance" : "trade agreement"} with the ${n.name}!`, 4);
    n.allied = n.pact = false;
    n.relation = clampRel(n.relation + DIPLO.attack);
    logTalk(n, "you", "Your forces attacked the " + n.name + ".", "War.");
    youAttacked(n);
    toast(`War with the ${n.name} nation! ${why}.`, 4);
    chronicle({ key: "civ:war:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: "Went to war with the " + n.name + " nation." });
    o.sfx("roar");
  }

  /* ---- vehicle behaviour --------------------------------------------------------------------------- */
  function placeVehicle(v, dt) {
    v.bob += dt;
    v.lift = v.mode === "air" ? AIR_LIFT + Math.sin(v.bob * 1.4) * 0.4 : v.mode === "sea" ? Math.sin(v.bob * 1.8) * 0.12 : 0;
    globe.surfaceMatrix(v.d, v.fwd, v.lift, M, 1, 0, v.mode !== "land");
    M.decompose(v.group.position, v.group.quaternion, v.group.scale);
    v.ring.position.y = v.mode === "air" ? -v.lift + 0.2 : 0.2;
    v.ring.visible = T.selected.has(v);
  }
  /** Drive toward a direction along a route over the surface; returns the distance left (Infinity: no way there). */
  function drive(v, target, dt, stop = 1) {
    const left = arc(v.d, target);
    if (left <= stop) return left;
    let aim = target;
    if (v.mode !== "air" && left > 26) {
      v.repath = (v.repath ?? 0) - dt;
      if (!v.route || v.routeFor !== target || v.repath <= 0) {
        v.route = planet.route(v.mode, v.d, target);
        v.routeFor = target;
        v.repath = 3;
        if (!v.route) return Infinity;
      }
      while (v.route.length > 1 && arc(v.d, v.route[0]) < 5) v.route.shift();
      aim = v.route[0];
    }
    // Turn smoothly toward the next point, then roll forward along the surface.
    const want = towards(v.d, aim);
    v.fwd = tangentize(nlerp(v.fwd, want, Math.min(1, dt * 4)), v.d);
    const dist = Math.min(left - stop + 0.01, v.unit.speed * dt);
    const next = step(v.d, v.fwd, dist);
    // Land vehicles keep out of the sea, boats off the land (they find another way next time).
    const h = planet.height(next.d);
    if ((v.mode === "land" && h < 0.15) || (v.mode === "sea" && h > -0.3)) {
      v.route = null;
      v.fwd = tangentize(nlerp(v.fwd, want, 0.5), v.d);
      return left;
    }
    v.d = next.d;
    v.fwd = next.fwd;
    return left - dist;
  }
  const hostile = (a, b) => {
    if (!a || !b || a === b) return false;
    if (a === YOU || b === YOU) return !!nationOf(a === YOU ? b : a)?.war;
    // Two rivals fight if they're at war with each other; your allies also fight the nations at war with you.
    if (T.pairs[pairKey(a, b)]?.war) return true;
    const na = nationOf(a),
      nb = nationOf(b);
    return !!((na?.allied && nb?.war) || (nb?.allied && na?.war));
  };
  function nearestFoeVehicle(v, radius) {
    let best = null,
      bd = radius;
    for (const u of T.vehicles) {
      if (u.dead || !hostile(v.owner, u.owner) || !hitMult(v.unit, u.mode)) continue;
      const d = arc(v.d, u.d);
      if (d < bd) (best = u), (bd = d);
    }
    return best;
  }
  function hurtVehicle(v, dmg, by) {
    v.hp -= dmg;
    if (v.hp > 0) return;
    boom(vehiclePos(v, 1), 7);
    popAt(v.d, v.lift + 2, "💥");
    if (v.owner === YOU) toast("A vehicle was destroyed.");
    else if (by === YOU) o.sfx("roar", { gain: 0.3 });
    removeVehicle(v);
  }
  const _a = new THREE.Vector3(),
    _b = new THREE.Vector3();
  function actAt(v, c, dt) {
    const from = vehiclePos(v, 1.5, _a),
      to = ground(c.d, 4, _b);
    if (v.role === "military") {
      if (v.owner === YOU) declareOn(c.owner, `You attacked ${c.name}`);
      else if (c.owner === YOU) {
        const n = nationOf(v.owner);
        if (n && !n.war) return void (v.order = null);
      } else if (c.owner && !hostile(v.owner, c.owner)) return void (v.order = null); // rivals fight only those they're at war with
      // Its defences down, a city is taken by whoever occupies it: a land vehicle or a ship (aircraft
      // can bomb a city defenceless, but can't hold it).
      if (c.hallHp <= 0) {
        if (v.mode !== "air") return void takeCity(c, v.owner, "military");
        if (v.owner === YOU) tipOnce("occupy:" + c.id, `${c.name}'s defences are down! Aircraft can't hold a city: send a land vehicle or a ship to take it.`, 5);
        return;
      }
      if ((v.cool -= dt) <= 0) {
        const w = weaponFor(v.unit, "land");
        v.cool = w.every * (0.85 + Math.random() * 0.3);
        const dmg = v.unit.dps * v.unit.vsCity * w.every;
        const spot = offsetDir(c.d, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, c.f);
        const aim = ground(spot, 3);
        projectiles.fire(w.weapon, from.clone(), () => aim, () => {
          if (c.owner === v.owner) return;
          damageCity(c, dmg, cityDefence(c, c.owner === YOU ? strengths : {}));
          if (c.owner === YOU && !(T.time < (c.alarmAt || 0))) {
            c.alarmAt = T.time + 25;
            const n = nationOf(v.owner);
            notify({ nation: n, icon: ico("attack"), title: `${c.name} is under attack!`, text: `${n ? "The " + n.name : "Enemy"} vehicles are shelling its ${c.turrets && c.turretHp > 0 ? "turrets" : "city hall"}.`, level: "danger", key: "attack:" + c.id, act: () => focusOn(c.d, ALT.city), actLabel: "Defend" });
          }
        });
      }
    } else if (v.role === "religious") {
      const faith = cityEconomy(c, ownerMods(c.owner)).faith;
      const done = preachTo(c, v.owner, preachRate(v.unit.preach * (v.owner === YOU ? fx().preach : 1), faith) * dt);
      const n = nationOf(c.owner);
      if (n && v.owner === YOU) n.relation = clampRel(n.relation + DIPLO.preach * dt);
      // Preaching to a rival's city sours that rival on the preachers.
      else if (n && nationOf(v.owner)) pairOf(n, nationOf(v.owner)).rel = clampRel(pairOf(n, nationOf(v.owner)).rel + DIPLO.preach * dt);
      if ((v.cool -= dt) <= 0) {
        v.cool = 1.1;
        shot(from, to, "faith");
      }
      if (done) takeCity(c, v.owner, "religious");
    }
  }
  /* ---- trade runs: goods out to the partner city, back home for more --------------------------------- */
  /** The city a trade vehicle loads at: its own home if it can still get there, else the nearest it can. */
  function tradeHome(v) {
    const ok = (c) => c.owner === v.owner && (v.mode !== "sea" || c.anchor) && reachCity(v, c);
    const home = T.cities[v.home];
    if (home && ok(home)) return home;
    return T.cities.filter(ok).sort((a, b) => arc(a.d, v.d) - arc(b.d, v.d))[0] || null;
  }
  function tradeRun(v, c, dt) {
    const ord = v.order;
    if (c.owner && hostile(v.owner, c.owner)) {
      if (v.owner === YOU) toast(`${c.name} won't trade with you while you're at war.`, 3.5);
      return void (v.order = null);
    }
    const home = tradeHome(v);
    if (!home) return void (v.order = null);
    const goal = (city) => (v.mode === "sea" ? city.anchor : city.d);
    const near = v.mode === "sea" ? RANGE.sea : 7;
    // A fresh order starts loaded if the vehicle is at home; otherwise it goes home to load first.
    ord.loaded ??= arc(v.d, home.d) < 45;
    if (ord.loaded) {
      // Crossing the land of a nation at war with you: raiders take half the cargo.
      const land = nearestCity(v.d);
      if (land?.owner && land.owner !== v.owner && hostile(v.owner, land.owner)) {
        if (!ord.raided && v.owner === YOU) notify({ icon: ico("trade"), title: "Trade route attacked", text: `Raiders on ${land.name}'s land are taking half your trade vehicle's cargo.`, level: "warn", key: "raid", act: () => focusOn(v.d, ALT.city), actLabel: "Look" });
        ord.raided = true;
      }
      const left = drive(v, goal(c), dt, near);
      if (left === Infinity) return void (v.order = null);
      if (left > near + 0.6) return;
      deliver(v, c, home, ord.raided);
      ord.loaded = false;
      ord.raided = false;
    } else {
      const left = drive(v, goal(home), dt, near + 1);
      if (left === Infinity) return void (v.order = null);
      if (left > near + 1.6) return;
      ord.loaded = true;
      if (v.owner === YOU && cam.salt < 200) popAt(home.d, 8, "📦", "good");
    }
  }
  /** A delivery: both sides are paid (more for longer routes and bigger partners), and the partnership grows. */
  function deliver(v, c, home, raided) {
    // A trade agreement between the two sides: half as much again.
    const pactWith = nationOf(v.owner === YOU ? c.owner : c.owner === YOU ? v.owner : null);
    const pay = Math.round(deliveryPay(arc(home.d, c.d), cityEconomy(c, {}).pop, raided) * (pactWith?.pact ? 1.5 : 1));
    const res = deliverTrade(c, v.owner, v.unit.trade * 1.2);
    earn(v.owner, pay);
    if (c.owner) earn(c.owner, Math.round(pay * 0.5));
    const partner = nationOf(c.owner),
      trader = nationOf(v.owner);
    if (partner && v.owner === YOU) partner.relation = clampRel(partner.relation + DIPLO.trade);
    if (c.owner === YOU && trader) trader.relation = clampRel(trader.relation + DIPLO.trade / 2);
    // Trade warms rivals to each other too.
    if (partner && trader) pairOf(partner, trader).rel = clampRel(pairOf(partner, trader).rel + 1);
    shot(vehiclePos(v, 1.5, _a), ground(c.d, 4, _b), "trade");
    if (v.owner === YOU) {
      popAt(c.d, 8, "+§" + pay + (raided ? " (raided)" : ""), raided ? "bad" : "good");
      if (res.newRoute) notify({ icon: ico("trade"), title: "New trade route", text: `Trade route open with ${c.name}: each delivery pays you both, and the route pays a little all the time.`, level: "good", act: () => openSheet("economy"), actLabel: "Economy" });
      if (res.complete && !c.toldBuy) {
        c.toldBuy = true;
        notify({ icon: ico("money"), title: `${c.name} is ready to buy`, text: `Your trade with ${c.name} is complete: you can buy the city outright.`, level: "good", act: () => openSheet("city", { city: c }), actLabel: "Buy" });
      }
    } else if (res.complete && c.owner !== YOU && trader) {
      // A rival economic nation buys a city once its trade is complete and it can afford it.
      // (Your own cities are never for sale: trade with you just pays you both.)
      const cost = buyoutCost(cityEconomy(c, {}), 0);
      if (trader.money >= cost) {
        trader.money -= cost;
        takeCity(c, v.owner, "economic");
      }
    }
  }
  function earn(owner, money) {
    if (owner === YOU) T.money += money;
    else if (nationOf(owner)) nationOf(owner).money += money;
  }
  function updateVehicle(v, dt) {
    const ord = v.order;
    // Military vehicles fight hostile vehicles that come near, whatever their orders.
    if (v.role === "military") {
      const chase = ord?.type === "vehicle" && !ord.target.dead && hitMult(v.unit, ord.target.mode) ? ord.target : null;
      const reach = 10 + v.unit.range * 0.6;
      // A guard doesn't chase further than 30 from its post: it goes back instead.
      const leash = ord?.type === "guard" && arc(v.d, ord.d) > 30;
      const foe = chase || (leash ? null : nearestFoeVehicle(v, (ord?.type === "guard" || ord?.type === "patrol" ? 16 : 6) + reach));
      if (foe) {
        const d = arc(v.d, foe.d);
        if (d > reach) {
          if (drive(v, foe.d, dt, reach - 1) === Infinity) v.order = null;
        } else {
          v.fwd = tangentize(nlerp(v.fwd, towards(v.d, foe.d), Math.min(1, dt * 5)), v.d);
          if ((v.cool -= dt) <= 0) {
            const w = weaponFor(v.unit, foe.mode);
            v.cool = w.every * (0.85 + Math.random() * 0.3);
            const dmg = v.unit.dps * hitMult(v.unit, foe.mode) * w.every;
            const by = v.owner;
            projectiles.fire(w.weapon, vehiclePos(v, 1.5, new THREE.Vector3()), aimAt(foe), () => !foe.dead && hurtVehicle(foe, dmg, by));
          }
        }
        return;
      }
      if (ord?.type === "vehicle") v.order = null;
    }
    if (ord?.type === "city") {
      const c = ord.city;
      if (c.owner === v.owner) return void (v.order = null);
      if (v.role === "economic") return tradeRun(v, c, dt);
      const goal = v.mode === "sea" ? c.anchor : c.d;
      if (!goal) return void (v.order = null);
      // Artillery and warships fight from further out (out of the turrets' reach, for artillery).
      const reach = RANGE[v.mode] + (v.role === "military" ? v.unit.range : 0);
      const left = drive(v, goal, dt, reach + (v.mode === "sea" ? 0 : 3));
      if (left === Infinity) return void (v.order = null);
      const inRange = v.mode === "sea" ? left <= reach + 0.5 : left <= reach + 3.5;
      if (inRange) actAt(v, c, dt);
      return;
    }
    if (ord?.type === "guard") {
      if (ord.until && T.time > ord.until) return void (v.order = null);
      // Hold the spot: military vehicles fight whatever comes near (above), then come back here.
      if (arc(v.d, ord.d) > 2.2 && drive(v, ord.d, dt, 2) === Infinity) v.order = null;
      return;
    }
    if (ord?.type === "patrol") {
      const to = ord.leg ? ord.a : ord.b;
      const left = drive(v, to, dt, 2);
      if (left === Infinity) return void (v.order = null);
      if (left <= 2.2) ord.leg = !ord.leg;
      return;
    }
    if (ord?.type === "move" || ord?.type === "geyser") {
      const left = drive(v, ord.d, dt, ord.type === "geyser" ? 3 : 2);
      if (left === Infinity) return void (v.order = null);
      if (left <= (ord.type === "geyser" ? 3.2 : 2.2)) {
        if (ord.type === "geyser") claimGeyser(ord.geyser, v, dt);
        else v.order = null;
      }
      return;
    }
    // Idle: park by the home city's gate, and claim any free geyser close by that it can reach.
    const home = T.cities[v.home] || capital();
    const free = T.geysers.find((g) => !g.owner && arc(g.d, v.d) < 30 && v.mode !== "sea" && reachable(v, g.d));
    if (free) v.order = { type: "geyser", geyser: free, d: free.d };
    else {
      const park = v.mode === "sea" ? home.anchor : offsetDir(home.d, ((v.id % 5) - 2) * 3, -(WALL + 5), home.f);
      if (park && arc(v.d, park) > 6 && reachable(v, park)) drive(v, park, dt, 4);
    }
  }
  function claimGeyser(g, v, dt) {
    if (g.owner === v.owner) return void (v.order = null);
    if (g.owner) {
      // A rival's derrick: only military vehicles can wreck it, and only rivals you're at war with (or you).
      if (v.role !== "military") return void (v.order = null);
      if (v.owner === YOU) declareOn(g.owner, "You attacked their derrick");
      g.hp -= (v.unit.dps * dt) / 40;
      if ((v.cool -= dt) <= 0) {
        const w = weaponFor(v.unit, "land");
        v.cool = w.every;
        const aim = ground(g.d, 3);
        projectiles.fire(w.weapon, vehiclePos(v, 1.5, new THREE.Vector3()), () => aim);
      }
      if (g.hp <= 0) {
        if (g.owner === YOU) notify({ icon: ico("derrick"), title: "Derrick wrecked!", text: `Your derrick${nearestCity(g.d) ? " near " + nearestCity(g.d).name : ""} was destroyed. Send a vehicle to claim the geyser back.`, level: "danger", act: () => focusOn(g.d, ALT.city), actLabel: "Look" });
        g.owner = null;
        g.hp = 1;
        g.level = 1;
        buildGeyser(g);
        boom(ground(g.d, 3), 8);
      }
      return;
    }
    g.owner = v.owner;
    g.hp = 1;
    g.level = 1;
    buildGeyser(g);
    v.order = null;
    // Spice taken from another nation's land is resented.
    const land = nearestCity(g.d);
    const host = nationOf(land?.owner),
      taker = nationOf(v.owner);
    if (host && host !== taker) {
      if (taker) pairOf(host, taker).rel = clampRel(pairOf(host, taker).rel - 8);
      else if (v.owner === YOU) host.relation = nudge(host.relation, -6);
    }
    if (v.owner === YOU) {
      o.sfx("unlock");
      popAt(g.d, 7, "+ spice", "good");
      tipOnce("spice", `Spice! This derrick pumps ${spiceYield(g).toFixed(1)} spice a second. Military vehicles need spice; sell the rest on the market (tap § at the top).`, 5.5);
      chronicle({ key: "civ:spice:first", stage: "civ", icon: "🌶", text: "Claimed the first spice geyser." });
    }
  }
  function updateTurrets(dt) {
    for (const c of T.cities) {
      repairCity(c, dt);
      calmUnrest(c, dt);
      // Conversion fades while nobody is preaching.
      for (const k of Object.keys(c.conv)) {
        if (T.vehicles.some((v) => v.owner === k && !v.dead && v.order?.city === c && v.role === "religious" && arc(v.mode === "sea" ? c.anchor || c.d : c.d, v.d) < 20)) continue;
        c.conv[k] = Math.max(0, c.conv[k] - 0.6 * dt);
        if (!c.conv[k]) delete c.conv[k];
      }
      if (!c.turrets || c.turretHp <= 0) continue;
      const def = cityDefence(c, c.owner === YOU ? strengths : {});
      // Defenders fire at hostile military vehicles, and at any vehicle of a nation at war with them.
      let target = null,
        bd = Infinity;
      for (const v of T.vehicles) {
        if (v.dead || v.owner === c.owner) continue;
        const d = arc(v.d, c.d);
        const attacking = v.order?.city === c;
        // Turrets reach further against attackers. Ships attack from their anchorage, so the guns reach
        // that far out to sea. Artillery shells from beyond the guns' close range, where they hit less.
        const close = v.mode === "sea" && c.anchor ? Math.max(TURRET_RANGE + 1, arc(c.anchor, c.d) + RANGE.sea + 5) : TURRET_RANGE + 1;
        const range = attacking ? close + 10 : TURRET_RANGE;
        if (d > range) continue;
        const atWar = c.owner === null ? v.role === "military" && attacking : hostile(c.owner, v.owner) || (v.role === "military" && attacking);
        if (atWar && d < bd) (target = v), (bd = d);
      }
      if (!target) continue;
      const far = bd > (target.mode === "sea" && c.anchor ? Math.max(TURRET_RANGE + 1, arc(c.anchor, c.d) + RANGE.sea + 5) : TURRET_RANGE + 1);
      c.shotCool = (c.shotCool || 0) - dt;
      if (c.shotCool <= 0) {
        // Each turret takes its turn; the shot carries the damage of the time since the last one.
        const every = 0.6 / Math.max(1, Math.min(3, c.turrets));
        c.shotCool = every;
        const dmg = def.dps * c.turretHp * every * 0.6 * (far ? 0.35 : 1);
        const k = (c.nextTurret = ((c.nextTurret || 0) + 1) % c.turrets);
        const owner = c.owner,
          tv = target;
        projectiles.fire(tv.mode === "air" ? "flak" : "turret", ground(turretSpot(c, k), 5, new THREE.Vector3()), aimAt(tv), () => !tv.dead && hurtVehicle(tv, dmg, owner));
      }
    }
  }

  /* ---- rival nations ---------------------------------------------------------------------------------- */
  function updateNations(dt) {
    for (const n of T.nations) {
      if (!n.alive) continue;
      const mine = citiesOf(n.id);
      if (!mine.length) {
        n.alive = false;
        continue;
      }
      n.money += (mine.reduce((s, c) => s + cityEconomy(c, {}).income, 0) + tradeIncome(T.cities, n.id)) * dt;
      // Rivals keep the spice they need for their army and sell the rest at the going price.
      n.spice += spiceIncome(n.id) * dt;
      if (n.spice > 60) {
        const sale = sellSpice(T.price, n.spice - 40);
        n.money += sale.money;
        T.price = sale.price;
        n.spice = 40;
      }
      // Relations settle toward a resting point that falls as your nation grows: a rising power worries everyone.
      const rest = n.base + (PERSONALITIES[n.personality]?.rest || 0) + (n.pact ? 5 : 0) + (n.allied ? 10 : 0) - 6 * Math.max(0, yourCities().length - 1);
      if (n.allied && n.relation < 20) {
        n.allied = false;
        notify({ nation: n, title: "Alliance over", text: `The ${n.name} have ended your alliance.`, level: "warn", act: () => openSheet("nation", { nation: n }), actLabel: "Talk" });
        logTalk(n, "them", "Our alliance is over.", "Alliance ended (relations fell below 20).");
      }
      if (!n.war) n.relation = clampRel(n.relation + Math.sign(rest - n.relation) * Math.min(Math.abs(rest - n.relation), DIPLO.drift * dt));
      // Growing their towns: a building or a turret now and then.
      if ((n.buildClock -= dt) <= 0) {
        n.buildClock = 45 + Math.random() * 30;
        const c = mine[Math.floor(Math.random() * mine.length)];
        const free = c.plots.indexOf(null);
        if (n.type === "military" && c.turrets < MAX_TURRETS && n.money > BUILD_COST.turret * 2) {
          c.turrets++;
          n.money -= BUILD_COST.turret;
          buildCity(c, "new");
        } else if (free >= 0 && n.money > 120) {
          const role = ["house", "fun", "factory", "house", n.type === "religious" ? "temple" : "fun", "factory"][free];
          c.plots[free] = role;
          n.money -= BUILD_COST[role];
          buildCity(c, "new");
        }
      }
      // Leaders get in touch on their own: first contact, offers, demands, invitations.
      if ((n.talkClock -= dt) <= 0) {
        n.talkClock = 35 + Math.random() * 35;
        if (!inboxOf(n) && T.time > 40 && T.time - lastPost > 25) {
          const m = incoming(commsCtx(n, { seen: seenBy(n) }), Math.random, namesFor(n));
          if (m) post(n, m);
        }
      }
      if ((n.clock -= dt) > 0) continue;
      n.clock = 4;
      const fleet = vehiclesOf(n.id);
      const plan = nationPlan(
        { type: n.type, relation: n.relation, war: n.war, money: n.money, vehicles: fleet.length, cap: vehicleCap(n.id), personality: n.personality, warAt: PERSONALITIES[n.personality]?.warAt, allied: n.allied, cowed: T.time < n.cowedUntil, preachYou: T.time < n.preachUntil },
        { yourCities: yourCities().length, freeCities: citiesOf(null).length, grace: T.time < GRACE, power: militaryPower(n.id), yourPower: militaryPower(YOU) },
      );
      // A trade agreement brings their merchants to you.
      if (n.pact && n.type === "economic" && plan.target === "free" && Math.random() < 0.6) plan.target = "you";
      if (plan.declareWar) {
        n.war = true;
        n.pact = false;
        const said = leaderLine(n);
        logTalk(n, "them", said, "They declared war.");
        post(n, { kind: "notice", text: said, choices: [{ id: "ok", label: "⚔ So be it" }, { id: "talk", label: "🕊 Talk peace" }] }, true);
        o.sfx("roar");
        chronicle({ key: "civ:attacked:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: "The " + n.name + " nation declared war." });
      }
      n.vehicleClock = (n.vehicleClock ?? 10) - 4;
      if (plan.build && n.vehicleClock <= 0) {
        n.vehicleClock = 30;
        const c = mine[Math.floor(Math.random() * mine.length)];
        const modes = allowedModes(mine.length, c.coastal);
        // Overseas targets need boats or aircraft: a nation alone on its continent builds them more.
        const lonely = !T.cities.some((x) => x !== c && x.landmass === c.landmass && x.owner !== n.id);
        const mode = modes.length > 1 && Math.random() < (lonely ? 0.8 : 0.35) ? modes[1 + Math.floor(Math.random() * (modes.length - 1))] : "land";
        // A military nation builds a mix of classes: mostly the main one, some artillery, bombers, torpedo boats.
        const classes = CLASSES_BY_MODE[mode];
        const key = c.type + ":" + mode + (c.type === "military" ? ":" + classes[Math.random() < 0.6 ? 0 : 1 + Math.floor(Math.random() * (classes.length - 1))] : "");
        const nu = vehicleUnit(vehicleDesign(n.id, key));
        // Military vehicles burn spice: without it, a nation must wait (or win some geysers).
        if (n.spice >= spiceCost(nu)) {
          n.money -= nu.cost;
          n.spice -= spiceCost(nu);
          spawnVehicle(n.id, key, c);
        }
      }
      // Spice is worth fighting over: idle vehicles claim free geysers, and at war, raid your derricks.
      for (const v of fleet) {
        if (v.order || v.mode === "sea" || Math.random() > 0.35) continue;
        const want = T.geysers
          .filter((g) => (!g.owner || (n.war && g.owner === YOU && v.role === "military")) && arc(g.d, v.d) < 130 && reachable(v, g.d))
          .sort((a, b) => arc(a.d, v.d) / a.rich - arc(b.d, v.d) / b.rich)[0];
        if (want) v.order = { type: "geyser", geyser: want, d: want.d };
      }
      // The first minute and a half is for building up, on every side.
      if (plan.target && T.time > 90) {
        // Rivals at war with this nation are targets too, and its traders and preachers go where they're welcome (or not).
        const enemies = T.nations.filter((m) => m !== n && m.alive && T.pairs[pairKey(n.id, m.id)]?.war);
        const disliked = T.nations.filter((m) => m !== n && m.alive && (T.pairs[pairKey(n.id, m.id)]?.rel ?? 0) < -10);
        const partners = T.nations.filter((m) => m !== n && m.alive && !T.pairs[pairKey(n.id, m.id)]?.war);
        const others = (list) => list.flatMap((m) => citiesOf(m.id));
        for (const v of fleet) {
          if (v.order) continue;
          let pool = plan.target === "you" ? yourCities() : citiesOf(null);
          if (v.role === "military" && enemies.length && (plan.target !== "you" || Math.random() < 0.5)) pool = [...others(enemies), ...(plan.target === "you" ? pool : [])];
          else if (v.role === "economic" && Math.random() < 0.4) pool = [...pool, ...others(partners)];
          else if (v.role === "religious" && disliked.length && Math.random() < 0.4) pool = [...pool, ...others(disliked)];
          const ok = pool.filter((c) => reachCity(v, c));
          if (!ok.length) continue;
          const home = T.cities[v.home] || mine[0];
          ok.sort((a, b) => arc(a.d, home.d) - arc(b.d, home.d));
          const c = ok[0];
          if (v.role === "military" && plan.target === "you" && !n.war) continue;
          v.order = { type: "city", city: c };
          if (c.owner === YOU && v.role !== "economic") tipOnce("incoming:" + v.role, v.role === "military" ? `Enemy vehicles are heading for ${c.name}! Turrets and your own military vehicles will fight them.` : `Missionaries from the ${n.name} nation are preaching to ${c.name}. Temples help it resist.`, 5);
        }
      }
    }
  }
  /** Every nation's military vehicles defend its cities: idle ones within reach go after attackers. */
  function autoDefend() {
    for (const c of T.cities) {
      if (!c.owner) continue;
      const raiders = T.vehicles.filter((v) => !v.dead && v.owner !== c.owner && v.order?.city === c && arc(v.d, c.d) < 40 && hostile(c.owner, v.owner));
      if (!raiders.length) continue;
      for (const v of vehiclesOf(c.owner)) if (!v.order && v.role === "military" && arc(v.d, c.d) < 70 && hitMult(v.unit, raiders[0].mode)) v.order = { type: "vehicle", target: raiders[0], d: raiders[0].d };
    }
  }

  /* ---- the rivals among themselves: relations, wars, alliances, coalitions ------------------------ */
  function pairOf(a, b) {
    const k = pairKey(a.id, b.id);
    if (!T.pairs[k]) {
      // A starting point from both personalities (and a little chance, from the planet's seed).
      const jitter = ((mulberry((seed ^ (a.index * 31 + b.index * 977)) >>> 0)() - 0.5) * 30) | 0;
      T.pairs[k] = { rel: Math.round(pairRest(a, b) + jitter), war: false, allied: false, pact: false, warFor: 0 };
    }
    return T.pairs[k];
  }
  const shareOf = (owner) => T.cities.filter((c) => c.owner === owner).length / T.cities.length;
  /** The nation (or you) everyone else is starting to fear, if any. */
  function dominantPower() {
    for (const owner of [YOU, ...T.nations.filter((n) => n.alive).map((n) => n.id)]) if (shareOf(owner) >= DOMINANT_SHARE) return owner;
    return null;
  }
  const news = (text, seconds = 4, nation = null) => {
    notify({ icon: "📰", nation, title: "World news", text, level: /war|no more|fell/i.test(text) ? "warn" : "info", seconds: seconds + 2, act: () => openSheet("world"), actLabel: "World" });
    T.newsLog.push({ t: Math.round(T.time), text });
    if (T.newsLog.length > 40) T.newsLog.shift();
  };
  /* -- the planet minimap (civ/minimap.js): the hemisphere you're looking at, kept up to date -- */
  let minimap = null;
  const miniVec = new THREE.Vector3();
  function updateMinimap() {
    const wrap = $h("#cvMiniWrap");
    if (!wrap || wrap.classList.contains("folded") || arrive) return;
    if (!minimap) {
      minimap = createMinimap({
        canvas: $h("#cvMini"),
        isLand: (d) => planet.isLand(miniVec.set(d.x, d.y, d.z)),
        view: () => ({ f: cam.sf, n: cam.sn }),
        colors: { sea: "#" + new THREE.Color(hw?.water?.color ?? region.water ?? 0x2f78b8).getHexString(), land: "#" + new THREE.Color(palette.grass ?? palette.leaf ?? 0x7fbf6a).getHexString() },
        world: () => ({
          cities: T.cities.map((c) => ({ d: c.d, color: c.owner ? ownerColor(c.owner) : null, yours: c.owner === YOU, capital: c.id === 0 && c.owner === YOU, attacked: c.owner === YOU && T.vehicles.some((v) => !v.dead && v.role === "military" && v.owner !== YOU && hostile(v.owner, YOU) && arc(v.d, c.d) < 0.12) })),
          vehicles: T.vehicles.filter((v) => !v.dead).map((v) => ({ d: v.d, color: ownerColor(v.owner), military: v.role === "military" })),
          geysers: T.geysers.filter((g) => g.owner).map((g) => ({ d: g.d, color: ownerColor(g.owner) })),
          events: eventMarks.filter((e) => e.until > T.time),
        }),
        onPick: (d) => {
          focusOn({ x: d.x, y: d.y, z: d.z }, Math.max(cam.alt, ALT.region));
          o.sfx("select");
        },
      });
    }
    eventMarks = eventMarks.filter((e) => e.until > T.time);
    minimap.draw(0.25);
  }

  /* -- danger, for the soundtrack: at war with anyone, or your cities under attack -- */
  let danger = null;
  function updateDanger() {
    const on = !arrive && !T.won && T.nations.some((n) => n.alive && n.war);
    if (on === danger) return;
    danger = on;
    o.onDanger?.(on);
  }

  /* -- world events: the planet changes without being asked (civ/events.js) -- */
  let eventMarks = []; // { d, color, until }: rings on the minimap where something happened
  function worldSnapshot() {
    const rivals = T.nations.filter((n) => n.alive && n.met !== false).map((n) => ({ id: n.id, name: n.name, war: n.war }));
    let unhappy = null,
      worst = 0;
    for (const c of yourCities()) {
      const h = cityEconomy(c, ownerMods(YOU)).happiness;
      if (h < worst) (worst = h), (unhappy = { id: c.id, name: c.name });
    }
    return {
      time: T.time,
      derricks: T.geysers.filter((g) => g.owner === YOU).length,
      routes: T.cities.filter((c) => (c.trade?.[YOU] || 0) > 0).length,
      wars: T.nations.filter((n) => n.alive && n.war).length,
      yourType: T.startType,
      cities: T.cities.filter((c) => c.owner).map((c) => ({ id: c.id, name: c.name })),
      unhappy,
      rivals,
      symbiotic: o.heritage?.instinct === "symbiotic",
      feared: o.heritage?.instinct === "apex" || o.heritage?.tribePath === "conquest",
    };
  }
  function applyWorldEvent(ev) {
    const f = ev.effect || {};
    const city = f.city != null ? T.cities.find((c) => c.id === f.city) : null;
    if (f.price) T.price = Math.min(SPICE_PRICE.max, Math.max(SPICE_PRICE.min, T.price * f.price));
    if (city && f.damage) {
      city.turretHp = Math.max(0.15, (city.turretHp ?? 1) - f.damage);
      city.hallHp = Math.max(0.3, (city.hallHp ?? 1) - f.damage * 0.4);
    }
    if (city && f.unrest) city.unrest = Math.min(5, (city.unrest || 0) + f.unrest);
    const n = f.nation ? nationOf(f.nation) : null;
    if (n && f.relation) n.relation = clampRel(n.relation + f.relation);
    if (n && f.rivalMoney) n.money += f.rivalMoney;
    if (f.pairRel && f.a && f.b) {
      const k = pairKey(f.a, f.b);
      T.pairs[k] = T.pairs[k] || { rel: 0, war: false };
      T.pairs[k].rel = clampRel((T.pairs[k].rel || 0) + f.pairRel);
    }
    if (ev.seconds) T.events.active.push({ id: ev.id, until: T.time + ev.seconds, effect: f, at: city ? city.id : null });
    T.events.active = T.events.active.filter((e) => e.until > T.time).slice(-6);
    // Seen on the planet as well as read: a flash where it happened, a ring on the minimap.
    const where = city?.d || (n ? T.cities.find((c) => c.owner === n.id)?.d : null);
    if (where) {
      flash(where, 4);
      eventMarks.push({ d: where, color: ev.color, until: T.time + 45 });
    }
    const nation = n || (city ? nationOf(city.owner) : null);
    notify({ icon: ev.icon, nation, title: ev.title, text: ev.text, level: /disaster|unrest|tension|shortage/.test(ev.id) ? "warn" : "info", seconds: 8, act: where ? () => focusOn(where, ALT.region) : () => openSheet("world"), actLabel: where ? "Look" : "World" });
    T.newsLog.push({ t: Math.round(T.time), text: ev.title + ": " + ev.text });
    if (T.newsLog.length > 40) T.newsLog.shift();
    // Only the memorable ones go into the species' history.
    if (ev.id === "disaster" || ev.id === "breakthrough" || T.events.count === 0) chronicle({ key: "civ:event:" + ev.id + ":" + Math.floor(T.time), stage: "civ", icon: ev.icon, text: ev.title + ": " + ev.text });
    T.events.count++;
    T.events.last = ev.id;
    o.sfx(/disaster|unrest|tension/.test(ev.id) ? "alarm" : "message");
  }
  function updateWorldEvents() {
    if (arrive || victory || T.lost) return;
    if (T.time < T.events.next) return;
    const ev = chooseEvent(worldSnapshot(), T.events.last);
    T.events.next = T.time + nextEventIn();
    if (ev) applyWorldEvent(ev);
  }
  let pairClock = 6;
  function updateRivalDiplomacy(dt) {
    const alive = T.nations.filter((n) => n.alive);
    for (const p of Object.values(T.pairs)) if (p.war) p.warFor = (p.warFor || 0) + dt;
    if ((pairClock -= dt) > 0) return;
    pairClock = 5;
    const top = dominantPower();
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i],
          b = alive[j];
        const p = pairOf(a, b);
        const commonEnemy = T.nations.some((m) => m !== a && m !== b && T.pairs[pairKey(a.id, m.id)]?.war && T.pairs[pairKey(b.id, m.id)]?.war) || (a.war && b.war);
        const commonThreat = !!top && top !== a.id && top !== b.id;
        const neighbours = citiesOf(a.id).some((x) => citiesOf(b.id).some((y) => x.landmass === y.landmass));
        const trading = T.cities.some((c) => (c.owner === a.id && c.trade?.[b.id] > 0) || (c.owner === b.id && c.trade?.[a.id] > 0));
        const fear = !!top && (top === a.id || top === b.id);
        const rest = pairRest(a, b, { pact: p.pact, allied: p.allied, neighbours, commonEnemy, commonThreat, fear, trading });
        if (!p.war) p.rel = clampRel(p.rel + Math.sign(rest - p.rel) * Math.min(Math.abs(rest - p.rel), 1.2));
        if (T.time < GRACE) continue;
        const d = pairDecision({ ...a, power: militaryPower(a.id) }, { ...b, power: militaryPower(b.id) }, p, { commonThreat });
        if (!d) continue;
        const [x, y] = d.by === "A" ? [a, b] : [b, a];
        if (d.kind === "war") rivalWar(x, y);
        else if (d.kind === "peace") {
          p.war = false;
          p.warFor = 0;
          p.rel = Math.max(p.rel, -10);
          vehiclesOf(a.id).concat(vehiclesOf(b.id)).filter((v) => v.order?.city && (v.order.city.owner === a.id || v.order.city.owner === b.id)).forEach((v) => (v.order = null));
          news(`The ${a.name} and the ${b.name} have made peace.`, 4, a);
        } else if (d.kind === "ally") {
          p.allied = true;
          news(commonThreat ? `The ${a.name} and the ${b.name} have allied against ${top === YOU ? "you" : "the " + nationOf(top).name}!` : `The ${a.name} and the ${b.name} are now allies.`);
        } else if (d.kind === "pact") {
          p.pact = true;
          news(`The ${a.name} and the ${b.name} signed a trade agreement.`, 3);
        } else if (d.kind === "break") {
          p.allied = false;
          news(`The alliance between the ${a.name} and the ${b.name} has broken.`, 3);
        }
      }
    // Allies stand by each other: a nation at war with one ally finds the other at war with it too.
    for (const n of alive) {
      if (!n.war) {
        const ally = alive.find((m) => m !== n && T.pairs[pairKey(n.id, m.id)]?.allied && m.war);
        if (ally && n.relation < 30 && !n.allied && Math.random() < 0.2) {
          n.war = true;
          n.pact = false;
          const said = `We stand with our allies, the ${ally.name}.`;
          logTalk(n, "them", said, "They declared war, to stand by their ally.");
          post(n, { kind: "notice", text: said, choices: [{ id: "ok", label: "⚔ So be it" }, { id: "talk", label: "🕊 Talk peace" }] }, true);
        }
      }
    }
  }
  /** One rival declares war on another: the victim's allies turn on the aggressor (and may join in). */
  function rivalWar(x, y) {
    const p = pairOf(x, y);
    p.war = true;
    p.allied = p.pact = false;
    p.warFor = 0;
    p.rel = clampRel(p.rel - 20);
    news(`The ${x.name} have declared war on the ${y.name}!`, 4, x);
    for (const m of T.nations) {
      if (!m.alive || m === x || m === y) continue;
      const my = T.pairs[pairKey(m.id, y.id)];
      if (my?.allied) {
        const mx = pairOf(m, x);
        mx.rel = clampRel(mx.rel - 25);
        if (!mx.war && !mx.allied && Math.random() < 0.6) {
          mx.war = true;
          mx.pact = false;
          mx.warFor = 0;
          news(`The ${m.name} join the war on the side of the ${y.name}.`, 3.5, m);
        }
      }
    }
    // Your ally under attack asks for your help.
    if (y.allied && !x.war && !inboxOf(y))
      post(y, { kind: "joinWar", text: `The ${x.name} have attacked us! Will you stand with us?`, enemy: x.id, choices: [{ id: "accept", label: `⚔ War on the ${x.name}` }, { id: "decline", label: "Stay out of it" }] });
  }

  /* ---- sheets ------------------------------------------------------------------------------------------ */
  let sheet = null; // { kind, city?, nation? }
  function openSheet(kind, extra = {}) {
    // Uniting the planet isn't a sheet: it's a celebration that takes the whole screen.
    if (kind === "won") return showVictory();
    const fresh = !sheet || sheet.kind !== kind;
    sheet = { kind, ...extra };
    $h("#cvMenuPanel").hidden = true;
    closePeek();
    hud.classList.add("sheetOpen");
    const el = $h("#cvSheet");
    el.dataset.kind = kind;
    if (fresh) {
      o.sfx("uiOpen");
      // Replay the opening bounce for a new sheet (not for a refresh of the same one).
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
      el.scrollTop = 0;
    }
    renderSheet();
  }
  function closeSheet() {
    if (sheet) o.sfx("uiClose");
    sheet = null;
    $h("#cvSheet").hidden = true;
    hud.classList.remove("sheetOpen");
  }
  const dis = (off) => (off ? 'aria-disabled="true"' : "");
  const bar = (frac, cls = "") => `<span class="tsRel cvBar ${cls}"><b style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></b></span>`;
  let sheetHtml = "",
    sheetPress = false,
    pendingReact = null;
  $h("#cvSheet").addEventListener("pointerdown", () => (sheetPress = true));
  const onSheetRelease = () => setTimeout(() => (sheetPress = false), 0);
  window.addEventListener("pointerup", onSheetRelease);
  function renderSheet(force = true) {
    const el = $h("#cvSheet");
    if (!sheet) {
      hud.classList.remove("sheetOpen");
      return void (el.hidden = true);
    }
    el.hidden = false;
    let html = "";
    if (sheet.kind === "city") html = cityHtml(sheet.city);
    else if (sheet.kind === "nation") html = nationHtml(sheet.nation);
    else if (sheet.kind === "designs") html = designsHtml();
    else if (sheet.kind === "spice") html = spiceHtml(sheet.gz);
    else if (sheet.kind === "economy") html = economyHtml();
    else if (sheet.kind === "messages") html = messagesHtml();
    else if (sheet.kind === "world") html = worldHtml();
    else if (sheet.kind === "lost") html = lostHtml();
    else html = helpHtml();
    // Live refreshes skip identical content, so a finger mid-tap never loses its button.
    if (!force && html === sheetHtml) return;
    sheetHtml = html;
    el.innerHTML = html;
    el.querySelector(".tsClose")?.addEventListener("click", closeSheet);
    bindSheet(el);
    if (pendingReact && sheet.kind === "nation") {
      const stage = el.querySelector("#cvLeaderStage");
      stage?.classList.add("react-" + pendingReact);
      pendingReact = null;
    }
  }
  const RICHNESS = (r) => (r >= 2 ? "Very rich" : r >= 1.5 ? "Rich" : r >= 1 ? "Ordinary" : "Poor");
  /* -- pieces every sheet is built from (the design system's components; styles in civ-ui.css) -- */
  /** A design's picture (rendered from your model), or its icon while the picture is on its way. */
  const thumbOf = (design, icon = "", cls = "") => {
    const url = design ? thumbs.get(design) : null;
    return `<span class="cvThumb ${cls}">${url ? `<img src="${url}" alt="">` : `<span class="cvThumbIc">${icon}</span>`}</span>`;
  };
  /** Sheet header: icon, title, subtitle and the close button. `tone` colours its ribbon. */
  const head = (icon, title, sub = "", tone = "") =>
    `<div class="tsHead cvHead ${tone}"><span class="cvHeadIc">${icon}</span><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div><button class="tsClose" aria-label="Close">${ico("close")}</button></div>`;
  /** A stat chip: icon, big number, label. */
  const chip = (icon, value, label, cls = "") => `<span class="cvChip ${cls}">${icon}<b>${value}</b><small>${label}</small></span>`;
  /** A chunky gauge of 0..max in pips (for vehicle and building stats: no walls of numbers). */
  const pips = (v, max = 10, cls = "") => `<span class="cvPips ${cls}" role="img" aria-label="${Math.round(v)} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < Math.round(v) ? "on" : ""}"></i>`).join("")}</span>`;
  const sectionTitle = (text, extra = "") => `<h5 class="tsKind cvKind">${text}${extra ? `<small>${extra}</small>` : ""}</h5>`;
  /** Building themes: each kind of building has a colour and a family name. */
  const ROLE_THEME = { house: ["res", "Residential"], factory: ["ind", "Industrial"], fun: ["ent", "Entertainment"], temple: ["rel", "Religious"], turret: ["mil", "Military"], hall: ["adm", "Administrative"] };

  /** A spice geyser: how rich it is, whose it is, what it pumps, and what you can do about it. */
  function spiceHtml(g) {
    const land = nearestCity(g.d);
    const sel = [...T.selected].filter((v) => !v.dead && v.owner === YOU);
    const lvl = g.level || 1;
    const next = lvl < 3 ? { ...g, level: lvl + 1, owner: g.owner || YOU } : null;
    let body;
    if (g.owner === YOU)
      body = `<p class="tsHint">Your derrick pumps <b>${spiceYield(g).toFixed(2)} spice a second</b>. ${next ? `Upgrading it to level ${lvl + 1} makes that ${spiceYield(next).toFixed(2)}.` : "It's fully upgraded."}</p>
        <div class="tsBtns">${next ? `<button class="good" id="cvUpgrade" ${dis(T.money < DERRICK_UPGRADE[lvl])}>${ico("plus")} Level ${lvl + 1} · §${DERRICK_UPGRADE[lvl]}</button>` : ""}<button id="cvLook">${ico("look")} Look here</button></div>`;
    else if (g.owner)
      body = `<p class="tsHint">A derrick of the ${esc(ownerName(g.owner))}, pumping ${spiceYield(g).toFixed(2)} a second for them. Military vehicles can wreck it (that means war); then any vehicle can claim the geyser. Taking the city whose land it's on takes the derrick too.</p>
        <div class="tsBtns">${sel.some((v) => v.role === "military") ? `<button class="bad" id="cvClaim">${ico("attack")} Send ${sel.filter((v) => v.role === "military").length} to wreck it</button>` : ""}<button id="cvLook">${ico("look")} Look here</button></div>`;
    else
      body = `<p class="tsHint">A free geyser: any vehicle that can reach it builds a derrick, pumping ${spiceYield({ ...g, owner: YOU, level: 1 }).toFixed(2)} spice a second at first. Boats can't reach geysers.</p>
        <div class="tsBtns">${sel.length ? `<button class="good" id="cvClaim">${ico("move")} Send ${sel.length} to claim it</button>` : ""}<button id="cvLook">${ico("look")} Look here</button></div>`;
    return `${head(ico("spice"), `${RICHNESS(g.rich)} spice geyser`, `${g.owner ? esc(cap(ownerName(g.owner))) + " · derrick level " + lvl : "Unclaimed"}${land ? " · on " + esc(land.name) + "'s land" : ""}`, "spice")}
      <div class="cvChips">${chip(ico("spice"), "×" + g.rich, "richness", "spice")}${chip(ico("derrick"), g.owner ? spiceYield(g).toFixed(2) : "—", "per second", "spice")}${chip(ico("money"), "§" + T.price.toFixed(1), "per spice", "money")}</div>
      ${body}`;
  }
  /** Your economy, drawn rather than tabulated: income sources, the spice market, routes and derricks. */
  function economyHtml() {
    const cities = yourCities().reduce((s, c) => s + cityEconomy(c, ownerMods(YOU)).income, 0);
    const routes = tradeIncome(T.cities, YOU);
    const pact = pactBonus();
    const traders = vehiclesOf(YOU).filter((v) => v.role === "economic");
    const mine = T.geysers.filter((g) => g.owner === YOU);
    const sell = (amount) => sellSpice(T.price, amount).money;
    const chunk = Math.min(Math.floor(T.spice), 25);
    const trend = T.price > SPICE_PRICE.usual * 1.15 ? "high" : T.price < SPICE_PRICE.usual * 0.85 ? "low" : "usual";
    const total = Math.max(0.01, cities + routes + pact);
    const slice = (v, cls, label) => (v > 0 ? `<i class="${cls}" style="flex:${v.toFixed(2)}" title="${label}"></i>` : "");
    // Trade routes: every city of someone else's that you trade with (or that trades with yours).
    const links = [];
    for (const c of T.cities) {
      if (c.owner !== YOU && (c.trade?.[YOU] || 0) > 0) links.push({ mine: null, them: c, level: c.trade[YOU] });
    }
    const onRoad = (c) => traders.filter((v) => v.order?.type === "city" && v.order.city === c).length;
    const routeRows = links
      .map(({ them, level }) => {
        const n = nationOf(them.owner);
        const cut = n?.war;
        return `<li class="cvRoute ${cut ? "cut" : ""}"><span class="cvRouteEnds"><b>${esc(capital().name)}</b><i class="cvRouteLine">${traders.length ? `<em style="--n:${onRoad(them)}"></em>` : ""}</i><b style="--nc:${hex(ownerColor(them.owner))}">${esc(them.name)}</b></span>
          <small>${cut ? "Disrupted: at war with the " + esc(n.name) : `${n ? "The " + esc(n.name) : "Independent"} · trade ${Math.round(level)}% · ${onRoad(them)} on the road${n?.pact ? " · trade agreement +50%" : ""}`}</small></li>`;
      })
      .join("");
    return `${head(ico("money"), "Economy", "Money pays for buildings and vehicles; spice for military vehicles", "money")}
      <div class="cvChips">${chip(ico("money"), Math.floor(T.money), "money", "money")}${chip(ico("income"), "+" + income().toFixed(1), "§ a second", "good")}${chip(ico("spice"), Math.floor(T.spice), "spice", "spice")}${chip(ico("derrick"), "+" + spiceIncome().toFixed(1), "spice a second", "spice")}</div>
      ${sectionTitle("Where the money comes from")}
      <div class="cvFlow" role="img" aria-label="Income: cities §${cities.toFixed(1)}, trade routes §${(routes + pact).toFixed(1)} a second">${slice(cities, "res", "Cities")}${slice(routes + pact, "trade", "Trade")}</div>
      <div class="cvFlowKey"><span class="res">${ico("city")} Cities §${cities.toFixed(1)}/s</span><span class="trade">${ico("trade")} Trade §${(routes + pact).toFixed(1)}/s</span><span>${Math.round((cities / total) * 100)}% from your own cities</span></div>
      ${sectionTitle("Trade routes", `${links.length} partner${links.length === 1 ? "" : "s"} · ${traders.length} trade vehicle${traders.length === 1 ? "" : "s"}`)}
      <ul class="cvRoutes">${routeRows || `<li class="cvEmpty">No routes yet. Send economic vehicles to another nation's city (or a free one): every delivery pays you both.</li>`}</ul>
      ${sectionTitle("Spice market", `§${T.price.toFixed(2)} a spice`)}
      <div class="cvMarket ${trend}"><span class="cvMarketDial"><i style="--p:${Math.max(0, Math.min(1, (T.price - SPICE_PRICE.min) / (SPICE_PRICE.max - SPICE_PRICE.min))).toFixed(3)}"></i></span><span><b>${trend === "high" ? "A good time to sell" : trend === "low" ? "Prices are low" : "An ordinary price"}</b><small>Every sale pushes the price down a little (rival nations sell too).</small></span></div>
      <div class="tsBtns cvSell"><button class="gift" id="cvSell25" ${dis(chunk < 1)}>Sell ${chunk}<small>§${sell(chunk)}</small></button><button class="gift" id="cvSellHalf" ${dis(T.spice < 2)}>Sell half<small>§${sell(Math.floor(T.spice / 2))}</small></button><button class="gift" id="cvSellAll" ${dis(T.spice < 1)}>Sell all<small>§${sell(Math.floor(T.spice))}</small></button></div>
      ${sectionTitle("Your derricks", String(mine.length))}
      <div class="tsTrade cvCards">${
        mine
          .map((g) => `<button class="tsTradeBtn cvCard spice" data-geyser="${g.id}"><span class="cvThumb"><span class="cvThumbIc">${ico("derrick")}</span></span><b>${RICHNESS(g.rich)} · level ${g.level}<small>${spiceYield(g).toFixed(2)}/s${nearestCity(g.d) ? " · " + esc(nearestCity(g.d).name) : ""}</small></b><em>${g.level < 3 ? "⬆ §" + DERRICK_UPGRADE[g.level] : "max"}</em></button>`)
          .join("") || '<p class="tsHint cvEmpty">None yet: send any vehicle to a spice geyser (the glowing plumes) to claim it.</p>'
      }</div>`;
  }
  /** A city's postcard: its skyline drawn from the real buildings on its plots, in its owner's colours. */
  function postcard(c, econ) {
    const built = c.plots.filter(Boolean);
    const sky = c.plots.map((role) => (role ? thumbOf(ownerDesign(c.owner, role), ROLE_ICON[role], "sky " + ROLE_THEME[role][0]) : "")).filter(Boolean);
    const hall = thumbOf(ownerDesign(c.owner, "hall"), ROLE_ICON.hall, "sky hall");
    // The hall in the middle, the rest either side of it.
    const half = Math.ceil(sky.length / 2);
    const mood = econ.riot ? "riot" : econ.happiness > 0 ? "happy" : econ.happiness < 0 ? "glum" : "";
    return `<div class="cvPostcard ${mood}" style="--oc:${hex(ownerColor(c.owner))}">
      <div class="cvSkyline">${sky.slice(0, half).join("")}${hall}${sky.slice(half).join("")}</div>
      <div class="cvPostName"><span class="cvTypeBadge ${c.type}">${CITY_TYPES[c.type].icon}</span><span><b>${esc(c.name)}</b><small>${c.owner === YOU ? (c === capital() ? "Your capital" : "Your city") : esc(cap(ownerName(c.owner)))} · ${CITY_TYPES[c.type].name} city · ${built.length}/${PLOTS} built</small></span></div>
    </div>`;
  }
  function cityHtml(c) {
    const econ = cityEconomy(c, ownerMods(c.owner));
    const close = `<button class="tsClose cvFloatClose" aria-label="Close">${ico("close")}</button>`;
    const stats = `<div class="cvChips cvCityStats">${chip(ico("population"), econ.pop + "k", "people", "res")}${chip(ico(econ.happiness >= 0 ? "happy" : "sad"), (econ.happiness > 0 ? "+" : "") + econ.happiness, econ.riot ? "rioting!" : "happiness", econ.riot ? "bad" : econ.happiness >= 0 ? "good" : "warn")}${chip(ico("income"), econ.income.toFixed(1), "§ a second", "money")}${chip(ico("turret"), c.turrets, "turrets", "mil")}</div>`;
    if (c.owner === YOU) {
      const plots = c.plots
        .map((role, k) => {
          const fresh = sheet.fresh === k ? " fresh" : "";
          return role
            ? `<button class="cvPlot built ${ROLE_THEME[role][0]}${fresh}" data-plot="${k}" aria-label="${ROLES.building[role].name}: tap to demolish">${thumbOf(T.designs.building[role], ROLE_ICON[role])}<small>${ROLES.building[role].name}</small></button>`
            : `<button class="cvPlot empty${sheet.plot === k ? " picking" : ""}" data-plot="${k}" aria-label="Empty plot: tap to build" aria-pressed="${sheet.plot === k}">${ico("plus")}<small>${sheet.plot === k ? "Choose below" : "Empty plot"}</small></button>`;
        })
        .join("");
      const choosing = sheet.plot != null && !c.plots[sheet.plot];
      const choices = choosing
        ? `<div class="cvBuildCards">${PLOT_ROLES.map((r) => {
            const s = designStats(T.designs.building[r]).stats;
            const short = Math.max(0, BUILD_COST[r] - Math.floor(T.money));
            return `<button class="cvBuildCard ${ROLE_THEME[r][0]}" data-build="${r}" ${dis(short > 0)}>
              <span class="cvBuildFamily">${ROLE_THEME[r][1]}</span>${thumbOf(T.designs.building[r], ROLE_ICON[r])}
              <b>${esc(T.designs.building[r].name || ROLES.building[r].name)}</b>
              <small class="cvEffect">${esc(ROLES.building[r].desc)}</small>
              <span class="cvStatLine">${ico("power")} Design strength ${pips(s.strength, 10, "small")}</span>
              <em class="cvCost">${short > 0 ? `Need §${short} more` : `§${BUILD_COST[r]}`}</em></button>`;
          }).join("")}</div><p class="tsHint">A stronger design does its job better. Improve one under ${ico("designs")} Designs.</p>`
        : "";
      const vcap = vehicleCap(YOU),
        have = vehiclesOf(YOU).length;
      const modes = allowedModes(yourCities().length, c.coastal);
      const role = c.type;
      const builds = designKeys(role)
        .map((key) => {
          const mode = key.split(":")[1];
          const d = T.designs.vehicle[key];
          const u = vehicleUnit(d, mods);
          const locked = !modes.includes(mode);
          const why = mode === "sea" && !c.coastal ? "Inland city: no harbour" : mode === "air" && locked ? `Needs ${AIR_AT} cities` : "";
          const k = clsOf(u);
          const sp = spiceCost(u);
          const st = designStats(d).stats;
          return `<button class="cvVehCard ${locked ? "locked" : ""}" data-vehicle="${key}" ${dis(locked || have + queued() >= vcap || c.queue.length >= QUEUE_MAX || T.money < u.cost || T.spice < sp || !u.ok)}>
            ${thumbOf(d, k ? k.icon : MODE_ICON[mode])}${locked ? `<span class="cvLock">${ico("lock")}</span>` : ""}
            <b>${esc(d.name)}<small>${why || `${k ? k.name : MODE_NAME[mode]} · ${buildTime(u, c, strengths)}s`}</small></b>
            <span class="cvMiniStats"><span>${ico("speed")}${pips(st.speed, 10, "small")}</span><span>${ico("health")}${pips(st.health, 10, "small")}</span><span>${ico(role === "military" ? "attack" : role === "economic" ? "trade" : "faith")}${pips(st.power, 10, "small")}</span></span>
            <em class="cvCost">§${u.cost}${sp ? ` <i>${ico("spice")}${sp}</i>` : ""}</em></button>`;
        })
        .join("");
      const queue = c.queue.length
        ? `<div class="cvQueue">${c.queue
            .map((q, i) => {
              const d = vehicleDesign(YOU, q.key);
              const k = clsOf(vehicleUnit(d, mods));
              return `<button class="cvQItem ${i ? "wait" : "now"}" data-cancel="${i}" style="--p:${q.done.toFixed(3)}" aria-label="${esc(d.name)}, ${Math.round(q.done * 100)}% built: tap to cancel and get a refund">${thumbOf(d, k?.icon || "🚙")}<span class="cvQRing"></span><small>${i ? "Next" : Math.round(q.done * 100) + "%"}</small><i class="cvQX">${ico("close")}</i></button>`;
            })
            .join("")}</div>`
        : "";
      return `${close}${postcard(c, econ)}${stats}
        ${econ.riot ? `<p class="cvAlert bad">${ico("sad")} <span><b>${esc(c.name)} is rioting!</b> Build entertainment, or fewer factories.</span></p>` : ""}
        ${sectionTitle("Buildings", "tap an empty plot to build, a building to knock it down")}<div class="cvPlots">${plots}</div>${choices}
        <div class="tsBtns cvRow"><button class="mil" id="cvTurret" ${dis(c.turrets >= MAX_TURRETS || T.money < BUILD_COST.turret)}>${ico("turret")} Turret · §${BUILD_COST.turret} <small>${c.turrets}/${MAX_TURRETS}</small></button><button id="cvFocus">${ico("look")} Look here</button></div>
        ${sectionTitle(`${CITY_TYPES[role].icon} ${CITY_TYPES[role].name} vehicles`, `${have}/${vcap} in service${c.queue.length ? ` · building ${c.queue.length}/${QUEUE_MAX}` : ""}`)}${queue}<div class="cvVehCards">${builds}</div>
        <p class="tsHint">${CITY_TYPES[role].desc}</p>`;
    }
    const nat = nationOf(c.owner);
    const myTrade = c.trade[YOU] || 0,
      myConv = c.conv[YOU] || 0;
    const cost = buyoutCost(econ, nat ? nat.relation : 0);
    const sel = [...T.selected].filter((v) => !v.dead);
    const meter = (icon, label, frac, cls) => `<div class="cvMeter ${cls}">${icon}<span><small>${label}</small>${bar(frac, cls)}</span><b>${Math.round(frac * 100)}%</b></div>`;
    return `${close}${postcard(c, econ)}${stats}
      <div class="cvMeters">${meter(ico("turret"), "Turrets", c.turrets ? c.turretHp : 0, "foe")}${meter(ico("capital"), "City hall", c.hallHp, "foe")}${meter(ico("trade"), "Your trade", myTrade / 100, "trade")}${meter(ico("faith"), "Converted to you", myConv / 100, "faith")}</div>
      ${nat ? `<p class="tsHint cvRelLine" style="--nc:${hex(nat.color)}">${esc(nat.leader.title)} ${esc(nat.leader.name)} of the ${esc(nat.name)}: <b>${relationWord(nat.relation, nat.war)}</b> (${Math.round(nat.relation)}).</p>` : `<p class="tsHint">An independent city: it belongs to no nation, and any nation can take it.</p>`}
      <div class="tsBtns">
        <button class="good" id="cvSend" ${dis(!sel.length)}>${ico("move")} Send ${sel.length || ""} selected</button>
        <button class="gift" id="cvBuy" ${dis(myTrade < 100 || T.money < cost)}>${ico("money")} Buy · §${cost}</button>
        ${nat?.alive ? `<button class="talk" id="cvContact">${ico("talk")} Contact ${esc(nat.leader.title)}</button>` : ""}
      </div>
      <p class="tsHint">${sel.length ? "Military vehicles attack its turrets, then its hall. Economic ones trade (buy it when trade is full). Religious ones preach until it converts." : "Select vehicles first (tap them, or All), then send them here."}${nat && !nat.war && sel.some((v) => v.role === "military") ? " <b>Attacking means war with this nation.</b>" : ""}</p>`;
  }
  /** How a leader feels, as a word the portrait acts out. */
  const moodOf = (n) => (n.war ? "angry" : n.relation >= 60 ? "delighted" : n.relation >= 20 ? "happy" : n.relation > -20 ? "neutral" : n.relation > -50 ? "wary" : "cross");
  const MOOD_FACE = { delighted: "😄", happy: "🙂", neutral: "😐", wary: "😒", cross: "😠", angry: "😡" };
  const moodFace = (n) => MOOD_FACE[moodOf(n)];
  /** What a leader says when you call and nothing's been said yet: each sounds like itself. */
  const IDLE_LINE = {
    aggressive: "Speak quickly. My patience is short and my claws are sharp.",
    friendly: "Oh! A call! Come in, come in, mind the tentacles.",
    greedy: "Ah, a customer. What are you buying? Everything has a price.",
    religious: "The stars told me you would call. They are rarely wrong.",
    cautious: "We are listening. Carefully. From a safe distance.",
  };
  /** What each thing you can say is for (shown on its card), and the colour family it belongs to. */
  const OPTION_UI = {
    introduce: ["good", "Say hello and open relations"],
    gift: ["gift", "Warm them up with money"],
    pact: ["trade", "Trade routes pay half as much again"],
    alliance: ["good", "Allies help each other in war"],
    assist: ["good", "Ask your ally to send help"],
    beliefs: ["faith", "Talk faith: devout leaders love it"],
    buy: ["trade", "Make an offer for one of their cities"],
    demand: ["bad", "Ask for tribute: the weak may pay"],
    threaten: ["bad", "Scare them into backing down"],
    peace: ["good", "End the war, for a price"],
    war: ["bad", "Open hostilities"],
  };
  /** The conversation with a nation's leader: a big, living portrait, what they say, what you can say. */
  function nationHtml(n) {
    const P = PERSONALITIES[n.personality];
    const cities = citiesOf(n.id).length;
    const pic = portraitOf(n);
    const pending = inboxOf(n);
    const status = [n.war ? "⚔ At war" : "", n.allied ? "🛡 Allied" : "", n.pact ? "🤝 Trade agreement" : "", T.time < n.cowedUntil ? "😨 Cowed" : "", T.time < n.preachUntil ? "🕯 Preaching to you" : "", !n.met ? "👋 Not met yet" : ""].filter(Boolean);
    const said = sheet.reply ? sheet.reply.text : pending ? pending.msg.text : !n.met ? "…?" : n.log.length ? n.log[n.log.length - 1].text : IDLE_LINE[n.personality] || "";
    const rel = Math.round(n.relation);
    const delta = sheet.reply?.delta || 0;
    const top = `<div class="cvComms" style="--nc:${hex(n.color)}">
      <button class="tsClose cvFloatClose" aria-label="Close">${ico("close")}</button>
      <div class="cvCommsStage mood-${moodOf(n)} ${n.personality}" id="cvLeaderStage">
        <span class="cvRays" aria-hidden="true"></span>
        <div class="cvLeaderPic">${pic ? `<img src="${pic}" alt="${esc(n.leader.title)} ${esc(n.leader.name)}">` : `<span>${CITY_TYPES[n.type].icon}</span>`}</div>
        <span class="cvMood" aria-label="Mood: ${moodOf(n)}">${moodFace(n)}</span>
        <span class="cvFx" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      <div class="cvLeaderName"><b>${esc(n.leader.title)} ${esc(n.leader.name)}</b><small>${CITY_TYPES[n.type].icon} The ${esc(n.name)} · ${P.icon} ${P.name} · ${cities} ${cities === 1 ? "city" : "cities"}</small></div>
      ${said ? `<div class="cvSpeech${sheet.reply ? (sheet.reply.accept ? " yes" : " no") : ""}">${esc(said)}</div>` : ""}
      <div class="cvRelMeter${n.war ? " war" : ""}" role="img" aria-label="Relations ${rel}: ${relationWord(n.relation, n.war)}"><span class="cvRelTrack"><i style="--p:${((n.relation + 100) / 200).toFixed(3)}"></i></span><span class="cvRelText"><b>${relationWord(n.relation, n.war)}</b> ${rel}${delta ? ` <em class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta}</em>` : ""}</span></div>
      ${sheet.reply?.summary ? `<p class="cvOutcome ${sheet.reply.accept ? "good" : "bad"}">${sheet.reply.accept ? "✓" : "✗"} ${esc(sheet.reply.summary)}</p>` : ""}
      ${status.length || standing(n) ? `<div class="cvStatus">${status.map((x) => `<span>${x}</span>`).join("")}${standing(n) ? `<span class="wide">${esc(standing(n))}</span>` : ""}</div>` : ""}
      <p class="cvStrength">${ico("sword")} Their strength ${Math.round(militaryPower(n.id))} · yours ${Math.round(militaryPower(YOU))} · ${vehiclesOf(n.id).length} vehicles</p>
    </div>`;
    if (sheet.tab === "log") {
      const rows = n.log
        .slice()
        .reverse()
        .map((l) => `<li class="${l.who}"><small>${clockText(l.t)} · ${l.who === "you" ? "You" : esc(n.leader.name)}</small>${esc(l.text)}${l.summary ? `<em>${esc(l.summary)}</em>` : ""}</li>`)
        .join("");
      return `${top}<div class="tsBtns cvTabs"><button class="talk" id="cvTalkTab">${ico("talk")} Talk</button><button id="cvWorldTab">${ico("world")} The world</button></div><ul class="cvLog cvChat">${rows || "<li>Nothing said yet.</li>"}</ul>`;
    }
    let choices;
    if (pending && pending.msg.kind !== "notice")
      choices = `<p class="cvWaiting">${ico("mail")} They're waiting for your answer <b>${Math.max(0, Math.ceil(pending.until - T.time))}s</b></p><div class="cvChoices cvAnswers">${pending.msg.choices.map((c) => `<button class="${/decline|no|refuse|reject/i.test(c.id) ? "bad" : "good"}" data-answer="${c.id}">${esc(c.label)}</button>`).join("")}</div>`;
    else if (pending) choices = `<div class="cvChoices cvAnswers">${pending.msg.choices.map((c) => `<button class="${c.id === "talk" ? "good" : ""}" data-answer="${c.id}">${esc(c.label)}</button>`).join("")}</div>`;
    else if (!n.alive) choices = '<p class="tsHint">This nation is no more.</p>';
    else {
      const sale = cityForSale(n);
      choices = `<div class="cvChoices">${availableOptions(commsCtx(n))
        .map((op) => {
          const [tone, what] = OPTION_UI[op.id] || ["", ""];
          return `<button data-talk="${op.id}" class="${tone}" ${dis(!op.ok)}><span class="cvOpIc">${op.icon}</span><b>${esc(op.id === "buy" && sale ? `Buy ${sale.c.name}` : op.name)}</b><small>${op.ok ? (op.cost ? `§${op.cost} · ` : "") + esc(what) : esc(op.why)}</small></button>`;
        })
        .join("")}</div>`;
    }
    return `${top}${choices}<div class="tsBtns cvTabs"><button id="cvLogTab">${ico("history")} History (${n.log.length})</button><button id="cvWorldTab">${ico("world")} The world</button></div>`;
  }
  /** How a nation stands with the other rivals (for its conversation sheet). */
  function standing(n) {
    const others = T.nations.filter((m) => m !== n && m.alive);
    const wars = others.filter((m) => T.pairs[pairKey(n.id, m.id)]?.war).map((m) => m.name);
    const allies = others.filter((m) => T.pairs[pairKey(n.id, m.id)]?.allied).map((m) => m.name);
    return [wars.length ? "⚔ At war with the " + wars.join(" and the ") : "", allies.length ? "🛡 Allied with the " + allies.join(" and the ") : ""].filter(Boolean).join(" · ");
  }
  /** The world: every nation (a portrait card each), how they stand with each other, and the news. */
  function worldHtml() {
    const alive = T.nations.filter((n) => n.alive);
    const top = dominantPower();
    const total = T.cities.length;
    const share = (id) => T.cities.filter((c) => c.owner === id).length;
    const owners = [YOU, ...T.nations.map((n) => n.id), null];
    const strip = owners.map((id) => (share(id) ? `<i style="flex:${share(id)};--nc:${hex(ownerColor(id))}" title="${esc(id === YOU ? "You" : id ? nationOf(id).name : "Independent")}: ${share(id)}"></i>` : "")).join("");
    const cards = [YOU, ...alive.map((n) => n.id)]
      .map((id) => {
        const n = nationOf(id);
        const cities = share(id);
        const pic = n ? portraitOf(n) : "";
        return `<button class="cvNationCard ${n ? "mood-" + moodOf(n) : "you"}" ${n ? `data-open="${n.id}"` : "disabled"} style="--nc:${hex(ownerColor(id))}">
          <span class="cvNationFace">${n ? (pic ? `<img src="${pic}" alt="">` : CITY_TYPES[n.type].icon) : ico("capital")}${n ? `<em>${moodFace(n)}</em>` : ""}</span>
          <b>${n ? "The " + esc(n.name) : esc(o.name || "Your nation")}<small>${n ? `${esc(n.leader.title)} ${esc(n.leader.name)} · ${PERSONALITIES[n.personality].icon} ${PERSONALITIES[n.personality].name}` : "You"}</small></b>
          <span class="cvNationNums"><span>${ico("city")}${cities}</span><span>${ico("sword")}${Math.round(militaryPower(id))}</span></span>
          ${n ? `<span class="cvNationRel ${n.war ? "war" : n.allied ? "ally" : ""}">${n.war ? "⚔ War" : n.allied ? "🛡 Ally" : relationWord(n.relation, n.war)}</span>` : ""}</button>`;
      })
      .join("");
    const pairs = [];
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i],
          b = alive[j],
          p = pairOf(a, b);
        pairs.push(`<li class="cvPair ${p.war ? "war" : p.allied ? "ally" : ""}"><b style="--nc:${hex(a.color)}">${esc(a.name)}</b><span>${p.war ? "⚔" : p.allied ? "🛡" : p.pact ? "🤝" : "·"}</span><b style="--nc:${hex(b.color)}">${esc(b.name)}</b><small>${p.war ? "At war" : p.allied ? "Allies" : relationWord(p.rel, false)} (${Math.round(p.rel)})${p.pact && !p.allied ? " · trade agreement" : ""}</small></li>`);
      }
    const independent = citiesOf(null).length;
    return `${head(ico("world"), "The world", `${total} cities · ${independent} independent`, "world")}
      <div class="cvShare" role="img" aria-label="Who holds the planet's cities">${strip}</div>
      ${top ? `<p class="cvAlert bad">${ico("attack")} <span>${top === YOU ? "You hold" : "The " + esc(nationOf(top).name) + " hold"} ${Math.round(shareOf(top) * 100)}% of the planet's cities: the other nations are uniting against ${top === YOU ? "you" : "them"}.</span></p>` : ""}
      ${sectionTitle("Nations", "tap a leader to talk")}<div class="cvNationCards">${cards}</div>
      ${sectionTitle("Between the rivals")}<ul class="cvPairs">${pairs.join("") || "<li>No rivals left.</li>"}</ul>
      ${sectionTitle("News")}<ul class="cvLog cvNews">${T.newsLog
        .slice()
        .reverse()
        .map((x) => `<li><small>${clockText(x.t)}</small>${esc(x.text)}</li>`)
        .join("") || "<li>Nothing yet.</li>"}</ul>`;
  }
  const clockText = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  /** Everything every leader has said to you (and you to them), newest first, as a chat. */
  function messagesHtml() {
    const all = T.nations.flatMap((n) => n.log.map((l) => ({ ...l, n }))).sort((a, b) => b.t - a.t);
    const face = (n) => (portraitOf(n) ? `<img src="${portraitOf(n)}" alt="">` : CITY_TYPES[n.type].icon);
    return `${head(ico("mail"), "Messages", inbox.length ? `${inbox.length} waiting for an answer` : "Everything said between you and the other leaders", "talk")}
      ${inbox.length ? `<div class="cvInbox">${inbox.map((m) => `<button class="cvInboxCard" data-open="${m.n.id}" style="--nc:${hex(m.n.color)}"><span class="cvNoteFace">${face(m.n)}</span><span><b>${esc(m.n.leader.title)} ${esc(m.n.leader.name)}</b><small>${esc(m.msg.text)}</small></span><em>${Math.max(0, Math.ceil(m.until - T.time))}s</em></button>`).join("")}</div>` : ""}
      <ul class="cvLog cvChat">${all.map((l) => `<li class="${l.who}" style="--nc:${hex(l.n.color)}"><small>${clockText(l.t)} · ${l.who === "you" ? "You → " + esc(l.n.name) : esc(l.n.leader.name) + " (" + esc(l.n.name) + ")"}</small>${esc(l.text)}${l.summary ? `<em>${esc(l.summary)}</em>` : ""}</li>`).join("") || "<li>No messages yet. Tap a nation's leader at the top to say hello.</li>"}</ul>`;
  }
  function designsHtml() {
    const buildings = Object.keys(ROLES.building)
      .map((role) => {
        const d = T.designs.building[role];
        const s = designStats(d);
        return `<button class="cvDesignCard ${ROLE_THEME[role][0]}" data-design="building|${role}"><span class="cvBuildFamily">${ROLE_THEME[role][1]}</span>${thumbOf(d, ROLE_ICON[role])}<b>${esc(d.name)}<small>${ROLES.building[role].name}</small></b><span class="cvStatLine">${ico("power")}${pips(s.stats.strength, 10, "small")}</span><em>Edit</em></button>`;
      })
      .join("");
    const owned = new Set(yourCities().map((c) => c.type));
    const vehicles = TYPE_IDS.map((role) => {
      const rows = designKeys(role)
        .map((key) => {
          const d = T.designs.vehicle[key];
          const u = vehicleUnit(d, mods);
          const k = clsOf(u);
          const st = designStats(d).stats;
          const custom = key.split(":").length === 3;
          return `<div class="cvDesignRow"><button class="cvVehCard cvDesign" data-design="vehicle|${key}">${thumbOf(d, k ? k.icon : MODE_ICON[u.mode])}<b>${esc(d.name)}<small>${k ? k.icon + " " + k.name : MODE_NAME[u.mode]} · §${u.cost}</small></b>
            <span class="cvMiniStats"><span>${ico("speed")}${pips(st.speed, 10, "small")}</span><span>${ico("health")}${pips(st.health, 10, "small")}</span><span>${ico(role === "military" ? "attack" : role === "economic" ? "trade" : "faith")}${pips(st.power, 10, "small")}</span></span><em class="cvEdit">Edit</em></button>
            <div class="cvDesignOps"><button data-copy="${key}" aria-label="Copy ${esc(d.name)}" title="Copy" ${dis(customKeys(role).length >= DESIGNS_PER_ROLE)}>⧉</button>${custom ? `<button data-del="${key}" aria-label="Delete ${esc(d.name)}" title="Delete">🗑</button>` : ""}</div></div>`;
        })
        .join("");
      return `${sectionTitle(`${CITY_TYPES[role].icon} ${CITY_TYPES[role].name} vehicles`, owned.has(role) ? "" : "no city of this kind yet")}
        <div class="cvVehCards cvDesigns">${rows}</div>
        <div class="tsBtns tsWide"><button class="good" data-new="${role}" ${dis(customKeys(role).length >= DESIGNS_PER_ROLE)}>${ico("plus")} New ${CITY_TYPES[role].name.toLowerCase()} design <small>${customKeys(role).length}/${DESIGNS_PER_ROLE}</small></button></div>`;
    }).join("");
    return `${head(ico("designs"), "Designs", "Your cities and vehicles are built from these", "designs")}
      <p class="tsHint">A better design does its job better: more income, stronger turrets, faster or tougher vehicles. What a vehicle carries decides its class: tanks, artillery, warships, torpedo boats, fighters and bombers each fight differently.</p>
      ${sectionTitle("Buildings")}<div class="cvDesignCards">${buildings}</div>
      ${vehicles}`;
  }
  function lostHtml() {
    return `${head("🏳", "Your nation has fallen", "", "bad")}
      <p class="tsWonText">Every one of your cities now flies another flag.</p>
      <div class="tsBtns tsWide"><button class="good" id="cvRestart">Start the Civilization Stage again</button></div>`;
  }
  function helpHtml() {
    return `${head(ico("help"), "How to play", "Civilization Stage", "world")}
      <ul class="tsHelp cvHelp">
        <li>${ico("planet")}<span><b>Look around:</b> drag to turn the planet, pinch or scroll to zoom from orbit down to the streets, twist two fingers (or Q/E) to turn the view. Planet jumps between the whole planet and the ground.</span></li>
        <li>${ico("city")}<span><b>Your cities:</b> tap one, then Open city, to build houses (people), factories (money, but unhappy people), entertainment (happiness), temples (faith) and turrets.</span></li>
        <li>${ico("vehicle")}<span><b>Vehicles:</b> each city makes vehicles of its own kind. Tap vehicles (or All) to select them, double-tap one for every vehicle of its class on screen, or use the box (Shift-drag on a computer) to drag round a group. Then tap a city, a spice geyser, an enemy vehicle or the ground. The card above your vehicles gives more orders: Guard, Patrol, formation, Follow, Stop. Land vehicles stay on their continent; boats (from coastal cities) cross the sea; aircraft go anywhere.</span></li>
        <li>${ico("attack")}<span><b>Take cities</b> three ways: military vehicles knock out turrets and then the hall; economic vehicles run trade until you can buy the city; religious vehicles preach until it converts. Every city you take makes vehicles of its kind.</span></li>
        <li>${ico("spice")}<span><b>Spice:</b> drive any vehicle to a geyser to build a derrick; richer geysers and upgraded derricks pump more. Military vehicles need spice to build; sell the rest on the market (tap your money at the top). Military vehicles can wreck a rival's derrick, and taking a city takes the derricks on its land.</span></li>
        <li>${ico("trade")}<span><b>Production and trade:</b> vehicles are paid for when ordered and built over time; factories build faster. Trade vehicles carry goods between one of your cities and a partner: every delivery pays you both. War, and crossing a hostile nation's land, disrupts trade.</span></li>
        <li>${ico("talk")}<span><b>Nations:</b> tap a leader at the top to talk: gifts, agreements, alliances, threats, peace. Military nations go to war with those they hate; religious ones preach; economic ones trade.</span></li>
        <li>${ico("super")}<span><b>Superweapon:</b> hold half the planet's cities and it's yours: one city at a time, the way you've been winning them.</span></li>
        <li>${ico("world")}<span><b>Goal:</b> unite every city on the planet under your flag. How you do it decides your card.</span></li>
      </ul>
      ${legacy.lines.length ? `${sectionTitle("What your species brings")}<ul class="tsHelp tsLegacy">${legacy.lines.map((l) => `<li>${l.icon} ${esc(l.text)}</li>`).join("")}</ul>` : ""}`;
  }
  /* -- the contextual card: tapping a city or a geyser shows a small card, not a whole management sheet -- */
  let peekOn = null; // { kind: "city", c } | { kind: "geyser", g }
  let peekHtml = "";
  function openPeek(target) {
    peekOn = target;
    const el = $h("#cvPeek");
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    o.sfx("uiSelect");
    renderPeek(true);
  }
  function closePeek() {
    if (!peekOn) return;
    peekOn = null;
    peekHtml = "";
    $h("#cvPeek").hidden = true;
  }
  function renderPeek(force = false) {
    const el = $h("#cvPeek");
    if (!peekOn || sheet) return void (el.hidden = true);
    let html;
    if (peekOn.kind === "city") {
      const c = peekOn.c;
      const econ = cityEconomy(c, ownerMods(c.owner));
      const nat = nationOf(c.owner);
      const sel = [...T.selected].filter((v) => !v.dead).length;
      const mine = c.owner === YOU;
      const extra = mine
        ? chip(ico("vehicle"), c.queue.length ? Math.round((c.queue[0].done || 0) * 100) + "%" : "—", c.queue.length ? "building" : "queue empty", "good")
        : chip(ico("trade"), Math.round(c.trade[YOU] || 0) + "%", "your trade", "money");
      html = `<div class="cvPeekHead" style="--oc:${hex(ownerColor(c.owner))}"><span class="cvTypeBadge ${c.type}">${CITY_TYPES[c.type].icon}</span><b>${esc(c.name)}<small>${mine ? (c === capital() ? "Your capital" : "Your city") : nat ? `The ${esc(nat.name)} · ${relationWord(nat.relation, nat.war)}` : "Independent"} · ${CITY_TYPES[c.type].name}</small></b><button class="cvPeekX" aria-label="Close">${ico("close")}</button></div>
        <div class="cvChips small">${chip(ico("population"), econ.pop + "k", "people", "res")}${chip(ico(econ.happiness >= 0 ? "happy" : "sad"), (econ.happiness > 0 ? "+" : "") + econ.happiness, econ.riot ? "rioting!" : "happiness", econ.riot ? "bad" : "good")}${mine ? chip(ico("income"), econ.income.toFixed(1), "§ a second", "money") : chip(ico("turret"), c.turrets, "turrets", "mil")}${extra}</div>
        <div class="cvPeekBtns">${mine ? `<button class="good" data-peek="open">${ico("build")} Open city</button>` : `<button data-peek="open">${ico("look")} Details</button>${nat?.alive ? `<button class="talk" data-peek="talk">${ico("talk")} Contact</button>` : ""}${sel ? `<button class="good" data-peek="send">${ico("move")} Send ${sel}</button>` : ""}`}</div>`;
    } else {
      const g = peekOn.g;
      const sel = [...T.selected].filter((v) => !v.dead && v.owner === YOU);
      const lvl = g.level || 1;
      const land = nearestCity(g.d);
      const canClaim = g.owner ? g.owner !== YOU && sel.some((v) => v.role === "military") : sel.length > 0;
      html = `<div class="cvPeekHead spice"><span class="cvTypeBadge spice">${ico("spice")}</span><b>${RICHNESS(g.rich)} spice geyser<small>${g.owner ? esc(cap(ownerName(g.owner))) + " · derrick level " + lvl : "Unclaimed"}${land ? " · " + esc(land.name) + "'s land" : ""}</small></b><button class="cvPeekX" aria-label="Close">${ico("close")}</button></div>
        <div class="cvChips small">${chip(ico("spice"), "×" + g.rich, "richness", "spice")}${chip(ico("derrick"), g.owner ? spiceYield(g).toFixed(2) : spiceYield({ ...g, owner: YOU, level: 1 }).toFixed(2), g.owner ? "per second" : "if claimed", "spice")}${chip(ico("money"), "§" + T.price.toFixed(1), "per spice", "money")}</div>
        <div class="cvPeekBtns">${g.owner === YOU && lvl < 3 ? `<button class="good" data-peek="upgrade" ${dis(T.money < DERRICK_UPGRADE[lvl])}>${ico("plus")} Upgrade · §${DERRICK_UPGRADE[lvl]}</button>` : ""}${canClaim ? `<button class="${g.owner ? "bad" : "good"}" data-peek="claim">${ico(g.owner ? "attack" : "move")} ${g.owner ? "Wreck it" : "Claim it"}</button>` : ""}<button data-peek="open">${ico("look")} Details</button></div>
        ${!g.owner && !sel.length ? `<p class="tsHint">Select a vehicle, then tap the geyser to build a derrick.</p>` : ""}`;
    }
    if (!force && html === peekHtml) return;
    peekHtml = html;
    el.hidden = false;
    el.innerHTML = html;
    el.querySelector(".cvPeekX").onclick = () => {
      closePeek();
      o.sfx("uiClose");
    };
    el.querySelectorAll("[data-peek]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.getAttribute("aria-disabled") === "true") return toast("Not enough money.");
          const t = peekOn,
            what = b.dataset.peek;
          if (t.kind === "city") {
            const c = t.c;
            if (what === "open") {
              // Down to the city, then its management opens.
              if (cam.salt > ALT.region) focusOn(c.d, ALT.city * 1.4);
              openSheet("city", { city: c });
            } else if (what === "talk") openSheet("nation", { nation: nationOf(c.owner) });
            else if (what === "send") {
              orderTo([...T.selected], { type: "city", city: c });
              closePeek();
            }
          } else {
            const g = t.g;
            if (what === "open") openSheet("spice", { gz: g });
            else if (what === "upgrade") upgradeDerrick(g), renderPeek(true);
            else if (what === "claim") {
              orderTo([...T.selected].filter((v) => !v.dead && (!g.owner || v.role === "military")), { type: "geyser", geyser: g, d: g.d });
              closePeek();
            }
          }
        }),
    );
  }
  /* -- the planet united: the normal HUD steps aside for a celebration and a look back -- */
  let victory = false;
  function showVictory() {
    closeSheet();
    closePeek();
    stopTargeting();
    T.selected.clear();
    victory = true;
    cam.follow = null;
    cam.alt = ALT.max;
    hud.classList.add("victory");
    const card = CIV_CARDS[T.card] || civArchetype(T.captures, T.startType);
    const caps = T.captures;
    const taken = caps.military + caps.economic + caps.religious;
    const split = TYPE_IDS.map((t) => (caps[t] ? `<i class="${t}" style="flex:${caps[t]}"></i>` : "")).join("");
    const how = taken ? TYPE_IDS.slice().sort((a, b) => caps[b] - caps[a])[0] : T.startType;
    const word = { military: "taken by force", economic: "bought", religious: "converted" };
    const verdict = taken
      ? `Your strategy: ${caps[how]} of the ${taken} cities you won were ${word[how]}${TYPE_IDS.filter((t) => t !== how && caps[t]).map((t) => `, ${caps[t]} ${word[t]}`).join("")}.`
      : "You united the planet without taking a single city from anyone.";
    const you = o.record && o.portrait ? o.portrait(o.record) : "";
    // The memorable moments: the first few, and the last few.
    const m = T.moments;
    const picks = m.length > 7 ? [...m.slice(0, 3), null, ...m.slice(-3)] : m;
    const confetti = calm() ? "" : Array.from({ length: 36 }, (_, i) => `<i style="--x:${(i * 37) % 100};--d:${(i % 7) * 0.35}s;--h:${(i * 47) % 360}"></i>`).join("");
    const el = $h("#cvVictory");
    el.innerHTML = `<div class="cvConfetti" aria-hidden="true">${confetti}</div><div class="cvWave" aria-hidden="true" style="--oc:${hex(myColors.accent)}"></div>
      <div class="cvVictoryCard">
        <p class="cvVictoryKicker">Civilization Stage complete</p>
        <h2>One world, one nation</h2>
        <div class="cvVictoryLeader" style="--oc:${hex(myColors.accent)}">${you ? `<img src="${you}" alt="">` : ico("capital")}<span class="cvVictoryBadge">${card.icon}</span></div>
        <p class="cvVictoryName"><b>${esc(o.name || "Your nation")}</b> earns the <b>${esc(card.name)}</b> card</p>
        <p class="cvVictoryText">${esc(card.text)}</p>
        <div class="cvChips">${chip(ico("city"), T.cities.length, "cities", "res")}${chip(ico("sword"), caps.military, "by force", "mil")}${chip(ico("money"), caps.economic, "bought", "money")}${chip(ico("faith"), caps.religious, "converted", "faith")}</div>
        <div class="cvVictorySplit" role="img" aria-label="How you took the planet">${split || `<i class="${T.startType}" style="flex:1"></i>`}</div>
        <p class="cvVictoryHow">${esc(verdict)} <small>${clockText(T.time)} of play · ${vehiclesOf(YOU).length} vehicles · ${T.geysers.filter((g) => g.owner === YOU).length} derricks · §${Math.floor(T.money)} in the treasury</small></p>
        ${o.heritage?.summary ? `<p class="cvVictoryHow cvLineage">${esc(o.heritage.summary.replace(/\.$/, ""))}, and now unites its world.</p>` : ""}
        ${picks.length ? `<h5 class="tsKind cvKind">Your story</h5><ol class="cvMoments">${picks.map((x) => (x ? `<li><span>${esc(x.icon)}</span><small>${clockText(x.t)}</small>${esc(x.text)}</li>` : `<li class="gap">…</li>`)).join("")}</ol>` : ""}
        <p class="tsHint">The Space Stage comes next and isn't part of the game yet: keep playing here, or go back to the Tribal Stage.</p>
        <div class="tsBtns"><button class="good" id="cvKeep">${ico("play")} Keep playing</button><button id="cvStory">${ico("history")} Species history</button></div>
      </div>`;
    el.hidden = false;
    el.querySelector("#cvKeep").onclick = hideVictory;
    el.querySelector("#cvStory").onclick = () => {
      hideVictory();
      o.onHistory?.();
    };
    o.sfx("fanfare");
  }
  function hideVictory() {
    victory = false;
    hud.classList.remove("victory");
    $h("#cvVictory").hidden = true;
    $h("#cvVictory").innerHTML = "";
    cam.alt = ALT.city * 1.6;
    o.sfx("uiClose");
  }
  function sellSome(amount) {
    amount = Math.floor(Math.min(amount, T.spice));
    if (amount < 1) return;
    const sale = sellSpice(T.price, amount);
    T.spice -= amount;
    T.money += sale.money;
    T.price = sale.price;
    o.sfx("build");
    toast(`Sold ${amount} spice for §${sale.money}.`, 2);
    renderSheet();
  }
  function upgradeDerrick(g) {
    const lvl = g.level || 1;
    if (g.owner !== YOU || lvl >= 3) return;
    if (T.money < DERRICK_UPGRADE[lvl]) return toast("Not enough money.");
    T.money -= DERRICK_UPGRADE[lvl];
    g.level = lvl + 1;
    buildGeyser(g);
    o.sfx("build");
    popAt(g.d, 8, "⬆ level " + g.level, "good");
    renderSheet();
  }
  /** A refused tap: the button shakes its head. */
  function nope(b) {
    b.classList.remove("nope");
    void b.offsetWidth;
    b.classList.add("nope");
    o.sfx("uiNo");
  }
  function bindSheet(el) {
    const on = (id, fn) => {
      const b = el.querySelector(id);
      if (b) b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? nope(b) : fn());
    };
    el.querySelectorAll("[data-plot]").forEach(
      (b) =>
        (b.onclick = () => {
          const k = Number(b.dataset.plot),
            c = sheet.city;
          if (c.plots[k]) {
            c.plots[k] = null;
            buildCity(c, "new");
            o.sfx("click");
            sheet.plot = null;
          } else sheet.plot = sheet.plot === k ? null : k;
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-build]").forEach(
      (b) =>
        (b.onclick = () => {
          const role = b.dataset.build,
            c = sheet.city;
          if (sheet.plot == null) return;
          if (T.money < BUILD_COST[role]) {
            nope(b);
            return toast(`Not enough money: a ${ROLES.building[role].name.toLowerCase()} costs §${BUILD_COST[role]}, you have §${Math.floor(T.money)}.`);
          }
          T.money -= BUILD_COST[role];
          const k = sheet.plot;
          c.plots[k] = role;
          sheet.plot = null;
          // The new building pops into its plot (here and in the city), with a hammer and a sparkle.
          sheet.fresh = k;
          setTimeout(() => sheet?.city === c && sheet.fresh === k && ((sheet.fresh = null), renderSheet(false)), 900);
          buildCity(c, "new");
          o.sfx("build");
          setTimeout(() => o.sfx("uiDone"), 380);
          popAt(c.d, 8, "−§" + BUILD_COST[role], "bad");
          renderSheet();
        }),
    );
    if (sheet?.kind === "spice") {
      const g = sheet.gz;
      el.querySelector("#cvUpgrade")?.addEventListener("click", (e) => (e.currentTarget.getAttribute("aria-disabled") === "true" ? toast("Not enough money.") : upgradeDerrick(g)));
      el.querySelector("#cvLook")?.addEventListener("click", () => {
        focusOn(g.d, ALT.city);
        closeSheet();
      });
      el.querySelector("#cvClaim")?.addEventListener("click", () => {
        const sel = [...T.selected].filter((v) => !v.dead && (!g.owner || v.role === "military"));
        orderTo(sel, { type: "geyser", geyser: g, d: g.d });
        closeSheet();
      });
    }
    if (sheet?.kind === "economy") {
      el.querySelector("#cvSell25")?.addEventListener("click", () => sellSome(25));
      el.querySelector("#cvSellHalf")?.addEventListener("click", () => sellSome(T.spice / 2));
      el.querySelector("#cvSellAll")?.addEventListener("click", () => sellSome(T.spice));
      el.querySelectorAll("[data-geyser]").forEach((b) => (b.onclick = () => openSheet("spice", { gz: T.geysers[Number(b.dataset.geyser)] })));
    }
    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelBuild(sheet.city, Number(b.dataset.cancel))));
    el.querySelectorAll("[data-vehicle]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? (nope(b), vehicleRefusal(sheet.city, b.dataset.vehicle)) : buyVehicle(sheet.city, b.dataset.vehicle))));
    el.querySelectorAll("[data-design]").forEach((b) => (b.onclick = () => editDesign(...b.dataset.design.split("|"))));
    el.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? toast(`You can keep ${DESIGNS_PER_ROLE} designs of your own per kind: delete one first.`) : newDesign(b.dataset.new))));
    el.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? toast(`You can keep ${DESIGNS_PER_ROLE} designs of your own per kind: delete one first.`) : copyDesign(b.dataset.copy))));
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => deleteDesign(b.dataset.del)));
    on("#cvTurret", () => {
      const c = sheet.city;
      T.money -= BUILD_COST.turret;
      c.turrets++;
      c.turretHp = 1;
      buildCity(c, "new");
      o.sfx("build");
      renderSheet();
    });
    on("#cvFocus", () => {
      focusOn(sheet.city.d, ALT.city);
    });
    on("#cvSend", () => {
      orderTo([...T.selected], { type: "city", city: sheet.city });
      closeSheet();
    });
    on("#cvBuy", () => buyCity(sheet.city));
    if (sheet?.kind === "nation") {
      const n = sheet.nation;
      el.querySelectorAll("[data-talk]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" && nope(b), talk(n, b.dataset.talk))));
      el.querySelectorAll("[data-answer]").forEach((b) => (b.onclick = () => reply(n, b.dataset.answer)));
      on("#cvLogTab", () => {
        sheet.tab = "log";
        renderSheet();
      });
      on("#cvWorldTab", () => openSheet("world"));
      on("#cvTalkTab", () => {
        sheet.tab = null;
        renderSheet();
      });
    }
    el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openSheet("nation", { nation: nationOf(b.dataset.open) })));
    on("#cvContact", () => openSheet("nation", { nation: nationOf(sheet.city.owner) }));
    on("#cvKeep", closeSheet);
    on("#cvRestart", () => o.onRestart());
  }
  /** Vehicles you have plus those being built (each counts against what your cities can support). */
  const queued = () => yourCities().reduce((s, c) => s + c.queue.length, 0);
  function vehicleRefusal(c, key) {
    const mode = key.split(":")[1];
    const u = vehicleUnit(vehicleDesign(YOU, key), mods);
    if (mode === "sea" && !c.coastal) return toast("This city is inland: only coastal cities build boats.");
    if (mode === "air" && yourCities().length < AIR_AT) return toast(`Aircraft need ${AIR_AT} cities.`);
    if (!u.ok) return toast("That design can't be used: open 🎨 Designs and fix it.");
    if (vehiclesOf(YOU).length + queued() >= vehicleCap(YOU)) return toast(`Each city supports ${VEHICLES_PER_CITY} vehicles (counting those being built). Take more cities for more.`);
    if (c.queue.length >= QUEUE_MAX) return toast(`A city builds one vehicle at a time, with ${QUEUE_MAX - 1} more waiting.`);
    if (T.spice < spiceCost(u)) return toast(`Not enough spice: this needs 🌶 ${spiceCost(u)}. Claim spice geysers with any vehicle.`, 4);
    toast("Not enough money.");
  }
  /** Order a vehicle: paid now, built over time at the city (faster with factories). */
  function buyVehicle(c, key) {
    if (!T.designs.vehicle[key] || !key.startsWith(c.type + ":") || c.queue.length >= QUEUE_MAX) return;
    const u = vehicleUnit(T.designs.vehicle[key], mods);
    const sp = spiceCost(u);
    T.money -= u.cost;
    T.spice -= sp;
    c.queue.push({ key, done: 0, money: u.cost, spice: sp });
    o.sfx("build");
    tipOnce("queue", `Being built at ${c.name}: ${buildTime(u, c, strengths)}s. Factories build faster.`, 4);
    renderSheet();
  }
  function cancelBuild(c, i) {
    const q = c.queue[i];
    if (!q) return;
    c.queue.splice(i, 1);
    T.money += q.money;
    T.spice += q.spice;
    o.sfx("click");
    renderSheet();
  }
  /** Your cities' factories at work: the first vehicle in each queue is built, then the next. */
  function updateProduction(dt) {
    for (const c of yourCities()) {
      const q = c.queue[0];
      if (!q) continue;
      const u = vehicleUnit(vehicleDesign(YOU, q.key), mods);
      q.done = Math.min(1, q.done + dt / Math.max(1, buildTime(u, c, strengths)));
      if (q.done < 1) continue;
      c.queue.shift();
      // A design deleted while it was being built comes out as the standard one (vehicleDesign falls back).
      const v = spawnVehicle(YOU, q.key, c);
      popAt(c.d, 9, (clsOf(v.unit)?.icon || "🚙") + " ready", "good");
      o.sfx("uiDone");
      const vd = vehicleDesign(YOU, q.key);
      const url = thumbs.get(vd);
      notify({ icon: url ? `<img src="${url}" alt="">` : ico("vehicle"), title: `${c.name} finished a vehicle`, text: `${vd.name} is ready${T.selected.has(v) ? " and selected" : ""}.`, level: "good", seconds: 4, key: "built:" + c.id, act: () => (T.selected.clear(), T.selected.add(v), focusOn(v.d, ALT.city), updateHUD()), actLabel: "Select" });
      if (!T.selected.size) T.selected.add(v);
      tipOnce("firstVehicle", "Your new vehicle is ready and selected: tap a city to send it there, or the ground to move it.", 5);
    }
  }
  function editDesign(kind, key) {
    const current = kind === "building" ? T.designs.building[key] : T.designs.vehicle[key];
    if (!current) return;
    const role = kind === "building" ? key : key.split(":")[0];
    openEditorFor(kind, current, role, (design) => {
      if (kind === "building") {
        T.designs.building[role] = design;
        strengths = myStrengths();
        yourCities().forEach((c) => buildCity(c));
        return;
      }
      const mode = key.split(":")[1];
      const actual = vehicleMode(design) || mode;
      if (actual === mode) {
        T.designs.vehicle[key] = design;
        // Vehicles already built keep their health share and take the new design.
        for (const v of vehiclesOf(YOU).filter((x) => x.key === key)) refitVehicle(v);
        return;
      }
      // It moves another way now: keep it as a new design of that kind, and leave this one as it was.
      const fresh = freeKey(role, actual);
      if (!fresh || customKeys(role).length >= DESIGNS_PER_ROLE) return toast(`This design ${actual === "air" ? "flies" : actual === "sea" ? "sails" : "drives"}, but you already keep ${DESIGNS_PER_ROLE} designs of your own: it wasn't saved. Delete one, then try again.`, 5);
      T.designs.vehicle[fresh] = design;
      toast(`This design ${actual === "air" ? "flies" : actual === "sea" ? "sails" : "drives"}, so it's saved as a new ${MODE_NAME[actual].toLowerCase()} design.`, 4.5);
    });
  }
  /** A new vehicle design of your own for a role, starting from its standard land design. */
  function newDesign(role) {
    if (customKeys(role).length >= DESIGNS_PER_ROLE) return;
    const start = { ...JSON.parse(JSON.stringify(T.designs.vehicle[role + ":land"])), name: "New " + CITY_TYPES[role].name.toLowerCase() + " vehicle", category: "land" };
    openEditorFor("vehicle", start, role, (design) => {
      const mode = vehicleMode(design) || "land";
      const key = freeKey(role, mode);
      if (key) T.designs.vehicle[key] = design;
      toast(`${design.name} saved: build it at any ${CITY_TYPES[role].name.toLowerCase()} city${mode === "sea" ? " on the coast" : mode === "air" ? ` once you have ${AIR_AT} cities` : ""}.`, 4.5);
    });
  }
  function copyDesign(key) {
    const [role, mode] = key.split(":");
    const fresh = customKeys(role).length < DESIGNS_PER_ROLE && freeKey(role, mode);
    if (!fresh) return;
    const d = JSON.parse(JSON.stringify(T.designs.vehicle[key]));
    d.name = (d.name + " II").slice(0, 32);
    T.designs.vehicle[fresh] = d;
    o.sfx("click");
    saveState();
    renderSheet();
  }
  function deleteDesign(key) {
    const parts = key.split(":");
    if (parts.length !== 3 || !T.designs.vehicle[key]) return;
    // Vehicles of this design stay in service: they keep their looks until they're rebuilt as the standard design.
    const base = parts[0] + ":" + parts[1];
    for (const v of vehiclesOf(YOU).filter((x) => x.key === key)) {
      v.key = base;
      refitVehicle(v);
    }
    const name = T.designs.vehicle[key].name;
    delete T.designs.vehicle[key];
    toast(`${name} deleted. Vehicles built from it were refitted to your standard ${MODE_NAME[parts[1]].toLowerCase()} design.`, 4);
    saveState();
    renderSheet();
  }
  function openEditorFor(kind, current, role, store) {
    closeSheet();
    paused = true;
    hud.hidden = true;
    o.openEditor(kind, current, {
      roles: [role],
      templates: kind === "vehicle" ? vehicleTemplates(role, myColors) : undefined,
      onDone: (design) => {
        paused = false;
        hud.hidden = false;
        store(design);
        o.onCreation?.(kind, design);
        saveState();
        openSheet("designs");
      },
      onCancel: () => {
        paused = false;
        hud.hidden = false;
        openSheet("designs");
      },
    });
  }
  function refitVehicle(v) {
    const frac = v.hp / v.unit.hp;
    v.model.dispose();
    const design = vehicleDesign(v.owner, v.key);
    v.unit = vehicleUnit(design, unitMods(v.owner));
    v.hp = v.unit.hp * frac;
    v.model = buildDesignMesh(design, { materials: matsFor(design.colors) });
    v.model.root.scale.setScalar(SCALE.vehicle);
    v.group.add(v.model.root);
  }

  /* ---- taking cities -------------------------------------------------------------------------------- */
  /** The city whose land a place is on (the nearest, within its territory), or null. */
  function nearestCity(d) {
    let best = null,
      bd = TERRITORY;
    for (const c of T.cities) {
      const a = arc(d, c.d);
      if (a < bd) (best = c), (bd = a);
    }
    return best;
  }
  function takeCity(c, owner, method) {
    const from = c.owner;
    transferCity(c, owner, method);
    // A city keeps its kind unless taken by force; force makes it a military city of the taker.
    if (method === "military") c.type = "military";
    else if (method === "religious") c.type = "religious";
    else if (method === "economic") c.type = "economic";
    buildCity(c, true);
    paintTerritory();
    // Derricks on the city's land go with it.
    for (const g of T.geysers)
      if (g.owner === from && from !== owner && nearestCity(g.d) === c) {
        g.owner = owner;
        buildGeyser(g);
        if (owner === YOU) popAt(g.d, 7, "+ derrick", "good");
      }
    T.vehicles.filter((v) => v.order?.city === c).forEach((v) => (v.order = null));
    if (owner === YOU) {
      T.captures[method] = (T.captures[method] || 0) + 1;
      o.sfx("unlock");
      notify({ icon: CITY_TYPES[method].icon, title: `${c.name} is yours!`, text: method === "military" ? "Taken by force." : method === "economic" ? "Bought outright." : "Converted to your faith.", level: "good", act: () => openSheet("city", { city: c }), actLabel: "Open" });
      chronicle({ key: "civ:take:" + c.id + ":" + method, stage: "civ", icon: CITY_TYPES[method].icon, text: `${method === "military" ? "Captured" : method === "economic" ? "Bought" : "Converted"} the city of ${c.name}.` });
      const n = nationOf(from);
      if (n && citiesOf(n.id).length === 0) {
        n.alive = false;
        vehiclesOf(n.id).forEach(removeVehicle);
        toast(`The ${n.name} nation is no more.`, 4);
        chronicle({ key: "civ:fall:" + n.id, stage: "civ", icon: "🏳", text: "Absorbed the last city of the " + n.name + " nation." });
      }
      checkWin();
    } else if (from !== YOU) {
      const loser = nationOf(from),
        winner = nationOf(owner);
      const how = method === "economic" ? "bought" : method === "religious" ? "converted" : "taken";
      if (winner && loser) news(`The ${winner.name} have ${how} ${c.name} from the ${loser.name}.`, 4, winner);
      else if (winner && !from) news(`The ${winner.name} have ${how} the free city of ${c.name}.`, 3, winner);
      // Expansion alarms the neighbours: everyone else with cities on that continent likes the winner less.
      if (winner)
        for (const m of T.nations)
          if (m.alive && m !== winner && citiesOf(m.id).some((x) => x.landmass === c.landmass)) {
            const p = pairOf(m, winner);
            p.rel = clampRel(p.rel - (m === loser ? 25 : 10));
          }
      if (loser && citiesOf(loser.id).length === 0) {
        loser.alive = false;
        vehiclesOf(loser.id).forEach(removeVehicle);
        news(`The ${loser.name} nation is no more: its last city fell to the ${winner?.name || "independents"}.`, 5);
      }
    } else if (from === YOU) {
      c.queue = [];
      o.sfx("hurt");
      notify({ nation: nationOf(owner), icon: "🏳", title: `${c.name} has fallen`, text: `The city now belongs to the ${ownerName(owner)}.`, level: "danger", act: () => focusOn(c.d, ALT.city * 1.4), actLabel: "Look" });
      vehiclesOf(YOU).filter((v) => v.home === c.id).forEach((v) => (v.home = capital().id));
      if (!yourCities().length) {
        T.lost = true;
        openSheet("lost");
      }
      // You may no longer field as many vehicles: the newest ones are lost.
      const extra = vehiclesOf(YOU).length - vehicleCap(YOU);
      if (extra > 0) vehiclesOf(YOU).slice(-extra).forEach(removeVehicle);
    }
    if (sheet?.city === c) renderSheet();
    saveState();
  }
  function buyCity(c) {
    const econ = cityEconomy(c, {});
    const nat = nationOf(c.owner);
    const cost = buyoutCost(econ, nat ? nat.relation : 0);
    if ((c.trade[YOU] || 0) < 100 || T.money < cost) return toast("Not yet: you need full trade and §" + cost + ".");
    T.money -= cost;
    if (nat) nat.relation = clampRel(nat.relation - 15);
    takeCity(c, YOU, "economic");
  }
  function checkWin() {
    if (T.won || !civWon(T.cities)) return;
    T.won = true;
    const card = civArchetype(T.captures, T.startType);
    T.card = card.id;
    const c = T.captures;
    chronicle({ key: "civ:won", stage: "civ", icon: card.icon, major: true, text: `United the world as a ${card.name.toLowerCase()} nation (${c.military || 0} cities taken by force, ${c.economic || 0} bought, ${c.religious || 0} converted).` });
    o.onWon?.(card);
    saveState();
    setTimeout(() => openSheet("won"), 1800);
  }

  /* ---- superweapon ---------------------------------------------------------------------------------- */
  function superState() {
    const kind = dominantMethod(T.captures, T.startType);
    const unlocked = superUnlocked(yourCities().length, T.cities.length);
    return { kind, unlocked, ready: unlocked && T.superCool <= 0 && T.money >= SUPER_COST, def: SUPERWEAPONS[kind] };
  }
  function startTargeting() {
    const s = superState();
    if (!s.unlocked) return toast(`Hold ${Math.ceil(T.cities.length / 2)} of the ${T.cities.length} cities to unlock your superweapon.`);
    if (T.superCool > 0) return toast(`${s.def.name} is recharging: ${Math.ceil(T.superCool)} s.`);
    if (T.money < SUPER_COST) return toast(`${s.def.name} costs §${SUPER_COST}.`);
    T.targeting = true;
    $h("#cvTarget").hidden = false;
    $h("#cvTargetText").textContent = `${s.def.icon} ${s.def.name}: tap a city that isn't yours.`;
  }
  function stopTargeting() {
    T.targeting = false;
    $h("#cvTarget").hidden = true;
  }
  $h("#cvTargetCancel").onclick = stopTargeting;
  function fireSuper(c) {
    const s = superState();
    stopTargeting();
    if (c.owner === YOU) return toast("That city is already yours.");
    T.money -= SUPER_COST;
    T.superCool = SUPER_COOLDOWN;
    const n = nationOf(c.owner);
    if (n) n.relation = clampRel(n.relation - (s.kind === "military" ? 50 : 20));
    if (n && s.kind === "military") n.war = true;
    chronicle({ key: "civ:super:" + c.id, stage: "civ", icon: s.def.icon, text: `Used the ${s.def.name} on ${c.name}.` });
    popAt(c.d, 12, s.def.icon + " " + s.def.name, "good");
    takeCity(c, YOU, s.kind);
  }

  /* ---- HUD refresh -------------------------------------------------------------------------------------- */
  const fx = () => activeEffects(T.events.active, T.time);
  const income = () => (yourCities().reduce((s, c) => s + cityEconomy(c, ownerMods(YOU)).income, 0) + tradeIncome(T.cities, YOU) + pactBonus()) * fx().income;
  /** Trade agreements: your routes with that nation pay half as much again. */
  function pactBonus() {
    let routes = 0;
    for (const c of T.cities) {
      const n = nationOf(c.owner);
      if (n?.pact && (c.trade?.[YOU] || 0) > 0) routes++;
      if (c.owner === YOU) for (const [k, val] of Object.entries(c.trade || {})) if (val > 0 && nationOf(k)?.pact) routes++;
    }
    return routes * ROUTE_INCOME * 0.5;
  }
  const spiceIncome = (owner = YOU) => T.geysers.filter((g) => g.owner === owner).reduce((s, g) => s + spiceYield(g), 0) * (owner === YOU ? (1 + (mods.spice || 0)) * fx().spice : 1);
  let hudClock = 0,
    liveClock = 1;
  const marks = new Map();
  const hpBars = new Map();
  function updateBars(layer) {
    const near = cam.salt < 160 && !arrive;
    for (const [v, el] of hpBars)
      if (v.dead || !near) {
        el.remove();
        hpBars.delete(v);
      }
    if (!near) return;
    for (const v of T.vehicles) {
      // Bars over your selected vehicles, and over anything damaged that's close enough to see.
      const show = !v.dead && (T.selected.has(v) || v.hp < v.unit.hp - 0.5);
      let el = hpBars.get(v);
      if (!show) {
        if (el) el.hidden = true;
        continue;
      }
      const p = project(vehiclePos(v, v.mode === "air" ? 3 : 3.2));
      if (!el) {
        el = document.createElement("i");
        el.className = "cvHpBar " + (v.owner === YOU ? "mine" : "foe");
        el.appendChild(document.createElement("b"));
        layer.appendChild(el);
        hpBars.set(v, el);
      }
      el.hidden = !p.on;
      if (!p.on) continue;
      el.style.transform = `translate(${p.x - 14}px,${p.y}px)`;
      el.firstChild.style.width = Math.round(Math.max(0, v.hp / v.unit.hp) * 100) + "%";
    }
  }
  function updateMarks() {
    const layer = $h("#cvMarks");
    updateBars(layer);
    for (const c of T.cities) {
      let m = marks.get(c);
      if (!m) {
        m = document.createElement("div");
        m.className = "trMark cvMark";
        layer.appendChild(m);
        marks.set(c, m);
      }
      const p = projectDir(c.d, 10);
      m.hidden = !p.on || !!arrive;
      m.classList.toggle("far", cam.salt > ALT.region);
      if (m.hidden) continue;
      m.style.left = p.x + "px";
      m.style.top = p.y + "px";
      m.style.setProperty("--rel", hex(ownerColor(c.owner)));
      const progress = c.owner === YOU ? Math.max(0, ...Object.entries(c.conv).filter(([k]) => k !== YOU).map(([, v]) => v)) / 100 : Math.max(c.trade[YOU] || 0, c.conv[YOU] || 0) / 100;
      const damaged = c.hallHp < 1 || (c.turrets && c.turretHp < 1);
      const html = `${CITY_TYPES[c.type].icon} ${esc(c.name)}${damaged ? `<i><b style="width:${Math.round(c.hallHp * 100)}%;background:#ef4b48"></b></i>` : progress > 0 ? `<i><b style="width:${Math.round(progress * 100)}%;background:${c.owner === YOU ? "#c9b5ff" : "#ffd24a"}"></b></i>` : ""}`;
      if (m._html !== html) m.innerHTML = m._html = html;
    }
  }
  /** Resource counters: a little bump and a floating "+12" when a total jumps (not for the steady trickle). */
  const shown = { money: null, spice: null };
  function bumpRes(key, value, trickle) {
    const prev = shown[key];
    shown[key] = value;
    if (prev == null) return;
    const delta = value - prev;
    if (Math.abs(delta) < Math.max(4, Math.abs(trickle) * 2.5)) return;
    const pill = $h(key === "money" ? "#cvEcon" : "#cvSpiceBtn");
    const d = $h(key === "money" ? "#cvMoneyDelta" : "#cvSpiceDelta");
    d.textContent = (delta > 0 ? "+" : "−") + Math.round(Math.abs(delta));
    d.className = "cvDelta " + (delta > 0 ? "up" : "down");
    pill.classList.remove("bump", "dip");
    void pill.offsetWidth;
    pill.classList.add(delta > 0 ? "bump" : "dip");
  }
  let nationsHtml = "",
    unitsHtml = "";
  function updateHUD() {
    const money = Math.floor(T.money),
      spice = Math.floor(T.spice);
    $h("#cvMoney").textContent = money;
    $h("#cvIncome").textContent = "+" + income().toFixed(1) + "/s";
    $h("#cvSpice").textContent = spice;
    bumpRes("money", money, income() * 0.25);
    bumpRes("spice", spice, spiceIncome() * 0.25);
    $h("#cvCities").textContent = yourCities().length + "/" + T.cities.length;
    $h("#cvVeh").textContent = vehiclesOf(YOU).length + "/" + vehicleCap(YOU);
    const left = T.cities.length - yourCities().length;
    $h("#cvGoal").innerHTML = T.won ? `${CIV_CARDS[T.card]?.icon || "✦"} The world is united` : left ? `<span class="cvGoalBar"><i style="width:${Math.round((yourCities().length / T.cities.length) * 100)}%"></i></span>Unite the planet: ${left} ${left === 1 ? "city" : "cities"} to go` : "";
    // The rival leaders, as faces: their mood, your relations (the ring), and a message waiting.
    const nh = T.nations
      .map((n) => {
        const col = n.war ? "#e0493c" : n.relation >= DIPLO.allyAt ? "#4fbf3a" : n.relation >= 20 ? "#8fd18f" : n.relation > -20 ? "#c9b79a" : "#f0a04b";
        const msg = inboxOf(n);
        const pic = n.alive ? portraitOf(n) : "";
        return `<button class="trTribe cvNation${msg ? " msg" : ""}${n.war ? " war" : ""}${n.alive ? "" : " fallen"}" role="listitem" data-nation="${n.id}" style="--rel:${col};--nc:${hex(n.color)}" aria-label="${esc(n.name)} nation (${esc(n.leader.title)} ${esc(n.leader.name)}), ${relationWord(n.relation, n.war)}${n.allied ? ", allied" : ""}${msg ? ", has a message for you" : ""}${n.alive ? "" : ", fallen"}" ${n.alive ? "" : 'aria-disabled="true"'}>${pic ? `<img src="${pic}" alt="">` : `<span>${n.alive ? CITY_TYPES[n.type].icon : "🏳"}</span>`}${n.alive ? `<em>${msg ? "📨" : n.war ? "⚔" : n.allied ? "🛡" : moodFace(n)}</em>` : ""}</button>`;
      })
      .join("");
    if (nh !== nationsHtml) {
      $h("#cvNations").innerHTML = nationsHtml = nh;
      $h("#cvNations")
        .querySelectorAll("[data-nation]")
        .forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? null : openSheet("nation", { nation: nationOf(b.dataset.nation) }))));
    }
    const mineV = vehiclesOf(YOU);
    const uh = mineV
      .map((v) => {
        const d = vehicleDesign(YOU, v.key);
        const url = thumbs.get(d);
        const k = clsOf(v.unit);
        return `<button class="trUnit cvUnit ${v.role} ${T.selected.has(v) ? "sel" : ""} ${v.hp / v.unit.hp < 0.35 ? "low" : ""}" role="listitem" data-veh="${v.id}" aria-label="${esc(k?.name || CITY_TYPES[v.role].name + " " + MODE_NAME[v.mode].toLowerCase() + " vehicle")}${T.selected.has(v) ? ", selected" : ""}" aria-pressed="${T.selected.has(v)}">${url ? `<img src="${url}" alt="">` : `<span class="noPic">${k?.icon || MODE_ICON[v.mode]}</span>`}<em>${CITY_TYPES[v.role].icon}</em><i><b style="width:${Math.round((v.hp / v.unit.hp) * 100)}%"></b></i></button>`;
      })
      .join("");
    if (uh !== unitsHtml) {
      $h("#cvUnits").innerHTML = unitsHtml = uh;
      $h("#cvUnits")
        .querySelectorAll("[data-veh]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              const v = T.vehicles.find((x) => x.id === Number(b.dataset.veh));
              if (!v) return;
              if (T.selected.has(v)) T.selected.delete(v);
              else T.selected.add(v);
              o.sfx("uiSelect");
              focusOn(v.d);
              updateHUD();
            }),
        );
    }
    updateSelection();
    const st = superState();
    const sb = $h("#cvSuper");
    const sh = `${ico("super")}<small>${st.unlocked ? (T.superCool > 0 ? Math.ceil(T.superCool) + "s" : "§" + SUPER_COST) : "Locked"}</small>`;
    if (sb._html !== sh) sb.innerHTML = sb._html = sh;
    sb.classList.toggle("ready", st.ready);
    sb.setAttribute("aria-label", `${st.def.name}: ${st.def.desc}${st.unlocked ? "" : " Locked until you hold half the cities."}`);
    sb.setAttribute("aria-disabled", String(!st.ready));
  }
  /* ---- the selection: what's selected, and orders for it ----------------------------------------- */
  $h("#cvBox").onclick = () => setBoxMode(!boxMode);
  hud.querySelectorAll("[data-cmd]").forEach(
    (b) =>
      (b.onclick = () => {
        const sel = [...T.selected].filter((v) => !v.dead);
        const cmd = b.dataset.cmd;
        if (cmd === "formation") {
          const ids = Object.keys(FORMATIONS);
          formation = ids[(ids.indexOf(formation) + 1) % ids.length];
          toast(`${FORMATIONS[formation].name} formation: ${FORMATIONS[formation].hint}.`, 3);
        } else if (cmd === "clear") {
          T.selected.clear();
          pendingCmd = null;
        } else if (!sel.length) return;
        else if (cmd === "guard") {
          // Guard where they are now, around the group's middle.
          let x = 0,
            y = 0,
            z = 0;
          sel.forEach((v) => ((x += v.d.x), (y += v.d.y), (z += v.d.z)));
          orderTo(sel, { type: "guard", d: norm3({ x, y, z }) });
          toast("Guarding: they'll hold here and fight anything hostile that comes near.", 3);
        } else if (cmd === "patrol") {
          pendingCmd = pendingCmd === "patrol" ? null : "patrol";
          if (pendingCmd) toast("Tap the far end of the patrol route.", 3);
        } else if (cmd === "follow") {
          cam.follow = cam.follow && T.selected.has(cam.follow) ? null : sel[0];
          if (cam.follow) cam.alt = Math.min(cam.alt, ALT.city);
        } else if (cmd === "stop") {
          sel.forEach((v) => ((v.order = null), (v.route = null)));
          toast("Stopped.", 1.5);
        }
        o.sfx("uiCommand");
        updateHUD();
      }),
  );
  /** The panel above your vehicles: what's selected (one in detail, a group by class) and its orders. */
  function updateSelection() {
    const sel = [...T.selected].filter((v) => !v.dead);
    const panel = $h("#cvOrders");
    // (Out of the way while a sheet is open: the sheet has the screen.)
    panel.hidden = !sel.length || !!sheet;
    $h("#cvFormIcon").textContent = FORMATIONS[formation].icon;
    $h("#cvFormName").textContent = FORMATIONS[formation].name;
    hud.querySelector('[data-cmd="patrol"]').classList.toggle("on", pendingCmd === "patrol");
    hud.querySelector('[data-cmd="follow"]').classList.toggle("on", !!cam.follow && T.selected.has(cam.follow));
    if (!sel.length) return;
    const doing = (v) => {
      const o2 = v.order;
      if (!o2) return "idle";
      if (o2.type === "city") return (v.role === "military" ? "attacking " : v.role === "religious" ? "preaching to " : "trading with ") + o2.city.name;
      return { move: "moving", guard: "guarding", patrol: "patrolling", geyser: "claiming spice", vehicle: "attacking a vehicle" }[o2.type] || "busy";
    };
    let html;
    if (sel.length === 1) {
      const v = sel[0],
        u = v.unit,
        k = clsOf(u);
      const hp = Math.max(0, v.hp / u.hp);
      const what = v.role === "military" ? `attack ${u.dps}/s · range ${RANGE[v.mode] + u.range}` : v.role === "economic" ? `trade ${u.trade}` : `preaching ${u.preach}`;
      const d = vehicleDesign(v.owner, v.key);
      html = `<div class="cvSelHead ${v.role}">${thumbOf(d, k?.icon || MODE_ICON[v.mode], "sel")}<b>${esc(d.name)}<small>${CITY_TYPES[v.role].icon} ${esc(k?.name || CITY_TYPES[v.role].name)} · ${doing(v)}</small></b></div>
        <div class="cvHp ${hp < 0.35 ? "low" : ""}">${ico("health")}<i><b style="width:${Math.round(hp * 100)}%"></b></i><small>${Math.ceil(v.hp)}/${u.hp}</small></div>
        <p>${ico("speed")} ${u.speed} · ${what}${k ? `<br><span class="good">+ ${esc(k.good)}</span> <span class="weak">− ${esc(k.weak)}</span>` : ""}</p>`;
    } else {
      const byCls = {};
      sel.forEach((v) => (byCls[v.unit.cls] = (byCls[v.unit.cls] || 0) + 1));
      const hp = sel.reduce((a, v) => a + Math.max(0, v.hp / v.unit.hp), 0) / sel.length;
      // The group drawn as its formation: a few of the selected vehicles' faces, in line, wedge or ring.
      const faces = sel.slice(0, 5).map((v) => thumbOf(vehicleDesign(v.owner, v.key), clsOf(v.unit)?.icon || MODE_ICON[v.mode], "mini")).join("");
      html = `<div class="cvSelHead group"><span class="cvGroup f-${formation}" aria-hidden="true">${faces}${sel.length > 5 ? `<em>+${sel.length - 5}</em>` : ""}</span><b>${sel.length} vehicles selected<small>${Object.entries(byCls)
        .map(([c, n]) => `${n} ${VEHICLE_CLASSES[c]?.icon || ""}`)
        .join(" · ")} · ${FORMATIONS[formation].name.toLowerCase()} · ${doing(sel[0])}</small></b></div>
        <div class="cvHp ${hp < 0.35 ? "low" : ""}">${ico("health")}<i><b style="width:${Math.round(hp * 100)}%"></b></i><small>${Math.round(hp * 100)}%</small></div>`;
    }
    const el = $h("#cvSelInfo");
    if (el._html !== html) el.innerHTML = el._html = html;
  }
  $h("#cvEcon").onclick = () => openSheet("economy");
  $h("#cvSpiceBtn").onclick = () => openSheet("economy");
  $h("#cvCitiesBtn").onclick = () => openSheet("world");
  // Pictures of designs arrive a frame or two after a sheet asks for them: show them as they come.
  thumbs.onReady(() => {
    if (sheet && !sheetPress) renderSheet(false);
    if (peekOn) renderPeek(false);
  });
  $h("#cvAll").onclick = () => {
    if (T.selected.size && T.selected.size === vehiclesOf(YOU).length) T.selected.clear();
    else selectAll();
    updateHUD();
  };
  $h("#cvHome").onclick = () => {
    focusOn(capital().d, ALT.city);
  };
  $h("#cvCity").onclick = () => {
    const mine = yourCities();
    if (!mine.length) return;
    const c = mine.sort((a, b) => arc(a.d, cam.f) - arc(b.d, cam.f))[0];
    openSheet("city", { city: c });
  };
  $h("#cvGlobe").onclick = () => {
    cam.follow = null;
    cam.alt = cam.alt > ALT.region ? ALT.city : ALT.max;
  };
  const openDesigns = () => openSheet("designs");
  $h("#cvDesigns").onclick = openDesigns;
  $h("#cvDesignsMenu").onclick = openDesigns;
  $h("#cvSuper").onclick = startTargeting;
  // The minimap folds away to a small globe button (remembered for this browser).
  const MINI_KEY = "johnny-spore-civ-minimap-folded";
  const setMiniFolded = (on) => {
    $h("#cvMiniWrap").classList.toggle("folded", on);
    $h("#cvMiniFold").setAttribute("aria-pressed", String(on));
    $h("#cvMiniFold").setAttribute("aria-label", on ? "Show the minimap" : "Hide the minimap");
  };
  try {
    setMiniFolded(localStorage.getItem(MINI_KEY) === "1");
  } catch {
    /* no storage: shown */
  }
  $h("#cvMiniFold").onclick = () => {
    const on = !$h("#cvMiniWrap").classList.contains("folded");
    setMiniFolded(on);
    try {
      localStorage.setItem(MINI_KEY, on ? "1" : "0");
    } catch {
      /* not remembered */
    }
    if (!on) updateMinimap();
    o.sfx("select");
  };
  $h("#cvMenu").onclick = () => ($h("#cvMenuPanel").hidden = !$h("#cvMenuPanel").hidden);
  $h("#cvResume").onclick = () => ($h("#cvMenuPanel").hidden = true);
  $h("#cvMessages").onclick = () => openSheet("messages");
  $h("#cvWorld").onclick = () => openSheet("world");
  $h("#cvHistory").onclick = () => {
    $h("#cvMenuPanel").hidden = true;
    o.onHistory?.();
  };
  $h("#cvSettings").onclick = () => {
    $h("#cvMenuPanel").hidden = true;
    o.onSettings?.();
  };
  $h("#cvHelp").onclick = () => openSheet("help");

  /* ---- saving --------------------------------------------------------------------------------------------- */
  const r3 = (n) => Math.round(n * 1e4) / 1e4;
  function saveState() {
    const data = {
      v: 2,
      seed,
      clock: Math.round(globe.time),
      money: Math.round(T.money),
      spice: Math.round(T.spice * 10) / 10,
      price: Math.round(T.price * 100) / 100,
      startType: T.startType,
      nations: T.nations.map((n) => ({ id: n.id, type: n.type, relation: n.relation, war: n.war, money: Math.round(n.money), spice: Math.round(n.spice), alive: n.alive, personality: n.personality, met: n.met, allied: n.allied, pact: n.pact, cowedUntil: Math.round(n.cowedUntil), preachUntil: Math.round(n.preachUntil), log: n.log.slice(-12) })),
      cities: T.cities.map((c) => ({ id: c.id, owner: c.owner, type: c.type, plots: c.plots, turrets: c.turrets, turretHp: c.turretHp, hallHp: c.hallHp, trade: c.trade, conv: c.conv, unrest: c.unrest, queue: c.queue.map((q) => ({ key: q.key, done: Math.round(q.done * 1000) / 1000, money: q.money, spice: q.spice })) })),
      geysers: T.geysers.map((g) => ({ owner: g.owner, hp: g.hp, level: g.level })),
      pairs: T.pairs,
      news: T.newsLog.slice(-20),
      moments: T.moments.slice(-30),
      events: { next: Math.round(T.events.next), last: T.events.last, count: T.events.count, active: T.events.active.filter((e) => e.until > T.time) },
      vehicles: T.vehicles.filter((v) => !v.dead).map((v) => ({ owner: v.owner, design: v.key, d: { x: r3(v.d.x), y: r3(v.d.y), z: r3(v.d.z) }, hp: Math.round((v.hp / v.unit.hp) * 100) / 100, city: v.home })),
      designs: T.designs,
      captures: T.captures,
      superCool: Math.round(T.superCool),
      won: T.won,
      card: T.card,
      time: Math.round(T.time),
    };
    try {
      localStorage.setItem(CIV_SAVE_KEY, JSON.stringify(data));
      o.onSaved?.();
    } catch {
      toast("Couldn't save: storage is full or blocked.");
    }
  }

  /* ---- start ------------------------------------------------------------------------------------------------ */
  // The day starts at noon over your capital (a saved game keeps its own time of day).
  globe.time = save?.clock ?? (((Math.atan2(HOME.z, HOME.x) + TAU) % TAU) / TAU) * DAY_SECONDS;
  T.cities.forEach((c) => buildCity(c));
  paintTerritory();
  T.geysers.forEach(buildGeyser);
  for (const sv of save?.vehicles || []) {
    const [role, mode] = sv.design.split(":");
    if (!TYPE_IDS.includes(role) || !["land", "sea", "air"].includes(mode)) continue;
    if (sv.owner !== YOU && !nationOf(sv.owner)?.alive) continue;
    const home = T.cities[sv.city] || capital();
    // Saved on the planet: back where it was (if that's still a place it can be). Older saves: at home.
    let d = sv.d || null;
    if (d && ((mode === "land" && !planet.isLand(d)) || (mode === "sea" && planet.isLand(d)))) d = null;
    spawnVehicle(sv.owner, sv.design, home, d, sv.hp);
  }
  if (!save) {
    // Your first vehicle, so there is something to do from the first second.
    spawnVehicle(YOU, T.startType + ":land", T.cities[0]);
    T.nations.forEach((n) => citiesOf(n.id).slice(0, 1).forEach((c) => spawnVehicle(n.id, c.type + ":land", c)));
    chronicle({ key: "civ:start", stage: "civ", icon: "🏛", text: `Founded the ${CITY_TYPES[T.startType].name.toLowerCase()} city of ${o.name}.` });
    // After the arrival from the Tribal Stage, if there is one: the help would cover it.
    if (arrive) arrive.after = () => openSheet("help");
    else setTimeout(() => openSheet("help"), 600);
  }
  if (!yourCities().length) T.lost = true;
  focusOn(capital().d, ALT.city * 1.6);
  cam.sf = cam.f;
  updateHUD();
  let saveClock = 15;

  /* ---- what is worth drawing from here ------------------------------------------------------------- */
  const camDir = new THREE.Vector3();
  function updateLOD(dt) {
    camDir.copy(camera.position).normalize();
    const alt = cam.salt;
    const facing = (d, k = 0.15) => d.x * camDir.x + d.y * camDir.y + d.z * camDir.z > k;
    for (const c of T.cities) {
      const front = facing(c.d, 0.05);
      // Up close: the town. From orbit: its lights at night and a beacon in its owner's colour.
      c.group.visible = front && alt < 380;
      const night = 1 - globe.daylight(c.d);
      c.lights.visible = front;
      c.lights.material.opacity = Math.max(0, night - 0.35) * 1.4 * Math.min(1, 0.4 + cityLevel(c) / 8);
      c.lights.scale.setScalar((26 + cityLevel(c) * 3) * (alt > ALT.region ? 1.6 : 1));
      const b = Math.max(0, Math.min(1, (alt - 160) / 200));
      c.beacon.visible = front && b > 0;
      c.beacon.material.opacity = 0.9 * b;
      c.beacon.scale.setScalar(10 + alt * 0.03);
    }
    // Vehicles are too small to see from orbit: their selection rings would just be noise there.
    for (const v of T.vehicles) v.group.visible = alt < 600 && facing(v.d, 0.1);
    for (const g of T.geysers) g.group.visible = alt < 500 && facing(g.d, 0.1);
  }
  function updateRising(dt) {
    for (let i = rising.length - 1; i >= 0; i--) {
      const r = rising[i];
      r.t = Math.min(1, r.t + dt / 1.1);
      r.root.scale.y = r.root.userData.sy * Math.max(0.01, ease(r.t));
      if (r.t >= 1 || !r.root.parent) rising.splice(i, 1);
    }
  }

  return {
    get state() {
      return T;
    },
    setPaused(p) {
      paused = !!p;
    },
    save: saveState,
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
    update(dt) {
      if (paused) return;
      if (toastT > 0 && (toastT -= dt) <= 0) $h("#cvToast").classList.remove("show");
      updateNotes(dt);
      if (victory) dragBy(-innerHeight * 0.06 * dt, 0);
      thumbs.pump(2);
      // The interface follows the camera: minimal over the whole planet, fuller down among the cities.
      const zoom = arrive ? "arrive" : cam.salt > ALT.region * 1.6 ? "planet" : cam.salt > 160 ? "region" : "city";
      if (hud.dataset.zoom !== zoom) {
        hud.dataset.zoom = zoom;
        $h("#cvGlobeLabel").textContent = zoom === "planet" ? "Land" : "Planet";
      }
      // Arrow keys and WASD turn the planet; Q and E turn the view; + and - zoom.
      const kx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
        kz = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      if (kx || kz) dragBy(-kx * innerHeight * 0.9 * dt, -kz * innerHeight * 0.9 * dt);
      const kt = (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0);
      if (kt) twist(kt * 1.6 * dt);
      const kzoom = (keys.has("-") || keys.has("_") ? 1 : 0) - (keys.has("=") || keys.has("+") ? 1 : 0);
      if (kzoom) {
        cam.alt *= Math.exp(kzoom * 1.6 * dt);
        clampAlt();
      }
      placeCamera(dt);
      globe.update(dt, camera, cam.salt);
      if (!arrive && !T.lost && !victory && !(sheet && sheet.kind === "lost")) {
        T.time += dt;
        T.superCool = Math.max(0, T.superCool - dt);
        T.money += income() * dt;
        T.spice += spiceIncome() * dt;
        T.price = marketStep(T.price, dt);
        updateProduction(dt);
        for (const v of [...T.vehicles]) if (!v.dead) updateVehicle(v, dt);
        updateTurrets(dt);
        updateNations(dt);
        updateRivalDiplomacy(dt);
        updateInbox();
        autoDefend();
      }
      for (const v of T.vehicles) placeVehicle(v, dt);
      T.geysers.forEach((g) => {
        if (g.plume) {
          g.plume.scale.y = 0.8 + 0.3 * Math.sin(T.time * 3 + g.id);
          g.plume.material.opacity = 0.45 + 0.15 * Math.sin(T.time * 5 + g.id);
        }
      });
      if (flashMesh && flashT > 0) {
        flashT -= dt;
        flashMat.opacity = Math.max(0, flashT / 0.6);
        flashMesh.visible = flashT > 0;
      }
      updateRising(dt);
      updateCitizens(dt, cam.sf, cam.salt);
      updateLOD(dt);
      updateShots(dt);
      projectiles.update(dt);
      updateBooms(dt);
      updateMarks();
      if ((hudClock -= dt) <= 0) {
        hudClock = 0.25;
        updateWorldEvents();
        updateMinimap();
        updateDanger();
        updateHUD();
        hud.classList.toggle("calm", calm());
        if ((liveClock -= 0.25) <= 0 && !sheetPress) {
          liveClock = 1;
          if (sheet && (sheet.kind === "city" || sheet.kind === "nation" || sheet.kind === "spice" || sheet.kind === "economy" || sheet.kind === "world" || sheet.kind === "messages")) renderSheet(false);
          renderPeek(false);
        }
      }
      if ((saveClock -= dt) <= 0) {
        saveClock = 20;
        saveState();
      }
    },
    render() {
      o.renderer.render(scene, camera);
    },
    dispose() {
      minimap?.dispose();
      arrive?.frame.remove(false);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointerup", onSheetRelease);
      T.vehicles.forEach((v) => v.model.dispose());
      T.cities.forEach((c) => {
        c.models?.forEach((m) => m.dispose());
        c.ownMats?.forEach((m) => m.dispose());
        c.ownGeos?.forEach((g) => g.dispose());
        c.lights?.material.dispose();
        c.beacon?.material.dispose();
      });
      T.geysers.forEach((g) => g.flagMat?.dispose());
      shots.forEach((s) => s.line.geometry.dispose());
      booms.forEach((b) => b.s.material.dispose());
      Object.values(shotMat).forEach((m) => m.dispose());
      projectiles.dispose();
      matCache.forEach((set) => Object.values(set).forEach((m) => m.dispose()));
      Object.values(sharedGeo).forEach((g) => g.dispose());
      Object.values(sharedMat).forEach((m) => m.dispose());
      citizenGeo.dispose();
      citizenMat.dispose();
      citizens.dispose();
      glowTex.dispose();
      flashGeo.dispose();
      flashMat.dispose();
      globe.dispose();
      thumbs.dispose();
      hud.remove();
    },
    debug: {
      T,
      legacy,
      applyWorldEvent,
      worldSnapshot,
      get minimap() {
        return minimap;
      },
      cam,
      openPeek,
      notify,
      thumbs,
      get victory() {
        return victory;
      },
      planet,
      globe,
      openSheet,
      takeCity,
      spawnVehicle,
      orderTo,
      fireSuper,
      selectAll,
      buyCity,
      project,
      income,
      editDesign,
      focusOn,
      reachable,
      projectiles,
      hostile,
      talk,
      get sheet() {
        return sheet;
      },
      get arriving() {
        return !!arrive;
      },
      get citizens() {
        return citizens.count;
      },
      /** Screen point of a city, for tests. */
      cityScreen(i) {
        return projectDir(T.cities[i].d, 4);
      },
      /** Screen point of a vehicle, for tests. */
      vehicleScreen(v) {
        return project(vehiclePos(v, 1.5));
      },
    },
  };
}
