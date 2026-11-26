/**
 * Colour helpers for the paint tools: conversions between 0xRRGGBB numbers, "#rrggbb" strings and
 * hue / saturation / brightness, plus ready-made colour schemes and the player's recent colours.
 * Pure (storage is passed in), so it is unit tested.
 */

export const toHex = (n) => "#" + ((n >>> 0) & 0xffffff).toString(16).padStart(6, "0");
/** "#abc", "abc", "#aabbcc" or "aabbcc" to a number; null if it isn't a colour. */
export function parseHex(s) {
  let t = String(s || "")
    .trim()
    .replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(t) ? parseInt(t, 16) : null;
}
/** 0xRRGGBB to { h: 0..360, s: 0..1, v: 0..1 }. */
export function toHsv(n) {
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
/** { h, s, v } back to 0xRRGGBB. */
export function fromHsv({ h, s, v }) {
  h = (((h % 360) + 360) % 360) / 60;
  s = Math.min(1, Math.max(0, s));
  v = Math.min(1, Math.max(0, v));
  const c = v * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = v - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const ch = (k) => Math.round((k + m) * 255);
  return (ch(r) << 16) | (ch(g) << 8) | ch(b);
}
/** Relative luminance 0..1 (for choosing dark or light text on a swatch). */
export function luminance(n) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** A small palette that reads well on skin and on shells: one tap each. */
export const PALETTE = [0x3be0d8, 0x58c46a, 0xa6d04a, 0xf2c84b, 0xf28a3b, 0xe0504a, 0xd8508e, 0x9a63e0, 0x4a74e0, 0x2f9fd6, 0x6f5a46, 0xa8835c, 0xe8e2d4, 0x8a8f96, 0x2c3440, 0x14181e];

/**
 * Colour schemes for a creature: base (back and sides), belly, pattern (coat) and accent (detail),
 * with the pattern that suits them. Grouped the way the Paint tab shows them.
 */
export const CREATURE_PRESETS = [
  { group: "Natural", name: "Tiger", colors: { base: 0xe8892f, belly: 0xf6e6cc, pattern: 0x2a1d14, accent: 0xf6efe0 }, pattern: "stripes" },
  { group: "Natural", name: "Leopard", colors: { base: 0xd9b25a, belly: 0xf3e5c2, pattern: 0x3b2a18, accent: 0xf0d99a }, pattern: "spots" },
  { group: "Natural", name: "Zebra", colors: { base: 0xf0ede6, belly: 0xf7f5ef, pattern: 0x1b1b1f, accent: 0x3a3a40 }, pattern: "stripes" },
  { group: "Natural", name: "Frog", colors: { base: 0x58b84a, belly: 0xe5efb8, pattern: 0x2c5e22, accent: 0xf2c84b }, pattern: "spots" },
  { group: "Natural", name: "Fawn", colors: { base: 0xa8774a, belly: 0xefdcc0, pattern: 0xf4ead8, accent: 0x3a2a1c }, pattern: "speckle" },
  { group: "Natural", name: "Salamander", colors: { base: 0x1f2630, belly: 0xf2c84b, pattern: 0xf2c84b, accent: 0xe0504a }, pattern: "spots" },
  { group: "Fantasy", name: "Dragon", colors: { base: 0x7a1f2a, belly: 0xd9a248, pattern: 0x2a0d12, accent: 0xf2c84b }, pattern: "gradient" },
  { group: "Fantasy", name: "Glacier", colors: { base: 0xbfe6f2, belly: 0xf4fbff, pattern: 0x4a8cc9, accent: 0x9fe9ff }, pattern: "glow" },
  { group: "Fantasy", name: "Nightshade", colors: { base: 0x3a2a63, belly: 0x8f7ab8, pattern: 0x9a63e0, accent: 0x7ff5e6 }, pattern: "glow" },
  { group: "Fantasy", name: "Ember", colors: { base: 0x2c2224, belly: 0x6b3b2a, pattern: 0xf28a3b, accent: 0xffd25e }, pattern: "glow" },
  { group: "Bright", name: "Candy", colors: { base: 0xf28ab8, belly: 0xfde2ef, pattern: 0x7ad7f0, accent: 0xfff27a }, pattern: "spots" },
  { group: "Bright", name: "Parrot", colors: { base: 0x2fbf4f, belly: 0xf2e04b, pattern: 0xe0504a, accent: 0x2f6fd6 }, pattern: "gradient" },
  { group: "Bright", name: "Reef", colors: { base: 0x22c7c7, belly: 0xfff0d6, pattern: 0xf28a3b, accent: 0x2a2a6a }, pattern: "stripes" },
  { group: "Bright", name: "Sherbet", colors: { base: 0xf6b04a, belly: 0xfff4d0, pattern: 0xf26a7a, accent: 0x9be36a }, pattern: "speckle" },
];

/**
 * A short most-recent-first list kept in storage (recent colours, recent parts, saved schemes).
 * @param {Storage|null} storage  localStorage, or null for memory only (tests)
 */
export function recentList(storage, key, max = 10, same = (a, b) => a === b) {
  let items = [];
  try {
    const raw = storage ? JSON.parse(storage.getItem(key) || "[]") : [];
    if (Array.isArray(raw)) items = raw.slice(0, max);
  } catch (e) {
    items = [];
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(items));
    } catch (e) {
      /* storage full or private browsing: the list still works for this session */
    }
  };
  return {
    get items() {
      return items.slice();
    },
    add(v) {
      items = [v, ...items.filter((x) => !same(x, v))].slice(0, max);
      save();
      return items.slice();
    },
    remove(v) {
      items = items.filter((x) => !same(x, v));
      save();
      return items.slice();
    },
  };
}
