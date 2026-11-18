import { test } from "node:test";
import assert from "node:assert/strict";
import { TRIBE_LEGACY, addEvent, creatureCardFor, emptyChronicle, eventsFromSaves, readChronicle, trackSummary, tribeLegacy } from "../lineage.js";
import { CREATURE_CARDS, DIET_CARDS } from "../traits.js";

test("every earlier card hands the tribe something", () => {
  for (const id of Object.keys(DIET_CARDS)) assert.ok(TRIBE_LEGACY.cell[id]?.text, id);
  for (const id of Object.keys(CREATURE_CARDS)) assert.ok(TRIBE_LEGACY.creature[id]?.text, id);
  const none = tribeLegacy(null, null);
  assert.deepEqual([none.damage, none.gift, none.music, none.carry, none.startTool, none.relation, none.hutLevel, none.lines.length], [1, 1, 1, 0, null, 0, 1, 0]);
  const a = tribeLegacy("carnivore", "predator");
  assert.equal(a.damage, 1.15);
  assert.equal(a.startTool, "axe");
  assert.equal(a.lines.length, 2);
  const b = tribeLegacy("herbivore", "charmer");
  assert.equal(b.gift, 1.25);
  assert.equal(b.relation, 15);
  assert.equal(b.music, 1.1);
  assert.equal(tribeLegacy("omnivore", "adaptable").carry, 1);
  assert.equal(tribeLegacy("omnivore", "adaptable").hutLevel, 2);
  assert.equal(tribeLegacy("nonsense", "junk").lines.length, 0);
});

test("the creature card is the one earned, or where the record points", () => {
  assert.equal(creatureCardFor(null), null);
  assert.equal(creatureCardFor({ card: "charmer", alliances: 0, extinctions: 9 }), "charmer");
  assert.equal(creatureCardFor({ alliances: 0, extinctions: 4 }), "predator");
  assert.equal(creatureCardFor({ alliances: 4, extinctions: 0 }), "charmer");
  assert.equal(creatureCardFor({}), "adaptable");
});

test("the chronicle records each moment once, and survives bad data", () => {
  const ch = emptyChronicle();
  assert.equal(addEvent(ch, { key: "tribe:start", stage: "tribe", text: "Founded a tribe." }, 5), true);
  assert.equal(addEvent(ch, { key: "tribe:start", stage: "tribe", text: "again" }, 6), false);
  assert.equal(ch.events.length, 1);
  for (let i = 0; i < 120; i++) addEvent(ch, { key: "e" + i, stage: "creature", text: "event " + i }, i);
  assert.equal(ch.events.length, 80);
  assert.equal(ch.events[0].key, "tribe:start", "founding moments are kept");
  assert.equal(ch.events.at(-1).key, "e119");
  assert.deepEqual(readChronicle("{bad"), emptyChronicle());
  assert.deepEqual(readChronicle({ events: "no" }), emptyChronicle());
  const r = readChronicle({ events: [{ key: "a", stage: "tribe", text: "ok", at: 1 }, { key: "b", stage: "space", text: "nope" }, { stage: "cell", text: "no key" }] });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].icon, "•");
});

test("older saves get their story back", () => {
  const ev = eventsFromSaves({
    cell: { cellStageComplete: true, dietCard: "herbivore" },
    creature: { brain: 3, unlockedRegions: ["coast", "forest", "swamp"], card: null },
    tribe: { path: "peace" },
    regionName: (id) => ({ forest: "Whispering Forest", swamp: "Mire" })[id],
  });
  const keys = ev.map((e) => e.key);
  assert.deepEqual(keys, ["cell:complete", "creature:start", "region:forest", "region:swamp", "brain:3", "tribe:start", "tribe:won"]);
  assert.match(ev[2].text, /Whispering Forest/);
  assert.deepEqual(eventsFromSaves({}), []);
  assert.deepEqual(eventsFromSaves({ cell: { cellStageComplete: false, dietCard: "herbivore" } }), []);
});

test("the track sums up each stage", () => {
  const t = trackSummary({
    cellCard: "carnivore",
    cellDone: true,
    creature: { brain: 5, card: "predator", alliances: 1, extinctions: 4 },
    tribe: { tribes: [{ status: "allied" }, { status: "conquered" }, { status: "neutral" }], path: null, units: [{}, {}], hutLevel: 2 },
  });
  assert.equal(t.cell.card, "carnivore");
  assert.equal(t.creature.card, "predator");
  assert.deepEqual([t.tribe.allied, t.tribe.conquered, t.tribe.total, t.tribe.members, t.tribe.trait], [1, 1, 3, 2, null]);
  assert.equal(trackSummary({ cellCard: "omnivore" }).cell.card, null, "not decided until the stage ends");
});
