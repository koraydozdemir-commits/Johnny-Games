/**
 * The modular editor: buildings and vehicles (Civilization Stage) and spaceships (Space Stage).
 *
 * Made for a phone first. Tap a part in the palette to add it (on top of the selected part, or on top
 * of the design); tap a part on the model to select it; drag it to slide it around; the tool bar
 * moves it up and down, turns, resizes, mirrors, copies or deletes it. Drag empty space to turn the
 * view, pinch or scroll to zoom. The Style tab picks the role and the three colours. The stats panel
 * shows what the design will do in play and what it still needs.
 *
 * Opens over the game using the game's renderer; the caller drives update() and render() each frame.
 */
import * as THREE from "three";
import { validateModular } from "./format.js";
import { buildDesignMesh, partExtent } from "./mesh.js";
import { CATALOGS, CATEGORIES, MAX_PARTS, ROLES, VEHICLE_CLASSES, designStats, partOf } from "./modular.js";

const SWATCHES = [0xf2f2f2, 0xe8dcc0, 0xd6a03f, 0xf2c84b, 0xc9483c, 0xd94f8a, 0x8a5fd0, 0x4a74e0, 0x3fa9d6, 0x3fc2a0, 0x6b7a4a, 0x8a8f96, 0x6b5a48, 0x3a3f45, 0x1d2228];
const KIND_NAMES = { building: "Building", vehicle: "Vehicle", ship: "Spaceship" };
const STAT_NAMES = { prestige: "Prestige", strength: "Strength", speed: "Speed", power: "Power", health: "Health", attack: "Attack", energy: "Energy", range: "Range", sensors: "Sensors", cargo: "Cargo" };
const STAT_HELP = {
  strength: { hall: "City style", house: "Population", factory: "Income", fun: "Happiness", temple: "Faith", turret: "Defence" },
  power: { military: "Attack", economic: "Trade", religious: "Preaching" },
};
const MODE_NAMES = { land: "🚙 Land", sea: "🚤 Sea", air: "✈ Air" };
const STEP = 0.25;
const TURN = Math.PI / 12;
const LIMIT = { building: { xz: 5, y: 9 }, vehicle: { xz: 3.5, y: 4 }, ship: { xz: 4, y: 3 } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const round = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {"building"|"vehicle"|"ship"} o.kind
 * @param {object} o.design        the design to edit (a starter design for a new one)
 * @param {string[]} [o.roles]     roles the player may pick (default: all of the kind's)
 * @param {{id:string, mode:string, name:string, icon:string, design:object}[]} [o.templates]
 *        vehicles: ready-made designs to start from, by category (land, sea, air)
 * @param {(kind:string)=>void} [o.sfx]
 * @param {(design:object, stats:object)=>void} o.onDone
 * @param {()=>void} o.onCancel
 */
export function openModularEditor(o) {
  const kind = o.kind;
  const catalog = CATALOGS[kind];
  let design = validateModular(o.design, kind);
  const roleIds = (o.roles?.length ? o.roles : Object.keys(ROLES[kind])).filter((r) => ROLES[kind][r]);
  if (!roleIds.includes(design.role)) design.role = roleIds[0];
  const sfx = o.sfx || (() => {});
  const undoStack = [],
    redoStack = [];
  let selected = -1;
  let tab = "parts";
  let category = catalog[0].cat;
  let colorSlot = "base";

  /* ---- scene ---------------------------------------------------------------- */
  const scene = new THREE.Scene();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  scene.background = new THREE.Color(kind === "ship" ? 0x0b1026 : 0xbfe2ee);
  scene.add(new THREE.HemisphereLight(0xffffff, kind === "ship" ? 0x223355 : 0x6a7f5a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  if (kind === "ship") {
    // A field of stars around the hangar.
    const pts = [];
    for (let i = 0; i < 500; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20);
      pts.push(v.x, v.y, v.z);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(g, keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 }))));
    const pad = new THREE.Mesh(keep(new THREE.RingGeometry(2.6, 2.75, 48)), keep(new THREE.MeshBasicMaterial({ color: 0x3fa9d6, transparent: true, opacity: 0.5, side: THREE.DoubleSide })));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = -1.6;
    scene.add(pad);
  } else {
    // A plot of ground with a measuring ring, so you can judge size.
    const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(18, 48)), keep(new THREE.MeshStandardMaterial({ color: kind === "building" ? 0x7fae5c : 0x8f9a7a, roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(LIMIT[kind].xz, LIMIT[kind].xz + 0.08, 64)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
    scene.fog = new THREE.Fog(0xbfe2ee, 22, 40);
  }
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
  const orbit = { yaw: 0.7, pitch: 0.38, dist: 11 };
  const centre = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const selMat = keep(new THREE.LineBasicMaterial({ color: 0xffc23a, depthTest: false }));
  let model = null;
  let selBoxes = [];

  /* ---- DOM -------------------------------------------------------------------- */
  const root = document.createElement("div");
  root.className = "crEditor mdEditor md-" + kind;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", KIND_NAMES[kind] + " editor");
  root.innerHTML = `
    <div class="ceTop">
      <input id="mdName" maxlength="32" aria-label="${KIND_NAMES[kind]} name" autocomplete="off" spellcheck="false">
      <span class="ceDna" id="mdCost" aria-live="polite"></span>
      <div class="ceTopBtns">
        <button id="mdUndo" aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button id="mdRedo" aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
        <button id="mdCancel">Cancel</button>
        <button id="mdDone" class="primary">Save</button>
      </div>
    </div>
    <p class="ceHint" id="mdHint" aria-live="polite"></p>
    <aside class="mdStats" id="mdStats" aria-label="What this design does"></aside>
    <div class="mdTools" id="mdTools" role="toolbar" aria-label="Selected part" hidden></div>
    <section class="cePanel" aria-label="Editor tools">
      <nav class="ceTabs" role="tablist">
        <button role="tab" data-tab="parts" aria-selected="true">Parts <small class="ceBudget" id="mdBudget"></small></button>
        <button role="tab" data-tab="style" aria-selected="false">${kind === "vehicle" ? "Type &amp; paint" : "Role &amp; paint"}</button>
      </nav>
      <div class="ceTab" data-pane="parts"></div>
      <div class="ceTab" data-pane="style" hidden></div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const nameInput = $("#mdName");
  nameInput.value = design.name;
  nameInput.oninput = () => {
    design.name = nameInput.value.replace(/[<>"`\\]/g, "").slice(0, 32);
  };
  const hint = (t) => ($("#mdHint").textContent = t);
  hint("Tap a part below to add it. Tap a part on the model to select it, then drag it or use the tools.");

  /* ---- history ---------------------------------------------------------------- */
  const snapshot = () => JSON.stringify({ design, selected });
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    const s = JSON.parse(from.pop());
    design = s.design;
    selected = s.selected < design.parts.length ? s.selected : -1;
    nameInput.value = design.name;
    refresh();
  }
  $("#mdUndo").onclick = () => restore(undoStack, redoStack);
  $("#mdRedo").onclick = () => restore(redoStack, undoStack);

  /* ---- model ------------------------------------------------------------------ */
  function rebuild() {
    model?.dispose();
    selBoxes.forEach((b) => (b.removeFromParent(), b.geometry.dispose()));
    selBoxes = [];
    model = buildDesignMesh(design);
    scene.add(model.root);
    const sel = model.parts.find((p) => p.index === selected);
    if (sel) {
      for (const m of [sel.mesh, sel.mirror].filter(Boolean)) {
        const b = new THREE.BoxHelper(m, 0xffc23a);
        b.material.dispose();
        b.material = selMat;
        b.renderOrder = 20;
        scene.add(b);
        selBoxes.push(b);
      }
    }
    const box = new THREE.Box3().setFromObject(model.root);
    if (!box.isEmpty()) {
      box.getCenter(centre);
      const size = box.getSize(new THREE.Vector3());
      orbit.fit = Math.max(7, Math.max(size.x, size.y, size.z) * 3);
    }
  }
  const usedCount = () => design.parts.length;
  function stats() {
    return designStats(design);
  }
  function renderStats() {
    const s = stats();
    const bars = (v) => Array.from({ length: 10 }, (_, i) => `<b class="${i < Math.round(v) ? "on" : ""}"></b>`).join("");
    const label = (k) => {
      const extra = k === "strength" ? STAT_HELP.strength[design.role] : k === "power" ? STAT_HELP.power[design.role] : null;
      return extra || STAT_NAMES[k] || k;
    };
    const role = ROLES[kind][design.role];
    $("#mdStats").innerHTML = `<h3>${role.icon} ${esc(role.name)}</h3>
      ${s.mode ? `<p class="mdMode">${MODE_NAMES[s.mode]}${s.cls ? ` · ${VEHICLE_CLASSES[s.cls].icon} ${esc(VEHICLE_CLASSES[s.cls].name)}` : ""}</p>` : ""}
      ${s.cls ? `<p class="mdClass">Good: ${esc(VEHICLE_CLASSES[s.cls].good)}. Weak: ${esc(VEHICLE_CLASSES[s.cls].weak)}.</p>` : ""}
      ${Object.entries(s.stats)
        .map(([k, v]) => `<div class="ceStat" title="${v} of 10"><span>${esc(label(k))}</span><i aria-label="${v} of 10">${bars(v)}</i></div>`)
        .join("")}
      ${s.problems.length ? `<ul class="mdProblems">${s.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="mdReady">✓ Ready to use</p>`}`;
    $("#mdCost").innerHTML = kind === "ship" ? "" : `§ <b>${s.cost}</b> <small>each</small>`;
    $("#mdDone").disabled = !s.ok;
    $("#mdDone").title = s.ok ? "Save this design" : s.problems[0];
    const budget = $("#mdBudget");
    budget.textContent = `${usedCount()}/${MAX_PARTS[kind]}`;
    budget.classList.toggle("full", usedCount() >= MAX_PARTS[kind]);
    $("#mdUndo").disabled = !undoStack.length;
    $("#mdRedo").disabled = !redoStack.length;
  }

  /* ---- palette ---------------------------------------------------------------- */
  const thumbs = new Map();
  function bakeThumbs() {
    const r = o.renderer;
    const size = 96;
    const target = new THREE.WebGLRenderTarget(size, size);
    const tScene = new THREE.Scene();
    tScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const l = new THREE.DirectionalLight(0xffffff, 1.6);
    l.position.set(2, 3, 4);
    tScene.add(l);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    const pixels = new Uint8Array(size * size * 4);
    const img = ctx.createImageData(size, size);
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()),
      prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    try {
      for (const def of catalog) {
        const one = buildDesignMesh({ kind, colors: design.colors, parts: [{ id: def.id, x: 0, y: 0, z: 0, s: 1 }] });
        const box = new THREE.Box3().setFromObject(one.root);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        one.root.position.copy(sphere.center).negate();
        const g = new THREE.Group();
        g.add(one.root);
        g.rotation.set(0.4, -0.6, 0);
        tScene.add(g);
        cam.position.set(0, 0, sphere.radius * 4 + 0.01);
        cam.lookAt(0, 0, 0);
        r.setRenderTarget(target);
        r.clear();
        r.render(tScene, cam);
        r.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.putImageData(img, 0, 0);
        thumbs.set(def.id, cv.toDataURL());
        tScene.remove(g);
        one.dispose();
      }
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      target.dispose();
    }
  }
  const categories = [...new Set(catalog.map((p) => p.cat))];
  const statLine = (def) =>
    Object.entries(def.add)
      .filter(([k]) => !["mass", "volume", "style"].includes(k))
      .map(([k, v]) => `+${v} ${k}`)
      .join(" · ");
  function renderPartsTab() {
    const pane = root.querySelector("[data-pane=parts]");
    const full = usedCount() >= MAX_PARTS[kind];
    pane.innerHTML = `
      <div class="ceChips" role="tablist" aria-label="Part types">${categories.map((c) => `<button role="tab" data-cat="${esc(c)}" aria-selected="${c === category}">${esc(c)}</button>`).join("")}</div>
      <div class="ceCards">${catalog
        .filter((p) => p.cat === category)
        .map(
          (p) => `<button class="cePart" data-part="${p.id}" ${full ? "disabled" : ""} aria-label="Add ${esc(p.name)}">
            <span class="thumb">${thumbs.has(p.id) ? `<img src="${thumbs.get(p.id)}" alt="">` : "◆"}</span>
            <b>${esc(p.name)}</b><small>${esc(statLine(p) || "Looks")}</small></button>`,
        )
        .join("")}</div>
      ${full ? `<p class="mdNote">That's the most parts a design can have. Delete one to add another.</p>` : ""}`;
    pane.querySelectorAll("[data-cat]").forEach(
      (b) =>
        (b.onclick = () => {
          category = b.dataset.cat;
          renderPartsTab();
        }),
    );
    pane.querySelectorAll("[data-part]").forEach((b) => (b.onclick = () => addPart(b.dataset.part)));
  }
  function renderStyleTab() {
    const pane = root.querySelector("[data-pane=style]");
    const templates = (o.templates || []).filter((t) => !design.category || t.mode === design.category);
    const typeGroup =
      kind === "vehicle"
        ? `<div class="ceGroup"><h4>CATEGORY</h4>
        <div class="ceRow mdRoles" role="radiogroup" aria-label="Category">${Object.entries(CATEGORIES)
          .map(([m, name]) => `<button role="radio" data-category="${m}" aria-checked="${m === design.category}">${MODE_NAMES[m] || name}</button>`)
          .join("")}</div>
        ${templates.length ? `<h4>START FROM</h4><div class="ceRow mdRoles mdTemplates">${templates.map((t) => `<button data-template="${o.templates.indexOf(t)}" title="Replace the parts with a ready-made ${esc(t.name.toLowerCase())}">${t.icon} ${esc(t.name)}</button>`).join("")}</div><p class="mdNote">Starting from a template replaces the parts (Undo brings them back).</p>` : ""}</div>`
        : "";
    pane.innerHTML = `${typeGroup}
      <div class="ceGroup"${roleIds.length < 2 ? " hidden" : ""}><h4>ROLE</h4>
        <div class="ceRow mdRoles" role="radiogroup" aria-label="Role">${roleIds
          .map((r) => {
            const def = ROLES[kind][r];
            return `<button role="radio" data-role="${r}" aria-checked="${r === design.role}" title="${esc(def.desc)}">${def.icon} ${esc(def.name)}</button>`;
          })
          .join("")}</div>
        <p class="mdNote">${esc(ROLES[kind][design.role].desc)}</p></div>
      <div class="ceGroup"><h4>COLOURS</h4>
        <div class="ceRow mdSlots" role="radiogroup" aria-label="Colour to change">${["base", "accent", "trim"]
          .map((k) => `<button role="radio" data-slot="${k}" aria-checked="${k === colorSlot}"><i style="background:${hex(design.colors[k])}"></i>${k[0].toUpperCase() + k.slice(1)}</button>`)
          .join("")}</div>
        <div class="ceSwatches" role="radiogroup" aria-label="${colorSlot} colour">${SWATCHES.map((c) => `<button role="radio" style="--c:${hex(c)}" data-c="${c}" aria-checked="${c === design.colors[colorSlot]}" aria-label="Colour ${hex(c)}"></button>`).join("")}
          <label class="ceCustom" title="Any colour"><input type="color" value="${hex(design.colors[colorSlot])}" aria-label="Pick any colour"></label></div></div>`;
    pane.querySelectorAll("[data-role]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.role === design.role) return;
          pushUndo();
          design.role = b.dataset.role;
          sfx("click");
          refresh();
        }),
    );
    pane.querySelectorAll("[data-category]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.category === design.category) return;
          pushUndo();
          design.category = b.dataset.category;
          sfx("click");
          hint(`A ${CATEGORIES[design.category].toLowerCase()} vehicle: ${design.category === "land" ? "wheels or treads" : design.category === "sea" ? "a hull with propellers, sails or pontoons" : "wings, jets or rotors"} must outnumber its other ways of moving.`);
          refresh();
        }),
    );
    pane.querySelectorAll("[data-template]").forEach(
      (b) =>
        (b.onclick = () => {
          const t = o.templates[Number(b.dataset.template)];
          if (!t) return;
          pushUndo();
          design.parts = JSON.parse(JSON.stringify(t.design.parts));
          design.category = t.mode;
          // A name nobody chose yet follows the template.
          if (/^New /.test(design.name)) nameInput.value = design.name = t.design.name;
          selected = -1;
          sfx("click");
          hint(`Started from a ${t.name.toLowerCase()}. Change anything you like.`);
          refresh();
        }),
    );
    pane.querySelectorAll("[data-slot]").forEach(
      (b) =>
        (b.onclick = () => {
          colorSlot = b.dataset.slot;
          renderStyleTab();
        }),
    );
    const paint = (c) => {
      pushUndo();
      design.colors[colorSlot] = c;
      model.setColors(design.colors);
      renderStyleTab();
      renderStats();
    };
    pane.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => paint(Number(b.dataset.c))));
    const picker = pane.querySelector("input[type=color]");
    picker.onchange = () => paint(parseInt(picker.value.slice(1), 16));
  }
  function setTab(name) {
    tab = name;
    root.querySelectorAll("[role=tab][data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    root.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "parts") renderPartsTab();
    else renderStyleTab();
  }
  root.querySelectorAll("[role=tab][data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  /* ---- editing -------------------------------------------------------------------- */
  const lim = LIMIT[kind];
  const floor = kind === "ship" ? -lim.y : 0;
  function clampPart(p) {
    p.x = round(THREE.MathUtils.clamp(p.x, -lim.xz, lim.xz));
    p.z = round(THREE.MathUtils.clamp(p.z, -lim.xz, lim.xz));
    p.y = round(THREE.MathUtils.clamp(p.y, floor, lim.y + (kind === "building" ? 0 : 1)));
  }
  /** Where a new part goes: on top of the selected part, beside it for wheels and the like, or on top of the design. */
  function spotFor(id) {
    const def = partOf(kind, id);
    const ext = partExtent(kind, id);
    const sel = design.parts[selected];
    if (sel) {
      const se = partExtent(kind, sel.id).multiplyScalar(sel.s || 1);
      // Wheels, treads, wings, propellers and engines go on the sides, mirrored.
      if (["Move", "Drive"].includes(def.cat) && def.id !== "sail") {
        const side = def.id === "propeller" || def.id === "jet" ? 0 : 1;
        return { x: side ? sel.x + se.x / 2 + ext.x / 2 : sel.x, y: def.id === "wheel" || def.id === "tread" ? Math.max(ext.y / 2, sel.y - se.y / 2 + ext.y * 0.15) : sel.y, z: side ? sel.z : sel.z - se.z / 2 - ext.z / 2, mirror: !!side };
      }
      return { x: sel.x, y: sel.y + se.y / 2 + ext.y / 2, z: sel.z, mirror: sel.mirror && Math.abs(sel.x) > 0.05 };
    }
    if (!design.parts.length) return { x: 0, y: kind === "ship" ? 0 : ext.y / 2, z: 0, mirror: false };
    const box = new THREE.Box3().setFromObject(model.root);
    return { x: 0, y: box.max.y + ext.y / 2, z: 0, mirror: false };
  }
  function addPart(id) {
    if (usedCount() >= MAX_PARTS[kind] || !partOf(kind, id)) return;
    pushUndo();
    const spot = spotFor(id);
    const p = { id, x: spot.x, y: spot.y, z: spot.z, ry: 0, s: 1, mirror: spot.mirror };
    clampPart(p);
    design.parts.push(p);
    selected = design.parts.length - 1;
    sfx("click");
    hint(`${partOf(kind, id).name} added. Drag it on the model, or use the tools to move it.`);
    refresh();
  }
  function edit(fn) {
    const p = design.parts[selected];
    if (!p) return;
    pushUndo();
    fn(p);
    clampPart(p);
    p.s = round(THREE.MathUtils.clamp(p.s || 1, 0.5, 2));
    refresh();
  }
  /** Move along the screen's left/right and toward/away from you, whichever world axis is closest. */
  function nudge(right, fwd) {
    const yaw = orbit.yaw;
    // Camera right and forward vectors on the ground plane.
    const rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw);
    const dx = right * rx + fwd * fx,
      dz = right * rz + fwd * fz;
    // Snap to the nearest axis so parts stay lined up.
    edit((p) => {
      if (Math.abs(dx) >= Math.abs(dz)) p.x += Math.sign(dx) * STEP;
      else p.z += Math.sign(dz) * STEP;
    });
  }
  function removeSelected() {
    if (!design.parts[selected]) return;
    pushUndo();
    design.parts.splice(selected, 1);
    selected = -1;
    sfx("click");
    refresh();
  }
  function duplicateSelected() {
    const p = design.parts[selected];
    if (!p || usedCount() >= MAX_PARTS[kind]) return;
    pushUndo();
    const ext = partExtent(kind, p.id).multiplyScalar(p.s || 1);
    const copy = { ...p, y: p.y + ext.y };
    clampPart(copy);
    design.parts.push(copy);
    selected = design.parts.length - 1;
    refresh();
  }
  function renderTools() {
    const bar = $("#mdTools");
    const p = design.parts[selected];
    bar.hidden = !p;
    if (!p) return;
    const def = partOf(kind, p.id);
    const full = usedCount() >= MAX_PARTS[kind];
    bar.innerHTML = `
      <b class="mdSel">${esc(def.name)}</b>
      <div class="mdPad">
        <button data-t="left" aria-label="Move left">◀</button>
        <button data-t="right" aria-label="Move right">▶</button>
        <button data-t="fwd" aria-label="Move away">⬆</button>
        <button data-t="back" aria-label="Move closer">⬇</button>
        <button data-t="up" aria-label="Raise">⤒</button>
        <button data-t="down" aria-label="Lower">⤓</button>
      </div>
      <div class="mdPad">
        <button data-t="ccw" aria-label="Turn left">⟲</button>
        <button data-t="cw" aria-label="Turn right">⟳</button>
        <button data-t="smaller" aria-label="Smaller" ${p.s <= 0.5 ? "disabled" : ""}>−</button>
        <button data-t="bigger" aria-label="Bigger" ${p.s >= 2 ? "disabled" : ""}>+</button>
        <button data-t="mirror" aria-pressed="${p.mirror}" aria-label="Mirror left and right">⇋</button>
        <button data-t="copy" aria-label="Copy" ${full ? "disabled" : ""}>⧉</button>
        <button data-t="delete" class="danger" aria-label="Delete">🗑</button>
      </div>`;
    const act = {
      left: () => nudge(-1, 0),
      right: () => nudge(1, 0),
      fwd: () => nudge(0, 1),
      back: () => nudge(0, -1),
      up: () => edit((q) => (q.y += STEP)),
      down: () => edit((q) => (q.y -= STEP)),
      ccw: () => edit((q) => (q.ry = round((q.ry || 0) + TURN))),
      cw: () => edit((q) => (q.ry = round((q.ry || 0) - TURN))),
      smaller: () => edit((q) => (q.s = (q.s || 1) - 0.1)),
      bigger: () => edit((q) => (q.s = (q.s || 1) + 0.1)),
      mirror: () => edit((q) => (q.mirror = !q.mirror)),
      copy: duplicateSelected,
      delete: removeSelected,
    };
    bar.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => act[b.dataset.t]()));
  }
  function refresh() {
    if (selected >= design.parts.length) selected = -1;
    rebuild();
    renderStats();
    renderTools();
    if (tab === "parts") renderPartsTab();
    else renderStyleTab();
    fitCamera();
  }

  /* ---- pointer: select, drag, orbit, zoom ------------------------------------------- */
  const canvas = o.renderer.domElement;
  const pointers = new Map();
  let gesture = null;
  function rayAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }
  function partAt(x, y) {
    if (!model) return null;
    const hit = rayAt(x, y).intersectObjects(model.root.children, false)[0];
    if (!hit) return null;
    return { index: hit.object.userData.partIndex, mirrored: model.parts.find((p) => p.index === hit.object.userData.partIndex)?.mirror === hit.object, point: hit.point };
  }
  const plane = new THREE.Plane();
  const tmp = new THREE.Vector3();
  function onDown(e) {
    if (closed) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), dist: orbit.dist };
      return;
    }
    const hit = partAt(e.clientX, e.clientY);
    if (hit && hit.index === selected) {
      const p = design.parts[selected];
      plane.set(new THREE.Vector3(0, 1, 0), -hit.point.y);
      const sign = hit.mirrored ? -1 : 1;
      gesture = { type: "drag", start: snapshot(), sign, offX: p.x * sign - hit.point.x, offZ: p.z - hit.point.z, moved: false, x: e.clientX, y: e.clientY };
    } else gesture = { type: "orbit", x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, hit };
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      orbit.zoomed = true;
      orbit.dist = THREE.MathUtils.clamp((gesture.dist * gesture.d) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 3, 40);
    } else if (gesture.type === "drag") {
      if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 6) return;
      if (!rayAt(e.clientX, e.clientY).ray.intersectPlane(plane, tmp)) return;
      const p = design.parts[selected];
      if (!gesture.moved) {
        undoStack.push(gesture.start);
        redoStack.length = 0;
        gesture.moved = true;
      }
      p.x = Math.round(((tmp.x + gesture.offX) * gesture.sign) / 0.05) * 0.05;
      p.z = Math.round((tmp.z + gesture.offZ) / 0.05) * 0.05;
      clampPart(p);
      // Cheap live update: move the meshes, rebuild on release.
      const parts = model.parts.find((q) => q.index === selected);
      parts.mesh.position.set(p.x, p.y, p.z);
      parts.mirror?.position.set(-p.x, p.y, p.z);
      selBoxes.forEach((b) => b.update());
    } else if (gesture.type === "orbit") {
      const dx = e.clientX - gesture.x,
        dy = e.clientY - gesture.y;
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 6) gesture.moved = true;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, kind === "ship" ? -1.2 : 0.05, 1.35);
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === "drag" && gesture.moved) refresh();
    else if (gesture.type === "orbit" && !gesture.moved) {
      // A tap: select the part under the finger, or clear the selection.
      selected = gesture.hit ? gesture.hit.index : -1;
      if (gesture.hit) hint(`${partOf(kind, design.parts[selected].id).name}: drag it, or use the tools.`);
      refresh();
    }
    gesture = pointers.size ? gesture : null;
    if (gesture?.type === "pinch" && pointers.size < 2) gesture = null;
  }
  function onWheel(e) {
    e.preventDefault();
    orbit.zoomed = true;
    orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 40);
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    if (e.target?.tagName === "INPUT") return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) restore(redoStack, undoStack);
      else restore(undoStack, redoStack);
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "y") {
      e.preventDefault();
      restore(redoStack, undoStack);
    } else if (selected >= 0 && (k === "Delete" || k === "Backspace")) removeSelected();
    else if (selected >= 0 && k.startsWith("Arrow")) {
      e.preventDefault();
      if (e.shiftKey && k === "ArrowUp") edit((p) => (p.y += STEP));
      else if (e.shiftKey && k === "ArrowDown") edit((p) => (p.y -= STEP));
      else nudge(k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0, k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0);
    } else if (k === "Escape" && selected >= 0) {
      selected = -1;
      refresh();
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---- finish -------------------------------------------------------------------------- */
  let closed = false;
  function close() {
    closed = true;
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
    camera.clearViewOffset();
    model?.dispose();
    selBoxes.forEach((b) => b.geometry.dispose());
    disposables.forEach((d) => d.dispose());
    root.remove();
  }
  $("#mdDone").onclick = () => {
    const s = stats();
    if (!s.ok) return;
    design.name = (nameInput.value.trim() || ROLES[kind][design.role].name).replace(/[<>"`\\]/g, "").slice(0, 32);
    const result = validateModular(design, kind);
    sfx("hatch");
    close();
    o.onDone(result, designStats(result));
  };
  $("#mdCancel").onclick = () => {
    close();
    o.onCancel();
  };

  /** Keep the model centred in the space between the top bar and the tool panel. */
  function fitCamera() {
    const panel = root.querySelector(".cePanel")?.getBoundingClientRect().height || 0;
    const tools = $("#mdTools").hidden ? 0 : $("#mdTools").getBoundingClientRect().height + 8;
    const top = root.querySelector(".ceTop")?.getBoundingClientRect().height || 0;
    const statsBox = $("#mdStats");
    statsBox.style.top = top + 8 + "px";
    // On phones the stats sit under the top bar, and the hint under them.
    const narrow = innerWidth <= 760;
    const covered = narrow ? top + 8 + statsBox.getBoundingClientRect().height : top;
    $("#mdHint").style.top = (narrow ? covered + 8 : top + 8) + "px";
    $("#mdTools").style.bottom = panel + 8 + "px";
    camera.aspect = innerWidth / innerHeight;
    camera.setViewOffset(innerWidth, innerHeight, 0, (panel + tools - covered) / 2, innerWidth, innerHeight);
    camera.updateProjectionMatrix();
  }

  try {
    bakeThumbs();
  } catch {
    /* thumbnails are decoration; the cards still name each part */
  }
  rebuild();
  orbit.dist = orbit.fit || 11;
  refresh();
  setTab("parts");
  if (!matchMedia("(pointer: coarse)").matches) nameInput.focus({ preventScroll: true });

  return {
    get closed() {
      return closed;
    },
    get design() {
      return design;
    },
    update(dt) {
      if (closed) return;
      // Settle the zoom to frame the design as it grows, unless the player has zoomed themselves.
      if (!orbit.zoomed && orbit.fit) orbit.dist += (orbit.fit - orbit.dist) * Math.min(1, dt * 4);
      const dist = orbit.dist * Math.max(1, 0.75 / Math.max(0.3, camera.aspect));
      camera.position.set(centre.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist, centre.y + Math.sin(orbit.pitch) * dist, centre.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist);
      camera.lookAt(centre);
      if (kind === "ship" && model && !gesture) model.root.position.y = Math.sin(performance.now() / 900) * 0.05;
    },
    render() {
      if (!closed) o.renderer.render(scene, camera);
    },
    resize: fitCamera,
    debug: {
      addPart,
      setTab,
      stats,
      select(i) {
        selected = i;
        refresh();
      },
      edit,
      nudge,
      /** Screen position of part i's centre, for tests. */
      partScreen(i) {
        const p = model.parts.find((q) => q.index === i);
        if (!p) return null;
        const v = p.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      get selected() {
        return selected;
      },
      get undo() {
        return undoStack.length;
      },
    },
  };
}
