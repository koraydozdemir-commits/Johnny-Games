/**
 * The Creature Stage ecosystem: wildlife that lives its own life around the nests.
 *
 * Each region has groups of wild creatures (herds, packs, loners) drawn from the archetypes below:
 * small prey and grazers graze and flee as a herd; pack hunters get hungry and hunt them together;
 * ambushers lie in wait; scavengers find carcasses; giants and guardians defend their ground. Every
 * individual has a personality (aggression, timidity, curiosity, sociability) that shifts its
 * choices, and they react to you by your size, your diet and what you have done to them.
 *
 * Cost control: groups far away are abstract (a drifting point, no bodies); near ones are spawned
 * as real creatures, up to a cap; each creature re-decides at a rate set by its distance from you.
 */
import { makeRng } from "../cell-format.js";
import { atLevel, generateSpecies } from "./species.js";
import { NPC_ATTACK, npcDamage } from "./balance.js";
import { courageOf, retreatThreshold } from "./combat-ai.js";

const TAU = Math.PI * 2;

/** What each kind of wild creature is like. All tuning for the ecosystem lives here. */
export const ARCHETYPES = {
  smallPrey: { name: "small prey", diet: "plant", role: "prey", scale: 0.55, group: [3, 6], speed: 6.6, flee: 15, social: 0.9, aggression: 0.05, timid: 0.9, curious: 0.3, levelOffset: -1, xp: [5, 2] },
  grazer: { name: "grazers", diet: "plant", role: "grazer", scale: 1.05, group: [4, 7], speed: 5.2, flee: 11, social: 0.85, aggression: 0.2, timid: 0.6, curious: 0.2, levelOffset: 0, xp: [8, 3] },
  giant: { name: "giants", diet: "plant", role: "giant", scale: 2.1, group: [1, 2], speed: 3.8, flee: 0, defend: 7, social: 0.5, aggression: 0.45, timid: 0, curious: 0.1, levelOffset: 1, xp: [20, 5] },
  scavenger: { name: "scavengers", diet: "omni", role: "prey", scale: 0.75, group: [2, 4], speed: 5.8, flee: 9, social: 0.6, aggression: 0.15, timid: 0.5, curious: 0.85, levelOffset: -1, xp: [5, 2] },
  packHunter: { name: "pack hunters", diet: "meat", role: "predator", scale: 0.95, group: [3, 4], speed: 6.1, hunt: true, social: 0.9, aggression: 0.7, timid: 0.15, curious: 0.2, levelOffset: 0, xp: [12, 4] },
  ambusher: { name: "ambushers", diet: "meat", role: "ambusher", scale: 1.0, group: [1, 1], speed: 8.2, lurk: true, social: 0.05, aggression: 0.85, timid: 0.1, curious: 0.1, levelOffset: 0, xp: [14, 4] },
  guardian: { name: "guardians", diet: "omni", role: "guardian", scale: 1.35, group: [1, 2], speed: 5.4, territory: 12, social: 0.4, aggression: 0.6, timid: 0, curious: 0.1, levelOffset: 1, xp: [16, 5] },
};
/** Roles a hungry predator will hunt. */
const PREY_ROLES = new Set(["prey", "grazer"]);
/** How many groups of each listed archetype a region gets, most common first. */
const GROUP_COUNTS = [4, 3, 2, 2, 1];
/** Live wild creatures at once, by quality. */
const CAP = { low: 10, medium: 14, high: 22 };

/**
 * @param {object} c the stage's context: world, regionSeed, wildlife (archetype ids), quality,
 *   spawnNPC, despawnNPC, npcs, P, level(), noticeScale(), distTo, act, voice, pop, hurtPlayer,
 *   noticeHunter, dropCarcass, carcasses, isNight(), now()
 */
export function createEcosystem(c) {
  const rng = makeRng(c.regionSeed + 4243);
  const groups = [];
  // Place each group's home range out on open ground, away from nests and the arrival shore.
  const avoid = [...c.world.nestSites.map((n) => ({ x: n.x, z: n.z, r: 24 })), { x: 0, z: 178, r: 34 }];
  c.wildlife.forEach((arch, k) => {
    const count = GROUP_COUNTS[k] ?? 1;
    for (let g = 0; g < count; g++) {
      let home = null;
      for (let tries = 0; tries < 60 && !home; tries++) {
        const a = rng() * TAU,
          d = 25 + Math.sqrt(rng()) * 140;
        const x = Math.cos(a) * d,
          z = Math.sin(a) * d;
        if (!c.world.isOpen(x, z, 5)) continue;
        if (avoid.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) continue;
        if (groups.some((o) => Math.hypot(o.home.x - x, o.home.z - z) < 28)) continue;
        home = { x, z };
      }
      if (!home) continue;
      const A = ARCHETYPES[arch];
      const seed = c.regionSeed + 7001 + groups.length * 1291;
      // On a homeworld, the wildlife are that planet's library creatures; otherwise a generated species.
      const base = c.libraryFauna?.(arch, groups.length) || generateSpecies(seed, A.diet, 2);
      base.role = A.role;
      base.sizeJitter = (base.sizeJitter || 1) * A.scale;
      base.temper = A.hunt || A.lurk ? "hostile" : A.territory || A.defend ? "wary" : "skittish";
      base.wild = arch;
      const size = A.group[0] + Math.floor(rng() * (A.group[1] - A.group[0] + 1));
      groups.push({
        arch,
        A,
        base,
        species: atLevel(base, levelFor(A)),
        home,
        pos: { ...home }, // the group's centre: drifts round its range even when nobody is watching
        waypoint: { ...home },
        hunger: rng() * 0.5,
        target: null,
        alarm: null,
        members: Array.from({ length: size }, () => ({ alive: true, npc: null, back: 0 })),
      });
    }
  });
  function levelFor(A) {
    return Math.max(1, Math.min(5, c.level() + A.levelOffset));
  }

  /** A new brain level: every wild species moves to its new level (bodies rebuilt as they respawn). */
  function relevel() {
    for (const g of groups) g.species = atLevel(g.base, levelFor(g.A));
  }

  /* ---- streaming ---------------------------------------------------------- */
  function spawnMember(g, m, k) {
    const a = (k / g.members.length) * TAU + rng() * 0.6;
    const r = 3 + rng() * 4 * Math.sqrt(g.members.length);
    const at = c.world.resolve(g.pos.x + Math.cos(a) * r, g.pos.z + Math.sin(a) * r, 1);
    const jitter = () => (rng() - 0.5) * 0.3;
    m.npc = c.spawnNPC(g.species, at.x, at.z, {
      wild: g,
      wildMember: m,
      // Personality: the archetype's leanings, a little different in every individual.
      traits: { aggression: clamp01(g.A.aggression + jitter()), timid: clamp01(g.A.timid + jitter()), curious: clamp01(g.A.curious + jitter()), social: clamp01(g.A.social + jitter()) },
      wb: { mode: "wander", t: 0, think: rng() * 0.5, eat: 0, seen: false },
      brave: 0.25 + g.A.aggression * 0.6,
    });
  }
  function stream(px, pz, active) {
    const now = c.now();
    let live = 0;
    for (const g of groups) for (const m of g.members) if (m.npc) live++;
    const cap = CAP[c.quality] || CAP.medium;
    // Nearest groups first, so the cap keeps the ones you can see.
    const order = groups.map((g) => ({ g, d: Math.hypot(g.pos.x - px, g.pos.z - pz) })).sort((a, b) => a.d - b.d);
    for (const { g, d } of order) {
      g.members.forEach((m, k) => {
        if (!m.alive && m.back && now > m.back) {
          m.alive = true; // the ecosystem refills: new young replace the fallen
          m.back = 0;
        }
        if (d > active + 25 && m.npc && !m.npc.dead && !m.npc.hunting) {
          c.despawnNPC(m.npc);
          m.npc = null;
          live--;
        } else if (d < active && m.alive && !m.npc && live < cap) {
          spawnMember(g, m, k);
          live++;
        }
      });
    }
  }

  /* ---- the abstract simulation (every group, cheaply) ---------------------- */
  function simulate(dt) {
    for (const g of groups) {
      g.hunger = Math.min(1, g.hunger + dt / (g.A.hunt || g.A.lurk ? 110 : 160));
      if (g.alarm && (g.alarm.t -= dt) <= 0) g.alarm = null;
      const spawned = g.members.some((m) => m.npc && !m.npc.dead);
      if (spawned) {
        // The centre follows the herd.
        let x = 0,
          z = 0,
          n = 0;
        for (const m of g.members)
          if (m.npc && !m.npc.dead) {
            x += m.npc.pos.x;
            z += m.npc.pos.z;
            n++;
          }
        g.pos.x = x / n;
        g.pos.z = z / n;
      } else {
        // Off screen: drift towards a waypoint in the home range, and eat now and then.
        const dx = g.waypoint.x - g.pos.x,
          dz = g.waypoint.z - g.pos.z,
          dd = Math.hypot(dx, dz);
        if (dd < 3) {
          const a = rng() * TAU,
            r = rng() * 40;
          const w = { x: g.home.x + Math.cos(a) * r, z: g.home.z + Math.sin(a) * r };
          if (c.world.isOpen(w.x, w.z, 2)) g.waypoint = w;
        } else {
          g.pos.x += (dx / dd) * dt * 1.2;
          g.pos.z += (dz / dd) * dt * 1.2;
        }
        if (g.hunger > 0.8 && rng() < dt * 0.02) g.hunger = 0.1;
      }
    }
  }

  /* ---- one creature's decisions -------------------------------------------- */
  /** Threat to a prey animal: you (by your look and behaviour) and hunting predators nearby. */
  function threatTo(n, d) {
    const t = n.traits;
    const P = c.P;
    // You are frightening if you've been fighting, eat meat, or are much bigger. Timid ones scare easily.
    const scary = P.aggro > 0 || P.diet === "meat" || P.scale > n.scale * 1.35 || n.wildMember.hurtByYou;
    const range = (n.wild.A.flee * (0.6 + t.timid * 0.8) + (P.aggro > 0 ? 6 : 0)) * c.noticeScale();
    if (scary && d < range) return { x: P.pos.x, z: P.pos.z, who: "you" };
    for (const o of c.npcs) {
      if (o === n || o.dead || !o.wild || !(o.wb.mode === "hunt" || o.wb.mode === "pounce")) continue;
      if (Math.hypot(o.pos.x - n.pos.x, o.pos.z - n.pos.z) < 16 + t.timid * 8) return { x: o.pos.x, z: o.pos.z, who: o };
    }
    return null;
  }
  function nearestCarcass(n, within) {
    let best = null,
      bestD = within;
    for (const k of c.carcasses) {
      const dd = Math.hypot(k.x - n.pos.x, k.z - n.pos.z);
      if (dd < bestD && k.bites > 0) {
        best = k;
        bestD = dd;
      }
    }
    return best;
  }
  function findPrey(g) {
    let best = null,
      bestD = 50;
    for (const o of c.npcs) {
      if (o.dead || !o.wild || o.wild === g || !PREY_ROLES.has(o.wild.A.role) || o.abducted) continue;
      const dd = Math.hypot(o.pos.x - g.pos.x, o.pos.z - g.pos.z);
      if (dd < bestD) {
        best = o;
        bestD = dd;
      }
    }
    return best;
  }
  /** A wind-up and a lunge, like every attack in the game; hits only if the target is still in reach. */
  function attack(n, target, dt, reachD) {
    const isYou = target === c.P;
    const tx = target.pos.x,
      tz = target.pos.z,
      d = Math.hypot(tx - n.pos.x, tz - n.pos.z);
    if (n.windUp > 0) {
      n.windUp -= dt;
      n.heading = Math.atan2(-(tz - n.pos.z), tx - n.pos.x);
      if (n.windUp <= 0) {
        n.body.setCrouch(0);
        c.act(n, "bite");
        c.voice(n, "bite");
        n.cool = NPC_ATTACK.recovery;
        const dmg = npcDamage(n.species.level || 1, n.species.abilities.bite || 1, n.species.role);
        if (d < reachD + NPC_ATTACK.dodge) {
          if (isYou) {
            if (c.P.deadTimer <= 0) c.hurtPlayer(dmg, "A wild " + n.species.name + " got you");
          } else hurtWild(target, dmg, n);
        } else if (isYou) c.pop(n, "💨");
      }
      // Against you it roots (your chance to dodge); against fleeing prey it lunges after it.
      return isYou ? { want: null, pace: 0 } : { want: { x: tx, z: tz }, pace: n.wild.A.speed * 1.15 };
    }
    if (d < reachD + 0.5 && n.cool <= 0) {
      n.windUp = NPC_ATTACK.windUp * (n.wild.A.lurk ? 0.7 : 1);
      n.body.setCrouch(1);
      return isYou ? { want: null, pace: 0 } : { want: { x: tx, z: tz }, pace: n.wild.A.speed * 1.15 };
    }
    return { want: { x: tx, z: tz }, pace: n.wild.A.speed * (n.wb.mode === "pounce" ? 1.25 : 1) };
  }
  const reachOf = (n, target) => 1.6 * n.scale + (target === c.P ? 0.9 * c.P.scale : 0.7 * target.scale);

  /** Wild-on-wild damage: no anger at you, but the victim runs and its herd panics. */
  function hurtWild(v, dmg, by) {
    if (v.dead) return;
    v.health -= dmg;
    v.hurtAt = c.now();
    v.body.hit();
    if (v.health <= 0) return die(v, false);
    if (v.wild) {
      const A = v.wild.A;
      // Fighters (hunters, ambushers, guardians, giants) hit back unless genuinely low on health; only
      // prey and the badly hurt run (combat-ai.js).
      const fighter = A.hunt || A.lurk || A.territory || A.defend;
      if (fighter && v.health / v.maxHealth >= retreatThreshold(courageOf({ role: A.role }))) {
        v.wb.mode = "hunt";
        v.wb.target = by;
        v.wb.t = 6;
        v.wild.alarm = { x: by.pos.x, z: by.pos.z, t: 4 };
        return;
      }
      v.wb.mode = "flee";
      v.wb.from = by;
      v.wb.t = 3 + Math.random() * 2;
      v.wild.alarm = { x: by.pos.x, z: by.pos.z, t: 4 };
    }
  }
  /** A wild creature dies: it leaves a carcass, and in a few minutes the herd has a new member. */
  function die(n, byYou) {
    n.dead = true;
    n.hunting = false;
    n.body.die();
    c.dropCarcass(n.pos.x, n.pos.z, Math.max(2, Math.round(n.scale * 3)));
    const m = n.wildMember;
    m.alive = false;
    m.npc = null;
    m.back = c.now() + 180 + Math.random() * 90;
    if (!byYou) setTimeout(() => c.despawnNPC(n), 2500);
    return n;
  }

  /**
   * Decide what a wild creature does this frame. Decisions are re-made every so often (more often up
   * close); in between, it keeps doing what it decided.
   * @returns {{ want: {x,z}|null, pace: number }}
   */
  function think(n, dt, d) {
    const g = n.wild,
      A = g.A,
      w = n.wb,
      t = n.traits,
      P = c.P;
    w.think -= dt;
    w.t -= dt;
    const fresh = w.think <= 0;
    if (fresh) w.think = d < 40 ? 0.3 : d < 80 ? 0.8 : 1.6;
    const night = c.isNight();

    // The stage marks wildMember.hurtByYou when you hurt one: it remembers for half a minute.
    const angryAtYou = n.wildMember.hurtByYou && c.now() - n.wildMember.hurtByYou < 30;

    if (fresh) {
      if (A.hunt || A.lurk || A.territory || A.defend) decideFighter(n, g, A, w, t, d, angryAtYou);
      else decidePrey(n, g, A, w, t, d, night);
    }

    // Act on the decision.
    switch (w.mode) {
      case "flee": {
        const from = w.from === "you" ? P.pos : w.from?.pos || g.alarm || P.pos;
        n.hunting = false;
        return { want: { x: n.pos.x + (n.pos.x - from.x), z: n.pos.z + (n.pos.z - from.z) }, pace: A.speed };
      }
      case "hunt":
      case "pounce": {
        const target = w.target === "you" ? P : w.target;
        if (!target || target.dead || (target !== P && !c.npcs.has(target))) {
          w.mode = "wander";
          return { want: null, pace: 0 };
        }
        n.hunting = target === P;
        return attack(n, target, dt, reachOf(n, target));
      }
      case "eat": {
        const k = w.food;
        if (!k || k.bites <= 0 || !c.carcasses.includes(k)) {
          w.mode = "wander";
          return { want: null, pace: 0 };
        }
        const kd = Math.hypot(k.x - n.pos.x, k.z - n.pos.z);
        if (kd > 1.6 + n.scale) return { want: k, pace: A.speed * 0.7 };
        // Tearing at it: a bite every couple of seconds, until full.
        n.heading = Math.atan2(-(k.z - n.pos.z), k.x - n.pos.x);
        if ((w.eat -= dt) <= 0) {
          w.eat = 1.8;
          c.act(n, "bite");
          k.bites -= 0.5;
          g.hunger = Math.max(0, g.hunger - 0.25);
          if (g.hunger <= 0.05) w.mode = "wander";
        }
        return { want: null, pace: 0 };
      }
      case "graze":
        n.body.setCrouch(1); // head down in the grass
        if (w.t <= 0) {
          n.body.setCrouch(0);
          g.hunger = Math.max(0, g.hunger - 0.3);
          w.mode = "wander";
        }
        return { want: null, pace: 0 };
      case "curious": {
        // Comes close for a look, then keeps a polite distance and watches you.
        if (d > 5.5) return { want: P.pos, pace: A.speed * 0.45 };
        n.heading = Math.atan2(-(P.pos.z - n.pos.z), P.pos.x - n.pos.x);
        return { want: null, pace: 0 };
      }
      case "warn":
        // A threat display: crouched, facing you, puffed up.
        n.heading = Math.atan2(-(P.pos.z - n.pos.z), P.pos.x - n.pos.x);
        n.body.setCrouch(1);
        if (w.t <= 0) {
          n.body.setCrouch(0);
          w.mode = d < (A.defend || A.territory) ? "hunt" : "wander";
          w.target = "you";
        }
        return { want: null, pace: 0 };
      case "lurk":
        n.body.setCrouch(1);
        if (Math.hypot(n.pos.x - g.home.x, n.pos.z - g.home.z) > 3) return { want: g.home, pace: A.speed * 0.4 };
        return { want: null, pace: 0 };
      case "rest":
        n.asleep = true;
        return { want: null, pace: 0 };
      default: {
        // Wander the home range, keeping close to the rest of the group.
        const toGroup = Math.hypot(g.pos.x - n.pos.x, g.pos.z - n.pos.z);
        if (toGroup > 7 + (1 - t.social) * 10) return { want: g.pos, pace: A.speed * 0.5 };
        if (!w.goal || Math.hypot(w.goal.x - n.pos.x, w.goal.z - n.pos.z) < 2 || w.t <= 0) {
          const a = Math.random() * TAU,
            r = 4 + Math.random() * 10;
          w.goal = { x: g.pos.x + Math.cos(a) * r, z: g.pos.z + Math.sin(a) * r };
          w.t = 6 + Math.random() * 6;
          // Herds drift towards the home range when they stray.
          if (Math.hypot(g.pos.x - g.home.x, g.pos.z - g.home.z) > 45) w.goal = { x: g.home.x, z: g.home.z };
        }
        return { want: w.goal, pace: A.speed * 0.35 };
      }
    }
  }

  function decidePrey(n, g, A, w, t, d, night) {
    const threat = threatTo(n, d) || (g.alarm ? { x: g.alarm.x, z: g.alarm.z, who: "alarm" } : null);
    if (threat) {
      if (w.mode !== "flee") {
        c.pop(n, "😨", "bad");
        g.alarm = { x: threat.x, z: threat.z, t: 4 }; // the herd runs together
      }
      w.mode = "flee";
      w.from = threat.who === "you" ? "you" : threat.who === "alarm" ? null : threat.who;
      w.t = 3;
      n.body.setCrouch(0);
      return;
    }
    if (w.mode === "flee" && w.t > 0) return;
    if (night && t.timid > 0.3) {
      // Herds bed down for the night together.
      w.mode = "rest";
      return;
    }
    // Scavengers go for carcasses; curious ones come to look at a peaceful visitor.
    if (A.diet === "omni") {
      const k = nearestCarcass(n, 45);
      if (k) {
        w.mode = "eat";
        w.food = k;
        return;
      }
    }
    const P = c.P;
    if (w.mode === "graze" && w.t > 0) return; // finish the mouthful
    if (t.curious > 0.6 && d < 16 && P.aggro <= 0 && P.diet !== "meat" && w.mode !== "curious" && Math.random() < t.curious * 0.4) {
      w.mode = "curious";
      w.t = 6;
      if (!w.seen) {
        w.seen = true;
        c.pop(n, "❓");
      }
      return;
    }
    if (w.mode === "curious" && w.t > 0 && d < 20) return;
    if (g.hunger > 0.4 && Math.random() < 0.25) {
      w.mode = "graze";
      w.t = 3 + Math.random() * 3;
      return;
    }
    if (w.mode !== "wander") w.mode = "wander";
  }

  function decideFighter(n, g, A, w, t, d, angryAtYou) {
    const P = c.P;
    const notice = c.noticeScale();
    // Stay on a hunt already under way.
    if ((w.mode === "hunt" || w.mode === "pounce") && w.target) {
      const tgt = w.target === "you" ? P : w.target;
      const td = tgt && !tgt.dead ? Math.hypot(tgt.pos.x - n.pos.x, tgt.pos.z - n.pos.z) : Infinity;
      const leash = A.territory ? Math.hypot(n.pos.x - g.home.x, n.pos.z - g.home.z) > 24 : false;
      const giveUp = td > (w.mode === "pounce" ? 16 : 60) || leash || (w.target === "you" && P.deadTimer > 0);
      if (!giveUp) return;
      w.mode = A.lurk ? "lurk" : "wander";
      w.target = null;
      n.hunting = false;
      if (g.target && (g.target.dead || giveUp)) g.target = null;
    }
    if (w.mode === "eat" && w.food?.bites > 0 && g.hunger > 0.05) return;
    if (w.mode === "warn" && w.t > 0) return;
    // Badly hurt: even predators back off.
    if (n.health < n.maxHealth * 0.3 && t.timid + (1 - t.aggression) > 0.6) {
      w.mode = "flee";
      w.from = "you";
      w.t = 4;
      return;
    }
    // You: hunted if they're hungry and you're within reach, or if you've hurt them.
    const aggro = (6 + (n.species.level || 1)) * (0.7 + t.aggression * 0.6) * notice;
    if (angryAtYou && d < 30) return startHunt(n, w, "you", d);
    if (A.lurk) {
      if (d < aggro * 0.9) return startHunt(n, w, "you", d, true);
      const prey = findPrey(g);
      if (prey && Math.hypot(prey.pos.x - n.pos.x, prey.pos.z - n.pos.z) < 9) return startHunt(n, w, prey, d, true);
      w.mode = "lurk";
      return;
    }
    if (A.territory || A.defend) {
      // Guardians defend their ground; giants anyone who crowds them. A display first, then the charge.
      const radius = A.territory || A.defend;
      const inside = A.territory ? Math.hypot(P.pos.x - g.home.x, P.pos.z - g.home.z) < radius * notice : d < radius * notice;
      if (inside && w.mode !== "hunt") {
        w.mode = "warn";
        w.t = 1.4 + (1 - t.aggression);
        c.pop(n, "😠", "bad");
        c.voice(n, "pose");
        return;
      }
      if (w.mode !== "hunt") w.mode = "wander";
      return;
    }
    if (A.hunt) {
      // A kill nearby comes first: eat before hunting again.
      const k = nearestCarcass(n, 30);
      if (k && g.hunger > 0.3) {
        w.mode = "eat";
        w.food = k;
        return;
      }
      if (g.hunger > 0.5 && d < aggro) return startHunt(n, w, "you", d);
      // The pack hunts together: one target for all of them.
      if (g.hunger > 0.55) {
        if (!g.target || g.target.dead || !c.npcs.has(g.target)) g.target = findPrey(g);
        if (g.target) return startHunt(n, w, g.target, d);
      }
    }
    if (w.mode !== "wander") w.mode = "wander";
  }
  function startHunt(n, w, target, d, pounce = false) {
    const wasHunting = w.mode === "hunt" || w.mode === "pounce";
    w.mode = pounce ? "pounce" : "hunt";
    w.target = target;
    n.body.setCrouch(0);
    if (target === "you" && !wasHunting) {
      c.noticeHunter(n, d);
      c.pop(n, pounce ? "⚡" : "❗", "bad");
    }
  }

  return { groups, stream, simulate, think, relevel, die, hurtWild };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
