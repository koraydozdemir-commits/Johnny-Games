/**
 * Village life for your own tribe (Tribes and Tribulations). Every member without an order chooses
 * what to do from what the tribe needs (life.js weighs it): gathering trips, group hunts and forage
 * expeditions, work, training, patrols and watches, and the rest of the day: chatting in small
 * groups, the campfire, resting, play, and sleep at night in the village's own shelters. Danger
 * overrides all of it. Orders you give always come first; jobs and food priorities only lean it.
 *
 * Decisions run on staggered timers (not every frame); per-frame work is walking and animation.
 */
import { ACTIVITIES, EXPEDITION, activityWeights, dayPhase, expeditionCheck, foodMood, huntPartySize, pickActivity, tribePersonality } from "./life.js";

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * @param {object} c  the stage's helpers (see stage.js, "village life")
 */
export function createVillagers(c) {
  const { T, HOME, FIRE, world, village } = c;
  const L = {
    phase: "day",
    mood: "ok",
    threat: null, // { x, z, n } hostile raiders near the village
    threatT: 0,
    busy: {},
    available: {},
    lean: { scores: {}, leaning: null },
    clock: 0,
    slow: 0,
    chiefAway: 0,
    homeHoldShown: false,
  };
  T.parties = T.parties || [];

  /* ---- shared state, refreshed a couple of times a second --------------------------------- */
  function refresh() {
    const own = c.mine();
    const adults = own.filter((u) => !u.child);
    L.phase = dayPhase(world.timeOfDay);
    L.mood = foodMood(T.food, adults.length);
    L.full = T.food / Math.max(1, adults.length) >= 12 && T.food >= 60;
    // A good evening with full stores becomes a feast round the fire.
    if (L.phase === "evening" && L.mood === "plenty" && !L.feast && L.feastDay !== Math.floor(T.time / 300)) {
      L.feast = true;
      L.feastDay = Math.floor(T.time / 300);
      c.culture.feasts++;
    }
    if (L.phase !== "evening" && L.phase !== "night") L.feast = false;
    // Who is doing what (for spreading the tribe across food sources).
    const busy = {};
    for (const u of own) {
      const k = activityOf(u);
      if (k) busy[k] = (busy[k] || 0) + 1;
    }
    L.busy = busy;
    // What can be reached right now.
    const fruitNear = world.fruits.some((f) => f.alive && !f.claimed && !f.hanging && Math.hypot(f.x - HOME.x, f.z - HOME.z) < 55) || !!world.fruitTreeNear(HOME.x, HOME.z, 45);
    L.available = {
      fruit: fruitNear,
      fish: c.fishSpots.length > 0,
      forage: village.nodes.some((n) => n.stock > 0 && n.claim < 2),
      hunt: T.animals.some((a) => !a.dead && Math.hypot(a.pos.x - HOME.x, a.pos.z - HOME.z) < 95),
      haul: T.carcasses.some((k) => k.food > 0 && Math.hypot(k.x - HOME.x, k.z - HOME.z) < 95 && haulers(k) < 3),
    };
    // Danger: raiders or a war party close to the village (further with a lookout).
    const reach = 42 + (c.lookouts() > 0 ? 18 : 0);
    let tx = 0,
      tz = 0,
      n = 0;
    for (const v of T.units) {
      if (v.mine || v.dead || !(v.raid || v.warParty) || v.fleeing) continue;
      if (Math.hypot(v.pos.x - HOME.x, v.pos.z - HOME.z) > reach) continue;
      tx += v.pos.x;
      tz += v.pos.z;
      n++;
    }
    const was = !!L.threat;
    L.threat = n ? { x: tx / n, z: tz / n, n } : null;
    if (L.threat && !was) alarm();
    if (!!L.threat !== was) c.onDanger?.(!!L.threat);
    // While there's danger, everyone working nearby drops it and comes to defend the village
    // (hunters and gatherers too: a job never stops anyone defending home).
    if (L.threat)
      for (const u of own)
        if (!u.child && u.task?.auto && ["gather", "fish", "forage", "hunt", "haul", "repair"].includes(u.task.type) && Math.hypot(u.pos.x - HOME.x, u.pos.z - HOME.z) < 65) {
          if (u.task.fruit) u.task.fruit.claimed = false;
          u.task = null;
          u.body.setCrouch(0);
        }
    // Something unusual near the village (a stranger, big game wandering close): a defender (or,
    // failing that, someone idle) goes to have a look.
    if (!L.threat && L.phase !== "night") {
      const odd =
        T.units.find((v) => !v.mine && !v.dead && !v.raid && !v.warParty && !v.helping && !(v.seenAt > T.time - 60) && Math.hypot(v.pos.x - HOME.x, v.pos.z - HOME.z) < 30) ||
        T.animals.find((a) => !a.dead && a.herd.fierce && !(a.seenAt > T.time - 60) && Math.hypot(a.pos.x - HOME.x, a.pos.z - HOME.z) < 40);
      if (odd) {
        const free = (u) => !u.child && !u.task && (!u.act || ["patrol", "watch", "rest", "social"].includes(u.act.kind)) && !(u.holdUntil > T.time);
        const who = own.filter((u) => free(u) && u.role === "guard")[0] || own.filter((u) => free(u) && !u.act)[0];
        if (who) {
          stop(who);
          odd.seenAt = T.time;
          who.act = { kind: "investigate", t: 0, dur: 12, what: odd };
        }
      }
    }
    // Release spots claimed by anyone no longer using them.
    for (const s of allSpots()) if (s.by && (s.by.dead || s.by.removed || s.by.act?.spot !== s)) s.by = null;
    for (const nd of village.nodes) nd.claim = own.filter((u) => u.task?.node === nd).length;
  }
  const haulers = (k) => c.mine().filter((u) => u.task?.carcass === k).length;
  function activityOf(u) {
    if (u.act) return u.act.kind;
    const t = u.task?.type;
    if (!t) return null;
    if (t === "gather") return "fruit";
    if (t === "fish" || t === "hunt" || t === "haul" || t === "forage") return t;
    if (t === "repair") return "work";
    if (t === "fight" || t === "attack") return "fight";
    return t;
  }
  let hutSpots = null;
  function allSpots() {
    // The chief's hut sleeps three at its door; player dwellings three each; shelters their own.
    if (!hutSpots) hutSpots = [-1, 0, 1].map((s) => ({ x: HOME.x + 3.8, z: HOME.z + s * 1.2, by: null }));
    return [...hutSpots, ...c.houseSpots(), ...village.sleepSpots(), ...seatSpots(), ...village.pieces.flatMap((p) => [...(p.id === "ring" || p.id === "craft" ? p.spots : []), ...(p.dummies || []), ...(p.spar || [])])];
  }
  const seatSpots = () => village.pieces.filter((p) => p.id === "seat").map((p) => p.spots[0]);
  const sleepSpots = () => [...hutSpots, ...c.houseSpots(), ...village.sleepSpots()];
  function claim(list, u, near = u.pos) {
    let best = null,
      bd = 1e9;
    for (const s of list) {
      if (s.by && s.by !== u) continue;
      const d = Math.hypot(s.x - near.x, s.z - near.z);
      if (d < bd) (bd = d), (best = s);
    }
    if (best) best.by = u;
    return best;
  }

  /* ---- reactions ------------------------------------------------------------------------- */
  function alarm() {
    // Everyone looks up; sleepers wake; idle chatter stops. Defenders move out to meet it.
    const own = c.mine();
    own.forEach((u, i) => {
      if (u.act && !["hide"].includes(u.act.kind)) stop(u);
      if (i < 3 && !u.child) c.emote(u, "alarm");
    });
    c.sfx("roar", { pitch: 1.4, gain: 0.35 });
  }
  /** A moment the village reacts to: hunters home with meat, a birth, the chief back, a victory. */
  function event(kind, at, who = null) {
    const own = c.mine().filter((u) => !u.task && u !== who && (!u.act || ["social", "rest", "campfire", "play", "work", "watch"].includes(u.act.kind)) && Math.hypot(u.pos.x - at.x, u.pos.z - at.z) < (kind === "victory" ? 40 : kind === "birth" ? 26 : 18));
    const n = kind === "victory" ? own.length : kind === "chief" ? 3 : 4;
    own
      .sort((a, b) => Math.hypot(a.pos.x - at.x, a.pos.z - at.z) - Math.hypot(b.pos.x - at.x, b.pos.z - at.z))
      .slice(0, n)
      .forEach((u, i) => {
        stop(u);
        u.act = { kind: "greet", t: 0, dur: rnd(4, 6), who, at: { x: at.x, z: at.z }, move: kind === "chief" ? "wave" : kind === "birth" ? "charm" : "dance", slot: i };
      });
  }

  /* ---- the member's own life ------------------------------------------------------------- */
  function stop(u) {
    const a = u.act;
    u.act = null;
    if (a?.spot && a.spot.by === u) a.spot.by = null;
    u.body.setSleep(false);
    u.body.setCrouch(0);
    u.body.lookAt(null);
    if (u.carryKind === "supplies") (u.carry = 0), (u.carryKind = null);
  }
  /** The member has no order: danger first, then whatever it's doing, then something new. */
  function member(u, dt) {
    // Tiredness: work wears them out, rest and sleep bring them back.
    const k = u.act?.kind;
    u.tired = Math.max(0, Math.min(1, (u.tired ?? Math.random() * 0.3) + dt * (k === "sleep" ? -0.014 : k === "rest" || k === "campfire" ? -0.006 : 0.0016)));
    // Danger close by: grown-ups fight it, children run for the huts.
    if (!u.child) {
      const foe = c.nearestFoe(u, u.role === "guard" ? 18 + (c.lookouts() ? 6 : 0) : L.threat ? 14 : 9);
      if (foe) {
        stop(u);
        u.task = { type: "fight", target: foe, guard: true, auto: true };
        return;
      }
    }
    if (L.threat && (u.child || (u.health < u.maxHealth * 0.4 && u.role !== "guard"))) {
      if (u.act?.kind !== "hide") {
        stop(u);
        u.act = { kind: "hide", t: 0, dur: 999, spot: claim(sleepSpots(), u) };
      }
    } else if (L.threat && u.act?.kind !== "guard" && !(u.holdUntil > T.time)) {
      // Danger wakes the village: defenders (and anyone armed) go out to meet it, everyone else
      // gathers close in, ready.
      stop(u);
      u.act = { kind: "guard", t: 0, dur: 40, front: u.role === "guard" || u.role === "hunt" || c.isWeapon(u.tool) };
    }
    // An order to stand somewhere is respected for a while.
    if (u.holdUntil > T.time) {
      u.speed += (0 - u.speed) * Math.min(1, dt * 8);
      if ((u.think -= dt) <= 0) {
        u.think = rnd(2, 5);
        u.body.lookAt(Math.random() < 0.5 ? null : c.v3(u.pos.x + rnd(-8, 8), u.pos.y + 1, u.pos.z + rnd(-8, 8)));
      }
      return;
    }
    if (u.act) return runAct(u, dt);
    // Too far from home with nothing to do: walk back.
    if (Math.hypot(u.pos.x - HOME.x, u.pos.z - HOME.z) > 50) {
      u.act = { kind: "home", t: 0, dur: 60 };
      return;
    }
    if ((u.decide = (u.decide ?? Math.random()) - dt) > 0) {
      u.speed += (0 - u.speed) * Math.min(1, dt * 8);
      return;
    }
    u.decide = rnd(0.4, 1.4);
    choose(u);
  }

  function choose(u) {
    const own = c.mine();
    const avail = { ...L.available };
    for (const [kind, until] of Object.entries(u.fail || {})) if (until > T.time) avail[kind] = false;
    const w = activityWeights({
      job: u.role || "free",
      diet: c.diet,
      phase: L.phase,
      mood: L.mood,
      priority: T.priority,
      available: avail,
      busy: L.busy,
      tired: u.tired,
      child: !!u.child,
      chief: u.chief,
      armed: !!(u.tool && c.isWeapon(u.tool)),
      repairs: c.repairsNeeded(),
      homeHold: T.homeHold > 0,
      has: { training: village.pieces.some((p) => p.id === "training"), rack: village.pieces.some((p) => p.id === "rack"), craft: village.pieces.some((p) => p.id === "craft"), lookout: c.lookouts() > 0 },
      lean: L.lean.scores,
      social: c.sociable,
      full: L.full,
      feast: L.feast,
    });
    const kind = pickActivity(w);
    if (!kind) return;
    L.busy[kind] = (L.busy[kind] || 0) + 1;
    if (!start(u, kind, own)) {
      // Not possible after all (taken, out of reach): don't ask again for a while.
      u.fail = u.fail || {};
      if (ACTIVITIES[kind]?.away) u.fail[kind] = T.time + 15;
      u.decide = 0.3;
    }
  }

  /** Begin an activity: food runs become tasks the stage already knows how to do; the rest are acts. */
  function start(u, kind, own) {
    const dHome = (p) => Math.hypot(p.x - HOME.x, p.z - HOME.z);
    if (kind === "fish") {
      const spot = [...c.fishSpots].sort((a, b) => fishers(a) - fishers(b) || Math.hypot(a.stand.x - u.pos.x, a.stand.z - u.pos.z) - Math.hypot(b.stand.x - u.pos.x, b.stand.z - u.pos.z))[0];
      if (!spot || fishers(spot) >= 3) return false;
      u.task = { type: "fish", spot, auto: true };
      return true;
    }
    if (kind === "fruit") {
      const f = c.nearestFruit(HOME, 55);
      const tree = f ? null : world.fruitTreeNear(HOME.x, HOME.z, 45);
      if (!f && !tree) return false;
      const o = f || tree;
      u.task = { type: "gather", origin: { x: o.x, z: o.z }, fruit: null, auto: true, tree: tree || null };
      return true;
    }
    if (kind === "forage") {
      const nodes = village.nodes.filter((n) => n.stock > 0 && n.claim < 2).sort((a, b) => dHome(a) + (a.far ? 25 : 0) - (dHome(b) + (b.far ? 25 : 0)));
      // A rich grove is worth the trip only as a group, and only by day.
      const near = nodes.filter((n) => !n.far);
      const node = near.length && Math.random() < 0.8 ? near[0] : nodes[0];
      if (!node) return false;
      node.claim++;
      if (node.far) {
        if (L.phase !== "day") return false;
        return party(u, "forage", node, own);
      }
      u.task = { type: "forage", node, auto: true };
      return true;
    }
    if (kind === "haul") {
      const k = T.carcasses.filter((x) => x.food > 0 && dHome(x) < 95 && haulers(x) < 3).sort((a, b) => dHome(a) - dHome(b))[0];
      if (!k) return false;
      u.task = { type: "haul", carcass: k, auto: true };
      return true;
    }
    if (kind === "hunt") {
      if (L.phase === "night") return false;
      // Join a party that's still setting out, or lead a new one.
      const forming = T.parties.find((p) => p.kind === "hunt" && p.t < 12 && p.members.length < p.size && !p.target.dead);
      if (forming) return joinParty(u, forming);
      const prey = T.animals
        .filter((a) => !a.dead && dHome(a.pos) < 95 && !T.parties.some((p) => p.target === a))
        .sort((a, b) => dHome(a.pos) + (a.herd.fierce ? 18 : 0) - (dHome(b.pos) + (b.herd.fierce ? 18 : 0)))[0];
      if (!prey) return false;
      return party(u, "hunt", prey, own);
    }
    const act = { kind, t: 0 };
    if (kind === "sleep") {
      act.spot = claim(sleepSpots(), u);
      if (!act.spot) act.goal = c.around(HOME, 4, 7);
      act.dur = 999;
    } else if (kind === "campfire") {
      act.spot = claim(seatSpots(), u, FIRE);
      if (!act.spot) {
        const a = Math.random() * TAU;
        const R = (seatSpots()[0] ? Math.hypot(seatSpots()[0].x - FIRE.x, seatSpots()[0].z - FIRE.z) : 3) + 1.8;
        act.goal = { x: FIRE.x + Math.cos(a) * R, z: FIRE.z + Math.sin(a) * R };
      }
      act.dur = L.phase === "night" ? rnd(25, 50) : rnd(18, 34);
    } else if (kind === "rest") {
      act.spot = claim(sleepSpots(), u);
      if (!act.spot) act.goal = c.around(HOME, 4, 8);
      act.dur = rnd(10, 22);
    } else if (kind === "social") {
      // Join a little group already talking, or start one with whoever is idle nearby.
      const group = own.find((v) => v !== u && v.act?.kind === "social" && v.act.group.length < 4 && Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) < 20);
      if (group) {
        act.group = group.act.group;
        act.group.push(u);
        act.at = group.act.at;
      } else {
        const mates = own.filter((v) => v !== u && !v.task && !v.act && !v.child === !u.child && Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) < 16 && !(v.holdUntil > T.time)).slice(0, 1 + Math.floor(Math.random() * 2));
        act.group = [u];
        act.at = village.findSpot((u.pos.x + HOME.x) / 2, (u.pos.z + HOME.z) / 2, 0, 9, 1.6, Math.random() * TAU, Math.PI) || c.around(HOME, 6, 10);
        for (const v of mates) {
          v.act = { kind: "social", t: 0, dur: rnd(14, 24), group: act.group, at: act.at };
          act.group.push(v);
        }
      }
      act.dur = rnd(14, 24);
    } else if (kind === "play") {
      const mate = own.find((v) => v !== u && !v.task && (!v.act || v.act.kind === "rest") && (!!v.child === !!u.child || Math.random() < 0.4) && Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) < 16 && !(v.holdUntil > T.time));
      if (!mate) return false;
      if (mate.act) stop(mate);
      const style = Math.random() < 0.55 ? "chase" : "tussle";
      act.dur = rnd(9, 15);
      act.mate = mate;
      act.style = style;
      act.it = true;
      mate.act = { kind: "play", t: 0, dur: act.dur, mate: u, style, it: false };
    } else if (kind === "work") {
      // Repairs first; otherwise craft, carry supplies, tend the fire or tidy up.
      const fix = c.firstRepair();
      if (fix) {
        u.task = { type: "repair", what: fix, auto: true };
        return true;
      }
      const craft = village.pieces.find((p) => p.id === "craft");
      const r = Math.random();
      act.sub = craft && r < 0.4 ? "craft" : r < 0.65 ? "supplies" : r < 0.82 ? "fire" : "tidy";
      if (act.sub === "craft") {
        act.spot = claim(craft.spots, u);
        if (!act.spot) act.sub = "supplies";
      }
      act.dur = rnd(14, 24);
    } else if (kind === "train") {
      const ground = village.pieces.find((p) => p.id === "training");
      const partner = ground && own.find((v) => v !== u && v.act?.kind === "train" && v.act.sub === "spar" && !v.act.mate);
      if (partner) {
        act.sub = "spar";
        act.mate = partner;
        partner.act.mate = u;
        act.spot = ground.spar.find((s) => !s.by) || null;
        if (act.spot) act.spot.by = u;
      } else if (ground && Math.random() < 0.6) {
        act.sub = "dummy";
        act.spot = claim(ground.dummies, u);
        if (!act.spot) (act.sub = "spar"), (act.spot = ground.spar.find((s) => !s.by) || null), act.spot && (act.spot.by = u);
      } else act.sub = "drill";
      if (act.sub === "drill") act.goal = village.findSpot(HOME.x, HOME.z, 7, 15, 1.2, Math.random() * TAU, Math.PI) || c.around(HOME, 8, 12);
      act.dur = rnd(14, 22);
    } else if (kind === "patrol") {
      const R = 18 * village.style.spacing;
      const start0 = Math.atan2(u.pos.z - HOME.z, u.pos.x - HOME.x);
      const dir = Math.random() < 0.5 ? 1 : -1;
      act.points = [1, 2, 3, 4].map((i) => {
        const a = start0 + dir * i * 0.7;
        let x = HOME.x + Math.cos(a) * R,
          z = HOME.z + Math.sin(a) * R;
        if (c.heightAt(x, z) < -0.3) (x = HOME.x + Math.cos(a) * R * 0.6), (z = HOME.z + Math.sin(a) * R * 0.6);
        return { x, z };
      });
      act.i = 0;
      act.dur = 60;
    } else if (kind === "watch") {
      const look = c.lookoutAt(u);
      const a = look ? Math.atan2(look.z - HOME.z, look.x - HOME.x) : Math.atan2(-HOME.z, -HOME.x) + rnd(-1.2, 1.2);
      act.goal = look ? { x: look.x + 1.6, z: look.z } : { x: HOME.x + Math.cos(a) * 14 * village.style.spacing, z: HOME.z + Math.sin(a) * 14 * village.style.spacing };
      act.out = a;
      act.dur = rnd(15, 26);
    } else return false;
    u.act = act;
    return true;
  }
  const fishers = (spot) => c.mine().filter((u) => u.task?.type === "fish" && u.task.spot === spot).length;

  /** Set out together: the first member leads, others who are free come along. */
  function party(u, kind, target, own) {
    const fierce = kind === "hunt" && !!target.herd?.fierce;
    const ready = own.filter((v) => !v.child && !v.task && (!v.act || ["social", "rest", "play", "campfire", "watch"].includes(v.act.kind)) && !(v.holdUntil > T.time) && v.role !== "guard" && Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) < 26 && v !== u);
    // Hunters first, then the unassigned; the job a member has decides who goes.
    const want = kind === "hunt" ? "hunt" : "gather";
    ready.sort((a, b) => (b.role === want) - (a.role === want) || (b.role === "free") - (a.role === "free"));
    const size = kind === "hunt" ? huntPartySize(fierce, ready.length + 1) : Math.min(3, ready.length + 1);
    if (fierce && size < 3) return false; // too dangerous to try short-handed
    const p = { kind, target, members: [], leader: u, size, t: 0, id: Math.random() };
    T.parties.push(p);
    joinParty(u, p);
    ready.slice(0, size - 1).forEach((v) => {
      stop(v);
      joinParty(v, p);
    });
    if (fierce) c.pop(u.pos.x, u.pos.z, "🏹", "good");
    return true;
  }
  function joinParty(u, p) {
    p.members.push(u);
    u.task = p.kind === "hunt" ? { type: "hunt", target: p.target, auto: true, party: p } : { type: "forage", node: p.target, auto: true, party: p };
    return true;
  }
  /**
   * A party member on the way out keeps with the group: followers fall in behind the leader until
   * the prey (or grove) is close. Returns true while it is still following.
   */
  function follow(u, dt, target) {
    const p = u.task?.party;
    if (!p || p.leader === u || p.leader.dead) return false;
    const l = p.leader;
    if (Math.hypot(u.pos.x - target.x, u.pos.z - target.z) < 18 || Math.hypot(l.pos.x - target.x, l.pos.z - target.z) < 16) return false;
    const i = p.members.indexOf(u);
    const back = Math.atan2(HOME.z - l.pos.z, HOME.x - l.pos.x);
    const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.55;
    c.walk(u, l.pos.x + Math.cos(back + side) * 2.6, l.pos.z + Math.sin(back + side) * 2.6, 5.3, dt, 0.6);
    return true;
  }
  /** Parties turn for home when it's dark, dangerous, too far or too long. */
  function updateParties(dt) {
    for (let i = T.parties.length - 1; i >= 0; i--) {
      const p = T.parties[i];
      p.t += dt;
      p.members = p.members.filter((m) => !m.dead && m.task?.party === p);
      if (!p.members.length) {
        T.parties.splice(i, 1);
        continue;
      }
      if (!p.members.includes(p.leader)) p.leader = p.members[0];
      const l = p.leader;
      const why = expeditionCheck({
        t: p.t,
        range: Math.hypot(l.pos.x - HOME.x, l.pos.z - HOME.z),
        threat: !!L.threat,
        phase: L.phase,
        weakest: Math.min(...p.members.map((m) => m.health / m.maxHealth)),
        left: p.members.length,
      });
      if (why && !(why === "time" && p.members.some((m) => m.task.type === "haul"))) {
        p.members.forEach((m, k) => {
          const at = c.around(HOME, 3, 6 + k * 0.4);
          m.task = { type: "retreat", x: at.x, z: at.z, auto: true };
        });
        T.parties.splice(i, 1);
      }
    }
  }

  /* ---- acts: everything that isn't a food run --------------------------------------------- */
  function goTo(u, a, dt, pace = 3.2, stop0 = 0.5) {
    const g = a.spot || a.goal;
    if (!g) return true;
    return c.walk(u, g.x, g.z, pace * (L.mood === "short" ? 0.88 : 1), dt, stop0);
  }
  function runAct(u, dt) {
    const a = u.act;
    a.t += dt;
    const end = () => stop(u);
    // Time's up (sleep ends with the night, hiding with the danger).
    if (a.kind === "sleep") {
      if ((L.phase === "day" || L.phase === "dawn") && a.t > 4 && (L.phase === "day" || Math.random() < dt * 0.15)) {
        end();
        u.body.playAbility("pose"); // a big stretch
        return;
      }
    } else if (a.kind === "hide") {
      if (!L.threat) return end();
    } else if (a.t > a.dur) return end();
    switch (a.kind) {
      case "sleep": {
        if (!goTo(u, a, dt, 2.6, 0.4)) return;
        if (!a.down) {
          a.down = true;
          c.face(u, HOME.x, HOME.z);
          u.body.setSleep(true);
        }
        u.speed = 0;
        if ((a.z = (a.z ?? rnd(1, 4)) - dt) <= 0) {
          a.z = rnd(4, 8);
          c.emote(u, "sleep");
        }
        return;
      }
      case "rest":
      case "hide": {
        if (!goTo(u, a, dt, a.kind === "hide" ? 5.4 : 2.6, 0.5)) return;
        if (!a.down) {
          a.down = true;
          c.face(u, FIRE.x, FIRE.z);
          u.body.setCrouch(1);
          if (a.kind === "hide") c.emote(u, "worry");
        }
        u.speed = 0;
        if (a.kind === "rest" && (a.look = (a.look ?? 2) - dt) <= 0) {
          a.look = rnd(3, 6);
          u.body.lookAt(Math.random() < 0.6 ? c.nearSomething(u) : null);
        }
        return;
      }
      case "campfire": {
        if (!goTo(u, a, dt, 3, 0.4)) return;
        c.face(u, FIRE.x, FIRE.z);
        if (!a.down) {
          a.down = true;
          u.body.setCrouch(L.mood === "plenty" ? 0.85 : 1);
        }
        u.speed = 0;
        if ((a.beat = (a.beat ?? rnd(1, 3)) - dt) <= 0) {
          a.beat = rnd(3, 6);
          const r = Math.random();
          const party = L.mood === "plenty" && (L.phase === "evening" || L.phase === "night");
          if (party && r < 0.35) {
            u.body.setCrouch(0);
            a.down = false;
            c.perform(u, Math.random() < 0.6 ? "dance" : "sing");
          } else if (r < (party ? 0.65 : 0.4) && T.food >= 3) {
            u.body.playAbility("eat");
            if (Math.random() < 0.4) c.emote(u, "eat");
          } else if (r < 0.8) {
            const n = c.mine().find((v) => v !== u && v.act?.kind === "campfire" && Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) < 4);
            if (n) {
              u.body.lookAt(c.headPos(n));
              u.body.playAbility("talk");
              c.emote(u, "talk");
            }
          } else if (L.mood === "short") c.emote(u, "worry");
        }
        return;
      }
      case "social": {
        const at = a.at;
        const i = a.group.indexOf(u);
        const n = Math.max(2, a.group.length);
        const ang = (i / n) * TAU + 0.3;
        const r = 1.1 + 0.25 * n;
        if (!c.walk(u, at.x + Math.cos(ang) * r, at.z + Math.sin(ang) * r, 2.8, dt, 0.4)) return;
        c.face(u, at.x, at.z);
        u.speed = 0;
        a.group = a.group.filter((v) => !v.dead && v.act?.group === a.group);
        if (a.group.length < 2 && a.t > 6) return end();
        if ((a.beat = (a.beat ?? rnd(0.5, 3)) - dt) <= 0) {
          a.beat = rnd(2, 4.5);
          const other = a.group[(i + 1) % a.group.length];
          if (other && other !== u) u.body.lookAt(c.headPos(other));
          const r2 = Math.random();
          if (r2 < 0.6) {
            u.body.playAbility("talk");
            c.emote(u, "talk");
          } else if (r2 < 0.75) c.perform(u, "charm");
          else if (r2 < 0.85 && L.mood === "plenty") c.perform(u, "dance");
          else if (L.mood === "short") c.emote(u, "worry");
          else u.body.playAbility("wave");
        }
        return;
      }
      case "play": {
        const m = a.mate;
        if (!m || m.dead || m.act?.mate !== u) return end();
        if (a.style === "chase") {
          if (a.it) {
            if (c.walk(u, m.pos.x, m.pos.z, u.child ? 4.6 : 5.6, dt, 1.1)) {
              // Tag! Now the other one chases.
              a.it = false;
              m.act.it = true;
              m.act.cool = 0.8;
              u.body.playAbility("dance");
              a.flee = null;
            }
          } else {
            if ((a.cool = (a.cool || 0) - dt) > 0) return void (u.speed = 0);
            if (!a.flee || Math.hypot(u.pos.x - a.flee.x, u.pos.z - a.flee.z) < 1.2) a.flee = c.around(HOME, 3, 12);
            c.walk(u, a.flee.x, a.flee.z, u.child ? 4.2 : 5, dt, 0.6);
          }
        } else {
          // A play fight: square up, butt heads, bounce off, no harm done.
          if (!c.walk(u, m.pos.x, m.pos.z, 3, dt, 1.4 + u.scale * 0.5)) return;
          c.face(u, m.pos.x, m.pos.z);
          if ((a.beat = (a.beat ?? rnd(0.2, 1)) - dt) <= 0) {
            a.beat = rnd(0.8, 1.6);
            u.body.playAbility(Math.random() < 0.4 ? "charge" : Math.random() < 0.5 ? "bite" : "dance");
          }
        }
        return;
      }
      case "work":
        return work(u, a, dt);
      case "train":
        return train(u, a, dt);
      case "patrol": {
        const p = a.points[a.i];
        if (!p) return end();
        if (!c.walk(u, p.x, p.z, 3.4, dt, 0.8)) return;
        u.speed = 0;
        if ((a.pause = (a.pause ?? rnd(1.5, 3)) - dt) > 0) {
          u.body.lookAt(c.v3(p.x + (p.x - HOME.x), u.pos.y + 1, p.z + (p.z - HOME.z)));
          return;
        }
        a.pause = null;
        a.i++;
        u.body.lookAt(null);
        return;
      }
      case "watch": {
        if (!goTo(u, a, dt, 3.4, 0.6)) return;
        u.speed = 0;
        // Sweep the horizon.
        const sweep = a.out + Math.sin(a.t * 0.4) * 0.9;
        u.heading = Math.atan2(-Math.sin(sweep), Math.cos(sweep));
        u.body.lookAt(c.v3(u.pos.x + Math.cos(sweep) * 40, u.pos.y + 2, u.pos.z + Math.sin(sweep) * 40));
        if ((a.beat = (a.beat ?? rnd(6, 10)) - dt) <= 0) {
          a.beat = rnd(7, 12);
          u.body.playAbility("pose");
        }
        return;
      }
      case "guard": {
        // Between the village and the danger, facing it.
        const th = L.threat;
        if (!th) return end();
        const ang = Math.atan2(th.z - HOME.z, th.x - HOME.x) + ((u.id % 5) - 2) * (a.front ? 0.3 : 0.45);
        const R = a.front ? 8 : 6;
        if (!c.walk(u, HOME.x + Math.cos(ang) * R, HOME.z + Math.sin(ang) * R, 5.4, dt, 0.8)) return;
        c.face(u, th.x, th.z);
        if ((a.beat = (a.beat ?? 0) - dt) <= 0) {
          a.beat = rnd(2, 3.5);
          u.body.playAbility("pose");
        }
        return;
      }
      case "greet": {
        const who = a.who && !a.who.dead ? a.who.pos : a.at;
        const ang = Math.atan2(u.pos.z - who.z, u.pos.x - who.x);
        if (!c.walk(u, who.x + Math.cos(ang) * 2.4, who.z + Math.sin(ang) * 2.4, 4.2, dt, 0.6) && a.t < 3) return;
        c.face(u, who.x, who.z);
        u.speed = 0;
        if (!a.did) {
          a.did = true;
          c.perform(u, a.move);
        }
        return;
      }
      case "investigate": {
        // Walk out to it, stop at a wary distance, look it over, then back to work.
        const w = a.what;
        if (!w || w.dead) return end();
        const ang = Math.atan2(u.pos.z - w.pos.z, u.pos.x - w.pos.x);
        if (!c.walk(u, w.pos.x + Math.cos(ang) * 6, w.pos.z + Math.sin(ang) * 6, 3.6, dt, 1) && a.t < 8) return;
        c.face(u, w.pos.x, w.pos.z);
        u.speed = 0;
        u.body.lookAt(c.v3(w.pos.x, w.pos.y + 1, w.pos.z));
        if (!a.did) {
          a.did = true;
          u.body.playAbility(w.animal ? "pose" : "wave");
        }
        return;
      }
      case "home": {
        if (c.walk(u, FIRE.x + Math.cos(u.id) * 5, FIRE.z + Math.sin(u.id) * 5, 4.6, dt, 1)) end();
        return;
      }
    }
  }
  function work(u, a, dt) {
    if (a.sub === "craft") {
      if (!goTo(u, a, dt, 3.2, 0.4)) return;
      const craft = village.pieces.find((p) => p.id === "craft");
      if (craft) c.face(u, craft.x, craft.z);
      u.body.setCrouch(0.45);
      u.speed = 0;
      if ((a.beat = (a.beat ?? 0.5) - dt) <= 0) {
        a.beat = rnd(0.9, 1.4);
        u.body.playAbility(Math.random() < 0.75 ? "strike" : "dig");
        if (c.near(u)) c.sfx("chop", { pitch: 1.5 + Math.random() * 0.3, gain: 0.15 });
      }
      return;
    }
    if (a.sub === "supplies") {
      // Wood from the woodpile to wherever it's needed.
      if (!a.from) {
        a.from = c.around(HOME, 10, 15);
        const to = village.pieces.filter((p) => ["craft", "rack", "shelter", "storage"].includes(p.id));
        const t = to[Math.floor(Math.random() * to.length)] || { x: FIRE.x, z: FIRE.z };
        a.to = { x: t.x + 1.6, z: t.z + 1.2 };
      }
      if (!a.picked) {
        if (!c.walk(u, a.from.x, a.from.z, 3.4, dt, 0.8)) return;
        u.body.playAbility("dig");
        a.picked = true;
        u.carryKind = "supplies";
        u.carry = 2;
        return;
      }
      if (!c.walk(u, a.to.x, a.to.z, 3, dt, 0.8)) return;
      u.carry = 0;
      u.carryKind = null;
      u.body.playAbility("dig");
      a.dur = Math.min(a.dur, a.t + 1);
      return;
    }
    if (a.sub === "fire") {
      if (!c.walk(u, FIRE.x + 1.6, FIRE.z + 0.4, 3.2, dt, 0.5)) return;
      c.face(u, FIRE.x, FIRE.z);
      u.speed = 0;
      if ((a.beat = (a.beat ?? 0.4) - dt) <= 0) {
        a.beat = rnd(1.5, 2.5);
        u.body.playAbility("strike");
        c.flare();
      }
      if (a.t > 7) a.dur = 0;
      return;
    }
    // Tidying: little jobs around the village.
    if (!a.goal || Math.hypot(u.pos.x - a.goal.x, u.pos.z - a.goal.z) < 0.8) {
      if (a.goal) {
        u.body.playAbility("dig");
        a.wait = 1.4;
      }
      a.goal = c.around(HOME, 4, 13);
    }
    if ((a.wait = (a.wait || 0) - dt) > 0) return void (u.speed = 0);
    c.walk(u, a.goal.x, a.goal.z, 2.6, dt, 0.6);
  }
  function train(u, a, dt) {
    if (a.sub === "dummy") {
      if (!c.walk(u, a.spot.x + 1.3, a.spot.z, 3.4, dt, 0.4)) return;
      c.face(u, a.spot.x, a.spot.z);
      u.speed = 0;
      if ((a.beat = (a.beat ?? 0.3) - dt) <= 0) {
        a.beat = rnd(0.8, 1.2);
        u.body.playAbility(c.isWeapon(u.tool) || Math.random() < 0.6 ? "strike" : "bite");
        a.spot.mesh.rotation.z = (Math.random() - 0.5) * 0.25;
        if (c.near(u)) c.sfx("chop", { pitch: 1.2, gain: 0.12 });
      }
      return;
    }
    if (a.sub === "spar") {
      const m = a.mate;
      if (!m) {
        // Waiting for a sparring partner; drill alone meanwhile.
        if (a.t > 6) a.sub = "drill";
        if (a.spot) goTo(u, a, dt, 3, 0.4);
        return;
      }
      if (m.dead || m.act?.mate !== u) return stop(u);
      if (!c.walk(u, m.pos.x, m.pos.z, 3, dt, 1.6 + u.scale * 0.4)) return;
      c.face(u, m.pos.x, m.pos.z);
      u.speed = 0;
      if ((a.beat = (a.beat ?? (u.id % 2) * 0.6) - dt) <= 0) {
        a.beat = rnd(1, 1.5);
        u.body.playAbility(Math.random() < 0.6 ? "strike" : "charge");
      }
      return;
    }
    // Drill: weapon practice in the air.
    if (a.goal && !c.walk(u, a.goal.x, a.goal.z, 3.2, dt, 0.6)) return;
    a.goal = null;
    u.speed = 0;
    if ((a.beat = (a.beat ?? 0.4) - dt) <= 0) {
      a.beat = rnd(0.9, 1.5);
      u.heading += rnd(-0.6, 0.6);
      u.body.playAbility(Math.random() < 0.7 ? "strike" : "charge");
    }
  }

  /* ---- the frame ------------------------------------------------------------------------------ */
  function update(dt) {
    L.clock -= dt;
    if (L.clock <= 0) {
      L.clock = 0.5;
      refresh();
    }
    T.homeHold = Math.max(0, (T.homeHold || 0) - dt);
    updateParties(dt);
    // The tribe's character, from how it lives (slowly).
    if ((L.slow -= dt) <= 0) {
      L.slow = 5;
      L.lean = tribePersonality(c.culture);
    }
    if (L.mood === "plenty") c.culture.plentyTime += dt;
    c.culture.guardTime += dt * c.mine().filter((u) => u.role === "guard" && !u.child).length * 0.25;
    // The chief coming home after a while away gets a welcome.
    const chief = c.mine().find((u) => u.chief);
    if (chief) {
      const away = Math.hypot(chief.pos.x - HOME.x, chief.pos.z - HOME.z) > 28;
      if (away) L.chiefAway += dt;
      else {
        if (L.chiefAway > 20) event("chief", chief.pos, chief);
        L.chiefAway = 0;
      }
    }
  }

  return {
    L,
    member,
    stop,
    update,
    follow,
    event,
    refresh,
    activityOf,
    /** Shown on the member chips: what each is up to. */
    iconOf(u) {
      const k = activityOf(u);
      if (!k) return "";
      if (k === "fight") return "⚔";
      if (k === "retreat") return "↩";
      if (k === "greet") return "👋";
      if (k === "hide") return "🛖";
      if (k === "guard") return "🛡";
      if (k === "home") return "↩";
      return ACTIVITIES[k]?.icon || "";
    },
    /** The member gave up on something it couldn't reach: try something else for a while. */
    giveUp(u, kind) {
      u.fail = u.fail || {};
      if (kind) u.fail[kind] = T.time + 25;
      if (u.task?.auto) {
        if (u.task.fruit) u.task.fruit.claimed = false;
        u.task = null;
      }
      stop(u);
      u.decide = 0.5;
    },
    get expeditionMax() {
      return EXPEDITION.maxTime;
    },
  };
}
