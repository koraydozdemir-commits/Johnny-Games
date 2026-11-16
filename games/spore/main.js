import * as THREE from "three";
import { buildCellBody, getQuality, QUALITY_PRESETS, setQuality, snapPartsToSurface, surfacePoint } from "./gfx/body.js";
import { createBackground } from "./gfx/background.js";
import { createFoodModel } from "./gfx/food.js";
import { timeUniform } from "./gfx/materials.js";
import { renderPartThumbnails } from "./gfx/thumbs.js";
import { SPECIES, chooseSpecies, speciesRecord } from "./species.js";
import { cellToJson, createCellRecord, defaultNodes as defaultSpine, makeRng, mirrorCellRecord, mutateCellRecord, storeCellRecord, writeHandoff } from "./cell-format.js";
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
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY_PRESETS[getQuality()].pixelRatio));
const background = createBackground(scene, getQuality());
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
const editorRim = new THREE.Mesh(new THREE.RingGeometry(5.7, 5.8, 128), new THREE.MeshBasicMaterial({ color: 0x7bd6d0, transparent: true, opacity: 0.45, depthWrite: false }));
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
scene.add(foodGroup, npcGroup, hazardGroup, meteorGroup, currentGroup);
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
  foodGoal: 8,
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
  selected: "filter",
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
  epicTimer: 95,
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
const unlocked = new Set(["filter", "cilia", "eye"]);
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
  particles = [],
  floatingFX = [],
  undoStack = [],
  redoStack = [],
  lastTime = performance.now(),
  gameTime = 0,
  worldSize = 1,
  radarDotCache = new Map(),
  editorCenterX = 0,
  editorEntrySnapshot = null,
  rebuildPending = false,
  audioContext = null,
  soundEnabled = true,
  hintTimeout = null,
  wakeCooldown = 0,
  autoSaveTimer = 28;
function toast(s) {
  const el = $("#toast");
  el.textContent = s;
  el.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}
function playSfx(kind) {
  if (!soundEnabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioContext) audioContext = new AC();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    const notes = {
      eat: [640, 880],
      damage: [180, 110],
      meteor: [720, 980, 1240],
      unlock: [540, 810, 1080],
      mate: [440, 660, 880],
      hatch: [330, 495, 660],
      click: [420],
      jet: [155, 95],
      death: [180, 120],
    };
    const seq = notes[kind] || notes.click,
      now = audioContext.currentTime;
    seq.forEach((hz, i) => {
      const osc = audioContext.createOscillator(),
        gain = audioContext.createGain();
      osc.type = kind === "damage" || kind === "death" ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(hz, now + i * 0.065);
      if (kind === "jet") osc.frequency.exponentialRampToValueAtTime(Math.max(40, hz * 0.55), now + 0.12);
      gain.gain.setValueAtTime(0.0001, now + i * 0.065);
      gain.gain.linearRampToValueAtTime(kind === "damage" ? 0.035 : 0.045, now + i * 0.065 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.065 + 0.12);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.14);
    });
  } catch (e) {}
}
function spawnFloatLabel(x, y, text, color = 0xfff0bd) {
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
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.55, 0.52),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.set(x, y, 2.4);
  mesh.renderOrder = 30;
  mesh.userData = { life: 0.92, maxLife: 0.92, vx: (Math.random() - 0.5) * 0.32, vy: 0.62, vz: 0, spin: 0, floatText: true, texture };
  scene.add(mesh);
  floatingFX.push(mesh);
}
function spawnBurst(x, y, color = 0xffe5a1, count = 10) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.025 + Math.random() * 0.04, 0),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.95 }),
    );
    mesh.position.set(x + (Math.random() - 0.5) * 0.18, y + (Math.random() - 0.5) * 0.18, 0.65 + Math.random() * 0.2);
    mesh.userData = {
      life: 0.38 + Math.random() * 0.5,
      maxLife: 0.88,
      vx: (Math.random() - 0.5) * 2.5,
      vy: (Math.random() - 0.5) * 2.5,
      vz: 0.2 + Math.random() * 0.8,
      spin: (Math.random() - 0.5) * 5,
    };
    scene.add(mesh);
    floatingFX.push(mesh);
  }
}
function spawnWake() {
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.045 + Math.random() * 0.055, 9, 7),
    new THREE.MeshBasicMaterial({ color: 0xb8f5f0, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  bubble.position.set(
    player.position.x - Math.cos(angle) * 0.9 + (Math.random() - 0.5) * 0.25,
    player.position.y - Math.sin(angle) * 0.9 + (Math.random() - 0.5) * 0.25,
    0.3,
  );
  bubble.userData = {
    life: 0.45 + Math.random() * 0.35,
    maxLife: 0.8,
    vx: -velocity.x * 0.12 + (Math.random() - 0.5) * 0.35,
    vy: -velocity.y * 0.12 + (Math.random() - 0.5) * 0.35,
    vz: 0.25,
    spin: Math.random() * 2,
  };
  scene.add(bubble);
  floatingFX.push(bubble);
}
function updateBurstFX(dt) {
  floatingFX = floatingFX.filter((p) => {
    p.userData.life -= dt;
    if (p.userData.life <= 0) {
      scene.remove(p);
      p.geometry.dispose();
      if (p.userData.texture) p.userData.texture.dispose();
      p.material.dispose();
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
function scheduleRebuildPlayer() {
  if (rebuildPending) return;
  rebuildPending = true;
  requestAnimationFrame(() => {
    rebuildPending = false;
    rebuildPlayer();
  });
}
/** The live cell as a saved-cell record: the single description the body builder, mating and the creature stage share. */
function currentRecord() {
  return createCellRecord({
    name: state.cellName,
    nodes,
    parts: parts.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rotation, scale: p.scale, pairId: p.pairId })),
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
  playerBody = buildCellBody(currentRecord(), { role: state.editor ? "editor" : "player", seed: 1, rimColor: 0xbff8ff });
  playerBody.rig.setFrozen(state.editor);
  player.add(playerBody.root);
  boundary = playerBody.outline;
  parts.forEach((p, i) => {
    p.index = i;
    p.object = playerBody.partObjects[i]?.group;
    if (state.editor) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(i === state.selectedPart ? 0.25 : 0.17, 0.025, 6, 20),
        new THREE.MeshBasicMaterial({ color: i === state.selectedPart ? 0xffe38b : 0x7fe8ed, transparent: true, opacity: 0.95, depthTest: false }),
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
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(n.r, 0.022, 7, 32),
        new THREE.MeshBasicMaterial({ color: i === state.selectedNode ? 0xffcf71 : 0x85e8f0, transparent: true, opacity: 0.82, depthTest: false }),
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
function partIsOutsideHull(x, y) {
  let inside = false,
    minDist = Infinity;
  const poly = boundary;
  if (!poly || poly.length < 3) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j],
      vx = b.x - a.x,
      vy = b.y - a.y,
      den = vx * vx + vy * vy,
      t = den ? THREE.MathUtils.clamp(((x - a.x) * vx + (y - a.y) * vy) / den, 0, 1) : 0,
      dx = x - (a.x + t * vx),
      dy = y - (a.y + t * vy);
    minDist = Math.min(minDist, Math.hypot(dx, dy));
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return !inside && minDist > 0.16;
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
        (ok ? "DNA " + d.cost : "Find meteor / elite") +
        "</small>";
      const thumb = partThumbs.get(d.id);
      if (thumb) {
        const img = document.createElement("img");
        img.className = "partThumb";
        img.alt = "";
        img.src = thumb;
        b.prepend(img);
      }
      b.title = d.desc;
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
          (d.diet ? "<br><strong>Diet:</strong> " + d.diet : "");
        renderCatalog();
        updateHUD();
      };
      b.addEventListener("dragstart", (e) => {
        if (!ok) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", d.id);
        state.selected = d.id;
      });
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
function updateHUD() {
  const s = stats();
  state.maxHealth = 100 + s.healthBonus * 10;
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
  $("#tierLabel").textContent = "SCALE TIER " + state.tier + " / 4";
  const hasJet = parts.some((p) => p.id === "jet");
  $("#touchBoost").classList.toggle("lockedAbility", !hasJet);
  $("#touchBoost").title = hasJet ? "Jet boost · spends stamina" : "Unlock a Jet in the Cell Editor to boost";
  $("#touchMate").classList.toggle("readyAbility", state.food >= state.foodGoal && !state.mateSignal);
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
    : state.food >= state.foodGoal
      ? ["READY", state.tier >= 4 ? "Press ♡ to finish the Cell Stage." : "Press ♡ to call a mate."]
      : !hasMouth
        ? ["NEEDS MOUTH", "Open the cell editor and attach a mouth part to eat."]
        : ["FORAGE", "Eat " + (state.foodGoal - state.food) + " more food particle" + (state.foodGoal - state.food === 1 ? "" : "s") + " to attract a mate."];
  $("#objectiveStep").textContent = objective[0];
  $("#objectiveText").textContent = objective[1];
  $("#callMateBtn").textContent = state.mateSignal ? "♥" : "♡";
  $("#callMateBtn").title = state.mateSignal ? "Follow the heart" : "Call a mate when growth is full";
  $("#mateCue").classList.toggle("show", state.food >= state.foodGoal || state.mateSignal);
  $("#mateCueTitle").textContent = state.mateSignal ? "♥" : state.food >= state.foodGoal ? "✦" : "";
  $("#mateCueText").textContent = "";
  const discoveryLabel = $("#discoveryCount")?.previousElementSibling;
  if (discoveryLabel) discoveryLabel.textContent = "✦";
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
  updateRadar();
}
function updateRadar() {
  const el = $("#radar"),
    active = new Set(),
    R = 50,
    s = stats(),
    range = 12 + s.sight * 1.6;
  let playerDot = el.querySelector(".radarDot.player");
  if (!playerDot) {
    playerDot = document.createElement("i");
    playerDot.className = "radarDot player";
    el.appendChild(playerDot);
  }
  function dot(obj, col) {
    if (!obj || !obj.userData || !obj.userData.alive) return;
    const dx = obj.position.x - player.position.x,
      dy = obj.position.y - player.position.y,
      d = Math.hypot(dx, dy);
    if (d > range) return;
    const key = obj.uuid;
    active.add(key);
    let n = radarDotCache.get(key);
    if (!n) {
      n = document.createElement("i");
      radarDotCache.set(key, n);
    }
    n.className = "radarDot" + (obj.userData.alpha || obj.userData.epic ? " alpha" : "");
    n.style.left = 50 + (dx / range) * R * 0.82 + "%";
    n.style.top = 50 - (dy / range) * R * 0.82 + "%";
    n.style.background = col;
    n.style.color = col;
    n.style.width = obj.userData.alpha || obj.userData.epic ? "8px" : "5px";
    n.style.height = obj.userData.alpha || obj.userData.epic ? "8px" : "5px";
    n.style.boxShadow = obj.userData.alpha || obj.userData.epic ? "0 0 8px #ff293f" : "none";
    if (n.parentElement !== el) el.appendChild(n);
  }
  food.forEach((f) => dot(f, f.userData.type === "plant" ? "#65ef9b" : "#f2ba85"));
  enemies.forEach((e) => dot(e, e.userData.alpha || e.userData.epic ? "#ff293f" : e.userData.diet === "meat" ? "#ff647a" : "#f5f5f4"));
  meteors.forEach((m) => dot(m, "#ffd56d"));
  if (state.mate) dot(state.mate, "#ff9ddd");
  for (const [key, node] of radarDotCache) {
    if (!active.has(key)) {
      node.remove();
      radarDotCache.delete(key);
    }
  }
}
function configureEditorViewport() {
  const aspect = innerWidth / innerHeight;
  cameraZoom = Math.max(10.5, 10.8 / aspect);
  cameraZoomTarget = cameraZoom;
  editorCenterX = !isTouchUI() ? cameraZoom * aspect * 0.12 : 0;
  player.position.set(editorCenterX, 0, 1);
  player.rotation.z = Math.PI;
  editorStage.position.set(editorCenterX, 0, 0);
  camera.position.set(editorCenterX, 0, 30);
  camera.lookAt(editorCenterX, 0, 0);
  updateCamera();
}
function setEditor(on) {
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
  state.editor = on;
  editorStage.visible = on;
  [foodGroup, npcGroup, hazardGroup].forEach((g) => (g.visible = !on));
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
    document.body.classList.toggle("show-parts", !isTouchUI());
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
        label: "Edit cell",
        action: () => {
          state.paused = false;
          setEditor(true);
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
  g.position.set(x, y, 0.2);
  g.userData = {
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
    rimColor: options.mate ? 0xffc6e8 : threat ? 0xff7a66 : 0xa6ffc9,
    eyeColor: species?.eyeColor,
  });
  const g = new THREE.Group();
  g.add(body.root);
  const widest = Math.max(...record.body.nodes.map((n) => n.r));
  const overlayY = widest * 0.62 + 0.55;
  const dietSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dietBadge(diet === "omni" ? "meat" : diet), transparent: true, depthTest: false }));
  dietSprite.material.userData.shared = false;
  dietSprite.scale.set(0.24, 0.24, 1);
  dietSprite.renderOrder = 20;
  g.add(dietSprite);
  const healthGroup = new THREE.Group();
  const back = new THREE.Mesh(healthBarGeometries.back, new THREE.MeshBasicMaterial({ color: 0x10202c, transparent: true, opacity: 0.8, depthTest: false }));
  back.renderOrder = 20;
  healthGroup.add(back);
  const bar = new THREE.Mesh(healthBarGeometries.bar, new THREE.MeshBasicMaterial({ color: 0x66ee8c, depthTest: false }));
  bar.position.z = 0.01;
  bar.renderOrder = 21;
  healthGroup.add(bar);
  g.add(healthGroup);
  const initialAngle = Math.random() * Math.PI * 2;
  const maxHealth = alpha ? 24 : 6 + size * 4;
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
    state: "idle",
    phase: phase,
    target: null,
    attackCooldown: 0,
    bar: bar,
    healthGroup: healthGroup,
    dietSprite: dietSprite,
    velocity: new THREE.Vector2(Math.cos(initialAngle) * (0.12 + Math.random() * 0.2), Math.sin(initialAngle) * (0.12 + Math.random() * 0.2)),
    color: record.colors.base,
  };
  g.scale.setScalar(size);
  g.position.set(options.x ?? (Math.random() - 0.5) * 44 * worldSize, options.y ?? (Math.random() - 0.5) * 28 * worldSize, 0.2);
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
  state.dna += f.userData.kind === "chunk" ? 2 : 1;
  state.scale = Math.min(1.65, state.scale + 0.0055);
  player.scale.setScalar(state.scale);
  cameraZoomTarget = Math.min(12 + stats().sight * 1.7, cameraZoomTarget + 0.055);
  state.health = Math.min(state.maxHealth, state.health + 3);
  updateHUD();
  saveGame(true);
  if (!wasReady && state.food >= state.foodGoal) {
    spawnBurst(player.position.x, player.position.y, 0xffdf8a, 26);
    playSfx("mate");
    $("#growthBar").classList.add("growthReady");
    if (navigator.vibrate)
      try {
        navigator.vibrate([14, 24, 14]);
      } catch (e) {}
  }
  setTimeout(() => {
    if (!f.parent) return;
    const bx = 22 * worldSize,
      by = 14 * worldSize;
    f.position.set(
      THREE.MathUtils.clamp(player.position.x + (Math.random() - 0.5) * 38 * worldSize, -bx, bx),
      THREE.MathUtils.clamp(player.position.y + (Math.random() - 0.5) * 24 * worldSize, -by, by),
      0.2,
    );
    f.userData.base.set(f.position.x, f.position.y);
    f.userData.alive = true;
    f.visible = true;
  }, 2400);
}
function dropMeat(x, y, amount = 3) {
  for (let i = 0; i < amount; i++) {
    const f = addFood("meat", x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.8, "chunk");
    f.userData.value = 2;
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
  dropMeat(e.position.x, e.position.y, elite ? 5 : 2);
  if (playerKill) {
    playSfx("death");
    state.dna += elite ? 5 : 2;
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
    if (!state.editor) makeNPC({ size: (0.3 + Math.random() * 0.6) * (1 + (state.tier - 1) * 0.08) });
  }, 2500);
}
function damageNPC(e, dmg, stun = false) {
  if (!e.userData.alive) return;
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
function hurt(amount, reason) {
  if (state.damageCooldown > 0) return;
  const s = stats(),
    damage = Math.max(1, amount - s.armour * 1.5);
  state.health -= damage;
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
  if (state.health <= 0) {
    state.health = Math.max(45, state.maxHealth * 0.55);
    state.food = Math.max(0, state.food - 2);
    player.position.set(0, 0, 1);
    velocity.set(0, 0);
    enemies
      .filter((e) => e.userData.alive)
      .forEach((e) => {
        if (distance2D(e.position, player.position) < 4) e.position.add(new THREE.Vector3(3, 2, 0));
      });
    spawnBurst(player.position.x, player.position.y, 0x7debf8, 26);
    playSfx("death");
    updateHUD();
  }
}
function downloadCellJson() {
  const blob = new Blob([cellToJson(currentRecord())], { type: "application/json" }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.cellName || "cell").replace(/[^a-z0-9-_]+/gi, "-") + ".spore-cell.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function completeCellStage() {
  const record = currentRecord();
  storeCellRecord(localStorage, record);
  writeHandoff(localStorage, record, {
    plants: state.plants,
    meat: state.meat,
    discoveries: state.discoveries,
    eliteKills: state.eliteKills,
    dna: state.dna,
    unlocked: [...unlocked],
  });
  showDialog(
    "CELL STAGE COMPLETE",
    "Your cell has been saved for the Creature Stage. Download a copy to keep it, keep exploring, or refine it in the editor first.",
    [
      { label: "Download my cell", primary: true, action: downloadCellJson },
      { label: "Keep exploring", action: () => {} },
      { label: "Edit cell", action: () => setEditor(true) },
    ],
  );
}
function callMate() {
  if (state.editor || state.paused) return;
  if (state.tier >= 4 && state.food >= state.foodGoal) {
    completeCellStage();
    return;
  }
  if (state.food < state.foodGoal) {
    const bar = $("#growthBar");
    bar.classList.remove("needsFoodPulse");
    void bar.offsetWidth;
    bar.classList.add("needsFoodPulse");
    setTimeout(() => bar.classList.remove("needsFoodPulse"), 750);
    return;
  }
  if (state.mateSignal && state.mate) return;
  state.mateSignal = true;
  state.mateTimer = 25;
  const direction = Math.random() * Math.PI * 2,
    matDist = Math.min(8, Math.max(4, 12 * worldSize)),
    mateX = THREE.MathUtils.clamp(player.position.x + Math.cos(direction) * matDist, -22.5 * worldSize, 22.5 * worldSize),
    mateY = THREE.MathUtils.clamp(player.position.y + Math.sin(direction) * matDist, -13.5 * worldSize, 13.5 * worldSize);
  const mateRecord = snapPartsToSurface(mutateCellRecord(mirrorCellRecord(currentRecord()), makeRng((Math.random() * 1e9) | 0), 0.6), { faceOutward: true });
  const m = makeNPC({ record: mateRecord, size: state.scale * 0.97, mate: true, x: mateX, y: mateY });
  m.userData.mate = true;
  m.userData.state = "mate";
  m.userData.health = 999;
  m.userData.velocity.set(0, 0);
  const heart = makeHeartSprite();
  heart.position.set(0, 0.85, 0.9);
  m.add(heart);
  state.mate = m;
  $("#mateCueTitle").textContent = "♥";
  $("#mateCueText").textContent = "";
  $("#mateCue").classList.add("show");
  playSfx("mate");
  spawnBurst(m.position.x, m.position.y, 0xff9ed7, 14);
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
  if (state.mate) {
    state.mate.userData.alive = false;
    disposeTree(state.mate);
    enemies = enemies.filter((e) => e !== state.mate);
    state.mate = null;
  }
  state.dna += 10;
  state.tier = Math.min(4, state.tier + 1);
  state.food = 0;
  state.foodGoal = state.tier === 2 ? 10 : state.tier === 3 ? 12 : 14;
  state.foodSinceMate = 0;
  state.health = state.maxHealth;
  state.scale = Math.min(1.65, state.scale + 0.12);
  state.epicTimer = 70 + Math.random() * 35;
  state.eliteTimer = 28 + Math.random() * 20;
  worldSize *= 1.4;
  player.scale.setScalar(state.scale);
  state.mate = null;
  state.mateSignal = false;
  state.mateTimer = 0;
  velocity.set(0, 0);
  player.position.set(0, 0, 1);
  angle = 0;
  player.rotation.z = 0;
  cameraZoomTarget = 9 * Math.pow(1.36, state.tier - 1);
  state.shake = 0.5;
  spawnBurst(0, 0, 0x80edff, 34);
  spawnFloatLabel(0, 0, "GENERATION " + state.tier, 0xcaf9ff);
  spawnFloatLabel(0.1, -0.5, "+10 DNA", 0xffe7a2);
  autoSaveTimer = 28;
  spawnWorld();
  saveGame(true);
  updateHUD();
  if (state.tier >= 4) {
    completeCellStage();
  } else
    showDialog(
      "A new generation!",
      "Mating complete. +10 DNA. The soup expands, the camera pulls back, and new scale-tier organisms enter the ecosystem. Edit your cell before returning to the broth.",
      [
        { label: "Enter cell editor", primary: true, action: () => setEditor(true) },
        { label: "Keep swimming", action: () => {} },
      ],
    );
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
function onPointerDown(e) {
  if ($("#intro").style.display !== "none" || $("#hatchCinematic").style.display === "flex" || $("#dialogOverlay").style.display === "flex")
    return;
  canvas.setPointerCapture(e.pointerId);
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
    const pi = hitPlayerPart(pos);
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
    let n = nodes[dragging.index];
    if (!n) return;
    const p = localFromWorld(pos);
    if (!dragging.extended && (dragging.index === 0 || dragging.index === nodes.length - 1)) {
      const i = dragging.index,
        neighbor = nodes[i === 0 ? 1 : i - 1],
        base = dragging.startNode;
      const out = new THREE.Vector2(base.x - neighbor.x, base.y - neighbor.y).normalize();
      const delta = new THREE.Vector2(p.x - base.x, p.y - base.y);
      if (delta.dot(out) > 0.72 && nodes.length < 8) {
        if (i === 0) {
          nodes.unshift({ x: p.x, y: p.y, r: Math.max(0.24, base.r * 0.8) });
          dragging.index = 0;
        } else {
          nodes.push({ x: p.x, y: p.y, r: Math.max(0.24, base.r * 0.8) });
          dragging.index = nodes.length - 1;
        }
        dragging.extended = true;
        n = nodes[dragging.index];
        state.selectedNode = dragging.index;
        toast("Spine extended · new vertebra added");
      } else if (delta.dot(out) < -0.72 && nodes.length > 2) {
        if (i === 0) {
          nodes.shift();
          dragging.index = 0;
        } else {
          nodes.pop();
          dragging.index = nodes.length - 1;
        }
        dragging.extended = true;
        n = nodes[dragging.index];
        state.selectedNode = dragging.index;
        toast("Spine shortened · terminal vertebra removed");
      }
    }
    n.x = Math.max(-4.2, Math.min(4.2, p.x));
    n.y = Math.max(-2.8, Math.min(2.8, p.y));
    scheduleRebuildPlayer();
  } else if (dragging.kind === "radius") {
    const n = nodes[dragging.index];
    if (n) {
      const p = localFromWorld(pos);
      n.r = THREE.MathUtils.clamp(new THREE.Vector2(p.x - n.x, p.y - n.y).length(), 0.22, 1.55);
      scheduleRebuildPlayer();
    }
  } else if (dragging.kind === "part") {
    const p = localFromWorld(pos),
      a = parts[dragging.index];
    if (a) {
      a.x = p.x;
      a.y = p.y;
      const mate = parts.find((q, j) => j !== dragging.index && a.pairId && q.pairId === a.pairId);
      if (state.symmetry && mate) {
        mate.x = p.x;
        mate.y = -p.y;
        mate.rotation = -a.rotation;
      } else if (mate && !state.symmetry) {
        a.pairId = nextPairId++;
        mate.pairId = nextPairId++;
      }
      const rect = $("#editorTrash").getBoundingClientRect(),
        overTrash = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      dragging.outside = partIsOutsideHull(a.x, a.y) || overTrash;
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
          n.r = THREE.MathUtils.clamp(n.r - Math.sign(e.deltaY) * 0.05, 0.25, 1.15);
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
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!state.editor) return;
  const id = e.dataTransfer.getData("text/plain");
  const p = setCanvasCoords(toWorld(e));
  addPart(id, p.x, p.y);
});
function updateCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = (-cameraZoom * aspect) / 2;
  camera.right = (cameraZoom * aspect) / 2;
  camera.top = cameraZoom / 2;
  camera.bottom = -cameraZoom / 2;
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
      u.rig.update(dt, time, { speed: u.mate ? 0.3 : u.velocity.length() });
      // Keep the health bar and diet badge upright above the cell, whatever way it is facing.
      const up = u.overlayY;
      u.healthGroup.rotation.z = -e.rotation.z;
      u.healthGroup.position.set(Math.sin(e.rotation.z) * up, Math.cos(e.rotation.z) * up, 0.9);
      u.dietSprite.position.set(Math.sin(e.rotation.z) * (up + 0.22), Math.cos(e.rotation.z) * (up + 0.22), 0.93);
    }
    if (u.mate) return;
    if (u.epic) {
      e.position.x += u.velocity.x * dt;
      e.position.y += u.velocity.y * dt;
      if (e.position.x > player.position.x + cameraZoom * 1.2) {
        e.position.x = player.position.x - cameraZoom * 1.2;
        e.position.y = player.position.y + (Math.random() - 0.5) * cameraZoom;
        u.hitCooldown = 0;
      }
      u.hitCooldown = Math.max(0, (u.hitCooldown || 0) - dt);
      const impactDistance = distance2D(e.position, player.position);
      if (impactDistance < u.size + state.scale && u.hitCooldown <= 0) {
        hurt(WORLD_TUNING.epicDamage, "The macro-predator struck!");
        spawnBurst(player.position.x, player.position.y, 0xff6f86, 18);
        const shove = new THREE.Vector2(player.position.x - e.position.x, player.position.y - e.position.y);
        if (shove.length() < 0.01) shove.set(1, 0);
        shove.normalize();
        velocity.addScaledVector(shove, 3.2);
        u.hitCooldown = 3;
      }
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
      isBig = u.size > playerSize * 1.18 || u.alpha,
      playerBigger = playerSize > u.size * 1.18;
    let target = null,
      targetFood = null,
      prey = null;
    if (u.diet === "meat") {
      let nearest = Infinity;
      enemies.forEach((other) => {
        if (other === e || !other.userData.alive || other.userData.mate || other.userData.epic || other.userData.size >= u.size * 0.78)
          return;
        const d = e.position.distanceTo(other.position);
        if (d < nearest && d < 7) {
          nearest = d;
          prey = other;
        }
      });
      if (prey) {
        target = prey.position;
        u.state = "hunt";
      } else if (playerDist < 9 && isBig) {
        target = player.position;
        u.state = "hunt";
      }
    }
    if (!target && isSmall && (playerThreat || playerBigger) && playerDist < 8 && u.diet !== "meat") {
      u.state = "flee";
      const away = new THREE.Vector2(e.position.x - player.position.x, e.position.y - player.position.y);
      if (away.length() < 0.01) away.set(Math.random() - 0.5, Math.random() - 0.5);
      away.normalize();
      u.velocity.x += away.x * dt * 7.5;
      u.velocity.y += away.y * dt * 7.5;
    } else if (!target) {
      u.state = "forage";
      let best = null,
        bestFood = null,
        bd = Infinity;
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
      if (best && bd < 9) {
        target = best;
        targetFood = bestFood;
      } else {
        u.state = "idle";
        u.velocity.x += Math.cos(time * 0.55 + u.phase) * dt * 0.55;
        u.velocity.y += Math.sin(time * 0.48 + u.phase) * dt * 0.55;
      }
    }
    if (target) {
      const steer = new THREE.Vector2(target.x - e.position.x, target.y - e.position.y);
      if (steer.length() > 0.01) {
        steer.normalize();
        const pace = u.state === "hunt" ? 2.25 : 1.2;
        u.velocity.x += steer.x * dt * pace * 2.4;
        u.velocity.y += steer.y * dt * pace * 2.4;
        e.rotation.z = Math.atan2(steer.y, steer.x);
      }
    }
    u.velocity.multiplyScalar(Math.max(0, 1 - 1.18 * dt));
    u.velocity.clampLength(0, u.alpha ? 3.1 : 2.35);
    e.position.x += u.velocity.x * dt;
    e.position.y += u.velocity.y * dt;
    if (u.velocity.lengthSq() > 0.08) {
      const desired = Math.atan2(u.velocity.y, u.velocity.x),
        delta = THREE.MathUtils.euclideanModulo(desired - e.rotation.z + Math.PI, Math.PI * 2) - Math.PI;
      e.rotation.z += THREE.MathUtils.clamp(delta, -dt * (u.alpha ? 3.6 : 2.5), dt * (u.alpha ? 3.6 : 2.5));
    }
    if (targetFood && e.position.distanceTo(targetFood.position) < 0.46 && targetFood.userData.alive) {
      u.rig.eat();
      spawnBurst(targetFood.position.x, targetFood.position.y, u.diet === "plant" ? 0x8effb7 : 0xffc19b, 6);
      targetFood.userData.alive = false;
      targetFood.visible = false;
      setTimeout(() => {
        if (targetFood.parent) {
          targetFood.position.set(
            THREE.MathUtils.clamp(e.position.x + (Math.random() - 0.5) * 18 * worldSize, -22 * worldSize, 22 * worldSize),
            THREE.MathUtils.clamp(e.position.y + (Math.random() - 0.5) * 12 * worldSize, -14 * worldSize, 14 * worldSize),
            0.2,
          );
          targetFood.userData.base.set(targetFood.position.x, targetFood.position.y);
          targetFood.userData.alive = true;
          targetFood.visible = true;
        }
      }, 2800);
    }
    if (prey && prey.userData.alive && e.position.distanceTo(prey.position) < 0.68) {
      u.state = "attack";
      u.attackCooldown -= dt;
      if (u.attackCooldown <= 0) {
        prey.userData.health -= u.alpha ? 4 : 1.7;
        u.attackCooldown = 0.7;
        if (prey.userData.health <= 0) killNPC(prey, false);
      }
    }
    const maxNX = 23.7 * worldSize,
      maxNY = 14.7 * worldSize;
    if (e.position.x > maxNX) {
      e.position.x = maxNX;
      u.velocity.x = -Math.abs(u.velocity.x) * 0.45;
      u.phase += Math.PI * 0.7;
    } else if (e.position.x < -maxNX) {
      e.position.x = -maxNX;
      u.velocity.x = Math.abs(u.velocity.x) * 0.45;
      u.phase += Math.PI * 0.7;
    }
    if (e.position.y > maxNY) {
      e.position.y = maxNY;
      u.velocity.y = -Math.abs(u.velocity.y) * 0.45;
      u.phase += Math.PI * 0.45;
    } else if (e.position.y < -maxNY) {
      e.position.y = -maxNY;
      u.velocity.y = Math.abs(u.velocity.y) * 0.45;
      u.phase += Math.PI * 0.45;
    }
    const dPlayer = distance2D(e.position, player.position),
      mouthParts = parts.filter((p) => p.def.cat === "Mouths"),
      mouthTouch = mouthParts.some(
        (p) =>
          localNodeWorld(p).distanceTo(new THREE.Vector2(e.position.x, e.position.y)) <
          (p.id === "proboscis" ? 0.82 : p.id === "jaw" ? 0.62 : 0.42) * state.scale * (p.scale || 1),
      ),
      spikeParts = parts.filter((p) => p.id === "spike"),
      spikeTouch = spikeParts.some(
        (p) => localNodeWorld(p).distanceTo(new THREE.Vector2(e.position.x, e.position.y)) < 0.68 * state.scale * (p.scale || 1),
      );
    if (dPlayer < 0.72 * state.scale || mouthTouch || spikeTouch) {
      if (s.diet !== "plant" && mouthTouch && isSmall && !u.alpha && !u.epic) {
        killNPC(e, true);
        state.food++;
        state.meat++;
        state.dna += 1;
        state.scale = Math.min(1.65, state.scale + 0.0055);
        player.scale.setScalar(state.scale);
        updateHUD();
        playSfx("eat");
        spawnBurst(e.position.x, e.position.y, 0x8ff0d4, 16);
        spawnFloatLabel(e.position.x, e.position.y, "+DNA", 0xffe5a2);
      } else if (mouthTouch && s.diet !== "plant") {
        u.state = "attack";
        u.attackCooldown -= dt;
        if (u.attackCooldown <= 0) {
          const dmg = mouthParts.some((p) => p.id === "jaw") ? 5 : 2;
          damageNPC(e, dmg, u.epic);
          u.attackCooldown = 0.6;
        }
      } else if (dPlayer < 0.72 * state.scale && u.diet === "meat" && isBig) {
        u.state = "attack";
        u.attackCooldown -= dt;
        if (u.attackCooldown <= 0) {
          hurt(u.alpha ? 13 : 7, "A carnivore bit your cell!");
          u.attackCooldown = 1;
        }
      } else if (dPlayer < 0.72 * state.scale && u.diet === "plant" && isSmall && playerThreat) {
        u.state = "flee";
      }
    }
    if (u.healthGroup) u.healthGroup.visible = dPlayer < 7 || u.health < u.maxHealth;
    if (u.dietSprite) u.dietSprite.visible = dPlayer < 13 || u.alpha;
  });
  if (state.mateSignal && state.mate && state.mate.userData.alive) {
    const m = state.mate,
      d = distance2D(m.position, player.position);
    m.position.x += Math.sin(time * 1.2) * dt * 0.4;
    m.position.y += Math.cos(time * 0.9) * dt * 0.4;
    if (d < 1.25 * state.scale) {
      finishMate();
      return;
    }
    state.mateTimer -= dt;
    if (state.mateTimer <= 0) {
      state.mateSignal = false;
      m.userData.alive = false;
      disposeTree(m);
      enemies = enemies.filter((e) => e !== m);
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
  const candidates = [];
  if (state.mateSignal && state.mate && state.mate.userData.alive) candidates.push({ obj: state.mate, kind: "mate", priority: 0 });
  else {
    enemies.forEach((e) => {
      if (e.userData.alive && (e.userData.epic || e.userData.alpha))
        candidates.push({ obj: e, kind: "danger", priority: e.userData.epic ? 0 : 1 });
    });
    meteors.forEach((m) => {
      if (m.userData.alive) candidates.push({ obj: m, kind: "meteor", priority: 2 });
    });
    food.forEach((f) => {
      if (f.userData.alive && compatible(f.userData.type)) candidates.push({ obj: f, kind: "food", priority: 3 });
    });
  }
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
  const sight = 8 + stats().sight * 1.9;
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
}

function updateFood(dt, time) {
  const s = stats(),
    mouths = parts.filter((p) => p.def.cat === "Mouths");
  const mouthWorld = (p) => localNodeWorld(p);
  food.forEach((f) => {
    if (!f.userData.alive) return;
    f.rotation.z += dt * 0.5;
    f.position.x += Math.sin(time + f.userData.phase) * dt * 0.09;
    f.position.y += Math.cos(time * 0.8 + f.userData.phase) * dt * 0.07;
    currents.forEach((cur) => {
      if (f.position.distanceTo(cur.position) < 3) {
        f.position.x += cur.userData.force.x * dt * 0.4;
        f.position.y += cur.userData.force.y * dt * 0.4;
      }
    });
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
      spawnFloatLabel(m.position.x, m.position.y, "+2 DNA", 0xffe27b);
      playSfx("meteor");
      state.dna += 2;
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
    THREE.MathUtils.clamp(player.position.x + (Math.random() - 0.5) * 18 * worldSize, -22 * worldSize, 22 * worldSize),
    THREE.MathUtils.clamp(player.position.y + (Math.random() - 0.5) * 12 * worldSize, -13 * worldSize, 13 * worldSize),
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

/* ---- World population -------------------------------------------------
   Every count lives in WORLD_TUNING so the balance can be tuned in one place.
   Index 0 is tier 1. Culling by sight radius (updateVisibility) keeps the
   number of drawn objects low even when the larger tiers hold more entities. */
const WORLD_TUNING = {
  foodParticles: [38, 54, 74, 96],
  meatChunks: [3, 5, 7, 9],
  npcs: [9, 12, 15, 17],
  clouds: [0, 2, 3, 4],
  currents: [2, 3, 4, 5],
  meteors: [2, 2, 3, 3],
  maxLiveMeteors: [3, 4, 5, 5],
  maxVents: (tier) => 3 + tier,
  plantShare: { plant: 0.7, meat: 0.38, omni: 0.55 },
  epicLifetime: 48,
  epicDamage: 50,
};
const tierIndex = () => Math.min(3, Math.max(0, state.tier - 1));
const randomInWorld = (margin = 1.2) => ({
  x: (Math.random() - 0.5) * 2 * (23 * worldSize - margin),
  y: (Math.random() - 0.5) * 2 * (14 * worldSize - margin),
});

function clearWorldEntities() {
  state.worldGeneration++;
  for (const list of [food, enemies, meteors, hazards, currents, floatingMeat]) {
    list.forEach((o) => disposeTree(o));
    list.length = 0;
  }
  vents.forEach((v) => disposeTree(v.mesh));
  vents.length = 0;
  particles.forEach((o) => disposeTree(o));
  particles.length = 0;
  epics.length = 0;
  state.mate = null;
  state.mateSignal = false;
  $("#mateCue").classList.remove("show");
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
  g.userData = { phase: Math.random() * 6, force: new THREE.Vector2(Math.cos(heading), Math.sin(heading)).multiplyScalar(strength), baseHeading: heading };
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
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x8cf67a : 0xb4e85a, transparent: true, opacity: 0.1 + Math.random() * 0.08, depthWrite: false }),
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

function spawnWorld() {
  clearWorldEntities();
  const i = tierIndex(),
    diet = stats().diet,
    plantShare = WORLD_TUNING.plantShare[diet] ?? 0.55;
  for (let n = 0; n < WORLD_TUNING.foodParticles[i]; n++) {
    const p = randomInWorld();
    addFood(Math.random() < plantShare ? "plant" : "meat", p.x, p.y, "particle");
  }
  for (let n = 0; n < WORLD_TUNING.meatChunks[i]; n++) {
    const p = randomInWorld();
    addFood("meat", p.x, p.y, "chunk");
  }
  for (let n = 0; n < WORLD_TUNING.npcs[i]; n++) {
    const p = randomInWorld(2);
    // Keep the arrival area calm: no NPC may spawn right on top of the player.
    if (Math.hypot(p.x - player.position.x, p.y - player.position.y) < 6) p.x += p.x < player.position.x ? -7 : 7;
    makeNPC({ x: THREE.MathUtils.clamp(p.x, -22 * worldSize, 22 * worldSize), y: p.y });
  }
  for (let n = 0; n < WORLD_TUNING.currents[i]; n++) createCurrent();
  for (let n = 0; n < WORLD_TUNING.clouds[i]; n++) createToxicCloud();
  for (let n = 0; n < WORLD_TUNING.meteors[i]; n++) spawnMeteor();
  state.eliteTimer = Math.min(state.eliteTimer, 28 + Math.random() * 14);
  updateVisibility();
}

function createMeteorMesh() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    material(0xffd56d, 0.12, { emissive: 0xffb43c, emissiveIntensity: 0.9, metalness: 0.2 }),
  );
  core.scale.set(1, 0.85, 0.8);
  g.add(core);
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), material(0xfff3c4, 0.1, { emissive: 0xffe08a, emissiveIntensity: 0.7 }));
  shard.position.set(0.22, 0.2, 0.1);
  g.add(shard);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: softGlowTexture, color: 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
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

function spawnEpic() {
  if (enemies.some((e) => e.userData.alive && e.userData.epic)) return null;
  const size = 2.5 + state.tier * 0.35;
  const e = makeNPC({ size, alpha: true, diet: "meat", color: 0x9a3b73, nucleusColor: 0x40163a, x: 0, y: 0 });
  const u = e.userData;
  u.epic = true;
  u.alpha = false;
  u.elite = true;
  u.health = u.maxHealth = 60;
  u.hitCooldown = 0;
  const heading = Math.random() < 0.5 ? 0 : Math.PI;
  const speed = 1.1 + Math.random() * 0.5;
  u.velocity.set(Math.cos(heading) * speed, Math.sin(heading) * speed * 0.15);
  e.rotation.z = Math.atan2(u.velocity.y, u.velocity.x);
  e.position.set(player.position.x - Math.cos(heading) * cameraZoom * 1.1, player.position.y + (Math.random() - 0.5) * cameraZoom * 0.6, 0.2);
  epics.push(e);
  spawnFloatLabel(player.position.x, player.position.y + 1.4, "SOMETHING HUGE IS COMING", 0xff9aa9);
  const generation = state.worldGeneration;
  setTimeout(() => {
    if (generation !== state.worldGeneration || !u.alive) return;
    u.alive = false;
    disposeTree(e);
    enemies = enemies.filter((o) => o !== e);
    epics.splice(epics.indexOf(e), 1);
  }, WORLD_TUNING.epicLifetime * 1000);
  return e;
}

/** Reward for a meteor fragment or an elite kill: unlock one new part. Returns its definition or null. */
function meteorUnlock() {
  const locked = defs.filter((d) => !unlocked.has(d.id));
  if (!locked.length) {
    state.dna += 3;
    spawnFloatLabel(player.position.x, player.position.y + 0.8, "+3 DNA", 0xffe7a2);
    return null;
  }
  const affordable = locked.filter((d) => d.unlock <= 5 + (state.tier - 1) * 4);
  const pool = affordable.length ? affordable : locked;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  unlocked.add(pick.id);
  playSfx("unlock");
  toast("New part discovered: " + pick.name);
  renderCatalog();
  return pick;
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
function updateGame(dt, time) {
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
  cameraZoom += (cameraZoomTarget - cameraZoom) * (1 - Math.exp(-dt * 2.25));
  const s = stats(),
    keyForward = (input.ArrowUp || input.w ? 1 : 0) - (input.ArrowDown || input.s ? 1 : 0),
    keyTurn = (input.ArrowRight || input.d ? 1 : 0) - (input.ArrowLeft || input.a ? 1 : 0),
    joy = state.joystick || { x: 0, y: 0 },
    forward = THREE.MathUtils.clamp(keyForward + joy.y + (pointerThrust ? 0.75 : 0), -1, 1),
    turn = THREE.MathUtils.clamp(keyTurn + joy.x, -1, 1);
  if (forward !== 0 || turn !== 0) dismissControlHint();
  if (keyForward !== 0 || keyTurn !== 0 || Math.abs(joy.x) + Math.abs(joy.y) > 0.05) state.mouseActive = false;
  let desiredTurn = turn * s.turn * 0.9;
  if (state.mouseActive) {
    const delta = THREE.MathUtils.euclideanModulo(targetAngle() - angle + Math.PI, Math.PI * 2) - Math.PI;
    desiredTurn = THREE.MathUtils.clamp(delta * 2.35, -s.turn * 1.35, s.turn * 1.35);
    turnVelocity += (desiredTurn - turnVelocity) * (1 - Math.exp(-dt * 5.2));
  } else {
    turnVelocity += (desiredTurn - turnVelocity) * (1 - Math.exp(-dt * (turn !== 0 ? 5.8 : 1.35)));
  }
  angle += turnVelocity * dt;
  const bodyLength = Math.abs(nodes[nodes.length - 1].x - nodes[0].x),
    bodyMass = 1 + nodes.reduce((sum, n) => sum + n.r * n.r, 0) * 0.11 + bodyLength * 0.1 + parts.length * 0.025,
    thrust = (s.speed * 1.72) / bodyMass;
  velocity.x += Math.cos(angle) * forward * thrust * dt;
  velocity.y += Math.sin(angle) * forward * thrust * dt;
  state.stamina = Math.min(100, state.stamina + dt * 9);
  if (input[" "] && state.jetCooldown <= 0 && state.stamina >= 35 && parts.some((p) => p.id === "jet")) {
    velocity.x += Math.cos(angle) * 6;
    velocity.y += Math.sin(angle) * 6;
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
  player.position.x += velocity.x * dt;
  player.position.y += velocity.y * dt;
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
  const bx = 24 * worldSize,
    by = 15 * worldSize;
  if (player.position.x > bx) {
    player.position.x = bx;
    velocity.x = -Math.abs(velocity.x) * 0.22;
  } else if (player.position.x < -bx) {
    player.position.x = -bx;
    velocity.x = Math.abs(velocity.x) * 0.22;
  }
  if (player.position.y > by) {
    player.position.y = by;
    velocity.y = -Math.abs(velocity.y) * 0.22;
  } else if (player.position.y < -by) {
    player.position.y = -by;
    velocity.y = Math.abs(velocity.y) * 0.22;
  }
  const poisonParts = parts.filter((p) => p.id === "poison");
  if (poisonParts.length && Math.random() < dt * 3) {
    const g = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 7),
      new THREE.MeshBasicMaterial({ color: 0x8cf67a, transparent: true, opacity: 0.65 }),
    );
    g.position.set(player.position.x - Math.cos(angle) * 0.8, player.position.y - Math.sin(angle) * 0.8, 0.3);
    g.userData.life = 2;
    hazardGroup.add(g);
    particles.push(g);
  }
  particles.forEach((p) => {
    p.userData.life -= dt;
    p.material.opacity = Math.max(0, (p.userData.life / 2) * 0.6);
    enemies.forEach((e) => {
      if (e.userData.alive && e.position.distanceTo(p.position) < 0.5) damageNPC(e, dt * 2);
    });
    if (p.userData.life <= 0) {
      hazardGroup.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    }
  });
  particles = particles.filter((p) => p.userData.life > 0);
  state.damageCooldown = Math.max(0, state.damageCooldown - dt);
  state.electricCooldown = Math.max(0, state.electricCooldown - dt);
  if (parts.some((p) => p.id === "electric") && state.electricCooldown <= 0) {
    const near = enemies.find((e) => e.userData.alive && !e.userData.mate && distance2D(e.position, player.position) < 2.1 * state.scale);
    if (near) {
      const pulse = new THREE.Mesh(
        new THREE.TorusGeometry(2.15, 0.05, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x91a9ff, transparent: true, opacity: 0.8 }),
      );
      pulse.position.set(player.position.x, player.position.y, 0.8);
      scene.add(pulse);
      setTimeout(() => {
        scene.remove(pulse);
        pulse.geometry.dispose();
        pulse.material.dispose();
      }, 300);
      enemies.forEach((e) => {
        if (e.userData.alive && distance2D(e.position, player.position) < 2.4) damageNPC(e, 5, true);
      });
      state.electricCooldown = 3.2;
    }
  }
  const attachedSpikes = parts.filter((p) => p.id === "spike");
  if (attachedSpikes.length)
    enemies.forEach((e) => {
      if (!e.userData.alive || e.userData.mate) return;
      const touch = attachedSpikes.some(
        (p) => localNodeWorld(p).distanceTo(new THREE.Vector2(e.position.x, e.position.y)) < 0.72 * state.scale * (p.scale || 1),
      );
      if (touch) {
        e.userData.attackCooldown -= dt;
        if (e.userData.attackCooldown <= 0) {
          damageNPC(e, 2);
          e.userData.attackCooldown = 0.45;
        }
      }
    });
  updateFood(dt, time);
  updateAI(dt, time);
  updateHazards(dt, time);
  state.visibilityTimer = (state.visibilityTimer || 0) - dt;
  if (state.visibilityTimer <= 0) {
    updateVisibility();
    state.visibilityTimer = 0.35;
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
    const alpha = makeNPC({ size: 1.15 + (state.tier - 1) * 0.12, alpha: true, diet: "meat" });
    spawnBurst(alpha.position.x, alpha.position.y, 0xff5a81, 18);
    state.eliteTimer = 38 + Math.random() * 20;
  }
  state.epicTimer -= dt;
  if (state.epicTimer <= 0) {
    spawnEpic();
    state.epicTimer = 95 + Math.random() * 45;
  }
  updateCamera();
  camera.position.x += (player.position.x - camera.position.x) * Math.min(1, dt * 2.5);
  camera.position.y += (player.position.y - camera.position.y) * Math.min(1, dt * 2.5);
  if (state.shake > 0) {
    camera.position.x += Math.sin(time * 53) * state.shake * 0.6;
    camera.position.y += Math.cos(time * 47) * state.shake * 0.45;
  }
  camera.lookAt(camera.position.x, camera.position.y, 0);
  if (state.mateSignal && state.mate) $("#mateCueText").textContent = "♥ " + Math.ceil(state.mateTimer) + "s";
  if (state.food >= state.foodGoal && !state.mateSignal) $("#growthBar").classList.add("growthReady");
  state.radarTimer = (state.radarTimer || 0) - dt;
  if (state.radarTimer <= 0) {
    updateRadar();
    state.radarTimer = 0.25;
  }
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
    document.body.classList.remove("show-genome");
    if (isTouchUI()) toggleMobilePanel("parts");
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
    if (editorEntrySnapshot) restoreEditState(editorEntrySnapshot);
    setEditor(false);
    toast("Cell edits cancelled");
  };
  const acceptCellEdit = () => {
    state.cellName = ($("#cellName").value || "Karlets").trim().slice(0, 22);
    saveGame();
    setEditor(false);
    toast("Cell edits accepted");
  };
  $("#editorSoupButton").onclick = cancelCellEdit;
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
    state.mate = null;
    state.paused = false;
    state.joystick = { x: 0, y: 0 };
    state.pointerScreen = null;
    pointerThrust = false;
    state.foodSinceMate = 0;
    state.dietHintAt = 0;
    state.cellName = "Karlets";
    state.baseColor = baseColors[0];
    state.patternColor = patternColors[0];
    state.accentColor = accentColors[0];
    state.pattern = "speckle";
    state.symmetry = true;
    state.stack = false;
    state.dna = 25;
    state.tier = 1;
    state.food = 0;
    state.foodGoal = 8;
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
    angle = 0;
    unlocked.clear();
    let cfg =
      diet === "plant"
        ? [
            { id: "filter", x: 1.13, y: 0 },
            { id: "cilia", x: -0.6, y: 0.68, pair: 101 },
            { id: "cilia", x: -0.6, y: -0.68, pair: 101 },
            { id: "eye", x: 0.38, y: 0.88, pair: 102 },
            { id: "eye", x: 0.38, y: -0.88, pair: 102 },
          ]
        : diet === "meat"
          ? [
              { id: "jaw", x: 1.13, y: 0 },
              { id: "flagellum", x: -1.2, y: 0 },
              { id: "eye", x: 0.38, y: 0.88, pair: 102 },
              { id: "eye", x: 0.38, y: -0.88, pair: 102 },
            ]
          : [
              { id: "proboscis", x: 1.13, y: 0 },
              { id: "cilia", x: -0.6, y: 0.68, pair: 101 },
              { id: "cilia", x: -0.6, y: -0.68, pair: 101 },
              { id: "eye", x: 0.38, y: 0.88, pair: 102 },
              { id: "eye", x: 0.38, y: -0.88, pair: 102 },
            ];
    const ids = [...new Set(cfg.map((p) => p.id))];
    ids.forEach((id) => unlocked.add(id));
    parts = cfg.map((o) => ({
      id: o.id,
      def: defs.find((d) => d.id === o.id),
      x: o.x,
      y: o.y,
      rotation: 0,
      scale: 1,
      costPaid: 0,
      source: o.pair ? "mirror" : "starter",
      pairId: o.pair || null,
    }));
    state.selected = cfg[0].id;
    state.category = "Mouths";
    spawnWorld();
    spawnMeteor();
    renderCatalog();
    rebuildPlayer();
    updateHUD();
    $("#intro").style.display = "none";
    state.runStarted = true;
    saveGame(true);
    toast("Egg hatched · " + (diet === "plant" ? "herbivore" : diet === "meat" ? "carnivore" : "omnivore") + " cell ready");
    showControlHint(
      isTouchUI()
        ? "JOYSTICK to swim and turn · EAT compatible food · TAP MATE when the growth bar fills."
        : "WASD/arrows or click-hold water to swim · steer with mouse · eat compatible food, then call a mate.",
    );
    if (openEditor) setEditor(true);
  }
  function selectEgg(diet) {
    state.pendingDiet = diet;
    [
      ["eggPlant", "plant"],
      ["eggCarn", "meat"],
      ["eggOmni", "omni"],
    ].forEach(([id, d]) => $("#" + id).classList.toggle("selectedEgg", d === diet));
    const names = { plant: "Herbivore", meat: "Carnivore", omni: "Omnivore" };
    $("#begin").textContent = "Hatch " + names[diet] + " egg";
  }
  $("#eggPlant").onclick = () => {
    selectEgg("plant");
    playSfx("click");
  };
  $("#eggCarn").onclick = () => {
    selectEgg("meat");
    playSfx("click");
  };
  $("#eggOmni").onclick = () => {
    selectEgg("omni");
    playSfx("click");
  };
  let hatchTimer = null,
    hatchEditor = false;
  const startHatch = (diet, openEditor = false) => {
    hatchEditor = openEditor;
    state.pendingDiet = diet;
    $("#intro").style.display = "none";
    const sceneCard = $("#hatchCinematic");
    sceneCard.dataset.diet = diet;
    $("#hatchEgg").dataset.diet = diet;
    $("#hatchTitle").textContent = diet === "plant" ? "HERBIVORE AWAKENS" : diet === "meat" ? "CARNIVORE AWAKENS" : "OMNIVORE AWAKENS";
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
  $("#begin").onclick = () => startHatch(state.pendingDiet || "plant");
  $("#introEditor").onclick = () => startHatch(state.pendingDiet || "plant", true);
  selectEgg("plant");
  $("#pauseBtn").onclick = pauseGame;
  $("#touchPause").onclick = pauseGame;
  $("#touchMate").onclick = callMate;
  const stick = $("#moveStick"),
    knob = $("#moveStickKnob");
  let stickPointer = null;
  const updateStick = (e) => {
    const r = stick.getBoundingClientRect(),
      dx = e.clientX - (r.left + r.width / 2),
      dy = e.clientY - (r.top + r.height / 2),
      max = r.width * 0.31,
      mag = Math.hypot(dx, dy) || 1,
      f = Math.min(1, max / mag),
      sx = dx * f,
      sy = dy * f;
    state.joystick.x = THREE.MathUtils.clamp(sx / max, -1, 1);
    state.joystick.y = THREE.MathUtils.clamp(-sy / max, -1, 1);
    knob.style.left = "calc(50% + " + sx + "px)";
    knob.style.top = "calc(50% + " + sy + "px)";
    state.mouseActive = false;
    dismissControlHint();
  };
  const resetStick = () => {
    stickPointer = null;
    state.joystick.x = 0;
    state.joystick.y = 0;
    knob.style.left = "50%";
    knob.style.top = "50%";
  };
  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stickPointer = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    updateStick(e);
  });
  stick.addEventListener("pointermove", (e) => {
    if (stickPointer === e.pointerId) updateStick(e);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => stick.addEventListener(ev, resetStick));
  const boostButton = $("#touchBoost");
  boostButton.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    input[" "] = true;
    dismissControlHint();
    boostButton.setPointerCapture?.(e.pointerId);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => boostButton.addEventListener(ev, () => (input[" "] = false)));
  $("#guideButton").onclick = () =>
    showDialog(
      "FIELD GUIDE",
      "YOUR GOAL\nEat compatible food until the evolution bar is full. Collect meteor fragments to unlock parts and earn DNA.\n\nMOVEMENT\nWASD / arrows to swim. The mouse steers your cell on desktop. On touch screens, use the on-screen joystick: push up to swim, sideways to turn. Tap Boost if you have a Jet. Space / BOOST uses a Jet part and stamina.\n\nSURVIVAL\nSmall carnivores may hunt you. Avoid poison clouds, follow current rings carefully, and use spikes or electric organs to fight back.\n\nEVOLUTION\nPress M or tap MATE when the bar fills. Find the pink heart, swim into your mate, then edit your cell.",
      [
        { label: "Got it", primary: true, action: () => {} },
        { label: "Open cell editor", action: () => setEditor(true) },
      ],
    );
  const zoomBy = (delta) => {
    cameraZoomTarget = THREE.MathUtils.clamp(cameraZoomTarget + delta, 7, 12 + stats().sight * 1.7);
    playSfx("click");
  };
  $("#zoomInBtn").onclick = () => zoomBy(-1);
  $("#zoomOutBtn").onclick = () => zoomBy(1);
  const refreshQualityButton = () => {
    const q = getQuality();
    $("#qualityToggle").textContent = q === "low" ? "▢" : q === "medium" ? "◫" : "▣";
    $("#qualityToggle").title = "Graphics quality: " + q + " (click to change)";
  };
  $("#qualityToggle").onclick = () => {
    const order = Object.keys(QUALITY_PRESETS);
    applyQuality(order[(order.indexOf(getQuality()) + 1) % order.length]);
    refreshQualityButton();
    toast("Graphics quality: " + getQuality());
  };
  refreshQualityButton();
  $("#soundToggle").onclick = () => {
    soundEnabled = !soundEnabled;
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
  $("#openEditorBtn").onclick = () => setEditor(true);
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
    const n = nodes[nodes.length - 1],
      prev = nodes[nodes.length - 2];
    nodes.push({ x: n.x + Math.max(0.25, n.x - prev.x), y: n.y + (n.y - prev.y), r: n.r });
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
    nodes.splice(state.selectedNode, 1);
    state.selectedNode = Math.min(state.selectedNode, nodes.length - 1);
    rebuildPlayer();
    toast("Vertebra removed.");
  };
  $("#radiusSlider").oninput = (e) => {
    if (nodes[state.selectedNode]) nodes[state.selectedNode].r = +e.target.value;
    rebuildPlayer();
  };
  $("#lengthSlider").oninput = (e) => {
    const want = +e.target.value / 100;
    const mid = (nodes[0].x + nodes[nodes.length - 1].x) / 2;
    const half = (nodes[nodes.length - 1].x - nodes[0].x) / 2;
    const f = want / (Math.abs(half) / 1.415 || 1);
    nodes.forEach((n) => (n.x = mid + (n.x - mid) * f));
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
  if (resumeExists) {
    const rb = document.createElement("button");
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
    if (k === "Tab") {
      e.preventDefault();
      setEditor(!state.editor);
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
  };
  try {
    localStorage.setItem("johnny-spore-cell-stage", JSON.stringify(data));
    storeCellRecord(localStorage, currentRecord());
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
    worldSize = Math.pow(1.4, state.tier - 1);
    cameraZoom = 9 * Math.pow(1.36, state.tier - 1);
    cameraZoomTarget = cameraZoom;
    unlocked.clear();
    (d.unlocked || ["filter", "cilia", "eye"]).forEach((id) => unlocked.add(id));
    if (d.nodes && d.nodes.length >= 2) nodes = d.nodes;
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
if (new URLSearchParams(location.search).has("debug")) {
  window.__spore = { state, renderer, scene, camera, player, setEditor, rebuildPlayer, callMate, finishMate, get enemies() { return enemies; }, get playerBody() { return playerBody; }, get parts() { return parts; }, get nodes() { return nodes; } };
}
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.04, Math.max(0.001, (t - lastTime) / 1000));
  lastTime = t;
  gameTime += dt;
  timeUniform.value = gameTime;
  if (
    !state.paused &&
    !state.editor &&
    $("#intro").style.display === "none" &&
    $("#hatchCinematic").style.display !== "flex" &&
    $("#dialogOverlay").style.display !== "flex"
  ) {
    updateGame(dt, gameTime);
  } else {
    if (state.editor) {
      player.rotation.z = Math.PI;
      handleGroup.visible = true;
      playerBody?.rig.update(dt, gameTime, { speed: 0 });
    } else handleGroup.visible = false;
  }
  background.update(gameTime, dt, camera);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
function applyQuality(name) {
  setQuality(name);
  try {
    localStorage.setItem(QUALITY_KEY, getQuality());
  } catch (e) {}
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY_PRESETS[getQuality()].pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  background.setQuality(getQuality());
  spawnWorld();
  rebuildPlayer();
}
window.addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY_PRESETS[getQuality()].pixelRatio));
  if (state.editor) configureEditorViewport();
  else updateCamera();
});
