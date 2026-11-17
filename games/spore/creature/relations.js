/**
 * How a creature feels about you, on Spore's five-step scale. Shown as a face (the player's own
 * drawings) on the selection card, the encounter arc and over creatures' heads when it changes.
 *
 * relationOf() is pure: it reads only the fields of the creature it is given, so it can be unit
 * tested without a scene.
 */

/** Worst to best. */
export const RELATIONS = ["furious", "annoyed", "neutral", "friendly", "allied"];

const face = (name) => new URL("../img/faces/" + name + ".png", import.meta.url).href;

export const RELATION_INFO = {
  furious: { label: "Furious", color: "#ef4b48", face: face("furious") },
  annoyed: { label: "Annoyed", color: "#f08a3c", face: face("annoyed") },
  neutral: { label: "Neutral", color: "#b9c3c9", face: face("neutral") },
  friendly: { label: "Friendly", color: "#4fa3f0", face: face("friendly") },
  allied: { label: "Allied", color: "#3fc26e", face: face("allied") },
};

/** Creatures that are always against you: epics, rogues and nest raiders. */
const isPredatorKind = (n) => !!(n.epic || n.rogue || n.raider);

/**
 * @param {object} n  a live creature: { following, family, member, nest, species, epic, rogue, raider,
 *                    calm, social, hunting, health, maxHealth }
 * @returns {"furious"|"annoyed"|"neutral"|"friendly"|"allied"}
 */
export function relationOf(n) {
  if (!n) return "neutral";
  if (n.following || n.family || n.member?.friend || n.nest?.status === "allied") return "allied";
  const calm = (n.calm || 0) > 0;
  if (isPredatorKind(n)) return n.hunting ? "furious" : "annoyed";
  if ((n.nest?.cowed || 0) > 0) return "annoyed"; // its alpha fell: wary of you, but not looking for a fight
  if ((n.nest?.angry || 0) > 0 && !calm) return "furious";
  if (n.species?.temper === "hostile" && !calm) return n.hunting ? "furious" : "annoyed";
  if ((n.nest?.snub || 0) > 0) return "annoyed";
  if ((n.social?.progress || 0) >= 0.5) return "friendly";
  if (n.nest?.members?.some((m) => m.alive && m.friend)) return "friendly";
  return "neutral";
}

/** -2 .. +2: how far up or down the scale a change went (used to pick a happy or sour pop). */
export const relationDelta = (from, to) => RELATIONS.indexOf(to) - RELATIONS.indexOf(from);
