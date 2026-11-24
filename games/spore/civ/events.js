/**
 * World events for the Civilization Stage: a living planet that changes without being asked. Pure
 * rules (which event fits the world now, and what it does), tested on their own; civ/stage.js applies
 * the effects and shows them on the planet, the minimap and in the news.
 *
 * Pacing: the first comes a few minutes in, then one every few minutes, never the same twice in a
 * row and never more than one at a time. Each is weighted by the state of the world, so a booming
 * economy can crash, crowded factories bring unrest, wars breed tension, and so on.
 */

export const FIRST_EVENT_AT = 240; // seconds of play before the first
export const EVENT_GAP = [170, 280]; // seconds between events

/**
 * Every kind of event: what it is, when it fits (weight > 0), and how long its effect lasts.
 * `effect` is applied by the stage:
 *   income ×, spice × (your derricks), price × (spice market), relation +, rivalMoney +,
 *   pairRel + (two rivals' relation), unrest + (one city), damage (a city's defences, 0..1),
 *   happy + (your cities), preach × (your religious vehicles), trade × (your trade vehicles)
 */
export const WORLD_EVENTS = {
  shortage: {
    icon: "🌶",
    title: "Spice shortage",
    color: 0xe07b2a,
    seconds: 100,
    weight: (w) => (w.derricks > 0 ? 1 : 0.3),
    make: () => ({ text: "The geysers are running thin: every derrick pumps less for a while, and the spice price climbs.", effect: { spice: 0.6, price: 1.35 } }),
  },
  boom: {
    icon: "💰",
    title: "Economic boom",
    color: 0xf5c75a,
    seconds: 100,
    weight: (w) => 0.6 + Math.min(1.2, w.routes * 0.25),
    make: () => ({ text: "Markets are booming: your cities earn a quarter more for a while.", effect: { income: 1.25 } }),
  },
  disaster: {
    icon: "🌋",
    title: "Natural disaster",
    color: 0xff6a3d,
    seconds: 0,
    weight: (w) => (w.time > 600 ? 0.8 : 0.3),
    make: (w, rand) => {
      const c = pick(w.cities, rand);
      if (!c) return null;
      const kind = pick(["An earthquake", "A great storm", "A flood", "A wildfire"], rand);
      return { text: `${kind} strikes ${c.name}! Its defences are damaged and its people uneasy.`, at: c.id, effect: { damage: 0.45, unrest: 1.5, city: c.id } };
    },
  },
  unrest: {
    icon: "📣",
    title: "Political unrest",
    color: 0xd9534f,
    seconds: 0,
    weight: (w) => (w.unhappy ? 1.4 : 0.2),
    make: (w) => {
      const c = w.unhappy;
      if (!c) return null;
      return { text: `Protests fill the streets of ${c.name}. Build entertainment there to calm them.`, at: c.id, effect: { unrest: 2, city: c.id } };
    },
  },
  expansion: {
    icon: "🏗",
    title: "A rival expands",
    color: 0x9aa7b8,
    seconds: 0,
    weight: (w) => (w.rivals.length ? 0.9 : 0),
    make: (w, rand) => {
      const n = pick(w.rivals, rand);
      return n ? { text: `The ${n.name} are pouring money into new vehicles and settlements.`, nation: n.id, effect: { rivalMoney: 160, nation: n.id } } : null;
    },
  },
  breakthrough: {
    icon: "🕊",
    title: "Diplomatic breakthrough",
    color: 0x3fc26e,
    seconds: 0,
    weight: (w) => (w.rivals.some((n) => !n.war) ? 0.8 + (w.symbiotic ? 0.4 : 0) : 0),
    make: (w, rand) => {
      const n = pick(
        w.rivals.filter((x) => !x.war),
        rand,
      );
      return n ? { text: `Envoys of the ${n.name} speak warmly of your people. Relations improve.`, nation: n.id, effect: { relation: 12, nation: n.id } } : null;
    },
  },
  tradeOpportunity: {
    icon: "📈",
    title: "Trade opportunity",
    color: 0xffd36a,
    seconds: 70,
    weight: () => 0.8,
    make: () => ({ text: "Far-off buyers want spice: the market price jumps for a while. Sell now!", effect: { price: 1.6 } }),
  },
  culture: {
    icon: "🎭",
    title: "Cultural movement",
    color: 0xb58cf0,
    seconds: 110,
    weight: () => 0.7,
    make: (w) =>
      w.yourType === "religious"
        ? { text: "A wave of devotion sweeps your cities: your missionaries preach a fifth faster.", effect: { preach: 1.2 } }
        : { text: "Art and music flourish in your cities: everyone is a little happier for a while.", effect: { happy: 1 } },
  },
  tension: {
    icon: "⚔",
    title: "Military tensions",
    color: 0xef4b48,
    seconds: 0,
    weight: (w) => (w.rivals.length >= 2 ? 0.7 + (w.wars ? 0.4 : 0) : 0),
    make: (w, rand) => {
      const [a, b] = shuffle(w.rivals, rand);
      return a && b ? { text: `Border clashes between the ${a.name} and the ${b.name}. Their relations sour.`, nation: a.id, effect: { pairRel: -22, a: a.id, b: b.id } } : null;
    },
  },
  shift: {
    icon: "🔀",
    title: "A change of heart",
    color: 0x6fb7e8,
    seconds: 0,
    weight: (w) => (w.rivals.length ? 0.6 : 0),
    make: (w, rand) => {
      const n = pick(w.rivals, rand);
      if (!n) return null;
      const up = rand() < (w.feared ? 0.35 : 0.6);
      return { text: up ? `A new council among the ${n.name} looks on you kindly.` : `A new council among the ${n.name} distrusts your people.`, nation: n.id, effect: { relation: up ? 10 : -10, nation: n.id } };
    },
  },
};
export const EVENT_IDS = Object.keys(WORLD_EVENTS);

function pick(list, rand) {
  return list.length ? list[Math.floor(rand() * list.length) % list.length] : null;
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose the next event for the world as it is, or null if nothing fits.
 * @param {{ time:number, derricks:number, routes:number, wars:number, yourType:string, cities:{id,name}[],
 *   unhappy:{id,name}|null, rivals:{id,name,war:boolean}[], symbiotic?:boolean, feared?:boolean }} w
 * @param {string|null} last  the previous event's id (never repeated back to back)
 */
export function chooseEvent(w, last = null, rand = Math.random) {
  const options = EVENT_IDS.filter((id) => id !== last)
    .map((id) => ({ id, w: Math.max(0, WORLD_EVENTS[id].weight(w)) }))
    .filter((x) => x.w > 0);
  let total = options.reduce((s, x) => s + x.w, 0);
  while (options.length && total > 0) {
    let r = rand() * total;
    const i = options.findIndex((x) => (r -= x.w) <= 0);
    const o = options[i < 0 ? options.length - 1 : i];
    const made = WORLD_EVENTS[o.id].make(w, rand);
    if (made) return { id: o.id, icon: WORLD_EVENTS[o.id].icon, title: WORLD_EVENTS[o.id].title, color: WORLD_EVENTS[o.id].color, seconds: WORLD_EVENTS[o.id].seconds, ...made };
    total -= o.w;
    options.splice(options.indexOf(o), 1);
  }
  return null;
}

/** When the next event is due, from now. */
export const nextEventIn = (rand = Math.random) => EVENT_GAP[0] + rand() * (EVENT_GAP[1] - EVENT_GAP[0]);

/**
 * The combined effect of the events still running: multipliers for income, spice, price, preaching,
 * and a happiness bonus. Expired events are ignored.
 * @param {{effect:object, until:number}[]} active
 */
export function activeEffects(active, now) {
  const out = { income: 1, spice: 1, price: 1, preach: 1, happy: 0 };
  for (const e of active || []) {
    if (!(e.until > now)) continue;
    const f = e.effect || {};
    if (f.income) out.income *= f.income;
    if (f.spice) out.spice *= f.spice;
    if (f.price) out.price *= f.price;
    if (f.preach) out.preach *= f.preach;
    if (f.happy) out.happy += f.happy;
  }
  return out;
}

/** Saved events, read defensively (old saves have none). */
export function readEvents(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const num = (v, def) => (Number.isFinite(v) ? v : def);
  const active = (Array.isArray(d.active) ? d.active : [])
    .filter((e) => e && typeof e.id === "string" && WORLD_EVENTS[e.id] && e.effect && typeof e.effect === "object")
    .slice(-6)
    .map((e) => ({ id: e.id, until: num(e.until, 0), effect: { ...e.effect }, at: Number.isInteger(e.at) ? e.at : null }));
  return { next: num(d.next, FIRST_EVENT_AT), last: typeof d.last === "string" && WORLD_EVENTS[d.last] ? d.last : null, active, count: Math.max(0, Math.floor(num(d.count, 0))) };
}
