/**
 * Civilization Stage — the interface's own icons: chunky, rounded, two-tone, drawn for this game
 * (one SVG sprite, added to the page once). `ico("spice")` gives the markup for one.
 *
 * Colours come from the design system's CSS variables where an icon means something (gold is money,
 * orange-red is spice, green is building, red is war), and from `currentColor` elsewhere.
 */
const S = 'stroke="#3a2414" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
const SYMBOLS = {
  // Sporebucks: a fat gold coin with a spiral.
  money: `<circle cx="16" cy="16" r="12" fill="#ffc83d" ${S}/><circle cx="16" cy="16" r="8.2" fill="#ffd96b" stroke="#c98a12" stroke-width="1.6"/><path d="M19.5 12.8c-1-1.5-5.6-1.8-5.8.6-.2 2.6 6 1.4 6 4.2 0 2.6-5 2.6-6.3.6M16.2 9.6v12.8" fill="none" stroke="#9a5d06" stroke-width="2" stroke-linecap="round"/>`,
  // Spice: a glowing teardrop with a swirl.
  spice: `<path d="M16 3.5c5 6.5 9 10.6 9 15.3a9 9 0 0 1-18 0c0-4.7 4-8.8 9-15.3z" fill="#ff7a3d" ${S}/><path d="M16 9.5c2.8 4 4.8 6.4 4.8 9.2a4.8 4.8 0 0 1-9.6 0c0-2.8 2-5.2 4.8-9.2z" fill="#ffc24a"/><circle cx="13.2" cy="19" r="1.6" fill="#fff6e3"/>`,
  // A city: three bulbous towers.
  city: `<path d="M5 27V16c0-3 4-3 4 0v-4c0-4 6-4 6 0v-6c0-4.5 7-4.5 7 0v9c0-3 5-3 5 0v12z" fill="#7fd3e6" ${S}/><path d="M11 27v-5h3v5M19 13h2M19 17h2M8 19h2" fill="none" ${S}/>`,
  // A vehicle: a round-wheeled buggy.
  vehicle: `<path d="M4 20c0-4 2-6 6-6l3-4h7l4 4c3 0 4 2 4 6z" fill="#6fc35a" ${S}/><circle cx="10" cy="22" r="3.6" fill="#fff6e3" ${S}/><circle cx="22" cy="22" r="3.6" fill="#fff6e3" ${S}/><path d="M14 11h5l2.6 3H12z" fill="#bff0ff" ${S}/>`,
  population: `<circle cx="11" cy="11" r="4.5" fill="#ffb37a" ${S}/><circle cx="21.5" cy="12.5" r="3.8" fill="#ffd3a8" ${S}/><path d="M3.5 27c0-6 3.4-9 7.5-9s7.5 3 7.5 9zM16 27c.4-5 2.6-7.5 5.5-7.5s5.5 2.5 5.5 7.5z" fill="#ff9a62" ${S}/>`,
  happy: `<circle cx="16" cy="16" r="12" fill="#ffe36b" ${S}/><circle cx="12" cy="13.5" r="1.6" fill="#3a2414"/><circle cx="20" cy="13.5" r="1.6" fill="#3a2414"/><path d="M10.5 18.5c2.4 3.6 8.6 3.6 11 0" fill="none" ${S}/>`,
  sad: `<circle cx="16" cy="16" r="12" fill="#ffb07a" ${S}/><circle cx="12" cy="13.5" r="1.6" fill="#3a2414"/><circle cx="20" cy="13.5" r="1.6" fill="#3a2414"/><path d="M11 21.5c2.4-3 7.6-3 10 0" fill="none" ${S}/>`,
  income: `<path d="M5 22l7-7 5 4 9-10" fill="none" stroke="#3a2414" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 22l7-7 5 4 9-10" fill="none" stroke="#6fd35a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 8h7v7" fill="none" ${S}/>`,
  turret: `<path d="M9 28V14h14v14z" fill="#c9b79a" ${S}/><path d="M7 14l2-5h14l2 5z" fill="#e0493c" ${S}/><path d="M16 9V4l6 2-6 2" fill="#ffc83d" ${S}/><path d="M13 28v-6h6v6" fill="#7a5a3a" ${S}/>`,
  shield: `<path d="M16 4l10 4v7c0 7-4.6 11-10 13-5.4-2-10-6-10-13V8z" fill="#7fd3e6" ${S}/><path d="M16 9v15M10 13h12" fill="none" stroke="#fff6e3" stroke-width="2.4" stroke-linecap="round"/>`,
  sword: `<path d="M22 4h6v6L14 24l-4-4z" fill="#dfe7ee" ${S}/><path d="M7 19l6 6-2.5 2.5L4.5 21.5zM5 26l-2 2" fill="#c98a12" ${S}/>`,
  faith: `<path d="M16 4c2.6 3.6 4.4 6 4.4 8.8a4.4 4.4 0 0 1-8.8 0C11.6 10 13.4 7.6 16 4z" fill="#ffc83d" ${S}/><path d="M9 28l2.6-11h8.8L23 28z" fill="#b48cf0" ${S}/>`,
  trade: `<path d="M5 12h17l-4-4M27 20H10l4 4" fill="none" stroke="#3a2414" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12h17l-4-4M27 20H10l4 4" fill="none" stroke="#ffc83d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  planet: `<circle cx="16" cy="16" r="11" fill="#3fb6d6" ${S}/><path d="M9 11c3-1 4 2 6 1s2-4 5-3c2 .7 1 4 3 5 1.6.8 2.6 0 3.4.4M7 19c2 0 3 2 5 1.5s3 2.5 5 2.5" fill="none" stroke="#6fd35a" stroke-width="3.2" stroke-linecap="round"/><ellipse cx="16" cy="16" rx="15" ry="4.6" fill="none" stroke="#ffc83d" stroke-width="2" transform="rotate(-18 16 16)" opacity=".9"/>`,
  capital: `<path d="M4 27h24M6 27V15h20v12" fill="#fff6e3" ${S}/><path d="M4 15L16 5l12 10z" fill="#ffc83d" ${S}/><path d="M10 27v-8M16 27v-8M22 27v-8" fill="none" ${S}/>`,
  build: `<path d="M5 26l11-11" fill="none" stroke="#3a2414" stroke-width="5.4" stroke-linecap="round"/><path d="M5 26l11-11" fill="none" stroke="#c98a12" stroke-width="2.8" stroke-linecap="round"/><path d="M14 9l5-5 9 9-5 5z" fill="#9fb4c4" ${S}/>`,
  designs: `<path d="M16 4C8.8 4 4 9 4 15.5S8 27 13.5 27c2.2 0 2.5-1.8 1.6-3.2-1-1.5 0-3.3 2-3.3h3.4C24.8 20.5 28 18 28 14 28 8.4 22.6 4 16 4z" fill="#fff6e3" ${S}/><circle cx="10" cy="15" r="2.3" fill="#e0493c"/><circle cx="13.5" cy="9.5" r="2.3" fill="#ffc83d"/><circle cx="19.5" cy="9" r="2.3" fill="#6fd35a"/><circle cx="23.5" cy="13.5" r="2.3" fill="#3fb6d6"/>`,
  super: `<path d="M16 3l3.4 8.2 8.6.8-6.6 5.6 2 8.4L16 21.4 8.6 26l2-8.4L4 12l8.6-.8z" fill="#ffc83d" ${S}/><circle cx="16" cy="15" r="3" fill="#fff6e3"/>`,
  all: `<rect x="4" y="9" width="11" height="9" rx="3" fill="#6fc35a" ${S}/><rect x="17" y="9" width="11" height="9" rx="3" fill="#6fc35a" ${S}/><rect x="10.5" y="18" width="11" height="9" rx="3" fill="#8fe07a" ${S}/>`,
  box: `<rect x="5" y="5" width="22" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="4 3.4"/><path d="M19 19l7 7M19 19v5M19 19h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  menu: `<path d="M7 10h18M7 16h18M7 22h18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>`,
  close: `<path d="M9 9l14 14M23 9L9 23" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>`,
  guard: `<path d="M16 4l10 4v7c0 7-4.6 11-10 13-5.4-2-10-6-10-13V8z" fill="#7fd3e6" ${S}/><path d="M11 16l3.4 3.4L21 12.6" fill="none" stroke="#fff6e3" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  patrol: `<path d="M7 13a9 9 0 0 1 16-3M25 19a9 9 0 0 1-16 3" fill="none" stroke="#3a2414" stroke-width="5" stroke-linecap="round"/><path d="M7 13a9 9 0 0 1 16-3M25 19a9 9 0 0 1-16 3" fill="none" stroke="#7fd3e6" stroke-width="2.6" stroke-linecap="round"/><path d="M24 5v6h-6M8 27v-6h6" fill="none" ${S}/>`,
  formation: `<circle cx="9" cy="10" r="3.4" fill="#6fc35a" ${S}/><circle cx="23" cy="10" r="3.4" fill="#6fc35a" ${S}/><circle cx="16" cy="16" r="3.4" fill="#6fc35a" ${S}/><circle cx="9" cy="22" r="3.4" fill="#6fc35a" ${S}/><circle cx="23" cy="22" r="3.4" fill="#6fc35a" ${S}/>`,
  follow: `<rect x="4" y="9" width="17" height="14" rx="4" fill="#9fb4c4" ${S}/><path d="M21 14l7-4v12l-7-4z" fill="#9fb4c4" ${S}/><circle cx="12.5" cy="16" r="3.4" fill="#fff6e3" ${S}/>`,
  stop: `<path d="M11 4h10l7 7v10l-7 7H11l-7-7V11z" fill="#e0493c" ${S}/><path d="M11 16h10" stroke="#fff6e3" stroke-width="3.4" stroke-linecap="round"/>`,
  deselect: `<circle cx="16" cy="16" r="11" fill="#fff6e3" ${S}/><path d="M11.5 11.5l9 9M20.5 11.5l-9 9" stroke="#3a2414" stroke-width="2.6" stroke-linecap="round"/>`,
  move: `<path d="M16 28s-8-8-8-14a8 8 0 0 1 16 0c0 6-8 14-8 14z" fill="#6fd35a" ${S}/><circle cx="16" cy="14" r="3" fill="#fff6e3" ${S}/>`,
  attack: `<circle cx="16" cy="16" r="11" fill="#ffb5a8" ${S}/><circle cx="16" cy="16" r="5.5" fill="#e0493c" ${S}/><path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="#3a2414" stroke-width="2.4" stroke-linecap="round"/>`,
  look: `<circle cx="14" cy="14" r="8.5" fill="#bff0ff" ${S}/><path d="M20.5 20.5L27 27" stroke="#3a2414" stroke-width="4.4" stroke-linecap="round"/><path d="M10.5 11.5a4.5 4.5 0 0 1 4-3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  talk: `<path d="M5 8c0-2 1.6-3.5 3.6-3.5h14.8C25.4 4.5 27 6 27 8v9c0 2-1.6 3.5-3.6 3.5H14l-6 5v-5h.6C6.6 20.5 5 19 5 17z" fill="#fff6e3" ${S}/><circle cx="11" cy="12.5" r="1.7" fill="#3a2414"/><circle cx="16" cy="12.5" r="1.7" fill="#3a2414"/><circle cx="21" cy="12.5" r="1.7" fill="#3a2414"/>`,
  mail: `<rect x="4" y="8" width="24" height="17" rx="4" fill="#fff6e3" ${S}/><path d="M5.5 10l10.5 8 10.5-8" fill="none" ${S}/><circle cx="25" cy="8" r="4.2" fill="#e0493c" ${S}/>`,
  world: `<circle cx="16" cy="16" r="11.5" fill="#7fd3e6" ${S}/><path d="M4.5 16h23M16 4.5c-4 4-4 19 0 23M16 4.5c4 4 4 19 0 23" fill="none" ${S}/>`,
  history: `<path d="M8 5h13l5 5v17H8z" fill="#fff6e3" ${S}/><path d="M12 13h9M12 17h9M12 21h6" fill="none" ${S}/>`,
  gear: `<path d="M16 3l2.6 3.2 4-.9.9 4 3.6 1.9-1.9 3.6 1.9 3.6-3.6 1.9-.9 4-4-.9L16 29l-2.6-3.2-4 .9-.9-4-3.6-1.9 1.9-3.6-1.9-3.6 3.6-1.9.9-4 4 .9z" fill="#c9b79a" ${S}/><circle cx="16" cy="16" r="4.4" fill="#fff6e3" ${S}/>`,
  help: `<circle cx="16" cy="16" r="12" fill="#7fd3e6" ${S}/><path d="M12.4 12.6c.4-2.6 2.3-3.6 4-3.6 2.2 0 3.8 1.4 3.8 3.4 0 2.8-4 3-4 6" fill="none" stroke="#fff6e3" stroke-width="3" stroke-linecap="round"/><circle cx="16.2" cy="22.6" r="1.8" fill="#fff6e3"/>`,
  play: `<circle cx="16" cy="16" r="12" fill="#6fd35a" ${S}/><path d="M13 10.5l8 5.5-8 5.5z" fill="#fff6e3" ${S}/>`,
  lock: `<rect x="7" y="14" width="18" height="13" rx="4" fill="#c9b79a" ${S}/><path d="M11 14v-3a5 5 0 0 1 10 0v3" fill="none" ${S}/><circle cx="16" cy="20.5" r="2" fill="#3a2414"/>`,
  plus: `<circle cx="16" cy="16" r="12" fill="#6fd35a" ${S}/><path d="M16 10v12M10 16h12" stroke="#fff6e3" stroke-width="3.4" stroke-linecap="round"/>`,
  derrick: `<path d="M10 28l6-22 6 22M12 20h8M13.5 14h5" fill="none" ${S}/><path d="M16 6c2-2 4 0 4-2" fill="none" stroke="#ff7a3d" stroke-width="2.4" stroke-linecap="round"/><path d="M6 28h20" ${S}/>`,
  speed: `<path d="M5 22a11 11 0 0 1 22 0z" fill="#bff0ff" ${S}/><path d="M16 22l6-8" stroke="#e0493c" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="22" r="2.4" fill="#3a2414"/>`,
  health: `<path d="M16 27S4 20 4 12a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 15-12 15z" fill="#ff6b6b" ${S}/><path d="M9 12a3 3 0 0 1 3-3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  power: `<path d="M18 3L7 18h8l-2 11 12-16h-8z" fill="#ffc83d" ${S}/>`,
};

let installed = false;
/** Add the sprite to the page (once). */
export function installIcons() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const wrap = document.createElement("div");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${Object.entries(SYMBOLS)
    .map(([id, body]) => `<symbol id="cvi-${id}" viewBox="0 0 32 32">${body}</symbol>`)
    .join("")}</svg>`;
  document.body.appendChild(wrap);
}
export const ICON_IDS = Object.keys(SYMBOLS);
/** Markup for one icon. */
export const ico = (id, cls = "") => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#cvi-${SYMBOLS[id] ? id : "help"}"/></svg>`;
