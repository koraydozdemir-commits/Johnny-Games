/**
 * Civilization Stage: your tribe's village has become a city on the home island. Build up cities
 * from your own building designs, field vehicles from your own vehicle designs, claim spice, and
 * bring every city on the island under your flag by force, by trade or by faith, while three rival
 * nations try the same.
 *
 * The rules (economy, damage, conversion, trade, diplomacy, the AI's choices) live in ./rules.js and
 * are unit tested; this file is the scene, the controls and the HUD.
 */
import * as THREE from "three";
import { generateSpecies } from "../creature/species.js";
import { getHomeworld } from "../ecolib/homeworld.js";
import { planetProfile } from "../ecolib/planet-profile.js";
import { clampToMap, createPlanetMap, mapToLonLat, unitVector } from "./planet-map.js";
import { createPlanetView, placeOnPlanet, worldAt } from "./planet-render.js";
import { createPlanetCamera, ZOOM } from "./planet-camera.js";
import { createPlanetFlora } from "./planet-flora.js";
import { createCityArt, createSpiceArt } from "./city-view.js";
import { CITY, STYLE_IDS, chooseStyles, describeCulture, makeCulture, roadLinks, traitsOf } from "./culture.js";
import { createMinimap } from "./minimap.js";
import { stripIcons, withIcons } from "./icons.js";
import { ALLIANCE_COST, DEAL_COST, accepts, alliesOf, allied, atWar, canAlly, canDeal, cannotDeclare, createDiplomacy, dealIncomeOf, declareWar, endAlliance, endDeal, hasDeal, joiners, makeAlliance, makeDeal, makeOffer, makePeace, pairKey, react, rel as relOf, relationWord as dipWord, setRel, settle, soureAlliances, tributeDemand, buyoutOffer, bump } from "./diplomacy.js";
import { PERSONALITY } from "./diplomacy.js";
import { planNation, strengthOf } from "./ai.js";
import { createCombatFx } from "./combat-fx.js";
import { COMMANDS, QUEUE_MAX, assignFormation, buildTime, availableCommands, canQueue, contextCommand, newItem, pickTarget, refundOf, separation, shotDamage, tickQueue, unitsInRect } from "./rts.js";
import { buildDesignMesh, designMaterials } from "../creations/mesh.js";
import { validateModular } from "../creations/format.js";
import { ROLES, STARTER_DESIGNS, designStats, vehicleMode } from "../creations/modular.js";
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
  SPICE_INCOME,
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
  canReach,
  cityDefence,
  cityEconomy,
  cityName,
  civArchetype,
  civLegacy,
  dominance,
  HALL_MAX,
  MAX_LEVEL,
  levelFactor,
  hallCost,
  improveCost,
  turretSlots,
  vehicleCapOf,
  VEHICLE_UPKEEP,
  adjacency,
  upkeepOf,
  clampRel,
  damageCity,
  deliverTrade,
  dominantMethod,
  preachRate,
  preachTo,
  relationWord,
  repairCity,
  starterVehicle,
  superUnlocked,
  tradeIncome,
  transferCity,
  vehicleUnit,
} from "./rules.js";

const TAU = Math.PI * 2;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const MODE_ICON = { land: "🚙", sea: "🚤", air: "✈" };
const MODE_NAME = { land: "Land", sea: "Sea", air: "Air" };
const ROLE_ICON = { house: "🏠", factory: "🏭", fun: "🎡", temple: "⛪", turret: "🗼", hall: "🏛" };
/** The three rival nations: one of each kind, from the three tribes that lived nearest. */
const NATION_KINDS = ["military", "economic", "religious"];
const NATION_COLORS = { military: 0xc9483c, economic: 0xd6a03f, religious: 0x8a5fd0 };
const NATION_START = { military: -20, economic: 10, religious: 0 };
const INDEPENDENT_COLOR = 0x9aa3ab;
const RANGE = { land: 12, air: 11, sea: 6 };
const SCALE = { building: 1.35, hall: 1.7, vehicle: 1.35 };
/** Where the stage stands in for a planet when the game has no universe (an old save, a test): a plain world per region. */
const REGION_WORLD = { coast: ["terrestrial", 18, 0.7], forest: ["jungle", 24, 0.6], swamp: ["swamp", 26, 0.75], badlands: ["desert", 40, 0.2], volcanic: ["volcanic", 55, 0.3] };
function fallbackProfile(regionId = "coast") {
  const [type, temp, water] = REGION_WORLD[regionId] || REGION_WORLD.coast;
  return planetProfile({ id: "home:" + regionId, type, temp, water, atmosphere: "Breathable", biodiversity: 0.7, gravity: 1, surfaceSeed: 4242 + regionId.length * 17 });
}
/** Local layout of a city's building plots and turret sites (metres from its centre). */
const SPOTS = {
  plots: PLOTS,
  turretSlots: MAX_TURRETS,
  plotAngle: (k) => (k / PLOTS) * TAU + TAU / 12,
  turretAngle: (k) => (k / MAX_TURRETS) * TAU - Math.PI / 2,
};
/** For the first few minutes nobody comes for your cities: time to build up. */
const GRACE = 240;
/** How much of its income a rival nation makes use of. */
const AI_EFFICIENCY = 0.75;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object|null} o.save        from readCivSave
 * @param {string} o.regionId
 * @param {string} o.quality
 * @param {string} o.name              your nation's name
 * @param {number} o.color             your colour (from your tribe)
 * @param {{cellDiet?:string, creatureCard?:string, tribeTrait?:string}} o.legacy
 * @param {(kind:string, opts?:object) => void} o.sfx
 * @param {(kind:string, design:object, opts:object) => object|null} o.openEditor  the modular editor
 * @param {(kind:string, design:object) => void} [o.onCreation]  a design saved: for the Sporepedia
 * @param {(ev:object) => void} [o.onChronicle]
 * @param {(card:object) => void} [o.onWon]
 * @param {() => void} [o.onSaved]
 * @param {() => void} [o.onSettings]
 * @param {() => void} [o.onHistory]
 * @param {() => void} o.onExit       back to the Tribal Stage
 * @param {() => void} o.onRestart    start the stage over (after losing every city)
 */
export function createCivStage(o) {
  const canvas = o.renderer.domElement;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 3600);
  const save = o.save || null;
  // The planet is the homeworld the game started on (see ecolib/homeworld.js); a plain one stands in when there is none.
  const profile = getHomeworld() || fallbackProfile(o.regionId);
  const map = createPlanetMap(profile);
  const planetView = createPlanetView(scene, map, { quality: o.quality });
  const legacy = civLegacy(o.legacy || {});
  const mods = legacy.mods;
  const chronicle = (ev) => o.onChronicle?.(ev);
  const HOME = { x: map.citySites[0].x, z: map.citySites[0].z };
  const wv = new THREE.Vector3();
  const W = (x, h, z) => worldAt(map, x, z, h, new THREE.Vector3());
  const rig = createPlanetCamera(camera, map, { x: HOME.x, z: HOME.z, dist: 125 });
  rig.snap();
  const fx = createCombatFx(scene);
  const myColors = { base: 0xf2efe6, accent: o.color ?? 0x3fa9d6, trim: 0x2f3d4f };

  /* ---- state -------------------------------------------------------------------------------- */
  const T = {
    money: save ? save.money : START_MONEY,
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
  const myStrengths = () => {
    const s = {};
    for (const [role, d] of Object.entries(T.designs.building)) s[role] = designStats(d).stats.strength;
    s.turret = (s.turret || 5) * (1 + mods.turret);
    return s;
  };
  let strengths = myStrengths();
  const ownerMods = (owner) => (owner === YOU ? { strengths, incomeBonus: mods.incomeBonus, happyBonus: mods.happyBonus } : {});
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
    plot: new THREE.CircleGeometry(2.6, 18).rotateX(-Math.PI / 2),
    ring: new THREE.RingGeometry(1.6, 2.1, 24).rotateX(-Math.PI / 2),
  };
  const sharedMat = {
    plot: plain(0xa89c80),
    sel: new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, opacity: 0.9, depthTest: false }),
    foe: new THREE.MeshBasicMaterial({ color: 0xef4b48, transparent: true, opacity: 0.9, depthTest: false }),
  };

  /* ---- nations ---------------------------------------------------------------------------------- */
  // Named for the species of the three nearest tribes from the Tribal Stage (same seeds), one of each kind.
  NATION_KINDS.forEach((type, i) => {
    const sp = generateSpecies(90210 + i * 7919, "omni", 1);
    const saved = save?.nations[i];
    T.nations.push({
      id: "n" + i,
      index: i,
      type,
      species: sp,
      name: sp.name,
      color: NATION_COLORS[type],
      colors: { base: 0xe8dcc0, accent: NATION_COLORS[type], trim: 0x3a3f45 },
      base: clampRel(NATION_START[type] + mods.relation),
      money: saved ? saved.money : 120,
      alive: saved ? saved.alive : true,
      clock: 4 + i * 1.3,
      buildClock: 20 + i * 7,
    });
  });
  // Every pair of nations (you included) has a relationship, wars, alliances and trade agreements: see diplomacy.js.
  // A nation's `relation` and `war` towards you read and write that state, so the rest of the stage can use them.
  T.dip =
    save?.dip && Object.keys(save.dip.rel).length
      ? save.dip
      : (() => {
          const d = createDiplomacy(T.nations, Object.fromEntries(T.nations.map((n, i) => [n.id, save?.nations[i] ? save.nations[i].relation : clampRel(NATION_START[n.type] + mods.relation)])));
          T.nations.forEach((n, i) => {
            if (save?.nations[i]?.war) d.war[pairKey(YOU, n.id)] = true;
          });
          return d;
        })();
  T.offers = [];
  for (const n of T.nations)
    Object.defineProperties(n, {
      relation: { enumerable: true, get: () => relOf(T.dip, YOU, n.id), set: (v) => setRel(T.dip, YOU, n.id, v) },
      war: {
        enumerable: true,
        get: () => atWar(T.dip, YOU, n.id),
        set: (v) => {
          const k = pairKey(YOU, n.id);
          if (v) {
            T.dip.war[k] = true;
            delete T.dip.deals[k];
            delete T.dip.allies[k];
          } else delete T.dip.war[k];
        },
      },
    });
  const nationOf = (id) => T.nations.find((n) => n.id === id) || null;
  const nationIds = () => [YOU, ...T.nations.map((n) => n.id)];
  const aliveIds = () => [YOU, ...T.nations.filter((n) => n.alive).map((n) => n.id)];
  const typeOfNation = (id) => (id === YOU ? T.startType : nationOf(id)?.type);
  const ownerColor = (owner) => (owner === YOU ? myColors.accent : nationOf(owner)?.color ?? INDEPENDENT_COLOR);
  const ownerName = (owner) => (owner === YOU ? "your nation" : owner ? nationOf(owner)?.name + " nation" : "Independent");

  /* ---- cultures: how each nation's cities look, from its species -------------------------------------- */
  const youSpecies = o.species?.record ? o.species : { record: null, diet: "omni" };
  {
    const order = [
      { key: YOU, traits: traitsOf(youSpecies), seed: 1 },
      ...T.nations.map((n) => ({ key: n.id, traits: traitsOf(n.species), seed: 90210 + n.index * 7919 })),
    ];
    const styles = chooseStyles(order);
    T.cultures = { [YOU]: makeCulture({ key: YOU, species: youSpecies, accent: myColors.accent, style: styles.get(YOU), seed: 1 }) };
    for (const n of T.nations) T.cultures[n.id] = makeCulture({ key: n.id, species: n.species, accent: n.color, style: styles.get(n.id), seed: n.index });
  }
  /** Independent cities have a weathered local style per continent. */
  const localCultures = new Map();
  const cultureFor = (c) => {
    if (c.owner === YOU) return T.cultures[YOU];
    if (c.owner && T.cultures[c.owner]) return T.cultures[c.owner];
    const key = "local:" + c.continent;
    if (!localCultures.has(key)) localCultures.set(key, makeCulture({ key, species: generateSpecies(5150 + c.continent * 31, "omni", 1), accent: INDEPENDENT_COLOR, style: STYLE_IDS[(c.continent * 3 + 1) % STYLE_IDS.length], seed: c.continent, muted: true }));
    return localCultures.get(key);
  };

  /* ---- cities -------------------------------------------------------------------------------------- */
  // Your capital where your village stood; eleven more cities across the planet's continents: two for
  // each rival nation (the nearer ones for the friendlier nations) and the rest independent.
  {
    const owners = [YOU, "n1", "n2", "n0", null, "n1", "n2", "n0", null, null, null, null];
    map.citySites.forEach((site, i) => {
      const saved = save?.cities[i];
      const owner = saved ? saved.owner : owners[i] === undefined ? null : owners[i];
      const nat = nationOf(owner);
      const type = saved ? saved.type : owner === YOU ? T.startType : nat ? nat.type : TYPE_IDS[i % 3];
      // Rivals start with a working town; independents with a couple of houses and a turret.
      const startPlots = owner === YOU ? ["house", "factory", null, null, null, null] : nat ? ["house", "factory", "fun", "house", null, null] : ["house", "house", null, null, null, null];
      const city = {
        id: i,
        x: site.x,
        z: site.z,
        continent: site.continent,
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
        coastal: !!site.coastal,
        // Where boats anchor off this city (coastal cities only).
        sea: site.coastal ? site.sea : null,
        art: null,
        levels: saved?.levels ? saved.levels.slice() : Array.from({ length: PLOTS }, () => 1),
        hall: saved?.hall || 1,
        devout: !!saved?.devout,
        queue: saved?.queue ? saved.queue.map((i) => ({ ...i })) : [],
        calm: 99,
        mark: null,
      };
      T.cities.push(city);
    });
  }
  const yourCities = () => T.cities.filter((c) => c.owner === YOU);
  const citiesOf = (owner) => T.cities.filter((c) => c.owner === owner);
  const capital = () => T.cities[0].owner === YOU ? T.cities[0] : yourCities()[0] || T.cities[0];
  const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const groundY = (x, z) => Math.max(0, map.heightAt(x, z));

  const cityArt = createCityArt(scene, map, { quality: o.quality });
  const spiceArt = createSpiceArt(scene, map);
  const ownerDesign = (owner, role, culture = null) => {
    if (owner === YOU) return T.designs.building[role];
    const pal = culture?.palette;
    const colors = pal ? { base: pal.wall, accent: pal.accent, trim: pal.trim } : nationOf(owner)?.colors || { base: 0xd9d4c8, accent: INDEPENDENT_COLOR, trim: 0x3a3f45 };
    return { ...STARTER_DESIGNS.building[role], colors };
  };
  const plotSpot = (c, k) => {
    const a = SPOTS.plotAngle(k);
    return { x: c.x + Math.cos(a) * CITY.plotRing, z: c.z + Math.sin(a) * CITY.plotRing };
  };
  /** A city's building plots and turret sites: the hall's level adds turret sites. */
  const spotsFor = (c) => {
    const n = turretSlots(c.hall);
    return { plots: PLOTS, turretSlots: n, plotAngle: SPOTS.plotAngle, turretAngle: (k) => (k / n) * TAU - Math.PI / 2 };
  };
  const turretSpot = (c, k) => {
    const a = spotsFor(c).turretAngle(k);
    return { x: c.x + Math.cos(a) * CITY.turretRing, z: c.z + Math.sin(a) * CITY.turretRing };
  };
  const boxTmp = new THREE.Box3();
  /** Stand one designed building on the ground at a spot, facing the way given; returns its model and height. */
  function placeModel(group, design, at, scale, face = 0) {
    const m = buildDesignMesh(design, { materials: matsFor(design.colors) });
    m.root.scale.setScalar(scale);
    m.root.updateMatrixWorld(true);
    const height = boxTmp.setFromObject(m.root).max.y;
    placeOnPlanet(map, m.root, at.x, at.z, groundY(at.x, at.z), face);
    group.add(m.root);
    m.height = height;
    return m;
  }
  function buildCity(c) {
    if (c.art) {
      c.models.forEach((m) => m.dispose());
      c.art.dispose();
    }
    c.models = [];
    const culture = cultureFor(c);
    c.culture = culture;
    const econ = cityEconomy(c, ownerMods(c.owner));
    const art = cityArt.build(c, { culture, ownerColor: ownerColor(c.owner), spots: spotsFor(c), pop: econ.pop });
    c.art = art;
    c.world = W(c.x, groundY(c.x, c.z), c.z);
    const face = (p) => Math.atan2(c.x - p.x, c.z - p.z);
    const hall = placeModel(art.detail, ownerDesign(c.owner, "hall", culture), c, SCALE.hall);
    c.models.push(hall);
    art.crownAt(hall.height);
    for (let k = 0; k < PLOTS; k++) {
      const at = plotSpot(c, k);
      if (c.plots[k]) c.models.push(placeModel(art.detail, ownerDesign(c.owner, c.plots[k], culture), at, SCALE.building, face(at)));
      else {
        const pad = new THREE.Mesh(sharedGeo.plot, sharedMat.plot);
        placeOnPlanet(map, pad, at.x, at.z, groundY(at.x, at.z) + 0.3);
        art.detail.add(pad);
      }
    }
    for (let k = 0; k < c.turrets; k++) {
      const at = turretSpot(c, k);
      c.models.push(placeModel(art.detail, ownerDesign(c.owner, "turret", culture), at, SCALE.building * 0.9, face(at)));
    }
  }

  /* ---- spice geysers ------------------------------------------------------------------------------ */
  // Spice vents sit where the planet map put them, each with its own richness (map.spiceSites[i].yield).
  map.spiceSites.forEach((sp, i) => {
    const saved = save?.geysers[i];
    T.geysers.push({ id: i, x: sp.x, z: sp.z, yield: sp.yield, biome: sp.biome, continent: sp.continent, owner: saved ? saved.owner : null, hp: saved ? saved.hp : 1, view: null, plume: null });
  });
  function buildGeyser(gz) {
    gz.view?.dispose();
    gz.view = spiceArt.build(gz, ownerColor(gz.owner));
    gz.plume = gz.view.plume;
  }

  /* ---- vehicles ------------------------------------------------------------------------------------ */
  const vehicleDesign = (owner, key) => {
    if (owner === YOU) return T.designs.vehicle[key];
    const [role, mode] = key.split(":");
    return starterVehicle(role, mode, nationOf(owner)?.colors);
  };
  /** A free spot for a land or air vehicle near a city: on open ground just outside its walls. */
  function spawnSpot(city, mode) {
    const base = Math.random() * TAU;
    for (let r = 20; r < 60; r += 6)
      for (let k = 0; k < 10; k++) {
        const a = base + (k / 10) * TAU;
        const x = city.x + Math.cos(a) * r,
          z = city.z + Math.sin(a) * r;
        if (map.walkable(mode === "air" ? "air" : "land", x, z)) return { x, z };
      }
    return { x: city.x + 20, z: city.z };
  }
  function spawnVehicle(owner, key, city, at = null, hpFrac = 1) {
    const design = vehicleDesign(owner, key);
    const unit = vehicleUnit(design, unitMods(owner));
    const [role, mode] = key.split(":");
    let start = at || (mode === "sea" ? city.sea || spawnSpot(city, "land") : spawnSpot(city, mode));
    const model = buildDesignMesh(design, { materials: matsFor(design.colors) });
    model.root.scale.setScalar(SCALE.vehicle);
    const ring = new THREE.Mesh(sharedGeo.ring, owner === YOU ? sharedMat.sel : sharedMat.foe);
    ring.visible = false;
    ring.renderOrder = 5;
    const g = new THREE.Group();
    g.add(model.root, ring);
    scene.add(g);
    const v = { id: nextVehicleId++, owner, key, role, mode, unit, model, group: g, ring, pos: { x: start.x, z: start.z }, y: 0, heading: Math.random() * TAU, hp: unit.hp * hpFrac, home: city.id, order: null, cool: 0, bob: Math.random() * 10, dead: false, path: null, planT: 0, far: false };
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
  }
  const vehiclesOf = (owner) => T.vehicles.filter((v) => v.owner === owner && !v.dead);
  const vehicleCap = (owner) => citiesOf(owner).reduce((sum, c) => sum + vehicleCapOf(c.hall), 0);

  /* ---- effects: shots, pops ------------------------------------------------------------------------- */
  const shots = [];
  const shotMat = { you: new THREE.LineBasicMaterial({ color: 0xfff1a8 }), foe: new THREE.LineBasicMaterial({ color: 0xff7b5c }), faith: new THREE.LineBasicMaterial({ color: 0xc9b5ff, transparent: true, opacity: 0.7 }), trade: new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7 }) };
  function shot(a, b, kind) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, shotMat[kind]);
    line.frustumCulled = false;
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

  /* ---- HUD ------------------------------------------------------------------------------------------ */
  const hud = document.createElement("div");
  hud.className = "tribeHUD civHUD";
  hud.innerHTML = withIcons(`
    <div class="trTop">
      <div class="trBox">
        <b class="trName" id="cvName"></b>
        <div class="trStats"><span title="Money (Sporebucks)">§ <b id="cvMoney">0</b> <small id="cvIncome"></small></span><span title="Cities you hold">🏙 <b id="cvCities">0</b></span><span title="Vehicles">🚙 <b id="cvVeh">0</b></span></div>
      </div>
      <button class="trIcon" id="cvMenu" aria-label="Menu" title="Menu">☰</button>
    </div>
    <div class="trGoal" id="cvGoal" role="status" aria-live="polite"></div>
    <div class="trTribes cvNations" id="cvNations" role="list" aria-label="Rival nations"></div>
    <div class="trMarks" id="cvMarks" aria-hidden="true"></div>
    <div class="cvCam" role="group" aria-label="Camera">
      <button id="cvZoomIn" aria-label="Zoom in" title="Zoom in (+)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <button id="cvZoomOut" aria-label="Zoom out" title="Zoom out (-)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      <button id="cvBoxBtn" aria-label="Box select: drag to select several vehicles" aria-pressed="false" title="Box select (B)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="1.6" class="dot"/></svg></button>
      <button id="cvGlobe" aria-label="Show the whole planet" title="Whole planet (G)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></button>
      <button id="cvNorth" aria-label="Compass: face north" title="Face north (N)"><svg viewBox="0 0 24 24" aria-hidden="true"><g id="cvNeedle"><path d="M12 3l4 9h-8z" class="n"/><path d="M12 21l4-9h-8z"/></g></svg></button>
    </div>
    <div class="cvRegion" id="cvRegion" hidden role="status" aria-live="polite"></div>
    <div class="cvBox" id="cvBox" hidden aria-hidden="true"></div>
    <div class="cvCmd" id="cvCmd" hidden>
      <div class="cvSelInfo" id="cvSelInfo" role="status" aria-live="polite"></div>
      <div class="cvCmdRow" id="cvCmdRow" role="toolbar" aria-label="Commands for the selected vehicles"></div>
    </div>
    <div class="trToast" id="cvToast" role="status" aria-live="polite"></div>
    <div class="trPlace" id="cvTarget" hidden role="status" aria-live="polite"><span id="cvTargetText"></span><button id="cvTargetCancel">Cancel</button></div>
    <div class="trSheet" id="cvSheet" hidden></div>
    <div class="trBottom">
      <div class="trUnits" id="cvUnits" role="list" aria-label="Your vehicles"></div>
      <div class="trActions cvActions">
        <button id="cvAll" aria-label="Select every vehicle"><span>🚙</span><small>All</small></button>
        <button id="cvHome" aria-label="Go to your capital"><span>🏛</span><small>Capital</small></button>
        <button id="cvCity" aria-label="Manage the nearest of your cities"><span>🔨</span><small>Build</small></button>
        <button id="cvDesigns" aria-label="Design buildings and vehicles"><span>🎨</span><small>Designs</small></button>
        <button id="cvSuper" aria-label="Superweapon"><span>✨</span><small>Super</small></button>
      </div>
    </div>
    <div class="trMenuPanel" id="cvMenuPanel" hidden>
      <button id="cvResume" class="primary">Resume</button>
      <button id="cvHistory">📜 Species history</button>
      <button id="cvSettings">⚙ Settings</button>
      <button id="cvHelp">How to play</button>
      <button id="cvExit">Back to the Tribal Stage</button>
    </div>`);
  document.body.appendChild(hud);
  const $h = (q) => hud.querySelector(q);
  $h("#cvName").textContent = o.name;
  {
    const box = hud.querySelector(".trStats");
    box.setAttribute("role", "button");
    box.setAttribute("tabindex", "0");
    box.setAttribute("aria-label", "Economy: where your money comes from and goes");
    box.style.cursor = "pointer";
    box.onclick = () => openSheet("econ");
    box.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openSheet("econ"));
  }
  let toastT = 0;
  function toast(text, seconds = 3) {
    const el = $h("#cvToast");
    el.textContent = stripIcons(text);
    el.classList.add("show");
    toastT = seconds;
  }
  const seenTips = new Set();
  const tipOnce = (key, text, s = 4.5) => {
    if (seenTips.has(key)) return;
    seenTips.add(key);
    toast(text, s);
  };
  const projOut = { x: 0, y: 0, on: false };
  /** Screen position of a map point `y` metres above the sea (x and z are map metres). */
  function project(x, y, z) {
    worldAt(map, x, z, y, wv);
    return { ...rig.project(wv, innerWidth, innerHeight, projOut) };
  }
  function pop(x, y, z, text, cls = "") {
    const p = project(x, y, z);
    if (!p.on) return;
    const el = document.createElement("div");
    el.className = "trPop " + cls;
    el.innerHTML = withIcons(esc(text));
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    $h("#cvMarks").appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /* ---- region inspector: tap open ground to learn about it -------------------------------------------- */
  let regionT = 0;
  function closeRegion() {
    $h("#cvRegion").hidden = true;
  }
  function inspect(at) {
    const d = map.describe(at.x, at.z);
    if (d.kind === "ice") return toast("Polar ice: nothing lives or builds here.");
    const near = T.cities.map((c) => ({ c, d: distXZ(c, at) })).sort((a, b) => a.d - b.d)[0];
    const spiceNear = T.geysers.map((g) => ({ g, d: distXZ(g, at) })).sort((a, b) => a.d - b.d)[0];
    const place = d.kind === "land" ? `${esc(d.label)}${d.continent ? ` · ${esc(d.continent)}` : ""}` : d.kind === "ocean" ? "Open ocean" : "Lake";
    const fact = d.kind === "land" ? `${d.altitude} m up` : `${d.depth} m deep`;
    const el = $h("#cvRegion");
    el.innerHTML = `<b>${place}</b><span>${fact} · ${Math.abs(d.latitude)}°${d.latitude >= 0 ? "N" : "S"}</span>${near ? `<span>Nearest city: ${esc(near.c.name)} (${esc(cap(ownerName(near.c.owner)))}), ${Math.round(near.d)} m</span>` : ""}${spiceNear && spiceNear.d < 130 ? `<span>Spice: ${spiceNear.g.owner ? esc(cap(ownerName(spiceNear.g.owner))) + "'s derrick" : "a free geyser"}, ${Math.round(spiceNear.d)} m</span>` : ""}`;
    el.hidden = false;
    regionT = 6;
    flash(at);
  }

  /* ---- sheets ------------------------------------------------------------------------------------------ */
  let sheet = null; // { kind, city?, nation? }
  function openSheet(kind, extra = {}) {
    sheet = { kind, ...extra };
    $h("#cvMenuPanel").hidden = true;
    renderSheet();
  }
  function closeSheet() {
    sheet = null;
    $h("#cvSheet").hidden = true;
  }
  const dis = (off) => (off ? 'aria-disabled="true"' : "");
  const bar = (frac, cls = "") => `<span class="tsRel cvBar ${cls}"><b style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></b></span>`;
  let sheetHtml = "",
    sheetPress = false;
  $h("#cvSheet").addEventListener("pointerdown", () => (sheetPress = true));
  const onSheetRelease = () => setTimeout(() => (sheetPress = false), 0);
  window.addEventListener("pointerup", onSheetRelease);
  function renderSheet(force = true) {
    const el = $h("#cvSheet");
    if (!sheet) return void (el.hidden = true);
    el.hidden = false;
    let html = "";
    if (sheet.kind === "city") html = cityHtml(sheet.city);
    else if (sheet.kind === "nation") html = nationHtml(sheet.nation);
    else if (sheet.kind === "designs") html = designsHtml();
    else if (sheet.kind === "offer") html = offerHtml();
    else if (sheet.kind === "econ") html = econHtml();
    else if (sheet.kind === "won") html = wonHtml();
    else if (sheet.kind === "lost") html = lostHtml();
    else html = helpHtml();
    // Live refreshes skip identical content, so a finger mid-tap never loses its button.
    if (!force && html === sheetHtml) return;
    sheetHtml = html;
    el.innerHTML = withIcons(html);
    el.querySelector(".tsClose")?.addEventListener("click", closeSheet);
    bindSheet(el);
  }
  function cityHtml(c) {
    const econ = cityEconomy(c, ownerMods(c.owner));
    const head = `<div class="tsHead"><div>${CITY_TYPES[c.type].icon} ${esc(c.name)}<small>${esc(cap(ownerName(c.owner)))} · ${CITY_TYPES[c.type].name} city</small></div><button class="tsClose" aria-label="Close">✕</button></div>
      <div class="tsStats cvCityStats"><span><b>${econ.pop}k</b>people</span><span><b>${econ.happiness > 0 ? "+" : ""}${econ.happiness}</b>${econ.riot ? "rioting!" : "happiness"}</span><span><b>${(econ.income - econ.upkeep).toFixed(1)}</b>§ / s net</span><span><b>${c.turrets}</b>turrets</span></div>
      <p class="tsHint cvCulture"><b>${esc(c.culture ? describeCulture(c.culture) : "")}</b> · ${esc(map.continents[c.continent]?.name || "")}</p>`;
    if (c.owner === YOU) {
      const adj = adjacency(c.plots);
      const plots = c.plots
        .map((role, k) => {
          const lvl = c.levels[k] || 1;
          const notes = adj.notes[k];
          const mark = notes.length ? `<i class="cvAdj ${notes.some((x) => !x.good) ? "bad" : "good"}" aria-hidden="true">${notes.some((x) => !x.good) ? "−" : "+"}</i>` : "";
          return role
            ? `<button class="cvPlot lv${lvl} ${sheet.plot === k ? "sel" : ""}" data-plot="${k}" aria-pressed="${sheet.plot === k}" aria-label="${ROLES.building[role].name}, level ${lvl} of ${MAX_LEVEL}.${notes.map((x) => " " + x.text + ".").join("")} Tap for options">${ROLE_ICON[role]}<small>${ROLES.building[role].name} · Lv ${lvl}</small>${mark}</button>`
            : `<button class="cvPlot empty ${sheet.plot === k ? "sel" : ""}" data-plot="${k}" aria-pressed="${sheet.plot === k}" aria-label="Empty plot: tap to build">＋<small>Empty</small></button>`;
        })
        .join("");
      const sel = sheet.plot;
      let panel = "";
      if (sel != null && !c.plots[sel]) {
        // What each building would do here: its own effect, and what it does to its neighbours.
        const preview = (role) => {
          const test = c.plots.slice();
          test[sel] = role;
          const a = adjacency(test);
          const d = { happiness: a.happiness - adj.happiness, income: a.income - adj.income, faith: a.faith - adj.faith };
          const bits = [d.happiness && `${d.happiness > 0 ? "+" : ""}${d.happiness.toFixed(1)} happiness`, d.income && `${d.income > 0 ? "+" : ""}${d.income.toFixed(2)} output`, d.faith && `${d.faith > 0 ? "+" : ""}${d.faith.toFixed(1)} faith`].filter(Boolean);
          return bits.length ? bits.join(", ") + " from its neighbours" : "no neighbour effect";
        };
        panel = `<div class="tsTrade">${PLOT_ROLES.map((r) => `<button class="tsTradeBtn" data-build="${r}" ${dis(T.money < BUILD_COST[r])}><span>${ROLE_ICON[r]}</span><b>${ROLES.building[r].name}<small>${preview(r)}</small></b><em>§${BUILD_COST[r]}</em></button>`).join("")}</div><p class="tsHint">${PLOT_ROLES.map((r) => `${ROLE_ICON[r]} ${ROLES.building[r].desc}`).join(" ")} Plots form a ring: what stands next to a building changes how it works.</p>`;
      } else if (sel != null) {
        const role = c.plots[sel];
        const lvl = c.levels[sel] || 1;
        const next = lvl < MAX_LEVEL ? improveCost(role, lvl) : null;
        panel = `<div class="cvPlotInfo"><b>${ROLE_ICON[role]} ${ROLES.building[role].name} · level ${lvl} of ${MAX_LEVEL}</b><span>${Math.round((levelFactor(lvl) - 1) * 100)}% better than a plain one${next ? `; level ${lvl + 1} adds 35% more` : ""}.</span>${adj.notes[sel].map((x) => `<span class="${x.good ? "good" : "bad"}">${x.good ? "＋" : "−"} ${x.text}</span>`).join("")}</div>
          <div class="tsBtns"><button class="good" data-improve="1" ${dis(next == null || T.money < next)}>${next == null ? "Fully improved" : `Improve · §${next}`}</button><button data-demolish="1">Demolish</button></div>`;
      }
      const hallBtn = c.hall >= HALL_MAX ? `<button disabled aria-disabled="true">Hall fully expanded</button>` : `<button id="cvHall" ${dis(T.money < hallCost(c.hall))}>Expand the hall (level ${c.hall + 1}) · §${hallCost(c.hall)}</button>`;
      const cap = vehicleCap(YOU),
        have = vehiclesOf(YOU).length + queuedFor(YOU);
      const modes = allowedModes(yourCities().length, c.coastal);
      const role = c.type;
      const builds = ["land", "sea", "air"]
        .map((mode) => {
          const key = role + ":" + mode;
          const u = vehicleUnit(T.designs.vehicle[key], mods);
          const locked = !modes.includes(mode);
          const why = mode === "sea" && !c.coastal ? "Inland city" : mode === "air" && locked ? `Needs ${AIR_AT} cities` : "";
          return `<button class="tsTradeBtn" data-vehicle="${mode}" ${dis(locked || !tryQueue(c, mode, u).ok)}><span>${MODE_ICON[mode]}</span><b>${esc(T.designs.vehicle[key].name)}<small>${why || `${MODE_NAME[mode]} · ${Math.round(buildTime(u.cost, factoriesOf(c)))} s`}</small></b><em>§${u.cost}</em></button>`;
        })
        .join("");
      return `${head}
        <h5 class="tsKind">Buildings · tap a plot</h5><div class="cvPlots">${plots}</div>${panel}
        <h5 class="tsKind">City hall · level ${c.hall} of ${HALL_MAX}</h5>
        <p class="tsHint">A bigger hall holds more people (+25% each level), adds a turret site and a vehicle slot, and toughens the walls.</p>
        <div class="tsBtns cvRow">${hallBtn}</div>
        <div class="tsBtns cvRow"><button id="cvTurret" ${dis(c.turrets >= turretSlots(c.hall) || T.money < BUILD_COST.turret)}>🗼 Turret · §${BUILD_COST.turret} (${c.turrets}/${turretSlots(c.hall)})</button><button id="cvFocus">📍 Look here</button></div>
        <h5 class="tsKind">${CITY_TYPES[role].icon} ${CITY_TYPES[role].name} vehicles · ${have}/${cap}</h5><div class="tsTrade">${builds}</div>
        ${c.queue.length ? `<h5 class="tsKind">In production · ${c.queue.length}/${QUEUE_MAX}${factoriesOf(c) ? ` · ${factoriesOf(c)} ${factoriesOf(c) === 1 ? "factory speeds" : "factories speed"} it up` : ""}</h5><div class="cvQueue">${c.queue.map((q, i) => `<div class="cvQItem"><span class="noPic">${MODE_ICON[q.key.split(":")[1]]}</span><div><b>${esc(T.designs.vehicle[q.key].name)}</b>${bar(q.t / q.total, "trade")}</div><small>${q.t >= q.total ? "waiting" : Math.ceil(q.total - q.t) + " s"}</small><button data-cancel="${i}" aria-label="Cancel ${esc(T.designs.vehicle[q.key].name)}: refund §${refundOf(q)}">✕</button></div>`).join("")}</div>` : ""}
        <p class="tsHint">${CITY_TYPES[role].desc}${econ.riot ? " <b>This city is rioting:</b> build entertainment, or fewer factories." : ""}</p>`;
    }
    const nat = nationOf(c.owner);
    const myTrade = c.trade[YOU] || 0,
      myConv = c.conv[YOU] || 0;
    const cost = buyoutCost(econ, nat ? nat.relation : 0);
    const sel = [...T.selected].filter((v) => !v.dead);
    return `${head}
      <div class="cvDefence"><small>Turrets</small>${bar(c.turrets ? c.turretHp : 0, "foe")}<small>City hall</small>${bar(c.hallHp, "foe")}</div>
      <div class="cvDefence"><small>💰 Your trade</small>${bar(myTrade / 100, "trade")}<small>🕊 Converted to you</small>${bar(myConv / 100, "faith")}</div>
      ${nat ? `<p class="tsHint">${esc(nat.name)} nation: <b>${relationWord(nat.relation, nat.war)}</b> (${Math.round(nat.relation)}).</p>` : `<p class="tsHint">An independent city: it belongs to no nation, and any nation can take it.</p>`}
      <div class="tsBtns">
        <button class="good" id="cvSend" ${dis(!sel.length)}>Send ${sel.length || ""} selected</button>
        <button class="gift" id="cvBuy" ${dis(myTrade < 100 || T.money < cost)}>Buy · §${cost}</button>
      </div>
      <p class="tsHint">${sel.length ? "Military vehicles attack its turrets, then its hall. Economic ones trade (buy it when trade is full). Religious ones preach until it converts." : "Select vehicles first (tap them, or 🚙 All), then send them here."}${nat && !nat.war && sel.some((v) => v.role === "military") ? " <b>Attacking means war with this nation.</b>" : ""}</p>`;
  }
  const NATION_AI_LINE = { military: "Respects strength. Attacks the weak, and will demand tribute from a neighbour it can bully.", economic: "Prefers deals to wars. Trades with anyone, buys cities outright, and sues for peace at once.", religious: "Spreads its faith and answers conversion with temples. Despises militarists." };
  function nationHtml(n) {
    const cities = citiesOf(n.id).length;
    const state = dipWord(T.dip, YOU, n.id);
    const war = n.war,
      ally = allied(T.dip, YOU, n.id),
      deal = hasDeal(T.dip, YOU, n.id);
    const others = T.nations.filter((m) => m !== n && m.alive).map((m) => `<li><b>${esc(m.name)}</b> <span class="${atWar(T.dip, n.id, m.id) ? "bad" : allied(T.dip, n.id, m.id) ? "good" : ""}">${dipWord(T.dip, n.id, m.id)}</span></li>`);
    const eco = econOf(n.id);
    const can = (k) => (!n.alive ? "Fallen." : k === "deal" && !canDeal(T.dip, YOU, n.id) ? "" : "");
    return `<div class="tsHead"><div>${CITY_TYPES[n.type].icon} ${esc(n.name)} nation<small>${PERSONALITY[n.type].name} · ${cities} ${cities === 1 ? "city" : "cities"} · ${vehiclesOf(n.id).length} vehicles</small></div><button class="tsClose" aria-label="Close">✕</button></div>
      ${bar((n.relation + 100) / 200, war ? "foe" : "")}
      <p class="tsHint"><b>${state}</b> (${Math.round(n.relation)}). ${esc(PERSONALITY[n.type].blurb)} ${NATION_AI_LINE[n.type]}</p>
      <div class="cvDipFacts"><span><b>§${Math.round(n.money)}</b>treasury</span><span><b>${eco.net >= 0 ? "+" : ""}${eco.net.toFixed(1)}</b>§ / s</span><span><b>${T.geysers.filter((g) => g.owner === n.id).length}</b>spice</span></div>
      <div class="tsBtns cvDip">
        <button class="gift" id="cvGift" ${dis(T.money < DIPLO.giftCost || !n.alive)}>Gift · §${DIPLO.giftCost}</button>
        ${deal ? `<button id="cvEndDeal">End trade agreement</button>` : `<button id="cvDeal" ${dis(!n.alive || war || T.money < DEAL_COST)}>Trade agreement · §${DEAL_COST}</button>`}
        ${ally ? `<button id="cvBreakAlly">End alliance</button>` : `<button id="cvAlly" ${dis(!n.alive || war || T.money < ALLIANCE_COST)}>Alliance · §${ALLIANCE_COST}</button>`}
        ${war ? `<button class="good" id="cvPeace" ${dis(!n.alive || T.money < DIPLO.peaceCost)}>Offer peace · §${DIPLO.peaceCost}</button>` : `<button class="warn" id="cvWar" ${dis(!n.alive || ally)}>Declare war</button>`}
      </div>
      <p class="tsHint">${ally ? "Allies never fight you, take your side in wars, defend your cities and pay more on trade." : deal ? "The agreement pays you both every second while you are at peace." : "A trade agreement pays you both. An alliance needs warm feelings (55+)."}${can("")}</p>
      <h5 class="tsKind">Relations with the other nations</h5><ul class="cvDipList">${others.join("") || "<li>None left.</li>"}</ul>`;
  }
  /** An offer a rival has put to you. */
  function offerHtml() {
    const off = T.offers[0];
    if (!off) return `<div class="tsHead"><b>No offers</b><button class="tsClose" aria-label="Close">✕</button></div><p class="tsHint">Nobody is waiting for an answer.</p>`;
    const n = nationOf(off.from);
    const left = Math.max(0, Math.ceil(off.ttl - off.t));
    const accept = { buyout: `Sell · +§${off.amount}`, tribute: `Pay §${off.amount}`, alliance: "Accept the alliance", deal: "Accept the agreement", peace: "Accept peace" }[off.kind];
    const decline = { buyout: "Keep the city", tribute: "Refuse", alliance: "Decline", deal: "Decline", peace: "Fight on" }[off.kind];
    return `<div class="tsHead"><div>${CITY_TYPES[n.type].icon} ${esc(n.name)} nation<small>${off.kind === "tribute" ? "A demand" : "An offer"} · ${left} s to answer${T.offers.length > 1 ? ` · ${T.offers.length} waiting` : ""}</small></div><button class="tsClose" aria-label="Close">✕</button></div>
      <p class="tsWonText">${esc(off.text)}</p>
      <div class="tsBtns"><button class="good" id="cvAccept" ${dis(off.kind === "tribute" && T.money < off.amount)}>${accept}</button><button id="cvDecline">${decline}</button></div>`;
  }
  /** Where your money comes from and goes. */
  function econHtml() {
    const e = econOf(YOU);
    const row = (label, v, cls = "") => `<li class="${cls}"><span>${label}</span><b>${v >= 0 ? "+" : "−"}§${Math.abs(v).toFixed(1)}/s</b></li>`;
    const em = ownerMods(YOU);
    const cityRows = yourCities().map((c) => {
      const ec = cityEconomy(c, em);
      return `<li><span>${esc(c.name)} <small>${ec.pop}k people · ${ec.riot ? "rioting" : "happiness " + ec.happiness}</small></span><b>${ec.income - ec.upkeep >= 0 ? "+" : "−"}§${Math.abs(ec.income - ec.upkeep).toFixed(1)}/s</b></li>`;
    });
    const buildingsUp = yourCities().reduce((sum, c) => sum + upkeepOf(c), 0);
    const geysers = T.geysers.filter((g) => g.owner === YOU);
    return `<div class="tsHead"><b>§ Economy</b><button class="tsClose" aria-label="Close">✕</button></div>
      <p class="tsHint">You have <b>§${Math.floor(T.money)}</b> and earn <b>${e.net >= 0 ? "+" : "−"}§${Math.abs(e.net).toFixed(1)}</b> a second.</p>
      <ul class="cvEcon">
        ${row("Cities (people and factories)", e.cities)}
        ${row(`Spice (${geysers.length} derrick${geysers.length === 1 ? "" : "s"})`, e.spice)}
        ${row("Trade routes", e.trade)}
        ${row("Trade agreements", e.deals)}
        ${row("Upkeep: buildings and turrets", -buildingsUp, "cost")}
        ${row(`Upkeep: ${vehiclesOf(YOU).length} vehicles`, -(vehiclesOf(YOU).length * VEHICLE_UPKEEP), "cost")}
      </ul>
      <h5 class="tsKind">Your cities</h5><ul class="cvEcon">${cityRows.join("")}</ul>
      <p class="tsHint">Spice is the richest income: each derrick pays by its richness, and rivals will fight for them. Factories earn but upset people, so balance them with entertainment; better buildings and a bigger hall earn more but cost more to keep.</p>`;
  }
  function designsHtml() {
    const row = (kind, key, design, label, sub) => `<button class="tsTradeBtn cvDesign" data-design="${kind}|${key}"><span>${label}</span><b>${esc(design.name)}<small>${esc(sub)}</small></b><em>Edit</em></button>`;
    const buildings = Object.keys(ROLES.building)
      .map((role) => {
        const s = designStats(T.designs.building[role]);
        return row("building", role, T.designs.building[role], ROLE_ICON[role], `${ROLES.building[role].name} · strength ${s.stats.strength}`);
      })
      .join("");
    const owned = new Set(yourCities().map((c) => c.type));
    const vehicles = TYPE_IDS.map((role) =>
      ["land", "sea", "air"]
        .map((mode) => {
          const key = role + ":" + mode;
          const u = vehicleUnit(T.designs.vehicle[key], mods);
          return row("vehicle", key, T.designs.vehicle[key], CITY_TYPES[role].icon + MODE_ICON[mode], `${owned.has(role) ? "" : "(no city of this kind yet) "}speed ${designStats(T.designs.vehicle[key]).stats.speed} · §${u.cost}`);
        })
        .join(""),
    ).join("");
    return `<div class="tsHead"><b>🎨 Designs</b><button class="tsClose" aria-label="Close">✕</button></div>
      <p class="tsHint">Your cities are built from your designs, and your vehicles too. A better design does its job better: more income, stronger turrets, faster or tougher vehicles.</p>
      <h5 class="tsKind">Buildings</h5><div class="tsTrade cvDesigns">${buildings}</div>
      <h5 class="tsKind">Vehicles</h5><div class="tsTrade cvDesigns">${vehicles}</div>`;
  }
  function wonHtml() {
    const card = CIV_CARDS[T.card] || civArchetype(T.captures, T.startType);
    return `<div class="tsHead tsWon"><b>${card.icon} Civilization Stage complete</b><button class="tsClose" aria-label="Close">✕</button></div>
      <p class="tsWonText"><b>One world, one nation.</b> ${esc(card.text)}${T.wonBy === "alliance" ? " You won with your allies at your side: every rival that remained was a friend." : ""}</p>
      <div class="tsStats"><span><b>${T.cities.length}</b>cities</span><span><b>${T.captures.military}</b>by force</span><span><b>${T.captures.economic}</b>bought</span><span><b>${T.captures.religious}</b>converted</span></div>
      <p class="tsHint">Your species earns the <b>${card.name}</b> card. The Space Stage comes next and isn't part of the game yet: keep playing here, or go back to the Tribal Stage.</p>
      <div class="tsBtns"><button class="good" id="cvKeep">Keep playing</button><button id="cvBack">Back to the Tribal Stage</button></div>`;
  }
  function lostHtml() {
    return `<div class="tsHead"><b>Your nation has fallen</b></div>
      <p class="tsWonText">Every one of your cities now flies another flag.</p>
      <div class="tsBtns"><button class="good" id="cvRestart">Start the Civilization Stage again</button><button id="cvBack">Back to the Tribal Stage</button></div>`;
  }
  function helpHtml() {
    return `<div class="tsHead"><b>Civilization Stage · how to play</b><button class="tsClose" aria-label="Close">✕</button></div>
      <ul class="tsHelp">
        <li><b>Look around:</b> drag to slide over the planet, pinch or scroll to zoom (all the way out shows the whole globe), twist two fingers or hold <b>Q</b>/<b>E</b> to turn the map, and use the buttons or the map in the corner to jump. <b>N</b> faces north, <b>G</b> shows the whole planet, <b>H</b> goes home. Tap open ground to learn about it.</li>
        <li><b>Your cities:</b> tap one to build houses (people), factories (money, but unhappy people), entertainment (happiness), temples (faith) and turrets.</li>
        <li><b>Vehicles:</b> each city builds vehicles of its own kind over time (see its production line; factories speed it up). Tap a vehicle, or drag a box (mouse: just drag; touch: switch on the box button) to select several. A command bar appears: <b>Move, Attack, Defend, Follow, Trade/Preach, Capture, Stop</b>. Pick one, then tap its target. Or just tap: a place moves, an enemy is attacked, a spice geyser is captured, a city of yours is defended. On a mouse, right-click does the same.</li>
        <li><b>Take cities</b> three ways: ⚔ military vehicles knock out turrets and then the hall; 💰 economic vehicles trade until you can buy the city; 🕊 religious vehicles preach until it converts. Every city you take makes vehicles of its kind.</li>
        <li><b>Spice:</b> glowing geysers dot the planet (and the map). Send a land or air vehicle to claim one: it pays you every second, richer ones more. Rivals claim them too, and military vehicles can wreck a derrick.</li>
        <li><b>Cities and money:</b> tap a plot to build or improve (three levels, each better and dearer to keep). Plots form a ring: factories beside factories earn more, houses beside entertainment are happier, houses beside factories are not, temples beside houses spread the faith. Expand the hall for more people, turrets and vehicles. Tap your money at the top to see the books: spice and trade pay, buildings and vehicles cost upkeep.</li>
        <li><b>Diplomacy:</b> tap a nation for gifts, trade agreements, alliances, war and peace. Allies never fight you and help in your wars; rivals fight each other too. Offers arrive from the rivals: answer them in time.</li>
        <li><b>Nations:</b> tap a nation at the top for gifts and peace. Military nations go to war with those they hate; religious ones preach; economic ones trade.</li>
        <li><b>Superweapon:</b> hold half the planet's cities and it's yours: one city at a time, the way you've been winning them.</li>
        <li><b>Goal:</b> unite the planet: hold every city, or three quarters of them with every rival either fallen or your ally. Land vehicles cannot cross the sea: other continents need boats or aircraft. How you do it decides your card.</li>
      </ul>
      ${legacy.lines.length ? `<h5 class="tsKind">What your species brings</h5><ul class="tsHelp tsLegacy">${legacy.lines.map((l) => `<li>${l.icon} ${esc(l.text)}</li>`).join("")}</ul>` : ""}`;
  }
  function bindSheet(el) {
    const on = (id, fn) => {
      const b = el.querySelector(id);
      if (b) b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? null : fn());
    };
    el.querySelectorAll("[data-plot]").forEach(
      (b) =>
        (b.onclick = () => {
          const k = Number(b.dataset.plot);
          sheet.plot = sheet.plot === k ? null : k;
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-build]").forEach(
      (b) =>
        (b.onclick = () => {
          const role = b.dataset.build,
            c = sheet.city;
          if (sheet.plot == null || !planBuild(c, sheet.plot, role, YOU)) return toast("Not enough money.");
          o.sfx("build");
          pop(c.x, groundY(c.x, c.z) + 8, c.z, "−§" + BUILD_COST[role], "bad");
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-improve]").forEach(
      (b) =>
        (b.onclick = () => {
          const c = sheet.city;
          if (b.getAttribute("aria-disabled") === "true" || sheet.plot == null) return;
          const cost = improveCost(c.plots[sheet.plot], c.levels[sheet.plot]);
          if (planImprove(c, sheet.plot, YOU)) {
            o.sfx("build");
            pop(c.x, groundY(c.x, c.z) + 8, c.z, "−§" + cost, "bad");
          } else toast("Not enough money.");
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-demolish]").forEach(
      (b) =>
        (b.onclick = () => {
          if (sheet.plot != null && planDemolish(sheet.city, sheet.plot)) o.sfx("click");
          sheet.plot = null;
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-vehicle]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? vehicleRefusal(sheet.city, b.dataset.vehicle) : buyVehicle(sheet.city, b.dataset.vehicle))));
    el.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelQueued(sheet.city, Number(b.dataset.cancel))));
    el.querySelectorAll("[data-design]").forEach((b) => (b.onclick = () => editDesign(...b.dataset.design.split("|"))));
    on("#cvTurret", () => {
      if (planTurret(sheet.city, YOU)) o.sfx("build");
      renderSheet();
    });
    on("#cvHall", () => {
      const c = sheet.city;
      if (planHall(c, YOU)) {
        o.sfx("unlock");
        toast(`${c.name}'s hall grows: more people, a new turret site and a vehicle slot.`, 4);
      }
      renderSheet();
    });
    on("#cvAccept", () => T.offers[0] && resolveOffer(T.offers[0], true));
    on("#cvDecline", () => T.offers[0] && resolveOffer(T.offers[0], false));
    on("#cvFocus", () => rig.flyTo(sheet.city.x, sheet.city.z, 90));
    on("#cvSend", () => {
      orderTo([...T.selected], { type: "city", city: sheet.city });
      closeSheet();
    });
    on("#cvBuy", () => buyCity(sheet.city));
    on("#cvGift", () => {
      const n = sheet.nation;
      T.money -= DIPLO.giftCost;
      react(T.dip, nationIds(), typeOfNation, { kind: "gift", by: YOU, to: n.id });
      o.sfx("gift");
      toast(`The ${n.name} nation thanks you for the gift.`);
      renderSheet();
    });
    on("#cvDeal", () => {
      const n = sheet.nation;
      if (accepts(T.dip, n, "deal", Math.random())) {
        T.money -= DEAL_COST;
        makeDeal(T.dip, YOU, n.id);
        o.sfx("unlock");
        toast(`Trade agreement with the ${n.name} nation: it pays you both.`);
        chronicle({ key: "civ:deal:" + n.id, stage: "civ", icon: "💰", text: `Signed a trade agreement with the ${n.name} nation.` });
      } else toast(`The ${n.name} nation is not interested yet: improve relations first.`);
      renderSheet();
    });
    on("#cvEndDeal", () => {
      endDeal(T.dip, YOU, sheet.nation.id);
      renderSheet();
    });
    on("#cvAlly", () => {
      const n = sheet.nation;
      if (!canAlly(T.dip, YOU, n.id)) toast(`The ${n.name} nation does not trust you that far yet: feelings must reach ${Math.round(55)} (now ${Math.round(n.relation)}). Gifts and trade help.`, 4.5);
      else if (accepts(T.dip, n, "alliance", Math.random())) {
        T.money -= ALLIANCE_COST;
        makeAlliance(T.dip, YOU, n.id);
        o.sfx("unlock");
        toast(`You and the ${n.name} nation are allies.`, 4);
        chronicle({ key: "civ:ally:" + n.id, stage: "civ", icon: "🤝", text: `Allied with the ${n.name} nation.` });
        checkWin();
      } else toast(`The ${n.name} nation considers it, but not today.`);
      renderSheet();
    });
    on("#cvBreakAlly", () => {
      endAlliance(T.dip, YOU, sheet.nation.id);
      renderSheet();
    });
    on("#cvWar", () => {
      declareBetween(YOU, sheet.nation.id, "You declared war");
      renderSheet();
    });
    on("#cvPeace", () => {
      const n = sheet.nation;
      if (accepts(T.dip, n, "peace", Math.random())) {
        T.money -= DIPLO.peaceCost;
        makePeace(T.dip, YOU, n.id);
        vehiclesOf(n.id).forEach((v) => (v.order = null));
        vehiclesOf(YOU).forEach((v) => v.order?.type === "vehicle" && (v.order = null));
        o.sfx("unlock");
        toast(`Peace with the ${n.name} nation.`);
        chronicle({ key: "civ:peace:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "🕊", text: "Made peace with the " + n.name + " nation." });
      } else toast(`The ${n.name} nation refuses peace for now.`);
      renderSheet();
    });
    on("#cvKeep", closeSheet);
    on("#cvBack", () => {
      saveState();
      o.onExit();
    });
    on("#cvRestart", () => o.onRestart());
  }
  function vehicleRefusal(c, mode) {
    const u = vehicleUnit(T.designs.vehicle[c.type + ":" + mode], mods);
    if (mode === "sea" && !c.coastal) return toast("This city is inland: only coastal cities build boats.");
    if (mode === "air" && yourCities().length < AIR_AT) return toast(`Aircraft need ${AIR_AT} cities.`);
    toast(tryQueue(c, mode, u).reason || "Not available.");
  }
  const factoriesOf = (c) => c.plots.filter((p) => p === "factory").length;
  const queuedFor = (owner) => T.cities.filter((c) => c.owner === owner).reduce((n, c) => n + c.queue.length, 0);
  /** Check, and for you take the money for, a vehicle to go into a city's production line. */
  function tryQueue(c, mode, unit, owner = YOU) {
    const mine = owner === YOU;
    const have = vehiclesOf(owner).length + queuedFor(owner) - c.queue.length;
    return canQueue({ queued: c.queue.length, have, cap: vehicleCap(owner), money: mine ? T.money : nationOf(owner)?.money ?? 0, cost: unit.cost, valid: unit.ok, perCity: VEHICLES_PER_CITY });
  }
  /** Put a vehicle in a city's production line (paid now); it appears at the city when its time is up. */
  function queueVehicle(c, mode, owner = YOU) {
    const key = c.type + ":" + mode;
    const unit = owner === YOU ? vehicleUnit(T.designs.vehicle[key], mods) : vehicleUnit(vehicleDesign(owner, key));
    if (!tryQueue(c, mode, unit, owner).ok) return false;
    if (owner === YOU) T.money -= unit.cost;
    else nationOf(owner).money -= unit.cost;
    c.queue.push(newItem(key, unit.cost, factoriesOf(c)));
    return true;
  }
  function buyVehicle(c, mode) {
    if (!queueVehicle(c, mode)) return vehicleRefusal(c, mode);
    o.sfx("build");
    const item = c.queue.at(-1);
    toast(`${T.designs.vehicle[item.key].name} is in production at ${c.name}: ${Math.round(item.total)} s.`);
    renderSheet();
  }
  function cancelQueued(c, index) {
    const item = c.queue[index];
    if (!item) return;
    c.queue.splice(index, 1);
    if (c.owner === YOU) T.money += refundOf(item);
    else if (nationOf(c.owner)) nationOf(c.owner).money += refundOf(item);
    o.sfx("click");
    renderSheet();
  }
  /** Production lines work on their first item; a finished vehicle appears at the city (if there is room). */
  function updateProduction(dt) {
    for (const c of T.cities) {
      if (!c.owner || !c.queue.length) continue;
      const room = vehiclesOf(c.owner).length < vehicleCap(c.owner);
      const done = tickQueue(c.queue, dt, room);
      if (!done) continue;
      const v = spawnVehicle(c.owner, done.key, c);
      if (c.owner === YOU) {
        o.sfx("build");
        toast(`${T.designs.vehicle[done.key].name} is ready at ${c.name}.`);
        T.selected.clear();
        T.selected.add(v);
        tipOnce("firstVehicle", "Your new vehicle is selected: pick a command, or tap a place or a city.", 5);
        if (sheet?.city === c) renderSheet();
      }
    }
  }
  function editDesign(kind, key) {
    const current = kind === "building" ? T.designs.building[key] : T.designs.vehicle[key];
    const role = kind === "building" ? key : key.split(":")[0];
    const mode = kind === "vehicle" ? key.split(":")[1] : null;
    closeSheet();
    paused = true;
    hud.hidden = true;
    o.openEditor(kind, current, {
      roles: [role],
      onDone: (design) => {
        paused = false;
        hud.hidden = false;
        if (kind === "building") {
          T.designs.building[role] = design;
          strengths = myStrengths();
          yourCities().forEach(buildCity);
        } else {
          const actual = vehicleMode(design) || mode;
          const newKey = role + ":" + actual;
          if (actual !== mode) toast(`This design ${actual === "air" ? "flies" : actual === "sea" ? "sails" : "drives"}, so it is now your ${MODE_NAME[actual].toLowerCase()} design.`, 4.5);
          T.designs.vehicle[newKey] = design;
          // Vehicles already built keep their health share and take the new design.
          for (const v of vehiclesOf(YOU).filter((x) => x.key === newKey)) refitVehicle(v);
        }
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
  function takeCity(c, owner, method) {
    const from = c.owner;
    // Whatever the old owner had in production is lost with the city (refunded to you if it was yours).
    const refund = c.queue.reduce((sum, i) => sum + refundOf(i), 0);
    transferCity(c, owner, method);
    c.turrets = Math.min(c.turrets, turretSlots(c.hall));
    if (from === YOU) T.money += refund;
    // A city keeps its kind unless taken by force; force makes it a military city of the taker.
    if (method === "military") c.type = "military";
    else if (method === "religious") c.type = "religious";
    else if (method === "economic") c.type = "economic";
    buildCity(c);
    T.vehicles.filter((v) => v.order?.city === c).forEach((v) => (v.order = null));
    if (from) react(T.dip, nationIds(), typeOfNation, { kind: "conquest", by: owner, to: from });
    // A nation that loses its last city falls.
    const fallen = nationOf(from);
    if (fallen && fallen.alive && citiesOf(fallen.id).length === 0) {
      fallen.alive = false;
      vehiclesOf(fallen.id).forEach(removeVehicle);
      for (const k of Object.keys(T.dip.allies)) if (k.split("|").includes(fallen.id)) delete T.dip.allies[k];
      for (const k of Object.keys(T.dip.deals)) if (k.split("|").includes(fallen.id)) delete T.dip.deals[k];
      toast(`The ${fallen.name} nation is no more.`, 4);
      if (owner === YOU) chronicle({ key: "civ:fall:" + fallen.id, stage: "civ", icon: "🏳", text: "Absorbed the last city of the " + fallen.name + " nation." });
    }
    if (owner === YOU) {
      T.captures[method] = (T.captures[method] || 0) + 1;
      o.sfx("unlock");
      toast(`${c.name} is yours! ${method === "military" ? "Taken by force: two buildings were lost and the people are restless." : method === "economic" ? "Bought: everything is intact." : "Converted: its people are devout."}`, 4.5);
      chronicle({ key: "civ:take:" + c.id + ":" + method, stage: "civ", icon: CITY_TYPES[method].icon, text: `${method === "military" ? "Captured" : method === "economic" ? "Bought" : "Converted"} the city of ${c.name}.` });
    } else if (from === YOU) {
      o.sfx("hurt");
      toast(`${c.name} has fallen to the ${ownerName(owner)}.`, 4);
      vehiclesOf(YOU).filter((v) => v.home === c.id).forEach((v) => (v.home = capital().id));
      if (!yourCities().length) {
        T.lost = true;
        openSheet("lost");
      }
      // You may no longer field as many vehicles: the newest ones are lost.
      const extra = vehiclesOf(YOU).length - vehicleCap(YOU);
      if (extra > 0) vehiclesOf(YOU).slice(-extra).forEach(removeVehicle);
    } else if (owner && from) tipOnce("rivalwar:" + owner + from, `The ${ownerName(owner)} took ${c.name} from the ${ownerName(from)}.`, 4);
    checkWin();
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
  const dominanceNow = () => dominance({ total: T.cities.length, yours: yourCities().length, rivals: T.nations.map((n) => ({ alive: n.alive, allied: allied(T.dip, YOU, n.id) })) });
  function checkWin() {
    if (T.won) return;
    const dom = dominanceNow();
    if (!dom.won) return;
    T.won = true;
    const card = civArchetype(T.captures, T.startType);
    T.card = card.id;
    T.wonBy = dom.byAlliance ? "alliance" : "conquest";
    chronicle({ key: "civ:won", stage: "civ", icon: card.icon, text: (dom.byAlliance ? "United the planet with allies as a " : "United the planet as a ") + card.name.toLowerCase() + " nation." });
    o.onWon?.(card);
    saveState();
    setTimeout(() => {
      o.sfx("unlock");
      openSheet("won");
    }, 1800);
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
    if (command) setCommand(command);
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
    pop(c.x, groundY(c.x, c.z) + 12, c.z, s.def.icon + " " + s.def.name, "good");
    takeCity(c, YOU, s.kind);
  }

  /* ---- orders -------------------------------------------------------------------------------------------- */
  /** Can this vehicle get to a map point at all? Land vehicles need a land route, boats need water. */
  function canGet(v, goal, memo) {
    if (v.mode === "air") return true;
    const key = v.mode + ":" + Math.round(v.pos.x / 8) + ":" + Math.round(v.pos.z / 8) + ":" + Math.round(goal.x / 8) + ":" + Math.round(goal.z / 8);
    if (!memo.has(key)) memo.set(key, map.reachable(v.mode, v.pos, goal));
    return memo.get(key);
  }
  function orderTo(list, order) {
    let refused = 0,
      noRoute = 0,
      noSea = 0,
      given = 0;
    const memo = new Map();
    const mine = list.filter((v) => !v.dead && v.owner === YOU);
    // A group sent to one place arrives spread out round it.
    const slots = order.type === "move" && mine.length > 1 ? assignFormation(mine, order, 5) : null;
    for (const v of mine) {
      if (order.type === "city" && !canReach(v.mode, order.city)) {
        refused++;
        continue;
      }
      if (v.mode === "sea" && (order.type === "geyser" || order.type === "defend" && !order.city)) {
        noSea++;
        continue;
      }
      let dest = order;
      if (slots) {
        const sl = slots.get(v);
        if (sl && map.walkable(v.mode, sl.x, sl.z)) dest = sl;
      }
      if (v.mode === "sea" && (order.type === "move" || order.type === "defend") && !map.walkable("sea", dest.x, dest.z)) {
        noSea++;
        continue;
      }
      if (order.type !== "vehicle" && order.type !== "follow" && v.mode !== "air") {
        const goal = order.type === "city" ? (v.mode === "sea" ? order.city.sea : order.city) : dest;
        if (!goal || !canGet(v, goal, memo)) {
          noRoute++;
          continue;
        }
      }
      if (order.type === "follow" && order.target === v) continue;
      v.order = { ...order, x: dest.x, z: dest.z };
      v.path = null;
      v.planT = 0;
      given++;
    }
    if (refused) toast("Boats can only reach cities on the coast.");
    else if (noSea) toast("Boats stay on the water: send land or air vehicles inland.");
    else if (noRoute) toast("No way there by land or sea: it is across the water. Build boats or aircraft.");
    if (given) o.sfx("click");
    flash(order.type === "city" ? order.city : order.type === "follow" ? order.target.pos : order);
    return given;
  }
  const flashGeo = new THREE.RingGeometry(2.6, 3.2, 28).rotateX(-Math.PI / 2);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, depthWrite: false });
  let flashMesh = null,
    flashT = 0;
  function flash(p) {
    if (!flashMesh) {
      flashMesh = new THREE.Mesh(flashGeo, flashMat);
      scene.add(flashMesh);
    }
    placeOnPlanet(map, flashMesh, p.x, p.z, groundY(p.x, p.z) + 0.4);
    flashMesh.scale.setScalar(p.plots ? 5 : 1);
    flashT = 0.6;
  }

  /* ---- camera and input ----------------------------------------------------------------------------- */
  // Drag slides over the planet, pinch or scroll zooms, two fingers (or right-drag) turn it, and every
  // control only moves a target the camera eases toward (see planet-camera.js).
  const groundHit = {};
  function groundAt(px, py) {
    return rig.groundAt(px, py, innerWidth, innerHeight, groundHit) ? { x: groundHit.x, z: groundHit.z } : null;
  }
  // Mouse: left click selects, left drag draws a selection box (shift adds), right click gives the contextual
  // command, middle or Ctrl+left drag slides the map, right drag turns it. Touch: tap selects and orders, one finger
  // slides the map (or draws a box when "box select" is on), two fingers pinch and twist.
  const pointers = new Map();
  let gesture = null,
    boxMode = false;
  const boxEl = $h("#cvBox");
  const setBoxMode = (on) => {
    boxMode = on;
    $h("#cvBoxBtn").setAttribute("aria-pressed", String(on));
    $h("#cvBoxBtn").classList.toggle("on", on);
  };
  const drawBox = (g, x, y) => {
    boxEl.hidden = false;
    boxEl.style.left = Math.min(g.x0, x) + "px";
    boxEl.style.top = Math.min(g.y0, y) + "px";
    boxEl.style.width = Math.abs(x - g.x0) + "px";
    boxEl.style.height = Math.abs(y - g.y0) + "px";
  };
  const onDown = (e) => {
    if (paused || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    rig.holding = true;
    if (pointers.size === 1) {
      const mouse = e.pointerType === "mouse";
      const mode = mouse ? (e.button === 2 ? "turn" : e.button === 1 || e.ctrlKey || e.metaKey ? "pan" : "box") : boxMode ? "box" : "pan";
      gesture = { panned: false, pinch: 0, twist: 0, mode, button: e.button, shift: e.shiftKey, x0: e.clientX, y0: e.clientY };
    } else if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.twist = Math.atan2(b.y - a.y, b.x - a.x);
      gesture.panned = true;
      gesture.mode = "pan";
      boxEl.hidden = true;
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
      if (gesture.pinch > 0 && d > 0) rig.zoom(gesture.pinch / d);
      gesture.pinch = d;
      // Twisting turns the map; both fingers moving together slide it.
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      let da = ang - gesture.twist;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > 0.003) rig.rotate(da);
      gesture.twist = ang;
      rig.pan(dx * 0.5, dy * 0.5, innerHeight);
      return;
    }
    if (!gesture.panned && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < (gesture.mode === "box" ? 7 : 10)) return;
    gesture.panned = true;
    if (gesture.mode === "box") drawBox(gesture, e.clientX, e.clientY);
    else if (gesture.mode === "turn") rig.rotate(dx * 0.006);
    else rig.pan(dx, dy, innerHeight);
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!pointers.size) rig.holding = false;
    if (!p || !gesture) return;
    if (pointers.size === 0) {
      const g = gesture;
      gesture = null;
      boxEl.hidden = true;
      if (e.type !== "pointerup") return;
      if (g.panned && g.mode === "box") {
        const inside = unitsInRect(vehiclesOf(YOU), { x0: g.x0, y0: g.y0, x1: e.clientX, y1: e.clientY }, (v) => project(v.pos.x, v.y + 1.5, v.pos.z));
        if (!g.shift) T.selected.clear();
        inside.forEach((v) => T.selected.add(v));
        if (inside.length) o.sfx("click");
        renderCmd();
      } else if (!g.panned) {
        if (g.mode === "turn") rightClick(e.clientX, e.clientY);
        else tap(e.clientX, e.clientY);
      }
    }
  };
  const aimVec = new THREE.Vector3();
  const onWheel = (e) => {
    if (paused || e.target !== canvas) return;
    e.preventDefault();
    // Zooming in drifts the view toward whatever is under the cursor, so you can zoom into a place.
    const g = e.deltaY < 0 ? groundAt(e.clientX, e.clientY) : null;
    let towards = null;
    if (g) {
      const { lon, lat } = mapToLonLat(g.x, g.z);
      towards = aimVec.set(...unitVector(lon, lat));
    }
    rig.zoom(Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0012), towards);
  };
  const keys = new Set();
  const onKey = (e) => {
    if (paused || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) return;
    if (e.key === "Escape") {
      if (T.targeting) stopTargeting();
      else if (command) setCommand(command);
      else if (sheet) closeSheet();
      else if (!$h("#cvRegion").hidden) closeRegion();
      else T.selected.clear();
      return;
    }
    if (e.key.toLowerCase() === "a" && e.ctrlKey) {
      e.preventDefault();
      selectAll();
      return;
    }
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "b") setBoxMode(!boxMode);
    else if ((k === "delete" || k === "backspace") && selectedVehicles().length) executeCommand("stop", null);
    else if (k === "n") rig.north();
    else if (k === "g") toggleGlobe();
    else if (k === "h" || k === "home") goCapital();
    else if (k === "+" || k === "=") rig.zoom(0.8);
    else if (k === "-" || k === "_") rig.zoom(1.25);
    keys.add(k);
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
  let lastZoom = 125;
  function toggleGlobe() {
    if (rig.target.dist > ZOOM.region * 1.6) rig.setDistance(lastZoom > ZOOM.region ? ZOOM.city + 30 : lastZoom);
    else {
      lastZoom = rig.target.dist;
      rig.globe();
    }
  }
  function goCapital() {
    const c = capital();
    rig.flyTo(c.x, c.z, Math.min(rig.target.dist, 150));
  }

  const selectedVehicles = () => [...T.selected].filter((v) => !v.dead && v.owner === YOU);
  function selectAll() {
    T.selected = new Set(vehiclesOf(YOU));
    o.sfx("click");
  }
  /** What is under a screen point: a vehicle, a city or a geyser (the nearest on screen), or the ground. */
  function pick(sx, sy) {
    let best = null,
      bestD = 34;
    for (const v of T.vehicles) {
      if (v.dead) continue;
      const p = project(v.pos.x, v.y + 1.5, v.pos.z);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (p.on && d < bestD) (best = { type: "vehicle", v }), (bestD = d);
    }
    if (best) return best;
    const g = groundAt(sx, sy);
    for (const c of T.cities) {
      const p = project(c.x, groundY(c.x, c.z) + 4, c.z);
      const near = g && Math.hypot(g.x - c.x, g.z - c.z) < 17;
      if ((p.on && Math.hypot(p.x - sx, p.y - sy) < 46) || near) return { type: "city", c };
    }
    for (const gz of T.geysers) if (g && Math.hypot(g.x - gz.x, g.z - gz.z) < 7) return { type: "geyser", gz };
    return g ? { type: "ground", at: g } : null;
  }
  /** A pick result as the RTS rules see it. */
  const targetOf = (hit) =>
    hit.type === "vehicle" ? { kind: "vehicle", own: hit.v.owner === YOU } : hit.type === "city" ? { kind: "city", own: hit.c.owner === YOU } : hit.type === "geyser" ? { kind: "geyser", own: hit.gz.owner === YOU } : { kind: "ground" };
  const posOf = (hit) => (hit.type === "vehicle" ? hit.v.pos : hit.type === "city" ? hit.c : hit.type === "geyser" ? hit.gz : hit.at);

  /** Carry out a command on what was tapped. Returns false (with a message) if the tap does not suit the command. */
  function executeCommand(id, hit) {
    const sel = selectedVehicles();
    if (!sel.length) return toast("Select a vehicle first."), false;
    const ok = (units) => units.length || (toast(COMMANDS[id].hint), false);
    switch (id) {
      case "stop":
        sel.forEach((v) => ((v.order = null), (v.path = null)));
        o.sfx("click");
        return true;
      case "move":
        return orderTo(sel, { type: "move", x: posOf(hit).x, z: posOf(hit).z }) > 0;
      case "attack": {
        const mil = sel.filter((v) => v.role === "military");
        if (!ok(mil)) return false;
        if (hit.type === "vehicle" && hit.v.owner !== YOU) {
          declareOn(hit.v.owner, "Your vehicles attacked theirs");
          return orderTo(mil, { type: "vehicle", target: hit.v, x: hit.v.pos.x, z: hit.v.pos.z }) > 0;
        }
        if (hit.type === "city" && hit.c.owner !== YOU) return orderTo(mil, { type: "city", city: hit.c }) > 0;
        return toast("Attack: tap an enemy vehicle or a city that is not yours."), false;
      }
      case "defend": {
        const mil = sel.filter((v) => v.role === "military");
        if (!ok(mil)) return false;
        if (hit.type === "city" && hit.c.owner === YOU) return orderTo(mil, { type: "defend", city: hit.c, x: hit.c.x, z: hit.c.z, r: 40 }) > 0;
        if (hit.type === "ground") return orderTo(mil, { type: "defend", x: hit.at.x, z: hit.at.z, r: 30 }) > 0;
        return toast("Defend: tap one of your cities, or open ground."), false;
      }
      case "follow":
        if (hit.type === "vehicle" && hit.v.owner === YOU) return orderTo(sel, { type: "follow", target: hit.v, x: hit.v.pos.x, z: hit.v.pos.z }) > 0;
        return toast("Follow: tap one of your own vehicles."), false;
      case "trade": {
        const act = sel.filter((v) => v.role !== "military");
        if (!ok(act)) return false;
        if (hit.type === "city" && hit.c.owner !== YOU) return orderTo(act, { type: "city", city: hit.c }) > 0;
        return toast("Tap a city that is not yours: traders trade and missionaries preach."), false;
      }
      case "capture": {
        const walkers = sel.filter((v) => v.mode !== "sea");
        if (!ok(walkers)) return false;
        if (hit.type === "geyser") return orderTo(walkers, { type: "geyser", geyser: hit.gz, x: hit.gz.x, z: hit.gz.z }) > 0;
        return toast("Capture: tap a spice geyser."), false;
      }
    }
    return false;
  }
  /** The command a plain tap or right-click means for what is under it. */
  function contextOrder(hit) {
    const sel = selectedVehicles();
    const c = contextCommand(sel, targetOf(hit));
    if (c.id === "none") return toast(c.reason), false;
    if (c.id === "interact") return openSheet("city", { city: hit.c }), true;
    if (c.id === "city") return orderTo(sel, { type: "city", city: hit.c }) > 0;
    return executeCommand(c.id, hit);
  }
  let command = null;
  function setCommand(id) {
    command = command === id ? null : id;
    if (id === "stop") {
      command = null;
      executeCommand("stop", null);
    }
    const banner = $h("#cvTarget");
    if (command) {
      banner.hidden = false;
      $h("#cvTargetText").textContent = `${COMMANDS[command].label}: ${COMMANDS[command].hint}`;
    } else if (!T.targeting) banner.hidden = true;
    renderCmd();
  }
  function tap(sx, sy) {
    $h("#cvMenuPanel").hidden = true;
    const hit = pick(sx, sy);
    if (T.targeting) {
      if (hit?.type === "city") fireSuper(hit.c);
      return;
    }
    if (!hit) return;
    if (command) {
      const id = command;
      if (executeCommand(id, hit)) setCommand(id);
      return;
    }
    const sel = selectedVehicles();
    if (hit.type === "vehicle" && hit.v.owner === YOU) {
      if (T.selected.has(hit.v)) T.selected.delete(hit.v);
      else T.selected.add(hit.v);
      o.sfx("click");
      renderCmd();
      return;
    }
    if (hit.type === "vehicle") {
      if (sel.some((v) => v.role === "military")) contextOrder(hit);
      else toast(`A ${CITY_TYPES[hit.v.role].name.toLowerCase()} vehicle of the ${ownerName(hit.v.owner)}.`);
      return;
    }
    if (hit.type === "city") {
      if (sel.length && !(hit.c.owner === YOU && sheet?.city === hit.c)) contextOrder(hit);
      else openSheet("city", { city: hit.c });
      return;
    }
    if (hit.type === "geyser") {
      if (sel.length) return contextOrder(hit);
      return toast(hit.gz.owner === YOU ? `Your spice derrick: it pays you §${(SPICE_INCOME * hit.gz.yield).toFixed(1)} a second.` : hit.gz.owner ? `A spice derrick of the ${ownerName(hit.gz.owner)}. Military vehicles can wreck it.` : `A spice geyser (richness ${hit.gz.yield.toFixed(2)}). Send any land or air vehicle here to claim it.`);
    }
    if (sel.length) contextOrder(hit);
    else {
      if (sheet) closeSheet();
      inspect(hit.at);
    }
  }
  /** The right mouse button: do the sensible thing for what is under the cursor. */
  function rightClick(sx, sy) {
    const hit = pick(sx, sy);
    if (!hit) return;
    command = null;
    $h("#cvTarget").hidden = !T.targeting;
    if (!selectedVehicles().length) return toast("Select a vehicle first (click it, or drag a box).");
    contextOrder(hit);
    renderCmd();
  }

  /* ---- the command bar and selection panel ----------------------------------------------------------- */
  const CMD_ICON = {
    move: '<path d="M12 4v16M12 4l-5 5M12 4l5 5"/>',
    attack: '<circle cx="12" cy="12" r="6"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
    defend: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/>',
    follow: '<circle cx="8" cy="15" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M10 13.5l4-3"/>',
    trade: '<path d="M5 9h13l-3-3M19 15H6l3 3"/>',
    capture: '<path d="M7 21V4M7 5h11l-2.5 4 2.5 4H7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  };
  const orderText = (v) => {
    const od = v.order;
    if (!od) return "Idle";
    if (od.type === "city") return v.role === "military" ? `Attacking ${od.city.name}` : v.role === "economic" ? `Trading with ${od.city.name}` : `Preaching in ${od.city.name}`;
    if (od.type === "defend") return od.city ? `Defending ${od.city.name}` : "Defending a position";
    return { move: "Moving", geyser: "Capturing spice", vehicle: "Attacking a vehicle", follow: "Following" }[od.type] || "Busy";
  };
  const statLine = (u) => `Speed ${u.speed}` + (u.weapon ? ` · Damage ${u.dps}/s · Range ${u.weapon.range} m` : u.trade ? ` · Trade ${u.trade}` : u.preach ? ` · Preaching ${u.preach}` : "");
  let cmdHtml = "";
  function renderCmd() {
    const sel = selectedVehicles();
    const box = $h("#cvCmd");
    box.hidden = !sel.length;
    hud.style.setProperty("--cvC", sel.length ? box.offsetHeight + 8 + "px" : "0px");
    if (!sel.length) {
      cmdHtml = "";
      return;
    }
    let info;
    if (sel.length === 1) {
      const v = sel[0];
      info = `<div class="cvSelHead"><span class="noPic">${MODE_ICON[v.mode]}</span><div><b>${esc(vehicleDesign(YOU, v.key).name)}</b><small>${CITY_TYPES[v.role].name} · ${MODE_NAME[v.mode]} · ${orderText(v)}</small></div><em>${Math.ceil(v.hp)}/${v.unit.hp}</em></div>${bar(v.hp / v.unit.hp, v.hp / v.unit.hp < 0.35 ? "foe" : "hp")}<small class="cvStats">${statLine(v.unit)}</small>`;
    } else {
      const roles = TYPE_IDS.map((r) => [r, sel.filter((v) => v.role === r).length]).filter(([, n]) => n);
      const hp = sel.reduce((a, v) => a + v.hp, 0) / sel.reduce((a, v) => a + v.unit.hp, 0);
      info = `<div class="cvSelHead"><div><b>${sel.length} vehicles</b><small>${roles.map(([r, n]) => `${n} ${CITY_TYPES[r].name.toLowerCase()}`).join(" · ")}</small></div><em>${Math.round(hp * 100)}%</em></div>${bar(hp, hp < 0.35 ? "foe" : "hp")}<small class="cvStats">Slowest: speed ${Math.min(...sel.map((v) => v.unit.speed))}</small>`;
    }
    const cmds = availableCommands(sel)
      .map((c) => `<button data-cmd="${c.id}" class="${command === c.id ? "on" : ""}" aria-pressed="${command === c.id}" aria-disabled="${!c.enabled}" title="${esc(c.enabled ? c.hint : c.why)}" aria-label="${esc(c.label)}: ${esc(c.enabled ? c.hint : c.why)}"><svg viewBox="0 0 24 24" aria-hidden="true">${CMD_ICON[c.id]}</svg><small>${esc(c.label)}</small></button>`)
      .join("");
    const html = info + "|" + cmds;
    if (html === cmdHtml) return;
    cmdHtml = html;
    $h("#cvSelInfo").innerHTML = withIcons(info);
    const row = $h("#cvCmdRow");
    row.innerHTML = cmds;
    row.querySelectorAll("[data-cmd]").forEach((b) => {
      b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? toast(b.title) : setCommand(b.dataset.cmd));
    });
    hud.style.setProperty("--cvC", box.offsetHeight + 8 + "px");
  }

  /** War between two nations (you are YOU). Allies take sides; feelings plunge; the history records it if you are involved. */
  function declareBetween(a, b, why) {
    if (cannotDeclare(T.dip, a, b)) return false;
    declareWar(T.dip, a, b);
    for (const j of joiners(T.dip, nationIds(), a, b)) {
      if (!cannotDeclare(T.dip, j.id, j.against)) declareWar(T.dip, j.id, j.against);
    }
    const nA = nationOf(a),
      nB = nationOf(b);
    if (a === YOU || b === YOU) {
      const n = a === YOU ? nB : nA;
      toast(a === YOU ? `War with the ${n.name} nation! ${why}.` : `The ${n.name} nation has declared war on you!`, 4.5);
      chronicle({ key: "civ:war:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: a === YOU ? "Went to war with the " + n.name + " nation." : "The " + n.name + " nation declared war." });
      o.sfx("roar");
    } else tipOnce("war:" + pairKey(a, b), `The ${nA.name} and ${nB.name} nations are at war.`, 4);
    return true;
  }
  function declareOn(owner, why) {
    if (!nationOf(owner)) return;
    declareBetween(YOU, owner, why);
  }

  /* ---- vehicle behaviour --------------------------------------------------------------------------- */
  function placeVehicle(v, dt) {
    v.bob += dt;
    const gh = groundY(v.pos.x, v.pos.z);
    if (v.mode === "air") v.y = gh + 13 + Math.sin(v.bob * 1.4) * 0.4;
    else if (v.mode === "sea") v.y = Math.sin(v.bob * 1.8) * 0.12;
    else v.y = gh;
    placeOnPlanet(map, v.group, v.pos.x, v.pos.z, v.y, 0);
    v.model.root.rotation.y = v.heading;
    v.ring.position.y = v.mode === "air" ? gh - v.y + 0.3 : 0.3;
    v.ring.visible = T.selected.has(v) && !v.far;
  }
  /**
   * Move toward a point along a route that suits the vehicle: land vehicles keep to land and round
   * mountains and lakes, boats to the sea and round the coast, aircraft fly straight. Routes are planned
   * on the planet map (and replanned if the goal moves). Returns the distance left; sets v.unreachable
   * when there is no way.
   */
  function drive(v, x, z, dt, stop = 1) {
    const d = Math.hypot(x - v.pos.x, z - v.pos.z);
    v.unreachable = false;
    if (d <= stop) return d;
    let tx = x,
      tz = z;
    if (v.mode !== "air") {
      v.planT -= dt;
      const moved = !v.pathGoal || Math.hypot(v.pathGoal.x - x, v.pathGoal.z - z) > 14;
      if ((!v.path || moved) && v.planT <= 0) {
        v.planT = 1.5;
        v.pathGoal = { x, z };
        v.path = map.findPath(v.mode, v.pos, { x, z });
        v.pathFail = !v.path;
      }
      if (v.pathFail && !moved) {
        v.unreachable = true;
        return d;
      }
      if (v.path) {
        while (v.path.length > 1 && Math.hypot(v.path[0].x - v.pos.x, v.path[0].z - v.pos.z) < 3.5) v.path.shift();
        tx = v.path[0].x;
        tz = v.path[0].z;
      }
    }
    const dl = Math.hypot(tx - v.pos.x, tz - v.pos.z) || 1;
    const dir = { x: (tx - v.pos.x) / dl, z: (tz - v.pos.z) / dl };
    const step = Math.min(Math.max(0, d - stop) + 0.01, v.unit.speed * dt);
    let nx = v.pos.x + dir.x * step,
      nz = v.pos.z + dir.z * step;
    if (v.mode !== "air" && !map.walkable(v.mode, nx, nz)) {
      // Something is in the way: slide round it, or wait for a new route.
      let free = false;
      for (const a of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
        const ca = Math.cos(a),
          sa = Math.sin(a);
        const px = v.pos.x + (dir.x * ca - dir.z * sa) * step,
          pz = v.pos.z + (dir.x * sa + dir.z * ca) * step;
        if (map.walkable(v.mode, px, pz)) {
          nx = px;
          nz = pz;
          free = true;
          break;
        }
      }
      if (!free) {
        nx = v.pos.x;
        nz = v.pos.z;
        v.path = null;
        v.planT = Math.min(v.planT, 0.3);
      }
    }
    const c = clampToMap(nx, nz, v.mode === "air" ? 8 : 12);
    if (Math.hypot(c.x - v.pos.x, c.z - v.pos.z) > 1e-4) v.heading = Math.atan2(c.x - v.pos.x, c.z - v.pos.z);
    v.pos.x = c.x;
    v.pos.z = c.z;
    return Math.hypot(x - v.pos.x, z - v.pos.z);
  }
  const hostile = (a, b) => !!a && !!b && a !== b && atWar(T.dip, a, b);
  function hurtVehicle(v, dmg, by) {
    v.hp -= dmg;
    v.hurtT = 1.2;
    if (v.hp > 0) return;
    fx.explode(W(v.pos.x, v.y + 1, v.pos.z), 3.4);
    if (v.owner === YOU) toast("A vehicle was destroyed.");
    else if (by === YOU) o.sfx("roar", { gain: 0.3 });
    removeVehicle(v);
  }
  const weaponRange = (v) => v.unit.weapon?.range ?? 12;
  const armed = (v) => v.role === "military" && !!v.unit.weapon;
  const lookAt = (v, p) => {
    if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) > 0.5) v.heading = Math.atan2(p.x - v.pos.x, p.z - v.pos.z);
  };
  /**
   * Fire at a vehicle or a city when the weapon is ready: a projectile flies there (kind, speed and range come
   * from the weapon parts) and does its damage on arrival, unless it misses a moving vehicle.
   */
  function fireAt(v, target, dt) {
    v.fireCool = (v.fireCool || 0) - dt;
    if (v.fireCool > 0) return false;
    const w = v.unit.weapon;
    v.fireCool = 1 / w.rate;
    const dmg = shotDamage(v.unit.dps, w.rate);
    const city = !!target.plots;
    let last = city ? null : W(target.pos.x, target.y + 1.2, target.pos.z);
    const where = city
      ? () => W(target.x, groundY(target.x, target.z) + 4, target.z)
      : () => {
          if (!target.dead) last = W(target.pos.x, target.y + 1.2, target.pos.z);
          return last;
        };
    const at = city ? target : target.pos;
    lookAt(v, at);
    const miss = !city && Math.random() < (target.mode === "air" ? 0.25 : 0.12);
    fx.fire(
      W(v.pos.x, v.y + 1.5, v.pos.z),
      where,
      w.kind,
      () => {
        if (city) {
          if (target.owner === v.owner) return;
          const r = damageCity(target, dmg, cityDefence(target, target.owner === YOU ? strengths : {}));
          if (r.captured) takeCity(target, v.owner, "military");
        } else if (!target.dead) hurtVehicle(target, dmg, v.owner);
      },
      { miss },
    );
    return true;
  }
  /** Armed vehicles keep watch: they notice hostiles at about twice their weapon range and shoot whatever is within it. */
  function autoFire(v, dt) {
    const w = weaponRange(v);
    v.autoT = (v.autoT || 0) - dt;
    if (v.autoT <= 0) {
      v.autoT = 0.45;
      v.target = pickTarget(v, T.vehicles.filter((u) => !u.dead && hostile(v.owner, u.owner)), w * 2.2);
    }
    if (v.target && (v.target.dead || distXZ(v.pos, v.target.pos) > w * 2.6)) v.target = null;
    if (v.target && distXZ(v.pos, v.target.pos) <= w * 1.15) fireAt(v, v.target, dt);
    return v.target;
  }
  function actAt(v, c, dt) {
    const at = W(v.pos.x, v.y + 1.5, v.pos.z),
      to = W(c.x, groundY(c.x, c.z) + 4, c.z);
    if (v.role === "military") {
      if (v.owner === YOU) declareOn(c.owner, `You attacked ${c.name}`);
      else if (c.owner === YOU) {
        const n = nationOf(v.owner);
        if (n && !n.war) return void (v.order = null);
      }
      fireAt(v, c, dt);
    } else if (v.role === "religious") {
      const faith = cityEconomy(c, ownerMods(c.owner)).faith;
      const done = preachTo(c, v.owner, preachRate(v.unit.preach, faith) * dt);
      if (c.owner) react(T.dip, nationIds(), typeOfNation, { kind: "preach", by: v.owner, to: c.owner, dt });
      if ((v.cool -= dt) <= 0) {
        v.cool = 1.1;
        shot(at, to, "faith");
      }
      if (done) takeCity(c, v.owner, "religious");
    } else {
      const res = deliverTrade(c, v.owner, (v.unit.trade / 6) * dt);
      if (c.owner && c.owner !== v.owner) react(T.dip, nationIds(), typeOfNation, { kind: "trade", by: v.owner, to: c.owner, dt });
      if ((v.cool -= dt) <= 0) {
        v.cool = 1.4;
        shot(at, to, "trade");
      }
      if (res.newRoute && v.owner === YOU) toast(`Trade route open with ${c.name}: it pays you both.`);
      if (res.complete) {
        if (v.owner === YOU) {
          if (!v.toldBuy) toast(`Trade with ${c.name} is complete: tap it to buy it.`, 4);
          v.toldBuy = true;
          v.order = null;
        } else {
          // A rival merchant's trade is complete: its planner decides whether to buy (see ai.js), at a price that rises with its holdings.
          v.order = null;
        }
      }
    }
  }
  function updateVehicle(v, dt) {
    const ord = v.order;
    const w = armed(v) ? weaponRange(v) : 0;
    // Keep apart from neighbours of the same kind, so a group does not pile onto one spot.
    v.push = separation(v, T.vehicles.filter((u) => !u.dead && u.mode === v.mode && Math.abs(u.pos.x - v.pos.x) < 4 && Math.abs(u.pos.z - v.pos.z) < 4));
    // An explicit attack: close to weapon range, then fire until the target falls.
    if (armed(v) && ord?.type === "vehicle") {
      const t = ord.target;
      if (t.dead) v.order = null;
      else {
        const d = distXZ(v.pos, t.pos);
        if (d > w * 0.9) {
          drive(v, t.pos.x, t.pos.z, dt, w * 0.75);
          if (v.unreachable) v.order = null;
        }
        if (d <= w) fireAt(v, t, dt);
        v.target = t;
        return;
      }
    }
    const foe = armed(v) ? autoFire(v, dt) : null;
    // Follow: stay close to a friendly vehicle.
    if (ord?.type === "follow") {
      const t = ord.target;
      if (!t || t.dead) v.order = null;
      else {
        if (distXZ(v.pos, t.pos) > 9) drive(v, t.pos.x, t.pos.z, dt, 6);
        return;
      }
    }
    // Defend: hold a place; hostile vehicles that come near are met and shot, then back to the post.
    if (ord?.type === "defend") {
      const hold = ord.city || ord;
      const radius = ord.r || 36;
      let threat = foe;
      if (!threat && armed(v)) threat = pickTarget(v, T.vehicles.filter((u) => !u.dead && hostile(v.owner, u.owner)), radius + w);
      if (threat && distXZ(threat.pos, hold) < radius + w) {
        if (distXZ(v.pos, threat.pos) > w * 0.8) drive(v, threat.pos.x, threat.pos.z, dt, w * 0.7);
        return;
      }
      if (distXZ(v.pos, hold) > 12) drive(v, hold.x, hold.z + (ord.city ? 18 : 0), dt, 8);
      return;
    }
    if (ord?.type === "city") {
      const c = ord.city;
      if (c.owner === v.owner) return void (v.order = null);
      const goal = v.mode === "sea" ? c.sea || c : c;
      const stand = armed(v) ? Math.max(9, Math.min(w - 1, 22)) : RANGE[v.mode] + 3;
      const left = drive(v, goal.x, goal.z, dt, v.mode === "sea" ? 0 : stand);
      if (v.unreachable) {
        v.order = null;
        if (v.owner === YOU) toast(`There is no way through to ${c.name}.`);
        return;
      }
      const inRange = v.mode === "sea" ? left <= RANGE.sea + 0.5 : left <= stand + 0.5;
      if (inRange) actAt(v, c, dt);
      return;
    }
    if (ord?.type === "move" || ord?.type === "geyser") {
      const left = drive(v, ord.x, ord.z, dt, ord.type === "geyser" ? 3 : 2);
      if (v.unreachable) {
        v.order = null;
        if (v.owner === YOU) toast("There is no way through to there.");
      } else if (left <= (ord.type === "geyser" ? 3.2 : 2.2)) {
        if (ord.type === "geyser") claimGeyser(ord.geyser, v, dt);
        else v.order = null;
      }
      return;
    }
    // Idle. Armed vehicles step up to meet a hostile that comes near (never far from home); then park, and claim free spice close by.
    const home = T.cities[v.home] || capital();
    if (foe && distXZ(v.pos, foe.pos) > w * 0.8 && distXZ(v.pos, home) < 45) return void drive(v, foe.pos.x, foe.pos.z, dt, w * 0.7);
    if (foe) return;
    const free = T.geysers.find((g) => !g.owner && distXZ(g, v.pos) < 40 && canClaim(v, g));
    if (free) v.order = { type: "geyser", geyser: free, x: free.x, z: free.z };
    else if (distXZ(v.pos, home) > 30) drive(v, v.mode === "sea" ? home.sea?.x ?? home.x : home.x, v.mode === "sea" ? home.sea?.z ?? home.z : home.z + 20, dt, 18);
  }
  /** Can this kind of vehicle reach a geyser? Boats cannot (spice lies inland); land vehicles need to be on its continent. */
  function canClaim(v, g) {
    if (v.mode === "sea") return false;
    if (v.mode === "air") return true;
    return map.continentAt(v.pos.x, v.pos.z) === g.continent;
  }
  function claimGeyser(g, v, dt) {
    if (g.owner === v.owner) return void (v.order = null);
    if (g.owner) {
      // A rival's derrick: only military vehicles can wreck it, and only rivals you're at war with (or you).
      if (v.role !== "military") return void (v.order = null);
      if (v.owner === YOU) declareOn(g.owner, "You attacked their derrick");
      g.hp -= (v.unit.dps * dt) / 40;
      if (g.hp <= 0) {
        g.owner = null;
        g.hp = 1;
        buildGeyser(g);
        pop(g.x, groundY(g.x, g.z) + 6, g.z, "💥");
      }
      return;
    }
    g.owner = v.owner;
    g.hp = 1;
    buildGeyser(g);
    v.order = null;
    if (v.owner === YOU) {
      o.sfx("unlock");
      pop(g.x, groundY(g.x, g.z) + 7, g.z, "+ spice", "good");
      tipOnce("spice", `Spice! This derrick pays you §${(SPICE_INCOME * g.yield).toFixed(1)} a second: richer geysers pay more.`);
      chronicle({ key: "civ:spice:first", stage: "civ", icon: "🌶", text: "Claimed the first spice geyser." });
    }
  }
  function updateTurrets(dt) {
    for (const c of T.cities) {
      repairCity(c, dt);
      calmUnrest(c, dt);
      // Conversion fades while nobody is preaching.
      for (const k of Object.keys(c.conv)) {
        if (T.vehicles.some((v) => v.owner === k && !v.dead && v.order?.city === c && v.role === "religious" && distXZ(v.mode === "sea" && c.sea ? c.sea : c, v.pos) < 20)) continue;
        // The owner's missionaries at home answer a rival faith: conversion fades four times as fast.
        const guarded = c.owner && T.vehicles.some((v) => !v.dead && v.owner === c.owner && v.role === "religious" && distXZ(v, c) < 30);
        c.conv[k] = Math.max(0, c.conv[k] - (guarded ? 2.4 : 0.6) * dt);
        if (!c.conv[k]) delete c.conv[k];
      }
      if (!c.turrets || c.turretHp <= 0) continue;
      const def = cityDefence(c, c.owner === YOU ? strengths : {});
      // Defenders fire at hostile military vehicles, and at any vehicle of a nation at war with them.
      let target = null,
        bd = Infinity;
      for (const v of T.vehicles) {
        if (v.dead || v.owner === c.owner) continue;
        const d = distXZ(v.pos, c);
        const attacking = v.order?.city === c;
        const range = attacking ? Math.max(TURRET_RANGE, d + 1) : TURRET_RANGE;
        if (d > range) continue;
        const atWar = c.owner === null ? v.role === "military" && attacking : hostile(c.owner, v.owner) || (v.role === "military" && attacking);
        if (atWar && d < bd) (target = v), (bd = d);
      }
      if (!target) continue;
      c.shotCool = (c.shotCool || 0) - dt;
      if (c.shotCool <= 0) {
        c.shotCool = 0.9;
        const k = Math.floor(Math.random() * c.turrets),
          t = turretSpot(c, k);
        const dmg = def.dps * c.turretHp * 0.9 * 0.6,
          tg = target;
        let last = W(tg.pos.x, tg.y + 1, tg.pos.z);
        fx.fire(
          W(t.x, groundY(t.x, t.z) + 5, t.z),
          () => {
            if (!tg.dead) last = W(tg.pos.x, tg.y + 1, tg.pos.z);
            return last;
          },
          "shell",
          () => !tg.dead && hurtVehicle(tg, dmg, c.owner),
        );
      }
    }
  }

  /* ---- rival nations ---------------------------------------------------------------------------------- */
  /* What is being done to a city: raiders at its gates or a faith winning over its people. */
  function threatOf(c) {
    if (!c.owner) return null;
    const raided = T.vehicles.some((v) => !v.dead && v.role === "military" && v.order?.city === c && hostile(c.owner, v.owner) && distXZ(v.pos, c) < 80);
    if (raided) return "military";
    const conv = Math.max(0, ...Object.entries(c.conv || {}).filter(([k]) => k !== c.owner).map(([, v]) => v));
    return conv > 25 ? "religious" : null;
  }
  /** What the rivals' planners see: every city, every nation's strength, the diplomatic state. */
  function aiWorld() {
    const cities = T.cities.map((c) => ({ id: c.id, owner: c.owner, type: c.type, plots: c.plots, turrets: c.turrets, hall: c.hall, hallHp: c.hallHp, turretHp: c.turretHp, faith: cityEconomy(c, {}).faith, devout: c.devout, coastal: c.coastal, continent: c.continent, trade: c.trade, conv: c.conv, queue: c.queue.length, threatened: threatOf(c) }));
    const nat = (id, type) => {
      const mine = cities.filter((c) => c.owner === id);
      return { id, type, alive: mine.length > 0 && (id === YOU || nationOf(id)?.alive !== false), cities: mine.length, strength: strengthOf(mine, vehiclesOf(id).length) };
    };
    return {
      time: T.time,
      grace: T.time < GRACE,
      dip: T.dip,
      cities,
      geysers: T.geysers,
      nations: [nat(YOU, T.startType), ...T.nations.map((n) => nat(n.id, n.type))],
      // The more cities a buyer already has, the dearer the next one: no one buys the planet.
      buyoutCost: (c, buyer) => Math.round(buyoutCost(cityEconomy(T.cities[c.id], {}), 0) * (1 + 0.3 * Math.max(0, (buyer?.cities?.length ?? 2) - 2))),
      vehicleCost: 110,
      youVehicles: vehiclesOf(YOU).length,
    };
  }
  /** Carry out one thing a rival's planner wants. */
  function applyIntent(n, it, fleet, mine, world) {
    const city = it.city != null ? T.cities[it.city] : null;
    // Rivals develop at a human pace: one building, upgrade or turret every half minute or so (answers to threats are quicker).
    if (["build", "turret", "hall", "improve"].includes(it.k)) {
      if ((n.devClock ?? 0) > 0 && !it.why) return;
      if ((n.devClock ?? 0) > 12 && it.why) return;
      n.devClock = it.why ? 14 : 30 + Math.random() * 25;
    }
    if (it.k === "buy") {
      if ((n.buyClock ?? 0) > 0) return;
      n.buyClock = 140;
    }
    switch (it.k) {
      case "build": {
        const plot = city && city.plots[it.plot] === null ? it.plot : city?.plots.indexOf(null);
        if (city && plot >= 0) planBuild(city, plot, it.role, n.id);
        break;
      }
      case "turret":
        if (city) planTurret(city, n.id);
        break;
      case "hall":
        if (city) planHall(city, n.id);
        break;
      case "improve": {
        if (!city) break;
        const best = city.plots.map((r, i) => [r, i]).filter(([r, i]) => r && city.levels[i] < MAX_LEVEL).sort((a, b) => city.levels[a[1]] - city.levels[b[1]])[0];
        if (best) planImprove(city, best[1], n.id);
        break;
      }
      case "vehicle": {
        n.vehicleClock = n.vehicleClock ?? 0;
        if (n.vehicleClock > 0) break;
        n.vehicleClock = 30;
        const c = city && city.owner === n.id ? city : mine[0];
        const modes = allowedModes(mine.length, c.coastal);
        const mode = it.modeBias === "land" ? "land" : modes.length > 1 && Math.random() < 0.35 ? modes[1 + Math.floor(Math.random() * (modes.length - 1))] : "land";
        queueVehicle(c, mode, n.id);
        break;
      }
      case "war":
        declareBetween(n.id, it.on, "");
        break;
      case "peace":
        if (it.with === YOU) offerTo(n, "peace", {});
        else if (atWar(T.dip, n.id, it.with)) {
          makePeace(T.dip, n.id, it.with);
          tipOnce("peace:" + pairKey(n.id, it.with) + Math.floor(T.time / 60), `The ${n.name} and ${nationOf(it.with).name} nations have made peace.`, 3.5);
        }
        break;
      case "ally":
        if (it.with === YOU) offerTo(n, "alliance", {});
        else if (canAlly(T.dip, n.id, it.with)) {
          makeAlliance(T.dip, n.id, it.with);
          tipOnce("ally:" + pairKey(n.id, it.with), `The ${n.name} and ${nationOf(it.with).name} nations are now allies.`, 4);
        }
        break;
      case "deal":
        if (it.with === YOU) offerTo(n, "deal", {});
        else if (canDeal(T.dip, n.id, it.with)) makeDeal(T.dip, n.id, it.with);
        break;
      case "gift":
        if (n.money > 150 && it.to !== YOU) {
          n.money -= 60;
          react(T.dip, nationIds(), typeOfNation, { kind: "gift", by: n.id, to: it.to });
        }
        break;
      case "offer":
        offerTo(n, it.kind, { city: it.city, amount: it.amount });
        break;
      case "buy": {
        if (!city || city.owner === YOU || city.owner === n.id) break;
        const cost = Math.round(buyoutCost(cityEconomy(city, {}), city.owner ? relOf(T.dip, n.id, city.owner) : 0) * (1 + 0.3 * Math.max(0, mine.length - 2)));
        if (n.money >= cost) {
          n.money -= cost;
          takeCity(city, n.id, "economic");
        }
        break;
      }
      case "counter":
        for (const v of fleet) if (!v.order && v.role === "religious") v.order = { type: "defend", city, x: city.x, z: city.z, r: 30 };
        break;
      case "target": {
        if (T.time < 90 && it.kind === "attack") break;
        const target = city;
        const role = it.kind === "attack" ? "military" : it.kind === "convert" ? "religious" : "economic";
        // An army marches together: a militarist waits for three vehicles against a nation, two against an independent city.
        const idle = fleet.filter((v) => !v.order && v.role === role);
        if (it.kind === "attack" && idle.length < (target.owner ? 3 : 2)) break;
        for (const v of fleet) {
          if (v.order || v.role !== role) continue;
          if (!canReach(v.mode, target) || (v.mode === "land" && map.continentAt(v.pos.x, v.pos.z) !== target.continent)) continue;
          v.order = { type: "city", city: target };
          if (target.owner === YOU && role !== "economic") tipOnce("incoming:" + role, role === "military" ? `Enemy vehicles are heading for ${target.name}! Turrets and your own military vehicles will fight them.` : `Missionaries from the ${n.name} nation are preaching to ${target.name}. Temples help it resist.`, 5);
        }
        break;
      }
    }
  }

  /* ---- offers: what the rivals put to you ------------------------------------------------------------ */
  let offerCool = 60;
  function offerTo(n, kind, o2) {
    if (T.offers.length || offerCool > 0) return;
    if (kind === "peace" && !n.war) return;
    let text = "",
      amount = o2.amount || 0;
    const city = o2.city != null ? T.cities[o2.city] : null;
    if (kind === "buyout") {
      if (!city || city.owner !== YOU) return;
      amount = buyoutOffer(buyoutCost(cityEconomy(city, {}), n.relation));
      text = `The ${n.name} nation offers §${amount} for ${city.name}. If you sell, it joins them.`;
    } else if (kind === "tribute") {
      amount = tributeDemand(T.money);
      text = `The ${n.name} nation demands §${amount} in tribute. Refuse, and expect trouble.`;
    } else if (kind === "alliance") text = `The ${n.name} nation proposes an alliance: allies never fight, take your side in wars and help defend your cities.`;
    else if (kind === "deal") text = `The ${n.name} nation proposes a trade agreement: it pays both of you every second while you are at peace.`;
    else if (kind === "peace") text = `The ${n.name} nation asks for peace.`;
    const offer = makeOffer(kind, n.id, { city: city?.id, amount, text });
    T.offers.push(offer);
    offerCool = 90;
    o.sfx("gift");
    toast(`${n.name} nation: ${kind === "tribute" ? "a demand" : "an offer"}. Tap the nations bar to answer.`, 4);
    if (!sheet) openSheet("offer");
  }
  /** Answer an offer. `silent` for one that ran out. */
  function resolveOffer(offer, accept, silent = false) {
    T.offers = T.offers.filter((x) => x !== offer);
    const n = nationOf(offer.from);
    if (!n || !n.alive) return;
    const city = offer.city != null ? T.cities[offer.city] : null;
    if (offer.kind === "buyout") {
      if (accept && city && city.owner === YOU) {
        T.money += offer.amount;
        chronicle({ key: "civ:sold:" + city.id, stage: "civ", icon: "💰", text: `Sold ${city.name} to the ${n.name} nation for §${offer.amount}.` });
        takeCity(city, n.id, "economic");
        bump(T.dip, YOU, n.id, 8);
      } else if (!accept) bump(T.dip, YOU, n.id, -3);
    } else if (offer.kind === "tribute") {
      if (accept && T.money >= offer.amount) {
        T.money -= offer.amount;
        bump(T.dip, YOU, n.id, 10);
        toast(`You paid the ${n.name} nation §${offer.amount}.`);
      } else {
        bump(T.dip, YOU, n.id, -20);
        if (!silent || Math.random() < 0.5) if (Math.random() < 0.55 && T.time > GRACE) declareBetween(n.id, YOU, "");
      }
    } else if (offer.kind === "alliance") {
      if (accept && canAlly(T.dip, YOU, n.id)) {
        makeAlliance(T.dip, YOU, n.id);
        chronicle({ key: "civ:ally:" + n.id, stage: "civ", icon: "🤝", text: `Allied with the ${n.name} nation.` });
        toast(`You and the ${n.name} nation are allies.`);
      } else if (!accept) bump(T.dip, YOU, n.id, -2);
    } else if (offer.kind === "deal") {
      if (accept && canDeal(T.dip, YOU, n.id)) {
        makeDeal(T.dip, YOU, n.id);
        toast(`Trade agreement with the ${n.name} nation: it pays you both.`);
      } else if (!accept) bump(T.dip, YOU, n.id, -1);
    } else if (offer.kind === "peace") {
      if (accept) {
        makePeace(T.dip, YOU, n.id);
        toast(`Peace with the ${n.name} nation.`);
        chronicle({ key: "civ:peace:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "🕊", text: "Made peace with the " + n.name + " nation." });
      }
    }
    if (sheet?.kind === "offer") {
      if (T.offers.length) renderSheet();
      else closeSheet();
    }
  }

  /* ---- rival nations ---------------------------------------------------------------------------------- */
  function updateNations(dt) {
    offerCool -= dt;
    for (const off of [...T.offers]) if ((off.t += dt) > off.ttl) resolveOffer(off, false, true);
    // Rivals' feelings toward each other settle; sour alliances end; a nation you fought its way up the world draws wary looks.
    settle(T.dip, T.nations.filter((x) => x.alive), dt);
    for (const [a, b] of soureAlliances(T.dip)) if (a === YOU || b === YOU) toast(`Your alliance with the ${nationOf(a === YOU ? b : a).name} nation has broken down.`, 4);
    let world = null;
    for (const n of T.nations) {
      if (!n.alive) continue;
      const mine = citiesOf(n.id);
      if (!mine.length) {
        n.alive = false;
        continue;
      }
      // The rivals are a little less efficient than a careful player (AI_EFFICIENCY), so the planet can be won.
      n.money = Math.max(0, n.money + econOf(n.id).net * AI_EFFICIENCY * dt);
      // Their feeling toward you settles toward a resting point that falls as your nation grows: a rising power worries everyone.
      const rest = n.base - 6 * Math.max(0, yourCities().length - 1) + (allied(T.dip, YOU, n.id) ? 40 : 0) + (hasDeal(T.dip, YOU, n.id) ? 12 : 0);
      if (!n.war) n.relation = clampRel(n.relation + Math.sign(rest - n.relation) * Math.min(Math.abs(rest - n.relation), DIPLO.drift * dt));
      n.vehicleClock = (n.vehicleClock ?? 10) - dt;
      n.devClock = (n.devClock ?? 20) - dt;
      n.buyClock = (n.buyClock ?? 90) - dt;
      if ((n.clock -= dt) > 0) continue;
      n.clock = 4;
      const fleet = vehiclesOf(n.id);
      world ||= aiWorld();
      const me = { id: n.id, type: n.type, money: n.money, vehicles: fleet.length + queuedFor(n.id), cap: vehicleCap(n.id), cities: world.cities.filter((c) => c.owner === n.id) };
      // Spice first: one idle vehicle at a time is sent to the nearest free geyser it can reach (rivals' derricks too, for a
      // militarist at war), before the rest are given targets; so claiming resources is never starved by the wars.
      if (T.time > 60 && !fleet.some((v) => v.order?.type === "geyser")) {
        const idle = fleet.filter((v) => !v.order && v.mode !== "sea");
        const pick = idle.sort((a, b) => (b.role !== "military") - (a.role !== "military"))[0];
        if (pick) {
          const home = T.cities[pick.home] || mine[0];
          const free = T.geysers
            .filter((g) => (!g.owner || (g.owner !== n.id && hostile(n.id, g.owner) && pick.role === "military")) && canClaim(pick, g) && distXZ(g, home) < 330)
            .sort((a, b) => distXZ(a, home) - distXZ(b, home))[0];
          if (free) pick.order = { type: "geyser", geyser: free, x: free.x, z: free.z };
        }
      }
      const intents = planNation(me, world);
      for (const it of intents.slice(0, 9)) applyIntent(n, it, fleet, mine, world);
    }
  }
  /** Your own military vehicles defend your cities: idle ones within reach go after attackers. */
  function autoDefend() {
    // Idle armed vehicles near a city under attack go to its defence: the owner's, and its allies'.
    for (const c of T.cities) {
      if (!c.owner) continue;
      const raiders = T.vehicles.filter((v) => !v.dead && v.owner !== c.owner && v.order?.city === c && distXZ(v.pos, c) < 45 && hostile(c.owner, v.owner));
      if (!raiders.length) continue;
      for (const id of [c.owner, ...alliesOf(T.dip, c.owner)])
        for (const v of vehiclesOf(id)) if (!v.order && armed(v) && distXZ(v.pos, c) < 70) v.order = { type: "defend", city: c, x: c.x, z: c.z, r: 40 };
    }
  }

  /* ---- HUD refresh -------------------------------------------------------------------------------------- */
  const spiceIncomeOf = (owner) => T.geysers.filter((g) => g.owner === owner).reduce((s, g) => s + SPICE_INCOME * g.yield, 0);
  /** Where an owner's money comes from and goes, a second: city income, spice, trade routes and agreements, less upkeep. */
  function econOf(owner) {
    const em = ownerMods(owner);
    const cities = citiesOf(owner).reduce((sum, c) => sum + cityEconomy(c, em).income, 0);
    const upkeep = citiesOf(owner).reduce((sum, c) => sum + upkeepOf(c), 0) + vehiclesOf(owner).length * VEHICLE_UPKEEP;
    const spice = spiceIncomeOf(owner);
    const trade = tradeIncome(T.cities, owner);
    const deals = dealIncomeOf(T.dip, owner, aliveIds());
    return { cities, spice, trade, deals, upkeep, net: cities + spice + trade + deals - upkeep };
  }
  const income = () => econOf(YOU).net;
  const moneyOf = (owner) => (owner === YOU ? T.money : nationOf(owner)?.money ?? 0);
  const spend = (owner, amount) => {
    if (owner === YOU) T.money -= amount;
    else nationOf(owner).money -= amount;
  };
  /* ---- the city planner: building, improving and expanding (you and the rivals use the same rules) ---- */
  function planBuild(c, plot, role, owner = c.owner) {
    if (c.owner !== owner || c.plots[plot] || !BUILD_COST[role] || moneyOf(owner) < BUILD_COST[role]) return false;
    spend(owner, BUILD_COST[role]);
    c.plots[plot] = role;
    c.levels[plot] = 1;
    buildCity(c);
    return true;
  }
  function planImprove(c, plot, owner = c.owner) {
    const role = c.plots[plot];
    const level = c.levels[plot] || 1;
    if (c.owner !== owner || !role || level >= MAX_LEVEL || moneyOf(owner) < improveCost(role, level)) return false;
    spend(owner, improveCost(role, level));
    c.levels[plot] = level + 1;
    buildCity(c);
    return true;
  }
  function planHall(c, owner = c.owner) {
    if (c.owner !== owner || c.hall >= HALL_MAX || moneyOf(owner) < hallCost(c.hall)) return false;
    spend(owner, hallCost(c.hall));
    c.hall++;
    c.hallHp = Math.min(1, c.hallHp + 0.2);
    buildCity(c);
    return true;
  }
  function planTurret(c, owner = c.owner) {
    if (c.owner !== owner || c.turrets >= turretSlots(c.hall) || moneyOf(owner) < BUILD_COST.turret) return false;
    spend(owner, BUILD_COST.turret);
    c.turrets++;
    c.turretHp = 1;
    buildCity(c);
    return true;
  }
  function planDemolish(c, plot) {
    if (!c.plots[plot]) return false;
    c.plots[plot] = null;
    c.levels[plot] = 1;
    buildCity(c);
    return true;
  }
  let hudClock = 0,
    liveClock = 1;
  const marks = new Map();
  const spiceMarks = new Map();
  const hpMarks = new Map();
  function updateMarks() {
    const layer = $h("#cvMarks");
    for (const c of T.cities) {
      let m = marks.get(c);
      if (!m) {
        m = document.createElement("div");
        m.className = "trMark cvMark";
        layer.appendChild(m);
        marks.set(c, m);
      }
      const p = project(c.x, groundY(c.x, c.z) + 10, c.z);
      m.hidden = !p.on;
      if (m.hidden) continue;
      m.style.left = p.x + "px";
      m.style.top = p.y + "px";
      m.style.setProperty("--rel", hex(ownerColor(c.owner)));
      const progress = c.owner === YOU ? Math.max(0, ...Object.entries(c.conv).filter(([k]) => k !== YOU).map(([, v]) => v)) / 100 : Math.max(c.trade[YOU] || 0, c.conv[YOU] || 0) / 100;
      const damaged = c.hallHp < 1 || (c.turrets && c.turretHp < 1);
      const html = `${CITY_TYPES[c.type].icon} ${esc(c.name)}${damaged ? `<i><b style="width:${Math.round(c.hallHp * 100)}%;background:#ef4b48"></b></i>` : progress > 0 ? `<i><b style="width:${Math.round(progress * 100)}%;background:${c.owner === YOU ? "#c9b5ff" : "#ffd24a"}"></b></i>` : ""}`;
      if (m._html !== html) m.innerHTML = withIcons((m._html = html));
    }
    // Spice: a small diamond in the owner's colour on every geyser, so they can be found from any height.
    for (const g of T.geysers) {
      let m = spiceMarks.get(g);
      if (!m) {
        m = document.createElement("div");
        m.className = "cvSpice";
        m.setAttribute("aria-hidden", "true");
        layer.appendChild(m);
        spiceMarks.set(g, m);
      }
      const p = project(g.x, groundY(g.x, g.z) + 8, g.z);
      m.hidden = !p.on || rig.distance < 40;
      if (m.hidden) continue;
      m.style.left = p.x + "px";
      m.style.top = p.y + "px";
      m.style.setProperty("--own", g.owner ? hex(ownerColor(g.owner)) : "#ffa14a");
      m.classList.toggle("free", !g.owner);
    }
    // Health bars over selected or hurt vehicles that are close enough to matter.
    let shown = 0;
    for (const [v, m] of hpMarks)
      if (v.dead) {
        m.remove();
        hpMarks.delete(v);
      }
    for (const v of T.vehicles) {
      const want = !v.dead && !v.far && shown < 32 && (T.selected.has(v) || v.hp < v.unit.hp - 0.5);
      let m = hpMarks.get(v);
      if (!want) {
        if (m) m.hidden = true;
        continue;
      }
      if (!m) {
        m = document.createElement("div");
        m.className = "cvHp";
        m.setAttribute("aria-hidden", "true");
        m.innerHTML = "<b></b>";
        layer.appendChild(m);
        hpMarks.set(v, m);
      }
      const p = project(v.pos.x, v.y + 3.6, v.pos.z);
      m.hidden = !p.on;
      if (m.hidden) continue;
      shown++;
      m.style.left = p.x + "px";
      m.style.top = p.y + "px";
      const f = Math.max(0, v.hp / v.unit.hp);
      m.firstChild.style.width = Math.round(f * 100) + "%";
      m.classList.toggle("foe", v.owner !== YOU);
      m.classList.toggle("low", f < 0.35);
    }
  }
  function updateHUD() {
    $h("#cvMoney").textContent = Math.floor(T.money);
    $h("#cvIncome").textContent = "+" + income().toFixed(1) + "/s";
    $h("#cvCities").textContent = yourCities().length + "/" + T.cities.length;
    $h("#cvVeh").textContent = vehiclesOf(YOU).length + "/" + vehicleCap(YOU);
    const left = T.cities.length - yourCities().length;
    const dom = dominanceNow();
    $h("#cvGoal").textContent = T.won ? `${CIV_CARDS[T.card]?.icon || "✦"} The planet is united` : left ? `Unite the planet: ${dom.yours}/${dom.need} cities${dom.holdouts ? ` · ${dom.holdouts} rival${dom.holdouts === 1 ? "" : "s"} to subdue or ally` : " · all rivals allied or fallen"}` : "";
    $h("#cvNations").innerHTML = withIcons(T.nations
      .map((n) => {
        const ally = allied(T.dip, YOU, n.id),
          deal = hasDeal(T.dip, YOU, n.id);
        const col = n.war ? "#ef4b48" : ally ? "#3fc26e" : n.relation >= 20 ? "#8fd18f" : n.relation > -20 ? "#b9c3c9" : "#f0a04b";
        return `<button class="trTribe cvNation ${ally ? "ally" : deal ? "deal" : ""}" role="listitem" data-nation="${n.id}" style="--rel:${col}" aria-label="${esc(n.name)} nation, ${dipWord(T.dip, YOU, n.id)}${n.alive ? "" : ", fallen"}" ${n.alive ? "" : 'aria-disabled="true"'}><span>${n.alive ? CITY_TYPES[n.type].icon : "🏳"}</span></button>`;
      })
      .join(""));
    $h("#cvNations")
      .querySelectorAll("[data-nation]")
      .forEach((b) => (b.onclick = () => openSheet("nation", { nation: nationOf(b.dataset.nation) })));
    const mineV = vehiclesOf(YOU);
    $h("#cvUnits").innerHTML = withIcons(mineV
      .map((v) => `<button class="trUnit cvUnit ${T.selected.has(v) ? "sel" : ""} ${v.hp / v.unit.hp < 0.35 ? "low" : ""}" role="listitem" data-veh="${v.id}" aria-label="${CITY_TYPES[v.role].name} ${MODE_NAME[v.mode].toLowerCase()} vehicle${T.selected.has(v) ? ", selected" : ""}" aria-pressed="${T.selected.has(v)}"><span class="noPic">${MODE_ICON[v.mode]}</span><em>${CITY_TYPES[v.role].icon}</em><i><b style="width:${Math.round((v.hp / v.unit.hp) * 100)}%"></b></i></button>`)
      .join(""));
    $h("#cvUnits")
      .querySelectorAll("[data-veh]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const v = T.vehicles.find((x) => x.id === Number(b.dataset.veh));
            if (!v) return;
            if (T.selected.has(v)) T.selected.delete(v);
            else T.selected.add(v);
            rig.flyTo(v.pos.x, v.pos.z);
            updateHUD();
          }),
      );
    renderCmd();
    const s = superState();
    const sb = $h("#cvSuper");
    sb.innerHTML = withIcons(`<span>${s.def.icon}</span><small>${s.unlocked ? (T.superCool > 0 ? Math.ceil(T.superCool) + "s" : "§" + SUPER_COST) : "Locked"}</small>`);
    sb.setAttribute("aria-label", `${s.def.name}: ${s.def.desc}${s.unlocked ? "" : " Locked until you hold half the cities."}`);
    sb.setAttribute("aria-disabled", String(!s.ready));
  }
  $h("#cvAll").onclick = () => {
    if (T.selected.size && T.selected.size === vehiclesOf(YOU).length) T.selected.clear();
    else selectAll();
    updateHUD();
  };
  $h("#cvHome").onclick = goCapital;
  $h("#cvBoxBtn").onclick = () => setBoxMode(!boxMode);
  $h("#cvZoomIn").onclick = () => rig.zoom(0.7);
  $h("#cvZoomOut").onclick = () => rig.zoom(1.45);
  $h("#cvGlobe").onclick = toggleGlobe;
  $h("#cvNorth").onclick = () => rig.north();
  $h("#cvCity").onclick = () => {
    const mine = yourCities();
    if (!mine.length) return;
    const f = rig.focusMap();
    const c = mine.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    openSheet("city", { city: c });
  };
  const openDesigns = () => openSheet("designs");
  $h("#cvDesigns").onclick = openDesigns;
  $h("#cvSuper").onclick = startTargeting;
  $h("#cvMenu").onclick = () => ($h("#cvMenuPanel").hidden = !$h("#cvMenuPanel").hidden);
  $h("#cvResume").onclick = () => ($h("#cvMenuPanel").hidden = true);
  $h("#cvHistory").onclick = () => {
    $h("#cvMenuPanel").hidden = true;
    o.onHistory?.();
  };
  $h("#cvSettings").onclick = () => {
    $h("#cvMenuPanel").hidden = true;
    o.onSettings?.();
  };
  $h("#cvHelp").onclick = () => openSheet("help");
  $h("#cvExit").onclick = () => {
    saveState();
    o.onExit();
  };

  /* ---- saving --------------------------------------------------------------------------------------------- */
  function saveState() {
    const data = {
      v: 1,
      planet: 1,
      money: Math.round(T.money),
      startType: T.startType,
      nations: T.nations.map((n) => ({ id: n.id, type: n.type, relation: n.relation, war: n.war, money: Math.round(n.money), alive: n.alive })),
      dip: T.dip,
      cities: T.cities.map((c) => ({ id: c.id, owner: c.owner, type: c.type, plots: c.plots, turrets: c.turrets, turretHp: c.turretHp, hallHp: c.hallHp, trade: c.trade, conv: c.conv, unrest: c.unrest, levels: c.levels, hall: c.hall, devout: c.devout, queue: c.queue.map((i) => ({ key: i.key, cost: i.cost, total: i.total, t: Math.round(i.t * 10) / 10 })) })),
      geysers: T.geysers.map((g) => ({ owner: g.owner, hp: g.hp })),
      vehicles: T.vehicles.filter((v) => !v.dead).map((v) => ({ owner: v.owner, design: v.key, x: Math.round(v.pos.x * 10) / 10, z: Math.round(v.pos.z * 10) / 10, hp: Math.round((v.hp / v.unit.hp) * 100) / 100, city: v.home })),
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
  T.cities.forEach(buildCity);
  T.geysers.forEach(buildGeyser);
  // Roads join neighbouring cities on the same continent wherever the way is open land.
  const roadMeshes = [];
  const links = roadLinks(map.citySites, (x, z) => map.walkable("land", x, z));
  for (const [a, b] of links) {
    const mesh = cityArt.buildRoad(T.cities[a], T.cities[b]);
    if (mesh) roadMeshes.push(mesh);
  }
  const flora = createPlanetFlora(scene, map, {
    quality: o.quality,
    cities: T.cities,
    spice: T.geysers,
    links: links.map(([a, b]) => [T.cities[a], T.cities[b]]),
  });
  // Build the ground around the first view now, so the stage opens at full detail rather than filling in.
  rig.update(0.016);
  planetView.update(camera, { all: true, budgetMs: 1e9 });
  flora.update(camera, rig.focusMap(), rig.distance, { maxNew: 1e9 });
  const mini = createMinimap(map, { onPick: (x, z) => rig.flyTo(x, z, Math.min(Math.max(rig.target.dist, ZOOM.city + 40), 260)) });
  hud.appendChild(mini.el);
  // Distant vehicles are drawn as coloured dots instead of full models.
  const farGeo = new THREE.BufferGeometry();
  const FAR_MAX = 160;
  farGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FAR_MAX * 3), 3));
  farGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(FAR_MAX * 3), 3));
  const farPoints = new THREE.Points(farGeo, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  farPoints.frustumCulled = false;
  farPoints.renderOrder = 4;
  scene.add(farPoints);
  const tmpColor = new THREE.Color();
  for (const sv of save?.planet ? save.vehicles || [] : []) {
    const [role, mode] = sv.design.split(":");
    if (!TYPE_IDS.includes(role) || !["land", "sea", "air"].includes(mode)) continue;
    if (sv.owner !== YOU && !nationOf(sv.owner)?.alive) continue;
    const home = T.cities[sv.city] || capital();
    spawnVehicle(sv.owner, sv.design, home, { x: sv.x, z: sv.z }, sv.hp);
  }
  // A save from before the planet kept vehicles on the old island: they come home to their cities.
  if (save && !save.planet)
    for (const sv of save.vehicles || []) {
      const [role, mode] = sv.design.split(":");
      if (!TYPE_IDS.includes(role) || !["land", "sea", "air"].includes(mode)) continue;
      if (sv.owner !== YOU && !nationOf(sv.owner)?.alive) continue;
      const home = T.cities[sv.city] && T.cities[sv.city].owner === sv.owner ? T.cities[sv.city] : citiesOf(sv.owner)[0];
      if (home) spawnVehicle(sv.owner, sv.design, home, null, sv.hp);
    }
  if (!save) {
    // Your first vehicle, so there is something to do from the first second.
    spawnVehicle(YOU, T.startType + ":land", T.cities[0]);
    T.nations.forEach((n) => citiesOf(n.id).slice(0, 1).forEach((c) => spawnVehicle(n.id, c.type + ":land", c)));
    chronicle({ key: "civ:start", stage: "civ", icon: "🏛", text: `Founded the ${CITY_TYPES[T.startType].name.toLowerCase()} city of ${o.name}.` });
    setTimeout(() => openSheet("help"), 600);
  }
  if (!yourCities().length) T.lost = true;
  updateHUD();
  hud.style.setProperty("--cvB", ($h(".trBottom")?.offsetHeight || 130) + 8 + "px");
  let saveClock = 15,
    miniClock = 0;
  const sunVec = new THREE.Vector3();
  /** Level of detail: what each city, vehicle and geyser is drawn as, from the camera's distance. */
  function updateDetail() {
    const cp = camera.position;
    for (const c of T.cities) {
      if (!c.art) continue;
      const d = c.world.distanceTo(cp);
      const hidden = rig.occluded(c.world);
      const full = !hidden && d < 240;
      c.art.always.visible = !hidden;
      c.art.detail.visible = full;
      c.art.proxy.visible = !hidden && !full;
    }
    let far = 0;
    for (const v of T.vehicles) {
      if (v.dead) continue;
      const d = v.group.position.distanceTo(cp);
      const hidden = rig.occluded(v.group.position);
      v.far = d > 230;
      v.model.root.visible = !v.far && !hidden;
      v.ring.visible = T.selected.has(v) && !v.far && !hidden;
      if (v.far && !hidden && far < FAR_MAX) {
        const p = v.group.position;
        farGeo.attributes.position.setXYZ(far, p.x, p.y, p.z);
        tmpColor.setHex(v.owner === YOU ? (T.selected.has(v) ? 0xffffff : 0x8ff0a8) : ownerColor(v.owner));
        farGeo.attributes.color.setXYZ(far, tmpColor.r, tmpColor.g, tmpColor.b);
        far++;
      }
    }
    farGeo.setDrawRange(0, far);
    farGeo.attributes.position.needsUpdate = true;
    farGeo.attributes.color.needsUpdate = true;
    for (const g of T.geysers) if (g.view) g.view.group.visible = !rig.occluded(g.view.group.children[0].position);
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
      hud.style.setProperty("--cvB", ($h(".trBottom")?.offsetHeight || 130) + 8 + "px");
    },
    update(dt) {
      if (paused) return;
      if (toastT > 0 && (toastT -= dt) <= 0) $h("#cvToast").classList.remove("show");
      // Arrow keys and WASD slide over the planet; Q and E turn the map.
      const kx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
        kz = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      if (kx || kz) rig.panMetres(kx * rig.distance * 0.9 * dt, kz * rig.distance * 0.9 * dt);
      const kr = (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0);
      if (kr) rig.rotate(kr * 1.4 * dt);
      rig.update(dt);
      planetView.setSun(rig.sunDir(sunVec));
      planetView.update(camera);
      const focus = rig.focusMap();
      // One heavy job a frame: a terrain patch built this frame means the plants wait for the next.
      flora.update(camera, focus, rig.distance, { maxNew: planetView.stats.heavy ? 0 : 2 });
      updateDetail();
      $h("#cvNeedle").setAttribute("transform", `rotate(${((-rig.heading() * 180) / Math.PI).toFixed(1)} 12 12)`);
      if (regionT > 0 && (regionT -= dt) <= 0) closeRegion();
      if (!T.lost && !(sheet && (sheet.kind === "won" || sheet.kind === "lost"))) {
        T.time += dt;
        T.superCool = Math.max(0, T.superCool - dt);
        T.money += income() * dt;
        for (const v of [...T.vehicles]) if (!v.dead) updateVehicle(v, dt);
        updateProduction(dt);
        updateTurrets(dt);
        updateNations(dt);
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
      updateShots(dt);
      fx.update(dt);
      updateMarks();
      if ((miniClock -= dt) <= 0) {
        miniClock = 0.3;
        mini.el.hidden = !!sheet;
        mini.draw({
          cities: T.cities.map((c) => ({ x: c.x, z: c.z, color: hex(ownerColor(c.owner)) })),
          spice: T.geysers.map((g) => ({ x: g.x, z: g.z, color: g.owner ? hex(ownerColor(g.owner)) : null })),
          units: T.vehicles.filter((v) => !v.dead).map((v) => ({ x: v.pos.x, z: v.pos.z, color: hex(ownerColor(v.owner)) })),
          view: { x: focus.x, z: focus.z, r: rig.distance * 1.1 },
        });
      }
      if ((hudClock -= dt) <= 0) {
        hudClock = 0.25;
        updateHUD();
        if ((liveClock -= 0.25) <= 0 && sheet && (sheet.kind === "city" || sheet.kind === "nation") && !sheetPress) {
          liveClock = 1;
          renderSheet(false);
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
        c.art?.dispose();
      });
      T.geysers.forEach((g) => g.view?.dispose());
      roadMeshes.forEach((m) => {
        scene.remove(m);
        m.geometry.dispose();
      });
      flora.dispose();
      fx.dispose();
      hpMarks.forEach((m) => m.remove());
      cityArt.dispose();
      spiceArt.dispose();
      mini.dispose();
      farGeo.dispose();
      farPoints.material.dispose();
      scene.remove(farPoints);
      shots.forEach((s) => s.line.geometry.dispose());
      Object.values(shotMat).forEach((m) => m.dispose());
      matCache.forEach((set) => Object.values(set).forEach((m) => m.dispose()));
      Object.values(sharedGeo).forEach((g) => g.dispose());
      Object.values(sharedMat).forEach((m) => m.dispose());
      flashGeo.dispose();
      flashMat.dispose();
      planetView.dispose();
      hud.remove();
    },
    debug: {
      T,
      map,
      rig,
      planetView,
      flora,
      cultures: () => T.cultures,
      fx,
      econOf,
      planBuild,
      planImprove,
      planHall,
      planTurret,
      planDemolish,
      resolveOffer,
      offerTo,
      clearOfferCool: () => (offerCool = 0),
      updateNations,
      declareBetween,
      aiWorld,
      dominanceNow,
      checkWin,
      setCommand,
      executeCommand,
      contextOrder,
      rightClick,
      queueVehicle,
      tryQueue,
      cancelQueued,
      updateProduction,
      pick,
      get command() {
        return command;
      },
      get boxMode() {
        return boxMode;
      },
      inspect,
      groundAt,
      cityArt,
      get camera() {
        return camera;
      },
      /** Render statistics for tests: what the planet costs to draw. */
      stats() {
        const info = o.renderer.info.render;
        return { calls: info.calls, triangles: info.triangles, chunks: { ...planetView.stats }, scenery: { ...flora.stats }, units: { total: T.vehicles.length, far: T.vehicles.filter((v) => v.far).length } };
      },
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
      get sheet() {
        return sheet;
      },
      /** Screen point of a city, for tests. */
      cityScreen(i) {
        const c = T.cities[i];
        return project(c.x, groundY(c.x, c.z) + 4, c.z);
      },
      geyserScreen(i) {
        const g = T.geysers[i];
        return project(g.x, groundY(g.x, g.z) + 3, g.z);
      },
      vehicleScreen(v) {
        return project(v.pos.x, v.y + 1.5, v.pos.z);
      },
    },
  };
}
