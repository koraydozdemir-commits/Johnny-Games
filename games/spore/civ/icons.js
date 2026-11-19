/**
 * One icon language for the Civilization Stage: simple outline icons drawn the same way (a 24-unit grid,
 * two-unit round strokes, the text colour), in place of the system's emoji, which look different on every
 * device. The game's text still names things with a few emoji in its data (city kinds, designs); `withIcons`
 * turns those into these icons wherever they would be shown, and `stripIcons` removes them from plain text
 * such as toasts.
 */
const P = {
  military: '<path d="M5 5l10 10M19 5L9 15M4 20l3-3M20 20l-3-3"/>',
  economic: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.7c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.7-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
  religious: '<path d="M4 14c3 0 5-2 6-5 1 2 3 3 5 3l4-3c0 5-4 9-9 9-4 0-6-2-6-4z"/>',
  land: '<path d="M4 15v-3l2-4h12l2 4v3zM4 15h16"/><circle cx="8" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/>',
  sea: '<path d="M3 15h18l-3 4H6zM12 15V6l5 6"/>',
  air: '<path d="M3 13l8-1 5-8 2 1-3 8 5 1v2l-6-1-3 6-2-1 1-6-7-1z"/>',
  house: '<path d="M4 11l8-6 8 6M6 10v9h12v-9"/>',
  factory: '<path d="M4 19V10l5 3V10l5 3V6h4v13zM4 19h16"/>',
  fun: '<circle cx="12" cy="11" r="6"/><path d="M12 5v12M6 11h12M7 19l5-2 5 2"/>',
  temple: '<path d="M12 3v4M10 5h4M6 21V11l6-4 6 4v10M10 21v-5h4v5"/>',
  turret: '<path d="M8 21l1-12h6l1 12M7 9h10M9 6h6v3"/>',
  hall: '<path d="M3 10l9-6 9 6M5 10v9M9 10v9M15 10v9M19 10v9M3 21h18"/>',
  city: '<path d="M4 21V9h6v12M10 21V5h6v16M16 21v-9h4v9M3 21h18"/>',
  build: '<path d="M14 6l4 4-8 8-4-4zM12 4l2 2M5 19l-2 2"/>',
  design: '<path d="M12 4c5 0 8 3 8 7 0 3-2 3-4 3h-1c-1 0-2 1-1 2 1 2 0 4-3 4-4 0-7-3-7-8s3-8 8-8z"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15.5" cy="10" r="1"/>',
  super: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  pin: '<path d="M12 21s6-6 6-11a6 6 0 10-12 0c0 5 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  history: '<path d="M7 4h10v14a2 2 0 01-2 2H5a2 2 0 002-2zM9 8h6M9 12h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  spice: '<path d="M12 3l6 9-6 9-6-9z"/>',
  flag: '<path d="M6 21V4M6 5h11l-2.5 4 2.5 4H6"/>',
  deal: '<path d="M3 12l4-4 4 2 3-2 4 4-5 6-3-2-3 2z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  blast: '<path d="M12 3l2 5 5-2-3 5 5 3-6 1 1 6-4-4-4 4 1-6-6-1 5-3-3-5 5 2z"/>',
  fin: '<path d="M3 17c4 0 6-3 7-8 3 3 6 4 11 4-2 4-6 6-10 6-3 0-6-1-8-2z"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15zM5 19l8-8"/>',
  plate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  claw: '<path d="M6 20c-2-6 0-12 4-16M11 20c-2-6 0-12 4-16M16 20c-2-6 0-12 4-16"/>',
  note: '<path d="M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM19 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>',
  compass: '<circle cx="12" cy="12" r="8"/><path d="M15 9l-2 5-5 1 2-5z"/>',
  scales: '<path d="M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 006 0zM19 7l-3 7a3 3 0 006 0z"/>',
};
const OF = { "⚔": "military", "💰": "economic", "🕊": "religious", "🚙": "land", "🚤": "sea", "✈": "air", "🏠": "house", "🏭": "factory", "🎡": "fun", "⛪": "temple", "🗼": "turret", "🏛": "hall", "🏙": "city", "🔨": "build", "🎨": "design", "✨": "super", "☄": "super", "📍": "pin", "📜": "history", "⚙": "settings", "🌶": "spice", "🏳": "flag", "🤝": "deal", "☰": "menu", "💥": "blast", "🦈": "fin", "🌿": "leaf", "🍽": "plate", "🦖": "claw", "🎵": "note", "🧭": "compass", "⚖": "scales" };
const EMOJI = new RegExp("(" + Object.keys(OF).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(\\uFE0F)?", "g");
/** An icon by name, as markup. */
export const icon = (name) => (P[name] ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>` : "");
/** Replace the game's emoji with icons in a piece of HTML (only in text, never inside a tag's attributes). */
export const withIcons = (html) =>
  String(html)
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") ? part.replace(EMOJI, "") : part.replace(EMOJI, (m, e) => icon(OF[e]))))
    .join("");
/** Remove the emoji from plain text (toasts and labels). */
export const stripIcons = (text) => String(text).replace(EMOJI, "").replace(/ {2,}/g, " ").replace(/^ | $/g, "");
