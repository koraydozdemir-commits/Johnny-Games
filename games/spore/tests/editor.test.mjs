import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../editor/history.js";
import { CREATURE_PRESETS, fromHsv, luminance, parseHex, recentList, toHex, toHsv } from "../editor/color.js";
import { browse, matches } from "../editor/catalogue.js";
import { createDrafts, fingerprint } from "../editor/drafts.js";
import { attachGestures } from "../editor/gestures.js";

/** A fake localStorage. */
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("history: one step per change, one step per drag, nothing for a drag that changed nothing", () => {
  let doc = { x: 0 };
  const h = createHistory({ take: () => JSON.parse(JSON.stringify(doc)), put: (s) => (doc = s) });
  h.record("move");
  doc.x = 1;
  assert.equal(h.size, 1);
  // A drag of a hundred frames is one undo.
  h.begin("drag");
  for (let i = 0; i < 100; i++) doc.x = 1 + i * 0.1;
  assert.equal(h.end(), true);
  assert.equal(h.size, 2);
  // A drag that went nowhere leaves nothing behind.
  h.begin("drag");
  assert.equal(h.end(), false);
  assert.equal(h.size, 2);
  assert.equal(h.undo(), "drag");
  assert.equal(doc.x, 1);
  assert.equal(h.undo(), "move");
  assert.equal(doc.x, 0);
  assert.equal(h.undo(), null, "nothing left to undo");
  assert.equal(h.redo(), "move");
  assert.equal(doc.x, 1);
  // A new change after undoing throws away the redo branch.
  h.record("other");
  doc.x = 5;
  assert.equal(h.canRedo, false);
  // Cancelling a transaction puts the creation back.
  h.begin("drag");
  doc.x = 99;
  h.cancel();
  assert.equal(doc.x, 5);
});

test("history: keeps a sensible limit and Undo during a drag finishes the drag first", () => {
  let doc = { n: 0 };
  const h = createHistory({ take: () => ({ ...doc }), put: (s) => (doc = s), limit: 5 });
  for (let i = 1; i <= 9; i++) {
    h.record();
    doc.n = i;
  }
  assert.equal(h.size, 5);
  h.begin("drag");
  doc.n = 50;
  h.undo(); // ends the drag (a step) and undoes it
  assert.equal(doc.n, 9);
});

test("colour: hex and HSV round-trip, bad input is rejected", () => {
  for (const c of [0x000000, 0xffffff, 0x3be0d8, 0xe0504a, 0x123456, 0xff00ff]) assert.equal(fromHsv(toHsv(c)), c, toHex(c));
  assert.equal(parseHex("#abc"), 0xaabbcc);
  assert.equal(parseHex("3BE0D8"), 0x3be0d8);
  assert.equal(parseHex("nope"), null);
  assert.equal(parseHex("#12345"), null);
  assert.equal(toHex(0x0a0b0c), "#0a0b0c");
  assert.ok(luminance(0xffffff) > 0.99 && luminance(0) === 0);
  for (const p of CREATURE_PRESETS) for (const k of ["base", "belly", "pattern", "accent"]) assert.ok(Number.isInteger(p.colors[k]) && p.colors[k] <= 0xffffff, p.name + " " + k);
});

test("recent lists: most recent first, no duplicates, capped, survive a reload", () => {
  const s = memStorage();
  const r = recentList(s, "k", 3);
  r.add(1);
  r.add(2);
  r.add(1);
  r.add(3);
  r.add(4);
  assert.deepEqual(r.items, [4, 3, 1]);
  assert.deepEqual(recentList(s, "k", 3).items, [4, 3, 1]);
  s.setItem("bad", "{not json");
  assert.deepEqual(recentList(s, "bad").items, [], "a damaged list starts empty");
});

test("catalogue: search, filters and sorting", () => {
  const parts = [
    { id: "a", name: "Grazing Beak", section: "mouth", cost: 5, unlocked: true, abilities: { bite: 1 }, diet: "plant", order: 0 },
    { id: "b", name: "Crusher Jaws", section: "mouth", cost: 12, unlocked: false, abilities: { bite: 4 }, diet: "meat", order: 1 },
    { id: "c", name: "Bright Eyes", section: "senses", cost: 3, unlocked: true, abilities: { sight: 2 }, order: 2 },
    { id: "d", name: "Secret Horn", section: "offence", cost: 9, unlocked: false, seen: false, abilities: { charge: 3 }, order: 3 },
  ];
  assert.deepEqual(browse(parts, { query: "beak" }).map((p) => p.id), ["a"]);
  assert.deepEqual(browse(parts, { query: "bite" }).map((p) => p.id), ["a", "b"], "abilities match");
  assert.deepEqual(browse(parts, { query: "mouth jaws" }).map((p) => p.id), ["b"], "every word must match");
  assert.equal(matches(parts[3], "horn"), false, "an unseen part's name stays secret");
  assert.deepEqual(browse(parts, { filter: "locked" }).map((p) => p.id), ["b", "d"]);
  assert.deepEqual(browse(parts, { filter: "recent", recent: ["c", "a"] }).map((p) => p.id), ["c", "a"]);
  assert.deepEqual(browse(parts, { sort: "cost" }).map((p) => p.id), ["c", "a", "d", "b"]);
  assert.deepEqual(browse(parts, { sort: "ability", sortKey: "bite" }).map((p) => p.id), ["b", "a", "c", "d"]);
  assert.deepEqual(browse(parts, { ability: "bite" }).map((p) => p.id), ["a", "b"], "ability filter");
  assert.deepEqual(browse(parts, { diet: "meat" }).map((p) => p.id), ["b"]);
  assert.deepEqual(browse(parts, { sort: "name" }).map((p) => p.id), ["c", "b", "a", "d"], "unseen names sort last");
});

test("drafts: written after a pause, offered back only for the same creation, cleared on save", () => {
  const s = memStorage();
  const timers = [];
  let clock = 1000;
  const base = { name: "Walker", n: 1 };
  const mk = (b = base) => createDrafts({ kind: "creature", base: b, storage: s, now: () => clock, setTimer: (f) => (timers.push(f), timers.length), clearTimer: (t) => (timers[t - 1] = null) });
  const d = mk();
  d.touch({ name: "Walker", n: 2 });
  d.touch({ name: "Walker", n: 3 });
  assert.equal(s.m.size, 0, "nothing is written straight away");
  timers.filter(Boolean).forEach((f) => f());
  assert.equal(s.m.size, 1);
  // The page reloads: the same creation offers its draft back; another creation doesn't.
  assert.deepEqual(mk().recoverable().data, { name: "Walker", n: 3 });
  assert.equal(mk({ name: "Other", n: 1 }).recoverable(), null);
  // Back to how it was opened: nothing to recover.
  d.touch(base);
  d.flush();
  assert.equal(mk().recoverable(), null);
  d.touch({ name: "Walker", n: 4 });
  d.flush();
  clock += 8 * 864e5;
  assert.equal(mk().recoverable(), null, "week-old drafts are not offered");
  d.clear();
  assert.equal(s.m.size, 0);
  assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  // Storage that throws (full, private mode) never breaks editing.
  const broken = createDrafts({ kind: "x", base, storage: { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} }, setTimer: (f) => f() });
  broken.touch({ n: 9 });
});

/** A fake element that records listeners, for the gesture recogniser. */
function fakeEl() {
  const L = {};
  return {
    addEventListener: (t, f) => ((L[t] ||= []).push(f)),
    removeEventListener: (t, f) => (L[t] = (L[t] || []).filter((x) => x !== f)),
    fire(type, o) {
      const e = { type, button: 0, pointerType: "touch", cancelable: true, preventDefault() {}, ...o };
      (L[type] || []).forEach((f) => f(e));
    },
    count: () => Object.values(L).reduce((s, a) => s + a.length, 0),
  };
}

test("gestures: a drag that starts on a part moves the part, on empty space turns the camera", () => {
  const el = fakeEl();
  const log = [];
  const g = attachGestures(el, {
    hit: (x) => (x < 100 ? { part: 1 } : null),
    tap: (x, y, t) => log.push(["tap", t]),
    dragStart: (t) => log.push(["dragStart", t.part]),
    drag: () => log.push(["drag"]),
    dragEnd: (t, c) => log.push(["dragEnd", c]),
    orbit: (dx) => log.push(["orbit", dx]),
    zoom: (f) => log.push(["zoom", +f.toFixed(2)]),
    pan: () => log.push(["pan"]),
  }, { setTimer: () => 0, clearTimer: () => {}, now: () => 0 });
  el.fire("pointerdown", { pointerId: 1, clientX: 50, clientY: 50 });
  el.fire("pointermove", { pointerId: 1, clientX: 52, clientY: 50 }); // inside the slop: nothing yet
  el.fire("pointermove", { pointerId: 1, clientX: 70, clientY: 50 });
  el.fire("pointerup", { pointerId: 1, clientX: 70, clientY: 50 });
  assert.deepEqual(log.map((l) => l[0]), ["dragStart", "drag", "dragEnd"]);
  log.length = 0;
  el.fire("pointerdown", { pointerId: 2, clientX: 300, clientY: 50 });
  el.fire("pointermove", { pointerId: 2, clientX: 320, clientY: 50 });
  el.fire("pointerup", { pointerId: 2, clientX: 320, clientY: 50 });
  assert.deepEqual(log, [["orbit", 20]], "empty space orbits");
  log.length = 0;
  // A second finger during a part drag ends the drag; then the pair pinches.
  el.fire("pointerdown", { pointerId: 3, clientX: 50, clientY: 50 });
  el.fire("pointermove", { pointerId: 3, clientX: 70, clientY: 50 });
  el.fire("pointerdown", { pointerId: 4, clientX: 170, clientY: 50 });
  el.fire("pointermove", { pointerId: 4, clientX: 270, clientY: 50 });
  assert.deepEqual(log.slice(0, 3).map((l) => l[0]), ["dragStart", "drag", "dragEnd"]);
  assert.ok(log.some((l) => l[0] === "zoom" && l[1] > 1.9), "spreading two fingers zooms in");
  assert.ok(!log.slice(3).some((l) => l[0] === "drag"), "no part moves during the pinch");
  el.fire("pointerup", { pointerId: 4 });
  log.length = 0;
  el.fire("pointermove", { pointerId: 3, clientX: 80, clientY: 50 }); // the finger left behind
  el.fire("pointerup", { pointerId: 3 });
  assert.ok(!log.some((l) => l[0] === "tap" || l[0] === "drag"), "the leftover finger is not a tap or a drag");
  // A cancelled pointer (browser gesture) ends a drag as cancelled.
  log.length = 0;
  el.fire("pointerdown", { pointerId: 5, clientX: 50, clientY: 50 });
  el.fire("pointermove", { pointerId: 5, clientX: 80, clientY: 50 });
  el.fire("pointercancel", { pointerId: 5 });
  assert.deepEqual(log.at(-1), ["dragEnd", true]);
  g.detach();
  assert.equal(el.count(), 0, "every listener is removed");
});

test("gestures: tap, double tap and long press", () => {
  const el = fakeEl();
  const log = [];
  let t = 0;
  let pending = null;
  attachGestures(el, { hit: () => ({ part: 2 }), tap: () => log.push("tap"), doubleTap: () => log.push("double"), longPress: () => log.push("long"), dragStart: () => log.push("drag") }, { now: () => t, setTimer: (f) => ((pending = f), 1), clearTimer: () => (pending = null) });
  el.fire("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
  el.fire("pointerup", { pointerId: 1, clientX: 10, clientY: 10 });
  t = 200;
  el.fire("pointerdown", { pointerId: 2, clientX: 12, clientY: 10 });
  el.fire("pointerup", { pointerId: 2, clientX: 12, clientY: 10 });
  assert.deepEqual(log, ["tap", "double"]);
  log.length = 0;
  t = 2000;
  el.fire("pointerdown", { pointerId: 3, clientX: 10, clientY: 10 });
  pending?.(); // held still for the long-press time
  el.fire("pointermove", { pointerId: 3, clientX: 40, clientY: 10 });
  el.fire("pointerup", { pointerId: 3, clientX: 40, clientY: 10 });
  assert.deepEqual(log, ["long"], "a long press is not also a tap or a drag");
});

import { LIMITS, validateCreature } from "../creature/format.js";
import { shapeSpine } from "../creature/editor.js";
import { validateModular } from "../creations/format.js";
import { designStats } from "../creations/modular.js";
import { duplicateEntry, emptyPedia, isLooseCreation, removeEntry, upsert } from "../pedia/model.js";

test("symmetry: one-sided parts survive saving, old saves gain nothing, abilities don't change", () => {
  const base = { spine: [{ x: -1, y: 0, r: 0.4 }, { x: 0, y: 0, r: 0.5 }, { x: 1, y: 0, r: 0.4 }], legs: [{ t: 0.5, length: 1 }], parts: [{ id: "beak", t: 1, angle: 0 }] };
  const old = validateCreature({ ...base, parts: [...base.parts, { id: "eyes", t: 0.9, angle: 0.6 }] });
  assert.equal("solo" in old.parts[1], false, "an old save has no solo flag added");
  const one = validateCreature({ ...base, parts: [...base.parts, { id: "eyes", t: 0.9, angle: 0.6, solo: true }] });
  assert.equal(one.parts[1].solo, true);
  assert.equal(validateCreature({ ...base, parts: [{ id: "eyes", t: 0.9, angle: 0.6, solo: "yes" }] }).parts[0].solo, undefined, "only a real true counts");
  assert.deepEqual(validateCreature(JSON.parse(JSON.stringify(one))), one, "round-trips");
});

test("quick shape keeps the spine inside the editor's limits", () => {
  let s = [{ x: -1.5, y: 0, r: 0.4 }, { x: -0.5, y: 0.1, r: 0.6 }, { x: 0.5, y: 0.1, r: 0.6 }, { x: 1.5, y: 0.2, r: 0.4 }];
  for (let i = 0; i < 12; i++) s = shapeSpine(s, "length", 1);
  assert.ok(s[0].x >= -3 && s.at(-1).x <= 3, "never longer than the limit");
  for (let i = 0; i < 20; i++) s = shapeSpine(s, "length", -1);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].x - s[i - 1].x >= 0.3 - 1e-9, "vertebrae keep their spacing");
  for (const kind of ["bulk", "head", "tail"]) for (const dir of [1, -1]) for (let i = 0; i < 20; i++) s = shapeSpine(s, kind, dir);
  assert.ok(s.every((n) => n.r >= LIMITS.minR && n.r <= LIMITS.maxR));
  const arched = shapeSpine(s, "arch", 1);
  assert.ok(arched[1].y > s[1].y && arched[0].y === s[0].y, "the middle rises, the ends stay");
  assert.equal(validateCreature({ spine: arched, legs: [], parts: [] }).spine.length, s.length);
});

test("painting one part of a building or vehicle is kept and never changes its stats", () => {
  const d = validateModular({ name: "Car", role: "military", parts: [{ id: "body", x: 0, y: 0.6, z: 0 }, { id: "wheel", x: 0.8, y: 0.4, z: 1, mirror: true, paint: "accent" }] }, "vehicle");
  assert.equal(d.parts[1].paint, "accent");
  assert.equal("paint" in d.parts[0], false);
  assert.equal(validateModular({ ...d, parts: [{ ...d.parts[0], paint: "gold" }] }, "vehicle").parts[0].paint, undefined, "unknown paints are dropped");
  const plain = validateModular({ ...d, parts: d.parts.map(({ paint, ...p }) => p) }, "vehicle");
  assert.deepEqual(designStats(d), designStats(plain));
});

test("library: duplicate and delete your own creations, never the game's", () => {
  const p = emptyPedia(1);
  upsert(p, { id: "gen:1", kind: "creature", name: "Zorb", owned: true, record: { name: "Zorb" } });
  upsert(p, { id: "planet:1:2", kind: "planet", name: "Verdana" });
  const c = duplicateEntry(p, "gen:1", 1000);
  assert.ok(c && c.id !== "gen:1" && c.name === "Copy of Zorb" && c.record.name === "Zorb" && c.copiedFrom === "gen:1");
  c.record.name = "Changed";
  assert.equal(p.entries["gen:1"].record.name, "Zorb", "the original is untouched by changes to the copy");
  assert.equal(duplicateEntry(p, "planet:1:2"), null, "only creations can be copied");
  assert.equal(isLooseCreation(c), true);
  assert.equal(removeEntry(p, "gen:1"), false, "the game's own entries stay");
  assert.equal(removeEntry(p, c.id), true);
  assert.equal(p.entries[c.id], undefined);
  assert.ok(!p.recent.includes(c.id));
  assert.equal(removeEntry(p, "planet:1:2", true), true, "the global collection can drop anything");
});
