/**
 * Creature editor: shape the spine, add legs, drop parts on the body, paint, test drive.
 *
 * Opens over the game with its own scene and orbit camera. The spine is edited in the side profile
 * (the body is always mirrored left/right, like Spore). Parts are dragged from the strip onto the
 * body; flank parts mirror automatically. New parts and leg pairs cost DNA.
 */
import * as THREE from "three";
import { createEditorBackdrop } from "./backdrop.js";
import { buildCreatureBody } from "./body3d.js";
import { LIMITS, creaturePartIds, validateCreature } from "./format.js";
import { ABILITY_INFO, ARM_PARTS, COMBAT, CREATURE_PARTS, PART_SECTIONS, SOCIAL, STAT_INFO, abilitiesOf, abilityIcon, creaturePart, dietOfParts, elbowOf, partGeometry } from "./parts.js";

const LEG_COST = 8;
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
const cardDef = (id) => (id === LEG_CARD.id ? LEG_CARD : creaturePart(id));
/** Where a part goes when it is tapped instead of dragged. */
const DEFAULT_SPOT = { mouth: [1, 0], eye: [0.86, 0.75], side: [0.62, 1.45], back: [0.5, 0], tail: [0, 0] };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

/** DNA cost of turning `from` into `to`: new parts, leg pairs and vertebrae; removing is free. */
export function designCost(from, to) {
  const owned = new Map();
  creaturePartIds(from).forEach((id) => owned.set(id, (owned.get(id) || 0) + 1));
  let cost = 0;
  for (const id of creaturePartIds(to)) {
    if (owned.get(id)) owned.set(id, owned.get(id) - 1);
    else cost += creaturePart(id)?.cost || 0;
  }
  cost += Math.max(0, to.legs.length - from.legs.length) * LEG_COST;
  cost += Math.max(0, to.spine.length - from.spine.length) * NODE_COST;
  return cost;
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.record     current design
 * @param {Set<string>} o.unlocked  part ids the player may use
 * @param {number} o.dna
 * @param {string} o.quality
 * @param {(kind:string) => void} o.sfx
 * @param {(record:object, dnaLeft:number) => void} o.onDone
 * @param {() => void} o.onCancel
 */
export function openCreatureEditor(o) {
  const original = validateCreature(o.record);
  let rec = validateCreature(o.record);
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
  root.className = "crEditor";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Creature editor");
  root.innerHTML = `
    <div class="ceTop">
      <input id="ceName" maxlength="22" aria-label="Species name" autocomplete="off" spellcheck="false">
      <span class="ceDna" id="ceDna" aria-live="polite"></span>
      <div class="ceTopBtns">
        <button id="ceUndo" aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button id="ceRedo" aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
        <button id="ceTest" aria-pressed="false">▶ Test</button>
        <button id="ceCancel">Cancel</button>
        <button id="ceDone" class="primary">Done</button>
      </div>
    </div>
    <p class="ceHint" id="ceHint" aria-live="polite"></p>
    <aside class="ceStats" id="ceStats" aria-label="Abilities"></aside>
    <div class="ceTestBar" id="ceTestBar" hidden></div>
    <section class="cePanel" aria-label="Editor tools">
      <nav class="ceTabs" role="tablist">
        <button role="tab" data-tab="body" aria-selected="true">Body</button>
        <button role="tab" data-tab="parts" aria-selected="false">Parts</button>
        <button role="tab" data-tab="paint" aria-selected="false">Paint</button>
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
    creature = buildCreatureBody(rec, { quality: o.quality === "low" ? "medium" : "high" });
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
    updatePartHalo();
    renderGrips();
    renderStats();
    renderDna();
  }
  const centre = new THREE.Vector3();
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
    rebuild();
    renderBodyTab();
    o.sfx("click");
  }
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
    $("#ceDna").innerHTML = `🧬 <b>${o.dna - c}</b> left${c ? ` <small>(−${c})</small>` : ""}`;
    $("#ceDna").classList.toggle("over", c > o.dna);
    const issues = problems();
    $("#ceDone").disabled = issues.length > 0;
    $("#ceDone").title = issues.join(". ");
    $("#ceUndo").disabled = !undoStack.length;
    $("#ceRedo").disabled = !redoStack.length;
  }
  function renderStats() {
    const ab = abilitiesOf(creaturePartIds(rec), rec.legs.length);
    const diet = dietOfParts(rec.parts.map((p) => p.id));
    const row = (k, name, icon) => `<div class="ceStat"><span>${icon} ${name}</span><i>${[1, 2, 3, 4, 5].map((n) => `<b class="${n <= ab[k] ? "on" : ""}"></b>`).join("")}</i></div>`;
    $("#ceStats").innerHTML =
      `<h3>${diet === "meat" ? "Carnivore" : diet === "plant" ? "Herbivore" : "Omnivore"}</h3>` +
      '<h4>Combat</h4>' +
      COMBAT.map((k) => row(k, ABILITY_INFO[k].name, ABILITY_INFO[k].icon)).join("") +
      '<h4>Social</h4>' +
      SOCIAL.map((k) => row(k, ABILITY_INFO[k].name, ABILITY_INFO[k].icon)).join("") +
      '<h4>Body</h4>' +
      ["speed", "health", "sight", "sneak", "jump", "glide"].map((k) => row(k, STAT_INFO[k].name, STAT_INFO[k].icon)).join("");
  }

  /* ---- Body tab --------------------------------------------------------------- */
  function renderBodyTab() {
    const node = rec.spine[selectedNode];
    $('[data-pane="body"]').innerHTML = `
      <div class="ceGroup">
        <h4>Spine <small>${rec.spine.length} / ${LIMITS.maxNodes}</small></h4>
        <div class="ceRow">
          <button id="ceAddNode" ${rec.spine.length >= LIMITS.maxNodes ? "disabled" : ""}>+ Vertebra <small>${NODE_COST}🧬</small></button>
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
        <button id="ceAddLeg" ${rec.legs.length >= LIMITS.maxLegPairs ? "disabled" : ""}>+ Leg pair <small>${LEG_COST}🧬</small></button>
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
  const thumbCache = new Map();
  function renderPartsTab() {
    const pane = $('[data-pane="parts"]');
    const sel = rec.parts[selectedPart];
    const selDef = sel && creaturePart(sel.id);
    let html = "";
    if (selDef) {
      html += `<div class="ceSelected"><b>${esc(selDef.name)}</b>
        <label>Size <input type="range" data-partk="scale" min="0.6" max="1.6" step="0.05" value="${sel.scale || 1}"></label>
        <label>Turn <input type="range" data-partk="roll" min="-3.14" max="3.14" step="0.05" value="${sel.roll || 0}"></label>
        ${ARM_PARTS.includes(sel.id) ? `<label>Elbow <input type="range" data-partk="bend" min="-1" max="1" step="0.05" value="${sel.bend || 0}"></label>` : ""}
        <button id="cePartDel">Remove</button></div>`;
    }
    // Spore's layout: a row of section tabs, and one sideways strip of parts for the chosen section.
    html += '<div class="ceChips" role="tablist" aria-label="Part sections">';
    for (const [section, title] of PART_SECTIONS) html += `<button role="tab" data-sec="${section}" aria-selected="${section === partSection}">${title}</button>`;
    html += '</div><div class="ceStrip" id="ceStrip">';
    {
      const section = partSection;
      html += `<div class="ceSlot"><div class="ceCards">`;
      const defs = CREATURE_PARTS.filter((p) => p.section === section);
      if (section === "limbs") defs.unshift(LEG_CARD);
      for (const def of defs) {
        const unlocked = isUnlocked(def.id);
        const inUse = def.slot === "foot" ? rec.foot === def.id : def.slot === "leg" ? false : rec.parts.some((p) => p.id === def.id);
        const abilities = Object.entries(def.abilities)
          .map(([k, v]) => abilityIcon(k) + v)
          .join(" ");
        html += `<button class="cePart ${unlocked ? "" : "locked"} ${inUse ? "inUse" : ""}" data-part="${def.id}" ${unlocked ? "" : 'aria-disabled="true"'} aria-label="${esc(def.name)}${unlocked ? ", costs " + def.cost + " DNA" : ", locked"}">
          <span class="thumb">${def.slot === "leg" ? '<span class="legIc" aria-hidden="true">🦵</span>' : ""}${thumbCache.get(def.id) ? `<img src="${thumbCache.get(def.id)}" alt="" draggable="false">` : ""}${unlocked ? "" : '<span class="lk" aria-hidden="true">🔒</span>'}</span>
          <b>${esc(def.name)}</b><small>${abilities}</small><em>${unlocked ? (def.cost ? def.cost + "🧬" : "Free") : "Find it"}</em>
        </button>`;
      }
      html += "</div></div>";
    }
    html += "</div>";
    const keepScroll = pane.querySelector(".ceCards")?.scrollLeft || 0;
    const sameSection = pane.dataset.section === partSection;
    pane.innerHTML = html;
    pane.dataset.section = partSection;
    const strip = pane.querySelector(".ceCards");
    if (sameSection) strip.scrollLeft = keepScroll;
    // A mouse wheel scrolls the strip sideways.
    strip.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    pane.querySelectorAll(".ceChips button").forEach((b) => {
      b.onclick = () => {
        partSection = b.dataset.sec;
        renderPartsTab();
        pane.querySelector(`.ceChips [data-sec="${partSection}"]`)?.focus();
      };
    });
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
  }
  let partSection = PART_SECTIONS[0][0];
  function removeSelectedPart() {
    if (selectedPart < 0) return;
    commit();
    rec.parts.splice(selectedPart, 1);
    selectedPart = -1;
    rebuild();
    renderPartsTab();
    o.sfx("click");
  }

  /** Render one small picture per part, once. */
  function bakeThumbs() {
    const r = o.renderer;
    const size = 96;
    const target = new THREE.WebGLRenderTarget(size, size);
    const tScene = new THREE.Scene();
    tScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const l = new THREE.DirectionalLight(0xffffff, 1.4);
    l.position.set(2, 3, 4);
    tScene.add(l);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const pixels = new Uint8Array(size * size * 4);
    const img = ctx.createImageData(size, size);
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()),
      prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const def of CREATURE_PARTS) {
      // Feet thumbnails show the foot; everything else shows the part model.
      const mesh = new THREE.Mesh(
        partGeometry(def.id, rec.colors.base),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }),
      );
      mesh.geometry.computeBoundingSphere();
      const bs = mesh.geometry.boundingSphere;
      mesh.position.copy(bs.center).negate();
      const g = new THREE.Group();
      g.add(mesh);
      g.rotation.set(0.35, -0.7, 0);
      tScene.add(g);
      cam.position.set(0, 0, bs.radius * 3.8 + 0.01);
      cam.lookAt(0, 0, 0);
      r.setRenderTarget(target);
      r.clear();
      r.render(tScene, cam);
      r.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      ctx.clearRect(0, 0, size, size);
      ctx.putImageData(img, 0, 0);
      thumbCache.set(def.id, canvas.toDataURL("image/png"));
      tScene.remove(g);
      mesh.material.dispose(); // the geometry is shared and cached by parts.js
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    target.dispose();
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
  function setTab(name) {
    tab = name;
    root.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    root.querySelectorAll(".ceTab").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "body") renderBodyTab();
    else if (name === "parts") renderPartsTab();
    else renderPaintTab();
  }
  root.querySelectorAll("[role=tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

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
  const isUnlocked = (id) => id === LEG_CARD.id || o.unlocked.has(id);
  function placePart(id, t, angle) {
    if (id === LEG_CARD.id) return addLegAt(t);
    const def = creaturePart(id);
    if (!def || !o.unlocked.has(id)) return;
    commit();
    if (def.slot === "foot") rec.foot = id;
    else {
      if (def.slot === "mouth" || def.slot === "tail") rec.parts = rec.parts.filter((p) => creaturePart(p.id).slot !== def.slot);
      if (rec.parts.length >= LIMITS.maxParts) {
        hint("That's the most parts one creature can carry (" + LIMITS.maxParts + ").");
        undoStack.pop();
        return;
      }
      rec.parts.push({ id, ...snapSpot(def, t, angle), scale: 1 });
      selectedPart = rec.parts.length - 1;
    }
    o.sfx("unlock");
    hint(def.name + ": " + def.desc);
    rebuild();
    renderPartsTab();
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
  /** Drag a card from the strip onto the body. Sideways swipes still scroll the strip. */
  function wireCard(card) {
    const id = card.dataset.part;
    const def = cardDef(id);
    let start = null,
      dragging = false,
      scrolling = false,
      holdTimer = 0,
      suppressClick = false;
    const strip = card.parentElement;
    const begin = (e) => {
      dragging = true;
      suppressClick = true;
      clearTimeout(holdTimer);
      card.classList.add("dragging");
      root.classList.add("placing");
      ghost.style.backgroundImage = thumbCache.get(id) ? `url(${thumbCache.get(id)})` : "";
      ghost.hidden = false;
      moveGhost(e);
      if (navigator.vibrate)
        try {
          navigator.vibrate(8);
        } catch (err) {
          /* not allowed */
        }
    };
    /*
     * Cards take the whole gesture themselves (touch-action: none), so the browser never turns a
     * drag into a scroll. A finger moving along the strip scrolls it; pulling a card up or down, or
     * holding it for a moment, picks the part up. A mouse always picks up.
     */
    card.onpointerdown = (e) => {
      if (e.button > 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, scroll: strip.scrollLeft, lastX: e.clientX, lastT: performance.now(), v: 0 };
      suppressClick = false;
      scrolling = false;
      // Keep receiving moves even if a quick flick leaves the card before the drag starts.
      try {
        card.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer already released */
      }
      if (e.pointerType === "mouse" || !isUnlocked(id)) return;
      holdTimer = setTimeout(() => start && !scrolling && begin(e), 260);
    };
    card.onpointermove = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (scrolling) {
        e.preventDefault();
        const now = performance.now();
        start.v = (e.clientX - start.lastX) / Math.max(1, now - start.lastT);
        start.lastX = e.clientX;
        start.lastT = now;
        strip.scrollLeft = start.scroll - dx;
        return;
      }
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        clearTimeout(holdTimer);
        const touch = e.pointerType !== "mouse";
        const along = Math.abs(dx) > Math.abs(dy) * 1.2;
        if (isUnlocked(id) && (!touch || !along)) begin(e);
        else if (touch) {
          scrolling = true;
          suppressClick = true;
          return;
        } else {
          start = null;
          return;
        }
      }
      e.preventDefault();
      moveGhost(e);
      const s = def.slot === "foot" ? null : surfaceAt(e.clientX, e.clientY);
      marker.visible = !!s;
      if (s) marker.position.copy(s.point);
    };
    /** Let the strip coast after a flick. */
    const glide = (v) => {
      let px = v * 16;
      const step = () => {
        if (Math.abs(px) < 0.4 || !strip.isConnected) return;
        strip.scrollLeft -= px;
        px *= 0.93;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const end = (e) => {
      clearTimeout(holdTimer);
      if (scrolling && start && e.type === "pointerup" && performance.now() - start.lastT < 80) glide(start.v);
      if (dragging && e.type === "pointerup") {
        const s = surfaceAt(e.clientX, e.clientY);
        const overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas;
        if (def.slot === "leg") {
          if (overCanvas) placePart(id, s ? s.t : null, 0);
        } else if (s) placePart(id, s.t, s.angle);
        else if (overCanvas && def.slot === "foot") placePart(id, 0.5, 0);
        else if (overCanvas) hint("Drop it on the body.");
      }
      dragging = false;
      scrolling = false;
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
      if (e.detail !== 0 && isUnlocked(id)) {
        // A pointer tap only picks the card up in your mind: parts go where you drag them.
        card.classList.remove("nudge");
        void card.offsetWidth;
        card.classList.add("nudge");
        hint("Drag " + def.name + " onto your creature, wherever you want it.");
        return;
      }
      if (!isUnlocked(id)) {
        hint(def.name + " is locked. Dig it from a fossil, or win it from species you befriend or drive extinct.");
        return;
      }
      if (def.slot === "leg") return placePart(id, null, 0);
      const [t, a] = DEFAULT_SPOT[def.slot] || [0.5, 0];
      // Tapping a second copy of a flank part puts it further back.
      const copies = rec.parts.filter((p) => creaturePart(p.id).slot === def.slot).length;
      placePart(id, def.slot === "side" || def.slot === "back" ? Math.max(0.15, t - copies * 0.18) : t, a);
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
     along the leg to stretch or shorten it). A selected part gets a size grip, a turn grip and,
     for jointed arms, an elbow grip. Every grip has a slider twin in the panel for keyboards. */
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
  /** The leg of a pair on the side facing the camera. */
  function nearLeg(pair) {
    const both = creature.joints().filter((j) => j.pair === pair);
    return both.sort((a, b) => a.foot.distanceToSquared(camera.position) - b.foot.distanceToSquared(camera.position))[0];
  }
  const selectedMesh = () => creature?.partMeshes.find((pm) => pm.userData.partIndex === selectedPart);
  function renderGrips() {
    const part = rec.parts[selectedPart];
    const key = rec.legs.length + "|" + selectedPart + "|" + (part ? part.id : "");
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
      add("knee", "", "Drag to bend the knee", { leg: i });
      add("foot", "↕", "Drag to stretch or shorten the leg", { leg: i });
    });
    if (part) {
      add("size", "⤢", "Drag to resize", {});
      add("turn", "⟳", "Drag to turn", {});
      if (ARM_PARTS.includes(part.id)) add("elbow", "", "Drag to bend the elbow", {});
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
      if (g.kind === "knee" || g.kind === "foot") {
        if (showLegs) {
          const leg = nearLeg(g.leg);
          if (leg) at = toScreen(g.kind === "knee" ? leg.knee : leg.foot);
        }
      } else if (mesh) {
        if (g.kind === "size") at = centreS.clone().add(new THREE.Vector2(46, 34));
        else if (g.kind === "turn") at = centreS.clone().add(new THREE.Vector2(-46, 34));
        else {
          const [ex, ey] = elbowOf(rec.parts[selectedPart].bend || 0);
          at = toScreen(mesh.localToWorld(new THREE.Vector3(ex, ey, 0)));
        }
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
      if (g.kind === "knee" || g.kind === "foot") {
        const leg = nearLeg(g.leg);
        const hip = toScreen(leg.hip),
          foot = toScreen(leg.foot);
        d.along = foot.clone().sub(hip);
        d.len = Math.max(20, d.along.length());
        d.along.normalize();
        // The body's forward direction on screen, for bending the knee.
        const front = toScreen(leg.hip.clone().add(new THREE.Vector3(0.5, 0, 0).applyQuaternion(creature.root.quaternion))).sub(hip);
        d.front = front.length() > 4 ? front.normalize() : new THREE.Vector2(1, 0);
        d.length0 = rec.legs[g.leg].length;
        d.bend0 = rec.legs[g.leg].bend || 0;
      } else {
        const mesh = selectedMesh();
        if (!mesh) return (d = null);
        const part = rec.parts[selectedPart];
        d.centre = toScreen(mesh.getWorldPosition(new THREE.Vector3()));
        d.scale0 = part.scale || 1;
        d.roll0 = part.roll || 0;
        d.bend0 = part.bend || 0;
        d.dist0 = Math.max(12, pointer.distanceTo(d.centre));
        d.angle0 = Math.atan2(pointer.y - d.centre.y, pointer.x - d.centre.x);
        if (g.kind === "elbow") {
          const [ex, ey] = elbowOf(d.bend0);
          const a = toScreen(mesh.localToWorld(new THREE.Vector3(ex, ey, 0))),
            b = toScreen(mesh.localToWorld(new THREE.Vector3(ex, ey + 0.2, 0)));
          d.up = b.sub(a);
          d.upLen = Math.max(8, d.up.length());
          d.up.normalize();
        }
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
      if (g.kind === "foot") {
        rec.legs[g.leg].length = THREE.MathUtils.clamp(d.length0 * (1 + delta.dot(d.along) / d.len), LIMITS.minLeg, LIMITS.maxLeg);
      } else if (g.kind === "knee") {
        rec.legs[g.leg].bend = THREE.MathUtils.clamp(d.bend0 + delta.dot(d.front) / (d.len * 0.9), -1, 1);
      } else {
        const part = rec.parts[selectedPart];
        if (!part) return;
        if (g.kind === "size") part.scale = THREE.MathUtils.clamp(d.scale0 * (1 + (pointer.distanceTo(d.centre) - d.dist0) / 110), 0.6, 1.6);
        else if (g.kind === "turn") {
          const a = Math.atan2(pointer.y - d.centre.y, pointer.x - d.centre.x);
          part.roll = THREE.MathUtils.euclideanModulo(d.roll0 + (a - d.angle0) + Math.PI, Math.PI * 2) - Math.PI;
        } else part.bend = THREE.MathUtils.clamp(d.bend0 + delta.dot(d.up) / (d.upLen * 1.5), -1, 1);
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
    $("#ceTest").textContent = on ? "■ Stop" : "▶ Test";
    root.classList.toggle("testing", on);
    fitCamera();
    handles.visible = !on;
    partHalo.visible = false;
    const bar = $("#ceTestBar");
    bar.hidden = !on;
    if (on) {
      const ab = abilitiesOf(creaturePartIds(rec), rec.legs.length);
      bar.innerHTML = [...COMBAT, ...SOCIAL]
        .map((k) => `<button data-play="${k}" ${ab[k] ? "" : "disabled"}>${ABILITY_INFO[k].icon}<small>${ABILITY_INFO[k].name} ${ab[k] || "–"}</small></button>`)
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
      else if (selectedPart >= 0 || selectedNode >= 0) {
        selectedPart = selectedNode = -1;
        rebuild();
      }
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---- start ------------------------------------------------------------------ */
  /** Keep the creature centred in the space above the tool panel. */
  function fitCamera() {
    const panel = testing ? 0 : root.querySelector(".cePanel")?.getBoundingClientRect().height || 0;
    const top = root.querySelector(".ceTop")?.getBoundingClientRect().height || 0;
    camera.aspect = innerWidth / innerHeight;
    camera.setViewOffset(innerWidth, innerHeight, 0, (panel - top) / 2, innerWidth, innerHeight);
    $("#ceHint").style.top = top + 8 + "px";
    camera.updateProjectionMatrix();
  }
  try {
    bakeThumbs();
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
          creature.update(dt, 2.6);
        } else creature.update(dt, 0);
        // Orbit around the body's middle.
        const target = testing ? new THREE.Vector3(0, 1, 0) : centre;
        // Tall phone screens need the camera further back to fit the body's length.
        const dist = orbit.dist * Math.max(1, 0.85 / Math.max(0.3, camera.aspect));
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
