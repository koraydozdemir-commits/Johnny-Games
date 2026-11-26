/**
 * One pointer system for every 3D editor viewport (Pointer Events, so mouse, pen and touch share it).
 *
 * It decides what a gesture means before anything moves, so a gesture is never two things at once:
 *   - one finger (or the left mouse button) that starts on something grabbable drags that thing;
 *   - one finger that starts on empty space turns the camera (orbit);
 *   - two fingers pinch to zoom and move together to pan; adding a second finger ends a part drag
 *     first, so a pinch can never move a part;
 *   - right or middle mouse button, or Shift + drag, pans; the wheel zooms;
 *   - a short touch without moving is a tap, two quick taps on the same thing a double tap, and a
 *     touch held still for half a second a long press.
 * Anything that interrupts a gesture (the finger leaving the screen edge, a browser gesture, the
 * window losing focus, a pointer being cancelled) ends it cleanly, so a part is never left "held".
 *
 * The editor supplies `hit(x, y, pointerType)`: what is under a point (or null), and callbacks.
 * Everything is removed again by `detach()`.
 */

/**
 * @param {HTMLElement} el
 * @param {object} h
 * @param {(x:number, y:number, type:string) => any} [h.hit]   a grabbable target, or null for empty space
 * @param {(target:any) => boolean} [h.canDrag]  whether a target can be dragged (default: any target)
 * @param {(x:number, y:number, target:any, e:Event) => void} [h.tap]
 * @param {(x:number, y:number, target:any) => void} [h.doubleTap]
 * @param {(x:number, y:number, target:any) => void} [h.longPress]
 * @param {(target:any, x:number, y:number, e:Event) => void} [h.dragStart]
 * @param {(target:any, x:number, y:number, e:Event) => void} [h.drag]
 * @param {(target:any, cancelled:boolean) => void} [h.dragEnd]
 * @param {(dx:number, dy:number) => void} [h.orbit]
 * @param {(dx:number, dy:number) => void} [h.pan]
 * @param {(factor:number) => void} [h.zoom]   >1 zooms in
 * @param {(x:number, y:number) => void} [h.down]  any first touch (e.g. to end a preview)
 * @param {object} [opts]
 */
export function attachGestures(el, h, opts = {}) {
  const now = opts.now || (() => performance.now());
  const setTimer = opts.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
  const LONG = opts.longPressMs ?? 480;
  const DOUBLE = opts.doubleTapMs ?? 320;
  const pointers = new Map();
  /** phase: idle | pending (down, not moved yet) | drag | orbit | pan | two | settle (one finger left after two) */
  let g = { phase: "idle" };
  let lastTap = null;
  let longTimer = null;
  const slop = (type) => (type === "mouse" ? 4 : 9);
  const clearLong = () => {
    if (longTimer) clearTimer(longTimer);
    longTimer = null;
  };
  const capture = (e) => {
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* the pointer is already gone */
    }
  };
  const endDrag = (cancelled) => {
    if (g.phase === "drag") {
      const t = g.target;
      g = { phase: "idle" };
      h.dragEnd?.(t, cancelled);
    }
  };
  const two = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  function down(e) {
    if (e.button > 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType || "mouse" });
    capture(e);
    if (pointers.size === 1) {
      h.down?.(e.clientX, e.clientY);
      const panButton = e.pointerType === "mouse" && (e.button === 1 || e.button === 2 || e.shiftKey);
      const target = panButton ? null : h.hit?.(e.clientX, e.clientY, e.pointerType || "mouse") ?? null;
      g = { phase: "pending", id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, target, type: e.pointerType || "mouse", pan: panButton, t0: now() };
      clearLong();
      if (!panButton && h.longPress)
        longTimer = setTimer(() => {
          longTimer = null;
          if (g.phase !== "pending") return;
          g.phase = "held"; // a long press is not also a tap or a drag
          h.longPress(g.x, g.y, g.target);
        }, LONG);
    } else if (pointers.size === 2) {
      // A second finger: whatever one finger was doing ends, and the camera takes over.
      clearLong();
      endDrag(false);
      const t = two();
      g = { phase: "two", d: t.d, mx: t.mx, my: t.my };
    }
    if (e.cancelable && e.pointerType !== "mouse") e.preventDefault();
  }
  function move(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (g.phase === "two" && pointers.size >= 2) {
      const t = two();
      h.zoom?.(t.d / g.d);
      h.pan?.(t.mx - g.mx, t.my - g.my);
      g.d = t.d;
      g.mx = t.mx;
      g.my = t.my;
      return;
    }
    if (e.pointerId !== g.id) {
      if (g.phase === "settle") g = { phase: "orbit", id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (g.phase === "pending") {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < slop(g.type)) return;
      clearLong();
      if (g.pan) g.phase = "pan";
      else if (g.target != null && (h.canDrag ? h.canDrag(g.target) : true)) {
        g.phase = "drag";
        h.dragStart?.(g.target, g.x0, g.y0, e);
      } else g.phase = "orbit";
    }
    if (g.phase === "drag") h.drag?.(g.target, e.clientX, e.clientY, e);
    else if (g.phase === "orbit") h.orbit?.(dx, dy);
    else if (g.phase === "pan") h.pan?.(dx, dy);
    g.x = e.clientX;
    g.y = e.clientY;
    if (e.cancelable && g.phase !== "pending") e.preventDefault();
  }
  function up(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const cancelled = e.type === "pointercancel" || e.type === "lostpointercapture";
    if (g.phase === "two") {
      // One finger stays down: let it settle rather than jump into an orbit.
      g = pointers.size ? { phase: "settle" } : { phase: "idle" };
      return;
    }
    if (e.pointerId !== g.id) return;
    clearLong();
    if (g.phase === "drag") endDrag(cancelled);
    else if (g.phase === "pending" && !cancelled) {
      const t = now();
      const same = lastTap && t - lastTap.t < DOUBLE && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30 && sameTarget(lastTap.target, g.target);
      if (same && h.doubleTap) {
        lastTap = null;
        h.doubleTap(e.clientX, e.clientY, g.target);
      } else {
        lastTap = { t, x: e.clientX, y: e.clientY, target: g.target };
        h.tap?.(e.clientX, e.clientY, g.target, e);
      }
    }
    g = { phase: "idle" };
  }
  const sameTarget = (a, b) => (a == null && b == null) || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
  function wheel(e) {
    e.preventDefault();
    // Trackpad pinches arrive as ctrl+wheel with small deltas; mice as big steps.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    h.zoom?.(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * k * (e.ctrlKey ? 1 : 6)));
  }
  /** Stop everything (window lost focus, editor closing). */
  function reset() {
    clearLong();
    endDrag(true);
    pointers.clear();
    g = { phase: "idle" };
  }
  const menu = (e) => e.preventDefault();
  const blur = () => reset();
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("contextmenu", menu);
  if (typeof window !== "undefined") window.addEventListener("blur", blur);
  return {
    detach() {
      reset();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
      if (typeof window !== "undefined") window.removeEventListener("blur", blur);
    },
    reset,
    /** What the current gesture is (for tests and to pause hover effects). */
    get phase() {
      return g.phase;
    },
    get dragging() {
      return g.phase === "drag" ? g.target : null;
    },
  };
}
