/**
 * The Civilization Stage's real-time strategy rules: what commands exist and which apply to a selection,
 * what a tap or right-click means on each kind of target, how a group spreads out, box selection, how vehicles
 * are produced over time at a city, and how shots fly. Pure (no scene), so every rule is unit tested.
 */

/* ------------------------------------------------------------------------------- commands */
export const COMMANDS = {
  move: { label: "Move", hint: "Tap a place to send the selected vehicles there." },
  attack: { label: "Attack", hint: "Tap an enemy vehicle or city. Military vehicles open fire." },
  defend: { label: "Defend", hint: "Tap one of your cities or a place: military vehicles guard it and engage anything hostile that comes near." },
  follow: { label: "Follow", hint: "Tap one of your vehicles: the selected ones stay close to it." },
  trade: { label: "Trade", hint: "Tap a city: economic vehicles open trade, religious ones preach." },
  capture: { label: "Capture", hint: "Tap a spice geyser: land and air vehicles claim it (military ones wreck a rival's derrick)." },
  stop: { label: "Stop", hint: "Cancel orders: the selected vehicles halt." },
};
export const COMMAND_IDS = Object.keys(COMMANDS);

const has = (units, f) => units.some(f);
/**
 * Commands for a selection, each with whether it can be used and, if not, why.
 * @param {Array<{role:string, mode:string, order:any}>} units
 */
export function availableCommands(units) {
  const mil = has(units, (u) => u.role === "military");
  const eco = has(units, (u) => u.role === "economic");
  const rel = has(units, (u) => u.role === "religious");
  const walkers = has(units, (u) => u.mode !== "sea");
  const none = !units.length;
  const state = {
    move: [!none, "Select a vehicle first."],
    attack: [mil, "Only military vehicles attack."],
    defend: [mil, "Only military vehicles defend."],
    follow: [!none, "Select a vehicle first."],
    trade: [eco || rel, "Economic vehicles trade and religious ones preach."],
    capture: [walkers, "Boats cannot reach spice geysers."],
    stop: [has(units, (u) => u.order), "Nothing to stop."],
  };
  return COMMAND_IDS.map((id) => {
    const [ok, why] = state[id];
    let label = COMMANDS[id].label;
    if (id === "trade") label = eco && !rel ? "Trade" : rel && !eco ? "Preach" : "Trade / preach";
    return { id, label, hint: COMMANDS[id].hint, enabled: !!ok, why: ok ? "" : why };
  });
}

/**
 * What a plain tap (or right-click) on something means for a selection. `target.kind` is "ground", "vehicle",
 * "city" or "geyser"; `target.own` and `target.free` say whose it is.
 * @returns {{id:string, units:object[]}|{id:"none", reason:string}}
 */
export function contextCommand(units, target) {
  if (!units.length) return { id: "none", reason: "Select a vehicle first." };
  const mil = units.filter((u) => u.role === "military");
  const walkers = units.filter((u) => u.mode !== "sea");
  switch (target.kind) {
    case "vehicle":
      if (target.own) return { id: "follow", units };
      return mil.length ? { id: "attack", units: mil } : { id: "none", reason: "Only military vehicles attack vehicles." };
    case "city":
      if (target.own) return mil.length ? { id: "defend", units: mil } : { id: "interact", units: [] };
      return { id: "city", units };
    case "geyser":
      return walkers.length ? { id: "capture", units: walkers } : { id: "none", reason: "Boats cannot reach spice geysers." };
    default:
      return { id: "move", units };
  }
}

/* ------------------------------------------------------------------------------ formations */
/**
 * Where each of n vehicles stands relative to the destination: one in the middle, then rings of six and
 * twelve, so a group arrives spread out instead of stacked on one point.
 */
export function formationOffsets(n, spacing = 5) {
  const out = [{ dx: 0, dz: 0 }];
  for (let ring = 1; out.length < n; ring++) {
    const count = ring * 6;
    for (let i = 0; i < count && out.length < n; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.4;
      out.push({ dx: Math.cos(a) * spacing * ring, dz: Math.sin(a) * spacing * ring });
    }
  }
  return out.slice(0, n);
}
/** Spread a group's units to their offsets by distance order, so the nearest unit takes the middle. */
export function assignFormation(units, dest, spacing = 5) {
  const offs = formationOffsets(units.length, spacing);
  const sorted = [...units].sort((a, b) => Math.hypot(a.pos.x - dest.x, a.pos.z - dest.z) - Math.hypot(b.pos.x - dest.x, b.pos.z - dest.z));
  return new Map(sorted.map((u, i) => [u, { x: dest.x + offs[i].dx, z: dest.z + offs[i].dz }]));
}

/* -------------------------------------------------------------------------- box selection */
/**
 * Units whose screen points fall inside a rectangle (any two opposite corners).
 * @param {Array<object>} units
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect
 * @param {(u:object)=>{x:number,y:number,on:boolean}} project
 */
export function unitsInRect(units, rect, project) {
  const x0 = Math.min(rect.x0, rect.x1),
    x1 = Math.max(rect.x0, rect.x1),
    y0 = Math.min(rect.y0, rect.y1),
    y1 = Math.max(rect.y0, rect.y1);
  return units.filter((u) => {
    const p = project(u);
    return p.on && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  });
}

/* ------------------------------------------------------------------------------ production */
/** At most this many vehicles wait in a city's production line. */
export const QUEUE_MAX = 3;
/** Seconds to build a vehicle: dearer ones take longer; every factory in the city speeds the line up. */
export const buildTime = (cost, factories = 0) => Math.round(((6 + cost * 0.12) / Math.min(2, 1 + 0.25 * factories)) * 10) / 10;

/**
 * Can this city take another vehicle into production?
 * @returns {{ok:boolean, reason:string}}
 */
export function canQueue({ queued, have, cap, money, cost, valid = true, perCity = 3 }) {
  if (!valid) return { ok: false, reason: "That design can't be used: fix it in Designs." };
  if (queued >= QUEUE_MAX) return { ok: false, reason: `The production line holds ${QUEUE_MAX} vehicles.` };
  if (have + queued >= cap) return { ok: false, reason: `Each city supports ${perCity} vehicles: take more cities for more.` };
  if (money < cost) return { ok: false, reason: "Not enough money." };
  return { ok: true, reason: "" };
}
/** A production item: paid for now, finished after `total` seconds of the line working on it. */
export const newItem = (key, cost, factories = 0) => ({ key, cost, total: buildTime(cost, factories), t: 0 });
/**
 * Advance a city's production line. Only the first item is worked on. Returns the finished item (or null);
 * if the vehicle cannot appear yet (`canSpawn` false) the item waits at the head, complete.
 */
export function tickQueue(queue, dt, canSpawn = true) {
  const head = queue[0];
  if (!head) return null;
  head.t = Math.min(head.total, head.t + dt);
  if (head.t >= head.total && canSpawn) return queue.shift();
  return null;
}
/** Money back for cancelling an item: all of it if it has not started, less the further it got. */
export const refundOf = (item) => Math.round(item.cost * (1 - 0.5 * Math.min(1, item.t / item.total)));

/* ---------------------------------------------------------------------------------- combat */
/** Projectile speeds (metres a second) by kind. */
export const PROJECTILE = { bullet: { speed: 70, arc: 0 }, shell: { speed: 38, arc: 0.18 }, missile: { speed: 30, arc: 0.1 } };
/** Seconds for a projectile to travel a distance. */
export const flightTime = (dist, kind) => dist / (PROJECTILE[kind] || PROJECTILE.shell).speed;
/** Damage of one shot: the unit's damage a second spread over its rate of fire. */
export const shotDamage = (dps, rate) => dps / Math.max(0.1, rate);
/**
 * The best target for a unit among hostile vehicles: the nearest within `reach`, with armed ones preferred
 * (they are the threat). `foes` need pos and role.
 */
export function pickTarget(unit, foes, reach) {
  let best = null,
    bs = Infinity;
  for (const f of foes) {
    const d = Math.hypot(f.pos.x - unit.pos.x, f.pos.z - unit.pos.z);
    if (d > reach) continue;
    const score = d - (f.role === "military" ? 5 : 0);
    if (score < bs) {
      bs = score;
      best = f;
    }
  }
  return best;
}
/** Keep-apart push for vehicles standing too close: a small vector away from the neighbours. */
export function separation(unit, others, radius = 3.2) {
  let sx = 0,
    sz = 0;
  for (const o of others) {
    if (o === unit) continue;
    const dx = unit.pos.x - o.pos.x,
      dz = unit.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= radius || d < 1e-6) continue;
    const k = (radius - d) / radius;
    sx += (dx / d) * k;
    sz += (dz / d) * k;
  }
  return { x: sx, z: sz };
}
