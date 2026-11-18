/**
 * The Galaxy Explorer: the whole galaxy as a map of star points (drag, pinch or scroll to zoom, tap
 * a star), a star system with its planets on their orbits, a planet's portrait and data, and its
 * exploration, where each survey turns up a landmark, a plant or a creature for the Sporepedia.
 * Levels of detail: points for the galaxy, small portraits for a system, a large portrait for a
 * planet, and the generated organisms only once a planet is explored.
 */
import { GALAXY_LY, PLANET_TYPES, STAR_KINDS, lightYears } from "./gen.js";
import { planetCanvas, planetImage, plantImage } from "./planet-art.js";
import { rng32 } from "./names.js";
import { entryId } from "../universe/session.js";
import { planetStatus, rename } from "../pedia/model.js";

const TAU = Math.PI * 2;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATUS_LABEL = { undiscovered: "Undiscovered", discovered: "Discovered", explored: "Explored", catalogued: "Fully catalogued" };

/**
 * @param {object} o
 * @param {object} o.session                 from universe/session.js
 * @param {(kind:string, opts?:object) => void} o.sfx
 * @param {(id:string) => void} o.openEntry  open a Sporepedia entry
 * @param {(record:object) => string|null} o.portrait
 * @param {() => void} o.onClose
 * @param {{ starId?:number, planetId?:string }} [o.focus]
 */
export function openGalaxy(o) {
  const S = o.session;
  const galaxy = S.galaxy();
  const home = S.home();
  const homeStar = galaxy.stars[home.starId];
  const el = document.createElement("div");
  el.className = "gx";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Galaxy explorer");
  el.innerHTML = `
    <canvas class="gxCanvas" tabindex="0" aria-label="Galaxy map: drag to move, pinch or scroll to zoom, tap a star. Arrow keys move, plus and minus zoom, Enter picks the star in the middle."></canvas>
    <div class="gxTop">
      <button class="gxBtn" id="gxBack" aria-label="Close the galaxy">✕</button>
      <div class="gxTitle"><small id="gxCrumb">Galaxy</small><b id="gxName"></b></div>
      <button class="gxBtn" id="gxHome" aria-label="Go to your home world" title="Home world">🏠</button>
    </div>
    <div class="gxZoom" role="group" aria-label="Zoom"><button class="gxBtn" id="gxIn" aria-label="Zoom in">+</button><button class="gxBtn" id="gxOut" aria-label="Zoom out">−</button></div>
    <div class="gxLegend" aria-hidden="true">${Object.values(STAR_KINDS)
      .map((k) => `<span><i style="background:${k.color}"></i>${k.name}</span>`)
      .join("")}</div>
    <div class="gxScale" id="gxScale" aria-hidden="true"></div>
    <section class="gxSheet" id="gxSheet" hidden aria-live="polite"></section>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const $ = (q) => el.querySelector(q);
  const canvas = $(".gxCanvas");
  const ctx = canvas.getContext("2d");
  let W = 0,
    H = 0,
    dpr = 1;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }
  resize();
  window.addEventListener("resize", resize);

  /* ---- state ---- */
  let view = "galaxy"; // galaxy | system
  let selected = null; // star
  let sysStar = null;
  let selPlanet = null;
  const cam = { x: homeStar.x, y: homeStar.y, zoom: 3, tx: homeStar.x, ty: homeStar.y, tz: 3 };
  const base = () => Math.min(W, H) / 2.4;
  const toScreen = (x, y) => [(x - cam.x) * base() * cam.zoom + W / 2, (y - cam.y) * base() * cam.zoom + H / 2];

  /* ---- the galaxy's look: nebulae along the arms and far-off galaxies (drawn once) ---- */
  const neb = document.createElement("canvas");
  neb.width = neb.height = 768;
  {
    const c = neb.getContext("2d");
    const r = rng32(galaxy.seed ^ 0xabc);
    const hues = ["255,120,90", "90,150,255", "120,220,150", "190,120,255"];
    c.globalCompositeOperation = "lighter";
    const core = c.createRadialGradient(384, 384, 0, 384, 384, 150);
    core.addColorStop(0, "rgba(255,230,190,0.55)");
    core.addColorStop(1, "rgba(255,200,150,0)");
    c.fillStyle = core;
    c.fillRect(0, 0, 768, 768);
    for (let i = 0; i < 90; i++) {
      const s = galaxy.stars[Math.floor(r() * galaxy.stars.length)];
      const arm = Math.max(0, galaxy.arms.indexOf(s.sector));
      const x = 384 + s.x * 330,
        y = 384 + s.y * 330,
        rad = 20 + r() * 70;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${hues[arm]},${0.07 + r() * 0.08})`);
      g.addColorStop(1, `rgba(${hues[arm]},0)`);
      c.fillStyle = g;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  const far = [...Array(7)].map((_, i) => {
    const r = rng32(galaxy.seed + i * 977);
    return { x: r(), y: r(), s: 8 + r() * 18, a: r() * Math.PI, c: ["#c9b8ff", "#ffd2b8", "#b8e0ff"][i % 3] };
  });
  const dust = [...Array(160)].map((_, i) => {
    const r = rng32(galaxy.seed + 31 * i);
    return { x: r(), y: r(), a: 0.15 + r() * 0.35 };
  });
  const orbitStart = (p) => (rng32(p.surfaceSeed)() * TAU);

  /* ---- drawing ---- */
  let t0 = performance.now(),
    raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - t0) / 1000);
    t0 = now;
    const k = 1 - Math.exp(-dt * 9);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.zoom += (cam.tz - cam.zoom) * k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#04060f");
    bg.addColorStop(1, "#0b0a1c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    for (const d of dust) (ctx.fillStyle = `rgba(255,255,255,${d.a})`), ctx.fillRect(d.x * W, d.y * H, 1, 1);
    for (const f of far) {
      ctx.save();
      ctx.translate(f.x * W, f.y * H);
      ctx.rotate(f.a);
      ctx.scale(1, 0.4);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, f.s);
      g.addColorStop(0, f.c + "88");
      g.addColorStop(1, f.c + "00");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, f.s, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (view === "galaxy") drawGalaxy(now / 1000);
    else drawSystem(now / 1000);
  }
  function drawGalaxy(t) {
    const sz = base() * cam.zoom;
    // Nebulae, scaled with the map.
    ctx.globalAlpha = Math.min(1, 0.9 / Math.sqrt(cam.zoom) + 0.25);
    const [nx, ny] = toScreen(-1.164, -1.164);
    ctx.drawImage(neb, nx, ny, sz * 2.327, sz * 2.327);
    ctx.globalAlpha = 1;
    const labels = [];
    const pedia = S.pedia;
    for (const s of galaxy.stars) {
      const [x, y] = toScreen(s.x, s.y);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const kind = STAR_KINDS[s.kind];
      const r = Math.max(0.6, (0.5 + s.mag) * kind.size * Math.min(3.2, 0.55 + cam.zoom * 0.16));
      if (cam.zoom > 4 || s.kind === "blue") {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        g.addColorStop(0, kind.color + "66");
        g.addColorStop(1, kind.color + "00");
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      }
      ctx.fillStyle = kind.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      const known = pedia.entries["star:" + s.id];
      if (known) {
        ctx.strokeStyle = "#8ff0c9aa";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, TAU);
        ctx.stroke();
      }
      if ((cam.zoom > 9 && labels.length < 40) || s === homeStar || known) labels.push({ x, y: y + r + 12, text: S.nameFor("star:" + s.id, s.name), home: s === homeStar });
    }
    // Home and selection markers.
    const [hx, hy] = toScreen(homeStar.x, homeStar.y);
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 9, 0, TAU);
    ctx.stroke();
    if (selected) {
      const [sx, sy] = toScreen(selected.x, selected.y);
      const pulse = 12 + Math.sin(t * 5) * 2.5;
      ctx.strokeStyle = "#8ff0a8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, pulse, 0, TAU);
      ctx.stroke();
      if (selected !== homeStar) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "#ffffff44";
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.font = "600 11px 'Trebuchet MS',system-ui,sans-serif";
    ctx.textAlign = "center";
    for (const l of labels) {
      ctx.fillStyle = l.home ? "#ffe08a" : "#d8e6ee";
      ctx.fillText((l.home ? "🏠 " : "") + l.text, l.x, l.y);
    }
    // Scale bar.
    const ly = Math.round((GALAXY_LY * 100) / (base() * cam.zoom));
    $("#gxScale").textContent = "100 px ≈ " + ly.toLocaleString() + " light years";
  }
  const sysLayout = () => {
    const sys = S.system(sysStar.id);
    const maxO = Math.sqrt(sys.planets.at(-1)?.orbit || 1);
    const maxR = W < 760 ? Math.min(W * 0.44, (H * 0.62 - 90) / 2) : Math.min(W - 400, H) * 0.42;
    return { sys, rOf: (p) => 34 + (Math.sqrt(p.orbit) / maxO) * (maxR - 34) };
  };
  const planetSpots = [];
  function drawSystem(t) {
    const { sys, rOf } = sysLayout();
    const cx = W < 760 ? W / 2 : (W - 400) / 2,
      cy = W < 760 ? Math.min(H / 2, 64 + (H * 0.62 - 64) / 2) : H / 2;
    const kind = STAR_KINDS[sysStar.kind];
    const sr = 12 + kind.size * 10;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 3.2);
    g.addColorStop(0, kind.color);
    g.addColorStop(0.3, kind.color + "aa");
    g.addColorStop(1, kind.color + "00");
    ctx.fillStyle = g;
    ctx.fillRect(cx - sr * 3.2, cy - sr * 3.2, sr * 6.4, sr * 6.4);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, sr * 0.55, 0, TAU);
    ctx.fill();
    if (sys.companion) {
      const a = t * 0.6;
      ctx.fillStyle = sys.companion.color;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * sr * 1.3, cy + Math.sin(a) * sr * 1.3, sr * 0.4, 0, TAU);
      ctx.fill();
    }
    planetSpots.length = 0;
    ctx.font = "600 11px 'Trebuchet MS',system-ui,sans-serif";
    ctx.textAlign = "center";
    for (const p of sys.planets) {
      const r = rOf(p);
      ctx.strokeStyle = p === selPlanet ? "#8ff0a8aa" : "#ffffff22";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, TAU);
      ctx.stroke();
      // Inner planets move faster (a gentle Kepler).
      const a = orbitStart(p) + (t * 0.35) / Math.pow(p.orbit, 1.5);
      const px = cx + Math.cos(a) * r,
        py = cy + Math.sin(a) * r * 0.92;
      const size = Math.max(14, Math.min(46, 10 + p.radius * 5));
      const img = planetCanvas(p, 64);
      const pad = Number(img.dataset.pad) * (size / 64);
      ctx.drawImage(img, px - size / 2 - pad, py - size / 2 - pad, size + pad * 2, size + pad * 2);
      if (p === selPlanet) {
        ctx.strokeStyle = "#8ff0a8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, size / 2 + 6 + Math.sin(t * 5) * 2, 0, TAU);
        ctx.stroke();
      }
      const status = planetStatus(S.pedia, p.id);
      ctx.fillStyle = status === "undiscovered" ? "#9fb8c2" : "#e6f2f6";
      ctx.fillText((p.id === home.planetId ? "🏠 " : "") + S.nameFor("planet:" + p.id, p.name), px, py + size / 2 + 14);
      planetSpots.push({ p, x: px, y: py, r: size / 2 + 12 });
    }
  }
  raf = requestAnimationFrame(frame);

  /* ---- input ---- */
  const pointers = new Map();
  let gest = null;
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size === 1) gest = { moved: false, pinch: 0 };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gest.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gest.moved = true;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* gone */
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gest) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (view !== "galaxy") return;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gest.pinch > 0) zoomBy(d / gest.pinch);
      gest.pinch = d;
      return;
    }
    if (!gest.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8) return;
    gest.moved = true;
    cam.tx = cam.x -= dx / (base() * cam.zoom);
    cam.ty = cam.y -= dy / (base() * cam.zoom);
    clampCam();
  });
  const up = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p && gest && pointers.size === 0) {
      if (!gest.moved && e.type === "pointerup") tapAt(e.clientX, e.clientY);
      gest = null;
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (view === "galaxy") zoomBy(Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  function zoomBy(f) {
    cam.tz = Math.max(0.8, Math.min(70, cam.tz * f));
    cam.zoom = Math.max(0.8, Math.min(70, cam.zoom * f));
  }
  function clampCam() {
    const d = Math.hypot(cam.tx, cam.ty);
    if (d > 1.15) (cam.tx *= 1.15 / d), (cam.ty *= 1.15 / d);
  }
  function tapAt(sx, sy) {
    if (view === "galaxy") {
      let best = null,
        bd = 26;
      for (const s of galaxy.stars) {
        const [x, y] = toScreen(s.x, s.y);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd) (bd = d), (best = s);
      }
      if (best) selectStar(best);
      else closeSheet();
    } else {
      const hit = planetSpots.find((s) => Math.hypot(s.x - sx, s.y - sy) < s.r);
      if (hit) showPlanet(hit.p);
    }
  }
  const onKey = (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // the game underneath doesn't also see it
      back();
      return;
    }
    if (view !== "galaxy" || document.activeElement !== canvas) return;
    const step = 0.12 / cam.zoom;
    if (e.key === "ArrowLeft") cam.tx -= step;
    else if (e.key === "ArrowRight") cam.tx += step;
    else if (e.key === "ArrowUp") cam.ty -= step;
    else if (e.key === "ArrowDown") cam.ty += step;
    else if (e.key === "+" || e.key === "=") zoomBy(1.3);
    else if (e.key === "-") zoomBy(1 / 1.3);
    else if (e.key === "Enter") tapAt(W / 2, H / 2);
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey, true);
  $("#gxIn").onclick = () => zoomBy(1.5);
  $("#gxOut").onclick = () => zoomBy(1 / 1.5);
  $("#gxHome").onclick = () => {
    if (view === "system") toGalaxy();
    cam.tx = homeStar.x;
    cam.ty = homeStar.y;
    cam.tz = Math.max(cam.tz, 8);
    selectStar(homeStar);
  };
  $("#gxBack").onclick = back;
  function back() {
    if (!$("#gxSheet").hidden && sheetKind === "explore") return showPlanet(selPlanet);
    if (view === "system" && !$("#gxSheet").hidden && sheetKind === "planet") return (closeSheet(), (selPlanet = null));
    if (view === "system") return toGalaxy();
    if (!$("#gxSheet").hidden) return closeSheet();
    close();
  }

  /* ---- sheets ---- */
  let sheetKind = null;
  function setHeader() {
    $("#gxCrumb").textContent = view === "galaxy" ? "Galaxy · " + S.meta.name : (sysStar ? STAR_KINDS[sysStar.kind].name : "") + " system";
    $("#gxName").textContent = view === "galaxy" ? (selected ? S.nameFor("star:" + selected.id, selected.name) : "Choose a star") : S.nameFor("star:" + sysStar.id, sysStar.name);
    $("#gxBack").setAttribute("aria-label", view === "galaxy" ? "Close the galaxy" : "Back to the galaxy");
    $("#gxBack").textContent = view === "galaxy" ? "✕" : "←";
    el.classList.toggle("sys", view === "system");
  }
  function openSheet(kind, html) {
    sheetKind = kind;
    const sh = $("#gxSheet");
    sh.hidden = false;
    sh.className = "gxSheet " + kind;
    sh.innerHTML = html;
    sh.scrollTop = 0;
    sh.querySelector(".gxClose")?.addEventListener("click", back);
    setHeader();
  }
  function closeSheet() {
    $("#gxSheet").hidden = true;
    sheetKind = null;
    selected = view === "galaxy" ? null : selected;
    setHeader();
  }
  function renameRow(id, current) {
    return `<form class="gxRename" data-id="${esc(id)}" hidden><label><span class="sr">New name</span><input maxlength="32" value="${esc(current)}" autocomplete="off" spellcheck="false"></label><button type="submit" class="gxPrimary">Save</button></form>`;
  }
  function wireRename(sh, after) {
    const btn = sh.querySelector("[data-rename]"),
      form = sh.querySelector(".gxRename");
    if (!btn || !form) return;
    btn.onclick = () => {
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector("input").select();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      rename(S.pedia, form.dataset.id, form.querySelector("input").value);
      S.save();
      o.sfx?.("click");
      after();
    };
  }
  function selectStar(s) {
    selected = s;
    const sys = S.system(s.id);
    const known = S.pedia.entries["star:" + s.id];
    const kind = STAR_KINDS[s.kind];
    const dist = lightYears(s, homeStar);
    openSheet(
      "star",
      `<div class="gxHead"><span class="gxDot" style="background:${kind.color}"></span><div><b>${esc(S.nameFor("star:" + s.id, s.name))}</b><small>${kind.name} · ${esc(s.sector)}</small></div>${known ? `<button class="gxBtn sm" data-rename aria-label="Rename this star">✎</button>` : ""}<button class="gxBtn sm gxClose" aria-label="Close">✕</button></div>
      ${known ? renameRow("star:" + s.id, S.nameFor("star:" + s.id, s.name)) : ""}
      <div class="gxStats"><span><b>${sys.planets.length}</b>planet${sys.planets.length === 1 ? "" : "s"}</span><span><b>${s === homeStar ? "Home" : dist.toLocaleString()}</b>${s === homeStar ? "your star" : "light years"}</span><span><b>${known ? "Visited" : "Unknown"}</b>status</span></div>
      <div class="gxRow">${sys.planets.map((p) => `<img src="${planetImage(p, 48)}" alt="${esc(PLANET_TYPES[p.type].name)} planet" width="40" height="40">`).join("")}</div>
      <button class="gxPrimary wide" id="gxOpenSys">Open the system</button>`,
    );
    wireRename($("#gxSheet"), () => selectStar(s));
    $("#gxOpenSys").onclick = () => openSystem(s);
    o.sfx?.("click");
  }
  function openSystem(s) {
    sysStar = s;
    view = "system";
    selPlanet = null;
    S.visitStar(s);
    closeSheet();
    canvas.setAttribute("aria-label", "The " + s.name + " system: tap a planet. Its planets are also listed below.");
    // An accessible list of the planets, below the picture.
    openSheet(
      "list",
      `<div class="gxHead"><div><b>Planets</b><small>Tap a planet on its orbit, or pick it here</small></div></div><div class="gxList">${S.system(s.id)
        .planets.map((p) => `<button data-planet="${esc(p.id)}"><img src="${planetImage(p, 48)}" alt="" width="36" height="36"><span><b>${esc(S.nameFor("planet:" + p.id, p.name))}</b><small>${PLANET_TYPES[p.type].name} · ${STATUS_LABEL[planetStatus(S.pedia, p.id)]}</small></span></button>`)
        .join("")}</div>`,
    );
    el.querySelectorAll("[data-planet]").forEach((b) => (b.onclick = () => showPlanet(S.planet(b.dataset.planet))));
    o.sfx?.("unlock");
  }
  function toGalaxy() {
    view = "galaxy";
    selPlanet = null;
    canvas.setAttribute("aria-label", "Galaxy map: drag to move, pinch or scroll to zoom, tap a star.");
    if (sysStar) selectStar(sysStar);
    else closeSheet();
  }
  function showPlanet(p) {
    selPlanet = p;
    S.visitPlanet(p);
    const st = planetStatus(S.pedia, p.id);
    const isHome = p.id === home.planetId;
    const name = S.nameFor("planet:" + p.id, p.name);
    const row = (k, v) => `<div><span>${k}</span><b>${esc(v)}</b></div>`;
    openSheet(
      "planet",
      `<div class="gxHead"><div><b>${esc(name)}${isHome ? " · 🏠 Home world" : ""}</b><small>${PLANET_TYPES[p.type].icon} ${PLANET_TYPES[p.type].name} · <em class="gxStatus ${st}">${STATUS_LABEL[st]}</em></small></div><button class="gxBtn sm" data-rename aria-label="Rename this planet">✎</button><button class="gxBtn sm gxClose" aria-label="Back to the system">✕</button></div>
      ${renameRow("planet:" + p.id, name)}
      <div class="gxPlanetPic"><img src="${planetImage(p, 200)}" alt="${esc(name)}: a ${PLANET_TYPES[p.type].name.toLowerCase()} planet" width="200"></div>
      <div class="gxGrid">
        ${row("Star system", S.nameFor("star:" + sysStar.id, sysStar.name))}${row("Habitability", p.habitability)}
        ${row("Temperature", p.temp + " °C")}${row("Gravity", p.gravity + " g")}
        ${row("Atmosphere", p.atmosphere)}${row("Water", Math.round(p.water * 100) + "%")}
        ${row("Life", p.biodiversity ? Math.round(p.biodiversity * 100) + "% diverse" : "None")}${row("Moons", p.moons + (p.rings ? " · rings" : ""))}
        ${row("Resources", p.resources.join(", ") || "None")}${row("Danger", p.hazards.join(", ") || "Safe")}
      </div>
      <div class="gxBtns"><button class="gxPrimary" id="gxExplore">🔭 Explore</button><button class="gxSecondary" id="gxPedia">📖 Sporepedia</button></div>`,
    );
    wireRename($("#gxSheet"), () => showPlanet(p));
    $("#gxExplore").onclick = () => showExplore(p);
    $("#gxPedia").onclick = () => o.openEntry("planet:" + p.id);
    o.sfx?.("click");
  }
  let surveying = false;
  function showExplore(p) {
    const found = S.found(p);
    const total = S.surveyList(p).length;
    const done = found.length >= total;
    const name = S.nameFor("planet:" + p.id, p.name);
    const icon = (x) =>
      x.kind === "landmark"
        ? `<span class="gxIcon" aria-hidden="true">🗺</span>`
        : x.kind === "plant"
          ? `<img src="${plantImage(x, 64)}" alt="" width="44" height="44">`
          : `<img data-thumb="${esc(x.id)}" alt="" width="44" height="44">`;
    openSheet(
      "explore",
      `<div class="gxHead"><img src="${planetImage(p, 48)}" alt="" width="40" height="40"><div><b>Exploring ${esc(name)}</b><small>${done ? "Fully catalogued ✓" : found.length + " found" + (p.biodiversity ? "" : " · no life here")}</small></div><button class="gxBtn sm gxClose" aria-label="Back to the planet">✕</button></div>
      <button class="gxPrimary wide" id="gxSurvey" ${done ? "disabled" : ""}><span>${done ? "Nothing left to find" : "🔭 Survey the surface"}</span><i class="gxProg"><b></b></i></button>
      <div class="gxFound">${
        found.length
          ? found
              .map(
                (x) =>
                  `<button class="gxItem ${x.rarity === "Rare" ? "rare" : ""}" data-entry="${esc(entryId(x))}">${icon(x)}<span><b>${esc(S.nameFor(entryId(x), x.kind === "landmark" ? x.name[0].toUpperCase() + x.name.slice(1) : x.name))}</b><small>${x.kind === "landmark" ? "Landmark" : x.kind === "plant" ? x.type + " · " + x.habitat : x.role + " · " + x.habitat}${x.rarity === "Rare" ? " · Rare" : ""}</small></span></button>`,
              )
              .join("")
          : `<p class="gxEmpty">Survey the surface to discover its landmarks${p.biodiversity ? ", plants and creatures" : ""}.</p>`
      }</div>`,
    );
    el.querySelectorAll("[data-entry]").forEach((b) => (b.onclick = () => o.openEntry(b.dataset.entry)));
    // Creature portraits, drawn one at a time so the list appears at once.
    const eco = S.ecosystem(p);
    const pending = [...el.querySelectorAll("img[data-thumb]")];
    const drawNext = () => {
      const img = pending.shift();
      if (!img || !img.isConnected) return;
      const sp = eco.species.find((s) => s.id === img.dataset.thumb);
      const url = sp && o.portrait?.(sp.record);
      if (url) img.src = url;
      setTimeout(drawNext, 16);
    };
    drawNext();
    $("#gxSurvey").onclick = () => {
      if (surveying || done) return;
      surveying = true;
      const btn = $("#gxSurvey");
      btn.classList.add("busy");
      btn.setAttribute("aria-busy", "true");
      o.sfx?.("click");
      setTimeout(() => {
        surveying = false;
        const next = S.survey(p);
        if (next) o.sfx?.(next.rarity === "Rare" ? "unlock" : "eat");
        if (el.isConnected && sheetKind === "explore" && selPlanet === p) showExplore(p);
      }, 1100);
    };
  }
  function close() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    document.removeEventListener("keydown", onKey, true);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
    o.onClose?.();
  }
  setHeader();
  canvas.focus({ preventScroll: true });
  // Open on a star or planet if asked (the Sporepedia's "show in galaxy").
  if (o.focus?.planetId) {
    const p = S.planet(o.focus.planetId);
    if (p) {
      const star = galaxy.stars[p.starId];
      cam.x = cam.tx = star.x;
      cam.y = cam.ty = star.y;
      openSystem(star);
      showPlanet(p);
    }
  } else if (o.focus?.starId !== undefined) selectStar(galaxy.stars[o.focus.starId]);
  return {
    close,
    debug: { cam, selectStar, openSystem, showPlanet, showExplore, toGalaxy, galaxy, get view() {
      return view;
    } },
  };
}
