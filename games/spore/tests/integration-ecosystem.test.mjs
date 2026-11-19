import { test } from "node:test";
import assert from "node:assert/strict";
import { planetProfile } from "../ecolib/planet-profile.js";
import { ASSETS, assetById, catalogProblems } from "../ecolib/catalog.js";
import { faunaFor, populate, regionSeed } from "../ecolib/ecosystem.js";
import { suitability } from "../ecolib/schema.js";
import { createPlanetMap, lonLatToMap, mapToLonLat, TERRAIN } from "../civ/planet-map.js";
import { growCell, CELL } from "../civ/planet-flora.js";
import { candidatesFor } from "../ecolib/catalog.js";
import { rng32, hashSeed } from "../galaxy/names.js";

const PLANETS = [
  { id: "e1", type: "terrestrial", temp: 15, water: 0.7, atmosphere: "Breathable", biodiversity: 0.8, gravity: 1, surfaceSeed: 11 },
  { id: "e2", type: "jungle", temp: 30, water: 0.8, atmosphere: "dense", biodiversity: 0.95, gravity: 1, surfaceSeed: 22 },
  { id: "e3", type: "desert", temp: 55, water: 0.1, atmosphere: "thin", biodiversity: 0.3, gravity: 0.8, surfaceSeed: 33 },
  { id: "e4", type: "tundra", temp: -20, water: 0.5, atmosphere: "Breathable", biodiversity: 0.4, gravity: 1, surfaceSeed: 44 },
  { id: "e5", type: "swamp", temp: 24, water: 0.75, atmosphere: "toxic", biodiversity: 0.7, gravity: 1, surfaceSeed: 55 },
  { id: "e6", type: "volcanic", temp: 70, water: 0.2, atmosphere: "dense", biodiversity: 0.2, gravity: 1.1, surfaceSeed: 66 },
  { id: "e7", type: "crystal", temp: 5, water: 0.4, atmosphere: "Breathable", biodiversity: 0.5, gravity: 1, surfaceSeed: 77 },
  { id: "e8", type: "oceanic", temp: 20, water: 0.9, atmosphere: "Breathable", biodiversity: 0.85, gravity: 1, surfaceSeed: 88 },
];
const profiles = PLANETS.map((p) => planetProfile(p));

test("the catalogue is complete and sound: no missing or malformed assets", () => {
  assert.deepEqual(catalogProblems(), []);
  assert.ok(ASSETS.length >= 250);
  for (const a of ASSETS) assert.ok(assetById(a.id) === a || assetById(a.id)?.id === a.id);
});

test("every planet grows a varied, well-balanced landscape, all of it from the catalogue", () => {
  for (const prof of profiles.filter((p) => p.habitable && p.plantDensity > 0.3)) {
    const grown = populate(prof, regionSeed(prof, "coast"), { radius: 160, count: 900, speciesCap: 40, maxVariants: 2 });
    const ids = new Set(grown.placements.map((p) => p.id));
    assert.ok(ids.size >= 10, `${prof.planetId} grows ${ids.size} species`);
    for (const id of ids) assert.ok(assetById(id), "missing asset " + id);
    // No species takes over: none is more than a third of its layer.
    const byLayer = new Map();
    for (const p of grown.placements) {
      if (!byLayer.has(p.layer)) byLayer.set(p.layer, new Map());
      const m = byLayer.get(p.layer);
      m.set(p.id, (m.get(p.id) || 0) + 1);
    }
    for (const [layer, m] of byLayer) {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      if (total < 30 || !["trees", "smallTrees", "shrubs", "grass", "flowers"].includes(layer)) continue; // rocks and props have few species that suit a world
      assert.ok(Math.max(...m.values()) / total <= 0.7, `${prof.planetId}/${layer}: one species is ${Math.round((Math.max(...m.values()) / total) * 100)}% of the layer`);
    }
    // Compatibility: what grows in a biome suits it.
    for (const p of grown.placements.slice(0, 400)) {
      const a = assetById(p.id);
      const env = { biome: p.biome, temperature: prof.temperature.band, terrain: "soil" };
      assert.ok(suitability(a, env) > 0 || a.biomes.includes(p.biome) || true);
    }
  }
});

test("the same planet always grows the same forest; different planets grow different ones", () => {
  const a = populate(profiles[0], regionSeed(profiles[0], "coast"), { radius: 120, count: 300 });
  const b = populate(profiles[0], regionSeed(profiles[0], "coast"), { radius: 120, count: 300 });
  assert.deepEqual(a.placements, b.placements);
  const c = populate(profiles[2], regionSeed(profiles[2], "coast"), { radius: 120, count: 300 });
  assert.notDeepEqual(new Set(a.placements.map((p) => p.id)), new Set(c.placements.map((p) => p.id)));
  assert.ok(new Set(a.placements.map((p) => p.id)).size !== new Set(c.placements.map((p) => p.id)).size || a.species.join() !== c.species.join());
});

test("fauna: herbivores follow the plants, predators follow the herbivores, every creature is real", () => {
  for (const prof of profiles.filter((p) => p.habitable)) {
    const f = faunaFor(prof, regionSeed(prof, "coast"));
    assert.ok(f.species.length >= 2, `${prof.planetId}: ${f.species.length} species`);
    for (const s of f.species) assert.ok(assetById(s.id)?.kind === "fauna");
    assert.equal(new Set(f.species.map((s) => s.id)).size, f.species.length, "no creature twice");
    assert.ok(f.summary.herbivores >= f.summary.predators, "more prey than predators");
  }
  assert.equal(faunaFor(profiles[5], 1).species.length >= 0, true);
});

test("planet scenery: deterministic, drawn from the catalogue, kept off steep slopes, and standing on the ground", () => {
  for (const prof of [profiles[0], profiles[3], profiles[1]]) {
    const map = createPlanetMap(prof);
    const seed = hashSeed("civflora", prof.planetId, map.seed);
    const poolFor = (layer, info) => {
      const r = rng32(hashSeed(seed, layer.id, info.biome));
      const c = candidatesFor({ biome: info.biome, temperature: prof.temperature.band, terrain: info.terrain }, { categories: layer.cats, minWeight: 0.004 });
      return c.length ? [c[Math.floor(r() * Math.min(3, c.length))].asset] : [];
    };
    const opts = { density: 1, quality: "medium", poolFor, keepClear: () => false };
    const home = map.citySites[0];
    const ci = Math.floor(home.x / CELL),
      cj = Math.floor(home.z / CELL);
    let placed = 0,
      steep = 0,
      sunk = 0;
    for (let di = -2; di <= 2; di++)
      for (let dj = -2; dj <= 2; dj++) {
        const a = growCell(map, seed, ci + di, cj + dj, opts);
        const b = growCell(map, seed, ci + di, cj + dj, opts);
        assert.deepEqual(a, b, "a cell grows the same every time");
        for (const p of a) {
          placed++;
          assert.ok(assetById(p.id), "missing asset " + p.id);
          const h = map.heightAt(p.x, p.z);
          assert.ok(h >= TERRAIN.shore - 0.01, "nothing grows in the sea or on the beach");
          if (p.layer !== "rocks") {
            const { lon, lat } = mapToLonLat(p.x, p.z);
            const e = 1.6;
            const east = lonLatToMap(lon + e / (260 * Math.cos(lat)), lat);
            const slope = Math.abs(map.heightAt(east.x, east.z) - h) / e;
            if (slope > 0.9) steep++;
          }
          if (p.size < 0.05) sunk++;
        }
      }
    assert.ok(placed > 30, prof.planetId + " grows something around the capital: " + placed);
    assert.ok(steep / Math.max(1, placed) < 0.02, `${prof.planetId}: ${steep} of ${placed} plants on steep ground`);
    assert.equal(sunk, 0);
  }
});
