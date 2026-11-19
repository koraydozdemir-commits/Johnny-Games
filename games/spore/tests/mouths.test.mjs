import { test } from "node:test";
import assert from "node:assert/strict";
import { CREATURE_PARTS, PART_SECTIONS, abilitiesOf, creaturePart, dietOfParts, partGeometry } from "../creature/parts.js";
import {
  MOUTH_IDS,
  MOUTH_STATS,
  STARTER_MOUTHS,
  biteCooldown,
  compareMouths,
  earnedMouths,
  feedsOn,
  mouthDiet,
  mouthEarned,
  mouthsOfDiet,
  newlyEarned,
  progressOf,
  requirementText,
  requirementsOf,
} from "../creature/mouths.js";
import { ATTACKS, abilityScale } from "../creature/balance.js";
import { validateCreature } from "../creature/format.js";
import { tileHtml, infoHtml, mouthTableHtml } from "../creature/editor-catalogue.js";

const mouthParts = CREATURE_PARTS.filter((p) => p.slot === "mouth");

test("every mouth part has stats, and every stat row is a real mouth", () => {
  assert.deepEqual(mouthParts.map((p) => p.id).sort(), [...MOUTH_IDS].sort());
  for (const p of mouthParts) assert.ok(MOUTH_STATS[p.id], p.id);
});

test("a mouth's diet is derived from what it can eat, and matches its part", () => {
  for (const p of mouthParts) assert.equal(p.diet, mouthDiet(p.id), p.id + " diet");
  assert.equal(dietOfParts(["jaws", "eyes"]), "meat");
  assert.equal(dietOfParts(["beak"]), "plant");
  assert.equal(dietOfParts(["snout"]), "omni");
  // Herbivore mouths cannot eat meat, carnivore mouths cannot eat plants, omnivores eat both.
  for (const id of mouthsOfDiet("plant")) assert.deepEqual([feedsOn(id, "meat"), feedsOn(id, "plant") > 0], [0, true], id);
  for (const id of mouthsOfDiet("meat")) assert.deepEqual([feedsOn(id, "plant"), feedsOn(id, "meat") > 0], [0, true], id);
  for (const id of mouthsOfDiet("omni")) assert.ok(feedsOn(id, "plant") > 0 && feedsOn(id, "meat") > 0, id);
});

test("each diet has five mouths and exactly one starter", () => {
  for (const diet of ["plant", "meat", "omni"]) {
    assert.equal(mouthsOfDiet(diet).length, 5, diet);
    assert.equal(mouthsOfDiet(diet).filter((id) => STARTER_MOUTHS.includes(id)).length, 1, diet);
  }
  assert.deepEqual([...STARTER_MOUTHS].sort(), ["beak", "jaws", "snout"]);
});

test("every mouth has its own model, not a recolour of another", () => {
  const sizes = new Map();
  for (const id of MOUTH_IDS) {
    const g = partGeometry(id, 0x7fb0d0);
    const n = g.attributes.position.count;
    assert.ok(n > 40, id + " has a real model");
    g.computeBoundingBox();
    const d = g.boundingBox.getSize(new (g.boundingBox.min.constructor)());
    sizes.set(id, [n, +d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)].join("/"));
  }
  assert.equal(new Set(sizes.values()).size, MOUTH_IDS.length, "no two mouths share a silhouette: " + JSON.stringify([...sizes]));
});

test("no mouth is better than another of its diet in every statistic", () => {
  const keys = (id) => {
    const s = MOUTH_STATS[id];
    return [s.bite, s.rate, s.social, s.eat.plant, s.eat.meat, s.reach];
  };
  for (const diet of ["plant", "meat", "omni"]) {
    const ids = mouthsOfDiet(diet);
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const [x, y] = [keys(a), keys(b)];
        const dominates = x.every((v, i) => v >= y[i]) && x.some((v, i) => v > y[i]);
        assert.ok(!dominates, `${a} dominates ${b}`);
      }
  }
});

test("mouths trade off: bite damage, small talk and feeding favour different diets", () => {
  // Damage per second of biting: bite level, damage multiplier and speed together.
  const dps = (id) => MOUTH_STATS[id].bite * abilityScale(creaturePart(id).abilities.bite || 1) * (MOUTH_STATS[id].rate / ATTACKS.bite.cooldown);
  const best = Math.max(...MOUTH_IDS.map(dps)),
    worst = Math.min(...MOUTH_IDS.map(dps));
  assert.ok(best / worst < 3.6, `bite DPS spread ${worst.toFixed(2)}..${best.toFixed(2)}`);
  // The hardest-hitting mouth is a carnivore's, the best talker is a herbivore's, the best feeder is not an omnivore's.
  const top = (f) => MOUTH_IDS.reduce((a, b) => (f(b) > f(a) ? b : a));
  assert.equal(mouthDiet(top((id) => MOUTH_STATS[id].bite)), "meat");
  assert.equal(mouthDiet(top((id) => MOUTH_STATS[id].social)), "plant");
  assert.notEqual(mouthDiet(top((id) => Math.max(MOUTH_STATS[id].eat.plant, MOUTH_STATS[id].eat.meat))), "omni");
  // Omnivores are flexible: their worst-of-both is never the best-of-either.
  for (const id of mouthsOfDiet("omni")) assert.ok(Math.max(MOUTH_STATS[id].eat.plant, MOUTH_STATS[id].eat.meat) < 1.1, id);
});

test("the bite cooldown follows the mouth", () => {
  assert.ok(biteCooldown("snapper", 1) > biteCooldown("jaws", 1), "a snapper is slower than jaws");
  assert.ok(biteCooldown("fangs", 1) < biteCooldown("jaws", 1), "fangs are quicker than jaws");
  assert.equal(biteCooldown("nope", 1.2), 1.2);
});

test("a new player has exactly the three starter mouths", () => {
  const p = progressOf({});
  assert.deepEqual([...earnedMouths(p)].sort(), [...STARTER_MOUTHS].sort());
  for (const id of MOUTH_IDS.filter((m) => !STARTER_MOUTHS.includes(m))) assert.equal(mouthEarned(id, p), false, id);
});

test("mouths unlock gradually with brain level, wins, allies and foods", () => {
  const at = (extra) => new Set(earnedMouths(progressOf(extra)));
  const b2 = at({ brain: 2 });
  assert.ok(["grinder", "fangs", "bill"].every((id) => b2.has(id)), "basic variations at brain 2");
  assert.ok(!b2.has("snapper") && !b2.has("trunk"));
  const b3 = at({ brain: 3 });
  assert.ok(!b3.has("shears"), "brain alone is not enough: shears also want foods");
  assert.ok(at({ brain: 3, foods: new Set(["a", "b", "c"]) }).has("shears"));
  assert.ok(!at({ brain: 3, treated: { x: { kills: 2 } } }).has("snapper"));
  assert.ok(at({ brain: 3, treated: { x: { kills: 2 }, y: { kills: 1 } } }).has("snapper"), "kills are summed across species");
  assert.ok(at({ brain: 3, alliances: 1 }).has("fluteBeak"));
  assert.ok(!at({ brain: 4, alliances: 1 }).has("trunk"), "trunk wants two alliances");
  // Everything is eventually reachable, and the advanced ones need the most.
  const full = at({ brain: 5, alliances: 3, foods: new Set(["a", "b", "c", "d"]), treated: { x: { kills: 20 } } });
  assert.equal(full.size, MOUTH_IDS.length);
  const tier = (id) => MOUTH_STATS[id].tier;
  for (const id of MOUTH_IDS) assert.ok(MOUTH_STATS[id].unlock.brain >= [1, 2, 3, 4][tier(id)], id);
});

test("locked mouths explain what unlocks them, with progress", () => {
  const p = progressOf({ brain: 3, treated: { x: { kills: 2 } } });
  const reqs = requirementsOf("snapper", p);
  assert.deepEqual(
    reqs.map((r) => [r.key, r.have, r.need, r.done]),
    [["brain", 3, 3, true], ["kills", 2, 3, false]],
  );
  assert.match(requirementText("snapper", p), /Reach brain level 3 · Defeat 3 creatures \(2\/3\)/);
  assert.equal(requirementText("beak", p), "Available from the start");
});

test("newlyEarned reports exactly what a step of progress opened", () => {
  const before = progressOf({ brain: 1 }),
    after = progressOf({ brain: 2 });
  assert.deepEqual(newlyEarned(before, after).sort(), ["bill", "fangs", "grinder"]);
  assert.deepEqual(newlyEarned(after, after), []);
});

test("comparing mouths reports better and worse per statistic", () => {
  const c = Object.fromEntries(compareMouths("jaws", "snapper").map((r) => [r.key, r.delta]));
  assert.ok(c.bite > 0 && c.rate < 0 && c.social < 0 && c.meat > 0);
  assert.ok(compareMouths("beak", "beak").every((r) => r.delta === 0));
});

test("the equipped mouth decides diet and ability levels on a real design", () => {
  const base = { spine: [{ x: -1, y: 0, r: 0.4 }, { x: 0, y: 0, r: 0.6 }, { x: 1, y: 0, r: 0.4 }], legs: [{ t: 0.5, length: 1 }], foot: "pads" };
  for (const id of MOUTH_IDS) {
    const rec = validateCreature({ ...base, parts: [{ id, t: 1, angle: 0 }] });
    const ids = rec.parts.map((p) => p.id);
    assert.deepEqual(ids, [id], "a mouth survives validation");
    assert.equal(dietOfParts(ids), mouthDiet(id));
    const a = abilitiesOf(ids, 1, 0);
    assert.equal(a.bite, Math.max(0, creaturePart(id).abilities.bite || 0) || a.bite);
  }
  // Two mouths on one record: only one is kept.
  assert.equal(validateCreature({ ...base, parts: [{ id: "jaws" }, { id: "beak" }] }).parts.filter((p) => creaturePart(p.id).slot === "mouth").length, 1);
});

test("old creatures keep their mouths: every mouth id from earlier versions still exists", () => {
  for (const id of ["beak", "jaws", "snout", "fluteBeak", "trunk", "tuskMaw", "mandibles", "crusher", "sawBeak"]) assert.ok(creaturePart(id)?.slot === "mouth", id);
});

test("every part is in a catalogue category, and categories are not empty", () => {
  const sections = new Set(PART_SECTIONS.map(([id]) => id));
  for (const p of CREATURE_PARTS) assert.ok(sections.has(p.section), p.id + " has no category");
  for (const [id] of PART_SECTIONS) if (id !== "limbs") assert.ok(CREATURE_PARTS.some((p) => p.section === id), id + " is empty");
});

test("catalogue markup: locked tiles say so, hide undiscovered names, and show requirements", () => {
  const def = creaturePart("snapper");
  const locked = tileHtml(def, { thumb: "", unlocked: false, seen: false, inUse: false, focused: false });
  assert.match(locked, /locked/);
  assert.match(locked, /Undiscovered mouth/);
  assert.doesNotMatch(locked, /Snapper/);
  const progress = progressOf({ brain: 2 });
  const card = infoHtml(def, { unlocked: false, seen: true, inUse: false, previewing: true, progress, mouthNow: "jaws", now: {}, after: {}, exclusive: true, blocked: "" });
  assert.match(card, /Locked/);
  assert.match(card, /Reach brain level 3/);
  assert.match(card, /Defeat 3 creatures/);
  assert.match(card, /Clamp/, "special is described");
  assert.doesNotMatch(card, /data-act="equip"/, "a locked mouth cannot be equipped");
  const open = infoHtml(creaturePart("fangs"), { unlocked: true, seen: true, inUse: false, previewing: true, progress, mouthNow: "jaws", now: {}, after: {}, exclusive: true, blocked: "" });
  assert.match(open, /data-act="equip"/);
  assert.match(mouthTableHtml("fangs", "jaws"), /class="up"|class="down"/, "comparison chips are shown");
});

test("no emoji in the catalogue markup", () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const id of MOUTH_IDS) {
    const def = creaturePart(id);
    for (const unlocked of [true, false]) {
      const html = tileHtml(def, { thumb: "", unlocked, seen: true, inUse: false, focused: false }) + infoHtml(def, { unlocked, seen: true, inUse: false, previewing: false, progress: progressOf({}), mouthNow: "beak", now: {}, after: {}, exclusive: true, blocked: "" });
      assert.doesNotMatch(html, emoji, id);
    }
  }
});
