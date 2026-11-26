/**
 * Original line icons for the creature editor: one SVG per category and action, so the interface
 * never leans on emoji. Drawn on a 24×24 grid in currentColor and sized by CSS.
 */
const svg = (body, extra = "") => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const ICONS = {
  body: svg('<path d="M3 15c3-8 7-8 9-3s6 3 9-4"/><circle cx="6" cy="11.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="9" r="1.1"/>'),
  mouth: svg('<path d="M3 12c3-4 6-4 9-2 3-2 6-2 9 2-3 5-6 6-9 6s-6-1-9-6z"/><path d="M3 12h18"/><path d="M9 12v2M15 12v2"/>'),
  senses: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  limbs: svg('<path d="M7 3v6l5 5v7"/><path d="M12 14l5-1 3 7"/><path d="M17 8l2-4"/>'),
  graspers: svg('<path d="M7 21v-6l-3-4M7 15V8M11 15V5M15 15V7M19 15v-4"/><path d="M7 21h10c2-2 2-4 2-6"/>'),
  feet: svg('<path d="M8 21c-2-4-3-9 0-13 3-2 7 0 7 5 0 3-1 6-3 8z"/><circle cx="6.5" cy="5.5" r="1"/><circle cx="10.5" cy="3.5" r="1"/><circle cx="14.5" cy="5" r="1"/>'),
  movement: svg('<path d="M3 17c4-1 7-4 9-11 2 7 5 10 9 11-4 1-7 1-9-3-2 4-5 4-9 3z"/>'),
  offence: svg('<path d="M5 21c0-9 5-14 15-17-2 7-3 12-9 15l-2-2z"/><path d="M5 21l4-4"/>'),
  defence: svg('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M12 8v9M8 11h8"/>'),
  details: svg('<path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>'),
  paint: svg('<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  dna: svg('<path d="M7 3c0 6 10 6 10 12s-10 6-10 6"/><path d="M17 3c0 6-10 6-10 12s10 6 10 6"/><path d="M8.5 7.5h7M8.5 16.5h7"/>'),
  undo: svg('<path d="M9 5L4 10l5 5"/><path d="M4 10h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="M15 5l5 5-5 5"/><path d="M20 10H10a6 6 0 0 0 0 12h3"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  up: svg('<path d="M6 14l6-6 6 6"/>'),
  down: svg('<path d="M6 10l6 6 6-6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  build: svg('<path d="M14.5 5.5a4 4 0 0 0-5.3 5.3L3.5 16.5a2 2 0 0 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  test: svg('<path d="M4 18c2-1 3-4 5-4s2 3 4 3 3-6 5-6 2 3 2 3"/><circle cx="18" cy="6" r="2"/>'),
  parts: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="3.5"/><rect x="4" y="13" width="7" height="7" rx="3.5"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  mirror: svg('<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L4 12l5 5z"/><path d="M15 7l5 5-5 5z"/>'),
  solo: svg('<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L4 12l5 5z"/><path d="M15 9l3 3-3 3" opacity=".45"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  camera: svg('<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  focus: svg('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><circle cx="12" cy="12" r="2.5"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17.2" r=".6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  stats: svg('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  save: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
};
/** Section id → icon. */
export const SECTION_ICON = { mouth: ICONS.mouth, senses: ICONS.senses, limbs: ICONS.limbs, graspers: ICONS.graspers, feet: ICONS.feet, movement: ICONS.movement, offence: ICONS.offence, defence: ICONS.defence, details: ICONS.details };
