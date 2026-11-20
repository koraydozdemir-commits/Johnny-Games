/**
 * Cinematics: the shared frame for the stage transitions and growth moments. Letterbox bars, a title,
 * a coloured flash to cut between scenes, and a Skip button. Each stage moves its own camera and
 * models; this file only gives them the frame and the timing helpers.
 *
 * The timeline helpers are pure (no DOM), so they can be tested.
 */

/** Smoothstep easing, 0..1. */
export const ease = (k) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
/** Where t falls inside [a, b], as 0..1 (clamped). */
export const span = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : Math.max(0, Math.min(1, (t - a) / (b - a))));
/** Linear blend. */
export const mix = (a, b, k) => a + (b - a) * k;

/**
 * A cutscene's beats: named moments at given times, used to fire one-off events once.
 * @param {Record<string, number>} beats  name -> time (s)
 */
export function beatClock(beats) {
  const fired = new Set();
  return {
    /** Names of the beats crossed since the last call. */
    crossed(t) {
      const out = [];
      for (const [name, at] of Object.entries(beats)) {
        if (!fired.has(name) && t >= at) {
          fired.add(name);
          out.push(name);
        }
      }
      return out;
    },
    /** Mark every beat as done (skipping). */
    finish() {
      Object.keys(beats).forEach((k) => fired.add(k));
    },
  };
}

/**
 * The timings of each transition, in seconds. Reduced motion shortens them; nothing ever waits on
 * an animation it can't finish. Cutscenes can't be skipped.
 */
export const CUTSCENES = {
  // Creature → Tribal, to "Founding A Tribe" (which plays on into the Tribal Stage): the stick picked up,
  // raised and thrown high; it hangs against the sun's glare while the family looks on; then it falls
  // straight back down on the thrower's head. White-out; in the Tribal Stage a stick falls into the
  // tribe's first fire.
  stickThrow: { gather: 1.3, pickUp: 2.3, raise: 3.3, throw: 3.8, glare: 4.4, apex: 6.6, glareOut: 10, fall: 10.8, bonk: 12.2, shrug: 14.4, flash: 16.4, end: 17.4 },
  campfire: { land: 1.7, gathered: 4.6, end: 6.4 },
  // Tribal → Civilization: night falls on the village; it rises in stone; dawn over a city.
  civRise: { gather: 1.0, rise: 1.8, risen: 5.2, crane: 5.4, dawn: 6.6, flash: 7.6, end: 8.2 },
  civArrive: { end: 3.6 },
  // Growth moments.
  brain: { pop: 0.45, grow: 2.9, hold: 3.6, end: 4.3 },
  brainFinal: { pop: 0.45, grow: 2.4, burst: 2.9, hold: 4.6, end: 5.4 },
};
export const cutsceneLength = (id, reduced = false) => CUTSCENES[id].end * (reduced ? 0.6 : 1);

/**
 * Letterbox frame over the game. Returns controls; remove() takes it away. Cutscenes always play
 * through: there is no Skip button (onSkip and setSkip are accepted and ignored).
 * @param {{ title?:string, kicker?:string, onSkip?:()=>void, flash?:string }} o
 */
export function openFrame(o = {}) {
  const el = document.createElement("div");
  el.className = "cineFrame";
  el.innerHTML = `<i class="cfBar cfTop"></i><i class="cfBar cfBottom"></i><div class="cfFlash"></div>
    <div class="cfTitle" aria-live="polite"><small></small><b></b></div>`;
  el.querySelector(".cfTitle small").textContent = o.kicker || "";
  el.querySelector(".cfTitle b").textContent = o.title || "";
  if (o.flash) el.style.setProperty("--flash", o.flash);
  document.body.appendChild(el);
  document.body.classList.add("cutscene"); // hides the joystick and touch controls
  requestAnimationFrame(() => el.classList.add("show"));
  return {
    el,
    /** Kept for callers; cutscenes can't be skipped. */
    setSkip() {},
    /** Show (or hide) the title card. */
    title(on, title, kicker) {
      if (title !== undefined) el.querySelector(".cfTitle b").textContent = title;
      if (kicker !== undefined) el.querySelector(".cfTitle small").textContent = kicker;
      el.classList.toggle("titled", !!on);
    },
    /** Fill the screen with the flash colour (on), or let it clear (off). */
    flash(on, color) {
      if (color) el.style.setProperty("--flash", color);
      el.classList.toggle("flashing", !!on);
    },
    remove(fade = true) {
      el.classList.remove("show", "titled");
      if (document.querySelectorAll(".cineFrame").length <= 1) document.body.classList.remove("cutscene");
      if (!fade) return el.remove();
      setTimeout(() => el.remove(), 650);
    },
  };
}
