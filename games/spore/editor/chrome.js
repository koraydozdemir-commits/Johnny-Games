/**
 * Shared editor chrome: the parts drawer, confirmations, first-time tips, the save indicator, the
 * camera easing and the iOS viewport fixes. Each editor builds its own panels; these pieces make
 * them behave the same way everywhere.
 */

export const reducedMotion = () => document.body.classList.contains("reducedMotion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
export const coarsePointer = () => matchMedia("(pointer: coarse)").matches;
/** Phone layout: narrow, or a phone on its side (short). */
export const phoneLayout = () => innerWidth < 640 || (innerHeight < 500 && innerWidth < 1000);

/** Play a one-off CSS animation class on an element (skipped with reduced motion). */
export function pulse(el, cls = "edPop") {
  if (!el || reducedMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

/**
 * Keep CSS in step with the real visible area. iOS Safari's toolbars grow and shrink and the
 * keyboard covers the page without resizing it; visualViewport knows, so --ed-vh follows it.
 * Returns a cleanup function.
 */
export function trackViewport(root, onChange) {
  const vv = window.visualViewport;
  const apply = () => {
    const h = vv ? vv.height : innerHeight;
    root.style.setProperty("--ed-vh", h + "px");
    // The keyboard is up when the visible area is much shorter than the window.
    root.classList.toggle("edKeyboard", !!vv && innerHeight - vv.height > 140);
    onChange?.();
  };
  apply();
  vv?.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    window.removeEventListener("resize", apply);
  };
}

/**
 * Stop the browser's own gestures (pinch-zoom of the page, double-tap zoom, text selection, iOS
 * callouts) while an editor is open, and only then. Returns a cleanup function.
 */
export function guardPageGestures(root) {
  const stop = (e) => e.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  // Double-tap zoom on old iOS: a second touchend in quick succession on the editor.
  let last = 0;
  const dbl = (e) => {
    const t = performance.now();
    if (t - last < 320 && !e.target.closest?.("input,textarea,select")) e.preventDefault();
    last = t;
  };
  root.addEventListener("touchend", dbl, { passive: false });
  document.documentElement.classList.add("edOpen");
  return () => {
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.removeEventListener(t, stop));
    root.removeEventListener("touchend", dbl);
    document.documentElement.classList.remove("edOpen");
  };
}

/**
 * The parts drawer on phones: a sheet with a grab handle that rests at "peek" (just the category
 * row), "half" or "full". Drag the handle (or the sheet's header) to resize, flick down to tuck it
 * away, tap the handle to toggle. The current state is a class on the panel and is remembered.
 * Opening or closing never touches the selection.
 */
export function makeDrawer(panel, o = {}) {
  const STATES = ["peek", "half", "full"];
  const key = "johnny-spore-editor-drawer";
  let state = o.initial || "half";
  try {
    const saved = localStorage.getItem(key);
    if (STATES.includes(saved) && saved !== "full") state = saved;
  } catch (e) {
    /* default */
  }
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "edHandle";
  handle.setAttribute("aria-label", "Resize the parts drawer");
  handle.innerHTML = "<i></i>";
  panel.prepend(handle);
  const heights = () => ({ peek: o.peek?.() ?? 118, half: Math.round((o.vh?.() ?? innerHeight) * 0.42), full: Math.round((o.vh?.() ?? innerHeight) * 0.86) });
  function set(s, silent) {
    state = s;
    STATES.forEach((x) => panel.classList.toggle("ed-" + x, x === s));
    panel.style.removeProperty("--ed-drag-h");
    handle.setAttribute("aria-expanded", String(s !== "peek"));
    try {
      localStorage.setItem(key, s);
    } catch (e) {
      /* fine */
    }
    if (!silent) o.onChange?.(s);
  }
  let drag = null;
  const down = (e) => {
    if (!o.active?.()) return;
    drag = { id: e.pointerId, y0: e.clientY, h0: panel.getBoundingClientRect().height, t0: performance.now(), moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      /* fine */
    }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    e.preventDefault();
    const hs = heights();
    panel.style.setProperty("--ed-drag-h", Math.max(hs.peek * 0.8, Math.min(hs.full, drag.h0 - dy)) + "px");
    panel.classList.add("ed-dragging");
  };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    panel.classList.remove("ed-dragging");
    if (!d.moved) {
      if (e.currentTarget === handle) set(state === "peek" ? "half" : state === "half" ? "full" : "half");
      return;
    }
    const h = panel.getBoundingClientRect().height;
    const v = (e.clientY - d.y0) / Math.max(1, performance.now() - d.t0); // px per ms, down is positive
    const hs = heights();
    let next = STATES.reduce((best, s) => (Math.abs(hs[s] - h) < Math.abs(hs[best] - h) ? s : best), "half");
    if (v > 0.6) next = state === "full" ? "half" : "peek"; // a flick down tucks it away
    else if (v < -0.6) next = state === "peek" ? "half" : "full";
    set(next);
  };
  const grips = [handle, ...(o.grips || [])];
  grips.forEach((g) => {
    g.addEventListener("pointerdown", down);
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  });
  set(state, true);
  return {
    get state() {
      return state;
    },
    set,
    handle,
  };
}

/**
 * A confirmation inside the editor (never the browser's own dialog). Resolves true or false.
 * @param {HTMLElement} root
 * @param {{ title: string, text?: string, ok?: string, cancel?: string, danger?: boolean }} o
 */
export function confirmBox(root, o) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "edModal";
    back.innerHTML = `<div class="edDialog" role="alertdialog" aria-modal="true" aria-labelledby="edDlgT"><h3 id="edDlgT"></h3><p></p><div class="edDlgBtns"><button type="button" data-v="0"></button><button type="button" data-v="1" class="${o.danger ? "danger" : "primary"}"></button></div></div>`;
    back.querySelector("h3").textContent = o.title;
    back.querySelector("p").textContent = o.text || "";
    back.querySelector("p").hidden = !o.text;
    back.querySelector('[data-v="0"]').textContent = o.cancel || "Cancel";
    back.querySelector('[data-v="1"]').textContent = o.ok || "OK";
    root.appendChild(back);
    const prev = document.activeElement;
    const done = (v) => {
      back.remove();
      document.removeEventListener("keydown", key, true);
      prev?.focus?.({ preventScroll: true });
      resolve(v);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };
    document.addEventListener("keydown", key, true);
    back.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v === "1")));
    back.onclick = (e) => e.target === back && done(false);
    back.querySelector('[data-v="1"]').focus({ preventScroll: true });
  });
}

/* ---- first-time tips ------------------------------------------------------------------- */
const TIPS_KEY = "johnny-spore-editor-tips";
const tipsState = () => {
  try {
    return JSON.parse(localStorage.getItem(TIPS_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
};
export const tipsSeen = (id) => !!tipsState()[id] || !!tipsState().off;
function markTips(id, all = false) {
  try {
    const s = tipsState();
    s[id] = 1;
    if (all) s.off = 1;
    localStorage.setItem(TIPS_KEY, JSON.stringify(s));
  } catch (e) {
    /* fine */
  }
}
/**
 * A short walkthrough the first time an editor opens: a card per step, with touch or mouse wording.
 * Skip ends it; "Don't show tips" turns them off for every editor. `force` shows them again (Help).
 * @param {HTMLElement} root
 * @param {string} id
 * @param {{ title: string, touch: string, mouse?: string }[]} steps
 */
export function showTips(root, id, steps, force = false) {
  if (!force && tipsSeen(id)) return null;
  root.querySelector(".edTips")?.remove();
  const touch = coarsePointer();
  let i = 0;
  const card = document.createElement("div");
  card.className = "edTips";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Editor tips");
  const render = () => {
    const s = steps[i];
    card.innerHTML = `<div class="edTipDots" aria-hidden="true">${steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      <h4></h4><p></p>
      <div class="edTipBtns"><button type="button" data-a="off">Don't show tips</button><span></span><button type="button" data-a="next" class="primary">${i < steps.length - 1 ? "Next" : "Got it"}</button></div>`;
    card.querySelector("h4").textContent = s.title;
    card.querySelector("p").textContent = touch || !s.mouse ? s.touch : s.mouse;
    card.querySelector('[data-a="next"]').onclick = () => {
      if (++i >= steps.length) return close();
      render();
    };
    card.querySelector('[data-a="off"]').onclick = () => close(true);
  };
  const close = (all) => {
    markTips(id, all);
    card.remove();
  };
  render();
  root.appendChild(card);
  return { close };
}

/* ---- camera ---------------------------------------------------------------------------- */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * Ease an orbit toward a goal ({ yaw?, pitch?, dist?, pan? }), taking the short way round. Returns
 * true while still moving. Any manual camera move should clear the goal.
 */
export function easeOrbit(orbit, goal, dt) {
  if (!goal) return false;
  const k = reducedMotion() ? 1 : Math.min(1, dt * 7);
  let moving = false;
  if (goal.yaw !== undefined) {
    const d = wrap(goal.yaw - orbit.yaw);
    orbit.yaw += d * k;
    moving ||= Math.abs(d) > 0.002;
  }
  for (const key of ["pitch", "dist"]) {
    if (goal[key] === undefined) continue;
    const d = goal[key] - orbit[key];
    orbit[key] += d * k;
    moving ||= Math.abs(d) > 0.002;
  }
  if (goal.pan && orbit.pan) {
    for (const a of ["x", "y", "z"]) {
      const d = goal.pan[a] - orbit.pan[a];
      orbit.pan[a] += d * k;
      moving ||= Math.abs(d) > 0.002;
    }
  }
  return moving;
}

/** A floating "saved" / "unsaved" badge with an accessible live label. */
export function saveBadge(el) {
  let state = "";
  return {
    set(s, text) {
      if (s === state && !text) return;
      state = s;
      el.className = "edSaveState " + s;
      el.textContent = text || { clean: "No changes", dirty: "Unsaved", draft: "Draft kept", saved: "Saved" }[s] || "";
      el.title = { clean: "Nothing changed yet", dirty: "Changes not saved yet", draft: "Your changes are kept as a draft. Save to keep them for good.", saved: "Saved" }[s] || "";
    },
  };
}
