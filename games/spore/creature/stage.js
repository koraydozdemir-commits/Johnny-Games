/**
 * The Creature Stage: walk the island, befriend or hunt every nest, grow your brain to level 5.
 *
 * Owns its own scene and camera and borrows the game's renderer and input. Everything that should
 * outlive a session (body, brain, nests, parts) is saved to localStorage after meaningful events.
 */
import * as THREE from "three";
import { timeUniform } from "../gfx/materials.js";
import { buildCreatureBody } from "./body3d.js";
import { CREATURE_SAVE_KEY, armPairsOf, creaturePartIds, validateCreature } from "./format.js";
import { ABILITY_INFO, COMBAT, CREATURE_PARTS, SOCIAL, abilitiesOf, creaturePart } from "./parts.js";
import { MOUTH_STATS, STARTER_MOUTHS, biteCooldown, earnedMouths, feedsOn, isMouth, mouthDiet, mouthStats, progressOf, requirementsOf } from "./mouths.js";
import { createEmotes } from "./emotes.js";
import { RELATION_INFO, relationDelta, relationOf } from "./relations.js";
import { PERSONALITIES, atLevel, evolveSpecies, generateEpic, generateRogue, generateSpecies, socialNeed } from "./species.js";
import { ISLAND, areaAt, createIsland, heightAt, poolAt, steerAround } from "./world.js";
import { createMinimap, islandPicture, openIslandMap } from "./minimap.js";
import { movementOf } from "./anatomy.js";
import { REGIONS, regionById, regionIndex } from "./regions.js";
import { getHomeworld } from "../ecolib/homeworld.js";
import { faunaFor, regionSeed as planetRegionSeed } from "../ecolib/ecosystem.js";
import { faunaSpecies } from "../ecolib/library.js";
import { assetById } from "../ecolib/catalog.js";
import { createEcosystem } from "./ecosystem.js";
import { ECO_EVENTS } from "./populations.js";
import { CUTSCENES, beatClock, ease, mix, openFrame, span } from "../cinematics.js";
import { ENCOUNTERS, ENCOUNTER_TIMING, OUTCOMES, encounterDone, pickEncounter, readEncounters, retryLater } from "./encounters.js";
import { createWeather } from "./weather.js";
import { COLOR_CARD, FORMING_AT, INSTINCTS, instinctCard, instinctFor, leaningFor, momentFor, profileOf, readLedger, reputationOf, seedLedger, traitMods, leaningMoment } from "./identity.js";
import { attitudeOf, fade, readMemory, remember, socialBias } from "./memory.js";
import { ALPHA, ATTACKS, NPC_ATTACK, applyStagger, npcDamage, npcHealth, npcHit, playerDamage, playerHealth, roleOf } from "./balance.js";
import { RECOVER_TIME, RETREAT_TIME, assignPack, chaseLimit, courageOf, decide, dodgeChance, flankPoint, isStuck, outmatched, retreatThreshold } from "./combat-ai.js";
/** Turn an angle toward a target by at most `step` radians. */
const turnTo = (from, to, step) => from + THREE.MathUtils.clamp(THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI, -step, step);

const TAU = Math.PI * 2;
/**
 * World versions: 2 = the open island (now the coast region), 3 = regions. A v2 save becomes the
 * coast's region save; saves from the old ringed island keep their progress but not positions.
 */
const WORLD_VERSION = 3;
/* Nests per region, listed nearest your arrival first: gentler near, fiercer far. The coast's table
   is the original one. Forests and swamps lean omnivore; the badlands and volcano lean meat. */
const NEST_DIETS_BY_REGION = {
  coast: ["plant", "plant", "omni", "plant", "meat", "omni", "plant", "meat", "omni", "plant", "meat", "meat"],
  forest: ["plant", "omni", "plant", "meat", "omni", "plant", "omni", "meat", "plant", "omni", "meat", "meat"],
  swamp: ["omni", "plant", "omni", "meat", "plant", "omni", "meat", "omni", "plant", "meat", "omni", "meat"],
  badlands: ["omni", "meat", "plant", "meat", "omni", "meat", "plant", "meat", "omni", "meat", "meat", "omni"],
  volcanic: ["meat", "omni", "meat", "plant", "meat", "omni", "meat", "meat", "omni", "meat", "meat", "meat"],
};
/* As in Spore, nests level with you: each is your brain level plus this, so the near ones stay a
   little gentler and the far ones a little tougher, whatever your level. */
const NEST_OFFSET = [-1, -1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 1];
const XP_TO_NEXT = [0, 100, 150, 210, 280];
/** At brain 5, one last stretch of growth before the species is ready to found a tribe. */
const XP_FINAL = 340;
/** How big the brain is in its bubble at each level (fraction of the box); the final one bursts out. */
const BRAIN_SIZE = [0, 0.2, 0.32, 0.45, 0.6, 0.76];
const BRAIN_FINAL = 1.6;
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
 * @param {(ev:object) => void} [o.onChronicle]  a moment for the species' chronicle
 * @param {() => void} [o.onIntroDone]
 * @param {(record:object) => string|null} [o.portrait]  a small picture of a creature (data URL)
 * @param {() => void} [o.onSettings]
 * @param {() => void} [o.onTribe]  open the Tribal Stage
 * @param {() => void} [o.onSaved]
 * @param {() => boolean} [o.reducedMotion]
 */
export function createCreatureStage(o) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
  /* ---- regions -------------------------------------------------------- */
  const save = o.save || {};
  const legacyIsland = save.worldVersion === 2; // the open island: its layout is the coast's
  const sameWorld = save.worldVersion === WORLD_VERSION || legacyIsland;
  /** Saved state of every region you have been to (nests, fossils, epics, rogues). */
  const regionSaves = sameWorld && save.regions ? JSON.parse(JSON.stringify(save.regions)) : {};
  if (!save.regions) regionSaves.coast = { nests: save.nests, bonesTaken: sameWorld ? save.bonesTaken : [], epics: save.epics, rogues: save.rogues };
  const unlockedRegions = new Set(sameWorld && save.unlockedRegions ? save.unlockedRegions : ["coast"]);
  /** Where your nest is, and where you are now (you can travel back to regions you have lived in). */
  let homeRegion = sameWorld && save.homeRegion ? save.homeRegion : "coast";
  const regionId = sameWorld && save.region && unlockedRegions.has(save.region) ? save.region : homeRegion;
  const atHome = regionId === homeRegion;
  const arrival = save.arrival || null; // "migrate" | "travel" | null: how you got here
  const world = createIsland(scene, o.quality, regionId);
  const REGION = world.region;
  /** The place, ready to read in a sentence: "on the Sunlit Coast", "in the Deepwood Forest". */
  const WHERE = (regionId === "coast" ? "on the " : "in the ") + REGION.name;
  const regionSave = regionSaves[regionId] || {};
  const NEST_DIETS = NEST_DIETS_BY_REGION[regionId] || NEST_DIETS_BY_REGION.coast;
  let leaving = false; // set while fading out to another region: nothing else gets saved
  const raycaster = new THREE.Raycaster();

  /* ---- state ---------------------------------------------------------- */
  /** Where your species nests right now (in the home region). It moves when you migrate. */
  const nestAt = sameWorld && save.home && !(arrival === "migrate") ? { x: save.home.x, z: save.home.z } : { x: ISLAND.nest.x, z: ISLAND.nest.z - 14 };
  if (arrival === "migrate") {
    // A new region: settle the first open ground in from the shore.
    for (let rad = 0; rad < 40; rad += 2) {
      const a = (rad / 2) * 2.4;
      const x = ISLAND.nest.x + Math.cos(a) * rad,
        z = ISLAND.nest.z - 22 + Math.sin(a) * rad * 0.6;
      if (world.isOpen(x, z, 7)) {
        nestAt.x = x;
        nestAt.z = z;
        break;
      }
    }
  }
  const P = {
    record: validateCreature(save.record || o.record),
    brain: save.brain || 1,
    xp: save.xp || 0,
    dna: save.dna ?? 20,
    /** Food stored at your nest; it feeds your family (and you, when you rest there hungry). */
    larder: save.larder || 0,
    /** Standing order for your family: free | follow | stay | gather | defend. */
    familyOrder: save.familyOrder || "free",
    carry: null, // { kind: "meat" | "fruit", mesh, drag: carcass | null }
    hunger: save.hunger ?? 100,
    health: 1,
    maxHealth: 100,
    unlocked: new Set(save.unlocked || []),
    alliances: save.alliances || 0,
    extinctions: save.extinctions || 0,
    deaths: save.deaths || 0,
    card: save.card || null,
    pos:
      arrival === "travel" && !atHome
        ? new THREE.Vector3(ISLAND.nest.x, 0, ISLAND.nest.z - 6) // arriving from the shore
        : sameWorld && save.pos && !arrival
          ? new THREE.Vector3(save.pos.x, 0, save.pos.z)
          : new THREE.Vector3(nestAt.x, 0, nestAt.z - 9),
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
    bonesTaken: new Set(sameWorld ? regionSave.bonesTaken || [] : []),
    /** Nests you have lived at in this region, so each migration heads somewhere new. */
    pastHomes: sameWorld && !arrival ? save.pastHomes || [] : [],
    /** The migration in progress: { x, z } a new nest here, or { x, z, to } the way out to a new region. */
    migration: sameWorld && save.worldVersion === WORLD_VERSION ? save.migration || null : null,
    // A level's migration: still owed if you haven't yet reached the region for your brain level.
    migrateDue: sameWorld ? !!save.migrateDue || (legacyIsland && (save.brain || 1) >= 2) : false,
    stamina: 100,
    staminaRest: 0, // seconds before stamina starts to refill
    sneaking: false,
    sprinting: false,
    sprintHeld: false, // Shift on a keyboard; the Sprint button toggles on touch
    air: null, // { h, vy, mode: "jump" | "glide" } while off the ground
    /** What you did to each species, for the library: species id -> { friends, kills } */
    treated: save.treated || {},
    /** Kinds of food you have tried: each first taste is worth DNA. */
    foods: new Set(save.foods || []),
  };
  let brainFx = null; // the brain growing in its bubble (see playBrainGrowth)
  let cine = null; // the Creature → Tribal cutscene (see playStickThrow)
  let disposed = false;
  const treat = (sp, key) => {
    const rec = (P.treated[sp.id] ||= { friends: 0, kills: 0 });
    rec[key]++;
  };
  /* ---- identity: what your species does, and what it is becoming (identity.js, memory.js) ----
     Meaningful acts are counted; the count shapes a live reputation (prey keep further off from a
     hunter, creatures wander over to look at a peaceful visitor) and, at brain 5, the instinct card. */
  const ledger = save.ledger ? readLedger(save.ledger) : seedLedger(save);
  const CARD_COLOR = Object.fromEntries(Object.entries(COLOR_CARD).map(([col, id]) => [id, col]));
  // An older save that already holds a card gets the instinct of that colour its record fits best.
  let instinct = INSTINCTS[save.instinct] ? save.instinct : save.card && CARD_COLOR[save.card] ? instinctFor(ledger, { color: CARD_COLOR[save.card] }) : null;
  let mods = traitMods(o.cellCard, instinct);
  let rep = reputationOf(ledger);
  let leaning = instinct || leaningFor(ledger, save.leaning || null);
  let leanPulse = 0; // seconds the history button glows after the species' character shifts
  /** Count an act: chronicle its firsts and milestones, and see whether the species' character shifted. */
  function note(key, n = 1) {
    ledger[key] = (ledger[key] || 0) + n;
    const moment = momentFor(key, ledger[key], WHERE, regionId);
    if (moment) o.onChronicle?.(moment);
    rep = reputationOf(ledger);
    if (instinct) return; // the card is earned: the character is set
    const next = leaningFor(ledger, leaning);
    if (next && next !== leaning) {
      leaning = next;
      leanPulse = 6;
      if (profileOf(ledger).acts >= FORMING_AT * 2) o.onChronicle?.(leaningMoment(next));
    }
  }
  /** Your attacks: the card modifiers, alone or with a pack, at home or away. */
  const attackMult = () => mods.damage * (packMembers().length ? 1 : mods.soloDamage) * (atHome && Math.hypot(P.pos.x - nestAt.x, P.pos.z - nestAt.z) < 26 ? mods.homeDamage : 1);
  /** How much further prey keeps off: your reputation as a hunter, and the cards. */
  const fearOf = () => Math.min(1, rep.fear + mods.fear);
  const lookTmp = new THREE.Vector3();
  /** What mouths ask for, from what you have done so far. */
  const mouthProgress = () => progressOf({ brain: P.brain, alliances: P.alliances, treated: P.treated, foods: P.foods });
  /**
   * Mouths are earned, not found: reaching a brain level, making allies, winning fights or trying
   * foods opens the next ones. New ones are kept in P.unlocked (so they survive) and announced.
   * `quiet` grants silently: used on load, for saves that already qualify.
   */
  function checkMouthUnlocks(quiet = false) {
    const progress = mouthProgress();
    for (const id of earnedMouths(progress)) {
      if (P.unlocked.has(id)) continue;
      P.unlocked.add(id);
      if (!quiet && !STARTER_MOUTHS.includes(id)) {
        const part = creaturePart(id);
        o.sfx("unlock");
        o.onUnlock?.(part, "Evolved: " + (requirementsOf(id, progress).map((r) => r.text).join(", ") || "new mouth").toLowerCase());
      }
    }
  }
  const unlockedParts = () => {
    const base = new Set(P.unlocked);
    creaturePartIds(P.record).forEach((id) => base.add(id));
    base.add("paw"); // simple hands come with every arm
    STARTER_MOUTHS.forEach((id) => base.add(id)); // one basic mouth per diet, from the start
    earnedMouths(mouthProgress()).forEach((id) => base.add(id));
    // Older saves unlocked the single-piece "arm"; it is now a pair of arms with paws.
    base.delete("arm");
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
    P.abilities = abilitiesOf(creaturePartIds(P.record), P.record.legs.length, armPairsOf(P.record));
    // The equipped mouth is the single source of diet and of every mouth stat used below.
    P.mouthId = P.record.parts.map((p) => p.id).find((id) => creaturePart(id)?.slot === "mouth") || "snout";
    P.mouth = mouthStats(P.mouthId) || MOUTH_STATS.snout;
    P.diet = mouthDiet(P.mouthId);
    P.maxHealth = playerHealth(P.brain, P.abilities.health);
    P.move = movementOf(P.record, P.abilities); // body plan, bulk, legs, tail, fins → how you move
    if (P.health > P.maxHealth || P.health <= 1) P.health = P.maxHealth;
    P.scale = 0.9 + (P.brain - 1) * 0.12;
    P.body.root.scale.setScalar(P.scale);
  }
  rebuildPlayer();
  creaturePartIds(P.record).forEach((id) => P.unlocked.add(id)); // an existing creature keeps every part it already wears
  checkMouthUnlocks(true); // saves that already qualify get their mouths quietly
  if (save.health) P.health = Math.min(P.maxHealth, save.health);
  {
    // Never start inside a rock or a mountain.
    const at = world.resolve(P.pos.x, P.pos.z, 1.2);
    P.pos.set(at.x, 0, at.z);
  }

  /* ---- nests and creatures -------------------------------------------- */
  const seedBase = save.seed || ((Math.random() * 1e9) | 0);
  // Each region has its own cast; the coast's seeds are the original ones.
  const regionSeed = seedBase + regionIndex(regionId) * 100003;
  const nestLevel = (i) => Math.max(1, Math.min(5, P.brain + NEST_OFFSET[i % NEST_OFFSET.length]));
  const nests = world.nestSites.map((site, i) => {
    let base = generateSpecies(regionSeed + i * 7919, NEST_DIETS[i % NEST_DIETS.length], 2);
    const saved = regionSave.nests?.[i];
    // Species evolve as you do; a saved island replays the same evolution steps.
    for (let k = 0; k < (saved?.evo || 0); k++) base = evolveSpecies(base);
    const species = atLevel(base, nestLevel(i));
    const home = sameWorld && saved?.site ? { x: saved.site.x, z: saved.site.z } : { x: site.x, z: site.z };
    const mesh = world.makeNestMesh(home.x, home.z, species.record.colors.accent);
    return {
      index: i,
      site: home,
      base, // the species' look and lineage; species is the same creature at its current level
      evo: saved?.evo || 0,
      migrating: 0,
      snub: 0,
      species,
      status: saved?.status || "neutral", // neutral | allied | extinct
      mem: readMemory(saved?.mem), // what this nest remembers about your kind (memory.js)
      memHurt: 0,
      angry: 0,
      eggs: 3,
      eggRegrow: 0,
      members: Array.from({ length: species.members }, (_, k) => ({ alive: saved?.members?.[k]?.alive ?? true, friend: saved?.members?.[k]?.friend ?? false, npc: null })),
      mesh,
    };
  });
  /** The quietest open spot on the island: as far as possible from every nest and the beach start. */
  function remoteSpot(avoid) {
    let best = null,
      bestD = -1;
    for (let x = -168; x <= 168; x += 6)
      for (let z = -168; z <= 168; z += 6) {
        if (!world.isOpen(x, z, 10, ISLAND.beach - 16)) continue;
        const d = Math.min(...avoid.map((a) => Math.hypot(a.x - x, a.z - z)));
        if (d > bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    return best || { x: 0, z: 0 };
  }
  // Epics keep to the island's remotest corners, well away from every nest.
  const epicAvoid = [ISLAND.nest, ...world.nestSites];
  const epicHomes = [remoteSpot(epicAvoid)];
  epicHomes.push(remoteSpot([...epicAvoid, epicHomes[0]]));
  // Epics: two on the coast (as always), fewer in the close-set forest and swamp, three by the volcano.
  const EPIC_COUNT = { coast: 2, forest: 1, swamp: 1, badlands: 2, volcanic: 3 }[regionId] ?? 2;
  if (EPIC_COUNT > 2) epicHomes.push(remoteSpot([...epicAvoid, ...epicHomes]));
  const epics = [generateEpic(regionSeed + 99991, 4), generateEpic(regionSeed + 77773, 5), generateEpic(regionSeed + 55551, 5)]
    .slice(0, EPIC_COUNT)
    .map((sp, i) => ({ species: sp, alive: regionSave.epics?.[i] ?? true, angle: i * Math.PI, anchor: epicHomes[i], npc: null }));
  const epicHome = (e) => world.resolve(e.anchor.x + Math.cos(e.angle) * 10, e.anchor.z + Math.sin(e.angle) * 10, 3);

  const npcs = new Set();
  /**
   * A live creature. Nest alphas (each nest's first member) are a third bigger and much tougher, and
   * lead their nest: win the alpha over and the whole nest follows; bring it down and the rest cower.
   */
  function spawnNPC(species, x, z, extra = {}) {
    const alpha = !!extra.alpha;
    const scale = species.scale * (alpha ? 1.3 : 1);
    const maxHealth = Math.round(species.maxHealth * (alpha ? ALPHA.hp : 1));
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
    maxHealth: npcHealth(P.brain, P.abilities.health, "kin"),
    diet: P.diet,
    temper: "friendly",
    level: P.brain,
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
        return spawnNPC(sp, nestAt.x + Math.cos(a) * 6, nestAt.z + Math.sin(a) * 6, { family: true, trek: !!P.migration });
      }),
    ];
  }
  /** Mating, Spore-style: the nearest family member comes over, you court, and an egg is laid. */
  let courtship = null;
  function callMate() {
    if (courtship || !nearNest() || P.migration || brainFx || cine) return;
    const partner = family.filter((n) => !n.dead && !n.following).sort((a, b) => distTo(a) - distTo(b))[0];
    if (!partner) return mate();
    courtship = { n: partner, t: 0 };
    partner.social = null;
    partner.wake = 60; // even at night
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

  const YOUNG_TIME = 150; // seconds a hatchling takes to grow up
  /** Lost family members are replaced slowly: a new one hatches at the nest every so often. */
  let hatchClock = 90;
  function regrowFamily(dt) {
    family = family.filter((n) => !n.dead && npcs.has(n));
    if (family.length >= FAMILY_SIZE || raid) return;
    if ((hatchClock -= dt) > 0) return;
    hatchClock = 90 * mods.familyRegrow;
    const a = Math.random() * TAU;
    const n = spawnNPC(ownSpecies(), nestAt.x + Math.cos(a) * 4, nestAt.z + Math.sin(a) * 4, { family: true, young: YOUNG_TIME });
    n.baseScale = n.scale;
    n.scale *= 0.55;
    n.body.root.scale.setScalar(n.scale);
    family.push(n);
    dust(n.pos.x, n.pos.z, 6, eggMat);
    if (distTo(n) < 40) pop(n, "🥚", "good");
  }

  /* ---- raids ------------------------------------------------------------------
     Once your brain has grown a little, carnivores come for your family. A few hunters run in from
     the wild and go for the creatures at your nest; drive them off or lose your kin. */
  let raid = null,
    raidClock = 300 + Math.random() * 150;
  /** Raiders are the nearest meat eaters, a level below you so a raid is a fight you can win. */
  function raidSpecies() {
    const level = Math.max(1, P.brain - 1);
    const meat = nests
      .filter((n) => n.status !== "extinct" && n.species.diet === "meat" && n.status !== "allied")
      .sort((a, b) => Math.hypot(a.site.x - nestAt.x, a.site.z - nestAt.z) - Math.hypot(b.site.x - nestAt.x, b.site.z - nestAt.z));
    if (meat.length) return atLevel(meat[0].base, level);
    return generateSpecies(seedBase + 4242 + P.brain, "meat", level);
  }
  function startRaid() {
    if (raid || P.migration || !family.some((n) => !n.dead && !n.following)) return false;
    const sp = raidSpecies();
    const count = Math.min(3, 1 + Math.floor(P.brain / 2));
    // They come from inland, the side away from the beach.
    const a0 = Math.atan2(-nestAt.z, -nestAt.x);
    const raiders = [];
    for (let i = 0; i < count; i++) {
      const a = a0 + (i - (count - 1) / 2) * 0.35;
      const at = world.resolve(nestAt.x + Math.cos(a) * 42, nestAt.z + Math.sin(a) * 42, 2);
      const n = spawnNPC(sp, at.x, at.z, { raider: true });
      n.heading = Math.atan2(-(nestAt.z - at.z), nestAt.x - at.x);
      raiders.push(n);
    }
    raid = { raiders, t: 0, warned: false };
    o.sfx("roar");
    toast("Raiders are coming for your nest!", 3.5);
    tipOnce("raid", "Raiders! Defend your family.");
    return true;
  }
  function updateRaid(dt) {
    if (!raid) {
      if (P.brain >= 2 && !intro && !courtship && (raidClock -= dt) <= 0) {
        // Only when you are near enough to come back and defend; otherwise check again soon.
        if (Math.hypot(P.pos.x - nestAt.x, P.pos.z - nestAt.z) < 90 && startRaid()) raidClock = (300 + Math.random() * 150) / mods.raidRate;
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
      note("defended");
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
    note("kinLost");
    mourn(n);
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
        if (d < ACTIVE_RANGE && !m.npc && !(m.away > 0)) {
          const a = (k / nest.members.length) * TAU;
          m.npc = spawnNPC(nest.species, nest.site.x + Math.cos(a) * 4, nest.site.z + Math.sin(a) * 4, { nest, member: m, alpha: k === 0, quirk: QUIRKS[(nest.index * 7 + k * 3) % QUIRKS.length] });
        } else if (d > ACTIVE_RANGE + 15 && m.npc && !inPack) {
          despawnNPC(m.npc);
          m.npc = null;
        }
      });
    }
    for (const e of epics) {
      if (!e.alive) continue;
      const { x: ex, z: ez } = epicHome(e);
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
  /* Rogues: lone, extra-tough wanderers, each carrying a rare part and always a level above you.
     They circle the island slowly at different distances, so you meet them in different places. */
  const ROGUE_RADIUS = [150, 115, 80, 45];
  const rogueLevel = () => Math.min(5, P.brain + 1);
  const rogues = ROGUE_RADIUS.map((radius, i) => {
    const base = generateRogue(regionSeed + 31337 + i * 104729, i + 1);
    return { base, species: atLevel(base, rogueLevel()), alive: regionSave.rogues?.[i] ?? true, angle: i * 1.7 + 0.6, radius, npc: null };
  });
  const rogueHome = (r) => world.resolve(Math.cos(r.angle) * r.radius, Math.sin(r.angle) * r.radius, 3);

  // Your family lives at your nest: only in your home region.
  if (atHome) hatchFamily();

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
    const c = { x, z, mesh, bites: amount, life: 90, byYou: false };
    carcasses.push(c);
    return c;
  }

  /* ---- the ecosystem: wildlife herds, packs, loners and the food chain (ecosystem.js) ---- */
  // The homeworld decides which creatures live here (library fauna that suit its biomes and food chain).
  const homeworld = getHomeworld();
  const fauna = homeworld ? faunaFor(homeworld, planetRegionSeed(homeworld, regionId)).species.map((s) => assetById(s.id)) : [];
  const libraryFauna = (arch, i) => {
    const fit = fauna.filter((a) => a.params.archetype === arch);
    if (!fit.length) return null;
    const a = fit[i % fit.length];
    return { ...faunaSpecies(a), diet: a.params.diet };
  };
  const eco = createEcosystem({
    world,
    regionSeed,
    libraryFauna,
    wildlife: REGION.wildlife,
    quality: o.quality,
    P,
    npcs,
    carcasses,
    spawnNPC,
    despawnNPC,
    act,
    voice: (who, kind) => voice(who, kind), // defined further down
    pop,
    dropCarcass,
    hurtPlayer: (dmg, why) => hurtPlayer(dmg, why),
    noticeHunter: (n, d) => noticeHunter(n, d),
    noticeScale: () => noticeScale(),
    level: () => P.brain,
    fear: () => fearOf(),
    trust: () => rep.trust,
    provoke: () => mods.provoke,
    saved: sameWorld ? regionSave.wild : null,
    // Something new for curious creatures to look at: a fallen meteorite, a fresh carcass.
    poi: (n) => {
      if (weather.meteorite) return { x: weather.meteorite.x, z: weather.meteorite.z, key: "meteorite" };
      return carcasses.find((k) => k.life > 70 && Math.hypot(k.x - n.pos.x, k.z - n.pos.z) < 40) || null;
    },
    isNight: () => world.isNight,
    now: () => timeUniform.value,
  });

  /* ---- life's small habits, mourning, bones ---------------------------------------
     Nest creatures each have a habit; kin mourn their dead; carcasses leave bones that linger; an
     extinct nest is left abandoned. None of it explains itself: it is just there to be seen. */
  const QUIRKS = ["curious", "shy", "playful", "calm"];
  function idleLife(n, d, dt) {
    // The young keep close to a grown-up of the family.
    if (n.family && n.young > 0) {
      const adult = family.filter((k) => k !== n && !k.dead && !k.young && !k.following).sort((a, b) => Math.hypot(a.pos.x - n.pos.x, a.pos.z - n.pos.z) - Math.hypot(b.pos.x - n.pos.x, b.pos.z - n.pos.z))[0];
      if (adult) {
        const ad = Math.hypot(adult.pos.x - n.pos.x, adult.pos.z - n.pos.z);
        if (ad > 2.5) return { want: { x: adult.pos.x - Math.cos(adult.heading) * 1.8, z: adult.pos.z + Math.sin(adult.heading) * 1.8 }, pace: Math.min(4.5, ad * 1.2) };
        return { want: null, pace: 0 };
      }
    }
    if (n.sniffing > 0) {
      n.sniffing -= dt;
      if (n.sniffing <= 0) n.body.setCrouch(0);
      return { want: null, pace: 0 };
    }
    if (n.playing) {
      const pl = n.playing;
      if ((pl.t -= dt) <= 0 || pl.with.dead || !npcs.has(pl.with)) n.playing = null;
      else {
        const ox = pl.with.pos.x - n.pos.x,
          oz = pl.with.pos.z - n.pos.z;
        return pl.flee ? { want: { x: n.pos.x - ox, z: n.pos.z - oz }, pace: 3.8 } : { want: pl.with.pos, pace: 4.2 };
      }
    }
    if (!n.nest) return null;
    const q = n.quirk;
    if (q === "shy" && d < 8 && !n.member?.friend && P.deadTimer <= 0) return { want: { x: n.pos.x + (n.pos.x - P.pos.x), z: n.pos.z + (n.pos.z - P.pos.z) }, pace: 2.4 };
    if (q === "curious" && P.aggro <= 0 && !(n.nest.angry > 0) && d < 15 && P.deadTimer <= 0) {
      // A good look at you, from a polite distance, now and then.
      if ((n.peek = (n.peek ?? 0) - dt) > 6) return d > 5 ? { want: P.pos, pace: 1.8 } : { want: null, pace: 0 };
      if (n.peek < -30) {
        n.peek = 14;
        if (d < 30) pop(n, "❓");
      }
    }
    if (q === "playful" && (n.playT = (n.playT ?? 8 + Math.random() * 12) - dt) <= 0) {
      n.playT = 18 + Math.random() * 16;
      const mate = [...npcs].find((m) => m !== n && m.nest === n.nest && !m.dead && !m.asleep && !m.social && !m.hunting && Math.hypot(m.pos.x - n.pos.x, m.pos.z - n.pos.z) < 12);
      if (mate) {
        n.playing = { with: mate, t: 3.5 };
        mate.playing = { with: n, t: 3.5, flee: true };
        act(n, "dance");
        if (d < 30) pop(n, "🎵", "good");
      }
    }
    if ((n.sniffT = (n.sniffT ?? 6 + Math.random() * 10) - dt) <= 0) {
      n.sniffT = 10 + Math.random() * 12;
      n.sniffing = 1.4;
      n.body.setCrouch(1);
    }
    return null;
  }
  /** Kin nearby come to where one of their own died. */
  function mourn(dead) {
    for (const m of npcs) {
      if (m === dead || m.dead || m.hunting || m.following) continue;
      const kin = (dead.nest && m.nest === dead.nest) || (dead.family && m.family);
      if (kin && Math.hypot(m.pos.x - dead.pos.x, m.pos.z - dead.pos.z) < 28) m.mourn = { x: dead.pos.x, z: dead.pos.z, t: 5 + Math.random() * 2 };
    }
  }
  const bonesLeft = [];
  const skullGeo = new THREE.SphereGeometry(0.26, 7, 5).scale(1.25, 0.85, 1);
  /** A little skeleton where something died: it lingers for a few minutes (abandoned nests keep theirs). */
  function leaveBones(x, z, size = 1, life = 420) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(boneGeo, boneMat);
      b.position.set((i - 1.5) * 0.32 * size, 0.06, 0);
      b.rotation.set(Math.PI / 2, 0, (i % 2 ? 0.25 : -0.25) + Math.PI / 2);
      b.scale.setScalar(0.6 * size);
      g.add(b);
    }
    const skull = new THREE.Mesh(skullGeo, boneMat);
    skull.position.set(0.85 * size, 0.14, 0);
    skull.scale.setScalar(size);
    g.add(skull);
    g.position.set(x, heightAt(x, z) + 0.02, z);
    g.rotation.y = Math.random() * TAU;
    scene.add(g);
    if (life !== Infinity) {
      bonesLeft.push({ g, life });
      if (bonesLeft.length > 14) scene.remove(bonesLeft.shift().g);
    }
    return g;
  }
  /** An extinct nest: dark, empty, a few bones. Nothing else needs saying. */
  function abandonNest(nest) {
    if (nest.abandoned) return;
    nest.abandoned = true;
    nest.mesh.traverse((m) => {
      if (!m.material || m.userData.dim) return;
      m.material = m.material.clone();
      m.material.color?.multiplyScalar(0.42);
      m.userData.dim = true;
    });
    for (let k = 1; k <= 3; k++) if (nest.mesh.children[k]) nest.mesh.children[k].visible = false;
    nest.bones = leaveBones(nest.site.x + 2.2, nest.site.z + 1.2, 1.15, Infinity);
  }
  nests.forEach((n) => n.status === "extinct" && abandonNest(n));

  /* ---- encounters: a rival at the nest, a lost youngster (encounters.js) ---------------
     They play out in the world first; a few small buttons appear only once you are there. */
  const enc = readEncounters(save.encounters);
  let encounter = null; // { id, n, src, t, chosen, done }
  /** Where a rival comes from: the nearest meat- or omnivore nest, else a guardian or hunter herd. */
  function rivalSource() {
    const nest = nests
      .filter((n) => n.status === "neutral" && n.species.diet !== "plant" && n.members.some((m) => m.alive) && !(n.angry > 0))
      .sort((a, b) => Math.hypot(a.site.x - nestAt.x, a.site.z - nestAt.z) - Math.hypot(b.site.x - nestAt.x, b.site.z - nestAt.z))[0];
    if (nest) return { kind: "nest", index: nest.index, species: nest.species };
    const g = eco.groups.find((x) => ["guardian", "giant", "packHunter"].includes(x.arch) && !eco.eco.groups[x.index].gone);
    return g ? { kind: "wild", index: g.index, species: g.species } : null;
  }
  /** Where a lost youngster comes from: a gentle herd or nest a short walk away. */
  function straySource() {
    for (const g of eco.groups) {
      if ((g.arch !== "grazer" && g.arch !== "smallPrey") || eco.eco.groups[g.index].gone) continue;
      const gd = Math.hypot(g.pos.x - P.pos.x, g.pos.z - P.pos.z);
      if (gd > 30 && gd < 90) return { kind: "wild", index: g.index, species: g.species, home: g.pos };
    }
    const nest = nests.find((n) => n.status === "neutral" && n.species.diet === "plant" && Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) > 30 && Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) < 90);
    return nest ? { kind: "nest", index: nest.index, species: nest.species, home: nest.site } : null;
  }
  const memOf = (src) => (src.kind === "nest" ? nests[src.index]?.mem : eco.groups[src.index]?.mem);
  function startEncounter(id) {
    if (id === "rival") {
      const src = rivalSource();
      if (!src) return false;
      const a0 = Math.atan2(-nestAt.z, -nestAt.x) + (Math.random() - 0.5) * 0.8; // from inland
      const at = world.resolve(nestAt.x + Math.cos(a0) * 46, nestAt.z + Math.sin(a0) * 46, 2);
      const n = spawnNPC(src.species, at.x, at.z, { rival: true, homeSpot: world.resolve(nestAt.x + Math.cos(a0) * 11, nestAt.z + Math.sin(a0) * 11, 2) });
      n.heading = Math.atan2(-(nestAt.z - at.z), nestAt.x - at.x);
      encounter = { id, n, src, t: 0, chosen: null, done: false };
      return true;
    }
    const src = straySource();
    if (!src) return false;
    // Lost between you and its home, crying for its kin.
    const hx = src.home.x - P.pos.x,
      hz = src.home.z - P.pos.z,
      hd = Math.hypot(hx, hz) || 1;
    const at = world.resolve(P.pos.x + (hx / hd) * 16 + (Math.random() - 0.5) * 8, P.pos.z + (hz / hd) * 16 + (Math.random() - 0.5) * 8, 1.5);
    const young = { ...src.species, scale: src.species.scale * 0.55, maxHealth: Math.max(8, src.species.maxHealth * 0.35) };
    const n = spawnNPC(young, at.x, at.z, { stray: true, strayHome: { x: src.home.x, z: src.home.z }, homeSpot: { x: at.x, z: at.z }, brave: 0 });
    encounter = { id, n, src, t: 0, chosen: null, done: false };
    return true;
  }
  /** Apply an outcome (encounters.js): what your kind did, what they remember, what changes. */
  function resolveEncounter(outKey) {
    const e = encounter;
    if (!e || e.done) return;
    e.done = true;
    const out = OUTCOMES[e.id][outKey];
    out.ledger.forEach((k) => note(k));
    const mem = memOf(e.src);
    if (out.memory && mem) remember(mem, out.memory);
    if (out.text) o.onChronicle?.({ key: "enc:" + e.id + ":" + outKey + ":" + (enc.done[e.id] || 0), stage: "creature", icon: out.icon, text: out.text(e.src.species.name) });
    const fx = out.effect || {};
    if (fx.larder) {
      P.larder = fx.larder === "all" ? 0 : Math.max(0, P.larder + fx.larder);
      syncLarder();
    }
    if (fx.migrate && atHome && !P.migration) {
      const to = pickMigrationSite();
      if (to) {
        P.migration = to;
        showBeacon();
        family.forEach((k) => (k.trek = true));
        tipOnce("migrate", "Follow the 🐾. Family nearby come too.");
      }
    }
    if (fx.neighbour) {
      const a = Math.atan2(e.n.pos.z - nestAt.z, e.n.pos.x - nestAt.x);
      const spot = world.resolve(nestAt.x + Math.cos(a) * 22, nestAt.z + Math.sin(a) * 22, 2);
      e.n.neighbour = true;
      e.n.homeSpot = spot;
      enc.neighbour = { kind: e.src.kind, index: e.src.index, x: spot.x, z: spot.z, region: regionId };
      pop(e.n, "🤝", "good");
    }
    encounterDone(enc, e.id);
    hideChoice();
    saveState();
  }
  /** You chose: the world takes it from there. */
  function chooseEncounter(choice) {
    const e = encounter;
    if (!e || e.chosen || e.done) return;
    e.chosen = choice;
    hideChoice();
    const n = e.n;
    if (choice === "defend") {
      n.angryRival = true;
      n.hunting = true;
      n.calm = 0;
      pop(n, "💢", "bad");
      select(n);
      setMode("combat");
    } else if (choice === "move") {
      n.homeSpot = { x: nestAt.x, z: nestAt.z }; // it takes the old nest
      resolveEncounter("move");
    } else if (choice === "coexist") {
      resolveEncounter("coexist");
    } else if (choice === "guide") {
      n.followYou = true;
      pop(n, "🐾", "good");
    } else if (choice === "hunt") {
      select(n);
      setMode("combat");
    }
  }
  function showChoice() {
    const box = $h("#chChoice");
    if (!box.hidden) return;
    box.innerHTML = ENCOUNTERS[encounter.id].choices.map((c) => `<button type="button" data-choice="${c.id}"><span aria-hidden="true">${c.icon}</span>${c.label}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => chooseEncounter(b.dataset.choice)));
    box.hidden = false;
    o.sfx("snub", { pitch: 1.3 });
  }
  function hideChoice() {
    $h("#chChoice").hidden = true;
  }
  /** The rival: walks in, claims the ground round your nest with displays, then goes for the larder. */
  function rivalTick(n, d, dt) {
    const e = encounter?.n === n ? encounter : null;
    if (n.leaveT !== undefined) {
      n.leaveT -= dt;
      if ((n.leaveT <= 0 && d > 45) || n.leaveT < -40) {
        despawnNPC(n);
        if (e) encounter = null;
        return null;
      }
      return { want: { x: n.pos.x + (n.pos.x - nestAt.x), z: n.pos.z + (n.pos.z - nestAt.z) }, pace: 3.6 };
    }
    if (n.raiding) {
      const lx = nestAt.x + 2.6,
        lz = nestAt.z;
      if (Math.hypot(n.pos.x - lx, n.pos.z - lz) > 2.2 + n.scale) return { want: { x: lx, z: lz }, pace: 3.4 };
      n.heading = Math.atan2(-(lz - n.pos.z), lx - n.pos.x);
      act(n, "bite");
      if (d < 50) pop(n, "🍖", "bad");
      if (n.raiding === "steal") {
        // The neighbour helps itself to one.
        P.larder = Math.max(0, P.larder - 1);
        syncLarder();
      } else if (e && !e.done) resolveEncounter(n.raiding);
      if (n.raiding !== "steal") n.leaveT = 6;
      n.raiding = null;
      return { want: null, pace: 0 };
    }
    if (n.neighbour) {
      // A neighbour: keeps to its own ground beside yours, fights raiders, and steals now and then.
      if (raid) {
        const r = nearest(raid.raiders, n.pos, 30);
        if (r) {
          if (Math.hypot(r.pos.x - n.pos.x, r.pos.z - n.pos.z) < 2.5 + r.scale && n.cool <= 0) {
            n.cool = 1.5;
            act(n, "bite");
            damageNPC(r, npcDamage(n.species.level || 1, n.species.abilities.bite || 1, "kin"));
          }
          return { want: r.pos, pace: 5.5 };
        }
      }
      if ((n.stealT = (n.stealT ?? ENCOUNTER_TIMING.neighbourSteal) - dt) <= 0) {
        n.stealT = ENCOUNTER_TIMING.neighbourSteal * (0.8 + Math.random() * 0.4);
        if (P.larder > 2) n.raiding = "steal";
      }
      if ((n.think -= dt) <= 0 || !n.wander) {
        n.think = 3 + Math.random() * 4;
        const a = Math.random() * TAU;
        n.wander = { x: n.homeSpot.x + Math.cos(a) * 5, z: n.homeSpot.z + Math.sin(a) * 5 };
      }
      return { want: n.wander, pace: 1.3 };
    }
    const spot = n.homeSpot;
    if (!n.claiming && Math.hypot(n.pos.x - spot.x, n.pos.z - spot.z) > 3) return { want: spot, pace: 3.2 };
    n.claiming = true;
    if (e && !e.chosen) {
      // Nobody comes to stop it: in a while it goes for the larder.
      if (d > 26) e.t += dt;
      if (e.t > ENCOUNTER_TIMING.approach * 1.6 || (d < 26 && (e.near = (e.near || 0) + dt) > ENCOUNTER_TIMING.decide + 40)) n.raiding = "ignored";
    }
    if (e?.chosen === "move") {
      // It has the old nest now: it stays there, and is gone once you have moved on.
      if (d > 70) {
        despawnNPC(n);
        encounter = null;
        return null;
      }
      if (Math.hypot(n.pos.x - spot.x, n.pos.z - spot.z) > 4) return { want: spot, pace: 2 };
      if ((n.display = (n.display ?? 2) - dt) <= 0) {
        n.display = 6 + Math.random() * 3;
        if (d < 45) pop(n, "😤");
      }
      return { want: null, pace: 0 };
    }
    if ((n.display = (n.display ?? 1) - dt) <= 0) {
      // A display: crouched and roaring, facing your nest.
      n.display = 3.5 + Math.random() * 2;
      if (d < 60) pop(n, "😠", "bad");
      if (d < 45) voice(n, "pose");
      n.body.setCrouch(1);
      n.uncrouch = 0.8;
    }
    if (n.uncrouch > 0 && (n.uncrouch -= dt) <= 0) n.body.setCrouch(0);
    n.circle = (n.circle ?? Math.atan2(n.pos.z - nestAt.z, n.pos.x - nestAt.x)) + dt * 0.22;
    return { want: { x: nestAt.x + Math.cos(n.circle) * 11, z: nestAt.z + Math.sin(n.circle) * 11 }, pace: 1.8 };
  }
  /** The lost youngster: cries where it is; follows you home if you lead it. */
  function strayTick(n, d, dt) {
    const e = encounter?.n === n ? encounter : null;
    const home = n.strayHome;
    if (n.goingHome) {
      if (Math.hypot(n.pos.x - home.x, n.pos.z - home.z) < 4 || d > 90) {
        if (d > 30 || Math.hypot(n.pos.x - home.x, n.pos.z - home.z) < 4) {
          despawnNPC(n);
          if (e) encounter = null;
          return null;
        }
      }
      return { want: home, pace: 3 };
    }
    if (n.followYou) {
      if (Math.hypot(n.pos.x - home.x, n.pos.z - home.z) < 14) {
        // Home: it runs to its kin, and they remember who brought it back.
        n.followYou = false;
        n.goingHome = true;
        pop(n, "💚", "good");
        for (const m of npcs) if (!m.dead && m !== n && (m.wild === eco.groups[e?.src.index] || m.nest === nests[e?.src.index]) && Math.hypot(m.pos.x - n.pos.x, m.pos.z - n.pos.z) < 25) setTimeout(() => !m.dead && pop(m, "💚", "good"), 300 + Math.random() * 600);
        if (e && !e.done) resolveEncounter("guide");
        return { want: home, pace: 3 };
      }
      if (d > 3.2) return { want: { x: P.pos.x - Math.cos(P.heading) * 2.4, z: P.pos.z + Math.sin(P.heading) * 2.4 }, pace: Math.min(6.5, d * 1.4) };
      return { want: null, pace: 0 };
    }
    if ((n.cry = (n.cry ?? 0) - dt) <= 0) {
      n.cry = 3 + Math.random() * 1.5;
      if (d < 40) {
        pop(n, "😢");
        if (d < 25) voice(n, "sing");
      }
    }
    if (e && !e.done) {
      e.t += dt;
      if (d < 10) e.seen = true;
      // Left alone too long (or walked away from), it finds its own way home.
      if (e.t > 140 || (e.seen && d > 60)) {
        resolveEncounter("ignored");
        n.goingHome = true;
      }
    }
    if (n.fleeT > 0) return { want: home, pace: 4 };
    return { want: null, pace: 0 };
  }
  /** Spawn the neighbour you let stay (when you are home). */
  function restoreNeighbour() {
    const nb = enc.neighbour;
    if (!nb || nb.region !== regionId || !atHome) return;
    const species = nb.kind === "nest" ? (nests[nb.index]?.status !== "extinct" ? nests[nb.index]?.species : null) : eco.groups[nb.index]?.species;
    if (!species) {
      enc.neighbour = null;
      return;
    }
    spawnNPC(species, nb.x, nb.z, { rival: true, neighbour: true, homeSpot: { x: nb.x, z: nb.z } });
  }
  function updateEncounters(dt) {
    if (intro || leaving) return;
    if (encounter) {
      const e = encounter;
      if (!npcs.has(e.n) || e.n.dead) {
        if (!e.done) resolveEncounter(e.id === "stray" ? "ignored" : "defend");
        encounter = null;
        hideChoice();
        return;
      }
      if (e.n.neighbour && e.done) {
        encounter = null; // it lives here now
        return;
      }
      const near = distTo(e.n) < (e.id === "rival" ? 26 : 9);
      if (!e.chosen && !e.done && near && P.deadTimer <= 0) showChoice();
      else if (e.chosen || e.done || !near) hideChoice();
      return;
    }
    enc.clock -= dt;
    if (enc.clock > 0) return;
    const id = pickEncounter(enc, {
      atHome,
      brain: P.brain,
      busy: !!(raid || P.migration || courtship || P.deadTimer > 0),
      night: world.isNight,
      nestDist: Math.hypot(P.pos.x - nestAt.x, P.pos.z - nestAt.z),
      rivalSource: !!rivalSource(),
      strayNear: !!straySource(),
    });
    if (!id || !startEncounter(id)) retryLater(enc);
  }
  restoreNeighbour();
  setTimeout(() => !intro && gainXp(0), 1500); // a save sitting on a full brain bar grows now

  /* ---- the ecology, shown rather than told ----------------------------------------
     Seasons change the fruit on the bushes; herds that are hunted too hard walk off; new packs walk in
     from the coast; sick herds cough and stagger. A short hint comes only once you have seen it. */
  const ecoWatch = []; // { id, group, rival, t }: waiting for you to witness it
  function ecoMoment(key, icon, text) {
    o.onChronicle?.({ key: "eco:" + key + ":" + regionId, stage: "creature", icon, text });
  }
  function applyEcoActions(list) {
    for (const a of list) {
      const g = eco.groups[a.group];
      const name = g?.species.name;
      if (a.type === "start") {
        const def = ECO_EVENTS[a.id];
        if (a.id === "bloom") {
          world.setGrowth(2.6);
          world.fruits.forEach((f) => !f.alive && (f.regrow = Math.min(f.regrow, Math.random() * 10)));
        } else if (a.id === "shortage") {
          world.setGrowth(0.22);
          // Food disappears: most of what is ripe withers.
          world.fruits.forEach((f) => {
            if (f.alive && Math.random() < 0.6) {
              f.alive = false;
              f.regrow = 40 + Math.random() * 40;
            }
          });
          world.syncFruit();
        }
        ecoMoment(a.id + (a.newGroup !== undefined ? ":" + a.newGroup : ""), def.icon, def.chronicle(REGION.name, WHERE));
        ecoWatch.push({ id: a.id, group: a.arrive ? a.newGroup : a.group, rival: a.rival, t: 0 });
      } else if (a.type === "end" && (a.id === "bloom" || a.id === "shortage")) world.setGrowth(1);
      else if (a.type === "leave" && g) {
        ecoMoment("leave:" + a.group, a.why === "hunted" ? "🦴" : "🥀", a.why === "hunted" ? "The " + name + " were hunted out of the " + REGION.name + "." : "The " + name + " left the " + REGION.name + ", going hungry.");
        if (a.why === "hunted" && g.members.some((m) => m.npc && distTo(m.npc) < 60)) tipOnce("ecoLeave", "Hunted too hard, they're leaving.");
      } else if (a.type === "migrate" && g && a.ok) {
        ecoMoment("migrate:" + a.group, "🧭", "The " + name + " abandoned their ground in the " + REGION.name + ".");
      } else if (a.type === "return" && g) ecoMoment("return:" + a.group, "🌱", "The " + name + " came back to the " + REGION.name + ".");
    }
  }
  /** Is any live member of this group close enough to see? */
  const groupInSight = (g, range) => !!g && g.members.some((m) => m.npc && !m.npc.dead && distTo(m.npc) < range);
  function watchEcology(dt) {
    for (let i = ecoWatch.length - 1; i >= 0; i--) {
      const w = ecoWatch[i];
      w.t += dt;
      const def = ECO_EVENTS[w.id];
      const g = eco.groups[w.group];
      const seen =
        w.id === "bloom" || w.id === "shortage"
          ? w.t > 12 // the bushes show it everywhere
          : w.id === "clash"
            ? groupInSight(g, 55) && groupInSight(eco.groups[w.rival], 55)
            : groupInSight(g, w.id === "sickness" ? 30 : 45);
      if (seen) {
        tipOnce("eco_" + w.id, def.hint);
        ecoWatch.splice(i, 1);
      } else if (w.t > 600) ecoWatch.splice(i, 1);
    }
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
        <button class="chIconBtn" id="chFamily" aria-label="Family orders" title="Family orders (O)" aria-haspopup="menu" aria-expanded="false">🐾</button>
        <button class="chIconBtn chHistBtn" id="chHistory" aria-label="Species history and library" title="Species history and library">◈<i class="chLean" id="chLean" hidden></i></button>
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
        <img class="ctFace" id="chTargetFace" alt="" width="28" height="28" draggable="false">
        <div class="ctHpWrap"><i class="ctHp"><b id="chTargetHp"></b></i><span class="ctHpNum" id="chTargetHpNum"></span></div>
        <span class="ctRel" id="chTargetRel"></span>
      </div>
      <span class="ctInfo" id="chTargetInfo"></span>
      <span class="ctLikes" id="chTargetLikes"></span>
      <span class="ctHint" id="chTargetHint"></span>
    </div>
    <div class="chMarkers" id="chMarkers"></div>
    <div class="chPops" id="chPops" aria-hidden="true"></div>
    <div class="chToast" id="chToast"></div>
    <div class="chHint" id="chHint" role="status" aria-live="polite"></div>
    <div class="chChoice" id="chChoice" role="group" aria-label="What will you do?" hidden></div>
    <div class="chBrainFx" id="chBrainFx" hidden aria-hidden="true">
      <svg class="bfLink"><line id="chBfLine"></line><circle id="chBfDot" r="3.5"></circle></svg>
      <div class="bfBox"><i class="bfShard s1"></i><i class="bfShard s2"></i><i class="bfShard s3"></i><i class="bfShard s4"></i>
        <svg class="bfBrain" viewBox="-50 -44 100 88"><path class="bfLobe" d="M-38,6 C-47,-8 -38,-30 -20,-32 C-12,-43 6,-43 14,-34 C30,-39 47,-24 42,-6 C50,6 42,25 28,26 C22,38 4,39 -2,30 C-14,39 -33,33 -32,20 C-43,18 -45,12 -38,6 Z"></path><path class="bfFold" d="M-2,-35 C-7,-20 4,-10 -2,4 C-6,16 2,24 -2,30 M-31,-13 C-20,-19 -15,-6 -24,0 M21,-21 C10,-16 12,-4 23,-2 M-19,14 C-10,9 -6,20 -15,24 M14,9 C25,7 27,18 18,22 M-28,-24 C-22,-30 -12,-26 -10,-30 M30,-26 C24,-32 14,-28 12,-31"></path><ellipse class="bfShine" cx="-16" cy="-20" rx="9" ry="5"></ellipse></svg>
      </div>
    </div>
    <button class="chMate" id="chMate" hidden>♡ Call a mate</button>
    <button class="chMate chEgg" id="chEgg" hidden>🥚 Eat an egg</button>
    <div class="chActRow" id="chActRow" hidden>
      <button class="chAct" id="chCarry"></button>
      <button class="chAct alt" id="chDrop" hidden>Drop</button>
    </div>
    <div class="chOrders" id="chOrders" role="menu" aria-label="Family orders" hidden>
      <b>Family orders</b>
      <button role="menuitemradio" data-order="follow"><span aria-hidden="true">🐾</span> Follow me</button>
      <button role="menuitemradio" data-order="stay"><span aria-hidden="true">✋</span> Stay here</button>
      <button role="menuitemradio" data-order="gather"><span aria-hidden="true">🍎</span> Gather food</button>
      <button role="menuitemradio" data-order="defend"><span aria-hidden="true">🛡</span> Defend the nest</button>
      <button role="menuitem" data-order="attack"><span aria-hidden="true">⚔</span> Attack my target</button>
      <button role="menuitem" data-order="retreat"><span aria-hidden="true">🏃</span> Retreat home</button>
      <button role="menuitemradio" data-order="free"><span aria-hidden="true">🌿</span> As you like</button>
    </div>
    <div class="chAbilities" id="chAbilities" role="toolbar" aria-label="Abilities"></div>
    <section class="chGuide" id="chGuidePanel" hidden aria-labelledby="chGuideTitle">
      <div class="cgHead"><b id="chGuideTitle">Field guide</b><button class="ctClose" id="chGuideClose" aria-label="Close field guide">✕</button></div>
      <dl>
        <div><dt>🍎 Food</dt><dd>Your mouth decides: plants, meat or both. Pick food up to carry, gift or store it.</dd></div>
        <div><dt>💚 Friends</dt><dd>Copy the move a creature shows. Win the alpha and the nest follows.</dd></div>
        <div><dt>⚔ Fights</dt><dd>A crouch means a lunge is coming: step back.</dd></div>
        <div><dt>👣 Sneak</dt><dd>Seen less far off. Your first strike is an ambush.</dd></div>
        <div><dt>🧠 Brain</dt><dd>Grows by itself as you live. Mate at your nest any time for a new design; fully grown, mating founds a tribe.</dd></div>
        <div><dt>🐾 Family</dt><dd>Orders: follow, stay, gather, defend.</dd></div>
        <div><dt>◈ Character</dt><dd>What you do shapes your species. Hunters are feared, friends are trusted. At brain 5 it becomes a trait card.</dd></div>
        <div><dt>🕯 Memory</dt><dd>Nests and herds remember harm and kindness.</dd></div>
      </dl>
    </section>
    <div class="chMenuPanel" id="chMenuPanel" hidden>
      <button id="chResume" class="primary">Resume</button>
      <button id="chGuide">❔ Field guide</button>
      <button id="chSettings">⚙ Settings</button>
      <button id="chTribe">🛖 Tribal Stage</button>
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
  /* Weather and events: rain, storms, heatwaves, meteor showers, eruptions (see weather.js). */
  const weather = createWeather({
    scene,
    hud,
    region: regionId,
    sfx: (k, opt) => o.sfx(k, opt),
    toast: (t, secs) => toast(t, secs),
    onMeteorite: () => tipOnce("meteorite", "A meteorite. Walk onto it."),
    onBomb: (dmg) => hurtPlayer(dmg, "Hit by a lava bomb"),
    reducedMotion: !!o.reducedMotion?.(),
  });
  /** A meteorite gives up one of the rarest parts you don't have yet (or a lot of DNA). */
  function digMeteorite() {
    const m = weather.meteorite;
    weather.takeMeteorite();
    dust(m.x, m.z, 24);
    o.sfx("unlock");
    pop(P, "☄", "good");
    const owned = unlockedParts();
    const pool = CREATURE_PARTS.filter((p) => p.cost > 0 && !owned.has(p.id) && !isMouth(p.id)).sort((a, z) => z.cost - a.cost);
    const pick = pool.length ? pool[Math.floor(Math.random() * Math.min(4, pool.length))] : null;
    gainXp(30);
    P.dna += 20;
    if (pick) {
      P.unlocked.add(pick.id);
      o.onUnlock?.(pick, "Dug from a meteorite");
    }
    o.onChronicle?.({ key: "meteorite:" + regionId, stage: "creature", icon: "☄", text: "Dug " + (pick ? "the " + pick.name : "DNA") + " out of a fallen meteorite in the " + REGION.name + "." });
    saveState();
  }
  /** A quiet one-line hint near the top of the screen: never a block of text, never twice. */
  let hintTimer = 0;
  function hint(text, seconds = 3.2) {
    if (o.hints?.() === false) return;
    $h("#chHint").textContent = text;
    $h("#chHint").classList.add("show");
    hintTimer = seconds;
  }
  function tipOnce(key, text, seconds = 3.2) {
    if (seenTips.has(key)) return;
    seenTips.add(key);
    hint(text, seconds);
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
    // Spore's simple philosophy: one set of four moves at a time, Social or Combat. Movement stays separate.
    const moves = P.mode === "social" ? SOCIAL : COMBAT;
    const modeBtn = (m, label) => `<button class="chMode ${m} ${P.mode === m ? "on" : ""}" data-mode="${m}" role="tab" aria-selected="${P.mode === m}" aria-label="${label} moves">${label}</button>`;
    $h("#chAbilities").innerHTML =
      `<div class="chModes" role="tablist" aria-label="Move set">${modeBtn("social", "Social")}${modeBtn("combat", "Combat")}<kbd>R</kbd></div>` +
      `<div class="chRow ${P.mode}">${moves.map((k, i) => btn(k, i + 1)).join("")}</div>` +
      `<div class="chRow extra">` +
      moveBtn("sneak", "👣", "Sneak", "C", P.abilities.sneak) +
      moveBtn("sprint", "💨", "Sprint", "⇧", 1) +
      moveBtn("jump", P.abilities.glide ? "🕊" : "⤒", "Jump", "␣", P.abilities.jump) +
      `<button class="chAb card" data-ab="card" aria-label="${cardInfo.name}"><span class="cd"></span><span class="ic">${cardInfo.icon}</span><small>${cardInfo.name}</small><kbd>Q</kbd></button>` +
      `<button class="chAb next" data-ab="next" aria-label="Select the next creature"><span class="ic">◎</span><small>Select</small><kbd>Tab</kbd></button></div>`;
    $h("#chAbilities")
      .querySelectorAll("button")
      .forEach((b) => (b.onclick = () => (b.dataset.mode ? setMode(b.dataset.mode, true) : useAbility(b.dataset.ab))));
  }
  /** Switch between the Social and Combat move sets. `manual` stops the game switching back for a few seconds. */
  function setMode(mode, manual = false) {
    if (mode !== "social" && mode !== "combat") return;
    if (manual) P.modeLock = performance.now() + 6000;
    if (P.mode === mode) return;
    P.mode = mode;
    renderAbilityButtons();
    hud.dataset.mode = mode;
    if (manual) o.sfx("click");
    tipOnce("mode", "Social or Combat: tap the tabs (R).");
  }

  /* ---- sneaking, sprinting, jumping ---------------------------------------------
     Sneak (from soft feet, keen senses and the like): crouch low, move at half pace and turn
     see-through; creatures only notice you much closer. Your first attack out of hiding is an ambush.
     Sprint uses Speed; both burn stamina. Anything with legs can hop, and wings turn a hop into a glide. */
  const sneakScale = () => (P.sneaking ? Math.max(0.2, 0.55 - 0.07 * P.abilities.sneak) : 1);
  /** How far away others notice you: sneaking, and your size (small creatures go unseen longer). */
  const noticeScale = () => sneakScale() * P.move.notice * weather.notice * mods.notice;
  /** In front of the camera (roughly what you can see on screen). */
  const inView = (x, z) => {
    const dx = x - P.pos.x,
      dz = z - P.pos.z,
      d = Math.hypot(dx, dz) || 1;
    return (dx * Math.cos(camYaw) - dz * Math.sin(camYaw)) / d > 0.55;
  };
  /** Hearing: a hunter coming up behind you is heard before it arrives (ears and antennae hear further). */
  const hearRange = () => 16 + P.abilities.hearing * 7;
  function noticeHunter(n, d) {
    if (d > hearRange() || inView(n.pos.x, n.pos.z) || timeUniform.value - (P.heardAt || -99) < 12) return;
    P.heardAt = timeUniform.value;
    pop(P, "👂", "bad");
    o.sfx("snub", { pitch: 0.8 });
    toast("You hear a " + (P.discovered.has(n.species.id) ? n.species.name : "hunter") + " behind you!", 2.4);
    tipOnce("hearing", "Something's behind you.");
  }
  function setSneak(on) {
    on = !!on && P.abilities.sneak > 0 && P.deadTimer <= 0;
    if (on === P.sneaking) return;
    P.sneaking = on;
    if (on && timeUniform.value - (P.sneakNoted ?? -99) > 15) {
      P.sneakNoted = timeUniform.value;
      note("sneaks");
    }
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
        tipOnce("glide", "Gliding! Jump again to drop.");
      }
      P.body.setAir(P.air.mode);
      return;
    }
    if (!P.abilities.jump) {
      nope("jump");
      tipOnce("noLegs", "Jumping needs legs.");
      return;
    }
    if (heightAt(P.pos.x, P.pos.z) < -0.9) return; // can't jump while swimming
    P.air = { h: 0, vy: 6 + 1.2 * P.abilities.jump, mode: "jump" };
    P.body.setAir("jump");
    o.sfx("jump", { pitch: 1 / Math.sqrt(P.scale) });
  }

  /* ---- abilities ------------------------------------------------------------ */
  // Combat recoveries come from the balance model; social moves have their own rhythm.
  /** Seconds until a move can be used again: the bite follows the equipped mouth's speed. */
  const cooldownOf = (kind) => (kind === "bite" ? biteCooldown(P.mouthId, COOLDOWN.bite) : COOLDOWN[kind]);
  const COOLDOWN = { bite: ATTACKS.bite.cooldown, strike: ATTACKS.strike.cooldown, charge: ATTACKS.charge.cooldown, spit: ATTACKS.spit.cooldown, sing: 1.5, dance: 1.6, charm: 1.5, pose: 1.4 };
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
  /** The mouth's extra reach, for bites only. */
  const biteReach = (kind) => (kind === "bite" ? P.mouth.reach : 0);
  /** Extra food-grabbing distance for mouths that snatch. */
  const snatchReach = () => (P.mouth.special === "snatch" ? 1.6 : 0);
  const reach = (n) => 2.2 * P.scale + (n ? n.body.radius * n.scale * 0.45 : 0);

  const usable = (n) => n && !n.dead && !n.following;
  const canSocialise = (t) => t.nest && t.nest.status === "neutral" && !t.member?.friend && !t.epic;
  /** How close you must be to use a move on a target. */
  const rangeFor = (kind, t) => (kind === "spit" ? 14 : kind === "charge" ? 12 : ABILITY_INFO[kind].kind === "social" ? 7 : reach(t) + 1 + biteReach(kind));

  /** Select a creature: Spore reveals the species' name the first time you meet it. */
  function select(n) {
    if (!usable(n)) return;
    if (P.target !== n) {
      P.pending = null;
      // Pick the move set that fits who you picked: chat with the friendly, fight the rest.
      if (performance.now() > (P.modeLock || 0)) setMode(canSocialise(n) ? "social" : "combat");
    }
    P.target = n;
    discover(n.species);
  }
  /** The first taste of a new kind of food is an evolutionary discovery: DNA. */
  function tasted(kind, label) {
    if (P.foods.has(kind)) return;
    P.foods.add(kind);
    P.dna += 5;
    checkMouthUnlocks();
    toast("New food: " + label + " · +5 DNA", 2.4);
  }
  /** Learn a species' name: by selecting one, or by watching its nest (sharp eyes do it from further away). */
  function discover(species) {
    const id = species.id;
    if (P.discovered.has(id)) return;
    P.discovered.add(id);
    revealing = { id, t: 0.9 };
    o.sfx("unlock");
    gainXp(4);
    P.dna += 3; // a new species in your Sporepedia
    if (id !== "own") note("discoveries");
    saveState();
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
        tipOnce("noSneak", "Sneaking needs a part.");
        return;
      }
      setSneak(!P.sneaking);
      if (P.sneaking) tipOnce("sneak", "Unseen. Strike now for an ambush.");
      return;
    }
    const info = ABILITY_INFO[kind],
      lvl = P.abilities[kind];
    if (!lvl) {
      nope(kind);
      tipOnce("noPart", "That move needs a part.");
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
      P.cooldowns[kind] = cooldownOf(kind);
      act(P, kind);
      act(t, kind);
      if (tribeReady && nearNest()) return callMate();
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
    if (kind === "pose" && t && canIntimidate(t)) {
      if (distTo(t) > rangeFor(kind, t)) {
        P.pending = { kind, t };
        return;
      }
      return intimidate(t);
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
    P.cooldowns[kind] = cooldownOf(kind);
    if (P.sneaking) setSneak(false);
    act(P, kind);
    voice(P, kind);
  }
  function perform(kind, t) {
    const info = ABILITY_INFO[kind],
      lvl = P.abilities[kind];
    if (!lvl || (P.cooldowns[kind] || 0) > 0) return;
    P.cooldowns[kind] = cooldownOf(kind);
    if (t) P.heading = Math.atan2(-(t.pos.z - P.pos.z), t.pos.x - P.pos.x);
    act(P, kind);
    voice(P, kind);
    if (info.kind === "combat") {
      if (kind !== "spit") knockTree();
      P.aggro = t ? 12 : P.aggro; // swinging at a tree doesn't make you look dangerous
      if (t && t.social) endEncounter(t.social);
      // Out of hiding: the first blow lands much harder, and you are seen.
      const ambush = P.sneaking ? 1.5 + 0.1 * P.abilities.sneak : 1;
      if (P.sneaking) setSneak(false);
      if (kind === "spit") {
        if (!t) return nope(kind);
        const m = new THREE.Mesh(spitGeo, spitMat);
        m.position.copy(P.pos).setY(P.pos.y + 1.5 * P.scale);
        scene.add(m);
        projectiles.push({ mesh: m, target: t, damage: playerDamage("spit", lvl, P.brain, ambush) * attackMult(), life: 2, ambush: ambush > 1 });
        return;
      }
      if (kind === "charge") {
        charging = 0.45;
        P.chargeDamage = playerDamage("charge", lvl, P.brain, ambush) * P.move.chargeMult * attackMult(); // weight behind it
        P.chargeAmbush = ambush > 1;
        P.chargeHit = new Set();
        return;
      }
      if (t && distTo(t) < reach(t) + ATTACKS[kind].range + biteReach(kind)) {
        if (ambush > 1) ambushHit(t);
        damageNPC(t, playerDamage(kind, lvl, P.brain, ambush) * (kind === "bite" ? P.mouth.bite : 1) * attackMult(), ambush > 1 ? 0.6 : ATTACKS[kind].stagger + (kind === "bite" && P.mouth.special === "stagger" ? 0.3 : 0));
      }
      return;
    }
    if (P.sneaking) setSneak(false); // showing off means being seen
    // Social encounter: the creature shows a move; answer with the same move at its level or better.
    if (t.nest.angry > 0 || (t.species.temper === "hostile" && t.calm <= 0)) {
      pop(t, "💢", "bad");
      tipOnce("hostile", "Too angry to listen. Pose, gift food, or fight.");
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
      // How warmly it starts: their personality, your charm, a gift, your size, and what you've done to their kind.
      const pers = PERSONALITIES[t.species.personality] || PERSONALITIES.proud;
      const past = P.treated[t.species.id];
      let start = 0.2 + pers.start + P.abilities.charm * 0.02 + (P.mouth.social - 1) * 0.1 + (P.mouth.special === "lure" ? 0.08 : 0) + (t.nest.gifted ? 0.25 : 0) - (past?.kills ? 0.12 : 0);
      // Your kind's reputation and cards, and what this nest itself remembers about you.
      start += mods.socialStart + socialBias(t.nest.mem) + rep.trust * 0.12 - fearOf() * 0.1;
      if (pers.fearsBig && P.scale > t.scale * 1.4) {
        start -= 0.08;
        pop(t, "😟");
        tipOnce("shyBig", "Shy of big bodies. Start gently.");
      }
      if (past?.kills) tipOnce("remember", "They remember what you did.");
      t.nest.gifted = false;
      const enc = { progress: Math.max(0.05, Math.min(0.6, start)), request: null, timer: ASK_TIME * pers.ask, misses: 0, leader: t, nest: t.nest, alpha: false, pers };
      for (const n of npcs)
        if (n.nest === t.nest && usable(n) && !n.member?.friend && Math.hypot(n.pos.x - t.pos.x, n.pos.z - t.pos.z) < 22) {
          n.social = enc;
          n.wake = 30;
        }
      t.social = enc;
      const alpha = [...npcs].find((n) => n.social === enc && n.alpha);
      if (alpha) {
        enc.leader = alpha;
        enc.alpha = true;
      }
      enc.request = nextRequest(enc.leader);
      activeEnc = enc;
      setMode("social");
      arcState.win = 0;
      act(enc.leader, enc.request);
      setTimeout(() => voice(enc.leader, enc.request), 400);
      [...npcs].filter((n) => n.social === enc).forEach((n) => pop(n, "❓"));
      tipOnce("encounter", "Copy the move they show.");
      return;
    }
    const need = socialNeed(t.species, t.social.request);
    if (kind === t.social.request) {
      const allies = packMembers().length;
      const gain = (lvl >= need ? 0.25 + 0.06 * (lvl - need) + allies * 0.04 : 0.08) * P.mouth.social; // the mouth shapes small talk
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
        enc.timer = ASK_TIME * (enc.pers?.ask || 1);
        [...npcs].filter((n) => n.social === enc).forEach((n) => act(n, enc.request));
        setTimeout(() => enc.leader.social === enc && voice(enc.leader, enc.request), 350);
      }
    } else missSocial(t, "wrong");
  }
  const ASK_TIME = 5; // seconds to answer a requested move

  /* ---- intimidation -----------------------------------------------------------
     Pose at something hostile and it becomes a display of might: your size, your weapons, your
     pack and your showmanship against its level, nerve and personality. Win and it backs off;
     lose and it comes at you. A non-lethal answer to predators, as Spore's early demos hinted. */
  const canIntimidate = (t) => !t.dead && !t.family && !t.following && !t.member?.friend && !t.neighbour && !t.stray && (t.rival || t.wild || t.raider || t.epic || t.rogue || t.hunting || t.nest?.angry > 0 || (t.species.temper === "hostile" && t.calm <= 0));
  function intimidate(t) {
    if ((P.cooldowns.pose || 0) > 0) return;
    P.cooldowns.pose = 4;
    act(P, "pose");
    voice(P, "pose");
    P.heading = Math.atan2(-(t.pos.z - P.pos.z), t.pos.x - P.pos.x);
    const rawMight = P.abilities.pose * 0.5 + Math.max(P.abilities.charge, P.abilities.strike, P.abilities.bite) * 0.6 + (P.scale / t.scale - 1) * 2.5 + packMembers().length * 0.5;
    const might = (rawMight + fearOf() * 1.5) * mods.intimidate; // a feared species is believed
    const pers = PERSONALITIES[t.species.personality];
    const nerve = (t.species.level || 1) * (pers?.resolve || 1) + (t.alpha ? 1 : 0) + (t.rogue ? 2 : 0) + (t.epic ? 99 : 0) + (t.wild?.A.role === "giant" ? 1.5 : 0);
    if (might >= nerve) {
      pop(t, "😨", "bad");
      o.sfx("ambush", { pitch: 0.8 });
      gainXp(4);
      note("intimidations");
      if (t.nest) remember(t.nest.mem, "intimidated");
      if (t.nest) {
        t.nest.cowed = 30;
        t.nest.angry = 0;
        [...npcs].filter((m) => m.nest === t.nest && !m.dead).forEach((m) => {
          m.hunting = false;
          m.windUp = 0;
          m.body.setCrouch(0);
        });
      } else if (t.rival && !t.neighbour) {
        // Stared down: the rival gives up the ground without a fight.
        t.angryRival = false;
        t.hunting = false;
        t.leaveT = 8;
        if (encounter?.n === t && !encounter.done) {
          encounter.chosen = "defend";
          hideChoice();
          resolveEncounter("defend");
        }
      } else if (t.wild) {
        for (const m of npcs)
          if (m.wild === t.wild && !m.dead) {
            m.wb.mode = "flee";
            m.wb.from = "you";
            m.wb.t = 6;
            m.windUp = 0;
            m.body.setCrouch(0);
            m.hunting = false;
          }
      } else {
        t.fleeT = 5;
        t.hunting = false;
      }
      tipOnce("intimidate", "Stared down.");
    } else {
      pop(t, "😤", "bad");
      o.sfx("snub");
      if (t.nest && t.nest.status === "neutral") t.nest.angry = 40;
      if (t.wildMember) t.wildMember.hurtByYou = timeUniform.value;
      tipOnce("intimidateFail", "Not impressed.");
    }
  }
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
    enc.progress = Math.max(0, enc.progress - (why === "slow" ? 0.08 : 0.1) * (enc.pers?.miss || 1)); // shy ones forgive less
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
  const SWARM_SPECIES = () => ({ name: P.record.name, record: P.record, abilities: P.abilities, favourite: ["sing"], maxHealth: npcHealth(1, 0, "kin"), diet: P.diet, temper: "friendly", level: 1 });

  function ambushHit(n) {
    note("ambushes");
    o.sfx("ambush");
    pop(n, "💥", "good");
    tipOnce("ambush", "Ambush!");
  }
  /** How strong a creature is as a fighter: its health times what it hits for. */
  const npcPower = (n) => Math.max(1, n.maxHealth * npcHit(n));
  const playerPower = () => Math.max(1, P.maxHealth * playerDamage("bite", P.abilities.bite || 1, P.brain));
  const courageFor = (n) => courageOf({ role: roleOf(n), alpha: n.alpha, epic: !!n.epic, rogue: !!n.rogue, brave: n.brave ?? 0.5 });
  function damageNPC(n, dmg, stun = 0) {
    if (n.dead) return;
    // A creature in a fight that sees a blow coming may sidestep it (never an ambush or a charge).
    if (!n.member?.friend && !n.family && n.stun <= 0 && stun < 0.6 && (n.cs === "approaching" || n.cs === "engaging") && (n.dodgeCool || 0) <= 0 && !(n.windUp > 0) && Math.random() < dodgeChance(courageFor(n))) {
      n.dodgeCool = 3;
      n.dodgeT = 0.45;
      n.backDir = Math.random() < 0.5 ? -1 : 1;
      n.cs = "dodging";
      pop(n, "💨");
      return;
    }
    // Striking first at something that wasn't after you is starting a fight.
    if (!n.provoked && !n.hunting && !n.raider && !(n.nest?.angry > 0) && !(n.wild && (n.wb?.mode === "hunt" || n.wb?.mode === "pounce"))) {
      n.provoked = true;
      note("fightsStarted");
    }
    if (n.nest && timeUniform.value - n.nest.memHurt > 2) {
      n.nest.memHurt = timeUniform.value;
      remember(n.nest.mem, "hurt");
    }
    n.engagedT = 12; // it is in a fight now: it commits
    // A nest whose alpha has fallen has lost its nerve and goes down easier.
    if (n.nest?.cowed > 0) dmg *= 1.5;
    n.health -= dmg;
    n.hurtAt = timeUniform.value;
    n.wake = 30;
    if (n.wild) {
      n.wildMember.hurtByYou = timeUniform.value; // it (and its kind nearby) will remember
      eco.onHurt(n);
    }
    n.body.hit();
    // Staggers are short and can't be chained (see balance.js): no stun-locking.
    const was = n.stun;
    applyStagger(n, stun, timeUniform.value);
    if (n.stun > was && n.windUp > 0) {
      n.windUp = 0; // a stagger interrupts an attack being wound up
      n.body.setCrouch(0);
    }
    if (n.social) endEncounter(n.social);
    // Its nestmates, packmates and family rally to it.
    for (const m of npcs) if (m !== n && !m.dead && ((m.nest && m.nest === n.nest) || (m.family && n.family) || (m.following && n.following)) && Math.hypot(m.pos.x - n.pos.x, m.pos.z - n.pos.z) < 22) m.defendT = 6;
    // Hurt creatures fall back only when genuinely low on health or hopelessly outmatched, once per fight,
    // for a few seconds, towards home (see combat-ai.js). Raiders give up for good.
    if (n.health > 0 && !n.fleeChecked && !n.member?.friend) {
      const courage = courageFor(n);
      if (n.health / n.maxHealth < retreatThreshold(courage) || outmatched(playerPower() / npcPower(n), courage)) {
        n.fleeChecked = true;
        if (n.raider) n.retreat = 6;
        else {
          n.fleeT = RETREAT_TIME[0] + Math.random() * (RETREAT_TIME[1] - RETREAT_TIME[0]);
          n.calm = Math.max(n.calm, RECOVER_TIME); // out of the fight while it walks home and recovers
        }
        n.hunting = false;
        n.engagedT = 0;
        n.cs = "retreating";
        pop(n, "😨", "bad");
      }
    }
    if (n.nest && n.nest.status === "neutral" && !(n.nest.cowed > 0)) n.nest.angry = 40; // the whole nest turns on you
    // A rival that falls back has been seen off.
    if (n.rival && n.fleeChecked && n.health > 0 && encounter?.n === n && !encounter.done) {
      resolveEncounter("defend");
      n.angryRival = false;
      n.leaveT = 8;
    }
    // Strike at a rival before choosing: that is your answer.
    if (n.rival && !n.angryRival && !n.neighbour && encounter?.n === n && !encounter.chosen) chooseEncounter("defend");
    if (n.member?.friend) return;
    if (n.health <= 0) killNPC(n);
  }
  function killNPC(n) {
    if (encounter?.n === n && !encounter.done) resolveEncounter(n.stray ? "hunt" : "defend");
    n.dead = true;
    n.hunting = false;
    n.body.die();
    o.sfx("death");
    dropCarcass(n.pos.x, n.pos.z, Math.max(2, Math.round(n.scale * 2))).byYou = true;
    const level = n.species.level || 1;
    // Rewards in proportion to the risk: wildlife by archetype (small prey is a snack, a giant a feat).
    const wildXp = n.wild ? n.wild.A.xp[0] + n.wild.A.xp[1] * level : 0;
    const tough = n.epic ? 120 : n.rogue ? 60 : n.wild ? wildXp : n.alpha ? 24 + level * 6 : 8 + level * 4;
    gainXp(tough, true);
    P.dna += n.epic ? 30 : n.rogue ? 16 : n.wild ? 1 + Math.round(wildXp / 6) : 3 + level + (n.alpha ? 3 : 0);
    if (n.wild) {
      const { rescued, saved: spared } = eco.onKilled(n, true);
      if (rescued) {
        // It was hunting a herd: you saved them, and they will remember.
        note("defended");
        if (spared && !spared.dead) pop(spared, "💚", "good");
      }
    } else eco.alarmAround(n.pos.x, n.pos.z, 20, n);
    if (n.wild) {
      // The herd refills in a few minutes: new young replace the fallen.
      n.wildMember.alive = false;
      n.wildMember.npc = null;
      n.wildMember.back = timeUniform.value + 180 + Math.random() * 90;
    }
    treat(n.species, "kills");
    if (n.wild) note(n.wild.A.role === "prey" || n.wild.A.role === "grazer" ? "hunts" : "predatorKills");
    else if (n.epic || n.rogue) note("predatorKills");
    else if (n.raider) {
      note("predatorKills");
      note("defended");
    } else if (n.member) note("nestKills");
    if (n.member) remember(n.nest.mem, n.alpha ? "killAlpha" : "kill");
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
        tipOnce("alpha", "The alpha fell. Its nest loses its nerve.");
      }
      mourn(n);
      if (nest.members.every((m) => !m.alive) && nest.status !== "extinct") {
        nest.status = "extinct";
        abandonNest(nest);
        P.extinctions++;
        note("extinctions");
        gainXp(30 + nest.species.level * 10, true);
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
    note("befriended");
    remember(n.nest.mem, "befriend", 0.5);
    if (!quiet) o.sfx("mate");
    gainXp(10 + (n.species.level || 1) * 4, true);
    P.dna += 2 + (n.species.level || 1);
    const nest = n.nest;
    if (nest.members.filter((m) => m.alive).every((m) => m.friend) && nest.status !== "allied") {
      nest.status = "allied";
      P.alliances++;
      note("alliances");
      remember(nest.mem, "alliance");
      gainXp(30 + nest.species.level * 10, true);
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
    const ids = creaturePartIds(species.record).filter((id) => !owned.has(id) && !isMouth(id));
    if (!ids.length) {
      P.dna += 10;
      return;
    }
    const id = ids[Math.floor(Math.random() * ids.length)];
    P.unlocked.add(id);
    o.onUnlock?.(creaturePart(id), source);
  }

  /* ---- progression ----------------------------------------------------- */
  /** Brain 5 and the final stretch filled: mating now founds the tribe. */
  let tribeReady = !!save.tribeReady || (P.brain >= 5 && P.xp >= XP_FINAL);
  const xpNeed = () => (P.brain >= 5 ? XP_FINAL : XP_TO_NEXT[P.brain]);
  /**
   * Experience fills the brain bar. A full bar grows the brain by itself (no mating needed): the
   * brain swells in its bubble and the creature with it. At brain 5 the bar fills once more for the
   * final growth, after which mating at the nest leads on to the Tribal Stage.
   */
  function gainXp(amount) {
    if (tribeReady) return;
    P.xp = Math.min(xpNeed(), P.xp + amount);
    if (P.xp < xpNeed() || brainFx || intro || cine || P.deadTimer > 0) return; // checked again once free
    if (P.brain < 5) growBrain();
    else {
      tribeReady = true;
      playBrainGrowth(5, true, () => tipOnce("tribeReady", "Fully evolved. Mate at your nest to found a tribe.", 5));
      o.onChronicle?.({ key: "brain:final", stage: "creature", icon: "🧠", text: "The brain reached its full size: ready to found a tribe." });
      saveState();
    }
  }
  function growBrain() {
    const from = P.brain;
    P.xp = 0;
    P.brain = Math.min(5, P.brain + 1);
    o.onChronicle?.({ key: "brain:" + P.brain, stage: "creature", icon: "🧠", text: "Reached brain level " + P.brain + "." });
    P.maxHealth = playerHealth(P.brain, P.abilities.health);
    P.health = P.maxHealth;
    P.hunger = Math.max(P.hunger, 80);
    evolveIsland();
    migrateNests(1 + Math.floor(Math.random() * 2));
    // A bigger brain moves on: your species migrates once the growth is over.
    P.migrateDue = true; // one migration per level: coast → forest → swamp → badlands → volcano
    let after = null;
    if (P.brain >= 5 && !P.card) {
      // The species' instinct, from everything it did; its colour is the classic creature card.
      instinct = instinctFor(ledger);
      P.card = COLOR_CARD[INSTINCTS[instinct].color];
      mods = traitMods(o.cellCard, instinct);
      leaning = instinct;
      after = () => o.onCard(P.card, instinctCard(instinct, ledger)); // revealed once the growth is over
    }
    // New mouths and the card are announced once the growth is over, so nothing covers it.
    const card = after;
    playBrainGrowth(from, false, () => {
      checkMouthUnlocks();
      card?.();
    });
    saveState();
  }
  /** Mating at the nest: a new generation to design, or (fully evolved) the step into the Tribal Stage. */
  function mate() {
    P.health = P.maxHealth;
    P.hunger = 100;
    o.sfx("mate");
    recordGeneration();
    if (tribeReady) {
      saveState(); // saved before the cutscene: nothing is lost if it is interrupted
      return playStickThrow();
    }
    o.onMate(editorState());
    saveState();
  }

  /* ---- brain growth, shown the way Spore did: a bubble by the head with the brain inside ------
     The brain swells in its bubble while the camera closes in; the body grows with it. The final
     growth bursts out of the box. */
  function playBrainGrowth(fromLevel, final, after = null) {
    const reduced = !!o.reducedMotion?.();
    const T = final ? CUTSCENES.brainFinal : CUTSCENES.brain;
    const el = $h("#chBrainFx");
    el.hidden = false;
    el.className = "chBrainFx" + (final ? " final" : "") + (reduced ? " still" : "");
    const fromScale = P.scale,
      toScale = 0.9 + (P.brain - 1) * 0.12;
    brainFx = {
      t: 0,
      T,
      k: reduced ? 1 / 0.6 : 1, // reduced motion runs it faster
      final,
      from: BRAIN_SIZE[Math.max(1, Math.min(5, fromLevel))],
      to: final ? BRAIN_FINAL : BRAIN_SIZE[P.brain],
      fromScale,
      toScale,
      zoom0: view.zoom,
      after,
      beats: beatClock({ grow: T.pop, burst: T.burst ?? 99, done: T.hold }),
    };
    P.invulnerable = Math.max(P.invulnerable, T.end + 0.5);
    o.sfx("growth");
    requestAnimationFrame(() => el.classList.add("show"));
  }
  function updateBrainFx(dt) {
    const f = brainFx;
    f.t += dt * f.k;
    const T = f.T,
      t = f.t;
    for (const b of f.beats.crossed(t)) {
      if (b === "grow") o.sfx("mate", { pitch: 0.8 });
      if (b === "burst") {
        $h("#chBrainFx").classList.add("burst");
        o.sfx("unlock");
        pop(P, "✨", "good");
      }
      if (b === "done") $h("#chBrainFx").classList.remove("show");
    }
    // The brain grows in three heartbeats; the body grows with it.
    const g = span(t, T.pop, T.grow);
    const beat = Math.min(1, ease(g) + 0.08 * Math.sin(g * Math.PI * 6) * (1 - g));
    const size = mix(f.from, f.to, beat);
    $h("#chBrainFx").style.setProperty("--b", size.toFixed(3));
    P.scale = mix(f.fromScale, f.toScale, ease(g));
    P.body.root.scale.setScalar(P.scale);
    // The camera closes in on the head, then lets go.
    const close = Math.sin(Math.PI * span(t, 0, T.end));
    view.zoom = f.zoom0 * (1 - 0.34 * close);
    placeBubble();
    if (t >= T.end) {
      view.zoom = f.zoom0;
      $h("#chBrainFx").hidden = true;
      brainFx = null;
      const next = nextRegion();
      if (!f.final) hint("Brain " + P.brain + ": pack of " + PACK_SIZE[P.brain] + (next ? " · " + next.name + " awaits" : ""), 4);
      f.after?.();
      gainXp(0); // more experience may already be waiting
    }
  }
  /** Keep the bubble beside the head, with its dotted line pointing at it. */
  function placeBubble() {
    const head = tmp
      .copy(P.body.mouthLocal)
      .multiplyScalar(P.scale)
      .applyAxisAngle(UP, P.heading)
      .add(P.pos);
    head.y = P.pos.y + P.body.height * P.scale * 0.85;
    const pt = project(head);
    const el = $h("#chBrainFx");
    const box = 96;
    const bx = Math.max(12, Math.min(innerWidth - box - 12, pt.x + 46)),
      by = Math.max(70, Math.min(innerHeight - box - 220, pt.y - box - 70));
    el.style.setProperty("--bx", bx + "px");
    el.style.setProperty("--by", by + "px");
    const line = $h("#chBfLine");
    line.setAttribute("x1", bx + box * 0.18);
    line.setAttribute("y1", by + box);
    line.setAttribute("x2", pt.x);
    line.setAttribute("y2", pt.y);
    $h("#chBfDot").setAttribute("cx", pt.x);
    $h("#chBfDot").setAttribute("cy", pt.y);
  }
  const UP = new THREE.Vector3(0, 1, 0);

  /* ---- Creature → Tribal: the stick ------------------------------------------------------
     Spore's moment: at the nest, with its family gathered, the creature picks up a stick, raises it,
     and throws it high into the sky. The camera follows it up; it comes down in the Tribal Stage,
     into the tribe's first campfire. */
  const stickGeo = new THREE.CylinderGeometry(0.08, 0.12, 2, 7).translate(0, 1, 0);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.85, flatShading: true, emissive: 0x2a1606 });
  function playStickThrow() {
    if (cine) return;
    const reduced = !!o.reducedMotion?.();
    P.target = null;
    P.pending = null;
    setSneak(false);
    setSprint(false);
    clearCarry();
    closeOrders();
    // Face out over the nest; the stick lies in front.
    const fx = Math.cos(P.heading),
      fz = -Math.sin(P.heading);
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.scale.setScalar(Math.max(1, P.scale));
    const lie = { x: P.pos.x + fx * (1.6 + P.scale), z: P.pos.z + fz * (1.6 + P.scale) };
    stick.position.set(lie.x, heightAt(lie.x, lie.z) + 0.08, lie.z);
    stick.rotation.set(0, -P.heading, Math.PI / 2);
    scene.add(stick);
    // Film from the most open side, so trees don't block the look up into the sky.
    const camDist = (5.5 + P.scale * 2.2) * Math.max(1, 0.8 / camera.aspect);
    const yaws = [2.5, -2.5, 1.9, -1.9, 3.1, 1.2, -1.2].map((d) => P.heading + d);
    const camYawCine = yaws.find((y) => world.isOpen(P.pos.x - Math.cos(y) * camDist, P.pos.z + Math.sin(y) * camDist, 4)) ?? yaws[0];
    cine = {
      t: 0,
      k: reduced ? 1 / 0.6 : 1,
      T: CUTSCENES.stickThrow,
      yaw: camYawCine,
      dist: camDist,
      stick,
      lie,
      vel: null,
      spin: 0,
      beats: beatClock({ pick: CUTSCENES.stickThrow.gather, raise: CUTSCENES.stickThrow.pickUp, throw: CUTSCENES.stickThrow.raise, flash: CUTSCENES.stickThrow.flash }),
      frame: openFrame({ kicker: "Creature Stage complete", title: P.record.name, onSkip: () => (cine ? (cine.t = Math.max(cine.t, CUTSCENES.stickThrow.flash)) : null), flash: "#fff3d6" }),
      cam0: camera.position.clone(),
      // Family gather round in a loose half circle facing you.
      ring: family.filter((n) => !n.dead).map((n, k, all) => {
        const a = P.heading + Math.PI + (k - (all.length - 1) / 2) * 0.55;
        return { n, x: P.pos.x + Math.cos(a) * (4 + P.scale), z: P.pos.z - Math.sin(a) * (4 + P.scale) };
      }),
    };
    hud.classList.add("intro");
    o.sfx("growth");
  }
  function updateStickThrow(dt) {
    const c = cine;
    // Slow motion at the top of the throw: the moment hangs.
    const slow = c.t > c.T.throw + 0.6 && c.t < c.T.apex + 0.4 ? 0.45 : 1;
    c.t += dt * c.k * slow;
    const t = c.t,
      T = c.T;
    for (const b of c.beats.crossed(t)) {
      if (b === "pick") {
        P.body.setCrouch(1);
        act(P, "bite");
      }
      if (b === "raise") {
        P.body.setCrouch(0);
        act(P, "pose");
        voice(P, "pose");
        c.ring.forEach(({ n }) => !n.dead && pop(n, "❗", "good"));
      }
      if (b === "throw") {
        o.sfx("charge");
        c.vel = new THREE.Vector3(Math.cos(P.heading) * 1.2, 15, -Math.sin(P.heading) * 1.2);
        c.frame.title(true);
        c.ring.forEach(({ n }) => !n.dead && act(n, "dance"));
      }
      if (b === "flash") {
        c.frame.flash(true);
        o.sfx("unlock");
      }
    }
    // The family gathers.
    for (const r of c.ring) {
      if (r.n.dead) continue;
      r.n.pos.x += (r.x - r.n.pos.x) * Math.min(1, dt * 2);
      r.n.pos.z += (r.z - r.n.pos.z) * Math.min(1, dt * 2);
      r.n.heading = Math.atan2(-(P.pos.z - r.n.pos.z), P.pos.x - r.n.pos.x);
      r.n.calm = 5;
    }
    // The stick: on the ground, in the mouth, held high, then away into the sky.
    // Held in a hand if it has arms, otherwise in its jaws.
    const hand = P.body.handAnchor?.();
    const mouth = hand ? hand.getWorldPosition(lookTmp) : lookTmp.copy(P.body.mouthLocal).multiplyScalar(P.scale).applyAxisAngle(UP, P.heading).add(P.pos);
    const s = c.stick;
    if (t < T.raise) {
      const k = ease(span(t, T.gather, T.pickUp));
      s.position.set(mix(c.lie.x, mouth.x, k), mix(heightAt(c.lie.x, c.lie.z) + 0.08, mouth.y + 0.1, k), mix(c.lie.z, mouth.z, k));
      s.rotation.set(0, -P.heading, (Math.PI / 2) * (1 - k * 0.6));
      // Lifting it overhead.
      const up = ease(span(t, T.pickUp, T.raise));
      s.position.y += up * P.body.height * P.scale * 0.9;
      s.rotation.z = mix(s.rotation.z, 0.15, up);
    } else if (c.vel) {
      c.vel.y -= 9 * dt * slow;
      s.position.addScaledVector(c.vel, dt * slow);
      c.spin += dt * slow * 7;
      s.rotation.set(c.spin, -P.heading, c.spin * 0.7);
    }
    P.body.root.position.copy(P.pos);
    P.body.root.rotation.y = P.heading;
    P.body.update(dt, 0);
    if (t < T.throw) P.body.lookAt(lookTmp.set(s.position.x, s.position.y, s.position.z));
    else P.body.lookAt(lookTmp.set(s.position.x, s.position.y + 4, s.position.z));
    // Camera: low and in front, then tilting up after the stick into the sky.
    const yaw = c.yaw,
      dist = c.dist * (1 - 0.25 * ease(span(t, T.throw, T.apex))); // closer and lower as it looks up
    const look = ease(span(t, T.throw, T.apex));
    tmp.set(P.pos.x - Math.cos(yaw) * dist, P.pos.y + 1.1 - look * 0.5, P.pos.z + Math.sin(yaw) * dist);
    const settle = ease(span(t, 0, T.gather));
    camera.position.lerpVectors(c.cam0, tmp, settle);
    const focusY = mix(P.pos.y + 1.2 * P.scale, s.position.y, look);
    camera.lookAt(mix(P.pos.x, s.position.x, look * 0.6), focusY, mix(P.pos.z, s.position.z, look * 0.6));
    if (t >= T.end) finishStickThrow();
  }
  function finishStickThrow() {
    const c = cine;
    if (!c) return;
    scene.remove(c.stick);
    o.onChronicle?.({ key: "creature:tribe", stage: "creature", icon: "🔥", text: "Picked up a stick and threw it high: the first step towards a tribe." });
    cine = null;
    tribeReady = false;
    saveState();
    // The frame stays white while the Tribal Stage loads; it lifts there.
    o.onTribe?.({ cinematic: true, frame: c.frame });
  }
  /**
   * As your species evolves, so does everyone else's: every surviving nest gains a part, and every
   * species moves to its level for your new brain (rogues stay one above you).
   */
  function evolveIsland() {
    let count = 0;
    for (const nest of nests) {
      if (nest.status === "extinct") continue;
      nest.base = evolveSpecies(nest.base);
      nest.species = atLevel(nest.base, nestLevel(nest.index));
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
    for (const r of rogues) {
      r.species = atLevel(r.base, rogueLevel());
      if (r.npc && !r.npc.dead) {
        const { x, z } = r.npc.pos;
        despawnNPC(r.npc);
        r.npc = spawnNPC(r.species, x, z, { rogue: r });
      }
    }
    eco.relevel(); // wildlife grows with you too (new bodies as they respawn)
    if (count) tipOnce("evolve", "The island evolves with you.");
  }
  /** Spore's migrating herds: a neutral nest packs up and moves somewhere new nearby. */
  function migrateNests(howMany) {
    const movable = nests.filter((n) => n.status === "neutral" && n.angry <= 0 && !n.members.some((m) => m.npc?.social));
    for (let k = 0; k < howMany && movable.length; k++) {
      const nest = movable.splice(Math.floor(Math.random() * movable.length), 1)[0];
      const spot = freeNestSpot(nest);
      if (!spot) continue;
      nest.site = { x: spot.x, z: spot.z };
      nest.mesh.position.set(spot.x, heightAt(spot.x, spot.z) + 0.2, spot.z);
      nest.migrating = 45;
    }
    saveState();
  }
  /** Open plains a short trek from a nest, clear of your nest, you and the other nests. */
  function freeNestSpot(self) {
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * TAU,
        d = 25 + Math.random() * 35;
      const x = self.site.x + Math.cos(a) * d,
        z = self.site.z + Math.sin(a) * d;
      if (!world.isOpen(x, z, 6)) continue;
      if (Math.hypot(x - nestAt.x, z - nestAt.z) < 32 || Math.hypot(x - P.pos.x, z - P.pos.z) < 25) continue;
      if (P.migration && Math.hypot(x - P.migration.x, z - P.migration.z) < 32) continue;
      if (nests.some((n) => n !== self && Math.hypot(n.site.x - x, n.site.z - z) < 28)) continue;
      return { x, z };
    }
    return null;
  }

  /* ---- migration ---------------------------------------------------------------
     As in Spore, your species moves on as it grows: after each new brain level a fresh nest site is
     picked out on the plains, and you lead your family there. A beam of light marks the spot. */
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.8, 70, 18, 1, true).translate(0, 35, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  beacon.visible = false;
  scene.add(beacon);
  function pickMigrationSite() {
    const lived = [nestAt, ISLAND.nest, ...P.pastHomes];
    let best = null,
      bestScore = -Infinity;
    for (let tries = 0; tries < 200; tries++) {
      const a = Math.random() * TAU,
        d = 70 + Math.random() * 70;
      const x = nestAt.x + Math.cos(a) * d,
        z = nestAt.z + Math.sin(a) * d;
      if (!world.isOpen(x, z, 8, ISLAND.beach - 12)) continue;
      const nearestNest = Math.min(...nests.map((n) => Math.hypot(n.site.x - x, n.site.z - z)));
      if (nearestNest < 30) continue;
      // Somewhere new (far from everywhere you have lived) with a little room around it.
      const score = Math.min(...lived.map((v) => Math.hypot(v.x - x, v.z - z))) + Math.min(nearestNest, 60) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    return best;
  }
  function showBeacon() {
    beacon.visible = !!P.migration;
    if (P.migration) beacon.position.set(P.migration.x, heightAt(P.migration.x, P.migration.z), P.migration.z);
  }
  /** The region your species moves on to next, if your brain has outgrown the current one. */
  const nextRegion = () => {
    const i = regionIndex(homeRegion);
    return i + 1 < REGIONS.length && P.brain - 1 > i ? REGIONS[i + 1] : null;
  };
  function startMigration() {
    P.migrateDue = false;
    const next = nextRegion();
    if (next) {
      // On to a new region: the way out is across the island, on the far shore.
      P.migration = { x: world.exitSpot.x, z: world.exitSpot.z, to: next.id };
      showBeacon();
      family.forEach((n) => (n.trek = true));
      o.sfx("friend");
      toast("Your species is ready to migrate to " + next.name + "! Lead your family to the far shore", 5);
      tipOnce("migrateRegion", "Follow the 🐾 to new land.");
      saveState();
      return;
    }
    const to = pickMigrationSite();
    if (!to) {
      saveState();
      return;
    }
    P.migration = to;
    showBeacon();
    family.forEach((n) => (n.trek = true));
    o.sfx("friend");
    toast("Your species is migrating! Lead your family to the new nest", 4.5);
    tipOnce("migrate", "Follow the 🐾. Family nearby come too.");
    saveState();
  }
  function finishMigration() {
    note("migrations");
    if (P.migration.to) return changeRegion(P.migration.to, "migrate");
    P.pastHomes = [...P.pastHomes, { x: nestAt.x, z: nestAt.z }].slice(-6);
    nestAt.x = P.migration.x;
    nestAt.z = P.migration.z;
    P.migration = null;
    showBeacon();
    playerNest.position.set(nestAt.x, heightAt(nestAt.x, nestAt.z) + 0.2, nestAt.z);
    // Family who kept up settle in; any left far behind find their own way to the new nest.
    family.forEach((n, k) => {
      n.trek = false;
      if (!n.dead && !n.following && Math.hypot(n.pos.x - nestAt.x, n.pos.z - nestAt.z) > 30) {
        const a = (k / FAMILY_SIZE) * TAU + 0.4;
        n.pos.set(nestAt.x + Math.cos(a) * 6, 0, nestAt.z + Math.sin(a) * 6);
        n.pos.y = heightAt(n.pos.x, n.pos.z);
      }
    });
    dust(nestAt.x, nestAt.z, 10, eggMat);
    o.sfx("friend");
    pop(P, "🏠", "good");
    toast("You've settled a new nest", 3);
    gainXp(20);
    P.dna += 10;
    saveState();
  }
  function updateMigration() {
    if (!atHome || leaving) return; // migrations start and end in your home region
    if (!P.migration) {
      if (P.migrateDue && !paused && !courtship && !raid && !brainFx && !cine && P.deadTimer <= 0) startMigration();
      return;
    }
    if (Math.hypot(P.pos.x - P.migration.x, P.pos.z - P.migration.z) < 10) finishMigration();
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
    clearCarry();
    closeOrders();
    setSneak(false);
    setSprint(false);
    P.air = null;
    P.body.setAir(null);
    P.deaths++;
    P.deadTimer = 2.2;
    P.body.die();
    o.sfx("death");
    toast(reason || "You died", 2.5);
    struggleHint(reason || "");
    // Beaten defending the nest: the rival takes what it came for.
    if (encounter?.n.angryRival && !encounter.done) {
      encounter.n.angryRival = false;
      encounter.n.hunting = false;
      encounter.n.raiding = "lost";
    }
    packMembers().forEach((n) => (n.following = false)); // the pack scatters
    if (!tribeReady) P.xp = Math.max(0, P.xp - xpNeed() * 0.15);
  }
  /** Dying the same way twice running: one short, practical pointer (once per kind of death). */
  let lastDeath = null;
  function struggleHint(reason) {
    const kind = /starved/i.test(reason) ? "hunger" : /lava/i.test(reason) ? "lava" : /deep|drown/i.test(reason) ? "deep" : /raid/i.test(reason) ? "raid" : "creature";
    const again = kind === lastDeath;
    lastDeath = kind;
    if (!again) return;
    const text = {
      hunger: "Hungry? Fruit trees, carcasses, and your larder.",
      lava: "Keep clear of glowing ground.",
      deep: "Stay out of deep water.",
      raid: "Order your family to Defend 🛡, or bring a pack.",
      creature: P.abilities.sneak ? "Sneak 👣 past, sprint 💨 away, or bring a pack." : "Sprint 💨 away, or bring a pack.",
    }[kind];
    setTimeout(() => tipOnce("struggle_" + kind, text, 4.5), 2600);
  }
  function respawn() {
    // You always wake at your nest: from another region, that means going home.
    if (!atHome) return changeRegion(homeRegion, "travel");
    rebuildPlayer();
    const at = world.resolve(nestAt.x, nestAt.z - 7, 1.2);
    P.pos.set(at.x, 0, at.z);
    P.health = P.maxHealth * 0.7;
    P.hunger = 60;
    P.invulnerable = 3;
    P.target = null;
    saveState();
  }

  /* ---- saving ---------------------------------------------------------- */
  /** Parts you have seen on a creature you have discovered: locked ones show their name in the editor only if seen. */
  function seenParts() {
    const out = new Set(creaturePartIds(P.record));
    const seen = (sp) => sp && P.discovered.has(sp.id) && creaturePartIds(sp.record).forEach((id) => out.add(id));
    nests.forEach((n) => seen(n.species));
    rogues.forEach((r) => seen(r.species));
    epics.forEach((e) => seen(e.species));
    return out;
  }
  /** Everything the creature editor needs: the design, what you may use, what you have achieved, and your DNA. */
  function editorState() {
    return { record: P.record, unlocked: unlockedParts(), seen: seenParts(), progress: mouthProgress(), dna: P.dna, brain: P.brain };
  }
  function snapshot() {
    regionSaves[regionId] = {
      bonesTaken: [...P.bonesTaken],
      rogues: rogues.map((r) => r.alive),
      epics: epics.map((e) => e.alive),
      wild: eco.save(),
      nests: nests.map((n) => ({ status: n.status, evo: n.evo, site: { x: n.site.x, z: n.site.z }, mem: n.mem, members: n.members.map((m) => ({ alive: m.alive, friend: m.friend })) })),
    };
    return {
      worldVersion: WORLD_VERSION,
      region: regionId,
      homeRegion,
      unlockedRegions: [...unlockedRegions],
      regions: regionSaves,
      arrival: null,
      home: { x: nestAt.x, z: nestAt.z },
      pastHomes: P.pastHomes,
      migration: P.migration,
      migrateDue: P.migrateDue,
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
      larder: P.larder,
      familyOrder: P.familyOrder,
      treated: P.treated,
      foods: [...P.foods],
      ledger,
      instinct,
      leaning,
      encounters: { clock: Math.round(enc.clock), last: enc.last, done: enc.done, neighbour: enc.neighbour },
      tribeReady,
      discovered: [...P.discovered],
      tips: [...seenTips],
    };
  }
  function saveState() {
    if (leaving) return; // the save for the next region is already written
    checkMouthUnlocks(); // alliances and wins land here: new mouths are announced as they are earned
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
    if (i >= 0) {
      // 1-4 are the four moves on screen; 5-8 still reach the other set (and switch to it).
      const set = i < 4 ? (P.mode === "social" ? SOCIAL : COMBAT) : P.mode === "social" ? COMBAT : SOCIAL;
      const kind = set[i % 4];
      if (i >= 4) setMode(P.mode === "social" ? "combat" : "social");
      useAbility(kind);
    } else if (e.key === "r" || e.key === "R") setMode(P.mode === "social" ? "combat" : "social", true);
    else if (e.key === " ") {
      e.preventDefault();
      jump();
    } else if (e.key === "c" || e.key === "C") useAbility("sneak");
    else if (e.key === "q" || e.key === "Q") useAbility("card");
    else if (e.key === "m" || e.key === "M") nearNest() && !P.migration ? callMate() : toggleMap();
    else if (e.key === "e" || e.key === "E") eatEgg();
    else if (e.key === "f" || e.key === "F") doCarry();
    else if (e.key === "o" || e.key === "O") ($h("#chOrders").hidden ? openOrders() : closeOrders());
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
  const nearNest = () => atHome && Math.hypot(P.pos.x - nestAt.x, P.pos.z - nestAt.z) < 14;
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
  $h("#chGuide").onclick = () => {
    $h("#chMenuPanel").hidden = true;
    $h("#chGuidePanel").hidden = false;
    $h("#chGuideClose").focus();
  };
  $h("#chGuideClose").onclick = () => ($h("#chGuidePanel").hidden = true);
  $h("#chSoup").onclick = () => {
    saveState();
    o.onExit();
  };
  P.mode = P.diet === "meat" ? "combat" : "social";
  hud.dataset.mode = P.mode;
  renderAbilityButtons();

  const playerNest = world.makeNestMesh(nestAt.x, nestAt.z, P.record.colors.accent);
  playerNest.scale.setScalar(1.3);
  playerNest.visible = atHome; // your nest is in your home region
  showBeacon();

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

  /* ---- the map ---------------------------------------------------------------
     Spore's minimap in the corner, turning with the camera; tap it (or press M) for the whole island. */
  const minimap = createMinimap(hud, { onOpen: () => toggleMap() });
  let islandPic = null,
    mapClock = 0,
    islandMap = null;
  // The relief picture takes a moment to draw, so it is made just after the stage appears.
  const picTimer = setTimeout(() => {
    islandPic = islandPicture(320);
    minimap.setPicture(islandPic);
  }, 250);
  /** What the maps show. The minimap is a local radar; the island map shows what you have found. */
  function mapMarkers(full) {
    const out = [];
    const near = (x, z, r) => Math.hypot(x - P.pos.x, z - P.pos.z) < r;
    // Sharp eyes spot fossils further off.
    for (const b of world.bonePiles) if (!b.taken && (full ? b.seen : near(b.x, b.z, 30 + P.abilities.sight * 10))) out.push({ kind: "fossil", x: b.x, z: b.z });
    for (const n of nests) {
      const known = P.discovered.has(n.species.id);
      const state = n.status === "allied" ? "allied" : n.status === "extinct" ? "extinct" : n.angry > 0 ? "angry" : known && n.species.temper === "hostile" ? "wary" : "neutral";
      const label = full && known ? n.species.name + (n.status === "neutral" ? " · Lv " + n.species.level : "") : null;
      out.push({ kind: "nest", x: n.site.x, z: n.site.z, state, known, label });
    }
    if (atHome) out.push({ kind: "home", x: nestAt.x, z: nestAt.z, edge: true, label: full ? "Your nest" : null });
    for (const e of [...epics, ...rogues]) {
      if (!e.alive) continue;
      const at = e.npc && !e.npc.dead ? e.npc.pos : null;
      if (full && P.discovered.has(e.species.id)) {
        const h = e.anchor ? e.anchor : rogueHome(e);
        out.push({ kind: "danger", x: h.x, z: h.z, label: e.species.name });
      } else if (!full && at) out.push({ kind: "danger", x: at.x, z: at.z, edge: true });
    }
    if (!full)
      for (const n of npcs) {
        if (n.dead || n.abducted) continue;
        if (n.following) out.push({ kind: "pack", x: n.pos.x, z: n.pos.z });
        // Hunters show up when you can see them or hear them coming.
        else if ((n.hunting || n.raider) && (inView(n.pos.x, n.pos.z) || near(n.pos.x, n.pos.z, hearRange()))) out.push({ kind: "hunter", x: n.pos.x, z: n.pos.z, edge: true });
      }
    if (P.migration) out.push({ kind: "migrate", x: P.migration.x, z: P.migration.z, edge: true, label: full ? "New nest" : null });
    return out;
  }
  function toggleMap() {
    if (islandMap) return islandMap.close();
    if (intro || !islandPic) return;
    const wasPaused = paused;
    paused = true;
    islandMap = openIslandMap(document.body, {
      picture: islandPic,
      markers: mapMarkers(true),
      you: { x: P.pos.x, z: P.pos.z, heading: P.heading },
      title: REGION.name,
      regions: REGIONS.map((r) => ({ id: r.id, name: r.name, here: r.id === regionId, home: r.id === homeRegion, open: unlockedRegions.has(r.id) })),
      onTravel: travelTo,
      onClose: () => {
        islandMap = null;
        if (!wasPaused) paused = false;
      },
    });
  }

  /* ---- fruit trees, eggs and allies ------------------------------------------ */
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9a4a, roughness: 1, transparent: true, opacity: 0.9, flatShading: true });
  /** Bump a fruit tree (bite, strike, charge or land on it) and its fruit falls. */
  function knockTree(extra = 0) {
    const tree = world.shakeTree(P.pos.x, P.pos.z, 1.4 + P.scale * 1.1 + extra);
    if (!tree) return;
    o.sfx("dig");
    dust(tree.x, tree.z, 8, leafMat, heightAt(tree.x, tree.z) + 4.6 * tree.s);
    if (P.diet !== "meat") tipOnce("fruitDown", "Fruit's down!");
  }
  /** The allied nest you are resting at, if any. */
  const allyNestNear = () => nests.find((n) => n.status === "allied" && Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) < 12) || null;
  /** A nest whose eggs you could eat from here (meat and omnivores only). */
  function eggNest() {
    if (P.diet === "plant" || P.deadTimer > 0 || P.air) return null;
    for (const n of nests) if (n.status === "neutral" && n.eggs > 0 && Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) < 3.6 + P.scale) return n;
    return null;
  }
  /** Spore's egg raid: a good meal, but the nest won't forgive you if anyone sees. */
  function eatEgg() {
    const nest = eggNest();
    if (!nest) return;
    nest.eggs--;
    nest.eggRegrow = 150;
    nest.mesh.children[nest.eggs + 1].visible = false;
    P.heading = Math.atan2(-(nest.site.z - P.pos.z), nest.site.x - P.pos.x);
    eat(30, 10, 6);
    note("eggs");
    tasted("egg", "eggs");
    pop(P, "🥚", "good");
    const sight = P.sneaking ? 7 : 18;
    const seen = [...npcs].filter((n) => n.nest === nest && !n.dead && !n.asleep && distTo(n) < sight);
    if (!seen.length) {
      tipOnce("eggSneak", "Unseen.");
      return;
    }
    nest.angry = 40;
    remember(nest.mem, "egg");
    seen.forEach((n) => {
      n.calm = 0;
      n.wake = 30;
      if (n.social) endEncounter(n.social);
      pop(n, "❗", "bad");
    });
    o.sfx("snub");
    toast("The " + nest.species.name + " saw you take an egg!", 2.6);
  }
  $h("#chEgg").onclick = eatEgg;

  /* ---- carrying food -------------------------------------------------------------
     Pick up a chunk of meat or a fallen fruit (in a hand if you have graspers, otherwise in your
     mouth), or drag a small carcass whole. Then eat it, store it at your nest, or give it away: a
     gift of the right food warms a nest towards you, calms an angry one, or heals your family. */
  const chunkGeo = new THREE.DodecahedronGeometry(0.32, 0).scale(1.2, 0.8, 1);
  const chunkMat = new THREE.MeshStandardMaterial({ color: 0xb8433a, roughness: 0.7, flatShading: true });
  const carriedFruitMat = new THREE.MeshStandardMaterial({ color: world.region.colors.fruit, roughness: 0.35, emissive: new THREE.Color(world.region.colors.fruit).multiplyScalar(0.2) });
  const carriedFruitGeo = new THREE.SphereGeometry(0.3, 10, 8);
  const canEat = (kind, diet) => diet === "omni" || (kind === "meat" ? diet === "meat" : diet === "plant");
  // Scale interaction reach to the full creature rig. Tall legs raise the torso and mouth far
  // above the ground-point used by fossil/carcase interactions, so the old small capped bonus
  // could leave oversized creatures visibly on top of an object but unable to use it.
  // Keep a generous but bounded radius for extreme custom body plans.
  const anatomyReach = () => Math.min(6.5, Math.max(0.65, Math.max(P.body.length * 0.35, P.body.height * 0.45) * P.scale));
  /** Food within reach that you could pick up. */
  function foodNear() {
    const r = 2.2 + P.scale + snatchReach();
    const carcassR = r + anatomyReach();
    for (const c of carcasses) if (c.bites > 0 && !c.dragged && Math.hypot(c.x - P.pos.x, c.z - P.pos.z) < carcassR) return { kind: "meat", c };
    for (const f of world.fruits) if (f.alive && !f.hanging && !f.claimed && Math.abs(f.y - heightAt(f.x, f.z)) < 1.6 && Math.hypot(f.x - P.pos.x, f.z - P.pos.z) < r) return { kind: "fruit", f };
    return null;
  }
  function holdMesh(kind) {
    const mesh = new THREE.Mesh(kind === "meat" ? chunkGeo : carriedFruitGeo, kind === "meat" ? chunkMat : carriedFruitMat);
    const hand = P.body.handAnchor();
    if (hand) {
      mesh.position.set(0.25, -0.15, 0); // in the hand
      hand.add(mesh);
    } else {
      mesh.position.copy(P.body.mouthLocal).add(new THREE.Vector3(0.2, -0.1, 0)); // in the mouth
      P.body.root.add(mesh);
    }
    return mesh;
  }
  function pickUp() {
    if (P.carry || P.deadTimer > 0) return;
    const food = foodNear();
    if (!food) return;
    if (food.kind === "meat") {
      const c = food.c;
      // Small carcasses come whole (dragged behind you); big ones a chunk at a time.
      if (c.bites <= 2 + P.scale * 1.5 && P.move.bulk >= 0.7) {
        c.dragged = true;
        P.carry = { kind: "meat", drag: c, mesh: null, from: c };
        tipOnce("drag", "Heavy. Take it home.");
      } else {
        c.bites -= 1;
        if (c.bites <= 0) removeCarcass(carcasses.indexOf(c));
        P.carry = { kind: "meat", drag: null, mesh: holdMesh("meat"), from: c };
      }
    } else {
      food.f.alive = false;
      food.f.regrow = 40;
      world.syncFruit();
      P.carry = { kind: "fruit", drag: null, mesh: holdMesh("fruit") };
    }
    act(P, "bite");
    o.sfx("dig", { pitch: 1.3 });
    tipOnce("carry", "Eat it, gift it, or store it at home.");
  }
  /** How much food you are carrying (a dragged carcass counts its remaining bites). */
  const carriedBites = () => (P.carry ? (P.carry.drag ? Math.max(1, Math.round(P.carry.drag.bites)) : 1) : 0);
  function clearCarry() {
    if (!P.carry) return;
    if (P.carry.mesh) P.carry.mesh.removeFromParent();
    if (P.carry.drag) {
      const c = P.carry.drag;
      c.dragged = false;
      if (c.bites <= 0) removeCarcass(carcasses.indexOf(c));
    }
    P.carry = null;
  }
  /** What the main carry button does right now, and its label. */
  function carryAction() {
    if (!P.carry) {
      const f = foodNear();
      if (!f) return null;
      const small = f.kind === "meat" && f.c.bites <= 2 + P.scale * 1.5 && P.move.bulk >= 0.7;
      return { id: "pick", label: f.kind === "meat" ? (small ? "🐾 Drag carcass" : "✋ Take meat") : "✋ Pick up fruit" };
    }
    if (nearNest()) return { id: "store", label: "🏠 Store at nest" };
    const t = P.target && !P.target.dead && distTo(P.target) < 7 ? P.target : null;
    if (t && (t.family || canSocialise(t) || (t.nest && t.nest.angry > 0 && t.nest.status === "neutral"))) return { id: "give", label: "🎁 Give to " + (t.family ? "family" : P.discovered.has(t.species.id) ? t.species.name : "them"), t };
    if (P.carry.drag) return { id: "drop", label: "Let go" };
    return canEat(P.carry.kind, P.diet) ? { id: "eat", label: "🍽 Eat it" } : { id: "drop", label: "Drop it" };
  }
  function doCarry() {
    const a = carryAction();
    if (!a) return;
    if (a.id === "pick") return pickUp();
    const bites = carriedBites(),
      kind = P.carry.kind;
    if (a.id === "store") {
      P.larder = Math.min(30, P.larder + bites);
      note("familyFed");
      gainXp(2 * bites);
      pop(P, kind === "meat" ? "🍖" : "🍎", "good");
      o.sfx("eat", { pitch: 1.2 });
      if (P.carry.drag) P.carry.drag.bites = 0;
      clearCarry();
      syncLarder();
      tipOnce("larder", "The larder feeds your family.");
      return saveState();
    }
    if (a.id === "give") return giveFood(a.t);
    if (a.id === "eat") {
      eat(kind === "meat" ? 22 : 18, 6, 2, kind === "meat" ? "meat" : "plant", P.carry.from || null);
      clearCarry();
      return;
    }
    clearCarry(); // drop
    o.sfx("land");
  }
  /** A gift of food: a social move anyone understands, if it's food they eat. */
  function giveFood(t) {
    const kind = P.carry.kind;
    if (!canEat(kind, t.family ? P.diet : t.species.diet)) {
      pop(t, "🙅", "bad");
      tipOnce("giftDiet", "They don't eat that.");
      return;
    }
    if (P.carry.drag) P.carry.drag.bites = 0;
    clearCarry();
    act(t, "bite");
    pop(t, "💕", "good");
    o.sfx("friend");
    if (t.family) {
      t.health = Math.min(t.maxHealth, t.health + t.maxHealth * 0.4);
      note("familyFed");
      return;
    }
    const nest = t.nest;
    note("gifts");
    remember(nest.mem, "gift");
    if (nest.angry > 0) {
      // Reconciliation: a peace offering calms an angry nest, and goes some way to mending an old grudge.
      nest.angry = 0;
      nest.mem.g = Math.max(nest.mem.fg, nest.mem.g - 25);
      [...npcs].filter((m) => m.nest === nest && !m.dead).forEach((m) => {
        m.hunting = false;
        m.calm = 30;
      });
      toast("The " + nest.species.name + " accept your offering and calm down", 3);
      return;
    }
    // A gift during a social round is worth a lot; before one, it opens the next round warmly.
    if (t.social) {
      t.social.progress = Math.min(0.99, t.social.progress + 0.3);
      bumpArc?.();
    } else nest.gifted = true;
    tipOnce("gift", "A gift warms them up.");
  }
  $h("#chCarry").onclick = doCarry;
  $h("#chDrop").onclick = () => {
    clearCarry();
    o.sfx("land");
  };
  /** Keep a dragged carcass behind you, and slow you down while you drag it. */
  function updateCarry() {
    const c = P.carry?.drag;
    if (!c) return;
    const back = 1.4 + P.body.radius * P.scale;
    c.x = P.pos.x - Math.cos(P.heading) * back;
    c.z = P.pos.z + Math.sin(P.heading) * back;
    c.mesh.position.set(c.x, heightAt(c.x, c.z) + 0.3, c.z);
    c.mesh.rotation.y = P.heading;
    c.life = 90;
  }
  /* The larder: a pile of food at your nest. */
  const larderMesh = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(i % 2 ? chunkGeo : carriedFruitGeo, i % 2 ? chunkMat : carriedFruitMat);
    const a = i * 2.3;
    m.position.set(Math.cos(a) * (0.3 + i * 0.07), 0.35 + Math.floor(i / 4) * 0.25, Math.sin(a) * (0.3 + i * 0.07));
    larderMesh.add(m);
  }
  scene.add(larderMesh);
  function syncLarder() {
    larderMesh.visible = atHome && P.larder > 0;
    larderMesh.position.set(nestAt.x + 2.6, heightAt(nestAt.x + 2.6, nestAt.z), nestAt.z);
    larderMesh.children.forEach((m, i) => (m.visible = i < Math.ceil(P.larder / 3)));
  }
  syncLarder();
  let larderClock = 0;
  /** Every couple of seconds the larder feeds whoever at the nest needs it. */
  function updateLarder(dt) {
    if ((larderClock -= dt) > 0 || !atHome || P.larder <= 0) return;
    larderClock = 2;
    if (nearNest() && P.hunger < 55 && P.deadTimer <= 0) {
      P.larder--;
      eat(20, 4, 0);
      pop(P, "🍽", "good");
      return syncLarder();
    }
    const hungry = family.find((n) => !n.dead && n.health < n.maxHealth * 0.7 && Math.hypot(n.pos.x - nestAt.x, n.pos.z - nestAt.z) < 10);
    if (hungry) {
      P.larder--;
      hungry.health = Math.min(hungry.maxHealth, hungry.health + hungry.maxHealth * 0.4);
      act(hungry, "bite");
      syncLarder();
    }
  }

  /* ---- family orders ----------------------------------------------------------------
     Follow (join your pack), Stay (the pack holds where it is), Gather (bring food to the larder),
     Defend (guard the nest), Attack (the pack goes for your target), Retreat (everyone home). */
  const ORDER_NAMES = { free: "doing as they like", follow: "following you", stay: "staying put", gather: "gathering food", defend: "defending the nest" };
  function setOrder(order) {
    closeOrders();
    if (!atHome && order !== "attack" && order !== "retreat" && order !== "stay") return toast("Your family is at your nest in " + regionById(homeRegion).name + ".", 2.6);
    const pack = packMembers();
    if (order === "attack") {
      const t = P.target;
      if (!t || t.dead || t.family || t.member?.friend || t.following) return toast("Select a creature to attack first.", 2.4);
      if (!pack.length) return toast("Nobody in your pack to send.", 2.4);
      pack.forEach((n) => {
        n.orderTarget = t;
        n.hold = null;
        pop(n, "⚔", "bad");
      });
      return o.sfx("strike", { pitch: 1.2 });
    }
    if (order === "retreat") {
      pack.forEach((n) => {
        n.orderTarget = null;
        n.hold = null;
        if (n.family) n.following = false;
        else sendHome(n);
        pop(n, "🏃");
      });
      family.forEach((n) => (n.gatherJob = null));
      P.familyOrder = "free";
      toast("Everyone back home!", 2);
      return saveState();
    }
    if (order === "stay") {
      if (!pack.length) return toast("Nobody in your pack to hold here.", 2.4);
      pack.forEach((n) => (n.hold = { x: n.pos.x, z: n.pos.z }));
      return toast("Your pack holds here. Order Follow to bring them on.", 2.6);
    }
    P.familyOrder = order;
    pack.forEach((n) => (n.hold = null));
    family.forEach((n) => {
      n.gatherJob = null;
      if (order === "follow" && !n.dead && !n.following && packMembers().length < PACK_SIZE[P.brain]) {
        n.following = true;
        pop(n, "🐾", "good");
      }
      if ((order === "gather" || order === "defend") && n.following) n.following = false;
    });
    if (order === "follow" && packMembers().length >= PACK_SIZE[P.brain]) tipOnce("packFull", "Pack full. A bigger brain leads more.");
    toast("Family: " + ORDER_NAMES[order], 2);
    o.sfx("pose", { pitch: 1.1, gain: 0.6 });
    saveState();
  }
  function openOrders() {
    const menu = $h("#chOrders");
    menu.hidden = false;
    $h("#chFamily").setAttribute("aria-expanded", "true");
    menu.querySelectorAll("[data-order]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.order === P.familyOrder)));
    menu.querySelector("button")?.focus();
  }
  function closeOrders() {
    $h("#chOrders").hidden = true;
    $h("#chFamily").setAttribute("aria-expanded", "false");
  }
  $h("#chFamily").onclick = () => ($h("#chOrders").hidden ? openOrders() : closeOrders());
  $h("#chOrders").querySelectorAll("[data-order]").forEach((b) => (b.onclick = () => setOrder(b.dataset.order)));
  /** Gathering: find food near the nest, carry it back, add it to the larder. */
  function gatherTick(n) {
    const job = (n.gatherJob ||= { state: "seek", food: null, mesh: null });
    if (job.state === "seek") {
      let best = null,
        bestD = 70;
      if (P.diet !== "meat")
        for (const f of world.fruits) {
          if (!f.alive || f.hanging || f.claimed) continue;
          const dd = Math.hypot(f.x - nestAt.x, f.z - nestAt.z);
          if (dd < bestD) {
            best = { f };
            bestD = dd;
          }
        }
      if (P.diet !== "plant")
        for (const c of carcasses) {
          if (c.bites <= 0 || c.dragged) continue;
          const dd = Math.hypot(c.x - nestAt.x, c.z - nestAt.z);
          if (dd < bestD) {
            best = { c };
            bestD = dd;
          }
        }
      if (!best) return Math.hypot(n.pos.x - nestAt.x, n.pos.z - nestAt.z) > 8 ? { want: nestAt, pace: 2.5 } : { want: null, pace: 0 };
      if (best.f) best.f.claimed = n;
      job.food = best;
      job.state = "go";
    }
    const food = job.food;
    if (job.state === "go") {
      const at = food.f || food.c;
      if ((food.f && !food.f.alive) || (food.c && (food.c.bites <= 0 || !carcasses.includes(food.c)))) {
        if (food.f) food.f.claimed = null;
        job.state = "seek";
        return { want: null, pace: 0 };
      }
      if (Math.hypot(at.x - n.pos.x, at.z - n.pos.z) > 1.8 + n.scale) return { want: at, pace: 4.2 };
      act(n, "bite");
      if (food.f) {
        food.f.alive = false;
        food.f.regrow = 40;
        food.f.claimed = null;
        world.syncFruit();
      } else {
        food.c.bites -= 1;
        if (food.c.bites <= 0) removeCarcass(carcasses.indexOf(food.c));
      }
      job.mesh = new THREE.Mesh(food.f ? carriedFruitGeo : chunkGeo, food.f ? carriedFruitMat : chunkMat);
      job.mesh.position.copy(n.body.mouthLocal).add(new THREE.Vector3(0.2, -0.1, 0));
      n.body.root.add(job.mesh);
      job.state = "return";
    }
    if (job.state === "return") {
      if (Math.hypot(nestAt.x - n.pos.x, nestAt.z - n.pos.z) > 3) return { want: nestAt, pace: 3.8 };
      job.mesh?.removeFromParent();
      job.mesh = null;
      P.larder = Math.min(30, P.larder + 1);
      syncLarder();
      pop(n, "🍎", "good");
      job.state = "seek";
    }
    return { want: null, pace: 0 };
  }
  /** Defending: hold a spot round the nest and see off anything hostile that comes close. */
  function defendTick(n, k) {
    let foe = null,
      foeD = 18;
    for (const e of npcs) {
      if (e.dead || e.family || e.following || e.member?.friend) continue;
      const hostile = e.raider || e.hunting || e.nest?.angry > 0 || (e.wild && (e.wb.mode === "hunt" || e.wb.mode === "pounce"));
      if (!hostile) continue;
      const dd = Math.hypot(e.pos.x - nestAt.x, e.pos.z - nestAt.z);
      if (dd < foeD) {
        foe = e;
        foeD = dd;
      }
    }
    if (foe) {
      if (Math.hypot(foe.pos.x - n.pos.x, foe.pos.z - n.pos.z) < 2.4 + foe.scale && n.cool <= 0) {
        n.cool = 1.4;
        act(n, "bite");
        const dmg = npcDamage(P.brain, n.species.abilities.bite || 1, "kin");
        if (foe.wild) eco.hurtWild(foe, dmg, n);
        else damageNPC(foe, dmg);
      }
      return { want: foe.pos, pace: 5.5 };
    }
    const a = (k / FAMILY_SIZE) * TAU;
    const spot = { x: nestAt.x + Math.cos(a) * 7, z: nestAt.z + Math.sin(a) * 7 };
    return Math.hypot(spot.x - n.pos.x, spot.z - n.pos.z) > 1.5 ? { want: spot, pace: 3 } : { want: null, pace: 0 };
  }

  /* ---- UFOs ----------------------------------------------------------------
     As in Spore, now and then a flying saucer drops by and beams a creature up: a hint of what is
     out there. The creature is only borrowed; its nest gets it back in a couple of minutes. */
  let ufo = null,
    ufoClock = 220 + Math.random() * 160;
  function buildUfo() {
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xbac6d2, metalness: 0.75, roughness: 0.28 }),
      new THREE.MeshStandardMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.75, emissive: 0x1f7ea0, roughness: 0.1 }),
      new THREE.MeshBasicMaterial({ color: 0xfff4a8 }),
      new THREE.MeshBasicMaterial({ color: 0xc8f7ff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    ];
    const geos = [
      new THREE.SphereGeometry(3.4, 32, 12).scale(1, 0.26, 1),
      new THREE.SphereGeometry(1.45, 24, 12, 0, TAU, 0, Math.PI / 2),
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.CylinderGeometry(0.7, 3.4, 1, 28, 1, true).translate(0, -0.5, 0),
    ];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geos[0], mats[0]));
    const dome = new THREE.Mesh(geos[1], mats[1]);
    dome.position.y = 0.5;
    group.add(dome);
    const lights = [];
    for (let i = 0; i < 10; i++) {
      const l = new THREE.Mesh(geos[2], mats[2]);
      l.position.set(Math.cos((i / 10) * TAU) * 3.2, -0.12, Math.sin((i / 10) * TAU) * 3.2);
      group.add(l);
      lights.push(l);
    }
    const beam = new THREE.Mesh(geos[3], mats[3]);
    beam.visible = false;
    group.add(beam);
    return { group, beam, lights, mats, geos };
  }
  function endUfo() {
    if (!ufo) return;
    scene.remove(ufo.group);
    ufo.mats.forEach((m) => m.dispose());
    ufo.geos.forEach((g) => g.dispose());
    ufo = null;
  }
  function updateUfo(dt) {
    if (!ufo) {
      if ((ufoClock -= dt) > 0 || raid || courtship) return;
      // Someone you can watch being taken: a nest creature, not yours, not busy, not too close.
      const fx = Math.cos(camYaw),
        fz = -Math.sin(camYaw);
      const inView = (n) => ((n.pos.x - P.pos.x) * fx + (n.pos.z - P.pos.z) * fz) / Math.max(1, distTo(n)) > 0.75; // within ~40° of straight ahead
      const pool = [...npcs].filter((n) => n.member && !n.dead && !n.following && !n.social && !n.hunting && P.target !== n && distTo(n) > 16 && distTo(n) < 55 && inView(n));
      if (!pool.length) {
        ufoClock = 45;
        return;
      }
      ufoClock = 260 + Math.random() * 220;
      const victim = pool[Math.floor(Math.random() * pool.length)];
      const ship = buildUfo();
      const a = Math.atan2(victim.pos.z - P.pos.z, victim.pos.x - P.pos.x);
      const from = new THREE.Vector3(victim.pos.x + Math.cos(a) * 140, victim.pos.y + 70, victim.pos.z + Math.sin(a) * 140);
      ship.group.position.copy(from);
      scene.add(ship.group);
      // Low enough to see from where you stand: just over the victim's head.
      ufo = { ...ship, victim, phase: "in", t: 0, from, hover: Math.max(6, victim.body.height * victim.scale + 3.5) };
      o.sfx("jet");
      tipOnce("ufo", "Something is watching…");
      return;
    }
    const u = ufo,
      v = u.victim;
    u.t += dt;
    u.group.rotation.y += dt * 1.6;
    u.lights.forEach((l, i) => (l.visible = Math.floor(u.t * 6 + i) % 3 !== 0));
    const lost = !npcs.has(v) || v.dead;
    if (u.phase === "in") {
      if (lost || v.following || v.social || v.hunting) {
        u.phase = "out";
        u.t = 0;
        return;
      }
      const k = Math.min(1, u.t / 4.5),
        e = 1 - Math.pow(1 - k, 3);
      tmp.set(v.pos.x, v.pos.y + u.hover, v.pos.z);
      u.group.position.lerpVectors(u.from, tmp, e);
      if (k >= 1) {
        u.phase = "beam";
        u.t = 0;
        v.abducted = true;
        if (P.target === v) P.target = null;
        u.beam.visible = true;
        u.beam.scale.set(1, u.hover, 1);
        o.sfx("meteor");
      }
    } else if (u.phase === "beam") {
      // Up it goes, spinning and shrinking into the saucer.
      const k = Math.min(1, u.t / 3.2);
      if (!lost) {
        v.body.root.position.set(v.pos.x, v.pos.y + k * k * (u.hover - 0.5), v.pos.z);
        v.body.root.rotation.y += dt * (1 + k * 6);
        v.body.root.scale.setScalar(v.scale * (1 - k * 0.85));
      }
      u.beam.material.opacity = 0.32 + 0.1 * Math.sin(u.t * 12);
      if (k >= 1 || lost) {
        if (!lost) {
          v.member.away = 140;
          v.member.npc = null;
          despawnNPC(v);
        }
        u.beam.visible = false;
        u.phase = "out";
        u.t = 0;
        u.from = u.group.position.clone();
        o.sfx("jet");
      }
    } else {
      // Off it zips, up and away.
      const k = u.t / 2.5;
      u.group.position.set(u.from.x + k * k * 120, u.from.y + k * k * 90, u.from.z - k * k * 40);
      if (k >= 1) endUfo();
    }
  }

  /* ---- crawl-out cinematic -------------------------------------------------
     The new creature wades out of the surf onto the beach below its nest while the camera swings
     from in front of it, low over the water, round to its usual place behind. Tap to skip. */
  const INTRO_TIME = 7.5;
  let intro = null;
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xeef9ff, transparent: true, opacity: 0.75 });
  if (!save.record) o.onChronicle?.({ key: "creature:start", stage: "creature", icon: "🦎", text: "Crawled ashore on the " + REGION.name + " and built a nest." });
  /** Start the crawl-out. With o.deferIntro the stage waits (the editor comes first) until playIntro(). */
  function beginIntro() {
    if (intro) return;
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
  if (o.intro && !o.deferIntro) beginIntro();
  else if (o.intro) P.pos.set(ISLAND.nest.x, 0, ISLAND.shore + 17); // waiting in the shallows
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
    gainXp(0);
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
    const mv = P.move;
    const baseSpeed = mv.top * pace * (P.air?.mode === "glide" ? 1.2 : 1) * (P.carry?.drag ? 0.7 : 1); // dragging a carcass is slow going
    if (charging > 0) {
      // Clamped at zero: a charge that ended a hair below zero once left digging blocked for good.
      charging = Math.max(0, charging - dt);
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
        P.heading += THREE.MathUtils.clamp(delta * 7 * dt, -mv.turn * dt, mv.turn * dt);
        P.speed += (baseSpeed * Math.max(0.3, Math.cos(delta)) - P.speed) * Math.min(1, dt * mv.accel);
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
      P.heading += THREE.MathUtils.clamp(delta * 7 * dt, -mv.turn * dt, mv.turn * dt);
      P.speed += (mag * baseSpeed * Math.max(0.3, Math.cos(delta)) - P.speed) * Math.min(1, dt * mv.accel);
    } else P.speed += (0 - P.speed) * Math.min(1, dt * (mv.accel + 1));
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
    // Out of your depth you swim: fins, webbed feet and tentacles (or no legs at all) swim faster.
    if (swimming && !P.air) P.speed = Math.min(P.speed, baseSpeed * 0.62 * mv.swim);
    else if (ground < 0 && !P.air) P.speed *= 1 - dt * 1.5;
    if (swimming && P.sneaking) setSneak(false);
    updateDeepWater(dt, ground);
    updateCarry();
    P.body.root.position.copy(P.pos);
    P.body.root.rotation.y = P.heading;
    // Your creature keeps an eye on whatever you have selected.
    const seen = P.target && !P.target.dead ? P.target : null;
    P.body.lookAt(seen ? lookTmp.set(seen.pos.x, seen.pos.y + seen.body.height * seen.scale * 0.8, seen.pos.z) : null);
    {
      // How fast you are turning, so the body leans into the corner.
      const dh = THREE.MathUtils.euclideanModulo(P.heading - (P.lastHeading ?? P.heading) + Math.PI, TAU) - Math.PI;
      P.lastHeading = P.heading;
      P.body.update(dt, P.speed, dt > 0 ? dh / dt : 0);
    }
    // Footsteps (or splashes) in time with the stride; sneaking steps are barely audible.
    if (!P.air && P.speed > 0.8 && (stepClock -= dt * (1 + P.speed * 0.25)) <= 0) {
      stepClock = 0.42;
      o.sfx(ground < 0 ? "splash" : "step", { pitch: 1 / Math.sqrt(P.scale), gain: (ground < 0 ? 0.4 : 1) * (P.sneaking ? 0.3 : 1) });
    }

    // Charge contact damage (and a charge into a tree shakes its fruit down).
    if (charging > 0) knockTree();
    if (charging > 0)
      for (const n of npcs)
        if (!n.dead && !n.following && !P.chargeHit.has(n) && distTo(n) < reach(n) + 0.5) {
          P.chargeHit.add(n);
          if (P.chargeAmbush) ambushHit(n);
          P.chargeAmbush = false;
          damageNPC(n, P.chargeDamage, ATTACKS.charge.stagger);
        }

    // Eating: fruit for plant eaters, carcasses for meat eaters, both for omnivores.
    const mouth = tmp.copy(P.body.mouthLocal).multiplyScalar(P.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), P.heading).add(P.pos);
    if (P.diet !== "meat")
      for (const f of world.fruits)
        if (f.alive && Math.abs(f.x - mouth.x) < 1.6 + snatchReach() && Math.abs(f.z - mouth.z) < 1.6 + snatchReach() && (!f.hanging || mouth.y > f.y - 1.4) && !(f.vy && f.y > f.groundY + 1.2)) {
          // Fruit up in a tree is only in reach of a tall creature; the rest has to be knocked down.
          f.alive = false;
          f.regrow = 40;
          world.syncFruit();
          eat(16, 4, 3, "plant");
          if (f.tree) tasted("treeFruit", "tree fruit");
          else tasted("fruit", "fruit");
        }
    if (P.diet !== "plant")
      for (let i = carcasses.length - 1; i >= 0; i--) {
        const c = carcasses[i];
        if (!c.dragged && Math.hypot(c.x - mouth.x, c.z - mouth.z) < 2 + anatomyReach() + snatchReach()) {
          c.bites--;
          eat(28, 8, 5, "meat", c);
          tasted("meat", "meat");
          c.mesh.scale.multiplyScalar(0.8);
          if (c.bites <= 0) {
            leaveBones(c.x, c.z);
            removeCarcass(i);
          }
          break;
        }
      }

    // Fossils: stand on one and your creature digs; dust flies, then the skeleton gives up a part.
    // The nearest fossil in reach is the one you dig (a big creature can reach two at once).
    let digging = null,
      digD = Infinity;
    const canDig = P.speed < 2.2 && charging <= 0 && !P.air;
    const digReach = 2.6 + P.scale + anatomyReach();
    for (const b of world.bonePiles) {
      if (b.taken) continue;
      const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
      if (canDig && d < digReach && d < digD) {
        digging = b;
        digD = d;
      }
    }
    for (const b of world.bonePiles) {
      if (b.taken) continue;
      const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
      if (b !== digging) b.dig = Math.max(0, b.dig - dt * 0.5);
      if (d < 22 && !b.seen) {
        b.seen = true;
        tipOnce("fossil", "A fossil. Stand on it.");
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
      const reach = 2.6 + P.scale + anatomyReach();
      digRing.geometry = new THREE.RingGeometry(reach - 0.2, reach + 0.05, 48, 1, Math.PI / 2, -TAU * Math.min(1, digging.dig)).rotateX(-Math.PI / 2);
    }

    // Hunger, and the nest heals.
    P.hunger = Math.max(0, P.hunger - dt * 0.3 * REGION.hunger * weather.hunger * mods.hunger); // the badlands' heat (and heatwaves) make you hungry
    // Lava: the ground near it scorches.
    const pool = poolAt(P.pos.x, P.pos.z);
    if (pool?.kind === "lava" && !P.air && P.deadTimer <= 0) {
      hurtPlayer(dt * 14, "Burned by lava");
      tipOnce("lava", "Lava burns.");
    }
    if (P.hunger <= 0) hurtPlayer(dt * 2, "You starved", true);
    const ally = allyNestNear();
    if ((nearNest() || ally) && P.hunger > 0) {
      P.health = Math.min(P.maxHealth, P.health + dt * (ally && !nearNest() ? 4.5 : 6));
      if (ally && P.health < P.maxHealth * 0.8) tipOnce("allyHeal", "Allies' nest: safe to rest.");
    }
    else if (P.hunger > 30 && performance.now() - P.lastHurt > 5000) P.health = Math.min(P.maxHealth, P.health + dt * 2); // slow regen out of a fight
    P.invulnerable = Math.max(0, P.invulnerable - dt);
    P.aggro = Math.max(0, P.aggro - dt);
    P.cardCooldown = Math.max(0, P.cardCooldown - dt);
    for (const k in P.cooldowns) P.cooldowns[k] = Math.max(0, P.cooldowns[k] - dt);
  }
  /** Sneaking and sprinting burn stamina; it refills shortly after you stop. */
  function updateStamina(dt, mag) {
    const drain = P.sneaking ? 9 - P.abilities.sneak : P.sprinting && mag > 0.12 ? 20 * mods.sprintDrain : 0;
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
      if (!swimming) knockTree(1.5);
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
  function dust(x, z, n, material = dustMat, y = null) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(dustGeo, material);
      m.position.set(x, y ?? Math.max(heightAt(x, z), 0.2) + 0.3, z);
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
    const pool = CREATURE_PARTS.filter((p) => p.cost > 0 && !owned.has(p.id) && !isMouth(p.id)).sort((a, z) => a.cost - z.cost);
    // The bigger your brain, the better the parts the fossils give up.
    const lo = Math.min(pool.length - 1, Math.floor(((P.brain - 1) / 5) * pool.length));
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
  /** A meal. `kind` ("plant" | "meat") scales it by how well the equipped mouth feeds on it; stored food passes none. */
  /** @param {object|null} [from] the carcass it came from: someone else's kill counts as scavenging */
  function eat(hunger, health, xp, kind, from = null) {
    const eff = kind ? feedsOn(P.mouthId, kind) || 1 : 1;
    const gulp = P.mouth.special === "gulp" ? 1.75 : 1;
    const scavenged = !!from && !from.byYou;
    const heal = mods.foodHeal * (kind === "plant" ? mods.plantHeal : 1) * (scavenged ? mods.carrion : 1);
    if (kind === "plant") note("plantMeals");
    else if (kind === "meat") note("meatMeals");
    if (scavenged && !from.scavNoted) {
      from.scavNoted = true; // one carcass, one scavenging
      note("scavenged");
    }
    P.hunger = Math.min(100, P.hunger + hunger * eff);
    P.health = Math.min(P.maxHealth, P.health + health * eff * gulp * heal);
    P.dna += 1 + (P.mouth.special === "forage" ? 2 : 0);
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

  const cardHide = { t: 0 };
  let uidCounter = 0;
  /** Per-frame combat bookkeeping: who is hunting you (so they can spread out) and what the pack should fight. */
  function prepCombat(dt) {
    const hunters = [];
    for (const n of npcs) {
      n.uid ||= ++uidCounter;
      n.engagedT = Math.max(0, (n.engagedT || 0) - dt);
      n.defendT = Math.max(0, (n.defendT || 0) - dt);
      n.dodgeCool = Math.max(0, (n.dodgeCool || 0) - dt);
      if (!n.dead && n.hunting && !n.following) hunters.push(n);
    }
    hunters.forEach((h, i) => (h.flank = { slot: i, slots: hunters.length }));
    huntersNow = hunters;
    // The pack fights what threatens it: your target, whatever is hunting you, and whatever is biting a packmate.
    const pack = packMembers().filter((m) => !m.dead);
    packPlan = new Map();
    if (!pack.length) return;
    const threats = new Set();
    for (const h of hunters) if (distTo(h) < 26) threats.add(h);
    for (const m of pack) if (m.threatBy && !m.threatBy.dead && npcs.has(m.threatBy) && timeUniform.value - (m.threatAt || -99) < 6) threats.add(m.threatBy);
    const list = [...threats].sort((a, b) => distTo(a) - distTo(b)).map((t) => ({ id: t.uid, x: t.pos.x, z: t.pos.z, n: t }));
    const plan = assignPack(pack.map((m) => ({ id: m.uid, x: m.pos.x, z: m.pos.z })), list, 2);
    for (const m of pack) {
      const a = plan.get(m.uid);
      if (a) packPlan.set(m, { foe: a.target.n, slot: a.slot, slots: a.slots });
    }
  }
  let packPlan = new Map();
  let huntersNow = [];
  let lastEscape = -99;
  /**
   * Allies come to your aid: a befriended member of another nest, close by, may join the fight against
   * whatever is hunting you (Symbiotic species can count on it). Returns where it goes, or null.
   */
  function allyAssist(n, time) {
    if (!n.member?.friend || n.following || n.asleep || P.deadTimer > 0) return null;
    if (time > (n.assistCheck || 0)) {
      n.assistCheck = time + 10;
      const was = n.assisting;
      const foe = huntersNow.find((h) => !h.dead && h.nest !== n.nest && distTo(h) < 20 && Math.hypot(h.pos.x - n.pos.x, h.pos.z - n.pos.z) < 32);
      n.assisting = foe && Math.random() < mods.assist ? foe : null;
      if (n.assisting && !was) {
        pop(n, "❗", "good");
        voice(n, "pose");
      }
    }
    const foe = n.assisting;
    if (!foe || foe.dead || !npcs.has(foe) || !foe.hunting) {
      n.assisting = null;
      return null;
    }
    if (Math.hypot(foe.pos.x - n.pos.x, foe.pos.z - n.pos.z) < 2.5 + foe.scale && n.cool <= 0) {
      n.cool = 1.5;
      act(n, "bite");
      const dmg = npcDamage(n.species.level || 1, n.species.abilities.bite || 1, "kin");
      if (foe.wild) eco.hurtWild(foe, dmg, n);
      else damageNPC(foe, dmg);
    }
    return { want: foe.pos, pace: 5.8 };
  }
  /** A creature's combat state this frame (see combat-ai.js), from what it is doing and how it is faring. */
  function combatState(n, d, homeD) {
    if (n.dead) return "idle";
    if (n.dodgeT > 0) return "dodging";
    const sp = n.species,
      courage = courageFor(n);
    const retreatT = Math.max(n.fleeT || 0, n.retreat !== undefined ? Math.max(0, n.retreat) : 0);
    const res = decide({
      state: n.cs || "idle",
      hostile: !!n.hunting,
      engaged: (n.engagedT || 0) > 0,
      defending: (n.defendT || 0) > 0 || (!!n.following && packPlan.has(n)),
      d,
      reach: reach(n),
      aggro: (8 + (sp.level || 1) * 1.1) * noticeScale(),
      hpFrac: n.health / n.maxHealth,
      courage,
      power: playerPower() / npcPower(n),
      homeD,
      chaseD: n.chaseStart ? Math.hypot(n.pos.x - n.chaseStart.x, n.pos.z - n.chaseStart.z) : 0,
      leash: chaseLimit(courage, { rogue: !!n.rogue, epic: !!n.epic }),
      winding: n.windUp > 0,
      backT: n.backT || 0,
      incoming: false,
      dodgeCool: n.dodgeCool || 0,
      retreated: !!n.fleeChecked,
      retreatT,
    });
    // The label must be truthful: "retreating" only while it is actually falling back.
    return res.state === "retreating" && retreatT <= 0 ? "engaging" : res.state;
  }
  function updateNPCs(dt, time) {
    prepCombat(dt);
    const night = world.isNight;
    const leader = P.target && !P.target.dead && !P.target.following ? P.target : null;
    for (const n of npcs) {
      const sp = n.species;
      if (n.dead) {
        n.body.update(dt, 0);
        continue;
      }
      if (n.abducted) continue; // the UFO has it
      if (n.temporary !== undefined && (n.temporary -= dt) <= 0) {
        n.dead = true;
        despawnNPC(n);
        continue;
      }
      const d = distTo(n);
      const wasHunting = n.hunting;
      n.body.setLOD(d < 40 ? 1 : 0);
      n.cool = Math.max(0, n.cool - dt);
      n.calm = Math.max(0, n.calm - dt);
      if (n.young > 0) {
        // Hatchlings grow into adults over a couple of minutes.
        n.young = Math.max(0, n.young - dt);
        n.scale = n.baseScale * (0.55 + 0.45 * (1 - n.young / YOUNG_TIME));
        n.body.root.scale.setScalar(n.scale);
      }
      n.wake = Math.max(0, (n.wake || 0) - dt);
      const wasAsleep = !!n.asleep;
      n.asleep = false;
      let want = null,
        pace = 0,
        helping = null;
      const home = n.nest
        ? n.nest.site
        : n.family || n.raider
          ? nestAt
          : n.epic
            ? epicHome(n.epic)
            : n.rogue
              ? rogueHome(n.rogue)
              : n.wild
                ? n.wild.home
                : n.homeSpot || P.pos;
      const homeD = Math.hypot(n.pos.x - home.x, n.pos.z - home.z);
      // Friends heal slowly when nothing is biting them.
      if (n.health < n.maxHealth && time - (n.hurtAt || -99) > (n.following || n.family ? 5 : 8)) {
        n.health = Math.min(n.maxHealth, n.health + dt * 3);
        if (n.health >= n.maxHealth) n.fleeChecked = false; // fully recovered: a new fight
      }
      if (n.stun > 0) n.stun -= dt;
      else if (n.dodgeT > 0) {
        // A sidestep: quick, to one side of you, then straight back into the fight.
        n.dodgeT -= dt;
        const ux = (n.pos.x - P.pos.x) / Math.max(d, 0.01),
          uz = (n.pos.z - P.pos.z) / Math.max(d, 0.01);
        want = { x: n.pos.x - uz * 3 * n.backDir, z: n.pos.z + ux * 3 * n.backDir };
        pace = 7;
      } else if (n.fleeT > 0) {
        // Falling back: towards home (round you if you are in the way), briefly, not flat out across the island.
        n.fleeT -= dt;
        n.hunting = false;
        const hx = home.x - n.pos.x,
          hz = home.z - n.pos.z,
          hd = Math.hypot(hx, hz) || 1;
        const px = P.pos.x - n.pos.x,
          pz = P.pos.z - n.pos.z,
          pd = Math.hypot(px, pz) || 1;
        // If home is the way you are, break sideways first.
        const blocked = (hx * px + hz * pz) / (hd * pd) > 0.5;
        want = blocked ? { x: n.pos.x + (-pz / pd) * 8 - (px / pd) * 6, z: n.pos.z + (px / pd) * 8 - (pz / pd) * 6 } : { x: home.x, z: home.z };
        pace = 5.2;
      } else if (n.retreat !== undefined) {
        // Raiders giving up: they run off inland and are gone once out of sight.
        n.hunting = false;
        n.retreat -= dt;
        want = { x: n.pos.x + (n.pos.x - nestAt.x), z: n.pos.z + (n.pos.z - nestAt.z) };
        pace = 5;
        if ((n.retreat <= 0 && d > 35) || n.retreat < -30) {
          despawnNPC(n);
          continue;
        }
      } else if (n.raider) {
        updateRaider(n, d, dt);
        want = n.want;
        pace = n.pace;
      } else if (n.rival && !n.angryRival) {
        // A rival at your nest, or the neighbour it became (see encounters below).
        const r = rivalTick(n, d, dt);
        if (!r) continue; // gone
        ({ want, pace } = r);
      } else if (n.stray) {
        const r = strayTick(n, d, dt);
        if (!r) continue;
        ({ want, pace } = r);
      } else if (n.wild) {
        // Wildlife lives its own life (ecosystem.js): grazing, fleeing, hunting, scavenging.
        const r = eco.think(n, dt, d);
        want = r.want;
        pace = r.pace;
      } else if (n.family && raid && !n.following && !n.young && family.some((k) => k.young > 0 && !k.dead && nearest(raid.raiders, k.pos, 12))) {
        // Adults stand between the raiders and the young.
        const kid = family.find((k) => k.young > 0 && !k.dead && nearest(raid.raiders, k.pos, 12));
        const foe = nearest(raid.raiders, kid.pos, 12);
        want = foe.pos;
        pace = 5;
        if (!n.guarding) {
          n.guarding = true;
          pop(n, "😤", "bad");
        }
        if (Math.hypot(foe.pos.x - n.pos.x, foe.pos.z - n.pos.z) < 2.5 + foe.scale && n.cool <= 0) {
          n.cool = 1.6;
          act(n, "bite");
          damageNPC(foe, npcDamage(P.brain, sp.abilities.bite || 1, "kin") * 0.8);
        }
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
      } else if (n.family && !n.following && atHome && P.familyOrder === "gather" && !raid && !n.trek) {
        ({ want, pace } = gatherTick(n));
      } else if (n.family && !n.following && atHome && P.familyOrder === "defend" && !n.trek) {
        ({ want, pace } = defendTick(n, family.indexOf(n)));
      } else if (n.family && n.trek && P.migration && !n.following && d < 45) {
        // Migrating: the family trails along behind you in a loose line.
        const k = family.indexOf(n) + 1;
        const back = 4 + k * 2.2,
          side = (k % 2 ? 1 : -1) * (1 + k * 0.4);
        const bx = -Math.cos(P.heading),
          bz = Math.sin(P.heading);
        want = { x: P.pos.x + bx * back - bz * side, z: P.pos.z + bz * back + bx * side };
        pace = Math.min(7, 1 + Math.hypot(want.x - n.pos.x, want.z - n.pos.z) * 1.2);
      } else if (n.following) {
        // Pack members: fight your target, otherwise trot behind you.
        // Allies only join a fight: never a social round, and never against their own nest.
        const ordered = n.orderTarget && !n.orderTarget.dead && npcs.has(n.orderTarget) && Math.hypot(n.orderTarget.pos.x - n.pos.x, n.orderTarget.pos.z - n.pos.z) < 40 ? n.orderTarget : null;
        if (!ordered) n.orderTarget = null;
        const fight = ordered || (leader && leader.nest !== n.nest && (P.aggro > 0 || leader.nest?.angry > 0) && (leader.nest?.angry > 0 || leader.species.temper === "hostile" || leader.epic));
        const foe = ordered || leader;
        if (n.hold && !ordered) {
          // Holding where you told it to (it still fights back if something comes at it).
          if (Math.hypot(n.hold.x - n.pos.x, n.hold.z - n.pos.z) > 1.5) {
            want = n.hold;
            pace = 4;
          }
        } else if (fight && (ordered || distTo(leader) < 18)) {
          if (foe !== leader) {
            want = foe.pos;
            pace = 5.8;
            if (Math.hypot(foe.pos.x - n.pos.x, foe.pos.z - n.pos.z) < 2.5 + foe.scale && n.cool <= 0) {
              n.cool = 1.4;
              act(n, "bite");
              const dmg = npcDamage(P.brain, sp.abilities.bite || 1, "kin") * mods.packDamage;
              if (foe.wild) eco.hurtWild(foe, dmg, n);
              else damageNPC(foe, dmg);
            }
          }
        }
        const plan = packPlan.get(n);
        if (plan && !(n.hold && !ordered) && !ordered) {
          // A threat to the pack: go for it, fanned out round it with the others, and defend whoever it is biting.
          const foe2 = plan.foe,
            fd = Math.hypot(foe2.pos.x - n.pos.x, foe2.pos.z - n.pos.z);
          want = fd > 3.5 ? flankPoint(foe2.pos, n.pos, plan.slot, plan.slots, 2 + foe2.scale) : foe2.pos;
          pace = 5.8;
          if (fd < 2.5 + foe2.scale && n.cool <= 0) {
            n.cool = 1.4;
            act(n, "bite");
            const dmg = npcDamage(P.brain, sp.abilities.bite || 1, "kin") * mods.packDamage;
            if (foe2.wild) eco.hurtWild(foe2, dmg, n);
            else damageNPC(foe2, dmg);
          }
        } else if ((n.hold && !ordered) || (ordered && ordered !== leader)) {
          /* holding, or going for the target you ordered (handled above) */
        } else if (fight && distTo(leader) < 18) {
          want = leader.pos;
          pace = 5.5;
          if (Math.hypot(leader.pos.x - n.pos.x, leader.pos.z - n.pos.z) < 2.5 + leader.scale && n.cool <= 0) {
            n.cool = 1.4;
            act(n, "bite");
            damageNPC(leader, npcDamage(P.brain, sp.abilities.bite || 1, "kin") * mods.packDamage);
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
              damageNPC(r, npcDamage(P.brain, sp.abilities.bite || 1, "kin") * mods.packDamage);
            }
          }
        } else if (d > 4) {
          want = { x: P.pos.x - Math.cos(P.heading) * 4, z: P.pos.z + Math.sin(P.heading) * 4 };
          pace = Math.min(7.5, d * 1.5);
        }
      } else if ((helping = allyAssist(n, time))) {
        ({ want, pace } = helping);
      } else if (n.mourn && !n.hunting && !(n.nest?.angry > 0) && !(n.nest?.cowed > 0)) {
        // Kin gather where one of them died, heads bowed, then go back to their lives.
        const mo = n.mourn;
        mo.walk = (mo.walk || 0) + dt;
        if (Math.hypot(mo.x - n.pos.x, mo.z - n.pos.z) > 2.4 + n.scale && mo.walk < 20) {
          want = mo;
          pace = 2.2;
        } else {
          n.body.setCrouch(1);
          if (!mo.popped) {
            mo.popped = true;
            if (d < 40) pop(n, "💧");
          }
          if ((mo.t -= dt) <= 0) {
            n.body.setCrouch(0);
            n.mourn = null;
          }
        }
      } else {
        const cowed = n.nest?.cowed > 0;
        const hostile = !n.member?.friend && n.calm <= 0 && !cowed && ((n.nest && n.nest.angry > 0) || sp.temper === "hostile" || n.epic || n.rogue || n.angryRival);
        // Sneaking shrinks how far away they notice you; once on your trail they follow further.
        // Epics and rogues prowl at night; everyone else is asleep.
        const aggro = ((n.epic ? 18 : n.rogue ? 15 : 8 + (sp.level || 1) * 1.1) + ((n.epic || n.rogue) && night ? 4 : 0)) * noticeScale() * mods.provoke;
        // Chase boundary: bolder fighters chase further, nobody chases without limit (combat-ai.js).
        const leash = chaseLimit(courageFor(n), { rogue: !!n.rogue, epic: !!n.epic });
        if (!n.hunting) n.chaseStart = { x: n.pos.x, z: n.pos.z };
        const chaseD = n.chaseStart ? Math.hypot(n.pos.x - n.chaseStart.x, n.pos.z - n.chaseStart.z) : 0;
        // Night, as in Spore: nest creatures go home and sleep. A sleeper wakes if attacked, spoken to,
        // or if you blunder right into it (sneak and you can tiptoe past).
        const sleepy =
          night && (n.nest || n.family) && courtship?.n !== n && !n.epic && !n.rogue && !(n.nest?.angry > 0) && !(n.nest?.migrating > 0) && !n.social && !n.hunting && n.wake <= 0 && !(P.aggro > 0 && d < 10);
        if (sleepy && !(d < (P.sneaking ? 1.6 : 3.4) + reach(n) * 0.5)) {
          n.hunting = false;
          if (homeD > 5) {
            want = home;
            pace = 2.2;
          } else {
            n.asleep = true;
            if (d < 30 && (n.zzz = (n.zzz ?? Math.random() * 3) - dt) <= 0) {
              n.zzz = 3.2 + Math.random() * 1.5;
              pop(n, "💤", "sleep");
            }
          }
        } else if (sleepy) {
          // Bumped awake: a moment's surprise, then whatever it would do by day.
          n.wake = 20;
          pop(n, "❗", "bad");
        } else if (hostile && d < (n.hunting ? aggro * 1.7 : aggro) && homeD < leash && chaseD < leash * 1.25 && P.deadTimer <= 0) {
          if (!n.hunting) noticeHunter(n, d);
          n.hunting = true;
          // A packmate in the way gets bitten first.
          const ally = nearest(packMembers(), n.pos, reach(n) + 0.4);
          // Several attackers fan out round you instead of all running at one point.
          let goal = P.pos;
          if (n.flank && n.flank.slots > 1 && d > reach(n) + 3) goal = flankPoint(P.pos, n.pos, n.flank.slot, n.flank.slots, reach(n) + 1.6);
          want = ally && Math.hypot(ally.pos.x - n.pos.x, ally.pos.z - n.pos.z) < d ? ally.pos : goal;
          pace = 4.2 + (sp.level || 1) * 0.3 + (n.epic ? 1.4 : 0) + (n.rogue ? 0.7 : 0);
          const bite = npcHit(n);
          if (n.windUp > 0) {
            // Committed to an attack: rooted, turning to face you. Step out of reach to dodge it.
            want = null;
            n.heading = turnTo(n.heading, Math.atan2(-(P.pos.z - n.pos.z), P.pos.x - n.pos.x), dt * 3);
            n.windUp -= dt;
            if (n.windUp <= 0) {
              n.body.setCrouch(0);
              act(n, "bite");
              voice(n, "bite");
              n.cool = n.epic ? NPC_ATTACK.recoveryApex : NPC_ATTACK.recovery;
              if (d < reach(n) + NPC_ATTACK.dodge && P.deadTimer <= 0) hurtPlayer(bite, "A " + sp.name + " got you");
              else {
                pop(n, "💨");
                tipOnce("dodge", "Dodged! Step back when they crouch.");
              }
              backOff(n);
            }
          } else if (n.backT > 0) {
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
            n.cool = 1.8;
            act(n, "bite");
            voice(n, "bite");
            hurtAlly(ally, bite * 0.8, time, n);
            backOff(n);
          } else if (d < reach(n) + 0.6 && n.cool <= 0) {
            // Wind up: a crouch you can read, then the lunge.
            n.windUp = n.epic || n.rogue ? NPC_ATTACK.windUpApex : NPC_ATTACK.windUp;
            n.body.setCrouch(1);
            want = null;
          }
        } else if (!n.member?.friend && ((sp.temper === "skittish" && d < (7 + (P.aggro > 0 ? 6 : 0)) * noticeScale() && (P.aggro > 0 || P.diet === "meat")) || (cowed && d < 14))) {
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
          } else {
            // Individual habits: the curious come to look, the shy keep off, the playful play, the young tag along.
            const q = idleLife(n, d, dt);
            if (q) ({ want, pace } = q);
          }
        }
      }
      // A hunter that loses you (not beaten, not scared off): you escaped it.
      if (wasHunting && !n.hunting && !n.dead && P.deadTimer <= 0 && d > 11 && !(n.fleeT > 0) && n.retreat === undefined && !(n.stun > 0) && n.calm <= 0 && !(n.nest?.cowed > 0) && !(n.wild && n.wb.mode === "flee") && time - lastEscape > 20) {
        lastEscape = time;
        note("escapes");
        if (P.health < P.maxHealth * 0.5) note("fled");
      }
      n.cs = combatState(n, d, homeD);
      // Followers that stop making progress get a nudge, and a lift if they are left far behind.
      if (n.following && want) {
        n.progress = (n.progress || 0) + Math.hypot(n.pos.x - (n.lastX ?? n.pos.x), n.pos.z - (n.lastZ ?? n.pos.z));
        n.lastX = n.pos.x;
        n.lastZ = n.pos.z;
        n.stuckClock = (n.stuckClock || 0) + dt;
        if (n.stuckClock > 0.8) {
          if (isStuck(n.progress, Math.hypot(want.x - n.pos.x, want.z - n.pos.z))) {
            n.nudgeT = 0.7;
            n.nudgeDir = Math.random() < 0.5 ? -1 : 1;
            n.stuckCount = (n.stuckCount || 0) + 1;
            if (n.stuckCount > 3 && d > 25) {
              const at = world.resolve(P.pos.x - Math.cos(P.heading) * 5, P.pos.z + Math.sin(P.heading) * 5, 1.2);
              n.pos.x = at.x;
              n.pos.z = at.z;
              n.stuckCount = 0;
            }
          } else n.stuckCount = 0;
          n.progress = 0;
          n.stuckClock = 0;
        }
        if (n.nudgeT > 0) {
          n.nudgeT -= dt;
          n.heading += n.nudgeDir * 2.2 * dt;
          pace = Math.max(pace, 4.5);
        }
      }
      if (want) {
        const dx = want.x - n.pos.x,
          dz = want.z - n.pos.z,
          dd = Math.hypot(dx, dz);
        if (dd > 0.6) {
          // Round the mountains rather than into them (only walls nearer than the goal count).
          const way = steerAround(n.pos.x, n.pos.z, dx, dz, 0.6 * n.scale, Math.min(9, dd));
          const target = Math.atan2(-way.z, way.x);
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
      if (n.asleep !== wasAsleep) n.body.setSleep(n.asleep);
      if (d < 70) {
        // Creatures close by watch you: always if they're hunting you or talking to you.
        const watching = d < 14 || n.hunting || (n.social && d < 24);
        n.body.lookAt(watching && P.deadTimer <= 0 ? lookTmp.set(P.pos.x, P.pos.y + P.body.height * P.scale * 0.8, P.pos.z) : null);
        n.body.update(dt, n.speed);
      }
    }
    nests.forEach((nest) => {
      nest.members.forEach((m) => {
        if (m.away > 0) m.away -= dt;
      });
      fade(nest.mem, dt);
      // An old grudge: a nest your kind has wronged turns on you when you come close (a gift calms it).
      if (nest.status === "neutral" && !(nest.angry > 0) && !(nest.cowed > 0) && P.deadTimer <= 0 && attitudeOf(nest.mem) === "hostile" && Math.hypot(nest.site.x - P.pos.x, nest.site.z - P.pos.z) < 22 * noticeScale() && !nest.members.some((m) => m.npc?.calm > 0)) {
        nest.angry = 25;
        const m = nest.members.find((x) => x.npc && !x.npc.dead);
        if (m) pop(m.npc, "💢", "bad");
      }
      // Eaten eggs are laid again, one at a time.
      if (nest.eggs < 3 && nest.status !== "extinct" && (nest.eggRegrow -= dt) <= 0) {
        nest.mesh.children[nest.eggs + 1].visible = true;
        nest.eggs++;
        nest.eggRegrow = 150;
      }
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
    for (let i = carcasses.length - 1; i >= 0; i--)
      if ((carcasses[i].life -= dt) <= 0) {
        leaveBones(carcasses[i].x, carcasses[i].z); // picked clean or rotted: the bones stay a while
        removeCarcass(i);
      }
    for (let i = bonesLeft.length - 1; i >= 0; i--)
      if ((bonesLeft[i].life -= dt) <= 0) {
        scene.remove(bonesLeft[i].g);
        bonesLeft.splice(i, 1);
      }
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
  function hurtAlly(n, dmg, time, by = null) {
    if (n.dead) return;
    if (by) {
      n.threatBy = by; // the rest of the pack goes for whoever is hurting one of them
      n.threatAt = time;
    }
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
    const aggro = 9 * noticeScale();
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
        hurtPlayer(npcDamage(n.species.level || 1, n.species.abilities.bite || 1, "predator"), "A raiding " + n.species.name + " got you");
      }
      return;
    }
    n.hunting = false;
    const prey = nearest(family, n.pos, 80);
    if (!prey) {
      n.want = nestAt;
      n.pace = 3;
      return;
    }
    n.want = prey.pos;
    n.pace = 4.8;
    if (Math.hypot(prey.pos.x - n.pos.x, prey.pos.z - n.pos.z) < 2.4 + n.scale * 0.6 && n.cool <= 0) {
      n.cool = 1.4;
      act(n, "bite");
      voice(n, "bite");
      hurtAlly(prey, npcDamage(n.species.level || 1, n.species.abilities.bite || 1, "predator"), timeUniform.value, n);
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
    $h("#chXp").style.width = (tribeReady ? 100 : (P.xp / xpNeed()) * 100) + "%";
    $h("#chXp").parentElement.classList.toggle("ready", tribeReady);
    $h("#chDna").textContent = "🧬 " + P.dna;
    // Your species' character, once one has formed: its icon rides on the history button, glowing when it shifts.
    const lean = $h("#chLean");
    const leanId = instinct || leaning;
    if (leanId && lean.dataset.id !== leanId) {
      lean.dataset.id = leanId;
      lean.textContent = INSTINCTS[leanId].icon;
      lean.style.setProperty("--c", { red: "#ef4b48", green: "#3fc26e", blue: "#3f9cf0" }[INSTINCTS[leanId].color]);
      lean.hidden = false;
      $h("#chHistory").setAttribute("aria-label", "Species history. Your species is " + (instinct ? "" : "becoming ") + INSTINCTS[leanId].title);
    }
    lean.classList.toggle("pulse", leanPulse > 0);
    const atNest = nearNest();
    $h("#chMate").hidden = !atNest || !!courtship || !!P.migration || !!brainFx;
    $h("#chMate").textContent = tribeReady ? "🔥 Mate · found a tribe" : "♡ Mate · new generation";
    $h("#chMate").classList.toggle("final", tribeReady);
    $h("#chTribe").hidden = !o.tribeUnlocked?.();
    // Watching a nest from nearby is enough to learn who lives there; sight lets you do it from further.
    const watch = 12 + P.abilities.sight * 6;
    for (const n of nests) if (n.status !== "extinct" && Math.hypot(n.site.x - P.pos.x, n.site.z - P.pos.z) < watch) discover(n.species);
    // Carrying: the button shows what it will do here (pick up, eat, give, store, let go).
    const ca = P.deadTimer > 0 ? null : carryAction();
    $h("#chActRow").hidden = !ca;
    if (ca) {
      $h("#chCarry").textContent = ca.label;
      $h("#chDrop").hidden = !P.carry || ca.id === "drop";
    }
    const eggs = eggNest();
    $h("#chEgg").hidden = !eggs || !$h("#chMate").hidden;
    if (eggs) tipOnce("eggs", "Eggs. They'll notice if you take one.");
    if (world.isNight && P.deadTimer <= 0) tipOnce("night", "Night. Most creatures sleep.");
    if (P.diet !== "meat" && world.fruitTreeNear(P.pos.x, P.pos.z, 9)) tipOnce("treeFruit", "Fruit up there. Hit the trunk.");
    const allied = nests.filter((n) => n.status === "allied").length,
      extinct = nests.filter((n) => n.status === "extinct").length;
    $h("#chObjective").textContent =
      !atHome
        ? "Visiting " + REGION.name + ". Your nest is in " + regionById(homeRegion).name + ": open the map to travel home."
        : P.migration
          ? (P.migration.to ? "Migrate to " + regionById(P.migration.to).name + ": lead your family to the far shore · " : "Migrate: lead your family to the new nest · ") +
            Math.round(Math.hypot(P.migration.x - P.pos.x, P.migration.z - P.pos.z)) +
            "m" +
            (tribeReady ? ". Then mate there." : "")
          : tribeReady
            ? "Fully evolved: go back to your nest and mate to found a tribe."
            : P.brain >= 5
              ? "Brain level 5. One last stretch of growth before your species can found a tribe."
            : P.hunger < 25
              ? "You're starving. Find " + (P.diet === "meat" ? "a carcass or prey" : P.diet === "plant" ? "fruit bushes" : "fruit or meat") + "."
              : "Befriend or hunt the nests: " + allied + " allied, " + extinct + " extinct of " + nests.length + ". " + areaAt(P.pos.x, P.pos.z);
    // Cooldown rings.
    hud.querySelectorAll(".chAb").forEach((b) => {
      const k = b.dataset.ab,
        cd = k === "card" ? P.cardCooldown / 30 : k === "next" ? 0 : (P.cooldowns[k] || 0) / cooldownOf(k);
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
    if (P.target && !P.target.dead && distTo(P.target) > 55) P.target = null; // out of sight, out of mind
    const t = P.target && !P.target.dead ? P.target : null;
    {
      // The card fades in and out rather than popping, and only exists while something is selected.
      const cardEl = $h("#chTarget");
      if (t) {
        cardEl.hidden = false;
        clearTimeout(cardHide.t);
        requestAnimationFrame(() => cardEl.classList.remove("fade"));
      } else if (!cardEl.hidden && !cardEl.classList.contains("fade")) {
        cardEl.classList.add("fade");
        cardHide.t = setTimeout(() => (cardEl.hidden = true), 260);
      }
      // A hunter on your heels during a social round-off? Switch to fighting moves, unless you just chose.
      if (P.mode === "social" && !activeEnc && performance.now() > (P.modeLock || 0) && [...npcs].some((n) => n.hunting && !n.dead && distTo(n) < 12)) setMode("combat");
    }
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
      $h("#chTargetRel").textContent = info.label;
      $h("#chTargetRel").style.background = info.color;
      card.classList.toggle("social", !!t.social);
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
              ? nest.members.filter((m) => m.friend).length + " of " + nest.members.filter((m) => m.alive).length + " befriended · Level " + nest.species.level + (PERSONALITIES[nest.species.personality] ? " · " + PERSONALITIES[nest.species.personality].name : "")
              : "Roams the island alone";
      // What this species likes to see, with the level it expects.
      const likes = canSocialise(t)
        ? "Likes " + sp.favourite.map((k) => `<span class="${P.abilities[k] >= socialNeed(sp, k) ? "ok" : "low"}" title="${ABILITY_INFO[k].name} ${socialNeed(sp, k)}">${ABILITY_INFO[k].icon}${socialNeed(sp, k)}</span>`).join(" ")
        : "";
      if ($h("#chTargetLikes").innerHTML !== likes) $h("#chTargetLikes").innerHTML = likes;
      $h("#chTargetHint").textContent = t.family
        ? tribeReady && nearNest()
          ? "Ready to found a tribe: use a social move"
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
    mini = minimap.element.getBoundingClientRect();
    goal = $h("#chObjective").getBoundingClientRect();
    for (const { n } of marks) {
      const pt = project(tmp.set(n.site.x, heightAt(n.site.x, n.site.z) + 6, n.site.z));
      // Not behind you, not up among the vitals and buttons at the top, not under the minimap.
      if (pt.behind || pt.y < (innerWidth <= 900 ? 135 : 90) || pt.x < 0 || pt.x > innerWidth || underMini(pt.x, pt.y)) continue;
      // Keep labels out from under the encounter arc.
      if (arcShown.mode && Math.abs(pt.x - innerWidth / 2) < 170 && pt.y < (innerWidth <= 900 ? 330 : 200)) continue;
      let icon = n.status === "allied" ? "💚" : n.status === "extinct" ? "🦴" : n.species.temper === "hostile" ? "⚠" : "◌";
      const known = P.discovered.has(n.species.id);
      if (n.migrating > 0) icon = "🐾";
      html += `<span class="chMark ${n.status}" style="left:${pt.x}px;top:${pt.y}px">${icon} ${known ? n.species.name : "???"}${n.status === "neutral" ? ` <small>Lv ${n.species.level}</small>` : ""}</span>`;
    }
    if (P.migration && atHome) html += edgeMark(P.migration, "migrate", "🐾 " + (P.migration.to ? "To " + regionById(P.migration.to).name : "New nest") + " · " + Math.round(Math.hypot(P.migration.x - P.pos.x, P.migration.z - P.pos.z)) + "m");
    const hp = project(tmp.set(nestAt.x, heightAt(nestAt.x, nestAt.z) + 6, nestAt.z));
    if (atHome && !hp.behind && !underMini(hp.x, hp.y) && !P.migration && (raid || Math.hypot(nestAt.x - P.pos.x, nestAt.z - P.pos.z) > 10))
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
      if (!bp.behind && !underMini(bp.x, bp.y)) html += `<span class="chMark bone" style="left:${bp.x}px;top:${bp.y}px">🦴 Fossil · ${Math.round(boneD)}m</span>`;
    }
    $h("#chMarkers").innerHTML = html;
  }

  /**
   * A marker for a far-off goal. On screen it sits over the spot; off screen it slides to the edge
   * in the direction to walk, with an arrow pointing the way.
   */
  /** The minimap's box on screen, refreshed each HUD update; labels keep out from under it. */
  let mini = null,
    goal = null;
  const inBox = (r, x, y) => !!r && r.width > 0 && x > r.left - 70 && x < r.right + 70 && y > r.top - 16 && y < r.bottom + 16;
  const underMini = (x, y) => inBox(mini, x, y) || inBox(goal, x, y);
  function edgeMark(at, cls, text) {
    const y = heightAt(at.x, at.z) + 8;
    const pt = project(tmp.set(at.x, y, at.z));
    const top = innerWidth <= 900 ? 150 : 110,
      bottom = innerHeight - (innerWidth <= 900 ? 250 : 170),
      side = 86;
    if (!pt.behind && pt.x > side && pt.x < innerWidth - side && pt.y > top && pt.y < bottom) return `<span class="chMark ${cls}" style="left:${pt.x}px;top:${pt.y}px">${text}</span>`;
    // Direction on screen from the camera's heading: 0 is straight ahead (up).
    const fx = Math.cos(camYaw),
      fz = -Math.sin(camYaw);
    const dx = at.x - P.pos.x,
      dz = at.z - P.pos.z;
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    const cx = innerWidth / 2,
      cy = (top + bottom) / 2;
    const sx = Math.sin(ang),
      sy = -Math.cos(ang);
    const k = Math.min((innerWidth / 2 - side) / Math.max(1e-3, Math.abs(sx)), ((bottom - top) / 2) / Math.max(1e-3, Math.abs(sy)));
    let ex = cx + sx * k,
      ey = cy + sy * k;
    if (underMini(ex, ey)) ey = Math.max(inBox(mini, ex, ey) ? mini.bottom : 0, inBox(goal, ex, ey) ? goal.bottom : 0) + 18; // slide down past the minimap and objective
    return `<span class="chMark ${cls} edge" style="left:${ex}px;top:${ey}px"><i class="mArrow" style="transform:rotate(${ang}rad)">▲</i>${text}</span>`;
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

  if (!save.record) setTimeout(() => tipOnce("land", "Tap a creature, then pick a move."), 2500);

  /* ---- moving between regions --------------------------------------------------
     A region change saves, fades to black with the region's name, and main.js restarts the stage
     in the new region (a clean rebuild of the world, its nests and its creatures). */
  function changeRegion(id, why) {
    if (leaving) return;
    clearCarry(); // food stays where it was found
    leaving = true;
    if (why === "migrate") {
      homeRegion = id;
      unlockedRegions.add(id);
      P.migration = null;
      P.pastHomes = [];
    }
    const data = snapshot();
    data.region = id;
    data.arrival = why;
    if (why === "migrate") delete data.home; // the new nest is picked on arrival
    try {
      localStorage.setItem(CREATURE_SAVE_KEY, JSON.stringify(data));
      o.onSaved?.();
    } catch (e) {
      /* storage unavailable: the swap still happens */
    }
    const r = regionById(id);
    const fade = document.createElement("div");
    fade.id = "regionFade";
    fade.className = "chRegionFade";
    fade.setAttribute("role", "status");
    fade.innerHTML = `<small>${why === "migrate" ? "Your species migrates to" : "Travelling to"}</small><b>${r.name}</b><span>${r.blurb}</span>`;
    document.body.appendChild(fade);
    o.sfx("friend");
    setTimeout(() => o.onChangeRegion?.(), 1100);
  }
  /** Travel to a region you have lived in (from the island map). */
  function travelTo(id) {
    if (id === regionId || !unlockedRegions.has(id)) return;
    const busy = P.migration ? "Finish your migration first." : raid ? "Your nest is under attack!" : [...npcs].some((n) => n.hunting && distTo(n) < 30) ? "Not while something is hunting you." : courtship ? "Not now." : "";
    if (busy) return toast(busy, 2.4);
    islandMap?.close();
    changeRegion(id, "travel");
  }
  // Arriving: lift the fade and announce the region; a new region is worth a reward.
  {
    const fade = document.getElementById("regionFade");
    if (fade) {
      fade.classList.add("out");
      setTimeout(() => fade.remove(), 1200);
    }
    if (arrival) {
      setTimeout(() => {
        toast(REGION.name + (atHome ? "" : " · visiting"), 3);
        if (arrival === "migrate") {
          o.onChronicle?.({ key: "region:" + regionId, stage: "creature", icon: "🧭", text: "Migrated to the " + REGION.name + "." });
          P.dna += 25;
          gainXp(30, true);
          pop(P, "🧭", "good");
          tipOnce("newRegion_" + regionId, REGION.name);
        }
        saveState(); // clears the arrival
      }, 900);
    }
  }

  return {
    camera,
    get brain() {
      return P.brain;
    },
    get record() {
      return P.record;
    },
    /** The editor finished: the new design replaces the old one. */
    editorState,
    /** Crawl out of the sea now (after the arrival editor). */
    playIntro: () => {
      beginIntro();
      P.body.root.position.copy(P.pos);
    },
    applyDesign(record, dnaLeft) {
      // Whatever you have been wearing stays yours, even if it was never earned the usual way.
      creaturePartIds(P.record).forEach((id) => P.unlocked.add(id));
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
        entry(nest.species, areaAt(nest.site.x, nest.site.z) + " · Level " + nest.species.level, nest.status, { members: nest.members.filter((m) => m.alive).length });
      }
      for (const e of [...epics, ...rogues])
        if (P.discovered.has(e.species.id)) entry(e.species, "Wanders", e.alive ? (e.species.epic ? "epic" : "rogue") : "defeated");
      return out;
    },
    update(dt) {
      if (paused) return;
      world.update(dt, P.pos);
      streamClock -= dt;
      if (streamClock <= 0) {
        streamClock = 0.5;
        streamNests();
        eco.stream(P.pos.x, P.pos.z, ACTIVE_RANGE);
        if (!intro) watchEcology(0.5);
      }
      if (intro) {
        updateIntro(dt);
        updateDust(dt);
        emotes.update(dt);
        updateNPCs(dt, timeUniform.value);
        return;
      }
      if (cine) {
        updateStickThrow(dt);
        if (disposed) return; // handed over to the Tribal Stage
        updateDust(dt);
        emotes.update(dt);
        updateNPCs(dt, timeUniform.value);
        return;
      }
      updatePlayer(dt);
      if (brainFx) updateBrainFx(dt);
      weather.update(dt, P, world.isNight);
      if (weather.meteorite && P.deadTimer <= 0 && Math.hypot(weather.meteorite.x - P.pos.x, weather.meteorite.z - P.pos.z) < 2.6) digMeteorite();
      updateDust(dt);
      emotes.update(dt);
      updateMonster(dt);
      updateNPCs(dt, timeUniform.value);
      updateRaid(dt);
      updateEncounters(dt);
      updateLarder(dt);
      applyEcoActions(eco.simulate(dt));
      updateMigration();
      updateUfo(dt);
      regrowFamily(dt);
      if (beacon.visible) beacon.material.opacity = 0.2 + 0.08 * Math.sin(timeUniform.value * 2.4);
      arcState.sour = Math.max(0, arcState.sour - dt);
      leanPulse = Math.max(0, leanPulse - dt);
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
      if ((mapClock -= dt) <= 0) {
        mapClock = 0.08;
        minimap.draw({ x: P.pos.x, z: P.pos.z, yaw: camYaw, heading: P.heading, time: timeUniform.value, markers: mapMarkers(false), range: 56 + P.abilities.sight * 8 });
      }
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) $h("#chToast").classList.remove("show");
      if (hintTimer > 0 && (hintTimer -= dt) <= 0) $h("#chHint").classList.remove("show");
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
      return { brain: P.brain, alliances: P.alliances, extinctions: P.extinctions, deaths: P.deaths, nests: nests.length, npcs: npcs.size, dna: P.dna, hunger: P.hunger, health: P.health, card: P.card, instinct, leaning, ledger: { ...ledger }, rep: { ...rep } };
    },
    debug: {
      ledger,
      note,
      applyEcoActions,
      enc,
      startEncounter,
      playStickThrow,
      get tribeReady() {
        return tribeReady;
      },
      get brainFx() {
        return brainFx;
      },
      get cine() {
        return cine;
      },
      chooseEncounter,
      get encounter() {
        return encounter;
      },
      bonesLeft,
      get familyAll() {
        return family;
      },
      get mods() {
        return mods;
      },
      weather,
      P,
      nests,
      npcs,
      rogues,
      gainXp,
      mate,
      useAbility,
      world,
      eco,
      carcasses,
      dropCarcass,
      setOrder: (o2) => setOrder(o2),
      damageNPC,
      packPlan: () => packPlan,
      setMode,
      doCarry: () => doCarry(),
      toast,
      select,
      migrateNests,
      evolveIsland,
      /** Call the UFO now (tests). */
      ufoNow() {
        ufoClock = 0;
      },
      get ufo() {
        return ufo;
      },
      toggleMap: () => toggleMap(),
      travelTo: (id) => travelTo(id),
      get region() {
        return { id: regionId, home: homeRegion, unlocked: [...unlockedRegions], nest: { ...nestAt } };
      },
      /** Point the camera (tests and screenshots). */
      aim(yaw, pitch = 0) {
        camYaw = yaw;
        view.pitch = pitch;
        view.lastManual = performance.now();
      },
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
      disposed = true;
      saveState();
      weather.dispose();
      clearTimeout(picTimer);
      islandMap?.close();
      endUfo();
      leafMat.dispose();
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
      stickGeo.dispose();
      stickMat.dispose();
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
