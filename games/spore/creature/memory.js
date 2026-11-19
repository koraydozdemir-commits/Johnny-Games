/**
 * Long memory: what a nest or a wild herd remembers about your species.
 *
 * Two scores, 0..100: grudge (you hurt them) and trust (you helped them). Both fade slowly, but
 * never below a floor set by the big things: a herd you slaughtered stays wary for good, a nest you
 * once rescued keeps a soft spot. Small slights are forgiven; massacres are not.
 * Pure data and functions; the stage keeps one memory per nest and per wildlife group and saves it.
 */

/** What each act does: g/t added to grudge/trust; fg/ft raise the permanent floor. */
export const MEMORY_ACTS = {
  hurt: { g: 5 },
  kill: { g: 18, fg: 6 },
  killAlpha: { g: 30, fg: 14 },
  witnessedKill: { g: 10, fg: 3 }, // you killed one of them in front of the others
  egg: { g: 12 },
  intimidated: { g: 6 },
  befriend: { t: 12, ft: 3 },
  gift: { t: 9 },
  rescue: { t: 20, ft: 8 }, // you killed something that was attacking them
  alliance: { t: 30, ft: 20 },
  coexist: { t: 15, ft: 5 },
};

/** Points lost per minute, above the floor. */
const FADE = { grudge: 3, trust: 1.5 };
const clamp = (v) => Math.max(0, Math.min(100, v));

export const emptyMemory = () => ({ g: 0, t: 0, fg: 0, ft: 0 });

export function readMemory(raw) {
  const m = emptyMemory();
  if (!raw || typeof raw !== "object") return m;
  for (const k of ["g", "t", "fg", "ft"]) {
    const v = Number(raw[k]);
    if (Number.isFinite(v)) m[k] = clamp(v);
  }
  m.fg = Math.min(m.fg, 60);
  m.ft = Math.min(m.ft, 60);
  return m;
}

/** Record an act. Returns the memory (changed in place). Unknown acts change nothing. */
export function remember(m, act, scale = 1) {
  const a = MEMORY_ACTS[act];
  if (!a) return m;
  if (a.g) m.g = clamp(m.g + a.g * scale);
  if (a.t) m.t = clamp(m.t + a.t * scale);
  if (a.fg) m.fg = Math.min(60, m.fg + a.fg * scale);
  if (a.ft) m.ft = Math.min(60, m.ft + a.ft * scale);
  // Kindness softens an old grudge a little, and harm sours trust a lot.
  if (a.t) m.g = clamp(Math.max(m.fg, m.g - a.t * 0.35 * scale));
  if (a.g) m.t = clamp(Math.max(m.ft, m.t - a.g * 0.8 * scale));
  return m;
}

/** Time passes (seconds). */
export function fade(m, dt) {
  const k = dt / 60;
  if (m.g > m.fg) m.g = Math.max(m.fg, m.g - FADE.grudge * k);
  if (m.t > m.ft) m.t = Math.max(m.ft, m.t - FADE.trust * k);
  return m;
}

/**
 * How they feel about you overall.
 * @returns {"hostile"|"wary"|"neutral"|"warm"|"loyal"}
 */
export function attitudeOf(m) {
  const net = m.t - m.g;
  if (m.g >= 45 && net < 0) return "hostile";
  if (net <= -15) return "wary";
  if (net >= 45) return "loyal";
  if (net >= 15) return "warm";
  return "neutral";
}

/** Added to a social round's opening progress: a warm welcome, or a cold one. */
export const socialBias = (m) => Math.max(-0.3, Math.min(0.25, (m.t - m.g) / 200));

/** How much further off a herd keeps from you (1 = no change). */
export const wariness = (m) => 1 + Math.min(0.8, m.g / 100);
