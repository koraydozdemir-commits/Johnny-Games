import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_FORMAT, cleanUniverseName, exportUniverse, formatPlaytime, isGameKey, newUniverse, readMeta, summarize, uniqueName, validateImport } from "../universe/model.js";
import { compareRows, counts, discover, emptyPedia, exportEntry, markViewed, milestone, planetStatus, query, readPedia, rename, setPlanetStatus, toggleFav, upsert } from "../pedia/model.js";

test("universes: names, metadata and which keys belong to a universe", () => {
  assert.equal(uniqueName("Alpha", ["alpha", "Alpha (2)"]), "Alpha (3)");
  assert.equal(uniqueName("Beta", []), "Beta");
  assert.equal(cleanUniverseName("  <b>Hi</b>  "), "bHi/b");
  const u = newUniverse({ name: "Home", seed: 99, now: 5 });
  assert.match(u.id, /^u[a-z0-9]+$/);
  assert.deepEqual(readMeta(u), u);
  assert.equal(readMeta({ id: "bad id" }), null);
  assert.equal(readMeta({ ...u, thumb: "javascript:x" }).thumb, null);
  assert.ok(isGameKey("johnny-spore-cell-stage"));
  assert.ok(!isGameKey("johnny-spore-settings") && !isGameKey("johnny-spore-universe") && !isGameKey("johnny-spore-slot2::johnny-spore-x") && !isGameKey("other"));
  assert.equal(formatPlaytime(30), "Under a minute");
  assert.equal(formatPlaytime(3720), "1 h 2 min");
});

test("a universe's card says where it stands", () => {
  assert.equal(summarize({}).stage, "New");
  const civ = summarize({ "johnny-spore-civ-stage": JSON.stringify({ cities: [{ owner: "you" }, { owner: "n0" }] }), "johnny-spore-tribe-stage": JSON.stringify({ tribes: [], look: { name: "Zibs" } }) });
  assert.deepEqual([civ.stage, civ.species, civ.detail], ["Civilization", "Zibs", "1 / 2 cities"]);
  const cell = summarize({ "johnny-spore-cell-stage": JSON.stringify({ tier: 3, cellName: "Zib" }) });
  assert.deepEqual([cell.stage, cell.species], ["Cell", "Zib"]);
  const cr = summarize({ "johnny-spore-creature-stage": JSON.stringify({ brain: 3, record: { name: "Mog" } }) });
  assert.deepEqual([cr.stage, cr.species, cr.detail], ["Creature", "Mog", "Brain level 3 / 5"]);
  const tr = summarize({ "johnny-spore-tribe-stage": JSON.stringify({ tribes: [{ status: "allied" }, { status: "neutral" }], look: { name: "Moon" } }) });
  assert.deepEqual([tr.stage, tr.species, tr.detail], ["Tribal", "Moon", "1 / 2 tribes settled"]);
  assert.ok(tr.progress > cr.progress && cr.progress > cell.progress);
  assert.equal(summarize({ "johnny-spore-creature-stage": "{broken" }).stage, "New", "damaged saves don't crash the card");
});

test("export and import: round trip, and bad files refused with a reason", () => {
  const meta = newUniverse({ name: "Trip", seed: 77 });
  const keys = { "johnny-spore-cell-stage": JSON.stringify({ tier: 2 }), "johnny-spore-settings": "{}", "johnny-spore-chronicle": "{}" };
  const file = JSON.stringify(exportUniverse(meta, keys, { v: 1, entries: {} }));
  const r = validateImport(file);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.keys).sort(), ["johnny-spore-chronicle", "johnny-spore-cell-stage"].sort(), "settings are never carried");
  assert.equal(r.universe.seed, 77);
  for (const [bad, why] of [
    ["", /empty/],
    ["not json", /valid JSON/],
    [JSON.stringify({ format: "other" }), /isn't a Johnny/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 99, keys: {} }), /newer version/],
    [JSON.stringify({ format: EXPORT_FORMAT }), /version/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1 }), /missing/],
    [JSON.stringify({ format: EXPORT_FORMAT, version: 1, keys: { "johnny-spore-tribe-stage": "{oops" } }), /damaged/],
  ])
    assert.match(validateImport(bad).error, why);
  const sneaky = validateImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, keys: { "johnny-spore-universe": "x", "evil": "y", "johnny-spore-ok": 5 } }));
  assert.deepEqual(sneaky.keys, {}, "foreign, shared and non-string keys are dropped");
});

test("the Sporepedia: discoveries are logged once, and only meaningful ones", () => {
  const p = emptyPedia(1);
  assert.match(discover(p, { id: "star:1", kind: "star", name: "Vega" }).text, /Vega/);
  assert.equal(discover(p, { id: "star:1", kind: "star", name: "Vega" }), null, "no repeats");
  assert.equal(discover(p, { id: "plant:1", kind: "plant", name: "Moss", rarity: "Common" }), null, "ordinary plants are quiet");
  assert.ok(p.entries["plant:1"], "but still catalogued");
  assert.match(discover(p, { id: "plant:2", kind: "plant", name: "Glowcap", rarity: "Rare" }).text, /unique plant/);
  assert.match(discover(p, { id: "sp:1", kind: "species", name: "Gnarl", rarity: "Common" }, { danger: 5 }).text, /dangerous/);
  assert.match(discover(p, { id: "sp:2", kind: "species", name: "Glim", rarity: "Rare" }).text, /rare/);
  assert.ok(milestone(p, "extremeHot", "First visit to a scorching world.", "🔥"));
  assert.equal(milestone(p, "extremeHot", "again", "🔥"), null);
  assert.equal(p.log.length, 5);
  assert.equal(counts(p).discovery, 5);
});

test("planets, favourites, renaming, recents, search, sort, compare", () => {
  const p = emptyPedia(1);
  upsert(p, { id: "planet:1:0", kind: "planet", name: "Ora", status: "discovered", temp: 20, danger: 1 }, 1);
  upsert(p, { id: "planet:1:1", kind: "planet", name: "Brimstone", status: "discovered", temp: 400, danger: 4, rarity: "Rare" }, 2);
  assert.equal(setPlanetStatus(p, "1:0", "explored"), true);
  assert.equal(setPlanetStatus(p, "1:0", "discovered"), false, "status only moves forward");
  assert.equal(planetStatus(p, "1:0"), "explored");
  assert.equal(planetStatus(p, "9:9"), "undiscovered");
  assert.equal(toggleFav(p, "planet:1:1"), true);
  assert.equal(rename(p, "planet:1:0", "  New <Home> "), "New Home");
  markViewed(p, "planet:1:1");
  markViewed(p, "planet:1:0");
  assert.deepEqual(p.recent, ["planet:1:0", "planet:1:1"]);
  assert.deepEqual(query(p, { cat: "planet", text: "home" }).map((e) => e.id), ["planet:1:0"], "search finds the new name");
  assert.deepEqual(query(p, { cat: "planet", sort: "danger" }).map((e) => e.name), ["Brimstone", "Ora"]);
  assert.deepEqual(query(p, { cat: "favourites" }).map((e) => e.name), ["Brimstone"]);
  assert.deepEqual(query(p, { cat: "planet", rarity: "Rare" }).length, 1);
  assert.deepEqual(query(p, { cat: "recent" }).map((e) => e.id), ["planet:1:0", "planet:1:1"]);
  const rows = compareRows(p.entries["planet:1:0"], p.entries["planet:1:1"]);
  assert.deepEqual(rows.find((r) => r[0] === "Temperature"), ["Temperature", "20", "400"]);
  assert.deepEqual(compareRows(p.entries["planet:1:0"], { kind: "star" }), []);
  const back = readPedia(JSON.stringify(p));
  assert.equal(back.entries["planet:1:0"].customName, "New Home");
  assert.deepEqual(readPedia("{bad").entries, {});
  assert.deepEqual(Object.keys(readPedia({ entries: { a: { id: "b", kind: "star", name: "x" }, c: { id: "c", kind: "weird", name: "x" } } }).entries), [], "mismatched and unknown entries dropped");
  assert.equal(exportEntry(p.entries["planet:1:1"]).entry.fav, undefined);
});
