/**
 * Tribe life (Tribes and Tribulations): the decisions behind a village that runs itself. Which job
 * a member does, what an idle member chooses next, how the day shapes the routine, what the village
 * builds as it grows, how it looks for the species that lives there, and the character the tribe
 * takes on. Pure: no THREE, no DOM, so every rule here is unit tested; tribe/stage.js acts them out.
 */

/** Ways to put food on the pile. All of them feed the same single store. */
export const FOOD_SOURCES = ["hunt", "fish", "fruit", "forage"];
export const SOURCE_INFO = {
  hunt: { name: "Hunting", icon: "🏹", verb: "Hunting" },
  fish: { name: "Fishing", icon: "🎣", verb: "Fishing" },
  fruit: { name: "Fruit", icon: "🍎", verb: "Picking fruit" },
  forage: { name: "Foraging", icon: "🍄", verb: "Foraging" },
};

/** What a diet allows, as in the original stage: plant eaters don't hunt or fish, meat eaters don't pick fruit. */
export function foodSources(diet) {
  if (diet === "plant") return ["fruit", "forage"];
  if (diet === "meat") return ["hunt", "fish", "forage"];
  return [...FOOD_SOURCES];
}

/**
 * Jobs. An assignment is a priority, never a cage: hunters still defend the village, gatherers still
 * run from danger, workers lend a hand anywhere. Unassigned members pick whatever the tribe needs.
 * The ids "free", "gather" and "guard" are the ones older saves already use.
 */
export const JOBS = {
  free: { name: "Unassigned", icon: "✦", desc: "Does whatever the tribe needs most." },
  hunt: { name: "Hunter", icon: "🏹", desc: "Hunts in groups and hauls the meat home.", source: "hunt" },
  gather: { name: "Gatherer", icon: "🧺", desc: "Picks fruit and forages for food.", source: "fruit" },
  fish: { name: "Fisher", icon: "🎣", desc: "Fishes in the shallows.", source: "fish" },
  guard: { name: "Defender", icon: "🛡", desc: "Watches and patrols the village, first to any fight." },
  work: { name: "Worker", icon: "🔨", desc: "Crafts, repairs and keeps the village supplied." },
};
export const JOB_IDS = Object.keys(JOBS);
/** Which jobs a diet can use (a herbivore tribe has no hunters or fishers). */
export const jobsFor = (diet) => JOB_IDS.filter((j) => !JOBS[j].source || foodSources(diet).includes(JOBS[j].source) || j === "gather");
/** Gatherers do fruit and foraging both. */
export const jobCovers = (job, source) => JOBS[job]?.source === source || (job === "gather" && (source === "fruit" || source === "forage"));

/** The player's food priority: one source the tribe leans toward, or a balanced spread. */
export const PRIORITIES = ["balanced", ...FOOD_SOURCES];

/* ---- time of day --------------------------------------------------------------------------- */
/**
 * The loose daily routine, from the world clock (0 dawn, 0.25 noon, 0.62 dusk, 0.8 midnight).
 * @returns {"dawn"|"day"|"evening"|"night"}
 */
export function dayPhase(t) {
  const x = ((t % 1) + 1) % 1;
  if (x >= 0.96 || x < 0.04) return "dawn";
  if (x < 0.5) return "day";
  if (x < 0.63) return "evening";
  return "night";
}

/**
 * How the stores look against the mouths to feed (each adult eats one a minute).
 * @returns {"short"|"ok"|"plenty"}
 */
export function foodMood(food, adults) {
  const minutes = food / Math.max(1, adults);
  if (minutes < 2) return "short";
  if (minutes >= 6 && food >= 30) return "plenty";
  return "ok";
}

/* ---- choosing what to do ------------------------------------------------------------------- */
export const ACTIVITIES = {
  hunt: { icon: "🏹", name: "Hunting", away: true },
  fish: { icon: "🎣", name: "Fishing", away: true },
  fruit: { icon: "🍎", name: "Picking fruit", away: true },
  forage: { icon: "🍄", name: "Foraging", away: true },
  haul: { icon: "🍖", name: "Hauling meat", away: true },
  work: { icon: "🔨", name: "Working" },
  train: { icon: "⚔", name: "Training" },
  patrol: { icon: "🛡", name: "Patrolling" },
  watch: { icon: "👁", name: "Keeping watch" },
  social: { icon: "💬", name: "Chatting" },
  campfire: { icon: "🔥", name: "At the fire" },
  rest: { icon: "🪑", name: "Resting" },
  sleep: { icon: "💤", name: "Sleeping" },
  play: { icon: "🤸", name: "Playing" },
  investigate: { icon: "👀", name: "Investigating" },
};

/**
 * How much a member wants each activity right now. Weights, not orders: the stage picks one at
 * random in proportion (so two members in the same spot rarely do the same thing at once).
 * @param {object} c
 * @param {string} c.job              a JOBS id
 * @param {string} c.diet             plant | meat | omni
 * @param {string} c.phase            from dayPhase()
 * @param {string} c.mood             from foodMood()
 * @param {string} [c.priority]       a PRIORITIES id
 * @param {Object<string,boolean>} c.available  food sources (and "haul") that can be reached now
 * @param {Object<string,number>} [c.busy]      how many members are already on each activity
 * @param {number} [c.tired]          0 fresh .. 1 exhausted
 * @param {boolean} [c.child]
 * @param {boolean} [c.chief]
 * @param {boolean} [c.armed]         holding a weapon
 * @param {number} [c.repairs]        damaged buildings
 * @param {boolean} [c.homeHold]      the player called everyone home: nothing far away
 * @param {Object<string,boolean>} [c.has]      village facilities: training, rack, craft, lookout
 * @param {Object<string,number>} [c.lean]      tribe personality scores 0..1 (aggressive, peaceful, defensive, prosperous)
 * @param {number} [c.social]         how sociable the species is, 0..1
 * @param {boolean} [c.full]          the stores are overflowing
 * @param {boolean} [c.feast]         a feast night: everyone to the fire
 * @returns {Object<string, number>}  activity id -> weight
 */
export function activityWeights(c) {
  const w = {};
  const busy = c.busy || {},
    lean = c.lean || {},
    has = c.has || {},
    tired = c.tired || 0,
    social = c.social ?? 0.5;
  const phase = c.phase,
    mood = c.mood;
  const night = phase === "night",
    evening = phase === "evening";
  if (c.child) {
    // Children stay at home: play, sit by the fire, nap, sleep at night.
    w.play = night ? 0.05 : 2.5;
    w.social = 0.6;
    w.campfire = evening ? 2 : 0.5;
    w.rest = 0.4 + tired;
    w.sleep = night ? 8 : 0.1 + tired * 0.5;
    return w;
  }
  // Full stores (a dozen minutes of food or more) and the tribe takes it easy.
  const need = mood === "short" ? 3.2 : mood === "ok" ? 1 : c.full ? 0.08 : 0.22;
  const sources = foodSources(c.diet);
  const foodJob = !!JOBS[c.job]?.source;
  const priority = c.priority && c.priority !== "balanced" ? c.priority : null;
  for (const s of sources) {
    if (!c.available?.[s] || c.homeHold) continue;
    // A hunt brings in a whole carcass: with the stores already full, nobody goes hunting.
    if (s === "hunt" && c.full) continue;
    // A job is a job: someone given one keeps at it through the day even with the stores stocked,
    // easing off only once they're overflowing. Everyone else gathers by need.
    const own = jobCovers(c.job, s);
    let v = (own ? Math.max(need, c.full ? 0.3 : 0.75) : need) * (s === "hunt" && mood === "plenty" ? 0.35 : 1);
    if (own) v *= 4;
    else if (foodJob) v *= 0.45;
    else if (c.job === "guard") v *= mood === "short" ? 0.35 : 0.06;
    else if (c.job === "work") v *= 0.55;
    if (priority === s) v *= c.job === "free" || c.job === "work" ? 3.5 : foodJob && !jobCovers(c.job, s) ? 2.2 : 1.3;
    else if (priority) v *= jobCovers(c.job, s) ? 0.8 : 0.45;
    // Spread out: each member already on it makes it a little less attractive.
    v /= 1 + (busy[s] || 0) * 0.35;
    if (night) v *= mood === "short" ? 0.35 : 0.04;
    else if (evening) v *= 0.4;
    else if (phase === "dawn") v *= 0.6;
    if (c.chief) v *= 0.45;
    if (tired > 0.7) v *= 0.5;
    w[s] = v;
  }
  // Meat lying out in the open spoils: hunters (and anyone hungry) fetch it.
  if (c.available?.haul && !c.homeHold && sources.includes("hunt")) w.haul = (c.job === "hunt" ? 6 : 2) * (mood === "short" ? 1.6 : 1) / (1 + (busy.haul || 0) * 0.5);

  const day = !night;
  w.work = (c.job === "work" ? 3 : 0.35) * (day ? 1 : 0.1) + (c.repairs || 0) * (c.job === "work" ? 3 : 1.2) * (day ? 1 : 0.3);
  if (has.craft) w.work *= 1.3;
  w.train = day && (c.armed || c.job === "guard" || c.job === "hunt") ? (has.training || has.rack ? 0.7 : 0.3) * (1 + (lean.aggressive || 0) * 1.4 + (lean.defensive || 0) * 0.9) : 0.02;
  w.patrol = (c.job === "guard" ? 1.8 : 0.06) * (1 + (lean.defensive || 0)) * (night ? 0.7 : 1);
  w.watch = (c.job === "guard" ? 1.1 : 0.15) * (has.lookout ? 1.5 : 1) * (night ? (c.job === "guard" ? 1.4 : 0.1) : 1);
  w.social = 0.55 * (0.5 + social) * (mood === "plenty" ? 1.8 : mood === "short" ? 0.3 : 1) * (evening ? 2 : night ? 0.25 : 1) * (1 + (lean.peaceful || 0) * 0.6 + (lean.prosperous || 0) * 0.4);
  w.campfire = (c.feast ? 3 : 1) * 0.35 * (evening ? 4.5 : night ? (c.job === "guard" ? 2 : 0.9) : phase === "dawn" ? 1.5 : 1) * (mood === "plenty" ? 1.5 : mood === "short" ? 0.6 : 1);
  w.rest = 0.15 + tired * 2.2 + (phase === "dawn" ? 0.4 : 0);
  w.sleep = night ? (c.job === "guard" ? 1 : 7) * (c.chief ? 1.2 : 1) : evening ? 0.15 + tired * 0.6 : tired > 0.85 ? 0.6 : 0;
  w.play = day ? 0.18 * (mood === "plenty" ? 2 : mood === "short" ? 0.15 : 1) * (0.6 + social * 0.8) * (1 + (lean.prosperous || 0) * 0.5) : 0.01;
  if (c.homeHold) w.patrol *= 0.5;
  for (const k of Object.keys(w)) if (!(w[k] > 0)) delete w[k];
  return w;
}

/** Pick one activity in proportion to its weight. */
export function pickActivity(weights, rand = Math.random) {
  const list = Object.entries(weights);
  const total = list.reduce((a, [, v]) => a + v, 0);
  if (!(total > 0)) return null;
  let r = rand() * total;
  for (const [k, v] of list) if ((r -= v) <= 0) return k;
  return list[list.length - 1][0];
}

/** The top activity (for tests and the overview). */
export const topActivity = (weights) => Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

/* ---- expeditions --------------------------------------------------------------------------- */
export const EXPEDITION = { maxTime: 110, maxRange: 120, minHealth: 0.35 };
/**
 * Whether a group out away from the village should turn for home, and why.
 * @param {{t:number, range:number, threat:boolean, phase:string, weakest:number, left:number, carrying?:boolean}} e
 * @returns {null|"threat"|"night"|"hurt"|"time"|"far"|"alone"}
 */
export function expeditionCheck(e) {
  if (e.threat) return "threat";
  if (e.weakest < EXPEDITION.minHealth) return "hurt";
  if (e.phase === "night") return "night";
  if (e.t > EXPEDITION.maxTime) return "time";
  if (e.range > EXPEDITION.maxRange) return "far";
  if (e.left < 1) return "alone";
  return null;
}
/** How many go hunting together: dangerous game needs a proper party. */
export const huntPartySize = (fierce, ready) => Math.max(1, Math.min(ready, fierce ? 4 : 2));

/* ---- the village plan ---------------------------------------------------------------------- */
/**
 * What the village has built for itself at a population: the essentials appear and improve on their
 * own as the tribe grows. Nothing here is decoration for its own sake: every piece matches a need.
 * @param {number} pop          members (children included)
 * @param {object} [o]
 * @param {number} [o.houses]   dwellings the player built (each sleeps a few)
 * @param {number} [o.hutLevel]
 * @param {boolean} [o.weapons] any weapon shack built
 * @param {number} [o.trophies] big hunts brought home
 * @param {object} [o.style]    from speciesStyle()
 * @param {string|null} [o.leaning] from tribePersonality()
 */
export function villagePlan(pop, o = {}) {
  const st = o.style || {};
  const lean = o.leaning || null;
  // The chief's hut sleeps three, each dwelling three more, each shelter two or three.
  const sleeps = 3 + 3 * (o.houses || 0);
  const per = st.size === "small" ? 3 : 2;
  const shelters = Math.max(0, Math.min(8, Math.ceil(Math.max(0, pop - sleeps) / per)));
  return {
    shelters,
    shelterTier: (o.hutLevel || 1) >= 3 ? 3 : (o.hutLevel || 1) >= 2 || pop >= 10 ? 2 : 1,
    storage: pop >= 10 ? 3 : pop >= 6 ? 2 : 1,
    seats: Math.max(3, Math.min(10, Math.ceil(pop * 0.6))),
    rack: !!o.weapons,
    craft: pop >= 5,
    training: pop >= 8 || ((lean === "aggressive" || lean === "defensive") && pop >= 5),
    fence: pop >= 12 ? 3 : pop >= 9 || (lean === "defensive" && pop >= 6) ? 2 : lean === "defensive" ? 1 : 0,
    trophies: st.predatory || lean === "aggressive" ? Math.min(6, o.trophies || 0) : Math.min(2, Math.floor((o.trophies || 0) / 2)),
    garden: st.herbivore && pop >= 6 ? (pop >= 11 ? 2 : 1) : 0,
    ring: (st.social || lean === "peaceful" || lean === "prosperous") && pop >= 6,
    decor: Math.min(6, Math.floor(pop / 3) + (lean === "prosperous" ? 2 : 0)),
  };
}

/* ---- species identity ---------------------------------------------------------------------- */
const SPIKY = new Set(["spines", "quills", "horns", "antlers", "plates", "tusks", "tuskMaw"]);
/**
 * How the species builds and decorates, from what it actually is.
 * @param {object} s
 * @param {string} s.diet
 * @param {{length:number, height:number}} s.dims   the body's size (body3d's length and height)
 * @param {number} s.arms         arm pairs
 * @param {string[]} s.parts      part ids
 * @param {Object<string,number>} [s.abilities]  ability levels (parts.abilitiesOf)
 * @param {{base:number, belly?:number, pattern?:number, accent?:number}} s.colors
 * @param {string[]} [s.legacy]   legacy line names from earlier stages (Aggressive, Social, …)
 */
export function speciesStyle(s) {
  const ab = s.abilities || {};
  const legacy = s.legacy || [];
  const fight = (ab.bite || 0) + (ab.strike || 0) + (ab.charge || 0) + (ab.spit || 0);
  const charm = (ab.sing || 0) + (ab.dance || 0) + (ab.charm || 0) + (ab.pose || 0) * 0.5;
  const predatory = s.diet === "meat" || legacy.some((n) => /Aggressive|Apex|Pack|Feral/.test(n)) || (s.diet === "omni" && fight >= 8);
  const herbivore = s.diet === "plant";
  const social = legacy.some((n) => /Social|Symbiotic|Elusive|Gentle/.test(n)) || charm >= 9;
  const spiky = (s.parts || []).some((id) => SPIKY.has(id));
  const armless = !(s.arms > 0);
  // Size: how much creature there is, mostly length and height together.
  // (Generated species run about 3.4 to 4.3 on this measure; editor-made ones much wider.)
  const bulk = (s.dims?.length || 3.6) * 0.55 + (s.dims?.height || 1.8);
  const size = bulk < 3.55 ? "small" : bulk > 4.05 ? "large" : "medium";
  const tall = (s.dims?.height || 1.8) > (s.dims?.length || 3.6) * 0.75;
  const shelter = armless ? "mound" : predatory ? "tent" : herbivore ? "leaf" : social ? "lodge" : "lodge";
  const decor = [];
  if (predatory) decor.push("bones", "skulls", "hides");
  if (herbivore) decor.push("garden", "vines", "blooms");
  if (social) decor.push("streamers", "drums", "lanterns");
  if (spiky) decor.push("thorns");
  if (!decor.length) decor.push("stones", "streamers");
  const c = s.colors || { base: 0x8a6a4a };
  return {
    size,
    scale: size === "small" ? 0.74 : size === "large" ? 1.32 : 1,
    // Small species pack their villages tight; big ones spread out.
    spacing: size === "small" ? 0.78 : size === "large" ? 1.22 : 1,
    height: tall ? 1.25 : 1,
    shelter,
    predatory,
    herbivore,
    social,
    spiky,
    armless,
    decor,
    colors: { main: c.base, trim: c.pattern ?? c.belly ?? c.base, paint: c.accent ?? c.pattern ?? 0xffffff, belly: c.belly ?? c.base },
  };
}

/* ---- the tribe's character ----------------------------------------------------------------- */
export const LEANINGS = {
  aggressive: { name: "Fierce", icon: "⚔", text: "Trophies, weapons and plenty of combat practice." },
  peaceful: { name: "Peaceful", icon: "🕊", text: "Open gathering places and a lot of company." },
  defensive: { name: "Watchful", icon: "🛡", text: "Patrols, fences and weapons kept ready." },
  prosperous: { name: "Prosperous", icon: "✨", text: "Full stores, celebrations and a busy village." },
};
/** Counters the village keeps as it lives (all saved). */
export const emptyCulture = () => ({ kills: 0, hunts: 0, bigHunts: 0, conquests: 0, allies: 0, songs: 0, gifts: 0, defended: 0, repairs: 0, guardTime: 0, plentyTime: 0, births: 0, feasts: 0 });
/**
 * The tribe's leaning from how it has lived, with each score 0..1 for behaviour weights.
 * @returns {{ leaning: string|null, scores: Object<string, number> }}
 */
export function tribePersonality(c) {
  const k = { ...emptyCulture(), ...(c || {}) };
  const raw = {
    aggressive: k.kills * 1 + k.conquests * 8 + k.hunts * 0.5 + k.bigHunts * 1.5,
    peaceful: k.allies * 8 + k.songs * 0.6 + k.gifts * 2,
    defensive: k.guardTime / 60 + k.repairs * 0.5 + k.defended * 1.5,
    prosperous: k.plentyTime / 60 + k.births * 1.5 + k.feasts,
  };
  const scores = Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, Math.min(1, v / 20)]));
  const [best, v] = Object.entries(raw).sort((a, b) => b[1] - a[1])[0];
  return { leaning: v >= 6 ? best : null, scores };
}

/* ---- foraging ------------------------------------------------------------------------------ */
export const FORAGE = {
  mushroom: { name: "Mushrooms", icon: "🍄", stock: 4, regrow: 45 },
  roots: { name: "Roots", icon: "🥕", stock: 4, regrow: 55 },
  nuts: { name: "Nuts", icon: "🌰", stock: 5, regrow: 60 },
  herbs: { name: "Edible plants", icon: "🌿", stock: 4, regrow: 40 },
  grubs: { name: "Grubs", icon: "🐛", stock: 4, regrow: 50 },
  eggs: { name: "Eggs", icon: "🥚", stock: 3, regrow: 70 },
};
/** What a tribe can forage: plant food for plant eaters, grubs and eggs for meat eaters. */
export function forageKinds(diet) {
  if (diet === "plant") return ["mushroom", "roots", "nuts", "herbs"];
  if (diet === "meat") return ["grubs", "eggs", "grubs"];
  return ["mushroom", "roots", "nuts", "grubs"];
}
/** Food per load for each source (before staffs and legacy bonuses). */
export const LOAD = { fruit: 3, fish: 4, forage: 3, meat: 4 };

/* ---- saving -------------------------------------------------------------------------------- */
const AUTO_IDS = ["shelter", "storage", "rack", "craft", "training", "fence", "trophy", "garden", "ring", "decor", "seat"];
const n = (v, lo, hi, d) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
};
/** Read the life part of a tribe save (priority, culture, the village's own buildings), tolerating anything. */
export function readLife(d) {
  const culture = emptyCulture();
  if (d?.culture && typeof d.culture === "object") for (const k of Object.keys(culture)) culture[k] = Math.round(n(d.culture[k], 0, 1e6, 0));
  const auto = (Array.isArray(d?.auto) ? d.auto : [])
    .filter((a) => a && AUTO_IDS.includes(a.id) && Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.z)))
    .slice(0, 60)
    .map((a) => ({ id: a.id, x: n(a.x, -300, 300, 0), z: n(a.z, -300, 300, 0), k: Math.round(n(a.k, 0, 99, 0)) }));
  return { priority: PRIORITIES.includes(d?.priority) ? d.priority : "balanced", culture, auto };
}
