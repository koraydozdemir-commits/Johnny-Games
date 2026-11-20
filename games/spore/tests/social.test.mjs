import { test } from "node:test";
import assert from "node:assert/strict";
import { RELATIONS, RELATION_INFO, relationDelta, relationOf } from "../creature/relations.js";
import { ROGUE_PARTS, generateRogue, generateSpecies } from "../creature/species.js";
import { abilitiesOf, creaturePart } from "../creature/parts.js";
import { validateCreature } from "../creature/format.js";
import { SLOT_COUNT, activeSlot, clearSlot, gameKeys, markSaved, slotSummary, switchSlot } from "../slots.js";
import { loadSettings, saveSettings, timeAgo } from "../settings.js";

const species = (temper = "wary") => ({ temper });
const nest = (over = {}) => ({ status: "neutral", angry: 0, snub: 0, cowed: 0, members: [{ alive: true, friend: false }], ...over });

test("the five relations run from furious to allied, each with a face and colour", () => {
  assert.deepEqual(RELATIONS, ["furious", "annoyed", "neutral", "friendly", "allied"]);
  for (const r of RELATIONS) {
    assert.match(RELATION_INFO[r].face, new RegExp("img/faces/" + r + "\\.png$"));
    assert.match(RELATION_INFO[r].color, /^#[0-9a-f]{6}$/);
  }
  assert.equal(relationDelta("neutral", "allied"), 2);
  assert.equal(relationDelta("friendly", "furious"), -3);
});

test("friends, family and allied nests are allied", () => {
  assert.equal(relationOf({ family: true, species: species("friendly") }), "allied");
  assert.equal(relationOf({ following: true, species: species("hostile") }), "allied");
  assert.equal(relationOf({ member: { friend: true }, nest: nest({ angry: 30 }), species: species() }), "allied");
  assert.equal(relationOf({ member: {}, nest: nest({ status: "allied" }), species: species() }), "allied");
});

test("anger, snubs and encounters move a creature along the scale", () => {
  const n = { member: {}, nest: nest(), species: species() };
  assert.equal(relationOf(n), "neutral");
  n.social = { progress: 0.3 };
  assert.equal(relationOf(n), "neutral");
  n.social.progress = 0.6;
  assert.equal(relationOf(n), "friendly");
  n.social = null;
  n.nest.snub = 12;
  assert.equal(relationOf(n), "annoyed");
  n.nest.angry = 20;
  assert.equal(relationOf(n), "furious");
  n.calm = 5; // a calming song
  assert.equal(relationOf(n), "annoyed", "calmed, but still snubbing");
  n.nest.snub = 0;
  n.nest.angry = 0;
  n.nest.members.push({ alive: true, friend: true });
  assert.equal(relationOf(n), "friendly", "some of its nest are already friends");
});

test("hunters are annoyed until they are after you; epics, rogues and raiders too", () => {
  const hunter = { member: {}, nest: nest(), species: species("hostile") };
  assert.equal(relationOf(hunter), "annoyed");
  hunter.hunting = true;
  assert.equal(relationOf(hunter), "furious");
  for (const kind of ["epic", "rogue", "raider"]) {
    assert.equal(relationOf({ [kind]: true, species: species("hostile") }), "annoyed");
    assert.equal(relationOf({ [kind]: true, hunting: true, species: species("hostile") }), "furious");
  }
});

test("a nest whose alpha fell is cowed, not furious", () => {
  assert.equal(relationOf({ member: {}, nest: nest({ cowed: 30, angry: 0 }), species: species("hostile") }), "annoyed");
  assert.equal(relationOf({ member: {}, nest: nest({ cowed: 30, angry: 40 }), species: species("skittish") }), "annoyed");
});

test("rogues are tough loners carrying a rare part", () => {
  for (const seed of [1, 77, 31337, 104729]) {
    const base = generateSpecies(seed, seed % 3 === 0 ? "omni" : "meat", 3);
    const r = generateRogue(seed, 3);
    assert.ok(ROGUE_PARTS.includes(r.rare));
    assert.ok(r.record.parts.some((p) => p.id === r.rare), "wears its rare part");
    assert.ok(creaturePart(r.rare).cost >= 20, "the part is a rare one");
    assert.equal(r.temper, "hostile");
    assert.equal(r.members, 1);
    assert.ok(r.maxHealth > base.maxHealth * 1.7 && r.scale > base.scale, "an elite: much tougher than its kind (balance.js rogue role)");
    assert.deepEqual(validateCreature(r.record), r.record, "a valid record");
    assert.deepEqual(generateRogue(seed, 3).record, r.record, "the same every time");
  }
});

test("sneak, jump and glide come from parts", () => {
  const plain = abilitiesOf(["jaws", "eyes", "hooves"], 2);
  assert.equal(plain.sneak, 0);
  assert.ok(plain.jump >= 1, "legs can hop");
  assert.equal(plain.glide, 0);
  const sneaky = abilitiesOf(["jaws", "antennae", "pads", "wings"], 2);
  assert.ok(sneaky.sneak >= 2);
  assert.ok(sneaky.glide >= 1);
  assert.equal(abilitiesOf(["jaws"], 0).jump, 0, "no legs, no jump");
});

/** A minimal Storage. */
function fakeStore() {
  const m = new Map();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

test("save slots park and restore a whole game without touching settings", () => {
  const s = fakeStore();
  s.setItem("johnny-spore-cell-stage", JSON.stringify({ tier: 3, cellName: "Zib" }));
  s.setItem("johnny-spore-history", "[1]");
  s.setItem("johnny-spore-quality", "low");
  s.setItem("johnny-spore-settings", "{}");
  s.setItem("unrelated", "x");
  markSaved(s, 1000);
  assert.equal(activeSlot(s), 1);
  assert.deepEqual(gameKeys(s).sort(), ["johnny-spore-cell-stage", "johnny-spore-history", "johnny-spore-saved-at"]);
  assert.deepEqual(slotSummary(s, 1), { slot: 1, active: true, empty: false, savedAt: 1000, label: "Cell Stage · Tier 3 · Zib" });
  assert.equal(slotSummary(s, 2).empty, true);

  assert.equal(switchSlot(s, 2), true);
  assert.equal(activeSlot(s), 2);
  assert.deepEqual(gameKeys(s), [], "slot 2 starts empty");
  assert.equal(s.getItem("johnny-spore-quality"), "low");
  assert.equal(s.getItem("unrelated"), "x");
  assert.equal(slotSummary(s, 1).label, "Cell Stage · Tier 3 · Zib");
  assert.equal(slotSummary(s, 1).active, false);

  s.setItem("johnny-spore-creature-stage", JSON.stringify({ brain: 2, record: { name: "Mo" } }));
  assert.equal(slotSummary(s, 2).label, "Creature Stage · Brain 2 · Mo");
  assert.equal(switchSlot(s, 2), false, "already there");

  switchSlot(s, 1);
  assert.equal(JSON.parse(s.getItem("johnny-spore-cell-stage")).tier, 3);
  assert.equal(s.getItem("johnny-spore-history"), "[1]");
  assert.equal(s.getItem("johnny-spore-creature-stage"), null);
  assert.equal(slotSummary(s, 2).label, "Creature Stage · Brain 2 · Mo");

  clearSlot(s, 2);
  assert.equal(slotSummary(s, 2).empty, true);
  clearSlot(s, 1);
  assert.deepEqual(gameKeys(s), []);
  assert.equal(s.getItem("johnny-spore-settings"), "{}");
  assert.equal(SLOT_COUNT, 3);
  assert.equal(activeSlot({ getItem: () => "99" }), 3, "out-of-range slots are clamped");
});

test("settings load with safe defaults and survive bad data", () => {
  const s = fakeStore();
  assert.deepEqual(loadSettings(s), { sfx: 0.85, ambience: 0.7, music: 0.55, reducedMotion: false });
  s.setItem("johnny-spore-settings", "{not json");
  assert.equal(loadSettings(s).sfx, 0.85);
  saveSettings(s, { sfx: 0.2, ambience: 0, music: 0.3, reducedMotion: true });
  assert.deepEqual(loadSettings(s), { sfx: 0.2, ambience: 0, music: 0.3, reducedMotion: true });
  s.setItem("johnny-spore-settings", JSON.stringify({ sfx: 7, ambience: "loud" }));
  assert.deepEqual(loadSettings(s), { sfx: 1, ambience: 0.7, music: 0.55, reducedMotion: false });
});

test("timeAgo reads naturally", () => {
  const now = 1e9;
  assert.equal(timeAgo(now - 5e3, now), "just now");
  assert.equal(timeAgo(now - 5 * 60e3, now), "5 min ago");
  assert.equal(timeAgo(now - 3 * 3600e3, now), "3 h ago");
  assert.equal(timeAgo(now - 86400e3, now), "1 day ago");
  assert.equal(timeAgo(now - 3 * 86400e3, now), "3 days ago");
  assert.equal(timeAgo(0, now), "");
});
