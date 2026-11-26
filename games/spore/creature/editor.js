/**
 * Creature Creator: Build, Paint and Test, the way Spore's creator worked.
 *
 * Build: sculpt the spine (drag the round handles; quick-shape buttons for whole-body changes), pose
 * the legs and arms with their grips, and pull parts out of the catalogue onto the body. Parts snap
 * where they belong and can be dragged anywhere on the skin; a selected part gets a small toolbar
 * (duplicate, symmetry, numbers, delete) and size and turn grips. Symmetry is on by default: a part
 * off the midline gets a mirror twin; switch it off to place one-sided parts.
 * Paint: four colour layers (base, belly, coat, detail), a pattern, a full colour picker, ready-made
 * schemes, your recent and saved schemes.
 * Test: walk, run, sneak, jump and every ability the design has, without touching the design.
 *
 * Everything goes through one undo history (a drag is one step), drafts are kept while you work so a
 * reload never loses a design, and one gesture system tells part drags from camera moves. On phones
 * the catalogue is a drawer over a bottom mode bar; on wide screens it is a panel on the left.
 * Opens over the game with its own scene; the caller drives update() and render() every frame.
 */
import * as THREE from "three";
import { createEditorBackdrop } from "./backdrop.js";
import { buildCreatureBody, offMidline } from "./body3d.js";
import { ARM_ANGLE, LIMITS, armPairsOf, creaturePartIds, validateCreature } from "./format.js";
import { ABILITY_INFO, ARM_ABILITIES, COMBAT, CREATURE_PARTS, PART_SECTIONS, SOCIAL, STAT_INFO, abilitiesOf, creaturePart, fitsArm } from "./parts.js";
import { DIET_NAME, MOUTH_DIETS, mouthDiet, mouthsOfDiet } from "./mouths.js";
import { movementOf, rate } from "./anatomy.js";
import { ICONS, SECTION_ICON } from "./editor-icons.js";
import { esc, infoHtml, mouthPanelHtml, shownName, tileHtml } from "./editor-catalogue.js";
import { bakePartThumbs } from "./part-thumbs.js";
import { createHistory } from "../editor/history.js";
import { createDrafts } from "../editor/drafts.js";
import { attachGestures } from "../editor/gestures.js";
import { createColorPicker } from "../editor/picker.js";
import { CREATURE_PRESETS, recentList, toHex } from "../editor/color.js";
import { browse } from "../editor/catalogue.js";
import { confirmBox, easeOrbit, guardPageGestures, makeDrawer, phoneLayout, pulse, reducedMotion, saveBadge, showTips, trackViewport } from "../editor/chrome.js";

const LEG_COST = 8;
const ARM_COST = 8;
const NODE_COST = 2;
const PATTERNS = [
  ["speckle", "Speckle"],
  ["spots", "Spots"],
  ["stripes", "Stripes"],
  ["gradient", "Fade"],
  ["glow", "Glow"],
];
/** The paint layers: which colour of the record each one sets. */
const LAYERS = [
  ["base", "Base", "Back and sides"],
  ["belly", "Belly", "Underside"],
  ["pattern", "Coat", "Pattern colour"],
  ["accent", "Detail", "Accents and fine marks"],
];
/** The Limbs section's leg card: drag it onto the body to add a pair of legs there. */
const LEG_CARD = { id: "__leg", name: "Leg Pair", slot: "leg", cost: LEG_COST, abilities: { speed: 1 }, desc: "Another pair of legs: steadier and faster." };
/** And the arm card: a pair of jointed arms that hands (graspers, or feet) go on the end of. */
const ARM_CARD = { id: "__arm", name: "Arm Pair", slot: "arm", cost: ARM_COST, abilities: ARM_ABILITIES, desc: "Jointed arms. Drag graspers or feet onto their ends." };
const cardDef = (id) => (id === LEG_CARD.id ? LEG_CARD : id === ARM_CARD.id ? ARM_CARD : creaturePart(id));
/** A new arm pair's spot: forward on the chest, low on the flank. */
const ARM_SPOT = { t: 0.76, angle: 1.7 };
/** Where a part goes when it is tapped instead of dragged. */
const DEFAULT_SPOT = { mouth: [1, 0], eye: [0.92, 0.62], side: [0.62, 1.45], back: [0.5, 0], tail: [0, 0] };
/** Ways to try the creature out in Test. */
const MOTIONS = [
  ["idle", "Idle"],
  ["walk", "Walk"],
  ["run", "Run"],
  ["sneak", "Sneak"],
  ["jump", "Jump"],
];
/** Names the catalogue search understands besides part names. */
const SEARCH_WORDS = { mouth: "mouth mouths", senses: "eye eyes senses", limbs: "arm arms leg legs limbs", graspers: "hand hands grasper", feet: "foot feet", movement: "movement wing wings fin tail", offence: "offensive weapon horn spike", defence: "defensive armour armor shell", details: "decorative detail decoration", plant: "herbivore plant", meat: "carnivore meat", omni: "omnivore" };
const PREF_KEY = "johnny-spore-creature-editor";
const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
};
const writePrefs = (p) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...p }));
  } catch (e) {
    /* fine */
  }
};
const storage = () => {
  try {
    return localStorage;
  } catch (e) {
    return null;
  }
};

/** DNA cost of turning `from` into `to`: new parts and hands, leg and arm pairs, and vertebrae; removing is free. */
export function designCost(from, to) {
  const owned = new Map();
  creaturePartIds(from).forEach((id) => owned.set(id, (owned.get(id) || 0) + 1));
  let cost = 0;
  for (const id of creaturePartIds(to)) {
    if (owned.get(id)) owned.set(id, owned.get(id) - 1);
    else cost += creaturePart(id)?.cost || 0;
  }
  cost += Math.max(0, to.legs.length - from.legs.length) * LEG_COST;
  cost += Math.max(0, armPairsOf(to) - armPairsOf(from)) * ARM_COST;
  cost += Math.max(0, to.spine.length - from.spine.length) * NODE_COST;
  return cost;
}

/**
 * Whole-body sculpting for players who would rather not move vertebrae one by one. Pure: returns a
 * new spine. Kinds: length (stretch along the body), bulk (girth everywhere), head, tail, arch.
 */
export function shapeSpine(spine, kind, dir) {
  const s = spine.map((n) => ({ ...n }));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mid = (s[0].x + s.at(-1).x) / 2;
  if (kind === "length") {
    const k = dir > 0 ? 1.12 : 1 / 1.12;
    s.forEach((n) => (n.x = mid + (n.x - mid) * k));
    // Keep inside the editor's limits and never closer than the minimum spacing.
    const span = s.at(-1).x - s[0].x;
    const fit = Math.min(1, 6 / Math.max(0.01, span));
    s.forEach((n) => (n.x = clamp(mid + (n.x - mid) * fit, -3, 3)));
    for (let i = 1; i < s.length; i++) if (s[i].x - s[i - 1].x < 0.3) s[i].x = Math.min(3, s[i - 1].x + 0.3);
  } else if (kind === "bulk") s.forEach((n) => (n.r = clamp(n.r * (dir > 0 ? 1.1 : 1 / 1.1), LIMITS.minR, LIMITS.maxR)));
  else if (kind === "head" || kind === "tail") {
    const idx = kind === "head" ? [s.length - 1, s.length - 2] : [0, 1];
    idx.forEach((i, k) => (s[i].r = clamp(s[i].r * (dir > 0 ? 1.14 - k * 0.06 : 1 / (1.14 - k * 0.06)), LIMITS.minR, LIMITS.maxR)));
  } else if (kind === "arch") {
    s.forEach((n, i) => (n.y = clamp(n.y + Math.sin((i / (s.length - 1)) * Math.PI) * 0.12 * dir, -1, 1.5)));
  }
  return s;
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.record     current design
 * @param {Set<string>} o.unlocked  part ids the player may use
 * @param {Set<string>} [o.seen]    part ids the player has seen on a creature (locked parts show their name only if seen)
 * @param {object} [o.progress]     what the player has achieved (see mouths.js progressOf), for unlock requirements
 * @param {number} o.dna
 * @param {number} [o.maxParts]
 * @param {string} o.quality
 * @param {(kind:string) => void} o.sfx
 * @param {(record:object, dnaLeft:number) => void} o.onDone
 * @param {() => void} o.onCancel
 */
export function openCreatureEditor(o) {
  const original = validateCreature(o.record);
  let rec = validateCreature(o.record);
  // The part budget for this brain level, never below what the creature already carries.
  const maxParts = Math.max(rec.parts.length, Math.min(LIMITS.maxParts, o.maxParts || LIMITS.maxParts));
  const prefs = readPrefs();
  let symmetry = prefs.symmetry !== false;
  const scene = new THREE.Scene();
  // A sunny clearing on the island rather than a void: you design the creature where it will live.
  const backdrop = createEditorBackdrop(scene, o.quality);
  const FLOOR = backdrop.floorY;
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 100);
  const orbit = { yaw: -Math.PI / 2, pitch: 0.05, dist: 9, pan: new THREE.Vector3() };
  let orbitGoal = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const recentParts = recentList(storage(), "johnny-spore-recent-parts:creature", 12);
  const recentColours = recentList(storage(), "johnny-spore-recent-colours", 10);
  const sameScheme = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const savedSchemes = recentList(storage(), "johnny-spore-schemes:creature", 12, sameScheme);
  const recentSchemes = recentList(storage(), "johnny-spore-recent-schemes:creature", 6, sameScheme);

  /* ---- DOM -------------------------------------------------------------- */
  const root = document.createElement("div");
  root.className = "crEditor ceCat edRoot mode-build";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Creature Creator");
  const railButton = (cat, label, icon, selected) => `<button role="tab" data-cat="${cat}" aria-selected="${selected}" aria-label="${label}" title="${label}">${icon}</button>`;
  const modeButton = (m, label, icon) => `<button role="tab" data-mode="${m}" aria-selected="${m === "build"}">${icon}<span>${label}</span></button>`;
  root.innerHTML = `
    <div class="ceTop edTop">
      <button id="ceCancel" class="edBack" aria-label="Cancel and leave the editor" title="Cancel">${ICONS.back}<span>Cancel</span></button>
      <input id="ceName" maxlength="22" aria-label="Species name" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <div class="edStatus"><span class="ceDna" id="ceDna" aria-live="polite"></span><span class="edSaveState" id="ceSave" aria-live="polite"></span></div>
      <div class="ceTopBtns">
        <button id="ceUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button id="ceRedo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
        <button id="ceMore" class="edMoreTop" aria-label="More options" aria-haspopup="menu" aria-expanded="false" title="More">${ICONS.more}</button>
        <button id="ceDone" class="primary" title="Save this design">Save</button>
      </div>
    </div>
    <nav class="edModes" role="tablist" aria-label="Editor mode">
      ${modeButton("build", "Build", ICONS.build)}${modeButton("paint", "Paint", ICONS.paint)}${modeButton("test", "Test", ICONS.test)}
      <button class="edNavOnly" id="ceParts" aria-label="Show or hide the parts drawer" aria-expanded="true">${ICONS.parts}<span>Parts</span></button>
      <button class="edNavOnly" id="ceMoreNav" aria-label="More options" aria-haspopup="menu">${ICONS.more}<span>More</span></button>
    </nav>
    <p class="ceHint" id="ceHint" aria-live="polite"></p>
    <aside class="ceStats" id="ceStats" aria-label="Creature statistics"></aside>
    <div class="edViewTools" role="toolbar" aria-label="View">
      <button id="ceSym" aria-pressed="${symmetry}" title="Symmetry: parts off the midline get a mirror twin">${ICONS.mirror}<span>Symmetry</span><b class="edOnOff"></b></button>
      <button id="ceViews" aria-haspopup="menu" aria-expanded="false" aria-label="Camera views" title="Camera views">${ICONS.camera}</button>
    </div>
    <div class="edPop edViewMenu" id="ceViewMenu" role="menu" hidden>
      <button role="menuitem" data-view="front">Front</button><button role="menuitem" data-view="side">Side</button><button role="menuitem" data-view="rear">Rear</button><button role="menuitem" data-view="top">Above</button><button role="menuitem" data-view="focus">Focus selected</button><button role="menuitem" data-view="reset">Reset view</button>
    </div>
    <div class="edPop edMenu" id="ceMenu" role="menu" hidden>
      <button role="menuitem" data-menu="tips">${ICONS.help}Show tips</button>
      <button role="menuitem" data-menu="views">${ICONS.camera}Reset camera</button>
      <button role="menuitem" data-menu="reset" class="danger">${ICONS.reset}Start over from the saved design…</button>
    </div>
    <div class="edCtx" id="ceCtx" role="toolbar" aria-label="Selected part" hidden></div>
    <div class="edRecover" id="ceRecover" hidden></div>
    <div class="ceTestBar" id="ceTestBar" hidden></div>
    <section class="cePanel" aria-label="Editor tools">
      <nav class="ceRail" role="tablist" aria-label="Categories">
        ${railButton("body", "Body", ICONS.body, true)}
        ${PART_SECTIONS.map(([id, title]) => railButton(id, title, SECTION_ICON[id], false)).join("")}
      </nav>
      <div class="ceTab" data-pane="body"></div>
      <div class="ceTab" data-pane="parts" hidden></div>
      <div class="ceTab" data-pane="paint" hidden></div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const nameInput = $("#ceName");
  nameInput.value = rec.name;
  // Typing a name is an undoable change too, one step per editing session of the field.
  nameInput.onfocus = () => history.begin("name");
  nameInput.oninput = () => {
    rec.name = nameInput.value.replace(/[<>]/g, "").slice(0, 22) || "Karlets";
  };
  nameInput.onblur = () => history.end();
  nameInput.onkeydown = (e) => e.key === "Enter" && nameInput.blur();
  let hintTimer = null;
  /** A short message under the top bar that fades by itself, so it never sits over the creature. */
  const hint = (text, ms = 4200) => {
    const el = $("#ceHint");
    el.textContent = text;
    el.classList.toggle("on", !!text);
    clearTimeout(hintTimer);
    if (text) hintTimer = setTimeout(() => el.classList.remove("on"), ms);
  };
  const badge = saveBadge($("#ceSave"));

  /* ---- history and drafts --------------------------------------------------- */
  const drafts = createDrafts({ kind: "creature", base: original });
  const history = createHistory({
    take: () => JSON.stringify(rec),
    put: (s) => {
      rec = JSON.parse(s);
      nameInput.value = rec.name;
      selectedNode = Math.min(selectedNode, rec.spine.length - 1);
      if (selectedPart >= rec.parts.length) selectedPart = -1;
      previewId = null;
      rebuild();
      refreshPanels();
    },
    same: (a, b) => a === b,
    limit: 100,
    onChange: () => {
      drafts.touch(rec);
      renderDna();
    },
  });
  const isDirty = () => JSON.stringify(validateCreature(rec)) !== JSON.stringify(original);
  /** One-off change: remember the design first. */
  const commit = (label) => history.record(label);

  /* ---- model ------------------------------------------------------------- */
  let creature = null;
  let selectedNode = -1,
    selectedPart = -1;
  // Handles: a bright core with a dark rim so they never read as skin spots.
  const handleGeo = new THREE.SphereGeometry(0.085, 16, 12);
  const handleRimGeo = new THREE.SphereGeometry(0.13, 16, 12);
  const handleMat = new THREE.MeshBasicMaterial({ color: 0x7ff5e6, depthTest: false });
  const handleSelMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, depthTest: false });
  const handleRimMat = new THREE.MeshBasicMaterial({ color: 0x0b1820, depthTest: false, transparent: true, opacity: 0.55 });
  const handles = new THREE.Group();
  scene.add(handles);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color: 0x8ff0a8, depthTest: false, transparent: true, opacity: 0.9 }));
  marker.renderOrder = 10;
  marker.visible = false;
  scene.add(marker);
  // The selection ring: soft and thin, on the part and (fainter) on its mirror twin.
  const haloGeo = new THREE.TorusGeometry(0.35, 0.018, 8, 40);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd25e, depthTest: false, transparent: true, opacity: 0.85 });
  const twinMat = new THREE.MeshBasicMaterial({ color: 0xffd25e, depthTest: false, transparent: true, opacity: 0.35 });
  const partHalo = new THREE.Mesh(haloGeo, haloMat);
  const twinHalo = new THREE.Mesh(haloGeo, twinMat);
  [partHalo, twinHalo].forEach((h) => {
    h.renderOrder = 11;
    h.visible = false;
    scene.add(h);
  });
  /** A part that was just placed grows in with a little bounce. */
  let pop = null;
  let needsRebuild = false;
  let lowDetail = false;

  function rebuild() {
    needsRebuild = false;
    if (creature) creature.dispose();
    rec = validateCreature(rec);
    // While something is being dragged the body is rebuilt every frame: a lighter mesh keeps it smooth.
    const q = lowDetail ? "medium" : o.quality === "low" ? "medium" : "high";
    creature = buildCreatureBody(view(), { quality: q });
    creature.root.position.y = FLOOR;
    scene.add(creature.root);
    centre.set((creature.extent.minX + creature.extent.maxX) / 2, creature.extent.lift + FLOOR, 0);
    // Spine handles sit on the side profile, which lives in the body group.
    handles.clear();
    rec.spine.forEach((n, i) => {
      const h = new THREE.Mesh(handleRimGeo, handleRimMat);
      h.renderOrder = 9;
      h.position.set(n.x, n.y + creature.extent.lift + FLOOR, 0);
      h.scale.setScalar((i === selectedNode ? 1.35 : 1) * (coarse ? 1.4 : 1));
      h.userData.node = i;
      const core = new THREE.Mesh(handleGeo, i === selectedNode ? handleSelMat : handleMat);
      core.renderOrder = 10;
      h.add(core);
      handles.add(h);
    });
    handles.visible = mode === "build";
    creature.update(0, 0); // settle into the rest pose so the joint handles sit on the joints
    creature.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(creature.root);
    bounds = { w: Math.max(2, box.max.x - box.min.x, box.max.z - box.min.z), h: Math.max(1.5, box.max.y - box.min.y) };
    updatePartHalo();
    renderGrips();
    renderStats();
    renderDna();
    renderCtx();
  }
  /** Rebuild once, on the next frame (drags and colour drags call this many times a frame). */
  const scheduleRebuild = () => (needsRebuild = true);
  const centre = new THREE.Vector3();
  /** World size of the creature as built, for framing it in the free part of the screen. */
  let bounds = { w: 4, h: 3 };
  let framing = 0;
  const coarse = matchMedia("(pointer: coarse)").matches;

  /* ---- stats, DNA ------------------------------------------------------------ */
  const cost = () => designCost(original, rec);
  const problems = () => {
    const list = [];
    if (!rec.parts.some((p) => creaturePart(p.id).slot === "mouth")) list.push("Add a mouth");
    if (!rec.legs.length) list.push("Add at least one pair of legs");
    if (cost() > o.dna) list.push("Not enough DNA");
    return list;
  };
  function renderDna() {
    const c = cost();
    $("#ceDna").innerHTML = `${ICONS.dna}<b>${o.dna - c}</b> DNA${c ? ` <small>(−${c})</small>` : ""}`;
    $("#ceDna").classList.toggle("over", c > o.dna);
    const issues = problems();
    $("#ceDone").disabled = issues.length > 0;
    $("#ceDone").title = issues.length ? issues.join(". ") : "Save this design";
    $("#ceUndo").disabled = !history.canUndo;
    $("#ceRedo").disabled = !history.canRedo;
    $("#ceUndo").title = history.canUndo ? `Undo ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo";
    $("#ceRedo").title = history.canRedo ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo";
    badge.set(isDirty() ? (drafts.savedAt ? "draft" : "dirty") : "clean");
  }
  function renderStats() {
    // The part budget: how many parts this brain can manage.
    const budget = $("#ceBudget");
    if (budget) {
      budget.textContent = rec.parts.length + "/" + maxParts + " parts";
      budget.classList.toggle("full", rec.parts.length >= maxParts);
    }
    const shown = view();
    const ab = abilitiesOf(creaturePartIds(shown), shown.legs.length, armPairsOf(shown));
    const mouthId = mouthOf(shown);
    const diet = mouthId ? mouthDiet(mouthId) : "omni";
    const bar = (v) => `<i aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<b class="${n <= v ? "on" : ""}"></b>`).join("")}</i>`;
    const row = (k, name) => `<div class="ceStat" aria-label="${name} ${ab[k] || 0} of 5"><span>${name}</span>${bar(ab[k])}<em class="edNum">${ab[k] || 0}</em></div>`;
    // How the body moves: plan, legs, bulk, tail and fins (see anatomy.js). Trade-offs, not upgrades.
    const mv = movementOf(shown, ab);
    const mrow = (name, v, tip) => `<div class="ceStat" title="${tip}" aria-label="${name} ${v} of 5"><span>${name}</span>${bar(v)}<em class="edNum">${v}</em></div>`;
    const bulk = mv.bulk < 0.85 ? "Light" : mv.bulk < 1.35 ? "Medium" : "Heavy";
    // While another mouth is being previewed, its numbers carry a comparison with the one you have equipped.
    const equippedMouth = mouthOf(rec);
    const caps = [COMBAT.some((k) => ab[k] > 0) && "Fighter", SOCIAL.some((k) => ab[k] > 0) && "Socialite", ab.glide > 0 && "Glider", ab.jump > 1 && "Jumper", mv.swim > 1 && "Swimmer"].filter(Boolean);
    $("#ceStats").innerHTML =
      `<button class="edStatsToggle" id="ceStatsToggle" aria-expanded="${statsOpen}" aria-label="Show all statistics">${ICONS.stats}</button>` +
      `<h3><span class="edDiet diet-${diet}">${DIET_NAME[diet]}</span><span class="edPlan">${mv.planName}</span></h3>` +
      `<p class="edCaps">${caps.length ? caps.map((c) => `<span>${c}</span>`).join("") : "<span>Basic body</span>"}</p>` +
      (previewId && mouthId !== equippedMouth ? '<p class="cePrevNote">Previewing, not equipped yet</p>' : "") +
      '<div class="edStatsMore">' +
      mouthPanelHtml(mouthId, previewId && mouthId !== equippedMouth ? equippedMouth : null) +
      (mouthId ? `<p class="edWhy">${esc(DIET_NAME[diet])} because of the ${esc(creaturePart(mouthId).name)}: ${diet === "plant" ? "it can only eat plants." : diet === "meat" ? "it can only eat meat." : "it eats plants and meat."}</p>` : "") +
      "<h4>Movement</h4>" +
      mrow("Top speed", rate(mv.top, 3, 9), `${mv.top.toFixed(1)} m/s. Longer legs and fast feet help; bulk slows you.`) +
      mrow("Agility", rate(mv.turn * mv.accel, 8, 36), "How quickly you turn and get going. More legs and a tail help; bulk hurts.") +
      mrow("Swimming", rate(mv.swim, 0.55, 1.35), "Fins, webbed feet and tentacles swim faster.") +
      `<div class="ceStat" title="Heavy bodies hit harder in a charge but are spotted from further away."><span>Build</span><em>${bulk}</em></div>` +
      "<h4>Combat</h4>" +
      COMBAT.map((k) => row(k, ABILITY_INFO[k].name)).join("") +
      "<h4>Social</h4>" +
      SOCIAL.map((k) => row(k, ABILITY_INFO[k].name)).join("") +
      "<h4>Body</h4>" +
      ["health", "sight", "hearing", "sneak", "jump", "glide"].map((k) => row(k, STAT_INFO[k].name)).join("") +
      "</div>";
    $("#ceStatsToggle").onclick = () => {
      statsOpen = !statsOpen;
      root.classList.toggle("statsOpen", statsOpen);
      renderStats();
    };
  }
  let statsOpen = false;
  /** The mouth part id on a design. */
  const mouthOf = (r) => r.parts.find((p) => creaturePart(p.id)?.slot === "mouth")?.id || null;
  /** The design as shown: with the previewed part swapped in (mouth, tail or foot), otherwise as built. */
  function view() {
    if (!previewId) return rec;
    const def = creaturePart(previewId);
    if (!def || !["mouth", "tail", "foot"].includes(def.slot)) return rec;
    return withPart(rec, previewId);
  }
  /** A copy of the design with an exclusive part (mouth, tail, foot) swapped in, keeping the old one's size and place. */
  function withPart(r, id) {
    const def = creaturePart(id);
    const copy = JSON.parse(JSON.stringify(r));
    if (def.slot === "foot") copy.foot = id;
    else {
      const old = copy.parts.find((p) => creaturePart(p.id)?.slot === def.slot);
      copy.parts = copy.parts.filter((p) => creaturePart(p.id)?.slot !== def.slot);
      copy.parts.push({ scale: 1, ...(old || {}), id, ...(old ? {} : DEFAULT_SPOT[def.slot] ? { t: DEFAULT_SPOT[def.slot][0], angle: DEFAULT_SPOT[def.slot][1] } : {}) });
    }
    return validateCreature(copy);
  }
  let previewId = null;

  /* ---- Body tab --------------------------------------------------------------- */
  /** A slider that is one undo step per drag (or per keyboard change). */
  function wireSlider(inp, label, set) {
    inp.onpointerdown = () => history.begin(label);
    inp.onkeydown = () => history.inTransaction || history.begin(label);
    inp.oninput = () => {
      if (!history.inTransaction) history.begin(label);
      lowDetail = true;
      set(+inp.value);
      scheduleRebuild();
    };
    inp.onchange = () => {
      lowDetail = false;
      history.end();
      scheduleRebuild();
    };
  }
  function renderBodyTab() {
    const node = rec.spine[selectedNode];
    const shape = (kind, minus, plus) => `<div class="edStep"><span>${kind[1]}</span><button data-shape="${kind[0]}" data-dir="-1" aria-label="${minus}">${ICONS.minus}</button><button data-shape="${kind[0]}" data-dir="1" aria-label="${plus}">${ICONS.plus}</button></div>`;
    $('[data-pane="body"]').innerHTML = `
      <div class="ceGroup">
        <h4>Quick shape</h4>
        <div class="edSteps">
          ${shape(["length", "Length"], "Shorter body", "Longer body")}
          ${shape(["bulk", "Bulk"], "Thinner body", "Bulkier body")}
          ${shape(["head", "Head"], "Smaller head", "Bigger head")}
          ${shape(["tail", "Rump"], "Slimmer rump", "Thicker rump")}
          ${shape(["arch", "Arch"], "Sag the back", "Arch the back")}
        </div>
      </div>
      <div class="ceGroup">
        <h4>Spine <small>${rec.spine.length} / ${LIMITS.maxNodes}</small></h4>
        <div class="ceRow">
          <button id="ceAddNode" ${rec.spine.length >= LIMITS.maxNodes ? "disabled" : ""}>${ICONS.plus} Vertebra <small>${NODE_COST} DNA</small></button>
          <button id="ceDelNode" ${node && rec.spine.length > LIMITS.minNodes ? "" : "disabled"}>${ICONS.minus} Remove selected</button>
        </div>
        <label class="ceSlider ${node ? "" : "off"}">Girth${node ? "" : " <small>(tap a spine handle)</small>"}
          <input type="range" id="ceGirth" min="${LIMITS.minR}" max="${LIMITS.maxR}" step="0.01" value="${node ? node.r : 0.45}" ${node ? "" : "disabled"}>
        </label>
      </div>
      <div class="ceGroup">
        <h4>Legs <small>${rec.legs.length} / ${LIMITS.maxLegPairs} pairs</small></h4>
        ${rec.legs
          .map(
            (l, i) => `<div class="ceLeg">
              <b>Pair ${i + 1}</b>
              <label>Position <input type="range" data-leg="${i}" data-k="t" min="0.05" max="0.95" step="0.01" value="${l.t}" aria-label="Leg pair ${i + 1} position"></label>
              <label>Length <input type="range" data-leg="${i}" data-k="length" min="${LIMITS.minLeg}" max="${LIMITS.maxLeg}" step="0.05" value="${l.length}" aria-label="Leg pair ${i + 1} length"></label>
              <label>Knees <input type="range" data-leg="${i}" data-k="bend" min="-1" max="1" step="0.05" value="${l.bend || 0}" aria-label="Leg pair ${i + 1} knee bend"></label>
              <button data-delleg="${i}" aria-label="Remove leg pair ${i + 1}">${ICONS.close}</button>
            </div>`,
          )
          .join("")}
        <button id="ceAddLeg" ${rec.legs.length >= LIMITS.maxLegPairs ? "disabled" : ""}>${ICONS.plus} Leg pair <small>${LEG_COST} DNA</small></button>
      </div>
      <div class="ceGroup">
        <h4>Arms <small>${rec.arms.length} / ${LIMITS.maxArmPairs} pairs</small></h4>
        ${rec.arms
          .map(
            (a, i) => `<div class="ceLeg ceArm">
              <b>Pair ${i + 1}<small>${a.hand ? esc(creaturePart(a.hand)?.name || "") : "No hands"}</small></b>
              <label>Position <input type="range" data-arm="${i}" data-k="t" min="0.05" max="0.95" step="0.01" value="${a.t}" aria-label="Arm pair ${i + 1} position"></label>
              <label>Length <input type="range" data-arm="${i}" data-k="length" min="${LIMITS.minArm}" max="${LIMITS.maxArm}" step="0.05" value="${a.length}" aria-label="Arm pair ${i + 1} length"></label>
              <label>Elbows <input type="range" data-arm="${i}" data-k="bend" min="-1" max="1" step="0.05" value="${a.bend || 0}" aria-label="Arm pair ${i + 1} elbow bend"></label>
              <button data-delarm="${i}" aria-label="Remove arm pair ${i + 1}">${ICONS.close}</button>
            </div>`,
          )
          .join("")}
        <button id="ceAddArm" ${rec.arms.length >= LIMITS.maxArmPairs ? "disabled" : ""}>${ICONS.plus} Arm pair <small>${ARM_COST} DNA</small></button>
      </div>`;
    const p = $('[data-pane="body"]');
    p.querySelectorAll("[data-shape]").forEach(
      (b) =>
        (b.onclick = () => {
          commit("shape");
          rec.spine = shapeSpine(rec.spine, b.dataset.shape, +b.dataset.dir);
          rebuild();
          o.sfx("click");
        }),
    );
    p.querySelector("#ceAddNode").onclick = () => insertNode();
    p.querySelector("#ceDelNode").onclick = () => removeNode();
    const girth = p.querySelector("#ceGirth");
    wireSlider(girth, "girth", (v) => selectedNode >= 0 && (rec.spine[selectedNode].r = v));
    p.querySelectorAll("input[data-leg]").forEach((inp) => wireSlider(inp, "leg", (v) => (rec.legs[+inp.dataset.leg][inp.dataset.k] = v)));
    p.querySelectorAll("[data-delleg]").forEach(
      (b) =>
        (b.onclick = () => {
          commit("remove legs");
          rec.legs.splice(+b.dataset.delleg, 1);
          rebuild();
          renderBodyTab();
        }),
    );
    p.querySelectorAll("input[data-arm]").forEach((inp) => wireSlider(inp, "arm", (v) => (rec.arms[+inp.dataset.arm][inp.dataset.k] = v)));
    p.querySelectorAll("[data-delarm]").forEach(
      (b) =>
        (b.onclick = () => {
          commit("remove arms");
          rec.arms.splice(+b.dataset.delarm, 1);
          rebuild();
          renderBodyTab();
        }),
    );
    p.querySelector("#ceAddArm").onclick = () => addArmAt(null, null, "paw");
    p.querySelector("#ceAddLeg").onclick = () => addLegAt(null);
  }
  function insertNode() {
    if (rec.spine.length >= LIMITS.maxNodes) return;
    commit("add vertebra");
    const i = selectedNode >= 0 && selectedNode < rec.spine.length - 1 ? selectedNode : rec.spine.length - 2;
    const a = rec.spine[i],
      b = rec.spine[i + 1];
    rec.spine.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: (a.r + b.r) / 2 });
    selectedNode = i + 1;
    rebuild();
    refreshPanels();
    o.sfx("click");
  }
  function removeNode() {
    if (selectedNode < 0 || rec.spine.length <= LIMITS.minNodes) return;
    commit("remove vertebra");
    rec.spine.splice(selectedNode, 1);
    selectedNode = -1;
    rebuild();
    refreshPanels();
  }

  /* ---- Parts tab ---------------------------------------------------------------- */
  let thumbs = new Map();
  let partSection = PART_SECTIONS[0][0];
  /** The catalogue card shown in the detail panel. */
  let focusId = null;
  /** Catalogue browsing: search words, filter, sort, and an ability or diet to narrow by. */
  const browseState = { query: "", filter: "all", sort: "default", narrow: "", open: false };
  const seenPart = (id) => !o.seen || o.seen.has(id) || id === LEG_CARD.id || id === ARM_CARD.id;
  const equippedNow = (def) =>
    def.slot === "foot" ? rec.foot === def.id || rec.arms.some((a) => a.hand === def.id) : def.slot === "hand" ? rec.arms.some((a) => a.hand === def.id) : def.slot === "leg" || def.slot === "arm" ? false : rec.parts.some((p) => p.id === def.id);
  /** One at a time: choosing it replaces what is there. */
  const isExclusive = (def) => ["mouth", "tail", "foot", "hand"].includes(def.slot);
  const PREVIEWABLE = ["mouth", "tail", "foot"];
  const defsOf = (section) => {
    const defs = CREATURE_PARTS.filter((p) => p.section === section);
    if (section === "limbs") defs.unshift(LEG_CARD, ARM_CARD);
    return defs;
  };
  /** Every card, described for search and sorting (catalogue order kept as `order`). */
  const allEntries = () => {
    let n = 0;
    return PART_SECTIONS.flatMap(([section]) =>
      defsOf(section).map((d) => ({ id: d.id, name: d.name, section, cost: d.cost || 0, unlocked: isUnlocked(d.id), seen: seenPart(d.id), abilities: d.abilities || {}, diet: d.slot === "mouth" ? mouthDiet(d.id) : null, order: n++ })),
    );
  };
  const browsing = () => !!(browseState.query.trim() || browseState.filter !== "all" || browseState.narrow || browseState.sort !== "default");
  function renderPartsTab() {
    const pane = $('[data-pane="parts"]');
    const sel = rec.parts[selectedPart];
    const selDef = sel && creaturePart(sel.id);
    const title = browsing() ? "Results" : PART_SECTIONS.find(([id]) => id === partSection)[1];
    let defs;
    if (browsing()) {
      const [kind, key] = browseState.narrow.split(":");
      // Search runs across every section; the filters narrow the current one unless you typed.
      const pool = browseState.query.trim() ? allEntries() : allEntries().filter((e) => e.section === partSection);
      defs = browse(pool, { query: browseState.query, filter: browseState.filter, sort: browseState.sort, ability: kind === "ab" ? key : null, sortKey: kind === "ab" ? key : null, diet: kind === "diet" ? key : null, recent: recentParts.items, words: SEARCH_WORDS }).map((e) => cardDef(e.id));
    } else defs = defsOf(partSection);
    if (!focusId || !defs.some((d) => d.id === focusId)) focusId = (defs.find((d) => equippedNow(d)) || defs[0])?.id || null;
    const tile = (def) =>
      tileHtml(def, { thumb: thumbs.get(def.id === LEG_CARD.id ? "__leg" : def.id === ARM_CARD.id ? "__arm" : def.id), unlocked: isUnlocked(def.id), seen: seenPart(def.id), inUse: equippedNow(def), focused: def.id === focusId });
    let html = "";
    if (selDef) {
      html += `<div class="ceSelected"><b>${esc(selDef.name)}</b>
        <label>Size <input type="range" data-partk="scale" min="0.6" max="1.6" step="0.05" value="${sel.scale || 1}"></label>
        <label>Turn <input type="range" data-partk="roll" min="-3.14" max="3.14" step="0.05" value="${sel.roll || 0}"></label>
        <button id="cePartDel">${ICONS.trash} Remove</button></div>`;
    }
    const open = defs.filter((d) => isUnlocked(d.id)).length;
    const chip = (v, label) => `<button role="radio" data-filter="${v}" aria-checked="${browseState.filter === v}">${label}</button>`;
    const narrowed = browseState.filter !== "all" || browseState.narrow || browseState.sort !== "default";
    html += `<div class="edBrowse ${browseState.open ? "open" : ""}">
        <label class="edSearch">${ICONS.search}<input type="search" id="ceSearch" placeholder="Search parts" value="${esc(browseState.query)}" aria-label="Search parts" autocomplete="off" enterkeyhint="search">${browseState.query ? `<button id="ceSearchClear" aria-label="Clear search">${ICONS.close}</button>` : ""}</label>
        <button class="edFiltBtn ${narrowed ? "on" : ""}" id="ceFilt" aria-expanded="${browseState.open}" aria-label="Filters and sorting">${ICONS.sliders}</button>
        <div class="edFilters" role="radiogroup" aria-label="Show">${chip("all", "All")}${chip("unlocked", "Unlocked")}${chip("locked", "Locked")}${chip("recent", "Recent")}</div>
        <div class="edSorts">
          <select id="ceNarrow" aria-label="Narrow by ability or diet"><option value="">Any ability</option>
            <optgroup label="Diet">${MOUTH_DIETS.map((d) => `<option value="diet:${d}" ${browseState.narrow === "diet:" + d ? "selected" : ""}>${DIET_NAME[d]} mouths</option>`).join("")}</optgroup>
            <optgroup label="Combat">${COMBAT.map((k) => `<option value="ab:${k}" ${browseState.narrow === "ab:" + k ? "selected" : ""}>${ABILITY_INFO[k].name}</option>`).join("")}</optgroup>
            <optgroup label="Social">${SOCIAL.map((k) => `<option value="ab:${k}" ${browseState.narrow === "ab:" + k ? "selected" : ""}>${ABILITY_INFO[k].name}</option>`).join("")}</optgroup>
            <optgroup label="Body">${["speed", "health", "sight", "sneak", "jump", "glide"].map((k) => `<option value="ab:${k}" ${browseState.narrow === "ab:" + k ? "selected" : ""}>${STAT_INFO[k].name}</option>`).join("")}</optgroup>
          </select>
          <select id="ceSort" aria-label="Sort parts">${[["default", "Catalogue order"], ["name", "Name"], ["cost", "DNA cost"], ["ability", "Strongest"]].map(([v, l]) => `<option value="${v}" ${browseState.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        </div>
      </div>`;
    html += `<h3 class="ceCatTitle">${title}<small>${open}/${defs.length} unlocked</small><small class="ceBudget" id="ceBudget"></small></h3><div class="ceGrid" id="ceGrid" role="group" aria-label="${title}">`;
    if (!defs.length) html += `<p class="edEmpty">No parts match. ${browseState.filter === "recent" ? "Parts you place show up here." : "Try fewer words or another filter."}</p>`;
    else if (partSection === "mouth" && !browsing()) {
      // Mouths are grouped by what they let you eat.
      for (const diet of MOUTH_DIETS) {
        html += `<h4 class="ceDietHead diet-${diet}">${DIET_NAME[diet]}</h4>`;
        for (const id of mouthsOfDiet(diet)) html += tile(creaturePart(id));
      }
    } else html += defs.map(tile).join("");
    html += '</div><div class="ceInfo" id="ceInfo" aria-live="polite"></div>';
    const grid0 = pane.querySelector(".ceGrid");
    const key = partSection + "|" + browsing();
    const keepScroll = pane.dataset.section === key && grid0 ? grid0.scrollTop : 0;
    const keepLeft = pane.dataset.section === key && grid0 ? grid0.scrollLeft : 0;
    const hadFocus = document.activeElement?.id === "ceSearch";
    const caret = hadFocus ? document.activeElement.selectionStart : 0;
    pane.innerHTML = html;
    pane.dataset.section = key;
    const grid = pane.querySelector(".ceGrid");
    grid.scrollTop = keepScroll;
    grid.scrollLeft = keepLeft;
    if (selDef) {
      pane.querySelectorAll("input[data-partk]").forEach((inp) => wireSlider(inp, inp.dataset.partk === "scale" ? "resize" : "turn", (v) => (rec.parts[selectedPart][inp.dataset.partk] = v)));
      pane.querySelector("#cePartDel").onclick = removeSelectedPart;
    }
    const search = pane.querySelector("#ceSearch");
    search.oninput = () => {
      browseState.query = search.value;
      renderPartsTab();
    };
    if (hadFocus) {
      search.focus({ preventScroll: true });
      search.setSelectionRange(caret, caret);
    }
    pane.querySelector("#ceSearchClear")?.addEventListener("click", () => {
      browseState.query = "";
      renderPartsTab();
    });
    pane.querySelector("#ceFilt").onclick = () => {
      browseState.open = !browseState.open;
      renderPartsTab();
    };
    pane.querySelectorAll("[data-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          browseState.filter = b.dataset.filter;
          renderPartsTab();
        }),
    );
    pane.querySelector("#ceNarrow").onchange = (e) => {
      browseState.narrow = e.target.value;
      if (browseState.narrow.startsWith("ab:") && browseState.sort === "default") browseState.sort = "ability";
      renderPartsTab();
    };
    pane.querySelector("#ceSort").onchange = (e) => {
      browseState.sort = e.target.value;
      renderPartsTab();
    };
    pane.querySelectorAll(".cePart").forEach((card) => wireCard(card));
    grid.onkeydown = gridKeys;
    sizeTiles();
    renderInfo();
    renderStats(); // refreshes the part budget in the title
  }
  /** In the side panel, tiles are squares that fill four columns exactly (the sheet uses fixed sizes). */
  function sizeTiles() {
    const grid = root.querySelector(".ceGrid");
    if (!grid || !root.classList.contains("side")) return;
    const cs = window.getComputedStyle(grid);
    const inner = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 8;
    if (inner > 0) root.style.setProperty("--tile", Math.floor((inner - gap * 3) / 4) + "px");
  }
  /** Arrow keys move between tiles. */
  function gridKeys(e) {
    const tiles = [...e.currentTarget.querySelectorAll(".cePart")];
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = window.getComputedStyle(e.currentTarget).gridTemplateColumns.split(" ").length || 1;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (!step) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, i + step))].focus();
  }
  /** Fill the detail card for the focused part. */
  function renderInfo() {
    const box = $("#ceInfo");
    if (!box) return;
    const def = focusId && cardDef(focusId);
    if (!def) {
      box.innerHTML = '<p class="ceDesc">Select a part to see what it does.</p>';
      return;
    }
    const unlocked = isUnlocked(def.id);
    const ids = creaturePartIds(rec);
    const afterIds = isExclusive(def) ? creaturePartIds(withPart(rec, def.id)) : [...ids, def.id];
    const legs = rec.legs.length + (def.slot === "leg" ? 1 : 0),
      arms = armPairsOf(rec) + (def.slot === "arm" ? 1 : 0);
    const now = abilitiesOf(ids, rec.legs.length, armPairsOf(rec));
    const after = def.slot === "leg" || def.slot === "arm" ? abilitiesOf(ids, legs, arms) : abilitiesOf(afterIds, rec.legs.length, armPairsOf(rec));
    const inUse = equippedNow(def);
    const extra = isExclusive(def) && def.slot !== "hand" ? designCost(original, withPart(rec, def.id)) - cost() : def.cost;
    let blocked = "";
    if (!inUse || !isExclusive(def)) {
      if (def.slot === "leg" && rec.legs.length >= LIMITS.maxLegPairs) blocked = "Most legs reached";
      else if (def.slot === "arm" && rec.arms.length >= LIMITS.maxArmPairs) blocked = "Most arms reached";
      else if (!["leg", "arm", "foot", "hand"].includes(def.slot) && !isExclusive(def) && rec.parts.length >= maxParts) blocked = "Part limit reached";
      else if (cost() + Math.max(0, extra) > o.dna) blocked = "Not enough DNA";
    }
    $("#ceInfo").innerHTML = infoHtml(def, { unlocked, seen: seenPart(def.id), inUse, previewing: previewId === def.id, progress: o.progress || {}, mouthNow: mouthOf(rec), now, after, exclusive: isExclusive(def), blocked });
    box.querySelector("[data-act=equip]")?.addEventListener("click", equipFocused);
  }
  /** Select a catalogue card: show its details, and (for mouths, tails and feet) preview it on the creature. */
  function setFocus(id) {
    const def = cardDef(id);
    if (!def) return;
    focusId = id;
    selectedPart = -1;
    selectedNode = -1;
    // A part you have neither unlocked nor seen stays a mystery: no preview, no numbers.
    previewId = PREVIEWABLE.includes(def.slot) && !equippedNow(def) && (isUnlocked(id) || seenPart(id)) ? id : null;
    root.querySelectorAll(".cePart").forEach((t) => {
      const on = t.dataset.part === id;
      t.classList.toggle("focused", on);
      t.setAttribute("aria-pressed", String(on));
    });
    rebuild();
    renderInfo();
    const unlocked = isUnlocked(id);
    const name = shownName(def, { unlocked, seen: seenPart(id) });
    hint(previewId ? `Previewing ${name}${unlocked ? ". Equip it to keep it." : " (locked)."}` : unlocked ? `${name}: ${def.desc}` : `${name} is locked.`);
  }
  /** Put the focused part on the creature, where its slot goes by default. */
  function equipFocused() {
    const def = focusId && cardDef(focusId);
    if (!def || !isUnlocked(def.id)) return;
    previewId = null;
    if (def.slot === "leg" || def.slot === "arm") return placePart(def.id, null, null);
    const [t, a] = DEFAULT_SPOT[def.slot] || [0.5, 0];
    // A second copy of a flank part goes further back.
    const copies = rec.parts.filter((p) => creaturePart(p.id).slot === def.slot).length;
    placePart(def.id, def.slot === "side" || def.slot === "back" ? Math.max(0.15, t - copies * 0.18) : t, a);
    renderInfo();
  }
  function removeSelectedPart() {
    if (selectedPart < 0) return;
    commit("remove part");
    const gone = creaturePart(rec.parts[selectedPart].id);
    rec.parts.splice(selectedPart, 1);
    selectedPart = -1;
    rebuild();
    refreshPanels();
    o.sfx("click");
    hint(`${gone?.name || "Part"} removed. Undo brings it back.`);
  }
  /** Another copy of the selected part, a little further along the body. */
  function duplicateSelected() {
    const p = rec.parts[selectedPart];
    const def = p && creaturePart(p.id);
    if (!def) return;
    if (isExclusive(def)) return hint(`A creature has one ${def.slot}. Pick another from the catalogue to swap it.`);
    if (rec.parts.length >= maxParts) return hint(maxParts < LIMITS.maxParts ? "Your brain can manage " + maxParts + " parts for now." : "That's the most parts one creature can carry.");
    const extra = def.cost || 0;
    if (cost() + extra > o.dna && !creaturePartIds(original).includes(def.id)) return hint("Not enough DNA for another one.");
    commit("duplicate");
    const t = p.t > 0.5 ? p.t - 0.14 : p.t + 0.14;
    rec.parts.push({ ...JSON.parse(JSON.stringify(p)), t: THREE.MathUtils.clamp(t, 0.04, 0.96) });
    selectedPart = rec.parts.length - 1;
    pop = { index: selectedPart, t: 0 };
    rebuild();
    refreshPanels();
    o.sfx("unlock");
    hint(`${def.name} copied. Drag the copy where you want it.`);
  }
  /** Turn the selected part's mirror twin on or off (only for parts off the midline). */
  function toggleSolo() {
    const p = rec.parts[selectedPart];
    if (!p || !offMidline(p.angle)) return hint("Parts on the midline have no twin to mirror.");
    commit(p.solo ? "mirror" : "unmirror");
    if (p.solo) delete p.solo;
    else p.solo = true;
    rebuild();
    hint(p.solo ? "One-sided now: no twin on the other flank. Tap again to mirror it back." : "Mirrored again: its twin is back on the other flank.");
  }

  /* ---- Paint tab -------------------------------------------------------------------- */
  let paintLayer = "base";
  let copiedColour = null;
  let picker = null;
  /** The colours you came into Paint with, so leaving can remember a new scheme as recent. */
  let paintEntry = null;
  const schemeOf = (r) => ({ colors: { ...r.colors }, pattern: r.pattern });
  const dots = (c) => `<span class="edDots" aria-hidden="true">${["base", "belly", "pattern", "accent"].map((k) => `<i style="background:${toHex(c[k])}"></i>`).join("")}</span>`;
  function renderPaintTab() {
    const pane = $('[data-pane="paint"]');
    const layerBtn = ([k, name, sub]) => `<button role="radio" data-layer="${k}" aria-checked="${k === paintLayer}" title="${sub}"><i style="background:${toHex(rec.colors[k])}"></i><b>${name}</b></button>`;
    const preset = (p, i, list) => `<button class="edScheme" data-scheme="${list}:${i}" title="${esc(p.name || "Scheme")}">${dots(p.colors)}<span>${esc(p.name || "")}</span></button>`;
    const groups = ["Natural", "Fantasy", "Bright"];
    pane.innerHTML = `
      <div class="edLayers" role="radiogroup" aria-label="Colour layer">${LAYERS.map(layerBtn).join("")}</div>
      <div class="edLayerTools"><span>${LAYERS.find((l) => l[0] === paintLayer)[2]}</span>
        <button id="ceCopyC" title="Copy this colour">${ICONS.copy}<span>Copy</span></button>
        <button id="cePasteC" ${copiedColour === null ? "disabled" : ""} title="Paste the copied colour onto this layer">${copiedColour !== null ? `<i style="background:${toHex(copiedColour)}"></i>` : ""}<span>Paste</span></button>
        <button id="ceResetC" ${rec.colors[paintLayer] === original.colors[paintLayer] ? "disabled" : ""} title="Back to this layer's saved colour">${ICONS.reset}<span>Reset</span></button>
      </div>
      <div class="edPickerSlot"></div>
      <div class="ceGroup"><h4>Pattern</h4><div class="edPatterns" role="radiogroup" aria-label="Pattern">${PATTERNS.map(
        ([id, name]) => `<button role="radio" aria-checked="${rec.pattern === id}" data-pattern="${id}" class="pat-${id}" style="--pa:${toHex(rec.colors.base)};--pb:${toHex(rec.colors.pattern)};--pc:${toHex(rec.colors.accent)}"><i></i><span>${name}</span></button>`,
      ).join("")}</div></div>
      <div class="ceGroup"><h4>Schemes</h4>
        ${groups.map((g) => `<h5>${g}</h5><div class="edSchemes">${CREATURE_PRESETS.map((p, i) => (p.group === g ? preset(p, i, "preset") : "")).join("")}</div>`).join("")}
        <h5>Recent</h5><div class="edSchemes">${recentSchemes.items.length ? recentSchemes.items.map((p, i) => preset(p, i, "recent")).join("") : '<p class="edEmpty">Schemes you paint show up here.</p>'}</div>
        <h5>Mine <button class="edSmall" id="ceSaveScheme">${ICONS.save} Save current</button></h5><div class="edSchemes">${savedSchemes.items.length ? savedSchemes.items.map((p, i) => preset({ ...p, name: "" }, i, "mine")).join("") : '<p class="edEmpty">Save a scheme to use it on other creatures.</p>'}</div>
      </div>`;
    picker = createColorPicker({
      value: rec.colors[paintLayer],
      label: LAYERS.find((l) => l[0] === paintLayer)[1] + " colour",
      recent: recentColours,
      onStart: () => history.begin("paint"),
      onInput: (c) => {
        rec.colors[paintLayer] = c;
        lowDetail = true;
        scheduleRebuild();
        const sw = pane.querySelector(`[data-layer="${paintLayer}"] i`);
        if (sw) sw.style.background = toHex(c);
      },
      onCommit: () => {
        lowDetail = false;
        history.end();
        scheduleRebuild();
        pane.querySelector("#ceResetC").disabled = rec.colors[paintLayer] === original.colors[paintLayer];
      },
    });
    pane.querySelector(".edPickerSlot").appendChild(picker.el);
    pane.querySelectorAll("[data-layer]").forEach(
      (b) =>
        (b.onclick = () => {
          paintLayer = b.dataset.layer;
          renderPaintTab();
        }),
    );
    pane.querySelector("#ceCopyC").onclick = () => {
      copiedColour = rec.colors[paintLayer];
      hint("Colour copied. Choose another layer and Paste.");
      renderPaintTab();
    };
    pane.querySelector("#cePasteC").onclick = () => {
      if (copiedColour === null) return;
      commit("paste colour");
      rec.colors[paintLayer] = copiedColour;
      rebuild();
      renderPaintTab();
    };
    pane.querySelector("#ceResetC").onclick = () => {
      commit("reset colour");
      rec.colors[paintLayer] = original.colors[paintLayer];
      rebuild();
      renderPaintTab();
    };
    pane.querySelectorAll("[data-pattern]").forEach(
      (b) =>
        (b.onclick = () => {
          if (rec.pattern === b.dataset.pattern) return;
          commit("pattern");
          rec.pattern = b.dataset.pattern;
          rebuild();
          renderPaintTab();
          pulse(b);
        }),
    );
    pane.querySelectorAll("[data-scheme]").forEach(
      (b) =>
        (b.onclick = () => {
          const [list, i] = b.dataset.scheme.split(":");
          const p = list === "preset" ? CREATURE_PRESETS[+i] : list === "recent" ? recentSchemes.items[+i] : savedSchemes.items[+i];
          if (!p) return;
          commit("scheme");
          rec.colors = { ...rec.colors, ...p.colors };
          if (PATTERNS.some(([id]) => id === p.pattern)) rec.pattern = p.pattern;
          rebuild();
          renderPaintTab();
          hint(p.name ? `${p.name} colours.` : "Scheme applied.");
        }),
    );
    pane.querySelector("#ceSaveScheme").onclick = () => {
      savedSchemes.add(schemeOf(rec));
      hint("Scheme saved. It's under Mine on every creature.");
      renderPaintTab();
    };
  }

  /* ---- modes and tabs ------------------------------------------------------------ */
  let mode = "build";
  let tab = "body";
  /** Build mode's pane (body or parts) and the rail icon that goes with it. */
  function setTab(name) {
    if (name === "paint") return setMode("paint");
    if (mode !== "build") setMode("build", true);
    tab = name;
    if (name !== "parts" && previewId) {
      previewId = null;
      rebuild();
    }
    const cat = name === "parts" ? partSection : name;
    root.querySelectorAll(".ceRail [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === cat)));
    root.querySelectorAll(".ceTab").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "body") renderBodyTab();
    else renderPartsTab();
  }
  function refreshPanels() {
    if (mode === "paint") renderPaintTab();
    else if (tab === "body") renderBodyTab();
    else renderPartsTab();
  }
  /** Build, Paint or Test. Switching never changes the design. */
  function setMode(m, keepTab = false) {
    if (m === mode && keepTab) return;
    const was = mode;
    if (was === "paint" && m !== "paint" && paintEntry && !sameScheme(paintEntry, schemeOf(rec))) recentSchemes.add(schemeOf(rec));
    mode = m;
    root.classList.remove("mode-build", "mode-paint", "mode-test");
    root.classList.add("mode-" + m);
    root.querySelectorAll(".edModes [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    closePops();
    if (was === "test" && m !== "test") stopTest();
    if (m === "paint") {
      paintEntry = schemeOf(rec);
      previewId = null;
      selectedNode = selectedPart = -1;
      root.querySelectorAll(".ceTab").forEach((p) => (p.hidden = p.dataset.pane !== "paint"));
      renderPaintTab();
      if (drawer?.state === "peek" && phoneLayout()) drawer.set("half");
      hint("Pick a layer, then a colour. Drag in the big square for any shade.");
    } else if (m === "build" && !keepTab) setTab(tab);
    else if (m === "test") startTest();
    handles.visible = m === "build";
    rebuild();
    fitCamera();
    if (was !== m) o.sfx("click");
  }
  root.querySelectorAll(".edModes [data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  root.querySelectorAll(".ceRail [role=tab]").forEach(
    (b) =>
      (b.onclick = () => {
        const cat = b.dataset.cat;
        if (drawer?.state === "peek" && phoneLayout()) drawer.set("half");
        if (cat === "body") return setTab("body");
        if (cat !== partSection || tab !== "parts" || browsing()) {
          partSection = cat;
          focusId = null;
          // Choosing a category leaves search results.
          browseState.query = "";
          browseState.filter = "all";
          browseState.narrow = "";
          browseState.sort = "default";
          if (previewId) {
            previewId = null;
            rebuild();
          }
        }
        setTab("parts");
      }),
  );

  /* ---- placing parts -------------------------------------------------------- */
  const canvas = o.renderer.domElement;
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }
  /** Body-surface hit as spine fraction and angle, or null. */
  function surfaceAt(clientX, clientY) {
    if (!creature) return null;
    creature.root.updateMatrixWorld(true);
    const hit = rayFrom(clientX, clientY).intersectObject(creature.torso, false)[0];
    if (!hit) return null;
    const local = creature.body.worldToLocal(hit.point.clone());
    // Find t by scanning the surface lookup, then the angle around the spine at that t.
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40,
        c = creature.surface(t, 0);
      const d = Math.abs(c.point.x - local.x);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    const top = creature.surface(best, 0);
    const centreY = top.point.y - top.r * 0.9;
    const angle = Math.atan2(local.z / Math.max(0.01, top.r), (local.y - centreY) / Math.max(0.01, top.r * 0.9));
    return { t: best, angle, point: hit.point };
  }
  /**
   * Spore lets any part go anywhere on the body. A part dropped close to the midline snaps onto it
   * (one centred copy); a mouth dropped near the head, or a tail near the rump, snaps to the tip.
   */
  function snapSpot(def, t, angle) {
    if (def.slot === "mouth" && t > 0.86 && Math.abs(angle) < 0.7) return { t: 1, angle: 0 };
    if (def.slot === "tail" && t < 0.14 && Math.abs(angle) < 0.7) return { t: 0, angle: 0 };
    const a = Math.abs(angle) < 0.18 ? 0 : Math.abs(angle) > Math.PI - 0.18 ? Math.PI : angle;
    return { t: THREE.MathUtils.clamp(t, 0.02, 0.98), angle: a };
  }
  const isUnlocked = (id) => id === LEG_CARD.id || id === ARM_CARD.id || o.unlocked.has(id);
  function placePart(id, t, angle) {
    if (id === LEG_CARD.id) return addLegAt(t);
    if (id === ARM_CARD.id) return addArmAt(t, angle, "paw");
    const def = creaturePart(id);
    if (!def || !o.unlocked.has(id)) return;
    // A grasper dropped on the body grows a pair of arms there to hold it (or goes on the arms you have).
    if (def.slot === "hand") return rec.arms.length ? setHand(0, id) : addArmAt(t, angle, id);
    commit("add " + def.name);
    if (def.slot === "foot") rec.foot = id;
    else {
      // Swapping a mouth or tail keeps the old one's size and turn, so it grows from the same place.
      const old = def.slot === "mouth" || def.slot === "tail" ? rec.parts.find((p) => creaturePart(p.id).slot === def.slot) : null;
      if (old) rec.parts = rec.parts.filter((p) => p !== old);
      if (rec.parts.length >= maxParts) {
        hint(maxParts < LIMITS.maxParts ? "Your brain can manage " + maxParts + " parts for now. A bigger brain carries more." : "That's the most parts one creature can carry (" + maxParts + ").");
        history.discardLast();
        if (old) rec.parts.push(old);
        return;
      }
      const spot = snapSpot(def, t, angle);
      // With symmetry off, a part placed off the midline stays on its own side.
      rec.parts.push({ id, ...spot, scale: old?.scale || 1, ...(old?.roll ? { roll: old.roll } : {}), ...(!symmetry && offMidline(spot.angle) ? { solo: true } : {}) });
      selectedPart = rec.parts.length - 1;
      pop = { index: selectedPart, t: 0 };
    }
    recentParts.add(id);
    o.sfx("unlock");
    hint(def.name + ": " + def.desc);
    previewId = null;
    focusId = def.id;
    rebuild();
    if (mode === "build" && tab === "parts") renderPartsTab();
  }

  /** Put a hand (a grasper or a foot) on the end of arm pair i. */
  function setHand(i, id) {
    const arm = rec.arms[i];
    const def = creaturePart(id);
    if (!arm || !def || !fitsArm(id) || !o.unlocked.has(id)) return;
    if (arm.hand === id) return;
    commit("hands");
    arm.hand = id;
    recentParts.add(id);
    o.sfx("unlock");
    hint(def.name + (def.slot === "foot" ? " on your arms: walk on all fours, Spore-style." : ": " + def.desc));
    rebuild();
    refreshPanels();
  }
  /** Add a pair of arms where it was dropped (or on the chest), holding `hand`. */
  function addArmAt(t, angle, hand) {
    if (rec.arms.length >= LIMITS.maxArmPairs) {
      hint("Two pairs is the most arms a creature can have. Drop graspers on the ends of the ones you have.");
      return;
    }
    commit("add arms");
    rec.arms.push({
      t: THREE.MathUtils.clamp(t ?? ARM_SPOT.t, 0.05, 0.95),
      angle: THREE.MathUtils.clamp(Math.abs(angle ?? ARM_SPOT.angle), ARM_ANGLE.min, ARM_ANGLE.max),
      length: rec.arms[0]?.length || 1,
      bend: 0,
      hand,
    });
    recentParts.add(ARM_CARD.id);
    o.sfx("unlock");
    hint(hand && hand !== "paw" ? creaturePart(hand).name + " on a new pair of arms. Drag the elbows and hands to pose them." : "Arms! Drag graspers onto their ends, and the elbows and hands to pose them.");
    rebuild();
    refreshPanels();
  }
  /** The arm end (hand) nearest a screen point, within reach of a finger: { pair } or null. */
  function armEndAt(clientX, clientY, radius = 70) {
    if (!creature || !rec.arms.length) return null;
    let best = null,
      bestD = radius;
    for (const j of creature.joints()) {
      if (j.kind !== "arm") continue;
      const p = toScreen(j.foot);
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d < bestD) {
        bestD = d;
        best = { pair: j.pair, point: j.foot };
      }
    }
    return best;
  }

  /** Add a pair of legs at spine fraction t (or the best free spot when t is null). */
  function addLegAt(t) {
    if (rec.legs.length >= LIMITS.maxLegPairs) {
      hint("Three pairs is the most legs a creature can have.");
      return;
    }
    commit("add legs");
    const used = rec.legs.map((l) => l.t);
    const spot = t ?? [0.5, 0.3, 0.72, 0.15, 0.85].find((c) => used.every((u) => Math.abs(u - c) > 0.12)) ?? 0.5;
    rec.legs.push({ t: THREE.MathUtils.clamp(spot, 0.05, 0.95), length: rec.legs[0]?.length || 1.1 });
    recentParts.add(LEG_CARD.id);
    o.sfx("unlock");
    rebuild();
    refreshPanels();
  }
  /**
   * A catalogue tile: tap to select it (and preview it), or pull it onto the body. The grid scrolls
   * natively along its own axis (down in the side panel and the drawer, across in a short drawer);
   * a touch that moves across that axis picks the tile up instead, and a mouse picks it up in any
   * direction. Holding a tile still for a moment also picks it up, whichever way you then move.
   */
  function wireCard(card) {
    const id = card.dataset.part;
    const def = cardDef(id);
    let start = null,
      dragging = false,
      suppressClick = false,
      holdTimer = null;
    // The catalogue grid scrolls down in the side panel and in the drawer alike.
    const scrollsDown = () => true;
    const begin = (e) => {
      dragging = true;
      suppressClick = true;
      clearTimeout(holdTimer);
      card.classList.add("dragging");
      root.classList.add("placing");
      const img = thumbs.get(id === LEG_CARD.id ? "__leg" : id === ARM_CARD.id ? "__arm" : id);
      ghost.style.backgroundImage = img ? `url(${img})` : "";
      ghost.hidden = false;
      moveGhost(e);
      try {
        card.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already released */
      }
      buzz();
    };
    card.onpointerdown = (e) => {
      if (e.button > 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, e };
      suppressClick = false;
      clearTimeout(holdTimer);
      // Touch and hold: pick it up without needing to move across the scroll direction first.
      if (e.pointerType !== "mouse" && isUnlocked(id))
        holdTimer = setTimeout(() => {
          if (start && !dragging) begin(start.e);
        }, 380);
    };
    card.onpointermove = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start.e = e;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        clearTimeout(holdTimer);
        const along = scrollsDown() ? Math.abs(dy) > Math.abs(dx) * 1.2 : Math.abs(dx) > Math.abs(dy) * 1.2;
        // Along the grid's axis a finger is scrolling it: leave that to the browser.
        if (!isUnlocked(id) || (e.pointerType !== "mouse" && along)) {
          start = null;
          return;
        }
        begin(e);
      }
      e.preventDefault();
      moveGhost(e);
      // Graspers and feet snap onto the end of an arm when they are dragged near one.
      const end = fitsArm(id) ? armEndAt(e.clientX, e.clientY) : null;
      const s = end ? null : def.slot === "foot" ? null : surfaceAt(e.clientX, e.clientY);
      marker.visible = !!(end || s);
      ghost.classList.toggle("ok", !!(end || s));
      if (end) marker.position.copy(end.point);
      else if (s) marker.position.copy(s.point);
    };
    const end = (e) => {
      clearTimeout(holdTimer);
      if (dragging && e.type === "pointerup") {
        const s = surfaceAt(e.clientX, e.clientY);
        const overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas;
        const armEnd = fitsArm(id) ? armEndAt(e.clientX, e.clientY) : null;
        previewId = null;
        if (armEnd) setHand(armEnd.pair, id);
        else if (def.slot === "leg") {
          if (overCanvas) placePart(id, s ? s.t : null, 0);
        } else if (s) placePart(id, s.t, s.angle);
        else if (overCanvas && def.slot === "foot") placePart(id, 0.5, 0);
        else if (overCanvas) hint("Drop it on the body.");
      }
      dragging = false;
      start = null;
      marker.visible = false;
      ghost.hidden = true;
      ghost.classList.remove("ok");
      card.classList.remove("dragging");
      root.classList.remove("placing");
    };
    card.onpointerup = end;
    card.onpointercancel = end;
    // Once a part is picked up the finger carries it: the catalogue must not scroll away under it.
    card.addEventListener("touchmove", (e) => dragging && e.cancelable && e.preventDefault(), { passive: false });
    card.ondragstart = (e) => e.preventDefault();
    card.oncontextmenu = (e) => e.preventDefault(); // a long press must not open a menu
    card.onclick = (e) => {
      if (suppressClick) return;
      if (e.detail === 2 && isUnlocked(id) && focusId === id) return equipFocused(); // double click equips
      setFocus(id);
    };
  }
  const ghost = document.createElement("div");
  ghost.className = "ceGhost";
  ghost.hidden = true;
  root.appendChild(ghost);
  const moveGhost = (e) => {
    ghost.style.left = e.clientX + "px";
    ghost.style.top = e.clientY + "px";
  };
  const buzz = () => {
    try {
      navigator.vibrate?.(8);
    } catch (err) {
      /* not allowed */
    }
  };

  /* ---- viewport gestures: spine handles, parts, camera ------------------------------ */
  const profilePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  /** What is under a point: a spine handle (nearest within a finger's reach), a part, or nothing. */
  function hitAt(x, y, type) {
    if (mode !== "build" || !creature) return null;
    const ray = rayFrom(x, y);
    // The selected part is what you are working on: touching it again grabs it, even over a handle.
    const sel = selectedPart >= 0 && ray.intersectObjects(creature.partMeshes.filter((m) => m.userData.partIndex === selectedPart), false)[0];
    if (sel) return { part: selectedPart };
    const direct = ray.intersectObjects(handles.children, false)[0];
    if (direct) return { node: direct.object.userData.node };
    // A part right under the finger wins over a spine handle that is merely nearby.
    const under = ray.intersectObjects(creature.partMeshes, false)[0];
    if (under) return { part: under.object.userData.partIndex };
    const tolerance = type === "mouse" ? 14 : 34;
    let best = tolerance,
      node = -1;
    handles.children.forEach((obj) => {
      const p = toScreen(obj.getWorldPosition(new THREE.Vector3()));
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) {
        best = d;
        node = obj.userData.node;
      }
    });
    if (node >= 0) return { node };
    const p = ray.intersectObjects(creature.partMeshes, false)[0];
    if (p) return { part: p.object.userData.partIndex };
    return null;
  }
  function selectNode(i) {
    selectedNode = i;
    selectedPart = -1;
    rebuild();
    if (tab !== "body") setTab("body");
    else renderBodyTab();
  }
  function selectPart(i) {
    selectedPart = i;
    selectedNode = -1;
    // The catalogue follows: the part's own category, with its card focused.
    const def = creaturePart(rec.parts[i]?.id);
    if (def && !browsing() && PART_SECTIONS.some(([id]) => id === def.section)) {
      partSection = def.section;
      focusId = def.id;
      root.querySelectorAll(".ceRail [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === partSection)));
    }
    rebuild();
    if (tab !== "parts") setTab("parts");
    else renderPartsTab();
  }
  let partDrag = null;
  const gestures = attachGestures(canvas, {
    hit: hitAt,
    down: () => {
      closePops();
      if (previewId) {
        // Touching the creature ends a preview.
        previewId = null;
        rebuild();
        if (tab === "parts") renderInfo();
      }
    },
    tap: (x, y, t) => {
      if (mode === "test") return;
      if (t?.node !== undefined) {
        selectNode(t.node);
        hint("Drag to bend the spine. The side grip changes its girth.");
      } else if (t?.part !== undefined) {
        selectPart(t.part);
        const def = creaturePart(rec.parts[t.part]?.id);
        hint(def ? `${def.name}: drag to move it. Double-tap for exact numbers.` : "");
      } else if (selectedPart >= 0 || selectedNode >= 0) {
        // Tapping empty space clears the selection.
        selectedNode = selectedPart = -1;
        rebuild();
        refreshPanels();
      }
    },
    doubleTap: (x, y, t) => {
      if (t?.part !== undefined) {
        if (selectedPart !== t.part) selectPart(t.part);
        openDetails();
      } else if (!t) setView("reset");
    },
    longPress: (x, y, t) => {
      if (t?.part === undefined) return;
      buzz();
      selectPart(t.part);
      pulse($("#ceCtx"));
      hint("Part actions: duplicate, mirror, exact numbers, delete.");
    },
    dragStart: (t) => {
      orbitGoal = null;
      lowDetail = true;
      if (t.node !== undefined) {
        history.begin("sculpt");
        selectedNode = t.node;
        selectedPart = -1;
        if (tab !== "body") setTab("body");
        hint("Drag to bend the spine.");
      } else {
        history.begin("move part");
        selectedPart = t.part;
        selectedNode = -1;
        partDrag = { def: creaturePart(rec.parts[t.part]?.id) };
      }
      rebuild();
    },
    drag: (t, x, y) => {
      if (t.node !== undefined) {
        const ray = rayFrom(x, y);
        // Drag in the side-profile plane, whichever way the camera is looking.
        profilePlane.normal.set(0, 0, 1);
        if (Math.abs(ray.ray.direction.z) < 0.2) profilePlane.normal.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        const pt = ray.ray.intersectPlane(profilePlane, new THREE.Vector3());
        if (!pt) return;
        creature.body.worldToLocal(pt);
        const n = rec.spine[t.node],
          prev = rec.spine[t.node - 1],
          next = rec.spine[t.node + 1];
        if (!n) return;
        // Vertebrae keep their order and spacing, so the body never folds back on itself.
        const lo = prev ? prev.x + 0.3 : -3,
          hi = next ? next.x - 0.3 : 3;
        if (profilePlane.normal.z === 1) n.x = THREE.MathUtils.clamp(pt.x, lo, hi);
        n.y = THREE.MathUtils.clamp(pt.y, -1, 1.5);
        scheduleRebuild();
      } else if (partDrag?.def) {
        const s = surfaceAt(x, y);
        if (!s || !rec.parts[t.part]) return;
        Object.assign(rec.parts[t.part], snapSpot(partDrag.def, s.t, s.angle));
        scheduleRebuild();
      }
    },
    dragEnd: () => {
      lowDetail = false;
      partDrag = null;
      history.end();
      rebuild();
      refreshPanels();
    },
    orbit: (dx, dy) => {
      orbitGoal = null;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, -0.2, 1.35);
    },
    pan: (dx, dy) => {
      orbitGoal = null;
      // Move the look-at point across the screen, scaled so the creature follows the fingers.
      const k = (camera.position.distanceTo(target()) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2) / Math.max(200, innerHeight);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      orbit.pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      orbit.pan.clampLength(0, 4);
    },
    zoom: (f) => {
      orbitGoal = null;
      orbit.dist = THREE.MathUtils.clamp(orbit.dist / f, 3.5, 18);
    },
  });

  /* ---- camera views ------------------------------------------------------------- */
  const VIEWS = { side: { yaw: -Math.PI / 2, pitch: 0.05 }, front: { yaw: 0, pitch: 0.12 }, rear: { yaw: Math.PI, pitch: 0.12 }, top: { yaw: -Math.PI / 2, pitch: 1.25 } };
  function setView(v) {
    if (v === "focus") {
      const m = selectedMesh();
      if (!m) return hint("Select a part first, then Focus.");
      creature.root.updateMatrixWorld(true);
      const p = m.getWorldPosition(new THREE.Vector3()).sub(centre);
      orbitGoal = { pan: p, dist: 5.5 };
      return;
    }
    if (v === "reset") orbitGoal = { ...VIEWS.side, dist: 9, pan: new THREE.Vector3() };
    else orbitGoal = { ...VIEWS[v], pan: new THREE.Vector3() };
  }
  const target = () => (mode === "test" ? new THREE.Vector3(0, 1, 0) : centre.clone().add(orbit.pan));

  /* ---- grips: joints and part handles ----------------------------------------------
     Big round handles drawn over the 3D view, so they are easy to hit with a finger. In Build every
     leg pair has a knee grip (drag forward or back to bend the leg) and a foot grip (drag along the
     leg to stretch or shorten it); arms get the same pair. A selected part gets a size grip and a
     turn grip; a selected vertebra a girth grip. Every grip has a slider twin in the panel. */
  const grips = document.createElement("div");
  grips.className = "ceGrips";
  root.appendChild(grips);
  let gripKey = "",
    gripList = [];
  const toScreen = (v) => {
    const p = v.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (-p.y * 0.5 + 0.5) * r.height);
  };
  /** The leg (or arm) of a pair on the side facing the camera. */
  function nearLimb(limb, pair) {
    const both = creature.joints().filter((j) => j.kind === limb && j.pair === pair);
    return both.sort((a, b) => a.foot.distanceToSquared(camera.position) - b.foot.distanceToSquared(camera.position))[0];
  }
  const limbList = (limb) => (limb === "arm" ? rec.arms : rec.legs);
  const limbLimits = (limb) => (limb === "arm" ? [LIMITS.minArm, LIMITS.maxArm] : [LIMITS.minLeg, LIMITS.maxLeg]);
  const selectedMesh = () => creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart && !pm.userData.mirror) || creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart);
  const twinMesh = () => creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart && pm.userData.mirror);
  function renderGrips() {
    const part = rec.parts[selectedPart];
    const key = rec.legs.length + "|" + rec.arms.length + "|" + selectedPart + "|" + (part ? part.id : "") + "|" + selectedNode;
    if (key === gripKey) return;
    gripKey = key;
    grips.innerHTML = "";
    gripList = [];
    const add = (kind, glyph, title, data) => {
      const el = document.createElement("button");
      el.className = "ceGrip " + kind;
      el.tabIndex = -1; // the sliders in the panel are the keyboard route
      el.title = title;
      el.setAttribute("aria-hidden", "true");
      el.textContent = glyph;
      grips.appendChild(el);
      const g = { el, kind, ...data };
      wireGrip(g);
      gripList.push(g);
    };
    rec.legs.forEach((_, i) => {
      add("knee", "", "Drag to bend the knee", { limb: "leg", leg: i });
      add("foot", "↕", "Drag to stretch or shorten the leg", { limb: "leg", leg: i });
    });
    rec.arms.forEach((_, i) => {
      add("knee elbow", "", "Drag up or down to raise and bend the arm", { limb: "arm", leg: i });
      add("foot hand", "↕", "Drag to lengthen or shorten the arm", { limb: "arm", leg: i });
    });
    if (part) {
      add("size", "⤢", "Drag to resize", {});
      add("turn", "⟳", "Drag to turn", {});
    }
    if (selectedNode >= 0) add("girth", "⇕", "Drag up or down to make the body fatter or thinner here", {});
  }
  /** The part of the screen not covered by panels, bars and the mode bar. */
  function freeArea() {
    const r = (sel) => root.querySelector(sel)?.getBoundingClientRect();
    const top = (r(".ceTop")?.bottom || 0) + (phoneLayout() ? 0 : 52);
    let bottom = innerHeight,
      left = 0,
      right = innerWidth;
    const panel = r(".cePanel");
    const nav = r(".edModes");
    if (root.classList.contains("side")) {
      if (panel && mode !== "test") left = panel.right;
      // The full stats column takes the right edge (on a phone on its side it is a small pill instead).
      const st = r(".ceStats");
      if (st && st.width && !phoneLayout()) right = st.left;
      if (phoneLayout() && nav) bottom = nav.top;
    } else {
      if (panel && mode !== "test" && panel.height) bottom = panel.top;
      else if (nav && phoneLayout()) bottom = nav.top;
      if (mode === "test") bottom = Math.min(bottom, r(".ceTestBar")?.top || bottom);
    }
    return { top, bottom, left, right };
  }
  /** Where each grip sits on screen this frame. */
  function placeGrips() {
    const showLegs = mode === "build" && tab === "body";
    const mesh = mode === "build" && selectedPart >= 0 ? selectedMesh() : null;
    const node = mode === "build" && selectedNode >= 0 ? handles.children[selectedNode] : null;
    const free = freeArea();
    let centreS = null;
    if (mesh) {
      creature.root.updateMatrixWorld(true);
      centreS = toScreen(mesh.getWorldPosition(new THREE.Vector3()));
    }
    const nodeS = node ? toScreen(node.getWorldPosition(new THREE.Vector3())) : null;
    for (const g of gripList) {
      let at = null;
      if (g.limb) {
        if (showLegs) {
          const j = nearLimb(g.limb, g.leg);
          if (j) at = toScreen(g.kind.startsWith("knee") ? j.knee : j.foot);
        }
      } else if (g.kind === "girth") {
        if (nodeS) at = nodeS.clone().add(new THREE.Vector2(0, -58));
      } else if (mesh) {
        if (g.kind === "size") at = centreS.clone().add(new THREE.Vector2(46, 34));
        else if (g.kind === "turn") at = centreS.clone().add(new THREE.Vector2(-46, 34));
      }
      // Never over the tool panel or the top bar.
      if (at && (at.y > free.bottom - 12 || at.y < free.top + 8 || at.x < free.left + 8 || at.x > free.right - 8)) at = null;
      g.el.hidden = !at;
      if (at) {
        g.el.style.left = at.x + "px";
        g.el.style.top = at.y + "px";
      }
    }
    placeCtx(centreS || nodeS, free);
  }
  function wireGrip(g) {
    let d = null;
    g.el.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pointer = new THREE.Vector2(e.clientX, e.clientY);
      d = { id: e.pointerId, start: pointer, moved: false };
      if (g.limb) {
        const j = nearLimb(g.limb, g.leg);
        if (!j) return (d = null);
        const hip = toScreen(j.hip),
          foot = toScreen(j.foot);
        d.along = foot.clone().sub(hip);
        d.len = Math.max(20, d.along.length());
        d.along.normalize();
        // Legs bend toward the body's front; arms are raised by dragging the elbow up.
        const dir = g.limb === "arm" ? new THREE.Vector3(0, 0.5, 0) : new THREE.Vector3(0.5, 0, 0).applyQuaternion(creature.root.quaternion);
        const front = toScreen(j.hip.clone().add(dir)).sub(hip);
        d.front = front.length() > 4 ? front.normalize() : new THREE.Vector2(g.limb === "arm" ? 0 : 1, g.limb === "arm" ? -1 : 0);
        const limb = limbList(g.limb)[g.leg];
        d.length0 = limb.length;
        d.bend0 = limb.bend || 0;
      } else if (g.kind === "girth") {
        const n = rec.spine[selectedNode];
        if (!n) return (d = null);
        d.r0 = n.r;
      } else {
        const mesh = selectedMesh();
        if (!mesh) return (d = null);
        const part = rec.parts[selectedPart];
        d.centre = toScreen(mesh.getWorldPosition(new THREE.Vector3()));
        d.scale0 = part.scale || 1;
        d.roll0 = part.roll || 0;
        d.dist0 = Math.max(12, pointer.distanceTo(d.centre));
        d.angle0 = Math.atan2(pointer.y - d.centre.y, pointer.x - d.centre.x);
      }
      history.begin(g.limb ? "pose" : g.kind === "girth" ? "girth" : g.kind === "size" ? "resize" : "turn");
      lowDetail = true;
      g.el.classList.add("held");
      try {
        g.el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already released */
      }
    };
    g.el.onpointermove = (e) => {
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      const pointer = new THREE.Vector2(e.clientX, e.clientY);
      const delta = pointer.clone().sub(d.start);
      if (!d.moved && delta.length() < 3) return;
      d.moved = true;
      if (g.limb) {
        const limb = limbList(g.limb)[g.leg];
        if (!limb) return;
        if (g.kind.startsWith("foot")) limb.length = THREE.MathUtils.clamp(d.length0 * (1 + delta.dot(d.along) / d.len), ...limbLimits(g.limb));
        else limb.bend = THREE.MathUtils.clamp(d.bend0 + delta.dot(d.front) / (d.len * 0.9), -1, 1);
      } else if (g.kind === "girth") {
        const n = rec.spine[selectedNode];
        if (n) n.r = THREE.MathUtils.clamp(d.r0 * (1 - delta.y / 160), LIMITS.minR, LIMITS.maxR);
      } else {
        const part = rec.parts[selectedPart];
        if (!part) return;
        if (g.kind === "size") part.scale = THREE.MathUtils.clamp(d.scale0 * (1 + (pointer.distanceTo(d.centre) - d.dist0) / 110), 0.6, 1.6);
        else if (g.kind === "turn") {
          const a = Math.atan2(pointer.y - d.centre.y, pointer.x - d.centre.x);
          part.roll = THREE.MathUtils.euclideanModulo(d.roll0 + (a - d.angle0) + Math.PI, Math.PI * 2) - Math.PI;
        }
      }
      scheduleRebuild();
    };
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      d = null;
      lowDetail = false;
      history.end();
      g.el.classList.remove("held");
      rebuild();
      refreshPanels();
    };
    g.el.onpointerup = end;
    g.el.onpointercancel = end;
    g.el.onlostpointercapture = end;
  }
  function updatePartHalo() {
    const m = mode === "build" ? selectedMesh() : null;
    const twin = m ? twinMesh() : null;
    partHalo.visible = !!m;
    twinHalo.visible = !!twin;
    if (m) {
      creature.root.updateMatrixWorld(true);
      m.getWorldPosition(partHalo.position);
      partHalo.lookAt(camera.position);
      const s = 0.8 + (rec.parts[selectedPart]?.scale || 1) * 0.35;
      partHalo.scale.setScalar(s);
      if (twin) {
        twin.getWorldPosition(twinHalo.position);
        twinHalo.lookAt(camera.position);
        twinHalo.scale.setScalar(s);
      }
    }
  }

  /* ---- the selected part's toolbar -------------------------------------------------- */
  function renderCtx() {
    const ctx = $("#ceCtx");
    const p = mode === "build" ? rec.parts[selectedPart] : null;
    const n = mode === "build" ? rec.spine[selectedNode] : null;
    if (!p && !n) {
      ctx.hidden = true;
      ctx.dataset.key = "";
      return;
    }
    const key = p ? `p${selectedPart}|${p.solo ? 1 : 0}|${offMidline(p.angle) ? 1 : 0}|${rec.parts.length}` : `n${selectedNode}|${rec.spine.length}`;
    ctx.hidden = false;
    if (ctx.dataset.key === key) return;
    ctx.dataset.key = key;
    if (p) {
      const def = creaturePart(p.id);
      const canMirror = offMidline(p.angle);
      ctx.innerHTML = `<b class="edCtxName">${esc(def.name)}</b>
        <button data-ctx="dup" ${isExclusive(def) || rec.parts.length >= maxParts ? "disabled" : ""} title="Duplicate (Ctrl+D)">${ICONS.copy}<span>Copy</span></button>
        <button data-ctx="solo" aria-pressed="${canMirror && !p.solo}" ${canMirror ? "" : "disabled"} title="${canMirror ? (p.solo ? "One-sided: tap to mirror it again" : "Mirrored: tap to make it one-sided") : "On the midline: nothing to mirror"}">${p.solo ? ICONS.solo : ICONS.mirror}<span>${p.solo ? "Single" : "Mirror"}</span></button>
        <button data-ctx="num" title="Exact numbers">${ICONS.sliders}<span>Adjust</span></button>
        <button data-ctx="del" class="danger" title="Delete (Del)">${ICONS.trash}<span>Delete</span></button>`;
    } else {
      ctx.innerHTML = `<b class="edCtxName">Vertebra ${selectedNode + 1}</b>
        <button data-ctx="ins" ${rec.spine.length >= LIMITS.maxNodes ? "disabled" : ""} title="Add a vertebra after this one (${NODE_COST} DNA)">${ICONS.plus}<span>Add</span></button>
        <button data-ctx="rm" class="danger" ${rec.spine.length <= LIMITS.minNodes ? "disabled" : ""} title="Remove this vertebra">${ICONS.minus}<span>Remove</span></button>`;
    }
    ctx.querySelectorAll("[data-ctx]").forEach(
      (b) =>
        (b.onclick = () =>
          ({ dup: duplicateSelected, solo: toggleSolo, num: openDetails, del: removeSelectedPart, ins: insertNode, rm: removeNode })[b.dataset.ctx]()),
    );
  }
  /** Float the toolbar above what's selected, inside the free part of the screen. */
  function placeCtx(at, free) {
    const ctx = $("#ceCtx");
    if (ctx.hidden || !at) {
      if (!ctx.hidden && !at) ctx.style.visibility = "hidden";
      return;
    }
    ctx.style.visibility = "";
    // Keep clear of the view buttons in the corner.
    const vt = !root.classList.contains("side") && root.querySelector(".edViewTools")?.getBoundingClientRect();
    if (vt && vt.width) free = { ...free, right: Math.min(free.right, vt.left - 4) };
    const w = ctx.offsetWidth,
      h = ctx.offsetHeight;
    let x = at.x - w / 2,
      y = at.y - h - 64;
    if (y < free.top + 6) y = at.y + 70;
    x = THREE.MathUtils.clamp(x, free.left + 6, free.right - w - 6);
    y = THREE.MathUtils.clamp(y, free.top + 6, Math.max(free.top + 6, free.bottom - h - 6));
    ctx.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
  /** Exact numbers for the selected part: along the body, around it, size and turn. */
  function openDetails() {
    const p = rec.parts[selectedPart];
    if (!p) return;
    root.querySelector(".edDetails")?.remove();
    const def = creaturePart(p.id);
    const box = document.createElement("div");
    box.className = "edDetails";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", def.name + " placement");
    const fields = [
      ["t", "Along the body", 0, 100, 1, (v) => v * 100, (v) => v / 100, "%"],
      ["angle", "Around the body", -180, 180, 1, (v) => (v * 180) / Math.PI, (v) => (v * Math.PI) / 180, "°"],
      ["scale", "Size", 60, 160, 1, (v) => v * 100, (v) => v / 100, "%"],
      ["roll", "Turn", -180, 180, 1, (v) => (v * 180) / Math.PI, (v) => (v * Math.PI) / 180, "°"],
    ];
    box.innerHTML = `<h4>${esc(def.name)}<button class="edX" aria-label="Close">${ICONS.close}</button></h4>${fields
      .map(([k, label, min, max, step, show, , unit]) => `<label class="edField"><span>${label}</span><input type="range" data-f="${k}" min="${min}" max="${max}" step="${step}" value="${Math.round(show(p[k] ?? (k === "scale" ? 1 : 0)))}"><input type="number" data-n="${k}" min="${min}" max="${max}" step="${step}" value="${Math.round(show(p[k] ?? (k === "scale" ? 1 : 0)))}" inputmode="decimal"><em>${unit}</em></label>`)
      .join("")}<p class="edNote">Tip: on the body, the side grips resize and turn it too.</p>`;
    root.appendChild(box);
    const apply = (k, raw) => {
      const f = fields.find((x) => x[0] === k);
      const part = rec.parts[selectedPart];
      if (!part) return;
      const v = THREE.MathUtils.clamp(+raw, f[2], f[3]);
      part[k] = f[6](v);
      if (k === "angle" || k === "t") Object.assign(part, snapSpot(def, part.t, part.angle));
      box.querySelector(`[data-f="${k}"]`).value = v;
      box.querySelector(`[data-n="${k}"]`).value = v;
      scheduleRebuild();
    };
    box.querySelectorAll("[data-f]").forEach((inp) => {
      inp.oninput = () => {
        if (!history.inTransaction) history.begin("adjust");
        apply(inp.dataset.f, inp.value);
      };
      inp.onchange = () => history.end();
    });
    box.querySelectorAll("[data-n]").forEach((inp) => {
      inp.onchange = () => {
        history.begin("adjust");
        apply(inp.dataset.n, inp.value);
        history.end();
      };
    });
    box.querySelector(".edX").onclick = () => box.remove();
    pulse(box);
  }

  /* ---- test drive ---------------------------------------------------------- */
  let testT = 0,
    motion = "walk",
    jumpT = -1;
  function startTest() {
    testT = 0;
    motion = "walk";
    renderTestBar();
    hint("Testing doesn't change your design. Try its moves, then go back to Build.");
  }
  function renderTestBar() {
    const bar = $("#ceTestBar");
    bar.hidden = false;
    const ab = abilitiesOf(creaturePartIds(rec), rec.legs.length, armPairsOf(rec));
    const glides = (ab.glide || 0) > 0;
    bar.innerHTML =
      `<div class="edMotions" role="radiogroup" aria-label="Movement">${MOTIONS.map(([m, label]) => `<button role="radio" data-motion="${m}" aria-checked="${m === motion}">${label}${m === "jump" && glides ? " &amp; glide" : ""}</button>`).join("")}</div>` +
      `<div class="edAbilities">${[...COMBAT, ...SOCIAL]
        .map((k) => `<button data-play="${k}" ${ab[k] ? "" : "disabled"} title="${ab[k] ? ABILITY_INFO[k].name + " level " + ab[k] : "This design has no " + ABILITY_INFO[k].name.toLowerCase() + " parts"}"><b>${ABILITY_INFO[k].name}</b><small>${ab[k] ? "Lv " + ab[k] : "—"}</small></button>`)
        .join("")}</div>` +
      `<button class="edBackBuild" data-mode-to="build">${ICONS.build} Back to Build</button>`;
    bar.querySelectorAll("[data-play]").forEach(
      (b) =>
        (b.onclick = () => {
          creature.playAbility(b.dataset.play);
          o.sfx("click");
        }),
    );
    bar.querySelectorAll("[data-motion]").forEach(
      (b) =>
        (b.onclick = () => {
          motion = b.dataset.motion;
          creature.setCrouch(motion === "sneak" ? 1 : 0);
          creature.setGhost?.(false);
          if (motion === "jump") jumpT = 0;
          renderTestBar();
        }),
    );
    bar.querySelector("[data-mode-to]").onclick = () => setMode("build");
  }
  function stopTest() {
    $("#ceTestBar").hidden = true;
    if (!creature) return;
    creature.setCrouch(0);
    creature.setAir(null);
    creature.root.position.set(0, FLOOR, 0);
    creature.root.rotation.set(0, 0, 0);
  }

  /* ---- menus ---------------------------------------------------------------- */
  function closePops() {
    root.querySelectorAll(".edPop").forEach((p) => (p.hidden = true));
    root.querySelectorAll("[aria-haspopup]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
  const togglePop = (btn, pop) => {
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) pulse(pop);
  };
  $("#ceViews").onclick = () => togglePop($("#ceViews"), $("#ceViewMenu"));
  root.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        setView(b.dataset.view);
        closePops();
      }),
  );
  $("#ceMore").onclick = () => togglePop($("#ceMore"), $("#ceMenu"));
  $("#ceMoreNav").onclick = () => togglePop($("#ceMoreNav"), $("#ceMenu"));
  root.querySelector('[data-menu="tips"]').onclick = () => {
    closePops();
    startTips(true);
  };
  root.querySelector('[data-menu="views"]').onclick = () => {
    closePops();
    setView("reset");
  };
  root.querySelector('[data-menu="reset"]').onclick = async () => {
    closePops();
    if (!isDirty()) return hint("Nothing to reset: this is the saved design.");
    const ok = await confirmBox(root, { title: "Start over?", text: "Your changes go and the design is back to how it was when you opened the editor. Undo can still bring them back.", ok: "Start over", danger: true });
    if (!ok) return;
    commit("start over");
    rec = JSON.parse(JSON.stringify(original));
    nameInput.value = rec.name;
    selectedNode = selectedPart = -1;
    previewId = null;
    rebuild();
    refreshPanels();
    hint("Back to the design you opened with. Undo brings your changes back.");
    o.sfx("click");
  };
  $("#ceSym").onclick = () => {
    symmetry = !symmetry;
    writePrefs({ symmetry });
    $("#ceSym").setAttribute("aria-pressed", String(symmetry));
    pulse($("#ceSym"));
    hint(symmetry ? "Symmetry on: new parts off the midline get a mirror twin." : "Symmetry off: new parts stay on the side you put them. Existing parts keep their twins (use Mirror on a part to change it).");
  };
  $("#ceUndo").onclick = () => {
    const l = history.undo();
    if (l) hint("Undid " + l + ".", 1800);
    o.sfx("click");
  };
  $("#ceRedo").onclick = () => {
    const l = history.redo();
    if (l) hint("Redid " + l + ".", 1800);
    o.sfx("click");
  };
  $("#ceParts").onclick = () => {
    if (mode === "test") setMode("build");
    else if (drawer) drawer.set(drawer.state === "peek" ? "half" : "peek");
  };

  /* ---- recovery after a reload ------------------------------------------------------- */
  const saved = drafts.recoverable();
  if (saved) {
    const box = $("#ceRecover");
    const mins = Math.max(1, Math.round((Date.now() - saved.savedAt) / 60000));
    box.hidden = false;
    box.innerHTML = `<p><b>Unsaved changes found.</b> You were editing this creature ${mins < 60 ? mins + " min" : Math.round(mins / 60) + " h"} ago and didn't save.</p><div><button data-r="0">Discard</button><button data-r="1" class="primary">Recover</button></div>`;
    box.querySelector('[data-r="1"]').onclick = () => {
      commit("recover");
      rec = validateCreature(saved.data);
      nameInput.value = rec.name;
      rebuild();
      refreshPanels();
      box.hidden = true;
      hint("Recovered. Save to keep it.");
    };
    box.querySelector('[data-r="0"]').onclick = () => {
      drafts.clear();
      box.hidden = true;
    };
  }

  /* ---- finish ---------------------------------------------------------------- */
  let closed = false;
  const cleanups = [];
  function close() {
    closed = true;
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    gestures.detach();
    cleanups.forEach((f) => f());
    camera.clearViewOffset();
    clearTimeout(hintTimer);
    creature?.dispose();
    root.remove();
    [handleGeo, handleRimGeo, handleMat, handleSelMat, handleRimMat, marker.geometry, marker.material, haloGeo, haloMat, twinMat].forEach((d) => d.dispose());
    backdrop.dispose();
  }
  $("#ceDone").onclick = () => {
    if (problems().length) return;
    history.end();
    rec.name = (nameInput.value.trim() || "Karlets").replace(/[<>]/g, "").slice(0, 22);
    const result = validateCreature(rec),
      left = o.dna - cost();
    if (mode === "paint" && !sameScheme(paintEntry, schemeOf(rec))) recentSchemes.add(schemeOf(rec));
    drafts.clear();
    o.sfx("hatch");
    close();
    o.onDone(result, left);
  };
  $("#ceCancel").onclick = async () => {
    history.end();
    if (isDirty()) {
      const ok = await confirmBox(root, { title: "Leave without saving?", text: "Your changes to this creature will be lost.", ok: "Discard changes", cancel: "Keep editing", danger: true });
      if (!ok || closed) return;
    }
    drafts.clear();
    close();
    o.onCancel();
  };
  /** Write the draft right away when the page is hidden (app switch, tab close, reload). */
  const onHide = (e) => {
    if (document.visibilityState === "hidden" || e?.type === "pagehide") {
      history.end();
      if (isDirty()) {
        drafts.touch(rec);
        drafts.flush();
      }
    }
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  const onKey = (e) => {
    if (root.querySelector(".edModal")) return;
    const typing = e.target === nameInput || /INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || "");
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z" && !typing) {
      e.preventDefault();
      (e.shiftKey ? $("#ceRedo") : $("#ceUndo")).click();
    } else if ((e.ctrlKey || e.metaKey) && k === "y" && !typing) {
      e.preventDefault();
      $("#ceRedo").click();
    } else if ((e.ctrlKey || e.metaKey) && k === "d" && selectedPart >= 0) {
      e.preventDefault();
      duplicateSelected();
    } else if (typing) return;
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedPart >= 0) removeSelectedPart();
    else if (k === "m" && selectedPart >= 0) toggleSolo();
    else if (k === "f") setView("focus");
    else if (["1", "2", "3"].includes(e.key)) setMode(["build", "paint", "test"][+e.key - 1]);
    else if (e.key === "Escape") {
      if (root.querySelector(".edDetails")) root.querySelector(".edDetails").remove();
      else if (root.querySelector(".edPop:not([hidden])")) closePops();
      else if (mode === "test") setMode("build");
      else if (previewId) {
        previewId = null;
        rebuild();
        renderInfo();
      } else if (selectedPart >= 0 || selectedNode >= 0) {
        selectedPart = selectedNode = -1;
        rebuild();
        refreshPanels();
      }
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---- layout ------------------------------------------------------------------ */
  /** Wide screens get the catalogue as a panel on the left; phones a drawer above the mode bar. */
  const wantsSide = () => innerWidth >= 900 || (innerWidth > innerHeight && innerWidth >= 640);
  let avail = { w: innerWidth, h: innerHeight };
  let drawer = null;
  /** Lay the editor out for the window, and keep the creature centred in the space the tools leave free. */
  function fitCamera() {
    root.classList.toggle("side", wantsSide());
    root.classList.toggle("phone", phoneLayout());
    const free = freeArea();
    camera.aspect = innerWidth / innerHeight;
    avail = { w: Math.max(200, free.right - free.left), h: Math.max(160, free.bottom - free.top) };
    // Slide the picture into the middle of the free area.
    const cx = (free.left + free.right) / 2 - innerWidth / 2,
      cy = (free.top + free.bottom) / 2 - innerHeight / 2;
    camera.setViewOffset(innerWidth, innerHeight, -cx, -cy, innerWidth, innerHeight);
    root.style.setProperty("--ce-top", ($(".ceTop")?.getBoundingClientRect().height || 0) + "px");
    root.style.setProperty("--ed-navh", ($(".edModes")?.getBoundingClientRect().height || 0) + "px");
    sizeTiles();
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", fitCamera);
  cleanups.push(() => window.removeEventListener("resize", fitCamera));
  cleanups.push(guardPageGestures(root));
  cleanups.push(trackViewport(root, () => !closed && fitCamera()));
  drawer = makeDrawer($(".cePanel"), {
    active: () => !root.classList.contains("side"),
    grips: [$(".ceRail")],
    peek: () => ($(".ceRail")?.offsetHeight || 64) + 34,
    vh: () => window.visualViewport?.height || innerHeight,
    onChange: (s) => {
      $("#ceParts").setAttribute("aria-expanded", String(s !== "peek"));
      // The drawer animates its height: keep the creature framed as it moves.
      fitCamera();
      setTimeout(() => !closed && fitCamera(), 260);
    },
  });
  try {
    thumbs = bakePartThumbs(o.renderer, { color: rec.colors.base });
  } catch (err) {
    /* thumbnails are decoration; the cards still work without them */
  }
  rebuild();
  setTab("body");
  fitCamera();
  renderDna();
  const TIPS = [
    { title: "Welcome to the Creature Creator", touch: "Drag empty space to turn the camera, pinch to zoom, and use two fingers to move the view.", mouse: "Drag empty space to turn the camera, scroll to zoom, and right-drag (or Shift-drag) to move the view." },
    { title: "Shape the body", touch: "Drag the round spine handles to bend and stretch the body. Tap one for its girth grip, or use Quick shape in Body.", mouse: "Drag the round spine handles to bend and stretch the body. Click one for its girth grip, or use Quick shape in Body." },
    { title: "Add parts", touch: "Open a category below, then drag a part onto the body (or touch and hold it, then drag). Tap a part on the body for its tools.", mouse: "Pick a category on the left and drag a part onto the body. Click a part on the body for its tools; Delete removes it." },
    { title: "Paint, test, save", touch: "Paint has colour layers and schemes; Test lets it walk and show off. Undo is always at the top, and your work is kept as a draft until you Save.", mouse: "Paint has colour layers and schemes; Test lets it walk and show off. Ctrl+Z undoes anything, and your work is kept as a draft until you Save." },
  ];
  const startTips = (force) => showTips(root, "creature", TIPS, force);
  if (!saved) setTimeout(() => !closed && startTips(false), 500);
  if (!matchMedia("(pointer: coarse)").matches && !saved) nameInput.focus({ preventScroll: true });
  return {
    get closed() {
      return closed;
    },
    get record() {
      return rec;
    },
    update(dt) {
      if (closed || !creature) return;
      if (needsRebuild) rebuild();
      if (mode === "test") {
        testT += dt;
        const speed = motion === "run" ? 5.2 : motion === "walk" || motion === "jump" ? 2.6 : motion === "sneak" ? 1.2 : 0;
        const r = motion === "run" ? 3.2 : 2.4;
        if (speed) {
          const a = (testT * speed) / r;
          creature.root.position.set(Math.cos(a) * r - centre.x, FLOOR, Math.sin(a) * r);
          creature.root.rotation.y = -a - Math.PI / 2;
        }
        if (motion === "jump") {
          // A hop every two seconds; gliders hang in the air a little longer.
          jumpT += dt;
          const period = 2,
            u = jumpT % period;
          const air = u < 0.9;
          creature.root.position.y = FLOOR + (air ? Math.sin((u / 0.9) * Math.PI) * 1.1 : 0);
          creature.setAir(air ? "jump" : null);
        }
        creature.lookAt(speed ? null : camera.position);
        creature.update(dt, speed);
      } else {
        // As in Spore, the creature on the table looks back at you.
        creature.lookAt(camera.position);
        creature.update(dt, 0);
      }
      // A newly placed part grows in.
      if (pop) {
        pop.t += dt;
        const k = reducedMotion() ? 1 : Math.min(1, pop.t / 0.32);
        const s = k >= 1 ? 1 : 0.55 + 0.45 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.12;
        const base = rec.parts[pop.index]?.scale || 1;
        creature.partMeshes.filter((m) => m.userData.partIndex === pop.index && !m.userData.eye).forEach((m) => m.scale.setScalar(base * s));
        if (k >= 1) pop = null;
      }
      easeOrbit(orbit, orbitGoal, dt) || (orbitGoal = null);
      // Orbit around the body's middle (or where you panned to).
      const tgt = target();
      // Back off just far enough that the whole creature fits the free space, easing as parts change.
      // The zoom you set (orbit.dist, 9 = as framed) scales on top of that.
      let fit = 9 * Math.max(1, 0.85 / Math.max(0.3, camera.aspect));
      if (mode !== "test") {
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const dW = (bounds.w * 1.12) / (0.9 * (avail.w / innerWidth) * 2 * tanV * camera.aspect);
        const dH = (bounds.h * 1.2) / (0.86 * (avail.h / innerHeight) * 2 * tanV);
        fit = THREE.MathUtils.clamp(Math.max(dW, dH), 5, 15);
      }
      framing = framing ? framing + (fit - framing) * Math.min(1, dt * 5) : fit;
      const dist = (mode === "test" ? fit : framing) * (orbit.dist / 9);
      camera.position.set(
        tgt.x + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist,
        tgt.y + Math.sin(orbit.pitch) * dist + 0.3,
        tgt.z - Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist,
      );
      // Look a little above the body so the treeline and sky stay in view behind it.
      camera.lookAt(tgt.x, tgt.y + (mode === "test" ? 0.9 : -0.2), tgt.z);
      camera.updateMatrixWorld();
      updatePartHalo();
      placeGrips();
    },
    render() {
      if (!closed) o.renderer.render(scene, camera);
    },
    resize: fitCamera,
    debug: {
      /** Screen position of spine handle i, for tests. */
      handleScreen(i) {
        const h = handles.children[i];
        if (!h) return null;
        const v = h.getWorldPosition(new THREE.Vector3()).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      /** Screen position of part i (its own side, not the twin), for tests. */
      partScreen(i) {
        creature.root.updateMatrixWorld(true);
        const m = creature.partMeshes.find((pm) => pm.userData.partIndex === i && !pm.userData.mirror);
        return m ? toScreen(m.getWorldPosition(new THREE.Vector3())) : null;
      },
      placePart,
      surfaceAt,
      setTab,
      setMode,
      setView,
      duplicateSelected,
      toggleSolo,
      openDetails,
      get symmetry() {
        return symmetry;
      },
      get mode() {
        return mode;
      },
      get orbit() {
        return orbit;
      },
      get history() {
        return history;
      },
      get drawer() {
        return drawer;
      },
      get browse() {
        return browseState;
      },
      freeArea,
      /** The creature's on-screen rectangle (projected bounding box), and the free area it should sit in. */
      screenBounds() {
        creature.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(creature.root);
        const r = canvas.getBoundingClientRect();
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              const v = new THREE.Vector3(x, y, z).project(camera);
              const px = r.left + (v.x * 0.5 + 0.5) * r.width,
                py = r.top + (-v.y * 0.5 + 0.5) * r.height;
              x0 = Math.min(x0, px);
              x1 = Math.max(x1, px);
              y0 = Math.min(y0, py);
              y1 = Math.max(y1, py);
            }
        return { x0, y0, x1, y1, free: freeArea() };
      },
      /** Select a catalogue card as a tap would (tests). */
      focus: setFocus,
      equipFocused,
      get previewId() {
        return previewId;
      },
      get focusId() {
        return focusId;
      },
      get shown() {
        return view();
      },
      setTesting: (on) => setMode(on ? "test" : "build"),
      cost,
      problems,
      /** Select a part by index (tests). */
      selectPart,
      selectNode,
      get rec() {
        return rec;
      },
    },
  };
}
