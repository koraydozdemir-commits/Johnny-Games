/**
 * The Ecosystem Library browser: every shared flora, environment and fauna asset, with category tabs,
 * search, biome and rarity filters, lazily drawn thumbnails, a 3D preview, compatibility information
 * and a description. It is a modal over the game (never over gameplay: the game is paused behind it by
 * the caller) and works on touch: big tiles, native scrolling, tap to select.
 */
import { ASSETS, assetsInTab, searchAssets } from "./catalog.js";
import { createLibrary, faunaSpecies, isFauna, triangleCount } from "./library.js";
import { assetThumb } from "./thumbs.js";
import { createAssetPreview } from "./preview.js";
import { BIOMES, BIOME_NAME, CATEGORY_NAME, DENSITIES, RARITIES, RARITY_WEIGHT, TABS, TEMPERATURES, preferredTemperature, suitability } from "./schema.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtSize = (a) => (a.size.min === a.size.max ? a.size.min + " m" : `${a.size.min}–${a.size.max} m`);

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer the game's renderer, used to bake thumbnails
 * @param {boolean} [o.reducedMotion]
 * @param {string} [o.open] an asset id to open straight away
 * @param {() => void} [o.onClose]
 */
export function openEcoLibrary(o) {
  const library = createLibrary();
  const el = document.createElement("div");
  el.className = "ecl";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "eclTitle");
  el.innerHTML = `
    <div class="eclPanel">
      <div class="eclTop">
        <div><small>Shared by every planet</small><h2 id="eclTitle">Ecosystem Library</h2></div>
        <span class="eclCount" id="eclCount" aria-live="polite"></span>
        <button class="eclBtn" id="eclClose" aria-label="Close the Ecosystem Library">Close</button>
      </div>
      <div class="eclBar">
        <label class="eclSearch"><span class="eclSr">Search the library</span><input type="search" id="eclQ" placeholder="Search plants, rocks, creatures, biomes…" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
        <label><span class="eclSr">Biome</span><select id="eclBiome"><option value="">Any biome</option>${BIOMES.map((b) => `<option value="${b}">${BIOME_NAME[b]}</option>`).join("")}</select></label>
        <label><span class="eclSr">Rarity</span><select id="eclRarity"><option value="">Any rarity</option>${RARITIES.map((r) => `<option value="${r}">${cap(r)}</option>`).join("")}</select></label>
      </div>
      <nav class="eclTabs" role="tablist" aria-label="Categories" id="eclTabs"></nav>
      <div class="eclSub" id="eclSub" role="group" aria-label="Filter by type"></div>
      <div class="eclBody">
        <div class="eclGrid" id="eclGrid" role="list" aria-label="Assets"></div>
        <section class="eclDetail" id="eclDetail" aria-label="Asset details" hidden></section>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const $ = (q) => el.querySelector(q);
  let tab = "trees",
    category = null,
    selected = null,
    variant = 0,
    preview = null;

  /* ---- thumbnails: baked a few at a time as tiles scroll into view ---- */
  const queue = [];
  let pumping = false;
  const pump = () => {
    if (pumping) return;
    pumping = true;
    preview?.setPaused(true); // thumbnails first: the turntable rests while they bake
    // Bake as many as fit in a ~10 ms slice, then yield, so scrolling and input stay smooth.
    const step = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) {
        const img = queue.shift();
        if (!img) {
          pumping = false;
          preview?.setPaused(false);
          return;
        }
        if (!img.isConnected) continue;
        const a = ASSETS.find((x) => x.id === img.dataset.lazy);
        const url = a && assetThumb(o.renderer, a, library, { size: 128 });
        if (url) img.src = url;
        else img.replaceWith(Object.assign(document.createElement("span"), { className: "eclNoThumb", textContent: a ? a.name[0] : "?" }));
      }
      setTimeout(step, 0);
    };
    step();
  };
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
          { root: $("#eclGrid"), rootMargin: "200px" },
        )
      : null;

  /* ---- list ---- */
  const results = () => searchAssets({ q: $("#eclQ").value, tab, category, biome: $("#eclBiome").value || null, rarity: $("#eclRarity").value || null });
  function renderTabs() {
    $("#eclTabs").innerHTML = TABS.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.name}<small>${assetsInTab(t.id).length}</small></button>`).join("");
    $("#eclTabs").querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          tab = b.dataset.tab;
          category = null;
          renderTabs();
          renderSub();
          renderGrid();
        }),
    );
  }
  function renderSub() {
    const cats = TABS.find((t) => t.id === tab).categories;
    $("#eclSub").innerHTML = [`<button data-cat="" aria-pressed="${!category}">All</button>`, ...cats.map((c) => `<button data-cat="${c}" aria-pressed="${category === c}">${CATEGORY_NAME[c]}</button>`)].join("");
    $("#eclSub").querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          category = b.dataset.cat || null;
          renderSub();
          renderGrid();
        }),
    );
  }
  function renderGrid() {
    const list = results();
    $("#eclCount").textContent = `${list.length} of ${assetsInTab(tab).length} shown`;
    const grid = $("#eclGrid");
    grid.scrollTop = 0;
    grid.innerHTML = list.length
      ? list
          .map(
            (a) => `<button class="eclTile ${a.id === selected ? "sel" : ""} r-${a.rarity}" role="listitem" data-id="${a.id}" aria-label="${esc(a.name)}, ${esc(CATEGORY_NAME[a.category])}, ${a.rarity}" aria-pressed="${a.id === selected}">
              <span class="eclThumb"><img data-lazy="${a.id}" alt="" draggable="false" width="96" height="96"></span>
              <b>${esc(a.name)}</b><small>${esc(CATEGORY_NAME[a.category])}</small>
            </button>`,
          )
          .join("")
      : `<p class="eclEmpty">Nothing matches. Try a different word, biome or rarity.</p>`;
    grid.querySelectorAll(".eclTile").forEach((t) => (t.onclick = () => select(t.dataset.id)));
    if (io) grid.querySelectorAll("img[data-lazy]").forEach((i) => io.observe(i));
    else grid.querySelectorAll("img[data-lazy]").forEach((i) => queue.push(i)), pump();
  }

  /* ---- detail ---- */
  function compat(a) {
    const temp = preferredTemperature(a);
    const rows = BIOMES.map((b) => ({ b, native: a.biomes.includes(b), w: suitability(a, { biome: b, temperature: temp, terrain: a.terrain[0] }) / RARITY_WEIGHT[a.rarity] })).sort((x, y) => y.w - x.w);
    return rows;
  }
  function renderDetail() {
    const box = $("#eclDetail");
    const a = ASSETS.find((x) => x.id === selected);
    if (!a) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    el.classList.add("hasDetail");
    const temps = TEMPERATURES.map((t, i) => `<i class="${i >= a.temperature.min && i <= a.temperature.max ? "on" : ""} ${i === preferredTemperature(a) ? "pref" : ""}" title="${cap(t)}"><span>${cap(t)}</span></i>`).join("");
    const d = DENSITIES[a.density];
    let model = "";
    if (isFauna(a)) {
      const sp = faunaSpecies(a);
      model = `<dt>Diet</dt><dd>${{ plant: "Herbivore", meat: "Carnivore", omni: "Omnivore" }[a.params.diet]}</dd><dt>Habitat</dt><dd>${cap(a.params.habitat)}</dd><dt>Role</dt><dd>${esc(a.params.archetype)}</dd><dt>Level</dt><dd>${sp.level}</dd><dt>Built from</dt><dd>The creature generator (seed ${a.params.seed})</dd>`;
    } else {
      const tris = [0, 1, 2].map((l) => triangleCount(library.get(a.id, 0, l)));
      model = `<dt>Detail levels</dt><dd>${tris.map((t, i) => `LOD ${i}: ${t} tris`).join(" · ")}</dd><dt>Model</dt><dd>Procedural, ${a.variants} variants</dd>`;
    }
    box.innerHTML = `
      <button class="eclBtn eclBack" id="eclBack" aria-label="Back to the list">Back</button>
      <div class="eclPrevHost" id="eclPrev"></div>
      <div class="eclHead"><h3>${esc(a.name)}</h3><span class="eclTag">${esc(CATEGORY_NAME[a.category])}</span><span class="eclTag rar r-${a.rarity}">${cap(a.rarity)}</span></div>
      <p class="eclDesc">${esc(a.description)}</p>
      ${isFauna(a) ? "" : `<div class="eclVariants" role="group" aria-label="Variants">${Array.from({ length: a.variants }, (_, i) => `<button data-v="${i}" aria-pressed="${i === variant}">Variant ${i + 1}</button>`).join("")}</div>`}
      <dl class="eclFacts">
        <dt>Size</dt><dd>${fmtSize(a)} ${isFauna(a) ? "long" : "(longest side)"}</dd>
        <dt>Preferred density</dt><dd>${cap(a.density)}: about ${d.perHa} per hectare${d.cluster > 0.6 ? ", in tight groups" : d.cluster > 0.3 ? ", loosely grouped" : ""}</dd>
        <dt>Terrain</dt><dd>${a.terrain.map((t) => `<span class="eclChip">${cap(t)}</span>`).join("")}</dd>
        <dt>Temperature</dt><dd><span class="eclTemp" role="img" aria-label="Tolerates ${TEMPERATURES[a.temperature.min]} to ${TEMPERATURES[a.temperature.max]}; prefers ${TEMPERATURES[preferredTemperature(a)]}">${temps}</span></dd>
        ${model}
      </dl>
      <h4>Compatible biomes</h4>
      <ul class="eclBiomes" aria-label="How well it suits each biome">${compat(a).map((r) => `<li class="${r.native ? "native" : ""}"><span>${BIOME_NAME[r.b]}</span><i style="width:${Math.max(3, Math.round(r.w * 100))}%"></i><em>${r.native ? "Native" : Math.round(r.w * 100) + "%"}</em></li>`).join("")}</ul>`;
    box.querySelectorAll("[data-v]").forEach(
      (b) =>
        (b.onclick = () => {
          variant = +b.dataset.v;
          box.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          preview?.show(a, variant);
        }),
    );
    $("#eclBack").onclick = () => {
      el.classList.remove("hasDetail");
      $("#eclGrid").querySelector(".eclTile.sel")?.focus();
    };
    // The 3D view; if WebGL is missing the thumbnail stands in.
    box.scrollTop = 0;
    const host = $("#eclPrev");
    preview?.dispose();
    preview = createAssetPreview(host, library, { reducedMotion: o.reducedMotion });
    if (preview) preview.show(a, variant);
    else host.innerHTML = `<img alt="" src="${assetThumb(o.renderer, a, library, { size: 128, variant }) || ""}">`;
  }
  function select(id) {
    selected = id;
    variant = 0;
    $("#eclGrid").querySelectorAll(".eclTile").forEach((t) => {
      const on = t.dataset.id === id;
      t.classList.toggle("sel", on);
      t.setAttribute("aria-pressed", String(on));
    });
    o.sfx?.("click");
    renderDetail();
  }

  /* ---- wiring ---- */
  let t = 0;
  $("#eclQ").oninput = () => {
    clearTimeout(t);
    t = setTimeout(renderGrid, 120);
  };
  $("#eclBiome").onchange = renderGrid;
  $("#eclRarity").onchange = renderGrid;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    io?.disconnect();
    preview?.dispose();
    library.clear();
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
    o.onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (el.classList.contains("hasDetail") && innerWidth < 900) el.classList.remove("hasDetail");
      else close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  $("#eclClose").onclick = close;
  renderTabs();
  renderSub();
  renderGrid();
  if (o.open) {
    const a = ASSETS.find((x) => x.id === o.open);
    if (a) {
      tab = a.tab;
      renderTabs();
      renderSub();
      renderGrid();
      select(a.id);
    }
  }
  if (!matchMedia("(pointer: coarse)").matches) setTimeout(() => $("#eclQ").focus({ preventScroll: true }), 50);
  return { close, select, get selected() { return selected; }, el };
}
