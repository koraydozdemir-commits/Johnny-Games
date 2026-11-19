/**
 * Creature editor: shape the spine, add legs, drop parts on the body, paint, test drive.
 *
 * Opens over the game with its own scene and orbit camera. The spine is edited in the side profile
 * (the body is always mirrored left/right, like Spore). Parts live in a catalogue: category icons
 * across the top, a grid of thumbnails, and a detail card with stats and a comparison against what
 * is equipped. Tap a part to select (and preview) it, then Equip, or drag it onto the body; flank
 * parts mirror automatically. New parts and leg pairs cost DNA. On wide screens the catalogue is a
 * panel on the left of a large preview; on narrow ones it is a sheet under it.
 */
import * as THREE from "three";
import { createEditorBackdrop } from "./backdrop.js";
import { buildCreatureBody } from "./body3d.js";
import { ARM_ANGLE, LIMITS, armPairsOf, creaturePartIds, validateCreature } from "./format.js";
import { ABILITY_INFO, ARM_ABILITIES, COMBAT, CREATURE_PARTS, PART_SECTIONS, SOCIAL, STAT_INFO, abilitiesOf, creaturePart, fitsArm } from "./parts.js";
import { DIET_NAME, MOUTH_DIETS, mouthDiet, mouthsOfDiet } from "./mouths.js";
import { movementOf, rate } from "./anatomy.js";
import { ICONS, SECTION_ICON } from "./editor-icons.js";
import { esc, infoHtml, mouthPanelHtml, shownName, tileHtml } from "./editor-catalogue.js";
import { bakePartThumbs } from "./part-thumbs.js";

const LEG_COST = 8;
const ARM_COST = 8;
const NODE_COST = 2;
const SWATCHES = [0x3be0d8, 0x58c46a, 0xa6d04a, 0xf2c84b, 0xf28a3b, 0xe0504a, 0xd8508e, 0x9a63e0, 0x4a74e0, 0x6f5a46, 0xe8e2d4, 0x2c3440];
const PATTERNS = [
  ["speckle", "Speckle"],
  ["spots", "Spots"],
  ["stripes", "Stripes"],
  ["gradient", "Fade"],
  ["glow", "Glow"],
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
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

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
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.record     current design
 * @param {Set<string>} o.unlocked  part ids the player may use
 * @param {Set<string>} [o.seen]    part ids the player has seen on a creature (locked parts show their name only if seen)
 * @param {object} [o.progress]     what the player has achieved (see mouths.js progressOf), for unlock requirements
 * @param {number} o.dna
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
  const undoStack = [],
    redoStack = [];
  const scene = new THREE.Scene();
  // A sunny clearing on the island rather than a void: you design the creature where it will live.
  const backdrop = createEditorBackdrop(scene, o.quality);
  const FLOOR = backdrop.floorY;
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 100);
  const orbit = { yaw: -Math.PI / 2, pitch: 0.05, dist: 9 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ---- DOM -------------------------------------------------------------- */
  const root = document.createElement("div");
  root.className = "crEditor ceCat";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Creature editor");
  const railButton = (cat, label, icon, selected) => `<button role="tab" data-cat="${cat}" aria-selected="${selected}" aria-label="${label}" title="${label}">${icon}</button>`;
  root.innerHTML = `
    <div class="ceTop">
      <input id="ceName" maxlength="22" aria-label="Species name" autocomplete="off" spellcheck="false">
      <span class="ceDna" id="ceDna" aria-live="polite"></span>
      <div class="ceTopBtns">
        <button id="ceUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button id="ceRedo" aria-label="Redo" title="Redo (Ctrl+Y)">${ICONS.redo}</button>
        <button id="ceReset" aria-label="Undo all changes" title="Undo all changes">${ICONS.reset}<span>Reset</span></button>
        <button id="ceTest" aria-pressed="false" title="Walk your creature around">${ICONS.play}<span>Test</span></button>
        <button id="ceCancel">Cancel</button>
        <button id="ceDone" class="primary" title="Save this design">Save</button>
      </div>
    </div>
    <p class="ceHint" id="ceHint" aria-live="polite"></p>
    <aside class="ceStats" id="ceStats" aria-label="Creature statistics"></aside>
    <div class="ceTestBar" id="ceTestBar" hidden></div>
    <section class="cePanel" aria-label="Editor tools">
      <nav class="ceRail" role="tablist" aria-label="Categories">
        ${railButton("body", "Body", ICONS.body, true)}
        ${PART_SECTIONS.map(([id, title]) => railButton(id, title, SECTION_ICON[id], false)).join("")}
        ${railButton("paint", "Paint", ICONS.paint, false)}
      </nav>
      <div class="ceTab" data-pane="body"></div>
      <div class="ceTab" data-pane="parts" hidden></div>
      <div class="ceTab" data-pane="paint" hidden></div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const nameInput = $("#ceName");
  nameInput.value = rec.name;
  nameInput.oninput = () => {
    rec.name = nameInput.value.replace(/[<>]/g, "").slice(0, 22) || "Karlets";
  };
  const hint = (text) => ($("#ceHint").textContent = text);
  hint("Drag the spine handles to shape the body, and the knee and foot handles to pose the legs.");

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
  const partHalo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd25e, depthTest: false }));
  partHalo.renderOrder = 11;
  partHalo.visible = false;
  scene.add(partHalo);

  function rebuild() {
    if (creature) creature.dispose();
    rec = validateCreature(rec);
    creature = buildCreatureBody(view(), { quality: o.quality === "low" ? "medium" : "high" });
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
    handles.visible = !testing;
    creature.update(0, 0); // settle into the rest pose so the joint handles sit on the joints
    creature.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(creature.root);
    bounds = { w: Math.max(2, box.max.x - box.min.x, box.max.z - box.min.z), h: Math.max(1.5, box.max.y - box.min.y) };
    updatePartHalo();
    renderGrips();
    renderStats();
    renderDna();
  }
  const centre = new THREE.Vector3();
  /** World size of the creature as built, for framing it in the free part of the screen. */
  let bounds = { w: 4, h: 3 };
  let framing = 0;
  const coarse = matchMedia("(pointer: coarse)").matches;
  function commit() {
    undoStack.push(JSON.stringify(rec));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(rec));
    rec = JSON.parse(from.pop());
    nameInput.value = rec.name;
    selectedNode = Math.min(selectedNode, rec.spine.length - 1);
    selectedPart = -1;
    previewId = null;
    rebuild();
    setTab(tab);
    o.sfx("click");
  }
  $("#ceReset").onclick = () => {
    if (JSON.stringify(rec) === JSON.stringify(original)) return;
    commit();
    rec = JSON.parse(JSON.stringify(original));
    nameInput.value = rec.name;
    selectedNode = selectedPart = -1;
    previewId = null;
    rebuild();
    setTab(tab);
    hint("Back to the design you opened with. Undo brings your changes back.");
    o.sfx("click");
  };
  $("#ceUndo").onclick = () => restore(undoStack, redoStack);
  $("#ceRedo").onclick = () => restore(redoStack, undoStack);

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
    $("#ceUndo").disabled = !undoStack.length;
    $("#ceRedo").disabled = !redoStack.length;
    $("#ceReset").disabled = JSON.stringify(rec) === JSON.stringify(original);
  }
  function renderStats() {
    // The part budget: how many parts this brain can manage.
    const budget = $("#ceBudget");
    if (budget) {
      budget.textContent = rec.parts.length + "/" + maxParts;
      budget.classList.toggle("full", rec.parts.length >= maxParts);
    }
    const shown = view();
    const ab = abilitiesOf(creaturePartIds(shown), shown.legs.length, armPairsOf(shown));
    const mouthId = mouthOf(shown);
    const diet = mouthId ? mouthDiet(mouthId) : "omni";
    const bar = (v) => `<i>${[1, 2, 3, 4, 5].map((n) => `<b class="${n <= v ? "on" : ""}"></b>`).join("")}</i>`;
    const row = (k, name) => `<div class="ceStat"><span>${name}</span>${bar(ab[k])}</div>`;
    // How the body moves: plan, legs, bulk, tail and fins (see anatomy.js). Trade-offs, not upgrades.
    const mv = movementOf(shown, ab);
    const mrow = (name, v, tip) => `<div class="ceStat" title="${tip}"><span>${name}</span>${bar(v)}</div>`;
    const bulk = mv.bulk < 0.85 ? "Light" : mv.bulk < 1.35 ? "Medium" : "Heavy";
    // While another mouth is being previewed, its numbers carry a comparison with the one you have equipped.
    const equippedMouth = mouthOf(rec);
    $("#ceStats").innerHTML =
      `<h3>${DIET_NAME[diet]} · ${mv.planName}</h3>` +
      (previewId && mouthId !== equippedMouth ? '<p class="cePrevNote">Previewing, not equipped yet</p>' : "") +
      mouthPanelHtml(mouthId, previewId && mouthId !== equippedMouth ? equippedMouth : null) +
      '<h4>Movement</h4>' +
      mrow("Top speed", rate(mv.top, 3, 9), `${mv.top.toFixed(1)} m/s. Longer legs and fast feet help; bulk slows you.`) +
      mrow("Agility", rate(mv.turn * mv.accel, 8, 36), "How quickly you turn and get going. More legs and a tail help; bulk hurts.") +
      mrow("Swimming", rate(mv.swim, 0.55, 1.35), "Fins, webbed feet and tentacles swim faster.") +
      `<div class="ceStat" title="Heavy bodies hit harder in a charge but are spotted from further away."><span>Build</span><em>${bulk}</em></div>` +
      '<h4>Combat</h4>' +
      COMBAT.map((k) => row(k, ABILITY_INFO[k].name)).join("") +
      '<h4>Social</h4>' +
      SOCIAL.map((k) => row(k, ABILITY_INFO[k].name)).join("") +
      '<h4>Body</h4>' +
      ["health", "sight", "hearing", "sneak", "jump", "glide"].map((k) => row(k, STAT_INFO[k].name)).join("");
  }
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
  function renderBodyTab() {
    const node = rec.spine[selectedNode];
    $('[data-pane="body"]').innerHTML = `
      <div class="ceGroup">
        <h4>Spine <small>${rec.spine.length} / ${LIMITS.maxNodes}</small></h4>
        <div class="ceRow">
          <button id="ceAddNode" ${rec.spine.length >= LIMITS.maxNodes ? "disabled" : ""}>+ Vertebra <small>${NODE_COST} DNA</small></button>
          <button id="ceDelNode" ${node && rec.spine.length > LIMITS.minNodes ? "" : "disabled"}>− Remove selected</button>
        </div>
        <label class="ceSlider ${node ? "" : "off"}">Girth${node ? "" : " <small>(select a handle)</small>"}
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
              <button data-delleg="${i}" aria-label="Remove leg pair ${i + 1}">✕</button>
            </div>`,
          )
          .join("")}
        <button id="ceAddLeg" ${rec.legs.length >= LIMITS.maxLegPairs ? "disabled" : ""}>+ Leg pair <small>${LEG_COST} DNA</small></button>
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
              <button data-delarm="${i}" aria-label="Remove arm pair ${i + 1}">✕</button>
            </div>`,
          )
          .join("")}
        <button id="ceAddArm" ${rec.arms.length >= LIMITS.maxArmPairs ? "disabled" : ""}>+ Arm pair <small>${ARM_COST} DNA</small></button>
      </div>`;
    const p = $('[data-pane="body"]');
    p.querySelector("#ceAddNode").onclick = () => {
      commit();
      const i = selectedNode >= 0 && selectedNode < rec.spine.length - 1 ? selectedNode : rec.spine.length - 2;
      const a = rec.spine[i],
        b = rec.spine[i + 1];
      rec.spine.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: (a.r + b.r) / 2 });
      selectedNode = i + 1;
      rebuild();
      renderBodyTab();
      o.sfx("click");
    };
    p.querySelector("#ceDelNode").onclick = () => {
      if (selectedNode < 0) return;
      commit();
      rec.spine.splice(selectedNode, 1);
      selectedNode = -1;
      rebuild();
      renderBodyTab();
    };
    const girth = p.querySelector("#ceGirth");
    girth.onpointerdown = () => commit();
    girth.onkeydown = () => commit();
    girth.oninput = () => {
      if (selectedNode < 0) return;
      rec.spine[selectedNode].r = +girth.value;
      rebuild();
    };
    p.querySelectorAll("input[data-leg]").forEach((inp) => {
      inp.onpointerdown = () => commit();
      inp.onkeydown = () => commit();
      inp.oninput = () => {
        rec.legs[+inp.dataset.leg][inp.dataset.k] = +inp.value;
        rebuild();
      };
    });
    p.querySelectorAll("[data-delleg]").forEach(
      (b) =>
        (b.onclick = () => {
          commit();
          rec.legs.splice(+b.dataset.delleg, 1);
          rebuild();
          renderBodyTab();
        }),
    );
    p.querySelectorAll("input[data-arm]").forEach((inp) => {
      inp.onpointerdown = () => commit();
      inp.onkeydown = () => commit();
      inp.oninput = () => {
        rec.arms[+inp.dataset.arm][inp.dataset.k] = +inp.value;
        rebuild();
      };
    });
    p.querySelectorAll("[data-delarm]").forEach(
      (b) =>
        (b.onclick = () => {
          commit();
          rec.arms.splice(+b.dataset.delarm, 1);
          rebuild();
          renderBodyTab();
        }),
    );
    p.querySelector("#ceAddArm").onclick = () => addArmAt(null, null, "paw");
    p.querySelector("#ceAddLeg").onclick = () => {
      commit();
      const used = rec.legs.map((l) => l.t);
      const t = [0.5, 0.3, 0.72, 0.15, 0.85].find((c) => used.every((u) => Math.abs(u - c) > 0.12)) ?? 0.5;
      rec.legs.push({ t, length: rec.legs[0]?.length || 1.1 });
      rebuild();
      renderBodyTab();
      o.sfx("click");
    };
  }

  /* ---- Parts tab ---------------------------------------------------------------- */
  let thumbs = new Map();
  let partSection = PART_SECTIONS[0][0];
  /** The catalogue card shown in the detail panel. */
  let focusId = null;
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
  function renderPartsTab() {
    const pane = $('[data-pane="parts"]');
    const sel = rec.parts[selectedPart];
    const selDef = sel && creaturePart(sel.id);
    const title = PART_SECTIONS.find(([id]) => id === partSection)[1];
    const defs = defsOf(partSection);
    if (!focusId || !defs.some((d) => d.id === focusId)) focusId = (defs.find((d) => equippedNow(d)) || defs[0])?.id || null;
    const tile = (def) =>
      tileHtml(def, { thumb: thumbs.get(def.id === LEG_CARD.id ? "__leg" : def.id === ARM_CARD.id ? "__arm" : def.id), unlocked: isUnlocked(def.id), seen: seenPart(def.id), inUse: equippedNow(def), focused: def.id === focusId });
    let html = "";
    if (selDef) {
      html += `<div class="ceSelected"><b>${esc(selDef.name)}</b>
        <label>Size <input type="range" data-partk="scale" min="0.6" max="1.6" step="0.05" value="${sel.scale || 1}"></label>
        <label>Turn <input type="range" data-partk="roll" min="-3.14" max="3.14" step="0.05" value="${sel.roll || 0}"></label>
        <button id="cePartDel">Remove</button></div>`;
    }
    const open = defs.filter((d) => isUnlocked(d.id)).length;
    html += `<h3 class="ceCatTitle">${title}<small>${open}/${defs.length} unlocked</small><small class="ceBudget" id="ceBudget"></small></h3><div class="ceGrid" id="ceGrid" role="group" aria-label="${title}">`;
    if (partSection === "mouth") {
      // Mouths are grouped by what they let you eat.
      for (const diet of MOUTH_DIETS) {
        html += `<h4 class="ceDietHead diet-${diet}">${DIET_NAME[diet]}</h4>`;
        for (const id of mouthsOfDiet(diet)) html += tile(creaturePart(id));
      }
    } else html += defs.map(tile).join("");
    html += '</div><div class="ceInfo" id="ceInfo" aria-live="polite"></div>';
    const grid0 = pane.querySelector(".ceGrid");
    const keepScroll = pane.dataset.section === partSection && grid0 ? grid0.scrollTop : 0;
    const keepLeft = pane.dataset.section === partSection && grid0 ? grid0.scrollLeft : 0;
    pane.innerHTML = html;
    pane.dataset.section = partSection;
    const grid = pane.querySelector(".ceGrid");
    grid.scrollTop = keepScroll;
    grid.scrollLeft = keepLeft;
    if (selDef) {
      pane.querySelectorAll("input[data-partk]").forEach((inp) => {
        inp.onpointerdown = () => commit();
        inp.onkeydown = () => commit();
        inp.oninput = () => {
          rec.parts[selectedPart][inp.dataset.partk] = +inp.value;
          rebuild();
        };
      });
      pane.querySelector("#cePartDel").onclick = removeSelectedPart;
    }
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
    commit();
    rec.parts.splice(selectedPart, 1);
    selectedPart = -1;
    rebuild();
    renderPartsTab();
    o.sfx("click");
  }

  /* ---- Paint tab -------------------------------------------------------------------- */
  function renderPaintTab() {
    const row = (key, label) =>
      `<div class="ceGroup"><h4>${label}</h4><div class="ceSwatches" role="radiogroup" aria-label="${label}">${SWATCHES.map(
        (c) => `<button role="radio" aria-checked="${rec.colors[key] === c}" aria-label="${label} ${hex(c)}" data-color="${key}" data-value="${c}" style="--c:${hex(c)}"></button>`,
      ).join("")}<label class="ceCustom" aria-label="Custom ${label} colour"><input type="color" data-colorpick="${key}" value="${hex(rec.colors[key])}"></label></div></div>`;
    $('[data-pane="paint"]').innerHTML =
      row("base", "Back and sides") +
      row("belly", "Belly") +
      row("pattern", "Pattern colour") +
      row("accent", "Detail colour") +
      `<div class="ceGroup"><h4>Pattern</h4><div class="ceRow" role="radiogroup" aria-label="Pattern">${PATTERNS.map(
        ([id, name]) => `<button role="radio" aria-checked="${rec.pattern === id}" data-pattern="${id}">${name}</button>`,
      ).join("")}</div></div>`;
    const pane = $('[data-pane="paint"]');
    pane.querySelectorAll("[data-color]").forEach(
      (b) =>
        (b.onclick = () => {
          commit();
          rec.colors[b.dataset.color] = +b.dataset.value;
          rebuild();
          renderPaintTab();
        }),
    );
    pane.querySelectorAll("[data-colorpick]").forEach((inp) => {
      inp.onfocus = () => commit();
      inp.oninput = () => {
        rec.colors[inp.dataset.colorpick] = parseInt(inp.value.slice(1), 16);
        rebuild();
      };
    });
    pane.querySelectorAll("[data-pattern]").forEach(
      (b) =>
        (b.onclick = () => {
          commit();
          rec.pattern = b.dataset.pattern;
          rebuild();
          renderPaintTab();
        }),
    );
  }

  /* ---- tabs ------------------------------------------------------------------- */
  let tab = "body";
  /** Show a pane (body, parts or paint) and light the matching icon on the rail. */
  function setTab(name) {
    tab = name;
    if (name !== "parts") {
      if (previewId) {
        previewId = null;
        rebuild();
      }
    }
    const cat = name === "parts" ? partSection : name;
    root.querySelectorAll(".ceRail [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === cat)));
    root.querySelectorAll(".ceTab").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "body") renderBodyTab();
    else if (name === "parts") renderPartsTab();
    else renderPaintTab();
  }
  root.querySelectorAll(".ceRail [role=tab]").forEach(
    (b) =>
      (b.onclick = () => {
        const cat = b.dataset.cat;
        if (cat === "body" || cat === "paint") return setTab(cat);
        if (cat !== partSection || tab !== "parts") {
          partSection = cat;
          focusId = null;
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
    commit();
    if (def.slot === "foot") rec.foot = id;
    else {
      // Swapping a mouth or tail keeps the old one's size and turn, so it grows from the same place.
      const old = def.slot === "mouth" || def.slot === "tail" ? rec.parts.find((p) => creaturePart(p.id).slot === def.slot) : null;
      if (old) rec.parts = rec.parts.filter((p) => p !== old);
      if (rec.parts.length >= maxParts) {
        hint(maxParts < LIMITS.maxParts ? "Your brain can manage " + maxParts + " parts for now. A bigger brain carries more." : "That's the most parts one creature can carry (" + maxParts + ").");
        undoStack.pop();
        return;
      }
      rec.parts.push({ id, ...snapSpot(def, t, angle), scale: old?.scale || 1, ...(old?.roll ? { roll: old.roll } : {}) });
      selectedPart = rec.parts.length - 1;
    }
    o.sfx("unlock");
    hint(def.name + ": " + def.desc);
    previewId = null;
    focusId = def.id;
    rebuild();
    renderPartsTab();
  }

  /** Put a hand (a grasper or a foot) on the end of arm pair i. */
  function setHand(i, id) {
    const arm = rec.arms[i];
    const def = creaturePart(id);
    if (!arm || !def || !fitsArm(id) || !o.unlocked.has(id)) return;
    if (arm.hand === id) return;
    commit();
    arm.hand = id;
    o.sfx("unlock");
    hint(def.name + (def.slot === "foot" ? " on your arms: walk on all fours, Spore-style." : ": " + def.desc));
    rebuild();
    renderPartsTab();
    renderBodyTab();
  }
  /** Add a pair of arms where it was dropped (or on the chest), holding `hand`. */
  function addArmAt(t, angle, hand) {
    if (rec.arms.length >= LIMITS.maxArmPairs) {
      hint("Two pairs is the most arms a creature can have. Drop graspers on the ends of the ones you have.");
      return;
    }
    commit();
    rec.arms.push({
      t: THREE.MathUtils.clamp(t ?? ARM_SPOT.t, 0.05, 0.95),
      angle: THREE.MathUtils.clamp(Math.abs(angle ?? ARM_SPOT.angle), ARM_ANGLE.min, ARM_ANGLE.max),
      length: rec.arms[0]?.length || 1,
      bend: 0,
      hand,
    });
    o.sfx("unlock");
    hint(hand && hand !== "paw" ? creaturePart(hand).name + " on a new pair of arms. Drag the elbows and hands to pose them." : "Arms! Drag graspers onto their ends, and the elbows and hands to pose them.");
    rebuild();
    renderPartsTab();
    renderBodyTab();
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
    commit();
    const used = rec.legs.map((l) => l.t);
    const spot = t ?? [0.5, 0.3, 0.72, 0.15, 0.85].find((c) => used.every((u) => Math.abs(u - c) > 0.12)) ?? 0.5;
    rec.legs.push({ t: THREE.MathUtils.clamp(spot, 0.05, 0.95), length: rec.legs[0]?.length || 1.1 });
    o.sfx("unlock");
    rebuild();
    renderPartsTab();
  }
  /**
   * A catalogue tile: tap to select it (and preview it), or pull it onto the body. The grid scrolls
   * natively along its own axis (down in the side panel, across in the bottom sheet); a touch that
   * moves across that axis picks the tile up instead, and a mouse picks it up in any direction.
   */
  function wireCard(card) {
    const id = card.dataset.part;
    const def = cardDef(id);
    let start = null,
      dragging = false,
      suppressClick = false;
    const sideLayout = () => root.classList.contains("side");
    const begin = (e) => {
      dragging = true;
      suppressClick = true;
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
      if (navigator.vibrate)
        try {
          navigator.vibrate(8);
        } catch (err) {
          /* not allowed */
        }
    };
    card.onpointerdown = (e) => {
      if (e.button > 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      suppressClick = false;
    };
    card.onpointermove = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        const along = sideLayout() ? Math.abs(dy) > Math.abs(dx) * 1.2 : Math.abs(dx) > Math.abs(dy) * 1.2;
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
      if (end) marker.position.copy(end.point);
      else if (s) marker.position.copy(s.point);
    };
    const end = (e) => {
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
      card.classList.remove("dragging");
      root.classList.remove("placing");
    };
    card.onpointerup = end;
    card.onpointercancel = end;
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

  /* ---- canvas interaction: spine handles, parts, orbit ------------------------------ */
  const pointers = new Map();
  let drag = null;
  const profilePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  function onCanvasDown(e) {
    if (testing) {
      drag = { kind: "orbit", x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (previewId) {
      // Touching the creature ends a preview.
      previewId = null;
      rebuild();
      if (tab === "parts") renderInfo();
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), dist: orbit.dist };
      return;
    }
    const ray = rayFrom(e.clientX, e.clientY);
    let h = ray.intersectObjects(handles.children, false)[0];
    if (!h) {
      // Fingers are bigger than handles: grab the nearest handle within reach on screen.
      const tolerance = e.pointerType === "mouse" ? 14 : 34;
      const r = canvas.getBoundingClientRect();
      let best = tolerance;
      handles.children.forEach((obj) => {
        const v = obj.getWorldPosition(new THREE.Vector3()).project(camera);
        const d = Math.hypot(r.left + (v.x * 0.5 + 0.5) * r.width - e.clientX, r.top + (-v.y * 0.5 + 0.5) * r.height - e.clientY);
        if (d < best) {
          best = d;
          h = { object: obj };
        }
      });
    }
    if (h) {
      commit();
      selectedNode = h.object.userData.node;
      selectedPart = -1;
      drag = { kind: "node", index: selectedNode, moved: false };
      canvas.setPointerCapture(e.pointerId);
      rebuild();
      if (tab === "body") renderBodyTab();
      else setTab("body");
      hint("Drag to bend the spine. Use the Girth slider to make this part fatter or thinner.");
      return;
    }
    const p = creature && ray.intersectObjects(creature.partMeshes, false)[0];
    if (p) {
      selectedPart = p.object.userData.partIndex;
      selectedNode = -1;
      const def = creaturePart(rec.parts[selectedPart]?.id);
      drag = { kind: "part", index: selectedPart, startX: e.clientX, startY: e.clientY, moved: false, def };
      canvas.setPointerCapture(e.pointerId);
      rebuild();
      setTab("parts");
      hint(def ? def.name + " selected. Drag it to move, or remove it from the Parts tab. Delete key removes it." : "");
      return;
    }
    drag = { kind: "orbit", x: e.clientX, y: e.clientY, tap: true };
  }
  function onCanvasMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      orbit.dist = THREE.MathUtils.clamp((drag.dist * drag.d) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 4, 16);
    } else if (drag.kind === "orbit") {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.tap = false;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, 0.02, 1.2);
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else if (drag.kind === "node") {
      const ray = rayFrom(e.clientX, e.clientY);
      // Drag in the side-profile plane, whichever way the camera is looking.
      profilePlane.normal.set(0, 0, 1);
      if (Math.abs(ray.ray.direction.z) < 0.2) profilePlane.normal.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const pt = ray.ray.intersectPlane(profilePlane, new THREE.Vector3());
      if (!pt) return;
      creature.body.worldToLocal(pt);
      const n = rec.spine[drag.index],
        prev = rec.spine[drag.index - 1],
        next = rec.spine[drag.index + 1];
      // Vertebrae keep their order and spacing, so the body never folds back on itself.
      const lo = prev ? prev.x + 0.3 : -3,
        hi = next ? next.x - 0.3 : 3;
      if (profilePlane.normal.z === 1) n.x = THREE.MathUtils.clamp(pt.x, lo, hi);
      n.y = THREE.MathUtils.clamp(pt.y, -1, 1.5);
      drag.moved = true;
      rebuild();
    } else if (drag.kind === "part") {
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 8) return;
      if (!drag.def) return;
      const s = surfaceAt(e.clientX, e.clientY);
      if (!s) return;
      if (!drag.moved) commit();
      drag.moved = true;
      Object.assign(rec.parts[drag.index], snapSpot(drag.def, s.t, s.angle));
      rebuild();
    }
  }
  function onCanvasUp(e) {
    pointers.delete(e.pointerId);
    if (drag?.kind === "node" && !drag.moved) undoStack.pop();
    if (drag?.kind === "orbit" && drag.tap && !testing) {
      // Tapping empty space clears the selection.
      selectedNode = -1;
      selectedPart = -1;
      rebuild();
      if (tab === "body") renderBodyTab();
      else if (tab === "parts") renderPartsTab();
    }
    if (drag?.kind === "part" && drag.moved) renderPartsTab();
    drag = pointers.size ? drag : null;
  }
  const onWheel = (e) => {
    e.preventDefault();
    orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 4, 16);
  };
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  function updatePartHalo() {
    const m = creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart);
    partHalo.visible = !!m && !testing;
    if (m) {
      creature.root.updateMatrixWorld(true);
      m.getWorldPosition(partHalo.position);
      partHalo.lookAt(camera.position);
    }
  }

  /* ---- grips: joints and part handles ----------------------------------------------
     Big round handles drawn over the 3D view, so they are easy to hit with a finger. On the Body
     tab every leg pair has a knee grip (drag forward or back to bend the leg) and a foot grip (drag
     along the leg to stretch or shorten it); arms get the same pair (elbow up or down to raise and
     fold the arm, hand along the arm for reach). A selected part gets a size grip and a turn grip.
     Every grip has a slider twin in the panel for keyboards. */
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
  const selectedMesh = () => creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart);
  function renderGrips() {
    const part = rec.parts[selectedPart];
    const key = rec.legs.length + "|" + rec.arms.length + "|" + selectedPart + "|" + (part ? part.id : "");
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
  }
  /** Where each grip sits on screen this frame. */
  function placeGrips() {
    const showLegs = !testing && tab === "body";
    const mesh = !testing && selectedPart >= 0 ? selectedMesh() : null;
    const panelTop = root.querySelector(".cePanel")?.getBoundingClientRect().top ?? innerHeight;
    const topBottom = root.querySelector(".ceTop")?.getBoundingClientRect().bottom ?? 0;
    let centreS = null;
    if (mesh) {
      creature.root.updateMatrixWorld(true);
      centreS = toScreen(mesh.getWorldPosition(new THREE.Vector3()));
    }
    for (const g of gripList) {
      let at = null;
      if (g.limb) {
        if (showLegs) {
          const j = nearLimb(g.limb, g.leg);
          if (j) at = toScreen(g.kind.startsWith("knee") ? j.knee : j.foot);
        }
      } else if (mesh) {
        if (g.kind === "size") at = centreS.clone().add(new THREE.Vector2(46, 34));
        else if (g.kind === "turn") at = centreS.clone().add(new THREE.Vector2(-46, 34));
      }
      // Never over the tool panel or the top bar.
      if (at && (at.y > panelTop - 12 || at.y < topBottom + 12)) at = null;
      g.el.hidden = !at;
      if (at) {
        g.el.style.left = at.x + "px";
        g.el.style.top = at.y + "px";
      }
    }
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
      commit();
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
      } else {
        const part = rec.parts[selectedPart];
        if (!part) return;
        if (g.kind === "size") part.scale = THREE.MathUtils.clamp(d.scale0 * (1 + (pointer.distanceTo(d.centre) - d.dist0) / 110), 0.6, 1.6);
        else if (g.kind === "turn") {
          const a = Math.atan2(pointer.y - d.centre.y, pointer.x - d.centre.x);
          part.roll = THREE.MathUtils.euclideanModulo(d.roll0 + (a - d.angle0) + Math.PI, Math.PI * 2) - Math.PI;
        }
      }
      rebuild();
    };
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved) undoStack.pop();
      d = null;
      g.el.classList.remove("held");
      renderDna();
      if (tab === "body") renderBodyTab();
      else if (tab === "parts") renderPartsTab();
    };
    g.el.onpointerup = end;
    g.el.onpointercancel = end;
  }

  /* ---- test drive ---------------------------------------------------------- */
  let testing = false,
    testT = 0;
  function setTesting(on) {
    testing = on;
    $("#ceTest").setAttribute("aria-pressed", String(on));
    $("#ceTest").innerHTML = on ? `${ICONS.stop}<span>Stop</span>` : `${ICONS.play}<span>Test</span>`;
    root.classList.toggle("testing", on);
    fitCamera();
    handles.visible = !on;
    partHalo.visible = false;
    const bar = $("#ceTestBar");
    bar.hidden = !on;
    if (on) {
      const ab = abilitiesOf(creaturePartIds(view()), rec.legs.length, armPairsOf(rec));
      bar.innerHTML = [...COMBAT, ...SOCIAL]
        .map((k) => `<button data-play="${k}" ${ab[k] ? "" : "disabled"}><b>${ABILITY_INFO[k].name}</b><small>Level ${ab[k] || "–"}</small></button>`)
        .join("");
      bar.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => creature.playAbility(b.dataset.play)));
      hint("Watch it walk. Tap an ability to see it.");
    } else {
      creature.root.position.set(0, FLOOR, 0);
      creature.root.rotation.set(0, 0, 0);
      hint("Back to editing.");
    }
  }
  $("#ceTest").onclick = () => setTesting(!testing);

  /* ---- finish ---------------------------------------------------------------- */
  let closed = false;
  function close() {
    closed = true;
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown", onCanvasDown);
    canvas.removeEventListener("pointermove", onCanvasMove);
    canvas.removeEventListener("pointerup", onCanvasUp);
    canvas.removeEventListener("pointercancel", onCanvasUp);
    canvas.removeEventListener("wheel", onWheel);
    camera.clearViewOffset();
    window.removeEventListener("resize", fitCamera);
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.removeEventListener(t, stopGesture));
    creature?.dispose();
    root.remove();
    [handleGeo, handleRimGeo, handleMat, handleSelMat, handleRimMat, marker.geometry, marker.material, partHalo.geometry, partHalo.material].forEach((d) => d.dispose());
    backdrop.dispose();
  }
  $("#ceDone").onclick = () => {
    if (problems().length) return;
    rec.name = (nameInput.value.trim() || "Karlets").replace(/[<>]/g, "").slice(0, 22);
    const result = validateCreature(rec),
      left = o.dna - cost();
    o.sfx("hatch");
    close();
    o.onDone(result, left);
  };
  $("#ceCancel").onclick = () => {
    close();
    o.onCancel();
  };
  const onKey = (e) => {
    if (e.target === nameInput || e.target?.tagName === "INPUT") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      restore(e.shiftKey ? redoStack : undoStack, e.shiftKey ? undoStack : redoStack);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      restore(redoStack, undoStack);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selectedPart >= 0) removeSelectedPart();
    else if (e.key === "Escape") {
      if (testing) setTesting(false);
      else if (previewId) {
        previewId = null;
        rebuild();
        renderInfo();
      }
      else if (selectedPart >= 0 || selectedNode >= 0) {
        selectedPart = selectedNode = -1;
        rebuild();
      }
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---- start ------------------------------------------------------------------ */
  /** Wide screens get the catalogue as a panel on the left; narrow ones as a sheet underneath. */
  const wantsSide = () => innerWidth >= 900 || (innerWidth > innerHeight && innerWidth >= 640);
  let avail = { w: innerWidth, h: innerHeight };
  /** Lay the editor out for the window, and keep the creature centred in the space the tools leave free. */
  function fitCamera() {
    root.classList.toggle("side", wantsSide());
    const side = root.classList.contains("side");
    const rect = (sel) => root.querySelector(sel)?.getBoundingClientRect();
    const top = rect(".ceTop")?.height || 0;
    camera.aspect = innerWidth / innerHeight;
    if (side && !testing) {
      const panelW = rect(".cePanel")?.width || 0;
      const statsW = (rect(".ceStats")?.width || 0) + 20;
      avail = { w: Math.max(200, innerWidth - panelW - statsW), h: Math.max(200, innerHeight - top) };
      // Slide the picture right of the catalogue panel and left of the stats, and down under the top bar.
      camera.setViewOffset(innerWidth, innerHeight, -(panelW - statsW) / 2, -top / 2, innerWidth, innerHeight);
    } else {
      const panel = testing ? 0 : rect(".cePanel")?.height || 0;
      // The full stats panel (tablets in portrait) sits over the right edge: frame the creature in the space left of it.
      const statsW = !testing && innerWidth > 760 ? (rect(".ceStats")?.width || 0) + 20 : 0;
      avail = { w: Math.max(200, innerWidth - statsW), h: Math.max(200, innerHeight - panel - top) };
      camera.setViewOffset(innerWidth, innerHeight, statsW / 2, (panel - top) / 2, innerWidth, innerHeight);
    }
    $("#ceHint").style.top = top + 8 + "px";
    root.style.setProperty("--ce-top", top + "px");
    sizeTiles();
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", fitCamera);
  /** Stop iOS from pinch-zooming the page while you work. */
  const stopGesture = (e) => e.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, stopGesture, { passive: false }));
  try {
    thumbs = bakePartThumbs(o.renderer, { color: rec.colors.base });
  } catch (err) {
    /* thumbnails are decoration; the cards still work without them */
  }
  rebuild();
  setTab("body");
  fitCamera();
  if (!matchMedia("(pointer: coarse)").matches) nameInput.focus({ preventScroll: true });
  return {
      get closed() {
        return closed;
      },
      get record() {
        return rec;
      },
      update(dt) {
        if (closed || !creature) return;
        if (testing) {
          testT += dt;
          const r = 2.4,
            a = testT * 0.6;
          creature.root.position.set(Math.cos(a) * r - centre.x, FLOOR, Math.sin(a) * r);
          creature.root.rotation.y = -a - Math.PI / 2;
          creature.lookAt(null);
          creature.update(dt, 2.6);
        } else {
          // As in Spore, the creature on the table looks back at you.
          creature.lookAt(camera.position);
          creature.update(dt, 0);
        }
        // Orbit around the body's middle.
        const target = testing ? new THREE.Vector3(0, 1, 0) : centre;
        // Tall phone screens need the camera further back to fit the body's length.
        // Back off just far enough that the whole creature fits the free space (not under the panel or stats),
        // easing as parts change. The zoom you set (orbit.dist, 9 = as framed) scales on top of that.
        let fit = 9 * Math.max(1, 0.85 / Math.max(0.3, camera.aspect));
        if (!testing) {
          const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          const dW = (bounds.w * 1.12) / (0.9 * (avail.w / innerWidth) * 2 * tanV * camera.aspect);
          const dH = (bounds.h * 1.2) / (0.86 * (avail.h / innerHeight) * 2 * tanV);
          fit = THREE.MathUtils.clamp(Math.max(dW, dH), 5, 15);
        }
        framing = framing ? framing + (fit - framing) * Math.min(1, dt * 5) : fit;
        const dist = (testing ? fit : framing) * (orbit.dist / 9);
        camera.position.set(
          target.x + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist,
          target.y + Math.sin(orbit.pitch) * dist + 0.3,
          target.z - Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist,
        );
        // Look a little above the body so the treeline and sky stay in view behind it.
        // While editing, frame the whole creature, feet included, above the tool panel.
        camera.lookAt(target.x, target.y + (testing ? 0.9 : -0.2), target.z);
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
        placePart,
        surfaceAt,
        setTab,
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
          const rect = (sel) => root.querySelector(sel)?.getBoundingClientRect();
          const side = root.classList.contains("side");
          const panel = rect(".cePanel"),
            top = rect(".ceTop"),
            stats = rect(".ceStats");
          const free = side ? { left: panel.right, right: stats.left, top: top.bottom, bottom: innerHeight } : { left: 0, right: innerWidth > 760 ? stats.left : innerWidth, top: top.bottom, bottom: panel.top };
          return { x0, y0, x1, y1, free };
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
        setTesting,
        cost,
        problems,
        /** Select a part by index (tests). */
        selectPart(i) {
          selectedPart = i;
          selectedNode = -1;
          rebuild();
          setTab("parts");
        },
        get rec() {
          return rec;
        },
      },
  };
}
