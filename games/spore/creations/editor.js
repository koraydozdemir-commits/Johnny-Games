/**
 * The construction workshop: buildings and vehicles (Civilization Stage) and spaceships (Space Stage).
 *
 * Build: drag a part from the catalogue onto the model (it lands where you drop it, stacked on what
 * is under it) or tap it to add it on top of the selection. Drag a part on the model to slide it;
 * dropped over another part it stacks on top. Snapping keeps things lined up and can be switched off
 * for free placement. The selected part's toolbar moves it up and down, turns, resizes, mirrors,
 * copies or deletes it; double-tap it for exact numbers. The Type tab picks the role, the category
 * and a template.
 * Paint: the design's three colours with the full picker, and a paint for any single part.
 * Test: watch it drive, sail or fly (vehicles), turn in the sun (buildings) or hover (spaceships).
 * The stats panel shows what the design does in play, from the game's own numbers (modular.js).
 *
 * Shares the creature creator's design system, gestures, undo history, drafts and tips. Opens over
 * the game using the game's renderer; the caller drives update() and render() each frame.
 */
import * as THREE from "three";
import { PART_PAINTS, validateModular } from "./format.js";
import { buildDesignMesh, partExtent } from "./mesh.js";
import { CATALOGS, CATEGORIES, MAX_PARTS, ROLES, VEHICLE_CLASSES, designStats, partOf } from "./modular.js";
import { ICONS } from "../creature/editor-icons.js";
import { createHistory } from "../editor/history.js";
import { createDrafts } from "../editor/drafts.js";
import { attachGestures } from "../editor/gestures.js";
import { createColorPicker } from "../editor/picker.js";
import { recentList } from "../editor/color.js";
import { browse } from "../editor/catalogue.js";
import { confirmBox, easeOrbit, guardPageGestures, makeDrawer, phoneLayout, pulse, reducedMotion, saveBadge, showTips, trackViewport } from "../editor/chrome.js";

const SWATCHES = [0xf2f2f2, 0xe8dcc0, 0xd6a03f, 0xf2c84b, 0xc9483c, 0xd94f8a, 0x8a5fd0, 0x4a74e0, 0x3fa9d6, 0x3fc2a0, 0x6b7a4a, 0x8a8f96, 0x6b5a48, 0x3a3f45, 0x1d2228];
const KIND_NAMES = { building: "Building", vehicle: "Vehicle", ship: "Spaceship" };
const STAT_NAMES = { prestige: "Prestige", strength: "Strength", speed: "Speed", power: "Power", health: "Health", attack: "Attack", energy: "Energy", range: "Range", sensors: "Sensors", cargo: "Cargo" };
const STAT_HELP = {
  strength: { hall: "City style", house: "Population", factory: "Income", fun: "Happiness", temple: "Faith", turret: "Defence" },
  power: { military: "Attack", economic: "Trade", religious: "Preaching" },
};
const MODE_NAMES = { land: "🚙 Land", sea: "🚤 Sea", air: "✈ Air" };
const PAINT_NAMES = { base: "Base", accent: "Accent", trim: "Trim", glass: "Glass", metal: "Metal" };
const STEP = 0.25;
const TURN = Math.PI / 12;
const LIMIT = { building: { xz: 5, y: 9 }, vehicle: { xz: 3.5, y: 4 }, ship: { xz: 4, y: 3 } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");
const round = (v) => Math.round(v * 100) / 100;
const storage = () => {
  try {
    return localStorage;
  } catch (e) {
    return null;
  }
};

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
  const original = JSON.parse(JSON.stringify(design));
  const sfx = o.sfx || (() => {});
  let selected = -1;
  let mode = "build";
  let tab = "parts";
  let category = catalog[0].cat;
  let colorSlot = "base";
  let query = "";
  let snap = true;
  const recentParts = recentList(storage(), "johnny-spore-recent-parts:" + kind, 10);
  const recentColours = recentList(storage(), "johnny-spore-recent-colours", 10);

  /* ---- scene ---------------------------------------------------------------- */
  const scene = new THREE.Scene();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  scene.background = new THREE.Color(kind === "ship" ? 0x0b1026 : 0xbfe2ee);
  const hemi = new THREE.HemisphereLight(0xffffff, kind === "ship" ? 0x223355 : 0x6a7f5a, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  let water = null;
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
    if (kind === "vehicle") {
      // A pond beside the plot for sea vehicles' test run (hidden until then).
      water = new THREE.Mesh(keep(new THREE.CircleGeometry(9, 48)), keep(new THREE.MeshStandardMaterial({ color: 0x3f8fc0, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 })));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.03;
      water.visible = false;
      scene.add(water);
    }
  }
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
  const orbit = { yaw: 0.7, pitch: 0.38, dist: 11, pan: new THREE.Vector3() };
  let orbitGoal = null;
  const centre = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const selMat = keep(new THREE.LineBasicMaterial({ color: 0xffc23a, depthTest: false, transparent: true, opacity: 0.85 }));
  let model = null;
  let selBoxes = [];

  /* ---- DOM -------------------------------------------------------------------- */
  const root = document.createElement("div");
  root.className = "crEditor mdEditor edRoot mode-build md-kind-" + kind;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", KIND_NAMES[kind] + " creator");
  const modeButton = (m, label, icon) => `<button role="tab" data-mode="${m}" aria-selected="${m === "build"}">${icon}<span>${label}</span></button>`;
  root.innerHTML = `
    <div class="ceTop edTop">
      <button id="mdCancel" class="edBack" aria-label="Cancel and leave the editor" title="Cancel">${ICONS.back}<span>Cancel</span></button>
      <input id="mdName" maxlength="32" aria-label="${KIND_NAMES[kind]} name" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <div class="edStatus"><span class="ceDna" id="mdCost" aria-live="polite"></span><span class="edSaveState" id="mdSave" aria-live="polite"></span></div>
      <div class="ceTopBtns">
        <button id="mdUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
        <button id="mdRedo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${ICONS.redo}</button>
        <button id="mdMore" class="edMoreTop" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${ICONS.more}</button>
        <button id="mdDone" class="primary">Save</button>
      </div>
    </div>
    <nav class="edModes" role="tablist" aria-label="Editor mode">
      ${modeButton("build", "Build", ICONS.build)}${modeButton("paint", "Paint", ICONS.paint)}${modeButton("test", "Test", ICONS.test)}
      <button class="edNavOnly" id="mdParts" aria-label="Show or hide the parts drawer" aria-expanded="true">${ICONS.parts}<span>Parts</span></button>
      <button class="edNavOnly" id="mdMoreNav" aria-label="More options" aria-haspopup="menu">${ICONS.more}<span>More</span></button>
    </nav>
    <p class="ceHint" id="mdHint" aria-live="polite"></p>
    <aside class="mdStats" id="mdStats" aria-label="What this design does"></aside>
    <div class="edViewTools" role="toolbar" aria-label="View">
      <button id="mdSnap" aria-pressed="true" title="Snapping: parts line up on a grid and stack on each other">${ICONS.parts}<span>Snap</span><b class="edOnOff"></b></button>
      <button id="mdViews" aria-haspopup="menu" aria-expanded="false" aria-label="Camera views" title="Camera views">${ICONS.camera}</button>
    </div>
    <div class="edPop edViewMenu" id="mdViewMenu" role="menu" hidden>
      <button role="menuitem" data-view="front">Front</button><button role="menuitem" data-view="side">Side</button><button role="menuitem" data-view="rear">Rear</button><button role="menuitem" data-view="top">Above</button><button role="menuitem" data-view="focus">Focus selected</button><button role="menuitem" data-view="reset">Reset view</button>
    </div>
    <div class="edPop edMenu" id="mdMenu" role="menu" hidden>
      <button role="menuitem" data-menu="tips">${ICONS.help}Show tips</button>
      <button role="menuitem" data-menu="views">${ICONS.camera}Reset camera</button>
      <button role="menuitem" data-menu="reset" class="danger">${ICONS.reset}Start over from the saved design…</button>
    </div>
    <div class="mdTools edTools" id="mdTools" role="toolbar" aria-label="Selected part" hidden></div>
    <div class="edRecover" id="mdRecover" hidden></div>
    <div class="ceTestBar" id="mdTestBar" hidden></div>
    <section class="cePanel" aria-label="Editor tools">
      <nav class="ceTabs" role="tablist">
        <button role="tab" data-tab="parts" aria-selected="true">Parts <small class="ceBudget" id="mdBudget"></small></button>
        <button role="tab" data-tab="style" aria-selected="false">${kind === "vehicle" ? "Type" : "Role"}</button>
      </nav>
      <div class="ceTab" data-pane="parts"></div>
      <div class="ceTab" data-pane="style" hidden></div>
      <div class="ceTab" data-pane="paint" hidden></div>
    </section>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const nameInput = $("#mdName");
  nameInput.value = design.name;
  nameInput.onfocus = () => history.begin("name");
  nameInput.oninput = () => {
    design.name = nameInput.value.replace(/[<>"`\\]/g, "").slice(0, 32);
  };
  nameInput.onblur = () => history.end();
  nameInput.onkeydown = (e) => e.key === "Enter" && nameInput.blur();
  let hintTimer = null;
  const hint = (t, ms = 4200) => {
    const el = $("#mdHint");
    el.textContent = t;
    el.classList.toggle("on", !!t);
    clearTimeout(hintTimer);
    if (t) hintTimer = setTimeout(() => el.classList.remove("on"), ms);
  };
  const badge = saveBadge($("#mdSave"));

  /* ---- history and drafts ---------------------------------------------------------- */
  const drafts = createDrafts({ kind: "design-" + kind, base: original });
  const history = createHistory({
    take: () => JSON.stringify({ design, selected }),
    put: (s) => {
      const v = JSON.parse(s);
      design = v.design;
      selected = v.selected < design.parts.length ? v.selected : -1;
      nameInput.value = design.name;
      refresh();
    },
    // Selecting a part isn't a change: only the design counts.
    same: (a, b) => JSON.stringify(JSON.parse(a).design) === JSON.stringify(JSON.parse(b).design),
    limit: 100,
    onChange: () => {
      drafts.touch(design);
      renderStats();
    },
  });
  const isDirty = () => JSON.stringify(design) !== JSON.stringify(original);
  const pushUndo = (label) => history.record(label);

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
      // Frame the whole design (and a little ground around it), whatever its size.
      orbit.radius = Math.max(2.2, box.getBoundingSphere(new THREE.Sphere()).radius);
      orbit.fit = orbit.radius * 3;
    }
  }
  const usedCount = () => design.parts.length;
  const stats = () => designStats(design);
  function renderStats() {
    const s = stats();
    const bars = (v) => Array.from({ length: 10 }, (_, i) => `<b class="${i < Math.round(v) ? "on" : ""}"></b>`).join("");
    const label = (k) => {
      const extra = k === "strength" ? STAT_HELP.strength[design.role] : k === "power" ? STAT_HELP.power[design.role] : null;
      return extra || STAT_NAMES[k] || k;
    };
    const role = ROLES[kind][design.role];
    $("#mdStats").innerHTML = `<button class="edStatsToggle" id="mdStatsToggle" aria-expanded="${root.classList.contains("statsOpen")}" aria-label="Show all statistics">${ICONS.stats}</button><h3>${role.icon} ${esc(role.name)}</h3>
      ${s.mode ? `<p class="mdMode">${MODE_NAMES[s.mode]}${s.cls ? ` · ${VEHICLE_CLASSES[s.cls].icon} ${esc(VEHICLE_CLASSES[s.cls].name)}` : ""}</p>` : ""}
      ${s.cls ? `<p class="mdClass">Good: ${esc(VEHICLE_CLASSES[s.cls].good)}. Weak: ${esc(VEHICLE_CLASSES[s.cls].weak)}.</p>` : ""}
      ${Object.entries(s.stats)
        .map(([k, v]) => `<div class="ceStat" title="${v} of 10"><span>${esc(label(k))}</span><i aria-label="${v} of 10">${bars(v)}</i></div>`)
        .join("")}
      ${s.problems.length ? `<ul class="mdProblems">${s.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="mdReady">✓ Ready to use</p>`}`;
    $("#mdStatsToggle").onclick = () => {
      root.classList.toggle("statsOpen");
      renderStats();
      fitCamera();
    };
    $("#mdCost").innerHTML = kind === "ship" ? "" : `§ <b>${s.cost}</b> <small>each</small>`;
    $("#mdDone").disabled = !s.ok;
    $("#mdDone").title = s.ok ? "Save this design" : s.problems[0];
    const budget = $("#mdBudget");
    budget.textContent = `${usedCount()}/${MAX_PARTS[kind]}`;
    budget.classList.toggle("full", usedCount() >= MAX_PARTS[kind]);
    $("#mdUndo").disabled = !history.canUndo;
    $("#mdRedo").disabled = !history.canRedo;
    badge.set(isDirty() ? (drafts.savedAt ? "draft" : "dirty") : "clean");
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
  const entries = () => catalog.map((d, i) => ({ id: d.id, name: d.name, section: d.cat, cost: 0, unlocked: true, abilities: d.add || {}, order: i }));
  function renderPartsTab() {
    const pane = root.querySelector("[data-pane=parts]");
    const full = usedCount() >= MAX_PARTS[kind];
    const list =
      category === "Recent" ? browse(entries(), { filter: "recent", recent: recentParts.items }) : query.trim() ? browse(entries(), { query, words: Object.fromEntries(categories.map((c) => [c, c])) }) : entries().filter((e) => e.section === category);
    const hadFocus = document.activeElement?.id === "mdSearch";
    pane.innerHTML = `
      <div class="edBrowse mdBrowse"><label class="edSearch">${ICONS.search}<input type="search" id="mdSearch" placeholder="Search parts" value="${esc(query)}" aria-label="Search parts" autocomplete="off" enterkeyhint="search">${query ? `<button id="mdSearchClear" aria-label="Clear search">${ICONS.close}</button>` : ""}</label></div>
      <div class="ceChips" role="tablist" aria-label="Part types">${["Recent", ...categories].map((c) => `<button role="tab" data-cat="${esc(c)}" aria-selected="${c === category && !query.trim()}">${esc(c)}</button>`).join("")}</div>
      <div class="ceCards">${list
        .map((e) => {
          const p = partOf(kind, e.id);
          return `<button class="cePart" data-part="${p.id}" ${full ? "disabled" : ""} aria-label="Add ${esc(p.name)}">
            <span class="thumb">${thumbs.has(p.id) ? `<img src="${thumbs.get(p.id)}" alt="" draggable="false">` : "◆"}</span>
            <b>${esc(p.name)}</b><small>${esc(statLine(p) || "Looks")}</small></button>`;
        })
        .join("")}${list.length ? "" : `<p class="edEmpty">${category === "Recent" && !query ? "Parts you add show up here." : "No parts match."}</p>`}</div>
      ${full ? `<p class="mdNote">That's the most parts a design can have. Delete one to add another.</p>` : ""}`;
    pane.querySelectorAll("[data-cat]").forEach(
      (b) =>
        (b.onclick = () => {
          category = b.dataset.cat;
          query = "";
          renderPartsTab();
        }),
    );
    const search = pane.querySelector("#mdSearch");
    search.oninput = () => {
      query = search.value;
      const caret = search.selectionStart;
      renderPartsTab();
      const s2 = root.querySelector("#mdSearch");
      s2.focus({ preventScroll: true });
      s2.setSelectionRange(caret, caret);
    };
    if (hadFocus) search.focus({ preventScroll: true });
    pane.querySelector("#mdSearchClear")?.addEventListener("click", () => {
      query = "";
      renderPartsTab();
    });
    pane.querySelectorAll("[data-part]").forEach((b) => wireCard(b));
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
      ${roleIds.length < 2 && kind !== "vehicle" ? `<p class="mdNote">This ${KIND_NAMES[kind].toLowerCase()} is a ${esc(ROLES[kind][design.role].name)}: ${esc(ROLES[kind][design.role].desc)}</p>` : ""}`;
    pane.querySelectorAll("[data-role]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.role === design.role) return;
          pushUndo("role");
          design.role = b.dataset.role;
          sfx("click");
          refresh();
        }),
    );
    pane.querySelectorAll("[data-category]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.category === design.category) return;
          pushUndo("category");
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
          pushUndo("template");
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
  }
  let picker = null;
  function renderPaintTab() {
    const pane = root.querySelector("[data-pane=paint]");
    const p = design.parts[selected];
    const def = p && partOf(kind, p.id);
    pane.innerHTML = `
      <div class="edLayers mdSlots" role="radiogroup" aria-label="Colour to change">${["base", "accent", "trim"]
        .map((k) => `<button role="radio" data-slot="${k}" aria-checked="${k === colorSlot}"><i style="background:${hex(design.colors[k])}"></i><b>${PAINT_NAMES[k]}</b></button>`)
        .join("")}</div>
      <div class="edPickerSlot"></div>
      <div class="ceGroup"><h4>${def ? "PAINT THE SELECTED PART" : "PAINT ONE PART"}</h4>
        ${
          def
            ? `<p class="mdNote">${esc(def.name)}${p.mirror ? " and its mirror twin" : ""} uses:</p><div class="ceRow mdPartPaint" role="radiogroup" aria-label="Paint for ${esc(def.name)}">
            <button role="radio" data-ppaint="" aria-checked="${!p.paint}">Its own (${PAINT_NAMES[def.paint]})</button>
            ${PART_PAINTS.filter((k) => k !== def.paint)
              .map((k) => `<button role="radio" data-ppaint="${k}" aria-checked="${p.paint === k}">${["base", "accent", "trim"].includes(k) ? `<i style="background:${hex(design.colors[k])}"></i>` : ""}${PAINT_NAMES[k]}</button>`)
              .join("")}</div>`
            : `<p class="mdNote">Tap a part on the model to give it a different paint.</p>`
        }</div>`;
    picker = createColorPicker({
      value: design.colors[colorSlot],
      label: PAINT_NAMES[colorSlot] + " colour",
      palette: SWATCHES,
      recent: recentColours,
      onStart: () => history.begin("paint"),
      onInput: (c) => {
        design.colors[colorSlot] = c;
        model.setColors(design.colors);
        const sw = pane.querySelector(`[data-slot="${colorSlot}"] i`);
        if (sw) sw.style.background = hex(c);
      },
      onCommit: () => history.end(),
    });
    pane.querySelector(".edPickerSlot").appendChild(picker.el);
    pane.querySelectorAll("[data-slot]").forEach(
      (b) =>
        (b.onclick = () => {
          colorSlot = b.dataset.slot;
          renderPaintTab();
        }),
    );
    pane.querySelectorAll("[data-ppaint]").forEach(
      (b) =>
        (b.onclick = () => {
          const q = design.parts[selected];
          if (!q) return;
          pushUndo("paint part");
          if (b.dataset.ppaint) q.paint = b.dataset.ppaint;
          else delete q.paint;
          rebuild();
          renderPaintTab();
          sfx("click");
        }),
    );
  }
  function setTab(name) {
    if (mode !== "build") setMode("build");
    tab = name;
    root.querySelectorAll("[role=tab][data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    root.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === "parts") renderPartsTab();
    else renderStyleTab();
  }
  root.querySelectorAll("[role=tab][data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  function refreshPanels() {
    if (mode === "paint") renderPaintTab();
    else if (tab === "parts") renderPartsTab();
    else renderStyleTab();
  }

  /* ---- modes ---------------------------------------------------------------------- */
  function setMode(m) {
    if (m === mode) return;
    const was = mode;
    mode = m;
    root.classList.remove("mode-build", "mode-paint", "mode-test");
    root.classList.add("mode-" + m);
    root.querySelectorAll(".edModes [data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    closePops();
    if (was === "test") stopTest();
    if (m === "paint") {
      root.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== "paint"));
      renderPaintTab();
      if (drawer?.state === "peek" && phoneLayout()) drawer.set("half");
      hint("Pick a colour to change, or tap a part to give it another paint.");
    } else if (m === "build") {
      root.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
      refreshPanels();
    } else startTest();
    renderTools();
    fitCamera();
    sfx("click");
  }
  root.querySelectorAll(".edModes [data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

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
  function addPart(id, at = null) {
    if (usedCount() >= MAX_PARTS[kind] || !partOf(kind, id)) return;
    pushUndo("add " + partOf(kind, id).name);
    const spot = at || spotFor(id);
    const p = { id, x: spot.x, y: spot.y, z: spot.z, ry: 0, s: 1, mirror: !!spot.mirror };
    clampPart(p);
    design.parts.push(p);
    selected = design.parts.length - 1;
    recentParts.add(id);
    pop = { index: selected, t: 0 };
    sfx("click");
    hint(`${partOf(kind, id).name} added. Drag it on the model, or use the tools to move it.`);
    refresh();
  }
  function edit(fn, label = "edit") {
    const p = design.parts[selected];
    if (!p) return;
    pushUndo(label);
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
    }, "move");
  }
  function removeSelected() {
    if (!design.parts[selected]) return;
    pushUndo("delete");
    design.parts.splice(selected, 1);
    selected = -1;
    sfx("click");
    refresh();
  }
  function duplicateSelected() {
    const p = design.parts[selected];
    if (!p || usedCount() >= MAX_PARTS[kind]) return;
    pushUndo("copy");
    const ext = partExtent(kind, p.id).multiplyScalar(p.s || 1);
    const copy = { ...p, y: p.y + ext.y };
    clampPart(copy);
    design.parts.push(copy);
    selected = design.parts.length - 1;
    pop = { index: selected, t: 0 };
    refresh();
  }
  function renderTools() {
    const bar = $("#mdTools");
    const p = mode === "build" ? design.parts[selected] : null;
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
        <button data-t="mirror" aria-pressed="${p.mirror}" aria-label="Mirror left and right">${ICONS.mirror}</button>
        <button data-t="copy" aria-label="Copy" ${full ? "disabled" : ""}>${ICONS.copy}</button>
        <button data-t="num" aria-label="Exact numbers">${ICONS.sliders}</button>
        <button data-t="delete" class="danger" aria-label="Delete">${ICONS.trash}</button>
      </div>`;
    const act = {
      left: () => nudge(-1, 0),
      right: () => nudge(1, 0),
      fwd: () => nudge(0, 1),
      back: () => nudge(0, -1),
      up: () => edit((q) => (q.y += STEP), "raise"),
      down: () => edit((q) => (q.y -= STEP), "lower"),
      ccw: () => edit((q) => (q.ry = round((q.ry || 0) + TURN)), "turn"),
      cw: () => edit((q) => (q.ry = round((q.ry || 0) - TURN)), "turn"),
      smaller: () => edit((q) => (q.s = (q.s || 1) - 0.1), "resize"),
      bigger: () => edit((q) => (q.s = (q.s || 1) + 0.1), "resize"),
      mirror: () => edit((q) => (q.mirror = !q.mirror), "mirror"),
      copy: duplicateSelected,
      num: openDetails,
      delete: removeSelected,
    };
    bar.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => act[b.dataset.t]()));
  }
  function refresh() {
    if (selected >= design.parts.length) selected = -1;
    rebuild();
    renderStats();
    renderTools();
    refreshPanels();
    fitCamera();
  }
  /** Exact numbers for the selected part. */
  function openDetails() {
    const p = design.parts[selected];
    if (!p) return;
    root.querySelector(".edDetails")?.remove();
    const def = partOf(kind, p.id);
    const box = document.createElement("div");
    box.className = "edDetails";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", def.name + " placement");
    const fields = [
      ["x", "Left / right", -lim.xz, lim.xz, 0.05, (v) => v, (v) => v, ""],
      ["y", "Height", floor, lim.y + 1, 0.05, (v) => v, (v) => v, ""],
      ["z", "Back / front", -lim.xz, lim.xz, 0.05, (v) => v, (v) => v, ""],
      ["ry", "Turn", -180, 180, 1, (v) => Math.round((v * 180) / Math.PI), (v) => (v * Math.PI) / 180, "°"],
      ["s", "Size", 50, 200, 1, (v) => Math.round(v * 100), (v) => v / 100, "%"],
    ];
    box.innerHTML = `<h4>${esc(def.name)}<button class="edX" aria-label="Close">${ICONS.close}</button></h4>${fields
      .map(([k, label, min, max, step, show, , unit]) => `<label class="edField"><span>${label}</span><input type="range" data-f="${k}" min="${min}" max="${max}" step="${step}" value="${show(p[k] ?? (k === "s" ? 1 : 0))}"><input type="number" data-n="${k}" min="${min}" max="${max}" step="${step}" value="${show(p[k] ?? (k === "s" ? 1 : 0))}" inputmode="decimal"><em>${unit}</em></label>`)
      .join("")}`;
    root.appendChild(box);
    const apply = (k, raw) => {
      const f = fields.find((x) => x[0] === k);
      const part = design.parts[selected];
      if (!part) return;
      const v = THREE.MathUtils.clamp(+raw, f[2], f[3]);
      part[k] = f[6](v);
      clampPart(part);
      box.querySelector(`[data-f="${k}"]`).value = v;
      box.querySelector(`[data-n="${k}"]`).value = v;
      rebuild();
      renderStats();
    };
    box.querySelectorAll("[data-f]").forEach((inp) => {
      inp.oninput = () => {
        if (!history.inTransaction) history.begin("adjust");
        apply(inp.dataset.f, inp.value);
      };
      inp.onchange = () => history.end();
    });
    box.querySelectorAll("[data-n]").forEach(
      (inp) =>
        (inp.onchange = () => {
          history.begin("adjust");
          apply(inp.dataset.n, inp.value);
          history.end();
        }),
    );
    box.querySelector(".edX").onclick = () => box.remove();
  }

  /* ---- dragging parts from the catalogue onto the model ----------------------------------- */
  const ghost = document.createElement("div");
  ghost.className = "ceGhost";
  ghost.hidden = true;
  root.appendChild(ghost);
  const canvas = o.renderer.domElement;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** Where a part dropped at a screen point lands: on top of whatever part is there, else on the ground. */
  function dropSpot(id, x, y) {
    const ext = partExtent(kind, id);
    const hit = model && rayAt(x, y).intersectObjects(model.root.children, false)[0];
    const g = (v) => (snap ? Math.round(v / STEP) * STEP : v);
    if (hit) {
      const top = new THREE.Box3().setFromObject(hit.object).max.y;
      return { x: g(hit.point.x), y: top + ext.y / 2, z: g(hit.point.z), mirror: false };
    }
    groundPlane.constant = kind === "ship" ? 0 : 0;
    const pt = rayAt(x, y).ray.intersectPlane(groundPlane, new THREE.Vector3());
    if (!pt) return null;
    return { x: g(pt.x), y: kind === "ship" ? 0 : ext.y / 2, z: g(pt.z), mirror: false };
  }
  function wireCard(card) {
    const id = card.dataset.part;
    let start = null,
      dragging = false,
      suppressClick = false,
      holdTimer = null;
    const begin = (e) => {
      dragging = true;
      suppressClick = true;
      clearTimeout(holdTimer);
      root.classList.add("placing");
      ghost.style.backgroundImage = thumbs.has(id) ? `url(${thumbs.get(id)})` : "";
      ghost.hidden = false;
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      try {
        card.setPointerCapture(e.pointerId);
      } catch (err) {
        /* gone */
      }
      try {
        navigator.vibrate?.(8);
      } catch (err) {
        /* not allowed */
      }
    };
    card.onpointerdown = (e) => {
      if (e.button > 0 || card.disabled) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, e };
      suppressClick = false;
      clearTimeout(holdTimer);
      if (e.pointerType !== "mouse") holdTimer = setTimeout(() => start && !dragging && begin(start.e), 380);
    };
    card.onpointermove = (e) => {
      if (!start || e.pointerId !== start.id) return;
      start.e = e;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        clearTimeout(holdTimer);
        // The cards scroll up and down: a vertical finger is scrolling, a sideways one picks the part up
        // (as does touching and holding it).
        if (e.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx) * 1.1) {
          start = null;
          return;
        }
        begin(e);
      }
      e.preventDefault();
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      ghost.classList.toggle("ok", document.elementFromPoint(e.clientX, e.clientY) === canvas);
    };
    const end = (e) => {
      clearTimeout(holdTimer);
      if (dragging && e.type === "pointerup" && document.elementFromPoint(e.clientX, e.clientY) === canvas) {
        const at = dropSpot(id, e.clientX, e.clientY);
        if (at) addPart(id, at);
      }
      dragging = false;
      start = null;
      ghost.hidden = true;
      ghost.classList.remove("ok");
      root.classList.remove("placing");
    };
    card.onpointerup = end;
    card.onpointercancel = end;
    card.addEventListener("touchmove", (e) => dragging && e.cancelable && e.preventDefault(), { passive: false });
    card.oncontextmenu = (e) => e.preventDefault();
    card.ondragstart = (e) => e.preventDefault();
    card.onclick = () => !suppressClick && addPart(id);
  }

  /* ---- viewport gestures: select, drag, orbit, pan, zoom ------------------------------------- */
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
  let drag = null;
  let pop = null;
  const gestures = attachGestures(canvas, {
    hit: (x, y) => {
      if (mode === "test") return null;
      const h = partAt(x, y);
      return h ? { part: h.index, mirrored: h.mirrored, y: h.point.y, px: h.point.x, pz: h.point.z } : null;
    },
    canDrag: () => mode === "build",
    down: () => closePops(),
    tap: (x, y, t) => {
      if (mode === "test") return;
      selected = t ? t.part : -1;
      if (t) hint(`${partOf(kind, design.parts[selected].id).name}: drag it, or use the tools. Double-tap for exact numbers.`);
      refresh();
    },
    doubleTap: (x, y, t) => {
      if (t && mode === "build") {
        selected = t.part;
        refresh();
        openDetails();
      } else if (!t) setView("reset");
    },
    longPress: (x, y, t) => {
      if (!t || mode !== "build") return;
      selected = t.part;
      refresh();
      pulse($("#mdTools"));
      try {
        navigator.vibrate?.(8);
      } catch (err) {
        /* not allowed */
      }
    },
    dragStart: (t) => {
      orbitGoal = null;
      if (selected !== t.part) {
        selected = t.part;
        refresh();
      }
      const p = design.parts[selected];
      plane.set(new THREE.Vector3(0, 1, 0), -t.y);
      const sign = t.mirrored ? -1 : 1;
      drag = { sign, offX: p.x * sign - t.px, offZ: p.z - t.pz, y0: p.y };
      history.begin("move");
    },
    drag: (t, x, y) => {
      if (!drag) return;
      if (!rayAt(x, y).ray.intersectPlane(plane, tmp)) return;
      const p = design.parts[selected];
      const g = snap ? STEP : 0.05;
      p.x = Math.round(((tmp.x + drag.offX) * drag.sign) / g) * g;
      p.z = Math.round((tmp.z + drag.offZ) / g) * g;
      // Over another part: stack on top of it. Clear of everything: back to where it started.
      p.y = drag.y0;
      if (snap) {
        const ext = partExtent(kind, p.id).multiplyScalar(p.s || 1);
        const others = model.root.children.filter((m) => m.userData.partIndex !== selected);
        const down = new THREE.Raycaster(new THREE.Vector3(p.x, lim.y + 5, p.z), new THREE.Vector3(0, -1, 0));
        const hit = down.intersectObjects(others, false)[0];
        if (hit && hit.point.y > drag.y0 - ext.y / 2 + 0.05) p.y = hit.point.y + ext.y / 2;
      }
      clampPart(p);
      // Cheap live update: move the meshes, rebuild on release.
      const parts = model.parts.find((q) => q.index === selected);
      parts.mesh.position.set(p.x, p.y, p.z);
      parts.mirror?.position.set(-p.x, p.y, p.z);
      selBoxes.forEach((b) => b.update());
    },
    dragEnd: () => {
      drag = null;
      history.end();
      refresh();
    },
    orbit: (dx, dy) => {
      orbitGoal = null;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, kind === "ship" ? -1.2 : 0.05, 1.35);
    },
    pan: (dx, dy) => {
      orbitGoal = null;
      const k = (orbit.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2) / Math.max(200, innerHeight);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      orbit.pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      orbit.pan.clampLength(0, 8);
    },
    zoom: (f) => {
      orbitGoal = null;
      orbit.zoomed = true;
      orbit.dist = THREE.MathUtils.clamp(orbit.dist / f, 3, 40);
    },
  });
  const VIEWS = { front: { yaw: 0, pitch: 0.2 }, side: { yaw: Math.PI / 2, pitch: 0.2 }, rear: { yaw: Math.PI, pitch: 0.2 }, top: { yaw: 0.7, pitch: 1.3 } };
  function setView(v) {
    if (v === "focus") {
      const p = model?.parts.find((q) => q.index === selected);
      if (!p) return hint("Select a part first, then Focus.");
      orbitGoal = { pan: p.mesh.getWorldPosition(new THREE.Vector3()).sub(centre), dist: 6 };
      orbit.zoomed = true;
      return;
    }
    orbit.zoomed = false;
    orbitGoal = v === "reset" ? { yaw: 0.7, pitch: 0.38, pan: new THREE.Vector3() } : { ...VIEWS[v], pan: new THREE.Vector3() };
  }

  /* ---- test preview ------------------------------------------------------------------------- */
  let testT = 0;
  let testKind = "drive";
  function startTest() {
    testT = 0;
    const s = stats();
    testKind = kind === "building" ? "turntable" : kind === "ship" ? "hover" : s.mode === "sea" ? "sail" : s.mode === "air" ? "fly" : "drive";
    const bar = $("#mdTestBar");
    bar.hidden = false;
    const speed = s.stats.speed ?? s.stats.power ?? 5;
    const words = { drive: "Driving", sail: "Sailing", fly: "Flying", turntable: "Showing off", hover: "Hovering" };
    bar.innerHTML = `<p class="mdTestNote"><b>${words[testKind]}</b> ${kind === "vehicle" ? `at speed ${speed} of 10. ` : ""}A preview only: your design isn't changed.</p>
      <div class="edMotions">${kind === "vehicle" ? ["drive", "sail", "fly"].map((m) => `<button data-tk="${m}" aria-checked="${m === testKind}" role="radio">${{ drive: "Drive", sail: "Sail", fly: "Fly" }[m]}</button>`).join("") : ""}</div>
      <button class="edBackBuild" data-mode-to="build">${ICONS.build} Back to Build</button>`;
    bar.querySelectorAll("[data-tk]").forEach(
      (b) =>
        (b.onclick = () => {
          testKind = b.dataset.tk;
          bar.querySelectorAll("[data-tk]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
          if (water) water.visible = testKind === "sail";
        }),
    );
    bar.querySelector("[data-mode-to]").onclick = () => setMode("build");
    if (water) water.visible = testKind === "sail";
    selBoxes.forEach((b) => (b.visible = false));
    hint(kind === "vehicle" ? "Watch it go. Turn the camera to follow it." : "A turn in the sunlight. Turn the camera to look around it.");
  }
  function stopTest() {
    $("#mdTestBar").hidden = true;
    if (water) water.visible = false;
    if (model) {
      model.root.position.set(0, 0, 0);
      model.root.rotation.set(0, 0, 0);
    }
    sun.position.set(4, 8, 6);
    selBoxes.forEach((b) => (b.visible = true));
  }

  /* ---- menus and buttons ----------------------------------------------------------------------- */
  function closePops() {
    root.querySelectorAll(".edPop").forEach((p) => (p.hidden = true));
    root.querySelectorAll("[aria-haspopup]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }
  const togglePop = (btn, pop) => {
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  $("#mdViews").onclick = () => togglePop($("#mdViews"), $("#mdViewMenu"));
  root.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        setView(b.dataset.view);
        closePops();
      }),
  );
  $("#mdMore").onclick = () => togglePop($("#mdMore"), $("#mdMenu"));
  $("#mdMoreNav").onclick = () => togglePop($("#mdMoreNav"), $("#mdMenu"));
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
    if (!(await confirmBox(root, { title: "Start over?", text: "The design goes back to how it was when you opened the editor. Undo can still bring your changes back.", ok: "Start over", danger: true }))) return;
    pushUndo("start over");
    design = JSON.parse(JSON.stringify(original));
    nameInput.value = design.name;
    selected = -1;
    refresh();
  };
  $("#mdSnap").onclick = () => {
    snap = !snap;
    $("#mdSnap").setAttribute("aria-pressed", String(snap));
    pulse($("#mdSnap"));
    hint(snap ? "Snapping on: parts line up on a grid and stack on each other." : "Snapping off: place parts anywhere, freely.");
  };
  $("#mdUndo").onclick = () => {
    const l = history.undo();
    if (l) hint("Undid " + l + ".", 1800);
  };
  $("#mdRedo").onclick = () => {
    const l = history.redo();
    if (l) hint("Redid " + l + ".", 1800);
  };
  $("#mdParts").onclick = () => {
    if (mode === "test") setMode("build");
    else if (drawer) drawer.set(drawer.state === "peek" ? "half" : "peek");
  };
  const onKey = (e) => {
    if (root.querySelector(".edModal")) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(e.target?.tagName || "");
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      (e.shiftKey ? $("#mdRedo") : $("#mdUndo")).click();
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      $("#mdRedo").click();
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "d" && selected >= 0) {
      e.preventDefault();
      duplicateSelected();
    } else if (typing) return;
    else if (selected >= 0 && (k === "Delete" || k === "Backspace")) removeSelected();
    else if (selected >= 0 && k.startsWith("Arrow")) {
      e.preventDefault();
      if (e.shiftKey && k === "ArrowUp") edit((p) => (p.y += STEP), "raise");
      else if (e.shiftKey && k === "ArrowDown") edit((p) => (p.y -= STEP), "lower");
      else nudge(k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0, k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0);
    } else if (["1", "2", "3"].includes(k)) setMode(["build", "paint", "test"][+k - 1]);
    else if (k === "Escape") {
      if (root.querySelector(".edDetails")) root.querySelector(".edDetails").remove();
      else if (mode === "test") setMode("build");
      else if (selected >= 0) {
        selected = -1;
        refresh();
      }
    }
  };
  window.addEventListener("keydown", onKey);

  /* ---- recovery ------------------------------------------------------------------------------- */
  const saved = drafts.recoverable();
  if (saved) {
    const box = $("#mdRecover");
    box.hidden = false;
    box.innerHTML = `<p><b>Unsaved changes found.</b> You were working on this ${KIND_NAMES[kind].toLowerCase()} and didn't save.</p><div><button data-r="0">Discard</button><button data-r="1" class="primary">Recover</button></div>`;
    box.querySelector('[data-r="1"]').onclick = () => {
      try {
        const d = validateModular(saved.data, kind);
        pushUndo("recover");
        design = d;
        nameInput.value = design.name;
        refresh();
        hint("Recovered. Save to keep it.");
      } catch (e) {
        hint("That draft couldn't be read.");
        drafts.clear();
      }
      box.hidden = true;
    };
    box.querySelector('[data-r="0"]').onclick = () => {
      drafts.clear();
      box.hidden = true;
    };
  }

  /* ---- finish -------------------------------------------------------------------------- */
  let closed = false;
  const cleanups = [];
  function close() {
    closed = true;
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    gestures.detach();
    cleanups.forEach((f) => f());
    clearTimeout(hintTimer);
    camera.clearViewOffset();
    model?.dispose();
    selBoxes.forEach((b) => b.geometry.dispose());
    disposables.forEach((d) => d.dispose());
    root.remove();
  }
  $("#mdDone").onclick = () => {
    history.end();
    const s = stats();
    if (!s.ok) return;
    design.name = (nameInput.value.trim() || ROLES[kind][design.role].name).replace(/[<>"`\\]/g, "").slice(0, 32);
    const result = validateModular(design, kind);
    drafts.clear();
    sfx("hatch");
    close();
    o.onDone(result, designStats(result));
  };
  $("#mdCancel").onclick = async () => {
    history.end();
    if (isDirty() && !(await confirmBox(root, { title: "Leave without saving?", text: `Your changes to this ${KIND_NAMES[kind].toLowerCase()} will be lost.`, ok: "Discard changes", cancel: "Keep editing", danger: true }))) return;
    if (closed) return;
    drafts.clear();
    close();
    o.onCancel();
  };
  const onHide = (e) => {
    if (document.visibilityState === "hidden" || e?.type === "pagehide") {
      history.end();
      if (isDirty()) {
        drafts.touch(design);
        drafts.flush();
      }
    }
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  /* ---- layout ----------------------------------------------------------------------------- */
  const wantsSide = () => innerWidth >= 900 || (innerWidth > innerHeight && innerWidth >= 640);
  let drawer = null;
  /** The part of the screen the model should sit in. */
  function freeArea() {
    const r = (sel) => root.querySelector(sel)?.getBoundingClientRect();
    let top = (r(".ceTop")?.bottom || 0) + (phoneLayout() ? 0 : 52);
    let bottom = innerHeight,
      left = 0,
      right = innerWidth;
    const panel = r(".cePanel"),
      stats = r(".mdStats"),
      tools = $("#mdTools").hidden ? null : r("#mdTools"),
      nav = r(".edModes");
    if (root.classList.contains("side")) {
      if (panel && mode !== "test") left = panel.right;
      if (stats?.width && !phoneLayout()) right = stats.left;
      if (phoneLayout() && nav) bottom = nav.top;
    } else {
      if (panel && mode !== "test" && panel.height) bottom = panel.top;
      else if (nav && phoneLayout()) bottom = nav.top;
      if (stats?.height && stats.bottom < innerHeight / 2) top = Math.max(top, stats.bottom);
    }
    if (tools?.height) bottom = Math.min(bottom, tools.top);
    if (mode === "test") bottom = Math.min(bottom, r("#mdTestBar")?.top || bottom);
    return { top, bottom, left, right };
  }
  /** Keep the model centred in the space the panels leave free. */
  function fitCamera() {
    root.classList.toggle("side", wantsSide());
    root.classList.toggle("phone", phoneLayout());
    root.style.setProperty("--ce-top", ($(".ceTop")?.getBoundingClientRect().height || 0) + "px");
    root.style.setProperty("--ed-navh", ($(".edModes")?.getBoundingClientRect().height || 0) + "px");
    // The part toolbar sits just above the panel (or the mode bar).
    const panel = root.querySelector(".cePanel")?.getBoundingClientRect();
    const navTop = root.querySelector(".edModes")?.getBoundingClientRect().top ?? innerHeight;
    const side = root.classList.contains("side");
    const above = side ? (phoneLayout() ? navTop : innerHeight) : mode === "test" ? navTop : Math.min(panel?.top ?? innerHeight, navTop);
    $("#mdTools").style.bottom = innerHeight - above + 8 + "px";
    const free = freeArea();
    // Below the stats strip on narrow screens; bottom-left of the view on wide ones (CSS).
    root.querySelector(".edViewTools").style.top = root.classList.contains("side") ? "" : free.top + 8 + "px";
    root.querySelector(".edViewMenu").style.top = root.classList.contains("side") ? "" : free.top + 112 + "px";
    camera.aspect = innerWidth / innerHeight;
    camera.setViewOffset(innerWidth, innerHeight, -((free.left + free.right) / 2 - innerWidth / 2), -((free.top + free.bottom) / 2 - innerHeight / 2), innerWidth, innerHeight);
    camera.updateProjectionMatrix();
    avail = { w: Math.max(160, free.right - free.left), h: Math.max(140, free.bottom - free.top) };
  }
  let avail = { w: innerWidth, h: innerHeight };
  window.addEventListener("resize", fitCamera);
  cleanups.push(() => window.removeEventListener("resize", fitCamera));
  cleanups.push(guardPageGestures(root));
  cleanups.push(trackViewport(root, () => !closed && fitCamera()));
  drawer = makeDrawer($(".cePanel"), {
    active: () => !root.classList.contains("side"),
    grips: [$(".ceTabs")],
    peek: () => ($(".ceTabs")?.offsetHeight || 50) + 34,
    vh: () => window.visualViewport?.height || innerHeight,
    onChange: () => {
      fitCamera();
      setTimeout(() => !closed && fitCamera(), 260);
    },
  });

  try {
    bakeThumbs();
  } catch {
    /* thumbnails are decoration; the cards still name each part */
  }
  rebuild();
  orbit.dist = orbit.fit || 11;
  refresh();
  setTab("parts");
  const TIPS = [
    { title: `Welcome to the ${KIND_NAMES[kind]} Creator`, touch: "Drag empty space to turn the view, pinch to zoom, two fingers to move it.", mouse: "Drag empty space to turn the view, scroll to zoom, right-drag to move it." },
    { title: "Build", touch: "Drag a part from the catalogue onto the model, or tap it to add it on top. Drag parts on the model to move them; they stack when dropped on another part.", mouse: "Drag a part from the catalogue onto the model, or click it to add it on top. Drag parts on the model to move them; arrow keys nudge, Shift+arrows raise and lower." },
    { title: "Paint, test, save", touch: "Paint changes the three colours or one part's paint. Test shows it in action. Your work is kept as a draft until you Save.", mouse: "Paint changes the three colours or one part's paint. Test shows it in action. Ctrl+Z undoes anything; your work is kept as a draft until you Save." },
  ];
  const startTips = (force) => showTips(root, "design-" + kind, TIPS, force);
  if (!saved) setTimeout(() => !closed && startTips(false), 500);
  if (!matchMedia("(pointer: coarse)").matches && !saved) nameInput.focus({ preventScroll: true });

  return {
    get closed() {
      return closed;
    },
    get design() {
      return design;
    },
    update(dt) {
      if (closed) return;
      easeOrbit(orbit, orbitGoal, dt) || (orbitGoal = null);
      // Settle the zoom to frame the design as it grows, unless the player has zoomed themselves.
      if (!orbit.zoomed && orbit.radius) {
        // Back off just far enough for the design to fit the free part of the screen.
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const need = orbit.radius * 1.08;
        const dH = need / (tanV * (avail.h / innerHeight));
        const dW = need / (tanV * camera.aspect * (avail.w / innerWidth));
        orbit.fit = THREE.MathUtils.clamp(Math.max(dH, dW), 4, 40);
        orbit.dist += (orbit.fit - orbit.dist) * Math.min(1, dt * 4);
      }
      const tgt = centre.clone().add(orbit.pan);
      if (mode === "test") {
        testT += dt;
        const s = stats().stats;
        const speed = 0.25 + ((s.speed ?? 5) / 10) * 0.6;
        if (testKind === "drive" || testKind === "sail" || testKind === "fly") {
          const r = testKind === "fly" ? 6 : 4.5,
            a = testT * speed;
          const y = testKind === "fly" ? 3 + Math.sin(testT * 1.3) * 0.3 : testKind === "sail" ? Math.sin(testT * 2.2) * 0.06 : 0;
          model.root.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
          model.root.rotation.set(testKind === "sail" ? Math.sin(testT * 1.7) * 0.05 : 0, -a, testKind === "fly" ? -0.25 : 0);
          tgt.set(0, 1 + y * 0.5, 0);
        } else if (testKind === "turntable") {
          model.root.rotation.y = testT * 0.35;
          const a = testT * 0.25;
          sun.position.set(Math.cos(a) * 9, 6 + Math.sin(testT * 0.2) * 2, Math.sin(a) * 9);
        } else {
          model.root.position.y = Math.sin(testT * 1.4) * 0.18;
          model.root.rotation.y = testT * 0.4;
        }
      } else if (kind === "ship" && model && !gestures.dragging) model.root.position.y = Math.sin(performance.now() / 900) * 0.05;
      // A newly added part settles in with a little bounce.
      if (pop && model) {
        pop.t += dt;
        const k = reducedMotion() ? 1 : Math.min(1, pop.t / 0.3);
        const p = design.parts[pop.index];
        const q = model.parts.find((x) => x.index === pop.index);
        const s = (p?.s || 1) * (k >= 1 ? 1 : 0.6 + 0.4 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.1);
        q?.mesh.scale.setScalar(s);
        q?.mirror?.scale.setScalar(s);
        if (k >= 1) pop = null;
      }
      const dist = mode === "test" && testKind !== "turntable" && testKind !== "hover" ? Math.max(orbit.dist, 16) : orbit.dist;
      camera.position.set(tgt.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist, tgt.y + Math.sin(orbit.pitch) * dist, tgt.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist);
      camera.lookAt(tgt);
      camera.updateMatrixWorld();
    },
    render() {
      if (!closed) o.renderer.render(scene, camera);
    },
    resize: fitCamera,
    debug: {
      addPart,
      setTab,
      setMode,
      setView,
      stats,
      dropSpot,
      openDetails,
      duplicateSelected,
      select(i) {
        selected = i;
        refresh();
      },
      edit,
      nudge,
      freeArea,
      get history() {
        return history;
      },
      get drawer() {
        return drawer;
      },
      get mode() {
        return mode;
      },
      get orbit() {
        return orbit;
      },
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
        return history.size;
      },
    },
  };
}
