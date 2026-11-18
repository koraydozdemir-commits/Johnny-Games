/**
 * The Sporepedia: the library of everything this universe has made and found. Categories, search,
 * sort and rarity filters, favourites and recently viewed; a detail page for each entry with its
 * real data (a turning 3D model for creatures), renaming, comparing two entries, exporting, opening a
 * creation in the editor, and showing a find in the galaxy.
 */
import { CATEGORIES, compareRows, counts, exportEntry, markViewed, nameOf, query, rename, toggleFav } from "./model.js";
import { creatureTurntable } from "./preview.js";
import { CREATION_KINDS, wrapCreation } from "../creations/format.js";
import { planetImage, plantImage } from "../galaxy/planet-art.js";
import { STAR_KINDS } from "../galaxy/gen.js";
import { ABILITY_INFO, abilitiesOf, creaturePart } from "../creature/parts.js";
import { creaturePartIds } from "../creature/format.js";
import { movementOf } from "../creature/anatomy.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ICON = { creature: "🦎", species: "🧬", cell: "◉", planet: "🪐", star: "✦", plant: "🌿", discovery: "🔭", landmark: "🗺", history: "📜", tribal: "⛺", building: "🏛", vehicle: "🚙", ship: "🚀", civ: "🏙", empire: "🌌" };
const RENAMEABLE = new Set(["creature", "species", "cell", "planet", "star", "plant", "landmark", "tribal", "building", "vehicle", "ship"]);
const COMPARABLE = new Set(["creature", "species", "cell", "planet", "plant", "star"]);
const EXPORTABLE = new Set(["creature", "species", "cell", "planet", "plant", "tribal", "star", "building", "vehicle", "ship"]);
/** In the Global Sporepedia: only creations, across every universe. */
const GLOBAL_CATS = new Set(["creature", "cell", "building", "vehicle", "ship", "favourites", "recent"]);
const dateOf = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * @param {object} o
 * @param {object} o.session
 * @param {(record:object) => string|null} o.portrait
 * @param {(kind:string, opts?:object) => void} [o.sfx]
 * @param {(entry:object) => void} [o.onEdit]          reopen a creation in the editor
 * @param {(focus:object) => void} [o.onShowInGalaxy]
 * @param {() => void} o.onClose
 * @param {string} [o.open]   an entry id to open straight away
 * @param {boolean} [o.reducedMotion]
 * @param {{ load:() => Promise<object>, save:(pedia:object) => Promise<void> }} [o.global]  the Global Sporepedia
 * @param {(text:string) => Promise<string>} [o.onImport]   import a creation file; resolves to its new entry id
 * @param {(entry:object) => void} [o.onCopyHere]            copy a global creation into this universe
 * @param {(kind:string, data:object) => string|null} [o.thumb]  a portrait for a design (cells)
 */
export function openPedia(o) {
  const S = o.session;
  // Two scopes: this universe's Sporepedia, or the Global Sporepedia of every universe's creations.
  let scope = "local",
    globalP = null;
  const P = () => (scope === "global" ? globalP : S.pedia);
  const save = () => (scope === "global" ? o.global?.save(globalP) : S.save());
  const el = document.createElement("div");
  el.className = "pd";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "pdTitle");
  el.innerHTML = `
    <div class="pdPanel">
      <div class="pdTop"><div><small id="pdScopeName">${esc(S.meta.name)}</small><h2 id="pdTitle">Sporepedia</h2></div>${o.global ? `<div class="pdScope" role="radiogroup" aria-label="Collection"><button role="radio" aria-checked="true" data-scope="local">This universe</button><button role="radio" aria-checked="false" data-scope="global">All universes</button></div>` : ""}<button class="pdBtn" id="pdClose" aria-label="Close the Sporepedia">✕</button></div>
      <div class="pdBar">
        <label class="pdSearch"><span class="sr">Search</span><input type="search" id="pdQ" placeholder="Search names, planets, diets…" autocomplete="off" spellcheck="false"></label>
        <label><span class="sr">Sort by</span><select id="pdSort"><option value="recent">Newest</option><option value="oldest">Oldest</option><option value="name">Name</option><option value="rarity">Rarity</option><option value="danger">Danger</option></select></label>
        <label><span class="sr">Rarity</span><select id="pdRarity"><option value="">Any rarity</option><option>Common</option><option>Rare</option><option>Unique</option></select></label>
        ${o.onImport ? `<label class="pdSecondary pdImport" title="Import a creation file">⤒ Import<input type="file" id="pdFile" accept=".json,application/json" hidden></label>` : ""}
      </div>
      <p class="pdMsg" id="pdMsg" role="status" aria-live="polite"></p>
      <nav class="pdTabs" role="tablist" aria-label="Categories" id="pdTabs"></nav>
      <div class="pdCompareBar" id="pdCmpBar" hidden role="status"><span id="pdCmpText"></span><button class="pdBtn sm" id="pdCmpCancel">Cancel</button></div>
      <div class="pdGrid" id="pdGrid" role="list"></div>
      <section class="pdDetail" id="pdDetail" hidden aria-labelledby="pdDName"></section>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const $ = (q) => el.querySelector(q);
  let cat = "creature",
    comparing = null,
    turntable = null,
    detailId = null;

  /* ---- thumbnails, drawn lazily as cards scroll into view ---- */
  const thumbCache = new Map();
  function thumbFor(e) {
    if (thumbCache.has(e.id)) return thumbCache.get(e.id);
    let url = null;
    const local = scope === "local";
    if (e.thumb) url = e.thumb;
    else if (e.kind === "planet" && local) {
      const p = S.planet(e.planetId);
      if (p) url = planetImage(p, 96);
    } else if (e.kind === "plant" && local) {
      const x = S.resolve(e);
      if (x) url = plantImage(x, 96);
    } else if (e.kind === "species" || e.kind === "creature") {
      const rec = e.record || (local ? S.resolve(e)?.record : null);
      if (rec) url = o.portrait?.(rec) || null;
    } else if (e.kind === "cell" && e.record) url = o.thumb?.("cell", e.record) || null;
    thumbCache.set(e.id, url);
    return url;
  }
  const queue = [];
  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    const step = () => {
      const img = queue.shift();
      if (!img) return (pumping = false);
      if (img.isConnected) {
        const e = P().entries[img.dataset.lazy];
        const url = e && thumbFor(e);
        if (url) img.src = url;
        else img.replaceWith(Object.assign(document.createElement("span"), { className: "pdIcon", textContent: ICON[e?.kind] || "•" }));
      }
      setTimeout(step, 12);
    };
    step();
  }
  const io =
    typeof window.IntersectionObserver !== "undefined"
      ? new window.IntersectionObserver(
          (list) =>
            list.forEach((x) => {
              if (!x.isIntersecting) return;
              io.unobserve(x.target);
              queue.push(x.target);
              pump();
            }),
          { root: $("#pdGrid"), rootMargin: "200px" },
        )
      : null;
  function picture(e, cls = "") {
    if (e.kind === "star") {
      const k = STAR_KINDS[P().entries[e.id]?.starKind] || Object.values(STAR_KINDS).find((x) => x.name === e.sub);
      return `<span class="pdStar ${cls}" style="--c:${k?.color || "#ffe9a3"}" aria-hidden="true"></span>`;
    }
    if (e.kind === "tribal") return `<span class="pdIcon ${cls}" style="--c:${esc(e.color || "#3fa9d6")}" aria-hidden="true">⛺</span>`;
    if (["discovery", "landmark", "history"].includes(e.kind)) return `<span class="pdIcon ${cls}" aria-hidden="true">${esc(e.icon || ICON[e.kind])}</span>`;
    // Large pictures (detail, compare) are drawn at once; list cards wait until they scroll into view.
    const url = cls === "big" ? thumbFor(e) : thumbCache.get(e.id);
    if (cls === "big" && !url) return `<span class="pdIcon big" aria-hidden="true">${ICON[e.kind] || "•"}</span>`;
    return `<img class="${cls}" alt="" ${url ? `src="${url}"` : `data-lazy="${esc(e.id)}"`} width="96" height="96">`;
  }

  /* ---- the list ---- */
  function renderTabs() {
    const c = counts(P());
    $("#pdTabs").innerHTML = CATEGORIES.filter((k) => scope === "local" || GLOBAL_CATS.has(k.id)).map(
      (k) =>
        `<button role="tab" aria-selected="${k.id === cat}" data-cat="${k.id}"><span aria-hidden="true">${k.icon}</span>${k.name}<em>${k.id === "discovery" ? (c.discovery || 0) + (c.landmark || 0) : c[k.id] || 0}</em></button>`,
    ).join("");
    el.querySelectorAll("[data-cat]").forEach(
      (b) =>
        (b.onclick = () => {
          cat = b.dataset.cat;
          renderTabs();
          renderGrid();
        }),
    );
  }
  function renderGrid() {
    const list = query(P(), { cat, text: $("#pdQ").value, sort: $("#pdSort").value, rarity: $("#pdRarity").value });
    const grid = $("#pdGrid");
    if (!list.length) {
      const empty = {
        creature: "Your creatures appear here as you design them. Discovered creatures are under Species.",
        species: "Explore planets in the galaxy to discover species.",
        cell: scope === "global" ? "Cell designs from every universe appear here." : "Your cell designs appear here, one per generation.",
        planet: "Open star systems in the galaxy to discover planets.",
        star: "Open a star system in the galaxy to add it here.",
        plant: "Survey living planets to find their plants.",
        discovery: "Your first discoveries will be logged here.",
        history: "Your species' story appears here as it evolves.",
        tribal: "Found a tribe to record its village here.",
        favourites: "Tap ☆ on any entry to keep it here.",
        recent: "Entries you open appear here.",
      }[cat];
      grid.innerHTML = `<p class="pdEmpty">${$("#pdQ").value || $("#pdRarity").value ? "Nothing matches." : empty}</p>`;
      return;
    }
    grid.innerHTML = list
      .slice(0, 400)
      .map(
        (e) =>
          `<button class="pdCard ${e.rarity === "Rare" || e.rarity === "Unique" ? "rare" : ""} ${e.kind}" role="listitem" data-id="${esc(e.id)}">${picture(e)}<span class="pdCardText"><b>${esc(nameOf(e))}</b><small>${esc(scope === "global" ? e.universe : cardSub(e))}</small></span>${e.fav ? `<i class="pdFav" aria-label="Favourite">★</i>` : ""}${e.owned ? `<i class="pdMine" title="Your creation">✦</i>` : ""}</button>`,
      )
      .join("");
    grid.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => (comparing ? finishCompare(b.dataset.id) : openDetail(b.dataset.id))));
    grid.querySelectorAll("img[data-lazy]").forEach((img) => (io ? io.observe(img) : (queue.push(img), pump())));
  }
  function cardSub(e) {
    if (e.kind === "discovery") return dateOf(e.at);
    if (e.kind === "history") return (e.stage ? e.stage[0].toUpperCase() + e.stage.slice(1) + " Stage" : "") + (e.at ? " · " + dateOf(e.at) : "");
    return [e.sub, e.place].filter(Boolean).join(" · ");
  }
  $("#pdQ").oninput = renderGrid;
  $("#pdSort").onchange = renderGrid;
  $("#pdRarity").onchange = renderGrid;

  /* ---- detail ---- */
  function rows(e) {
    const r = [];
    const add = (k, v) => v !== undefined && v !== null && v !== "" && r.push([k, v]);
    if (e.kind === "creature" || (e.kind === "species" && (e.record || (scope === "local" && S.resolve(e))))) {
      const rec = e.record || S.resolve(e)?.record;
      if (rec) {
        const ab = abilitiesOf(creaturePartIds(rec), rec.legs.length, rec.arms?.length || 0);
        const mv = movementOf(rec, ab);
        e.parts = rec.parts.length + rec.legs.length * 2 + (rec.arms?.length || 0) * 2;
        e.plan = mv.planName;
        add("Body plan", mv.planName + " · " + e.parts + " parts");
        add(
          "Abilities",
          Object.entries(ab)
            .filter(([k, v]) => v > 0 && ABILITY_INFO[k])
            .map(([k, v]) => ABILITY_INFO[k].icon + " " + ABILITY_INFO[k].name + " " + v)
            .join(" · ") || "None",
        );
        add("Parts", [...new Set(rec.parts.map((p) => creaturePart(p.id)?.name).filter(Boolean))].join(", "));
      }
    }
    for (const [k, f] of [
      ["Species", "species"],
      ["Diet", "diet"],
      ["Role", "role"],
      ["Size", "size"],
      ["Personality", "temperament"],
      ["Habitat", "habitat"],
      ["Stage", "stage"],
      ["Generation", "gen"],
      ["Type", "sub"],
      ["Temperature", "temp"],
      ["Gravity", "gravity"],
      ["Atmosphere", "atmosphere"],
      ["Water", "water"],
      ["Life", "biodiversity"],
      ["Fruit", "fruit"],
      ["Needs", "needs"],
      ["Sector", "sector"],
      ["Planets", "planets"],
      ["Danger", "danger"],
      ["Rarity", "rarity"],
      ["Homeworld", "homeworld"],
      ["Found on", "place"],
      ["Traits", "traits"],
      ["Village", "village"],
      ["Equipment", "equipment"],
      ["Outcome", "outcome"],
      ["Universe", "universe"],
    ])
      if (!((e.kind === "creature" || e.kind === "cell") && f === "sub")) add(e.owned && f === "place" ? "Made on" : k, e[f]);
    if (e.kind === "planet") add("Status", { discovered: "Discovered", explored: "Explored", catalogued: "Fully catalogued" }[e.status] || "Discovered");
    add(e.owned ? "Created" : e.kind === "history" ? "When" : "Discovered", dateOf(e.discoveredAt || e.at));
    if (e.by && !e.owned) add("First discovered by", e.by);
    return r;
  }
  function openDetail(id) {
    const e = P().entries[id];
    if (!e) return;
    detailId = id;
    markViewed(P(), id);
    save();
    turntable?.dispose();
    turntable = null;
    // The 3D turntable is for creatures and species (cells are drawn flat).
    const rec = e.kind === "creature" || e.kind === "species" ? e.record || (e.kind === "species" && scope === "local" ? S.resolve(e)?.record : null) : null;
    const known = e.kind === "planet" && scope === "local" ? query(P(), { cat: "species" }).filter((x) => x.planetId === e.planetId) : [];
    const timeline = e.timeline || [];
    const d = $("#pdDetail");
    d.hidden = false;
    d.innerHTML = `
      <div class="pdDHead"><button class="pdBtn" id="pdDBack" aria-label="Back to the list">←</button><div><h3 id="pdDName">${esc(nameOf(e))}</h3><small>${ICON[e.kind] || ""} ${esc([e.kind === "landmark" ? "Landmark" : e.sub, e.owned ? "Your creation" : null].filter(Boolean).join(" · "))}</small></div>
        <button class="pdBtn" id="pdFavBtn" aria-pressed="${!!e.fav}" aria-label="${e.fav ? "Remove from favourites" : "Add to favourites"}">${e.fav ? "★" : "☆"}</button></div>
      <div class="pdHero" id="pdHero">${rec ? "" : scope === "local" && e.kind === "planet" && S.planet(e.planetId) ? `<img src="${planetImage(S.planet(e.planetId), 220)}" alt="" width="220">` : scope === "local" && e.kind === "plant" && S.resolve(e) ? `<img src="${plantImage(S.resolve(e), 160)}" alt="" width="160">` : picture(e, "big")}</div>
      ${e.description || e.text ? `<p class="pdDesc">${esc(e.description || e.text)}</p>` : e.kind === "discovery" ? `<p class="pdDesc">${esc(e.name)}</p>` : ""}
      <form class="pdRename" id="pdRenameForm" hidden><label><span class="sr">New name</span><input maxlength="32" value="${esc(nameOf(e))}" autocomplete="off" spellcheck="false"></label><button class="pdPrimary">Save</button></form>
      <dl class="pdRows">${rows(e)
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join("")}</dl>
      ${known.length ? `<h4>Known species</h4><div class="pdChips">${known.map((x) => `<button data-go="${esc(x.id)}">${esc(nameOf(x))}</button>`).join("")}</div>` : ""}
      ${timeline.length ? `<h4>Evolution</h4><ol class="pdTimeline">${timeline.map((t) => `<li><span aria-hidden="true">${esc(t.icon)}</span>${esc(t.text)}</li>`).join("")}</ol>` : ""}
      ${e.generations?.length ? `<h4>Generations</h4><div class="pdGens">${e.generations.map((g) => `<button data-go="${esc(g.id)}">${g.thumb ? `<img src="${g.thumb}" alt="" width="64" height="64">` : ""}<small>${esc(g.label)}</small></button>`).join("")}</div>` : ""}
      ${e.ref && P().entries[e.ref] ? `<div class="pdChips"><button data-go="${esc(e.ref)}">Open ${esc(nameOf(P().entries[e.ref]))}</button></div>` : ""}
      <div class="pdActions">
        ${RENAMEABLE.has(e.kind) ? `<button class="pdSecondary" id="pdRename">✎ Rename</button>` : ""}
        ${COMPARABLE.has(e.kind) ? `<button class="pdSecondary" id="pdCompare">⇄ Compare</button>` : ""}
        ${EXPORTABLE.has(e.kind) ? `<button class="pdSecondary" id="pdExport">⤓ Export</button>` : ""}
        ${scope === "local" && (e.planetId || e.starId !== undefined) ? `<button class="pdSecondary" id="pdGalaxy">🌌 Show in galaxy</button>` : ""}
        ${scope === "global" && o.onCopyHere ? `<button class="pdSecondary" id="pdCopyHere">⇣ Copy into this universe</button>` : ""}
        ${e.owned && (e.record || e.design) && o.onEdit ? `<button class="pdPrimary" id="pdEdit">✏ Open in editor</button>` : ""}
      </div>`;
    d.scrollTop = 0;
    if (rec) {
      const host = $("#pdHero");
      turntable = creatureTurntable(host, rec, { reducedMotion: o.reducedMotion });
      if (!turntable) host.innerHTML = picture({ ...e, record: rec }, "big");
    }
    const on = (q, fn) => {
      const b = d.querySelector(q);
      if (b) b.onclick = fn;
    };
    on("#pdDBack", closeDetail);
    on("#pdCopyHere", () => {
      o.onCopyHere(e);
      msg("Copied " + nameOf(e) + " into " + S.meta.name + ".");
    });
    on("#pdFavBtn", () => {
      toggleFav(P(), id);
      save();
      o.sfx?.("click");
      openDetail(id);
      renderTabs();
    });
    on("#pdRename", () => {
      const f = $("#pdRenameForm");
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector("input").select();
    });
    $("#pdRenameForm").onsubmit = (ev) => {
      ev.preventDefault();
      rename(P(), id, $("#pdRenameForm input").value);
      save();
      o.sfx?.("click");
      openDetail(id);
      renderGrid();
    };
    on("#pdCompare", () => startCompare(e));
    on("#pdExport", () => download(e));
    on("#pdGalaxy", () => o.onShowInGalaxy?.(e.planetId ? { planetId: e.planetId } : { starId: e.starId }));
    on("#pdEdit", () => o.onEdit?.(e));
    d.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => openDetail(b.dataset.go)));
    $("#pdDBack").focus();
  }
  function closeDetail() {
    turntable?.dispose();
    turntable = null;
    $("#pdDetail").hidden = true;
    const back = detailId && [...el.querySelectorAll("[data-id]")].find((b) => b.dataset.id === detailId);
    detailId = null;
    renderTabs();
    renderGrid();
    (back || $("#pdQ")).focus();
  }
  function download(e) {
    // Designs travel in the creation format (they reopen in their editor); discoveries as entries.
    const design = e.record || e.design || (e.kind === "species" && scope === "local" ? S.resolve(e)?.record : null);
    const kind = e.kind === "species" ? "creature" : e.kind;
    const data = design && CREATION_KINDS[kind] ? wrapCreation(kind, design, { name: nameOf(e), thumb: thumbFor(e), from: scope === "global" ? e.universe : S.meta.name }) : exportEntry(e);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (nameOf(e) || "creation").replace(/[^\w-]+/g, "_") + "." + e.kind + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
    o.sfx?.("click");
  }

  /* ---- comparing two entries ---- */
  function startCompare(e) {
    comparing = e;
    closeDetail();
    cat = e.kind;
    renderTabs();
    renderGrid();
    $("#pdCmpBar").hidden = false;
    $("#pdCmpText").textContent = "Pick another " + (e.kind === "species" ? "species" : e.kind) + " to compare with " + nameOf(e) + ".";
  }
  $("#pdCmpCancel").onclick = () => {
    comparing = null;
    $("#pdCmpBar").hidden = true;
  };
  function finishCompare(id) {
    const a = comparing,
      b = P().entries[id];
    comparing = null;
    $("#pdCmpBar").hidden = true;
    if (!b || b.id === a.id) return;
    // Fill derived fields (body plan, parts) for both.
    rows(a);
    rows(b);
    const table = compareRows(a, b);
    const d = $("#pdDetail");
    d.hidden = false;
    d.innerHTML = `<div class="pdDHead"><button class="pdBtn" id="pdDBack" aria-label="Back to the list">←</button><div><h3 id="pdDName">Compare</h3><small>${esc(nameOf(a))} and ${esc(nameOf(b))}</small></div></div>
      <div class="pdCmpPics"><figure>${picture(a, "big")}<figcaption>${esc(nameOf(a))}</figcaption></figure><figure>${picture(b, "big")}<figcaption>${esc(nameOf(b))}</figcaption></figure></div>
      <table class="pdCmp"><thead><tr><th scope="col"><span class="sr">Property</span></th><th scope="col">${esc(nameOf(a))}</th><th scope="col">${esc(nameOf(b))}</th></tr></thead><tbody>${table
        .map(([k, x, y]) => `<tr${x !== y ? ' class="diff"' : ""}><th scope="row">${esc(k)}</th><td>${esc(x)}</td><td>${esc(y)}</td></tr>`)
        .join("")}</tbody></table>`;
    d.querySelectorAll("img[data-lazy]").forEach((img) => (queue.push(img), pump()));
    $("#pdDBack").onclick = closeDetail;
    $("#pdDBack").focus();
  }

  /* ---- the Global Sporepedia, and importing creations ---- */
  const msg = (t, bad = false) => {
    const m = $("#pdMsg");
    m.textContent = t;
    m.classList.toggle("bad", bad);
  };
  el.querySelectorAll("[data-scope]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (b.dataset.scope === scope) return;
        if (b.dataset.scope === "global") {
          msg("Opening every universe's creations…");
          try {
            globalP = await o.global.load();
          } catch (err) {
            return msg("The Global Sporepedia couldn't be opened.", true);
          }
          msg("");
        }
        scope = b.dataset.scope;
        el.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.scope === scope)));
        $("#pdScopeName").textContent = scope === "global" ? "Every universe" : S.meta.name;
        $("#pdTitle").textContent = scope === "global" ? "Global Sporepedia" : "Sporepedia";
        thumbCache.clear();
        if (scope === "global" && !GLOBAL_CATS.has(cat)) cat = "creature";
        if (!$("#pdDetail").hidden) closeDetail();
        renderTabs();
        renderGrid();
        o.sfx?.("click");
      }),
  );
  const file = $("#pdFile");
  if (file)
    file.onchange = async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      if (f.size > 400_000) return msg("That file is too big to be a creation.", true);
      try {
        const id = await o.onImport(await f.text());
        if (scope === "global") el.querySelector('[data-scope="local"]').click();
        cat = P().entries[id]?.kind || cat;
        renderTabs();
        renderGrid();
        openDetail(id);
        msg("Imported. It's in your creations now.");
      } catch (err) {
        msg(err.message || "That file couldn't be imported.", true);
      }
    };

  /* ---- open and close ---- */
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (comparing) $("#pdCmpCancel").click();
    else if (!$("#pdDetail").hidden) closeDetail();
    else close();
  };
  document.addEventListener("keydown", onKey, true);
  $("#pdClose").onclick = close;
  el.addEventListener("click", (e) => e.target === el && close());
  function close() {
    turntable?.dispose();
    io?.disconnect();
    document.removeEventListener("keydown", onKey, true);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
    o.onClose?.();
  }
  renderTabs();
  renderGrid();
  if (o.open && P().entries[o.open]) {
    cat = P().entries[o.open].kind === "landmark" ? "discovery" : P().entries[o.open].kind;
    renderTabs();
    renderGrid();
    openDetail(o.open);
  } else $("#pdQ").focus({ preventScroll: true });
  return { close, debug: { openDetail, renderGrid, setCat: (c) => ((cat = c), renderTabs(), renderGrid()), finishCompare, startCompare: (id) => startCompare(P().entries[id]) } };
}
