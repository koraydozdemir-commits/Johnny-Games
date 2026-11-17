/**
 * The Creature Stage: walk the island, befriend or hunt every nest, grow your brain to level 5.
 *
 * Owns its own scene and camera and borrows the game's renderer and input. Everything that should
 * outlive a session (body, brain, nests, parts) is saved to localStorage after meaningful events.
 */
import * as THREE from "three";
import { timeUniform } from "../gfx/materials.js";
import { buildCreatureBody } from "./body3d.js";
import { CREATURE_SAVE_KEY, creaturePartIds, validateCreature } from "./format.js";
import { ABILITY_INFO, COMBAT, CREATURE_PARTS, SOCIAL, abilitiesOf, creaturePart, dietOfParts } from "./parts.js";
import { createEmotes } from "./emotes.js";
import { RELATION_INFO, relationDelta, relationOf } from "./relations.js";
import { evolveSpecies, generateEpic, generateRogue, generateSpecies, socialNeed } from "./species.js";
import { ISLAND, RING_NAMES, createIsland, heightAt, ringAt } from "./world.js";
import { creatureCard } from "../traits.js";

const TAU = Math.PI * 2;
const DIET_BY_RING = [null, ["plant", "omni", "plant"], ["plant", "meat", "plant"], ["meat", "plant", "omni"], ["plant", "meat"], ["meat"]];
const XP_TO_NEXT = [0, 120, 180, 250, 330];
const PACK_SIZE = [0, 1, 2, 3, 4, 4];
const ACTIVE_RANGE = 80; // nests closer than this have live creatures

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {object} o.record        the player's creature record
 * @param {string} o.cellCard      herbivore | omnivore | carnivore (the ability from the cell stage)
 * @param {object|null} o.save     a saved stage state to resume, if any
 * @param {() => {x:number,y:number}} o.getInput  x = right, y = forward
 * @param {string} o.quality
 * @param {(kind:string) => void} o.sfx
 * @param {() => boolean} o.isTouch
 * @param {(s:object) => void} o.onMate        brain bar full and mated at the nest: open the editor
 * @param {(entry:object) => void} o.onGeneration  a new generation for the species history
 * @param {(cardId:string) => void} o.onCard    Creature card earned
 * @param {() => void} o.onHistory
 * @param {() => void} o.onExit
 * @param {(part:object, source:string) => void} [o.onUnlock]  a new part became available
 * @param {boolean} [o.intro]  play the crawl-out cinematic first
 * @param {() => void} [o.onIntroDone]
 * @param {(record:object) => string|null} [o.portrait]  a small picture of a creature (data URL)
 * @param {() => void} [o.onSettings]
 * @param {() => void} [o.onTribe]  open the Tribe Stage prototype
 * @param {() => void} [o.onSaved]
 * @param {() => boolean} [o.reducedMotion]
 */
export function createCreatureStage(o) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
  const world = createIsland(scene, o.quality);
  const raycaster = new THREE.Raycaster();

  /* ---- state ---------------------------------------------------------- */
  const save = o.save || {};
  const P = {
    record: validateCreature(save.record || o.record),
    brain: save.brain || 1,
    xp: save.xp || 0,
    dna: save.dna ?? 20,
    hunger: save.hunger ?? 100,
    health: 1,
    maxHealth: 100,
    unlocked: new Set(save.unlocked || []),
    alliances: save.alliances || 0,
    extinctions: save.extinctions || 0,
    deaths: save.deaths || 0,
    card: save.card || null,
    pos: new THREE.Vector3(save.pos?.x ?? ISLAND.nest.x, 0, save.pos?.z ?? ISLAND.nest.z - 13),
    heading: save.heading ?? Math.PI / 2,
    speed: 0,
    lastHurt: 0,
    aggro: 0, // seconds since you last fought: herbivores keep away from a creature that's been fighting
    pending: null, // { kind, t }: walking up to a target to use a move, like Spore's click-to-act
    discovered: new Set([...(save.discovered || []), "own"]),
    cooldowns: {},
    cardCooldown: 0,
    invulnerable: 2,
    target: null,
    abilities: null,
    diet: "plant",
    body: null,
    deadTimer: 0,
    genStart: save.genStart || { alliances: 0, extinctions: 0, deaths: 0 },
    bonesTaken: new Set(save.bonesTaken || []),
    stamina: 100,
    staminaRest: 0, // seconds before stamina starts to refill
    sneaking: false,
    sprinting: false,
    sprintHeld: false, // Shift on a keyboard; the Sprint button toggles on touch
    air: null, // { h, vy, mode: "jump" | "glide" } while off the ground
    /** What you did to each species, for the library: species id -> { friends, kills } */
    treated: save.treated || {},
  };
  const treat = (sp, key) => {
    const rec = (P.treated[sp.id] ||= { friends: 0, kills: 0 });
    rec[key]++;
  };
  const unlockedParts = () => {
    const base = new Set(P.unlocked);
    P.record.parts.forEach((p) => base.add(p.id));
    base.add(P.record.foot);
    return base;
  };

  function rebuildPlayer() {
    if (P.body) P.body.dispose();
    // A fresh body starts standing, opaque and on the ground.
    P.sneaking = false;
    P.sprinting = false;
    P.air = null;
    P.body = buildCreatureBody(P.record, { quality: o.quality });
    scene.add(P.body.root);
    P.abilities = abilitiesOf(creaturePartIds(P.record), P.record.legs.length);
    P.diet = dietOfParts(P.record.parts.map((p) => p.id));
    P.maxHealth = 100 + P.abilities.health * 25 + (P.brain - 1) * 20;
    if (P.health > P.maxHealth || P.health <= 1) P.health = P.maxHealth;
    P.scale = 0.9 + (P.brain - 1) * 0.12;
    P.body.root.scale.setScalar(P.scale);
  }
  rebuildPlayer();
  if (save.health) P.health = Math.min(P.maxHealth, save.health);

  /* ---- nests and creatures -------------------------------------------- */
  const seedBase = save.seed || ((Math.random() * 1e9) | 0);
  const nests = world.nestSites.map((site, i) => {
    const diets = DIET_BY_RING[site.ring];
    let species = generateSpecies(seedBase + i * 7919, diets[i % diets.length], site.ring);
    const saved = save.nests?.[i];
    // Species evolve as you do; a saved island replays the same evolution steps.
    for (let k = 0; k < (saved?.evo || 0); k++) species = evolveSpecies(species);
    const home = saved?.site ? { x: saved.site.x, z: saved.site.z, ring: site.ring } : { ...site };
    const mesh = world.makeNestMesh(home.x, home.z, species.record.colors.accent);
    return {
      index: i,
      site: home,
      evo: saved?.evo || 0,
      migrating: 0,
      snub: 0,
      species,
      status: saved?.status || "neutral", // neutral | allied | extinct
      angry: 0,
      members: Array.from({ length: species.members }, (_, k) => ({ alive: saved?.members?.[k]?.alive ?? true, friend: saved?.members?.[k]?.friend ?? false, npc: null })),
      mesh,
    };
  });
  const epics = [generateEpic(seedBase + 99991, 4), generateEpic(seedBase + 77773, 5)].map((sp, i) => ({ species: sp, alive: save.epics?.[i] ?? true, angle: i * Math.PI, ring: sp.ring, npc: null }));

  const npcs = new Set();
  /**
   * A live creature. Nest alphas (each nest's first member) are a third bigger and much tougher, and
   * lead their nest: win the alpha over and the whole nest follows; bring it down and the rest cower.
   */
  function spawnNPC(species, x, z, extra = {}) {
    const alpha = !!extra.alpha;
    const scale = species.scale * (alpha ? 1.3 : 1);
    const maxHealth = Math.round(species.maxHealth * (alpha ? 1.8 : 1));
    const body = buildCreatureBody(species.record, { quality: o.quality === "high" ? "medium" : "low", seed: 2 });
    body.root.scale.setScalar(scale);
    scene.add(body.root);
    const npc = {
      species,
      body,
      scale,
      maxHealth,
      pos: new THREE.Vector3(x, heightAt(x, z), z),
      heading: Math.random() * TAU,
      speed: 0,
      health: maxHealth,
      hunting: false, // chasing you right now
      // How likely it is to stand its ground when badly hurt (alphas and rogues rarely run).
      brave: extra.epic ? 1 : alpha ? 0.9 : extra.rogue ? 0.75 : 0.3 + Math.random() * 0.4,
      mood: null, // last relation shown, for the face that pops up when it changes
      moodAt: 0,
      state: "idle",
      think: Math.random() * 2,
      cool: 0,
      stun: 0,
      social: null,
      calm: 0,
      ...extra,
    };
    npcs.add(npc);
    return npc;
  }
  function despawnNPC(npc) {
    npc.body.dispose();
    npcs.delete(npc);
    if (P.target === npc) P.target = null;
  }
  /* ---- your own nest ----------------------------------------------------------
     Like Spore, members of your species live at your nest. They are who you mate with, and you can
     show off to one to bring it along in your pack. A new design hatches a whole new family. */
  const FAMILY_SIZE = 4;
  let family = [];
  const ownSpecies = () => ({
    id: "own",
    name: P.record.name,
    record: P.record,
    abilities: P.abilities,
    favourite: ["sing", "dance", "charm"],
    maxHealth: Math.round(P.maxHealth * 0.8),
    diet: P.diet,
    temper: "friendly",
    ring: 1,
    scale: P.scale * 0.95,
    generation: P.brain,
  });
  function hatchFamily() {
    // Pack members out with you keep their old look; the ones at home are replaced by the new design.
    const away = family.filter((n) => n.following && !n.dead);
    family.filter((n) => !away.includes(n)).forEach(despawnNPC);
    const sp = ownSpecies();
    family = [
      ...away,
      ...Array.from({ length: Math.max(0, FAMILY_SIZE - away.length) }, (_, k) => {
        const a = (k / FAMILY_SIZE) * TAU + 0.4;
        return spawnNPC(sp, ISLAND.nest.x + Math.cos(a) * 6, ISLAND.nest.z + Math.sin(a) * 6, { family: true });
      }),
    ];
  }
  /** Mating, Spore-style: the nearest family member comes over, you court, and an egg is laid. */
  let courtship = null;
  function callMate() {
    if (!brainReady || courtship || !nearNest()) return;
    const partner = family.filter((n) => !n.dead && !n.following).sort((a, b) => distTo(a) - distTo(b))[0];
    if (!partner) return mate();
    courtship = { n: partner, t: 0 };
    partner.social = null;
    P.pending = null;
    o.sfx("mate");
  }
  function updateCourtship(dt) {
    const c = courtship,
      n = c.n;
    c.t += dt;
    const dx = n.pos.x - P.pos.x,
      dz = n.pos.z - P.pos.z,
      d = Math.hypot(dx, dz);
    const close = 2.4 * P.scale;
    // The partner trots over; once together the two face each other and dance.
    if (d > close) {
      n.heading = Math.atan2(dz, -dx);
      n.speed = 3.5;
      n.pos.x -= (dx / d) * 3.5 * dt;
      n.pos.z -= (dz / d) * 3.5 * dt;
      c.t = Math.min(c.t, 0.5);
    } else {
      n.speed = 0;
      n.heading = Math.atan2(dz, -dx);
      P.heading = Math.atan2(-dz, dx);
      if ((c.beat = (c.beat || 0) - dt) <= 0) {
        c.beat = 1.6;
        const move = ["dance", "charm"][Math.floor(c.t / 1.6) % 2];
        act(P, move);
        act(n, move);
        voice(P, move);
        pop(P, "💗", "good");
        pop(n, "💗", "good");
      }
    }
    n.pos.y = heightAt(n.pos.x, n.pos.z);
    if (c.t > 3.2) {
      courtship = null;
      dust(P.pos.x, P.pos.z, 6, eggMat);
      mate();
    }
  }
  const eggMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 0.4 });

  /** Lost family members are replaced slowly: a new one hatches at the nest every so often. */
  let hatchClock = 90;
  function regrowFamily(dt) {
    family = family.filter((n) => !n.dead && npcs.has(n));
    if (family.length >= FAMILY_SIZE || raid) return;
    if ((hatchClock -= dt) > 0) return;
    hatchClock = 90;
    const a = Math.random() * TAU;
    const n = spawnNPC(ownSpecies(), ISLAND.nest.x + Math.cos(a) * 4, ISLAND.nest.z + Math.sin(a) * 4, { family: true });
    family.push(n);
    dust(n.pos.x, n.pos.z, 6, eggMat);
    if (distTo(n) < 40) pop(n, "🥚", "good");
  }

  /* ---- raids ------------------------------------------------------------------
     Once your brain has grown a little, carnivores come for your family. A few hunters run in from
     the wild and go for the creatures at your nest; drive them off or lose your kin. */
  let raid = null,
    raidClock = 240 + Math.random() * 120;
  function raidSpecies() {
    const meat = nests.filter((n) => n.status !== "extinct" && n.species.diet === "meat" && n.status !== "allied").sort((a, b) => a.species.ring - b.species.ring);
    if (meat.length) return meat[Math.min(meat.length - 1, Math.max(0, P.brain - 2))].species;
    return generateSpecies(seedBase + 4242 + P.brain, "meat", Math.min(4, P.brain));
  }
  function startRaid() {
    if (raid || !family.some((n) => !n.dead && !n.following)) return false;
    const sp = raidSpecies();
    const count = Math.min(4, 1 + Math.ceil(P.brain / 2));
    // They come from inland, the side away from the beach.
    const a0 = Math.atan2(-ISLAND.nest.z, -ISLAND.nest.x);
    const raiders = [];
    for (let i = 0; i < count; i++) {
      const a = a0 + (i - (count - 1) / 2) * 0.35;
      const at = world.resolve(ISLAND.nest.x + Math.cos(a) * 42, ISLAND.nest.z + Math.sin(a) * 42, 2);
      const n = spawnNPC(sp, at.x, at.z, { raider: true });
      n.heading = Math.atan2(-(ISLAND.nest.z - at.z), ISLAND.nest.x - at.x);
      raiders.push(n);
    }
    raid = { raiders, t: 0, warned: false };
    o.sfx("roar");
    toast("Raiders are coming for your nest!", 3.5);
    tipOnce("raid", "Carnivores raid nests. Fight them off before they get your family.", 4.5);
    return true;
  }
  function updateRaid(dt) {
    if (!raid) {
      if (P.brain >= 2 && !intro && !courtship && (raidClock -= dt) <= 0) {
        // Only when you are near enough to come back and defend; otherwise check again soon.
        if (Math.hypot(P.pos.x - ISLAND.nest.x, P.pos.z - ISLAND.nest.z) < 90 && startRaid()) raidClock = 240 + Math.random() * 120;
        else raidClock = 30;
      }
      return;
    }
    raid.t += dt;
    raid.raiders = raid.raiders.filter((n) => npcs.has(n) && !n.dead && n.retreat === undefined);
    const kin = family.filter((n) => !n.dead && !n.following);
    if (!raid.raiders.length) {
      endRaid(true);
      return;
    }
    if (!kin.length || raid.t > 120) {
      // Nothing left to take, or they've had enough: they head back to the wild.
      raid.raiders.forEach((n) => (n.retreat = 6));
      endRaid(false);
    }
  }
  function endRaid(won) {
    if (!raid) return;
    if (won) {
      o.sfx("friend");
      toast("You drove off the raiders", 3);
      gainXp(25 + P.brain * 5);
      P.dna += 8;
      family.filter((n) => !n.dead).forEach((n) => pop(n, "💚", "good"));
    }
    raid = null;
    saveState();
  }
  /** A family member killed by raiders: no meat, no reward, just a loss. */
  function loseKin(n) {
    if (n.dead) return;
    n.dead = true;
    n.following = false;
    n.body.die();
    o.sfx("death");
    if (distTo(n) < 60) toast("A " + P.record.name + " was killed", 2.5);
    family = family.filter((m) => m !== n);
    setTimeout(() => despawnNPC(n), 2500);
  }

  /** Nests near the player have live creatures; far ones are just numbers. */
  function streamNests() {
    for (const nest of nests) {
      const d = Math.hypot(nest.site.x - P.pos.x, nest.site.z - P.pos.z);
      nest.members.forEach((m, k) => {
        if (!m.alive) return;
        const inPack = m.npc?.following;
        if (d < ACTIVE_RANGE && !m.npc) {
          const a = (k / nest.members.length) * TAU;
          m.npc = spawnNPC(nest.species, nest.site.x + Math.cos(a) * 4, nest.site.z + Math.sin(a) * 4, { nest, member: m, alpha: k === 0 });
        } else if (d > ACTIVE_RANGE + 15 && m.npc && !inPack) {
          despawnNPC(m.npc);
          m.npc = null;
        }
      });
    }
    for (const e of epics) {
      if (!e.alive) continue;
      const ex = Math.cos(e.angle) * (e.ring === 5 ? 22 : 52),
        ez = Math.sin(e.angle) * (e.ring === 5 ? 22 : 52);
      const d = Math.hypot(ex - P.pos.x, ez - P.pos.z);
      if (d < ACTIVE_RANGE && !e.npc) e.npc = spawnNPC(e.species, ex, ez, { epic: e });
      else if (d > ACTIVE_RANGE + 20 && e.npc) {
        despawnNPC(e.npc);
        e.npc = null;
      }
    }
    // Rogues roam their ring alone; the live one wanders off its circuit while it hunts you.
    for (const r of rogues) {
      if (!r.alive) continue;
      const { x: rx, z: rz } = rogueHome(r);
      const ref = r.npc ? r.npc.pos : { x: rx, z: rz };
      const d = Math.hypot(ref.x - P.pos.x, ref.z - P.pos.z);
      if (d < ACTIVE_RANGE && !r.npc) r.npc = spawnNPC(r.species, rx, rz, { rogue: r });
      else if (d > ACTIVE_RANGE + 20 && r.npc) {
        despawnNPC(r.npc);
        r.npc = null;
      }
    }
  }
  /* Rogues: lone, extra-tough wanderers, one per ring from the forest inward, each carrying a rare
     part. They circle the island slowly, so you meet them in different places. */
  const ROGUE_RADIUS = [0, 176, 131, 91, 53];
  const rogues = [1, 2, 3, 4].map((ring, i) => ({
    species: generateRogue(seedBase + 31337 + i * 104729, ring),
    alive: save.rogues?.[i] ?? true,
    angle: i * 1.7 + 0.6,
    ring,
    npc: null,
  }));
  const rogueHome = (r) => {
    const d = ROGUE_RADIUS[r.ring];
    const x = Math.cos(r.angle) * d,
      z = Math.sin(r.angle) * d;
    return world.resolve(x, z, 3);
  };

  hatchFamily();

  /* ---- food ------------------------------------------------------------- */
  const carcasses = [];
  // A lumpy flat-shaded chunk of meat with a pale bone through it.
  const carcassGeo = new THREE.IcosahedronGeometry(0.55, 1).scale(1.3, 0.75, 1);
  {
    const pos = carcassGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.85 + 0.3 * Math.abs(Math.sin(pos.getX(i) * 7.1 + pos.getY(i) * 4.3 + pos.getZ(i) * 5.7));
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    carcassGeo.computeVertexNormals();
  }
  const carcassMat = new THREE.MeshStandardMaterial({ color: 0xc4473b, roughness: 0.55, flatShading: true });
  const boneGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6).rotateZ(Math.PI / 2.3);
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xf0e6cf, roughness: 0.8 });
  function dropCarcass(x, z, amount) {
    const mesh = new THREE.Mesh(carcassGeo, carcassMat);
    mesh.add(new THREE.Mesh(boneGeo, boneMat));
    mesh.rotation.y = Math.random() * TAU;
    mesh.position.set(x, heightAt(x, z) + 0.3, z);
    scene.add(mesh);
    carcasses.push({ x, z, mesh, bites: amount, life: 90 });
  }

  /* ---- HUD ---------------------------------------------------------------- */
  const hud = document.createElement("div");
  hud.className = "creatureHUD stageHUD";
  hud.innerHTML = `
    <div class="chTop">
      <div class="chBox chVitals">
        <div class="chName"><b id="chName"></b><span id="chBrain"></span></div>
        <div class="chBar"><span>Health</span><i><b id="chHealth"></b></i></div>
        <div class="chBar"><span>Hunger</span><i><b id="chHunger"></b></i></div>
        <div class="chBar brain"><span>Brain</span><i><b id="chXp"></b></i></div>
      </div>
      <div class="chTopRight">
        <span class="chPill" id="chDna"></span>
        <button class="chIconBtn" id="chHistory" aria-label="Species history and library" title="Species history and library">◈</button>
        <button class="chIconBtn" id="chMenu" aria-label="Menu" title="Menu">☰</button>
      </div>
    </div>
    <div class="chObjective" id="chObjective"></div>
    <div class="chPack" id="chPack" role="list" aria-label="Your pack"></div>
    <div class="chArc" id="chArc" hidden>
      <svg class="arcSvg" viewBox="0 0 240 128" aria-hidden="true">
        <path class="arcRim" d="M 22 118 A 98 98 0 0 1 218 118"></path>
        <path class="arcTrack" d="M 22 118 A 98 98 0 0 1 218 118" pathLength="100"></path>
        <path class="arcFill" id="chArcFill" d="M 22 118 A 98 98 0 0 1 218 118" pathLength="100"></path>
      </svg>
      <div class="arcAsk" id="chArcAsk" hidden>
        <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="arcAskTrack" cx="22" cy="22" r="19" pathLength="100"></circle><circle class="arcAskTime" id="chArcTime" cx="22" cy="22" r="19" pathLength="100"></circle></svg>
        <span id="chArcAskIcon"></span>
      </div>
      <img class="arcFace" id="chArcFace" alt="" width="58" height="58" draggable="false">
      <span class="arcLabel" id="chArcLabel" role="status" aria-live="polite"></span>
    </div>
    <div class="chTarget" id="chTarget" hidden role="status" aria-live="polite">
      <div class="ctHead"><span class="ctDiet" id="chTargetDiet"></span><b id="chTargetName"></b><em class="ctTag" id="chTargetTag" hidden></em><button class="ctClose" id="chTargetClose" aria-label="Deselect">✕</button></div>
      <div class="ctVital">
        <img class="ctFace" id="chTargetFace" alt="" width="40" height="40" draggable="false">
        <div class="ctHpWrap"><i class="ctHp"><b id="chTargetHp"></b></i><span class="ctHpNum" id="chTargetHpNum"></span></div>
      </div>
      <span class="ctInfo" id="chTargetInfo"></span>
      <span class="ctLikes" id="chTargetLikes"></span>
      <span class="ctHint" id="chTargetHint"></span>
    </div>
    <div class="chMarkers" id="chMarkers"></div>
    <div class="chPops" id="chPops" aria-hidden="true"></div>
    <div class="chToast" id="chToast"></div>
    <button class="chMate" id="chMate" hidden>♡ Call a mate</button>
    <div class="chAbilities" id="chAbilities" role="toolbar" aria-label="Abilities"></div>
    <div class="chMenuPanel" id="chMenuPanel" hidden>
      <button id="chResume" class="primary">Resume</button>
      <button id="chSettings">⚙ Settings</button>
      <button id="chTribe">🛖 Tribe Stage (prototype)</button>
      <button id="chSoup">Return to the soup</button>
    </div>`;
  document.body.appendChild(hud);
  const $h = (s) => hud.querySelector(s);
  let toastTimer = 0;
  const toast = (text, seconds = 2.4) => {
    $h("#chToast").textContent = text;
    $h("#chToast").classList.add("show");
    toastTimer = seconds;
  };
  /** Creature sounds: bigger creatures have deeper voices; others are a little quieter than you. */
  const voiceOf = (who) => ({ pitch: 1 / Math.sqrt(Math.max(0.5, who === P ? P.scale : who.scale)), gain: who === P ? 1 : 0.55 });
  const ABILITY_SOUND = { bite: "creatureBite", strike: "strike", charge: "charge", spit: "spit", sing: "sing", dance: "dance", charm: "charm", pose: "pose" };
  const voice = (who, kind) => o.sfx(ABILITY_SOUND[kind] || kind, voiceOf(who));
  /** Show, don't tell: an icon that pops up over a creature (or you) and floats away. */
  function pop(who, icon, cls = "") {
    const pos = who === P ? P.pos : who.pos;
    const h = who === P ? P.body.height * P.scale : who.body.height * who.scale;
    const pt = project(tmp.set(pos.x, pos.y + h + 0.6, pos.z));
    if (pt.behind) return;
    const el = document.createElement("span");
    el.className = "chPop " + cls;
    el.textContent = icon;
    el.style.left = pt.x + (Math.random() - 0.5) * 24 + "px";
    el.style.top = pt.y + "px";
    $h("#chPops").appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  /** A creature's feelings changed: its face pops up over its head. */
  function popFace(n, rel, delta) {
    const pt = project(tmp.set(n.pos.x, n.pos.y + n.body.height * n.scale + 0.8, n.pos.z));
    if (pt.behind || pt.x < -40 || pt.x > innerWidth + 40 || pt.y < -40 || pt.y > innerHeight + 40) return;
    const el = document.createElement("img");
    el.className = "chPop chFacePop " + (delta > 0 ? "up" : "down");
    el.src = RELATION_INFO[rel].face;
    el.alt = "";
    el.style.left = pt.x + "px";
    el.style.top = pt.y + "px";
    $h("#chPops").appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
  /** A button that can't be used right now shakes instead of explaining itself. */
  function nope(kind) {
    const b = hud.querySelector(`.chAb[data-ab="${kind}"]`);
    if (!b) return;
    b.classList.remove("nope");
    void b.offsetWidth;
    b.classList.add("nope");
  }
  /** Teaching text appears once per save, then never again. */
  const seenTips = new Set(save.tips || []);
  function tipOnce(key, text, seconds = 4) {
    if (seenTips.has(key)) return;
    seenTips.add(key);
    toast(text, seconds);
  }
  const cardInfo = {
    carnivore: { name: "Feral Roar", icon: "🦁" },
    herbivore: { name: "Gentle Chorus", icon: "🌿" },
    omnivore: { name: "Swarm Call", icon: "✧" },
  }[o.cellCard || "omnivore"];

  /** Spore's action bar: every combat and social move at once, used on whatever you have selected. */
  function renderAbilityButtons() {
    // Movement moves: sneak and sprint wear a ring that shows stamina.
    const moveBtn = (k, icon, name, key, lvl) =>
      `<button class="chAb move ${k}" data-ab="${k}" ${lvl ? "" : 'aria-disabled="true"'} aria-label="${name}${k === "sneak" ? ", level " + (lvl || 0) : ""}" ${k === "jump" ? "" : 'aria-pressed="false"'}><span class="stam"></span><span class="ic">${icon}</span><small>${name}</small><kbd>${key}</kbd></button>`;
    const btn = (k, key) => {
      const lvl = P.abilities[k],
        info = ABILITY_INFO[k];
      return `<button class="chAb ${info.kind}" data-ab="${k}" ${lvl ? "" : 'aria-disabled="true"'} aria-label="${info.name}, level ${lvl || 0}"><span class="cd"></span><span class="ic">${info.icon}</span><small>${info.name}</small><em class="lv">${lvl || "–"}</em><kbd>${key}</kbd></button>`;
    };
    $h("#chAbilities").innerHTML =
      `<div class="chRow combat">${COMBAT.map((k, i) => btn(k, i + 1)).join("")}</div>` +
      `<div class="chRow social">${SOCIAL.map((k, i) => btn(k, i + 5)).join("")}</div>` +
      `<div class="chRow extra">` +
      moveBtn("sneak", "👣", "Sneak", "C", P.abilities.sneak) +
      moveBtn("sprint", "💨", "Sprint", "⇧", 1) +
      moveBtn("jump", P.abilities.glide ? "🕊" : "⤒", "Jump", "␣", P.abilities.jump) +
      `<button class="chAb card" data-ab="card" aria-label="${cardInfo.name}"><span class="cd"></span><span class="ic">${cardInfo.icon}</span><small>${cardInfo.name}</small><kbd>Q</kbd></button>` +
      `<button class="chAb next" data-ab="next" aria-label="Select the next creature"><span class="ic">◎</span><small>Select</small><kbd>Tab</kbd></button></div>`;
    $h("#chAbilities")
      .querySelectorAll("button")
      .forEach((b) => (b.onclick = () => useAbility(b.dataset.ab)));
  }

  /* ---- sneaking, sprinting, jumping ---------------------------------------------
     Sneak (from soft feet, keen senses and the like): crouch low, move at half pace and turn
     see-through; creatures only notice you much closer. Your first attack out of hiding is an ambush.
     Sprint uses Speed; both burn stamina. Anything with legs can hop, and wings turn a hop into a glide. */
  const sneakScale = () => (P.sneaking ? Math.max(0.2, 0.55 - 0.07 * P.abilities.sneak) : 1);
  function setSneak(on) {
    on = !!on && P.abilities.sneak > 0 && P.deadTimer <= 0;
    if (on === P.sneaking) return;
    P.sneaking = on;
    if (on) setSprint(false);
    P.body.setCrouch(on ? 1 : 0);
    P.body.setGhost(on);
    o.sfx(on ? "sneak" : "unsneak");
  }
  function setSprint(on) {
    on = !!on && P.deadTimer <= 0 && P.stamina > 5;
    if (on === P.sprinting) return;
    P.sprinting = on;
    if (on) setSneak(false);
  }
  function jump() {
    if (P.deadTimer > 0 || courtship) return;
    if (P.air) {
      // A second tap in the air spreads the wings (or folds them again).
      if (!P.abilities.glide) return;
      P.air.mode = P.air.mode === "glide" ? "jump" : "glide";
      if (P.air.mode === "glide") {
        P.air.vy = Math.max(P.air.vy, -1);
        o.sfx("glide");
        tipOnce("glide", "Gliding! Tap jump again to drop.");
      }
      P.body.setAir(P.air.mode);
      return;
    }
    if (!P.abilities.jump) {
      nope("jump");
      tipOnce("noLegs", "You need legs to jump.");
      return;
    }
    if (heightAt(P.pos.x, P.pos.z) < -0.9) return; // can't jump while swimming
    P.air = { h: 0, vy: 6 + 1.2 * P.abilities.jump, mode: "jump" };
    P.body.setAir("jump");
    o.sfx("jump", { pitch: 1 / Math.sqrt(P.scale) });
  }

  /* ---- abilities ------------------------------------------------------------ */
  const COOLDOWN = { bite: 1, strike: 1.4, charge: 5, spit: 2.4, sing: 1.5, dance: 1.6, charm: 1.5, pose: 1.4 };
  /* A creature performs a move: the body animates, and social moves send up notes, hearts or sparkles. */
  const emotes = createEmotes(scene);
  function act(who, kind) {
    who.body.playAbility(kind);
    if (!SOCIAL.includes(kind)) return;
    const size = Math.max(0.8, Math.sqrt(who === P ? P.scale : who.scale));
    emotes.emit(
      kind,
      () => {
        if (who !== P && (who.dead || !npcs.has(who))) return null;
        const sc = who === P ? P.scale : who.scale,
          reach = who.body.length * sc * 0.35;
        return new THREE.Vector3(who.pos.x + Math.cos(who.heading) * reach, who.pos.y + who.body.height * sc + 0.4, who.pos.z - Math.sin(who.heading) * reach);
      },
      size,
    );
  }
  const projectiles = [];
  const spitGeo = new THREE.SphereGeometry(0.25, 8, 6),
    spitMat = new THREE.MeshBasicMaterial({ color: 0x9be36b });
  let charging = 0;

  function pickTarget(socialOnly) {
    let best = null,
      bestScore = Infinity;
    const fx = Math.cos(P.heading),
      fz = -Math.sin(P.heading);
    for (const n of npcs) {
      if (n.dead || n.following) continue;
      if (socialOnly && (n.nest?.status !== "neutral" || n.member?.friend || n.epic || n.rogue || n.raider)) continue;
      const dx = n.pos.x - P.pos.x,
        dz = n.pos.z - P.pos.z,
        d = Math.hypot(dx, dz);
      if (d > 16) continue;
      const facing = (dx * fx + dz * fz) / Math.max(d, 0.001);
      const score = d - facing * 5;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }
  const reach = (n) => 2.2 * P.scale + (n ? n.body.radius * n.scale * 0.45 : 0);

  const usable = (n) => n && !n.dead && !n.following;
  const canSocialise = (t) => t.nest && t.nest.status === "neutral" && !t.member?.friend && !t.epic;
  /** How close you must be to use a move on a target. */
  const rangeFor = (kind, t) => (kind === "spit" ? 14 : kind === "charge" ? 12 : ABILITY_INFO[kind].kind === "social" ? 7 : reach(t) + 1);

  /** Select a creature: Spore reveals the species' name the first time you meet it. */
  function select(n) {
    if (!usable(n)) return;
    if (P.target !== n) P.pending = null;
    P.target = n;
    const id = n.species.id;
    if (!P.discovered.has(id)) {
      P.discovered.add(id);
      revealing = { id, t: 0.9 };
      o.sfx("unlock");
      gainXp(4);
      saveState();
    }
  }
  let revealing = null;
  function selectNext() {
    const all = [...npcs].filter((n) => usable(n) && distTo(n) < 24).sort((a, b) => distTo(a) - distTo(b));
    if (!all.length) return nope("next");
    select(all[(all.indexOf(P.target) + 1) % all.length]);
  }

  function useAbility(kind) {
    if (P.deadTimer > 0) return;
    if (kind === "card") return useCard();
    if (kind === "next") return selectNext();
    if (kind === "jump") return jump();
    if (kind === "sprint") return setSprint(!P.sprinting);
    if (kind === "sneak") {
      if (!P.abilities.sneak) {
        nope(kind);
        tipOnce("noSneak", "Sneaking needs a part: soft feet, sharp senses or nimble limbs.");
        return;
      }
      setSneak(!P.sneaking);
      if (P.sneaking) tipOnce("sneak", "Sneaking: creatures notice you much closer. Your first attack is an ambush.", 4.5);
      return;
    }
    const info = ABILITY_INFO[kind],
      lvl = P.abilities[kind];
    if (!lvl) {
      nope(kind);
      tipOnce("noPart", "Greyed-out moves need a part. Add one in the editor when you mate.");
      return;
    }
    if ((P.cooldowns[kind] || 0) > 0) return;
    let t = usable(P.target) ? P.target : pickTarget(info.kind === "social");
    if (t) select(t);
    if (info.kind === "combat" && t && (t.family || t.member?.friend)) {
      // You don't attack your own kind or your friends.
      nope(kind);
      return pop(t, "💚", "bad");
    }
    if (info.kind === "social" && t?.family) {
      if (distTo(t) > rangeFor(kind, t)) {
        P.pending = { kind, t };
        return;
      }
      P.cooldowns[kind] = COOLDOWN[kind];
      act(P, kind);
      act(t, kind);
      if (brainReady && nearNest()) return callMate();
      if (packMembers().length < PACK_SIZE[P.brain]) {
        t.following = true;
        pop(t, "🐾", "good");
        o.sfx("unlock");
      } else {
        nope(kind);
        pop(t, "✖", "bad");
      }
      return;
    }
    if (info.kind === "social" && (!t || !canSocialise(t))) {
      // Nobody to impress: you still perform it (as in Spore), it just doesn't count for anything.
      showOff(kind);
      if (t) pop(t, t.member?.friend ? "💚" : "✖", "bad");
      return;
    }
    if (t && distTo(t) > rangeFor(kind, t)) {
      // Click-to-act: walk up to the target and do it when in range.
      P.pending = { kind, t };
      return;
    }
    perform(kind, t);
  }

  /** A social move performed for no one. */
  function showOff(kind) {
    P.cooldowns[kind] = COOLDOWN[kind];
    if (P.sneaking) setSneak(false);
    act(P, kind);
    voice(P, kind);
  }
  function perform(kind, t) {
    const info = ABILITY_INFO[kind],
      lvl = P.abilities[kind];
    if (!lvl || (P.cooldowns[kind] || 0) > 0) return;
    P.cooldowns[kind] = COOLDOWN[kind];
    if (t) P.heading = Math.atan2(-(t.pos.z - P.pos.z), t.pos.x - P.pos.x);
    act(P, kind);
    voice(P, kind);
    if (info.kind === "combat") {
      P.aggro = 12;
      if (t && t.social) endEncounter(t.social);
      // Out of hiding: the first blow lands much harder, and you are seen.
      const ambush = P.sneaking ? 1.5 + 0.1 * P.abilities.sneak : 1;
      if (P.sneaking) setSneak(false);
      if (kind === "spit") {
        if (!t) return nope(kind);
        const m = new THREE.Mesh(spitGeo, spitMat);
        m.position.copy(P.pos).setY(P.pos.y + 1.5 * P.scale);
        scene.add(m);
        projectiles.push({ mesh: m, target: t, damage: (6 + lvl * 7) * ambush, life: 2, ambush: ambush > 1 });
        return;
      }
      if (kind === "charge") {
        charging = 0.45;
        P.chargeDamage = (12 + lvl * 10) * ambush;
        P.chargeAmbush = ambush > 1;
        P.chargeHit = new Set();
        return;
      }
      if (t && distTo(t) < reach(t) + 1.2) {
        const dmg = (kind === "bite" ? 10 + lvl * 8 : 8 + lvl * 7) * ambush;
        if (ambush > 1) ambushHit(t);
        damageNPC(t, dmg, kind === "strike" ? 0.5 : ambush > 1 ? 0.6 : 0);
      }
      return;
    }
    if (P.sneaking) setSneak(false); // showing off means being seen
    // Social encounter: the creature shows a move; answer with the same move at its level or better.
    if (t.nest.angry > 0 || (t.species.temper === "hostile" && t.calm <= 0)) {
      pop(t, "💢", "bad");
      tipOnce("hostile", "Angry creatures won't watch you show off. Calm them, or fight.");
      return;
    }
    if (t.nest.snub > 0) {
      pop(t, "💤");
      return;
    }
    if (!t.social) {
      // Opening move: always welcome. Like Spore, the whole group nearby joins one encounter with one
      // shared meter; the leader shows the moves it wants to see.
      // If the nest's alpha is close it leads, and winning it over wins the whole nest.
      const enc = { progress: 0.2, request: null, timer: ASK_TIME, misses: 0, leader: t, nest: t.nest, alpha: false };
      for (const n of npcs) if (n.nest === t.nest && usable(n) && !n.member?.friend && Math.hypot(n.pos.x - t.pos.x, n.pos.z - t.pos.z) < 22) n.social = enc;
      t.social = enc;
      const alpha = [...npcs].find((n) => n.social === enc && n.alpha);
      if (alpha) {
        enc.leader = alpha;
        enc.alpha = true;
      }
      enc.request = nextRequest(enc.leader);
      activeEnc = enc;
      arcState.win = 0;
      act(enc.leader, enc.request);
      setTimeout(() => voice(enc.leader, enc.request), 400);
      [...npcs].filter((n) => n.social === enc).forEach((n) => pop(n, "❓"));
      tipOnce("encounter", "Copy the move shown above their face to fill the meter.");
      return;
    }
    const need = socialNeed(t.species, t.social.request);
    if (kind === t.social.request) {
      const allies = packMembers().length;
      const gain = lvl >= need ? 0.22 + 0.06 * (lvl - need) + allies * 0.04 : 0.06;
      t.social.progress = Math.min(1, t.social.progress + gain);
      bumpArc(lvl >= need ? "good" : "weak");
      // A strong move gets a big golden pop; a weak one only a faint one, and barely moves the meter.
      pop(t, ABILITY_INFO[kind].icon, lvl >= need ? "good" : "weak");
      if (t.social.progress >= 1) {
        const enc = t.social;
        const group = [...npcs].filter((n) => n.social === enc);
        // Win the alpha and the whole nest follows its lead, even members out of sight; otherwise
        // only the group you performed for (and those away from the nest, who hear about it).
        enc.nest.members.forEach((m) => {
          if (!m.alive) return;
          if (!m.npc) m.friend = true;
          else if (enc.alpha && !group.includes(m.npc) && !m.npc.dead) group.push(m.npc);
        });
        o.sfx("friend");
        arcState.win = 1.6;
        arcState.winEnc = enc;
        activeEnc = null;
        group.forEach((n) => befriend(n, true));
        group.forEach((n) => {
          pop(n, "💚", "good");
          setTimeout(() => pop(n, "💚", "good"), 250);
        });
      } else {
        const enc = t.social;
        enc.request = nextRequest(enc.leader);
        enc.timer = ASK_TIME;
        [...npcs].filter((n) => n.social === enc).forEach((n) => act(n, enc.request));
        setTimeout(() => enc.leader.social === enc && voice(enc.leader, enc.request), 350);
      }
    } else missSocial(t, "wrong");
  }
  const ASK_TIME = 4.5; // seconds to answer a requested move
  /** The encounter you are in, shown on the arc at the top of the screen. */
  let activeEnc = null;
  const arcState = { sour: 0, win: 0, winEnc: null, rel: null };
  function endEncounter(enc) {
    for (const n of npcs) if (n.social === enc) n.social = null;
    if (activeEnc === enc) activeEnc = null;
  }
  /** The arc jumps when a move lands, and shakes when one misses. */
  function bumpArc(kind) {
    const el = $h("#chArc");
    el.classList.remove("good", "weak", "miss");
    void el.offsetWidth;
    el.classList.add(kind);
  }
  /** A wrong or late move knocks the meter back and sours the face; an empty meter ends it. */
  function missSocial(t, why) {
    const enc = t.social;
    enc.progress = Math.max(0, enc.progress - (why === "slow" ? 0.1 : 0.12));
    enc.misses++;
    arcState.sour = 1;
    bumpArc("miss");
    if (enc.progress <= 0) {
      endEncounter(enc);
      enc.nest.snub = 20;
      [...npcs].filter((n) => n.nest === enc.nest).forEach((n) => pop(n, "💤"));
      o.sfx("snub");
    } else pop(enc.leader, why === "slow" ? "⌛" : "✖", "bad");
  }
  const nextRequest = (t) => {
    const fav = t.species.favourite;
    return fav[Math.floor(Math.random() * fav.length)];
  };
  const distTo = (n) => Math.hypot(n.pos.x - P.pos.x, n.pos.z - P.pos.z);

  function useCard() {
    if (P.cardCooldown > 0) return;
    P.cardCooldown = 30;
    act(P, "sing");
    o.sfx("mate");
    const near = [...npcs].filter((n) => !n.dead && distTo(n) < 16 && !n.following);
    if (o.cellCard === "carnivore") {
      near.forEach((n) => {
        n.stun = 4;
        pop(n, "💫");
      });
      pop(P, "🦁", "good");
    } else if (o.cellCard === "herbivore") {
      near.forEach((n) => {
        n.calm = 20;
        if (n.nest) n.nest.angry = 0;
        if (n.social) n.social.progress = Math.min(0.95, n.social.progress + 0.3);
      });
      near.forEach((n) => pop(n, "🎶", "good"));
      pop(P, "🌿", "good");
    } else {
      for (let i = 0; i < 3; i++) {
        const helper = spawnNPC(
          { ...SWARM_SPECIES(), scale: P.scale * 0.6 },
          P.pos.x + (Math.random() - 0.5) * 4,
          P.pos.z + (Math.random() - 0.5) * 4,
          { following: true, temporary: 20 },
        );
        helper.health = 60;
      }
      pop(P, "✧", "good");
    }
  }
  const SWARM_SPECIES = () => ({ name: P.record.name, record: P.record, abilities: P.abilities, favourite: ["sing"], maxHealth: 60, diet: P.diet, temper: "friendly", ring: 1 });

  function ambushHit(n) {
    o.sfx("ambush");
    pop(n, "💥", "good");
    tipOnce("ambush", "Ambush! Attacks from hiding hit much harder.");
  }
  function damageNPC(n, dmg, stun = 0) {
    if (n.dead) return;
    // A nest whose alpha has fallen has lost its nerve and goes down easier.
    if (n.nest?.cowed > 0) dmg *= 1.5;
    n.health -= dmg;
    n.hurtAt = timeUniform.value;
    n.body.hit();
    n.stun = Math.max(n.stun, stun);
    if (n.social) endEncounter(n.social);
    // Badly hurt creatures think twice: many turn tail (once per fight), raiders for good.
    if (n.health > 0 && !n.fleeChecked && !n.member?.friend && n.health < n.maxHealth * (n.rogue ? 0.2 : 0.38)) {
      n.fleeChecked = true;
      if (Math.random() > n.brave) {
        if (n.raider) n.retreat = 6;
        else n.fleeT = 4 + Math.random() * 2.5;
        n.hunting = false;
        pop(n, "😨", "bad");
      }
    }
    if (n.nest && n.nest.status === "neutral" && !(n.nest.cowed > 0)) n.nest.angry = 40; // the whole nest turns on you
    if (n.member?.friend) return;
    if (n.health <= 0) killNPC(n);
  }
  function killNPC(n) {
    n.dead = true;
    n.hunting = false;
    n.body.die();
    o.sfx("death");
    dropCarcass(n.pos.x, n.pos.z, Math.max(2, Math.round(n.scale * 2)));
    const tough = n.epic ? 120 : n.rogue ? 60 : n.alpha ? 24 + n.species.ring * 6 : 8 + n.species.ring * 4;
    gainXp(tough, true);
    P.dna += n.epic ? 30 : n.rogue ? 16 : 3 + n.species.ring + (n.alpha ? 3 : 0);
    treat(n.species, "kills");
    if (n.member) {
      n.member.alive = false;
      n.member.npc = null;
      const nest = n.nest;
      if (n.alpha && nest.members.some((m) => m.alive)) {
        // The leader is down: the rest of the nest cowers and flees from you for a while.
        nest.cowed = 60;
        nest.angry = 0;
        [...npcs].filter((m) => m.nest === nest && !m.dead).forEach((m) => {
          m.hunting = false;
          pop(m, "😨", "bad");
        });
        tipOnce("alpha", "You beat the alpha! Its nest has lost its nerve.");
      }
      if (nest.members.every((m) => !m.alive) && nest.status !== "extinct") {
        nest.status = "extinct";
        P.extinctions++;
        gainXp(30 + nest.species.ring * 10, true);
        unlockFromSpecies(nest.species, "Taken from the extinct " + nest.species.name);
        toast(nest.species.name + " are extinct", 3.5);
      }
    }
    if (n.epic) {
      n.epic.alive = false;
      n.epic.npc = null;
      unlockFromSpecies(n.species, "Taken from the " + n.species.name);
      toast("You brought down the " + n.species.name + "!", 4);
    }
    if (n.rogue) {
      n.rogue.alive = false;
      n.rogue.npc = null;
      // A rogue always gives up the rare part it carries (or DNA if you have it already).
      const rare = n.species.rare;
      if (rare && !unlockedParts().has(rare)) {
        P.unlocked.add(rare);
        o.onUnlock?.(creaturePart(rare), "Taken from the " + n.species.name);
      } else P.dna += 15;
      toast("You beat the " + n.species.name + "!", 3.5);
    }
    setTimeout(() => despawnNPC(n), 2500);
    saveState();
  }
  function befriend(n, quiet = false) {
    n.member.friend = true;
    n.social = null;
    n.hunting = false;
    treat(n.species, "friends");
    if (!quiet) o.sfx("mate");
    gainXp(10 + n.species.ring * 4, true);
    P.dna += 2 + n.species.ring;
    const nest = n.nest;
    if (nest.members.filter((m) => m.alive).every((m) => m.friend) && nest.status !== "allied") {
      nest.status = "allied";
      P.alliances++;
      gainXp(30 + nest.species.ring * 10, true);
      unlockFromSpecies(nest.species, "A gift from your allies, the " + nest.species.name);
      toast("The " + nest.species.name + " are now your allies", 3.5);
    } else if (!quiet) pop(n, "💚", "good");
    // Join the pack if there is room.
    if (packMembers().length < PACK_SIZE[P.brain]) {
      n.following = true;
      setTimeout(() => usable(n) || n.following ? pop(n, "🐾", "good") : null, 500);
    }
    saveState();
  }
  const packMembers = () => [...npcs].filter((n) => n.following && !n.temporary && !n.dead);
  function unlockFromSpecies(species, source) {
    const owned = unlockedParts();
    const ids = creaturePartIds(species.record).filter((id) => !owned.has(id));
    if (!ids.length) {
      P.dna += 10;
      return;
    }
    const id = ids[Math.floor(Math.random() * ids.length)];
    P.unlocked.add(id);
    o.onUnlock?.(creaturePart(id), source);
  }

  /* ---- progression ----------------------------------------------------- */
  let brainReady = false;
  function gainXp(amount) {
    if (P.brain >= 5) return;
    P.xp = Math.min(XP_TO_NEXT[P.brain], P.xp + amount);
    if (P.xp >= XP_TO_NEXT[P.brain] && !brainReady) {
      brainReady = true;
      o.sfx("mate");
      pop(P, "🧠", "good");
      toast("Brain ready: return to your nest to mate", 4);
    }
  }
  function mate() {
    if (!brainReady) return;
    brainReady = false;
    P.xp = 0;
    P.brain = Math.min(5, P.brain + 1);
    P.health = P.maxHealth;
    P.hunger = 100;
    o.sfx("mate");
    recordGeneration();
    evolveIsland();
    migrateNests(1 + Math.floor(Math.random() * 2));
    // Grow, then design the next generation.
    o.onMate({ record: P.record, unlocked: unlockedParts(), dna: P.dna, brain: P.brain });
    if (P.brain >= 5 && !P.card) {
      P.card = creatureCard(P.alliances, P.extinctions);
      o.onCard(P.card);
    }
    saveState();
  }
  /** As your species evolves, so does everyone else's: every surviving nest gains a part and grows. */
  function evolveIsland() {
    let count = 0;
    for (const nest of nests) {
      if (nest.status === "extinct") continue;
      nest.species = evolveSpecies(nest.species);
      nest.evo++;
      count++;
      // Rebuild the live members in their new form (pack members keep following in theirs).
      nest.members.forEach((m, k) => {
        if (m.npc && !m.npc.following) {
          const { x, z } = m.npc.pos;
          despawnNPC(m.npc);
          m.npc = spawnNPC(nest.species, x, z, { nest, member: m, alpha: k === 0 });
        }
      });
    }
    if (count) tipOnce("evolve", "The island evolves with you: other species grow new parts too.", 4);
  }
  /** Spore's migrating herds: a neutral nest packs up and moves somewhere new in its ring. */
  function migrateNests(howMany) {
    const movable = nests.filter((n) => n.status === "neutral" && n.angry <= 0 && !n.members.some((m) => m.npc?.social));
    for (let k = 0; k < howMany && movable.length; k++) {
      const nest = movable.splice(Math.floor(Math.random() * movable.length), 1)[0];
      const spot = freeNestSpot(nest.site.ring || ringAt(nest.site.x, nest.site.z), nest);
      if (!spot) continue;
      nest.site = { x: spot.x, z: spot.z, ring: nest.site.ring };
      nest.mesh.position.set(spot.x, heightAt(spot.x, spot.z) + 0.2, spot.z);
      nest.migrating = 45;
    }
    saveState();
  }
  const RING_BAND = [null, [158, 195], [116, 146], [76, 106], [40, 66], [16, 30]];
  function freeNestSpot(ring, self) {
    const [lo, hi] = RING_BAND[ring] || RING_BAND[1];
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * TAU,
        d = lo + Math.random() * (hi - lo);
      const x = Math.cos(a) * d,
        z = Math.sin(a) * d;
      if (Math.hypot(x - ISLAND.nest.x, z - ISLAND.nest.z) < 32 || Math.hypot(x - P.pos.x, z - P.pos.z) < 25) continue;
      if (nests.some((n) => n !== self && Math.hypot(n.site.x - x, n.site.z - z) < 28)) continue;
      const res = world.resolve(x, z, 3);
      if (Math.hypot(res.x - x, res.z - z) > 0.5) continue;
      return { x, z };
    }
    return null;
  }
  function recordGeneration() {
    o.onGeneration({
      stage: "creature",
      brain: P.brain,
      alliances: P.alliances - P.genStart.alliances,
      extinctions: P.extinctions - P.genStart.extinctions,
      deaths: P.deaths - P.genStart.deaths,
      record: P.record,
      diet: P.diet,
      parts: P.record.parts.length + P.record.legs.length * 2,
    });
    P.genStart = { alliances: P.alliances, extinctions: P.extinctions, deaths: P.deaths };
  }
  function die(reason) {
    setSneak(false);
    setSprint(false);
    P.air = null;
    P.body.setAir(null);
    P.deaths++;
    P.deadTimer = 2.2;
    P.body.die();
    o.sfx("death");
    toast(reason || "You died", 2.5);
    packMembers().forEach((n) => (n.following = false)); // the pack scatters
    P.xp = Math.max(0, P.xp - XP_TO_NEXT[Math.min(4, P.brain)] * 0.25);
  }
  function respawn() {
    rebuildPlayer();
    P.pos.set(ISLAND.nest.x, 0, ISLAND.nest.z - 13);
    P.health = P.maxHealth * 0.6;
    P.hunger = 60;
    P.invulnerable = 3;
    P.target = null;
    saveState();
  }

  /* ---- saving ---------------------------------------------------------- */
  function snapshot() {
    return {
      seed: seedBase,
      record: P.record,
      brain: P.brain,
      xp: P.xp,
      dna: P.dna,
      hunger: P.hunger,
      health: P.health,
      unlocked: [...P.unlocked],
      alliances: P.alliances,
      extinctions: P.extinctions,
      deaths: P.deaths,
      card: P.card,
      pos: { x: P.pos.x, z: P.pos.z },
      heading: P.heading,
      genStart: P.genStart,
      bonesTaken: [...P.bonesTaken],
      rogues: rogues.map((r) => r.alive),
      treated: P.treated,
      nests: nests.map((n) => ({ status: n.status, evo: n.evo, site: { x: n.site.x, z: n.site.z }, members: n.members.map((m) => ({ alive: m.alive, friend: m.friend })) })),
      discovered: [...P.discovered],
      tips: [...seenTips],
      epics: epics.map((e) => e.alive),
    };
  }
  function saveState() {
    try {
      localStorage.setItem(CREATURE_SAVE_KEY, JSON.stringify(snapshot()));
      o.onSaved?.();
    } catch (e) {
      /* storage unavailable */
    }
  }
  world.bonePiles.forEach((b, i) => {
    if (P.bonesTaken.has(i)) {
      world.markDug(b);
    }
  });

  /* ---- input: tap a creature to target it ------------------------------------- */
  const canvas = o.renderer.domElement;
  let downAt = null;
  /* Spore-style camera: drag to orbit round your creature (right half of the screen on touch, any
     drag with a mouse), pinch or scroll to zoom. It drifts back behind you once you walk off. */
  const view = { zoom: 1, pitch: 0, lastManual: -99, drag: null, pinch: null, touches: new Map() };
  const onDown = (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    if (paused || intro) return;
    if (e.pointerType !== "mouse" && e.clientX < innerWidth * 0.5) return; // the joystick side
    view.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (view.touches.size === 2) {
      const [a, b] = [...view.touches.values()];
      view.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
      view.drag = null;
    } else view.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onMove = (e) => {
    if (!view.touches.has(e.pointerId)) return;
    view.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (view.pinch && view.touches.size >= 2) {
      const [a, b] = [...view.touches.values()];
      view.zoom = THREE.MathUtils.clamp((view.pinch.zoom * view.pinch.d) / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 0.55, 1.9);
    } else if (view.drag && view.drag.id === e.pointerId) {
      const dx = e.clientX - view.drag.x,
        dy = e.clientY - view.drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      camYaw -= dx * 0.008;
      view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, -0.35, 0.7);
      view.lastManual = performance.now();
      view.drag.x = e.clientX;
      view.drag.y = e.clientY;
    }
  };
  const onRelease = (e) => {
    view.touches.delete(e.pointerId);
    if (view.touches.size < 2) view.pinch = null;
    if (view.drag?.id === e.pointerId) view.drag = null;
  };
  const onWheel = (e) => {
    if (paused || intro) return;
    e.preventDefault();
    view.zoom = THREE.MathUtils.clamp(view.zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.55, 1.9);
  };
  const onUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const roots = [...npcs].filter(usable).map((n) => n.body.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    let picked = null;
    if (hit)
      for (const n of npcs) {
        let obj = hit.object;
        while (obj && obj !== n.body.root) obj = obj.parent;
        if (obj) picked = n;
      }
    if (!picked) {
      // Fingers are fat: take the creature whose screen position is nearest the tap.
      let best = 48;
      for (const n of npcs) {
        if (!usable(n)) continue;
        const pt = project(tmp.set(n.pos.x, n.pos.y + n.body.height * n.scale * 0.5, n.pos.z));
        const d = Math.hypot(pt.x - (e.clientX - r.left), pt.y - (e.clientY - r.top));
        if (!pt.behind && d < best) {
          best = d;
          picked = n;
        }
      }
    }
    if (picked) select(picked);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  ["pointerup", "pointercancel"].forEach((ev) => canvas.addEventListener(ev, onRelease));
  const onKey = (e) => {
    if (paused || intro) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const i = ["1", "2", "3", "4", "5", "6", "7", "8"].indexOf(e.key);
    if (e.key === "Shift") {
      P.sprintHeld = true;
      setSprint(true);
      return;
    }
    if (e.repeat) return;
    if (i >= 0) useAbility([...COMBAT, ...SOCIAL][i]);
    else if (e.key === " ") {
      e.preventDefault();
      jump();
    } else if (e.key === "c" || e.key === "C") useAbility("sneak");
    else if (e.key === "q" || e.key === "Q") useAbility("card");
    else if ((e.key === "m" || e.key === "M") && nearNest()) callMate();
    else if (e.key === "Escape") {
      P.target = null;
      P.pending = null;
    } else if (e.key === "Tab") {
      e.preventDefault();
      selectNext();
    }
  };
  const onKeyUp = (e) => {
    if (e.key !== "Shift") return;
    P.sprintHeld = false;
    setSprint(false);
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  const nearNest = () => Math.hypot(P.pos.x - ISLAND.nest.x, P.pos.z - ISLAND.nest.z) < 14;
  $h("#chMate").onclick = callMate;
  $h("#chTargetClose").onclick = () => {
    P.target = null;
    P.pending = null;
  };
  $h("#chHistory").onclick = () => o.onHistory();
  $h("#chTribe").onclick = () => {
    $h("#chMenuPanel").hidden = true;
    o.onTribe?.();
  };
  $h("#chSettings").onclick = () => {
    $h("#chMenuPanel").hidden = true;
    o.onSettings?.();
  };
  $h("#chMenu").onclick = () => ($h("#chMenuPanel").hidden = !$h("#chMenuPanel").hidden);
  $h("#chResume").onclick = () => ($h("#chMenuPanel").hidden = true);
  $h("#chSoup").onclick = () => {
    saveState();
    o.onExit();
  };
  renderAbilityButtons();

  const playerNest = world.makeNestMesh(ISLAND.nest.x, ISLAND.nest.z, P.record.colors.accent);
  playerNest.scale.setScalar(1.3);

  /* ---- per-frame --------------------------------------------------------- */
  const camPos = new THREE.Vector3();
  let camYaw = P.heading,
    streamClock = 0,
    hudClock = 0,
    saveClock = 20,
    migrateClock = 150 + Math.random() * 90,
    paused = false;
  camPos.set(P.pos.x - Math.cos(camYaw) * 12, heightAt(P.pos.x, P.pos.z) + 9, P.pos.z + Math.sin(camYaw) * 12);
  const tmp = new THREE.Vector3();

  /* ---- crawl-out cinematic -------------------------------------------------
     The new creature wades out of the surf onto the beach below its nest while the camera swings
     from in front of it, low over the water, round to its usual place behind. Tap to skip. */
  const INTRO_TIME = 7.5;
  let intro = null;
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xeef9ff, transparent: true, opacity: 0.75 });
  if (o.intro) {
    P.pos.set(ISLAND.nest.x, 0, ISLAND.shore + 17);
    P.heading = Math.PI / 2; // facing inland (-z)
    intro = { t: 0, splash: 0, overlay: document.createElement("div") };
    const card = { carnivore: ["🦁", "#ef4b48", "Carnivore"], herbivore: ["🌿", "#3fc26e", "Herbivore"], omnivore: ["✧", "#3f9cf0", "Omnivore"] }[o.cellCard || "omnivore"];
    intro.overlay.className = "stageIntro";
    intro.overlay.innerHTML = `<i class="lbTop"></i><i class="lbBottom"></i>
      <div class="siTitle"><small>Creature Stage</small><b></b><span class="siTrait" style="--c:${card[1]}">${card[0]} ${card[2]} ancestry</span></div>
      <button class="siSkip">Skip ▸</button>`;
    intro.overlay.querySelector("b").textContent = P.record.name;
    document.body.appendChild(intro.overlay);
    hud.classList.add("intro");
    const skip = () => (intro ? (intro.t = INTRO_TIME) : null);
    intro.overlay.querySelector(".siSkip").onclick = skip;
    intro.overlay.addEventListener("pointerdown", (e) => e.target === intro?.overlay && skip());
    requestAnimationFrame(() => intro?.overlay.classList.add("show"));
  }
  function updateIntro(dt) {
    intro.t += dt;
    const k = Math.min(1, intro.t / INTRO_TIME);
    // Wade in: slow through the surf, quicker once on sand.
    const ground = heightAt(P.pos.x, P.pos.z);
    P.speed = ground < 0 ? 2.2 : 3.4;
    if (k < 0.9) P.pos.z -= P.speed * dt;
    else P.speed *= 0.5;
    P.pos.y = Math.max(ground, -0.4);
    P.body.root.position.copy(P.pos);
    P.body.root.rotation.y = P.heading;
    P.body.update(dt, P.speed);
    if (ground < 0.1 && (intro.splash -= dt) <= 0) {
      intro.splash = 0.18;
      dust(P.pos.x + (Math.random() - 0.5) * 1.5, P.pos.z + (Math.random() - 0.5) * 1.5, 3, splashMat);
    }
    // Camera: from low in front, over the shoulder, to behind and above.
    const ease = k * k * (3 - 2 * k);
    const ang = Math.PI * 0.85 * (1 - ease); // three-quarter front view, swinging round to behind
    // Portrait phones need the camera further back to fit the creature and the shoreline.
    const dist = (7 + ease * (5 + P.scale * 2.5)) * Math.max(1, 0.8 / camera.aspect);
    const yaw = P.heading + ang;
    tmp.set(P.pos.x - Math.cos(yaw) * dist, P.pos.y + 1.2 + ease * 6, P.pos.z + Math.sin(yaw) * dist);
    camPos.copy(tmp);
    camera.position.copy(camPos);
    camera.lookAt(P.pos.x, P.pos.y + 1.3 * P.scale, P.pos.z);
    camYaw = P.heading;
    if (intro.t > 1.2) intro.overlay.classList.add("titled");
    if (intro.t > INTRO_TIME - 1.4) intro.overlay.classList.remove("titled");
    if (intro.t >= INTRO_TIME) endIntro();
  }
  function endIntro() {
    if (!intro) return;
    const el = intro.overlay;
    el.classList.remove("show", "titled");
    setTimeout(() => el.remove(), 700);
    intro = null;
    hud.classList.remove("intro");
    saveState();
    o.onIntroDone?.();
  }

  function updatePlayer(dt) {
    if (courtship) {
      updateCourtship(dt);
      P.body.root.position.copy(P.pos);
      P.body.root.rotation.y = P.heading;
      P.body.update(dt, 0);
      return;
    }
    if (P.deadTimer > 0) {
      P.deadTimer -= dt;
      P.body.update(dt, 0);
      if (P.deadTimer <= 0) respawn();
      return;
    }
    const input = o.getInput();
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    updateStamina(dt, mag);
    const pace = P.sneaking ? 0.5 : P.sprinting && mag > 0.12 ? 1.5 + 0.08 * P.abilities.speed : 1;
    const baseSpeed = (4.5 + P.abilities.speed * 0.9) * pace * (P.air?.mode === "glide" ? 1.2 : 1);
    if (charging > 0) {
      charging -= dt;
      P.speed = baseSpeed * 3;
      if (P.target && !P.target.dead) P.heading = Math.atan2(-(P.target.pos.z - P.pos.z), P.target.pos.x - P.pos.x);
    } else if (P.pending && mag <= 0.12) {
      // Walking up to the target to use the chosen move.
      const { kind, t } = P.pending;
      if (!usable(t)) P.pending = null;
      else if (distTo(t) <= rangeFor(kind, t)) {
        P.pending = null;
        if (t.family) useAbility(kind);
        else perform(kind, t);
      } else {
        const want = Math.atan2(-(t.pos.z - P.pos.z), t.pos.x - P.pos.x);
        const delta = THREE.MathUtils.euclideanModulo(want - P.heading + Math.PI, TAU) - Math.PI;
        P.heading += THREE.MathUtils.clamp(delta * 7 * dt, -4 * dt, 4 * dt);
        P.speed += (baseSpeed * Math.max(0.3, Math.cos(delta)) - P.speed) * Math.min(1, dt * 6);
      }
    } else if (mag > 0.12) {
      P.pending = null; // taking control cancels the walk-up
      // Camera-relative: up on the stick walks away from the camera.
      const fx = Math.cos(camYaw),
        fz = -Math.sin(camYaw);
      const mx = fx * input.y - fz * input.x,
        mz = fz * input.y + fx * input.x;
      const want = Math.atan2(-mz, mx);
      const delta = THREE.MathUtils.euclideanModulo(want - P.heading + Math.PI, TAU) - Math.PI;
      P.heading += THREE.MathUtils.clamp(delta * 7 * dt, -4 * dt, 4 * dt);
      P.speed += (mag * baseSpeed * Math.max(0.3, Math.cos(delta)) - P.speed) * Math.min(1, dt * 6);
    } else P.speed += (0 - P.speed) * Math.min(1, dt * 7);
    let nx = P.pos.x + Math.cos(P.heading) * P.speed * dt,
      nz = P.pos.z - Math.sin(P.heading) * P.speed * dt;
    ({ x: nx, z: nz } = world.resolve(nx, nz, 0.8 * P.scale));
    P.pos.x = nx;
    P.pos.z = nz;
    const ground = heightAt(P.pos.x, P.pos.z);
    // No walls: the sea is open. Wade in the shallows, swim (slowly) out of your depth.
    const swimming = ground < -0.9;
    const floor = swimming ? -0.75 + Math.sin(performance.now() * 0.004) * 0.08 : Math.max(ground, -0.4);
    updateAir(dt, swimming);
    P.pos.y = floor + (P.air ? P.air.h : 0);
    if (ground < 0 && !P.air) P.speed *= 1 - dt * (swimming ? 2.2 : 1.5);
    if (swimming && P.sneaking) setSneak(false);
    updateDeepWater(dt, ground);
    P.body.root.position.copy(P.pos);
    P.body.root.rotation.y = P.heading;
    P.body.update(dt, P.speed);
    // Footsteps (or splashes) in time with the stride; sneaking steps are barely audible.
    if (!P.air && P.speed > 0.8 && (stepClock -= dt * (1 + P.speed * 0.25)) <= 0) {
      stepClock = 0.42;
      o.sfx(ground < 0 ? "splash" : "step", { pitch: 1 / Math.sqrt(P.scale), gain: (ground < 0 ? 0.4 : 1) * (P.sneaking ? 0.3 : 1) });
    }

    // Charge contact damage.
    if (charging > 0)
      for (const n of npcs)
        if (!n.dead && !n.following && !P.chargeHit.has(n) && distTo(n) < reach(n) + 0.5) {
          P.chargeHit.add(n);
          if (P.chargeAmbush) ambushHit(n);
          P.chargeAmbush = false;
          damageNPC(n, P.chargeDamage, 0.8);
        }

    // Eating: fruit for plant eaters, carcasses for meat eaters, both for omnivores.
    const mouth = tmp.copy(P.body.mouthLocal).multiplyScalar(P.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), P.heading).add(P.pos);
    if (P.diet !== "meat")
      for (const f of world.fruits)
        if (f.alive && Math.abs(f.x - mouth.x) < 1.6 && Math.abs(f.z - mouth.z) < 1.6) {
          f.alive = false;
          f.regrow = 40;
          world.syncFruit();
          eat(16, 4, 3);
        }
    if (P.diet !== "plant")
      for (let i = carcasses.length - 1; i >= 0; i--) {
        const c = carcasses[i];
        if (Math.hypot(c.x - mouth.x, c.z - mouth.z) < 2) {
          c.bites--;
          eat(28, 8, 5);
          c.mesh.scale.multiplyScalar(0.8);
          if (c.bites <= 0) removeCarcass(i);
          break;
        }
      }

    // Fossils: stand on one and your creature digs; dust flies, then the skeleton gives up a part.
    let digging = null;
    for (const b of world.bonePiles) {
      if (b.taken) continue;
      const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
      if (d < 2.6 + P.scale && P.speed < 2.2 && !charging && !P.air) digging = b;
      else b.dig = Math.max(0, b.dig - dt * 0.5);
      if (d < 22 && !b.seen) {
        b.seen = true;
        tipOnce("fossil", "A fossil! Stand on it to dig up a new part.");
      }
    }
    if (digging) {
      const b = digging;
      b.dig += dt / DIG_TIME;
      digDust -= dt;
      if (digDust <= 0) {
        digDust = 0.28;
        act(P, "bite");
        o.sfx("dig");
        dust(b.x + (Math.random() - 0.5) * 2, b.z + (Math.random() - 0.5) * 2, 4);
      }
      b.bones.position.y = b.dig * 0.45; // the skeleton rises as you uncover it
      b.mound.scale.y = 1 - b.dig * 0.6;
      if (b.dig >= 1) digUp(b);
    }
    digRing.visible = !!digging;
    if (digging) {
      digRing.position.set(digging.x, heightAt(digging.x, digging.z) + 0.15, digging.z);
      digRing.geometry.dispose();
      digRing.geometry = new THREE.RingGeometry(2.4, 2.65, 48, 1, Math.PI / 2, -TAU * Math.min(1, digging.dig)).rotateX(-Math.PI / 2);
    }

    // Hunger, and the nest heals.
    P.hunger = Math.max(0, P.hunger - dt * 0.42);
    if (P.hunger <= 0) hurtPlayer(dt * 2.5, "You starved", true);
    if (nearNest() && P.hunger > 0) P.health = Math.min(P.maxHealth, P.health + dt * 4);
    else if (P.hunger > 30 && performance.now() - P.lastHurt > 6000) P.health = Math.min(P.maxHealth, P.health + dt * 1.2); // slow regen out of a fight
    P.invulnerable = Math.max(0, P.invulnerable - dt);
    P.aggro = Math.max(0, P.aggro - dt);
    P.cardCooldown = Math.max(0, P.cardCooldown - dt);
    for (const k in P.cooldowns) P.cooldowns[k] = Math.max(0, P.cooldowns[k] - dt);
  }
  /** Sneaking and sprinting burn stamina; it refills shortly after you stop. */
  function updateStamina(dt, mag) {
    const drain = P.sneaking ? 9 - P.abilities.sneak : P.sprinting && mag > 0.12 ? 20 : 0;
    if (drain > 0) {
      P.stamina = Math.max(0, P.stamina - drain * dt);
      P.staminaRest = 0.8;
      if (P.stamina <= 0) {
        setSneak(false);
        setSprint(false);
        nope("sprint");
      }
    } else if ((P.staminaRest -= dt) <= 0) P.stamina = Math.min(100, P.stamina + 14 * dt);
  }
  /** Jumping and gliding: a simple ballistic arc; wings slow the fall to a gentle descent. */
  function updateAir(dt, swimming) {
    const a = P.air;
    if (!a) return;
    const gliding = a.mode === "glide";
    a.vy -= (gliding ? 3 : 18) * dt;
    if (gliding) a.vy = Math.max(a.vy, -(3.2 - 0.3 * P.abilities.glide));
    a.h += a.vy * dt;
    if (a.h <= 0 || swimming) {
      P.air = null;
      P.body.setAir(null);
      dust(P.pos.x, P.pos.z, swimming ? 4 : 3, swimming ? splashMat : dustMat);
      o.sfx(swimming ? "splash" : "land", { pitch: 1 / Math.sqrt(P.scale) });
    }
  }
  const DIG_TIME = 2.4;
  let stepClock = 0;
  let digDust = 0;
  const digRing = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.65, 8), new THREE.MeshBasicMaterial({ color: 0xffe69a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  digRing.visible = false;
  scene.add(digRing);
  const dustGeo = new THREE.IcosahedronGeometry(0.25, 0);
  const dustMat = new THREE.MeshStandardMaterial({ color: 0xc9b07c, roughness: 1, transparent: true, opacity: 0.9, flatShading: true });
  const dusts = [];
  /** Little clods of sand kicked up by digging. */
  function dust(x, z, n, material = dustMat) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(dustGeo, material);
      m.position.set(x, Math.max(heightAt(x, z), 0.2) + 0.3, z);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4);
      m.userData.life = 0.9;
      m.scale.setScalar((0.5 + Math.random() * 0.8) * (material === dustMat ? 1 : 0.45));
      scene.add(m);
      dusts.push(m);
    }
  }
  function updateDust(dt) {
    for (let i = dusts.length - 1; i >= 0; i--) {
      const m = dusts[i];
      m.userData.life -= dt;
      m.userData.v.y -= 12 * dt;
      m.position.addScaledVector(m.userData.v, dt);
      m.rotation.x += dt * 5;
      if (m.userData.life <= 0) {
        scene.remove(m);
        dusts.splice(i, 1);
      }
    }
  }
  /** The skeleton gives up a part: a burst of sand, a sparkle, and the part card. */
  function digUp(b) {
    const i = world.bonePiles.indexOf(b);
    world.markDug(b);
    P.bonesTaken.add(i);
    dust(b.x, b.z, 18);
    o.sfx("unlock");
    pop(P, "🦴", "good");
    const owned = unlockedParts();
    const pool = CREATURE_PARTS.filter((p) => p.cost > 0 && !owned.has(p.id)).sort((a, z) => a.cost - z.cost);
    // Deeper rings hide better parts.
    const lo = Math.min(pool.length - 1, Math.floor(((b.ring - 1) / 5) * pool.length));
    const pick = pool.length ? pool[Math.min(pool.length - 1, lo + Math.floor(Math.random() * 6))] : null;
    gainXp(14);
    if (pick) {
      P.unlocked.add(pick.id);
      o.onUnlock?.(pick, "Dug from a fossil");
    } else {
      P.dna += 12;
      pop(P, "🧬", "good");
    }
    saveState();
  }
  /* ---- the deep -------------------------------------------------------------
     Spore's rule: swim too far out and something huge comes up from below and swallows you.
     First a dark shape gathers under you; turn back and it sinks away, stay and it strikes. */
  const DEEP = -3; // ground height that counts as deep water
  const MONSTER_DELAY = 3.2;
  let deepTime = 0,
    monster = null;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x041018, transparent: true, opacity: 0, depthWrite: false }));
  shadow.renderOrder = 2;
  scene.add(shadow);
  function buildSeaMonster() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.4, metalness: 0.1 });
    const belly = new THREE.MeshStandardMaterial({ color: 0x9bc4a0, roughness: 0.5 });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const gum = new THREE.MeshStandardMaterial({ color: 0x7a1e2c, roughness: 0.6 });
    const tooth = new THREE.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.3 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    const jaw = (upper) => {
      const j = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), upper ? skin : belly);
      shell.scale.set(1, 0.7, 1.35);
      if (!upper) shell.rotation.x = Math.PI;
      j.add(shell);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(3.8, 28).rotateX(upper ? Math.PI / 2 : -Math.PI / 2), gum);
      inside.scale.set(1, 1.35, 1);
      j.add(inside);
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 6), tooth);
        t.position.set(Math.cos(a) * 3.6, upper ? -0.6 : 0.6, Math.sin(a) * 3.6 * 1.35);
        if (upper) t.rotation.x = Math.PI;
        j.add(t);
      }
      if (upper)
        for (let i = 0; i < 6; i++) {
          // A ridge of dorsal spikes down the head.
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 6), skin);
          spike.position.set(-2.6 + i * 0.9, 2.6 - Math.abs(i - 2.5) * 0.25, 0);
          spike.rotation.z = 0.5;
          j.add(spike);
        }
      // Hinge at the back of the mouth, so the jaws open like jaws.
      j.children.forEach((c) => (c.position.x += 3.6));
      return j;
    };
    const upper = jaw(true),
      lower = jaw(false);
    g.add(upper, lower);
    for (const z of [-1.8, 1.8]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), eyeMat);
      eye.position.set(1.4, 2.3, z);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), pupilMat);
      pupil.scale.set(0.35, 1, 0.35);
      pupil.position.set(1.85, 2.35, z * 1.08);
      upper.add(eye, pupil);
    }
    g.userData = { upper, lower, t: 0, mats: [skin, belly, gum, tooth, eyeMat, pupilMat] };
    return g;
  }
  function updateDeepWater(dt, ground) {
    const deep = ground < DEEP && P.deadTimer <= 0;
    deepTime = deep ? deepTime + dt : Math.max(0, deepTime - dt * 1.5);
    const k = Math.min(1, deepTime / MONSTER_DELAY);
    shadow.visible = k > 0;
    shadow.position.set(P.pos.x + Math.cos(P.heading) * 1.5, 0.22, P.pos.z - Math.sin(P.heading) * 1.5);
    shadow.scale.setScalar(2 + k * 7);
    shadow.material.opacity = k * 0.75;
    if (deep && deepTime > 0.6 && !intro && Math.random() < dt * 2) pop(P, "⚠", "bad");
    if (deepTime >= MONSTER_DELAY && !monster) {
      monster = buildSeaMonster();
      // It faces the camera, so you see straight down its throat as it rises round you.
      const face = camYaw + Math.PI;
      monster.position.set(P.pos.x - Math.cos(face) * 3.6, -9, P.pos.z + Math.sin(face) * 3.6);
      monster.rotation.y = face;
      scene.add(monster);
      o.sfx("roar");
      setTimeout(() => o.sfx("splash"), 500);
      deepTime = 0;
    }
  }
  /** The monster rises with its jaws open, snaps shut around you, and sinks again. */
  function updateMonster(dt) {
    if (!monster) return;
    const m = monster.userData;
    m.t += dt;
    const rise = Math.min(1, m.t / 0.8);
    // Burst up out of the water mouth-first, jaws gaping, then snap shut and sink.
    monster.position.y = -9 + rise * 9.5 - Math.max(0, m.t - 2.2) * 6;
    const open = m.t < 1.1 ? Math.min(1, m.t / 0.5) : Math.max(0, 1 - (m.t - 1.1) / 0.18);
    m.upper.rotation.z = open * 1.15;
    m.lower.rotation.z = -open * 0.45;
    monster.rotation.z = rise * 0.25 * (m.t < 1.2 ? 1 : 0.4);
    if (m.t < 1.4 && Math.random() < dt * 30) dust(monster.position.x + (Math.random() - 0.5) * 9, monster.position.z + (Math.random() - 0.5) * 9, 2, splashMat);
    if (m.t > 1.2 && !m.bit) {
      m.bit = true;
      P.body.root.visible = false;
      o.sfx("death");
      hud.classList.remove("hurt");
      void hud.offsetWidth;
      hud.classList.add("hurt");
      P.invulnerable = 0;
      die("Swallowed by something from the deep");
      packMembers().forEach((n) => (n.following = false));
    }
    if (m.t > 3.8) {
      scene.remove(monster);
      monster.traverse((obj) => obj.geometry?.dispose());
      m.mats.forEach((x) => x.dispose());
      monster = null;
    }
  }
  function eat(hunger, health, xp) {
    P.hunger = Math.min(100, P.hunger + hunger);
    P.health = Math.min(P.maxHealth, P.health + health);
    P.dna += 1;
    gainXp(xp);
    act(P, "bite");
    o.sfx("eat");
  }
  function removeCarcass(i) {
    scene.remove(carcasses[i].mesh);
    carcasses.splice(i, 1);
  }
  function hurtPlayer(amount, reason, silent) {
    if (P.invulnerable > 0 || P.deadTimer > 0) return;
    P.health -= amount;
    if (!silent) P.lastHurt = performance.now();
    if (!silent) {
      setSneak(false);
      P.body.hit();
      o.sfx("damage");
      hud.classList.remove("hurt");
      void hud.offsetWidth;
      hud.classList.add("hurt");
    }
    if (P.health <= 0) die(reason);
  }

  function updateNPCs(dt, time) {
    const night = world.isNight;
    const leader = P.target && !P.target.dead && !P.target.following ? P.target : null;
    for (const n of npcs) {
      const sp = n.species;
      if (n.dead) {
        n.body.update(dt, 0);
        continue;
      }
      if (n.temporary !== undefined && (n.temporary -= dt) <= 0) {
        n.dead = true;
        despawnNPC(n);
        continue;
      }
      const d = distTo(n);
      n.body.setLOD(d < 40 ? 1 : 0);
      n.cool = Math.max(0, n.cool - dt);
      n.calm = Math.max(0, n.calm - dt);
      let want = null,
        pace = 0;
      const home = n.nest
        ? n.nest.site
        : n.family || n.raider
          ? ISLAND.nest
          : n.epic
            ? { x: Math.cos(n.epic.angle) * (n.epic.ring === 5 ? 22 : 52), z: Math.sin(n.epic.angle) * (n.epic.ring === 5 ? 22 : 52) }
            : n.rogue
              ? { x: Math.cos(n.rogue.angle) * ROGUE_RADIUS[n.rogue.ring], z: Math.sin(n.rogue.angle) * ROGUE_RADIUS[n.rogue.ring] }
              : P.pos;
      const homeD = Math.hypot(n.pos.x - home.x, n.pos.z - home.z);
      // Friends heal slowly when nothing is biting them.
      if (n.health < n.maxHealth && time - (n.hurtAt || -99) > (n.following || n.family ? 5 : 8)) {
        n.health = Math.min(n.maxHealth, n.health + dt * 3);
        if (n.health >= n.maxHealth) n.fleeChecked = false; // fully recovered: a new fight
      }
      if (n.stun > 0) n.stun -= dt;
      else if (n.fleeT > 0) {
        // Running for it: away from you, flat out, until its nerve comes back.
        n.fleeT -= dt;
        n.hunting = false;
        want = { x: n.pos.x + (n.pos.x - P.pos.x), z: n.pos.z + (n.pos.z - P.pos.z) };
        pace = 5.8;
      } else if (n.retreat !== undefined) {
        // Raiders giving up: they run off inland and are gone once out of sight.
        n.hunting = false;
        n.retreat -= dt;
        want = { x: n.pos.x + (n.pos.x - ISLAND.nest.x), z: n.pos.z + (n.pos.z - ISLAND.nest.z) };
        pace = 5;
        if ((n.retreat <= 0 && d > 35) || n.retreat < -30) {
          despawnNPC(n);
          continue;
        }
      } else if (n.raider) {
        updateRaider(n, d, dt);
        want = n.want;
        pace = n.pace;
      } else if (n.family && raid && !n.following) {
        // Your family scatters from raiders.
        const r = nearest(raid.raiders, n.pos, 14);
        if (r) {
          want = { x: n.pos.x + (n.pos.x - r.pos.x), z: n.pos.z + (n.pos.z - r.pos.z) };
          pace = 4.6;
          if (!n.scared) {
            n.scared = true;
            pop(n, "❗", "bad");
          }
        } else if (Math.hypot(n.pos.x - home.x, n.pos.z - home.z) > 10) {
          want = home;
          pace = 2.4;
        }
      } else if (n.following) {
        // Pack members: fight your target, otherwise trot behind you.
        // Allies only join a fight: never a social round, and never against their own nest.
        const fight = leader && leader.nest !== n.nest && (P.aggro > 0 || leader.nest?.angry > 0) && (leader.nest?.angry > 0 || leader.species.temper === "hostile" || leader.epic);
        if (fight && distTo(leader) < 18) {
          want = leader.pos;
          pace = 5.5;
          if (Math.hypot(leader.pos.x - n.pos.x, leader.pos.z - n.pos.z) < 2.5 + leader.scale && n.cool <= 0) {
            n.cool = 1.4;
            act(n, "bite");
            damageNPC(leader, 6 + (sp.abilities.bite || 1) * 5);
          }
        } else if (raid && n.family && distTo(n) < 30) {
          // Family in your pack defend the nest when it is raided.
          const r = nearest(raid.raiders, n.pos, 20);
          if (r) {
            want = r.pos;
            pace = 5.5;
            if (Math.hypot(r.pos.x - n.pos.x, r.pos.z - n.pos.z) < 2.5 + r.scale && n.cool <= 0) {
              n.cool = 1.4;
              act(n, "bite");
              damageNPC(r, 6 + (sp.abilities.bite || 1) * 5);
            }
          }
        } else if (d > 4) {
          want = { x: P.pos.x - Math.cos(P.heading) * 4, z: P.pos.z + Math.sin(P.heading) * 4 };
          pace = Math.min(7.5, d * 1.5);
        }
      } else {
        const cowed = n.nest?.cowed > 0;
        const hostile = !n.member?.friend && n.calm <= 0 && !cowed && ((n.nest && n.nest.angry > 0) || sp.temper === "hostile" || n.epic || n.rogue);
        // Sneaking shrinks how far away they notice you; once on your trail they follow further.
        const aggro = ((n.epic ? 20 : n.rogue ? 16 : 9 + sp.ring * 1.5) + (night ? 5 : 0)) * sneakScale();
        const leash = n.rogue ? 70 : 40;
        if (hostile && d < (n.hunting ? aggro * 1.7 : aggro) && homeD < leash && P.deadTimer <= 0) {
          n.hunting = true;
          // A packmate in the way gets bitten first.
          const ally = nearest(packMembers(), n.pos, reach(n) + 0.4);
          want = ally && Math.hypot(ally.pos.x - n.pos.x, ally.pos.z - n.pos.z) < d ? ally.pos : P.pos;
          pace = 4.5 + sp.ring * 0.4 + (n.epic ? 1.5 : 0) + (n.rogue ? 0.8 : 0);
          const bite = (3.6 + (sp.abilities.bite || 1) * 3.6) * Math.sqrt(n.scale) * (n.epic ? 2 : n.rogue ? 1.3 : 1);
          if (n.backT > 0) {
            // Just bit: it backs off and circles round for a new angle, which leaves you an opening.
            n.backT -= dt;
            const ux = (n.pos.x - P.pos.x) / Math.max(d, 0.01),
              uz = (n.pos.z - P.pos.z) / Math.max(d, 0.01),
              ca = Math.cos(0.9 * n.backDir),
              sa = Math.sin(0.9 * n.backDir),
              r = reach(n) + 4;
            want = { x: P.pos.x + (ux * ca - uz * sa) * r, z: P.pos.z + (ux * sa + uz * ca) * r };
            pace *= 0.85;
          } else if (ally && n.cool <= 0 && want === ally.pos) {
            n.cool = 1.6;
            act(n, "bite");
            voice(n, "bite");
            hurtAlly(ally, bite * 0.8, time);
            backOff(n);
          } else if (d < reach(n) + 0.6 && n.cool <= 0) {
            n.cool = n.epic ? 1.9 : 1.5;
            act(n, "bite");
            voice(n, "bite");
            hurtPlayer(bite, "A " + sp.name + " got you");
            backOff(n);
          }
        } else if (!n.member?.friend && ((sp.temper === "skittish" && d < (7 + (P.aggro > 0 ? 6 : 0)) * sneakScale() && (P.aggro > 0 || P.diet === "meat")) || (cowed && d < 14))) {
          n.hunting = false;
          want = { x: n.pos.x + (n.pos.x - P.pos.x), z: n.pos.z + (n.pos.z - P.pos.z) };
          pace = cowed ? 5.5 : 5;
        } else if (n.social && d < 24) {
          n.hunting = false;
          // Mid-conversation: face the player.
          n.heading = Math.atan2(-(P.pos.z - n.pos.z), P.pos.x - n.pos.x);
          if (n.social.leader === n) n.social.timer -= dt; // the leader keeps time for the group
          if (n.social.timer <= 0 && n.social.leader === n) {
            // Too slow: it counts as a miss, and the creature moves on to another move.
            missSocial(n, "slow");
            if (n.social) {
              n.social.request = nextRequest(n);
              n.social.timer = ASK_TIME;
              const enc = n.social;
              [...npcs].filter((x) => x.social === enc).forEach((x) => act(x, enc.request));
              voice(n, enc.request);
            }
          }
        } else {
          n.hunting = false;
          if (n.social && d >= 24) endEncounter(n.social);
          n.think -= dt;
          if (n.think <= 0 || !n.wander) {
            n.think = 2 + Math.random() * 4;
            const a = Math.random() * TAU,
              r = n.epic || n.rogue ? 14 : 3 + Math.random() * 7;
            n.wander = { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r };
          }
          want = n.wander;
          pace = 1.4;
          if (homeD > 12) {
            // Far from home (a migrating herd, or chased off): trot back in a loose line.
            want = home;
            pace = n.nest?.migrating > 0 ? 3.4 : 2.4;
          }
        }
      }
      if (want) {
        const dx = want.x - n.pos.x,
          dz = want.z - n.pos.z,
          dd = Math.hypot(dx, dz);
        if (dd > 0.6) {
          const target = Math.atan2(-dz, dx);
          const delta = THREE.MathUtils.euclideanModulo(target - n.heading + Math.PI, TAU) - Math.PI;
          n.heading += THREE.MathUtils.clamp(delta, -3 * dt, 3 * dt);
          n.speed += (pace - n.speed) * Math.min(1, dt * 3);
        } else n.speed *= 1 - Math.min(1, dt * 4);
      } else n.speed *= 1 - Math.min(1, dt * 4);
      n.pos.x += Math.cos(n.heading) * n.speed * dt;
      n.pos.z -= Math.sin(n.heading) * n.speed * dt;
      const res = world.resolve(n.pos.x, n.pos.z, 0.6 * n.scale);
      n.pos.x = res.x;
      n.pos.z = res.z;
      n.pos.y = Math.max(heightAt(n.pos.x, n.pos.z), -0.4);
      n.body.root.position.copy(n.pos);
      n.body.root.rotation.y = n.heading;
      if (d < 70) n.body.update(dt, n.speed);
    }
    nests.forEach((nest) => {
      nest.angry = Math.max(0, nest.angry - dt);
      nest.snub = Math.max(0, nest.snub - dt);
      nest.migrating = Math.max(0, nest.migrating - dt);
      nest.cowed = Math.max(0, (nest.cowed || 0) - dt);
    });
    epics.forEach((e) => (e.angle += dt * 0.01));
    rogues.forEach((r) => (r.angle += dt * 0.006));
    // Projectiles.
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.life -= dt;
      const t = pr.target;
      if (!t || t.dead || pr.life <= 0) {
        scene.remove(pr.mesh);
        projectiles.splice(i, 1);
        continue;
      }
      tmp.set(t.pos.x, t.pos.y + 1.2 * t.scale, t.pos.z).sub(pr.mesh.position);
      if (tmp.length() < 1 + t.scale * 0.5) {
        if (pr.ambush) ambushHit(t);
        damageNPC(t, pr.damage);
        scene.remove(pr.mesh);
        projectiles.splice(i, 1);
        continue;
      }
      pr.mesh.position.addScaledVector(tmp.normalize(), dt * 22);
    }
    for (let i = carcasses.length - 1; i >= 0; i--) if ((carcasses[i].life -= dt) <= 0) removeCarcass(i);
  }
  /** After a bite most creatures step back and circle before coming in again (epics just keep coming). */
  function backOff(n) {
    if (n.epic || Math.random() < 0.4) return;
    n.backT = 0.7 + Math.random() * 0.7;
    n.backDir = Math.random() < 0.5 ? 1 : -1;
  }
  /** The closest live creature in a list within a radius of a point, or null. */
  function nearest(list, pos, radius) {
    let best = null,
      bestD = radius;
    for (const n of list) {
      if (!n || n.dead) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }
  /** A packmate or family member is bitten. Kin killed this way are lost for good. */
  function hurtAlly(n, dmg, time) {
    if (n.dead) return;
    n.health -= dmg;
    n.hurtAt = time;
    n.body.hit();
    if (n.health > 0) return;
    if (n.family) return loseKin(n);
    n.dead = true;
    n.following = false;
    n.body.die();
    o.sfx("death");
    if (n.member) {
      n.member.alive = false;
      n.member.npc = null;
    }
    toast("Your packmate, a " + n.species.name + ", fell", 2.5);
    setTimeout(() => despawnNPC(n), 2500);
  }
  /** Raiders head for your family; they turn on you if you get close or fight them. */
  function updateRaider(n, d, dt) {
    const aggro = 9 * sneakScale();
    const provoked = n.health < n.maxHealth || P.aggro > 0;
    n.want = null;
    n.pace = 0;
    if (P.deadTimer <= 0 && (d < aggro || (provoked && d < 22))) {
      n.hunting = true;
      n.want = P.pos;
      n.pace = 5.2;
      if (d < reach(n) + 0.6 && n.cool <= 0) {
        n.cool = 1.7;
        act(n, "bite");
        voice(n, "bite");
        hurtPlayer((3.6 + (n.species.abilities.bite || 1) * 3.6) * Math.sqrt(n.scale), "A raiding " + n.species.name + " got you");
      }
      return;
    }
    n.hunting = false;
    const prey = nearest(family, n.pos, 80);
    if (!prey) {
      n.want = ISLAND.nest;
      n.pace = 3;
      return;
    }
    n.want = prey.pos;
    n.pace = 4.8;
    if (Math.hypot(prey.pos.x - n.pos.x, prey.pos.z - n.pos.z) < 2.4 + n.scale * 0.6 && n.cool <= 0) {
      n.cool = 1.4;
      act(n, "bite");
      voice(n, "bite");
      hurtAlly(prey, (6 + (n.species.abilities.bite || 1) * 4) * Math.sqrt(n.scale), timeUniform.value);
    }
    void dt;
  }

  /* ---- HUD per frame ---------------------------------------------------------- */
  const project = (v) => {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, behind: p.z > 1 };
  };
  function updateHUD() {
    $h("#chName").textContent = P.record.name;
    $h("#chBrain").textContent = "Brain " + P.brain + " / 5";
    $h("#chHealth").style.width = Math.max(0, (P.health / P.maxHealth) * 100) + "%";
    $h("#chHunger").style.width = P.hunger + "%";
    $h("#chHunger").parentElement.classList.toggle("low", P.hunger < 25);
    $h("#chXp").style.width = (P.brain >= 5 ? 100 : (P.xp / XP_TO_NEXT[P.brain]) * 100) + "%";
    $h("#chXp").parentElement.classList.toggle("ready", brainReady);
    $h("#chDna").textContent = "🧬 " + P.dna;
    const atNest = nearNest();
    $h("#chMate").hidden = !(brainReady && atNest) || !!courtship;
    const allied = nests.filter((n) => n.status === "allied").length,
      extinct = nests.filter((n) => n.status === "extinct").length;
    $h("#chObjective").textContent =
      P.brain >= 5
        ? "Brain level 5 reached. Open ☰ to try the Tribe Stage prototype."
        : brainReady
          ? "Brain ready: go back to your nest and call a mate."
          : P.hunger < 25
            ? "You're starving. Find " + (P.diet === "meat" ? "a carcass or prey" : P.diet === "plant" ? "fruit bushes" : "fruit or meat") + "."
            : "Befriend or hunt the nests: " + allied + " allied, " + extinct + " extinct of " + nests.length + ". " + RING_NAMES[ringAt(P.pos.x, P.pos.z)];
    // Cooldown rings.
    hud.querySelectorAll(".chAb").forEach((b) => {
      const k = b.dataset.ab,
        cd = k === "card" ? P.cardCooldown / 30 : k === "next" ? 0 : (P.cooldowns[k] || 0) / COOLDOWN[k];
      b.classList.toggle("pending", P.pending?.kind === k);
      const ring = b.querySelector(".cd");
      if (ring) ring.style.setProperty("--p", Math.max(0, cd) * 100 + "%");
    });
    // Movement buttons: stamina rings and on/off states.
    for (const k of ["sneak", "sprint"]) {
      const b = hud.querySelector(`.chAb[data-ab="${k}"]`);
      if (!b) continue;
      const on = k === "sneak" ? P.sneaking : P.sprinting;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.style.setProperty("--s", P.stamina + "%");
      b.classList.toggle("tired", P.stamina < 25);
    }
    hud.querySelector('.chAb[data-ab="jump"]')?.classList.toggle("on", !!P.air);
    hud.classList.toggle("sneaking", P.sneaking);

    // Faces pop up over creatures whose feelings about you change.
    const now = performance.now();
    for (const n of npcs) {
      if (n.dead) continue;
      const rel = relationOf(n);
      if (n.mood && n.mood !== rel && now - n.moodAt > 1500 && distTo(n) < 30) {
        popFace(n, rel, relationDelta(n.mood, rel));
        n.moodAt = now;
      }
      n.mood = rel;
    }

    // Selection card.
    const t = P.target && !P.target.dead ? P.target : null;
    $h("#chTarget").hidden = !t;
    if (t) {
      const sp = t.species;
      const rel = relationOf(t),
        info = RELATION_INFO[rel];
      const card = $h("#chTarget");
      card.style.setProperty("--rel", info.color);
      const face = $h("#chTargetFace");
      if (cardShown.t !== t || cardShown.rel !== rel) {
        face.src = info.face;
        face.alt = info.label;
        face.title = info.label;
        // Same creature, new feeling: the face bounces.
        if (cardShown.t === t) {
          face.classList.remove("bounce");
          void face.offsetWidth;
          face.classList.add("bounce");
        }
        cardShown.t = t;
        cardShown.rel = rel;
      }
      const isRevealing = revealing && revealing.id === sp.id;
      card.classList.toggle("revealing", !!isRevealing);
      $h("#chTargetName").textContent = isRevealing ? "???" : sp.name;
      const tags = [];
      if ((sp.generation || 1) > 1 && !isRevealing) tags.push(`<span class="gen">Gen ${sp.generation}</span>`);
      if (t.alpha) tags.push('<span class="alpha">👑 Alpha</span>');
      if (t.epic) tags.push('<span class="epic">Epic</span>');
      if (t.rogue) tags.push('<span class="rogue">Rogue</span>');
      if (t.raider) tags.push('<span class="raider">Raider</span>');
      const tagEl = $h("#chTargetTag");
      tagEl.hidden = !tags.length;
      if (tagEl.innerHTML !== tags.join("")) tagEl.innerHTML = tags.join("");
      $h("#chTargetDiet").textContent = sp.diet === "meat" ? "🥩" : sp.diet === "plant" ? "🌿" : "🍽";
      $h("#chTargetDiet").title = sp.diet === "meat" ? "Carnivore" : sp.diet === "plant" ? "Herbivore" : "Omnivore";
      const hpFrac = Math.max(0, Math.min(1, t.health / t.maxHealth));
      $h("#chTargetHp").style.width = hpFrac * 100 + "%";
      $h("#chTargetHp").parentElement.classList.toggle("low", hpFrac < 0.3);
      $h("#chTargetHpNum").textContent = Math.max(0, Math.ceil(t.health)) + " / " + t.maxHealth;
      const nest = t.nest;
      $h("#chTargetInfo").textContent = t.family
        ? "Lives at your nest"
        : t.raider
          ? "Raiding your nest"
          : t.rogue
            ? "A loner carrying a rare part"
            : nest
              ? nest.members.filter((m) => m.friend).length + " of " + nest.members.filter((m) => m.alive).length + " befriended · " + RING_NAMES[nest.site.ring || ringAt(nest.site.x, nest.site.z)]
              : "Roams the island alone";
      // What this species likes to see, with the level it expects.
      const likes = canSocialise(t)
        ? "Likes " + sp.favourite.map((k) => `<span class="${P.abilities[k] >= socialNeed(sp, k) ? "ok" : "low"}" title="${ABILITY_INFO[k].name} ${socialNeed(sp, k)}">${ABILITY_INFO[k].icon}${socialNeed(sp, k)}</span>`).join(" ")
        : "";
      if ($h("#chTargetLikes").innerHTML !== likes) $h("#chTargetLikes").innerHTML = likes;
      $h("#chTargetHint").textContent = t.family
        ? brainReady && nearNest()
          ? "Ready to mate: use a social move"
          : t.following
            ? ""
            : "Show off to bring it along"
        : t.social
          ? "Copy the move above its face!"
          : P.pending?.t === t
            ? "Walking over to " + ABILITY_INFO[P.pending.kind].name + "…"
            : t.raider || t.rogue || t.epic
              ? "Fight it" + (P.abilities.sneak && !P.sneaking && !t.hunting ? ", or sneak up for an ambush" : "")
              : canSocialise(t)
                ? nest.cowed > 0
                  ? "Cowering since its alpha fell"
                  : nest.snub > 0
                    ? "Not interested for " + Math.ceil(nest.snub) + "s"
                    : rel === "furious" || rel === "annoyed"
                      ? "Aggressive: calm it or fight"
                      : t.alpha
                        ? "The alpha: win it over and its nest follows"
                        : "Use a social move to befriend, or attack"
                : t.member?.friend
                  ? "Already a friend"
                  : "Attack to fight";
    }

    // The encounter arc: Spore's meter at the top of the screen.
    updateArc(t);

    // Pack bar.
    updatePackBar();

    // Nest markers: the three nearest nests within sight, and home.
    const marks = nests
      .map((n) => ({ n, d: Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) }))
      .filter((m) => m.d < 60)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    let html = "";
    for (const { n } of marks) {
      const pt = project(tmp.set(n.site.x, heightAt(n.site.x, n.site.z) + 6, n.site.z));
      if (pt.behind) continue;
      // Keep labels out from under the encounter arc.
      if (arcShown.mode && Math.abs(pt.x - innerWidth / 2) < 170 && pt.y < (innerWidth <= 900 ? 330 : 200)) continue;
      let icon = n.status === "allied" ? "💚" : n.status === "extinct" ? "🦴" : n.species.temper === "hostile" ? "⚠" : "◌";
      const known = P.discovered.has(n.species.id);
      if (n.migrating > 0) icon = "🐾";
      html += `<span class="chMark ${n.status}" style="left:${pt.x}px;top:${pt.y}px">${icon} ${known ? n.species.name : "???"}</span>`;
    }
    const hp = project(tmp.set(ISLAND.nest.x, heightAt(ISLAND.nest.x, ISLAND.nest.z) + 6, ISLAND.nest.z));
    if (!hp.behind && (raid || Math.hypot(ISLAND.nest.x - P.pos.x, ISLAND.nest.z - P.pos.z) > 10))
      html += raid ? `<span class="chMark home raid" style="left:${hp.x}px;top:${hp.y}px">⚠ Raid!</span>` : `<span class="chMark home" style="left:${hp.x}px;top:${hp.y}px">🏠 Your nest</span>`;
    // The nearest fossil you haven't dug yet, so parts are easy to find.
    let bone = null,
      boneD = 75;
    for (const b of world.bonePiles) {
      if (b.taken) continue;
      const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
      if (d < boneD) {
        boneD = d;
        bone = b;
      }
    }
    if (bone && boneD > 6) {
      const bp = project(tmp.set(bone.x, heightAt(bone.x, bone.z) + 3.2, bone.z));
      if (!bp.behind) html += `<span class="chMark bone" style="left:${bp.x}px;top:${bp.y}px">🦴 Fossil · ${Math.round(boneD)}m</span>`;
    }
    $h("#chMarkers").innerHTML = html;
  }

  const cardShown = { t: null, rel: null };
  const arcShown = { face: null, ask: null, mode: null };
  function updateArc(t) {
    const arc = $h("#chArc");
    let mode = null,
      fill = 0,
      faceRel = "neutral",
      ask = null,
      label = "",
      timer = 0;
    if (activeEnc && ![...npcs].some((n) => n.social === activeEnc)) activeEnc = null;
    const enc = activeEnc;
    if (enc) {
      mode = "social";
      fill = enc.progress;
      faceRel = arcState.sour > 0 ? "annoyed" : enc.progress >= 0.5 ? "friendly" : "neutral";
      ask = enc.request;
      timer = Math.max(0, enc.timer / ASK_TIME);
      label = (enc.alpha ? "👑 " : "") + enc.leader.species.name;
    } else if (arcState.win > 0 && arcState.winEnc) {
      mode = "social";
      fill = 1;
      faceRel = "allied";
      label = arcState.winEnc.leader.species.name;
    } else if (t && !t.family && !t.following && !t.member?.friend) {
      const rel = relationOf(t);
      if (rel === "furious" || t.health < t.maxHealth) {
        mode = "fight";
        fill = Math.max(0, t.health / t.maxHealth);
        faceRel = rel === "furious" ? "furious" : "annoyed";
        label = t.species.name;
      }
    }
    arc.hidden = !mode;
    hud.classList.toggle("arcOn", !!mode);
    if (!mode) {
      arcShown.mode = null;
      hud.querySelectorAll(".chAb.wanted").forEach((b) => b.classList.remove("wanted"));
      return;
    }
    if (arcShown.mode !== mode) {
      arc.classList.toggle("fight", mode === "fight");
      arc.classList.toggle("social", mode === "social");
      arcShown.mode = mode;
    }
    $h("#chArcFill").style.strokeDasharray = (fill * 100).toFixed(2) + " 100";
    const face = $h("#chArcFace");
    if (arcShown.face !== faceRel) {
      face.src = RELATION_INFO[faceRel].face;
      face.alt = RELATION_INFO[faceRel].label;
      if (arcShown.face) {
        face.classList.remove("bounce");
        void face.offsetWidth;
        face.classList.add("bounce");
      }
      arcShown.face = faceRel;
    }
    $h("#chArcLabel").textContent = label;
    $h("#chArcAsk").hidden = !ask;
    if (ask) {
      if (arcShown.ask !== ask) {
        $h("#chArcAskIcon").textContent = ABILITY_INFO[ask].icon;
        $h("#chArcAsk").setAttribute("aria-label", "Wants to see: " + ABILITY_INFO[ask].name);
        const el = $h("#chArcAsk");
        el.classList.remove("fresh");
        void el.offsetWidth;
        el.classList.add("fresh");
        arcShown.ask = ask;
      }
      $h("#chArcTime").style.strokeDasharray = (timer * 100).toFixed(2) + " 100";
      $h("#chArcAsk").classList.toggle("hurry", timer < 0.3);
    } else arcShown.ask = null;
    hud.querySelectorAll(".chAb.social").forEach((b) => b.classList.toggle("wanted", !!ask && b.dataset.ab === ask));
  }

  /* ---- pack bar -------------------------------------------------------------- */
  const portraits = new WeakMap();
  /** A small picture of a species, rendered once per design. */
  function portraitOf(record) {
    if (!o.portrait) return "";
    if (!portraits.has(record)) portraits.set(record, o.portrait(record) || "");
    return portraits.get(record);
  }
  let packShown = [];
  function updatePackBar() {
    const pack = packMembers();
    const el = $h("#chPack");
    if (pack.length !== packShown.length || pack.some((n, i) => n !== packShown[i])) {
      packShown = pack;
      el.innerHTML = "";
      pack.forEach((n) => {
        const item = document.createElement("div");
        item.className = "chPackMember";
        item.setAttribute("role", "listitem");
        const pic = portraitOf(n.species.record);
        item.innerHTML =
          (pic ? `<img alt="" src="${pic}" draggable="false">` : `<span class="noPic" aria-hidden="true">🐾</span>`) +
          `<i class="pmHp"><b></b></i><button class="pmHome" aria-label="Send the ${n.species.name} home" title="Send home">⌂</button>`;
        item.title = n.species.name;
        item.querySelector(".pmHome").onclick = () => sendHome(n);
        el.appendChild(item);
      });
    }
    [...el.children].forEach((item, i) => {
      const n = packShown[i];
      if (!n) return;
      const frac = Math.max(0, Math.min(1, n.health / n.maxHealth));
      item.querySelector(".pmHp b").style.width = frac * 100 + "%";
      item.classList.toggle("low", frac < 0.3);
    });
  }
  /** A packmate leaves your side and goes back to its nest. */
  function sendHome(n) {
    if (!n.following) return;
    n.following = false;
    n.wander = null;
    pop(n, "🏠");
    o.sfx("pose", { pitch: 1.2, gain: 0.5 });
  }

  /* ---- target ring -------------------------------------------------------- */
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false }));
  scene.add(ring);

  if (!save.record) setTimeout(() => tipOnce("land", "Tap a creature to select it, then pick a move.", 5), 2500);

  return {
    camera,
    get brain() {
      return P.brain;
    },
    get record() {
      return P.record;
    },
    /** The editor finished: the new design replaces the old one. */
    applyDesign(record, dnaLeft) {
      P.record = validateCreature(record);
      P.dna = dnaLeft;
      rebuildPlayer();
      P.body.root.position.copy(P.pos);
      renderAbilityButtons(); // new parts, new move levels
      hatchFamily();
      saveState();
    },
    setPaused(v) {
      paused = v;
      hud.hidden = v;
      if (v) {
        P.sprintHeld = false;
        setSprint(false);
      }
    },
    save: () => saveState(),
    /** Every species you have met, for the library in the species history. */
    library() {
      const out = [];
      const entry = (sp, home, status, extra = {}) => {
        const t = P.treated[sp.id] || { friends: 0, kills: 0 };
        out.push({ id: sp.id, name: sp.name, diet: sp.diet, home, status, friends: t.friends, kills: t.kills, generation: sp.generation || 1, thumb: portraitOf(sp.record), ...extra });
      };
      entry(ownSpecies(), "Your nest", "own");
      for (const nest of nests) {
        if (!P.discovered.has(nest.species.id)) continue;
        entry(nest.species, RING_NAMES[nest.site.ring || ringAt(nest.site.x, nest.site.z)], nest.status, { members: nest.members.filter((m) => m.alive).length });
      }
      for (const e of [...epics, ...rogues])
        if (P.discovered.has(e.species.id)) entry(e.species, RING_NAMES[e.ring] || "Wanders", e.alive ? (e.species.epic ? "epic" : "rogue") : "defeated");
      return out;
    },
    update(dt) {
      if (paused) return;
      world.update(dt, P.pos);
      streamClock -= dt;
      if (streamClock <= 0) {
        streamClock = 0.5;
        streamNests();
      }
      if (intro) {
        updateIntro(dt);
        updateDust(dt);
        emotes.update(dt);
        updateNPCs(dt, timeUniform.value);
        return;
      }
      updatePlayer(dt);
      updateDust(dt);
      emotes.update(dt);
      updateMonster(dt);
      updateNPCs(dt, timeUniform.value);
      updateRaid(dt);
      regrowFamily(dt);
      arcState.sour = Math.max(0, arcState.sour - dt);
      if (arcState.win > 0 && (arcState.win -= dt) <= 0) arcState.winEnc = null;
      if ((migrateClock -= dt) <= 0) {
        migrateClock = 150 + Math.random() * 90;
        migrateNests(1);
      }
      // Camera trails behind and above, swinging round slowly.
      // Auto-follow only when you are walking and haven't just turned the camera yourself.
      const manual = performance.now() - view.lastManual < 2500 || view.drag;
      if (!manual) {
        const yawDelta = THREE.MathUtils.euclideanModulo(P.heading - camYaw + Math.PI, TAU) - Math.PI;
        camYaw += yawDelta * Math.min(1, dt * (P.speed > 0.5 ? 1.8 : 0.3));
        if (P.speed > 0.5) view.pitch *= 1 - Math.min(1, dt * 0.8);
      }
      const dist = (10 + P.scale * 2.5) * view.zoom,
        up = (6 + P.scale * 1.6) * view.zoom * (1 + view.pitch);
      tmp.set(P.pos.x - Math.cos(camYaw) * dist, P.pos.y + up, P.pos.z + Math.sin(camYaw) * dist);
      tmp.y = Math.max(tmp.y, heightAt(tmp.x, tmp.z) + 2);
      camPos.lerp(tmp, Math.min(1, dt * 4));
      camera.position.copy(camPos);
      camera.lookAt(P.pos.x, P.pos.y + 1.6 * P.scale, P.pos.z);
      const t = P.target && !P.target.dead ? P.target : null;
      ring.visible = !!t;
      if (t) {
        ring.position.set(t.pos.x, t.pos.y + 0.15, t.pos.z);
        ring.scale.setScalar(t.body.radius * t.scale * 0.8 + 0.6);
        ring.material.color.set(RELATION_INFO[relationOf(t)].color);
      }
      if (revealing && (revealing.t -= dt) <= 0) {
        const n = P.target && P.target.species.id === revealing.id ? P.target : null;
        if (n) pop(n, "✦", "good");
        revealing = null;
      }
      hudClock -= dt;
      if (hudClock <= 0) {
        hudClock = 0.1;
        updateHUD();
      }
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) $h("#chToast").classList.remove("show");
      saveClock -= dt;
      if (saveClock <= 0) {
        saveClock = 20;
        saveState();
      }
    },
    render() {
      o.renderer.render(scene, camera);
    },
    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
    stats() {
      return { brain: P.brain, alliances: P.alliances, extinctions: P.extinctions, deaths: P.deaths, nests: nests.length, npcs: npcs.size, dna: P.dna, hunger: P.hunger, health: P.health, card: P.card };
    },
    debug: {
      P,
      nests,
      npcs,
      rogues,
      gainXp,
      mate,
      useAbility,
      world,
      toast,
      select,
      migrateNests,
      evolveIsland,
      startRaid,
      setSneak,
      jump,
      relationOf,
      get raid() {
        return raid;
      },
      get family() {
        return family;
      },
      get intro() {
        return intro;
      },
    },
    dispose() {
      saveState();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      ["pointerup", "pointercancel"].forEach((ev) => canvas.removeEventListener(ev, onRelease));
      hud.remove();
      [...npcs].forEach(despawnNPC);
      P.body.dispose();
      carcasses.forEach((c) => scene.remove(c.mesh));
      carcassGeo.dispose();
      carcassMat.dispose();
      boneGeo.dispose();
      boneMat.dispose();
      spitGeo.dispose();
      spitMat.dispose();
      dusts.forEach((m) => scene.remove(m));
      emotes.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      splashMat.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      if (monster) scene.remove(monster);
      intro?.overlay.remove();
      digRing.geometry.dispose();
      digRing.material.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      world.dispose();
    },
  };
}
