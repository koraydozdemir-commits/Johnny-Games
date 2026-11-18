import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../universe/store.js";
import { activate, bootUniverses, createUniverse, currentKeys, deleteUniverse, duplicateUniverse, exportText, importText, renameUniverse } from "../universe/manager.js";
import { ACTIVE_UNIVERSE_KEY } from "../universe/model.js";

class LS {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init));
    this.failOnce = false;
  }
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("QuotaExceededError");
    }
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
const cell = (name) => JSON.stringify({ tier: 2, cellName: name });

test("first start: the game in play and old save slots become universes", async () => {
  const store = await openStore(null);
  const ls = new LS({ "johnny-spore-cell-stage": cell("Ana"), "johnny-spore-settings": "{}", "johnny-spore-slot": "1", "johnny-spore-slot2::johnny-spore-cell-stage": cell("Bo") });
  const { meta, metas } = await bootUniverses(store, ls);
  assert.equal(metas.length, 2);
  assert.equal(ls.getItem(ACTIVE_UNIVERSE_KEY), meta.id);
  assert.equal(ls.getItem("johnny-spore-cell-stage"), cell("Ana"), "the game in play is untouched");
  assert.equal(ls.getItem("johnny-spore-slot2::johnny-spore-cell-stage"), null, "the slot moved into its universe");
  const slot = metas.find((m) => m.name === "Save slot 2");
  assert.equal((await store.get("parked", slot.id))["johnny-spore-cell-stage"], cell("Bo"));
  // A second start finds the same universe.
  assert.equal((await bootUniverses(store, ls)).meta.id, meta.id);
});

test("switching keeps both universes whole, and never mixes them", async () => {
  const store = await openStore(null);
  const ls = new LS({ "johnny-spore-cell-stage": cell("Ana"), "johnny-spore-settings": "{\"vol\":1}" });
  const { meta: a } = await bootUniverses(store, ls);
  const b = await createUniverse(store, ls, a, { name: "Second" });
  assert.equal(ls.getItem("johnny-spore-cell-stage"), null, "a new universe starts empty");
  assert.equal(ls.getItem("johnny-spore-settings"), "{\"vol\":1}", "settings are shared");
  ls.setItem("johnny-spore-cell-stage", cell("Bea"));
  await activate(store, ls, b, a.id);
  assert.equal(ls.getItem("johnny-spore-cell-stage"), cell("Ana"));
  await activate(store, ls, a, b.id);
  assert.equal(ls.getItem("johnny-spore-cell-stage"), cell("Bea"));
  assert.equal(ls.getItem(ACTIVE_UNIVERSE_KEY), b.id);
});

test("a switch that runs out of storage puts everything back", async () => {
  const store = await openStore(null);
  const ls = new LS({ "johnny-spore-cell-stage": cell("Ana") });
  const { meta: a } = await bootUniverses(store, ls);
  const b = await createUniverse(store, ls, a, { name: "B" });
  ls.setItem("johnny-spore-cell-stage", cell("Bea"));
  ls.setItem("johnny-spore-chronicle", "{}");
  ls.failOnce = true; // loading the other universe's data hits the storage limit
  await assert.rejects(activate(store, ls, b, a.id), /storage/);
  assert.equal(ls.getItem("johnny-spore-cell-stage"), cell("Bea"), "the game in play is back");
  assert.equal(ls.getItem(ACTIVE_UNIVERSE_KEY), b.id);
  assert.equal((await store.get("parked", a.id))["johnny-spore-cell-stage"], cell("Ana"), "the other universe is untouched");
});

test("duplicate, rename, delete, export and import", async () => {
  const store = await openStore(null);
  const ls = new LS({ "johnny-spore-creature-stage": JSON.stringify({ brain: 2, record: { name: "Mo" } }) });
  const { meta: a } = await bootUniverses(store, ls, { name: "Main" });
  const copy = await duplicateUniverse(store, ls, a, a.id);
  assert.equal(copy.name, "Main copy");
  assert.equal(copy.seed, a.seed, "a copy keeps its galaxy");
  assert.deepEqual(await store.get("parked", copy.id), currentKeys(ls));
  assert.equal((await renameUniverse(store, copy.id, "Main")).name, "Main (2)", "names stay unique");
  await assert.rejects(deleteUniverse(store, a, a.id), /can't delete/);
  const text = await exportText(store, ls, a, a.id);
  const imp = await importText(store, text);
  assert.equal(imp.name, "Main (3)");
  assert.notEqual(imp.id, a.id, "an import never overwrites");
  assert.equal(ls.getItem("johnny-spore-creature-stage"), JSON.stringify({ brain: 2, record: { name: "Mo" } }));
  await assert.rejects(importText(store, "{nope"), /JSON/);
  await deleteUniverse(store, a, copy.id);
  assert.equal(await store.get("meta", copy.id), undefined);
  assert.equal((await store.all("meta")).length, 2);
});
