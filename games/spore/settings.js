/**
 * Settings: sound volumes, reduced motion, graphics quality and save slots, in one panel that works
 * in both stages. Settings are shared by every save slot.
 */
import { SLOT_COUNT, clearSlot, slotSummary } from "./slots.js";

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

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Open the settings panel.
 * @param {object} o
 * @param {Storage} o.store
 * @param {{ sfx:number, ambience:number, reducedMotion:boolean }} o.settings  edited in place
 * @param {(s:object) => void} o.onChange      called on every change (apply and save)
 * @param {string[]} o.qualities
 * @param {() => string} o.getQuality
 * @param {(q:string) => void} o.onQuality
 * @param {(slot:number) => void} o.onSwitchSlot  save the game in play, switch and reload
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
      <section aria-labelledby="spSlots"><h3 id="spSlots">Save slots</h3><div class="spSlots" id="spSlotList"></div></section>
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

  /* Slots: play another one (saves this one first), or delete one with a second tap to confirm. */
  function renderSlots() {
    const list = $("#spSlotList");
    list.innerHTML = "";
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const sum = slotSummary(o.store, n);
      const row = document.createElement("div");
      row.className = "spSlot" + (sum.active ? " active" : "") + (sum.empty ? " empty" : "");
      row.innerHTML =
        `<div class="spSlotInfo"><b>Slot ${n}</b><span>${esc(sum.label)}</span>${sum.savedAt ? `<small>Saved ${esc(timeAgo(sum.savedAt))}</small>` : ""}</div>` +
        (sum.active ? `<em class="spPlaying">Playing</em>` : `<button class="spPlay" data-slot="${n}">${sum.empty ? "New game" : "Play"}</button>`) +
        (sum.empty ? "" : `<button class="spDelete" data-slot="${n}" aria-label="Delete slot ${n}">Delete</button>`);
      list.appendChild(row);
    }
    list.querySelectorAll(".spPlay").forEach((b) => (b.onclick = () => o.onSwitchSlot(Number(b.dataset.slot))));
    list.querySelectorAll(".spDelete").forEach((b) => {
      b.onclick = () => {
        if (!b.classList.contains("confirm")) {
          b.classList.add("confirm");
          b.textContent = "Delete?";
          setTimeout(() => {
            if (b.isConnected) {
              b.classList.remove("confirm");
              b.textContent = "Delete";
            }
          }, 3000);
          return;
        }
        const n = Number(b.dataset.slot);
        const wasActive = slotSummary(o.store, n).active;
        clearSlot(o.store, n);
        // Deleting the game in play starts over.
        if (wasActive) location.reload();
        else renderSlots();
      };
    });
  }
  renderSlots();

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
