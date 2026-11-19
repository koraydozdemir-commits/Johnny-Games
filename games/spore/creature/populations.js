/**
 * The island's ecology over time: how big each wild group can grow, how the food chain balances, and
 * the occasional season or upheaval that shakes it.
 *
 * This is the cheap, abstract half of the ecosystem. It never touches a creature: it keeps one number
 * per group (pop, how many members the group can sustain) and the region's food (lush), and every few
 * seconds it returns *actions* for the stage to make visible: a herd abandoning its ground, hungry
 * hunters leaving, a pack walking in from the coast, a bloom, a lean season, a sickness, a clash.
 * Pure data and functions: no THREE, no DOM.
 */

/** Which archetypes eat which: prey grows on food, predators grow on prey. */
export const PREY_ARCHES = new Set(["smallPrey", "grazer", "giant", "scavenger"]);
export const PREDATOR_ARCHES = new Set(["packHunter", "ambusher", "guardian"]);

/**
 * Ecological events. weight(eco) says how likely each is right now (0 = impossible); dur is seconds;
 * lush is how far it pushes the food supply. Texts are short: the world shows the rest.
 */
export const ECO_EVENTS = {
  bloom: {
    name: "Season of plenty",
    icon: "🌸",
    dur: [150, 220],
    lush: 0.6,
    weight: (e) => (e.lush < 1.2 ? 1 : 0.3),
    hint: "Food is everywhere.",
    chronicle: (r) => "A season of plenty came to the " + r + ".",
  },
  shortage: {
    name: "Lean season",
    icon: "🥀",
    dur: [160, 240],
    lush: -0.55,
    weight: (e) => (e.lush > 0.8 ? 1 : 0.2),
    hint: "Food is getting scarce.",
    chronicle: (r) => "A lean season hit the " + r + ". Herds thinned and hunters grew bold.",
  },
  predators: {
    name: "Predator migration",
    icon: "🐺",
    dur: [0, 0],
    arrive: "packHunter",
    // Plenty of prey draws hunters in; few predators already here leaves room for them.
    weight: (e) => (e.preyFood > 0.8 ? 1.6 : e.preyFood > 0.5 ? 0.7 : 0.1) * (e.predators < 3 ? 1 : 0.4),
    hint: "New hunters in the area.",
    chronicle: (r) => "A pack of hunters migrated into the " + r + ".",
  },
  newcomers: {
    name: "Newcomers",
    icon: "🦌",
    dur: [0, 0],
    arrive: "grazer",
    weight: (e) => (e.lush > 0.9 && e.preyFood < 0.9 ? 0.9 : 0.25),
    hint: "A new herd has wandered in.",
    chronicle: (r) => "A new herd wandered into the " + r + ".",
  },
  sickness: {
    name: "Sickness",
    icon: "🤢",
    dur: [120, 180],
    // Crowded herds catch it.
    weight: (e) => (e.crowded ? 1.2 : 0.2),
    hint: "That herd is sick.",
    chronicle: (r, where) => "Sickness swept through a herd " + where + ".",
  },
  clash: {
    name: "Territorial clash",
    icon: "⚔",
    dur: [50, 80],
    weight: (e) => (e.fighters >= 2 ? 0.8 : 0),
    hint: "Two predators are fighting over ground.",
    chronicle: (r, where) => "Rival predators fought over ground " + where + ".",
  },
};
export const ECO_EVENT_IDS = Object.keys(ECO_EVENTS);

/** Seconds between events (a calm start in a new region). */
export const firstEventIn = (rand = Math.random) => 200 + rand() * 120;
export const nextEventIn = (rand = Math.random) => 260 + rand() * 200;

/** Per-minute rates. */
const RATES = {
  preyGrowth: 0.45, // logistic growth at full food
  predation: 0.05, // prey lost per predator per minute, off screen, when hunters are hungry
  predatorGrowth: 0.18,
  predatorStarve: 0.3,
  pressureFade: 0.35, // your hunting pressure on a group fades
};

/**
 * A new ecology for a region.
 * @param {{arch:string, size:number}[]} groups  one per wildlife group, in order
 * @param {object|null} saved  a previous ecology for this region (see saveEcology)
 */
export function createEcology(groups, saved = null, rand = Math.random) {
  const e = {
    lush: Number.isFinite(saved?.lush) ? Math.max(0.3, Math.min(1.8, saved.lush)) : 1,
    event: null, // { id, t, group?, rival? }
    last: saved?.last || null,
    nextIn: Number.isFinite(saved?.nextIn) ? Math.max(30, saved.nextIn) : firstEventIn(rand),
    groups: [],
  };
  groups.forEach((g, i) => addEcoGroup(e, g.arch, g.size, saved?.groups?.[i]));
  return e;
}

/** A group joins the ecology (at creation, or a migration into the region). */
export function addEcoGroup(e, arch, size, saved = null) {
  const cap = size + 2;
  const g = {
    arch,
    prey: PREY_ARCHES.has(arch),
    start: size,
    cap,
    pop: Number.isFinite(saved?.pop) ? Math.max(0, Math.min(cap, saved.pop)) : size,
    pressure: Number.isFinite(saved?.pressure) ? Math.max(0, saved.pressure) : 0,
    gone: !!saved?.gone,
    goneFor: Number.isFinite(saved?.goneFor) ? saved.goneFor : 0,
    sick: 0,
  };
  e.groups.push(g);
  return g;
}

/** How well fed the predators are: live prey against what the prey started with (0..~1.3). */
export function preyFood(e) {
  let pop = 0,
    start = 0;
  for (const g of e.groups)
    if (g.prey) {
      start += g.start;
      if (!g.gone) pop += g.pop;
    }
  return start ? pop / start : 0;
}

/** You (or something) killed one of a group's members. */
export function recordKill(e, index, byYou) {
  const g = e.groups[index];
  if (!g) return;
  g.pop = Math.max(0, g.pop - 1);
  if (byYou) g.pressure += 1;
}

/** How many members a group can keep alive right now (the stage refills up to this). */
export const sustainable = (g) => (g.gone ? 0 : Math.max(0, Math.floor(g.pop + 0.25)));

/**
 * Advance the ecology. `spawned(i)` says whether group i is on screen right now (its losses are real
 * kills there, so the abstract predation leaves it alone).
 * @returns {object[]} actions: { type: "migrate"|"leave"|"return"|"arrive"|"start"|"end", ... }
 */
export function stepEcology(e, dt, spawned = () => false, rand = Math.random) {
  const out = [];
  const min = dt / 60;
  // Food drifts back towards normal, pushed by whatever season is under way.
  const goal = 1 + (e.event ? ECO_EVENTS[e.event.id].lush || 0 : 0);
  e.lush += (goal - e.lush) * Math.min(1, min * 1.2);
  const food = preyFood(e);
  const hunters = e.groups.filter((g) => !g.prey && !g.gone).reduce((a, g) => a + g.pop, 0);
  e.groups.forEach((g, i) => {
    g.pressure = Math.max(0, g.pressure - RATES.pressureFade * min);
    if (g.gone) {
      // Gone groups come back once the land can feed them again.
      g.goneFor += dt;
      const ready = g.prey ? e.lush > 0.9 && g.pressure < 0.5 : food > 0.75;
      if (g.goneFor > 360 && ready && rand() < min * 0.5) {
        g.gone = false;
        g.goneFor = 0;
        g.pop = Math.max(2, Math.round(g.start * 0.6));
        out.push({ type: "return", group: i });
      }
      return;
    }
    if (g.prey) {
      g.pop += RATES.preyGrowth * e.lush * g.pop * (1 - g.pop / g.cap) * min;
      if (g.pop < 1.2 && g.pop > 0) g.pop += 0.1 * e.lush * min; // the last few still breed, slowly
      if (!spawned(i) && hunters > 0 && food > 0) g.pop -= RATES.predation * hunters * (g.pop / Math.max(1, food * 6)) * min * (e.lush < 0.8 ? 1.5 : 1);
      if (g.sick > 0) {
        g.sick -= dt;
        g.pop -= 0.5 * min;
      }
      g.pop = Math.max(0, Math.min(g.cap, g.pop));
      if (g.pop < 0.8) {
        // Hunted (or starved) out: the last of them flee the area.
        g.gone = true;
        g.goneFor = 0;
        out.push({ type: "leave", group: i, why: g.pressure > 1 ? "hunted" : "starved" });
      } else if (g.pop < g.start * 0.45 && g.pressure > 1.5) {
        // Pressed hard: the herd abandons its ground for somewhere safer.
        g.pressure = 0;
        out.push({ type: "migrate", group: i, why: "hunted" });
      }
    } else {
      const fed = food > 0.6 ? RATES.predatorGrowth : food < 0.35 ? -RATES.predatorStarve : 0;
      g.pop = Math.max(0, Math.min(g.cap, g.pop + fed * (e.lush < 0.8 ? 1.4 : 1) * min));
      if (g.pop < 0.8) {
        g.gone = true;
        g.goneFor = 0;
        out.push({ type: "leave", group: i, why: "starved" });
      }
    }
  });
  // Events: one at a time, never the same twice in a row.
  if (e.event) {
    e.event.t -= dt;
    if (e.event.t <= 0) {
      out.push({ type: "end", id: e.event.id, group: e.event.group, rival: e.event.rival });
      e.event = null;
    }
  } else if ((e.nextIn -= dt) <= 0) {
    e.nextIn = nextEventIn(rand);
    const ev = pickEcoEvent(e, rand);
    if (ev) out.push(startEcoEvent(e, ev, rand));
  }
  return out;
}

/** The situation events are weighed against. */
export function ecoSituation(e) {
  const live = e.groups.filter((g) => !g.gone);
  return {
    lush: e.lush,
    preyFood: preyFood(e),
    predators: live.filter((g) => !g.prey).length,
    fighters: live.filter((g) => !g.prey && g.pop >= 1).length,
    crowded: live.some((g) => g.prey && g.pop > g.cap * 0.85),
  };
}

export function pickEcoEvent(e, rand = Math.random) {
  if (rand() < 0.2) return null; // sometimes nothing happens
  const s = ecoSituation(e);
  const options = ECO_EVENT_IDS.filter((id) => id !== e.last).map((id) => [id, Math.max(0, ECO_EVENTS[id].weight(s))]);
  const total = options.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const [id, w] of options) if ((roll -= w) <= 0) return id;
  return options.at(-1)[0];
}

/** Begin an event: picks who it concerns. Returns the "start" action. */
export function startEcoEvent(e, id, rand = Math.random) {
  const def = ECO_EVENTS[id];
  const len = def.dur[0] + rand() * (def.dur[1] - def.dur[0]);
  const live = e.groups.map((g, i) => ({ g, i })).filter(({ g }) => !g.gone);
  let group, rival;
  if (id === "sickness") {
    const herds = live.filter(({ g }) => g.prey).sort((a, b) => b.g.pop / b.g.cap - a.g.pop / a.g.cap);
    group = herds[0]?.i;
    if (group !== undefined) e.groups[group].sick = len;
  } else if (id === "clash") {
    const f = live.filter(({ g }) => !g.prey && g.pop >= 1);
    group = f[0]?.i;
    rival = f[1]?.i;
  }
  e.last = id;
  if (len > 0) e.event = { id, t: len, group, rival };
  return { type: "start", id, group, rival, arrive: def.arrive || null };
}

/** What to keep in the region save. */
export function saveEcology(e) {
  return {
    lush: Math.round(e.lush * 100) / 100,
    last: e.last,
    nextIn: Math.round(e.nextIn),
    groups: e.groups.map((g) => ({ pop: Math.round(g.pop * 100) / 100, pressure: Math.round(g.pressure * 10) / 10, gone: g.gone, goneFor: Math.round(g.goneFor) })),
  };
}
