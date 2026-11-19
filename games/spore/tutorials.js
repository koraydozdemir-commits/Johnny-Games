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
 * @param {{ storage?: Storage, isTouch: () => boolean, show: (tip, text) => void, hide: () => void }} io
 */
export function createTipEngine(io) {
  const KEY = "johnny-spore-tips";
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
    quietFor = 4;
    io.hide();
  };
  return {
    /** Call about twice a second with the elapsed time and a context snapshot. */
    tick(dt, ctx) {
      if (current) {
        shownFor += dt;
        const finished = current.done && current.done(ctx);
        const wrongPlace = !!current.editor !== !!ctx.editor;
        if (finished || wrongPlace || shownFor > 11) close();
        return;
      }
      quietFor -= dt;
      if (quietFor > 0) return;
      const tip = TIPS.filter((t) => !seen.has(t.id) && !!t.editor === !!ctx.editor && !(t.done && t.done(ctx)))
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
  };
}
