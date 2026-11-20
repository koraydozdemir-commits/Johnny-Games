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
import { ISLAND, createIsland, heightAt } from "../creature/world.js";
import { CUTSCENES, ease, mix, span } from "../cinematics.js";
import { steerAround } from "../creature/world.js";
import { generateSpecies } from "../creature/species.js";
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
const SEA_RING = ISLAND.shore + 14;
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
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 900);
  const save = o.save || null;
  const world = createIsland(scene, o.quality, o.regionId || "coast", { fossils: false });
  scene.fog.near = 180;
  scene.fog.far = 520;
  const legacy = civLegacy(o.legacy || {});
  const mods = legacy.mods;
  const chronicle = (ev) => o.onChronicle?.(ev);
  const HOME = { x: ISLAND.nest.x, z: ISLAND.nest.z };
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
    wall: new THREE.TorusGeometry(15, 0.45, 6, 48).rotateX(Math.PI / 2),
    plaza: new THREE.CircleGeometry(15, 40).rotateX(-Math.PI / 2),
    plot: new THREE.CircleGeometry(2.6, 18).rotateX(-Math.PI / 2),
    vent: new THREE.CylinderGeometry(1.4, 2.2, 0.8, 10),
    plume: new THREE.ConeGeometry(1.1, 5, 10, 1, true),
    derrick: new THREE.CylinderGeometry(0.35, 1.3, 5, 4),
    flag: new THREE.PlaneGeometry(1.4, 0.9),
    ring: new THREE.RingGeometry(1.6, 2.1, 24).rotateX(-Math.PI / 2),
  };
  const sharedMat = {
    plaza: plain(0xcfc4a8),
    plot: plain(0xa89c80),
    vent: plain(0x6b5a48),
    plume: new THREE.MeshBasicMaterial({ color: 0xffa14a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    derrick: plain(0x3a3f45),
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

  /* ---- cities -------------------------------------------------------------------------------------- */
  // Your capital where your village stood; ten more cities on the island's other nest sites: two for
  // each rival nation (the nearer ones for the friendlier nations) and the rest independent.
  {
    const sites = world.nestSites.filter((s) => Math.hypot(s.x - HOME.x, s.z - HOME.z) > 40).slice(0, 10);
    const owners = [YOU, "n1", "n2", "n0", null, "n1", "n2", "n0", null, null, null];
    [HOME, ...sites].forEach((site, i) => {
      const saved = save?.cities[i];
      const owner = saved ? saved.owner : owners[i] === undefined ? null : owners[i];
      const nat = nationOf(owner);
      const type = saved ? saved.type : owner === YOU ? T.startType : nat ? nat.type : TYPE_IDS[i % 3];
      // Rivals start with a working town; independents with a couple of houses and a turret.
      const startPlots = owner === YOU ? ["house", "factory", null, null, null, null] : nat ? ["house", "factory", "fun", "house", null, null] : ["house", "house", null, null, null, null];
      const dist = Math.hypot(site.x, site.z);
      const city = {
        id: i,
        x: site.x,
        z: site.z,
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
        coastal: ISLAND.shore - dist < 48,
        group: null,
        calm: 99,
        mark: null,
      };
      // Where sea vehicles anchor off this city: straight out from the island's centre.
      const ang = Math.atan2(site.z, site.x);
      let r = dist;
      while (r < ISLAND.shore + 40 && heightAt(Math.cos(ang) * r, Math.sin(ang) * r) > -0.6) r += 2;
      city.sea = { x: Math.cos(ang) * (r + 4), z: Math.sin(ang) * (r + 4), r: r + 4 };
      T.cities.push(city);
    });
  }
  const yourCities = () => T.cities.filter((c) => c.owner === YOU);
  const citiesOf = (owner) => T.cities.filter((c) => c.owner === owner);
  const capital = () => T.cities[0].owner === YOU ? T.cities[0] : yourCities()[0] || T.cities[0];
  const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const groundY = (x, z) => Math.max(0, heightAt(x, z));

  const ownerDesign = (owner, role) => {
    if (owner === YOU) return T.designs.building[role];
    const colors = nationOf(owner)?.colors || { base: 0xd9d4c8, accent: INDEPENDENT_COLOR, trim: 0x3a3f45 };
    return { ...STARTER_DESIGNS.building[role], colors };
  };
  const plotSpot = (c, k) => {
    const a = (k / PLOTS) * TAU + TAU / 12;
    return { x: c.x + Math.cos(a) * 9, z: c.z + Math.sin(a) * 9 };
  };
  const turretSpot = (c, k) => {
    const a = (k / MAX_TURRETS) * TAU - Math.PI / 2;
    return { x: c.x + Math.cos(a) * 15, z: c.z + Math.sin(a) * 15 };
  };
  function placeModel(group, design, at, scale, face = 0) {
    const m = buildDesignMesh(design, { materials: matsFor(design.colors) });
    m.root.scale.setScalar(scale);
    m.root.position.set(at.x, groundY(at.x, at.z), at.z);
    m.root.rotation.y = face;
    group.add(m.root);
    return m;
  }
  function buildCity(c) {
    if (c.group) {
      c.models.forEach((m) => m.dispose());
      c.wallMat.dispose();
      scene.remove(c.group);
    }
    const g = new THREE.Group();
    c.models = [];
    c.wallMat = plain(ownerColor(c.owner));
    const gy = groundY(c.x, c.z);
    const plaza = new THREE.Mesh(sharedGeo.plaza, sharedMat.plaza);
    plaza.position.set(c.x, gy + 0.05, c.z);
    g.add(plaza);
    const wall = new THREE.Mesh(sharedGeo.wall, c.wallMat);
    wall.position.set(c.x, gy + 0.3, c.z);
    g.add(wall);
    const face = (p) => Math.atan2(c.x - p.x, c.z - p.z);
    c.models.push(placeModel(g, ownerDesign(c.owner, "hall"), c, SCALE.hall));
    for (let k = 0; k < PLOTS; k++) {
      const at = plotSpot(c, k);
      if (c.plots[k]) c.models.push(placeModel(g, ownerDesign(c.owner, c.plots[k]), at, SCALE.building, face(at)));
      else {
        const pad = new THREE.Mesh(sharedGeo.plot, sharedMat.plot);
        pad.position.set(at.x, groundY(at.x, at.z) + 0.06, at.z);
        g.add(pad);
      }
    }
    for (let k = 0; k < c.turrets; k++) {
      const at = turretSpot(c, k);
      c.models.push(placeModel(g, ownerDesign(c.owner, "turret"), at, SCALE.building * 0.9, face(at)));
    }
    c.group = g;
    scene.add(g);
  }

  /* ---- spice geysers ------------------------------------------------------------------------------ */
  {
    let seed = 1337 + (o.regionId || "").length * 101;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let tries = 0; T.geysers.length < 9 && tries < 4000; tries++) {
      const a = rnd() * TAU,
        r = 30 + rnd() * (ISLAND.beach - 40);
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (heightAt(x, z) < 0.5 || !world.isOpen(x, z, 4, ISLAND.beach)) continue;
      if (T.cities.some((c) => Math.hypot(c.x - x, c.z - z) < 30)) continue;
      if (T.geysers.some((g) => Math.hypot(g.x - x, g.z - z) < 35)) continue;
      const saved = save?.geysers[T.geysers.length];
      T.geysers.push({ id: T.geysers.length, x, z, owner: saved ? saved.owner : null, hp: saved ? saved.hp : 1, group: null });
    }
  }
  function buildGeyser(gz) {
    if (gz.group) {
      gz.flagMat?.dispose();
      scene.remove(gz.group);
    }
    const g = new THREE.Group();
    const gy = groundY(gz.x, gz.z);
    g.position.set(gz.x, gy, gz.z);
    const vent = new THREE.Mesh(sharedGeo.vent, sharedMat.vent);
    vent.position.y = 0.4;
    g.add(vent);
    if (gz.owner) {
      const tower = new THREE.Mesh(sharedGeo.derrick, sharedMat.derrick);
      tower.position.y = 3;
      g.add(tower);
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
    if (owner === YOU) return T.designs.vehicle[key];
    const [role, mode] = key.split(":");
    return starterVehicle(role, mode, nationOf(owner)?.colors);
  };
  function spawnVehicle(owner, key, city, at = null, hpFrac = 1) {
    const design = vehicleDesign(owner, key);
    const unit = vehicleUnit(design, unitMods(owner));
    const [role, mode] = key.split(":");
    let start = at || (mode === "sea" ? city.sea : { x: city.x + (Math.random() - 0.5) * 8, z: city.z + 17 * (Math.random() < 0.5 ? 1 : -1) });
    if (mode === "land" && !at) start = world.resolve(start.x, start.z, 1.6);
    const model = buildDesignMesh(design, { materials: matsFor(design.colors) });
    model.root.scale.setScalar(SCALE.vehicle);
    const ring = new THREE.Mesh(sharedGeo.ring, owner === YOU ? sharedMat.sel : sharedMat.foe);
    ring.visible = false;
    ring.renderOrder = 5;
    const g = new THREE.Group();
    g.add(model.root, ring);
    scene.add(g);
    const v = { id: nextVehicleId++, owner, key, role, mode, unit, model, group: g, ring, pos: { x: start.x, z: start.z }, y: 0, heading: Math.random() * TAU, hp: unit.hp * hpFrac, home: city.id, order: null, cool: 0, bob: Math.random() * 10, dead: false };
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
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
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
  const v3 = new THREE.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight, on: v3.z < 1 && v3.z > -1 };
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
      <div class="tsStats cvCityStats"><span><b>${econ.pop}k</b>people</span><span><b>${econ.happiness > 0 ? "+" : ""}${econ.happiness}</b>${econ.riot ? "rioting!" : "happiness"}</span><span><b>${econ.income.toFixed(1)}</b>§ / s</span><span><b>${c.turrets}</b>turrets</span></div>`;
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
      <div class="tsBtns tsWide"><button class="good" id="cvKeep">Keep playing</button></div>`;
  }
  function lostHtml() {
    return `<div class="tsHead"><b>Your nation has fallen</b></div>
      <p class="tsWonText">Every one of your cities now flies another flag.</p>
      <div class="tsBtns tsWide"><button class="good" id="cvRestart">Start the Civilization Stage again</button></div>`;
  }
  function helpHtml() {
    return `<div class="tsHead"><b>Civilization Stage · how to play</b><button class="tsClose" aria-label="Close">✕</button></div>
      <ul class="tsHelp">
        <li><b>Look around:</b> drag to move, pinch or scroll to zoom.</li>
        <li><b>Your cities:</b> tap one to build houses (people), factories (money, but unhappy people), entertainment (happiness), temples (faith) and turrets.</li>
        <li><b>Vehicles:</b> each city makes vehicles of its own kind. Tap vehicles (or 🚙 All) to select them, then tap a city, a spice geyser or the ground.</li>
        <li><b>Take cities</b> three ways: ⚔ military vehicles knock out turrets and then the hall; 💰 economic vehicles trade until you can buy the city; 🕊 religious vehicles preach until it converts. Every city you take makes vehicles of its kind.</li>
        <li><b>Spice:</b> drive any vehicle to a geyser to claim it. Each one pays you. Military vehicles can wreck a rival's derrick.</li>
        <li><b>Nations:</b> tap a nation at the top for gifts and peace. Military nations go to war with those they hate; religious ones preach; economic ones trade.</li>
        <li><b>Superweapon:</b> hold half the island's cities and it's yours: one city at a time, the way you've been winning them.</li>
        <li><b>Goal:</b> unite every city on the island under your flag. How you do it decides your card.</li>
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
    on("#cvFocus", () => {
      cam.x = sheet.city.x;
      cam.z = sheet.city.z;
    });
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
  function orderTo(list, order) {
    let refused = 0;
    for (const v of list) {
      if (v.dead || v.owner !== YOU) continue;
      if (order.type === "city" && !canReach(v.mode, order.city)) {
        refused++;
        continue;
      }
      v.order = { ...order };
    }
    if (refused) toast("Boats can only reach cities on the coast.");
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
    flashMesh.position.set(p.x, groundY(p.x, p.z) + 0.3, p.z);
    flashMesh.scale.setScalar(p.group ? 5 : 1);
    flashT = 0.6;
  }

  /* ---- camera and input ----------------------------------------------------------------------------- */
  const cam = { x: HOME.x, z: HOME.z - 20, dist: 115, sx: HOME.x, sz: HOME.z - 20, sd: 115 };
  const PITCH = { up: 0.78, back: 0.62 };
  /* Arriving from the Tribal Stage's dawn: the camera comes down out of the bright sky onto your city. */
  let arrive = o.intro === "arrive" && o.frame ? { t: 0, k: o.reducedMotion?.() ? 1 / 0.6 : 1, frame: o.frame, titled: false } : null;
  if (!arrive) o.frame?.remove();
  else {
    o.frame.title(false);
    hud.classList.add("cine"); // the city labels and buttons come in once the camera has landed
  }
  function placeCamera(dt) {
    const k = 1 - Math.exp(-dt * 10);
    cam.sx += (cam.x - cam.sx) * k;
    cam.sz += (cam.z - cam.sz) * k;
    cam.sd += (cam.dist - cam.sd) * k;
    const gy = groundY(cam.sx, cam.sz);
    camera.position.set(cam.sx, gy + cam.sd * PITCH.up, cam.sz + cam.sd * PITCH.back);
    camera.lookAt(cam.sx, gy, cam.sz);
    if (!arrive) return;
    const a = arrive;
    a.t += dt * a.k;
    const T = CUTSCENES.civArrive.end;
    if (a.t > 0.15) a.frame.flash(false);
    if (a.t > 0.8 && !a.titled) {
      a.titled = true;
      a.frame.title(true, o.name || "Your nation", "Civilization Stage");
    }
    if (a.t > T - 0.9) a.frame.title(false);
    const e = ease(span(a.t, 0, T));
    camera.position.set(cam.sx, mix(gy + 320, camera.position.y, e), mix(cam.sz + 40, camera.position.z, e));
    camera.lookAt(cam.sx, gy, cam.sz);
    if (a.t >= T) {
      a.frame.remove();
      arrive = null;
      hud.classList.remove("cine");
      a.after?.();
    }
  }
  function clampCam() {
    const d = Math.hypot(cam.x, cam.z),
      max = ISLAND.shore + 30;
    if (d > max) {
      cam.x *= max / d;
      cam.z *= max / d;
    }
    cam.dist = Math.max(30, Math.min(220, cam.dist));
  }
  const ray = new THREE.Raycaster();
  function groundAt(px, py) {
    ray.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
    const { origin, direction } = ray.ray;
    if (direction.y >= -0.01) return null;
    for (let t = 2, prev = 0; t < 900; prev = t, t += 2) {
      const y = origin.y + direction.y * t;
      if (y <= groundY(origin.x + direction.x * t, origin.z + direction.z * t)) {
        let lo = prev,
          hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (origin.y + direction.y * mid <= groundY(origin.x + direction.x * mid, origin.z + direction.z * mid)) hi = mid;
          else lo = mid;
        }
        return { x: origin.x + direction.x * hi, z: origin.z + direction.z * hi };
      }
    }
    return null;
  }
  const pointers = new Map();
  let gesture = null;
  const onDown = (e) => {
    if (paused || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) gesture = { panned: false, pinch: 0 };
    else if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
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
      if (gesture.pinch > 0 && d > 0) cam.dist *= gesture.pinch / d;
      gesture.pinch = d;
      clampCam();
      return;
    }
    if (!gesture.panned && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10) return;
    gesture.panned = true;
    const wpp = (2 * cam.sd * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
    cam.x -= dx * wpp;
    cam.z -= (dy * wpp) / PITCH.up;
    clampCam();
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || !gesture) return;
    if (pointers.size === 0) {
      if (!gesture.panned && e.type === "pointerup") tap(e.clientX, e.clientY);
      gesture = null;
    }
  };
  const onWheel = (e) => {
    if (paused || e.target !== canvas) return;
    e.preventDefault();
    cam.dist *= Math.exp(e.deltaY * 0.0012);
    clampCam();
  };
  const keys = new Set();
  const onKey = (e) => {
    if (paused || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) return;
    if (e.key === "Escape") {
      if (T.targeting) stopTargeting();
      else if (sheet) closeSheet();
      else T.selected.clear();
      return;
    }
    if (e.key.toLowerCase() === "a" && e.ctrlKey) {
      e.preventDefault();
      selectAll();
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
    else if (sheet) closeSheet();
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
    if (v.mode === "air") v.y = groundY(v.pos.x, v.pos.z) + 13 + Math.sin(v.bob * 1.4) * 0.4;
    else if (v.mode === "sea") v.y = Math.sin(v.bob * 1.8) * 0.12;
    else v.y = groundY(v.pos.x, v.pos.z);
    v.group.position.set(v.pos.x, v.y, v.pos.z);
    v.model.root.rotation.y = v.heading;
    v.ring.position.y = v.mode === "air" ? -v.y + groundY(v.pos.x, v.pos.z) + 0.2 : 0.2;
    v.ring.visible = T.selected.has(v);
  }
  /** Move toward a point; returns the distance left. */
  function drive(v, x, z, dt, stop = 1) {
    let dx = x - v.pos.x,
      dz = z - v.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return d;
    if (v.mode === "sea") {
      // Boats keep to the water: round the island on the sea ring, then in to the anchorage.
      const r = Math.hypot(v.pos.x, v.pos.z);
      const a = Math.atan2(v.pos.z, v.pos.x),
        ta = Math.atan2(z, x);
      let da = ta - a;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) * r > 18) {
        const ring = Math.max(SEA_RING, Math.hypot(x, z));
        const tx = Math.cos(a + Math.sign(da) * 0.25) * ring,
          tz = Math.sin(a + Math.sign(da) * 0.25) * ring;
        dx = tx - v.pos.x;
        dz = tz - v.pos.z;
      }
    }
    let dir = { x: dx / (Math.hypot(dx, dz) || 1), z: dz / (Math.hypot(dx, dz) || 1) };
    if (v.mode === "land") dir = steerAround(v.pos.x, v.pos.z, dir.x, dir.z, 1.6, 10);
    const step = Math.min(d - stop + 0.01, v.unit.speed * dt);
    let nx = v.pos.x + dir.x * step,
      nz = v.pos.z + dir.z * step;
    if (v.mode === "land") {
      const r = world.resolve(nx, nz, 1.4);
      nx = r.x;
      nz = r.z;
      // Land vehicles stop at the water's edge.
      if (heightAt(nx, nz) < 0.1) {
        const k = (ISLAND.beach - 2) / Math.max(1, Math.hypot(nx, nz));
        if (k < 1) (nx *= k), (nz *= k);
      }
    } else if (v.mode === "sea" && heightAt(nx, nz) > -0.4) {
      // Ran aground: push back out to sea.
      const r = Math.hypot(nx, nz) || 1;
      nx += (nx / r) * step;
      nz += (nz / r) * step;
    }
    v.heading = Math.atan2(nx - v.pos.x, nz - v.pos.z);
    v.pos.x = nx;
    v.pos.z = nz;
    return d - step;
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
    const at = { x: v.pos.x, y: v.y + 1.5, z: v.pos.z },
      to = { x: c.x, y: groundY(c.x, c.z) + 4, z: c.z };
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
        if (d > 10) drive(v, foe.pos.x, foe.pos.z, dt, 9);
        else {
          hurtVehicle(foe, v.unit.dps * dt, v.owner);
          if ((v.cool -= dt) <= 0) {
            v.cool = 0.45;
            shot({ x: v.pos.x, y: v.y + 1.5, z: v.pos.z }, { x: foe.pos.x, y: foe.y + 1.2, z: foe.pos.z }, v.owner === YOU ? "you" : "foe");
          }
        }
        return;
      }
      if (ord?.type === "vehicle") v.order = null;
    }
    if (ord?.type === "city") {
      const c = ord.city;
      if (c.owner === v.owner) return void (v.order = null);
      const goal = v.mode === "sea" ? c.sea : c;
      const left = drive(v, goal.x, goal.z, dt, RANGE[v.mode] + (v.mode === "sea" ? 0 : 3));
      const inRange = v.mode === "sea" ? left <= RANGE.sea + 0.5 : left <= RANGE[v.mode] + 3.5;
      if (inRange) actAt(v, c, dt);
      return;
    }
    if (ord?.type === "move" || ord?.type === "geyser") {
      if (drive(v, ord.x, ord.z, dt, ord.type === "geyser" ? 3 : 2) <= (ord.type === "geyser" ? 3.2 : 2.2)) {
        if (ord.type === "geyser") claimGeyser(ord.geyser, v, dt);
        else v.order = null;
      }
      return;
    }
    // Idle: park near home, and claim any free geyser close by.
    const home = T.cities[v.home] || capital();
    const free = T.geysers.find((g) => !g.owner && distXZ(g, v.pos) < 28);
    if (free) v.order = { type: "geyser", geyser: free, x: free.x, z: free.z };
    else if (distXZ(v.pos, home) > 30) drive(v, home.x, home.z + 20, dt, 18);
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
        pop(g.x, 6, g.z, "💥");
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
      tipOnce("spice", `Spice! Each derrick pays you §${SPICE_INCOME} a second.`);
      chronicle({ key: "civ:spice:first", stage: "civ", icon: "🌶", text: "Claimed the first spice geyser." });
    }
  }
  function updateTurrets(dt) {
    for (const c of T.cities) {
      repairCity(c, dt);
      calmUnrest(c, dt);
      // Conversion fades while nobody is preaching.
      for (const k of Object.keys(c.conv)) {
        if (T.vehicles.some((v) => v.owner === k && !v.dead && v.order?.city === c && v.role === "religious" && distXZ(v.mode === "sea" ? c.sea : c, v.pos) < 20)) continue;
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
        shot({ x: t.x, y: groundY(t.x, t.z) + 5, z: t.z }, { x: target.pos.x, y: target.y + 1, z: target.pos.z }, c.owner === YOU ? "you" : "foe");
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
      n.money += (mine.reduce((s, c) => s + cityEconomy(c, {}).income, 0) + T.geysers.filter((g) => g.owner === n.id).length * SPICE_INCOME + tradeIncome(T.cities, n.id)) * dt;
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
      // The first minute and a half is for building up, on every side.
      if (plan.target && T.time > 90) {
        const pool = plan.target === "you" ? yourCities() : citiesOf(null);
        for (const v of fleet) {
          if (v.order) continue;
          const reachable = pool.filter((c) => canReach(v.mode, c));
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
  const income = () => yourCities().reduce((s, c) => s + cityEconomy(c, ownerMods(YOU)).income, 0) + T.geysers.filter((g) => g.owner === YOU).length * SPICE_INCOME + tradeIncome(T.cities, YOU);
  let hudClock = 0,
    liveClock = 1;
  const marks = new Map();
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
      m.hidden = !p.on || cam.sd > 200;
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
  function updateHUD() {
    $h("#cvMoney").textContent = Math.floor(T.money);
    $h("#cvIncome").textContent = "+" + income().toFixed(1) + "/s";
    $h("#cvCities").textContent = yourCities().length + "/" + T.cities.length;
    $h("#cvVeh").textContent = vehiclesOf(YOU).length + "/" + vehicleCap(YOU);
    const left = T.cities.length - yourCities().length;
    $h("#cvGoal").textContent = T.won ? `${CIV_CARDS[T.card]?.icon || "✦"} The world is united` : left ? `Unite the island: ${left} ${left === 1 ? "city" : "cities"} to go` : "";
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
            cam.x = v.pos.x;
            cam.z = v.pos.z;
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
  $h("#cvHome").onclick = () => {
    const c = capital();
    cam.x = c.x;
    cam.z = c.z;
  };
  $h("#cvCity").onclick = () => {
    const mine = yourCities();
    if (!mine.length) return;
    const c = mine.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z))[0];
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

  /* ---- saving --------------------------------------------------------------------------------------------- */
  function saveState() {
    const data = {
      v: 1,
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
  for (const sv of save?.vehicles || []) {
    const [role, mode] = sv.design.split(":");
    if (!TYPE_IDS.includes(role) || !["land", "sea", "air"].includes(mode)) continue;
    if (sv.owner !== YOU && !nationOf(sv.owner)?.alive) continue;
    const home = T.cities[sv.city] || capital();
    spawnVehicle(sv.owner, sv.design, home, { x: sv.x, z: sv.z }, sv.hp);
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
  updateHUD();
  let saveClock = 15;

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
      // Arrow keys and WASD pan the map.
      const kx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0),
        kz = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      if (kx || kz) {
        cam.x += kx * cam.dist * 0.9 * dt;
        cam.z += kz * cam.dist * 0.9 * dt;
        clampCam();
      }
      placeCamera(dt);
      // Cities keep office hours: the Civilization Stage stays in daylight.
      world.setTimeOfDay(0.22);
      world.update(dt, { x: cam.sx, z: cam.sz });
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
        c.wallMat?.dispose();
      });
      T.geysers.forEach((g) => g.flagMat?.dispose());
      shots.forEach((s) => s.line.geometry.dispose());
      Object.values(shotMat).forEach((m) => m.dispose());
      matCache.forEach((set) => Object.values(set).forEach((m) => m.dispose()));
      Object.values(sharedGeo).forEach((g) => g.dispose());
      Object.values(sharedMat).forEach((m) => m.dispose());
      flashGeo.dispose();
      flashMat.dispose();
      world.dispose();
      hud.remove();
    },
    debug: {
      T,
      cam,
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
    },
  };
}
