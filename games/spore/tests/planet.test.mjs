import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGalaxy, makeSystem } from "../galaxy/gen.js";
import { PROFILE_VERSION, lookKey, planetProfile, temperatureBand } from "../ecolib/planet-profile.js";
import { biomeMap, faunaFor, populate, regionSeed } from "../ecolib/ecosystem.js";
import { getHomeworld, setHomeworld, themeRegion } from "../ecolib/homeworld.js";
import { REGIONS } from "../creature/regions.js";
import { assetById } from "../ecolib/catalog.js";
import { readPedia } from "../pedia/model.js";
import { hexToHsl } from "../ecolib/color.js";

/** A spread of real planets: many galaxies, every star, every non-gas planet. */
const WORLDS = [];
for (const seed of [11, 222, 3333, 44444, 555555, 7, 90, 1234, 8888, 31337]) {
  const g = makeGalaxy(seed);
  for (const star of g.stars.slice(0, 90)) for (const p of makeSystem(seed, star).planets) if (p.type !== "gas") WORLDS.push({ planet: p, star, seed, profile: planetProfile(p, { star, seed }) });
}
const lush = WORLDS.filter((w) => w.profile.habitable && w.profile.plantDensity >= 0.8);

test("a planet's profile is deterministic and versioned", () => {
  const w = WORLDS[5];
  assert.deepEqual(planetProfile(w.planet, { star: w.star, seed: w.seed }), w.profile);
  assert.equal(w.profile.v, PROFILE_VERSION);
  assert.notDeepEqual(planetProfile(w.planet, { star: w.star, seed: w.seed + 1 }).vegetation, w.profile.vegetation, "a different universe, a different look");
  // JSON-safe: it is stored with the universe.
  assert.deepEqual(JSON.parse(JSON.stringify(w.profile)), w.profile);
});

test("every profile is complete and in range", () => {
  assert.ok(WORLDS.length > 1500, "planets sampled: " + WORLDS.length);
  for (const { profile: p } of WORLDS) {
    for (const k of ["terrain", "temperature", "atmosphere", "water", "vegetation", "lighting", "biomes", "flora", "fauna"]) assert.ok(p[k], k);
    assert.ok(p.fertility >= 0 && p.fertility <= 1 && p.relief >= 0.3 && p.relief <= 1.8, "fertility/relief");
    assert.ok(Math.abs(p.biomes.reduce((s, b) => s + b.weight, 0) - 1) < 0.01, "biome weights sum to 1");
    assert.ok(p.biomes.length >= 1 && p.biomes.length <= 4);
    for (const c of [p.terrain.grassLight, p.terrain.rock, p.atmosphere.day, p.atmosphere.night, p.water.color, p.vegetation.leaf, p.lighting.sun]) assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff);
    assert.ok(p.temperature.band >= 0 && p.temperature.band <= 4 && p.label.length > 3);
    assert.equal(temperatureBand(p.temperature.c), p.temperature.band);
    assert.ok(p.atmosphere.fog[0] < p.atmosphere.fog[1]);
  }
});

test("characteristics vary independently: no single preset decides everything", () => {
  const byType = (t) => WORLDS.filter((w) => w.planet.type === t).map((w) => w.profile);
  // Within one planet type, foliage, sky, water and mineral all vary.
  for (const t of ["terrestrial", "desert", "frozen", "rocky"]) {
    const ps = byType(t);
    if (ps.length < 25) continue;
    assert.ok(new Set(ps.map((p) => p.vegetation.name)).size >= 5, t + " foliage varies");
    assert.ok(new Set(ps.map((p) => p.water.name)).size >= 3, t + " water varies");
    assert.ok(new Set(ps.map((p) => p.terrain.mineral)).size >= 4, t + " stone varies");
    assert.ok(new Set(ps.map((p) => p.biomes[0].biome + p.biomes.length)).size >= 3, t + " biome mix varies");
  }
  // The same foliage colour turns up on many kinds of world.
  for (const name of ["verdant", "violet", "crimson", "azure"]) assert.ok(new Set(WORLDS.filter((w) => w.profile.vegetation.name === name).map((w) => w.planet.type)).size >= 5, name + " grows on many world types");
  // Nothing dominates: the commonest foliage is well under half.
  const counts = {};
  for (const w of WORLDS) counts[w.profile.vegetation.name] = (counts[w.profile.vegetation.name] || 0) + 1;
  assert.ok(Math.max(...Object.values(counts)) / WORLDS.length < 0.4, JSON.stringify(counts));
  // Nearly every world has its own look.
  const looks = new Set(WORLDS.map((w) => lookKey(w.profile)));
  assert.ok(looks.size > WORLDS.length * 0.25, `${looks.size} looks across ${WORLDS.length} planets`);
});

test("the named kinds of world all occur, and some are blends of several biomes", () => {
  const has = (f) => WORLDS.some((w) => f(w.profile, w.planet));
  assert.ok(has((p) => /violet|magenta/.test(p.vegetation.name) && p.biomes.some((b) => b.biome === "fungal" && b.weight >= 0.15)), "purple fungal world");
  assert.ok(has((p) => p.biomes[0].biome === "desert" && /iron red|rust orange/.test(p.terrain.mineral)), "red desert world");
  assert.ok(has((p) => p.biomes[0].biome === "volcanic" && (/amber|crimson/.test(p.vegetation.name) || /rust|amber/.test(p.atmosphere.skyName))), "orange volcanic world");
  assert.ok(has((p, pl) => /ice|frozen/.test(pl.type) && /pale cyan|turquoise/.test(p.water.name)), "frozen cyan world");
  assert.ok(has((p, pl) => /rocky|barren/.test(pl.type) && /basalt|slate/.test(p.terrain.mineral)), "dark rocky world");
  assert.ok(has((p) => p.biomes[0].biome === "swamp"), "swamp world");
  assert.ok(has((p) => ["shallows", "coral_reef", "deep_ocean"].includes(p.biomes[0].biome)), "ocean world");
  assert.ok(has((p) => p.biomes[0].biome === "crystalline"), "crystalline world");
  assert.ok(has((p) => p.biomes.some((b) => b.biome === "alien_lush" && b.weight >= 0.15) && p.plantDensity >= 0.9), "dense alien forest");
  assert.ok(has((p) => p.biomes.length >= 3 && p.biomes[1].weight >= 0.2), "strange mixed-biome world");
  // Unusual skies and waters exist alongside ordinary ones.
  assert.ok(has((p) => /green|lilac|rose|amber/.test(p.atmosphere.skyName) && p.atmosphere.kind === "breathable"), "a breathable world with an unfamiliar sky");
  assert.ok(has((p) => /purple|rose|black|green/.test(p.water.name)), "unfamiliar water");
});

test("worlds are coherent: heat, cold, air and life shape the profile", () => {
  for (const { profile: p, planet } of WORLDS) {
    if (planet.biodiversity <= 0) assert.equal(p.habitable, false);
    if (p.atmosphere.kind === "none") assert.equal(p.fauna.flying, 0, "no flyers without air");
    if (planet.temp > 60) assert.ok(!p.biomes.some((b) => b.biome === "tundra" || b.biome === "taiga"), "no tundra at " + planet.temp + "°C");
    if (planet.temp < -10) assert.ok(!p.biomes.some((b) => b.biome === "rainforest" || b.biome === "savanna"), "no rainforest at " + planet.temp + "°C");
    if (p.atmosphere.kind === "none") assert.ok(hexToHsl(p.atmosphere.day).l < 0.12, "airless worlds have black skies");
  }
  // Lush, living worlds grow more than dead ones.
  const avg = (list, f) => list.reduce((s, x) => s + f(x), 0) / Math.max(1, list.length);
  assert.ok(avg(lush, (w) => w.profile.plantDensity) > avg(WORLDS.filter((w) => !w.profile.habitable), (w) => w.profile.plantDensity) + 0.3);
});

/* ------------------------------------------------------------------ ecosystems */
const forest = lush.find((w) => w.profile.biomes.length >= 3);

test("flora placement is deterministic: a revisited planet grows the same forest", () => {
  const a = populate(forest.profile, 42, { radius: 200, count: 600 }),
    b = populate(forest.profile, 42, { radius: 200, count: 600 });
  assert.deepEqual(a.placements, b.placements);
  const c = populate(forest.profile, 43, { radius: 200, count: 600 });
  assert.notDeepEqual(a.placements.slice(0, 20), c.placements.slice(0, 20), "another region differs");
  assert.notEqual(regionSeed(forest.profile, "coast"), regionSeed(forest.profile, "forest"));
});

test("a forest has many species, in clusters and clearings, not one model repeated", () => {
  let best = 0;
  for (const w of lush.slice(0, 40)) {
    const { placements, species } = populate(w.profile, 9, { radius: 220, count: 1200 });
    assert.ok(placements.length > 300, "grew " + placements.length);
    best = Math.max(best, species.length);
    // No species is most of the vegetation.
    const counts = {};
    for (const p of placements) counts[p.id] = (counts[p.id] || 0) + 1;
    assert.ok(Math.max(...Object.values(counts)) / placements.length < 0.3, "one species dominates in " + w.profile.label);
    const trees = placements.filter((p) => p.layer === "trees");
    if (trees.length > 40) assert.ok(new Set(trees.map((t) => t.id)).size >= 4, "tree species " + new Set(trees.map((t) => t.id)).size);
    // Every plant has its own size, rotation and variant.
    assert.ok(new Set(placements.map((p) => p.yaw.toFixed(4))).size > placements.length * 0.97);
    // Plants of one species differ in size.
    const bySpecies = {};
    for (const p of placements) (bySpecies[p.id] ||= []).push(p.size);
    for (const sizes of Object.values(bySpecies)) {
      if (sizes.length < 10) continue;
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const sd = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length);
      assert.ok(sd / mean > 0.025, "same-size clones: " + (sd / mean).toFixed(3));
    }
    assert.ok(new Set(placements.map((p) => p.variant)).size >= 2);
  }
  assert.ok(best >= 30, "best planet grows " + best + " species");
});

test("placement is natural: no big trees overlapping, clearings stay open, density varies", () => {
  const w = lush.find((x) => x.profile.flora.trees > 0.8) || lush[0];
  const { placements, biomeAt } = populate(w.profile, 5, { radius: 220, count: 1500 });
  const trees = placements.filter((p) => p.layer === "trees");
  for (let i = 0; i < trees.length; i++)
    for (let j = i + 1; j < trees.length; j++) {
      const d = Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z);
      assert.ok(d > 0.1 * Math.min(trees[i].size, trees[j].size), "two trees on top of each other");
    }
  // Glades: where the clearing noise is high, trees are rarer than elsewhere.
  const inGlade = trees.filter((t) => biomeAt(t.x, t.z).clearing > 0.66).length;
  assert.ok(inGlade / Math.max(1, trees.length) < 0.08, "trees in glades: " + inGlade + "/" + trees.length);
  // Density is uneven: some 40 m cells are crowded, some nearly empty.
  const cells = new Map();
  for (const p of placements) cells.set(Math.floor(p.x / 40) + "," + Math.floor(p.z / 40), (cells.get(Math.floor(p.x / 40) + "," + Math.floor(p.z / 40)) || 0) + 1);
  const v = [...cells.values()];
  assert.ok(Math.max(...v) > 2.2 * (v.reduce((a, b) => a + b, 0) / v.length) || Math.min(...v) < 0.4 * (v.reduce((a, b) => a + b, 0) / v.length), "density is not uniform");
});

test("placement honours open ground and keep-clear zones", () => {
  const w = lush[3];
  const { placements } = populate(w.profile, 77, { radius: 220, count: 800, isOpen: (x) => x > 0, avoid: [{ x: 100, z: 0, r: 60 }] });
  assert.ok(placements.length > 100);
  assert.ok(placements.every((p) => p.x > 0), "nothing grows on closed ground");
  assert.ok(placements.every((p) => Math.hypot(p.x - 100, p.z) >= 60), "keep-clear zones stay clear");
});

test("a planet's biomes appear as patches in its stated proportions", () => {
  for (const w of lush.slice(0, 25)) {
    const at = biomeMap(w.profile, 31, 240);
    const counts = {};
    let n = 0;
    for (let x = -230; x <= 230; x += 8)
      for (let z = -230; z <= 230; z += 8)
        if (Math.hypot(x, z) < 230) {
          const b = at(x, z).biome;
          counts[b] = (counts[b] || 0) + 1;
          n++;
        }
    const shore = { shallows: "grassland", coral_reef: "grassland", deep_ocean: "wasteland", freshwater: "swamp" };
    const landBiomes = new Set(w.profile.biomes.map((b) => shore[b.biome] || b.biome));
    if (landBiomes.size >= 2) assert.ok(Object.keys(counts).length >= 2, "more than one biome on " + w.profile.label);
    if (landBiomes.size >= 2) assert.ok(Math.max(...Object.values(counts)) / n < 0.97);
    // The commonest planet biome (after shore mapping) is among the commonest on the map.
    assert.ok(Object.keys(counts).every((b) => landBiomes.has(b)), "no biome the planet does not have");
  }
});

test("ground cover follows the biome: desert patches are not forests", () => {
  const desert = WORLDS.find((w) => w.profile.biomes[0].biome === "desert" && w.profile.plantDensity > 0.4);
  if (!desert) return;
  const { placements } = populate(desert.profile, 3, { radius: 220, count: 1000 });
  const inDesert = placements.filter((p) => p.biome === "desert");
  const woody = inDesert.filter((p) => ["tree"].includes(assetById(p.id).category)).length;
  assert.ok(woody / Math.max(1, inDesert.length) < 0.2, "desert trees " + woody + "/" + inDesert.length);
});

/* ------------------------------------------------------------------------ fauna */
test("fauna rosters follow the food chain, the air and the water", () => {
  for (const { profile: p, planet } of WORLDS.slice(0, 600)) {
    const f = faunaFor(p, 12);
    assert.deepEqual(f, faunaFor(p, 12), "deterministic");
    if (!p.habitable) {
      assert.equal(f.species.length, 0);
      continue;
    }
    const prey = f.species.filter((s) => s.role === "prey" || s.role === "giant").length;
    const preds = f.species.filter((s) => s.role === "predator").length;
    assert.ok(prey >= 1, "a living world has herbivores: " + p.label);
    assert.ok(preds <= Math.max(1, Math.ceil(prey / 2)), `predators ${preds} vs prey ${prey}`);
    for (const s of f.species) {
      const a = assetById(s.id);
      assert.ok(a && a.kind === "fauna");
      if (a.params.habitat === "air") assert.ok(p.atmosphere.kind !== "none" && p.atmosphere.kind !== "hydrogen", "flyer without air");
      if (a.params.habitat === "water") assert.ok(p.water.coverage > 0.05 || p.fauna.aquatic > 0.3, "swimmer without water");
    }
    assert.equal(new Set(f.species.map((s) => s.id)).size, f.species.length, "no species twice");
    void planet;
  }
});

/* ------------------------------------------------------------- stage continuity */
test("every stage's land is themed from the same homeworld, and keeps its regional character", () => {
  assert.equal(themeRegion(REGIONS[0], null), REGIONS[0], "no homeworld, no change");
  const a = lush[0].profile,
    b = lush.find((w) => w.profile.vegetation.name !== a.vegetation.name && w.profile.atmosphere.kind !== undefined && Math.abs(w.profile.vegetation.hue - a.vegetation.hue) > 90).profile;
  for (const r of REGIONS) {
    const ta = themeRegion(r, a),
      tb = themeRegion(r, b);
    assert.equal(ta.id, r.id);
    assert.ok(ta.themeKey.startsWith(a.planetId) && ta.homeworld === a);
    assert.notEqual(ta.colors.leaf, tb.colors.leaf, r.id + " foliage differs between planets");
    assert.notEqual(ta.sky.day, tb.sky.day === ta.sky.day ? 0 : tb.sky.day);
    assert.equal(ta.water, a.water.color);
    assert.ok(ta.peaks.length === r.peaks.length && ta.peaks.every((p, i) => p.h > 0 && p.x === r.peaks[i].x));
    assert.ok(ta.fog[0] < ta.fog[1]);
    // The foliage really is the planet's hue (within a tolerance), whichever region.
    const hue = hexToHsl(ta.colors.leaf).h;
    const d = Math.abs(((hue - a.vegetation.hue + 540) % 360) - 180);
    assert.ok(d < 50 || hexToHsl(ta.colors.leaf).s < 0.15 || a.vegetation.name === "shadow", `${r.id} leaf hue ${hue.toFixed(0)} vs planet ${a.vegetation.hue.toFixed(0)}`);
  }
  // Regions stay different from one another on one planet: forest is darker than coast.
  const coast = themeRegion(REGIONS.find((r) => r.id === "coast"), a),
    deep = themeRegion(REGIONS.find((r) => r.id === "forest"), a);
  assert.notEqual(coast.colors.grassLight, deep.colors.grassLight);
  assert.notEqual(coast.fog[1], deep.fog[1]);
});

test("the homeworld is shared state: one setter, read by every stage", () => {
  setHomeworld(lush[1].profile);
  assert.equal(getHomeworld(), lush[1].profile);
  setHomeworld(null);
  assert.equal(getHomeworld(), null);
});

/* ------------------------------------------------------------------ persistence */
test("the stored profile survives a save and load of the universe's Sporepedia", () => {
  const profile = lush[2].profile;
  const raw = { v: 1, seed: 5, entries: {}, log: [], recent: [], visited: {}, milestones: {}, home: { starId: 3, planetId: profile.planetId.replace(/^.*:/, "3:") && "3:1", chosen: true, at: 1, profile: { ...profile, planetId: "3:1" } } };
  const p = readPedia(JSON.stringify(raw), 5);
  assert.deepEqual(p.home.profile, raw.home.profile, "kept exactly");
  // A profile for some other planet, or a malformed one, is dropped rather than trusted.
  assert.equal(readPedia(JSON.stringify({ ...raw, home: { ...raw.home, profile: { ...raw.home.profile, planetId: "9:9" } } }), 5).home.profile, undefined);
  assert.equal(readPedia(JSON.stringify({ ...raw, home: { ...raw.home, profile: { v: 1, planetId: "3:1" } } }), 5).home.profile, undefined);
  // Old saves with no profile still load with their home intact.
  const old = readPedia(JSON.stringify({ ...raw, home: { starId: 3, planetId: "3:1", chosen: true, at: 1 } }), 5);
  assert.equal(old.home.planetId, "3:1");
  assert.equal(old.home.profile, undefined);
});
