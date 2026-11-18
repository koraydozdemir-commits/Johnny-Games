/**
 * Creature Stage balance: one model for every health bar and every hit, so numbers are consistent
 * instead of tuned creature by creature. All tuning lives in the tables at the top.
 *
 * Targets (checked by tests/balance.test.mjs), for a creature of your own level:
 *   prey                  2–4 hits      a comparable predator   3–6 hits
 *   alpha / elite         5–8 hits      apex (epics)            6–10 hits (or a tactic)
 *   an ordinary enemy needs 8+ bites to kill you; an apex needs 4+.
 *
 * Levels: the player's level is its brain (1..5); a species' level comes from species.atLevel.
 */

/** How much stronger each level is than the one before (health and damage both). */
const LEVEL_STEP = 0.25;
export const levelFactor = (level) => 1 + LEVEL_STEP * (Math.max(1, Math.min(5, level)) - 1);

/** Player attacks: base damage at level 1, how hard each move hits, and its recovery (cooldown). */
export const PLAYER_BASE_DAMAGE = 14;
export const ATTACKS = {
  // mult: share of base damage · cooldown: seconds before you can use it again · stagger: seconds the target is staggered
  bite: { mult: 1.0, cooldown: 1.0, stagger: 0, range: 1.2 },
  strike: { mult: 0.8, cooldown: 0.8, stagger: 0.35, range: 1.4 },
  charge: { mult: 1.5, cooldown: 5.0, stagger: 0.6, range: 0 },
  spit: { mult: 0.75, cooldown: 2.2, stagger: 0, range: 18 },
};
/** An ability's level (1..5) scales its damage: level 1 hits for 0.85×, level 5 for 1.45×. */
export const abilityScale = (lvl) => 0.7 + 0.15 * Math.max(1, Math.min(5, lvl || 1));

/** A peer's health is this many average hits. */
const PEER_HITS = 4.2;
/** Health and damage multipliers by role. Size is folded into the role, so giants don't get inflated health. */
export const ROLES = {
  prey: { hp: 0.6, dmg: 0.5 },
  grazer: { hp: 0.8, dmg: 0.7 },
  standard: { hp: 1.0, dmg: 1.0 },
  predator: { hp: 1.0, dmg: 1.1 },
  rogue: { hp: 1.9, dmg: 1.35 },
  // Wildlife (ecosystem.js)
  ambusher: { hp: 0.9, dmg: 1.4 }, // fragile but hits hard from hiding
  guardian: { hp: 1.4, dmg: 1.2 }, // holds its ground
  giant: { hp: 1.8, dmg: 1.45 }, // a big herbivore: leave it be
  apex: { hp: 2.1, dmg: 2.0 },
  kin: { hp: 0.85, dmg: 0.9 }, // your family and pack
};
/** A nest's alpha is its own kind, only bigger: this much tougher and harder-hitting. */
export const ALPHA = { hp: 1.6, dmg: 1.25 };
/** Health stat (0..5, from shells, plates…) adds 8% per level. */
const healthBonus = (healthStat) => 1 + 0.08 * Math.max(0, healthStat || 0);

/** Health of a non-player creature. */
export function npcHealth(level, healthStat = 0, role = "standard") {
  const r = ROLES[role] || ROLES.standard;
  return Math.round(PLAYER_BASE_DAMAGE * levelFactor(level) * PEER_HITS * healthBonus(healthStat) * r.hp);
}

/** Damage one of your attacks does. `ambush` multiplies the first blow from hiding. */
export function playerDamage(kind, abilityLvl, brain, ambush = 1) {
  const a = ATTACKS[kind] || ATTACKS.bite;
  return PLAYER_BASE_DAMAGE * levelFactor(brain) * a.mult * abilityScale(abilityLvl) * ambush;
}

/** Your health: 110 at brain 1, rising a quarter per brain level, plus 12% per health level. */
export const playerHealth = (brain, healthStat = 0) => Math.round(110 * levelFactor(brain) * (1 + 0.12 * Math.max(0, healthStat || 0)));

/** Base damage of a creature's bite at level 1 (against a player of level 1 that's 110 health). */
const NPC_BASE_DAMAGE = 11;
/** Damage one bite (or hit) from a creature does. */
export function npcDamage(level, biteLvl, role = "standard") {
  const r = ROLES[role] || ROLES.standard;
  return NPC_BASE_DAMAGE * levelFactor(level) * abilityScale(biteLvl) * r.dmg;
}

/**
 * Creature attack timing: a readable wind-up you can dodge, then recovery before the next attack.
 * Big creatures wind up longer (and hit harder through their role).
 */
export const NPC_ATTACK = { windUp: 0.45, windUpApex: 0.75, recovery: 1.7, recoveryApex: 2.1, dodge: 1.0 };
/** After being staggered, a creature can't be staggered again for this long (no stun-locks). */
export const STAGGER_IMMUNITY = 1.6;
export const MAX_STAGGER = 0.6;

/**
 * Apply a stagger to a creature, respecting immunity. Mutates and returns the creature's
 * { stun, staggerImmune } fields. `now` is the current time in seconds.
 */
export function applyStagger(n, seconds, now) {
  if (seconds <= 0 || now < (n.staggerImmune || 0)) return n;
  n.stun = Math.max(n.stun || 0, Math.min(MAX_STAGGER, seconds));
  n.staggerImmune = now + n.stun + STAGGER_IMMUNITY;
  return n;
}

/** The role a creature plays in a fight, from what it is. */
export function roleOf(n) {
  if (n.epic) return "apex";
  if (n.rogue) return "rogue";
  if (n.family || n.following) return "kin";
  if (n.species?.role) return n.species.role;
  const diet = n.species?.diet;
  return diet === "plant" ? "grazer" : diet === "meat" ? "predator" : "standard";
}

/** Damage a creature deals per hit, including its alpha bonus. */
export const npcHit = (n) => npcDamage(n.species?.level || 1, n.species?.abilities?.bite || 1, roleOf(n)) * (n.alpha ? ALPHA.dmg : 1);

/** Average hits to kill, for tests and the editor's readout. */
export function hitsToKill(targetHealth, kind, abilityLvl, brain) {
  return Math.ceil(targetHealth / playerDamage(kind, abilityLvl, brain));
}
