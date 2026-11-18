/**
 * Tribal Stage.
 *
 * Your creatures have settled: a hut, a fire and a food pile on the beach where you first crawled
 * ashore. You no longer steer one creature; you direct the tribe from above. Gather, fish and hunt,
 * raise babies, place and upgrade tool shacks (weapons, instruments, staffs), grow the chief's hut,
 * and deal with five rival tribes, each with its own temper: Traders, Musicians, Hunters, Defenders
 * and Warriors. Play for them, send gifts, trade, make peace, recruit from allies, raid their food,
 * or bring their huts down. The rivals live their own lives meanwhile: they grow, hunt, get hungry,
 * raid you and each other.
 *
 * Controls are the same on a phone and a desktop: drag to move the camera, pinch or scroll to zoom,
 * tap a member to select it (or use All), then tap where it should go or what it should do.
 */
import * as THREE from "three";
import { buildCreatureBody } from "../creature/body3d.js";
import { createEmotes } from "../creature/emotes.js";
import { validateCreature } from "../creature/format.js";
import { dietOfParts } from "../creature/parts.js";
import { RELATION_INFO } from "../creature/relations.js";
import { generateSpecies } from "../creature/species.js";
import { ISLAND, createIsland, heightAt } from "../creature/world.js";
import {
  HUT_LEVELS,
  HUT_STYLES,
  PEACE_RELATION,
  RAID_TAKE,
  RECRUIT_COST,
  RIVALS,
  RIVAL_ORDER,
  ROLES,
  STRUCTURES,
  STRUCTURE_IDS,
  spiritHeal,
  structureCost,
  TIER_NAMES,
  TRIBE_COLORS,
  UPKEEP_EVERY,
  canMakePeace,
  canPlace,
  canRecruit,
  cleanName,
  giftAnswer,
  hutLevel,
  musicAnswer,
  peaceCost,
  rivalRaidTarget,
  stepRival,
  tierMult,
  tradeOffers,
  upgradeCost,
  upkeep,
  victoryPath,
  villageRoom,
} from "./campaign.js";
import {
  ASK_TIME,
  BABY_COST,
  CARRY,
  DAMAGE,
  GIFT,
  HUT_DAMAGE,
  INSTRUMENTS,
  SOCIAL_MISS,
  START_FOOD,
  TOOLS,
  TOOL_IDS,
  TRIBE_SAVE_KEY,
  canGather,
  clampRelation,
  nextAsk,
  readTribeSave,
  relationFace,
} from "./rules.js";

const TAU = Math.PI * 2;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Read the saved tribe game for the current slot, if there is one. */
export function loadTribeSave() {
  try {
    return readTribeSave(localStorage.getItem(TRIBE_SAVE_KEY));
  } catch (e) {
    return null;
  }
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.record            your creature (creature record v1)
 * @param {object|null} [o.save]       from loadTribeSave()
 * @param {string} o.quality
 * @param {(kind:string, opts?:object) => void} o.sfx
 * @param {() => void} o.onExit        back to the creature stage
 * @param {() => void} [o.onSettings]
 * @param {() => void} [o.onSaved]
 * @param {(record:object) => string|null} [o.portrait]
 * @param {string} [o.regionId]        the species' home region (a saved tribe keeps its own)
 * @param {object} [o.legacy]          from lineage.tribeLegacy(): what earlier stages hand the tribe
 * @param {(ev:object) => void} [o.onChronicle]  a moment for the species' chronicle
 * @param {() => void} [o.onHistory]   open the species history screen
 */
export function createTribeStage(o) {
  const canvas = o.renderer.domElement;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
  const save = o.save || null;
  const regionId = save?.region || o.regionId || "coast";
  const world = createIsland(scene, o.quality, regionId);
  const legacy = o.legacy || { damage: 1, gift: 1, music: 1, carry: 0, startTool: null, relation: 0, hutLevel: 1, lines: [] };
  const chronicle = (ev) => o.onChronicle?.(ev);
  scene.fog.near = 110;
  scene.fog.far = 320;
  const emotes = createEmotes(scene);
  const record = validateCreature(o.record);
  const diet = dietOfParts(record.parts.map((p) => p.id));
  const HOME = { x: ISLAND.nest.x, z: ISLAND.nest.z };

  const look = { name: cleanName(save?.look?.name, record.name), color: save?.look?.color ?? 0x3fa9d6, style: save?.look?.style || "cone" };
  const T = {
    food: save ? save.food : START_FOOD,
    // Tier of each tool's shack: 0 not built, 1 stone, 2 bronze.
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, save?.tools[id] || 0])),
    hutLevel: save?.hutLevel || legacy.hutLevel || 1,
    hutHp: save?.hutHp ?? 1, // 0..1 of the hut's strength
    path: save?.path || null,
    upkeepClock: UPKEEP_EVERY,
    rivalRaidClock: 200,
    placing: null, // the tool (or "s:" + structure) being placed
    structures: (save?.structures || []).map((st) => ({ ...st })),
    boxMode: false,
    units: [], // every creature in the world, yours and theirs
    tribes: [],
    selected: new Set(),
    eggs: [],
    time: 0,
    won: !!save?.won,
    time0: save?.time || 0,
    animals: [],
    carcasses: [],
    spears: [],
    chiefRespawn: 0,
  };
  let paused = false,
    nextId = 1;

  /* ---- village buildings ----------------------------------------------------------------- */
  const disposables = [];
  const mat = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });
    disposables.push(m);
    return m;
  };
  const geo = (g) => {
    disposables.push(g);
    return g;
  };
  const wallGeo = geo(new THREE.CylinderGeometry(2.3, 2.6, 2.4, 10)),
    roofGeo = geo(new THREE.ConeGeometry(3.4, 2.8, 10)),
    doorGeo = geo(new THREE.BoxGeometry(0.2, 1.5, 1.1)),
    poleGeo = geo(new THREE.CylinderGeometry(0.07, 0.07, 3, 6)),
    flagGeo = geo(new THREE.PlaneGeometry(1.3, 0.8)),
    stoneGeo = geo(new THREE.DodecahedronGeometry(0.32, 0)),
    flameGeo = geo(new THREE.ConeGeometry(0.42, 1.2, 7)),
    logGeo = geo(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 6).rotateZ(Math.PI / 2)),
    foodGeo = geo(new THREE.SphereGeometry(0.34, 8, 6)),
    eggGeo = geo(new THREE.SphereGeometry(0.42, 12, 10).scale(1, 1.3, 1)),
    shackPostGeo = geo(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 6)),
    shackRoofGeo = geo(new THREE.BoxGeometry(2.6, 0.16, 2)),
    ringGeo = geo(new THREE.RingGeometry(0.9, 1.12, 28).rotateX(-Math.PI / 2)),
    rippleGeo = geo(new THREE.RingGeometry(1.5, 1.9, 32).rotateX(-Math.PI / 2)),
    fishGeo = geo(new THREE.SphereGeometry(0.22, 8, 6).scale(1.8, 0.8, 0.5));
  const wallMat = mat(0xc9a878),
    doorMat = mat(0x3a2a1c),
    poleMat = mat(0x6b4a2c),
    stoneMat = mat(0x8a8f96),
    logMat = mat(0x5a3d24),
    eggMat = mat(0xfff1d0, { flatShading: false, roughness: 0.4 }),
    fishMat = mat(0xb9d8e8, { flatShading: false, roughness: 0.3 }),
    ruinMat = mat(0x3b3430);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9 });
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const selMat = new THREE.MeshBasicMaterial({ color: 0x8ff0a8, transparent: true, opacity: 0.9, depthWrite: false });
  const goMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false });
  disposables.push(flameMat, rippleMat, selMat, goMat);
  const foodMats = [mat(0xff5a7a, { flatShading: false }), mat(0xf2b75a, { flatShading: false }), mat(0xc76a4a, { flatShading: false })];

  const domeGeo = geo(new THREE.SphereGeometry(3, 12, 8, 0, TAU, 0, Math.PI / 2)),
    longWallGeo = geo(new THREE.BoxGeometry(6.4, 2.3, 3.8)),
    longRoofGeo = geo(new THREE.CylinderGeometry(2.5, 2.5, 6.8, 3, 1).rotateZ(Math.PI / 2)),
    stakeGeo = geo(new THREE.ConeGeometry(0.16, 2.6, 5).translate(0, 1.3, 0)),
    tierFlagGeo = geo(new THREE.PlaneGeometry(0.6, 0.4));
  const bronzeMat = mat(0xc98a3a, { flatShading: false, roughness: 0.35, metalness: 0.5 });
  /** A hut in one of three styles, with a coloured roof and flag. Returns handles for the parts that change. */
  function makeHut(x, z, color, style = "cone") {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    const roofMat = mat(color);
    let wall, roof, doorX = 2.45;
    if (style === "long") {
      wall = new THREE.Mesh(longWallGeo, wallMat);
      wall.position.y = 1.15;
      roof = new THREE.Mesh(longRoofGeo, roofMat);
      roof.position.y = 2.9;
      roof.scale.set(1, 0.75, 1);
      roof.rotation.x = Math.PI / 6;
      doorX = 3.25;
    } else {
      wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.y = 1.2;
      roof = new THREE.Mesh(style === "dome" ? domeGeo : roofGeo, roofMat);
      roof.position.y = style === "dome" ? 2.2 : 3.7;
    }
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(doorX, 0.75, 0);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, style === "cone" ? 6.2 : 5.2, 0);
    const flagMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    disposables.push(flagMat);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.7, pole.position.y + 0.9, 0);
    g.add(wall, roof, door, pole, flag);
    g.scale.setScalar(0.8);
    // The door faces the middle of the island's shore side, i.e. away from the hill behind.
    g.rotation.y = Math.atan2(-(HOME.z - z), HOME.x - x) || 0;
    scene.add(g);
    return { group: g, roof, flag, flagMat, roofMat };
  }
  /** A ring of sharpened stakes around a village (the Defenders'). */
  function makePalisade(x, z, r) {
    const g = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      if (Math.abs(Math.atan2(Math.sin(a - Math.atan2(HOME.z - z, HOME.x - x)), Math.cos(a - Math.atan2(HOME.z - z, HOME.x - x)))) < 0.35) continue; // a gate toward you
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      const s = new THREE.Mesh(stakeGeo, poleMat);
      s.position.set(px, heightAt(px, pz) - 0.2, pz);
      s.rotation.set((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15);
      g.add(s);
    }
    scene.add(g);
    return g;
  }
  /** A ring of stones with a flickering fire. */
  function makeFire(x, z) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(stoneGeo, stoneMat);
      s.position.set(Math.cos((i / 7) * TAU) * 0.85, 0.12, Math.sin((i / 7) * TAU) * 0.85);
      g.add(s);
    }
    const l1 = new THREE.Mesh(logGeo, logMat),
      l2 = new THREE.Mesh(logGeo, logMat);
    l1.position.y = l2.position.y = 0.16;
    l2.rotation.y = Math.PI / 2;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.75;
    g.add(l1, l2, flame);
    scene.add(g);
    return { group: g, flame };
  }

  let myHut = makeHut(HOME.x, HOME.z, look.color, look.style);
  /** The chief's hut grows with its level: bigger, with stone around the base from level 2. */
  const hutStones = [];
  function styleMyHut() {
    myHut.group.scale.setScalar(0.8 * (1 + (T.hutLevel - 1) * 0.14));
    hutStones.forEach((m) => scene.remove(m));
    hutStones.length = 0;
    if (T.hutLevel >= 2)
      for (let i = 0; i < (T.hutLevel >= 3 ? 16 : 9); i++) {
        const a = (i / (T.hutLevel >= 3 ? 16 : 9)) * TAU,
          r = 3.4 + T.hutLevel * 0.3;
        const m = new THREE.Mesh(stoneGeo, stoneMat);
        m.position.set(HOME.x + Math.cos(a) * r, heightAt(HOME.x + Math.cos(a) * r, HOME.z + Math.sin(a) * r) + 0.15, HOME.z + Math.sin(a) * r);
        m.scale.setScalar(1.3);
        scene.add(m);
        hutStones.push(m);
      }
    // A battered hut leans and darkens until it's repaired.
    myHut.group.rotation.z = T.hutHp < 0.5 ? 0.08 : 0;
    myHut.roofMat.color.set(look.color).multiplyScalar(T.hutHp < 0.5 ? 0.55 : 1);
  }
  function rebuildMyHut() {
    scene.remove(myHut.group);
    myHut = makeHut(HOME.x, HOME.z, look.color, look.style);
    styleMyHut();
  }
  styleMyHut();
  const FIRE = { x: HOME.x + 6.5, z: HOME.z - 1.5 };
  const PILE = { x: HOME.x + 3.5, z: HOME.z + 5.5 };
  /* Tool shacks go wherever you place them. Shacks from older saves (which had fixed places) stand in
     their old arc behind the hut. Each has its own strength, and raiders can knock it about. */
  // Older saves placed shacks by their order in this list, so it never changes (clubs came later).
  const ARC_ORDER = ["axe", "spear", "torch", "horn", "maracas", "didgeridoo", "staff", "healer", "club"];
  function arcSpot(id) {
    const a = ((110 + ARC_ORDER.indexOf(id) * 31) * Math.PI) / 180;
    let r = 10.5;
    // Keep them on dry ground: step in toward the hut if the spot is wet.
    while (r > 6 && heightAt(HOME.x + Math.cos(a) * r, HOME.z + Math.sin(a) * r) < 0.25) r -= 0.5;
    return { x: HOME.x + Math.cos(a) * r, z: HOME.z + Math.sin(a) * r };
  }
  const SHACK = {};
  TOOL_IDS.forEach((id) => {
    if (!T.tools[id]) return;
    const at = save?.shacks?.[id] || arcSpot(id);
    SHACK[id] = { x: at.x, z: at.z, hp: at.hp ?? 1 };
  });
  const KIND_ROOF = { fight: 0xb5523a, music: 0xd9a441, village: 0x6aa84f };
  const fires = [makeFire(FIRE.x, FIRE.z)];

  // The food pile grows as the stock does.
  const pile = new THREE.Group();
  pile.position.set(PILE.x, heightAt(PILE.x, PILE.z), PILE.z);
  scene.add(pile);
  const pileSpots = [];
  for (let layer = 0, k = 0; layer < 3; layer++) {
    const n = [9, 5, 2][layer];
    for (let i = 0; i < n; i++, k++) {
      const a = (i / n) * TAU + layer,
        r = [1, 0.55, 0.2][layer];
      const m = new THREE.Mesh(foodGeo, foodMats[k % 3]);
      m.position.set(Math.cos(a) * r, 0.25 + layer * 0.42, Math.sin(a) * r);
      m.visible = false;
      pile.add(m);
      pileSpots.push(m);
    }
  }
  let pileShown = -1;
  function syncPile() {
    const n = Math.min(pileSpots.length, Math.ceil(T.food / 5));
    if (n === pileShown) return;
    pileShown = n;
    pileSpots.forEach((m, i) => (m.visible = i < n));
  }

  const shackMeshes = {};
  function buildShack(tool) {
    if (shackMeshes[tool]) {
      scene.remove(shackMeshes[tool]);
      delete shackMeshes[tool];
    }
    const at = SHACK[tool];
    const g = new THREE.Group();
    g.position.set(at.x, heightAt(at.x, at.z), at.z);
    for (const [px, pz] of [
      [-1.1, -0.8],
      [1.1, -0.8],
      [-1.1, 0.8],
      [1.1, 0.8],
    ]) {
      const p = new THREE.Mesh(shackPostGeo, poleMat);
      p.position.set(px, 0.9, pz);
      g.add(p);
    }
    const roof = new THREE.Mesh(shackRoofGeo, mat(KIND_ROOF[TOOLS[tool].kind]));
    roof.position.y = 1.85;
    roof.rotation.z = 0.12;
    g.add(roof);
    // A few of the tools leaning inside, so the shack reads at a glance.
    const tier = T.tools[tool];
    for (let i = 0; i < 3; i++) {
      const t = toolMesh(tool, tier);
      t.position.set(-0.7 + i * 0.7, 0.35, 0);
      t.rotation.z = 0.25;
      t.scale.setScalar(1.1);
      g.add(t);
    }
    // Bronze shacks fly a bronze pennant.
    if (tier >= 2) {
      const pole2 = new THREE.Mesh(shackPostGeo, poleMat);
      pole2.position.set(1.1, 2.3, 0);
      const pen = new THREE.Mesh(tierFlagGeo, bronzeMat);
      pen.position.set(1.42, 2.95, 0);
      g.add(pole2, pen);
    }
    // Shacks face the hut; a battered one sags.
    g.rotation.y = Math.atan2(-(HOME.z - at.z), HOME.x - at.x) + Math.PI / 2;
    g.rotation.x = at.hp < 0.5 ? 0.1 : 0;
    scene.add(g);
    shackMeshes[tool] = g;
  }
  /* Tool models: built standing up along +y with the grip at the origin. */
  const hornGeo = geo(new THREE.ConeGeometry(0.2, 0.75, 10, 1, true).translate(0, 0.38, 0)),
    haftGeo = geo(new THREE.CylinderGeometry(0.045, 0.05, 1, 6).translate(0, 0.4, 0)),
    clubHeadGeo = geo(new THREE.SphereGeometry(0.15, 8, 6)),
    longHaftGeo = geo(new THREE.CylinderGeometry(0.04, 0.045, 1.7, 6).translate(0, 0.6, 0)),
    bladeGeo = geo(new THREE.BoxGeometry(0.36, 0.3, 0.07)),
    tipGeo = geo(new THREE.ConeGeometry(0.08, 0.32, 6)),
    torchHeadGeo = geo(new THREE.CylinderGeometry(0.11, 0.07, 0.22, 7)),
    torchFlameGeo = geo(new THREE.ConeGeometry(0.15, 0.42, 7)),
    shakerGeo = geo(new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.2, 1)),
    stickGeo = geo(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 5).translate(0, 0.16, 0)),
    didgeGeo = geo(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 9, 1, true).translate(0, 0.5, 0)),
    bandGeo = geo(new THREE.TorusGeometry(0.085, 0.022, 6, 12).rotateX(Math.PI / 2)),
    crookGeo = geo(new THREE.TorusGeometry(0.16, 0.035, 6, 12, Math.PI * 1.3)),
    orbGeo = geo(new THREE.SphereGeometry(0.13, 12, 10));
  const hornMat = mat(0xf2e3c0, { side: THREE.DoubleSide, flatShading: false }),
    stoneBladeMat = mat(0x9aa3ab),
    shakerMat = mat(0xd96b3a, { flatShading: false }),
    didgeMat = mat(0x8a5a2e, { side: THREE.DoubleSide }),
    bandMat = mat(0xf2d27a),
    healMat = new THREE.MeshStandardMaterial({ color: 0x8ff0a8, emissive: 0x3fc26e, emissiveIntensity: 0.9, roughness: 0.3 });
  disposables.push(healMat);
  /** The small model a member carries (and the shacks display). */
  function toolMesh(tool, tier = 1) {
    const g = new THREE.Group();
    const bladeMat = tier >= 2 ? bronzeMat : stoneBladeMat;
    const add = (geometry, material, x = 0, y = 0, z = 0, rz = 0) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      g.add(m);
      return m;
    };
    if (tool === "horn") add(hornGeo, hornMat, 0, 0.1, 0, -0.5);
    else if (tool === "club") {
      add(haftGeo, poleMat);
      const head = add(clubHeadGeo, tier >= 2 ? bronzeMat : logMat, 0, 0.92);
      head.scale.set(1, 1.3, 1);
    } else if (tool === "axe") {
      add(haftGeo, poleMat);
      add(bladeGeo, bladeMat, 0.16, 0.78);
    } else if (tool === "spear") {
      add(longHaftGeo, poleMat);
      add(tipGeo, bladeMat, 0, 1.6);
    } else if (tool === "torch") {
      add(haftGeo, poleMat);
      add(torchHeadGeo, logMat, 0, 0.92);
      add(torchFlameGeo, flameMat, 0, 1.2);
    } else if (tool === "maracas") {
      for (const x of [-0.12, 0.14]) {
        add(stickGeo, poleMat, x, 0, 0, x * 1.5);
        add(shakerGeo, shakerMat, x * 1.5, 0.4);
      }
    } else if (tool === "didgeridoo") {
      add(didgeGeo, didgeMat, 0, 0, 0, 0.15);
      for (const y of [0.2, 0.55, 0.9]) add(bandGeo, bandMat, -y * 0.15, y, 0, 0.15);
    } else if (tool === "staff") {
      add(longHaftGeo, poleMat);
      add(crookGeo, poleMat, 0.12, 1.45);
    } else if (tool === "healer") {
      add(longHaftGeo, poleMat);
      add(orbGeo, healMat, 0, 1.55);
    }
    return g;
  }
  // A Predator species starts with a shack of its favourite weapon.
  if (!save && legacy.startTool && TOOLS[legacy.startTool]) {
    T.tools[legacy.startTool] = 1;
    const at = arcSpot(legacy.startTool);
    SHACK[legacy.startTool] = { x: at.x, z: at.z, hp: 1 };
  }
  TOOL_IDS.forEach((id) => T.tools[id] && buildShack(id));

  /* Fishing spots: rings of ripples in the shallows nearest the village. */
  const fishSpots = [];
  {
    const base = Math.atan2(HOME.z, HOME.x);
    for (const off of [-0.16, -0.05, 0.07, 0.18]) {
      const a = base + off;
      // Walk outwards from the beach until the water is knee deep.
      let r = Math.hypot(HOME.x, HOME.z);
      while (r < ISLAND.shore + 30 && heightAt(Math.cos(a) * r, Math.sin(a) * r) > -0.55) r += 0.5;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      let rs = r;
      while (rs > 0 && heightAt(Math.cos(a) * rs, Math.sin(a) * rs) < -0.1) rs -= 0.5;
      const ripple = new THREE.Mesh(rippleGeo, rippleMat);
      ripple.position.set(x, 0.06, z);
      const fish = new THREE.Mesh(fishGeo, fishMat);
      fish.position.set(x, -0.3, z);
      scene.add(ripple, fish);
      fishSpots.push({ x, z, stand: { x: Math.cos(a) * rs, z: Math.sin(a) * rs }, ripple, fish, phase: off * 40 });
    }
  }

  /* ---- units ----------------------------------------------------------------------------------- */
  /**
   * @param {object|null} tribe  null for your own
   * @param {{ chief?:boolean, child?:boolean, tool?:string|null }} [opts]
   */
  function makeUnit(tribe, rec, x, z, opts = {}) {
    const body = buildCreatureBody(rec, { quality: "low", seed: nextId });
    const u = {
      id: nextId++,
      mine: !tribe,
      tribe,
      body,
      pos: new THREE.Vector3(x, heightAt(x, z), z),
      heading: Math.random() * TAU,
      speed: 0,
      chief: !!opts.chief,
      child: opts.child ? 22 : 0, // seconds until grown
      maxHealth: opts.chief ? 110 : 60,
      health: opts.chief ? 110 : 60,
      tool: null,
      toolModel: null,
      task: null,
      carry: 0,
      carryKind: null,
      cool: 0,
      work: 0,
      think: Math.random() * 3,
      wander: null,
      raid: false,
      hurtAt: -99,
      dead: false,
      ring: null,
      from: opts.from ?? -1, // a recruit: the tribe it came from
      role: opts.role || "free", // free · gather · guard
    };
    u.scale = u.chief ? 1.25 : u.child ? 0.55 : 1;
    body.root.scale.setScalar(u.scale);
    body.root.position.copy(u.pos);
    scene.add(body.root);
    if (opts.tool) setTool(u, opts.tool);
    T.units.push(u);
    return u;
  }
  function setTool(u, tool) {
    if (u.toolModel) u.toolModel.removeFromParent();
    u.tool = tool;
    u.toolModel = null;
    if (!tool) return;
    const m = toolMesh(tool, u.mine ? T.tools[tool] || 1 : 1);
    const hand = u.body.handAnchor();
    if (hand) {
      // Held in the hand, standing up out of the fist (the wrist's +x is "up" when the arm is raised).
      m.rotation.z = -Math.PI / 2;
      m.position.y = -0.12;
      m.scale.setScalar(0.85);
      hand.add(m);
    } else {
      // No arms: carried slung along the flank.
      m.position.set(u.body.length * 0.15, u.body.height * 0.72, u.body.radius + 0.2);
      m.rotation.set(0.25, 0, -0.9);
      m.scale.setScalar(0.8);
      u.body.root.add(m);
    }
    u.toolModel = m;
  }
  function removeUnit(u) {
    if (u.removed) return;
    u.removed = true;
    scene.remove(u.body.root);
    u.body.dispose();
    if (u.ring) scene.remove(u.ring);
    T.selected.delete(u);
    const i = T.units.indexOf(u);
    if (i >= 0) T.units.splice(i, 1);
  }
  const mine = () => T.units.filter((u) => u.mine && !u.dead);
  const around = (c, r0, r1) => {
    const a = Math.random() * TAU,
      r = r0 + Math.random() * (r1 - r0);
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
  };

  /* ---- the other tribes -------------------------------------------------------------------- */
  const RIVAL_HUT = { traders: "long", musicians: "dome", hunters: "cone", defenders: "long", warriors: "cone" };
  {
    // The five nest sites nearest your village (but not on top of it) become villages: the friendlier
    // rivals closest, the warriors furthest away.
    const sites = world.nestSites
      .map((s) => ({ ...s, d: Math.hypot(s.x - HOME.x, s.z - HOME.z) }))
      .filter((s) => s.d > 50)
      .sort((a, b) => a.d - b.d)
      .slice(0, RIVAL_ORDER.length);
    sites.forEach((site, i) => {
      const kind = RIVAL_ORDER[i];
      const rival = RIVALS[kind];
      const sp = generateSpecies(90210 + i * 7919, rival.diet, 1);
      const saved = save?.tribes[i];
      const tribe = {
        index: i,
        kind,
        rival,
        name: sp.name,
        species: sp,
        mood: rival.mood,
        color: rival.color,
        center: { x: site.x, z: site.z },
        relation: saved ? saved.relation : clampRelation(rival.start + legacy.relation),
        status: saved ? saved.status : "neutral",
        hutHealth: saved ? saved.hut : 1, // 0..1
        food: saved ? saved.food : 12,
        alive: 0, // kept up to date for the background simulation
        peace: saved ? saved.peace : 0,
        hungry: false,
        hut: null,
        fire: null,
        raidClock: (rival.raid ? rival.raid[0] * 0.8 : 999) + i * 12,
        giftClock: 60,
        visitClock: 70 + i * 20,
        retaliated: false,
        war: saved ? saved.war : 0, // seconds they stay on the attack after being hit
        performers: 0,
        watching: 0,
        faceShown: null,
        band: [], // your performers in place at their fire this frame
        ask: null, // the instrument they want to hear next
        askT: 0,
        lastAsk: null,
        rest: 0, // a breath between calls
        giftCool: 0,
        burning: 0,
        flames: null,
      };
      tribe.hut = makeHut(site.x, site.z, rival.color, RIVAL_HUT[kind]);
      tribe.fire = makeFire(site.x + 6, site.z + 1);
      fires.push(tribe.fire);
      if (rival.palisade) tribe.palisade = makePalisade(site.x + 2, site.z, 12.5);
      const alive = tribe.status === "conquered" ? 0 : saved ? saved.alive : rival.members;
      for (let k = 0; k < alive; k++) spawnRival(tribe, around(tribe.center, 4, 9));
      T.tribes.push(tribe);
      if (tribe.status === "conquered") ruinHut(tribe);
      if (tribe.status === "allied") tribe.hut.flagMat.color.set(0x3fc26e);
    });
  }
  /** A member of a rival tribe, armed the way that tribe arms its people. */
  function spawnRival(tribe, at) {
    const k = T.units.filter((u) => u.tribe === tribe).length;
    const arm = tribe.rival.arms[k % tribe.rival.arms.length];
    const u = makeUnit(tribe, tribe.species.record, at.x, at.z, { tool: arm });
    // Defenders and warriors are tougher than most.
    if (tribe.kind === "defenders" || tribe.kind === "warriors") u.maxHealth = u.health = 75;
    return u;
  }
  // Your tribe: the chief and two others, or whoever was saved (recruits keep the look of their tribe).
  (save ? save.units : [{ chief: true }, {}, {}]).forEach((s) => {
    const at = around(FIRE, 2.5, 5);
    const from = s.from >= 0 && T.tribes[s.from] ? s.from : -1;
    makeUnit(null, from >= 0 ? T.tribes[from].species.record : record, at.x, at.z, { chief: s.chief, tool: s.tool && T.tools[s.tool] ? s.tool : null, from, role: s.role });
  });
  const membersOf = (tribe) => T.units.filter((u) => u.tribe === tribe && !u.dead);
  const settled = () => T.tribes.filter((t) => t.status !== "neutral").length;
  function ruinHut(tribe) {
    tribe.hut.roof.visible = false;
    tribe.hut.flag.visible = false;
    tribe.hut.group.scale.y = 0.36;
    tribe.hut.group.traverse((m) => {
      if (m.isMesh && m !== tribe.hut.flag) m.material = ruinMat;
    });
    tribe.fire.flame.visible = false;
  }

  /* ---- wildlife -------------------------------------------------------------------------------
     Small herds of grazers roam the land around the village. Carnivores and omnivores hunt them:
     a felled animal leaves a carcass that hunters butcher and carry home a few pieces at a time. */
  const HERDS = [0, 1].map((i) => {
    const sp = generateSpecies(31415 + i * 2718, "plant", 1);
    // A grazing ground inland of the village, one on each side.
    const a = Math.atan2(HOME.z, HOME.x) + Math.PI + (i ? 0.55 : -0.55);
    let r = 30;
    let x = HOME.x + Math.cos(a) * r,
      z = HOME.z + Math.sin(a) * r;
    while (heightAt(x, z) < 0.6 && r > 12) {
      r -= 2;
      x = HOME.x + Math.cos(a) * r;
      z = HOME.z + Math.sin(a) * r;
    }
    return { species: sp, center: { x, z }, respawn: 0 };
  });
  function spawnAnimal(herd) {
    const at = around(herd.center, 0, 7);
    const body = buildCreatureBody(herd.species.record, { quality: "low", seed: nextId++ });
    const scale = 0.85;
    body.root.scale.setScalar(scale);
    scene.add(body.root);
    const a = {
      animal: true,
      herd,
      body,
      scale,
      pos: new THREE.Vector3(at.x, heightAt(at.x, at.z), at.z),
      heading: Math.random() * TAU,
      speed: 0,
      health: 40,
      maxHealth: 40,
      fleeT: 0,
      think: Math.random() * 3,
      wander: null,
      dead: false,
      hurtAt: -99,
    };
    T.animals.push(a);
    return a;
  }
  HERDS.forEach((h) => [0, 1, 2].forEach(() => spawnAnimal(h)));
  const carcassGeo = geo(new THREE.SphereGeometry(0.55, 10, 7).scale(1.4, 0.55, 1));
  const meatMat = mat(0xb3473a, { flatShading: false, roughness: 0.6 });
  function hurtAnimal(a, dmg) {
    if (a.dead) return;
    a.health -= dmg;
    a.hurtAt = T.time;
    a.body.hit();
    a.fleeT = 3.5; // bolt away from whoever hit it
    if (a.health > 0) return;
    a.dead = true;
    a.body.die();
    o.sfx("death", { pitch: 1.2 });
    const m = new THREE.Mesh(carcassGeo, meatMat);
    m.position.set(a.pos.x, Math.max(heightAt(a.pos.x, a.pos.z), 0) + 0.2, a.pos.z);
    scene.add(m);
    T.carcasses.push({ from: a, x: a.pos.x, z: a.pos.z, food: 12, full: 12, mesh: m, life: 120 });
    pop(a.pos.x, a.pos.z, "🍖", "good");
    tipOnce("carcass", "Your hunters will carry the meat home.");
    setTimeout(() => {
      scene.remove(a.body.root);
      a.body.dispose();
      T.animals.splice(T.animals.indexOf(a), 1);
    }, 2200);
  }
  function syncCarcass(c) {
    c.mesh.scale.setScalar(0.35 + (0.65 * c.food) / c.full);
    if (c.food <= 0) {
      scene.remove(c.mesh);
      T.carcasses.splice(T.carcasses.indexOf(c), 1);
    }
  }
  function updateAnimals(dt) {
    for (const a of T.animals) {
      if (a.dead) {
        a.body.update(dt, 0);
        continue;
      }
      if (a.fleeT > 0) {
        a.fleeT -= dt;
        // Away from the nearest of your tribe.
        let near = null,
          nd = 30;
        for (const u of T.units) if (u.mine && !u.dead && dist(u, a) < nd) (nd = dist(u, a)), (near = u);
        const away = near ? { x: a.pos.x + (a.pos.x - near.pos.x), z: a.pos.z + (a.pos.z - near.pos.z) } : around(a.herd.center, 4, 9);
        walk(a, away.x, away.z, 4.6, dt);
      } else {
        // Graze: amble about the herd's ground, and drift back if chased off it.
        if (distTo(a, a.herd.center) > 22) a.wander = around(a.herd.center, 0, 6);
        idle(a, a.herd.center, dt, 0, 8);
      }
      if (T.time - a.hurtAt > 8 && a.health < a.maxHealth) a.health = Math.min(a.maxHealth, a.health + dt * 2);
      a.pos.y = Math.max(heightAt(a.pos.x, a.pos.z), -0.4);
      a.body.root.position.copy(a.pos);
      a.body.root.rotation.y = a.heading;
      a.body.update(dt, a.speed);
    }
    // Herds grow back slowly.
    for (const h of HERDS) {
      if (T.animals.filter((a) => a.herd === h && !a.dead).length >= 3) continue;
      if ((h.respawn += dt) > 45) {
        h.respawn = 0;
        spawnAnimal(h);
      }
    }
    for (let i = T.carcasses.length - 1; i >= 0; i--) {
      const c = T.carcasses[i];
      if ((c.life -= dt) <= 0) {
        c.food = 0;
        syncCarcass(c);
      }
    }
  }

  /* ---- burning huts and healers ------------------------------------------------------------ */
  const burnGeo = geo(new THREE.ConeGeometry(0.5, 1.6, 7));
  function setBurning(tr) {
    tr.burning = 8;
    if (tr.flames) return;
    tr.flames = [0, 1, 2, 3].map((i) => {
      const f = new THREE.Mesh(burnGeo, flameMat);
      const a = (i / 4) * TAU;
      f.position.set(tr.center.x + Math.cos(a) * 1.6, heightAt(tr.center.x, tr.center.z) + 3 + (i % 2) * 0.6, tr.center.z + Math.sin(a) * 1.6);
      scene.add(f);
      return f;
    });
    o.sfx("roar", { pitch: 1.6, gain: 0.4 });
  }
  function updateBurning(dt) {
    for (const tr of T.tribes) {
      if (!tr.flames) continue;
      tr.burning -= dt;
      // A burning hut keeps burning down on its own for a while.
      if (tr.status === "neutral" && tr.burning > 0) {
        tr.hutHealth -= dt * 0.01;
        if (tr.hutHealth <= 0) conquer(tr);
      }
      tr.flames.forEach((f, i) => f.scale.set(1 + Math.sin(T.time * 9 + i) * 0.2, 1 + Math.sin(T.time * 13 + i * 2) * 0.35, 1));
      if (tr.burning <= 0 || tr.status !== "neutral") {
        tr.flames.forEach((f) => scene.remove(f));
        tr.flames = null;
      }
    }
  }
  let healPulse = 0;
  function updateHealers(dt) {
    healPulse -= dt;
    const pulse = healPulse <= 0;
    if (pulse) healPulse = 1.5;
    for (const h of T.units) {
      if (!h.mine || h.dead || h.tool !== "healer") continue;
      let healed = false;
      for (const u of T.units) {
        if (!u.mine || u.dead || u.health >= u.maxHealth || dist(u, h) > 7) continue;
        u.health = Math.min(u.maxHealth, u.health + dt * 5);
        healed = true;
      }
      if (healed && pulse) pop(h.pos.x, h.pos.z, "✚", "good");
    }
  }

  /* ---- HUD ------------------------------------------------------------------------------------ */
  const hud = document.createElement("div");
  hud.className = "tribeHUD";
  hud.innerHTML = `
    <div class="trTop">
      <div class="trBox">
        <b class="trName" id="trName"></b>
        <div class="trStats"><span title="Food (each adult eats one a minute)">🍖 <b id="trFood">0</b></span><span title="Tribe members">👥 <b id="trPop">0</b></span><span title="Chief's hut">🛖 <b id="trHutLv">1</b></span></div>
      </div>
      <button class="trIcon" id="trMenu" aria-label="Menu" title="Menu">☰</button>
    </div>
    <div class="trGoal" id="trGoal" role="status" aria-live="polite"></div>
    <div class="trTribes" id="trTribes" role="list" aria-label="Rival tribes"></div>
    <div class="trMarks" id="trMarks" aria-hidden="true"></div>
    <div class="trBoxSel" id="trBoxSel" hidden></div>
    <div class="trToast" id="trToast" role="status" aria-live="polite"></div>
    <div class="trPlace" id="trPlace" hidden role="status" aria-live="polite"><span id="trPlaceText"></span><button id="trPlaceCancel">Cancel</button></div>
    <div class="trArc" id="trArc" hidden>
      <svg class="arcSvg" viewBox="0 0 240 128" aria-hidden="true">
        <path class="arcRim" d="M 22 118 A 98 98 0 0 1 218 118"></path>
        <path class="arcTrack" d="M 22 118 A 98 98 0 0 1 218 118" pathLength="100"></path>
        <path class="arcFill" id="trArcFill" d="M 22 118 A 98 98 0 0 1 218 118" pathLength="100"></path>
      </svg>
      <div class="arcAsk" id="trArcAsk" hidden>
        <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="arcAskTrack" cx="22" cy="22" r="19" pathLength="100"></circle><circle class="arcAskTime" id="trArcTime" cx="22" cy="22" r="19" pathLength="100"></circle></svg>
        <span id="trArcAskIcon"></span>
      </div>
      <img class="arcFace" id="trArcFace" alt="" width="58" height="58" draggable="false">
      <span class="arcLabel" id="trArcLabel" role="status" aria-live="polite"></span>
    </div>
    <div class="trSheet" id="trSheet" hidden></div>
    <div class="trBottom">
      <div class="trBand" id="trBand" hidden role="group" aria-label="Play an instrument">
        ${INSTRUMENTS.map((id, i) => `<button data-play="${id}" aria-label="Play ${TOOLS[id].name.toLowerCase()}"><span>${TOOLS[id].icon}</span><small>${TOOLS[id].name}</small><kbd>${i + 1}</kbd></button>`).join("")}
      </div>
      <div class="trUnits" id="trUnits" role="list" aria-label="Your tribe"></div>
      <div class="trActions">
        <button id="trAll" aria-label="Select everyone"><span>👥</span><small>All</small></button>
        <button id="trBoxBtn" aria-label="Drag a box to select" aria-pressed="false"><span>⬚</span><small>Box</small></button>
        <button id="trRetreat" aria-label="Retreat to the village"><span>↩</span><small>Retreat</small></button>
        <button id="trBaby" aria-label="Have a baby, costs ${BABY_COST} food"><span>🥚</span><small>Baby · ${BABY_COST}</small></button>
        <button id="trBuild" aria-label="Build and upgrade"><span>🔨</span><small>Build</small></button>
        <button id="trHome" aria-label="Go to your village"><span>⌂</span><small>Village</small></button>
      </div>
    </div>
    <div class="trMenuPanel" id="trMenuPanel" hidden>
      <button id="trResume" class="primary">Resume</button>
      <button id="trCustom">🎨 Customise your tribe</button>
      <button id="trHistory">📜 Species history</button>
      <button id="trSettings">⚙ Settings</button>
      <button id="trHelp">How to play</button>
      <button id="trCivGo" hidden>🏛 Civilization Stage</button>
      <button id="trExit">Back to the Creature Stage</button>
    </div>`;
  document.body.appendChild(hud);
  const $h = (q) => hud.querySelector(q);
  const setName = () => ($h("#trName").textContent = look.name + " tribe");
  setName();
  let toastTimer = 0;
  function toast(text, seconds = 3) {
    const el = $h("#trToast");
    el.textContent = text;
    el.classList.add("show");
    toastTimer = seconds;
  }
  const seenTips = new Set();
  function tipOnce(key, text, seconds = 4.5) {
    if (seenTips.has(key)) return;
    seenTips.add(key);
    toast(text, seconds);
  }
  const tmp = new THREE.Vector3();
  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (-tmp.y * 0.5 + 0.5) * innerHeight, behind: tmp.z > 1 };
  }
  /** A floating "+3" or icon over a spot in the world. */
  function pop(x, z, text, cls = "") {
    const pt = project(x, heightAt(x, z) + 2.6, z);
    if (pt.behind) return;
    const el = document.createElement("span");
    el.className = "trPop " + cls;
    el.textContent = text;
    el.style.left = pt.x + "px";
    el.style.top = pt.y + "px";
    hud.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  $h("#trMenu").onclick = () => ($h("#trMenuPanel").hidden = !$h("#trMenuPanel").hidden);
  $h("#trResume").onclick = () => ($h("#trMenuPanel").hidden = true);
  $h("#trSettings").onclick = () => {
    $h("#trMenuPanel").hidden = true;
    o.onSettings?.();
  };
  $h("#trCustom").onclick = () => {
    $h("#trMenuPanel").hidden = true;
    openSheet("custom");
  };
  $h("#trHistory").onclick = () => {
    $h("#trMenuPanel").hidden = true;
    saveState();
    o.onHistory?.();
  };
  $h("#trExit").onclick = () => {
    saveState();
    o.onExit();
  };
  // Once the island is settled, the menu leads on to the Civilization Stage.
  $h("#trMenu").addEventListener("click", () => ($h("#trCivGo").hidden = !(T.won && o.onCivilization)));
  $h("#trCivGo").onclick = () => {
    saveState();
    o.onCivilization?.();
  };
  $h("#trHelp").onclick = () => {
    $h("#trMenuPanel").hidden = true;
    showHelp();
  };
  $h("#trAll").onclick = () => {
    const adults = mine().filter((u) => !u.child);
    const all = adults.length > 0 && adults.every((u) => T.selected.has(u));
    T.selected.clear();
    if (!all) adults.forEach((u) => T.selected.add(u));
    o.sfx("click");
  };
  $h("#trBoxBtn").onclick = () => setBoxMode(!T.boxMode);
  $h("#trRetreat").onclick = retreat;
  $h("#trHome").onclick = () => {
    cam.x = HOME.x;
    cam.z = HOME.z;
  };
  $h("#trBaby").onclick = haveBaby;
  $h("#trPlaceCancel").onclick = () => stopPlacing();
  hud.querySelectorAll("#trBand [data-play]").forEach((b) => (b.onclick = () => playInstrument(b.dataset.play)));
  $h("#trBuild").onclick = () => openSheet("build");

  function setBoxMode(on) {
    T.boxMode = on;
    $h("#trBoxBtn").setAttribute("aria-pressed", String(on));
    $h("#trBoxBtn").classList.toggle("on", on);
    if (on) tipOnce("box", "Drag across the ground to select everyone inside the box.", 4);
  }
  /** Everyone selected (or, with nobody selected, every adult) drops what they're doing and runs home. */
  function retreat() {
    const who = T.selected.size ? [...T.selected] : mine().filter((u) => !u.child);
    who.forEach((u, i) => {
      const at = around(HOME, 3, 6 + i * 0.2);
      u.task = { type: "retreat", x: at.x, z: at.z };
    });
    if (who.length) {
      pop(HOME.x, HOME.z, "↩", "good");
      o.sfx("click");
    }
  }
  function showHelp() {
    openSheet("help");
  }

  /* ---- sheets: build menu, a tribe's card, customising, help ---------------------------- */
  let sheet = null; // { kind, tribe }
  function openSheet(kind, tribe = null) {
    sheet = { kind, tribe };
    renderSheet();
  }
  function closeSheet() {
    sheet = null;
    $h("#trSheet").hidden = true;
  }
  const hex = (c) => "#" + c.toString(16).padStart(6, "0");
  const dis = (off) => (off ? 'aria-disabled="true"' : "");
  function renderSheet() {
    const el = $h("#trSheet");
    if (!sheet) return;
    el.hidden = false;
    let html = "";
    if (sheet.kind === "build") {
      const lv = hutLevel(T.hutLevel),
        next = HUT_LEVELS[T.hutLevel];
      html = `<div class="tsHead"><b>Build</b><button class="tsClose" aria-label="Close">✕</button></div>
        <h5 class="tsKind">Chief's hut · level ${lv.level}</h5>
        <div class="tsHut"><i class="tsRel"><b style="width:${T.hutHp * 100}%;background:${T.hutHp < 0.5 ? "#ef4b48" : "#3fc26e"}"></b></i>
        <small>${T.hutHp < 1 ? "Damaged: select members and tap the hut to repair it." : "Holds " + villageRoom(settled(), T.hutLevel) + " members."}</small>
        ${next ? `<button class="tsTool village" id="tsHutUp" ${dis(T.food < next.cost || T.hutHp < 1)}><span>🛖</span><b>Level ${next.level}</b><small>Room for ${next.room - lv.room} more, a tougher hut, and bronze tools.</small><em>🍖 ${next.cost}</em></button>` : `<p class="tsHint">Your hut is as grand as it gets.</p>`}</div>`;
      for (const [kind, title] of [
        ["fight", "Weapons"],
        ["music", "Instruments"],
        ["village", "Village"],
      ]) {
        html += `<h5 class="tsKind">${title}</h5><div class="tsTools">`;
        for (const [id, t] of Object.entries(TOOLS)) {
          if (t.kind !== kind) continue;
          const tier = T.tools[id];
          let tag, off;
          if (!tier) (tag = "🍖 " + t.cost), (off = T.food < t.cost);
          else if (tier === 1) (tag = T.hutLevel < 2 ? "Bronze: hut lv 2" : "Bronze · 🍖 " + upgradeCost(id)), (off = T.hutLevel < 2 || T.food < upgradeCost(id));
          else (tag = "Bronze ✓"), (off = true);
          html += `<button class="tsTool ${kind}${tier ? " built" : ""}" data-tool="${id}" ${dis(off)}><span>${t.icon}</span><b>${t.name}${tier ? " · " + TIER_NAMES[tier] : ""}</b><small>${t.desc}${tier === 1 ? " Bronze: half as strong again." : ""}</small><em>${tag}</em></button>`;
        }
        html += `</div>`;
      }
      // Dwellings and decorations.
      html += `<h5 class="tsKind">Village</h5><div class="tsTools">`;
      for (const id of STRUCTURE_IDS) {
        const st = STRUCTURES[id],
          built = T.structures.filter((x) => x.id === id).length,
          cost = structureCost(id, built);
        html += `<button class="tsTool village${built ? " built" : ""}" data-structure="${id}" ${dis(cost === null || T.food < cost)}><span>${st.icon}</span><b>${st.name}${built ? " · " + built + "/" + st.max : ""}</b><small>${st.desc}${st.decor ? " Members heal faster at home." : ""}</small><em>${cost === null ? "Full" : "🍖 " + cost}</em></button>`;
      }
      html += `</div>`;
      // Roles: how many gatherers and guards.
      const adults = mine().filter((u) => !u.child);
      const count = (r) => adults.filter((u) => u.role === r).length;
      html += `<h5 class="tsKind">Roles</h5><div class="tsRoles">${["gather", "guard"]
        .map(
          (r) =>
            `<div class="tsRole"><span aria-hidden="true">${ROLES[r].icon}</span><div><b>${ROLES[r].name}s · ${count(r)}</b><small>${ROLES[r].desc}</small></div><button data-role-less="${r}" aria-label="One fewer ${ROLES[r].name.toLowerCase()}" ${dis(!count(r))}>−</button><button data-role-more="${r}" aria-label="One more ${ROLES[r].name.toLowerCase()}" ${dis(!count("free"))}>+</button></div>`,
        )
        .join("")}<p class="tsHint">${count("free")} free for your orders.</p></div>`;
      html += `<p class="tsHint">New shacks and buildings go where you tap near the village. Select members and tap a shack to pick its tool up.</p>`;
    } else if (sheet.kind === "tribe") {
      const tr = sheet.tribe;
      const face = RELATION_INFO[relationFace(tr.relation, tr.status)];
      const picked = [...T.selected].filter((u) => !u.dead);
      const players = picked.filter((u) => INSTRUMENTS.includes(u.tool)).length;
      const anyInstrument = INSTRUMENTS.some((id) => T.tools[id]);
      const offers = tradeOffers(tr, tr.rival, T.tools);
      const alive = membersOf(tr).length;
      const status = tr.status === "allied" ? "Allies" : tr.status === "conquered" ? "Conquered" : face.label + (tr.war > 0 ? " · at war" : "");
      html = `<div class="tsHead"><img src="${face.face}" alt="${face.label}" width="40" height="40"><div><b>${tr.rival.icon} ${esc(tr.name)} · ${tr.rival.name}</b><small>${status} · ${tr.mood} · 👥 ${alive} · 🍖 ${Math.floor(tr.food)}</small></div><button class="tsClose" aria-label="Close">✕</button></div>`;
      if (tr.status === "neutral") html += `<i class="tsRel"><b style="width:${(tr.relation + 100) / 2}%;background:${face.color}"></b></i>`;
      html += `<p class="tsHint tsRival">${tr.rival.hint}</p><div class="tsBtns">`;
      if (tr.status === "neutral") {
        html += `<button id="tsImpress" class="good" ${dis(!players)}>🎶 Play for them</button>
          <button id="tsGift" class="gift" ${dis(T.food < GIFT.food || tr.giftCool > 0)}>🎁 Gift · 🍖${GIFT.food}</button>`;
        if (canMakePeace(tr)) html += `<button id="tsPeace" class="gift" ${dis(T.food < peaceCost(tr.rival))}>🕊 Make peace · 🍖${peaceCost(tr.rival)}</button>`;
        html += `<button id="tsRaid" class="bad" ${dis(!picked.length)}>🍖 Raid their food</button>
          <button id="tsAttack" class="bad" ${dis(!picked.length)}>⚔ Attack</button>`;
      } else if (tr.status === "allied") {
        html += `<button id="tsRecruit" class="good" ${dis(!canRecruit(tr, alive) || T.food < RECRUIT_COST || mine().length + T.eggs.length >= room())}>🤝 Recruit one · 🍖${RECRUIT_COST}</button>`;
      }
      html += `</div>`;
      if (offers.length) {
        html += `<h5 class="tsKind">Trade${tr.status === "allied" ? " (ally prices)" : ""}</h5><div class="tsTrade">`;
        for (const of of offers) html += `<button class="tsTradeBtn" data-trade="${of.tool}" data-price="${of.price}" ${dis(T.food < of.price)}><span>${TOOLS[of.tool].icon}</span><b>${TOOLS[of.tool].name}</b><em>🍖 ${of.price}</em></button>`;
        html += `</div>`;
      }
      if (tr.status === "neutral")
        html += `<p class="tsHint">${
          players
            ? players + " of your selected members " + (players === 1 ? "has an instrument" : "have instruments") + ". When they call for one, play it."
            : picked.length
              ? anyInstrument
                ? "Nobody selected has an instrument: tap an instrument shack first."
                : "To make friends, build an instrument (🔨) and pick it up, or send gifts."
              : "Select some of your tribe to play, raid or attack."
        }</p>`;
      else if (tr.status === "allied") html += `<p class="tsHint">Allies send food now and then, help you see off raiders, and trade at half price.</p>`;
    } else if (sheet.kind === "custom") {
      html = `<div class="tsHead"><b>Customise your tribe</b><button class="tsClose" aria-label="Close">✕</button></div>
        <label class="tsField"><span>Tribe name</span><input id="tsName" maxlength="22" value="${esc(look.name)}" autocomplete="off" spellcheck="false"></label>
        <h5 class="tsKind">Colour</h5><div class="tsSwatches" role="radiogroup" aria-label="Tribe colour">${TRIBE_COLORS.map((c) => `<button role="radio" aria-checked="${c === look.color}" aria-label="Colour ${hex(c)}" data-color="${c}" style="--c:${hex(c)}"></button>`).join("")}</div>
        <h5 class="tsKind">Hut</h5><div class="tsStyles" role="radiogroup" aria-label="Hut style">${Object.entries(HUT_STYLES)
          .map(([id, st]) => `<button role="radio" aria-checked="${id === look.style}" data-style="${id}"><b>${st.name}</b><small>${st.desc}</small></button>`)
          .join("")}</div>
        <div class="tsBtns"><button class="good" id="tsDone">Done</button></div>`;
    } else if (sheet.kind === "won") {
      const v = victoryPath(T.tribes) || { title: "The island is settled", text: "", trait: "", icon: "✦" };
      const allied = T.tribes.filter((t) => t.status === "allied").length,
        conquered = T.tribes.filter((t) => t.status === "conquered").length;
      html = `<div class="tsHead tsWon"><b>${v.icon} Tribal Stage complete</b><button class="tsClose" aria-label="Close">✕</button></div>
        <p class="tsWonText"><b>${v.title}.</b> ${v.text}</p>
        <div class="tsStats"><span><b>${allied}</b> allied</span><span><b>${conquered}</b> conquered</span><span><b>${mine().length}</b> members</span><span><b>${Math.floor(T.food)}</b> food</span></div>
        ${v.trait ? `<p class="tsHint">Your species earns the <b>${v.trait}</b> trait, carried into the stages to come. Your village can become a city: the Civilization Stage begins when you're ready.</p>` : ""}
        ${o.onCivilization ? `<div class="tsBtns tsWide"><button class="good" id="tsCiv">🏛 Begin the Civilization Stage</button></div>` : ""}
        <div class="tsBtns"><button id="tsKeep">Keep playing</button><button id="tsBack">Back to the Creature Stage</button></div>`;
    } else {
      html = `<div class="tsHead"><b>Tribal Stage · how to play</b><button class="tsClose" aria-label="Close">✕</button></div>
        <ul class="tsHelp">
          <li><b>Look around:</b> drag to move, pinch or scroll to zoom.</li>
          <li><b>Select:</b> tap a member, use All, or ⬚ Box and drag. Then tap where to go: they march in formation.</li>
          <li><b>Food:</b> tap ${diet === "meat" ? "the ripples in the sea to fish" : diet === "plant" ? "a fruit bush to pick fruit" : "a fruit bush, or the ripples in the sea to fish"}. Each adult eats one food a minute.</li>
          ${diet !== "plant" ? "<li><b>Hunt:</b> tap a grazing animal. Your hunters bring the meat home.</li>" : ""}
          <li><b>Grow:</b> 🥚 Baby costs ${BABY_COST} food. 🔨 Build places shacks, upgrades tools to bronze, and enlarges the chief's hut for more room.</li>
          <li><b>Five rivals:</b> tap a village to see what it wants. Play the instrument they call for (or press 1-3), send gifts, trade, or make peace.</li>
          <li><b>Allies</b> send food, help against raiders, trade cheaply and let you recruit their people.</li>
          <li><b>Or fight:</b> raid their food, or attack and knock their hut down. Torches burn huts fast. ↩ Retreat brings everyone home.</li>
          <li><b>Goal:</b> make every tribe an ally, or bring it down. How you do it shapes your species.</li>
        </ul>
        ${legacy.lines.length ? `<h5 class="tsKind">Your species' legacy</h5><ul class="tsHelp tsLegacy">${legacy.lines.map((l) => `<li>${l.icon} <b>${esc(l.name)}</b> (${l.stage === "cell" ? "Cell" : "Creature"} Stage): ${esc(l.text)}</li>`).join("")}</ul>` : ""}`;
    }
    el.innerHTML = html;
    el.querySelector(".tsClose").onclick = closeSheet;
    el.querySelectorAll(".tsTool[data-tool]").forEach((b) => (b.onclick = () => (T.tools[b.dataset.tool] ? upgradeTool(b.dataset.tool) : startPlacing(b.dataset.tool))));
    el.querySelectorAll("[data-structure]").forEach((b) => (b.onclick = () => startPlacing("s:" + b.dataset.structure)));
    el.querySelectorAll("[data-role-more]").forEach(
      (b) =>
        (b.onclick = () => {
          // The free adult nearest the fire takes the job (the chief stays free while others can).
          const free = mine().filter((u) => !u.child && u.role === "free").sort((a, z) => a.chief - z.chief || distTo(a, FIRE) - distTo(z, FIRE));
          if (!free.length) return;
          free[0].role = b.dataset.roleMore;
          free[0].task = null;
          o.sfx("click");
          saveState();
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-role-less]").forEach(
      (b) =>
        (b.onclick = () => {
          const u = mine().find((x) => !x.child && x.role === b.dataset.roleLess);
          if (!u) return;
          u.role = "free";
          u.task = null;
          o.sfx("click");
          saveState();
          renderSheet();
        }),
    );
    const hutUp = el.querySelector("#tsHutUp");
    if (hutUp) hutUp.onclick = upgradeHut;
    el.querySelectorAll("[data-trade]").forEach((b) => (b.onclick = () => trade(sheet.tribe, b.dataset.trade, Number(b.dataset.price))));
    const imp = el.querySelector("#tsImpress");
    if (imp)
      imp.onclick = () => {
        const tr = sheet.tribe;
        const players = [...T.selected].filter((u) => INSTRUMENTS.includes(u.tool));
        if (!players.length) return toast(INSTRUMENTS.some((id) => T.tools[id]) ? "Select members holding instruments." : "Build an instrument first (🔨 Build).");
        players.forEach((u, i) => (u.task = { type: "perform", tribe: tr, slot: i }));
        o.sfx("click");
        tipOnce("band", "When your band arrives, the tribe calls for instruments. Play the one they ask for.", 5);
        closeSheet();
      };
    const on = (id, fn) => {
      const b = el.querySelector(id);
      if (b) b.onclick = fn;
    };
    on("#tsGift", () => sendGift(sheet.tribe));
    on("#tsPeace", () => makePeace(sheet.tribe));
    on("#tsRecruit", () => recruit(sheet.tribe));
    on("#tsKeep", closeSheet);
    on("#tsCiv", () => {
      saveState();
      o.onCivilization();
    });
    on("#tsBack", () => {
      saveState();
      o.onExit();
    });
    on("#tsRaid", () => {
      const tr = sheet.tribe;
      const picked = [...T.selected].filter((u) => !u.dead && !u.child);
      if (!picked.length) return toast("Select some of your tribe first.");
      picked.forEach((u) => (u.task = { type: "raid", tribe: tr }));
      o.sfx("roar", { gain: 0.5 });
      tipOnce("raidThem", "Raiders grab what food they can and run home. The tribe will be furious if they see you.", 5);
      closeSheet();
    });
    on("#tsAttack", () => {
      const tr = sheet.tribe;
      [...T.selected].forEach((u) => (u.task = { type: "attack", tribe: tr, target: null }));
      o.sfx("roar");
      closeSheet();
    });
    // Customising: changes show at once and are saved.
    const nameIn = el.querySelector("#tsName");
    if (nameIn) {
      nameIn.oninput = () => {
        look.name = cleanName(nameIn.value, record.name);
        setName();
      };
      nameIn.onchange = () => {
        nameIn.value = look.name;
        saveState();
      };
    }
    el.querySelectorAll("[data-color]").forEach(
      (b) =>
        (b.onclick = () => {
          look.color = Number(b.dataset.color);
          myHut.flagMat.color.set(look.color);
          styleMyHut();
          saveState();
          renderSheet();
        }),
    );
    el.querySelectorAll("[data-style]").forEach(
      (b) =>
        (b.onclick = () => {
          look.style = b.dataset.style;
          rebuildMyHut();
          saveState();
          renderSheet();
        }),
    );
    on("#tsDone", closeSheet);
  }

  /* ---- building: placing shacks, upgrades, the chief's hut ---------------------------------- */
  const room = () => villageRoom(settled(), T.hutLevel, T.structures.filter((st) => st.id === "house").length);
  const decorCount = () => T.structures.filter((st) => STRUCTURES[st.id].decor).length;
  function takenSpots() {
    return [
      { x: HOME.x, z: HOME.z, r: 5.5 + T.hutLevel * 0.4 },
      { ...FIRE, r: 3 },
      { ...PILE, r: 3 },
      ...Object.values(SHACK).map((s) => ({ x: s.x, z: s.z, r: 3.6 })),
      ...T.structures.map((st) => ({ x: st.x, z: st.z, r: st.id === "house" ? 3.8 : 2.4 })),
    ];
  }
  function startPlacing(id) {
    const sid = id.startsWith("s:") ? id.slice(2) : null;
    const t = sid ? { name: STRUCTURES[sid].name, cost: structureCost(sid, T.structures.filter((st) => st.id === sid).length) } : TOOLS[id];
    if (t.cost === null) return toast("You have as many of those as the village can use.");
    if (T.food < t.cost) return toast("Not enough food: " + t.name + " costs " + t.cost + ".");
    T.placing = id;
    closeSheet();
    cam.x = HOME.x;
    cam.z = HOME.z;
    cam.dist = Math.min(cam.dist, 46);
    $h("#trPlace").hidden = false;
    $h("#trPlaceText").textContent = "Tap near the village to place the " + t.name.toLowerCase() + (sid ? "." : " shack.");
    o.sfx("click");
  }
  function stopPlacing() {
    T.placing = null;
    $h("#trPlace").hidden = true;
  }
  /** Placing a shack at a ground point; false (with a reason shown) if it can't go there. */
  function placeShack(at) {
    const id = T.placing;
    if (!id) return false;
    const why = canPlace(at, HOME, takenSpots(), heightAt);
    if (why) {
      toast(why);
      o.sfx("snub", { gain: 0.4 });
      return false;
    }
    if (id.startsWith("s:")) return placeStructure(id.slice(2), at);
    const t = TOOLS[id];
    if (T.food < t.cost) {
      stopPlacing();
      toast("Not enough food: " + t.name + " cost " + t.cost + ".");
      return false;
    }
    T.food -= t.cost;
    T.tools[id] = 1;
    SHACK[id] = { x: at.x, z: at.z, hp: 1 };
    buildShack(id);
    stopPlacing();
    o.sfx("build");
    pop(at.x, at.z, t.icon, "good");
    tipOnce("equip", "Select members, then tap the new shack to pick up " + t.name.toLowerCase() + ".", 5);
    saveState();
    return true;
  }
  /** Kept for older callers (and tests): build a shack at its old spot behind the hut. */
  function buyTool(id) {
    if (T.tools[id]) return;
    const t = TOOLS[id];
    if (T.food < t.cost) return toast("Not enough food: " + t.name + " cost " + t.cost + ".");
    T.placing = id;
    if (!placeShack(arcSpot(id))) {
      // The old spot is taken: find one nearby.
      for (let k = 0; k < 40 && T.placing; k++) placeShack(around(HOME, 8, 20));
    }
    stopPlacing();
  }
  /** A dwelling or decoration, placed where you tapped. */
  function placeStructure(sid, at) {
    const st = STRUCTURES[sid];
    const cost = structureCost(sid, T.structures.filter((x) => x.id === sid).length);
    if (cost === null || T.food < cost) {
      stopPlacing();
      toast(cost === null ? "You have as many of those as the village can use." : "Not enough food: " + st.name + " costs " + cost + ".");
      return false;
    }
    T.food -= cost;
    const s = { id: sid, x: at.x, z: at.z };
    T.structures.push(s);
    buildStructure(s);
    stopPlacing();
    o.sfx("build");
    pop(at.x, at.z, st.icon, "good");
    toast(sid === "house" ? "A new dwelling: room for " + room() + " members now." : st.name + " placed. Members heal faster at a lively village.", 3.5);
    saveState();
    return true;
  }
  /* Structure models: a small hut for a dwelling, carved stacks, banners in the tribe's colour, flowers. */
  const structureMeshes = new Map();
  const totemMats = [mat(0x8a5a3a), mat(0xd9a05a), mat(0x5a3d24)];
  const flowerMats = [mat(0xff7aa8), mat(0xffe05a), mat(0xa88aff), mat(0xff9a5a)];
  const stemMat = mat(0x3f8f4a);
  const totemGeo = geo(new THREE.CylinderGeometry(0.42, 0.48, 0.8, 8)),
    eyeGeo = geo(new THREE.SphereGeometry(0.09, 6, 4)),
    bloomGeo = geo(new THREE.SphereGeometry(0.16, 6, 4)),
    stemGeo = geo(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4).translate(0, 0.2, 0)),
    bannerGeo = geo(new THREE.PlaneGeometry(0.9, 1.3));
  function buildStructure(s) {
    if (s.id === "house") {
      const h = makeHut(s.x, s.z, look.color, look.style);
      h.group.scale.setScalar(0.48);
      h.flag.visible = false;
      structureMeshes.set(s, h.group);
      return;
    }
    const g = new THREE.Group();
    g.position.set(s.x, heightAt(s.x, s.z), s.z);
    if (s.id === "totem") {
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(totemGeo, totemMats[i % 3]);
        seg.position.y = 0.4 + i * 0.8;
        seg.scale.setScalar(1 - i * 0.08);
        g.add(seg);
        for (const x of [-0.15, 0.15]) {
          const e = new THREE.Mesh(eyeGeo, wallMat);
          e.position.set(x, 0.55 + i * 0.8, 0.4 - i * 0.03);
          g.add(e);
        }
      }
    } else if (s.id === "banner") {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.6;
      pole.scale.y = 1.2;
      const flagMat2 = new THREE.MeshBasicMaterial({ color: look.color, side: THREE.DoubleSide });
      disposables.push(flagMat2);
      const flag = new THREE.Mesh(bannerGeo, flagMat2);
      flag.position.set(0.5, 3, 0);
      g.add(pole, flag);
    } else {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU,
          r = 0.4 + (i % 3) * 0.35;
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        const bloom = new THREE.Mesh(bloomGeo, flowerMats[i % flowerMats.length]);
        bloom.position.set(Math.cos(a) * r, 0.45, Math.sin(a) * r);
        g.add(stem, bloom);
      }
    }
    g.rotation.y = Math.atan2(-(HOME.z - s.z), HOME.x - s.x) || 0;
    scene.add(g);
    structureMeshes.set(s, g);
  }
  T.structures.forEach(buildStructure);

  function upgradeTool(id) {
    if (T.tools[id] !== 1) return;
    if (T.hutLevel < 2) return toast("Bronze needs a level 2 hut: upgrade the chief's hut first.");
    const cost = upgradeCost(id);
    if (T.food < cost) return toast("Bronze " + TOOLS[id].name.toLowerCase() + " cost " + cost + " food.");
    T.food -= cost;
    T.tools[id] = 2;
    buildShack(id);
    // Everyone already holding one gets the bronze version.
    mine().forEach((u) => u.tool === id && setTool(u, id));
    o.sfx("build");
    pop(SHACK[id].x, SHACK[id].z, "✦ " + TOOLS[id].icon, "good");
    toast("Bronze " + TOOLS[id].name.toLowerCase() + ": half as strong again.");
    saveState();
    renderSheet();
  }
  function upgradeHut() {
    const next = HUT_LEVELS[T.hutLevel];
    if (!next) return;
    if (T.hutHp < 1) return toast("Repair the hut before enlarging it.");
    if (T.food < next.cost) return toast("Level " + next.level + " costs " + next.cost + " food.");
    T.food -= next.cost;
    T.hutLevel = next.level;
    styleMyHut();
    o.sfx("unlock");
    pop(HOME.x, HOME.z, "🛖 " + next.level, "good");
    toast("The chief's hut is now level " + next.level + ": room for " + room() + " members.");
    chronicle({ key: "tribe:hut:" + next.level, stage: "tribe", icon: "🛖", text: "Raised the chief's hut to level " + next.level + "." });
    saveState();
    renderSheet();
  }
  function haveBaby() {
    const pop0 = mine().length + T.eggs.length;
    if (T.hutHp < 0.3) return toast("Your hut is wrecked: repair it first (select members, tap the hut).");
    if (pop0 >= room()) return toast(T.hutLevel < 3 ? "Your village is full. Enlarge the hut (🔨) or win over a tribe to make room." : "Your village is full. Win over or conquer a tribe to make room.");
    if (T.food < BABY_COST) return toast("A baby needs " + BABY_COST + " food.");
    T.food -= BABY_COST;
    const at = around(HOME, 3.6, 4.6);
    const m = new THREE.Mesh(eggGeo, eggMat);
    m.position.set(at.x, heightAt(at.x, at.z) + 0.5, at.z);
    scene.add(m);
    T.eggs.push({ mesh: m, t: 5, x: at.x, z: at.z });
    o.sfx("hatch");
  }

  /* ---- camera and input --------------------------------------------------------------- */
  const cam = { x: HOME.x, z: HOME.z, dist: 42, sx: HOME.x, sz: HOME.z, sd: 42 };
  const PITCH = { up: 0.68, back: 0.74 }; // the view looks down and inland, like Spore's tribe camera
  function placeCamera(dt) {
    const k = 1 - Math.exp(-dt * 10);
    cam.sx += (cam.x - cam.sx) * k;
    cam.sz += (cam.z - cam.sz) * k;
    cam.sd += (cam.dist - cam.sd) * k;
    const gy = Math.max(0, heightAt(cam.sx, cam.sz));
    camera.position.set(cam.sx, gy + cam.sd * PITCH.up, cam.sz + cam.sd * PITCH.back);
    camera.lookAt(cam.sx, gy, cam.sz);
  }
  function clampCam() {
    const d = Math.hypot(cam.x, cam.z);
    if (d > ISLAND.shore + 10) {
      cam.x *= (ISLAND.shore + 10) / d;
      cam.z *= (ISLAND.shore + 10) / d;
    }
    cam.dist = Math.max(16, Math.min(80, cam.dist));
  }
  /** Where a screen point meets the ground (or the sea), by marching along the view ray. */
  const ray = new THREE.Raycaster();
  function groundAt(px, py) {
    ray.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
    const { origin, direction } = ray.ray;
    if (direction.y >= -0.01) return null;
    let prev = 0;
    for (let t = 2; t < 400; t += 1.5) {
      const x = origin.x + direction.x * t,
        y = origin.y + direction.y * t,
        z = origin.z + direction.z * t;
      if (y <= Math.max(heightAt(x, z), 0)) {
        // Refine between the last two steps.
        let lo = prev,
          hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + direction.y * mid;
          if (my <= Math.max(heightAt(origin.x + direction.x * mid, origin.z + direction.z * mid), 0)) hi = mid;
          else lo = mid;
        }
        return { x: origin.x + direction.x * hi, z: origin.z + direction.z * hi };
      }
      prev = t;
    }
    return null;
  }

  const pointers = new Map();
  let gesture = null; // { panned, pinch }
  const onDown = (e) => {
    if (paused || e.target !== canvas) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    // Box selection: with ⬚ Box on, or shift-drag with a mouse.
    if (pointers.size === 1) gesture = { panned: false, pinch: 0, button: e.button, box: T.boxMode || (e.shiftKey && e.pointerType === "mouse") ? { x0: e.clientX, y0: e.clientY } : null };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.panned = true; // a pinch never counts as a tap
      gesture.box = null;
      $h("#trBoxSel").hidden = true;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* pointer already gone */
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
    if (gesture.box) {
      const b = gesture.box,
        el = $h("#trBoxSel");
      el.hidden = false;
      el.style.left = Math.min(b.x0, e.clientX) + "px";
      el.style.top = Math.min(b.y0, e.clientY) + "px";
      el.style.width = Math.abs(e.clientX - b.x0) + "px";
      el.style.height = Math.abs(e.clientY - b.y0) + "px";
      return;
    }
    // World units per pixel at the ground under the camera; up-down is stretched by the view angle.
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
      if (gesture.box && gesture.panned) {
        boxSelect(gesture.box.x0, gesture.box.y0, e.clientX, e.clientY);
        $h("#trBoxSel").hidden = true;
      } else if (!gesture.panned && e.type === "pointerup") tap(e.clientX, e.clientY);
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
    if (paused) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "Escape") {
      if (sheet) closeSheet();
      else T.selected.clear();
      return;
    }
    const n = ["1", "2", "3"].indexOf(e.key);
    if (n >= 0 && !e.repeat) return playInstrument(INSTRUMENTS[n]);
    keys.add(e.key.toLowerCase());
  };
  const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
  const onContext = (e) => e.target === canvas && e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  /** The nearest thing in a list to a screen point, within `px` pixels. */
  function nearestOnScreen(list, sx, sy, px, at) {
    let best = null,
      bestD = px;
    for (const item of list) {
      const a = at(item);
      const pt = project(a.x, a.y, a.z);
      if (pt.behind) continue;
      const d = Math.hypot(pt.x - sx, pt.y - sy);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }
  const unitAt = (u) => ({ x: u.pos.x, y: u.pos.y + u.body.height * u.scale * 0.55, z: u.pos.z });
  const groundY = (p, lift = 1.5) => ({ x: p.x, y: Math.max(0, heightAt(p.x, p.z)) + lift, z: p.z });

  /** Select every adult of yours whose body is inside a screen rectangle. */
  function boxSelect(x0, y0, x1, y1) {
    const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)],
      [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
    T.selected.clear();
    for (const u of mine()) {
      if (u.child) continue;
      const a = unitAt(u),
        pt = project(a.x, a.y, a.z);
      if (!pt.behind && pt.x >= l && pt.x <= r && pt.y >= t && pt.y <= b) T.selected.add(u);
    }
    o.sfx("click");
    if (T.selected.size) tipOnce("selected", "Now tap where they should go, or what they should do.");
  }
  function tap(sx, sy) {
    $h("#trMenuPanel").hidden = true;
    if (T.placing) {
      const g = groundAt(sx, sy);
      if (g) placeShack(g);
      return;
    }
    const own = nearestOnScreen(
      mine().filter((u) => !u.child),
      sx,
      sy,
      38,
      unitAt,
    );
    if (own) {
      const only = T.selected.size === 1 && T.selected.has(own);
      T.selected.clear();
      if (!only) T.selected.add(own);
      o.sfx("click");
      if (!only) tipOnce("selected", "Now tap where it should go, or what it should do.");
      return;
    }
    const picked = [...T.selected].filter((u) => !u.dead);
    // Another tribe: its members or its hut.
    const foreign = nearestOnScreen(
      T.units.filter((u) => !u.mine && !u.dead),
      sx,
      sy,
      36,
      unitAt,
    );
    // A hut counts wherever you tap it, from the doorstep to the top of the roof.
    const hutTribe = nearestOnScreen(T.tribes, sx, sy, 50, (t) => groundY(t.center, 1.2)) || nearestOnScreen(T.tribes, sx, sy, 60, (t) => groundY(t.center, 3.6));
    const tribe = foreign?.tribe || hutTribe;
    if (tribe) {
      if (tribe.status === "conquered") return toast("The " + tribe.name + " tribe is no more.");
      // A raider in your village is simply fought.
      if (foreign?.raid && picked.length) {
        picked.forEach((u) => (u.task = { type: "fight", target: foreign }));
        return flash(foreign.pos.x, foreign.pos.z);
      }
      return openSheet("tribe", tribe);
    }
    if (!picked.length) {
      const g0 = groundAt(sx, sy);
      if (g0 && Math.hypot(g0.x - HOME.x, g0.z - HOME.z) < 5) $h("#trAll").click();
      else tipOnce("select", "Tap one of your tribe to select it, or use All.");
      return;
    }
    closeSheet();
    // Your hut: repair it if it's been knocked about.
    const hp = project(HOME.x, heightAt(HOME.x, HOME.z) + 2.4, HOME.z);
    if (!hp.behind && Math.hypot(hp.x - sx, hp.y - sy) < 52 && T.hutHp < 1) {
      picked.forEach((u) => (u.task = { type: "repair", what: "hut" }));
      flash(HOME.x, HOME.z);
      tipOnce("repair", "Repairing the hut. Everyone helping makes it quicker.");
      return o.sfx("click");
    }
    // Tool shacks: pick up the tool, or repair a damaged shack.
    for (const tool of Object.keys(TOOLS)) {
      if (!T.tools[tool] || !SHACK[tool]) continue;
      const pt = project(SHACK[tool].x, heightAt(SHACK[tool].x, SHACK[tool].z) + 1.2, SHACK[tool].z);
      if (!pt.behind && Math.hypot(pt.x - sx, pt.y - sy) < 46) {
        picked.forEach((u) => (u.task = SHACK[tool].hp < 1 ? { type: "repair", what: tool } : { type: "equip", tool }));
        flash(SHACK[tool].x, SHACK[tool].z);
        if (SHACK[tool].hp < 1) tipOnce("repairShack", "That shack is damaged: they'll repair it first.");
        return o.sfx("click");
      }
    }
    // Wild animals: hunt them (or butcher a carcass).
    const prey = nearestOnScreen(
      T.animals.filter((a) => !a.dead),
      sx,
      sy,
      40,
      unitAt,
    );
    const meat = nearestOnScreen(T.carcasses, sx, sy, 40, (c) => groundY(c, 0.5));
    if (prey || meat) {
      if (diet === "plant") return toast("Your tribe are herbivores: they don't hunt.");
      picked.forEach((u) => (u.task = prey ? { type: "hunt", target: prey } : { type: "haul", carcass: meat }));
      const at = prey ? prey.pos : meat;
      flash(at.x, at.z);
      tipOnce("hunt", "Hunting! Spears let your hunters strike from a distance.");
      return o.sfx("click");
    }
    // Fishing spots.
    const spot = nearestOnScreen(fishSpots, sx, sy, 46, (f) => ({ x: f.x, y: 0.2, z: f.z }));
    if (spot) {
      if (!canGather(diet, "fish")) return toast("Your tribe are herbivores: they pick fruit, they don't fish.");
      picked.forEach((u) => (u.task = { type: "fish", spot }));
      flash(spot.x, spot.z);
      return o.sfx("click");
    }
    const g = groundAt(sx, sy);
    if (!g) return;
    // Fruit: any bush with fruit on it near the tap.
    const fruit = nearestFruit(g, 3);
    if (fruit) {
      if (!canGather(diet, "fruit")) return toast("Your tribe are carnivores: they fish (tap the ripples in the sea).");
      picked.forEach((u) => (u.task = { type: "gather", origin: { x: fruit.x, z: fruit.z }, fruit: null }));
      flash(fruit.x, fruit.z);
      return o.sfx("click");
    }
    if (heightAt(g.x, g.z) < -0.7) return toast("Too deep to wade.");
    // March there in formation: ranks facing the way they're going, the chief in front.
    const slots = formation(picked, g);
    picked.forEach((u, i) => (u.task = { type: "move", x: slots[i].x, z: slots[i].z }));
    flash(g.x, g.z);
    o.sfx("click");
  }
  /**
   * Formation slots around a target: rows of up to four, two metres apart, facing from the group's
   * centre toward the target. Chief first, then fighters, then everyone else.
   */
  function formation(units, g) {
    if (units.length === 1) return [{ x: g.x, z: g.z }];
    const cx = units.reduce((a, u) => a + u.pos.x, 0) / units.length,
      cz = units.reduce((a, u) => a + u.pos.z, 0) / units.length;
    const dir = Math.atan2(g.z - cz, g.x - cx) || 0;
    const fx = Math.cos(dir),
      fz = Math.sin(dir);
    const rank = (u) => (u.chief ? 0 : u.tool && DAMAGE[u.tool] ? 1 : 2);
    const order = [...units].sort((a, b) => rank(a) - rank(b));
    const out = new Map();
    const cols = Math.min(4, units.length);
    order.forEach((u, i) => {
      const row = Math.floor(i / cols),
        col = (i % cols) - (Math.min(cols, units.length - row * cols) - 1) / 2;
      // Side to side across the march, rows back from the target.
      out.set(u, { x: g.x - fx * row * 2 - fz * col * 2, z: g.z - fz * row * 2 + fx * col * 2 });
    });
    return units.map((u) => out.get(u));
  }
  function nearestFruit(p, radius) {
    let best = null,
      bestD = radius;
    for (const f of world.fruits) {
      if (!f.alive || f.claimed || f.hanging) continue; // tree fruit is out of reach until it falls
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }
  /** A ring that shrinks away where you sent them. */
  const flashes = [];
  function flash(x, z) {
    const m = new THREE.Mesh(ringGeo, goMat);
    m.position.set(x, Math.max(0, heightAt(x, z)) + 0.15, z);
    m.scale.setScalar(1.6);
    scene.add(m);
    flashes.push({ m, t: 0.5 });
  }

  /* ---- unit behaviour ----------------------------------------------------------------- */
  /** Walk toward a point; true once within `stop` of it. */
  function walk(u, x, z, pace, dt, stop = 0.4) {
    const dx = x - u.pos.x,
      dz = z - u.pos.z,
      d = Math.hypot(dx, dz);
    if (d <= stop) {
      u.speed += (0 - u.speed) * Math.min(1, dt * 8);
      return true;
    }
    const want = Math.atan2(-dz, dx);
    let da = want - u.heading;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    u.heading += Math.max(-dt * 7, Math.min(dt * 7, da));
    u.speed += (pace - u.speed) * Math.min(1, dt * 6);
    const step = Math.min(d, u.speed * dt);
    let nx = u.pos.x + Math.cos(u.heading) * step,
      nz = u.pos.z - Math.sin(u.heading) * step;
    ({ x: nx, z: nz } = world.resolve(nx, nz, 0.7));
    // Nobody swims in this stage: deep water stops them.
    if (heightAt(nx, nz) < -0.8) {
      u.speed = 0;
      return true;
    }
    u.pos.x = nx;
    u.pos.z = nz;
    return false;
  }
  const face = (u, x, z) => (u.heading = Math.atan2(-(z - u.pos.z), x - u.pos.x));
  const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  const distTo = (u, p) => Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
  const headOf = (u) => () => (u.dead ? null : new THREE.Vector3(u.pos.x + Math.cos(u.heading) * u.body.length * u.scale * 0.35, u.pos.y + u.body.height * u.scale + 0.4, u.pos.z - Math.sin(u.heading) * u.body.length * u.scale * 0.35));
  function perform(u, kind) {
    u.body.playAbility(kind);
    emotes.emit(kind, headOf(u), Math.max(0.8, u.scale));
  }

  const weapon = (u) => (DAMAGE[u.tool] ? u.tool : "none");
  /** Close in and hit (or, with a spear, throw from a distance). Returns false when the target is gone. */
  function strike(u, target, dt) {
    if (!target || target.dead) return false;
    const w = weapon(u);
    const reach = w === "spear" ? 8 : 1.6 + (u.scale + (target.scale || 1)) * 0.5;
    if (!walk(u, target.pos.x, target.pos.z, 5.4, dt, reach)) return true;
    face(u, target.pos.x, target.pos.z);
    if (u.cool > 0) return true;
    const dmg = DAMAGE[w] * (u.chief ? 1.4 : 1) * (u.mine ? tierMult(u.tool, T.tools[u.tool]) * legacy.damage : 1);
    if (w === "spear") {
      u.cool = 1.4;
      u.body.playAbility("strike");
      throwSpear(u, target, dmg);
      return true;
    }
    u.cool = 1;
    u.body.playAbility(w === "none" ? "bite" : "strike");
    o.sfx(w === "none" ? "creatureBite" : "chop", { pitch: w === "torch" ? 1.3 : 1, gain: 0.6 });
    (target.animal ? hurtAnimal : hurt)(target, dmg, u);
    return true;
  }
  /** A spear in flight: a quick arc from the thrower to where the target is. */
  const spearGeo = geo(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5).rotateZ(Math.PI / 2));
  function throwSpear(u, target, dmg) {
    const m = new THREE.Mesh(spearGeo, poleMat);
    const from = new THREE.Vector3(u.pos.x, u.pos.y + u.body.height * u.scale, u.pos.z);
    m.position.copy(from);
    scene.add(m);
    o.sfx("spit", { pitch: 0.7, gain: 0.5 });
    T.spears.push({ m, from, target, by: u, dmg, t: 0, dur: 0.28 + dist(u, target) * 0.025 });
  }
  function updateSpears(dt) {
    for (let i = T.spears.length - 1; i >= 0; i--) {
      const sp = T.spears[i];
      sp.t += dt;
      const k = Math.min(1, sp.t / sp.dur);
      const to = sp.target.pos;
      const x = sp.from.x + (to.x - sp.from.x) * k,
        z = sp.from.z + (to.z - sp.from.z) * k,
        y = sp.from.y + (to.y + 0.8 - sp.from.y) * k + Math.sin(k * Math.PI) * 1.4;
      sp.m.lookAt(x, y, z);
      sp.m.position.set(x, y, z);
      sp.m.rotation.y += Math.PI / 2;
      if (k >= 1) {
        scene.remove(sp.m);
        T.spears.splice(i, 1);
        if (!sp.target.dead) {
          (sp.target.animal ? hurtAnimal : hurt)(sp.target, sp.dmg, sp.by);
          o.sfx("chop", { pitch: 1.4, gain: 0.4 });
        }
      }
    }
  }
  function hurt(u, dmg, by) {
    if (u.dead) return;
    u.health -= dmg;
    u.hurtAt = T.time;
    u.body.hit();
    // Fight back, unless running home with loot or retreating.
    const fleeing = (u.raid && u.carry) || (u.task?.type === "raid" && u.carry) || u.task?.type === "retreat";
    if (by && !by.dead && (!u.task || (u.task.type !== "fight" && u.task.type !== "attack")) && !u.child && !fleeing) u.task = { type: "fight", target: by };
    // Hitting a tribe at home is an act of war; seeing off raiders is not.
    if (u.tribe && !u.raid && by?.mine) {
      const tr = u.tribe;
      tr.war = Math.max(tr.war, 25);
      if (by?.mine && tr.status === "neutral") {
        tr.relation = -100;
        tr.peace = 0;
        // Defenders (and warriors) answer an attack by marching on your village.
        if ((tr.rival.retaliate || tr.kind === "warriors") && !tr.retaliated) {
          tr.retaliated = true;
          setTimeout(() => warParty(tr), 6000);
        }
      }
    }
    if (u.health <= 0) kill(u);
  }
  function kill(u) {
    u.dead = true;
    u.body.die();
    o.sfx("death");
    T.selected.delete(u);
    if (u.mine) {
      if (u.chief) {
        T.chiefRespawn = 12;
        toast("Your chief has fallen. A new chief will rise at the hut.", 4);
      }
    } else if (u.raid && u.carry) {
      // Stolen food is dropped where the raider falls.
      T.food += u.carry;
      pop(u.pos.x, u.pos.z, "+" + u.carry + " 🍖", "good");
    }
    setTimeout(() => removeUnit(u), 2200);
  }

  /** A gatherer's next job: the nearest fruit near the village, or fishing if the tribe eats meat. */
  function autoJob(u) {
    if (canGather(diet, "fruit")) {
      const f = nearestFruit(HOME, 48);
      if (f) return { type: "gather", origin: { x: f.x, z: f.z }, fruit: null };
    }
    if (canGather(diet, "fish") && fishSpots.length) {
      const spot = [...fishSpots].sort((a, b) => distTo(u, a.stand) - distTo(u, b.stand))[0];
      return { type: "fish", spot };
    }
    return null;
  }
  function updateMine(u, dt) {
    if (u.child) {
      u.child -= dt;
      if (u.child <= 0) {
        u.child = 0;
        u.scale = 1;
        u.body.root.scale.setScalar(1);
        pop(u.pos.x, u.pos.z, "✦", "good");
        o.sfx("unlock");
      }
      return idle(u, HOME, dt, 3, 7);
    }
    const task = u.task;
    if (!task) {
      // Stand guard: anything hostile close by gets chased off (guards watch further, from the fire).
      const foe = nearestFoe(u, u.role === "guard" ? 18 : 9);
      if (foe) {
        u.task = { type: "fight", target: foe, guard: true };
        return;
      }
      if (u.role === "gather" && (u.roleClock = (u.roleClock || 0) - dt) <= 0) {
        u.roleClock = 1.5;
        const job = autoJob(u);
        if (job) {
          u.task = job;
          return;
        }
      }
      if (u.role === "guard" && distTo(u, FIRE) > 7) {
        walk(u, FIRE.x + Math.cos(u.id) * 4, FIRE.z + Math.sin(u.id) * 4, 4.4, dt, 1);
        return;
      }
      u.speed += (0 - u.speed) * Math.min(1, dt * 8);
      return;
    }
    if (task.type === "move") {
      if (walk(u, task.x, task.z, 5, dt)) u.task = null;
    } else if (task.type === "retreat") {
      // Running home: no stopping to fight. Whatever they carried goes on the pile.
      if (walk(u, task.x, task.z, 6, dt, 1)) {
        if (u.carry) {
          T.food += u.carry;
          pop(PILE.x, PILE.z, "+" + u.carry + " 🍖", "good");
          u.carry = 0;
        }
        u.task = null;
      }
    } else if (task.type === "repair") {
      const at = task.what === "hut" ? HOME : SHACK[task.what];
      const hp = () => (task.what === "hut" ? T.hutHp : SHACK[task.what]?.hp ?? 1);
      if (!at || hp() >= 1) {
        u.task = task.what !== "hut" && SHACK[task.what] ? { type: "equip", tool: task.what } : null;
        return;
      }
      if (!walk(u, at.x, at.z, 5, dt, task.what === "hut" ? 4 : 2.4)) return;
      face(u, at.x, at.z);
      u.work += dt;
      if (u.work >= 1) {
        u.work = 0;
        u.body.playAbility("strike");
        o.sfx("chop", { pitch: 1.2, gain: 0.4 });
        if (task.what === "hut") {
          T.hutHp = Math.min(1, T.hutHp + 0.06 / hutLevel(T.hutLevel).hp);
          styleMyHut();
          if (T.hutHp >= 1) {
            toast("The hut is repaired.");
            pop(HOME.x, HOME.z, "🛖 ✓", "good");
          }
        } else {
          const sh = SHACK[task.what];
          sh.hp = Math.min(1, sh.hp + 0.12);
          if (sh.hp >= 1 || sh.hp >= 0.5) buildShack(task.what);
        }
      }
    } else if (task.type === "raid") {
      // Steal from a rival's food store and run home with it.
      const tr = task.tribe;
      if (tr.status === "conquered") {
        u.task = null;
        return;
      }
      if (u.carry > 0 || task.empty) {
        if (walk(u, PILE.x, PILE.z, 5.6, dt, 2.4)) {
          if (u.carry) {
            T.food += u.carry;
            pop(PILE.x, PILE.z, "+" + u.carry + " 🍖", "good");
            o.sfx("eat");
          }
          u.carry = 0;
          u.task = null;
        }
        return;
      }
      const store = { x: tr.center.x + 6, z: tr.center.z + 1 };
      if (!walk(u, store.x, store.z, 5.4, dt, 2)) return;
      u.work += dt;
      if (u.work >= 1.2) {
        u.work = 0;
        const take = Math.min(RAID_TAKE, Math.floor(tr.food));
        tr.food -= take;
        u.carry = take;
        task.empty = !take;
        pop(store.x, store.z, take ? "−" + take + " 🍖" : "…", take ? "bad" : "");
        u.body.playAbility("bite");
        // Caught in the act: they're furious, and they fight.
        if (tr.status === "neutral") {
          tr.relation = clampRelation(tr.relation - 30);
          tr.war = Math.max(tr.war, 20);
          tr.peace = 0;
        } else if (tr.status === "allied") {
          // Robbing an ally breaks the alliance.
          tr.status = "neutral";
          tr.relation = -40;
          tr.war = 20;
          tr.hut.flagMat.color.set(tr.color);
          toast("You robbed your allies. The " + tr.name + " tribe has broken the alliance!", 4.5);
        }
      }
    } else if (task.type === "equip") {
      const at = SHACK[task.tool];
      if (walk(u, at.x, at.z, 5, dt, 2.6)) {
        setTool(u, task.tool);
        pop(u.pos.x, u.pos.z, TOOLS[task.tool].icon, "good");
        o.sfx("click");
        u.task = null;
      }
    } else if (task.type === "gather" || task.type === "fish") {
      const kind = task.type === "gather" ? "fruit" : "fish";
      if (u.carry >= carryOf(u, kind) || task.deliver) {
        // Home with the food, then straight back out.
        if (walk(u, PILE.x, PILE.z, 4.6, dt, 2.4)) {
          if (u.carry) {
            T.food += u.carry;
            pop(PILE.x, PILE.z, "+" + u.carry + " 🍖", "good");
            o.sfx("eat");
            u.carry = 0;
          }
          task.deliver = false;
        }
        return;
      }
      if (kind === "fish") {
        const s = task.spot;
        // Side by side along the waterline rather than on one spot.
        const side = ((u.id % 3) - 1) * 1.7,
          len = Math.hypot(s.x, s.z) || 1;
        if (!walk(u, s.stand.x + (-s.z / len) * side, s.stand.z + (s.x / len) * side, 5, dt, 1)) return;
        face(u, s.x, s.z);
        u.work += dt * (u.tool === "staff" ? 2 : 1);
        if (u.work >= 2.4) {
          u.work = 0;
          u.body.playAbility(u.tool === "staff" ? "strike" : "bite");
          o.sfx("splash");
          u.carry += u.tool === "staff" ? 3 : 2;
          pop(s.x, s.z, "🐟");
        }
        return;
      }
      if (!task.fruit || !task.fruit.alive) {
        if (task.fruit) task.fruit.claimed = false;
        task.fruit = nearestFruit(task.origin, 26);
        if (task.fruit) task.fruit.claimed = true;
        u.work = 0;
      }
      if (!task.fruit) {
        // Picked clean: bring back what there is, then rest.
        if (u.carry) task.deliver = true;
        else {
          u.task = null;
          pop(u.pos.x, u.pos.z, "…");
          tipOnce("bare", "That patch is picked clean. Fruit grows back; try other bushes meanwhile.");
        }
        return;
      }
      if (!walk(u, task.fruit.x, task.fruit.z, 5, dt, 1.7)) return;
      face(u, task.fruit.x, task.fruit.z);
      if (u.work === 0) u.body.playAbility(u.tool === "staff" ? "strike" : "bite");
      u.work += dt * (u.tool === "staff" ? 2 : 1);
      if (u.work >= 1.1) {
        u.work = 0;
        task.fruit.alive = false;
        task.fruit.claimed = false;
        task.fruit.regrow = 50;
        task.fruit = null;
        world.syncFruit();
        u.carry++;
        o.sfx("eat", { gain: 0.5 });
      }
    } else if (task.type === "perform") {
      const tr = task.tribe;
      if (tr.status !== "neutral" || !INSTRUMENTS.includes(u.tool)) {
        u.task = null;
        return;
      }
      // Line up in an arc on the home side of their fire.
      const toHome = Math.atan2(HOME.z - tr.center.z, HOME.x - tr.center.x);
      const a = toHome + (task.slot - 1) * 0.45;
      const sx = tr.center.x + Math.cos(a) * 9,
        sz = tr.center.z + Math.sin(a) * 9;
      if (!walk(u, sx, sz, 5, dt, 0.8)) return;
      face(u, tr.center.x, tr.center.z);
      // In place: part of the band. The tribe calls for instruments; you play them.
      tr.band.push(u);
    } else if (task.type === "attack") {
      const tr = task.tribe;
      if (tr.status !== "neutral") {
        u.task = null;
        return;
      }
      if (!task.target || task.target.dead) {
        task.target = null;
        let best = 40;
        for (const m of membersOf(tr)) {
          const d = dist(u, m);
          if (d < best && distTo(m, tr.center) < 34) {
            best = d;
            task.target = m;
          }
        }
      }
      if (task.target) strike(u, task.target, dt);
      else {
        // Nobody left to stop you: bring the hut down.
        if (!walk(u, tr.center.x, tr.center.z, 5.2, dt, 4.4)) return;
        face(u, tr.center.x, tr.center.z);
        if (u.cool > 0) return;
        u.cool = 1;
        u.body.playAbility(weapon(u) === "none" ? "bite" : "strike");
        o.sfx("chop");
        tr.relation = -100;
        tr.hutHealth -= HUT_DAMAGE[weapon(u)] * (u.chief ? 1.4 : 1);
        if (u.tool === "torch") setBurning(tr);
        tr.hut.group.rotation.z = (Math.random() - 0.5) * 0.05;
        if (tr.hutHealth <= 0) conquer(tr);
      }
    } else if (task.type === "fight") {
      if (!strike(u, task.target, dt) || (task.guard && distTo(u, HOME) > 30)) u.task = null;
    } else if (task.type === "hunt") {
      // Chase the animal down; once it falls, butcher it and carry the meat home.
      if (task.target.dead) {
        const c = T.carcasses.find((k) => k.from === task.target);
        u.task = c ? { type: "haul", carcass: c } : null;
        return;
      }
      strike(u, task.target, dt);
    } else if (task.type === "haul") {
      const c = task.carcass;
      if (u.carry > 0 && (u.carry >= carryOf(u, "fish") || c.food <= 0)) {
        if (walk(u, PILE.x, PILE.z, 4.6, dt, 2.4)) {
          T.food += u.carry;
          pop(PILE.x, PILE.z, "+" + u.carry + " 🍖", "good");
          o.sfx("eat");
          u.carry = 0;
          if (c.food <= 0) u.task = null;
        }
        return;
      }
      if (c.food <= 0) {
        u.task = null;
        return;
      }
      if (!walk(u, c.x, c.z, 5, dt, 1.6)) return;
      face(u, c.x, c.z);
      u.work += dt;
      if (u.work >= 0.9) {
        u.work = 0;
        u.body.playAbility("bite");
        const take = Math.min(2, c.food);
        c.food -= take;
        u.carry += take;
        syncCarcass(c);
      }
    }
  }
  /** Members with a gathering staff carry half as much again. */
  const carryOf = (u, kind) => Math.ceil(CARRY[kind] * (u.tool === "staff" ? 1.5 : 1)) + legacy.carry;
  function nearestFoe(u, radius) {
    let best = null,
      bestD = radius;
    for (const v of T.units) {
      if (v.dead || v.child || v === u) continue;
      let hostile;
      if (u.mine) hostile = !v.mine && (v.raid || v.warParty || v.tribe.war > 0);
      else if (u.helping) hostile = !v.mine && v.tribe !== u.tribe && (v.raid || v.warParty);
      else hostile = v.mine && (u.tribe.war > 0 || u.raid || u.warParty);
      if (!hostile) continue;
      const d = dist(u, v);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }
  /** The nearest building of yours a raider can knock about: the hut, or a standing shack. */
  function nearestBuilding(u) {
    let best = { what: "hut", x: HOME.x, z: HOME.z },
      bd = distTo(u, HOME) - 3;
    for (const [id, sh] of Object.entries(SHACK)) {
      if (sh.hp <= 0) continue;
      const d = distTo(u, sh);
      if (d < bd) (bd = d), (best = { what: id, x: sh.x, z: sh.z });
    }
    return best;
  }
  /** A blow against one of your buildings. */
  function wreck(u, b) {
    u.body.playAbility("strike");
    o.sfx("chop", { pitch: 0.8, gain: 0.5 });
    if (b.what === "hut") {
      const was = T.hutHp;
      T.hutHp = Math.max(0, T.hutHp - 0.05 / hutLevel(T.hutLevel).hp);
      styleMyHut();
      if (was >= 0.5 && T.hutHp < 0.5) toast("Your hut is badly damaged! Select members and tap it to repair.", 4.5);
      if (was > 0 && T.hutHp <= 0) toast("Your hut is wrecked: no babies until it's repaired.", 4.5);
    } else {
      const sh = SHACK[b.what];
      const was = sh.hp;
      sh.hp = Math.max(0, sh.hp - 0.15);
      if (was >= 0.5 && sh.hp < 0.5) buildShack(b.what);
    }
    pop(b.x, b.z, "💥", "bad");
  }
  /** A tribe you attacked marches on your village to pay you back. */
  function warParty(tr) {
    if (tr.status !== "neutral" || tr.war <= 0) return;
    const party = membersOf(tr).filter((m) => !m.raid);
    // Up to four of them; the rest stay home to guard it.
    party.slice(0, Math.min(4, Math.max(1, party.length - 1))).forEach((m) => {
      m.warParty = true;
      m.task = null;
    });
    o.sfx("roar");
    toast("The " + tr.name + " " + tr.rival.name.toLowerCase() + " are marching on your village!", 4.5);
    callAllies(tr);
  }
  /** Your allies send help when your village is attacked. */
  function callAllies(enemy) {
    let sent = 0;
    for (const al of T.tribes) {
      if (al.status !== "allied" || al === enemy) continue;
      membersOf(al)
        .filter((m) => !m.helping)
        .slice(0, 2)
        .forEach((m) => {
          m.helping = 50;
          m.task = null;
          sent++;
        });
    }
    if (sent) toast("Your allies are sending " + sent + " to help defend the village.", 3.5);
  }
  /** Amble about a centre. */
  function idle(u, centre, dt, r0, r1) {
    u.think -= dt;
    if (u.think <= 0) {
      u.think = 2.5 + Math.random() * 4;
      u.wander = Math.random() < 0.7 ? around(centre, r0, r1) : null;
    }
    if (u.wander) {
      if (walk(u, u.wander.x, u.wander.z, 2.2, dt, 0.6)) u.wander = null;
    } else u.speed += (0 - u.speed) * Math.min(1, dt * 8);
  }
  function updateTheirs(u, dt) {
    const tr = u.tribe;
    if (u.child) {
      u.child = Math.max(0, u.child - dt);
      if (!u.child) {
        u.scale = 1;
        u.body.root.scale.setScalar(1);
      }
      return idle(u, tr.center, dt, 2, 5);
    }
    if (u.task?.type === "fight") {
      // Break off when badly hurt or dragged too far from home.
      const far = distTo(u, tr.center) > 46 && !u.raid && !u.warParty && !u.helping;
      if (!strike(u, u.task.target, dt) || far) u.task = null;
      if ((u.raid || u.warParty) && u.health < u.maxHealth * 0.35) {
        u.task = null;
        u.fleeing = true;
      }
      return;
    }
    if (u.helping > 0) {
      // An ally's warrior standing guard at your village.
      u.helping -= dt;
      const foe = nearestFoe(u, 16);
      if (foe) {
        u.task = { type: "fight", target: foe };
        return;
      }
      if (u.helping <= 0) u.helping = 0;
      else return idle(u, FIRE, dt, 3, 8);
    }
    if (u.warParty) {
      // They go home once they've made their point (or been beaten back).
      if (u.fleeing || tr.status !== "neutral" || T.hutHp < 0.25) {
        if (walk(u, tr.center.x, tr.center.z, 5.6, dt, 7)) u.warParty = u.fleeing = false;
        return;
      }
      const foe = nearestFoe(u, 12);
      if (foe) {
        u.task = { type: "fight", target: foe };
        return;
      }
      // Nobody to fight: smash what they can.
      const bld = nearestBuilding(u);
      if (!walk(u, bld.x, bld.z, 5.2, dt, bld.what === "hut" ? 4 : 2.4)) return;
      face(u, bld.x, bld.z);
      if (u.cool > 0) return;
      u.cool = 1.6;
      wreck(u, bld);
      if ((u.hits = (u.hits || 0) + 1) >= 6) (u.fleeing = true), (u.hits = 0);
      return;
    }
    if (u.raid) {
      if (u.carry || u.fleeing || tr.status !== "neutral") {
        // Home with the loot (or with nothing, if routed).
        if (walk(u, tr.center.x, tr.center.z, 5.6, dt, 7)) {
          tr.food += u.carry;
          u.raid = false;
          u.fleeing = false;
          u.carry = 0;
          u.hits = 0;
        }
        return;
      }
      const foe = nearestFoe(u, 5);
      if (foe) {
        u.task = { type: "fight", target: foe };
        return;
      }
      if (u.wrecking) {
        // The pile was bare: they take it out on your buildings instead.
        const bld = nearestBuilding(u);
        if (!walk(u, bld.x, bld.z, 5, dt, bld.what === "hut" ? 4 : 2.4)) return;
        face(u, bld.x, bld.z);
        if (u.cool > 0) return;
        u.cool = 1.8;
        wreck(u, bld);
        if ((u.hits = (u.hits || 0) + 1) >= 3) (u.fleeing = true), (u.wrecking = false);
        return;
      }
      if (walk(u, PILE.x, PILE.z, 4.8, dt, 2.6)) {
        u.work += dt;
        if (u.work > 1.2) {
          u.work = 0;
          const take = Math.min(5, Math.floor(T.food));
          T.food -= take;
          u.carry = take;
          if (take) {
            pop(PILE.x, PILE.z, "−" + take + " 🍖", "bad");
            o.sfx("damage");
          } else u.wrecking = true;
        }
      }
      return;
    }
    if (tr.war > 0) {
      const foe = nearestFoe(u, 18);
      if (foe) {
        u.task = { type: "fight", target: foe };
        return;
      }
    }
    if (u.visiting > 0) {
      // A trader at your fire with goods to show. Tap them to trade.
      u.visiting -= dt;
      const spot = { x: FIRE.x + 2.5, z: FIRE.z + 2.5 };
      if (u.visiting > 0 && tr.status !== "conquered") {
        if (walk(u, spot.x, spot.z, 3.2, dt, 1)) {
          face(u, HOME.x, HOME.z);
          u.think -= dt;
          if (u.think <= 0) {
            u.think = 4;
            perform(u, "charm");
          }
        }
        return;
      }
      u.visiting = 0;
    }
    if (u.task?.type === "hunt" || u.task?.type === "haul") return huntForTribe(u, dt);
    if (tr.watching > 0 && tr.status === "neutral") {
      // An audience: gather on the near side of the fire, watch, and join in when they like it.
      const toHome = Math.atan2(HOME.z - tr.center.z, HOME.x - tr.center.x);
      const a = toHome + ((u.id % 5) - 2) * 0.5;
      if (walk(u, tr.center.x + Math.cos(a) * 4, tr.center.z + Math.sin(a) * 4, 3, dt, 0.8)) {
        face(u, tr.center.x + Math.cos(toHome) * 9, tr.center.z + Math.sin(toHome) * 9);
        u.think -= dt;
        if (u.think <= 0) {
          u.think = 2 + Math.random() * 3;
          if (tr.relation > 20) perform(u, Math.random() < 0.5 ? "dance" : "charm");
        }
      }
      return;
    }
    // Musicians make music at their fire anyway.
    if (tr.kind === "musicians" && u.tool === "horn" && Math.random() < dt * 0.08) perform(u, "sing");
    idle(u, tr.center, dt, 3, 9);
  }
  /** Hunters (and any hungry meat-eating tribe) chase the herds and carry the meat home. */
  function huntForTribe(u, dt) {
    const tr = u.tribe,
      task = u.task;
    if (task.type === "hunt") {
      if (task.target.dead) {
        const c = T.carcasses.find((k) => k.from === task.target);
        u.task = c ? { type: "haul", carcass: c } : null;
        return;
      }
      if (distTo(task.target, tr.center) > 80) {
        u.task = null;
        return;
      }
      strike(u, task.target, dt);
      return;
    }
    const c = task.carcass;
    if (u.carry > 0 && (u.carry >= 4 || c.food <= 0)) {
      if (walk(u, tr.center.x + 6, tr.center.z + 1, 4.4, dt, 2.4)) {
        tr.food += u.carry;
        u.carry = 0;
        if (c.food <= 0) u.task = null;
      }
      return;
    }
    if (c.food <= 0) {
      u.task = null;
      return;
    }
    if (!walk(u, c.x, c.z, 4.6, dt, 1.6)) return;
    u.work += dt;
    if (u.work >= 1) {
      u.work = 0;
      u.body.playAbility("bite");
      const take = Math.min(2, c.food);
      c.food -= take;
      u.carry += take;
      syncCarcass(c);
    }
  }

  /* ---- the tribal social game ---------------------------------------------------------------
     As in Spore: once your band stands at a tribe's fire, the tribe calls for an instrument. Play it
     before the timer runs out and their mood rises (more players, more); play the wrong one, or
     nothing, and it drops. Fill the meter and they ally with you. */
  /** The tribe your band is playing for right now (the one with most of your band there). */
  function stageTribe() {
    let best = null;
    for (const tr of T.tribes) if (tr.status === "neutral" && tr.watching > 0 && (!best || tr.watching > best.watching)) best = tr;
    return best;
  }
  function updateCalls(tr, dt) {
    if (!tr.band.length) {
      tr.ask = null;
      return;
    }
    if (!tr.ask) {
      if ((tr.rest -= dt) > 0) return;
      const owned = [...new Set(tr.band.map((u) => u.tool))];
      tr.ask = nextAsk(tr.lastAsk, owned);
      tr.lastAsk = tr.ask;
      // Musicians are patient listeners: a little longer to answer.
      tr.askMax = ASK_TIME * (tr.kind === "musicians" ? 1.25 : 1);
      tr.askT = tr.askMax;
      // Their chief demonstrates: one of them performs, and a note of the instrument sounds.
      const lead = membersOf(tr)[0];
      if (lead) perform(lead, "sing");
      o.sfx("horn", { pitch: INSTRUMENT_PITCH[tr.ask] * 0.8, gain: 0.5 });
      return;
    }
    tr.askT -= dt;
    if (tr.askT <= 0) answer(tr, null);
  }
  const INSTRUMENT_PITCH = { horn: 1, maracas: 1.5, didgeridoo: 0.6 };
  /** You pressed an instrument: everyone in the band holding it plays. */
  function playInstrument(id) {
    const tr = stageTribe();
    if (!tr) return;
    const players = tr.band.length ? tr.band : membersBandFor(tr);
    const holding = players.filter((u) => u.tool === id);
    if (!holding.length) {
      toast("Nobody in your band holds " + TOOLS[id].name.toLowerCase() + ".");
      return;
    }
    holding.forEach((u, i) => perform(u, i % 2 ? "dance" : "sing"));
    o.sfx("horn", { pitch: INSTRUMENT_PITCH[id], gain: 0.9 });
    if (tr.ask) answer(tr, id, holding.length);
  }
  /** Performers in place at a tribe (the per-frame list is rebuilt during updates). */
  const membersBandFor = (tr) => mine().filter((u) => u.task?.type === "perform" && u.task.tribe === tr && distTo(u, tr.center) < 11);
  function answer(tr, played, count = 0) {
    const right = played === tr.ask;
    // Missing a call you couldn't have answered (nobody holds that instrument) costs half as much.
    const couldnt = !played && !(tr.band.length ? tr.band : membersBandFor(tr)).some((u) => u.tool === tr.ask);
    // Bronze instruments carry further: the band plays louder for each player holding one.
    const bronze = right && T.tools[played] >= 2 ? tierMult(played, 2) : 1;
    tr.relation = couldnt ? clampRelation(tr.relation - SOCIAL_MISS / 2) : musicAnswer(tr.relation, tr.rival, right ? count : 0, bronze * legacy.music);
    tr.ask = null;
    tr.rest = 0.8;
    bumpArc(right ? "good" : "miss");
    if (right) {
      pop(tr.center.x, tr.center.z, "♪", "good");
      // They like it: a few of them dance along.
      membersOf(tr)
        .slice(0, 3)
        .forEach((m) => perform(m, "dance"));
    } else {
      pop(tr.center.x, tr.center.z, played ? "✖" : "⌛", "bad");
      o.sfx("snub", { gain: 0.6 });
    }
    if (tr.relation >= 100) ally(tr);
  }
  function bumpArc(kind) {
    const el = $h("#trArc");
    el.classList.remove("good", "miss");
    void el.offsetWidth;
    el.classList.add(kind);
  }
  /** A gift of food: a quick boost to a tribe's mood, once in a while. */
  function sendGift(tr) {
    if (tr.status !== "neutral") return;
    if (tr.giftCool > 0) return toast("They need a little time before another gift.");
    if (T.food < GIFT.food) return toast("A gift needs " + GIFT.food + " food.");
    T.food -= GIFT.food;
    tr.giftCool = 25;
    tr.relation = clampRelation(tr.relation + (giftAnswer(tr.relation, tr.rival, diet !== "plant") - tr.relation) * legacy.gift);
    tr.food += GIFT.food * 0.6;
    tr.war = 0;
    pop(tr.center.x, tr.center.z, "🎁", "good");
    pop(PILE.x, PILE.z, "−" + GIFT.food + " 🍖", "bad");
    o.sfx("friend", { gain: 0.6 });
    if (tr.relation >= 100) ally(tr);
    else renderSheet();
  }

  /** Peace with a tribe that is at war with you, or furious: food buys a clean slate and a truce. */
  function makePeace(tr) {
    if (!canMakePeace(tr)) return;
    const cost = peaceCost(tr.rival);
    if (T.food < cost) return toast("Peace with the " + tr.rival.name.toLowerCase() + " costs " + cost + " food.");
    T.food -= cost;
    tr.food += cost * 0.6;
    tr.relation = Math.max(tr.relation, PEACE_RELATION);
    tr.war = 0;
    tr.peace = 180; // no raids for three minutes
    tr.retaliated = false;
    membersOf(tr).forEach((m) => {
      if (m.raid || m.warParty) m.fleeing = true;
      if (m.task?.type === "fight" && m.task.target?.mine) m.task = null;
    });
    // Your own fighters stand down too.
    mine().forEach((u) => {
      if ((u.task?.type === "attack" && u.task.tribe === tr) || (u.task?.type === "fight" && u.task.target?.tribe === tr)) u.task = null;
    });
    pop(tr.center.x, tr.center.z, "🕊", "good");
    o.sfx("friend", { gain: 0.6 });
    toast("The " + tr.name + " tribe accepts your peace offering. They'll leave you alone for a while.", 4);
    renderSheet();
    saveState();
  }
  /** Food for a tool you haven't built: the tribe builds the shack for you. */
  function trade(tr, tool, price) {
    const offer = tradeOffers(tr, tr.rival, T.tools).find((of) => of.tool === tool);
    if (!offer || offer.price !== price) return;
    if (T.food < price) return toast("That costs " + price + " food.");
    // Find a free spot for the shack near the village.
    let at = arcSpot(tool);
    for (let k = 0; k < 60 && canPlace(at, HOME, takenSpots(), heightAt); k++) at = around(HOME, 8, 21);
    if (canPlace(at, HOME, takenSpots(), heightAt)) return toast("There's no room left near the hut for another shack.");
    T.food -= price;
    tr.food += price * 0.6;
    if (tr.status === "neutral") tr.relation = clampRelation(tr.relation + 6);
    T.tools[tool] = 1;
    SHACK[tool] = { x: at.x, z: at.z, hp: 1 };
    buildShack(tool);
    o.sfx("build");
    pop(at.x, at.z, TOOLS[tool].icon, "good");
    toast("Traded for " + TOOLS[tool].name.toLowerCase() + ": the " + tr.name + " tribe built you a shack.", 4);
    if (tr.relation >= 100 && tr.status === "neutral") ally(tr);
    else renderSheet();
    saveState();
  }
  /** One of your allies' people joins your tribe. */
  function recruit(tr) {
    const theirs = membersOf(tr).filter((m) => !m.helping && !m.visiting);
    if (!canRecruit(tr, membersOf(tr).length) || !theirs.length) return toast("They can't spare anyone right now.");
    if (mine().length + T.eggs.length >= room()) return toast("Your village is full. Enlarge the hut (🔨) to make room.");
    if (T.food < RECRUIT_COST) return toast("A recruit costs " + RECRUIT_COST + " food.");
    T.food -= RECRUIT_COST;
    tr.food += RECRUIT_COST * 0.6;
    const m = theirs[theirs.length - 1];
    const at = { x: m.pos.x, z: m.pos.z };
    removeUnit(m);
    const u = makeUnit(null, tr.species.record, at.x, at.z, { from: tr.index });
    u.task = { type: "move", ...around(FIRE, 2.5, 5) };
    pop(at.x, at.z, "🤝", "good");
    o.sfx("friend");
    toast("A " + tr.name + " joins your tribe. They'll head for your fire.", 4);
    renderSheet();
    saveState();
  }

  /* ---- tribes: friendship, conquest, raids, gifts ------------------------------------- */
  function ally(tr) {
    tr.status = "allied";
    tr.relation = 100;
    tr.war = 0;
    tr.hut.flagMat.color.set(0x3fc26e);
    membersOf(tr).forEach((m) => {
      m.raid = false;
      m.warParty = false;
      m.task = null;
      perform(m, "dance");
    });
    T.units.forEach((u) => {
      if (u.task && u.task.tribe === tr) u.task = null;
    });
    T.food += 10;
    o.sfx("friend");
    toast("The " + tr.name + " " + tr.rival.name.toLowerCase() + " are now your allies! They sent a gift of food.", 4.5);
    chronicle({ key: "tribe:ally:" + tr.kind, stage: "tribe", icon: "🤝", text: "Allied with the " + tr.name + " " + tr.rival.name.toLowerCase() + "." });
    // Musicians teach you an instrument you don't have.
    if (tr.kind === "musicians") {
      const gift = INSTRUMENTS.find((id) => !T.tools[id]);
      if (gift) {
        let at = arcSpot(gift);
        for (let k = 0; k < 60 && canPlace(at, HOME, takenSpots(), heightAt); k++) at = around(HOME, 8, 21);
        if (!canPlace(at, HOME, takenSpots(), heightAt)) {
          T.tools[gift] = 1;
          SHACK[gift] = { x: at.x, z: at.z, hp: 1 };
          buildShack(gift);
          setTimeout(() => toast("The musicians built you a " + TOOLS[gift].name.toLowerCase() + " shack as a gift.", 4), 4800);
        }
      }
    }
    settle();
  }
  function conquer(tr) {
    tr.status = "conquered";
    tr.hutHealth = 0;
    ruinHut(tr);
    membersOf(tr).forEach((m) => kill(m));
    T.units.forEach((u) => {
      if (u.task && u.task.tribe === tr) u.task = null;
    });
    T.food += 25;
    o.sfx("roar");
    toast("You conquered the " + tr.name + " tribe and took their food.", 4.5);
    chronicle({ key: "tribe:conquer:" + tr.kind, stage: "tribe", icon: "⚔", text: "Conquered the " + tr.name + " " + tr.rival.name.toLowerCase() + "." });
    settle();
  }
  function settle() {
    closeSheet();
    saveState();
    const v = victoryPath(T.tribes);
    if (!T.won && v) {
      T.won = true;
      T.path = v.path;
      saveState();
      chronicle({ key: "tribe:won", stage: "tribe", icon: v.icon, text: "Settled the island and earned the " + v.trait + " trait." });
      setTimeout(() => {
        o.sfx("unlock");
        openSheet("won");
      }, 2500);
    } else tipOnce("room", "Your village can now hold " + room() + " members.", 4);
  }
  function updateTribes(dt) {
    for (const tr of T.tribes) {
      tr.war = Math.max(0, tr.war - dt);
      tr.giftCool = Math.max(0, tr.giftCool - dt);
      if (tr.war <= 0) tr.retaliated = false;
      const alive = membersOf(tr);
      tr.alive = alive.length;
      // Their own lives: food, growth, tempers, raids.
      const ev = stepRival(tr, tr.rival, dt);
      if (ev.grow) {
        const u = spawnRival(tr, around(tr.center, 3, 6));
        u.child = 14;
        u.scale = 0.55;
        u.body.root.scale.setScalar(0.55);
      }
      if (tr.status === "neutral") {
        updateCalls(tr, dt);
        if (ev.raid && !alive.some((m) => m.raid)) {
          alive
            .filter((m) => !m.child && !m.visiting && !m.helping)
            .slice(0, Math.min(3, alive.length - 1))
            .forEach((m) => {
              m.raid = true;
              m.fleeing = m.wrecking = false;
              m.carry = 0;
              m.work = 0;
              m.task = null;
            });
          o.sfx("roar");
          toast("The " + tr.name + " " + tr.rival.name.toLowerCase() + (tr.hungry ? " are hungry, and raiding your food!" : " are raiding your food!"), 4);
          tipOnce("raid", "Raiders steal from your food pile, and smash buildings if it's bare. Members near the village fight them.", 5);
          callAllies(tr);
        }
      } else if (tr.status === "allied") {
        tr.giftClock -= dt;
        if (tr.giftClock <= 0) {
          tr.giftClock = 90;
          T.food += 8;
          pop(PILE.x, PILE.z, "+8 🍖", "good");
          if (Math.hypot(cam.x - HOME.x, cam.z - HOME.z) < 60) toast("A gift of food from the " + tr.name + " tribe.", 3);
        }
      }
      if (tr.status !== "conquered") {
        // Hungry meat-eaters go hunting.
        if ((tr.rival.hunt || tr.hungry) && tr.rival.diet !== "plant" && !alive.some((m) => m.task?.type === "hunt" || m.task?.type === "haul")) {
          const prey = T.animals.filter((a) => !a.dead && distTo(a, tr.center) < 70).sort((a, b) => distTo(a, tr.center) - distTo(b, tr.center))[0];
          if (prey && (tr.hungry || Math.random() < dt / 40))
            alive
              .filter((m) => !m.child && !m.raid && !m.warParty && !m.helping && !m.visiting && !m.task)
              .slice(0, 2)
              .forEach((m) => (m.task = { type: "hunt", target: prey }));
        }
        // Traders (and allies) visit your fire with goods.
        if ((tr.rival.trade || tr.status === "allied") && (tr.status === "allied" || (tr.relation >= -10 && tr.war <= 0))) {
          tr.visitClock -= dt;
          if (tr.visitClock <= 0) {
            tr.visitClock = 110 + Math.random() * 50;
            const v = alive.find((m) => !m.child && !m.raid && !m.task && !m.helping);
            if (v) {
              v.visiting = 40;
              if (Math.hypot(cam.x - HOME.x, cam.z - HOME.z) < 70) toast("A " + tr.name + " trader is coming to your fire. Tap them to trade.", 4);
            }
          }
        }
      }
      tr.watching = tr.band.length;
      tr.performers = tr.band.length;
      tr.band = []; // refilled by the performers each frame
    }
    // The warriors pick on the other tribes too, whether you're watching or not.
    const warriors = T.tribes.find((t) => t.kind === "warriors" && t.status === "neutral" && t.alive >= 3);
    if (warriors && (T.rivalRaidClock -= dt) <= 0) {
      T.rivalRaidClock = 160 + Math.random() * 90;
      const vi = rivalRaidTarget(T.tribes, warriors.index);
      const victim = T.tribes[vi];
      if (victim) {
        const took = Math.min(10, Math.floor(victim.food));
        victim.food -= took;
        warriors.food += took;
        const lost = Math.random() < 0.35 ? membersOf(victim).filter((m) => !m.helping && !m.visiting)[0] : null;
        if (lost) kill(lost);
        if (victim.status === "allied") {
          toast("The warriors raided your allies, the " + victim.name + " tribe" + (lost ? ", and one of them fell." : ".") + " Send fighters to help?", 5);
        } else if (Math.hypot(cam.x - victim.center.x, cam.z - victim.center.z) < 70) toast("The warriors are raiding the " + victim.name + " tribe.", 3.5);
        // Shared enemies: the victims warm to you a little if you're also at odds with the warriors.
        if (victim.status === "neutral" && warriors.relation < -30) victim.relation = clampRelation(victim.relation + 6);
      }
    }
  }

  /* ---- saving --------------------------------------------------------------------------- */
  function saveState() {
    try {
      localStorage.setItem(
        TRIBE_SAVE_KEY,
        JSON.stringify({
          v: 2,
          food: Math.round(T.food),
          tools: T.tools,
          units: mine().map((u) => ({ tool: u.tool, chief: u.chief, from: u.from, role: u.role })),
          structures: T.structures.map((st) => ({ id: st.id, x: Math.round(st.x * 10) / 10, z: Math.round(st.z * 10) / 10 })),
          tribes: T.tribes.map((t) => ({ relation: Math.round(t.relation), status: t.status, alive: membersOf(t).length, hut: t.hutHealth, food: Math.round(t.food), war: Math.round(t.war), peace: Math.round(t.peace || 0) })),
          won: T.won,
          path: T.path,
          hutLevel: T.hutLevel,
          hutHp: Math.round(T.hutHp * 100) / 100,
          shacks: Object.fromEntries(Object.entries(SHACK).map(([id, sh]) => [id, { x: Math.round(sh.x * 10) / 10, z: Math.round(sh.z * 10) / 10, hp: Math.round(sh.hp * 100) / 100 }])),
          look,
          region: regionId,
          time: Math.round(T.time0 + T.time),
        }),
      );
      o.onSaved?.();
    } catch (e) {
      /* storage unavailable: the game still plays */
    }
  }
  let saveClock = 20;

  /* ---- HUD refresh ------------------------------------------------------------------ */
  let unitsKey = "",
    tribesKey = "",
    hudClock = 0;
  const portrait = o.portrait ? o.portrait(record) || "" : "";
  const recruitPics = {};
  const recruitPortrait = (i) => (recruitPics[i] ??= o.portrait ? o.portrait(T.tribes[i].species.record) || "" : "");
  function updateHUD() {
    const own = mine();
    $h("#trFood").textContent = Math.floor(T.food);
    $h("#trPop").textContent = own.length + T.eggs.length + " / " + room();
    $h("#trHutLv").textContent = T.hutLevel + (T.hutHp < 1 ? " ⚠" : "");
    $h("#trBaby").setAttribute("aria-disabled", String(T.food < BABY_COST || own.length + T.eggs.length >= room() || T.hutHp < 0.3));
    const done = settled();
    $h("#trGoal").textContent = T.won
      ? "Tribal Stage complete · " + (victoryPath(T.tribes)?.title || "the island is settled")
      : T.placing
        ? "Placing a shack"
        : "Ally with or conquer the five rival tribes · " + done + " / " + T.tribes.length;
    // Member chips.
    const key = own.map((u) => u.id + (u.tool || "") + u.role + (u.child ? "c" : "") + (T.selected.has(u) ? "s" : "")).join(",");
    const list = $h("#trUnits");
    if (key !== unitsKey) {
      unitsKey = key;
      list.innerHTML = "";
      own.forEach((u) => {
        const b = document.createElement("button");
        b.className = "trUnit" + (T.selected.has(u) ? " sel" : "") + (u.child ? " child" : "");
        b.setAttribute("role", "listitem");
        b.setAttribute("aria-pressed", String(T.selected.has(u)));
        b.setAttribute("aria-label", (u.chief ? "Chief" : u.child ? "Child" : u.from >= 0 ? "Recruit from the " + T.tribes[u.from].name + " tribe" : "Member") + (u.tool ? " with " + TOOLS[u.tool].name.toLowerCase() : "") + (u.role !== "free" ? ", " + ROLES[u.role].name.toLowerCase() : ""));
        const pic = u.from >= 0 ? recruitPortrait(u.from) : portrait;
        b.innerHTML = (pic ? `<img src="${pic}" alt="" draggable="false">` : `<span class="noPic">🐾</span>`) + `<em>${u.chief ? "👑" : u.child ? "🍼" : u.tool ? TOOLS[u.tool].icon : ""}</em>${u.role !== "free" && !u.child ? `<s class="trRole" aria-hidden="true">${ROLES[u.role].icon}</s>` : ""}<i><b></b></i>`;
        b.onclick = () => {
          if (u.child) return toast("Children can't work yet. They grow up quickly.");
          if (T.selected.has(u) && T.selected.size === 1) T.selected.clear();
          else {
            T.selected.clear();
            T.selected.add(u);
          }
          o.sfx("click");
        };
        b.unit = u;
        list.appendChild(b);
      });
    }
    [...list.children].forEach((b) => {
      const frac = Math.max(0, b.unit.health / b.unit.maxHealth);
      b.querySelector("i b").style.width = frac * 100 + "%";
      b.classList.toggle("low", frac < 0.35);
    });
    // Neighbour faces along the top.
    const tk = T.tribes.map((t) => relationFace(t.relation, t.status) + t.status + (t.war > 0)).join(",");
    if (tk !== tribesKey) {
      tribesKey = tk;
      const el = $h("#trTribes");
      el.innerHTML = "";
      T.tribes.forEach((t) => {
        const f = RELATION_INFO[relationFace(t.relation, t.status)];
        const b = document.createElement("button");
        b.className = "trTribe " + t.status;
        b.setAttribute("role", "listitem");
        b.setAttribute("aria-label", t.name + " " + t.rival.name.toLowerCase() + ": " + (t.status === "conquered" ? "conquered" : t.status === "allied" ? "allies" : f.label) + ". Tap to look.");
        b.style.setProperty("--rel", t.status === "conquered" ? "#6b6b6b" : f.color);
        b.innerHTML = (t.status === "conquered" ? `<span>☠</span>` : `<img src="${f.face}" alt="" draggable="false">`) + `<em>${t.rival.icon}</em>`;
        b.onclick = () => {
          cam.x = t.center.x;
          cam.z = t.center.z;
          if (t.status !== "conquered") openSheet("tribe", t);
        };
        el.appendChild(b);
      });
    }
    // Labels over villages, and health bars over anyone hurt.
    let html = "";
    for (const t of T.tribes) {
      const pt = project(t.center.x, heightAt(t.center.x, t.center.z) + 9.5, t.center.z);
      if (pt.behind || pt.x < -80 || pt.x > innerWidth + 80 || pt.y < 0 || pt.y > innerHeight) continue;
      const f = RELATION_INFO[relationFace(t.relation, t.status)];
      html +=
        t.status === "conquered"
          ? `<span class="trMark gone" style="left:${pt.x}px;top:${pt.y}px">☠ ${esc(t.name)}</span>`
          : `<span class="trMark" style="left:${pt.x}px;top:${pt.y}px;--rel:${f.color}"><img src="${f.face}" alt="">${t.rival.icon} ${esc(t.name)}<i><b style="width:${t.hutHealth < 1 ? t.hutHealth * 100 : (t.relation + 100) / 2}%;background:${t.hutHealth < 1 ? "#ef4b48" : f.color}"></b></i></span>`;
    }
    let bars = 0;
    for (const u of T.units) {
      if (u.dead || u.health >= u.maxHealth || bars >= 24) continue;
      const pt = project(u.pos.x, u.pos.y + u.body.height * u.scale + 0.9, u.pos.z);
      if (pt.behind || pt.x < 0 || pt.x > innerWidth || pt.y < 0 || pt.y > innerHeight) continue;
      bars++;
      html += `<span class="trBar ${u.mine ? "" : "foe"}" style="left:${pt.x}px;top:${pt.y}px"><b style="width:${Math.max(0, (u.health / u.maxHealth) * 100)}%"></b></span>`;
    }
    // Visiting traders wear a basket over their heads.
    for (const u of T.units) {
      if (!u.visiting || u.dead) continue;
      const pt = project(u.pos.x, u.pos.y + u.body.height * u.scale + 1.4, u.pos.z);
      if (!pt.behind) html += `<span class="trMark trade" style="left:${pt.x}px;top:${pt.y}px">🧺</span>`;
    }
    $h("#trMarks").innerHTML = html;
    // The social arc and the band's instrument buttons, while you're playing for a tribe.
    const tr = stageTribe();
    $h("#trArc").hidden = !tr;
    $h("#trBand").hidden = !tr;
    hud.classList.toggle("playing", !!tr);
    if (tr) {
      const f = RELATION_INFO[relationFace(tr.relation, tr.status)];
      $h("#trArcFill").style.strokeDasharray = ((tr.relation + 100) / 2).toFixed(1) + " 100";
      const face = $h("#trArcFace");
      if (face.dataset.face !== f.face) {
        face.dataset.face = f.face;
        face.src = f.face;
        face.alt = f.label;
      }
      $h("#trArcLabel").textContent = tr.name + " tribe";
      const ask = $h("#trArcAsk");
      ask.hidden = !tr.ask;
      if (tr.ask) {
        if (ask.dataset.ask !== tr.ask + tr.lastAsk + Math.round(tr.relation)) {
          ask.dataset.ask = tr.ask + tr.lastAsk + Math.round(tr.relation);
          $h("#trArcAskIcon").textContent = TOOLS[tr.ask].icon;
          ask.setAttribute("aria-label", "They want to hear: " + TOOLS[tr.ask].name);
        }
        $h("#trArcTime").style.strokeDasharray = ((tr.askT / (tr.askMax || ASK_TIME)) * 100).toFixed(1) + " 100";
        ask.classList.toggle("hurry", tr.askT < (tr.askMax || ASK_TIME) * 0.3);
      }
      const held = new Set(tr.band.length ? tr.band.map((u) => u.tool) : membersBandFor(tr).map((u) => u.tool));
      hud.querySelectorAll("#trBand [data-play]").forEach((b) => {
        b.disabled = !held.has(b.dataset.play);
        b.classList.toggle("wanted", b.dataset.play === tr.ask);
      });
    }
    if (sheet?.kind === "tribe" && sheet.tribe.status === "neutral") {
      const bar = $h("#trSheet .tsRel b");
      if (bar) bar.style.width = (sheet.tribe.relation + 100) / 2 + "%";
    }
  }

  /* ---- frame ------------------------------------------------------------------------------ */
  function update(dt) {
    if (paused) return;
    T.time += dt;
    // Keyboard panning.
    const pan = cam.sd * dt * 0.9;
    if (keys.has("a") || keys.has("arrowleft")) cam.x -= pan;
    if (keys.has("d") || keys.has("arrowright")) cam.x += pan;
    if (keys.has("w") || keys.has("arrowup")) cam.z -= pan;
    if (keys.has("s") || keys.has("arrowdown")) cam.z += pan;
    clampCam();
    placeCamera(dt);
    world.update(dt, { x: cam.sx, z: cam.sz });

    updateTribes(dt);
    // Upkeep: every adult eats once a minute. Going short weakens them; nobody starves to death.
    if ((T.upkeepClock -= dt) <= 0) {
      T.upkeepClock = UPKEEP_EVERY;
      const adults = mine().filter((u) => !u.child);
      const { eat, short } = upkeep(Math.floor(T.food), adults.length);
      T.food -= eat;
      if (eat) pop(PILE.x, PILE.z, "−" + eat + " 🍖");
      if (short) {
        adults.slice(0, short).forEach((u) => (u.health = Math.max(1, u.health - u.maxHealth * 0.25)));
        toast("Not enough food: " + short + " of your tribe went hungry and are weaker. Gather, fish or hunt!", 4.5);
      } else tipOnce("upkeep", "Each adult eats one food a minute. Keep the pile stocked.", 4.5);
    }
    updateAnimals(dt);
    updateSpears(dt);
    updateBurning(dt);
    updateHealers(dt);
    for (const u of [...T.units]) {
      if (u.dead) {
        u.body.update(dt, 0);
        continue;
      }
      u.cool = Math.max(0, u.cool - dt);
      if (u.mine) updateMine(u, dt);
      else updateTheirs(u, dt);
      // Rest heals.
      if (u.health < u.maxHealth && T.time - u.hurtAt > 6) u.health = Math.min(u.maxHealth, u.health + dt * (u.mine && distTo(u, HOME) < 14 ? 6 * spiritHeal(decorCount()) : 2));
    }
    // Keep bodies from stacking.
    for (let i = 0; i < T.units.length; i++) {
      const a = T.units[i];
      if (a.dead) continue;
      for (let j = i + 1; j < T.units.length; j++) {
        const b = T.units[j];
        if (b.dead) continue;
        const dx = b.pos.x - a.pos.x,
          dz = b.pos.z - a.pos.z,
          d = Math.hypot(dx, dz),
          min = 0.75 * (a.scale + b.scale);
        if (d < min && d > 1e-3) {
          const push = (min - d) * 0.5 * Math.min(1, dt * 10);
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
    for (const u of T.units) {
      u.pos.y = Math.max(heightAt(u.pos.x, u.pos.z), -0.4);
      u.body.root.position.copy(u.pos);
      u.body.root.rotation.y = u.heading;
      if (!u.dead) u.body.update(dt, u.speed);
      // Selection rings.
      const sel = T.selected.has(u);
      if (sel && !u.ring) {
        u.ring = new THREE.Mesh(ringGeo, selMat);
        scene.add(u.ring);
      } else if (!sel && u.ring) {
        scene.remove(u.ring);
        u.ring = null;
      }
      if (u.ring) {
        u.ring.position.set(u.pos.x, u.pos.y + 0.14, u.pos.z);
        u.ring.scale.setScalar(u.scale * (1 + 0.06 * Math.sin(T.time * 6)));
      }
    }
    // Eggs hatch into children.
    for (let i = T.eggs.length - 1; i >= 0; i--) {
      const e = T.eggs[i];
      e.t -= dt;
      e.mesh.rotation.z = Math.sin(T.time * 9) * 0.12 * (e.t < 2 ? 1 : 0.2);
      if (e.t <= 0) {
        scene.remove(e.mesh);
        T.eggs.splice(i, 1);
        makeUnit(null, record, e.x, e.z, { child: true });
        pop(e.x, e.z, "🐣", "good");
        o.sfx("hatch");
        tipOnce("child", "A child! It will be grown and ready to work in a moment.");
      }
    }
    if (T.chiefRespawn > 0 && (T.chiefRespawn -= dt) <= 0) {
      const at = around(HOME, 3.5, 4.5);
      makeUnit(null, record, at.x, at.z, { chief: true });
      pop(at.x, at.z, "👑", "good");
      o.sfx("hatch");
    }
    // Fires flicker, ripples breathe, fish jump, order rings fade.
    fires.forEach((f, i) => {
      f.flame.scale.set(1 + Math.sin(T.time * 11 + i) * 0.12, 1 + Math.sin(T.time * 7 + i * 2) * 0.22, 1 + Math.cos(T.time * 9 + i) * 0.12);
    });
    fishSpots.forEach((f) => {
      const k = (T.time * 0.5 + f.phase) % 1;
      f.ripple.scale.setScalar(0.6 + k * 1.2);
      const j = (T.time * 0.35 + f.phase * 0.37) % 1;
      f.fish.position.y = -0.4 + Math.max(0, Math.sin(j * Math.PI * 6)) * (j < 0.17 ? 1.1 : 0);
      f.fish.rotation.z = j < 0.17 ? Math.cos(j * Math.PI * 6) * 0.9 : 0;
    });
    rippleMat.opacity = 0.55 + 0.25 * Math.sin(T.time * 2);
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t -= dt;
      f.m.scale.setScalar(0.4 + f.t * 2.4);
      if (f.t <= 0) {
        scene.remove(f.m);
        flashes.splice(i, 1);
      }
    }
    emotes.update(dt);
    syncPile();
    if ((hudClock -= dt) <= 0) {
      hudClock = 0.05;
      updateHUD();
    }
    if (toastTimer > 0 && (toastTimer -= dt) <= 0) $h("#trToast").classList.remove("show");
    if ((saveClock -= dt) <= 0) {
      saveClock = 20;
      saveState();
    }
  }

  placeCamera(1);
  updateHUD();
  if (!save) {
    setTimeout(showHelp, 400);
    chronicle({ key: "tribe:start", stage: "tribe", icon: "🛖", text: "Founded the " + look.name + " tribe in the " + world.region.name + "." });
  }

  return {
    record,
    update,
    render() {
      o.renderer.render(scene, camera);
    },
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
    setPaused(v) {
      paused = v;
      hud.hidden = v;
      if (v) {
        pointers.clear();
        gesture = null;
        keys.clear();
      }
    },
    save: saveState,
    debug: {
      T,
      cam,
      tap,
      project,
      haveBaby,
      buyTool,
      ally,
      conquer,
      fishSpots,
      world,
      HOME,
      PILE,
      FIRE,
      SHACK,
      look,
      openSheet,
      playInstrument,
      sendGift,
      setTool,
      hurtAnimal,
      stageTribe,
      heightAt,
      startPlacing,
      placeShack,
      upgradeTool,
      upgradeHut,
      trade,
      recruit,
      makePeace,
      warParty,
      retreat,
      boxSelect,
      formation,
      membersOf,
      get sheet() {
        return sheet;
      },
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      [...T.units].forEach(removeUnit);
      T.eggs.forEach((e) => scene.remove(e.mesh));
      T.animals.forEach((a) => a.body.dispose());
      T.carcasses.forEach((c) => scene.remove(c.mesh));
      T.spears.forEach((sp) => scene.remove(sp.m));
      emotes.dispose();
      world.dispose();
      disposables.forEach((d) => d.dispose());
      hud.remove();
    },
  };
}
