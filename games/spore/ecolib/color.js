/**
 * Small, pure colour helpers on 0xRRGGBB integers (no THREE), so planet palettes can be computed and
 * tested anywhere. Hue is in degrees, saturation and lightness in 0..1.
 */
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function hexToHsl(hex) {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round(clamp(v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/** Blend two colours: t = 0 gives a, 1 gives b. */
export function mix(a, b, t) {
  const k = clamp(t);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Rotate hue, scale saturation and lightness. */
export function adjust(hex, { hue = 0, sat = 1, light = 1 } = {}) {
  const c = hexToHsl(hex);
  return hslToHex(c.h + hue, c.s * sat, c.l * light);
}

/** Move a colour's hue to `h` (keeping its saturation and lightness, scaled). */
export function withHue(hex, h, sat = 1, light = 1) {
  const c = hexToHsl(hex);
  return hslToHex(h, c.s * sat, c.l * light);
}

export const scaleRgb = (hex, k) => (Math.round(clamp(((hex >> 16) & 255) * k, 0, 255)) << 16) | (Math.round(clamp(((hex >> 8) & 255) * k, 0, 255)) << 8) | Math.round(clamp((hex & 255) * k, 0, 255));
export const toCss = (hex) => "#" + hex.toString(16).padStart(6, "0");
/** Shortest signed distance between two hues, in degrees. */
export const hueDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
