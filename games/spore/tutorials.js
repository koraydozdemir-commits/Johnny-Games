/**
 * Dynamic tutorials: short, one-time hints that appear when they become relevant and disappear once
 * the player has done the thing (or after a while). The game hands the engine a snapshot of what is
 * going on (`ctx`) twice a second; the engine decides which hint, if any, to show.
 *
 * A tip: { id, when(ctx), done?(ctx), text: string | { touch, desktop }, anchor?: css selector,
 *          priority?: higher shows first, editor?: true to show only in the editor }
 */

export const TIPS = [
  {
    id: "move",
    priority: 100,
    when: (c) => c.playing && c.time > 1.5,
    done: (c) => c.distanceSwum > 4,
    text: {
      touch: "Drag anywhere to swim.",
      desktop: "Hold the mouse, or use WASD, to swim.",
    },
  },
  {
    id: "eat",
    priority: 90,
    when: (c) => c.playing && c.foodEaten === 0 && c.compatibleFoodNear,
    done: (c) => c.foodEaten > 0,
    text: (c) =>
      c.diet === "meat"
        ? "Food discovered: swim into the meat."
        : "Food discovered: swim into the buds.",
  },
  {
    id: "wrong-diet",
    priority: 85,
    when: (c) => c.playing && c.touchedWrongFood,
    text: (c) =>
      c.diet === "plant"
        ? "Your mouth only eats plants."
        : "Your jaw only eats meat.",
  },
  {
    id: "predator",
    priority: 95,
    when: (c) => c.playing && c.predatorNear,
    text: "Red rim: a hunter.",
  },
  {
    id: "low-health",
    priority: 92,
    when: (c) => c.playing && c.healthPct < 0.35,
    done: (c) => c.healthPct > 0.6,
    text: "Hurt. Eat to heal.",
  },
  {
    id: "growth-bar",
    priority: 60,
    when: (c) => c.playing && c.foodEaten >= 2 && !c.mateReady,
    text: "Eating fills your growth bar.",
    anchor: "#growthBar",
  },
  {
    id: "diet-path",
    priority: 55,
    when: (c) => c.playing && c.foodEaten >= 5,
    text: "What you eat shapes your species.",
    anchor: "#dietPath",
  },
  {
    id: "meteor",
    priority: 80,
    when: (c) => c.playing && c.meteorNear,
    done: (c) => c.shards > 0,
    text: "A meteor shard. Grab it.",
  },
  {
    id: "part-orb",
    priority: 82,
    when: (c) => c.playing && c.partOrbNear,
    text: "A part! Swim over it.",
  },
  {
    id: "colony",
    priority: 50,
    when: (c) => c.playing && c.colonyNear && c.diet !== "meat",
    text: "Colonies regrow.",
  },
  {
    id: "kin",
    priority: 58,
    when: (c) => c.playing && c.kinNear,
    text: "Teal rim: your own kind.",
  },
  {
    id: "giant",
    priority: 88,
    when: (c) => c.playing && c.giantNear,
    text: "Too big for you. For now.",
  },
  {
    id: "new-part",
    priority: 75,
    when: (c) => c.playing && c.unlockedSinceEditor > 0,
    done: (c) => c.editor,
    text: "New part! Add it when you next mate.",
    anchor: "#touchMate",
  },
  {
    id: "mate-ready",
    priority: 97,
    when: (c) => c.playing && c.mateReady && !c.mateSignal,
    done: (c) => c.mateSignal,
    text: { touch: "Fully grown! Tap MATE to leave the water.", desktop: "Fully grown! Press M to call a mate and leave the water." },
    anchor: "#touchMate",
  },
  {
    id: "mate-follow",
    priority: 96,
    when: (c) => c.playing && c.mateSignal,
    text: "Follow the ♡ to your mate.",
  },
  {
    id: "history",
    priority: 70,
    when: (c) => c.playing && c.generations >= 2,
    done: (c) => c.pathOpened,
    text: "Your history grows. Tap ◈.",
    anchor: "#pathToggle",
  },
  {
    id: "bite",
    priority: 86,
    when: (c) => c.playing && c.canBite && c.preyNear,
    text: "Bite smaller cells.",
  },
  {
    id: "first-mouth",
    priority: 120,
    editor: true,
    when: (c) => c.editor && !c.hasMouth,
    done: (c) => c.hasMouth,
    text: {
      touch: "Needs a mouth: drag one on from the drawer.",
      desktop: "Needs a mouth: drag one onto the front.",
    },
    anchor: "#buildTool",
  },
  {
    id: "editor-basics",
    priority: 100,
    editor: true,
    anchor: "#buildTool",
    when: (c) => c.editor,
    text: {
      touch: "Drag parts onto your cell.",
      desktop: "Drag parts onto your cell.",
    },
  },
  {
    id: "editor-locked",
    priority: 90,
    editor: true,
    when: (c) => c.editor && c.time > 4,
    text: "Grey parts are locked. Each card says where to find it.",
  },
];

/**
 * The Tribal Stage's first steps, one short tip at a time instead of a help sheet on arrival. The
 * stage hands the engine { playing, time (seconds since arriving), selected, food, babyCost, diet,
 * legacy (lines carried from earlier stages) }. The full guide stays under ☰ How to play.
 */
export const TRIBE_TIPS = [
  { id: "look", priority: 100, when: (c) => c.playing && c.time > 1.5, text: { touch: "Drag to look around. Pinch to zoom.", desktop: "Drag or use WASD to look around. Scroll to zoom." } },
  { id: "select", priority: 95, when: (c) => c.playing && c.time > 8, done: (c) => c.selected > 0, text: "Tap one of your tribe, or All, to select." },
  { id: "order", priority: 94, when: (c) => c.playing && c.selected > 0, text: "Now tap where they should go, or what to do." },
  {
    id: "food",
    priority: 90,
    when: (c) => c.playing && c.time > 18,
    text: (c) => (c.diet === "meat" ? "Food: tap the ripples in the sea to fish." : c.diet === "plant" ? "Food: tap a fruit bush to gather." : "Food: tap a fruit bush, or ripples in the sea."),
  },
  { id: "hunt", priority: 85, when: (c) => c.playing && c.time > 40 && c.diet !== "plant", text: "Tap a grazing animal to hunt it." },
  { id: "baby", priority: 88, when: (c) => c.playing && c.time > 25 && c.food >= c.babyCost, text: (c) => "🥚 Baby: " + c.babyCost + " food for one more member." },
  { id: "life", priority: 80, when: (c) => c.playing && c.time > 60, text: "Your tribe works on its own. 🧭 Tribe sets jobs." },
  { id: "build", priority: 78, when: (c) => c.playing && c.time > 85, text: "🔨 Build adds shacks and better tools." },
  { id: "rivals", priority: 76, when: (c) => c.playing && c.time > 110, text: "Tap a rival village to see what it wants." },
  { id: "goal", priority: 74, when: (c) => c.playing && c.time > 135, text: "Goal: ally with every tribe, or bring it down." },
  { id: "legacy", priority: 72, when: (c) => c.playing && c.time > 160 && c.legacy > 0, text: "Your species' legacy is under ☰ How to play." },
  { id: "guide", priority: 70, when: (c) => c.playing && c.time > 185, text: "More detail any time: ☰ How to play." },
];

/** The Civilization Stage's first steps. Context: { playing, time, selected, cityOpened }. */
export const CIV_TIPS = [
  { id: "look", priority: 100, when: (c) => c.playing && c.time > 1.5, text: { touch: "Drag to turn the planet. Pinch to zoom.", desktop: "Drag to turn the planet. Scroll to zoom." } },
  { id: "city", priority: 95, when: (c) => c.playing && c.time > 9, done: (c) => c.cityOpened, text: "Tap your city, then Open city, to build." },
  { id: "vehicles", priority: 92, when: (c) => c.playing && c.time > 22, done: (c) => c.selected > 0, text: "Tap a vehicle, or All, then tap where it goes." },
  { id: "spice", priority: 88, when: (c) => c.playing && c.time > 45, text: "Drive to a spice geyser to build a derrick." },
  { id: "take", priority: 85, when: (c) => c.playing && c.time > 75, text: "Take cities by force, trade or faith." },
  { id: "talk", priority: 82, when: (c) => c.playing && c.time > 100, text: "Tap a leader at the top to talk." },
  { id: "money", priority: 80, when: (c) => c.playing && c.time > 125, text: "Tap your money to sell spice." },
  { id: "goal", priority: 76, when: (c) => c.playing && c.time > 150, text: "Goal: every city under your flag." },
  { id: "guide", priority: 70, when: (c) => c.playing && c.time > 175, text: "More detail any time: ☰ How to play." },
];

/**
 * @param {{ storage?: Storage, isTouch: () => boolean, show: (tip, text) => void, hide: () => void,
 *   tips?: object[], key?: string, hold?: number, gap?: number }} io  tips/key/hold/gap default to the Cell Stage's
 */
export function createTipEngine(io) {
  const KEY = io.key || "johnny-spore-tips";
  const LIST = io.tips || TIPS;
  const HOLD = io.hold ?? 11,
    GAP = io.gap ?? 4;
  let seen = new Set();
  try {
    seen = new Set(JSON.parse(io.storage?.getItem(KEY) || "[]"));
  } catch (e) {
    seen = new Set();
  }
  let current = null,
    shownFor = 0,
    quietFor = 3;
  const save = () => {
    try {
      io.storage?.setItem(KEY, JSON.stringify([...seen]));
    } catch (e) {
      /* storage may be unavailable */
    }
  };
  const textOf = (tip, ctx) => {
    const t = typeof tip.text === "function" ? tip.text(ctx) : tip.text;
    return typeof t === "string" ? t : io.isTouch() ? t.touch : t.desktop;
  };
  const close = () => {
    if (!current) return;
    seen.add(current.id);
    save();
    current = null;
    quietFor = GAP;
    io.hide();
  };
  return {
    /** Call about twice a second with the elapsed time and a context snapshot. */
    tick(dt, ctx) {
      if (current) {
        shownFor += dt;
        const finished = current.done && current.done(ctx);
        const wrongPlace = !!current.editor !== !!ctx.editor;
        if (finished || wrongPlace || shownFor > HOLD) close();
        return;
      }
      quietFor -= dt;
      if (quietFor > 0) return;
      const tip = LIST.filter((t) => !seen.has(t.id) && !!t.editor === !!ctx.editor && !(t.done && t.done(ctx)))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .find((t) => t.when(ctx));
      if (!tip) return;
      current = tip;
      shownFor = 0;
      io.show(tip, textOf(tip, ctx));
    },
    dismiss: close,
    reset() {
      seen.clear();
      save();
      close();
    },
    get active() {
      return current;
    },
    /** Every tip has been shown. */
    get finished() {
      return LIST.every((t) => seen.has(t.id));
    },
    /** Whether any tip has been shown yet (a stage's coach carries on after a reload). */
    get started() {
      return seen.size > 0;
    },
  };
}

/**
 * A stage's coach: its tips shown one at a time through the stage's own toast. It runs for a stage
 * begun fresh (and carries on after a reload until every tip has shown), never for an old save.
 * @param {{ tips: object[], key: string, storage?: Storage, fresh: boolean, toast: (text:string, seconds:number) => void }} o
 */
export function createStageCoach(o) {
  const ON = o.key + "-on";
  let on = false;
  try {
    if (o.fresh) o.storage?.setItem(ON, "1");
    on = o.fresh || o.storage?.getItem(ON) === "1";
  } catch (e) {
    on = !!o.fresh;
  }
  const touch = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const engine = createTipEngine({ storage: o.storage, isTouch: touch, tips: o.tips, key: o.key, hold: 6.5, gap: 3, show: (tip, text) => o.toast(text, 6), hide: () => {} });
  let time = 0,
    clock = 0;
  return {
    /** Every frame the stage is running; `ctx` is read twice a second. Time counts from arrival. */
    tick(dt, ctx) {
      if (!on) return;
      time += dt;
      if ((clock -= dt) > 0) return;
      clock = 0.5;
      engine.tick(0.5, { ...ctx(), time });
      if (engine.finished) {
        on = false;
        try {
          o.storage?.removeItem(ON);
        } catch (e) {
          /* fine */
        }
      }
    },
    get engine() {
      return engine;
    },
  };
}
