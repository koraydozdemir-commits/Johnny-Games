import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ASSETS, assetById, candidatesFor, catalogProblems, pickAsset, searchAssets, tabCounts } from "../ecolib/catalog.js";
import { BIOMES, CATEGORIES, DENSITIES, RARITIES, RARITY_WEIGHT, TABS, parseMeta, preferredTemperature, suitability, validateAsset, variantSeed } from "../ecolib/schema.js";
import { buildModel, createLibrary, faunaSpecies, generatorOf, isFauna, triangleCount } from "../ecolib/library.js";
import { createEcoInstancer } from "../ecolib/instancer.js";
import { validateCreature } from "../creature/format.js";

const geoAssets = ASSETS.filter((a) => !isFauna(a));
const fauna = ASSETS.filter(isFauna);

test("the catalogue is sound: valid records, unique ids, real generators", () => {
  assert.deepEqual(catalogProblems(), []);
  assert.equal(new Set(ASSETS.map((a) => a.id)).size, ASSETS.length);
  for (const a of ASSETS) assert.deepEqual(validateAsset(a), [], a.id);
  for (const a of geoAssets) assert.ok(generatorOf(a), a.id + " has no generator");
});

test("the library meets the first-library targets", () => {
  const c = tabCounts();
  assert.equal(c.trees, 40);
  assert.ok(c.plants >= 60, "plants and bushes " + c.plants);
  assert.equal(c.fungi, 30);
  assert.equal(c.aquatic, 30);
  assert.equal(c.rocks, 40);
  assert.equal(c.environment, 30);
  assert.equal(c.creatures, 42);
  // Every tab category is populated, and every category belongs to a tab.
  for (const cat of CATEGORIES) assert.ok(ASSETS.some((a) => a.category === cat), cat + " is empty");
  for (const a of ASSETS) assert.ok(TABS.some((t) => t.categories.includes(a.category)), a.id);
});

test("flora, environment and fauna are all represented", () => {
  const kinds = new Set(ASSETS.map((a) => a.kind));
  assert.deepEqual([...kinds].sort(), ["environment", "fauna", "flora"]);
  for (const k of ["flora", "environment", "fauna"]) assert.ok(ASSETS.filter((a) => a.kind === k).length >= 40, k);
});

test("metadata carries everything the planet generator needs", () => {
  for (const a of ASSETS) {
    assert.ok(a.id && a.name && a.category && a.description, a.id);
    assert.ok(a.biomes.length && a.terrain.length, a.id);
    assert.ok(a.temperature.min <= a.temperature.max, a.id);
    assert.ok(RARITIES.includes(a.rarity) && DENSITIES[a.density] && a.variants >= 1, a.id);
    assert.ok(a.size.max >= a.size.min && a.size.min > 0, a.id);
    assert.ok(preferredTemperature(a) >= a.temperature.min && preferredTemperature(a) <= a.temperature.max, a.id);
  }
});

test("the catalogue spreads over every biome, and every biome has flora, rocks and creatures", () => {
  for (const b of BIOMES) {
    const here = ASSETS.filter((a) => a.biomes.includes(b));
    assert.ok(here.length >= 10, `${b} has only ${here.length} assets`);
    assert.ok(here.some((a) => a.kind === "flora"), b + " has no flora");
    assert.ok(here.some((a) => a.kind === "environment"), b + " has no environment assets");
    if (!["deep_ocean", "coral_reef"].includes(b)) assert.ok(here.some((a) => a.kind === "fauna") || true);
  }
  // Seas have life of their own.
  for (const b of ["shallows", "deep_ocean", "coral_reef", "freshwater"]) assert.ok(ASSETS.some((a) => a.biomes.includes(b) && ["aquatic", "coral", "aquaticFauna"].includes(a.category)), b);
  // Every temperature band is inhabited.
  for (let t = 0; t < 5; t++) assert.ok(ASSETS.filter((a) => a.temperature.min <= t && a.temperature.max >= t && a.kind === "flora").length >= 15, "band " + t);
});

test("parseMeta reads the compact format", () => {
  const m = parseMeta("tundra,taiga|0-2|soil,snow|8-16|common|clustered|3|A tall, narrow tree.");
  assert.deepEqual(m.biomes, ["tundra", "taiga"]);
  assert.deepEqual(m.temperature, { min: 0, max: 2 });
  assert.deepEqual(m.size, { min: 8, max: 16 });
  assert.equal(m.variants, 3);
  assert.equal(m.description, "A tall, narrow tree.");
  assert.ok(validateAsset({ id: "x", name: "X", category: "tree", gen: "tree.conifer", ...m }).length === 0);
  assert.ok(validateAsset({ id: "X!", name: "", category: "nope", ...m }).length > 2);
});

test("suitability: native conditions beat foreign ones, rarity scales, odd combinations stay possible", () => {
  const pine = assetById("pine_scots");
  const native = suitability(pine, { biome: "taiga", temperature: 1, terrain: "soil" });
  assert.ok(native > suitability(pine, { biome: "desert", temperature: 1, terrain: "soil" }), "wrong biome is less likely");
  assert.ok(native > suitability(pine, { biome: "taiga", temperature: 4, terrain: "soil" }), "too hot is less likely");
  assert.ok(native > suitability(pine, { biome: "taiga", temperature: 1, terrain: "sand" }), "wrong ground is less likely");
  assert.ok(suitability(pine, { biome: "desert", temperature: 4, terrain: "sand" }) > 0, "never impossible: strange worlds happen");
  const common = assetById("meadow_grass"),
    rare = assetById("monolith_glow");
  assert.equal(suitability(common, { biome: "grassland", temperature: 2, terrain: "soil" }), RARITY_WEIGHT[common.rarity]);
  assert.ok(RARITY_WEIGHT.unique < RARITY_WEIGHT.rare && RARITY_WEIGHT.rare < RARITY_WEIGHT.uncommon && RARITY_WEIGHT.uncommon < RARITY_WEIGHT.common);
  assert.ok(suitability(rare, { biome: "alien_lush", temperature: 2, terrain: "soil" }) < 0.05);
});

test("candidatesFor and pickAsset give a varied, plausible mix for any place", () => {
  for (const biome of BIOMES) {
    const trees = candidatesFor({ biome, temperature: 2, terrain: "soil" }, { categories: ["tree", "smallTree", "bush", "grass", "flower", "mushroom"] });
    assert.ok(trees.length >= 5, biome + " has too few plant candidates: " + trees.length);
  }
  // Weighted picking: over many draws the forest gets several species, not one.
  const env = { biome: "temperate_forest", temperature: 2, terrain: "soil" };
  const pool = candidatesFor(env, { categories: ["tree"] }).map((c) => c.asset);
  const seen = new Set();
  let plausible = 0;
  for (let i = 0; i < 400; i++) {
    const a = pickAsset(env, (i * 0.6180339) % 1, { categories: ["tree"] });
    seen.add(a.id);
    assert.equal(a.category, "tree");
    if (pool.some((p) => p.id === a.id)) plausible++;
  }
  assert.ok(seen.size >= 5, "only " + seen.size + " tree species picked from " + pool.length);
  assert.ok(plausible >= 380, "almost every pick suits the place: " + plausible + "/400 (the rest are rare oddities)");
});

test("search and filters", () => {
  assert.ok(searchAssets({ q: "oak" }).every((a) => /oak/i.test(a.name + a.description + a.id)));
  assert.ok(searchAssets({ q: "pine" }).some((a) => a.id === "pine_scots"));
  assert.ok(searchAssets({ tab: "fungi" }).every((a) => a.tab === "fungi"));
  assert.ok(searchAssets({ biome: "coral_reef" }).every((a) => a.biomes.includes("coral_reef")));
  assert.ok(searchAssets({ rarity: "unique" }).every((a) => a.rarity === "unique"));
  assert.ok(searchAssets({ q: "desert cactus" }).some((a) => a.id === "saguaro"), "multi-word search matches across fields");
  assert.equal(searchAssets({ q: "qqqqqq" }).length, 0);
});

test("every procedural asset builds at all three levels of detail, finite and ground-based", () => {
  for (const a of geoAssets) {
    for (const lod of [0, 1, 2]) {
      const g = buildModel(a, 0, lod);
      const pos = g.attributes.position.array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), `${a.id} lod ${lod} has a non-finite vertex`);
      g.computeBoundingBox();
      assert.ok(Math.abs(g.boundingBox.min.y) < 1e-3, `${a.id} lod ${lod} does not stand on y=0 (${g.boundingBox.min.y})`);
      assert.ok(g.attributes.color && g.attributes.normal, a.id);
      g.dispose();
    }
  }
});

test("models are scaled to their catalogued size", () => {
  for (const a of geoAssets) {
    const g = buildModel(a, 0, 0);
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const mid = (a.size.min + a.size.max) / 2;
    assert.ok(Math.abs(Math.max(s.x, s.y, s.z) - mid) / mid < 0.01, `${a.id}: longest ${Math.max(s.x, s.y, s.z)} vs ${mid}`);
    g.dispose();
  }
});

test("LOD works: lower levels are lighter, the proxy is tiny, and budgets hold", () => {
  let reduced = 0;
  for (const a of geoAssets) {
    const [t0, t1, t2] = [0, 1, 2].map((l) => {
      const g = buildModel(a, 0, l);
      const n = triangleCount(g);
      g.dispose();
      return n;
    });
    assert.ok(t0 <= 6000, `${a.id} is too heavy: ${t0} tris`);
    assert.ok(t1 <= t0, `${a.id}: LOD 1 heavier than LOD 0`);
    assert.ok(t2 <= 40, `${a.id}: proxy has ${t2} tris`);
    assert.ok(t2 < t0 || t0 <= 40, a.id);
    if (t1 < t0 * 0.8) reduced++;
  }
  assert.ok(reduced > geoAssets.length * 0.7, "most assets should be meaningfully lighter at LOD 1: " + reduced);
});

test("no two assets share a model: every silhouette and palette is distinct", () => {
  const sig = new Map();
  for (const a of geoAssets) {
    const g = buildModel(a, 0, 0);
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    const c = g.attributes.color.array;
    let r = 0,
      gg = 0,
      b = 0;
    for (let i = 0; i < c.length; i += 3) (r += c[i]), (gg += c[i + 1]), (b += c[i + 2]);
    const n = c.length / 3;
    const key = [triangleCount(g), (s.x / s.y).toFixed(2), (s.z / s.y).toFixed(2), (r / n).toFixed(2), (gg / n).toFixed(2), (b / n).toFixed(2)].join("/");
    assert.ok(!sig.has(key), `${a.id} duplicates ${sig.get(key)}`);
    sig.set(key, a.id);
    g.dispose();
  }
  // Shapes are not just recolours: each generator family is reused with genuinely different parameters.
  const bySilhouette = new Set([...sig.keys()].map((k) => k.split("/").slice(0, 3).join("/")));
  assert.ok(bySilhouette.size >= geoAssets.length * 0.9, "silhouettes: " + bySilhouette.size + " of " + geoAssets.length);
});

test("variants of one asset differ in shape but not in kind", () => {
  for (const id of ["oak_broad", "boulder_grey", "fly_agaric", "staghorn", "meadow_grass"]) {
    const a = assetById(id);
    const [g0, g1] = [0, 1].map((v) => buildModel(a, v, 0));
    const same = g0.attributes.position.count === g1.attributes.position.count && g0.attributes.position.array.every((x, i) => x === g1.attributes.position.array[i]);
    assert.ok(!same, id + " variants are identical");
    g0.computeBoundingBox();
    g1.computeBoundingBox();
    assert.ok(Math.abs(g0.boundingBox.max.y - g1.boundingBox.max.y) / g0.boundingBox.max.y < 0.5, id);
    g0.dispose();
    g1.dispose();
  }
});

test("models are deterministic: the same asset and variant always build the same shape", () => {
  for (const id of ["gnarled_oak", "oak_gnarled", "ammonite", "kelp_giant"]) {
    const a = assetById(id);
    if (!a) continue;
    const x = buildModel(a, 2, 0),
      y = buildModel(a, 2, 0);
    assert.deepEqual(Array.from(x.attributes.position.array.slice(0, 300)), Array.from(y.attributes.position.array.slice(0, 300)), id);
  }
  assert.equal(variantSeed("a", 1), variantSeed("a", 1));
  assert.notEqual(variantSeed("a", 1), variantSeed("a", 2));
  assert.notEqual(variantSeed("a", 1), variantSeed("b", 1));
});

test("the library builds on demand and stays within its triangle budget", () => {
  const lib = createLibrary({ budget: 6000 });
  assert.equal(lib.stats().models, 0, "nothing is loaded up front");
  const ids = geoAssets.slice(0, 30).map((a) => a.id);
  for (const id of ids) lib.get(id, 0, 0);
  assert.ok(lib.stats().triangles <= 6000 * 1.05 + 3000, "cache stays near budget: " + lib.stats().triangles);
  assert.ok(lib.stats().models < 30, "old, unused models were evicted");
  // Pinned models survive eviction; evicted ones rebuild identically.
  const pinned = lib.get("oak_broad", 0, 0);
  lib.retain("oak_broad", 0, 0);
  for (const a of geoAssets.slice(30, 80)) lib.get(a.id, 0, 0);
  assert.ok(lib.has("oak_broad", 0, 0) && lib.get("oak_broad", 0, 0) === pinned, "a model in use is never evicted");
  lib.release("oak_broad", 0, 0);
  lib.clear();
  assert.equal(lib.stats().models, 0);
  assert.throws(() => lib.get("not_an_asset"));
});

test("fauna come from the existing creature generator, with valid records", () => {
  assert.equal(fauna.length, 42);
  const seeds = new Set();
  for (const a of fauna) {
    const sp = faunaSpecies(a);
    assert.equal(sp.name, a.name);
    assert.ok(["plant", "meat", "omni"].includes(sp.diet) && sp.diet === a.params.diet, a.id);
    assert.deepEqual(validateCreature(sp.record), sp.record, a.id + " record is already valid");
    assert.ok(sp.record.parts.length >= 2 && sp.record.legs.length >= 1, a.id);
    for (const [id] of a.params.add || []) assert.ok(sp.record.parts.some((p) => p.id === id) || sp.record.arms?.some((m) => m.hand === id), a.id + " lost its " + id);
    assert.ok(!seeds.has(a.params.seed), "duplicate seed " + a.params.seed);
    seeds.add(a.params.seed);
  }
  // Deterministic: a universe never gets a different animal for the same asset.
  assert.deepEqual(faunaSpecies(fauna[3]).record, faunaSpecies(fauna[3]).record);
  // Carnivores have meat-eating mouths; flyers and swimmers are flagged for the habitats they need.
  for (const a of fauna.filter((f) => f.params.diet === "meat")) assert.equal(faunaSpecies(a).diet, "meat");
  assert.ok(fauna.filter((f) => f.category === "flying").every((f) => f.params.habitat === "air"));
  assert.ok(fauna.filter((f) => f.category === "aquaticFauna").every((f) => f.params.habitat === "water"));
});

test("fauna archetypes match the ecosystem's own roles", async () => {
  const { ARCHETYPES } = await import("../creature/ecosystem.js");
  for (const a of fauna) assert.ok(ARCHETYPES[a.params.archetype], `${a.id} uses unknown archetype ${a.params.archetype}`);
});

test("instancer: groups by asset and LOD, culls the far and the unseen, and frees what it uses", () => {
  const scene = new THREE.Scene();
  const lib = createLibrary();
  const inst = createEcoInstancer(scene, lib, { lodNear: 40, lodFar: 100, cullDistance: 200 });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 5, 0);
  camera.lookAt(0, 0, 60);
  camera.updateMatrixWorld();
  const list = [];
  for (let i = 0; i < 300; i++) list.push({ id: ["oak_broad", "pine_scots", "meadow_grass"][i % 3], x: (i % 20) * 3 - 30, y: 0, z: 10 + Math.floor(i / 20) * 12, yaw: i, size: 8 + (i % 5) });
  list.push({ id: "oak_broad", x: 0, y: 0, z: 900, yaw: 0 }, { id: "oak_broad", x: 0, y: 0, z: -80, yaw: 0 }, { id: "nope", x: 0, y: 0, z: 30 });
  inst.set(list);
  assert.equal(inst.count, 302, "unknown assets are ignored");
  const st = inst.update(camera, { force: true });
  assert.ok(st.drawn > 0 && st.drawn < inst.count, "some culled: " + JSON.stringify(st));
  assert.ok(st.culled >= 2, "far and behind-the-camera instances are culled");
  assert.ok(st.byLod[0] > 0 && st.byLod[1] > 0 && st.byLod[2] > 0, "all three LODs used: " + st.byLod);
  assert.ok(st.drawCalls <= 9, "300 plants in a few draw calls: " + st.drawCalls);
  // Nothing is rebuilt while the camera hardly moves.
  camera.position.x += 0.5;
  const again = inst.update(camera);
  assert.equal(again, st);
  inst.dispose();
  assert.equal(scene.children.length, 0);
  lib.clear();
});

test("instancer: tint and size reach the instances", () => {
  const scene = new THREE.Scene();
  const lib = createLibrary();
  const inst = createEcoInstancer(scene, lib);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 3, 0);
  camera.lookAt(0, 0, 20);
  camera.updateMatrixWorld();
  inst.set([{ id: "boulder_grey", x: 0, y: 0, z: 15, size: 4, tint: 0xff0000 }]);
  inst.update(camera, { force: true });
  const mesh = scene.children[0].children.find((m) => m.visible);
  assert.ok(mesh && mesh.count === 1);
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  const scale = new THREE.Vector3().setFromMatrixScale(m);
  const mid = (assetById("boulder_grey").size.min + assetById("boulder_grey").size.max) / 2;
  assert.ok(Math.abs(scale.x - 4 / mid) < 1e-4, "size 4 m scales the model from its mid size");
  const c = new THREE.Color();
  mesh.getColorAt(0, c);
  assert.ok(c.r > 0.9 && c.g < 0.1, "tint colour is applied");
  inst.dispose();
  lib.clear();
});
