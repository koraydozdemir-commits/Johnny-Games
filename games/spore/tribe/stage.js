/**
 * Tribe Stage (early prototype).
 *
 * Your creatures have settled: a hut, a fire and a food pile on the beach where you first crawled
 * ashore. You no longer steer one creature; you direct the tribe from above. Gather food, raise
 * babies, build tool shacks, and deal with the three neighbouring tribes, by playing horns for them
 * until they ally with you or by knocking their hut down.
 *
 * Controls are the same on a phone and a desktop: drag to move the camera, pinch or scroll to zoom,
 * tap a member to select it (or use All), then tap where it should go or what it should do.
 */
import * as THREE from "three";
import { ABILITY_TIME, buildCreatureBody } from "../creature/body3d.js";
import { createEmotes } from "../creature/emotes.js";
import { validateCreature } from "../creature/format.js";
import { dietOfParts } from "../creature/parts.js";
import { RELATION_INFO } from "../creature/relations.js";
import { generateSpecies } from "../creature/species.js";
import { ISLAND, createIsland, heightAt } from "../creature/world.js";
import { BABY_COST, CARRY, START_FOOD, TOOLS, TRIBE_SAVE_KEY, canGather, clampRelation, popCap, readTribeSave, relationFace, stageWon, willRaid } from "./rules.js";

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
    tools: { axe: !!save?.tools.axe, horn: !!save?.tools.horn },
    units: [], // every creature in the world, yours and theirs
    tribes: [],
    selected: new Set(),
    eggs: [],
    time: 0,
    won: false,
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
  const SHACK = { axe: { x: HOME.x - 6.5, z: HOME.z + 2 }, horn: { x: HOME.x - 5, z: HOME.z - 5.5 } };
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
    const roof = new THREE.Mesh(shackRoofGeo, mat(tool === "axe" ? 0xb5523a : 0xd9a441));
    roof.position.y = 1.85;
    roof.rotation.z = 0.12;
    g.add(roof);
    // A few of the tools leaning inside, so the shack reads at a glance.
    for (let i = 0; i < 3; i++) {
      const t = toolMesh(tool);
      t.position.set(-0.7 + i * 0.7, 0.7, 0);
      t.rotation.z = 0.25;
      t.scale.setScalar(1.25);
      g.add(t);
    }
    scene.add(g);
    shackMeshes[tool] = g;
  }
  const hornGeo = geo(new THREE.ConeGeometry(0.2, 0.75, 8, 1, true).rotateZ(-Math.PI / 2)),
    haftGeo = geo(new THREE.CylinderGeometry(0.045, 0.045, 0.95, 6)),
    bladeGeo = geo(new THREE.BoxGeometry(0.36, 0.3, 0.07));
  const hornMat = mat(0xf2e3c0, { side: THREE.DoubleSide, flatShading: false }),
    bladeMat = mat(0x9aa3ab);
  /** The small model a member carries (and the shacks display). */
  function toolMesh(tool) {
    const g = new THREE.Group();
    if (tool === "horn") g.add(new THREE.Mesh(hornGeo, hornMat));
    else {
      const haft = new THREE.Mesh(haftGeo, poleMat);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(0.16, 0.36, 0);
      g.add(haft, blade);
    }
    return g;
  }
  if (T.tools.axe) buildShack("axe");
  if (T.tools.horn) buildShack("horn");

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
    if (u.toolModel) u.body.root.remove(u.toolModel);
    u.tool = tool;
    u.toolModel = null;
    if (!tool) return;
    const m = toolMesh(tool);
    m.position.set(u.body.length * 0.2, u.body.height * 0.75, u.body.radius + 0.25);
    m.rotation.z = tool === "axe" ? -0.5 : 0.35;
    u.body.root.add(m);
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
      };
      tribe.hut = makeHut(site.x, site.z, setup.color);
      tribe.fire = makeFire(site.x + 6, site.z + 1);
      fires.push(tribe.fire);
      const alive = tribe.status === "conquered" ? 0 : saved ? saved.alive : 5;
      for (let k = 0; k < alive; k++) {
        const at = around(tribe.center, 4, 9);
        makeUnit(tribe, sp.record, at.x, at.z);
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
    <div class="trSheet" id="trSheet" hidden></div>
    <div class="trBottom">
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
      html = `<div class="tsHead"><b>Build a tool shack</b><button class="tsClose" aria-label="Close">✕</button></div><div class="tsTools">`;
      for (const [id, t] of Object.entries(TOOLS)) {
        const owned = T.tools[id];
        html += `<button class="tsTool" data-tool="${id}" ${owned || T.food < t.cost ? 'aria-disabled="true"' : ""}><span>${t.icon}</span><b>${t.name}</b><small>${t.desc}</small><em>${owned ? "Built" : "🍖 " + t.cost}</em></button>`;
      }
      html += `</div><p class="tsHint">Once built, select members and tap the shack to pick the tool up.</p>`;
    } else if (sheet.kind === "tribe") {
      const tr = sheet.tribe;
      const face = RELATION_INFO[relationFace(tr.relation, tr.status)];
      const horns = [...T.selected].filter((u) => u.tool === "horn").length;
      html = `<div class="tsHead"><img src="${face.face}" alt="${face.label}" width="40" height="40"><div><b>${esc(tr.name)} tribe</b><small>${face.label} · ${tr.mood}</small></div><button class="tsClose" aria-label="Close">✕</button></div>
        <i class="tsRel"><b style="width:${(tr.relation + 100) / 2}%;background:${face.color}"></b></i>
        <div class="tsBtns">
          <button id="tsImpress" class="good" ${horns ? "" : 'aria-disabled="true"'}>📯 Play for them</button>
          <button id="tsAttack" class="bad">⚔ Attack</button>
        </div>
        <p class="tsHint">${horns ? horns + " of your selected members " + (horns === 1 ? "has a horn" : "have horns") + "." : T.tools.horn ? "Nobody selected has a horn: tap the Horns shack first." : "To make friends, build Horns (🔨) and pick them up."}</p>`;
    } else {
      html = `<div class="tsHead"><b>Tribe Stage · early prototype</b><button class="tsClose" aria-label="Close">✕</button></div>
        <ul class="tsHelp">
          <li><b>Look around:</b> drag to move, pinch or scroll to zoom.</li>
          <li><b>Select:</b> tap a member, or All. Then tap where to go.</li>
          <li><b>Food:</b> tap ${diet === "meat" ? "the ripples in the sea to fish" : diet === "plant" ? "a fruit bush to pick fruit" : "a fruit bush, or the ripples in the sea to fish"}. They carry it home by themselves.</li>
          <li><b>Grow:</b> 🥚 Baby costs ${BABY_COST} food. 🔨 Build adds Axes or Horns.</li>
          <li><b>Other tribes:</b> select members, tap their village, then play horns for them or attack.</li>
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
        const players = [...T.selected].filter((u) => u.tool === "horn");
        if (!players.length) return toast(T.tools.horn ? "Select members holding horns." : "Build Horns first (🔨 Build).");
        players.forEach((u, i) => (u.task = { type: "perform", tribe: tr, slot: i }));
        o.sfx("click");
        closeSheet();
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
    const hutTribe = nearestOnScreen(T.tribes, sx, sy, 52, (t) => groundY(t.center, 2.5));
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
      if (!f.alive || f.claimed) continue;
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

  function strike(u, target, dt) {
    // Returns false when the target is gone.
    if (!target || target.dead) return false;
    const reach = 1.6 + (u.scale + target.scale) * 0.5;
    if (!walk(u, target.pos.x, target.pos.z, 5.4, dt, reach)) return true;
    face(u, target.pos.x, target.pos.z);
    if (u.cool > 0) return true;
    u.cool = 1;
    u.body.playAbility(u.tool === "axe" ? "strike" : "bite");
    o.sfx(u.tool === "axe" ? "chop" : "creatureBite", { pitch: 1, gain: 0.6 });
    hurt(target, (u.tool === "axe" ? 12 : 6) * (u.chief ? 1.4 : 1), u);
    return true;
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
      if (u.carry >= CARRY[kind] || task.deliver) {
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
        u.work += dt;
        if (u.work >= 2.4) {
          u.work = 0;
          u.body.playAbility("bite");
          o.sfx("splash");
          u.carry += 2;
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
      if (u.work === 0) u.body.playAbility("bite");
      u.work += dt;
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
      if (tr.status !== "neutral" || u.tool !== "horn") {
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
      tr.performers++;
      u.work -= dt;
      if (u.work <= 0) {
        const kind = (task.n = (task.n || 0) + 1) % 2 ? "sing" : "dance";
        u.work = ABILITY_TIME[kind] + 0.25;
        perform(u, kind);
        o.sfx("horn", { pitch: [1, 1.19, 1.5][task.slot % 3], gain: 0.8 });
      }
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
        u.body.playAbility(u.tool === "axe" ? "strike" : "bite");
        o.sfx("chop");
        tr.relation = -100;
        tr.hutHealth -= (u.tool === "axe" ? 0.05 : 0.025) * (u.chief ? 1.4 : 1);
        tr.hut.group.rotation.z = (Math.random() - 0.5) * 0.05;
        if (tr.hutHealth <= 0) conquer(tr);
      }
    } else if (task.type === "fight") {
      if (!strike(u, task.target, dt) || (task.guard && distTo(u, HOME) > 30)) u.task = null;
    }
  }
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
      setTimeout(() => {
        o.sfx("unlock");
        toast("Every tribe is settled. That is the end of this prototype: the Civilization Stage comes next.", 8);
      }, 2500);
    } else tipOnce("room", "Your village can now hold " + popCap(settled()) + " members.", 4);
  }
  function updateTribes(dt) {
    for (const tr of T.tribes) {
      tr.war = Math.max(0, tr.war - dt);
      if (tr.status === "neutral") {
        if (tr.performers > 0) {
          // Each horn adds to the mood; a tribe that dislikes you takes more winning over.
          const rate = 2.6 * tr.performers * (tr.relation < -10 ? 0.7 : 1);
          tr.relation = clampRelation(tr.relation + rate * dt);
          if (tr.relation >= 100) ally(tr);
        }
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
      tr.watching = tr.performers;
      tr.performers = 0; // recounted by the performers each frame
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
    debug: { T, cam, tap, project, haveBaby, buyTool, ally, conquer, fishSpots, world, HOME, PILE, SHACK, openSheet },
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
      emotes.dispose();
      world.dispose();
      disposables.forEach((d) => d.dispose());
      hud.remove();
    },
  };
}
