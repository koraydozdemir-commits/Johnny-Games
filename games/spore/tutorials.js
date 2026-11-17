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
      touch: "Put your thumb anywhere on the water and drag the way you want to swim.",
      desktop: "Hold the mouse button on the water to swim towards it, or use WASD / the arrow keys.",
    },
  },
  {
    id: "eat",
    priority: 90,
    when: (c) => c.playing && c.foodEaten === 0 && c.compatibleFoodNear,
    done: (c) => c.foodEaten > 0,
    text: (c) =>
      c.diet === "meat"
        ? "Red chunks are meat. Swim your jaw into one to eat it. Bitten cells drop more."
        : "Green buds are plants. Swim your mouth into one to eat it.",
  },
  {
    id: "wrong-diet",
    priority: 85,
    when: (c) => c.playing && c.touchedWrongFood,
    text: (c) =>
      c.diet === "plant"
        ? "Your filter mouth can only eat plants. A Jaw (found on Flickers and Gnashers) lets you eat meat."
        : "Your jaw can only eat meat. Add a Filter mouth in the editor to eat plants too.",
  },
  {
    id: "predator",
    priority: 95,
    when: (c) => c.playing && c.predatorNear,
    text: "Cells with a red rim are hunters. Swim away, or grow spikes and jaws to fight back.",
  },
  {
    id: "low-health",
    priority: 92,
    when: (c) => c.playing && c.healthPct < 0.35,
    done: (c) => c.healthPct > 0.6,
    text: "You're hurt. Eating heals you. Keep away from hunters until you recover.",
  },
  {
    id: "growth-bar",
    priority: 60,
    when: (c) => c.playing && c.foodEaten >= 2 && !c.mateReady,
    text: "Every bite fills the growth bar at the top. Fill it to call a mate and evolve.",
    anchor: "#growthBar",
  },
  {
    id: "diet-path",
    priority: 55,
    when: (c) => c.playing && c.foodEaten >= 5,
    text: "Plants and meat shift your diet path. Where it ends decides your trait card for the next stage.",
    anchor: "#dietPath",
  },
  {
    id: "meteor",
    priority: 80,
    when: (c) => c.playing && c.meteorNear,
    done: (c) => c.shards > 0,
    text: "A meteor shard! Grab it to unlock a new part.",
  },
  {
    id: "part-orb",
    priority: 82,
    when: (c) => c.playing && c.partOrbNear,
    text: "That cell dropped a part. Swim over it to unlock that part.",
  },
  {
    id: "colony",
    priority: 50,
    when: (c) => c.playing && c.colonyNear && c.diet !== "meat",
    text: "Plant colonies regrow their buds. Come back to graze them again.",
  },
  {
    id: "kin",
    priority: 58,
    when: (c) => c.playing && c.kinNear,
    text: "Cells with a teal rim are your own species. They won't hurt you, and your mate will be one of them.",
  },
  {
    id: "giant",
    priority: 88,
    when: (c) => c.playing && c.giantNear,
    text: "That one is from the next stage. Steer clear until you've grown.",
  },
  {
    id: "new-part",
    priority: 75,
    when: (c) => c.playing && c.unlockedSinceEditor > 0,
    done: (c) => c.editor,
    text: "New part unlocked! You can add it to your cell when you next mate and the editor opens.",
    anchor: "#touchMate",
  },
  {
    id: "mate-ready",
    priority: 97,
    when: (c) => c.playing && c.mateReady && !c.mateSignal,
    done: (c) => c.mateSignal,
    text: { touch: "Growth complete! Tap MATE to call one of your species.", desktop: "Growth complete! Press M (or ♡) to call one of your species." },
    anchor: "#touchMate",
  },
  {
    id: "mate-follow",
    priority: 96,
    when: (c) => c.playing && c.mateSignal,
    text: "Follow the heart arrow and touch your mate to start the next generation.",
  },
  {
    id: "history",
    priority: 70,
    when: (c) => c.playing && c.generations >= 2,
    done: (c) => c.pathOpened,
    text: "A new generation joined your species history. Tap ◈ to see your lineage and which trait card your diet is earning.",
    anchor: "#pathToggle",
  },
  {
    id: "bite",
    priority: 86,
    when: (c) => c.playing && c.canBite && c.preyNear,
    text: "Swim your jaw into smaller cells to bite them. A few bites finish them off, and they drop meat to eat.",
  },
  {
    id: "first-mouth",
    priority: 120,
    editor: true,
    when: (c) => c.editor && !c.hasMouth,
    done: (c) => c.hasMouth,
    text: {
      touch: "Every cell needs a mouth. Open the parts drawer with the hammer and drag the Filter (eats plants) or the Jaw (eats meat) onto the front of your cell.",
      desktop: "Every cell needs a mouth. Drag the Filter (eats plants) or the Jaw (eats meat) onto the front of your cell.",
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
      touch: "Drag a part up from the drawer onto your cell. Drag a spine end to stretch it.",
      desktop: "Drag parts from the list onto your cell. Drag a spine end to stretch it, and scroll on a vertebra to resize it.",
    },
  },
  {
    id: "editor-locked",
    priority: 90,
    editor: true,
    when: (c) => c.editor && c.time > 4,
    text: "Grey parts are still locked. Their card says where to find them: meteor shards, other cells, or growing a stage.",
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
