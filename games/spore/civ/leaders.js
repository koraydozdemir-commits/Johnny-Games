/**
 * Civilization Stage — rival leaders: who they are, how they talk, and what they agree to.
 *
 * Every rival nation has a leader with a personality. The personality changes what the nation does
 * (when it goes to war, what it asks of you, how it answers you), not only the words it uses. Everything
 * a leader agrees to is a real change in the simulation: the stage applies the `effects` returned here.
 *
 * Pure: no DOM, no Three.js. Randomness comes in through `rand`.
 */
import { DIPLO, buyoutCost, clampRel } from "./rules.js";

/* ---- personalities ----------------------------------------------------------------------------- */
export const PERSONALITIES = {
  aggressive: {
    name: "Aggressive",
    icon: "🔥",
    desc: "Prefers conquest; answers threats with war; demands tribute from the weak.",
    warAt: -30, // relation below which it declares war on you
    rest: -10, // where relations settle on their own
    allyAt: 65,
    pactAt: 30,
    gift: 1,
    price: 1.5,
  },
  friendly: {
    name: "Friendly",
    icon: "🌼",
    desc: "Open to alliances and agreements; avoids war.",
    warAt: -75,
    rest: 15,
    allyAt: 35,
    pactAt: 0,
    gift: 1.2,
    price: 1,
  },
  greedy: {
    name: "Greedy",
    icon: "💰",
    desc: "Wealth above all: loves trade and gifts; sells anything for the right price.",
    warAt: -55,
    rest: 0,
    allyAt: 50,
    pactAt: -10,
    gift: 1.5,
    price: 0.85,
  },
  religious: {
    name: "Devout",
    icon: "🕯",
    desc: "Spreads its faith; warms to believers; preaches at those who resist.",
    warAt: -60,
    rest: 0,
    allyAt: 50,
    pactAt: 15,
    gift: 0.8,
    price: 1.1,
  },
  cautious: {
    name: "Cautious",
    icon: "🛡",
    desc: "Weighs every risk: avoids wars it might lose; gives way to a stronger nation.",
    warAt: -70,
    rest: 5,
    allyAt: 50,
    pactAt: 10,
    gift: 1,
    price: 1.2,
  },
};
/** Personalities that suit each kind of nation (the first is the likeliest). */
const FITS = { military: ["aggressive", "cautious", "aggressive"], economic: ["greedy", "friendly", "cautious"], religious: ["religious", "religious", "friendly"] };
export const personalityFor = (type, rand) => {
  const list = FITS[type] || Object.keys(PERSONALITIES);
  return list[Math.floor(rand * list.length) % list.length];
};
const TITLES = { aggressive: "Warlord", friendly: "First Speaker", greedy: "Grand Treasurer", religious: "High Prophet", cautious: "Steward" };
export const leaderTitle = (personality) => TITLES[personality] || "Leader";

/* ---- what leaders say ---------------------------------------------------------------------------- */
/** Lines by personality. `{you}` is your nation's name, `{them}` theirs, `{x}` a number. */
const LINES = {
  greet: {
    aggressive: "So, {you}. We have watched your cities grow. Be careful they don't grow toward ours.",
    friendly: "Welcome, friends of {you}! The {them} have hoped to meet you.",
    greedy: "{you}! New neighbours mean new markets. Let us talk business.",
    religious: "The light finds you at last, {you}. The {them} greet you in faith.",
    cautious: "The {them} acknowledge {you}. We hope our dealings will be careful ones.",
  },
  accept: {
    aggressive: "Agreed. Do not make us regret it.",
    friendly: "Wonderful! Gladly.",
    greedy: "A fine deal. We accept.",
    religious: "It is blessed. We accept.",
    cautious: "After due thought: yes.",
  },
  refuse: {
    aggressive: "You waste our time.",
    friendly: "We're sorry, but not now.",
    greedy: "There's nothing in that for us.",
    religious: "Our faith forbids it.",
    cautious: "That would be unwise for us.",
  },
  cowed: {
    aggressive: "…Very well. For now.",
    friendly: "There's no need for that! We'll keep our distance.",
    greedy: "War is bad for business. We'll stay out of your way.",
    religious: "We will pray for you from afar.",
    cautious: "We have no wish to fight you. We will keep away.",
  },
  defiant: {
    aggressive: "You dare threaten the {them}? Then let it be war!",
    friendly: "That was unkind. We will remember it.",
    greedy: "Threats are bad for trade. And yours are empty.",
    religious: "Our faith does not bend to threats.",
    cautious: "We are not as weak as you think.",
  },
  war: {
    aggressive: "Enough talk. The {them} march on {you}!",
    friendly: "You leave us no choice. It is war.",
    greedy: "You've cost us too much. This is war.",
    religious: "The heretics of {you} must be stopped. War!",
    cautious: "We have weighed it, and we must fight. War.",
  },
};
export function line(kind, personality, names = {}) {
  let t = LINES[kind]?.[personality] || LINES[kind]?.cautious || "";
  // On meeting you, a leader may say what they know of your species' past.
  if (kind === "greet" && names.heritage) t += " " + names.heritage;
  return t.replace(/\{you\}/g, names.you || "your people").replace(/\{them\}/g, names.them || "our people").replace(/\{x\}/g, names.x ?? "");
}

/* ---- what you can say --------------------------------------------------------------------------- */
export const OPTIONS = {
  introduce: { icon: "👋", name: "Introduce yourselves" },
  gift: { icon: "🎁", name: "Send a gift" },
  pact: { icon: "🤝", name: "Propose a trade agreement" },
  alliance: { icon: "🛡", name: "Request an alliance" },
  assist: { icon: "🚨", name: "Ask for assistance" },
  beliefs: { icon: "🕯", name: "Discuss beliefs" },
  buy: { icon: "🏙", name: "Offer to buy a city" },
  demand: { icon: "💸", name: "Demand tribute" },
  threaten: { icon: "⚠", name: "Threaten" },
  peace: { icon: "🕊", name: "Negotiate peace" },
  war: { icon: "⚔", name: "Declare war" },
};
export const ASSIST_COOLDOWN = 120;
export const BELIEFS_COOLDOWN = 60;
export const COWED_FOR = 240;

/**
 * The context a leader answers in.
 * @typedef {{ personality:string, relation:number, war:boolean, met:boolean, allied:boolean, pact:boolean,
 *   power:number, yourPower:number, money:number, yourMoney:number, faith:number, cities:number,
 *   now:number, assistAt?:number, beliefsAt?:number, cityPrice?:number, forces?:number }} Ctx
 */

/** Which options are open right now, each with a reason when it isn't (shown to the player, greyed out). */
export function availableOptions(ctx) {
  const o = [];
  const add = (id, ok, why = "", extra = {}) => o.push({ id, ...OPTIONS[id], ok: !!ok, why: ok ? "" : why, ...extra });
  if (!ctx.met) {
    add("introduce", true);
    return o;
  }
  const peaceCost = peacePrice(ctx);
  if (ctx.war) {
    add("peace", ctx.yourMoney >= peaceCost, `Costs §${peaceCost}`, { cost: peaceCost });
    add("gift", ctx.yourMoney >= DIPLO.giftCost, `Costs §${DIPLO.giftCost}`, { cost: DIPLO.giftCost });
    return o;
  }
  add("gift", ctx.yourMoney >= DIPLO.giftCost, `Costs §${DIPLO.giftCost}`, { cost: DIPLO.giftCost });
  if (!ctx.pact) add("pact", true);
  if (!ctx.allied) add("alliance", true);
  else add("assist", ctx.now >= (ctx.assistAt || 0), `Asked recently: wait ${Math.ceil((ctx.assistAt || 0) - ctx.now)}s`);
  add("beliefs", ctx.now >= (ctx.beliefsAt || 0), "You talked about faith a moment ago");
  if (ctx.cities >= 2) add("buy", !!ctx.cityPrice && ctx.yourMoney >= ctx.cityPrice, ctx.cityPrice ? `Costs §${ctx.cityPrice}` : "Nothing for sale", { cost: ctx.cityPrice });
  if (!ctx.allied) {
    add("demand", true);
    add("threaten", true);
  }
  add("war", true);
  return o;
}

/** The price of peace: personality, and who's winning. */
export function peacePrice(ctx) {
  const p = PERSONALITIES[ctx.personality] || PERSONALITIES.cautious;
  const winning = ctx.power > ctx.yourPower * 1.3;
  return Math.round((DIPLO.peaceCost * p.price * (winning ? 1.5 : ctx.power < ctx.yourPower * 0.7 ? 0.6 : 1)) / 5) * 5;
}
/** What a leader asks for one of its cities (more than a city bought through trade: it's not for sale). */
export function cityPrice(econ, ctx) {
  const p = PERSONALITIES[ctx.personality] || PERSONALITIES.cautious;
  return Math.round((buyoutCost(econ, ctx.relation) * 1.6 * p.price) / 5) * 5;
}

/**
 * A leader's answer to something you say.
 * @param {string} option  a key of OPTIONS
 * @param {Ctx} ctx
 * @param {() => number} [rand]
 * @returns {{ accept:boolean, text:string, effects:object, summary:string }}
 *   effects: relation (change), war, peace, allied, pact, money (to you, negative: you pay),
 *   cowed (seconds), preach (seconds they preach at you), assist, buy, met, assistAt, beliefsAt
 */
export function respond(option, ctx, rand = Math.random, names = {}) {
  const P = PERSONALITIES[ctx.personality] || PERSONALITIES.cautious;
  const pers = ctx.personality;
  const ratio = ctx.yourPower / Math.max(1, ctx.power); // > 1: you're stronger
  const say = (k) => line(k, pers, names);
  const yes = (text, effects, summary) => ({ accept: true, text, effects, summary });
  const no = (text, effects, summary) => ({ accept: false, text, effects, summary });
  switch (option) {
    case "introduce":
      return yes(say("greet"), { met: true, relation: pers === "friendly" ? 8 : pers === "aggressive" ? -2 : 4 }, "You have met.");
    case "gift": {
      const gain = Math.round(DIPLO.gift * P.gift);
      return yes(pers === "greedy" ? "Generous! The treasury thanks you." : pers === "aggressive" ? "A gift. Hm. Accepted." : "Thank you, friends.", { money: -DIPLO.giftCost, relation: gain }, `Relations +${gain}.`);
    }
    case "pact": {
      const need = P.pactAt;
      if (ctx.relation >= need) return yes(say("accept") + " Our traders will welcome yours.", { pact: true, relation: 5 }, "Trade agreement: trade between you pays half as much again, and their traders seek you out.");
      return no(say("refuse"), { relation: pers === "aggressive" ? -4 : -2 }, `They want better relations first (${need >= 0 ? "at least " + need : "above " + need}).`);
    }
    case "alliance": {
      let need = P.allyAt;
      if (pers === "cautious" && ratio > 1.3) need -= 10; // the cautious like a strong friend
      if (pers === "greedy" && ctx.pact) need -= 10;
      if (pers === "religious" && ctx.faith >= 6) need -= 10;
      if (ctx.relation >= need) return yes(say("accept") + " Our forces will stand with yours.", { allied: true, relation: 10 }, "Alliance: they won't attack you, and their military fights your enemies.");
      return no(say("refuse"), { relation: pers === "aggressive" ? -6 : -3 }, `They want relations of at least ${need} first.`);
    }
    case "assist": {
      if (!ctx.allied) return no(say("refuse"), {}, "Only allies send help.");
      // `forces`: their military vehicles that can reach your most threatened city.
      if (!ctx.forces && ctx.money < 60) return no("We have nothing to spare right now.", { assistAt: ctx.now + 30 }, "They have no forces or money to spare.");
      return yes(say("accept") + (ctx.forces ? " Our forces are on their way." : " Take this, for your war chest."), { assist: true, assistAt: ctx.now + ASSIST_COOLDOWN, relation: -2 }, ctx.forces ? "Their military vehicles go to guard your most threatened city for three minutes." : "They send money for your war chest.");
    }
    case "beliefs": {
      const at = ctx.now + BELIEFS_COOLDOWN;
      if (pers === "religious") {
        if (ctx.faith >= 6) return yes("Your temples sing the same songs as ours. We are kin in faith.", { relation: 8, beliefsAt: at }, "Relations +8: they respect your faith.");
        return no("Your people live without the light. We will send missionaries to help them.", { relation: -3, preach: 180, beliefsAt: at }, "They will preach to your cities for a while.");
      }
      if (pers === "friendly") return yes("Every people finds its own way. We respect yours.", { relation: 3, beliefsAt: at }, "Relations +3.");
      if (pers === "aggressive") return no("Faith? Strength is our faith.", { relation: -1, beliefsAt: at }, "They aren't interested.");
      if (pers === "greedy") return no("Faith doesn't pay the bills.", { beliefsAt: at }, "They aren't interested.");
      return yes("An interesting conversation. Thank you.", { relation: 2, beliefsAt: at }, "Relations +2.");
    }
    case "buy": {
      if (!ctx.cityPrice) return no("We have no city to sell.", {}, "");
      if (pers === "aggressive" && ctx.relation < 40) return no("The {them} do not sell their land!".replace("{them}", names.them || "We"), { relation: -5 }, "Aggressive leaders sell only to close friends (relations 40+).");
      if (ctx.relation < (pers === "greedy" ? -10 : 0)) return no(say("refuse"), { relation: -2 }, "They won't sell to a nation they dislike.");
      if (ctx.yourMoney < ctx.cityPrice) return no("You can't afford it.", {}, "");
      return yes(say("accept") + " The city is yours.", { buy: true, money: -ctx.cityPrice, relation: pers === "greedy" ? 5 : -5 }, "The city joins your nation.");
    }
    case "demand": {
      const amount = Math.max(20, Math.round(Math.min(ctx.money * 0.4, 150) / 5) * 5);
      const needRatio = pers === "cautious" ? 1.2 : pers === "greedy" ? 2 : pers === "aggressive" ? Infinity : 1.5;
      if (ratio >= needRatio && ctx.money >= 20) return yes(pers === "greedy" ? "…Take it. This once." : "We will pay. Keep your armies away.", { money: amount, relation: -10 }, `They pay §${amount} (relations −10).`);
      const war = pers === "aggressive" && ctx.relation - 12 < -20;
      return no(war ? say("war") : say("refuse"), { relation: -12, war }, war ? "They declare war!" : "Relations −12.");
    }
    case "threaten": {
      if (ratio >= 1.3 && pers !== "aggressive") return yes(say("cowed"), { cowed: COWED_FOR, relation: -8 }, `They won't move against you for ${COWED_FOR / 60} minutes (relations −8).`);
      const war = pers === "aggressive" ? ctx.relation - 20 < -30 || rand() < 0.5 : ratio < 0.7 && ctx.relation - 10 < P.warAt;
      return no(war ? say("war") : say("defiant").replace(/\{them\}/g, names.them || "us"), { relation: pers === "aggressive" ? -20 : -10, war }, war ? "They declare war!" : "It didn't work: they aren't afraid of you.");
    }
    case "peace": {
      const price = peacePrice(ctx);
      if (pers === "aggressive" && ctx.power > ctx.yourPower * 1.5) return no("Peace? We are winning. Never!", {}, "They're winning, and won't stop.");
      if (ctx.yourMoney < price) return no(`Peace costs §${price}.`, {}, "");
      return yes(say("accept") + " Let the fighting end.", { peace: true, money: -price }, "Peace. Their vehicles stand down.");
    }
    case "war":
      return yes(pers === "aggressive" ? "At last. Come, then!" : pers === "cautious" ? "You will regret this." : "So be it.", { war: true }, "War! Their military will come for you.");
    default:
      return no("…", {}, "");
  }
}

/* ---- leaders who start the conversation ---------------------------------------------------------- */
export const MESSAGE_TTL = 45;
/**
 * Whether a nation has something to say to you now. Called every so often for each nation that has no
 * message waiting. Returns null, or { kind, text, choices: [{ id, label }] }.
 * @param {Ctx & { seen:boolean, lastAsk?:object }} ctx
 */
export function incoming(ctx, rand = Math.random, names = {}) {
  const pers = ctx.personality;
  const P = PERSONALITIES[pers] || PERSONALITIES.cautious;
  const ratio = ctx.yourPower / Math.max(1, ctx.power);
  const msg = (kind, text, choices) => ({ kind, text, choices });
  if (!ctx.met) return ctx.seen ? msg("greet", line("greet", pers, names), [{ id: "accept", label: "👋 Greet them" }, { id: "decline", label: "Ignore them" }]) : null;
  if (ctx.war) {
    if (ratio > 1.4 && rand() < 0.5) return msg("peace", pers === "aggressive" ? "…Perhaps this war has gone on long enough." : "We are losing too many. Let us make peace.", [{ id: "accept", label: "🕊 Accept peace" }, { id: "decline", label: "Fight on" }]);
    return null;
  }
  const r = rand();
  if (!ctx.allied && ctx.relation >= P.allyAt + 5 && r < 0.35) return msg("alliance", pers === "friendly" ? "We have grown fond of you. Shall we stand together?" : "Our interests are aligned. An alliance?", [{ id: "accept", label: "🛡 Accept the alliance" }, { id: "decline", label: "Decline" }]);
  if (!ctx.pact && ctx.relation >= P.pactAt + 5 && (pers === "greedy" || pers === "friendly") && r < 0.5) return msg("pact", "Our merchants would like to trade with yours on better terms. An agreement?", [{ id: "accept", label: "🤝 Accept the agreement" }, { id: "decline", label: "Decline" }]);
  if (!ctx.allied && (pers === "aggressive" || pers === "greedy") && ctx.relation < 10 && ratio < 0.8 && ctx.yourMoney >= 40 && r < 0.45) {
    const amount = Math.max(30, Math.round(Math.min(ctx.yourMoney * 0.3, 160) / 5) * 5);
    return msg("demand", (pers === "aggressive" ? "Pay us §{x}, {you}, or we will take it from your cities." : "A little 'protection' fee: §{x}. It would be a shame if trade… stopped.").replace("{x}", amount).replace("{you}", names.you || "you"), [
      { id: "accept", label: `💸 Pay §${amount}`, amount },
      { id: "decline", label: "Refuse" },
    ]);
  }
  if (pers === "religious" && ctx.faith < 6 && ctx.relation > -40 && r < 0.4) return msg("beliefs", "Open your hearts to our faith, and our peoples will be as one.", [{ id: "accept", label: "🕯 Welcome their missionaries" }, { id: "decline", label: "Politely refuse" }]);
  return null;
}
/** What happens when you answer a message. */
export function answer(message, choiceId, ctx, names = {}) {
  const pers = ctx.personality;
  const ok = choiceId === "accept";
  switch (message.kind) {
    case "greet":
      return ok ? { text: "We look forward to knowing you.", effects: { met: true, relation: 5 }, summary: "You have met." } : { text: "…How rude.", effects: { met: true, relation: -5 }, summary: "Relations −5." };
    case "alliance":
      return ok ? { text: line("accept", pers, names), effects: { allied: true, relation: 10 }, summary: "Alliance: they won't attack you, and their military fights your enemies." } : { text: "A pity.", effects: { relation: -4 }, summary: "Relations −4." };
    case "pact":
      return ok ? { text: line("accept", pers, names), effects: { pact: true, relation: 5 }, summary: "Trade agreement: trade between you pays half as much again." } : { text: "Another time, then.", effects: { relation: -2 }, summary: "Relations −2." };
    case "demand": {
      const amount = message.choices.find((c) => c.id === "accept")?.amount || 0;
      if (ok) return { text: "A wise choice.", effects: { money: -amount, relation: 8 }, summary: `You paid §${amount} (relations +8).` };
      const war = pers === "aggressive" && ctx.relation - 15 < -20;
      return { text: war ? line("war", pers, names) : "You will regret that.", effects: { relation: -15, war }, summary: war ? "They declare war!" : "Relations −15." };
    }
    case "beliefs":
      return ok ? { text: "Bless you. Our missionaries will be gentle.", effects: { relation: 12, preach: 120 }, summary: "Relations +12. Their missionaries will visit your cities for a while." } : { text: "Then we will pray for you.", effects: { relation: -6 }, summary: "Relations −6." };
    case "peace":
      return ok ? { text: "Then it is over.", effects: { peace: true, relation: 5 }, summary: "Peace." } : { text: "So be it.", effects: { relation: -5 }, summary: "The war goes on." };
    default:
      return { text: "", effects: {}, summary: "" };
  }
}
/** The answer you give by saying nothing (a message left too long). */
export const silence = (message, ctx, names) => answer(message, "decline", ctx, names);

/** Relations after applying a change, clamped. */
export const nudge = (r, d) => clampRel(r + (d || 0));

/** A leader's own name, from a seeded random source (the same nation always has the same leader). */
export function leaderName(rand) {
  const a = ["Ka", "Zo", "Mi", "Thu", "Ve", "Or", "Sa", "Gri", "Lu", "Ny", "Bo", "Ixa", "Re", "Qu", "Ta", "Elo"];
  const b = ["rak", "ven", "lith", "mora", "dux", "sha", "nor", "bel", "quin", "tess", "gor", "lia", "vos", "rin"];
  const pick = (l) => l[Math.floor(rand() * l.length) % l.length];
  return pick(a) + pick(b) + (rand() < 0.35 ? " " + pick(a) + pick(b).slice(0, 2) : "");
}

/* ---- rivals among themselves -------------------------------------------------------------------- */
/**
 * Rival nations have relations with each other too, kept per pair. Relations drift toward a resting
 * point (their personalities, neighbourhood, agreements, a common enemy or a common threat), and now and
 * then a pair goes to war, makes peace, allies or signs a trade agreement. The stage carries it out.
 */
export const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
/**
 * Where a pair's relations settle.
 * @param {{personality:string}} A @param {{personality:string}} B
 * @param {{ pact?:boolean, allied?:boolean, neighbours?:boolean, commonEnemy?:boolean, commonThreat?:boolean, fear?:boolean, trading?:boolean }} ctx
 *   commonThreat: a third nation dominates the planet; fear: one of this pair is that nation
 */
export function pairRest(A, B, ctx = {}) {
  const pa = PERSONALITIES[A.personality] || PERSONALITIES.cautious,
    pb = PERSONALITIES[B.personality] || PERSONALITIES.cautious;
  let r = (pa.rest + pb.rest) / 2;
  if (ctx.neighbours) r -= 12; // sharing a continent means rubbing up against each other
  if (ctx.pact) r += 8;
  if (ctx.allied) r += 12;
  if (ctx.trading) r += 5;
  if (ctx.commonEnemy) r += 15;
  if (ctx.commonThreat) r += 15; // a rising power drives the rest together…
  if (ctx.fear) r -= 20; // …and turns them against it
  return Math.max(-90, Math.min(90, r));
}
/**
 * What a pair of rivals does next, if anything.
 * @param {{personality:string, type:string, power:number}} A @param {{personality:string, type:string, power:number}} B
 * @param {{rel:number, war:boolean, allied:boolean, pact:boolean, warFor?:number}} pair
 * @param {{ commonThreat?:boolean }} [ctx]
 * @returns {null | { kind:"war"|"peace"|"ally"|"pact"|"break", by:"A"|"B" }}
 */
export function pairDecision(A, B, pair, ctx = {}, rand = Math.random) {
  const P = (x) => PERSONALITIES[x.personality] || PERSONALITIES.cautious;
  const warlike = (x) => x.type === "military" || x.personality === "aggressive";
  if (pair.allied && pair.rel < 10) return { kind: "break", by: pair.rel < 0 ? "A" : "B" };
  if (pair.war) {
    // Wars end when one side is losing badly, or when tempers have cooled.
    const weaker = A.power < B.power ? "A" : "B";
    const ratio = Math.min(A.power, B.power) / Math.max(1, Math.max(A.power, B.power));
    if ((pair.warFor || 0) > 90 && (ratio < 0.6 || pair.rel > -35) && rand() < 0.3) return { kind: "peace", by: weaker };
    return null;
  }
  // War: started by the more warlike side, if relations are bad enough for it (and, if cautious, it would win).
  for (const [x, y, by] of [
    [A, B, "A"],
    [B, A, "B"],
  ]) {
    if (pair.allied || !warlike(x) || pair.rel >= P(x).warAt) continue;
    if (x.personality === "cautious" && x.power < y.power * 1.2) continue;
    if (ctx.commonThreat) continue; // not while a bigger danger looms
    if (rand() < 0.3) return { kind: "war", by };
  }
  const allyAt = Math.max(P(A).allyAt, P(B).allyAt) - (ctx.commonThreat ? 25 : 0);
  if (!pair.allied && pair.rel >= allyAt && rand() < 0.3) return { kind: "ally", by: "A" };
  if (!pair.pact && pair.rel >= Math.max(P(A).pactAt, P(B).pactAt) && rand() < 0.3) return { kind: "pact", by: "A" };
  return null;
}
/** The share of the planet's cities above which a nation is a threat everyone else unites against. */
export const DOMINANT_SHARE = 0.4;
