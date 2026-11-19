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
};
/** Section id → icon. */
export const SECTION_ICON = { mouth: ICONS.mouth, senses: ICONS.senses, limbs: ICONS.limbs, graspers: ICONS.graspers, feet: ICONS.feet, movement: ICONS.movement, offence: ICONS.offence, defence: ICONS.defence, details: ICONS.details };
