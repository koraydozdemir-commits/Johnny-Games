import { test } from "node:test";
import assert from "node:assert/strict";
import { CREATION_FORMAT, readCreation, validateModular, wrapCreation } from "../creations/format.js";
import { starterCellRecord } from "../cell-format.js";
import { creatureFromCell } from "../creature/format.js";
import { openStore } from "../universe/store.js";
import { asPedia, listGlobal, putGlobal, removeUniverseCreations, toGlobal } from "../universe/global.js";
import { deleteUniverse } from "../universe/manager.js";
import { newUniverse, parseSeed, readSeedFile, seedFile, shareCode } from "../universe/model.js";
import { makeGalaxy } from "../galaxy/gen.js";

test("every kind of creation round-trips through the shared format", () => {
  const cell = starterCellRecord();
  const creature = creatureFromCell(cell, "Walker");
  const ship = { name: "Comet", colors: { base: 0xffffff, accent: 0xff0000, trim: 0 }, parts: [{ id: "shipHull", x: 0, y: 0, z: 0 }] };
  for (const [kind, data] of [["cell", cell], ["creature", creature], ["ship", ship], ["building", { ...ship, parts: [{ id: "wall", x: 1, y: 2, z: 3, s: 9 }] }]]) {
    if (!data) continue;
    const r = readCreation(JSON.stringify(wrapCreation(kind, data, { name: "Mine" })));
    assert.equal(r.ok, true, kind + ": " + r.error);
    assert.equal(r.kind, kind);
    assert.equal(r.name, "Mine");
  }
  assert.equal(validateModular({ parts: [{ id: "wall", s: 99 }] }, "building").parts[0].s, 4, "numbers are clamped");
  assert.throws(() => validateModular({ parts: [{ id: "wheel" }] }, "building"), /Unknown part/, "parts belong to their kind");
  assert.equal(validateModular({ role: "evil", parts: [{ id: "body" }] }, "vehicle").role, "military", "unknown roles fall back");
  assert.throws(() => validateModular({ parts: [] }, "vehicle"), /at least one part/);
  assert.throws(() => validateModular({ parts: [{ id: "<script>" }] }, "vehicle"), /Bad part/);
  for (const [bad, why] of [["", /empty/], ["{", /valid JSON/], [JSON.stringify({ format: "x" }), /isn't a Johnny/], [JSON.stringify({ format: CREATION_FORMAT, version: 9, kind: "cell" }), /newer/], [JSON.stringify({ format: CREATION_FORMAT, version: 2, kind: "spaceport", data: {} }), /can't be imported/], [JSON.stringify({ format: CREATION_FORMAT, version: 2, kind: "cell", data: { nope: 1 } }), /damaged/]])
    assert.match(readCreation(bad).error, why);
  // Version 1 (Sporepedia entry exports) still import.
  const v1 = readCreation(JSON.stringify({ format: CREATION_FORMAT, version: 1, entry: { kind: "cell", record: cell } }));
  assert.equal(v1.ok, true);
});

test("galaxy seed sharing: a code or a file gives the same galaxy", () => {
  const meta = newUniverse({ name: "Mine", seed: 987654 });
  const code = shareCode(meta.seed);
  assert.match(code, /^SPORE-[0-9A-Z]+$/);
  assert.equal(parseSeed(code), 987654);
  assert.equal(parseSeed(code.toLowerCase()), 987654);
  assert.equal(parseSeed("not a seed"), null);
  assert.equal(parseSeed("99999999999"), null);
  const f = readSeedFile(JSON.stringify(seedFile(meta)));
  assert.equal(f.seed, 987654);
  assert.match(f.name, /shared/);
  assert.equal(readSeedFile("{}"), null);
  assert.deepEqual(makeGalaxy(parseSeed(code)).stars.slice(0, 20), makeGalaxy(987654).stars.slice(0, 20), "same seed, same stars");
});

test("the Global Sporepedia keeps creations across universes, unless asked to remove them", async () => {
  const store = await openStore(null);
  const a = newUniverse({ name: "A" }),
    b = newUniverse({ name: "B" });
  const cell = starterCellRecord();
  assert.equal(toGlobal(a, { id: "x", kind: "planet", owned: true, record: {} }), null, "only creations go global");
  assert.equal(toGlobal(a, { id: "x", kind: "cell", owned: false, record: cell }), null, "only your own");
  await putGlobal(store, a, { id: "gen:1", kind: "cell", owned: true, name: "Blob", record: cell });
  await putGlobal(store, b, { id: "gen:1", kind: "cell", owned: true, name: "Blob B", record: cell });
  let all = await listGlobal(store);
  assert.equal(all.length, 2, "same entry id in two universes: two creations");
  // Global renames and favourites survive the creation being updated in its universe.
  const g = all.find((x) => x.universeId === a.id);
  g.fav = true;
  g.customName = "Best";
  await store.put("global", g.gid, g);
  await putGlobal(store, a, { id: "gen:1", kind: "cell", owned: true, name: "Blob v2", record: cell });
  const again = (await listGlobal(store)).find((x) => x.universeId === a.id);
  assert.deepEqual([again.name, again.fav, again.customName], ["Blob v2", true, "Best"]);
  assert.equal(Object.keys(asPedia(all).entries).length, 2);
  // Deleting a universe keeps its creations by default.
  await store.put("meta", b.id, b);
  await deleteUniverse(store, a, b.id);
  assert.equal((await listGlobal(store)).length, 2);
  await store.put("meta", b.id, b);
  await deleteUniverse(store, a, b.id, { removeCreations: true });
  assert.deepEqual((await listGlobal(store)).map((x) => x.universeId), [a.id]);
  assert.equal(await removeUniverseCreations(store, "nope"), 0);
});
