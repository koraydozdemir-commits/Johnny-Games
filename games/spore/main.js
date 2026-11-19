import * as THREE from "three";
import { buildCellBody, getQuality, pointInPolygon, QUALITY_PRESETS, setQuality, snapPartsToSurface, surfacePoint } from "./gfx/body.js";
import { createBackground, createWaterFx } from "./gfx/background.js";
import { createFoodBatch, createFoodModel } from "./gfx/food.js";
import { createDebris, createPlantColony } from "./gfx/flora.js";
import { createFxPool } from "./gfx/fx.js";
import { ZONES, plantShareIn, zoneAt } from "./cell/zones.js";
import { GROWTH_STAGES, LAST_TIER, meteorPool, preyFor, stageFor, stageScale, unlockHint } from "./stages.js";
import { dietPath } from "./traits.js";
import { createTipEngine } from "./tutorials.js";
import { hideTip, openHistoryScreen, pathScreenOpen, popCard, showTip, showTraitCard, updateDietMeter } from "./progression-ui.js";
import { CELL_PASSIVES, INSTINCTS, instinctCard, leaningFor, profileOf, readLedger, seedLedger } from "./creature/identity.js";
import { createAudio } from "./audio.js";
import { loadSettings, openSettings, saveSettings } from "./settings.js";
import { createTribeStage, loadTribeSave } from "./tribe/stage.js";
import { createCivStage } from "./civ/stage.js";
import { CIV_CARDS, CIV_SAVE_KEY, readCivSave } from "./civ/rules.js";
import { markSaved } from "./slots.js";
import { capsuleGap, leadTarget, pointCapsuleGap, resolveCollisions, steerHeading, strokePulse } from "./cell-physics.js";
import { createCreatureStage } from "./creature/stage.js";
import { openCreatureEditor } from "./creature/editor.js";
import { buildCreatureBody } from "./creature/body3d.js";
import { CREATURE_SAVE_KEY, creatureFromCell, creaturePartIds, partsLimit } from "./creature/format.js";
import { CREATURE_CARDS, DIET_CARDS } from "./traits.js";
import { CHRONICLE_KEY, TRIBE_LEGACY, addEvent, creatureCardFor, eventsFromSaves, readChronicle, trackSummary, tribeLegacy } from "./lineage.js";
import { regionById } from "./creature/regions.js";
import { openStore } from "./universe/store.js";
import { bootUniverses, createUniverse, currentKeys, parkActive } from "./universe/manager.js";
import { newSeed, summarize, uniqueName } from "./universe/model.js";
import { pedia as pediaStore } from "./universe/pedia-store.js";
import { emptyPedia } from "./pedia/model.js";
import { createSession } from "./universe/session.js";
import { openUniverses } from "./universe/ui.js";
import { openGalaxy } from "./galaxy/ui.js";
import { createGalaxyStart } from "./galaxy/start.js";
import { openPedia } from "./pedia/ui.js";
import { openEcoLibrary } from "./ecolib/ui.js";
import { setHomeworld } from "./ecolib/homeworld.js";
import { asPedia, listGlobal, putGlobal, updateGlobal } from "./universe/global.js";
import { readCreation } from "./creations/format.js";
import { openModularEditor } from "./creations/editor.js";
import { STARTER_DESIGNS } from "./creations/modular.js";
import { CREATURE_PARTS } from "./creature/parts.js";
import { STARTER_MOUTHS, earnedMouths, progressOf } from "./creature/mouths.js";
import { partThumb } from "./creature/part-thumbs.js";
import { timeUniform } from "./gfx/materials.js";
import { renderCellSnapshot, renderPartThumbnails } from "./gfx/thumbs.js";
import { SPECIES, chooseSpecies, speciesRecord } from "./species.js";
import {
  createCellRecord,
  defaultNodes as defaultSpine,
  makeRng,
  mutateCellRecord,
  randomStarterCell,
  storeCellRecord,
  writeHandoff,
} from "./cell-format.js";
const $ = (s) => document.querySelector(s),
  canvas = $("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#12396a");
const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 120);
camera.position.set(0, 0, 30);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xd6f2ff, 0x1a2d5c, 1.5));
const keyLight = new THREE.DirectionalLight(0xfff0d8, 2.1);
keyLight.position.set(-5, 7, 12);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x51cfff, 30, 30);
rimLight.position.set(4, 2, 10);
scene.add(rimLight);
const QUALITY_KEY = "johnny-spore-quality";
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem(QUALITY_KEY);
  } catch (e) {}
  setQuality(saved && QUALITY_PRESETS[saved] ? saved : matchMedia("(pointer: coarse)").matches ? "medium" : "high");
})();
/* Adaptive resolution: if frames run slow for a couple of seconds, render fewer pixels (down to 60%
   of the quality preset) and creep back up when there's headroom. Every feature stays on. */
const perf = { time: 0, frames: 0, scale: 1 };
const basePixelRatio = () => Math.min(devicePixelRatio, QUALITY_PRESETS[getQuality()].pixelRatio);
renderer.setPixelRatio(basePixelRatio() * perf.scale);
const background = createBackground(scene, getQuality());
// Gentle underwater wobble over the whole picture (off on low quality and in the editor).
const waterFx = createWaterFx(renderer);
waterFx.setQuality(getQuality());
const softGlowTexture = background.glowTexture;
const world = new THREE.Group();
scene.add(world);
const editorStage = new THREE.Group();
scene.add(editorStage);
// A calm, flat stage: a soft disc with one thin rim so the cell is the only thing with detail.
const editorDisk = new THREE.Mesh(
  new THREE.CircleGeometry(5.8, 96),
  new THREE.MeshBasicMaterial({ color: 0x1a5f8c, transparent: true, opacity: 0.32, depthWrite: false }),
);
editorDisk.position.z = -1.5;
editorStage.add(editorDisk);
const editorRim = new THREE.Mesh(
  new THREE.RingGeometry(5.7, 5.8, 128),
  new THREE.MeshBasicMaterial({ color: 0x7bd6d0, transparent: true, opacity: 0.45, depthWrite: false }),
);
editorRim.position.z = -1.4;
editorStage.add(editorRim);
editorStage.visible = false;
const player = new THREE.Group();
world.add(player);
const foodGroup = new THREE.Group(),
  npcGroup = new THREE.Group(),
  hazardGroup = new THREE.Group(),
  meteorGroup = new THREE.Group(),
  currentGroup = new THREE.Group();
const sceneryGroup = new THREE.Group();
const foodBatch = createFoodBatch(foodGroup);
scene.add(sceneryGroup, foodGroup, npcGroup, hazardGroup, meteorGroup, currentGroup);
const baseColors = [0x3be0d8, 0x8bd18b, 0xe6a76f, 0xb9a4ef, 0xe17fa9, 0x6ca4e8, 0xffd56d],
  patternColors = [0x9df6ee, 0x204d88, 0xf3dc9e, 0x8cf0af, 0xef97d0],
  accentColors = [0xffedbc, 0xff8eae, 0x91f8ed, 0xc9a4ff, 0xffb65c];
const defs = [
  {
    id: "filter",
    name: "Filter Mite",
    icon: "⌁",
    cat: "Mouths",
    cost: 0,
    unlock: 0,
    complex: 8,
    diet: "plant",
    desc: "Herbivore filter. Pulls in floating plant particles at short range.",
    stats: { bite: 1, feeding: 2 },
    col: 0xffb78a,
  },
  {
    id: "jaw",
    name: "Jaw",
    icon: "✹",
    cat: "Mouths",
    cost: 5,
    unlock: 5,
    complex: 15,
    diet: "meat",
    attack: 5,
    desc: "Carnivore mouth. Bites meat chunks and damages enemy cells at close range.",
    stats: { bite: 5, feeding: 3 },
    col: 0xf08b87,
  },
  {
    id: "proboscis",
    name: "Proboscis",
    icon: "➤",
    cat: "Mouths",
    cost: 10,
    unlock: 10,
    complex: 18,
    diet: "omni",
    attack: 2,
    desc: "Omnivore feeder. Reaches farther and consumes plants or meat.",
    stats: { bite: 3, feeding: 4 },
    col: 0xffc276,
  },
  {
    id: "cilia",
    name: "Cilia Pair",
    icon: "≋",
    cat: "Locomotion",
    cost: 5,
    unlock: 5,
    complex: 10,
    turn: 2.4,
    speed: 1,
    desc: "Fast turning, quick acceleration and precise movement.",
    stats: { turn: 3, thrust: 1 },
    col: 0x91f0d5,
  },
  {
    id: "flagellum",
    name: "Flagellum",
    icon: "〰",
    cat: "Locomotion",
    cost: 10,
    unlock: 10,
    complex: 12,
    turn: 0.55,
    speed: 4,
    desc: "Long trailing tail gives strong forward propulsion, but a wide turning radius.",
    stats: { thrust: 4, turn: 1 },
    col: 0x80edf0,
  },
  {
    id: "jet",
    name: "Jet",
    icon: "💨",
    cat: "Locomotion",
    cost: 15,
    unlock: 15,
    complex: 14,
    speed: 2,
    desc: "Press Space for a powerful impulse burst. Recharges over time.",
    stats: { burst: 5, thrust: 2 },
    col: 0x8ce6ff,
  },
  {
    id: "spike",
    name: "Spike",
    icon: "✦",
    cat: "Weapons",
    cost: 5,
    unlock: 5,
    complex: 9,
    attack: 3,
    desc: "Contact weapon inflicting damage when an enemy bumps this part.",
    stats: { damage: 3 },
    col: 0xffa0a4,
  },
  {
    id: "poison",
    name: "Poison Gland",
    icon: "☣",
    cat: "Weapons",
    cost: 10,
    unlock: 10,
    complex: 15,
    attack: 2,
    desc: "Leaves poisonous green droplets behind you. Clouds damage cells over time.",
    stats: { damage: 2, trail: 1 },
    col: 0xa8ef8a,
  },
  {
    id: "electric",
    name: "Electric Organs",
    icon: "ϟ",
    cat: "Weapons",
    cost: 15,
    unlock: 15,
    complex: 16,
    attack: 5,
    desc: "Periodic area pulse damages and stuns cells nearby.",
    stats: { shock: 5, radius: 2 },
    col: 0x9aaaff,
  },
  {
    id: "eye",
    name: "Eye",
    icon: "◉",
    cat: "Senses",
    cost: 5,
    unlock: 5,
    complex: 8,
    sight: 4,
    desc: "Extends the visible radius and maximum camera zoom.",
    stats: { sight: 4 },
    col: 0xffd98a,
  },
  {
    id: "mito",
    name: "Mitochondria",
    icon: "❋",
    cat: "Body",
    cost: 3,
    unlock: 3,
    complex: 7,
    hp: 2,
    speed: 1,
    desc: "Boosts membrane health capacity and sustained metabolism.",
    stats: { health: 2, thrust: 1 },
    col: 0xffb66f,
  },
  {
    id: "armour",
    name: "Chitin Plates",
    icon: "⬡",
    cat: "Body",
    cost: 8,
    unlock: 8,
    complex: 12,
    hp: 5,
    speed: -1,
    desc: "Hard shell plates reduce incoming damage, at the expense of speed.",
    stats: { health: 5, armour: 2 },
    col: 0x9bbed3,
  },
];
const state = {
  joystick: { x: 0, y: 0 },
  pointerScreen: null,
  pendingDiet: "plant",
  dna: 25,
  tier: 1,
  food: 0,
  foodGoal: 12,
  plants: 0,
  meat: 0,
  health: 100,
  maxHealth: 100,
  scale: 1,
  vision: 1,
  baseColor: baseColors[0],
  patternColor: patternColors[0],
  accentColor: accentColors[0],
  pattern: "speckle",
  selected: null,
  category: "Mouths",
  symmetry: true,
  stack: false,
  paint: false,
  editor: false,
  paused: false,
  hasMate: false,
  mateSignal: false,
  mateTimer: 0,
  mate: null,
  selectedPart: -1,
  selectedNode: 2,
  mouseWorld: new THREE.Vector2(),
  mouseActive: false,
  jetCooldown: 0,
  electricCooldown: 0,
  damageCooldown: 0,
  meteorTimer: 18,
  ventTimer: 5,
  eliteTimer: 30,
  worldSeed: (Math.random() * 2 ** 31) | 0,
  streamTimer: 0,
  epicTimer: 170,
  toastTimer: 0,
  runStarted: false,
  eliteKills: 0,
  discoveries: 0,
  foodSinceMate: 0,
  stamina: 100,
  paintStrokes: [],
  shake: 0,
  hintDismissed: false,
  worldGeneration: 0,
  dietHintAt: 0,
};
const STARTER_UNLOCKS = ["filter", "jaw", "cilia", "eye"];
const unlocked = new Set(STARTER_UNLOCKS);
/** Run progress that drives trait cards, tutorials and the Path screen. */
const progress = {
  kills: 0,
  regions: new Set(),
  deaths: 0,
  history: [],
  genStart: { plants: 0, meat: 0, kills: 0, deaths: 0 },
  editorPass: false,
  biteCooldown: 0,
  pathOpened: false,
  unlockedSinceEditor: 0,
  wrongFoodAt: -99,
  distanceSwum: 0,
  runTime: 0,
  editorOpenedAt: 0,
  dietCard: null,
  cellStageComplete: false,
  /** The final generation has hatched: the cell may leave the water whenever the player chooses. */
  landReady: false,
  pendingBanner: 0,
  firstBuild: false,
};
const progressStats = () => ({
  plants: state.plants,
  meat: state.meat,
  kills: progress.kills,
  deaths: progress.deaths,
  shards: state.discoveries,
  regions: progress.regions.size,
  partsUnlocked: unlocked.size,
});
let nodes = [],
  parts = [],
  boundary = [],
  playerBody = null,
  handleGroup = new THREE.Group(),
  playerPartsGroup = new THREE.Group();
player.add(handleGroup, playerPartsGroup);
const input = {};
let food = [],
  enemies = [],
  hazards = [],
  meteors = [],
  vents = [],
  currents = [],
  epics = [],
  floatingMeat = [],
  partOrbs = [],
  colonies = [],
  debris = [],
  particles = [],
  floatingFX = [],
  undoStack = [],
  redoStack = [],
  lastTime = performance.now(),
  gameTime = 0,
  worldSize = 1,
  editorCenterX = 0,
  editorEntrySnapshot = null,
  rebuildPending = false,
  soundEnabled = true,
  hintTimeout = null,
  wakeCooldown = 0,
  strokePhase = 0,
  autoSaveTimer = 28;
/* Impulses sit on top of swimming velocity and are never speed-capped, so a jet burst or a hit
   really moves you; each fades on its own clock. Jets glide out, knockback is a short sharp shove. */
const jetVel = new THREE.Vector2(),
  knockVel = new THREE.Vector2();
const JET_FADE = 2.4,
  KNOCK_FADE = 9;
const aiDesire = new THREE.Vector2();
/** Collision radius of a cell body: between its half-width and half-length, since cells are oval. */
const cellRadius = (extent, scale) => (Math.min(extent.width, extent.height) * 0.3 + Math.max(extent.width, extent.height) * 0.2) * scale;
const playerRadius = () => (playerBody ? cellRadius(playerBody.extent, state.scale) : 0.5 * state.scale);
const playerCollider = { pos: null, vel: null, r: 0.5, mass: 1, half: 0, angle: 0, off: 0 };
/** Fit a capsule (radius = half-width, core along the body) to a cell's outline. */
function fitCapsule(target, extent, scale, heading) {
  const r = (extent.height / 2) * scale * 0.95;
  target.r = r;
  target.half = Math.max(0, (extent.width / 2) * scale - r);
  target.off = (extent.minX + extent.width / 2) * scale;
  target.angle = heading;
  return target;
}
const updatePlayerCapsule = () => {
  playerCollider.pos = player.position;
  playerCollider.vel = velocity;
  if (playerBody) fitCapsule(playerCollider, playerBody.extent, state.scale, angle);
  else playerCollider.r = 0.5 * state.scale;
  return playerCollider;
};
const npcCapsule = (e) => {
  const u = e.userData;
  if (!u.collider) u.collider = { pos: e.position, vel: u.velocity, r: 0.4, mass: 1 };
  return fitCapsule(u.collider, u.body.extent, u.size, e.rotation.z);
};
/** Cells can't overlap: push every live cell (and you) apart, heavier cells shoving lighter ones. */
function resolveCellCollisions() {
  const bodies = [];
  for (const e of enemies) {
    const u = e.userData;
    if (!u.alive || u.epic || (state.courtship && e === state.mate)) continue;
    if (!u.radius) u.radius = cellRadius(u.body.extent, u.size);
    const c = npcCapsule(e);
    c.mass = u.size * u.size * (u.alpha ? 1.6 : 1);
    bodies.push(c);
  }
  if (!state.courtship) {
    updatePlayerCapsule().mass = state.scale * state.scale * 1.15;
    bodies.push(playerCollider);
  }
  resolveCollisions(bodies, 0.3);
}
function toast(s) {
  const el = $("#toast");
  el.textContent = s;
  el.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}
const audio = createAudio();
audio.setAmbient("cell"); // starts on the first tap or key press
/* ---- Settings (shared by every save slot) ---- */
const settings = loadSettings(localStorage);
function applySettings() {
  audio.setVolume({ sfx: settings.sfx, ambience: settings.ambience });
  audio.setMusicVolume(settings.music);
  document.body.classList.toggle("reduceMotion", settings.reducedMotion);
}
applySettings();
let settingsOpen = false;
function refreshQualityButton() {
  const q = getQuality();
  $("#qualityToggle").textContent = q === "low" ? "▢" : q === "medium" ? "◫" : "▣";
  $("#qualityToggle").title = "Graphics quality: " + q + " (click to change)";
}
/* ---- developer mode -----------------------------------------------------------------------
   Off for players. Tapping the credits line in Settings seven times turns it on (for this browser);
   the developer tools then appear in Settings. Hidden on purpose, not secured: by the owner's choice,
   there is no password. */
const DEV_KEY = "johnny-spore-dev";
let devMode = (() => {
  try {
    return localStorage.getItem(DEV_KEY) === "1";
  } catch (e) {
    return false;
  }
})();
let devJump = null;
function setDevMode(on) {
  devMode = !!on;
  try {
    if (devMode) localStorage.setItem(DEV_KEY, "1");
    else localStorage.removeItem(DEV_KEY);
  } catch (e) {
    /* storage blocked: on for this visit only */
  }
}
/** What the developer tools can do from where you are now. */
function devActions() {
  const list = [
    { group: "Jump to stage", label: "🦠 Cell", run: () => devJump?.("cell") },
    { group: "Jump to stage", label: "🦎 Creature", run: () => devJump?.("creature") },
    { group: "Jump to stage", label: "🛖 Tribe", run: () => devJump?.("tribe") },
    { group: "Jump to stage", label: "🏛 Civilization", run: () => devJump?.("civ") },
  ];
  if (creatureStage) {
    const d = creatureStage.debug;
    list.push(
      { group: "Creature", label: "🧠 Fill the brain bar", run: () => d.gainXp(99999) },
      { group: "Creature", label: "🔥 Stick throw → Tribe", run: () => d.playStickThrow() },
      { group: "Creature", label: "⚠ Rival at the nest", run: () => d.startEncounter("rival") },
      { group: "Creature", label: "😢 Lost youngster", run: () => d.startEncounter("stray") },
      { group: "Creature", label: "🐺 Predators migrate in", run: () => d.applyEcoActions([d.eco.force("predators")]) },
      { group: "Creature", label: "🥀 Lean season", run: () => d.applyEcoActions([d.eco.force("shortage")]) },
    );
  } else if (tribeStage) list.push({ group: "Tribe", label: "🏛 Rise into a civilization", run: () => tribeStage.debug?.playCivRise?.() });
  else if (!civStage && state.runStarted)
    list.push({
      group: "Cell",
      label: "🌱 Fill the growth bar",
      run: () => {
        state.food = state.foodGoal;
        if (state.tier < LAST_TIER) advanceTier();
        updateHUD();
      },
    });
  return list;
}
function openGameSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  // Everything holds still while the panel is open.
  const wasPaused = state.paused;
  if (civStage) civStage.setPaused(true);
  else if (tribeStage) tribeStage.setPaused(true);
  else if (creatureStage && !creatureEditor) creatureStage.setPaused(true);
  else state.paused = true;
  openSettings({
    store: localStorage,
    settings,
    onChange: () => {
      applySettings();
      saveSettings(localStorage, settings);
    },
    qualities: Object.keys(QUALITY_PRESETS),
    getQuality,
    onQuality: (q) => {
      applyQuality(q);
      refreshQualityButton();
    },
    onOpen: (screen) => (screen === "title" ? backToTitle() : openUniverseScreen(screen)),
    dev: { enabled: () => devMode, set: setDevMode, actions: devActions },
    onClose: () => {
      settingsOpen = false;
      if (civStage) civStage.setPaused(false);
      else if (tribeStage) tribeStage.setPaused(false);
      else if (creatureStage && !creatureEditor) creatureStage.setPaused(false);
      else state.paused = wasPaused;
    },
  });
}
/** Every sound in the game goes through here. opts: { pitch, gain } for creature voices. */
function playSfx(kind, opts) {
  if (!soundEnabled) return;
  audio.play(kind, opts);
}
// Browsers only allow sound after a user gesture: unlock (and start ambience) on the first one.
["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true }));
const labelTextures = new Map();
const labelGeometry = new THREE.PlaneGeometry(1.55, 0.52);
function spawnFloatLabel(x, y, text, color = 0xfff0bd) {
  const key = text + "|" + color;
  if (labelTextures.has(key)) return addFloatLabel(x, y, labelTextures.get(key));
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 86;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 38px Trebuchet MS,system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(4,18,36,.86)";
  ctx.strokeText(text, 128, 44);
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.fillText(text, 128, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (labelTextures.size < 40) labelTextures.set(key, texture);
  addFloatLabel(x, y, texture);
}
function addFloatLabel(x, y, texture) {
  const mesh = new THREE.Mesh(
    labelGeometry,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.set(x, y, 2.4);
  mesh.renderOrder = 30;
  mesh.userData = { life: 0.92, maxLife: 0.92, vx: (Math.random() - 0.5) * 0.32, vy: 0.62, vz: 0, spin: 0, floatText: true };
  scene.add(mesh);
  floatingFX.push(mesh);
}
const fxPool = createFxPool(scene);
const poisonPuffGeometry = new THREE.SphereGeometry(0.09, 8, 7),
  electricPulseGeometry = new THREE.TorusGeometry(2.15, 0.05, 8, 48);
poisonPuffGeometry.userData.shared = electricPulseGeometry.userData.shared = true;
function spawnBurst(x, y, color = 0xffe5a1, count = 10) {
  fxPool.burst(x, y, color, count);
}
function spawnWake() {
  fxPool.bubble(
    player.position.x - Math.cos(angle) * 0.9 + (Math.random() - 0.5) * 0.25,
    player.position.y - Math.sin(angle) * 0.9 + (Math.random() - 0.5) * 0.25,
    -velocity.x * 0.12 + (Math.random() - 0.5) * 0.35,
    -velocity.y * 0.12 + (Math.random() - 0.5) * 0.35,
  );
}
function updateBurstFX(dt) {
  fxPool.update(dt);
  floatingFX = floatingFX.filter((p) => {
    p.userData.life -= dt;
    if (p.userData.life <= 0) {
      scene.remove(p);
      p.material.dispose(); // geometry and text textures are shared
      return false;
    }
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;
    if (!p.userData.floatText) {
      p.rotation.x += dt * p.userData.spin;
      p.rotation.y += dt * p.userData.spin;
    }
    p.scale.multiplyScalar(1 - dt * (p.userData.floatText ? 0.16 : 0.5));
    p.material.opacity = Math.max(0, p.userData.life / p.userData.maxLife);
    return true;
  });
}
function showControlHint(text, duration = 7500) {
  const el = $("#controlHint");
  $("#controlHintText").textContent = text;
  el.classList.add("show");
  state.hintDismissed = false;
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => {
    el.classList.remove("show");
    state.hintDismissed = true;
  }, duration);
}
function dismissControlHint() {
  if (state.hintDismissed) return;
  $("#controlHint").classList.remove("show");
  clearTimeout(hintTimeout);
  state.hintDismissed = true;
}
function material(color, rough = 0.3, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.92, clearcoatRoughness: 0.15, ...extra });
}
function tube(points, r, color, extra = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 8), r, 8, false), material(color, 0.23, extra));
}

const defaultNodes = defaultSpine;
/** Free GPU resources of a subtree and detach it. Shared geometry, materials and textures are left alone. */
function disposeTree(root) {
  if (!root) return;
  root.traverse((ch) => {
    if (ch.geometry && !ch.geometry.userData.shared) ch.geometry.dispose();
    if (!ch.material) return;
    for (const m of Array.isArray(ch.material) ? ch.material : [ch.material]) {
      if (m.userData.shared) continue;
      for (const key of ["map", "alphaMap", "emissiveMap"]) if (m[key] && !m[key].userData.shared) m[key].dispose();
      m.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
function clearGroup(group) {
  while (group.children.length) disposeTree(group.children[0]);
}
// Spore-style spine: vertebrae sit on one straight axis, so the body is always mirror-symmetric.
const SPINE = { minGap: 0.32, maxGap: 1.0, maxX: 4.2 };
function straightenSpine(list) {
  const sorted = list.map((n) => ({ x: n.x, y: 0, r: n.r })).sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) sorted[i].x = Math.max(sorted[i].x, sorted[i - 1].x + SPINE.minGap);
  const mid = (sorted[0].x + sorted[sorted.length - 1].x) / 2;
  sorted.forEach((n) => (n.x -= mid));
  return sorted;
}
/** The hatchling's starter eyes and cilia: mirrored pairs seated on the membrane at the rolled spots. */
function starterParts(hatchling) {
  const half = (nodes[nodes.length - 1].x - nodes[0].x) / 2;
  const widest = Math.max(...nodes.map((n) => n.r));
  const cfg = [
    { id: "cilia", x: hatchling.ciliaAt * half, scale: hatchling.ciliaScale, pair: 101 },
    { id: "eye", x: hatchling.eyeAt * half, scale: hatchling.eyeScale, pair: 102 },
  ];
  const draft = cfg.map((o) => ({ id: o.id, x: o.x, y: widest * 1.5, rotation: 0, scale: o.scale, pairId: o.pair }));
  const seated = snapPartsToSurface(createCellRecord({ nodes, parts: draft }), { faceOutward: true }).parts;
  return seated.flatMap((p) =>
    [1, -1].map((side) => ({
      id: p.id,
      def: defs.find((d) => d.id === p.id),
      x: p.x,
      y: Math.abs(p.y) * side,
      rotation: side > 0 ? p.rotation : -p.rotation,
      scale: p.scale,
      costPaid: 0,
      source: "mirror",
      pairId: p.pairId,
    })),
  );
}
let previewParts = [];
let partsNeedSeating = false;
/** Remember where each part sits relative to the vertebrae around it, before the spine changes. */
function anchorPartsToSpine() {
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  return {
    extent: [first.x - first.r, last.x + last.r],
    anchors: parts.map((p) => {
      // Parts on the axis (mouths, tails) sit on a cap: keep them on that tip.
      if (Math.abs(p.y) < 0.08)
        return p.x >= (first.x + last.x) / 2
          ? { end: last, dx: Math.max(0, (p.x - last.x) / last.r) }
          : { end: first, dx: Math.min(0, (p.x - first.x) / first.r) };
      if (p.x <= first.x) return { end: first, dx: (p.x - first.x) / first.r };
      if (p.x >= last.x) return { end: last, dx: (p.x - last.x) / last.r };
      const i = nodes.findIndex((n, k) => k < nodes.length - 1 && p.x >= n.x && p.x <= nodes[k + 1].x);
      const a = nodes[i],
        b = nodes[i + 1];
      return { a, b, f: (p.x - a.x) / Math.max(1e-6, b.x - a.x) };
    }),
  };
}
/** After the spine changes, move each part with its vertebrae and re-seat it on the new membrane. */
function carryPartsWithSpine(before) {
  const live = new Set(nodes),
    [a0, a1] = before.extent,
    b0 = nodes[0].x - nodes[0].r,
    b1 = nodes[nodes.length - 1].x + nodes[nodes.length - 1].r;
  parts.forEach((p, i) => {
    const anchor = before.anchors[i];
    if (!anchor) return;
    if (anchor.end && live.has(anchor.end)) p.x = anchor.end.x + anchor.dx * anchor.end.r;
    else if (anchor.a && live.has(anchor.a) && live.has(anchor.b)) p.x = anchor.a.x + anchor.f * (anchor.b.x - anchor.a.x);
    else if (a1 - a0 > 1e-6) p.x = b0 + ((p.x - a0) / (a1 - a0)) * (b1 - b0);
  });
  partsNeedSeating = true;
}
function scheduleRebuildPlayer() {
  if (rebuildPending) return;
  rebuildPending = true;
  requestAnimationFrame(() => {
    rebuildPending = false;
    rebuildPlayer();
  });
}
/** The live cell as a saved-cell record: the single description the body builder, mating and the creature stage share. */
function currentRecord({ withPreview = false } = {}) {
  return createCellRecord({
    name: state.cellName,
    nodes,
    parts: (withPreview ? parts.concat(previewParts) : parts).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      scale: p.scale,
      pairId: p.pairId,
    })),
    baseColor: state.baseColor,
    patternColor: state.patternColor,
    accentColor: state.accentColor,
    pattern: state.pattern,
    paintStrokes: state.paintStrokes,
    scale: state.scale,
    tier: state.tier,
    vision: state.vision,
  });
}
function rebuildPlayer() {
  if (playerBody) {
    playerBody.rig.dispose();
    disposeTree(playerBody.root);
    playerBody = null;
  }
  clearGroup(playerPartsGroup);
  clearGroup(handleGroup);
  if (partsNeedSeating && parts.length) {
    const seated = snapPartsToSurface(currentRecord(), { faceOutward: true });
    parts.forEach((p, i) => Object.assign(p, { x: seated.parts[i].x, y: seated.parts[i].y, rotation: seated.parts[i].rotation }));
  }
  partsNeedSeating = false;
  playerBody = buildCellBody(currentRecord({ withPreview: state.editor }), {
    role: state.editor ? "editor" : "player",
    seed: 1,
    rimColor: 0xbff8ff,
  });
  playerBody.rig.setFrozen(state.editor);
  player.add(playerBody.root);
  boundary = playerBody.outline;
  parts.forEach((p, i) => {
    p.index = i;
    p.object = playerBody.partObjects[i]?.group;
    if (state.editor) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(i === state.selectedPart ? 0.25 : 0.17, 0.025, 6, 20),
        new THREE.MeshBasicMaterial({
          color: i === state.selectedPart ? 0xffe38b : 0x7fe8ed,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      ring.position.set(p.x, p.y, 0.7);
      ring.renderOrder = 7;
      ring.userData.partIndex = i;
      playerPartsGroup.add(ring);
    }
  });
  if (state.editor) {
    const lineCurve = new THREE.CatmullRomCurve3(
      nodes.map((n) => new THREE.Vector3(n.x, n.y, 0.78)),
      false,
      "centripetal",
    );
    const spineLine = new THREE.Mesh(
      new THREE.TubeGeometry(lineCurve, Math.max(32, nodes.length * 12), 0.035, 7, false),
      new THREE.MeshBasicMaterial({ color: 0xf6d27d, transparent: true, opacity: 0.98, depthTest: false }),
    );
    spineLine.renderOrder = 6;
    handleGroup.add(spineLine);
    nodes.forEach((n, i) => {
      const end = i === 0 || i === nodes.length - 1;
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(end ? 0.14 : i === state.selectedNode ? 0.12 : 0.085, 16, 12),
        new THREE.MeshBasicMaterial({ color: i === state.selectedNode ? 0xffc84d : end ? 0xffa64d : 0xffefb7, depthTest: false }),
      );
      handle.position.set(n.x, n.y, 0.89);
      handle.renderOrder = 9;
      handle.userData.nodeIndex = i;
      handleGroup.add(handle);
      if (i !== state.selectedNode) return;
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(n.r, 0.022, 7, 32),
        new THREE.MeshBasicMaterial({
          color: i === state.selectedNode ? 0xffcf71 : 0x85e8f0,
          transparent: true,
          opacity: 0.82,
          depthTest: false,
        }),
      );
      r.position.set(n.x, n.y, 0.84);
      r.renderOrder = 8;
      handleGroup.add(r);
    });
  }
  player.scale.setScalar(state.scale);
  if (state.editor) {
    // The editor hit-tests in flat body space, so the cell must be drawn flat: clear any swim tilt.
    player.position.set(editorCenterX, 0, 1);
    player.rotation.set(0, 0, Math.PI);
  }
  updateEditorUI();
}
function captureEditState() {
  return JSON.stringify({
    nodes,
    paintStrokes: state.paintStrokes,
    parts: parts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      scale: p.scale,
      source: p.source,
      pairId: p.pairId,
      costPaid: p.costPaid,
    })),
    dna: state.dna,
    scale: state.scale,
    symmetry: state.symmetry,
    stack: state.stack,
    cellName: state.cellName,
    baseColor: state.baseColor,
    patternColor: state.patternColor,
    accentColor: state.accentColor,
    pattern: state.pattern,
  });
}
function saveUndo() {
  undoStack.push(captureEditState());
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
}
function snapToSurface(x, y) {
  const outline = boundary.length ? boundary : playerBody?.outline || [];
  if (!outline.length) return { x, y, angle: Math.atan2(y, x) };
  const hit = surfacePoint(outline, x, y);
  // Near the very front or back, settle on the tip itself: mouths and tails sit on the spine, unmirrored.
  const head = nodes[nodes.length - 1].x,
    tail = nodes[0].x;
  if (Math.abs(hit.y) < 0.3 && (hit.x >= head - 0.05 || hit.x <= tail + 0.05)) {
    const front = hit.x >= head - 0.05,
      tipX = front ? Math.max(...outline.map((p) => p.x)) : Math.min(...outline.map((p) => p.x));
    return { x: tipX, y: 0, angle: front ? 0 : Math.PI };
  }
  return { x: hit.x, y: hit.y, angle: hit.angle };
}
let nextPairId = 1;
function addPart(id, x, y, fromMirror = false, pairId = null) {
  const d = defs.find((d) => d.id === id);
  if (!d || !unlocked.has(id)) {
    toast("Discover this part from a meteor or elite cell first.");
    return false;
  }
  if (parts.reduce((n, p) => n + p.def.complex, 0) + d.complex > 100) {
    toast("Complexity limit reached. Remove a part first.");
    return false;
  }
  if (state.dna < d.cost) {
    toast("Not enough DNA for " + d.name + ".");
    return false;
  }
  if (!state.stack && parts.some((p) => Math.hypot(p.x - x, p.y - y) < 0.24)) {
    toast("That spot is occupied. Enable stacking to layer sub-parts.");
    return false;
  }
  saveUndo();
  state.dna -= d.cost;
  const pair = pairId || nextPairId++;
  parts.push({
    id: id,
    def: d,
    x: x,
    y: y,
    rotation: snapToSurface(x, y).angle,
    scale: 1,
    costPaid: d.cost,
    source: fromMirror ? "mirror" : "placed",
    pairId: pair,
  });
  state.selectedPart = parts.length - 1;
  if (state.symmetry && !fromMirror && Math.abs(y) > 0.12) {
    const my = -y,
      sp = snapToSurface(x, my);
    if (
      parts.reduce((n, p) => n + p.def.complex, 0) + d.complex <= 100 &&
      state.dna >= d.cost &&
      (!parts.some((p) => Math.hypot(p.x - sp.x, p.y - sp.y) < 0.24) || state.stack)
    ) {
      state.dna -= d.cost;
      parts.push({
        id: id,
        def: d,
        x: sp.x,
        y: sp.y,
        rotation: sp.angle,
        scale: 1,
        costPaid: d.cost,
        source: "mirror",
        pairId: pair,
      });
    }
  }
  rebuildPlayer();
  renderCatalog();
  updateHUD();
  toast(d.name + " attached · DNA −" + d.cost);
  return true;
}
function removePartAt(index, fromDrag = false) {
  if (index < 0 || !parts[index]) return false;
  const p = parts[index],
    pairId = p.pairId;
  if (!fromDrag) saveUndo();
  const indices = pairId && state.symmetry ? parts.map((q, i) => (q.pairId === pairId ? i : -1)).filter((i) => i >= 0) : [index];
  indices.sort((a, b) => b - a);
  let refunded = 0;
  for (const i of indices) {
    const part = parts[i];
    if (!part) continue;
    refunded += Number.isFinite(part.costPaid) ? part.costPaid : part.def.cost;
    parts.splice(i, 1);
  }
  state.dna += refunded;
  state.selectedPart = -1;
  rebuildPlayer();
  renderCatalog();
  updateHUD();
  toast(p.def.name + " removed · +" + refunded + " DNA");
  return true;
}
function removeSelectedPart() {
  if (state.selectedPart < 0 || !parts[state.selectedPart]) {
    toast("Select an attached part first.");
    return;
  }
  removePartAt(state.selectedPart, false);
}
function restoreEditState(s) {
  const data = JSON.parse(s);
  nodes = data.nodes;
  state.paintStrokes = data.paintStrokes || [];
  state.baseColor = data.baseColor ?? state.baseColor;
  state.patternColor = data.patternColor ?? state.patternColor;
  state.accentColor = data.accentColor ?? state.accentColor;
  state.pattern = data.pattern ?? state.pattern;
  state.scale = data.scale ?? state.scale;
  state.symmetry = data.symmetry ?? state.symmetry;
  state.stack = data.stack ?? state.stack;
  state.cellName = data.cellName ?? state.cellName;
  player.scale.setScalar(state.scale);
  parts = data.parts.map((p) => ({
    id: p.id,
    def: defs.find((d) => d.id === p.id),
    x: p.x,
    y: p.y,
    rotation: p.rotation,
    scale: p.scale,
    costPaid: p.costPaid ?? defs.find((d) => d.id === p.id).cost,
    source: p.source,
    pairId: p.pairId,
  }));
  state.dna = data.dna;
  state.selectedPart = -1;
  state.selectedNode = Math.min(state.selectedNode, nodes.length - 1);
  rebuildPlayer();
  renderCatalog();
  updateHUD();
}
function undoEdit() {
  const s = undoStack.pop();
  if (!s) {
    toast("Nothing to undo.");
    return;
  }
  redoStack.push(captureEditState());
  restoreEditState(s);
  toast("Edit undone");
}
function redoEdit() {
  const s = redoStack.pop();
  if (!s) {
    toast("Nothing to redo.");
    return;
  }
  undoStack.push(captureEditState());
  restoreEditState(s);
  toast("Edit redone");
}
function drawSwatches(id, values, current, cb) {
  const el = $(id);
  if (el.children.length !== values.length || [...el.children].some((b, i) => Number(b.dataset.color) !== values[i])) {
    el.innerHTML = "";
    values.forEach((c) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.dataset.color = String(c);
      b.setAttribute("aria-label", "Choose colour #" + c.toString(16).padStart(6, "0"));
      b.onclick = () => cb(Number(b.dataset.color));
      el.appendChild(b);
    });
  }
  [...el.children].forEach((b, i) => {
    b.classList.toggle("selected", values[i] === current);
    b.style.background = "#" + values[i].toString(16).padStart(6, "0");
  });
}
let partThumbs = new Map();
let catalogDrag = null;
/*
 * Touching a part card can mean two things on a phone: scroll the drawer, or pull the part out.
 * Cards take the gesture themselves (touch-action: none) and decide: a steep vertical swipe scrolls
 * the drawer (with a little momentum), a sideways or diagonal pull, or a short hold, picks the part up.
 */
const CATALOG_HOLD_MS = 260;
function beginCatalogDrag(e, def, usable = true) {
  if (!state.editor || e.button > 0) return;
  // Locked cards can still be swiped to scroll, but never picked up.
  if (!usable && e.pointerType === "mouse") return;
  const touch = e.pointerType !== "mouse",
    list = $("#partsPanel .catalog");
  catalogDrag = {
    def,
    touch,
    list,
    startX: e.clientX,
    startY: e.clientY,
    // Phones show the parts as a sideways strip; desktop as a tall grid.
    horizontal: !!list && list.scrollWidth > list.clientWidth + 2,
    startScroll: list ? (list.scrollWidth > list.clientWidth + 2 ? list.scrollLeft : list.scrollTop) : 0,
    lastY: e.clientY,
    lastX: e.clientX,
    lastT: performance.now(),
    velocity: 0,
    mode: null,
    active: false,
    spot: null,
    ghost: null,
    suppressClick: false,
    hold: 0,
    usable,
  };
  if (touch) {
    const drag = catalogDrag;
    drag.hold = setTimeout(() => {
      if (catalogDrag === drag && !drag.mode && drag.usable) {
        drag.mode = "drag";
        if (navigator.vibrate)
          try {
            navigator.vibrate(8);
          } catch (err) {}
        activateCatalogDrag(drag, drag.startX, drag.startY);
      }
    }, CATALOG_HOLD_MS);
  }
  window.addEventListener("pointermove", moveCatalogDrag);
  window.addEventListener("pointerup", endCatalogDrag);
  window.addEventListener("pointercancel", cancelCatalogDrag);
}
function activateCatalogDrag(drag, x, y) {
  drag.active = true;
  drag.suppressClick = true;
  // On a phone the drawer covers the cell: tuck it away once a part is picked up.
  if (drag.touch && !drag.horizontal) document.body.classList.remove("show-parts");
  state.selected = drag.def.id;
  document.body.classList.add("dragging-catalog");
  const ghost = document.createElement("img");
  ghost.className = "partDragGhost";
  ghost.alt = "";
  ghost.src = partThumbs.get(drag.def.id) || "";
  ghost.style.left = x + "px";
  ghost.style.top = y + "px";
  document.body.appendChild(ghost);
  drag.ghost = ghost;
}
function setPreview(spot) {
  const id = catalogDrag.def.id,
    def = catalogDrag.def;
  previewParts = spot ? [{ id, def, x: spot.x, y: spot.y, rotation: spot.angle, scale: 1 }] : [];
  if (spot && state.symmetry && Math.abs(spot.y) > 0.12)
    previewParts.push({ id, def, x: spot.x, y: -spot.y, rotation: -spot.angle, scale: 1 });
  scheduleRebuildPlayer();
}
function moveCatalogDrag(e) {
  const drag = catalogDrag;
  if (!drag) return;
  const dx = e.clientX - drag.startX,
    dy = e.clientY - drag.startY;
  if (drag.mode === "scroll") {
    e.preventDefault();
    const now = performance.now();
    const along = drag.horizontal ? e.clientX - drag.lastX : e.clientY - drag.lastY;
    drag.velocity = along / Math.max(1, now - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastX = e.clientX;
    drag.lastT = now;
    if (drag.list) drag.list[drag.horizontal ? "scrollLeft" : "scrollTop"] = drag.startScroll - (drag.horizontal ? dx : dy);
    return;
  }
  if (!drag.mode) {
    if (Math.hypot(dx, dy) < 8) return;
    clearTimeout(drag.hold);
    // Swiping along the list scrolls it; pulling across it picks the part up.
    const alongList = drag.horizontal ? Math.abs(dx) > Math.abs(dy) * 1.2 : Math.abs(dy) > Math.abs(dx) * 1.6;
    drag.mode = (drag.touch && alongList) || !drag.usable ? "scroll" : "drag";
    if (drag.mode === "scroll") {
      drag.suppressClick = true;
      drag.lastY = e.clientY;
      drag.lastX = e.clientX;
      drag.lastT = performance.now();
      return;
    }
  }
  if (!drag.active) activateCatalogDrag(drag, e.clientX, e.clientY);
  e.preventDefault();
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  const overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas;
  let spot = null;
  if (overCanvas && boundary.length) {
    const p = localFromWorld(toWorld(e)),
      hit = snapToSurface(p.x, p.y);
    if (pointInPolygon(boundary, p.x, p.y) || Math.hypot(p.x - hit.x, p.y - hit.y) < 0.9) spot = hit;
  }
  drag.ghost.style.opacity = spot ? "0" : "1";
  const changed = !spot !== !drag.spot || (spot && drag.spot && Math.hypot(spot.x - drag.spot.x, spot.y - drag.spot.y) > 0.01);
  drag.spot = spot;
  if (changed) setPreview(spot);
}
function finishCatalogDrag() {
  window.removeEventListener("pointermove", moveCatalogDrag);
  window.removeEventListener("pointerup", endCatalogDrag);
  window.removeEventListener("pointercancel", cancelCatalogDrag);
  catalogDrag?.ghost?.remove();
  document.body.classList.remove("dragging-catalog");
  if (previewParts.length) {
    previewParts = [];
    scheduleRebuildPlayer();
  }
}
function glideCatalog(list, velocity, horizontal) {
  let v = velocity * 16; // px per frame
  const step = () => {
    if (Math.abs(v) < 0.4) return;
    if (horizontal) list.scrollLeft -= v;
    else list.scrollTop -= v;
    v *= 0.93;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function endCatalogDrag() {
  const drag = catalogDrag;
  if (drag) clearTimeout(drag.hold);
  if (drag?.mode === "scroll" && drag.list) glideCatalog(drag.list, drag.velocity, drag.horizontal);
  finishCatalogDrag();
  if (!drag || (!drag.active && !drag.suppressClick)) {
    catalogDrag = null;
    return;
  }
  if (drag.active && drag.spot) addPart(drag.def.id, drag.spot.x, drag.spot.y);
  // Keep the object until the card's click fires so the click can be swallowed.
  setTimeout(() => {
    if (catalogDrag === drag) catalogDrag = null;
  }, 0);
}
function cancelCatalogDrag() {
  if (catalogDrag) clearTimeout(catalogDrag.hold);
  finishCatalogDrag();
  catalogDrag = null;
}
function renderCatalog() {
  const el = $("#catalog");
  el.innerHTML = "";
  defs
    .filter((d) => state.category === "All" || d.cat === state.category)
    .forEach((d) => {
      const ok = unlocked.has(d.id),
        b = document.createElement("button");
      b.className = "partCard" + (state.selected === d.id ? " selected" : "") + (!ok ? " locked" : "");
      b.setAttribute("aria-label", d.name + (ok ? ", cost " + d.cost + " DNA" : ", locked"));
      b.draggable = ok;
      b.innerHTML =
        (ok ? "" : '<span class="lock">🔒</span>') +
        "<b>" +
        d.name +
        "</b><small>" +
        (ok ? "DNA " + d.cost : unlockHint(d.id, (id) => SPECIES[id]?.name || id)) +
        "</small>";
      const thumb = partThumbs.get(d.id);
      if (thumb) {
        const img = document.createElement("img");
        img.className = "partThumb";
        img.draggable = false;
        img.alt = "";
        img.src = thumb;
        b.prepend(img);
      }
      b.title = ok ? d.desc : "Locked. " + unlockHint(d.id, (id) => SPECIES[id]?.name || id);
      b.onclick = () => {
        state.selected = d.id;
        $("#partDescription").innerHTML =
          "<strong>" +
          d.name +
          "</strong><br>" +
          d.desc +
          "<br><strong>Cost:</strong> " +
          d.cost +
          " DNA · <strong>Complexity:</strong> " +
          d.complex +
          "%" +
          (d.diet ? "<br><strong>Diet:</strong> " + d.diet : "") +
          (ok ? "" : "<br><strong>Locked:</strong> " + unlockHint(d.id, (id) => SPECIES[id]?.name || id));
        if (isTouchUI()) toast(d.name + (ok ? " · " + d.cost + " DNA" : " · " + unlockHint(d.id, (id) => SPECIES[id]?.name || id)));
        renderCatalog();
        updateHUD();
      };
      b.draggable = false;
      b.addEventListener("dragstart", (e) => e.preventDefault());
      b.addEventListener("pointerdown", (e) => beginCatalogDrag(e, d, ok));
      b.addEventListener(
        "click",
        (e) => {
          if (catalogDrag?.suppressClick) {
            e.stopImmediatePropagation();
            e.preventDefault();
            catalogDrag = null;
          }
        },
        true,
      );
      el.appendChild(b);
    });
  document.querySelectorAll("[data-cat]").forEach((b) => b.classList.toggle("active", b.dataset.cat === state.category));
}
function updateEditorUI() {
  if (!state.editor) return;
  $("#complexityValue").textContent = parts.reduce((n, p) => n + p.def.complex, 0) + " / 100%";
  $("#complexityFill").style.width = parts.reduce((n, p) => n + p.def.complex, 0) + "%";
  $("#dnaVsCost").textContent = state.dna + " DNA · next " + (defs.find((d) => d.id === state.selected)?.cost || 0);
  $("#nodeCount").textContent = nodes.length + " nodes";
  $("#radiusSlider").value = nodes[state.selectedNode]?.r || 0.72;
  $("#radiusValue").textContent = (nodes[state.selectedNode]?.r || 0.72).toFixed(2);
  $("#lengthSlider").value = Math.round(((nodes[nodes.length - 1].x - nodes[0].x) / 2.83) * 100);
  $("#lengthValue").textContent = $("#lengthSlider").value + "%";
  $("#sizeSlider").value = state.scale;
  $("#sizeValue").textContent = state.scale.toFixed(2) + "×";
  const p = parts[state.selectedPart];
  $("#selectedPartLabel").textContent = p ? p.def.name : "None selected";
  $("#partScaleSlider").value = p ? p.scale : 1;
  $("#partScaleValue").textContent = (p ? p.scale : 1).toFixed(2) + "×";
  $("#partRotationSlider").value = p ? THREE.MathUtils.radToDeg(p.rotation) : 0;
  $("#partRotationValue").textContent = Math.round(p ? THREE.MathUtils.radToDeg(p.rotation) : 0) + "°";
  $("#mirrorToggle").textContent = "↔ Symmetry " + (state.symmetry ? "ON" : "OFF");
  $("#mirrorToggle").classList.toggle("active", state.symmetry);
  $("#stackToggle").textContent = "Stack parts: " + (state.stack ? "ON" : "OFF");
  $("#stackToggle").classList.toggle("active", state.stack);
  drawSwatches("#baseSwatches", baseColors, state.baseColor, (c) => {
    saveUndo();
    state.baseColor = c;
    rebuildPlayer();
    updateEditorUI();
  });
  drawSwatches("#patternSwatches", patternColors, state.patternColor, (c) => {
    saveUndo();
    state.patternColor = c;
    rebuildPlayer();
  });
  drawSwatches("#accentSwatches", accentColors, state.accentColor, (c) => {
    saveUndo();
    state.accentColor = c;
    rebuildPlayer();
  });
  $("#patternSelect").value = state.pattern;
}
function stats() {
  let speed = 1.5,
    turn = 1.2,
    damage = 0,
    sight = state.vision,
    healthBonus = 0,
    armour = 0;
  parts.forEach((p) => {
    const d = p.def;
    speed += d.speed || 0;
    turn += d.turn || 0;
    damage += d.attack || 0;
    sight += d.sight || 0;
    healthBonus += d.hp || 0;
    armour += d.id === "armour" ? 2 : 0;
  });
  const diets = parts.filter((p) => p.def.cat === "Mouths").map((p) => p.def.diet);
  const uniq = [...new Set(diets)];
  const diet = uniq.includes("omni") || uniq.length > 1 ? "omni" : uniq[0] || "plant";
  turn = turn / (1 + Math.abs(nodes[nodes.length - 1].x - nodes[0].x) * 0.1 + parts.length * 0.02);
  return { speed: Math.max(0.55, speed), turn: Math.max(0.4, turn), damage, sight, healthBonus, armour, diet };
}
function updateSporeEditorChrome() {
  const d = stats().diet;
  $("#editorDietName").textContent = d === "plant" ? "HERBIVORE" : d === "meat" ? "CARNIVORE" : "OMNIVORE";
  $("#editorDietIcon").textContent = d === "plant" ? "♧" : d === "meat" ? "✹" : "✧";
  $("#editorDNABalance").textContent = state.dna;
  const segs = $("#sporeEditorTop .editorStageTrack").children;
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("lit", i < state.tier * 2);
  $("#editorComplexityButton").title = "Complexity " + parts.reduce((n, p) => n + p.def.complex, 0) + "%";
  $("#cellName").value = state.cellName || $("#cellName").value || "Karlets";
  $("#editorSymmetryTop").classList.toggle("active", state.symmetry);
}
let objectiveFade = 0;
function updateHUD() {
  const s = stats();
  state.maxHealth = 80 + s.healthBonus * 10;
  state.health = Math.min(state.health, state.maxHealth);
  $("#dnaCount").textContent = state.dna;
  const dnab = $("#editorDNABalance");
  if (dnab) dnab.textContent = state.dna;
  if (state.editor) updateSporeEditorChrome();
  if (state.dna !== lastDisplayedDNA) {
    const badge = $("#dnaCount").parentElement;
    badge.classList.remove("dnaPulse");
    void badge.offsetWidth;
    badge.classList.add("dnaPulse");
    lastDisplayedDNA = state.dna;
  }
  if ($("#complexityValue")) {
    const used = parts.reduce((n, p) => n + p.def.complex, 0);
    $("#complexityValue").textContent = used + " / 100%";
    $("#complexityFill").style.width = used + "%";
    $("#dnaVsCost").textContent = state.dna + " DNA · next " + (defs.find((d) => d.id === state.selected)?.cost || 0);
  }
  const stage = stageFor(state.tier);
  $("#tierLabel").textContent = "STAGE " + state.tier + " / " + LAST_TIER;
  $("#tierLabel").title = stage.name;
  $("#stageName").textContent = "STAGE " + state.tier + " · " + stage.name.toUpperCase();
  updateDietMeter(state.plants, state.meat);
  const hasJet = parts.some((p) => p.id === "jet");
  // Keep the HUD lean: stamina only matters with a Jet, and the growth bar at the top already shows food.
  $("#staminaFill").closest(".metric").hidden = !hasJet;
  $("#foodFill").closest(".metric").hidden = true;
  $("#touchBoost").classList.toggle("lockedAbility", !hasJet);
  $("#touchBoost").title = hasJet ? "Jet boost · spends stamina" : "Unlock a Jet in the Cell Editor to boost";
  $("#touchMate").classList.toggle("readyAbility", finalReady() && !state.mateSignal);
  if ($("#touchMate").firstChild) $("#touchMate").firstChild.textContent = state.mateSignal ? "♥" : "♡";
  $("#healthValue").textContent = Math.round((state.health / state.maxHealth) * 100) + "%";
  $("#healthFill").style.width = Math.max(0, (state.health / state.maxHealth) * 100) + "%";
  if ($("#staminaFill")) {
    $("#staminaFill").style.width = state.stamina + "%";
    $("#staminaValue").textContent = Math.round(state.stamina) + "%";
  }
  $("#foodValue").textContent = state.food + " / " + state.foodGoal;
  $("#foodFill").style.width = Math.min(100, (state.food / state.foodGoal) * 100) + "%";
  const pct = Math.min(100, (state.food / state.foodGoal) * 100);
  $("#growthPercent").textContent = Math.round(pct) + "%";
  $("#growthFill").style.width = pct + "%";
  $("#growthBar").classList.toggle("growthReady", pct >= 100);
  $("#plantCount").textContent = state.plants;
  $("#meatCount").textContent = state.meat;
  $("#dietLabel").textContent = s.diet === "plant" ? "Herbivore" : s.diet === "meat" ? "Carnivore" : "Omnivore";
  $("#discoveryCount").textContent = state.discoveries;
  const hasMouth = parts.some((p) => p.def.cat === "Mouths");
  const objective = state.mateSignal
    ? ["MATE", "Follow the heart and touch your mate."]
    : finalReady()
      ? ["READY", "Fully grown. Call a mate to leave the water."]
      : !hasMouth
        ? ["NEEDS MOUTH", "Open the cell editor and attach a mouth part to eat."]
        : [
            "FORAGE",
            "Eat " +
              (state.foodGoal - state.food) +
              " more food particle" +
              (state.foodGoal - state.food === 1 ? "" : "s") +
              (state.tier >= LAST_TIER ? " to be fully grown." : " to grow."),
          ];
  const box = $("#objectiveText").closest(".hudbox");
  if ($("#objectiveText").textContent !== objective[1]) {
    box.classList.add("fresh");
    clearTimeout(objectiveFade);
    objectiveFade = setTimeout(() => box.classList.remove("fresh"), 6000);
  }
  $("#objectiveStep").textContent = objective[0];
  $("#objectiveText").textContent = objective[1];
  $("#landBtn").hidden = !progress.landReady;
  $("#touchLand").hidden = !progress.landReady;
  $("#callMateBtn").textContent = state.mateSignal ? "♥" : "♡";
  $("#callMateBtn").title = state.mateSignal ? "Follow the heart" : finalReady() ? "Call a mate to leave the water" : "Call a mate: a new generation to design";
  $("#mateCue").classList.toggle("show", finalReady() || state.mateSignal);
  $("#mateCueTitle").textContent = state.mateSignal ? "♥" : finalReady() ? "✦" : "";
  $("#mateCueText").textContent = "";
  const dietLabel = $("#dietLabel");
  if (dietLabel) {
    if (dietLabel.parentElement.childNodes[0]) dietLabel.parentElement.childNodes[0].nodeValue = "";
    dietLabel.textContent = s.diet === "plant" ? "🌿" : s.diet === "meat" ? "🥩" : "✧";
  }
  const growthLabel = $("#growthHUD")?.querySelector(".row b");
  if (growthLabel) growthLabel.textContent = "✦";
  const rows = [
    ["Thrust", s.speed],
    ["Turning", s.turn],
    ["Contact damage", s.damage],
    ["Vision", s.sight],
    ["Health bonus", s.healthBonus],
    ["Armour", s.armour],
  ];
  $("#statRows").innerHTML = rows
    .map(
      (r) =>
        '<div class="statLine"><div class="row"><span>' +
        r[0] +
        "</span><b>" +
        r[1].toFixed(1) +
        '</b></div><div class="mini"><i style="width:' +
        Math.min(100, Math.max(3, r[1] * 10)) +
        '%"></i></div></div>',
    )
    .join("");
}
function configureEditorViewport() {
  const aspect = innerWidth / innerHeight;
  // Upright phones: frame the cell across the narrow width instead of the tall height.
  cameraZoom = aspect < 1 ? Math.max(7.5, 6.2 / aspect) : Math.max(10.5, 10.8 / aspect);
  cameraZoomTarget = cameraZoom;
  editorCenterX = !isTouchUI() ? cameraZoom * aspect * 0.12 : 0;
  player.position.set(editorCenterX, 0, 1);
  player.rotation.z = Math.PI;
  editorStage.position.set(editorCenterX, 0, 0);
  camera.position.set(editorCenterX, 0, 30);
  camera.lookAt(editorCenterX, 0, 0);
  updateCamera();
}
const hasMouth = () => parts.some((p) => p.def.cat === "Mouths");
function setEditor(on) {
  const wasEditing = state.editor;
  // As in Spore, the editor opens for your first cell and after each mating, never mid-swim.
  if (on && !state.editor && !progress.editorPass) {
    toast("Find a mate to evolve: the editor opens when your next generation is born.");
    return;
  }
  if (!on && state.editor && !hasMouth() && !cellSandboxClosing) {
    toast("Your cell needs a mouth first: drag on the Filter (plants) or the Jaw (meat).");
    if (isTouchUI()) document.body.classList.add("show-parts");
    return;
  }
  if (on === state.editor) return;
  $("#worldWaypoint").style.display = "none";
  $("#gameReticle").style.display = "none";
  document.body.classList.remove("show-parts", "show-genome");
  state.paused = false;
  state.mouseActive = false;
  state.pointerScreen = null;
  pointerThrust = false;
  state.joystick.x = 0;
  state.joystick.y = 0;
  if (on) dismissControlHint();
  if (on) {
    state.paint = false;
    state.category = "All";
    $("#paintTool").classList.remove("active");
    $("#buildTool").classList.add("active");
  }
  if (on) {
    editorEntrySnapshot = captureEditState();
    undoStack = [];
    redoStack = [];
    editorReturnPos = player.position.clone();
    editorReturnAngle = angle;
    editorReturnZoom = cameraZoom;
    editorReturnTargetZoom = cameraZoomTarget;
    angle = 0;
    document.body.classList.add("cellEditorMode");
    configureEditorViewport();
  } else {
    document.body.classList.remove("cellEditorMode", "show-parts", "show-genome");
    if (editorReturnPos) player.position.copy(editorReturnPos);
    editorReturnPos = null;
    angle = editorReturnAngle;
    cameraZoom = editorReturnZoom;
    cameraZoomTarget = editorReturnTargetZoom;
    editorStage.position.set(0, 0, 0);
    player.rotation.z = angle;
    camera.position.x = player.position.x;
    camera.position.y = player.position.y;
    camera.lookAt(player.position.x, player.position.y, 0);
    updateCamera();
  }
  if (!on) editorEntrySnapshot = null;
  if (!on) setTimeout(refreshKin, 0);
  if (!on && progress.firstBuild) {
    // The first design decides what the soup serves up, so refill it for the chosen mouth.
    progress.firstBuild = false;
    spawnWorld();
    showControlHint(
      isTouchUI()
        ? "Drag on the water to swim · eat food your mouth can handle · tap MATE when the growth bar fills."
        : "WASD/arrows or click-hold water to swim · eat food your mouth can handle · M to call a mate.",
    );
  }
  if (on) {
    progress.editorOpenedAt = gameTime;
    progress.unlockedSinceEditor = 0;
  } else if (wasEditing && !cellSandboxClosing) {
    // A sandbox edit (from the Sporepedia) is not a new generation.
    progress.editorPass = false;
    recordGeneration();
    if (state.runStarted) saveGame(true);
  }
  if (!on && progress.pendingBanner) {
    startGrowthPullback(progress.pendingBanner);
    progress.pendingBanner = 0;
  }
  state.editor = on;
  editorStage.visible = on;
  [sceneryGroup, foodGroup, npcGroup, hazardGroup, meteorGroup, currentGroup, deepGroup].forEach((g) => (g.visible = !on));
  $("#partsPanel").style.display = on ? "flex" : "none";
  $("#editorPanel").style.display = "none";
  $("#gameHUD").style.display = on ? "none" : "flex";
  $("#radarWrap").style.display = on ? "none" : "block";
  $("#growthHUD").style.display = on ? "none" : "block";
  $("#gameButtons").style.display = on ? "none" : "flex";
  $("#editorButtons").style.display = "none";
  $("#mobileControls").style.display = on ? "none" : "";
  handleGroup.visible = on;
  state.selectedNode = Math.min(state.selectedNode, nodes.length - 1);
  rebuildPlayer();
  renderCatalog();
  updateHUD();
  if (on) {
    updateSporeEditorChrome();
    // The parts drawer is open from the start, on phones too: it is what the editor is for.
    document.body.classList.add("show-parts");
  }
  toast(on ? "Cell creator · drag the spine itself to sculpt the organism." : "Back to the primordial soup.");
  if (!on && state.runStarted)
    showControlHint(
      isTouchUI()
        ? "JOYSTICK: push up to swim, sideways to turn · eat glowing food · tap MATE when ready."
        : "WASD/arrows or click-hold in the water to swim · steer with mouse · eat to grow and press M to mate.",
      5200,
    );
}
function resetRunConfirm() {
  showDialog("RESTART EVOLUTION?", "Your current local save will be removed and a new primordial soup run will begin.", [
    {
      label: "Keep playing",
      primary: true,
      action: () => {
        state.paused = false;
      },
    },
    {
      label: "Restart run",
      action: () => {
        try {
          localStorage.removeItem("johnny-spore-cell-stage");
        } catch (e) {}
        location.reload();
      },
    },
  ]);
}
function pauseGame() {
  if (state.editor || $("#intro").style.display !== "none") return;
  if (state.paused) {
    state.paused = false;
    $("#dialogOverlay").style.display = "none";
    return;
  }
  state.paused = true;
  pointerThrust = false;
  state.mouseActive = false;
  state.pointerScreen = null;
  state.joystick.x = 0;
  state.joystick.y = 0;
  const knob = $("#moveStickKnob");
  if (knob) {
    knob.style.left = "50%";
    knob.style.top = "50%";
  }
  Object.keys(input).forEach((k) => (input[k] = false));
  showDialog(
    "PAUSED",
    "Take a breath. Your cell, DNA, and current evolution progress are safe.\n\nWASD / arrows: swim · move the mouse to steer · Space: jet boost · M: call mate · Tab: cell editor.",
    [
      {
        label: "Resume",
        primary: true,
        action: () => {
          state.paused = false;
        },
      },
      {
        label: "Save & resume",
        action: () => {
          saveGame();
          state.paused = false;
        },
      },
      { label: "Restart run", action: () => resetRunConfirm() },
    ],
  );
}
function showDialog(title, text, buttons) {
  $("#worldWaypoint").style.display = "none";
  $("#gameReticle").style.display = "none";
  $("#dialogTitle").textContent = title;
  $("#dialogText").textContent = text;
  $("#dialogText").style.whiteSpace = "pre-line";
  const o = $("#dialogOptions");
  o.innerHTML = "";
  buttons.forEach((b) => {
    const el = document.createElement("button");
    el.textContent = b.label;
    if (b.primary) el.className = "primary";
    el.onclick = () => {
      $("#dialogOverlay").style.display = "none";
      if (b.action) b.action();
    };
    o.appendChild(el);
  });
  $("#dialogOverlay").style.display = "flex";
}
function addFood(type, x, y, kind = "particle") {
  const g = createFoodModel(type, kind);
  g.rotation.z = Math.random() * TAU;
  g.position.set(x, y, 0.2);
  g.userData = {
    renderKey: g.userData.renderKey,
    type: type,
    kind: kind,
    alive: true,
    phase: Math.random() * 6,
    base: new THREE.Vector2(x, y),
    value: kind === "chunk" ? 2 : 1,
  };
  foodGroup.add(g);
  food.push(g);
  return g;
}

/* Small diet badges above NPCs. Two shared textures serve every cell in the world. */
const dietBadgeTextures = {};
function dietBadge(diet) {
  if (dietBadgeTextures[diet]) return dietBadgeTextures[diet];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  c.fillStyle = diet === "plant" ? "#2b9a78" : "#a43f5c";
  c.beginPath();
  c.arc(32, 32, 25, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#f5f0d9";
  c.lineWidth = 3;
  c.stroke();
  c.fillStyle = diet === "plant" ? "#d8ffe2" : "#ffe4d5";
  if (diet === "plant") {
    c.beginPath();
    c.moveTo(18, 39);
    c.bezierCurveTo(17, 19, 38, 13, 47, 17);
    c.bezierCurveTo(47, 37, 31, 45, 18, 39);
    c.fill();
  } else {
    // A fang pair reads as "bites".
    c.beginPath();
    c.moveTo(18, 20);
    c.lineTo(46, 20);
    c.lineTo(40, 44);
    c.lineTo(34, 30);
    c.lineTo(30, 30);
    c.lineTo(24, 44);
    c.closePath();
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.userData.shared = true;
  dietBadgeTextures[diet] = tex;
  return tex;
}
const healthBarGeometries = { back: new THREE.PlaneGeometry(0.9, 0.07), bar: new THREE.PlaneGeometry(0.85, 0.045) };
Object.values(healthBarGeometries).forEach((g) => (g.userData.shared = true));

/**
 * Create an NPC from a species (or from an explicit cell record, as the mate does).
 * options: { size, diet, alpha, x, y, species, record, mate }
 */
function makeNPC(options = {}) {
  const phase = Math.random() * Math.PI * 2;
  const diet = options.record ? options.record.diet : options.diet || (Math.random() < 0.57 ? "plant" : "meat");
  const alpha = !!options.alpha;
  const speciesId = options.record ? null : options.species || chooseSpecies(diet, Math.random, alpha);
  const species = speciesId ? SPECIES[speciesId] : null;
  const record = options.record || snapPartsToSurface(speciesRecord(speciesId, Math.random), { faceOutward: true });
  const size = options.size || (0.46 + Math.random() * 0.68) * (1 + (state.tier - 1) * 0.08);
  const threat = species ? species.threat : false;
  const body = buildCellBody(record, {
    role: options.mate ? "mate" : "npc",
    seed: 1 + Math.floor(Math.random() * 3),
    rimColor: options.mate ? 0xffc6e8 : options.kin ? 0x9ff3ff : threat ? 0xff7a66 : 0xa6ffc9,
    shadow: getQuality() === "high",
    eyeColor: species?.eyeColor,
  });
  const g = new THREE.Group();
  g.add(body.root);
  const widest = Math.max(...record.body.nodes.map((n) => n.r));
  const overlayY = widest * 0.62 + 0.55;
  const dietSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: dietBadge(diet === "omni" ? "meat" : diet), transparent: true, depthTest: false }),
  );
  dietSprite.material.userData.shared = false;
  dietSprite.scale.set(0.24, 0.24, 1);
  dietSprite.renderOrder = 20;
  g.add(dietSprite);
  const healthGroup = new THREE.Group();
  const back = new THREE.Mesh(
    healthBarGeometries.back,
    new THREE.MeshBasicMaterial({ color: 0x10202c, transparent: true, opacity: 0.8, depthTest: false }),
  );
  back.renderOrder = 20;
  healthGroup.add(back);
  const bar = new THREE.Mesh(healthBarGeometries.bar, new THREE.MeshBasicMaterial({ color: 0x66ee8c, depthTest: false }));
  bar.position.z = 0.01;
  bar.renderOrder = 21;
  healthGroup.add(bar);
  g.add(healthGroup);
  const initialAngle = Math.random() * Math.PI * 2;
  const maxHealth = alpha ? 24 : (6 + size * 4) * (species?.soft ?? 1); // easy prey is soft-bodied
  g.userData = {
    alive: true,
    size: size,
    diet: diet,
    species: speciesId,
    threat: threat,
    body: body,
    rig: body.rig,
    overlayY: overlayY,
    health: maxHealth,
    maxHealth: maxHealth,
    alpha: alpha,
    elite: alpha,
    mate: !!options.mate,
    kin: !!options.kin,
    retarget: Math.random() * 0.4,
    state: "idle",
    phase: phase,
    target: null,
    attackCooldown: 0,
    bar: bar,
    healthGroup: healthGroup,
    dietSprite: dietSprite,
    velocity: new THREE.Vector2(
      Math.cos(initialAngle) * (0.12 + Math.random() * 0.2),
      Math.sin(initialAngle) * (0.12 + Math.random() * 0.2),
    ),
    color: record.colors.base,
  };
  g.scale.setScalar(size);
  const spot = options.x === undefined ? ringSpot() : { x: options.x, y: options.y };
  g.position.set(spot.x, spot.y, 0.2);
  g.rotation.z = initialAngle;
  npcGroup.add(g);
  enemies.push(g);
  return g;
}
function compatible(type) {
  const d = stats().diet;
  return d === "omni" || (d === "plant" && type === "plant") || (d === "meat" && type === "meat");
}
function eat(f) {
  if (!f.userData.alive) return;
  const wasReady = state.food >= state.foodGoal,
    type = f.userData.type;
  f.userData.alive = false;
  f.visible = false;
  spawnBurst(f.position.x, f.position.y, type === "plant" ? 0x8cffb8 : 0xffc891, f.userData.kind === "chunk" ? 20 : 12);
  playSfx("eat");
  playerBody?.rig.eat();
  if (navigator.vibrate)
    try {
      navigator.vibrate(7);
    } catch (e) {}
  state.food++;
  state.foodSinceMate++;
  if (type === "plant") state.plants++;
  else state.meat++;
  // DNA trickles in: about one strand per three bites of plant, a little faster for meat chunks,
  // and faster in the deeper zones.
  state.dnaProgress = (state.dnaProgress || 0) + (f.userData.kind === "chunk" ? 0.6 : 0.34) * ZONES[cellZone].dna;
  // Scavenging: eating the remains of dead cells.
  if (f.userData.kind === "chunk" && f.userData.temporary) {
    progress.scavenged = (progress.scavenged || 0) + 1;
    if (progress.scavenged === 1) toast("Scavenged the remains of a dead cell. Remains rot away, so be quick.");
  }
  if (state.dnaProgress >= 1) {
    state.dna += Math.floor(state.dnaProgress);
    state.dnaProgress %= 1;
  }
  // You grow a little with every bite, up to the size of the next stage's start.
  const base = stageScale(state.tier);
  state.scale = Math.min(base * 1.18, state.scale + (0.066 / state.foodGoal) * base);
  player.scale.setScalar(state.scale);
  cameraZoomTarget = Math.min(9 * base * 1.15 + stats().sight * 0.5, cameraZoomTarget + 0.04 * base);
  state.health = Math.min(state.maxHealth, state.health + 2);
  updateHUD();
  saveGame(true);
  if (!wasReady && state.food >= state.foodGoal && state.tier < LAST_TIER) {
    advanceTier(); // ordinary stages grow on their own; only the last one needs a mate
  } else if (!wasReady && state.food >= state.foodGoal) {
    spawnBurst(player.position.x, player.position.y, 0xffdf8a, 26);
    playSfx("mate");
    $("#growthBar").classList.add("growthReady");
    if (navigator.vibrate)
      try {
        navigator.vibrate([14, 24, 14]);
      } catch (e) {}
  }
  respawnFood(f, 7500);
}
function dropMeat(x, y, amount = 3) {
  for (let i = 0; i < amount; i++) {
    const f = addFood("meat", x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, "chunk");
    f.userData.value = 2;
    f.userData.temporary = true;
    // Uneaten meat rots away.
    setTimeout(() => {
      if (f.parent && f.userData.alive) {
        f.userData.alive = false;
        f.userData.temporary = "gone";
      }
    }, 15000);
  }
}
function killNPC(e, playerKill = true) {
  if (!e.userData.alive) return;
  e.userData.alive = false;
  e.userData.dying = true;
  e.userData.rig.die();
  const elite = e.userData.alpha || e.userData.epic;
  spawnBurst(e.position.x, e.position.y, e.userData.color || 0xff9c9c, elite ? 34 : 20);
  if (elite) spawnBurst(e.position.x, e.position.y, 0xffda83, 18);
  dropMeat(e.position.x, e.position.y, elite ? 6 : Math.max(2, Math.min(5, Math.round(1 + (e.userData.size / stageScale(state.tier)) * 2))) + (SPECIES[e.userData.species]?.meaty || 0));
  dropPartOrb(e);
  if (playerKill) {
    progress.kills++;
    if (elite) spawnFloatLabel(e.position.x, e.position.y + 0.4, "+3 DNA", 0xffe5a2);
    playSfx("death");
    state.dna += elite ? 3 : 0;
    state.eliteKills += elite ? 1 : 0;
    if (elite) {
      meteorUnlock();
      spawnBurst(e.position.x, e.position.y, 0xffd77c, 28);
    }
  }
  updateHUD();
  if (playerKill) saveGame(true);
  const generation = state.worldGeneration;
  setTimeout(() => {
    if (generation !== state.worldGeneration) return;
    disposeTree(e);
    const ix = enemies.indexOf(e);
    if (ix >= 0) enemies.splice(ix, 1);
  }, 2500);
}
/** Shove a cell away from a point. Lighter cells fly further; the speed cap lifts briefly so it shows. */
/** Spore-style hit reaction: a quick shove of about a body length that fades in a fraction of a second. */
function knockNPC(e, from, strength) {
  const u = e.userData;
  const dx = e.position.x - from.x,
    dy = e.position.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const push = (strength * 4.2) / Math.max(0.6, Math.sqrt(u.size));
  if (!u.knockVel) u.knockVel = new THREE.Vector2();
  u.knockVel.x += (dx / d) * push;
  u.knockVel.y += (dy / d) * push;
  u.knockVel.clampLength(0, 9);
}
function damageNPC(e, dmg, stun = false, from = null) {
  if (!e.userData.alive) return;
  // A cell from the next stage: you can't hurt it until you've grown into its league.
  if (e.userData.giant && !e.userData.epic) {
    if (from && gameTime - (e.userData.shrugAt || -9) > 1.2) {
      e.userData.shrugAt = gameTime;
      spawnBurst(e.position.x, e.position.y, 0xcfe8ff, 6);
      spawnFloatLabel(e.position.x, e.position.y + e.userData.size * 0.6, "Too big", 0xcfe8ff);
    }
    return;
  }
  if (from && !e.userData.epic) knockNPC(e, from, 1 + Math.min(2.5, dmg * 0.2));
  e.userData.health -= dmg;
  const b = e.userData.bar;
  if (b) {
    b.scale.x = Math.max(0.001, e.userData.health / e.userData.maxHealth);
    b.position.x = -(1 - b.scale.x) * 0.42;
    b.material.color.set(e.userData.health / e.userData.maxHealth < 0.35 ? 0xff5353 : 0x66ee8c);
  }
  if (stun) e.userData.stunned = 0.8;
  if (e.userData.health <= 0) killNPC(e, true);
  else e.userData.rig.hit(0.8);
}
function hurt(amount, reason, from = null) {
  if (state.damageCooldown > 0 || state.courtship) return;
  const s = stats(),
    damage = Math.max(1, amount - s.armour * 1.5);
  state.health -= damage;
  if (from) {
    // Spore's knockback: a short sharp shove away from the biter (about a body length) and the
    // biter bounces back too. You keep control; it's over in a fraction of a second.
    const dx = player.position.x - from.x,
      dy = player.position.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    const push = (6 + Math.min(4, damage * 0.25)) * Math.sqrt(Math.max(0.6, state.scale));
    knockVel.x += (dx / d) * push;
    knockVel.y += (dy / d) * push;
    knockVel.clampLength(0, 11 * Math.sqrt(state.scale));
    state.knock = 0.15;
    const attacker = enemies.find((e) => e.position === from);
    if (attacker) knockNPC(attacker, player.position, 0.6);
  }
  state.damageCooldown = 0.65;
  state.shake = 0.42;
  $("#damageFlash").style.opacity = ".85";
  spawnBurst(player.position.x, player.position.y, damage > 18 ? 0xff526f : 0xff8796, damage > 18 ? 24 : 10);
  playSfx("damage");
  playerBody?.rig.hit(1);
  if (navigator.vibrate)
    try {
      navigator.vibrate(24);
    } catch (e) {}
  updateHUD();
  if (state.health <= 0) dieAndRespawn(reason);
}
/** Spore-style death: your cell dies, a new one of your species hatches nearby, and you lose ground. */
function dieAndRespawn(reason) {
  progress.deaths++;
  const lostFood = Math.min(state.food, Math.ceil(state.foodGoal * 0.4)),
    lostDna = Math.min(state.dna, 5 + state.tier * 2);
  state.food -= lostFood;
  state.dna -= lostDna;
  spawnBurst(player.position.x, player.position.y, 0xff7d8a, 30);
  playSfx("death");
  // Hatch a few body-lengths away from the nearest hunter, with a moment of protection.
  const threat = enemies.filter((e) => e.userData.alive && e.userData.diet === "meat" && !e.userData.kin).sort((a, b) => distance2D(a.position, player.position) - distance2D(b.position, player.position))[0];
  const away = threat ? new THREE.Vector2(player.position.x - threat.position.x, player.position.y - threat.position.y).normalize() : new THREE.Vector2(1, 0);
  player.position.x += away.x * 9 * state.scale;
  player.position.y += away.y * 9 * state.scale;
  velocity.set(0, 0);
  jetVel.set(0, 0);
  knockVel.set(0, 0);
  state.health = state.maxHealth * 0.7;
  state.damageCooldown = 2.5;
  state.shake = 0.6;
  spawnBurst(player.position.x, player.position.y, 0x7debf8, 26);
  updateHUD();
  showDialog(
    "Your cell died",
    (reason || "Something got you.") +
      " A new cell of your species hatches nearby. You lost " +
      lostFood +
      " growth and " +
      lostDna +
      " DNA. Keep away from red-rimmed hunters until you can fight back.",
    [{ label: "Keep going", primary: true, action: () => {} }],
  );
}
/** Asked before leaving the water, since it ends the Cell Stage. */
function promptLand() {
  if (!progress.landReady || state.editor || state.paused || document.querySelector(".surfaceFx")) return;
  showDialog("Leave the water?", "Your cell grows legs and crawls onto land to begin the Creature Stage.\nYou can come back to the soup later from the menu.", [
    { label: "Not yet", action: () => {} },
    { label: "🦎 Go to land", primary: true, action: completeCellStage },
  ]);
}
function completeCellStage() {
  const record = currentRecord();
  const card = progress.dietCard || dietPath(state.plants, state.meat);
  progress.dietCard = card;
  progress.cellStageComplete = true;
  recordChronicle({ key: "cell:complete", stage: "cell", icon: DIET_CARDS[card].icon, text: "Left the water as " + (/^[aeiou]/i.test(DIET_CARDS[card].title) ? "an " : "a ") + DIET_CARDS[card].title.toLowerCase() + ", earning " + DIET_CARDS[card].ability + "." });
  storeCellRecord(localStorage, record);
  writeHandoff(localStorage, record, {
    plants: state.plants,
    meat: state.meat,
    discoveries: state.discoveries,
    eliteKills: state.eliteKills,
    dna: state.dna,
    unlocked: [...unlocked],
    dietCard: card,
    consequenceTraits: [{ stage: "cell", card }],
  });
  saveGame(true);
  const c = DIET_CARDS[card],
    land = CELL_PASSIVES[card];
  const reasons = ["Ate " + state.plants + " plant" + (state.plants === 1 ? "" : "s") + " and " + state.meat + " meat"];
  if (progress.kills) reasons.push("Defeated " + progress.kills + " cell" + (progress.kills === 1 ? "" : "s"));
  if (progress.scavenged) reasons.push("Scavenged " + progress.scavenged + " time" + (progress.scavenged === 1 ? "" : "s"));
  hideTip();
  showTraitCard({
    stage: "Cell Stage",
    title: c.title,
    icon: c.icon,
    color: c.color,
    ability: c.ability,
    blurb: c.text,
    reasons,
    pros: ["On land: " + land.pro],
    cons: ["On land: " + land.con],
    later: [{ icon: "⛺", text: "Tribal Stage: " + TRIBE_LEGACY.cell[card].text }],
    button: "🦎 Crawl ashore",
    reducedMotion: settings.reducedMotion,
    onClose: () => {
      playSfx("hatch");
      playSurfacing(() => startCreatureStage(false, true));
    },
  });
}
/** End of the Cell Stage: the camera pulls back, light floods down from the surface, and the cell
    rises toward it. The screen whites out and the Creature Stage fades up from it. */
function playSurfacing(then) {
  if (document.querySelector(".surfaceFx")) return;
  hideTip();
  state.paused = true;
  const fx = document.createElement("div");
  fx.className = "surfaceFx";
  fx.innerHTML = "<i></i><i></i><i></i>";
  document.body.appendChild(fx);
  requestAnimationFrame(() => fx.classList.add("rise"));
  const start = performance.now(),
    zoom0 = cameraZoomTarget,
    scale0 = player.scale.x;
  const tick = () => {
    const k = Math.min(1, (performance.now() - start) / 2600);
    // The cell grows toward the camera as it swims up, with bubbles streaming off it.
    cameraZoomTarget = zoom0 * (1 + k * 0.35);
    player.scale.setScalar(scale0 * (1 + k * k * 1.6));
    angle += 0.012;
    if (Math.random() < 0.5) spawnBurst(player.position.x + (Math.random() - 0.5) * 2, player.position.y + (Math.random() - 0.5) * 2, 0xdff6ff, 2);
    if (k < 1) requestAnimationFrame(tick);
    else {
      player.scale.setScalar(scale0);
      cameraZoomTarget = zoom0;
      then();
      fx.classList.add("out");
      setTimeout(() => fx.remove(), 1400);
    }
  };
  requestAnimationFrame(tick);
}
/* ---- Creature Stage -------------------------------------------------------------
   The cell crawls onto the island. Cell DNA and parts stay in the water (Spore's rule); the body
   shape, colours and diet carry over. The stage owns its own scene; main.js lends it the renderer,
   the joystick and the sound, and keeps the species history. */
let creatureStage = null,
  creatureEditor = null;
const creatureMoveInput = () => {
  const keyY = (input.ArrowUp || input.w ? 1 : 0) - (input.ArrowDown || input.s ? 1 : 0),
    keyX = (input.ArrowRight || input.d ? 1 : 0) - (input.ArrowLeft || input.a ? 1 : 0);
  return { x: THREE.MathUtils.clamp(keyX + state.joystick.x, -1, 1), y: THREE.MathUtils.clamp(keyY + state.joystick.y, -1, 1) };
};
/* ---- the species chronicle: one story across every stage (kept per save slot) ---------------- */
function loadChronicle() {
  try {
    return readChronicle(localStorage.getItem(CHRONICLE_KEY));
  } catch (e) {
    return readChronicle(null);
  }
}
function recordChronicle(ev) {
  const ch = loadChronicle();
  if (!addEvent(ch, ev)) return;
  try {
    localStorage.setItem(CHRONICLE_KEY, JSON.stringify(ch));
  } catch (e) {
    /* storage full or unavailable: the moment is only lost from the history screen */
  }
}
/** Saves from before the chronicle existed: fill it once from what they prove. */
function seedChronicle() {
  try {
    if (localStorage.getItem(CHRONICLE_KEY)) return;
  } catch (e) {
    return;
  }
  const ch = loadChronicle();
  eventsFromSaves({
    cell: { cellStageComplete: progress.cellStageComplete, dietCard: progress.dietCard },
    creature: loadCreatureSave(),
    tribe: loadTribeSave(),
    regionName: (id) => regionById(id).name,
  }).forEach((ev, i) => addEvent(ch, ev, i));
  try {
    localStorage.setItem(CHRONICLE_KEY, JSON.stringify(ch));
  } catch (e) {
    /* nothing to do */
  }
}
function loadCreatureSave() {
  try {
    const raw = localStorage.getItem(CREATURE_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function creatureSnapshot(record, size) {
  try {
    return renderCellSnapshot(
      renderer,
      record,
      (rec) => {
        const b = buildCreatureBody(rec, { quality: "medium" });
        b.update(0, 0);
        return { root: b.root, rig: { dispose: () => b.dispose() } };
      },
      size,
    );
  } catch (e) {
    return null;
  }
}
function startCreatureStage(resume = false, intro = false) {
  if (creatureStage) return;
  const save = resume ? loadCreatureSave() : null;
  stickEnd();
  hideTip();
  state.paused = true;
  document.body.classList.add("creatureMode");
  audio.setAmbient("land");
  const cellCard = progress.dietCard || dietPath(state.plants, state.meat);
  const fresh = !save;
  audio.setMusic(fresh && intro ? "land" : "creature");
  const record = save?.record || creatureFromCell(currentRecord(), state.cellName);
  creatureStage = createCreatureStage({
    renderer,
    record,
    cellCard,
    save,
    quality: getQuality(),
    getInput: creatureMoveInput,
    sfx: playSfx,
    isTouch: isTouchUI,
    onMate: (d) => openCreatureEditorFor({ ...d, mated: true }, false),
    onGeneration: endCreatureGeneration,
    onChronicle: recordChronicle,
    onCard: (id, inst) => {
      const card = CREATURE_CARDS[id];
      progress.creatureCard = id;
      recordChronicle({ key: "creature:card", stage: "creature", icon: inst?.icon || card.icon, text: "Became " + (inst ? inst.title : card.title) + ", earning " + card.ability + "." });
      pendingReveal = {
        stage: "Creature Stage",
        title: inst?.title || card.title,
        icon: inst?.icon || card.icon,
        color: inst?.color || card.color,
        blurb: inst?.blurb || card.text,
        ability: card.title + " · " + card.ability,
        reasons: inst?.reasons || [],
        pros: inst?.pros || [],
        cons: inst?.cons || [],
        later: [inst?.legacy && { icon: inst.legacy.icon, text: "Tribal Stage: " + inst.legacy.text }, { icon: card.icon, text: "Tribal Stage: " + TRIBE_LEGACY.creature[id].text }].filter(Boolean),
      };
      flushReveal();
      saveGame(true);
    },
    onUnlock: (part, source) => popCard({ kind: "New part · " + source, title: part.name, text: part.desc, img: partThumb(renderer, part.id), icon: "🦴", color: "#f5c75a" }),
    onHistory: openPath,
    onSettings: openGameSettings,
    onTribe: (opts) => startTribeStage(null, opts),
    // The ☰ shortcut to the Tribal Stage: once a tribe exists, or in developer mode. Otherwise you get
    // there the Spore way, by mating once fully evolved.
    tribeUnlocked: () => devMode || !!loadTribeSave(),
    onSaved: () => markSaved(localStorage),
    portrait: (rec) => creatureSnapshot(rec, { width: 120, height: 90 }),
    reducedMotion: () => settings.reducedMotion,
    onExit: () => stopCreatureStage(),
    // Moving to another region: rebuild the stage there from the save it just wrote.
    onChangeRegion: () => {
      if (!creatureStage) return;
      stopCreatureStage(false);
      startCreatureStage(true, false);
    },
    intro: fresh && intro,
    deferIntro: fresh && intro,
    onIntroDone: () => {
      audio.setMusic("creature");
      document.body.classList.remove("cinematic");
    },
  });
  // Arrival: design the creature first; then (leaving the water) it crawls out onto land.
  if (fresh) {
    introAfterEditor = !!intro;
    openCreatureEditorFor(creatureStage.editorState(), true);
  }
}
function openCreatureEditorFor(d, arrival) {
  if (!creatureStage || creatureEditor) return;
  if (d.mated) audio.setMusic("mating");
  creatureStage.setPaused(true);
  document.body.classList.add("creatureEditing");
  stickEnd();
  creatureEditor = openCreatureEditor({
    renderer,
    record: d.record,
    unlocked: d.unlocked,
    seen: d.seen,
    progress: d.progress,
    dna: d.dna,
    // The part budget grows with the brain (never below what the creature already has).
    maxParts: partsLimit(creatureStage?.debug?.P?.brain || 1),
    quality: getQuality(),
    sfx: playSfx,
    onDone: (record, dnaLeft) => {
      closeCreatureEditor();
      creatureStage.applyDesign(record, dnaLeft);
      beginCreatureGeneration();
    },
    onCancel: () => {
      closeCreatureEditor();
      if (arrival || d.mated) beginCreatureGeneration();
    },
  });
}
function closeCreatureEditor() {
  creatureEditor = null;
  audio.setMusic(introAfterEditor ? "land" : "creature");
  document.body.classList.remove("creatureEditing");
  creatureStage?.setPaused(false);
  if (introAfterEditor && creatureStage) {
    // Designed: now the new creature crawls out of the sea.
    introAfterEditor = false;
    document.body.classList.add("cinematic");
    creatureStage.playIntro();
  }
  flushReveal();
}
let introAfterEditor = false;
/** A trait card earned while the editor was open waits until it closes. */
let pendingReveal = null;
function flushReveal() {
  if (!pendingReveal || creatureEditor || !creatureStage) return;
  const d = pendingReveal;
  pendingReveal = null;
  creatureStage.setPaused(true);
  showTraitCard({ ...d, reducedMotion: settings.reducedMotion, onClose: () => !creatureEditor && creatureStage?.setPaused(false) });
}
/** The species' character for the history screen, from a live stage's stats or a creature save. */
function identityView(src) {
  if (!src) return null;
  const ledger = src.ledger ? readLedger(src.ledger) : seedLedger(src);
  const id = INSTINCTS[src.instinct] ? src.instinct : leaningFor(ledger, src.leaning || null);
  const view = { profile: profileOf(ledger), earned: !!INSTINCTS[src.instinct], id: null };
  return id ? { ...instinctCard(id, ledger), ...view, id } : view;
}
/** A creature generation ends at mating: fill in what it achieved. */
function endCreatureGeneration(entry) {
  const last = progress.history.at(-1);
  if (last?.stage === "creature" && !last.ended) Object.assign(last, { alliances: entry.alliances, extinctions: entry.extinctions, deaths: entry.deaths, ended: true });
  storeHistory();
}
/** The design leaving the editor is the new living generation. */
function beginCreatureGeneration() {
  if (!creatureStage) return;
  const P = creatureStage.debug.P;
  // The last cell generation ends here: close its record with what it ate and fought.
  progress.history.forEach((g) => {
    if (g.ended) return;
    if (g.stage !== "creature")
      Object.assign(g, {
        plants: Math.max(0, state.plants - (progress.genStart?.plants || 0)),
        meat: Math.max(0, state.meat - (progress.genStart?.meat || 0)),
        kills: Math.max(0, progress.kills - (progress.genStart?.kills || 0)),
        deaths: Math.max(0, progress.deaths - (progress.genStart?.deaths || 0)),
      });
    g.ended = true;
  });
  progress.history.push({
    gen: progress.history.length + 1,
    stage: "creature",
    brain: P.brain,
    diet: P.diet,
    parts: P.record.parts.length + P.record.legs.length * 2,
    alliances: 0,
    extinctions: 0,
    deaths: 0,
    thumb: creatureSnapshot(P.record),
    record: JSON.parse(JSON.stringify(P.record)),
    ended: false,
  });
  storeHistory();
  syncPedia();
  audio.setMusic("creature");
}
function stopCreatureStage(toSoup = true) {
  if (!creatureStage) return;
  creatureEditor = null;
  document.querySelector(".crEditor")?.remove();
  creatureStage.dispose();
  creatureStage = null;
  document.body.classList.remove("creatureEditing", "cinematic");
  stickEnd();
  if (toSoup !== true) return; // handing over to another land stage
  document.body.classList.remove("creatureMode");
  audio.setAmbient("cell");
  audio.setMusic("cell");
  state.paused = false;
  updateCamera();
  toast("Back in the primordial soup. Your land creature is saved.");
}
/* ---- Tribal Stage -------------------------------------------------------------------
   Your creature's species, settled in a village. Reached from the Creature Stage's menu; it keeps
   its own save, and leaving it drops you back into the Creature Stage where you left off. */
let tribeStage = null;
/** The building, vehicle or spaceship editor, when open. It takes over the frame while it is. */
let modularEditor = null;
/**
 * Open the modular editor for a design. Stages pause underneath (the frame loop only drives the editor).
 * @param {"building"|"vehicle"|"ship"} kind
 * @param {object} [design]  defaults to a starter design of the first allowed role
 * @param {{ roles?:string[], onDone?:(design:object, stats:object)=>void, onCancel?:()=>void }} [opts]
 */
function openDesignEditor(kind, design, opts = {}) {
  if (modularEditor || creatureEditor) return null;
  const starters = STARTER_DESIGNS[kind] || {};
  const base = design || starters[opts.roles?.[0]] || Object.values(starters)[0];
  document.body.classList.add("designing");
  const finish = () => {
    modularEditor = null;
    document.body.classList.remove("designing");
  };
  modularEditor = openModularEditor({
    renderer,
    kind,
    design: JSON.parse(JSON.stringify(base)),
    roles: opts.roles,
    sfx: (k) => playSfx(k),
    onDone: (d, st) => {
      finish();
      opts.onDone?.(d, st);
    },
    onCancel: () => {
      finish();
      opts.onCancel?.();
    },
  });
  return modularEditor;
}
/** @param {{ cinematic?:boolean, frame?:object }} [opts] arriving from the stick-throw cutscene */
function startTribeStage(fallbackRecord = null, opts = {}) {
  if (tribeStage) {
    opts.frame?.remove();
    return;
  }
  const record = creatureStage ? creatureStage.record : loadCreatureSave()?.record || fallbackRecord;
  if (!record) {
    toast("Reach land first: the Tribal Stage starts from your creature.");
    return;
  }
  if (creatureStage) {
    creatureStage.save();
    stopCreatureStage(false);
  }
  stickEnd();
  hideTip();
  state.paused = true;
  document.body.classList.add("creatureMode", "tribeMode");
  audio.setAmbient("land");
  audio.setMusic("tribe");
  // The tribe settles in the species' home region, with what its earlier stages earned.
  const creatureSave = loadCreatureSave();
  tribeStage = createTribeStage({
    renderer,
    record,
    save: loadTribeSave(),
    regionId: creatureSave?.homeRegion || "coast",
    legacy: tribeLegacy(progress.dietCard || dietPath(state.plants, state.meat), creatureCardFor(creatureSave), creatureSave?.instinct || creatureSave?.leaning),
    onChronicle: recordChronicle,
    onHistory: openPath,
    quality: getQuality(),
    sfx: playSfx,
    onSettings: openGameSettings,
    onSaved: () => markSaved(localStorage),
    portrait: (rec) => creatureSnapshot(rec, { width: 96, height: 96 }),
    intro: opts.cinematic ? "campfire" : null,
    frame: opts.frame || null,
    reducedMotion: () => settings.reducedMotion,
    onCivilization: (o2 = {}) => {
      stopTribeStage();
      startCivStage(o2);
    },
    onExit: () => {
      stopTribeStage();
      startCreatureStage(true);
    },
  });
}
let civStage = null;
function loadCivSave() {
  try {
    return readCivSave(localStorage.getItem(CIV_SAVE_KEY));
  } catch (e) {
    return null;
  }
}
/** The Civilization Stage, on the tribe's island, with what every earlier stage earned. */
/** @param {{ frame?:object }} [opts] arriving from the Tribal → Civilization cutscene */
function startCivStage(opts = {}) {
  if (civStage) {
    opts.frame?.remove();
    return;
  }
  const ts = loadTribeSave();
  const cs = loadCreatureSave();
  if (creatureStage) {
    creatureStage.save();
    stopCreatureStage(false);
  }
  if (tribeStage) stopTribeStage();
  stickEnd();
  hideTip();
  state.paused = true;
  document.body.classList.add("inGameMode", "creatureMode", "tribeMode", "civMode");
  $("#intro").style.display = "none";
  state.runStarted = true;
  audio.setAmbient("land");
  audio.setMusic("civ");
  const creatureCard = creatureCardFor(cs);
  civStage = createCivStage({
    renderer,
    save: loadCivSave(),
    regionId: ts?.region || cs?.homeRegion || "coast",
    quality: getQuality(),
    name: ts?.look?.name || cs?.record?.name || state.cellName || "Your nation",
    color: ts?.look?.color ?? 0x3fa9d6,
    legacy: {
      cellDiet: progress.dietCard || dietPath(state.plants, state.meat),
      creatureCard: creatureCard ? CREATURE_CARDS[creatureCard]?.title : null,
      tribeTrait: ts?.path ? { peace: "Diplomatic", balance: "Industrious", conquest: "Warlike" }[ts.path] : null,
    },
    sfx: playSfx,
    openEditor: (kind, design, opts) => openDesignEditor(kind, design, opts),
    onCreation: (kind, design) => {
      if (!universe) return;
      universe.session.record({ id: "design:" + kind + ":" + design.role + ":" + Date.now().toString(36), kind, owned: true, name: design.name, sub: (kind === "building" ? "Building" : "Vehicle") + " · " + design.role, stage: "Civilization", design, place: "Home" });
    },
    onChronicle: (ev) => {
      recordChronicle(ev);
      if (/^civ:(war|attacked)/.test(ev?.key || "")) audio.setMusic("civWar");
      else if (/^civ:peace/.test(ev?.key || "")) audio.setMusic("civ");
    },
    onHistory: openPath,
    onSettings: openGameSettings,
    onSaved: () => markSaved(localStorage),
    onWon: () => syncPedia(),
    intro: opts.frame ? "arrive" : null,
    frame: opts.frame || null,
    reducedMotion: () => settings.reducedMotion,
    onRestart: () => {
      try {
        localStorage.removeItem(CIV_SAVE_KEY);
      } catch (e) {
        /* storage blocked: the stage restarts from memory */
      }
      stopCivStage();
      startCivStage();
    },
    onExit: () => {
      stopCivStage();
      startTribeStage();
    },
  });
}
function stopCivStage() {
  if (!civStage) return;
  civStage.save();
  civStage.dispose();
  civStage = null;
  document.body.classList.remove("civMode");
}
function stopTribeStage() {
  if (!tribeStage) return;
  tribeStage.save();
  tribeStage.dispose();
  tribeStage = null;
  document.body.classList.remove("tribeMode");
}
/** The last Cell stage is full: mating now ends the Cell Stage. */
const finalReady = () => state.tier >= LAST_TIER && state.food >= state.foodGoal;
function callMate(confirmed = false) {
  if (state.editor || state.paused || growth) return;
  if (state.mateSignal && state.mate) return;
  // Leaving the water is a big step: ask once, so it never happens by accident.
  if (finalReady() && !confirmed && !progress.landReady) {
    showDialog("Leave the water?", "Mate now and your species evolves: you'll design your creature, then crawl onto land.", [
      { label: "Not yet", action: () => {} },
      { label: "🦎 Evolve", primary: true, action: () => callMate(true) },
    ]);
    return;
  }
  state.finalMate = finalReady();
  state.mateSignal = true;
  state.mateTimer = 30;
  // Your mate is one of your own species: the nearest relative, or a new one arriving from off screen.
  let m = null,
    best = viewRadius() * 1.6;
  enemies.forEach((e) => {
    if (!e.userData.kin || !e.userData.alive) return;
    const d = distance2D(e.position, player.position);
    if (d < best) {
      best = d;
      m = e;
    }
  });
  if (!m) {
    const a = Math.random() * TAU,
      r = Math.min(viewRadius() * 0.9, 8);
    m = spawnKin({ x: player.position.x + Math.cos(a) * r, y: player.position.y + Math.sin(a) * r });
  }
  m.userData.mate = true;
  m.userData.state = "mate";
  m.userData.health = 999;
  const heart = makeHeartSprite();
  heart.position.set(0, 0.85, 0.9);
  m.add(heart);
  m.userData.heart = heart;
  state.mate = m;
  state.mateCallPulse = 0;
  $("#mateCueTitle").textContent = "♥";
  $("#mateCueText").textContent = "Calling…";
  $("#mateCue").classList.add("show");
  playMateSong();
  spawnBurst(m.position.x, m.position.y, 0xff9ed7, 14);
}
/* ---- Mate call and courtship ------------------------------------------------------
   Spore-style: your cell sings a call that ripples out through the water, a relative answers and
   swims to you, the two circle each other in a courtship dance, and an egg forms. */
const mateRings = [];
const mateRingGeometry = new THREE.RingGeometry(0.92, 1, 48);
function emitMateRing(x, y, color = 0xff8fcf) {
  const ring = new THREE.Mesh(mateRingGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
  ring.position.set(x, y, 0.15);
  ring.userData.life = 0;
  scene.add(ring);
  mateRings.push(ring);
}
function updateMateRings(dt) {
  for (let i = mateRings.length - 1; i >= 0; i--) {
    const r = mateRings[i];
    r.userData.life += dt;
    const k = r.userData.life / 1.8;
    r.scale.setScalar(0.4 + k * 6 * state.scale);
    r.material.opacity = 0.65 * (1 - k);
    if (k >= 1) {
      scene.remove(r);
      r.material.dispose();
      mateRings.splice(i, 1);
    }
  }
}
function playMateSong() {
  playSfx("mate");
}
/** The mate swims to you; when you meet, start the courtship dance. Runs every frame while calling. */
function updateMateCall(dt, time) {
  const m = state.mate,
    u = m.userData;
  if (state.courtship) return updateCourtship(dt, time);
  state.mateCallPulse -= dt;
  if (state.mateCallPulse <= 0) {
    state.mateCallPulse = 1.3;
    emitMateRing(player.position.x, player.position.y);
  }
  const dx = player.position.x - m.position.x,
    dy = player.position.y - m.position.y,
    d = Math.hypot(dx, dy);
  // The mate answers: it swims toward you with an eager, wiggling approach and calls back.
  u.stroke = (u.stroke ?? 0) + dt * 6;
  const arrive = Math.min(1, d / 2.5);
  m.rotation.z = steerHeading(u.velocity, m.rotation.z, (dx / (d || 1)) * 5 * arrive, (dy / (d || 1)) * 5 * arrive, dt, { turnRate: 3.2, stroke: strokePulse(u.stroke) });
  u.velocity.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
  u.velocity.clampLength(0, 2.6);
  m.position.x += u.velocity.x * dt;
  m.position.y += u.velocity.y * dt;
  if (u.heart) u.heart.scale.setScalar(0.6 + Math.sin(time * 7) * 0.08);
  u.answerTimer = (u.answerTimer ?? 0.6) - dt;
  if (u.answerTimer <= 0) {
    u.answerTimer = 1.3;
    emitMateRing(m.position.x, m.position.y, 0xffc4ea);
  }
  $("#mateCueText").textContent = d < 5 ? "Swim to your mate" : "Your mate is answering… " + Math.ceil(state.mateTimer) + "s";
  if (d < playerRadius() + (u.radius || 0.4) + 0.45) {
    state.courtship = { t: 0, cx: (player.position.x + m.position.x) / 2, cy: (player.position.y + m.position.y) / 2, a: Math.atan2(-dy, -dx), zoom: cameraZoomTarget };
    velocity.set(0, 0);
    jetVel.set(0, 0);
    knockVel.set(0, 0);
    u.velocity.set(0, 0);
    cameraZoomTarget *= 0.62;
    $("#mateCueText").textContent = "Courtship…";
    playMateSong();
  }
}
const COURTSHIP_TIME = 2.6;
function updateCourtship(dt, time) {
  const c = state.courtship,
    m = state.mate;
  c.t += dt;
  const k = Math.min(1, c.t / COURTSHIP_TIME);
  // The pair circle one another, drawing closer, then nuzzle.
  const radius = (playerRadius() + (m.userData.radius || 0.4)) * (0.55 - 0.3 * k);
  const spin = c.a + k * Math.PI * 3;
  player.position.x = c.cx + Math.cos(spin) * radius;
  player.position.y = c.cy + Math.sin(spin) * radius;
  m.position.x = c.cx - Math.cos(spin) * radius;
  m.position.y = c.cy - Math.sin(spin) * radius;
  angle = spin + Math.PI / 2 + 0.4;
  m.rotation.z = spin - Math.PI / 2 + 0.4;
  if (Math.random() < dt * 9) spawnBurst(c.cx + (Math.random() - 0.5) * radius * 2, c.cy + (Math.random() - 0.5) * radius * 2, 0xff9ed7, 3);
  if (Math.random() < dt * 1.6) emitMateRing(c.cx, c.cy, 0xffd0ef);
  if (c.t >= COURTSHIP_TIME) {
    cameraZoomTarget = c.zoom;
    state.courtship = null;
    // The egg: a glowing burst at the meeting point before the new generation hatches.
    spawnBurst(c.cx, c.cy, 0xfff1b8, 30);
    emitMateRing(c.cx, c.cy, 0xfff1b8);
    finishMate();
  }
}
function makeHeartSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff8dc9";
  ctx.shadowColor = "#ff67b5";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.moveTo(64, 104);
  ctx.bezierCurveTo(2, 59, 16, 18, 43, 27);
  ctx.bezierCurveTo(56, 31, 63, 42, 64, 46);
  ctx.bezierCurveTo(78, 14, 119, 21, 117, 53);
  ctx.bezierCurveTo(115, 73, 88, 92, 64, 104);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  s.scale.set(0.65, 0.65, 1);
  return s;
}
function finishMate() {
  if (!state.mateSignal) return;
  playSfx("mate");
  spawnBurst(player.position.x, player.position.y, 0xff99d0, 26);
  if (navigator.vibrate)
    try {
      navigator.vibrate([18, 35, 18]);
    } catch (e) {}
  state.mateSignal = false;
  state.courtship = null;
  if (state.mate) {
    state.mate.userData.alive = false;
    disposeTree(state.mate);
    enemies = enemies.filter((e) => e !== state.mate);
    state.mate = null;
  }
  state.dna += 6;
  state.mate = null;
  state.mateSignal = false;
  state.courtship = null;
  state.mateTimer = 0;
  spawnBurst(player.position.x, player.position.y, 0x80edff, 34);
  spawnFloatLabel(player.position.x, player.position.y + 0.5, "+6 DNA", 0xffe7a2);
  if (state.finalMate) {
    // The last mating of the Cell Stage: the species leaves the water. Saved first.
    state.finalMate = false;
    state.health = state.maxHealth;
    saveGame(true);
    updateHUD();
    completeCellStage();
    return;
  }
  // Any other mating is a new generation: design it in the editor. Growth carries on where it was.
  progress.editorPass = true;
  saveGame(true); // saved with the edit still owed, so reloading here reopens the editor
  updateHUD();
  setEditor(true);
}
/**
 * The growth bar is full in an ordinary stage: the cell grows into the next one by itself. The world
 * stays as it is; the cell swells while the camera pulls back, so the cells around it seem to shrink,
 * and last stage's neighbours become prey while the next stage's giants become its equals.
 */
function advanceTier() {
  if (growth || state.tier >= LAST_TIER) return;
  const fromScale = state.scale;
  state.tier = Math.min(LAST_TIER, state.tier + 1);
  const stage = stageFor(state.tier);
  state.food = 0;
  state.foodGoal = stage.foodGoal;
  state.foodSinceMate = 0;
  state.epicTimer = EPIC_INTERVAL();
  state.eliteTimer = 28 + Math.random() * 20;
  worldSize *= 1.4;
  regionCache.clear(); // each area's residents are chosen per stage
  // Who is big and who is small, now that you have grown. Giants of the stage you grew into shrink
  // from their towering size down to your own during the growth.
  enemies.forEach((e) => {
    const u = e.userData;
    const native = SPECIES[u.species]?.tier || state.tier;
    if (u.giant && native <= state.tier && u.giantBoost) {
      u.shrinkFrom = u.size;
      u.shrinkTo = u.size / u.giantBoost;
      u.giantBoost = 0;
    }
    u.giant = native > state.tier;
    u.prey = native < state.tier;
  });
  buildDeepCells(); // the deep holds bigger things now
  // The deeper soup of a bigger stage: top up its currents, clouds and meteors.
  for (let n = currents.length; n < WORLD_TUNING.currents[tierIndex()]; n++) createCurrent();
  for (let n = hazards.length; n < WORLD_TUNING.clouds[tierIndex()]; n++) createToxicCloud();
  for (let n = 0; n < WORLD_TUNING.meteors[tierIndex()]; n++) spawnMeteor();
  state.health = state.maxHealth;
  state.dna += 6;
  autoSaveTimer = 28;
  startGrowthPullback(state.tier, fromScale, Math.max(fromScale, stage.scale), 9 * stage.scale);
  // Rewards wait until the growth is over, so nothing covers the moment.
  const rewards = () => (stage.rewards || []).forEach((id) => unlockPart(id, "Reward for reaching the " + stage.name + " stage"));
  if (growth) growth.after = rewards;
  else rewards();
  saveGame(true);
  updateHUD();
}
let velocity = new THREE.Vector2(),
  angle = 0,
  cameraZoom = 10,
  cameraZoomTarget = 10,
  turnVelocity = 0,
  pointerThrust = false,
  keyboardSteering = false,
  dragging = null,
  editorReturnPos = null,
  editorReturnAngle = 0,
  editorReturnZoom = 10,
  editorReturnTargetZoom = 10,
  lastDisplayedDNA = state.dna;
function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.4).unproject(camera);
  return new THREE.Vector2(p.x, p.y);
}
function localFromWorld(p) {
  return p
    .clone()
    .sub(new THREE.Vector2(player.position.x, player.position.y))
    .rotateAround(new THREE.Vector2(0, 0), -player.rotation.z)
    .multiplyScalar(1 / state.scale);
}
function hitPlayerPart(pos) {
  let best = -1,
    dist = 0.28;
  parts.forEach((p, i) => {
    const worldPos = new THREE.Vector2(player.position.x, player.position.y).add(
      new THREE.Vector2(p.x, p.y).multiplyScalar(state.scale).rotateAround(new THREE.Vector2(0, 0), player.rotation.z),
    );
    const d = worldPos.distanceTo(pos);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}
function hitPartRing(pos) {
  if (state.selectedPart < 0 || !parts[state.selectedPart]) return -1;
  const p = parts[state.selectedPart],
    center = localNodeWorld(p);
  const d = center.distanceTo(pos) / (state.scale * (p.scale || 1));
  return d > 0.19 && d < 0.35 ? state.selectedPart : -1;
}
function localNodeWorld(n) {
  return new THREE.Vector2(n.x, n.y)
    .multiplyScalar(state.scale)
    .rotateAround(new THREE.Vector2(0, 0), player.rotation.z)
    .add(new THREE.Vector2(player.position.x, player.position.y));
}
function hitNode(pos) {
  let best = -1,
    dist = 0.23;
  nodes.forEach((n, i) => {
    const d = localNodeWorld(n).distanceTo(pos);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}
function hitNodeRadius(pos) {
  let best = -1,
    err = 0.14;
  nodes.forEach((n, i) => {
    if (i !== state.selectedNode) return;
    const d = Math.abs(localNodeWorld(n).distanceTo(pos) - n.r * state.scale);
    if (d < err) {
      err = d;
      best = i;
    }
  });
  return best;
}
function setCanvasCoords(pos) {
  const p = localFromWorld(pos);
  return snapToSurface(p.x, p.y);
}
/* ---- Touch joystick ----------------------------------------------------
   Touch anywhere on the water and the stick appears under your thumb; drag to swim that way.
   The fixed stick in the corner still works and shows where it lives. */
const STICK_DEAD_ZONE = 0.15;
const touchStick = { pointer: null, cx: 0, cy: 0, floating: false };
function stickStart(e, cx, cy, floating) {
  touchStick.pointer = e.pointerId;
  touchStick.cx = cx;
  touchStick.cy = cy;
  touchStick.floating = floating;
  const stick = $("#moveStick");
  if (floating) {
    const r = stick.getBoundingClientRect();
    stick.classList.add("floating");
    stick.style.left = cx - r.width / 2 + "px";
    stick.style.top = cy - r.height / 2 + "px";
    stick.style.bottom = "auto";
  }
  state.mouseActive = false;
  stickMove(e);
}
function stickMove(e) {
  if (touchStick.pointer !== e.pointerId) return;
  const stick = $("#moveStick"),
    knob = $("#moveStickKnob");
  const max = Math.max(38, stick.getBoundingClientRect().width * 0.42),
    dx = e.clientX - touchStick.cx,
    dy = e.clientY - touchStick.cy,
    mag = Math.hypot(dx, dy),
    f = mag > max ? max / mag : 1;
  state.joystick.x = (dx * f) / max;
  state.joystick.y = (-dy * f) / max;
  knob.style.left = "calc(50% + " + dx * f + "px)";
  knob.style.top = "calc(50% + " + dy * f + "px)";
  state.mouseActive = false;
  if (mag > 4) dismissControlHint();
}
function stickEnd(e) {
  if (e && e.pointerId !== undefined && touchStick.pointer !== e.pointerId) return;
  touchStick.pointer = null;
  state.joystick.x = 0;
  state.joystick.y = 0;
  const stick = $("#moveStick"),
    knob = $("#moveStickKnob");
  knob.style.left = "50%";
  knob.style.top = "50%";
  if (touchStick.floating) {
    stick.classList.remove("floating");
    stick.style.left = stick.style.top = stick.style.bottom = "";
  }
  touchStick.floating = false;
}
function onPointerDown(e) {
  if ($("#intro").style.display !== "none" || $("#hatchCinematic").style.display === "flex" || $("#dialogOverlay").style.display === "flex")
    return;
  // On land, the left half of the screen is the joystick and the right half turns the camera.
  if (tribeStage || civStage || creatureEditor || modularEditor || (creatureStage && (e.pointerType === "mouse" || e.clientX > innerWidth * 0.5))) return;
  canvas.setPointerCapture(e.pointerId);
  if (!state.editor && e.pointerType !== "mouse") {
    if (touchStick.pointer === null) stickStart(e, e.clientX, e.clientY, true);
    return;
  }
  const pos = toWorld(e);
  if (!state.editor) {
    dismissControlHint();
    pointerThrust = e.pointerType === "mouse" && e.button === 0 && !keyboardSteering;
  }
  state.pointerScreen = { x: e.clientX, y: e.clientY };
  state.mouseWorld.copy(pos);
  if (e.pointerType !== "mouse" || !keyboardSteering) state.mouseActive = true;
  if (state.editor) {
    if (state.paint) {
      const p = localFromWorld(pos),
        inside = (() => {
          let hit = false;
          for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
            const a = boundary[i],
              b = boundary[j];
            if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
          }
          return hit;
        })();
      if (inside) {
        saveUndo();
        state.paintStrokes.push({ x: p.x, y: p.y, color: state.accentColor, size: 0.075 });
        if (state.symmetry && Math.abs(p.y) > 0.1) state.paintStrokes.push({ x: p.x, y: -p.y, color: state.accentColor, size: 0.075 });
        rebuildPlayer();
      } else toast("Paint on the cell membrane.");
      return;
    }
    const ri = hitPartRing(pos);
    if (ri >= 0) {
      saveUndo();
      dragging = { kind: "rotate", index: ri };
      state.selectedPart = ri;
      rebuildPlayer();
      return;
    }
    let pi = hitPlayerPart(pos);
    const nearNode = hitNode(pos);
    if (pi >= 0 && nearNode >= 0 && localNodeWorld(nodes[nearNode]).distanceTo(pos) < localNodeWorld(parts[pi]).distanceTo(pos)) pi = -1;
    if (pi >= 0) {
      if (state.stack && state.selected) {
        const old = parts[pi];
        addPart(state.selected, old.x, old.y);
        return;
      }
      saveUndo();
      state.selectedPart = pi;
      dragging = { kind: "part", index: pi, startX: parts[pi].x, startY: parts[pi].y, outside: false };
      document.body.classList.add("dragging-part");
      $("#editorTrash").classList.remove("ready");
      rebuildPlayer();
      return;
    }
    const radiusIndex = hitNodeRadius(pos);
    if (radiusIndex >= 0) {
      saveUndo();
      state.selectedNode = radiusIndex;
      state.selectedPart = -1;
      dragging = { kind: "radius", index: radiusIndex };
      rebuildPlayer();
      return;
    }
    const ni = hitNode(pos);
    if (ni >= 0) {
      saveUndo();
      state.selectedNode = ni;
      state.selectedPart = -1;
      dragging = { kind: "node", index: ni, startNode: { ...nodes[ni] }, extended: false };
      rebuildPlayer();
      return;
    }
    if (state.selected) {
      const p = setCanvasCoords(pos);
      addPart(state.selected, p.x, p.y);
      return;
    }
  } else {
  }
}
function onPointerMove(e) {
  if (touchStick.pointer === e.pointerId) {
    stickMove(e);
    return;
  }
  const pos = toWorld(e);
  state.pointerScreen = { x: e.clientX, y: e.clientY };
  state.mouseWorld.copy(pos);
  if (!state.editor && e.pointerType === "mouse" && $("#intro").style.display === "none" && $("#dialogOverlay").style.display !== "flex") {
    const ret = $("#gameReticle");
    ret.style.display = "block";
    ret.style.left = e.clientX + "px";
    ret.style.top = e.clientY + "px";
  }
  if (!state.editor) {
    if (e.pointerType === "mouse" && !keyboardSteering) {
      state.mouseActive = true;
    } else if (e.pointerType === "mouse") state.mouseActive = false;
    return;
  }
  if (!dragging) return;
  if (dragging.kind === "node") {
    const i = dragging.index;
    if (!nodes[i]) return;
    const p = localFromWorld(pos),
      before = anchorPartsToSpine();
    const first = i === 0,
      last = i === nodes.length - 1;
    if (first || last) {
      // Dragging an end stretches the cell: new vertebrae appear as it grows, and merge away as it shrinks.
      const neighbor = nodes[first ? 1 : i - 1];
      let x = THREE.MathUtils.clamp(p.x, -SPINE.maxX, SPINE.maxX);
      x = first ? Math.min(x, neighbor.x - SPINE.minGap) : Math.max(x, neighbor.x + SPINE.minGap);
      nodes[i].x = x;
      if (Math.abs(x - neighbor.x) > SPINE.maxGap && nodes.length < 8) {
        const r = neighbor.r * 0.8 + nodes[i].r * 0.2;
        nodes.splice(first ? 1 : i, 0, { x: (x + neighbor.x) / 2, y: 0, r: Math.min(1.15, r) });
        if (!first) dragging.index = nodes.length - 1;
        playSfx("click");
      } else if (Math.abs(x - neighbor.x) <= SPINE.minGap + 0.001 && nodes.length > 2) {
        const outer = first ? nodes[2] : nodes[nodes.length - 3];
        if (!outer || Math.abs(x - outer.x) > SPINE.minGap) {
          nodes.splice(first ? 1 : i - 1, 1);
          if (!first) dragging.index = nodes.length - 1;
        }
      }
      state.selectedNode = dragging.index;
    } else {
      const lo = nodes[i - 1].x + SPINE.minGap,
        hi = nodes[i + 1].x - SPINE.minGap;
      nodes[i].x = lo < hi ? THREE.MathUtils.clamp(p.x, lo, hi) : (lo + hi) / 2;
    }
    nodes.forEach((n) => (n.y = 0));
    carryPartsWithSpine(before);
    scheduleRebuildPlayer();
  } else if (dragging.kind === "radius") {
    const n = nodes[dragging.index];
    if (n) {
      const p = localFromWorld(pos);
      const before = anchorPartsToSpine();
      n.r = THREE.MathUtils.clamp(new THREE.Vector2(p.x - n.x, p.y - n.y).length(), 0.22, 1.15);
      carryPartsWithSpine(before);
      scheduleRebuildPlayer();
    }
  } else if (dragging.kind === "part") {
    const p = localFromWorld(pos),
      a = parts[dragging.index];
    if (a) {
      const rect = $("#editorTrash").getBoundingClientRect(),
        overTrash = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      const hit = snapToSurface(p.x, p.y);
      const far = !pointInPolygon(boundary, p.x, p.y) && Math.hypot(p.x - hit.x, p.y - hit.y) > 0.75;
      dragging.outside = far || overTrash;
      const mate = parts.find((q, j) => j !== dragging.index && a.pairId && q.pairId === a.pairId);
      if (dragging.outside) {
        a.x = p.x;
        a.y = p.y;
      } else {
        Object.assign(a, { x: hit.x, y: hit.y, rotation: hit.angle });
        if (state.symmetry && mate) Object.assign(mate, { x: hit.x, y: -hit.y, rotation: -hit.angle });
      }
      if (mate && !state.symmetry) {
        a.pairId = nextPairId++;
        mate.pairId = nextPairId++;
      }
      $("#editorTrash").classList.toggle("ready", dragging.outside);
      $("#editorTrash").querySelector("span:last-child").textContent = dragging.outside ? "RELEASE TO REMOVE" : "DRAG OFF CELL TO REMOVE";
      scheduleRebuildPlayer();
    }
  } else if (dragging.kind === "rotate") {
    const p = parts[dragging.index];
    if (p) {
      const center = localNodeWorld(p);
      p.rotation = Math.atan2(pos.y - center.y, pos.x - center.x) - player.rotation.z;
      const mate = parts.find((q, j) => j !== dragging.index && p.pairId && q.pairId === p.pairId);
      if (state.symmetry && mate) mate.rotation = -p.rotation;
      scheduleRebuildPlayer();
    }
  }
}
function onPointerUp(e) {
  if (touchStick.pointer === e.pointerId) stickEnd(e);
  const old = dragging;
  if (old && old.kind === "part" && old.outside) {
    removePartAt(old.index, true);
  } else if (old && old.kind === "part") {
    const p = parts[old.index];
    if (p) {
      const snapped = snapToSurface(p.x, p.y);
      p.x = snapped.x;
      p.y = snapped.y;
      p.rotation = snapped.angle;
      const mate = parts.find((q, j) => j !== old.index && p.pairId && q.pairId === p.pairId);
      if (state.symmetry && mate) {
        const mirrored = snapToSurface(p.x, -p.y);
        mate.x = mirrored.x;
        mate.y = mirrored.y;
        mate.rotation = mirrored.angle;
      }
      rebuildPlayer();
    }
  }
  dragging = null;
  pointerThrust = false;
  document.body.classList.remove("dragging-part");
  $("#editorTrash").classList.remove("ready");
  if (e && e.pointerType !== "mouse") state.mouseActive = false;
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse" && !dragging && !pointerThrust) {
    state.mouseActive = false;
    $("#gameReticle").style.display = "none";
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (state.editor) {
      saveUndo();
      if (state.selectedPart >= 0 && parts[state.selectedPart]) {
        const p = parts[state.selectedPart];
        p.scale = THREE.MathUtils.clamp(p.scale - Math.sign(e.deltaY) * 0.08, 0.45, 2);
        const mate = parts.find((q, j) => j !== state.selectedPart && p.pairId && q.pairId === p.pairId);
        if (state.symmetry && mate) mate.scale = p.scale;
        rebuildPlayer();
      } else {
        const n = nodes[state.selectedNode];
        if (n) {
          const before = anchorPartsToSpine();
          n.r = THREE.MathUtils.clamp(n.r - Math.sign(e.deltaY) * 0.05, 0.25, 1.15);
          carryPartsWithSpine(before);
          $("#radiusSlider").value = n.r;
          rebuildPlayer();
        }
      }
    } else {
      cameraZoomTarget = THREE.MathUtils.clamp(cameraZoomTarget + Math.sign(e.deltaY) * 0.6, 7, 12 + stats().sight * 1.7);
    }
    e.preventDefault();
  },
  { passive: false },
);
function updateCamera() {
  const aspect = innerWidth / innerHeight;
  // Zoom describes the short side of the screen, so a phone held upright sees as much water across
  // as a landscape screen sees top to bottom (plus a little extra above and below).
  const portrait = aspect < 1 && !state.editor;
  const halfH = portrait ? (cameraZoom * 0.62) / aspect : cameraZoom / 2,
    halfW = portrait ? cameraZoom * 0.62 : (cameraZoom * aspect) / 2;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
function isTouchUI() {
  return (
    (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && window.matchMedia("(pointer:coarse)").matches) || "ontouchstart" in window
  );
}
function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function targetAngle() {
  return Math.atan2(state.mouseWorld.y - player.position.y, state.mouseWorld.x - player.position.x);
}
function updateAI(dt, time) {
  const playerMouths = parts
    .filter((p) => p.def.cat === "Mouths")
    .map((p) => ({ id: p.id, pos: localNodeWorld(p), reach: (p.id === "proboscis" ? 0.82 : p.id === "jaw" ? 0.62 : 0.42) * state.scale * (p.scale || 1) }));
  const playerSpikes = parts.filter((p) => p.id === "spike").map((p) => ({ pos: localNodeWorld(p), reach: 0.68 * state.scale * (p.scale || 1) }));
  const s = stats(),
    playerThreat = s.damage > 0 || s.diet !== "plant",
    playerSize = state.scale * (1 + parts.length * 0.03);
  enemies.forEach((e) => {
    const u = e.userData;
    if (!u.alive) {
      // Play out the death animation, then hide the corpse.
      if (u.dying) {
        u.rig.update(dt, time, {});
        if (u.rig.deathProgress >= 1) {
          u.dying = false;
          e.visible = false;
        }
      }
      return;
    }
    if (e.visible) {
      const farAway = distance2D(e.position, player.position) > 13;
      u.rig.setDetail(farAway ? 0 : 1);
      u.rig.update(dt, time, { speed: state.courtship && e === state.mate ? 1.2 : u.velocity.length() });
      // Keep the health bar and diet badge upright above the cell, whatever way it is facing.
      const up = u.overlayY;
      u.healthGroup.rotation.z = -e.rotation.z;
      u.healthGroup.position.set(Math.sin(e.rotation.z) * up, Math.cos(e.rotation.z) * up, 0.9);
      u.dietSprite.position.set(Math.sin(e.rotation.z) * (up + 0.22), Math.cos(e.rotation.z) * (up + 0.22), 0.93);
    }
    if (u.mate) return;
    if (u.epic) {
      updateEpic(e, u, dt);
      return;
    }
    if (u.stunned > 0) {
      u.stunned -= dt;
      e.rotation.z += Math.sin(time * 20) * dt * 0.25;
      return;
    }
    const swimSpeed = u.velocity.length();
    e.scale.set(
      u.size * (1 + Math.sin(time * 3 + u.phase) * 0.012 + Math.min(0.026, swimSpeed * 0.01)),
      u.size * (1 + Math.sin(time * 4.2 + u.phase) * 0.024 - Math.min(0.018, swimSpeed * 0.007)),
      u.size * (1 + Math.min(0.035, swimSpeed * 0.018)),
    );
    e.rotation.x += (THREE.MathUtils.clamp(-u.velocity.y * 0.055, -0.11, 0.11) - e.rotation.x) * (1 - Math.exp(-dt * 3));
    e.rotation.y += (THREE.MathUtils.clamp(u.velocity.x * 0.055, -0.12, 0.12) - e.rotation.y) * (1 - Math.exp(-dt * 3));
    const playerDist = distance2D(e.position, player.position),
      isSmall = u.size < playerSize * 0.88,
      playerBigger = playerSize > u.size * 1.18;
    if (!u.radius) u.radius = cellRadius(u.body.extent, u.size);
    // Behaviours add up to one desired acceleration; the cell then turns and swims toward it.
    const desire = aiDesire.set(0, 0);
    let target = null,
      targetFood = null,
      prey = null,
      pace = 1.2;
    // One pass over neighbours: prey to hunt, predators to fear, schoolmates to swim with.
    let threat = null,
      threatD = Infinity,
      preyD = Infinity,
      school = 0,
      cx = 0,
      cy = 0,
      ax = 0,
      ay = 0;
    for (const other of enemies) {
      if (other === e) continue;
      const o = other.userData;
      if (!o.alive || o.mate) continue;
      const dx = other.position.x - e.position.x,
        dy = other.position.y - e.position.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) continue;
      const d = Math.hypot(dx, dy);
      const sameKind = (u.kin && o.kin) || (u.species && o.species === u.species);
      if (u.diet === "meat" && !o.epic && !sameKind && o.size < u.size * 0.78 && d < 7 && d < preyD) {
        preyD = d;
        prey = other;
      }
      if (!sameKind && (o.epic || (o.diet === "meat" && o.size > u.size * 1.25)) && d < 3.5 + o.size * 2 && d < threatD) {
        threatD = d;
        threat = other;
      }
      if (sameKind && d < 4.5) {
        cx += other.position.x;
        cy += other.position.y;
        ax += o.velocity.x;
        ay += o.velocity.y;
        school++;
      }
    }
    if (prey) {
      // Aim where the prey is going, not where it is.
      target = leadTarget(e.position, prey.position, prey.userData.velocity, u.velocity.length() + 1);
      u.state = "hunt";
    } else if (u.diet === "meat" && !u.kin && u.size > state.scale * 0.7 && playerDist < 10 + state.tier * 1.5) {
      target = leadTarget(e.position, player.position, velocity, u.velocity.length() + 1);
      u.state = "hunt";
    }
    u.fleeTimer = Math.max(0, (u.fleeTimer || 0) - dt);
    const fearPlayer = !u.kin && (u.fleeTimer > 0 || (isSmall && (playerThreat || playerBigger) && playerDist < 8 && u.diet !== "meat"));
    if (!target && !u.kin && (fearPlayer || threat)) {
      u.state = "flee";
      const from = fearPlayer && (!threat || playerDist < threatD) ? player.position : threat.position;
      let fx = e.position.x - from.x,
        fy = e.position.y - from.y;
      const fl = Math.hypot(fx, fy) || 1;
      // Panicked zig-zag: real prey jinks rather than fleeing in a straight line.
      const jink = Math.sin(time * 4.3 + u.phase * 3) * 0.55,
        c = Math.cos(jink),
        sn = Math.sin(jink);
      fx /= fl;
      fy /= fl;
      desire.x += (fx * c - fy * sn) * 7.5;
      desire.y += (fx * sn + fy * c) * 7.5;
    } else if (!target) {
      u.state = "forage";
      let best = null,
        bestFood = null,
        bd = Infinity;
      // Food search is the costliest step for a crowd: reuse the last pick between rescans.
      u.retarget -= dt;
      const cached = u.foodTarget && u.foodTarget.userData.alive ? u.foodTarget : null;
      if (cached && u.retarget > 0) {
        bestFood = cached;
        best = cached.position;
        bd = cached.position.distanceTo(e.position);
      } else
        food.forEach((f) => {
          if (!f.userData.alive) return;
          const canEat = u.diet === "plant" ? f.userData.type === "plant" : f.userData.type === "meat";
          if (!canEat) return;
          const d = f.position.distanceTo(e.position);
          if (d < bd) {
            bd = d;
            best = f.position;
            bestFood = f;
          }
        });
      if (!cached || u.retarget <= 0) {
        u.foodTarget = bestFood;
        u.retarget = 0.5 + Math.random() * 0.3;
      }
      if (best && bd < 9) {
        target = best;
        targetFood = bestFood;
      } else {
        // Wander: a slowly drifting heading, with the odd pause to rest.
        u.state = "idle";
        u.wander = (u.wander ?? e.rotation.z) + (Math.random() - 0.5) * dt * 3.2;
        if ((u.rest = (u.rest || 0) - dt) <= 0) {
          desire.x += Math.cos(u.wander) * 0.85;
          desire.y += Math.sin(u.wander) * 0.85;
          if (Math.random() < dt * 0.09) u.rest = 0.8 + Math.random() * 2.2;
        }
      }
    }
    if (u.kin && !target && playerDist > 3 && playerDist < 9) {
      desire.x += ((player.position.x - e.position.x) / playerDist) * 0.5;
      desire.y += ((player.position.y - e.position.y) / playerDist) * 0.5;
    }
    if (school && u.state !== "hunt") {
      // Schooling: drift toward the group and match its heading.
      const k = u.state === "flee" ? 0.4 : 1;
      desire.x += ((cx / school - e.position.x) * 0.45 + (ax / school - u.velocity.x) * 0.7) * k;
      desire.y += ((cy / school - e.position.y) * 0.45 + (ay / school - u.velocity.y) * 0.7) * k;
    }
    if (target) {
      const tx = target.x - e.position.x,
        ty = target.y - e.position.y,
        tl = Math.hypot(tx, ty);
      if (tl > 0.01) {
        pace = (u.state === "hunt" ? 2.6 : 1.2) * (0.8 + 0.3 * u.size);
        // Ease off when arriving at food instead of overshooting it.
        const arrive = u.state === "hunt" ? 1 : Math.min(1, 0.35 + tl / 1.4);
        desire.x += (tx / tl) * pace * 2.4 * arrive;
        desire.y += (ty / tl) * pace * 2.4 * arrive;
      }
    }
    u.stroke = (u.stroke ?? u.phase) + dt * (3.5 + u.velocity.length() * 2.2);
    const turnRate = (u.alpha ? 3.6 : 2.7) / Math.sqrt(Math.max(0.45, u.size)) + (u.state === "flee" ? 1 : 0);
    e.rotation.z = steerHeading(u.velocity, e.rotation.z, desire.x, desire.y, dt, { turnRate, stroke: strokePulse(u.stroke) });
    u.velocity.multiplyScalar(Math.max(0, 1 - 1.05 * dt));
    // Bigger cells are faster in absolute terms, and hunters put on a burst when they chase.
    const cap = (u.alpha ? 3.1 : 2.35) * (0.8 + 0.3 * u.size) * (u.state === "hunt" ? 1.18 : 1) * (SPECIES[u.species]?.slow ?? 1);
    u.velocity.clampLength(0, cap);
    e.position.x += u.velocity.x * dt;
    e.position.y += u.velocity.y * dt;
    if (u.knockVel && u.knockVel.lengthSq() > 1e-4) {
      e.position.x += u.knockVel.x * dt;
      e.position.y += u.knockVel.y * dt;
      u.knockVel.multiplyScalar(Math.exp(-KNOCK_FADE * dt));
    }
    if (targetFood && e.position.distanceTo(targetFood.position) < 0.46 && targetFood.userData.alive) {
      u.rig.eat();
      spawnBurst(targetFood.position.x, targetFood.position.y, u.diet === "plant" ? 0x8effb7 : 0xffc19b, 6);
      targetFood.userData.alive = false;
      targetFood.visible = false;
      respawnFood(targetFood, 2800);
    }
    if (prey && prey.userData.alive && e.position.distanceTo(prey.position) < u.radius + (prey.userData.radius || 0.3) + 0.18) {
      u.state = "attack";
      u.attackCooldown -= dt;
      if (u.attackCooldown <= 0) {
        prey.userData.health -= u.alpha ? 4 : 1.7;
        u.attackCooldown = 0.7;
        knockNPC(prey, e.position, 1.1);
        if (prey.userData.health <= 0) killNPC(prey, false);
      }
    }
    const dPlayer = distance2D(e.position, player.position),
      // Whole-body hitboxes: anywhere on either cell counts, not just the centres.
      nearEnough = dPlayer < 4 * state.scale + u.size * 2,
      them = nearEnough ? npcCapsule(e) : null,
      within = (m) => pointCapsuleGap(m.pos.x, m.pos.y, them) < m.reach * 0.5,
      touching = nearEnough && capsuleGap(updatePlayerCapsule(), them) < 0.08 * state.scale,
      mouthParts = playerMouths,
      mouthTouch = nearEnough && playerMouths.some(within),
      spikeTouch = nearEnough && playerSpikes.some(within);
    if (!u.kin && (touching || mouthTouch || spikeTouch)) {
      const biter = mouthParts.find((p) => p.id === "jaw") || mouthParts.find((p) => p.id === "proboscis");
      if (mouthTouch && biter && s.diet !== "plant" && progress.biteCooldown <= 0) {
        // A bite hurts; it doesn't swallow. Damage grows with the mouth, attack parts and your size.
        const bite = ((biter.id === "jaw" ? 3.2 : 2.1) + s.damage * 0.35) * state.scale;
        progress.biteCooldown = 0.5;
        playerBody?.rig.eat();
        playSfx("damage");
        spawnBurst(e.position.x, e.position.y, 0xff7d7d, 8);
        const away = new THREE.Vector2(e.position.x - player.position.x, e.position.y - player.position.y).normalize();
        e.position.x += away.x * 0.35;
        e.position.y += away.y * 0.35;
        u.velocity.addScaledVector(away, 1.6);
        u.fleeTimer = u.diet === "meat" && !isSmall ? 0 : 2.6; // prey panics; predators fight back
        damageNPC(e, bite, u.epic);
      }
      if (spikeTouch && (u.spikeCooldown = (u.spikeCooldown || 0) - dt) <= 0) {
        u.spikeCooldown = 0.8;
        damageNPC(e, 1.4 * state.scale, false, player.position);
        spawnBurst(e.position.x, e.position.y, 0xffc27d, 5);
      }
      // Hunters bite back if they are anywhere near your size.
      const hunter = u.diet === "meat" && u.size > state.scale * 0.7;
      if (u.alive && hunter && touching) {
        u.state = "attack";
        u.attackCooldown -= dt;
        if (u.attackCooldown <= 0) {
          const ratio = THREE.MathUtils.clamp(u.size / state.scale, 0.6, u.giant ? 1.7 : 2.2); // giants: dangerous, not unfair
          const damage = Math.round((7 + state.tier * 2) * ratio * (u.alpha ? 1.8 : 1) * (u.epic ? 2.2 : 1));
          u.rig.eat?.();
          hurt(damage, "A " + (SPECIES[u.species]?.name || "predator") + " bit you!", e.position);
          u.attackCooldown = 0.8;
        }
      }
    }
    if (u.healthGroup) u.healthGroup.visible = u.health < u.maxHealth && dPlayer < 12;
    if (u.dietSprite) u.dietSprite.visible = (dPlayer < 9 && !u.kin) || u.alpha;
  });
  resolveCellCollisions();
  if (state.mateSignal && state.mate && state.mate.userData.alive) {
    const m = state.mate;
    updateMateCall(dt, time);
    if (!state.mateSignal) return;
    if (state.courtship) return;
    state.mateTimer -= dt;
    if (state.mateTimer <= 0) {
      state.mateSignal = false;
  state.courtship = null;
      m.userData.mate = false;
      m.userData.health = m.userData.maxHealth;
      if (m.userData.heart) {
        m.remove(m.userData.heart);
        disposeTree(m.userData.heart);
        m.userData.heart = null;
      }
      state.mate = null;
      $("#mateCue").classList.remove("show");
      spawnBurst(m.position.x, m.position.y, 0xffa5db, 8);
      updateHUD();
    }
  }
}
function updateWaypoint() {
  const el = $("#worldWaypoint");
  if (
    state.editor ||
    state.paused ||
    $("#intro").style.display !== "none" ||
    $("#hatchCinematic").style.display === "flex" ||
    $("#dialogOverlay").style.display === "flex" ||
    (state.food >= state.foodGoal && !state.mateSignal)
  ) {
    el.style.display = "none";
    return;
  }
  // Immersion: only your mate gets a guide arrow; food, shards and threats you find by looking.
  const candidates = state.mateSignal && state.mate && state.mate.userData.alive ? [{ obj: state.mate, kind: "mate", priority: 0 }] : [];
  candidates.sort(
    (a, b) => a.priority - b.priority || distance2D(a.obj.position, player.position) - distance2D(b.obj.position, player.position),
  );
  let chosen = null,
    projected = null;
  for (const q of candidates) {
    if (distance2D(q.obj.position, player.position) > Math.max(20, cameraZoom * 1.8)) continue;
    const p = new THREE.Vector3(q.obj.position.x, q.obj.position.y, 0).project(camera);
    if (Math.abs(p.x) > 0.78 || Math.abs(p.y) > 0.78) {
      chosen = q;
      projected = p;
      break;
    }
  }
  if (!chosen) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  el.dataset.kind = chosen.kind;
  el.classList.add("iconOnlyWaypoint");
  el.style.left = THREE.MathUtils.clamp((projected.x + 1) * 50, 7, 93) + "%";
  el.style.top = THREE.MathUtils.clamp((1 - projected.y) * 50, 12, 88) + "%";
  el.querySelector(".waypointArrow").style.transform = "rotate(" + (Math.atan2(-projected.y, projected.x) * 180) / Math.PI + "deg)";
  $("#waypointTitle").textContent = "";
  $("#waypointSubtitle").textContent = "";
}
function updateVisibility() {
  // Eyes extend sight, but it always reaches at least most of the screen, even on a tall phone.
  const sight = Math.max(8 + stats().sight * 1.9, viewRadius() * 0.85);
  food.forEach((f) => {
    f.visible = !!f.userData.alive && distance2D(f.position, player.position) < sight;
  });
  enemies.forEach((e) => {
    e.visible = (!!e.userData.alive || !!e.userData.dying) && (distance2D(e.position, player.position) < sight + 2 || e.userData.mate);
  });
  meteors.forEach((m) => {
    m.visible = !!m.userData.alive && distance2D(m.position, player.position) < sight + 4;
  });
  hazards.forEach((h) => {
    h.visible = distance2D(h.position, player.position) < sight + 3;
  });
  // Scenery is not hidden by sight: it is culled only once it is off screen.
  const view = viewRadius() + 1.5;
  debris.forEach((d) => (d.visible = distance2D(d.position, player.position) < view));
  colonies.forEach((c) => (c.mesh.visible = distance2D(c.mesh.position, player.position) < view + 1));
}
function updateScenery(dt, time) {
  const reach = 0.9 * state.scale;
  debris.forEach((d) => {
    if (!d.visible) return;
    const u = d.userData;
    d.rotation.z += u.spin * dt;
    if (u.rise) d.position.y += u.rise * dt; // bubbles drift slowly upwards
    d.position.x += Math.sin(time * 0.3 + u.phase) * dt * 0.05;
    d.position.y += Math.cos(time * 0.25 + u.phase) * dt * 0.04;
    // Swimming through debris nudges it aside.
    const dx = d.position.x - player.position.x,
      dy = d.position.y - player.position.y,
      dist = Math.hypot(dx, dy),
      min = reach + u.radius;
    if (dist < min && dist > 0.001) {
      const push = ((min - dist) / min) * dt * 3;
      d.position.x += (dx / dist) * push + velocity.x * dt * 0.4;
      d.position.y += (dy / dist) * push + velocity.y * dt * 0.4;
    }
  });
}

function updateFood(dt, time) {
  const s = stats(),
    mouths = parts.filter((p) => p.def.cat === "Mouths");
  // Mouth positions once per frame, not once per food item.
  const mouthPos = new Map(mouths.map((m) => [m, localNodeWorld(m)]));
  const mouthWorld = (p) => mouthPos.get(p);
  const near = (2.4 + Math.max(...nodes.map((n) => Math.abs(n.x))) ) * state.scale;
  food.forEach((f) => {
    if (!f.userData.alive) return;
    // Food out of sight only needs its drift; nothing it does there is visible or reachable.
    if (!f.visible && !f.userData.colony) {
      f.position.x += Math.sin(time + f.userData.phase) * dt * 0.09;
      return;
    }
    f.rotation.z += dt * 0.5;
    if (f.userData.colony) {
      // Buds ride their frond's sway until a mouth pulls them free.
      const b = f.userData.base;
      f.position.x += (b.x + Math.sin(time * 1.3 + f.userData.phase) * 0.05 - f.position.x) * Math.min(1, dt * 2);
      f.position.y += (b.y + Math.cos(time * 1.1 + f.userData.phase) * 0.05 - f.position.y) * Math.min(1, dt * 2);
    } else {
      f.position.x += Math.sin(time + f.userData.phase) * dt * 0.09;
      f.position.y += Math.cos(time * 0.8 + f.userData.phase) * dt * 0.07;
    }
    if (!f.userData.colony)
      currents.forEach((cur) => {
        if (f.position.distanceTo(cur.position) < 3) {
          f.position.x += cur.userData.force.x * dt * 0.4;
          f.position.y += cur.userData.force.y * dt * 0.4;
        }
      });
    if (Math.abs(f.position.x - player.position.x) > near || Math.abs(f.position.y - player.position.y) > near) return;
    const fp = new THREE.Vector2(f.position.x, f.position.y);
    if (!mouths.length) {
      if (distance2D(f.position, player.position) < 1.35 * state.scale && time > state.dietHintAt) {
        state.dietHintAt = time + 6;
        spawnBurst(f.position.x, f.position.y, 0x9ee8ef, 3);
      }
      return;
    }
    if (!compatible(f.userData.type)) {
      const nearMouth = mouths.some((m) => mouthWorld(m).distanceTo(fp) < 1.45 * state.scale);
      if (nearMouth && time > state.dietHintAt) {
        state.dietHintAt = time + 6;
        progress.wrongFoodAt = gameTime;
        spawnBurst(f.position.x, f.position.y, s.diet === "plant" ? 0xe89c9c : 0xffd0a0, 4);
      }
      return;
    }
    let nearest = Infinity,
      target = null,
      reach = 0.52;
    mouths.forEach((m) => {
      const wp = mouthWorld(m),
        d = wp.distanceTo(fp);
      const r = m.id === "proboscis" ? 1.12 : m.id === "filter" ? 0.68 : m.id === "jaw" ? 0.5 : 0.58;
      if (d < nearest) {
        nearest = d;
        target = wp;
        reach = r;
      }
    });
    if (nearest < reach * state.scale) eat(f);
    else if (nearest < (reach + 0.7) * state.scale && target) {
      const pull = target.clone().sub(fp);
      const strength =
        (0.6 + Math.max(0, 1 - nearest / ((reach + 0.7) * state.scale))) * dt * (parts.some((p) => p.id === "proboscis") ? 1.5 : 1);
      f.position.x += pull.x * strength;
      f.position.y += pull.y * strength;
    }
  });
  meteors.forEach((m) => {
    m.rotation.y += dt * 0.8;
    m.userData.life -= dt;
    if (distance2D(m.position, player.position) < 0.85 * state.scale) {
      spawnBurst(m.position.x, m.position.y, 0xffdd80, 20);
      const shardDna = 1;
      spawnFloatLabel(m.position.x, m.position.y, "+" + shardDna + " DNA", 0xffe27b);
      playSfx("meteor");
      state.dna += shardDna;
      state.discoveries++;
      const unlockedPart = meteorUnlock();
          m.userData.alive = false;
      disposeTree(m);
      updateHUD();
      saveGame(true);
      if (unlockedPart) spawnFloatLabel(player.position.x, player.position.y, "PART FOUND", 0xffdf86);
    } else if (m.userData.life <= 0) {
      m.userData.alive = false;
      disposeTree(m);
    }
  });
  meteors = meteors.filter((m) => m.userData.alive);
}
function updateHazards(dt, time) {
  hazards.forEach((h) => {
    h.scale.set(1.5 + Math.sin(time + h.userData.phase) * 0.1, 1 + Math.cos(time * 0.8 + h.userData.phase) * 0.1, 0.3);
    if (distance2D(h.position, player.position) < h.userData.radius) hurt(3, "Toxic cloud!");
    enemies.forEach((e) => {
      if (e.userData.alive && distance2D(e.position, h.position) < h.userData.radius) damageNPC(e, 0.3 * dt, false);
    });
  });
  vents.forEach((v) => {
    v.timer -= dt;
    if (v.active) {
      v.mesh.scale.setScalar(1.05 + Math.sin(time * 17) * 0.12);
    } else {
      v.mesh.scale.setScalar(0.48 + Math.sin(time * 2 + v.mesh.position.x) * 0.035);
    }
    if (v.timer <= 0) {
      v.active = !v.active;
      if (v.active) {
        v.timer = 0.72;
        v.mesh.scale.setScalar(1.25);
        if (distance2D(player.position, v.mesh.position) < 8) {
          spawnBurst(v.mesh.position.x, v.mesh.position.y, 0x8eeeff, 18);
        }
      } else {
        v.timer = 4.8 + Math.random() * 2.2;
        v.mesh.scale.setScalar(0.48);
      }
    }
    if (v.active) {
      const d = distance2D(player.position, v.mesh.position);
      if (d < 3.2) {
        const n = new THREE.Vector2(player.position.x - v.mesh.position.x, player.position.y - v.mesh.position.y);
        if (n.length() < 0.01) n.set(1, 0);
        n.normalize();
        velocity.add(n.multiplyScalar(dt * 8));
      }
      enemies.forEach((e) => {
        const ed = distance2D(e.position, v.mesh.position);
        if (e.userData.alive && ed < 3) {
          const n = new THREE.Vector2(e.position.x - v.mesh.position.x, e.position.y - v.mesh.position.y);
          if (n.length() < 0.01) n.set(1, 0);
          n.normalize();
          e.userData.velocity.add(n.multiplyScalar(dt * 5));
        }
      });
    }
  });
  currents.forEach((cur) => {
    cur.rotation.z = Math.sin(time * 0.25 + cur.userData.phase) * 0.2;
    if (distance2D(player.position, cur.position) < 4.5) {
      velocity.x += cur.userData.force.x * dt * 0.75;
      velocity.y += cur.userData.force.y * dt * 0.75;
    }
    enemies.forEach((e) => {
      if (e.userData.alive && distance2D(e.position, cur.position) < 4) {
        e.userData.velocity.x += cur.userData.force.x * dt * 0.65;
        e.userData.velocity.y += cur.userData.force.y * dt * 0.65;
      }
    });
  });
}
function createVent() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.045, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x89ecfa, transparent: true, opacity: 0.8 }),
  );
  g.add(ring);
  for (let i = 0; i < 8; i++) {
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.055 + Math.random() * 0.08, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xb6f8ff, transparent: true, opacity: 0.7 }),
    );
    bubble.position.set(Math.cos((i / 8) * Math.PI * 2) * 0.3, Math.sin((i / 8) * Math.PI * 2) * 0.3, 0.05);
    g.add(bubble);
  }
  g.position.set(
    player.position.x + (Math.random() - 0.5) * 18 * worldSize,
    player.position.y + (Math.random() - 0.5) * 12 * worldSize,
    -0.1,
  );
  g.userData = { timer: 4, active: false };
  hazardGroup.add(g);
  vents.push({ mesh: g, timer: 4, active: false });
  while (vents.length > WORLD_TUNING.maxVents(state.tier)) {
    const oldest = vents.shift();
    disposeTree(oldest.mesh);
  }
}

/* ---- Infinite world ----------------------------------------------------
   The soup has no edges. Everything lives in a disc around the player that is a little larger than
   the screen; whatever drifts out of the disc is recycled into the ring just outside the view
   (mostly ahead of where the player is swimming), so the population stays dense wherever you go
   without the cost of creating and destroying meshes. Index 0 of each list is tier 1. */
const WORLD_TUNING = {
  // Spore-like density: a few cells in view at a time, food you have to look for.
  foodParticles: [14, 16, 18, 20],
  meatChunks: [2, 2, 3, 3],
  colonies: [3, 4, 4, 5],
  debris: [14, 16, 18, 20],
  npcs: [6, 7, 8, 9],
  kin: [2, 2, 3, 3],
  clouds: [1, 1, 2, 2],
  currents: [1, 2, 2, 2],
  meteors: [1, 1, 1, 2],
  maxLiveMeteors: [2, 2, 3, 3],
  maxVents: (tier) => 3 + tier,
  plantShare: { plant: 0.7, meat: 0.38, omni: 0.55 },
  epicDamage: 50,
  regionSize: 40,
};
/** Mobile GPUs get a smaller crowd; the same disc, just sparser. */
const crowdScale = () => (getQuality() === "low" ? 0.7 : getQuality() === "medium" ? 0.85 : 1);
const tuned = (list) => Math.max(1, Math.round(list[tierIndex()] * crowdScale()));
const tierIndex = () => Math.min(3, Math.max(0, state.tier - 1));
const TAU = Math.PI * 2;
function viewRadius() {
  return Math.hypot(camera.right - camera.left, camera.top - camera.bottom) / 2;
}
const activeRadius = () => viewRadius() * 1.8 + 2;
const despawnRadius = () => viewRadius() * 2.3 + 3;
/** Uniform point in the active disc, at least `minR` from the player. */
function discSpot(minR = 0, maxR = activeRadius()) {
  const a = Math.random() * TAU,
    r = Math.sqrt(minR * minR + Math.random() * (maxR * maxR - minR * minR));
  return { x: player.position.x + Math.cos(a) * r, y: player.position.y + Math.sin(a) * r };
}
/** Point in the ring just off screen, biased towards the direction of travel. */
function ringSpot() {
  const moving = velocity.lengthSq() > 0.1;
  const a =
    moving && Math.random() < 0.7 ? Math.atan2(velocity.y, velocity.x) + (Math.random() - 0.5) * Math.PI * 1.3 : Math.random() * TAU;
  const minR = viewRadius() + 1.2,
    maxR = activeRadius(),
    r = minR + Math.random() * (maxR - minR);
  return { x: player.position.x + Math.cos(a) * r, y: player.position.y + Math.sin(a) * r };
}
const randomInWorld = () => discSpot(3);

/** Each 40-unit region has its own residents, drawn from the current stage's roster and fixed by the world seed. */
const regionCache = new Map();
const regionKey = (x, y) => Math.floor(x / WORLD_TUNING.regionSize) + "," + Math.floor(y / WORLD_TUNING.regionSize);
function regionSpecies(x, y) {
  const key = state.tier + ":" + regionKey(x, y);
  if (!regionCache.has(key)) {
    const [rx, ry] = regionKey(x, y).split(",").map(Number);
    const rng = makeRng((state.worldSeed ^ Math.imul(rx, 73856093) ^ Math.imul(ry, 19349663) ^ Math.imul(state.tier, 83492791)) >>> 0);
    const { residents } = stageFor(state.tier);
    const shuffled = (list) => [...list].sort(() => rng() - 0.5);
    const plants = shuffled(residents.plant),
      hunters = shuffled(residents.meat);
    const chosen = [plants[0], ...(rng() < 0.7 && plants[1] ? [plants[1]] : []), hunters[0], ...(rng() < 0.65 && hunters[1] ? [hunters[1]] : [])];
    // Every area also holds this stage's easy prey, so a carnivore always has something to catch.
    const easy = residents.plant.find((id) => SPECIES[id]?.easy);
    if (easy && !chosen.includes(easy)) chosen.push(easy);
    regionCache.set(key, chosen.filter(Boolean));
  }
  return regionCache.get(key);
}
/** A species' size in world units: its own size range, measured against the stage it belongs to. */
function speciesSize(id) {
  const sp = SPECIES[id];
  const [lo, hi] = sp.size || [0.7, 1.1];
  return (lo + Math.random() * (hi - lo)) * stageScale(sp.tier || state.tier);
}

function clearWorldEntities() {
  state.worldGeneration++;
  for (const list of [food, enemies, meteors, hazards, currents, floatingMeat, debris]) {
    list.forEach((o) => disposeTree(o));
    list.length = 0;
  }
  colonies.forEach((c) => disposeTree(c.mesh));
  colonies.length = 0;
  partOrbs.forEach((o) => {
    meteorGroup.remove(o);
    o.material.dispose();
  });
  partOrbs.length = 0;
  vents.forEach((v) => disposeTree(v.mesh));
  vents.length = 0;
  particles.forEach((o) => disposeTree(o));
  particles.length = 0;
  epics.length = 0;
  state.mate = null;
  state.mateSignal = false;
  state.courtship = null;
  $("#mateCue").classList.remove("show");
}

function addDebris(spot) {
  const d = createDebris(Math.random, timeUniform);
  d.position.set(spot.x, spot.y, -0.25);
  sceneryGroup.add(d);
  debris.push(d);
  return d;
}
function addColony(spot) {
  const { mesh, tips } = createPlantColony(Math.random, timeUniform);
  mesh.position.set(spot.x, spot.y, -0.12);
  sceneryGroup.add(mesh);
  const colony = { mesh, tips, buds: [] };
  tips.forEach((t, i) => {
    const bud = addFood("plant", spot.x + t.x, spot.y + t.y, "particle");
    bud.userData.colony = colony;
    bud.userData.slot = i;
    colony.buds.push(bud);
  });
  colonies.push(colony);
  return colony;
}
function placeColony(colony, spot) {
  colony.mesh.position.set(spot.x, spot.y, -0.12);
  colony.buds.forEach((bud, i) => {
    const t = colony.tips[i];
    bud.position.set(spot.x + t.x, spot.y + t.y, 0.2);
    bud.userData.base.set(bud.position.x, bud.position.y);
    bud.userData.alive = true;
  });
}
/** Put a loose piece of food back into the world off screen (or regrow a colony bud in place). */
function respawnFood(f, delay) {
  const generation = state.worldGeneration;
  setTimeout(
    () => {
      if (generation !== state.worldGeneration || !f.parent || f.userData.alive) return;
      if (f.userData.temporary) {
        disposeTree(f);
        food = food.filter((o) => o !== f);
        return;
      }
      const colony = f.userData.colony;
      if (colony) {
        const t = colony.tips[f.userData.slot];
        f.position.set(colony.mesh.position.x + t.x, colony.mesh.position.y + t.y, 0.2);
      } else {
        const p = ringSpot();
        f.position.set(p.x, p.y, 0.2);
      }
      f.userData.base.set(f.position.x, f.position.y);
      f.userData.alive = true;
    },
    f.userData.colony ? delay * 7 : delay,
  );
}
/**
 * Most arrivals are local residents. Some are last stage's species, now small prey, and once in a
 * while one of the next stage's giants drifts through.
 */
const GIANT_BOOST = 2.3;
function spawnRegionNPC(spot, pack = null) {
  const roll = pack ? 1 : Math.random(),
    prey = preyFor(state.tier),
    giants = stageFor(state.tier).giants;
  let species;
  // Deeper zones hold more hunters.
  const huntersHere = !pack && Math.random() < ZONES[cellZone].hunters ? regionSpecies(spot.x, spot.y).filter((sp) => SPECIES[sp]?.diet === "meat") : [];
  if (huntersHere.length) species = huntersHere[Math.floor(Math.random() * huntersHere.length)];
  else if (roll < 0.22 && prey.length) species = prey[Math.floor(Math.random() * prey.length)];
  else if (roll < 0.34 && giants.length && enemies.filter((e) => e.userData.alive && e.userData.giant).length < 2) species = giants[Math.floor(Math.random() * giants.length)];
  else if (pack) species = pack;
  else {
    const residents = regionSpecies(spot.x, spot.y);
    species = residents[Math.floor(Math.random() * residents.length)];
  }
  const e = makeNPC({ x: spot.x, y: spot.y, species, diet: SPECIES[species]?.diet, size: speciesSize(species) });
  const native = SPECIES[species]?.tier || state.tier;
  e.userData.giant = native > state.tier;
  e.userData.prey = native < state.tier;
  if (e.userData.giant) {
    // Next stage's cells tower over you, as in Spore (they come down to size when you grow into their stage).
    e.userData.giantBoost = GIANT_BOOST;
    e.userData.size *= GIANT_BOOST;
    e.scale.setScalar(e.userData.size);
  }
  // Local hunters often travel in small packs.
  if (!pack && SPECIES[species]?.diet === "meat" && native === state.tier && Math.random() < 0.18) {
    const extra = 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < extra; i++) spawnRegionNPC({ x: spot.x + (Math.random() - 0.5) * 3, y: spot.y + (Math.random() - 0.5) * 3 }, species);
  }
  return e;
}

/* ---- Your own species ------------------------------------------------
   Kin are built from your current cell with a light mutation, so they look like relatives, share
   your diet, never attack you and swim in loose groups. Your mate is chosen from them. */
function kinRecord() {
  return snapPartsToSurface(mutateCellRecord(currentRecord(), makeRng((Math.random() * 1e9) | 0), 0.45), { faceOutward: true });
}
function spawnKin(spot, opts = {}) {
  return makeNPC({ record: kinRecord(), kin: true, size: state.scale * (0.85 + Math.random() * 0.2), x: spot.x, y: spot.y, ...opts });
}
function spawnKinGroup(spot) {
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) spawnKin({ x: spot.x + (Math.random() - 0.5) * 2.2, y: spot.y + (Math.random() - 0.5) * 2.2 });
}
/** After the editor, relatives evolve with you: rebuild every kin in place from the new design. */
function refreshKin() {
  enemies
    .filter((e) => e.userData.kin && e.userData.alive && !e.userData.mate)
    .forEach((e) => {
      const { x, y } = e.position;
      e.userData.alive = false;
      disposeTree(e);
      enemies = enemies.filter((o) => o !== e);
      spawnKin({ x, y });
    });
}

/* ---- zones of the microscopic ocean: shallows → kelp / vents → twilight → trench ------------- */
let cellZone = "shallows";
const zonesSeen = new Set(["shallows"]);
/** Check which zone the cell is in; on a change, the soup around it changes too. */
function updateZone() {
  const z = zoneAt(player.position.x, player.position.y);
  if (z === cellZone) return;
  cellZone = z;
  const info = ZONES[z];
  const label = document.getElementById("zoneLabel");
  if (label) {
    label.innerHTML = `<span aria-hidden="true">${info.icon}</span><b>${info.name}</b>`;
    label.title = info.name + ": " + info.desc;
  }
  document.getElementById("depthShade").style.opacity = String(info.dark);
  if (!zonesSeen.has(z)) {
    zonesSeen.add(z);
    toast(info.icon + " " + info.name + ": " + info.desc);
    // The first visit to a new depth is worth a little DNA.
    state.dna += 3 + info.depth * 2;
    updateHUD();
    if (z === "trench") recordChronicle({ key: "cell:trench", stage: "cell", icon: "🌑", text: "Dived into the Abyssal Trench." });
  }
  rezoneFood();
}
/**
 * Off-screen food takes on the new zone's mix, and deep zones get drifting remains to scavenge
 * ("marine snow"), so the soup visibly changes as you go deeper.
 */
function rezoneFood() {
  const share = plantShareIn(cellZone, WORLD_TUNING.plantShare[stats().diet] ?? 0.55);
  const far = viewRadius() * 1.1;
  const swap = food.filter((f) => f.userData.alive && f.userData.kind === "particle" && !f.userData.colony && distance2D(f.position, player.position) > far);
  for (const f of swap) {
    const want = Math.random() < share ? "plant" : "meat";
    if (want === f.userData.type) continue;
    const { x, y } = f.position;
    f.userData.alive = false;
    f.userData.temporary = "gone";
    addFood(want, x, y, "particle");
  }
  const extra = Math.round(tuned(WORLD_TUNING.meatChunks) * (ZONES[cellZone].chunks - 1));
  for (let i = 0; i < extra; i++) {
    const p = ringSpot();
    const c = addFood("meat", p.x, p.y, "chunk");
    c.userData.temporary = true;
    c.userData.remains = true;
  }
}
function spawnWorld() {
  clearWorldEntities();
  const diet = stats().diet,
    plantShare = plantShareIn(cellZone, WORLD_TUNING.plantShare[diet] ?? 0.55);
  for (let n = 0; n < tuned(WORLD_TUNING.foodParticles); n++) {
    const p = discSpot(1);
    addFood(Math.random() < plantShare ? "plant" : "meat", p.x, p.y, "particle");
  }
  for (let n = 0; n < tuned(WORLD_TUNING.meatChunks); n++) {
    const p = discSpot(2);
    addFood("meat", p.x, p.y, "chunk");
  }
  for (let n = 0; n < tuned(WORLD_TUNING.colonies); n++) addColony(discSpot(3));
  for (let n = 0; n < tuned(WORLD_TUNING.debris); n++) addDebris(discSpot(1.5));
  // Keep the arrival area calm: no cell spawns right on top of the player.
  for (let n = 0; n < tuned(WORLD_TUNING.npcs); n++) spawnRegionNPC(discSpot(6));
  for (let n = 0; n < tuned(WORLD_TUNING.kin);) {
    spawnKinGroup(discSpot(4, viewRadius() * 1.2));
    n = enemies.filter((e) => e.userData.kin).length;
  }
  for (let n = 0; n < WORLD_TUNING.currents[tierIndex()]; n++) createCurrent();
  for (let n = 0; n < WORLD_TUNING.clouds[tierIndex()]; n++) createToxicCloud();
  for (let n = 0; n < WORLD_TUNING.meteors[tierIndex()]; n++) spawnMeteor();
  state.eliteTimer = Math.min(state.eliteTimer, 28 + Math.random() * 14);
  buildDeepCells();
  updateVisibility();
}

/** Recycle whatever has drifted out of the active disc into the ring ahead, and top up the cast. */
function maintainWorld() {
  const here = regionKey(player.position.x, player.position.y);
  if (!progress.regions.has(here)) {
    progress.regions.add(here);
    }
  const far = despawnRadius(),
    px = player.position.x,
    py = player.position.y;
  const isFar = (o) => Math.hypot(o.position.x - px, o.position.y - py) > far;
  for (const f of food) {
    if (f.userData.colony || !isFar(f)) continue;
    if (f.userData.temporary) {
      f.userData.alive = false;
      f.userData.temporary = "gone";
      continue;
    }
    const p = ringSpot();
    f.position.set(p.x, p.y, 0.2);
    f.userData.base.set(p.x, p.y);
    f.userData.alive = true;
  }
  const gone = food.filter((f) => f.userData.temporary === "gone");
  if (gone.length) {
    gone.forEach((f) => disposeTree(f));
    food = food.filter((f) => f.userData.temporary !== "gone");
  }
  for (const c of colonies) if (isFar(c.mesh)) placeColony(c, ringSpot());
  for (const d of debris) {
    if (!isFar(d)) continue;
    const p = ringSpot();
    d.position.set(p.x, p.y, -0.25);
    d.rotation.z = Math.random() * TAU;
  }
  for (const list of [currents, hazards]) {
    for (const h of list) {
      if (!isFar(h)) continue;
      const p = ringSpot();
      h.position.x = p.x;
      h.position.y = p.y;
    }
  }
  meteors.forEach((m) => {
    if (m.userData.alive && isFar(m)) {
      m.userData.alive = false;
      disposeTree(m);
    }
  });
  meteors = meteors.filter((m) => m.userData.alive);
  // Cells that wander off are released; fresh ones arrive from the ring, chosen by local region.
  const leaving = enemies.filter((e) => e.userData.alive && !e.userData.mate && !e.userData.epic && isFar(e));
  if (leaving.length) {
    leaving.forEach((e) => {
      e.userData.alive = false;
      disposeTree(e);
    });
    enemies = enemies.filter((e) => !leaving.includes(e));
  }
  const live = enemies.filter((e) => e.userData.alive && !e.userData.epic && !e.userData.mate);
  const kinCount = live.filter((e) => e.userData.kin).length,
    otherCount = live.length - kinCount - live.filter((e) => e.userData.alpha).length;
  for (let n = Math.min(3, tuned(WORLD_TUNING.npcs) - otherCount); n > 0; n--) spawnRegionNPC(ringSpot());
  if (kinCount < tuned(WORLD_TUNING.kin) && Math.random() < 0.2) spawnKinGroup(ringSpot());
}

function createCurrent() {
  const g = new THREE.Group();
  const heading = Math.random() * Math.PI * 2;
  for (let i = 0; i < 5; i++) {
    const points = [];
    for (let j = 0; j < 10; j++) {
      const t = j / 9;
      points.push(new THREE.Vector3((t - 0.5) * 6, (i - 2) * 0.55 + Math.sin(t * 5 + i) * 0.18, -0.35));
    }
    g.add(tube(points, 0.022, 0x9fe4ff, { transparent: true, opacity: 0.13, depthWrite: false }));
  }
  const pos = randomInWorld(3);
  g.position.set(pos.x, pos.y, 0);
  g.rotation.z = heading;
  const strength = 0.9 + Math.random() * 0.7;
  g.userData = {
    phase: Math.random() * 6,
    force: new THREE.Vector2(Math.cos(heading), Math.sin(heading)).multiplyScalar(strength),
    baseHeading: heading,
  };
  currentGroup.add(g);
  currents.push(g);
  return g;
}

function createToxicCloud() {
  const g = new THREE.Group();
  const puffs = 7;
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 + Math.random() * 0.35, 14, 10),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? 0x8cf67a : 0xb4e85a,
        transparent: true,
        opacity: 0.1 + Math.random() * 0.08,
        depthWrite: false,
      }),
    );
    const a = (i / puffs) * Math.PI * 2;
    puff.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.4, 0);
    g.add(puff);
  }
  const pos = randomInWorld(3);
  if (Math.hypot(pos.x, pos.y) < 6) pos.x += pos.x < 0 ? -6 : 6;
  g.position.set(pos.x, pos.y, -0.05);
  g.userData = { phase: Math.random() * 6, radius: 1.5 + Math.random() * 0.5 };
  hazardGroup.add(g);
  hazards.push(g);
  return g;
}

function createMeteorMesh() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    material(0xffd56d, 0.12, { emissive: 0xffb43c, emissiveIntensity: 0.9, metalness: 0.2 }),
  );
  core.scale.set(1, 0.85, 0.8);
  g.add(core);
  const shard = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.2, 0),
    material(0xfff3c4, 0.1, { emissive: 0xffe08a, emissiveIntensity: 0.7 }),
  );
  shard.position.set(0.22, 0.2, 0.1);
  g.add(shard);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture,
      color: 0xffd36a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.scale.set(1.9, 1.9, 1);
  g.add(glow);
  return g;
}

function spawnMeteor() {
  const live = meteors.filter((m) => m.userData.alive);
  if (live.length >= WORLD_TUNING.maxLiveMeteors[tierIndex()]) return null;
  const m = createMeteorMesh();
  // Prefer a spot the player can reach in a few seconds but not on top of them.
  let spot = randomInWorld(1.5);
  for (let tries = 0; tries < 6; tries++) {
    const d = Math.hypot(spot.x - player.position.x, spot.y - player.position.y);
    if (d > 5 && d < 15 * Math.max(1, worldSize * 0.7)) break;
    spot = randomInWorld(1.5);
  }
  m.position.set(spot.x, spot.y, 0.25);
  m.userData = { alive: true, life: 70, phase: Math.random() * 6 };
  meteorGroup.add(m);
  meteors.push(m);
  return m;
}

/* ---- Growing up a stage ----------------------------------------------------------
   No banner: as in Spore, the camera pulls back to show how much bigger the world has become while
   time slows and the HUD steps aside, then settles in at the new size. */
let growth = null;
/**
 * Spore's growth moment: the cell swells, the camera pulls back so everything else seems to shrink,
 * then settles in close again at the new scale. Gameplay size follows the visible size every frame.
 */
function startGrowthPullback(tier, fromScale = state.scale, toScale = state.scale, toZoom = cameraZoomTarget) {
  if (growth) return;
  const reduced = settings.reducedMotion;
  growth = { t: 0, dur: reduced ? 1.8 : 4.2, from: cameraZoom, to: toZoom, zoom: cameraZoom, fromScale, toScale };
  cameraZoomTarget = toZoom;
  state.damageCooldown = Math.max(state.damageCooldown, growth.dur); // nothing bites mid-growth
  velocity.set(0, 0);
  spawnBurst(player.position.x, player.position.y, 0x80edff, 30);
  document.body.classList.add("growthPullback");
  playSfx("growth");
  // Screen readers still hear which stage this is.
  const live = $("#growthAnnounce");
  const stage = GROWTH_STAGES[tier - 1];
  if (live && stage) live.textContent = "Stage " + tier + " of " + LAST_TIER + ": " + stage.name;
}
/** Advances the pull-back; returns the (slowed) time step for the world. */
function updateGrowthPullback(dt) {
  const g = growth;
  g.t += dt;
  const k = Math.min(1, g.t / g.dur);
  /*
   * Spore's growth, in two beats. First the cell swells on screen while the camera holds still and
   * the world slows: you are visibly bigger than everything around you. Then the camera draws back
   * until you are your usual size on screen again, so everything else shrinks away round you, and
   * the giants of your new stage shrink down to your size (see advanceTier).
   */
  const SWELL = 0.42;
  const a = Math.min(1, k / SWELL),
    b = Math.max(0, (k - SWELL) / (1 - SWELL));
  // Swell with a little overshoot, like a breath in.
  const swell = a < 1 ? 1 + 2.4 * Math.pow(a - 1, 3) + 1.4 * Math.pow(a - 1, 2) : 1;
  const ratio = g.toScale / g.fromScale;
  const settle = b * b * (3 - 2 * b);
  const peak = ratio * 1.12; // at the top of the swell you look this much bigger on screen
  state.scale = g.fromScale * (b > 0 ? peak + (ratio - peak) * settle : 1 + (peak - 1) * swell);
  g.zoom = g.from + (g.to - g.from) * settle;
  player.scale.setScalar(state.scale);
  // Former giants shrink down to your new size while the camera draws back.
  for (const e of enemies) {
    const u = e.userData;
    if (u.shrinkTo === undefined) continue;
    u.size = u.shrinkFrom + (u.shrinkTo - u.shrinkFrom) * settle;
    e.scale.setScalar(u.size);
    if (k >= 1) delete u.shrinkTo;
  }
  if (k >= 1) {
    growth = null;
    cameraZoom = g.to;
    state.scale = g.toScale;
    player.scale.setScalar(state.scale);
    document.body.classList.remove("growthPullback");
    g.after?.();
    saveGame(true);
  }
  return dt * (k < SWELL ? 0.3 : 0.3 + 0.7 * settle); // the world holds its breath while you swell
}

/* ---- Epic cells -------------------------------------------------------------
   Spore's epic cells: a rare, enormous predator that comes in from the edge of the screen and
   chases you. It is a little slower than you at full speed but turns like a whale, so keep swimming
   and dodge. Survive until it gives up and swims off, and a meteor shard falls from its wake. */
const EPIC_INTERVAL = () => 150 + Math.random() * 90;
const EPIC_CHASE = 26; // seconds it hunts you before giving up
function spawnEpic() {
  if (enemies.some((e) => e.userData.alive && e.userData.epic)) return null;
  const size = stageScale(state.tier) * 2.6;
  const e = makeNPC({ size, alpha: true, diet: "meat", color: 0x9a3b73, nucleusColor: 0x40163a, x: 0, y: 0 });
  const u = e.userData;
  u.epic = true;
  u.alpha = false;
  u.elite = true;
  u.health = u.maxHealth = 60;
  u.hitCooldown = 0;
  u.chase = EPIC_CHASE;
  u.leaving = false;
  u.deathsAtSpawn = progress.deaths;
  // In from just past the edge of the view, already heading your way.
  const a = Math.random() * TAU,
    r = viewRadius() * 1.1 + size;
  e.position.set(player.position.x + Math.cos(a) * r, player.position.y + Math.sin(a) * r, 0.2);
  u.velocity.set(-Math.cos(a), -Math.sin(a)).multiplyScalar(1.2);
  e.rotation.z = Math.atan2(u.velocity.y, u.velocity.x);
  epics.push(e);
  playSfx("looming");
  state.shake = Math.max(state.shake, 0.35);
  spawnFloatLabel(player.position.x, player.position.y + 1.4, "SOMETHING HUGE IS COMING", 0xff9aa9);
  return e;
}
const wrapAngle = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, TAU) - Math.PI;
function updateEpic(e, u, dt) {
  const top = 2.1 + Math.min(1.05, stats().speed * 0.24);
  const dx = player.position.x - e.position.x,
    dy = player.position.y - e.position.y,
    d = Math.hypot(dx, dy);
  u.chase -= dt;
  // It gives up when time runs out, or once it has caught you (you respawn elsewhere).
  if (!u.leaving && (u.chase <= 0 || progress.deaths !== u.deathsAtSpawn)) u.leaving = true;
  const heading = Math.atan2(u.velocity.y, u.velocity.x);
  let speed = u.velocity.length();
  let turnTo = heading;
  if (!u.leaving) {
    turnTo = Math.atan2(dy, dx);
    speed = Math.min(top * 0.86, speed + 1.5 * dt);
  } else {
    // Swim off: turn away from you and speed up until out of sight.
    turnTo = Math.atan2(-dy, -dx);
    // Slow while it wheels round, then away at full pace.
    const facingAway = Math.cos(wrapAngle(turnTo - heading)) > 0.3;
    speed = facingAway ? Math.min(top * 1.4, speed + 2 * dt) : Math.max(top * 0.45, speed - 2.5 * dt);
  }
  const turned = heading + THREE.MathUtils.clamp(wrapAngle(turnTo - heading), -0.85 * dt, 0.85 * dt);
  u.velocity.set(Math.cos(turned) * speed, Math.sin(turned) * speed);
  e.position.x += u.velocity.x * dt;
  e.position.y += u.velocity.y * dt;
  e.rotation.z = turned;
  u.hitCooldown = Math.max(0, (u.hitCooldown || 0) - dt);
  if (!u.leaving && d < u.size * 0.85 + state.scale * 0.6 && u.hitCooldown <= 0) {
    hurt(WORLD_TUNING.epicDamage, "The epic cell caught you!", e.position);
    spawnBurst(player.position.x, player.position.y, 0xff6f86, 18);
    const shove = new THREE.Vector2(dx, dy);
    if (shove.length() < 0.01) shove.set(1, 0);
    knockVel.addScaledVector(shove.normalize(), 6 + u.size);
    u.hitCooldown = 2.5;
  }
  if (u.leaving && d > viewRadius() * 1.7 + u.size) {
    const survived = progress.deaths === u.deathsAtSpawn;
    u.alive = false;
    disposeTree(e);
    enemies = enemies.filter((o) => o !== e);
    epics.splice(epics.indexOf(e), 1);
    if (survived) dropEpicShard();
  }
}
/** The reward for outlasting an epic: a shard lands just ahead of you. */
function dropEpicShard() {
  const m = createMeteorMesh();
  const ahead = 2.2 * state.scale;
  m.position.set(player.position.x + Math.cos(angle) * ahead, player.position.y + Math.sin(angle) * ahead, 0.25);
  m.userData = { alive: true, life: 60, phase: Math.random() * 6 };
  meteorGroup.add(m);
  meteors.push(m);
  spawnBurst(m.position.x, m.position.y, 0xffdd80, 26);
  playSfx("shard");
}

/* ---- Part unlocks ------------------------------------------------------
   As in Spore, parts are found rather than bought outright: in meteor shards, in the bodies of cells
   that carry them, and as a reward for reaching a new stage. Once found, a part costs DNA to add. */
function unlockPart(id, source) {
  const d = defs.find((x) => x.id === id);
  if (!d || unlocked.has(id)) return null;
  unlocked.add(id);
  progress.unlockedSinceEditor++;
  playSfx("unlock");
  popCard({ kind: "NEW PART", img: partThumbs.get(id), title: d.name, text: source + ". " + d.desc, color: "#f5c75a" });
  renderCatalog();
  saveGame(true);
  return d;
}
/** Reward for a meteor shard or an elite kill: one part from this stage's meteor pool. */
function meteorUnlock() {
  const locked = defs.filter((d) => !unlocked.has(d.id)).map((d) => d.id);
  const pool = meteorPool(state.tier, locked);
  if (!pool.length) {
    state.dna += 2;
    spawnFloatLabel(player.position.x, player.position.y + 0.8, "+2 DNA", 0xffe7a2);
    return null;
  }
  return unlockPart(pool[Math.floor(Math.random() * pool.length)], "Found in a meteor shard");
}

const orbTextures = new Map();
function orbTexture(id) {
  if (!orbTextures.has(id)) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, "#fff8d8");
    g.addColorStop(0.45, "#f5c75acc");
    g.addColorStop(1, "#f5c75a00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const thumb = partThumbs.get(id);
    if (thumb) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 22, 30, 84, 63);
        tex.needsUpdate = true;
      };
      img.src = thumb;
    }
    orbTextures.set(id, tex);
  }
  return orbTextures.get(id);
}
/** A dead cell may leave behind one of its parts that the player has not found yet. */
function dropPartOrb(e) {
  const sp = SPECIES[e.userData.species];
  if (!sp) return;
  const candidates = [...new Set(sp.parts.map((p) => p.id))].filter((id) => !unlocked.has(id) && !partOrbs.some((o) => o.userData.id === id));
  if (!candidates.length || Math.random() > (e.userData.alpha ? 1 : 0.22)) return;
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTexture(id), transparent: true, depthWrite: false }));
  const size = 0.9 * Math.sqrt(stageScale(state.tier));
  orb.scale.set(size, size, 1);
  orb.position.set(e.position.x, e.position.y, 0.6);
  orb.renderOrder = 15;
  orb.userData = { id, from: sp.name, life: 45, phase: Math.random() * 6, size };
  meteorGroup.add(orb);
  partOrbs.push(orb);
}
function updatePartOrbs(dt, time) {
  for (let i = partOrbs.length - 1; i >= 0; i--) {
    const o = partOrbs[i],
      u = o.userData;
    u.life -= dt;
    const pulse = 1 + Math.sin(time * 4 + u.phase) * 0.08;
    o.scale.set(u.size * pulse, u.size * pulse, 1);
    o.material.opacity = Math.min(1, u.life / 3);
    const picked = distance2D(o.position, player.position) < 0.9 * state.scale;
    if (picked) {
      spawnBurst(o.position.x, o.position.y, 0xffdf86, 18);
      unlockPart(u.id, "Taken from a " + u.from);
    }
    if (picked || u.life <= 0 || unlocked.has(u.id)) {
      meteorGroup.remove(o);
      o.material.dispose();
      partOrbs.splice(i, 1);
    }
  }
}
function animateCell(time, dt) {
  const speed = velocity.length(),
    surge = Math.min(0.035, speed * 0.012);
  player.scale.set(
    state.scale * (1 + Math.sin(time * 3.6) * 0.009 + surge),
    state.scale * (1 + Math.sin(time * 4.9 + 1.2) * 0.018 - surge * 0.58),
    state.scale * (1 + Math.min(0.045, speed * 0.018)),
  );
  playerBody?.rig.update(dt, time, { speed });
}
/* ---- the deep: enormous cells drifting far below, blurred and out of reach (as in Spore) ----------
   Bodies of bigger species, faint and tinted by the depth, moving with parallax behind the play layer.
   Not part of the world: nothing there can touch you, and you can't reach it. */
const deepGroup = new THREE.Group();
scene.add(deepGroup);
let deepCells = [];
const DEEP_TINT = new THREE.Color(0x182a66);
function buildDeepCells() {
  deepCells.forEach((d) => disposeTree(d.g));
  deepCells = [];
  const ahead = Object.keys(SPECIES).filter((id) => (SPECIES[id].tier || 1) >= Math.min(LAST_TIER, state.tier + 1));
  const pool = ahead.length ? ahead : Object.keys(SPECIES);
  const count = getQuality() === "low" ? 2 : 3;
  for (let i = 0; i < count; i++) {
    const id = pool[Math.floor(Math.random() * pool.length)];
    const record = snapPartsToSurface(speciesRecord(id, Math.random), { faceOutward: true });
    const body = buildCellBody(record, { role: "npc", seed: 1 + i, shadow: false });
    body.root.traverse((m) => {
      if (!m.material) return;
      m.material = m.material.clone(); // faint and blue with depth (the clone drops the wobble shader: they are far off)
      m.material.transparent = true;
      m.material.opacity = 0.3 + Math.random() * 0.1;
      m.material.depthWrite = false;
      m.material.color?.lerp(DEEP_TINT, 0.7);
      if (m.material.emissive) m.material.emissive.set(0x000000);
      m.renderOrder = -95;
    });
    const g = new THREE.Group();
    g.add(body.root);
    g.scale.setScalar(stageScale(state.tier) * (7 + Math.random() * 5));
    deepGroup.add(g);
    const span = cameraZoom * 1.6;
    deepCells.push({ g, rig: body.rig, x: (Math.random() - 0.5) * span * 2, y: (Math.random() - 0.5) * span * 2, heading: Math.random() * TAU, speed: 0.35 + Math.random() * 0.3, phase: Math.random() * TAU });
  }
}
function updateDeepCells(dt, time) {
  const cx = camera.position.x,
    cy = camera.position.y,
    span = cameraZoom * 1.7;
  for (const d of deepCells) {
    d.heading += Math.sin(time * 0.13 + d.phase) * 0.12 * dt;
    d.x += Math.cos(d.heading) * d.speed * dt;
    d.y += Math.sin(d.heading) * d.speed * dt;
    // Parallax: the deep moves past slower than the water you swim in.
    let px = cx * 0.55 + d.x,
      py = cy * 0.55 + d.y;
    // Keep them passing through the view: one that drifts far off comes round on the other side.
    if (px - cx > span) d.x -= span * 2;
    if (px - cx < -span) d.x += span * 2;
    if (py - cy > span) d.y -= span * 2;
    if (py - cy < -span) d.y += span * 2;
    px = cx * 0.55 + d.x;
    py = cy * 0.55 + d.y;
    d.g.position.set(px, py, -12);
    d.g.rotation.z = d.heading;
    d.rig?.update?.(dt, time, { speed: d.speed });
  }
}
function updateGame(dt, time) {
  updateDeepCells(dt, time);
  if (
    state.editor ||
    state.paused ||
    $("#intro").style.display !== "none" ||
    $("#hatchCinematic").style.display === "flex" ||
    $("#dialogOverlay").style.display === "flex"
  )
    return;
  state.shake = Math.max(0, state.shake - dt);
  $("#damageFlash").style.opacity = String(state.shake * 1.9);
  updateBurstFX(dt);
  animateCell(time, dt);
  if (state.mouseActive && state.pointerScreen)
    state.mouseWorld.copy(toWorld({ clientX: state.pointerScreen.x, clientY: state.pointerScreen.y }));
  if (growth) cameraZoom = growth.zoom;
  else cameraZoom += (cameraZoomTarget - cameraZoom) * (1 - Math.exp(-dt * 2.25));
  const s = stats(),
    keyForward = (input.ArrowUp || input.w ? 1 : 0) - (input.ArrowDown || input.s ? 1 : 0),
    keyTurn = (input.ArrowRight || input.d ? 1 : 0) - (input.ArrowLeft || input.a ? 1 : 0),
    joy = state.joystick || { x: 0, y: 0 },
    joyMag = Math.min(1, Math.hypot(joy.x, joy.y)),
    joyActive = joyMag > STICK_DEAD_ZONE,
    turn = THREE.MathUtils.clamp(keyTurn, -1, 1);
  let forward = THREE.MathUtils.clamp(keyForward + (pointerThrust ? 0.75 : 0), -1, 1);
  if (forward !== 0 || turn !== 0) dismissControlHint();
  if (keyForward !== 0 || keyTurn !== 0 || Math.abs(joy.x) + Math.abs(joy.y) > 0.05) state.mouseActive = false;
  let desiredTurn = turn * s.turn * 0.9;
  if (joyActive) {
    // Direction steering: the cell turns to face where the stick points (screen and world share axes)
    // and swims that way. The turn rate is proportional to the remaining angle, so it settles on the
    // heading instead of overshooting, and thrust is held back until the cell is roughly facing it.
    const delta = THREE.MathUtils.euclideanModulo(Math.atan2(joy.y, joy.x) - angle + Math.PI, TAU) - Math.PI;
    const maxTurn = 1.9 + s.turn * 0.8; // the turning stat still matters, but no cell feels unsteerable
    desiredTurn = THREE.MathUtils.clamp(delta * 4, -maxTurn, maxTurn);
    // Angular inertia: the spin builds up and dies down instead of snapping.
    turnVelocity += (desiredTurn - turnVelocity) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(delta) < Math.abs(turnVelocity * dt)) turnVelocity = delta / Math.max(dt, 1e-3);
    const throttle = (joyMag - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
    forward = Math.max(forward, throttle * (0.2 + 0.8 * Math.max(0, Math.cos(delta))));
  } else if (state.mouseActive) {
    const delta = THREE.MathUtils.euclideanModulo(targetAngle() - angle + Math.PI, Math.PI * 2) - Math.PI;
    desiredTurn = THREE.MathUtils.clamp(delta * 2.35, -s.turn * 1.35, s.turn * 1.35);
    turnVelocity += (desiredTurn - turnVelocity) * (1 - Math.exp(-dt * 3.6));
  } else {
    // Let go and the spin eases out over a moment instead of stopping dead.
    turnVelocity += (desiredTurn - turnVelocity) * (1 - Math.exp(-dt * (turn !== 0 ? 4.2 : 3.4)));
  }
  if (state.knock > 0) {
    state.knock -= dt;
    forward *= 0.6;
  }
  if (state.courtship) forward = 0;
  angle += turnVelocity * dt;
  const bodyLength = Math.abs(nodes[nodes.length - 1].x - nodes[0].x),
    bodyMass = 1 + nodes.reduce((sum, n) => sum + n.r * n.r, 0) * 0.11 + bodyLength * 0.1 + parts.length * 0.025,
    thrust = (s.speed * 1.72) / bodyMass;
  // Flagellum strokes: thrust pulses slightly, so a cell surges and glides rather than sliding.
  strokePhase += dt * (5 + velocity.length() * 2);
  const stroke = 0.75 + 0.5 * Math.max(0, Math.sin(strokePhase)) ** 2;
  velocity.x += Math.cos(angle) * forward * thrust * stroke * dt;
  velocity.y += Math.sin(angle) * forward * thrust * stroke * dt;
  state.stamina = Math.min(100, state.stamina + dt * 9);
  const wantsJet = input[" "] || state.jetQueued;
  state.jetQueued = false;
  if (wantsJet && state.jetCooldown <= 0 && state.stamina >= 35 && parts.some((p) => p.id === "jet")) {
    // The burst rides on top of normal swimming and glides out over about half a second.
    const burst = 7.5 * Math.sqrt(state.scale);
    jetVel.x += Math.cos(angle) * burst;
    jetVel.y += Math.sin(angle) * burst;
    state.shake = Math.max(state.shake || 0, 0.12);
    state.stamina -= 35;
    state.jetCooldown = 1.5;
    playSfx("jet");
    spawnBurst(player.position.x - Math.cos(angle) * 0.65, player.position.y - Math.sin(angle) * 0.65, 0x8befff, 8);
  } else if (input[" "] && !parts.some((p) => p.id === "jet") && (state.jetHintCooldown || 0) <= 0) {
    state.jetHintCooldown = 3;
  }
  state.jetCooldown -= dt;
  const waterDrag = 0.34 + parts.length * 0.012 + (parts.some((p) => p.id === "armour") ? 0.13 : 0);
  velocity.multiplyScalar(Math.exp(-waterDrag * dt));
  velocity.clampLength(0, 2.1 + Math.min(1.05, s.speed * 0.24));
  player.position.x += (velocity.x + jetVel.x + knockVel.x) * dt;
  player.position.y += (velocity.y + jetVel.y + knockVel.y) * dt;
  jetVel.multiplyScalar(Math.exp(-JET_FADE * dt));
  knockVel.multiplyScalar(Math.exp(-KNOCK_FADE * dt));
  player.rotation.z = angle;
  const speedForward = velocity.x * Math.cos(angle) + velocity.y * Math.sin(angle),
    speedLateral = -velocity.x * Math.sin(angle) + velocity.y * Math.cos(angle);
  player.rotation.x += (THREE.MathUtils.clamp(-speedForward * 0.045, -0.12, 0.12) - player.rotation.x) * (1 - Math.exp(-dt * 3.8));
  player.rotation.y += (THREE.MathUtils.clamp(speedLateral * 0.13, -0.2, 0.2) - player.rotation.y) * (1 - Math.exp(-dt * 4.5));
  wakeCooldown -= dt;
  if (velocity.length() > 0.65 && wakeCooldown <= 0) {
    spawnWake();
    wakeCooldown = 0.12;
  }
  const poisonParts = parts.filter((p) => p.id === "poison");
  if (poisonParts.length && Math.random() < dt * 3) {
    const g = new THREE.Mesh(poisonPuffGeometry, new THREE.MeshBasicMaterial({ color: 0x8cf67a, transparent: true, opacity: 0.65 }));
    g.position.set(player.position.x - Math.cos(angle) * 0.8, player.position.y - Math.sin(angle) * 0.8, 0.3);
    g.userData.life = 2;
    hazardGroup.add(g);
    particles.push(g);
  }
  particles.forEach((p) => {
    p.userData.life -= dt;
    p.material.opacity = Math.max(0, (p.userData.life / 2) * 0.6);
    enemies.forEach((e) => {
      if (e.userData.alive && !e.userData.kin && e.position.distanceTo(p.position) < 0.5) damageNPC(e, dt * 2);
    });
    if (p.userData.life <= 0) {
      hazardGroup.remove(p);
      p.material.dispose();
    }
  });
  particles = particles.filter((p) => p.userData.life > 0);
  state.damageCooldown = Math.max(0, state.damageCooldown - dt);
  state.electricCooldown = Math.max(0, state.electricCooldown - dt);
  if (parts.some((p) => p.id === "electric") && state.electricCooldown <= 0) {
    const near = enemies.find(
      (e) => e.userData.alive && !e.userData.mate && !e.userData.kin && distance2D(e.position, player.position) < 2.1 * state.scale,
    );
    if (near) {
      const pulse = new THREE.Mesh(electricPulseGeometry, new THREE.MeshBasicMaterial({ color: 0x91a9ff, transparent: true, opacity: 0.8 }));
      pulse.position.set(player.position.x, player.position.y, 0.8);
      scene.add(pulse);
      setTimeout(() => {
        scene.remove(pulse);
        pulse.material.dispose();
      }, 300);
      enemies.forEach((e) => {
        if (e.userData.alive && distance2D(e.position, player.position) < 2.4) damageNPC(e, 5, true, player.position);
      });
      state.electricCooldown = 3.2;
    }
  }
  updateFood(dt, time);
  updateScenery(dt, time);
  updatePartOrbs(dt, time);
  progress.runTime += dt;
  progress.distanceSwum += velocity.length() * dt;
  progress.biteCooldown = Math.max(0, progress.biteCooldown - dt);
  updateAI(dt, time);
  updateHazards(dt, time);
  state.visibilityTimer = (state.visibilityTimer || 0) - dt;
  if (state.visibilityTimer <= 0) {
    updateVisibility();
    state.visibilityTimer = 0.35;
  }
  state.streamTimer -= dt;
  if (state.streamTimer <= 0) {
    // A red glow at the screen edge warns that a hunter your size or bigger is closing in.
    const danger = enemies.some(
      (e) => e.userData.alive && e.userData.diet === "meat" && !e.userData.kin && e.userData.size > state.scale * 0.7 && distance2D(e.position, player.position) < 5 + state.scale * 2,
    );
    document.body.classList.toggle("dangerNear", danger);
    updateZone();
    maintainWorld();
    state.streamTimer = 0.3;
  }
  state.meteorTimer -= dt;
  if (state.meteorTimer <= 0) {
    spawnMeteor();
    state.meteorTimer = 18 + Math.random() * 13;
  }
  state.ventTimer -= dt;
  if (state.ventTimer <= 0) {
    createVent();
    state.ventTimer = 7 + Math.random() * 7;
  }
  state.eliteTimer -= dt;
  if (state.eliteTimer <= 0) {
    const alpha = makeNPC({ size: stageScale(state.tier) * 1.35, alpha: true, diet: "meat" });
    spawnBurst(alpha.position.x, alpha.position.y, 0xff5a81, 18);
    state.eliteTimer = 26 + Math.random() * 14;
  }
  // Epic cells are rare, and only turn up once you're big enough to be worth chasing.
  if (!state.courtship && !state.mateSignal) state.epicTimer -= dt;
  if (state.epicTimer <= 0) {
    if (state.tier >= 2) spawnEpic();
    state.epicTimer = EPIC_INTERVAL();
  }
  updateCamera();
  camera.position.x += (player.position.x - camera.position.x) * Math.min(1, dt * 2.5);
  camera.position.y += (player.position.y - camera.position.y) * Math.min(1, dt * 2.5);
  if (state.shake > 0 && !settings.reducedMotion) {
    camera.position.x += Math.sin(time * 53) * state.shake * 0.6;
    camera.position.y += Math.cos(time * 47) * state.shake * 0.45;
  }
  camera.lookAt(camera.position.x, camera.position.y, 0);
  updateMateRings(dt);
  if (finalReady() && !state.mateSignal) $("#growthBar").classList.add("growthReady");
  state.waypointTimer = (state.waypointTimer || 0) - dt;
  if (state.waypointTimer <= 0) {
    updateWaypoint();
    state.waypointTimer = 0.12;
  }
  autoSaveTimer -= dt;
  if (autoSaveTimer <= 0) {
    saveGame(true);
    autoSaveTimer = 28;
  }
}
function bindUI() {
  const toggleMobilePanel = (which) => {
    const name = which === "parts" ? "show-parts" : "show-genome",
      wasOpen = document.body.classList.contains(name);
    document.body.classList.remove("show-parts", "show-genome");
    if (!wasOpen) document.body.classList.add(name);
  };
  ["mobilePartsToggle", "mobilePartsToggleEdit"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.onclick = () => toggleMobilePanel("parts");
  });
  ["mobileGenomeToggle", "mobileGenomeToggleEdit"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.onclick = () => toggleMobilePanel("genome");
  });
  $("#buildTool").onclick = () => {
    state.paint = false;
    state.category = "All";
    renderCatalog();
    $("#paintTool").classList.remove("active");
    $("#buildTool").classList.add("active");
    // The hammer always shows the parts (it never hides them), so "tap the hammer" can't backfire.
    document.body.classList.remove("show-genome");
    document.body.classList.add("show-parts");
  };
  $("#paintTool").onclick = () => {
    state.paint = !state.paint;
    $("#paintTool").classList.toggle("active", state.paint);
    $("#buildTool").classList.toggle("active", !state.paint);
    document.body.classList.remove("show-parts");
    document.body.classList.toggle("show-genome", state.paint);
    $("#paintBtn").classList.toggle("active", state.paint);
    toast(state.paint ? "Paint mode · tap the membrane to paint." : "Build mode");
  };
  $("#genomeTool").onclick = () => {
    document.body.classList.toggle("show-genome");
    if (isTouchUI()) document.body.classList.remove("show-parts");
  };
  $("#editorStatsTop").onclick = () => {
    const open = !document.body.classList.contains("show-genome");
    document.body.classList.toggle("show-genome", open);
    if (isTouchUI()) document.body.classList.remove("show-parts");
  };
  $("#editorSymmetryTop").onclick = () => {
    state.symmetry = !state.symmetry;
    updateEditorUI();
    updateSporeEditorChrome();
  };
  const cancelCellEdit = () => {
    if (endCellSandbox(false)) return;
    if (editorEntrySnapshot) restoreEditState(editorEntrySnapshot);
    setEditor(false);
    if (!state.editor) toast("Cell edits cancelled");
  };
  const acceptCellEdit = () => {
    if (endCellSandbox(true)) return;
    state.cellName = ($("#cellName").value || "Karlets").trim().slice(0, 22);
    saveGame();
    setTimeout(syncPedia, 50);
    setEditor(false);
    if (!state.editor) toast("Cell edits accepted");
  };
  $("#editorPartsButton").onclick = () => toggleMobilePanel("parts");
  $("#editorCancel").onclick = cancelCellEdit;
  $("#editorAccept").onclick = acceptCellEdit;
  $("#editorUndo").onclick = undoEdit;
  $("#editorRedo").onclick = redoEdit;
  $("#editorGridButton").onclick = () => {
    editorStage.visible = !editorStage.visible;
    toast(editorStage.visible ? "Editor arena visible" : "Editor arena hidden");
  };
  $("#editorComplexityButton").onclick = () => {
    document.body.classList.add("show-genome");
    if (isTouchUI()) document.body.classList.remove("show-parts");
    toast("Complexity is shown in the cell details drawer");
  };
  $("#cellName").oninput = (e) => {
    state.cellName = e.target.value.slice(0, 22);
  };
  ["radiusSlider", "lengthSlider", "sizeSlider", "partScaleSlider", "partRotationSlider"].forEach((id) =>
    $("#" + id).addEventListener("pointerdown", saveUndo),
  );
  document.querySelectorAll("[data-cat]").forEach(
    (b) =>
      (b.onclick = () => {
        state.category = b.dataset.cat;
        renderCatalog();
      }),
  );
  function chooseEgg(diet, openEditor = false) {
    document.body.classList.add("inGameMode");
    $("#hatchCinematic").style.display = "none";
    playSfx("hatch");
    state.pendingDiet = diet;
    state.mateSignal = false;
  state.courtship = null;
    state.mate = null;
    state.paused = false;
    state.joystick = { x: 0, y: 0 };
    state.pointerScreen = null;
    pointerThrust = false;
    state.foodSinceMate = 0;
    state.dietHintAt = 0;
    state.foodGoal = GROWTH_STAGES[0].foodGoal;
    Object.assign(progress, {
      kills: 0,
      regions: new Set(),
      deaths: 0,
      history: [],
      genStart: { plants: 0, meat: 0, kills: 0, deaths: 0 },
      editorPass: false,
      unlockedSinceEditor: 0,
      distanceSwum: 0,
      runTime: 0,
      dietCard: null,
      cellStageComplete: false,
      landReady: false,
      pendingBanner: 0,
    });
    // Every run hatches a different cell: body plan, palette, pattern and name are rolled fresh.
    const hatchling = randomStarterCell();
    state.cellName = hatchling.name;
    state.baseColor = hatchling.baseColor;
    state.patternColor = hatchling.patternColor;
    state.accentColor = hatchling.accentColor;
    state.pattern = hatchling.pattern;
    nodes = straightenSpine(hatchling.nodes);
    state.selectedNode = Math.floor(nodes.length / 2);
    state.symmetry = true;
    state.stack = false;
    state.dna = 25;
    state.tier = 1;
    state.food = 0;
    state.foodGoal = GROWTH_STAGES[0].foodGoal;
    cameraZoom = 9;
    cameraZoomTarget = 9;
    state.plants = 0;
    state.meat = 0;
    state.health = 100;
    state.stamina = 100;
    state.scale = 1;
    state.vision = 1;
    state.discoveries = 0;
    state.eliteKills = 0;
    state.paintStrokes = [];
    worldSize = 1;
    velocity.set(0, 0);
    jetVel.set(0, 0);
    knockVel.set(0, 0);
    angle = 0;
    unlocked.clear();
    // Every run starts with cilia and eyes, and the player picks its mouth. Where they sit varies with the body.
    STARTER_UNLOCKS.forEach((id) => unlocked.add(id));
    parts = starterParts(hatchling);
    state.selected = null;
    state.category = "All";
    progress.firstBuild = true;
    spawnWorld();
    spawnMeteor();
    renderCatalog();
    rebuildPlayer();
    updateHUD();
    $("#intro").style.display = "none";
    state.runStarted = true;
    saveGame(true);
    toast("Life begins. Build your first cell.");
    progress.editorPass = true;
    setEditor(true);
    if (isTouchUI()) document.body.classList.add("show-parts");
  }
  let hatchTimer = null,
    hatchEditor = false;
  const startHatch = (diet, openEditor = false) => {
    hatchEditor = openEditor;
    state.pendingDiet = diet;
    $("#intro").style.display = "none";
    const sceneCard = $("#hatchCinematic");
    sceneCard.dataset.diet = diet;
    $("#hatchEgg").dataset.diet = diet;
    $("#hatchTitle").textContent = "LIFE BEGINS";
    sceneCard.style.display = "flex";
    playSfx("meteor");
    if (hatchTimer) clearTimeout(hatchTimer);
    hatchTimer = setTimeout(
      () => {
        sceneCard.style.display = "none";
        hatchTimer = null;
        chooseEgg(diet, openEditor);
      },
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 1750,
    );
  };
  const skipHatch = () => {
    if (hatchTimer) clearTimeout(hatchTimer);
    hatchTimer = null;
    $("#hatchCinematic").style.display = "none";
    chooseEgg(state.pendingDiet || "plant", hatchEditor);
  };
  $("#skipHatch").onclick = skipHatch;
  bindStageSwitcher();
  /*
   * Developer stage jump (Settings → Developer, once developer mode is on): jumps straight to any
   * stage. Saves are kept, so a jump resumes a stage where it was left; a stage never reached starts
   * fresh from the current cell.
   */
  function bindStageSwitcher() {
    const currentStage = () => (civStage ? "civ" : tribeStage ? "tribe" : creatureStage ? "creature" : "cell");
    const hasCellSave = () => {
      try {
        return !!localStorage.getItem("johnny-spore-cell-stage");
      } catch (e) {
        return false;
      }
    };
    /** Leave menus, dialogs and the hatch cinematic so the jump lands on a clean screen. */
    const clearScreens = () => {
      if (hatchTimer) clearTimeout(hatchTimer);
      hatchTimer = null;
      $("#hatchCinematic").style.display = "none";
      $("#dialogOverlay").style.display = "none";
      if (pathScreenOpen()) $("#pathClose")?.click();
      if (state.editor && !hasMouth()) {
        // A brand-new cell can't leave the editor without a mouth: give it the plant mouth, free.
        const head = nodes[nodes.length - 1],
          tip = snapToSurface(head.x + head.r + 0.4, 0);
        parts.push({ id: "filter", def: defs.find((d) => d.id === "filter"), x: tip.x, y: tip.y, rotation: tip.angle, scale: 1, costPaid: 0, source: "starter", pairId: nextPairId++ });
        rebuildPlayer();
      }
      if (state.editor) setEditor(false);
    };
    const enterRun = () => {
      document.body.classList.add("inGameMode");
      $("#intro").style.display = "none";
      state.runStarted = true;
    };
    const backToSoup = () => {
      document.body.classList.remove("creatureMode", "tribeMode");
      audio.setAmbient("cell");
      audio.setMusic("cell");
      state.paused = false;
      updateCamera();
      updateHUD();
    };
    const jumpTo = (stage) => {
      if (state.runStarted && stage === currentStage()) return;
      clearScreens();
      if (civStage) stopCivStage();
      if (stage === "cell") {
        if (tribeStage || document.body.classList.contains("tribeMode")) {
          if (tribeStage) stopTribeStage();
          document.body.classList.remove("tribeMode");
          backToSoup();
        } else if (creatureStage) stopCreatureStage(true);
        else if (!state.runStarted && !hasCellSave()) return chooseEgg("plant");
        enterRun();
        state.paused = false;
        updateHUD();
        return;
      }
      enterRun();
      audio.setAmbient("land");
      if (stage === "creature") {
        if (tribeStage) stopTribeStage();
        startCreatureStage(!!loadCreatureSave(), false);
        return;
      }
      if (stage === "civ") {
        startCivStage();
        return;
      }
      startTribeStage(creatureFromCell(currentRecord(), state.cellName));
    };
    devJump = jumpTo;
  }
  $("#begin").onclick = () => {
    audio.setAmbient("cell");
    audio.setMusic("cell");
    startHatch("plant");
  };
  $("#pauseBtn").onclick = pauseGame;
  $("#touchPause").onclick = pauseGame;
  $("#touchMate").onclick = callMate;
  $("#touchLand").onclick = promptLand;
  $("#landBtn").onclick = promptLand;
  const stick = $("#moveStick");
  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stick.setPointerCapture?.(e.pointerId);
    const r = stick.getBoundingClientRect();
    stickStart(e, r.left + r.width / 2, r.top + r.height / 2, false);
  });
  stick.addEventListener("pointermove", stickMove);
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => stick.addEventListener(ev, stickEnd));
  const boostButton = $("#touchBoost");
  boostButton.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    input[" "] = true;
    state.jetQueued = true; // a quick tap can start and end between two frames
    dismissControlHint();
    try {
      boostButton.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* the pointer may already be gone after a very quick tap */
    }
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => boostButton.addEventListener(ev, () => (input[" "] = false)));
  $("#guideButton").onclick = () =>
    showDialog(
      "FIELD GUIDE",
      "YOUR GOAL\nEat compatible food to grow. Collect meteor fragments to unlock parts and earn DNA.\n\nMOVEMENT\nWASD / arrows to swim. The mouse steers your cell on desktop. On touch screens, put your thumb anywhere on the water and drag the way you want to swim. Tap Boost if you have a Jet. Space / BOOST uses a Jet part and stamina.\n\nSURVIVAL\nSmall carnivores may hunt you. Avoid poison clouds, follow current rings carefully, and use spikes or electric organs to fight back.\n\nEVOLUTION\nFill the growth bar and your cell grows into the next stage by itself. Mate whenever you like (M or MATE) to design a new generation. In the last stage, a full bar and a mate take your species onto land.",
      [
        { label: "Got it", primary: true, action: () => {} },
      ],
    );
  const zoomBy = (delta) => {
    cameraZoomTarget = THREE.MathUtils.clamp(cameraZoomTarget + delta, 7, 12 + stats().sight * 1.7);
    playSfx("click");
  };
  $("#zoomInBtn").onclick = () => zoomBy(-1);
  $("#zoomOutBtn").onclick = () => zoomBy(1);
  $("#pathToggle").onclick = openPath;
  $("#settingsToggle").onclick = openGameSettings;
  $("#qualityToggle").onclick = () => {
    const order = Object.keys(QUALITY_PRESETS);
    applyQuality(order[(order.indexOf(getQuality()) + 1) % order.length]);
    refreshQualityButton();
    toast("Graphics quality: " + getQuality());
  };
  refreshQualityButton();
  $("#soundToggle").onclick = () => {
    soundEnabled = !soundEnabled;
    audio.setEnabled(soundEnabled);
    $("#soundToggle").textContent = soundEnabled ? "♫" : "♪";
    $("#soundToggle").title = soundEnabled ? "Sound effects on" : "Sound effects muted";
    toast(soundEnabled ? "Sound effects on" : "Sound effects muted");
    if (soundEnabled) playSfx("click");
  };
  $("#fullscreenToggle").onclick = async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        toast("Fullscreen off");
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        toast("Fullscreen on");
      } else toast("Fullscreen is not available in this browser.");
    } catch (e) {
      toast("Fullscreen could not be started here.");
    }
  };
  $("#callMateBtn").onclick = callMate;
  $("#openEditorBtn").hidden = true;
  $("#cancelEditor").onclick = () => setEditor(false);
  $("#finishEditor").onclick = () => setEditor(false);
  $("#deletePartBtn").onclick = removeSelectedPart;
  $("#undoBtn").onclick = undoEdit;
  $("#paintBtn").onclick = () => {
    state.paint = !state.paint;
    $("#paintBtn").classList.toggle("active", state.paint);
    toast(state.paint ? "Paint mode enabled. Choose the three colour layers." : "Part editing mode");
  };
  $("#mirrorToggle").onclick = () => {
    state.symmetry = !state.symmetry;
    updateEditorUI();
    toast("Bilateral symmetry " + (state.symmetry ? "enabled" : "disabled"));
  };
  $("#stackToggle").onclick = () => {
    state.stack = !state.stack;
    updateEditorUI();
  };
  $("#addNode").onclick = () => {
    if (nodes.length >= 8) {
      toast("Maximum eight spine nodes.");
      return;
    }
    saveUndo();
    const before = anchorPartsToSpine();
    const n = nodes[nodes.length - 1],
      prev = nodes[nodes.length - 2];
    nodes.push({ x: n.x + Math.min(SPINE.maxGap, Math.max(0.4, n.x - prev.x)), y: 0, r: n.r });
    nodes = straightenSpine(nodes);
    carryPartsWithSpine(before);
    state.selectedNode = nodes.length - 1;
    rebuildPlayer();
    toast("Vertebra added.");
  };
  $("#removeNode").onclick = () => {
    if (nodes.length <= 2) {
      toast("The spine needs at least two nodes.");
      return;
    }
    saveUndo();
    const before = anchorPartsToSpine();
    nodes.splice(state.selectedNode, 1);
    nodes = straightenSpine(nodes);
    carryPartsWithSpine(before);
    state.selectedNode = Math.min(state.selectedNode, nodes.length - 1);
    rebuildPlayer();
    toast("Vertebra removed.");
  };
  $("#radiusSlider").oninput = (e) => {
    const before = anchorPartsToSpine();
    if (nodes[state.selectedNode]) nodes[state.selectedNode].r = +e.target.value;
    carryPartsWithSpine(before);
    rebuildPlayer();
  };
  $("#lengthSlider").oninput = (e) => {
    const want = +e.target.value / 100;
    const mid = (nodes[0].x + nodes[nodes.length - 1].x) / 2;
    const half = (nodes[nodes.length - 1].x - nodes[0].x) / 2;
    const f = want / (Math.abs(half) / 1.415 || 1);
    const before = anchorPartsToSpine();
    nodes.forEach((n) => (n.x = mid + (n.x - mid) * f));
    carryPartsWithSpine(before);
    rebuildPlayer();
  };
  $("#sizeSlider").oninput = (e) => {
    state.scale = +e.target.value;
    player.scale.setScalar(state.scale);
    updateEditorUI();
  };
  $("#partScaleSlider").oninput = (e) => {
    if (parts[state.selectedPart]) {
      const p = parts[state.selectedPart];
      p.scale = +e.target.value;
      const mate = parts.find((q, j) => j !== state.selectedPart && p.pairId && q.pairId === p.pairId);
      if (state.symmetry && mate) mate.scale = p.scale;
      rebuildPlayer();
    }
  };
  $("#partRotationSlider").oninput = (e) => {
    if (parts[state.selectedPart]) {
      const p = parts[state.selectedPart];
      p.rotation = THREE.MathUtils.degToRad(+e.target.value);
      const mate = parts.find((q, j) => j !== state.selectedPart && p.pairId && q.pairId === p.pairId);
      if (state.symmetry && mate) mate.rotation = -p.rotation;
      rebuildPlayer();
    }
  };
  $("#patternSelect").onchange = (e) => {
    state.pattern = e.target.value;
    rebuildPlayer();
  };
  $("#saveBtn").onclick = saveGame;
  $("#resetBtn").onclick = resetRun;
  $("#resetEditorBtn").onclick = resetRun;
  function resetRun() {
    resetRunConfirm();
  }
  const resumeExists = (() => {
    try {
      return !!localStorage.getItem("johnny-spore-cell-stage");
    } catch (e) {
      return false;
    }
  })();
  if (loadCreatureSave()) {
    const lb = document.createElement("button");
    lb.id = "contLand";
    lb.textContent = "Continue on land";
    lb.className = "primary";
    lb.onclick = () => {
      document.body.classList.add("inGameMode");
      $("#intro").style.display = "none";
      state.runStarted = true;
      startCreatureStage(true);
      playSfx("hatch");
    };
    $("#intro .options").prepend(lb);
    if (loadCivSave()) {
      const vb = document.createElement("button");
      vb.id = "contCiv";
      vb.textContent = "Continue your civilization";
      vb.className = "primary";
      vb.onclick = () => {
        startCivStage();
        playSfx("hatch");
      };
      $("#intro .options").prepend(vb);
    }
    if (loadTribeSave()) {
      const tb = document.createElement("button");
      tb.id = "contTribe";
      tb.textContent = "Continue your tribe";
      tb.className = "primary";
      tb.onclick = () => {
        document.body.classList.add("inGameMode");
        $("#intro").style.display = "none";
        state.runStarted = true;
        startTribeStage();
        playSfx("hatch");
      };
      $("#intro .options").prepend(tb);
    }
  }
  if (resumeExists) {
    const rb = document.createElement("button");
    rb.id = "contCell";
    rb.textContent = "Continue saved cell";
    rb.className = "primary";
    rb.onclick = () => {
      document.body.classList.add("inGameMode");
      $("#intro").style.display = "none";
      state.runStarted = true;
      updateHUD();
      showControlHint(
        isTouchUI()
          ? "Welcome back. Use the arrows to swim, eat compatible food, then tap MATE."
          : "Welcome back. WASD/arrows to swim, mouse to steer, and M to call a mate.",
        6500,
      );
      toast("Saved cell resumed.");
      // The page closed while a new generation was still in the editor: pick up there.
      if (progress.editorPass) setEditor(true);
      playSfx("hatch");
    };
    $("#intro .options").prepend(rb);
  }
  document.addEventListener("keydown", (e) => {
    const rawKey = e.key,
      k = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey,
      target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable))
      return;
    if ($("#intro").style.display !== "none" || $("#hatchCinematic").style.display === "flex") return;
    if (tribeStage || civStage) return; // these stages read their own keys
    if (creatureStage) {
      // The land stage and its editor handle their own keys; movement goes through `input`.
      if (creatureEditor || modularEditor || pathScreenOpen()) {
        if (pathScreenOpen() && k === "Escape") $("#pathClose")?.click();
        return;
      }
      input[k] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
      return;
    }
    if (pathScreenOpen()) {
      if (k === "Escape" || k === "c") $("#pathClose")?.click();
      return;
    }
    if ($("#finale").classList.contains("show")) return;
    if (k === "c" && !state.editor) {
      openPath();
      return;
    }
    if ($("#dialogOverlay").style.display === "flex") {
      if (k === "Escape") {
        $("#dialogOverlay").style.display = "none";
        if (state.paused) state.paused = false;
      }
      return;
    }
    input[k] = true;
    if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) {
      keyboardSteering = true;
      state.mouseActive = false;
      state.pointerScreen = null;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
    if (k.toLowerCase() === "m" && !state.editor) callMate();
    if (k.toLowerCase() === "l" && !state.editor && progress.landReady) promptLand();
    if (k === " " && !e.repeat) state.jetQueued = true;
    if (k === "Tab") {
      e.preventDefault();
      if (state.editor) setEditor(false);
    }
    if (k === "Escape" && state.editor) {
      if (editorEntrySnapshot) restoreEditState(editorEntrySnapshot);
      setEditor(false);
    } else if (k === "Escape" && $("#intro").style.display === "none" && $("#dialogOverlay").style.display !== "flex") {
      pauseGame();
    }
    if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) dismissControlHint();
    if (k.toLowerCase() === "r" && state.editor && parts[state.selectedPart]) {
      parts[state.selectedPart].rotation += Math.PI / 8;
      rebuildPlayer();
    }
    if (k === "Delete" && state.editor) removeSelectedPart();
  });
  document.addEventListener("keyup", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    input[k] = false;
    if (!["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((key) => input[key])) keyboardSteering = false;
  });
  document.querySelectorAll("[data-key]").forEach((b) => {
    const k = b.dataset.key;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      input[k] = true;
      dismissControlHint();
      b.setPointerCapture?.(e.pointerId);
    });
    ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((ev) => b.addEventListener(ev, () => (input[k] = false)));
  });
  window.addEventListener("blur", () => {
    Object.keys(input).forEach((k) => (input[k] = false));
    pointerThrust = false;
    keyboardSteering = false;
    state.mouseActive = false;
    state.pointerScreen = null;
    state.joystick.x = 0;
    state.joystick.y = 0;
    const knob = $("#moveStickKnob");
    if (knob) {
      knob.style.left = "50%";
      knob.style.top = "50%";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (
      document.hidden &&
      state.runStarted &&
      !state.editor &&
      !state.paused &&
      $("#intro").style.display === "none" &&
      $("#dialogOverlay").style.display !== "flex"
    )
      pauseGame();
  });
}
function saveGame(silent = false) {
  if (state.editor) state.cellName = ($("#cellName")?.value || state.cellName || "Karlets").trim().slice(0, 22);
  else state.cellName = (state.cellName || "Karlets").trim().slice(0, 22);
  const data = {
    cellName: state.cellName,
    dna: state.dna,
    tier: state.tier,
    food: state.food,
    foodGoal: state.foodGoal,
    plants: state.plants,
    meat: state.meat,
    health: state.health,
    scale: state.scale,
    vision: state.vision,
    stamina: state.stamina,
    symmetry: state.symmetry,
    stack: state.stack,
    paintStrokes: state.paintStrokes,
    baseColor: state.baseColor,
    patternColor: state.patternColor,
    accentColor: state.accentColor,
    pattern: state.pattern,
    unlocked: [...unlocked],
    partsV: 2,
    nodes: nodes,
    parts: parts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      scale: p.scale,
      costPaid: p.costPaid,
      pairId: p.pairId,
      source: p.source,
    })),
    discoveries: state.discoveries,
    eliteKills: state.eliteKills,
    progress: {
      kills: progress.kills,
      regions: [...progress.regions],
      deaths: progress.deaths,
      genStart: progress.genStart,
      dietCard: progress.dietCard,
      cellStageComplete: progress.cellStageComplete,
      landReady: progress.landReady,
      editorPass: progress.editorPass && state.runStarted && state.tier > 1,
      zones: [...zonesSeen],
      scavenged: progress.scavenged || 0,
    },
  };
  try {
    localStorage.setItem("johnny-spore-cell-stage", JSON.stringify(data));
    storeCellRecord(localStorage, currentRecord());
    markSaved(localStorage);
    if (!silent) toast("Your cell and progress have been saved on this device.");
  } catch (e) {
    if (!silent) toast("Local saving unavailable in this browser.");
  }
}
function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem("johnny-spore-cell-stage") || "null");
    if (!d) return;
    Object.assign(state, {
      cellName: d.cellName ?? "Karlets",
      dna: d.dna ?? 25,
      tier: d.tier ?? 1,
      food: d.food ?? 0,
      foodGoal: d.foodGoal ?? 8,
      plants: d.plants ?? 0,
      meat: d.meat ?? 0,
      health: d.health ?? 100,
      scale: d.scale ?? 1,
      vision: d.vision ?? 1,
      symmetry: d.symmetry ?? true,
      stack: d.stack ?? false,
      baseColor: d.baseColor ?? baseColors[0],
      patternColor: d.patternColor ?? patternColors[0],
      accentColor: d.accentColor ?? accentColors[0],
      pattern: d.pattern ?? "speckle",
      discoveries: d.discoveries ?? 0,
      eliteKills: d.eliteKills ?? 0,
      stamina: d.stamina ?? 100,
    });
    state.paintStrokes = d.paintStrokes || [];
    state.tier = Math.min(LAST_TIER, Math.max(1, state.tier));
    state.foodGoal = stageFor(state.tier).foodGoal;
    state.scale = Math.max(state.scale, stageScale(state.tier));
    const pr = d.progress || {};
    Object.assign(progress, {
      kills: pr.kills ?? 0,
      regions: new Set(pr.regions || []),
      deaths: pr.deaths ?? 0,
      genStart: pr.genStart || { plants: state.plants, meat: state.meat, kills: pr.kills ?? 0, deaths: pr.deaths ?? 0 },
      history: loadHistory(),
      dietCard: pr.dietCard ?? null,
      cellStageComplete: !!pr.cellStageComplete,
      landReady: !!pr.landReady || !!pr.cellStageComplete,
      editorPass: !!pr.editorPass,
      pendingBanner: pr.editorPass ? state.tier : 0,
      scavenged: pr.scavenged || 0,
    });
    (Array.isArray(pr.zones) ? pr.zones : []).forEach((z) => ZONES[z] && zonesSeen.add(z));
    worldSize = Math.pow(1.4, state.tier - 1);
    cameraZoom = 9 * stageScale(state.tier);
    cameraZoomTarget = cameraZoom;
    unlocked.clear();
    (d.unlocked || STARTER_UNLOCKS).forEach((id) => unlocked.add(id));
    // Every stage reached has handed out its reward parts (even if the page closed mid-growth).
    GROWTH_STAGES.slice(1, state.tier).forEach((st) => (st.rewards || []).forEach((id) => unlocked.add(id)));
    if (d.nodes && d.nodes.length >= 2) nodes = straightenSpine(d.nodes);
    parts = (d.parts || [])
      .map((p) => ({
        id: p.id,
        def: defs.find((d) => d.id === p.id),
        x: p.x,
        y: p.y,
        rotation: p.rotation || 0,
        scale: p.scale || 1,
        costPaid: p.costPaid ?? defs.find((d) => d.id === p.id)?.cost,
        pairId: p.pairId,
        source: p.source,
      }))
      .filter((p) => p.def);
    // Saves from before the rebuilt body renderer stored parts for the old hull and orientation: re-seat them on the new surface.
    if (d.partsV !== 2 && parts.length) {
      const snapped = snapPartsToSurface(currentRecord(), { faceOutward: true });
      parts.forEach((p, i) => Object.assign(p, { x: snapped.parts[i].x, y: snapped.parts[i].y, rotation: snapped.parts[i].rotation }));
    }
    $("#patternSelect").value = state.pattern;
    toast("Saved cell restored.");
  } catch (e) {
    console.warn("Could not restore save", e);
  }
}
function boot() {
  nodes = defaultNodes();
  state.selectedNode = 2;
  const saveExists = (() => {
    try {
      return !!localStorage.getItem("johnny-spore-cell-stage");
    } catch (e) {
      return false;
    }
  })();
  if (saveExists) {
    loadGame();
    seedChronicle();
  } else {
    parts = [
      { id: "filter", def: defs.find((d) => d.id === "filter"), x: 1.13, y: 0, rotation: 0, scale: 1, costPaid: 0, source: "starter" },
      { id: "cilia", def: defs.find((d) => d.id === "cilia"), x: -0.55, y: 0.68, rotation: 0.25, scale: 1, costPaid: 0, source: "starter" },
      { id: "eye", def: defs.find((d) => d.id === "eye"), x: 0.45, y: 0.88, rotation: 0, scale: 1, costPaid: 0, source: "starter" },
    ];
    const seated = snapPartsToSurface(currentRecord(), { faceOutward: true });
    parts.forEach((p, i) => Object.assign(p, { x: seated.parts[i].x, y: seated.parts[i].y, rotation: seated.parts[i].rotation }));
  }
  state.selectedNode = Math.min(state.selectedNode, nodes.length - 1);
  try {
    partThumbs = renderPartThumbnails(
      renderer,
      defs.map((d) => d.id),
    );
  } catch (err) {
    console.warn("Part thumbnails unavailable", err);
  }
  renderCatalog();
  spawnWorld();
  spawnMeteor();
  rebuildPlayer();
  drawSwatches("#baseSwatches", baseColors, state.baseColor, (c) => {
    state.baseColor = c;
    rebuildPlayer();
  });
  drawSwatches("#patternSwatches", patternColors, state.patternColor, (c) => {
    state.patternColor = c;
    rebuildPlayer();
  });
  drawSwatches("#accentSwatches", accentColors, state.accentColor, (c) => {
    state.accentColor = c;
    rebuildPlayer();
  });
  updateHUD();
  bindUI();
  updateCamera();
}
boot();

function adaptResolution(rawDt) {
  if (rawDt > 0.25) return; // tab was hidden or the page stalled; not a real frame time
  perf.time += rawDt;
  perf.frames++;
  if (perf.time < 2) return;
  const avg = perf.time / perf.frames;
  const before = perf.scale;
  if (avg > 0.024) perf.scale = Math.max(0.6, perf.scale - 0.1);
  else if (avg < 0.0155) perf.scale = Math.min(1, perf.scale + 0.05);
  if (perf.scale !== before) renderer.setPixelRatio(basePixelRatio() * perf.scale);
  perf.time = perf.frames = 0;
}
function frame(t) {
  requestAnimationFrame(frame);
  adaptResolution((t - lastTime) / 1000);
  const dt = Math.min(0.04, Math.max(0.001, (t - lastTime) / 1000));
  lastTime = t;
  gameTime += dt;
  tickPlaytime(dt);
  timeUniform.value = gameTime;
  if (galaxyStart) {
    galaxyStart.update(dt);
    galaxyStart.render();
    return;
  }
  if (modularEditor) {
    modularEditor.update(dt);
    modularEditor.render();
    return;
  }
  if (creatureEditor) {
    creatureEditor.update(dt);
    creatureEditor.render();
    return;
  }
  if (civStage) {
    civStage.update(dt);
    civStage?.render(); // a cutscene may have handed over to another stage this frame
    return;
  }
  if (tribeStage) {
    tribeStage.update(dt);
    tribeStage?.render();
    return;
  }
  if (creatureStage) {
    creatureStage.update(dt);
    creatureStage?.render();
    return;
  }
  tipClock -= dt;
  if (tipClock <= 0) {
    tipClock = 0.5;
    tipEngine.tick(0.5, tipContext());
  }
  if (
    !state.paused &&
    !state.editor &&
    $("#intro").style.display === "none" &&
    $("#hatchCinematic").style.display !== "flex" &&
    $("#dialogOverlay").style.display !== "flex"
  ) {
    updateGame(growth ? updateGrowthPullback(dt) : dt, gameTime);
    // A save from before automatic growth may be sitting on a full bar: grow now.
    if (!growth && state.runStarted && state.tier < LAST_TIER && state.food >= state.foodGoal) advanceTier();
  } else {
    if (state.editor) {
      player.rotation.z = Math.PI;
      handleGroup.visible = true;
      playerBody?.rig.update(dt, gameTime, { speed: 0 });
    } else handleGroup.visible = false;
  }
  background.update(gameTime, dt, camera);
  foodBatch.sync(food);
  waterFx.render(scene, camera, gameTime, !state.editor);
}
requestAnimationFrame(frame);

/* ---- Dynamic tutorials ---- */
let tipClock = 1;
const tipEngine = createTipEngine({
  storage: (() => {
    try {
      return localStorage;
    } catch (e) {
      return null;
    }
  })(),
  isTouch: () => isTouchUI(),
  show: (tip, text) => showTip(text, tip.anchor, () => tipEngine.dismiss()),
  hide: hideTip,
});
function tipContext() {
  const near = (list, r, test = () => true) => list.some((o) => o.visible !== false && test(o) && distance2D(o.position, player.position) < r);
  const s = stats(),
    view = viewRadius();
  const compatibleFood = (f) => f.userData.alive && (s.diet === "omni" || (s.diet === "plant" ? f.userData.type === "plant" : f.userData.type === "meat"));
  const blocked =
    $("#intro").style.display !== "none" ||
    $("#hatchCinematic").style.display === "flex" ||
    $("#dialogOverlay").style.display === "flex" ||
    $("#finale").classList.contains("show") ||
    pathScreenOpen();
  return {
    playing: !state.editor && !state.paused && !blocked,
    editor: state.editor && !blocked,
    time: state.editor ? gameTime - progress.editorOpenedAt : progress.runTime,
    distanceSwum: progress.distanceSwum,
    foodEaten: state.plants + state.meat,
    diet: s.diet,
    compatibleFoodNear: near(food, 6, compatibleFood),
    touchedWrongFood: gameTime - progress.wrongFoodAt < 2,
    predatorNear: near(enemies, 7, (e) => e.userData.alive && e.userData.diet === "meat" && !e.userData.kin && e.userData.size > state.scale * 0.85),
    healthPct: state.health / state.maxHealth,
    mateReady: finalReady(),
    mateSignal: state.mateSignal,
    meteorNear: near(meteors, view, (m) => m.userData.alive),
    partOrbNear: near(partOrbs, view),
    shards: state.discoveries,
    colonyNear: colonies.some((c) => distance2D(c.mesh.position, player.position) < 7),
    kinNear: near(enemies, 7, (e) => e.userData.alive && e.userData.kin && !e.userData.mate),
    giantNear: near(enemies, view, (e) => e.userData.alive && e.userData.giant),
    unlockedSinceEditor: progress.unlockedSinceEditor,
    generations: progress.history.length,
    canBite: parts.some((p) => p.id === "jaw" || p.id === "proboscis"),
    preyNear: near(enemies, 6, (e) => e.userData.alive && !e.userData.kin && e.userData.size < state.scale * 0.9),
    pathOpened: progress.pathOpened,
    hasMouth: hasMouth(),
  };
}

/* ---- Species history ----------------------------------------------------
   Like Spore's, the history keeps every generation's design (a snapshot image of the cell) and
   what that generation did, plus the consequence trait each stage earns. */
const HISTORY_KEY = "johnny-spore-history";
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
function storeHistory() {
  // Snapshots are small images; keep the first design and the most recent ones if it grows long.
  const list = progress.history.length > 14 ? [progress.history[0], ...progress.history.slice(-13)] : progress.history;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    /* storage full or unavailable: history stays for this session */
  }
}
/** Close the previous generation's record and add the design the player just made. */
function recordGeneration() {
  const now = { plants: state.plants, meat: state.meat, kills: progress.kills, deaths: progress.deaths };
  const last = progress.history[progress.history.length - 1];
  if (last && !last.ended) {
    Object.assign(last, {
      ended: true,
      plants: now.plants - progress.genStart.plants,
      meat: now.meat - progress.genStart.meat,
      kills: now.kills - progress.genStart.kills,
      deaths: now.deaths - progress.genStart.deaths,
    });
  }
  progress.genStart = now;
  let thumb = "";
  try {
    thumb = renderCellSnapshot(renderer, currentRecord(), (record) => buildCellBody(record, { role: "mate", shadow: false }));
  } catch (err) {
    console.warn("Snapshot failed", err);
  }
  progress.history.push({
    gen: (last?.gen || 0) + 1,
    tier: state.tier,
    stageName: stageFor(state.tier).name,
    diet: stats().diet,
    parts: parts.length,
    thumb,
    // The real design, so the Sporepedia keeps the cell itself, not just its picture.
    record: currentRecord(),
    ended: false,
  });
  storeHistory();
  syncPedia();
}
/* ---- universes, the galaxy and the Sporepedia ----------------------------------------------
   The universe in play keeps its game in the usual localStorage keys; its galaxy, discoveries and
   Sporepedia live in IndexedDB through the session. Everything here starts after the game has
   loaded, so a slow or missing IndexedDB never delays playing. */
let universe = null; // { store, meta, session }
let universeOpen = false;
let playClock = 0;
async function initUniverse() {
  try {
    const store = await openStore();
    const { meta } = await bootUniverses(store, localStorage, { name: "First universe" });
    const session = await createSession({
      store,
      meta,
      onOwned: (entry) => putGlobal(store, meta, entry).catch(() => {}),
      onEvent: (ev) => {
        toast(ev.icon + " " + ev.text);
        playSfx("unlock", { gain: 0.5 });
      },
    });
    universe = { store, meta, session };
    // Every stage is built on the homeworld: hand its environment to all of them before any starts.
    const profile = session.homeProfile();
    setHomeworld(profile);
    background.setPlanet(profile);
    // The home world and its star are known from the start: this is where the species began.
    const home = session.home();
    const planet = session.planet(home.planetId);
    if (planet && !session.pedia.entries["planet:" + planet.id]) {
      session.visitStar(session.galaxy().stars[home.starId]);
      session.visitPlanet(planet);
    }
    syncPedia();
    const label = document.getElementById("uvActiveName");
    if (label) label.textContent = meta.name;
  } catch (e) {
    console.warn("Universes unavailable", e);
  }
}
/* ---- the galaxy start screen ------------------------------------------------------------------ */
let galaxyStart = null;
const BEGIN_KEY = "spore-begin"; // sessionStorage: a homeworld was just chosen, play the arrival
/** The game opens on its galaxy. Continue resumes the furthest stage; New Game picks a homeworld. */
function openStartScreen() {
  audio.setMusic("menu");
  let arrival = null;
  try {
    arrival = JSON.parse(window.sessionStorage.getItem(BEGIN_KEY) || "null");
    window.sessionStorage.removeItem(BEGIN_KEY);
  } catch (e) {
    arrival = null;
  }
  if (arrival) return arriveOnHomeworld(arrival);
  if (!universe) {
    // No IndexedDB (private mode on some browsers): fall back to the plain title screen.
    document.body.classList.remove("galaxyStart");
    return;
  }
  const S = universe.session;
  const info = summarize(currentKeys(localStorage));
  const home = S.home();
  const homePlanet = S.planet(home.planetId);
  try {
    galaxyStart = createGalaxyStart({
      renderer,
      seed: universe.meta.seed,
      quality: getQuality(),
      save: info.stage !== "New" ? { species: info.species, stage: info.stage + " Stage · " + info.detail, home: homePlanet ? "born on " + S.nameFor("planet:" + homePlanet.id, homePlanet.name) : null } : null,
      homeStarId: info.stage !== "New" ? home.starId : null,
      newSeed: () => newSeed(),
      sfx: playSfx,
      onContinue: () => {
        closeStartScreen();
        continueGame();
      },
      onLoad: () => openUniverseScreen("universes"),
      onSettings: openGameSettings,
      onBegin: (choice) => beginHomeworld(choice).catch((e) => {
        console.warn(e);
        closeStartScreen();
        toast("Your new universe couldn't be saved: " + (e.message || "storage error"));
      }),
    });
    document.body.classList.add("gsReady");
  } catch (e) {
    console.warn("Galaxy start screen unavailable", e);
    closeStartScreen();
  }
}
function closeStartScreen() {
  galaxyStart?.dispose();
  galaxyStart = null;
  document.body.classList.remove("galaxyStart", "gsReady");
  updateCamera();
}
/** Save everything and return to the galaxy. A fresh page load keeps it clean: one renderer, one loop. */
function backToTitle() {
  if (galaxyStart) return;
  saveRunningGame();
  universe?.session.flush();
  setTimeout(() => location.reload(), 150);
}
/** Resume the furthest stage saved in this universe. */
function continueGame() {
  for (const id of ["contCiv", "contTribe", "contLand", "contCell"]) {
    const b = document.getElementById(id);
    if (b) return b.click();
  }
}
/**
 * A homeworld was chosen: make it a universe of its own (or the empty one in play), remember the
 * star, the planet and its seeds, and reload into the Cell Stage on that world.
 */
async function beginHomeworld(choice) {
  const { store } = universe;
  const keys = currentKeys(localStorage);
  const fresh = summarize(keys).stage === "New";
  let meta = universe.meta;
  const metas = (await store.all("meta")).filter((m) => m && m.id !== meta.id).map((m) => m.name);
  const name = uniqueName(choice.planet.name, metas);
  if (fresh && meta.seed === choice.seed) {
    // Nothing played yet in this universe: it simply becomes this one.
    meta.name = uniqueName(name, metas);
  } else if (fresh) {
    meta.seed = choice.seed;
    meta.name = name;
  } else {
    saveRunningGame();
    universe.session.flush();
    meta = await createUniverse(store, localStorage, universe.meta, { name, seed: choice.seed });
  }
  meta.home = { planet: choice.planet.name, star: choice.star.name, t: 3 };
  meta.lastPlayed = Date.now();
  await store.put("meta", meta.id, meta);
  const pedia = emptyPedia(choice.seed);
  pedia.home = { starId: choice.starId, planetId: choice.planetId, chosen: true, at: Date.now() };
  await pediaStore.put(store, meta.id, pedia);
  if (fresh) {
    // Keys of an untouched universe (settings-like leftovers) are cleared so the new world starts clean.
    for (const k of Object.keys(keys)) localStorage.removeItem(k);
  }
  window.sessionStorage.setItem(BEGIN_KEY, JSON.stringify({ planet: choice.planet.name, star: choice.star.name, type: choice.planet.type, color: document.querySelector("#gsFade")?.style.background || "#0b1f3a" }));
  location.reload();
}
/** After the dive: the homeworld's name, then the Cell Stage begins in its oceans. */
function arriveOnHomeworld(a) {
  document.body.classList.remove("galaxyStart", "gsReady");
  const cover = document.createElement("div");
  cover.className = "homeArrive";
  cover.style.background = typeof a.color === "string" && /^(#[0-9a-f]{3,8}|rgb[^;]*)$/i.test(a.color) ? a.color : "#0b1f3a";
  const p = document.createElement("p");
  const small = document.createElement("small");
  small.textContent = "HOMEWORLD";
  p.append(small, String(a.planet || "Home").slice(0, 40));
  cover.appendChild(p);
  document.body.appendChild(cover);
  recordChronicle({ key: "home:begin", stage: "cell", icon: "🪐", text: "Life began in the oceans of " + String(a.planet).slice(0, 40) + ", a world of the " + String(a.star).slice(0, 40) + " system." });
  syncPedia();
  setTimeout(() => {
    $("#begin").click();
    cover.style.opacity = "0";
    setTimeout(() => cover.remove(), 1800);
  }, 1400);
}
/** Pause whatever is running while a universe screen is open; returns the resume function. */
function holdGame() {
  const wasPaused = state.paused;
  if (civStage) civStage.setPaused(true);
  else if (tribeStage) tribeStage.setPaused(true);
  else if (creatureStage && !creatureEditor) creatureStage.setPaused(true);
  else state.paused = true;
  return () => {
    if (civStage) civStage.setPaused(false);
    else if (tribeStage) tribeStage.setPaused(false);
    else if (creatureStage && !creatureEditor) creatureStage.setPaused(false);
    else state.paused = wasPaused;
  };
}
function saveRunningGame() {
  if (civStage) civStage.save();
  else if (tribeStage) tribeStage.save();
  else if (creatureStage) creatureStage.save();
  else if (state.runStarted) saveGame(true);
}
function openUniverseScreen(screen, arg) {
  if (universeOpen || creatureEditor) return;
  if (!universe) return toast("Your universe is still loading. Try again in a moment.");
  universeOpen = true;
  const resume = holdGame();
  audio.setMusic(screen === "pedia" ? "pedia" : "menu");
  const done = () => {
    universeOpen = false;
    audio.setMusic(civStage ? "civ" : tribeStage ? "tribe" : creatureStage ? "creature" : state.runStarted ? "cell" : "menu");
    resume();
  };
  const { session } = universe;
  if (screen === "universes") {
    syncPedia();
    openUniverses({
      store: universe.store,
      ls: localStorage,
      current: universe.meta,
      sfx: playSfx,
      beforeLeave: async () => {
        saveRunningGame();
        syncPedia();
        session.flush();
        await parkActive(universe.store, localStorage, universe.meta);
      },
      reload: () => location.reload(),
      onClose: () => {
        const label = document.getElementById("uvActiveName");
        if (label) label.textContent = universe.meta.name;
        done();
      },
    });
  } else if (screen === "galaxy") {
    openGalaxy({
      session,
      sfx: playSfx,
      portrait: (rec) => creatureSnapshot(rec, { width: 96, height: 96 }),
      focus: arg,
      openEntry: (id) => {
        universeOpen = false;
        openUniverseScreen("pedia", id);
        universeOpen = true;
      },
      onClose: done,
    });
  } else if (screen === "pedia") {
    syncPedia();
    const ui = openPedia({
      session,
      sfx: playSfx,
      open: arg,
      reducedMotion: settings.reducedMotion,
      portrait: (rec) => creatureSnapshot(rec, { width: 120, height: 120 }),
      thumb: (kind, data) => (kind === "cell" ? cellThumb(data) : null),
      global: {
        load: async () => asPedia(await listGlobal(universe.store)),
        save: async (p) => {
          for (const g of Object.values(p.entries)) await updateGlobal(universe.store, g);
        },
      },
      onImport: async (text) => {
        const r = readCreation(text);
        if (!r.ok) throw new Error(r.error);
        const id = "import:" + Date.now().toString(36);
        session.record({ id, kind: r.kind, owned: true, name: r.name, sub: "Imported", stage: "Imported", record: r.kind === "creature" || r.kind === "cell" ? r.data : undefined, design: r.kind !== "creature" && r.kind !== "cell" ? r.data : undefined, thumb: r.thumb || (r.kind === "creature" ? creatureSnapshot(r.data, { width: 120, height: 120 }) : r.kind === "cell" ? cellThumb(r.data) : null) });
        return id;
      },
      onCopyHere: (g) => {
        session.record({ id: "copy:" + Date.now().toString(36), kind: g.kind, owned: true, name: g.customName || g.name, sub: "From " + g.universe, stage: g.stage, diet: g.diet, record: g.record, design: g.design, thumb: g.thumb });
      },
      onEdit: (entry) => {
        ui.close();
        setTimeout(() => editCreation(entry), 220);
      },
      onShowInGalaxy: (focus) => {
        ui.close();
        setTimeout(() => openUniverseScreen("galaxy", focus), 220);
      },
      // The shared library opens over the Sporepedia and gives it back when closed.
      onLibrary: () => openEcoLibrary({ renderer, reducedMotion: settings.reducedMotion, sfx: playSfx }),
      onClose: done,
    });
  }
}
/**
 * Reopen one of your creations in the creature editor, as a sandbox: the result is saved to the
 * Sporepedia as a new creation and never changes the game in play.
 */
function editCreation(entry) {
  if (!universe || creatureEditor || !entry?.record) return;
  if (entry.kind === "cell") return editCellCreation(entry);
  const resume = holdGame();
  document.body.classList.add("creatureEditing");
  const saved = loadCreatureSave();
  const progress = progressOf(saved || {});
  const unlocked = new Set([...(Array.isArray(saved?.unlocked) ? saved.unlocked : []), ...creaturePartIds(entry.record), ...STARTER_MOUTHS, ...earnedMouths(progress)].filter((id) => CREATURE_PARTS.some((p) => p.id === id)));
  const finish = () => {
    creatureEditor = null;
    document.body.classList.remove("creatureEditing");
    resume();
  };
  creatureEditor = openCreatureEditor({
    renderer,
    record: JSON.parse(JSON.stringify(entry.record)),
    unlocked,
    progress,
    dna: 9999,
    maxParts: partsLimit(saved?.brain || 5),
    quality: getQuality(),
    sfx: playSfx,
    onDone: (record) => {
      finish();
      const id = "edit:" + Date.now().toString(36);
      universe.session.record({ id, kind: "creature", owned: true, name: record.name || entry.name, sub: "Sandbox design", diet: entry.diet, stage: "Sandbox", record, thumb: creatureSnapshot(record, { width: 120, height: 120 }), place: entry.place });
      toast("✦ Saved to your Sporepedia as a new creation.");
      setTimeout(() => openUniverseScreen("pedia", id), 250);
    },
    onCancel: finish,
  });
}
/** A cell design's portrait (for Sporepedia cards). */
function cellThumb(record) {
  try {
    return renderCellSnapshot(renderer, record, (r) => buildCellBody(r, { role: "mate", shadow: false }));
  } catch (e) {
    return null;
  }
}
/**
 * Reopen a cell design in the cell editor, as a sandbox: your real cell is put aside, the design is
 * loaded, and Accept saves the result to the Sporepedia as a new creation before your cell comes back
 * exactly as it was. Cancel just puts it back. Only from the Cell Stage, where the cell editor lives.
 */
let cellSandbox = null;
function editCellCreation(entry) {
  if (creatureStage || tribeStage || civStage) return toast("Cell designs open in the cell editor from the Cell Stage. Start or load a Cell Stage game to edit this one.");
  if (state.editor || cellSandbox) return;
  const r = entry.record;
  cellSandbox = { snapshot: captureEditState(), editorPass: progress.editorPass, dna: state.dna, entry, openedAt: progress.editorOpenedAt, unlocked: progress.unlockedSinceEditor };
  restoreEditState(
    JSON.stringify({
      nodes: r.body.nodes,
      paintStrokes: r.body.paintStrokes || [],
      parts: r.parts.map((p) => ({ ...p, source: "sandbox", costPaid: 0 })),
      dna: 9999,
      baseColor: r.colors.base,
      patternColor: r.colors.pattern,
      accentColor: r.colors.accent,
      pattern: r.body.pattern,
      scale: r.scale,
      cellName: r.name,
      symmetry: state.symmetry,
      stack: state.stack,
    }),
  );
  state.dna = 9999;
  progress.editorPass = true;
  setEditor(true);
  document.body.classList.add("cellSandbox");
  toast("Sandbox: Accept saves this as a new creation. Your own cell is untouched.");
}
function endCellSandbox(keep) {
  const sb = cellSandbox;
  if (!sb) return false;
  if (keep && universe) {
    const record = currentRecord();
    universe.session.record({ id: "edit:" + Date.now().toString(36), kind: "cell", owned: true, name: (document.getElementById("cellName")?.value || record.name).trim().slice(0, 22), sub: "Sandbox design", stage: "Sandbox", diet: record.diet === "meat" ? "Carnivore" : record.diet === "plant" ? "Herbivore" : "Omnivore", parts: record.parts.length, record, thumb: cellThumb(record) });
  }
  restoreEditState(sb.snapshot);
  state.dna = sb.dna;
  cellSandbox = null;
  cellSandboxClosing = true;
  setEditor(false);
  cellSandboxClosing = false;
  progress.editorPass = sb.editorPass;
  progress.editorOpenedAt = sb.openedAt;
  progress.unlockedSinceEditor = sb.unlocked;
  document.body.classList.remove("cellSandbox");
  toast(keep ? "Saved to your Sporepedia as a new cell creation." : "Sandbox closed. Your cell is as it was.");
  return true;
}
let cellSandboxClosing = false;
/** Keep the Sporepedia in step with the game: creations, the species, its history, the tribe. */
function syncPedia() {
  if (!universe) return;
  const S = universe.session;
  const home = S.home();
  const homePlanet = S.planet(home.planetId);
  const homeName = homePlanet ? S.nameFor("planet:" + homePlanet.id, homePlanet.name) : "Home";
  const cs = loadCreatureSave(),
    ts = loadTribeSave();
  const speciesName = ts?.look?.name || cs?.record?.name || state.cellName || "Your species";
  const dietW = (d) => (d === "meat" || d === "carnivore" ? "Carnivore" : d === "plant" || d === "herbivore" ? "Herbivore" : d ? "Omnivore" : undefined);
  const gens = progress.history.map((g) => ({
    id: "gen:" + g.gen,
    label: "Gen " + g.gen + " · " + (g.stage === "creature" ? "Creature" : "Cell"),
    thumb: g.thumb || null,
  }));
  progress.history.forEach((g) => {
    const old = S.pedia.entries["gen:" + g.gen];
    const kind = g.stage === "creature" ? "creature" : "cell";
    if (old && old.kind === kind && old.thumb === g.thumb && (old.record || !g.record)) return;
    S.record({
      id: "gen:" + g.gen,
      kind,
      owned: true,
      name: speciesName + " · Generation " + g.gen,
      sub: kind === "creature" ? "Creature Stage" : "Cell Stage" + (g.stageName ? " · " + g.stageName : ""),
      stage: kind === "creature" ? "Creature" : "Cell" + (g.tier ? " (tier " + g.tier + ")" : ""),
      gen: g.gen,
      diet: dietW(g.diet),
      parts: g.parts,
      thumb: g.thumb || null,
      record: g.record || null,
      place: homeName,
      species: speciesName,
    });
  });
  // The cell as it is now (in the Cell Stage): a creation of its own, redrawn only when it changes.
  if (!creatureStage && !tribeStage && !civStage && state.runStarted && !cellSandbox && hasMouth()) {
    const record = currentRecord();
    const sig = JSON.stringify([record.body, record.parts, record.colors, record.name]);
    const old = S.pedia.entries["cell:current"];
    if (!old || old.sig !== sig)
      S.record({ id: "cell:current", kind: "cell", owned: true, name: record.name, sub: "Your cell now", stage: "Cell (tier " + state.tier + ")", diet: dietW(record.diet), parts: record.parts.length, record, sig, thumb: cellThumb(record), place: homeName });
  }
  const chronicle = loadChronicle().events;
  for (const ev of chronicle) if (!S.pedia.entries["hist:" + ev.key]) S.record({ id: "hist:" + ev.key, kind: "history", name: ev.text, icon: ev.icon, stage: ev.stage, at: ev.at || Date.now() });
  const traits = [progress.cellStageComplete && progress.dietCard ? DIET_CARDS[progress.dietCard]?.title : null, cs?.instinct && INSTINCTS[cs.instinct] ? INSTINCTS[cs.instinct].title : cs?.card ? CREATURE_CARDS[cs.card]?.title : null, ts?.path ? { peace: "Diplomatic", balance: "Industrious", conquest: "Warlike" }[ts.path] : null].filter(Boolean);
  const cv = loadCivSave();
  if (cv?.won && CIV_CARDS[cv.card]) traits.push(CIV_CARDS[cv.card].name);
  const stage = civStage || cv ? "Civilization" : tribeStage || ts ? "Tribal" : creatureStage || cs ? "Creature" : "Cell";
  const lastThumb = [...progress.history].reverse().find((g) => g.thumb)?.thumb || null;
  S.record({
    id: "species:player",
    kind: "species",
    owned: true,
    name: speciesName,
    sub: "Your species",
    diet: dietW(cs?.record ? dietPath(state.plants, state.meat) : progress.dietCard || dietPath(state.plants, state.meat)),
    stage: stage + " Stage",
    homeworld: homeName,
    place: homeName,
    planetId: home.planetId,
    traits: traits.join(", ") || "None yet",
    gen: progress.history.length,
    thumb: lastThumb,
    record: cs?.record || null,
    rarity: "Unique",
    timeline: chronicle.map((e) => ({ icon: e.icon, text: e.text })),
    generations: gens,
  });
  if (ts) {
    const tiers = ["", "stone", "bronze"];
    S.record({
      id: "tribal:village",
      kind: "tribal",
      owned: true,
      name: (ts.look?.name || speciesName) + " village",
      sub: "Your tribe",
      color: "#" + Number(ts.look?.color ?? 0x3fa9d6).toString(16).padStart(6, "0"),
      village: (ts.look?.style ? ts.look.style[0].toUpperCase() + ts.look.style.slice(1) + " hut" : "Hut") + " · level " + (ts.hutLevel || 1) + " · " + ts.units.length + " members",
      equipment: Object.entries(ts.tools || {}).filter(([, t]) => t > 0).map(([id, t]) => id + " (" + tiers[t] + ")").join(", ") || "None",
      outcome: ts.path ? { peace: "Diplomatic: every tribe allied", balance: "Industrious: allies and conquests", conquest: "Warlike: every tribe conquered" }[ts.path] : ts.tribes.filter((t) => t.status !== "neutral").length + " of " + ts.tribes.length + " tribes settled",
      place: homeName,
    });
  }
  // The universe card shows the latest design.
  if (lastThumb && universe.meta.thumb !== lastThumb && lastThumb.length < 200000) {
    universe.meta.thumb = lastThumb;
    universe.store.put("meta", universe.meta.id, universe.meta).catch(() => {});
  }
}
/** Play time, counted while the page is visible and something is being played. */
function tickPlaytime(dt) {
  if (!universe || document.hidden || !state.runStarted) return;
  playClock += dt;
  if (playClock < 30) return;
  universe.meta.playtime += playClock;
  universe.meta.lastPlayed = Date.now();
  playClock = 0;
  universe.store.put("meta", universe.meta.id, universe.meta).catch(() => {});
}
function openPath() {
  if (creatureEditor) return;
  const chronicle = loadChronicle().events;
  const cs = loadCreatureSave();
  if (tribeStage || civStage) {
    const stagePaused = tribeStage || civStage;
    stagePaused.setPaused(true);
    const ts = loadTribeSave();
    const cv = loadCivSave();
    openHistoryScreen({
      name: tribeStage?.record?.name || cs?.record?.name || state.cellName || "Your species",
      tier: state.tier,
      plants: state.plants,
      meat: state.meat,
      card: progress.dietCard,
      creature: cs ? { brain: cs.brain || 1, alliances: cs.alliances || 0, extinctions: cs.extinctions || 0, deaths: cs.deaths || 0, dna: cs.dna || 0, card: creatureCardFor(cs) } : null,
      tribe: trackSummary({ tribe: ts }).tribe,
      civ: cv ? { card: cv.won && CIV_CARDS[cv.card] ? CIV_CARDS[cv.card] : null, cities: cv.cities.filter((c) => c.owner === "you").length, total: cv.cities.length, captures: Object.values(cv.captures).reduce((a, b) => a + b, 0) } : null,
      legacy: tribeLegacy(progress.dietCard || dietPath(state.plants, state.meat), creatureCardFor(cs), cs?.instinct || cs?.leaning).lines,
      identity: identityView(cs),
      chronicle,
      history: progress.history,
      stats: progressStats(),
      onClose: () => stagePaused.setPaused(false),
    });
    return;
  }
  if (creatureStage) {
    creatureStage.setPaused(true);
    const st = creatureStage.stats();
    openHistoryScreen({
      name: creatureStage.record.name,
      tier: state.tier,
      plants: state.plants,
      meat: state.meat,
      card: progress.dietCard,
      creature: { brain: st.brain, alliances: st.alliances, extinctions: st.extinctions, deaths: st.deaths, dna: st.dna, card: st.card },
      library: creatureStage.library(),
      identity: identityView(st),
      tribe: trackSummary({ tribe: loadTribeSave() }).tribe,
      chronicle,
      history: progress.history,
      stats: progressStats(),
      onClose: () => creatureStage?.setPaused(false),
    });
    return;
  }
  if (state.editor) return;
  const wasPaused = state.paused;
  state.paused = true;
  progress.pathOpened = true;
  hideTip();
  openHistoryScreen({
    name: state.cellName || "Karlets",
    tier: state.tier,
    plants: state.plants,
    meat: state.meat,
    card: progress.cellStageComplete ? progress.dietCard : null,
    tribe: trackSummary({ tribe: loadTribeSave() }).tribe,
    chronicle,
    history: progress.history,
    stats: progressStats(),
    onClose: () => (state.paused = wasPaused),
  });
}
function applyQuality(name) {
  setQuality(name);
  try {
    localStorage.setItem(QUALITY_KEY, getQuality());
  } catch (e) {}
  renderer.setPixelRatio(basePixelRatio() * perf.scale);
  renderer.setSize(innerWidth, innerHeight);
  background.setQuality(getQuality());
  waterFx.setQuality(getQuality());
  spawnWorld();
  rebuildPlayer();
}
window.addEventListener("resize", () => {
  creatureStage?.resize();
  tribeStage?.resize();
  civStage?.resize();
  galaxyStart?.resize();
  creatureEditor?.resize();
  modularEditor?.resize();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(basePixelRatio() * perf.scale);
  if (state.editor) configureEditorViewport();
  else updateCamera();
});
// The universe system starts once the game is on screen.
document.querySelectorAll("#uvLinks [data-open]").forEach((b) => (b.onclick = () => openUniverseScreen(b.dataset.open)));
initUniverse().then(openStartScreen);
if (new URLSearchParams(location.search).has("debug")) {
  window.__spore = {
    get universe() {
      return universe;
    },
    background,
    openUniverseScreen,
    openEcoLibrary: (o2) => openEcoLibrary({ renderer, reducedMotion: settings.reducedMotion, sfx: playSfx, ...o2 }),
    syncPedia,
    editCreation,
    state,
    renderer,
    scene,
    camera,
    player,
    setEditor,
    rebuildPlayer,
    callMate,
    finishMate,
    get enemies() {
      return enemies;
    },
    get playerBody() {
      return playerBody;
    },
    get parts() {
      return parts;
    },
    get nodes() {
      return nodes;
    },
    get catalogDrag() {
      return catalogDrag;
    },
    get previewParts() {
      return previewParts;
    },
    get food() {
      return food;
    },
    get debris() {
      return debris;
    },
    get colonies() {
      return colonies;
    },
    get angle() {
      return angle;
    },
    get velocity() {
      return velocity;
    },
    spawnWorld,
    progress,
    unlocked,
    unlockPart,
    addPart,
    hurt,
    burst: (n) => {
      for (let i = 0; i < n; i++) spawnBurst(player.position.x, player.position.y, 0xffcc88, 20);
    },
    killNPC,
    damageNPC,
    completeCellStage,
    startCreatureStage,
    stopCreatureStage,
    openPath,
    spawnEpic,
    openGameSettings,
    startTribeStage,
    get tribeStage() {
      return tribeStage;
    },
    get civStage() {
      return civStage;
    },
    get galaxyStart() {
      return galaxyStart;
    },
    closeStartScreen,
    startCivStage,
    startGrowthPullback,
    get growth() {
      return growth;
    },
    get epics() {
      return epics;
    },
    tipEngine,
    get creatureStage() {
      return creatureStage;
    },
    get creatureEditor() {
      return creatureEditor;
    },
    get modularEditor() {
      return modularEditor;
    },
    openDesignEditor,
    get partOrbs() {
      return partOrbs;
    },
  };
}
