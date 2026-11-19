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
      relation: saved ? saved.relation : clampRel(NATION_START[type] + mods.relation),
      base: clampRel(NATION_START[type] + mods.relation),
      war: saved ? saved.war : false,
      money: saved ? saved.money : 120,
      alive: saved ? saved.alive : true,
      clock: 4 + i * 1.3,
      buildClock: 20 + i * 7,
    });
  });
  const nationOf = (id) => T.nations.find((n) => n.id === id) || null;
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
  const turretSpot = (c, k) => {
    const a = SPOTS.turretAngle(k);
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
    const art = cityArt.build(c, { culture, ownerColor: ownerColor(c.owner), spots: SPOTS, pop: econ.pop });
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
  const vehicleCap = (owner) => VEHICLES_PER_CITY * citiesOf(owner).length;

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
  hud.innerHTML = `
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
      <button id="cvGlobe" aria-label="Show the whole planet" title="Whole planet (G)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/></svg></button>
      <button id="cvNorth" aria-label="Compass: face north" title="Face north (N)"><svg viewBox="0 0 24 24" aria-hidden="true"><g id="cvNeedle"><path d="M12 3l4 9h-8z" class="n"/><path d="M12 21l4-9h-8z"/></g></svg></button>
    </div>
    <div class="cvRegion" id="cvRegion" hidden role="status" aria-live="polite"></div>
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
      <button id="cvDesignsMenu">🎨 Designs</button>
      <button id="cvHistory">📜 Species history</button>
      <button id="cvSettings">⚙ Settings</button>
      <button id="cvHelp">How to play</button>
      <button id="cvExit">Back to the Tribal Stage</button>
    </div>`;
  document.body.appendChild(hud);
  const $h = (q) => hud.querySelector(q);
  $h("#cvName").textContent = o.name;
  let toastT = 0;
  function toast(text, seconds = 3) {
    const el = $h("#cvToast");
    el.textContent = text;
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
    el.textContent = text;
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
    else if (sheet.kind === "won") html = wonHtml();
    else if (sheet.kind === "lost") html = lostHtml();
    else html = helpHtml();
    // Live refreshes skip identical content, so a finger mid-tap never loses its button.
    if (!force && html === sheetHtml) return;
    sheetHtml = html;
    el.innerHTML = html;
    el.querySelector(".tsClose")?.addEventListener("click", closeSheet);
    bindSheet(el);
  }
  function cityHtml(c) {
    const econ = cityEconomy(c, ownerMods(c.owner));
    const head = `<div class="tsHead"><div>${CITY_TYPES[c.type].icon} ${esc(c.name)}<small>${esc(cap(ownerName(c.owner)))} · ${CITY_TYPES[c.type].name} city</small></div><button class="tsClose" aria-label="Close">✕</button></div>
      <div class="tsStats cvCityStats"><span><b>${econ.pop}k</b>people</span><span><b>${econ.happiness > 0 ? "+" : ""}${econ.happiness}</b>${econ.riot ? "rioting!" : "happiness"}</span><span><b>${econ.income.toFixed(1)}</b>§ / s</span><span><b>${c.turrets}</b>turrets</span></div>
      <p class="tsHint cvCulture"><b>${esc(c.culture ? describeCulture(c.culture) : "")}</b> · ${esc(map.continents[c.continent]?.name || "")}</p>`;
    if (c.owner === YOU) {
      const plots = c.plots
        .map((role, k) =>
          role
            ? `<button class="cvPlot" data-plot="${k}" aria-label="${ROLES.building[role].name}: tap to demolish">${ROLE_ICON[role]}<small>${ROLES.building[role].name}</small></button>`
            : `<button class="cvPlot empty" data-plot="${k}" aria-label="Empty plot: tap to build">＋<small>Empty</small></button>`,
        )
        .join("");
      const choosing = sheet.plot != null && !c.plots[sheet.plot];
      const choices = choosing
        ? `<div class="tsTrade">${PLOT_ROLES.map((r) => `<button class="tsTradeBtn" data-build="${r}" ${dis(T.money < BUILD_COST[r])}><span>${ROLE_ICON[r]}</span><b>${ROLES.building[r].name}</b><em>§${BUILD_COST[r]}</em></button>`).join("")}</div><p class="tsHint">${PLOT_ROLES.map((r) => `${ROLE_ICON[r]} ${ROLES.building[r].desc}`).join(" ")}</p>`
        : "";
      const cap = vehicleCap(YOU),
        have = vehiclesOf(YOU).length;
      const modes = allowedModes(yourCities().length, c.coastal);
      const role = c.type;
      const builds = ["land", "sea", "air"]
        .map((mode) => {
          const key = role + ":" + mode;
          const u = vehicleUnit(T.designs.vehicle[key], mods);
          const locked = !modes.includes(mode);
          const why = mode === "sea" && !c.coastal ? "Inland city" : mode === "air" && locked ? `Needs ${AIR_AT} cities` : "";
          return `<button class="tsTradeBtn" data-vehicle="${mode}" ${dis(locked || have >= cap || T.money < u.cost || !u.ok)}><span>${MODE_ICON[mode]}</span><b>${esc(T.designs.vehicle[key].name)}<small>${why || MODE_NAME[mode]}</small></b><em>§${u.cost}</em></button>`;
        })
        .join("");
      return `${head}
        <h5 class="tsKind">Buildings · tap a plot</h5><div class="cvPlots">${plots}</div>${choices}
        <div class="tsBtns cvRow"><button id="cvTurret" ${dis(c.turrets >= MAX_TURRETS || T.money < BUILD_COST.turret)}>🗼 Turret · §${BUILD_COST.turret} (${c.turrets}/${MAX_TURRETS})</button><button id="cvFocus">📍 Look here</button></div>
        <h5 class="tsKind">${CITY_TYPES[role].icon} ${CITY_TYPES[role].name} vehicles · ${have}/${cap}</h5><div class="tsTrade">${builds}</div>
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
  function nationHtml(n) {
    const cities = citiesOf(n.id).length;
    return `<div class="tsHead"><div>${CITY_TYPES[n.type].icon} ${esc(n.name)} nation<small>${CITY_TYPES[n.type].name} · ${cities} ${cities === 1 ? "city" : "cities"} · ${vehiclesOf(n.id).length} vehicles</small></div><button class="tsClose" aria-label="Close">✕</button></div>
      ${bar((n.relation + 100) / 200, n.war ? "foe" : "")}
      <p class="tsHint"><b>${relationWord(n.relation, n.war)}</b> (${Math.round(n.relation)}). ${
        n.type === "military" ? "A military nation: if it grows to hate you, it declares war and sends its army." : n.type === "economic" ? "An economic nation: it trades with you while relations are decent. Trade routes pay you both." : "A religious nation: it preaches to cities of nations it dislikes. Temples help your cities resist."
      }</p>
      <div class="tsBtns">
        <button class="gift" id="cvGift" ${dis(T.money < DIPLO.giftCost || !n.alive)}>Gift · §${DIPLO.giftCost}</button>
        <button class="${n.war ? "good" : ""}" id="cvPeace" ${dis(!n.war || T.money < DIPLO.peaceCost)}>${n.war ? `Offer peace · §${DIPLO.peaceCost}` : "At peace"}</button>
      </div>`;
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
      <p class="tsWonText"><b>One world, one nation.</b> ${esc(card.text)}</p>
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
        <li><b>Vehicles:</b> each city makes vehicles of its own kind. Tap vehicles (or 🚙 All) to select them, then tap a city, a spice geyser or the ground.</li>
        <li><b>Take cities</b> three ways: ⚔ military vehicles knock out turrets and then the hall; 💰 economic vehicles trade until you can buy the city; 🕊 religious vehicles preach until it converts. Every city you take makes vehicles of its kind.</li>
        <li><b>Spice:</b> glowing geysers dot the planet (and the map). Send a land or air vehicle to claim one: it pays you every second, richer ones more. Rivals claim them too, and military vehicles can wreck a derrick.</li>
        <li><b>Nations:</b> tap a nation at the top for gifts and peace. Military nations go to war with those they hate; religious ones preach; economic ones trade.</li>
        <li><b>Superweapon:</b> hold half the planet's cities and it's yours: one city at a time, the way you've been winning them.</li>
        <li><b>Goal:</b> unite every city on the planet under your flag. Land vehicles cannot cross the sea: other continents need boats or aircraft. How you do it decides your card.</li>
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
          const k = Number(b.dataset.plot),
            c = sheet.city;
          if (c.plots[k]) {
            c.plots[k] = null;
            buildCity(c);
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
          if (T.money < BUILD_COST[role] || sheet.plot == null) return toast("Not enough money.");
          T.money -= BUILD_COST[role];
          c.plots[sheet.plot] = role;
          sheet.plot = null;
          buildCity(c);
          o.sfx("build");
          pop(c.x, groundY(c.x, c.z) + 8, c.z, "−§" + BUILD_COST[role], "bad");
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-vehicle]").forEach((b) => (b.onclick = () => (b.getAttribute("aria-disabled") === "true" ? vehicleRefusal(sheet.city, b.dataset.vehicle) : buyVehicle(sheet.city, b.dataset.vehicle))));
    el.querySelectorAll("[data-design]").forEach((b) => (b.onclick = () => editDesign(...b.dataset.design.split("|"))));
    on("#cvTurret", () => {
      const c = sheet.city;
      T.money -= BUILD_COST.turret;
      c.turrets++;
      c.turretHp = 1;
      buildCity(c);
      o.sfx("build");
      renderSheet();
    });
    on("#cvFocus", () => rig.flyTo(sheet.city.x, sheet.city.z, 90));
    on("#cvSend", () => {
      orderTo([...T.selected], { type: "city", city: sheet.city });
      closeSheet();
    });
    on("#cvBuy", () => buyCity(sheet.city));
    on("#cvGift", () => {
      const n = sheet.nation;
      T.money -= DIPLO.giftCost;
      n.relation = clampRel(n.relation + DIPLO.gift);
      o.sfx("gift");
      toast(`The ${n.name} nation thanks you for the gift.`);
      renderSheet();
    });
    on("#cvPeace", () => {
      const n = sheet.nation;
      T.money -= DIPLO.peaceCost;
      n.war = false;
      n.relation = Math.max(n.relation, DIPLO.peaceAt);
      vehiclesOf(n.id).forEach((v) => (v.order = null));
      o.sfx("unlock");
      toast(`Peace with the ${n.name} nation.`);
      chronicle({ key: "civ:peace:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "🕊", text: "Made peace with the " + n.name + " nation." });
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
    if (!u.ok) return toast("That design can't be used: open 🎨 Designs and fix it.");
    if (vehiclesOf(YOU).length >= vehicleCap(YOU)) return toast(`Each city supports ${VEHICLES_PER_CITY} vehicles. Take more cities for more.`);
    toast("Not enough money.");
  }
  function buyVehicle(c, mode) {
    const key = c.type + ":" + mode;
    const u = vehicleUnit(T.designs.vehicle[key], mods);
    T.money -= u.cost;
    const v = spawnVehicle(YOU, key, c);
    T.selected.clear();
    T.selected.add(v);
    o.sfx("build");
    tipOnce("firstVehicle", "Your new vehicle is selected: tap a city to send it there, or the ground to move it.", 5);
    renderSheet();
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
    transferCity(c, owner, method);
    // A city keeps its kind unless taken by force; force makes it a military city of the taker.
    if (method === "military") c.type = "military";
    else if (method === "religious") c.type = "religious";
    else if (method === "economic") c.type = "economic";
    buildCity(c);
    T.vehicles.filter((v) => v.order?.city === c).forEach((v) => (v.order = null));
    if (owner === YOU) {
      T.captures[method] = (T.captures[method] || 0) + 1;
      o.sfx("unlock");
      toast(`${c.name} is yours! ${method === "military" ? "Taken by force." : method === "economic" ? "Bought." : "Converted."}`, 4);
      chronicle({ key: "civ:take:" + c.id + ":" + method, stage: "civ", icon: CITY_TYPES[method].icon, text: `${method === "military" ? "Captured" : method === "economic" ? "Bought" : "Converted"} the city of ${c.name}.` });
      const n = nationOf(from);
      if (n && citiesOf(n.id).length === 0) {
        n.alive = false;
        vehiclesOf(n.id).forEach(removeVehicle);
        toast(`The ${n.name} nation is no more.`, 4);
        chronicle({ key: "civ:fall:" + n.id, stage: "civ", icon: "🏳", text: "Absorbed the last city of the " + n.name + " nation." });
      }
      checkWin();
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
    chronicle({ key: "civ:won", stage: "civ", icon: card.icon, text: "United the world as a " + card.name.toLowerCase() + " nation." });
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
      noSea = 0;
    const memo = new Map();
    for (const v of list) {
      if (v.dead || v.owner !== YOU) continue;
      if (order.type === "city" && !canReach(v.mode, order.city)) {
        refused++;
        continue;
      }
      if (v.mode === "sea" && order.type === "geyser") {
        noSea++;
        continue;
      }
      if (v.mode === "sea" && order.type === "move" && !map.walkable("sea", order.x, order.z)) {
        noSea++;
        continue;
      }
      if (order.type !== "vehicle" && v.mode !== "air") {
        const goal = order.type === "city" ? (v.mode === "sea" ? order.city.sea : order.city) : order;
        if (!goal || !canGet(v, goal, memo)) {
          noRoute++;
          continue;
        }
      }
      v.order = { ...order };
      v.path = null;
      v.planT = 0;
    }
    if (refused) toast("Boats can only reach cities on the coast.");
    else if (noSea) toast("Boats stay on the water: send land or air vehicles inland.");
    else if (noRoute) toast("No way there by land or sea: it is across the water. Build boats or aircraft.");
    o.sfx("click");
    flash(order.type === "city" ? order.city : order);
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
  const pointers = new Map();
  let gesture = null;
  const onDown = (e) => {
    if (paused || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    rig.holding = true;
    if (pointers.size === 1) gesture = { panned: false, pinch: 0, twist: 0, turning: e.button === 2 || e.button === 1 || e.shiftKey };
    else if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.twist = Math.atan2(b.y - a.y, b.x - a.x);
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
    if (!gesture.panned && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10) return;
    gesture.panned = true;
    if (gesture.turning) rig.rotate(dx * 0.006);
    else rig.pan(dx, dy, innerHeight);
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!pointers.size) rig.holding = false;
    if (!p || !gesture) return;
    if (pointers.size === 0) {
      if (!gesture.panned && e.type === "pointerup") tap(e.clientX, e.clientY);
      gesture = null;
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
    if (k === "n") rig.north();
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
  function tap(sx, sy) {
    $h("#cvMenuPanel").hidden = true;
    const hit = pick(sx, sy);
    if (T.targeting) {
      if (hit?.type === "city") fireSuper(hit.c);
      return;
    }
    if (!hit) return;
    const sel = [...T.selected].filter((v) => !v.dead);
    if (hit.type === "vehicle") {
      if (hit.v.owner === YOU) {
        if (T.selected.has(hit.v)) T.selected.delete(hit.v);
        else T.selected.add(hit.v);
        o.sfx("click");
      } else if (sel.some((v) => v.role === "military")) {
        orderTo(
          sel.filter((v) => v.role === "military"),
          { type: "vehicle", target: hit.v, x: hit.v.pos.x, z: hit.v.pos.z },
        );
        declareOn(hit.v.owner, "Your vehicles attacked theirs");
      } else toast(`A ${CITY_TYPES[hit.v.role].name.toLowerCase()} vehicle of the ${ownerName(hit.v.owner)}.`);
      return;
    }
    if (hit.type === "city") {
      const c = hit.c;
      if (sel.length && c.owner !== YOU) return orderTo(sel, { type: "city", city: c });
      if (sel.length && c.owner === YOU && sheet?.city !== c) {
        orderTo(sel, { type: "move", x: c.x, z: c.z + 20 });
        return;
      }
      openSheet("city", { city: c });
      return;
    }
    if (hit.type === "geyser") {
      if (sel.length) return orderTo(sel, { type: "geyser", geyser: hit.gz, x: hit.gz.x, z: hit.gz.z });
      return toast(hit.gz.owner === YOU ? "Your spice derrick: it pays you §" + SPICE_INCOME + " a second." : hit.gz.owner ? `A spice derrick of the ${ownerName(hit.gz.owner)}. Military vehicles can wreck it.` : "A spice geyser. Send any vehicle here to claim it.");
    }
    if (sel.length) orderTo(sel, { type: "move", x: hit.at.x, z: hit.at.z });
    else {
      if (sheet) closeSheet();
      inspect(hit.at);
    }
  }
  function declareOn(owner, why) {
    const n = nationOf(owner);
    if (!n || n.war) return;
    n.war = true;
    n.relation = clampRel(n.relation + DIPLO.attack);
    toast(`War with the ${n.name} nation! ${why}.`, 4);
    chronicle({ key: "civ:war:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: "Went to war with the " + n.name + " nation." });
    o.sfx("roar");
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
  const hostile = (a, b) => {
    if (!a || !b || a === b) return false;
    if (a !== YOU && b !== YOU) return false; // rival nations leave each other's vehicles alone
    const n = nationOf(a === YOU ? b : a);
    return !!n?.war;
  };
  function nearestFoeVehicle(v, radius) {
    let best = null,
      bd = radius;
    for (const u of T.vehicles) {
      if (u.dead || !hostile(v.owner, u.owner)) continue;
      const d = distXZ(v.pos, u.pos);
      if (d < bd) (best = u), (bd = d);
    }
    return best;
  }
  function hurtVehicle(v, dmg, by) {
    v.hp -= dmg;
    if (v.hp > 0) return;
    pop(v.pos.x, v.y + 2, v.pos.z, "💥");
    if (v.owner === YOU) toast("A vehicle was destroyed.");
    else if (by === YOU) o.sfx("roar", { gain: 0.3 });
    removeVehicle(v);
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
      const r = damageCity(c, v.unit.dps * dt, cityDefence(c, c.owner === YOU ? strengths : {}));
      if ((v.cool -= dt) <= 0) {
        v.cool = 0.5;
        shot(at, to, v.owner === YOU ? "you" : "foe");
      }
      if (r.captured) takeCity(c, v.owner, "military");
    } else if (v.role === "religious") {
      const faith = cityEconomy(c, ownerMods(c.owner)).faith;
      const done = preachTo(c, v.owner, preachRate(v.unit.preach, faith) * dt);
      const n = nationOf(c.owner);
      if (n && v.owner === YOU) n.relation = clampRel(n.relation + DIPLO.preach * dt);
      if ((v.cool -= dt) <= 0) {
        v.cool = 1.1;
        shot(at, to, "faith");
      }
      if (done) takeCity(c, v.owner, "religious");
    } else {
      const res = deliverTrade(c, v.owner, (v.unit.trade / 6) * dt);
      const n = nationOf(c.owner);
      if (n && v.owner === YOU) n.relation = clampRel(n.relation + (DIPLO.trade / 6) * dt);
      if (c.owner === YOU && v.owner !== YOU) nationOf(v.owner) && (nationOf(v.owner).relation = clampRel(nationOf(v.owner).relation + (DIPLO.trade / 12) * dt));
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
          // A rival economic nation buys a city once its trade is complete and it can afford it.
          const n = nationOf(v.owner),
            cost = buyoutCost(cityEconomy(c, {}), 0);
          // (Your own cities are never for sale: trade with you just pays you both.)
          if (n && n.money >= cost && c.owner !== YOU) {
            n.money -= cost;
            takeCity(c, v.owner, "economic");
          }
        }
      }
    }
  }
  function updateVehicle(v, dt) {
    const ord = v.order;
    // Military vehicles fight hostile vehicles that come near, whatever their orders.
    if (v.role === "military") {
      const foe = ord?.type === "vehicle" && !ord.target.dead ? ord.target : nearestFoeVehicle(v, 16);
      if (foe) {
        const d = distXZ(v.pos, foe.pos);
        if (d > 10) {
          drive(v, foe.pos.x, foe.pos.z, dt, 9);
          if (v.unreachable && ord?.type === "vehicle") v.order = null;
        } else {
          hurtVehicle(foe, v.unit.dps * dt, v.owner);
          if ((v.cool -= dt) <= 0) {
            v.cool = 0.45;
            shot(W(v.pos.x, v.y + 1.5, v.pos.z), W(foe.pos.x, foe.y + 1.2, foe.pos.z), v.owner === YOU ? "you" : "foe");
          }
        }
        return;
      }
      if (ord?.type === "vehicle") v.order = null;
    }
    if (ord?.type === "city") {
      const c = ord.city;
      if (c.owner === v.owner) return void (v.order = null);
      const goal = v.mode === "sea" ? c.sea || c : c;
      const left = drive(v, goal.x, goal.z, dt, RANGE[v.mode] + (v.mode === "sea" ? 0 : 3));
      if (v.unreachable) {
        v.order = null;
        if (v.owner === YOU) toast(`There is no way through to ${c.name}.`);
        return;
      }
      const inRange = v.mode === "sea" ? left <= RANGE.sea + 0.5 : left <= RANGE[v.mode] + 3.5;
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
    // Idle: park near home, and claim any free geyser close by.
    const home = T.cities[v.home] || capital();
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
        const d = distXZ(v.pos, c);
        const attacking = v.order?.city === c;
        const range = attacking ? Math.max(TURRET_RANGE, d + 1) : TURRET_RANGE;
        if (d > range) continue;
        const atWar = c.owner === null ? v.role === "military" && attacking : hostile(c.owner, v.owner) || (v.role === "military" && attacking);
        if (atWar && d < bd) (target = v), (bd = d);
      }
      if (!target) continue;
      hurtVehicle(target, def.dps * c.turretHp * dt * 0.6, c.owner);
      c.shotCool = (c.shotCool || 0) - dt;
      if (c.shotCool <= 0) {
        c.shotCool = 0.6;
        const k = Math.floor(Math.random() * c.turrets),
          t = turretSpot(c, k);
        shot(W(t.x, groundY(t.x, t.z) + 5, t.z), W(target.pos.x, target.y + 1, target.pos.z), c.owner === YOU ? "you" : "foe");
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
      n.money += (mine.reduce((s, c) => s + cityEconomy(c, {}).income, 0) + spiceIncomeOf(n.id) + tradeIncome(T.cities, n.id)) * dt;
      // Relations settle toward a resting point that falls as your nation grows: a rising power worries everyone.
      const rest = n.base - 6 * Math.max(0, yourCities().length - 1);
      if (!n.war) n.relation = clampRel(n.relation + Math.sign(rest - n.relation) * Math.min(Math.abs(rest - n.relation), DIPLO.drift * dt));
      // Growing their towns: a building or a turret now and then.
      if ((n.buildClock -= dt) <= 0) {
        n.buildClock = 45 + Math.random() * 30;
        const c = mine[Math.floor(Math.random() * mine.length)];
        const free = c.plots.indexOf(null);
        if (n.type === "military" && c.turrets < MAX_TURRETS && n.money > BUILD_COST.turret * 2) {
          c.turrets++;
          n.money -= BUILD_COST.turret;
          buildCity(c);
        } else if (free >= 0 && n.money > 120) {
          const role = ["house", "fun", "factory", "house", n.type === "religious" ? "temple" : "fun", "factory"][free];
          c.plots[free] = role;
          n.money -= BUILD_COST[role];
          buildCity(c);
        }
      }
      if ((n.clock -= dt) > 0) continue;
      n.clock = 4;
      const fleet = vehiclesOf(n.id);
      const plan = nationPlan(
        { type: n.type, relation: n.relation, war: n.war, money: n.money, vehicles: fleet.length, cap: vehicleCap(n.id) },
        { yourCities: yourCities().length, freeCities: citiesOf(null).length, grace: T.time < GRACE },
      );
      if (plan.declareWar) {
        n.war = true;
        toast(`The ${n.name} nation has declared war on you!`, 4.5);
        o.sfx("roar");
        chronicle({ key: "civ:attacked:" + n.id + ":" + Math.floor(T.time), stage: "civ", icon: "⚔", text: "The " + n.name + " nation declared war." });
      }
      n.vehicleClock = (n.vehicleClock ?? 10) - 4;
      if (plan.build && n.vehicleClock <= 0) {
        n.vehicleClock = 30;
        const c = mine[Math.floor(Math.random() * mine.length)];
        const modes = allowedModes(mine.length, c.coastal);
        const mode = modes.length > 1 && Math.random() < 0.35 ? modes[1 + Math.floor(Math.random() * (modes.length - 1))] : "land";
        const key = c.type + ":" + mode;
        n.money -= vehicleUnit(vehicleDesign(n.id, key)).cost;
        spawnVehicle(n.id, key, c);
      }
      // Spice: idle vehicles go and claim free geysers they can reach, and raiders wreck their enemies' derricks.
      if (T.time > 60)
        for (const v of fleet) {
          if (v.order || v.mode === "sea") continue;
          const taken = new Set(fleet.filter((u) => u.order?.type === "geyser").map((u) => u.order.geyser));
          const home = T.cities[v.home] || mine[0];
          const free = T.geysers
            .filter((g) => (!g.owner || (n.war && g.owner === YOU && v.role === "military")) && !taken.has(g) && canClaim(v, g) && distXZ(g, home) < 330)
            .sort((a, b) => distXZ(a, home) - distXZ(b, home))[0];
          if (free && Math.random() < 0.5) v.order = { type: "geyser", geyser: free, x: free.x, z: free.z };
        }
      // The first minute and a half is for building up, on every side.
      if (plan.target && T.time > 90) {
        const pool = plan.target === "you" ? yourCities() : citiesOf(null);
        for (const v of fleet) {
          if (v.order) continue;
          const reachable = pool.filter((c) => canReach(v.mode, c) && (v.mode !== "land" || map.continentAt(v.pos.x, v.pos.z) === c.continent));
          if (!reachable.length) continue;
          const home = T.cities[v.home] || mine[0];
          reachable.sort((a, b) => distXZ(a, home) - distXZ(b, home));
          // Economic and religious vehicles only go to cities they would actually work on.
          const c = reachable[0];
          if (v.role === "military" && plan.target === "you" && !n.war) continue;
          v.order = { type: "city", city: c };
          if (c.owner === YOU && v.role !== "economic") tipOnce("incoming:" + v.role, v.role === "military" ? `Enemy vehicles are heading for ${c.name}! Turrets and your own military vehicles will fight them.` : `Missionaries from the ${n.name} nation are preaching to ${c.name}. Temples help it resist.`, 5);
        }
      }
    }
  }
  /** Your own military vehicles defend your cities: idle ones within reach go after attackers. */
  function autoDefend() {
    for (const c of yourCities()) {
      const raiders = T.vehicles.filter((v) => !v.dead && v.owner !== YOU && v.order?.city === c && distXZ(v.pos, c) < 40);
      if (!raiders.length) continue;
      for (const v of vehiclesOf(YOU))
        if (!v.order && v.role === "military" && distXZ(v.pos, c) < 70 && hostile(YOU, raiders[0].owner)) v.order = { type: "vehicle", target: raiders[0], x: raiders[0].pos.x, z: raiders[0].pos.z };
    }
  }

  /* ---- HUD refresh -------------------------------------------------------------------------------------- */
  const spiceIncomeOf = (owner) => T.geysers.filter((g) => g.owner === owner).reduce((s, g) => s + SPICE_INCOME * g.yield, 0);
  const income = () => yourCities().reduce((s, c) => s + cityEconomy(c, ownerMods(YOU)).income, 0) + spiceIncomeOf(YOU) + tradeIncome(T.cities, YOU);
  let hudClock = 0,
    liveClock = 1;
  const marks = new Map();
  const spiceMarks = new Map();
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
      if (m._html !== html) m.innerHTML = m._html = html;
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
  }
  function updateHUD() {
    $h("#cvMoney").textContent = Math.floor(T.money);
    $h("#cvIncome").textContent = "+" + income().toFixed(1) + "/s";
    $h("#cvCities").textContent = yourCities().length + "/" + T.cities.length;
    $h("#cvVeh").textContent = vehiclesOf(YOU).length + "/" + vehicleCap(YOU);
    const left = T.cities.length - yourCities().length;
    $h("#cvGoal").textContent = T.won ? `${CIV_CARDS[T.card]?.icon || "✦"} The world is united` : left ? `Unite the planet: ${left} ${left === 1 ? "city" : "cities"} to go` : "";
    $h("#cvNations").innerHTML = T.nations
      .map((n) => {
        const col = n.war ? "#ef4b48" : n.relation >= DIPLO.allyAt ? "#3fc26e" : n.relation >= 20 ? "#8fd18f" : n.relation > -20 ? "#b9c3c9" : "#f0a04b";
        return `<button class="trTribe cvNation" role="listitem" data-nation="${n.id}" style="--rel:${col}" aria-label="${esc(n.name)} nation, ${relationWord(n.relation, n.war)}${n.alive ? "" : ", fallen"}" ${n.alive ? "" : 'aria-disabled="true"'}><span>${n.alive ? CITY_TYPES[n.type].icon : "🏳"}</span></button>`;
      })
      .join("");
    $h("#cvNations")
      .querySelectorAll("[data-nation]")
      .forEach((b) => (b.onclick = () => openSheet("nation", { nation: nationOf(b.dataset.nation) })));
    const mineV = vehiclesOf(YOU);
    $h("#cvUnits").innerHTML = mineV
      .map((v) => `<button class="trUnit cvUnit ${T.selected.has(v) ? "sel" : ""} ${v.hp / v.unit.hp < 0.35 ? "low" : ""}" role="listitem" data-veh="${v.id}" aria-label="${CITY_TYPES[v.role].name} ${MODE_NAME[v.mode].toLowerCase()} vehicle${T.selected.has(v) ? ", selected" : ""}" aria-pressed="${T.selected.has(v)}"><span class="noPic">${MODE_ICON[v.mode]}</span><em>${CITY_TYPES[v.role].icon}</em><i><b style="width:${Math.round((v.hp / v.unit.hp) * 100)}%"></b></i></button>`)
      .join("");
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
    const s = superState();
    const sb = $h("#cvSuper");
    sb.innerHTML = `<span>${s.def.icon}</span><small>${s.unlocked ? (T.superCool > 0 ? Math.ceil(T.superCool) + "s" : "§" + SUPER_COST) : "Locked"}</small>`;
    sb.setAttribute("aria-label", `${s.def.name}: ${s.def.desc}${s.unlocked ? "" : " Locked until you hold half the cities."}`);
    sb.setAttribute("aria-disabled", String(!s.ready));
  }
  $h("#cvAll").onclick = () => {
    if (T.selected.size && T.selected.size === vehiclesOf(YOU).length) T.selected.clear();
    else selectAll();
    updateHUD();
  };
  $h("#cvHome").onclick = goCapital;
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
  $h("#cvDesignsMenu").onclick = openDesigns;
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
      cities: T.cities.map((c) => ({ id: c.id, owner: c.owner, type: c.type, plots: c.plots, turrets: c.turrets, turretHp: c.turretHp, hallHp: c.hallHp, trade: c.trade, conv: c.conv, unrest: c.unrest })),
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
      flora.update(camera, focus, rig.distance);
      updateDetail();
      $h("#cvNeedle").setAttribute("transform", `rotate(${((-rig.heading() * 180) / Math.PI).toFixed(1)} 12 12)`);
      if (regionT > 0 && (regionT -= dt) <= 0) closeRegion();
      if (!T.lost && !(sheet && (sheet.kind === "won" || sheet.kind === "lost"))) {
        T.time += dt;
        T.superCool = Math.max(0, T.superCool - dt);
        T.money += income() * dt;
        for (const v of [...T.vehicles]) if (!v.dead) updateVehicle(v, dt);
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
