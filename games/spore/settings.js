/**
 * Settings: sound volumes, reduced motion, graphics quality and save slots, in one panel that works
 * in both stages. Settings are shared by every save slot.
 */

export const SETTINGS_KEY = "johnny-spore-settings";

const prefersReducedMotion = () => typeof window !== "undefined" && !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : d);

/** @returns {{ sfx:number, ambience:number, reducedMotion:boolean }} */
export function loadSettings(store) {
  let raw = null;
  try {
    raw = JSON.parse(store.getItem(SETTINGS_KEY) || "null");
  } catch (e) {
    raw = null;
  }
  return {
    sfx: clamp01(raw?.sfx, 0.85),
    ambience: clamp01(raw?.ambience, 0.7),
    reducedMotion: typeof raw?.reducedMotion === "boolean" ? raw.reducedMotion : prefersReducedMotion(),
  };
}
export function saveSettings(store, s) {
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify({ sfx: s.sfx, ambience: s.ambience, reducedMotion: s.reducedMotion }));
  } catch (e) {
    /* storage unavailable: settings last for this visit */
  }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function timeAgo(when, now = Date.now()) {
  if (!when) return "";
  const s = Math.max(0, (now - when) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  const d = Math.floor(s / 86400);
  return d + (d === 1 ? " day ago" : " days ago");
}

/**
 * Open the settings panel.
 * @param {object} o
 * @param {Storage} o.store
 * @param {{ sfx:number, ambience:number, reducedMotion:boolean }} o.settings  edited in place
 * @param {(s:object) => void} o.onChange      called on every change (apply and save)
 * @param {string[]} o.qualities
 * @param {() => string} o.getQuality
 * @param {(q:string) => void} o.onQuality
 * @param {(screen:"universes"|"galaxy"|"pedia"|"title") => void} o.onOpen  open one of the universe screens, or the main menu
 * @param {{ enabled:()=>boolean, set:(on:boolean)=>void, actions:()=>{group:string,label:string,run:()=>void}[] }} [o.dev]
 *   developer mode: tapping the credits seven times switches it; its tools then show here
 * @param {() => void} [o.onClose]
 */
export function openSettings(o) {
  document.querySelector(".settingsScreen")?.remove();
  const before = document.activeElement;
  const el = document.createElement("div");
  el.className = "settingsScreen";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "settingsTitle");
  const s = o.settings;
  const pct = (v) => Math.round(v * 100) + "%";
  el.innerHTML = `
    <div class="settingsPanel">
      <div class="spHead"><h2 id="settingsTitle">Settings</h2><button class="spClose" aria-label="Close settings">✕</button></div>
      <section aria-labelledby="spSound"><h3 id="spSound">Sound</h3>
        <label class="spRange"><span>Effects</span><input type="range" min="0" max="100" step="5" id="spSfx" value="${Math.round(s.sfx * 100)}"><output for="spSfx">${pct(s.sfx)}</output></label>
        <label class="spRange"><span>Ambience</span><input type="range" min="0" max="100" step="5" id="spAmb" value="${Math.round(s.ambience * 100)}"><output for="spAmb">${pct(s.ambience)}</output></label>
      </section>
      <section aria-labelledby="spView"><h3 id="spView">Display</h3>
        <label class="spSwitch"><span>Reduced motion<small>Calmer camera, no screen shake, gentler effects</small></span><input type="checkbox" role="switch" id="spMotion" ${s.reducedMotion ? "checked" : ""}><i aria-hidden="true"></i></label>
        <div class="spRow"><span>Graphics</span><div class="spSeg" role="radiogroup" aria-label="Graphics quality">${o.qualities
          .map((q) => `<button role="radio" data-q="${q}" aria-checked="${q === o.getQuality()}">${q[0].toUpperCase() + q.slice(1)}</button>`)
          .join("")}</div></div>
      </section>
      <section aria-labelledby="spSlots"><h3 id="spSlots">Universe</h3><div class="spOpen">
        <button data-open="universes"><span aria-hidden="true">🪐</span>Universes<small>Saves: switch, create, copy, export, import</small></button>
        <button data-open="galaxy"><span aria-hidden="true">🌌</span>Galaxy<small>Explore stars and planets</small></button>
        <button data-open="pedia"><span aria-hidden="true">📖</span>Sporepedia<small>Everything you've made and found</small></button>
        <button data-open="title"><span aria-hidden="true">✦</span>Main menu<small>Save and go back to the galaxy</small></button>
      </div></section>
      <section class="spDev" id="spDev" aria-labelledby="spDevTitle" hidden></section>
      <button class="spCredits" type="button" id="spCredits">Johnny Spore · a Johnny Games project · made with three.js</button>
    </div>`;
  document.body.appendChild(el);
  const $ = (q) => el.querySelector(q);

  const slider = (id, key) => {
    const input = $(id);
    input.oninput = () => {
      s[key] = Number(input.value) / 100;
      input.nextElementSibling.textContent = pct(s[key]);
      o.onChange(s);
    };
  };
  slider("#spSfx", "sfx");
  slider("#spAmb", "ambience");
  $("#spMotion").onchange = (e) => {
    s.reducedMotion = e.target.checked;
    o.onChange(s);
  };
  el.querySelectorAll(".spSeg button").forEach((b) => {
    b.onclick = () => {
      o.onQuality(b.dataset.q);
      el.querySelectorAll(".spSeg button").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.q === o.getQuality())));
    };
  });

  /* Developer tools: shown once developer mode is on. Seven quick taps on the credits switch it. */
  const devBox = $("#spDev");
  const renderDev = () => {
    const on = !!o.dev?.enabled();
    devBox.hidden = !on;
    if (!on) return (devBox.innerHTML = "");
    const groups = {};
    for (const a of o.dev.actions()) (groups[a.group] ||= []).push(a);
    const all = Object.values(groups).flat();
    devBox.innerHTML =
      '<h3 id="spDevTitle">Developer</h3>' +
      Object.entries(groups)
        .map(([g, list]) => `<div class="spDevGroup"><small>${g}</small><div>${list.map((a) => `<button data-dev="${all.indexOf(a)}">${a.label}</button>`).join("")}</div></div>`)
        .join("") +
      '<button class="spDevOff" id="spDevOff">Turn off developer mode</button>';
    devBox.querySelectorAll("[data-dev]").forEach(
      (b) =>
        (b.onclick = () => {
          const act = all[Number(b.dataset.dev)];
          close();
          setTimeout(() => act.run(), 260);
        }),
    );
    $("#spDevOff").onclick = () => {
      o.dev.set(false);
      renderDev();
    };
  };
  if (o.dev) {
    renderDev();
    let taps = 0,
      last = 0;
    $("#spCredits").onclick = () => {
      // Seven taps in a row, each within a second and a half of the last.
      const now = performance.now();
      taps = now - last < 1500 ? taps + 1 : 1;
      last = now;
      if (taps < 7) return;
      taps = 0;
      o.dev.set(!o.dev.enabled());
      renderDev();
      $("#spCredits").classList.add("tapped");
      setTimeout(() => $("#spCredits").classList.remove("tapped"), 600);
    };
  }

  /* Universes, the galaxy and the Sporepedia have their own screens: settings just opens them. */
  el.querySelectorAll("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        close();
        setTimeout(() => o.onOpen?.(b.dataset.open), 240);
      }),
  );

  const close = () => {
    el.classList.remove("show");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => el.remove(), 220);
    if (before && before.focus) before.focus();
    o.onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      // Keep focus inside the panel.
      const items = [...el.querySelectorAll("button, input")].filter((x) => !x.disabled);
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    }
  };
  document.addEventListener("keydown", onKey, true);
  $(".spClose").onclick = close;
  el.addEventListener("pointerdown", (e) => e.target === el && close());
  requestAnimationFrame(() => el.classList.add("show"));
  $(".spClose").focus();
  return { close };
}
