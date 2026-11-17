/**
 * Tribe Stage (early prototype).
 *
 * Your creatures have settled: a hut, a fire and a food pile on the beach where you first crawled
 * ashore. You no longer steer one creature; you direct the tribe from above. Gather, fish and hunt,
 * raise babies, build tool shacks (weapons, instruments, staffs), and deal with the three
 * neighbouring tribes: play the instruments they call for until they ally with you, send gifts, or
 * knock their hut down.
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
  answerCall,
  canGather,
  clampRelation,
  nextAsk,
  popCap,
  readTribeSave,
  relationFace,
  stageWon,
  willRaid,
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
 */
export function createTribeStage(o) {
  const canvas = o.renderer.domElement;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 600);
  const world = createIsland(scene, o.quality);
  scene.fog.near = 110;
  scene.fog.far = 320;
  const emotes = createEmotes(scene);
  const record = validateCreature(o.record);
  const diet = dietOfParts(record.parts.map((p) => p.id));
  const HOME = { x: ISLAND.nest.x, z: ISLAND.nest.z };
  const save = o.save || null;

  const T = {
    food: save ? save.food : START_FOOD,
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, !!save?.tools[id]])),
    units: [], // every creature in the world, yours and theirs
    tribes: [],
    selected: new Set(),
    eggs: [],
    time: 0,
    won: !!save?.won,
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

  /** A hut with a coloured roof and flag. Returns handles for the parts that change. */
  function makeHut(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    const roofMat = mat(color);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 1.2;
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 3.7;
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(2.45, 0.75, 0);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(0, 6.2, 0);
    const flagMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    disposables.push(flagMat);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.7, 7.1, 0);
    g.add(wall, roof, door, pole, flag);
    g.scale.setScalar(0.8);
    // The door faces the middle of the island's shore side, i.e. away from the hill behind.
    g.rotation.y = Math.atan2(-(HOME.z - z), HOME.x - x) || 0;
    scene.add(g);
    return { group: g, roof, flag, flagMat, roofMat };
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

  makeHut(HOME.x, HOME.z, 0x3fa9d6);
  const FIRE = { x: HOME.x + 6.5, z: HOME.z - 1.5 };
  const PILE = { x: HOME.x + 3.5, z: HOME.z + 5.5 };
  /* Tool shacks stand in an arc behind the hut, away from the fire and the food pile. */
  const SHACK = {};
  TOOL_IDS.forEach((id, i) => {
    const a = ((110 + i * 31) * Math.PI) / 180;
    let r = 10.5;
    // Keep them on dry ground: step in toward the hut if the spot is wet.
    while (r > 6 && heightAt(HOME.x + Math.cos(a) * r, HOME.z + Math.sin(a) * r) < 0.25) r -= 0.5;
    SHACK[id] = { x: HOME.x + Math.cos(a) * r, z: HOME.z + Math.sin(a) * r };
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
    if (shackMeshes[tool]) return;
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
    for (let i = 0; i < 3; i++) {
      const t = toolMesh(tool);
      t.position.set(-0.7 + i * 0.7, 0.35, 0);
      t.rotation.z = 0.25;
      t.scale.setScalar(1.1);
      g.add(t);
    }
    // Shacks face the hut.
    g.rotation.y = Math.atan2(-(HOME.z - at.z), HOME.x - at.x) + Math.PI / 2;
    scene.add(g);
    shackMeshes[tool] = g;
  }
  /* Tool models: built standing up along +y with the grip at the origin. */
  const hornGeo = geo(new THREE.ConeGeometry(0.2, 0.75, 10, 1, true).translate(0, 0.38, 0)),
    haftGeo = geo(new THREE.CylinderGeometry(0.045, 0.05, 1, 6).translate(0, 0.4, 0)),
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
    bladeMat = mat(0x9aa3ab),
    shakerMat = mat(0xd96b3a, { flatShading: false }),
    didgeMat = mat(0x8a5a2e, { side: THREE.DoubleSide }),
    bandMat = mat(0xf2d27a),
    healMat = new THREE.MeshStandardMaterial({ color: 0x8ff0a8, emissive: 0x3fc26e, emissiveIntensity: 0.9, roughness: 0.3 });
  disposables.push(healMat);
  /** The small model a member carries (and the shacks display). */
  function toolMesh(tool) {
    const g = new THREE.Group();
    const add = (geometry, material, x = 0, y = 0, z = 0, rz = 0) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      g.add(m);
      return m;
    };
    if (tool === "horn") add(hornGeo, hornMat, 0, 0.1, 0, -0.5);
    else if (tool === "axe") {
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
    const m = toolMesh(tool);
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

  // Your tribe: the chief and two others, or whoever was saved.
  (save ? save.units : [{ chief: true }, {}, {}]).forEach((s) => {
    const at = around(FIRE, 2.5, 5);
    makeUnit(null, record, at.x, at.z, { chief: s.chief, tool: s.tool && T.tools[s.tool] ? s.tool : null });
  });

  /* ---- the other tribes -------------------------------------------------------------------- */
  const TRIBE_SETUP = [
    { relation: 0, color: 0xd6a03f, mood: "Curious" },
    { relation: 0, color: 0x8a5fd0, mood: "Wary" },
    { relation: -35, color: 0xc9483c, mood: "Aggressive" },
  ];
  {
    // The three nest sites nearest your village (but not on top of it) become villages.
    const sites = world.nestSites
      .map((s) => ({ ...s, d: Math.hypot(s.x - HOME.x, s.z - HOME.z) }))
      .filter((s) => s.d > 50)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    sites.forEach((site, i) => {
      const setup = TRIBE_SETUP[i];
      const sp = generateSpecies(90210 + i * 7919, ["plant", "omni", "meat"][i], 1);
      const saved = save?.tribes[i];
      const tribe = {
        index: i,
        name: sp.name,
        species: sp,
        mood: setup.mood,
        color: setup.color,
        center: { x: site.x, z: site.z },
        relation: saved ? saved.relation : setup.relation,
        status: saved ? saved.status : "neutral",
        hutHealth: saved ? saved.hut : 1, // 0..1
        hut: null,
        fire: null,
        raidClock: 110 + i * 25 + Math.random() * 40,
        giftClock: 60,
        war: 0, // seconds they stay on the attack after being hit
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
      tribe.hut = makeHut(site.x, site.z, setup.color);
      tribe.fire = makeFire(site.x + 6, site.z + 1);
      fires.push(tribe.fire);
      const alive = tribe.status === "conquered" ? 0 : saved ? saved.alive : 5;
      for (let k = 0; k < alive; k++) {
        const at = around(tribe.center, 4, 9);
        // The aggressive tribe arms its hunters with spears.
        makeUnit(tribe, sp.record, at.x, at.z, { tool: i === 2 && k % 2 === 0 ? "spear" : null });
      }
      T.tribes.push(tribe);
      if (tribe.status === "conquered") ruinHut(tribe);
      if (tribe.status === "allied") tribe.hut.flagMat.color.set(0x3fc26e);
    });
  }
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
        <b class="trName">${esc(record.name)} tribe <em>Prototype</em></b>
        <div class="trStats"><span title="Food">🍖 <b id="trFood">0</b></span><span title="Tribe members">👥 <b id="trPop">0</b></span></div>
      </div>
      <button class="trIcon" id="trMenu" aria-label="Menu" title="Menu">☰</button>
    </div>
    <div class="trGoal" id="trGoal" role="status" aria-live="polite"></div>
    <div class="trTribes" id="trTribes" role="list" aria-label="Neighbouring tribes"></div>
    <div class="trMarks" id="trMarks" aria-hidden="true"></div>
    <div class="trToast" id="trToast" role="status" aria-live="polite"></div>
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
        <button id="trBaby" aria-label="Have a baby, costs ${BABY_COST} food"><span>🥚</span><small>Baby · ${BABY_COST}</small></button>
        <button id="trBuild" aria-label="Build a tool shack"><span>🔨</span><small>Build</small></button>
        <button id="trHome" aria-label="Go to your village"><span>⌂</span><small>Village</small></button>
      </div>
    </div>
    <div class="trMenuPanel" id="trMenuPanel" hidden>
      <button id="trResume" class="primary">Resume</button>
      <button id="trSettings">⚙ Settings</button>
      <button id="trHelp">How to play</button>
      <button id="trExit">Back to the Creature Stage</button>
    </div>`;
  document.body.appendChild(hud);
  const $h = (q) => hud.querySelector(q);
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
  $h("#trExit").onclick = () => {
    saveState();
    o.onExit();
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
  $h("#trHome").onclick = () => {
    cam.x = HOME.x;
    cam.z = HOME.z;
  };
  $h("#trBaby").onclick = haveBaby;
  hud.querySelectorAll("#trBand [data-play]").forEach((b) => (b.onclick = () => playInstrument(b.dataset.play)));
  $h("#trBuild").onclick = () => openSheet("build");

  function showHelp() {
    openSheet("help");
  }

  /* ---- sheets: build menu, a tribe's card, help ------------------------------------- */
  let sheet = null; // { kind, tribe }
  function openSheet(kind, tribe = null) {
    sheet = { kind, tribe };
    renderSheet();
  }
  function closeSheet() {
    sheet = null;
    $h("#trSheet").hidden = true;
  }
  function renderSheet() {
    const el = $h("#trSheet");
    if (!sheet) return;
    el.hidden = false;
    let html = "";
    if (sheet.kind === "build") {
      html = `<div class="tsHead"><b>Build a tool shack</b><button class="tsClose" aria-label="Close">✕</button></div>`;
      for (const [kind, title] of [
        ["fight", "Weapons"],
        ["music", "Instruments"],
        ["village", "Village"],
      ]) {
        html += `<h5 class="tsKind">${title}</h5><div class="tsTools">`;
        for (const [id, t] of Object.entries(TOOLS)) {
          if (t.kind !== kind) continue;
          const owned = T.tools[id];
          html += `<button class="tsTool ${kind}" data-tool="${id}" ${owned || T.food < t.cost ? 'aria-disabled="true"' : ""}><span>${t.icon}</span><b>${t.name}</b><small>${t.desc}</small><em>${owned ? "Built" : "🍖 " + t.cost}</em></button>`;
        }
        html += `</div>`;
      }
      html += `<p class="tsHint">Once built, select members and tap the shack to pick the tool up.</p>`;
    } else if (sheet.kind === "tribe") {
      const tr = sheet.tribe;
      const face = RELATION_INFO[relationFace(tr.relation, tr.status)];
      const players = [...T.selected].filter((u) => INSTRUMENTS.includes(u.tool)).length;
      const anyInstrument = INSTRUMENTS.some((id) => T.tools[id]);
      html = `<div class="tsHead"><img src="${face.face}" alt="${face.label}" width="40" height="40"><div><b>${esc(tr.name)} tribe</b><small>${face.label} · ${tr.mood}</small></div><button class="tsClose" aria-label="Close">✕</button></div>
        <i class="tsRel"><b style="width:${(tr.relation + 100) / 2}%;background:${face.color}"></b></i>
        <div class="tsBtns">
          <button id="tsImpress" class="good" ${players ? "" : 'aria-disabled="true"'}>🎶 Play for them</button>
          <button id="tsGift" class="gift" ${T.food < GIFT.food || tr.giftCool > 0 ? 'aria-disabled="true"' : ""}>🎁 Gift · 🍖${GIFT.food}</button>
          <button id="tsAttack" class="bad">⚔ Attack</button>
        </div>
        <p class="tsHint">${
          players
            ? players + " of your selected members " + (players === 1 ? "has an instrument" : "have instruments") + ". When they call for one, play it."
            : anyInstrument
              ? "Nobody selected has an instrument: tap an instrument shack first."
              : "To make friends, build an instrument (🔨) and pick it up, or send gifts."
        }</p>`;
    } else if (sheet.kind === "won") {
      const allied = T.tribes.filter((t) => t.status === "allied").length,
        conquered = T.tribes.length - allied;
      html = `<div class="tsHead tsWon"><b>Tribe Stage complete</b><button class="tsClose" aria-label="Close">✕</button></div>
        <p class="tsWonText">${
          conquered === 0 ? "Every neighbour is your friend. Your tribe is known for its music." : allied === 0 ? "Every neighbour has fallen. Your tribe is feared across the island." : "Some neighbours are friends, some have fallen. Your tribe is respected."
        }</p>
        <div class="tsStats"><span><b>${allied}</b> allied</span><span><b>${conquered}</b> conquered</span><span><b>${mine().length}</b> members</span><span><b>${Math.floor(T.food)}</b> food</span></div>
        <p class="tsHint">The Civilization Stage is next. It isn't built yet: keep playing here, or head back to your creature.</p>
        <div class="tsBtns"><button class="good" id="tsKeep">Keep playing</button><button id="tsBack">Back to the Creature Stage</button></div>`;
    } else {
      html = `<div class="tsHead"><b>Tribe Stage · early prototype</b><button class="tsClose" aria-label="Close">✕</button></div>
        <ul class="tsHelp">
          <li><b>Look around:</b> drag to move, pinch or scroll to zoom.</li>
          <li><b>Select:</b> tap a member, or All. Then tap where to go.</li>
          <li><b>Food:</b> tap ${diet === "meat" ? "the ripples in the sea to fish" : diet === "plant" ? "a fruit bush to pick fruit" : "a fruit bush, or the ripples in the sea to fish"}. They carry it home by themselves.</li>
          ${diet !== "plant" ? "<li><b>Hunt:</b> tap a grazing animal. Your hunters bring the meat home.</li>" : ""}
          <li><b>Grow:</b> 🥚 Baby costs ${BABY_COST} food. 🔨 Build shacks for weapons, instruments and staffs.</li>
          <li><b>Make friends:</b> select members holding instruments and tap a village. When the tribe calls for an instrument, play it (or press 1-3). Gifts of food help too.</li>
          <li><b>Or conquer:</b> attack the village and knock down its hut. Torches burn huts fast.</li>
          <li><b>Goal:</b> make every tribe an ally, or knock down its hut.</li>
        </ul>`;
    }
    el.innerHTML = html;
    el.querySelector(".tsClose").onclick = closeSheet;
    el.querySelectorAll(".tsTool").forEach((b) => (b.onclick = () => buyTool(b.dataset.tool)));
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
    const gift = el.querySelector("#tsGift");
    if (gift) gift.onclick = () => sendGift(sheet.tribe);
    const keep = el.querySelector("#tsKeep");
    if (keep) keep.onclick = closeSheet;
    const back = el.querySelector("#tsBack");
    if (back)
      back.onclick = () => {
        saveState();
        o.onExit();
      };
    const atk = el.querySelector("#tsAttack");
    if (atk)
      atk.onclick = () => {
        const tr = sheet.tribe;
        [...T.selected].forEach((u) => (u.task = { type: "attack", tribe: tr, target: null }));
        o.sfx("roar");
        closeSheet();
      };
  }
  function buyTool(id) {
    const t = TOOLS[id];
    if (T.tools[id]) return;
    if (T.food < t.cost) return toast("Not enough food: " + t.name + " cost " + t.cost + ".");
    T.food -= t.cost;
    T.tools[id] = true;
    buildShack(id);
    o.sfx("build");
    pop(SHACK[id].x, SHACK[id].z, t.icon, "good");
    tipOnce("equip", "Select members, then tap the new shack to pick up " + t.name.toLowerCase() + ".", 5);
    cam.x = HOME.x;
    cam.z = HOME.z;
    closeSheet();
    saveState();
  }
  function haveBaby() {
    const pop0 = mine().length + T.eggs.length;
    if (pop0 >= popCap(settled())) return toast("Your village is full. Befriend or conquer a tribe to make room.");
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
    if (pointers.size === 1) gesture = { panned: false, pinch: 0, button: e.button };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.panned = true; // a pinch never counts as a tap
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

  function tap(sx, sy) {
    $h("#trMenuPanel").hidden = true;
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
      if (tribe.status === "allied") return toast("The " + tribe.name + " tribe are your allies.");
      if (tribe.status === "conquered") return toast("The " + tribe.name + " tribe is no more.");
      if (!picked.length) return toast("Select some of your tribe first (tap one, or All).");
      // A raider in your village is simply fought.
      if (foreign?.raid) {
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
    // Tool shacks.
    for (const tool of Object.keys(TOOLS)) {
      if (!T.tools[tool]) continue;
      const pt = project(SHACK[tool].x, heightAt(SHACK[tool].x, SHACK[tool].z) + 1.2, SHACK[tool].z);
      if (!pt.behind && Math.hypot(pt.x - sx, pt.y - sy) < 46) {
        picked.forEach((u) => (u.task = { type: "equip", tool }));
        flash(SHACK[tool].x, SHACK[tool].z);
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
    // Walk there, spread out so they don't pile onto one spot.
    picked.forEach((u, i) => {
      const a = (i / Math.max(1, picked.length)) * TAU,
        r = picked.length > 1 ? 1.2 + picked.length * 0.22 : 0;
      u.task = { type: "move", x: g.x + Math.cos(a) * r, z: g.z + Math.sin(a) * r };
    });
    flash(g.x, g.z);
    o.sfx("click");
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
    const dmg = DAMAGE[w] * (u.chief ? 1.4 : 1);
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
    // Fight back, unless busy running home with stolen food.
    if (by && !by.dead && (!u.task || (u.task.type !== "fight" && u.task.type !== "attack")) && !u.child && !(u.raid && u.carry)) u.task = { type: "fight", target: by };
    // Hitting a tribe at home is an act of war; seeing off raiders is not.
    if (u.tribe && !u.raid) {
      u.tribe.war = 25;
      if (by?.mine && u.tribe.status === "neutral") u.tribe.relation = -100;
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
      // Stand guard: anything hostile close by gets chased off.
      const foe = nearestFoe(u, 9);
      if (foe) u.task = { type: "fight", target: foe, guard: true };
      else u.speed += (0 - u.speed) * Math.min(1, dt * 8);
      return;
    }
    if (task.type === "move") {
      if (walk(u, task.x, task.z, 5, dt)) u.task = null;
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
  const carryOf = (u, kind) => Math.ceil(CARRY[kind] * (u.tool === "staff" ? 1.5 : 1));
  function nearestFoe(u, radius) {
    let best = null,
      bestD = radius;
    for (const v of T.units) {
      if (v.dead || v.mine === u.mine || v.child) continue;
      // Yours guard against raiders and tribes at war; theirs against you when at war.
      const hostile = u.mine ? v.raid || v.tribe.war > 0 : v.mine && (u.tribe.war > 0 || u.raid);
      if (!hostile) continue;
      const d = dist(u, v);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
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
    if (u.task?.type === "fight") {
      // Break off when badly hurt or dragged too far from home.
      const far = distTo(u, tr.center) > 46 && !u.raid;
      if (!strike(u, u.task.target, dt) || far) u.task = null;
      if (u.raid && u.health < u.maxHealth * 0.35) {
        u.task = null;
        u.fleeing = true;
      }
      return;
    }
    if (u.raid) {
      if (u.carry || u.fleeing || tr.status !== "neutral") {
        // Home with the loot (or with nothing, if routed).
        if (walk(u, tr.center.x, tr.center.z, 5.6, dt, 7)) {
          u.raid = false;
          u.fleeing = false;
          u.carry = 0;
        }
        return;
      }
      const foe = nearestFoe(u, 5);
      if (foe) {
        u.task = { type: "fight", target: foe };
        return;
      }
      if (walk(u, PILE.x, PILE.z, 4.8, dt, 2.6)) {
        u.work += dt;
        if (u.work > 1.2) {
          u.work = 0;
          const take = Math.min(5, T.food);
          T.food -= take;
          u.carry = take;
          u.fleeing = !take;
          if (take) {
            pop(PILE.x, PILE.z, "−" + take + " 🍖", "bad");
            o.sfx("damage");
          }
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
    idle(u, tr.center, dt, 3, 9);
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
      tr.askT = ASK_TIME;
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
    tr.relation = couldnt ? clampRelation(tr.relation - SOCIAL_MISS / 2) : answerCall(tr.relation, right ? count : 0);
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
    tr.relation = clampRelation(tr.relation + GIFT.relation);
    tr.war = 0;
    pop(tr.center.x, tr.center.z, "🎁", "good");
    pop(PILE.x, PILE.z, "−" + GIFT.food + " 🍖", "bad");
    o.sfx("friend", { gain: 0.6 });
    if (tr.relation >= 100) ally(tr);
    else renderSheet();
  }

  /* ---- tribes: friendship, conquest, raids, gifts ------------------------------------- */
  function ally(tr) {
    tr.status = "allied";
    tr.relation = 100;
    tr.war = 0;
    tr.hut.flagMat.color.set(0x3fc26e);
    membersOf(tr).forEach((m) => {
      m.raid = false;
      m.task = null;
      perform(m, "dance");
    });
    T.units.forEach((u) => {
      if (u.task && u.task.tribe === tr) u.task = null;
    });
    T.food += 10;
    o.sfx("friend");
    toast("The " + tr.name + " tribe are now your allies! They sent a gift of food.", 4.5);
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
    settle();
  }
  function settle() {
    closeSheet();
    saveState();
    if (!T.won && stageWon(T.tribes)) {
      T.won = true;
      saveState();
      setTimeout(() => {
        o.sfx("unlock");
        openSheet("won");
      }, 2500);
    } else tipOnce("room", "Your village can now hold " + popCap(settled()) + " members.", 4);
  }
  function updateTribes(dt) {
    for (const tr of T.tribes) {
      tr.war = Math.max(0, tr.war - dt);
      tr.giftCool = Math.max(0, tr.giftCool - dt);
      if (tr.status === "neutral") {
        updateCalls(tr, dt);
        // Raids on your food pile.
        const alive = membersOf(tr);
        if (willRaid({ status: tr.status, relation: tr.relation, alive: alive.length }) && tr.war <= 0 && !alive.some((m) => m.raid)) {
          tr.raidClock -= dt;
          if (tr.raidClock <= 0) {
            tr.raidClock = 150 + Math.random() * 60;
            alive.slice(0, Math.min(3, alive.length - 1)).forEach((m) => {
              m.raid = true;
              m.fleeing = false;
              m.carry = 0;
              m.work = 0;
              m.task = null;
            });
            o.sfx("roar");
            toast("The " + tr.name + " tribe is raiding your food!", 4);
            tipOnce("raid", "Raiders steal from your food pile. Members near the village chase them off.", 5);
          }
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
      tr.watching = tr.band.length;
      tr.performers = tr.band.length;
      tr.band = []; // refilled by the performers each frame
    }
  }

  /* ---- saving --------------------------------------------------------------------------- */
  function saveState() {
    try {
      localStorage.setItem(
        TRIBE_SAVE_KEY,
        JSON.stringify({
          v: 1,
          food: Math.round(T.food),
          tools: T.tools,
          units: mine().map((u) => ({ tool: u.tool, chief: u.chief })),
          tribes: T.tribes.map((t) => ({ relation: Math.round(t.relation), status: t.status, alive: membersOf(t).length, hut: t.hutHealth })),
          won: T.won,
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
  function updateHUD() {
    const own = mine();
    $h("#trFood").textContent = Math.floor(T.food);
    $h("#trPop").textContent = own.length + T.eggs.length + " / " + popCap(settled());
    $h("#trBaby").setAttribute("aria-disabled", String(T.food < BABY_COST || own.length + T.eggs.length >= popCap(settled())));
    const done = settled();
    $h("#trGoal").textContent = T.won ? "Prototype complete · every tribe is settled" : "Befriend or conquer the neighbouring tribes · " + done + " / " + T.tribes.length;
    // Member chips.
    const key = own.map((u) => u.id + (u.tool || "") + (u.child ? "c" : "") + (T.selected.has(u) ? "s" : "")).join(",");
    const list = $h("#trUnits");
    if (key !== unitsKey) {
      unitsKey = key;
      list.innerHTML = "";
      own.forEach((u) => {
        const b = document.createElement("button");
        b.className = "trUnit" + (T.selected.has(u) ? " sel" : "") + (u.child ? " child" : "");
        b.setAttribute("role", "listitem");
        b.setAttribute("aria-pressed", String(T.selected.has(u)));
        b.setAttribute("aria-label", (u.chief ? "Chief" : u.child ? "Child" : "Member") + (u.tool ? " with " + TOOLS[u.tool].name.toLowerCase() : ""));
        b.innerHTML = (portrait ? `<img src="${portrait}" alt="" draggable="false">` : `<span class="noPic">🐾</span>`) + `<em>${u.chief ? "👑" : u.child ? "🍼" : u.tool ? TOOLS[u.tool].icon : ""}</em><i><b></b></i>`;
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
    const tk = T.tribes.map((t) => relationFace(t.relation, t.status) + t.status).join(",");
    if (tk !== tribesKey) {
      tribesKey = tk;
      const el = $h("#trTribes");
      el.innerHTML = "";
      T.tribes.forEach((t) => {
        const f = RELATION_INFO[relationFace(t.relation, t.status)];
        const b = document.createElement("button");
        b.className = "trTribe " + t.status;
        b.setAttribute("role", "listitem");
        b.setAttribute("aria-label", t.name + " tribe: " + (t.status === "conquered" ? "conquered" : f.label) + ". Tap to look.");
        b.style.setProperty("--rel", t.status === "conquered" ? "#6b6b6b" : f.color);
        b.innerHTML = t.status === "conquered" ? `<span>☠</span>` : `<img src="${f.face}" alt="" draggable="false">`;
        b.onclick = () => {
          cam.x = t.center.x;
          cam.z = t.center.z;
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
          : `<span class="trMark" style="left:${pt.x}px;top:${pt.y}px;--rel:${f.color}"><img src="${f.face}" alt="">${esc(t.name)}<i><b style="width:${t.hutHealth < 1 ? t.hutHealth * 100 : (t.relation + 100) / 2}%;background:${t.hutHealth < 1 ? "#ef4b48" : f.color}"></b></i></span>`;
    }
    let bars = 0;
    for (const u of T.units) {
      if (u.dead || u.health >= u.maxHealth || bars >= 24) continue;
      const pt = project(u.pos.x, u.pos.y + u.body.height * u.scale + 0.9, u.pos.z);
      if (pt.behind || pt.x < 0 || pt.x > innerWidth || pt.y < 0 || pt.y > innerHeight) continue;
      bars++;
      html += `<span class="trBar ${u.mine ? "" : "foe"}" style="left:${pt.x}px;top:${pt.y}px"><b style="width:${Math.max(0, (u.health / u.maxHealth) * 100)}%"></b></span>`;
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
        $h("#trArcTime").style.strokeDasharray = ((tr.askT / ASK_TIME) * 100).toFixed(1) + " 100";
        ask.classList.toggle("hurry", tr.askT < ASK_TIME * 0.3);
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
      if (u.health < u.maxHealth && T.time - u.hurtAt > 6) u.health = Math.min(u.maxHealth, u.health + dt * (u.mine && distTo(u, HOME) < 14 ? 6 : 2));
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
  if (!save) setTimeout(showHelp, 400);

  return {
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
    debug: { T, cam, tap, project, haveBaby, buyTool, ally, conquer, fishSpots, world, HOME, PILE, SHACK, openSheet, playInstrument, sendGift, setTool, hurtAnimal, stageTribe, heightAt },
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
