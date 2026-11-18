import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANET_TYPES, STAR_COUNT, STAR_KINDS, findHomeWorld, makeEcosystem, makeGalaxy, makeSystem, starNear } from "../galaxy/gen.js";
import { makeName } from "../galaxy/names.js";
import { validateCreature } from "../creature/format.js";

test("the same seed makes the same galaxy; another seed, another one", () => {
  const a = makeGalaxy(1234),
    b = makeGalaxy(1234),
    c = makeGalaxy(98765);
  assert.equal(a.stars.length, STAR_COUNT);
  assert.deepEqual(a.stars.slice(0, 50), b.stars.slice(0, 50));
  assert.notDeepEqual(a.stars.slice(0, 50).map((s) => s.name), c.stars.slice(0, 50).map((s) => s.name));
  for (const s of a.stars) assert.ok(Math.hypot(s.x, s.y) < 1.2 && STAR_KINDS[s.kind] && s.name.length >= 3);
  const kinds = new Set(a.stars.map((s) => s.kind));
  assert.equal(kinds.size, Object.keys(STAR_KINDS).length, "every kind of star appears");
  // Names are varied, not one pattern repeated.
  const names = new Set(a.stars.map((s) => s.name));
  assert.ok(names.size > STAR_COUNT * 0.8, "unique star names: " + names.size);
  assert.equal(starNear(a, a.stars[7].x, a.stars[7].y, 0.0001).id, 7);
});

test("systems and planets are coherent and stable", () => {
  const g = makeGalaxy(42);
  let planets = 0,
    habitable = 0,
    gas = 0;
  const types = new Set();
  for (const star of g.stars.slice(0, 300)) {
    const s1 = makeSystem(42, star),
      s2 = makeSystem(42, star);
    assert.deepEqual(s1.planets, s2.planets, "lazy systems are deterministic");
    const [lo, hi] = STAR_KINDS[star.kind].planets;
    assert.ok(s1.planets.length >= lo && s1.planets.length <= hi);
    let last = 0;
    for (const p of s1.planets) {
      planets++;
      types.add(p.type);
      assert.ok(PLANET_TYPES[p.type]);
      assert.ok(p.orbit > last, "orbits move outward");
      last = p.orbit;
      if (p.type === "gas") gas++;
      if (p.habitability === "Easily habitable") habitable++;
      // Coherence: no life where there is no air or water; no tropics on frozen worlds.
      if (p.atmosphere === "None" || p.type === "gas" || p.type === "barren" || p.type === "volcanic") assert.equal(p.biodiversity, 0, p.type + " " + p.atmosphere);
      if (p.type === "frozen" || p.type === "ice") assert.ok(p.temp < 40, "icy worlds are cold");
      if (p.type === "jungle") assert.ok(p.water >= 0.3);
      assert.ok(p.gravity > 0 && p.name);
    }
  }
  assert.ok(types.size >= 11, "a wide range of worlds: " + [...types].join(","));
  assert.ok(habitable > 0 && habitable < planets * 0.2, "habitable worlds are special: " + habitable + "/" + planets);
  assert.ok(gas > planets * 0.1, "gas giants out past the frost line");
});

test("ecosystems follow the food chain and use real creature data", () => {
  const g = makeGalaxy(7);
  const home = findHomeWorld(g);
  assert.deepEqual(findHomeWorld(makeGalaxy(7)), home, "the home world is fixed by the seed");
  const star = g.stars[home.starId];
  const planet = makeSystem(7, star).planets.find((p) => p.id === home.planetId);
  assert.ok(planet.biodiversity > 0, "the home world has life");
  const eco = makeEcosystem(7, planet);
  assert.deepEqual(makeEcosystem(7, planet).species.map((s) => s.name), eco.species.map((s) => s.name));
  const herb = eco.species.filter((s) => s.diet === "plant").length,
    pred = eco.species.filter((s) => s.diet === "meat").length;
  assert.ok(eco.plants.length >= 1 && herb >= 1, "plants feed grazers");
  assert.ok(pred <= Math.ceil(herb / 2), "fewer predators than prey");
  for (const s of eco.species) {
    assert.doesNotThrow(() => validateCreature(s.record));
    assert.ok(s.record.parts.length >= 2 && s.description.length > 20 && s.danger >= 1 && s.danger <= 5);
  }
  // A dead world has landmarks and nothing living.
  const dead = makeSystem(7, g.stars[0]).planets.find((p) => p.biodiversity === 0) || { id: "x", type: "barren", biodiversity: 0, gravity: 1, temp: 0, water: 0 };
  const deadEco = makeEcosystem(7, dead);
  assert.equal(deadEco.species.length + deadEco.plants.length, 0);
  assert.ok(deadEco.landmarks.length >= 1);
});

test("names are deterministic and readable", () => {
  assert.equal(makeName("planet", 5), makeName("planet", 5));
  for (let i = 0; i < 200; i++) for (const k of ["star", "planet", "species", "plant"]) assert.match(makeName(k, i), /^[A-Z][a-z]+( \d+)?$/);
});

test("species names always have a vowel, and landmarks don't repeat", () => {
  for (let i = 0; i < 400; i++) assert.match(makeName("species", i), /[aeiouy]/i);
  const g = makeGalaxy(3);
  for (const star of g.stars.slice(0, 80))
    for (const p of makeSystem(3, star).planets) {
      const names = makeEcosystem(3, p).landmarks.map((l) => l.name);
      assert.equal(new Set(names).size, names.length);
    }
});

test("starting systems: 8 to 12, far from the core, spread over the arms, each with a T3 world", async () => {
  const { makeGalaxy, makeSystem, terraformLevel, CORE_RADIUS, START_BAND } = await import("../galaxy/gen.js");
  for (const seed of [1, 42, 9001, 123456789]) {
    const g = makeGalaxy(seed);
    assert.ok(g.starts.length >= 8 && g.starts.length <= 12, "count for seed " + seed);
    const arms = new Set();
    const kinds = new Set();
    for (const id of g.starts) {
      const s = g.stars[id];
      const d = Math.hypot(s.x, s.y);
      assert.ok(s.start && d >= START_BAND[0] && d <= START_BAND[1] && d > CORE_RADIUS * 2, "distance " + d);
      arms.add(s.sector);
      kinds.add(s.kind);
      const homes = makeSystem(seed, s).planets.filter((p) => terraformLevel(p) === 3 && p.homeworld);
      assert.equal(homes.length, 1, "one homeworld");
      const h = homes[0];
      assert.equal(h.atmosphere, "Breathable");
      assert.ok(h.water > 0.25 && h.water < 0.9 && h.temp > -10 && h.temp < 36 && h.biodiversity > 0.6 && h.hazards.length === 0);
      assert.ok(h.description && h.climate);
    }
    assert.ok(arms.size >= 3, "spread over arms");
    assert.ok(kinds.size >= 3, "varied star colours");
    // Starts are spaced out, and everything else is unchanged by marking them.
    for (const a of g.starts) for (const b of g.starts) if (a !== b) assert.ok(Math.hypot(g.stars[a].x - g.stars[b].x, g.stars[a].y - g.stars[b].y) > 0.04);
    assert.ok(g.core.systems.length > 0 && g.core.owner === "grox");
    assert.ok(!g.core.systems.some((id) => g.stars[id].start));
  }
  // Same seed, same starts and homeworlds.
  const a = makeGalaxy(77), b = makeGalaxy(77);
  assert.deepEqual(a.starts, b.starts);
  assert.deepEqual(makeSystem(77, a.stars[a.starts[0]]), makeSystem(77, b.stars[b.starts[0]]));
  assert.equal(terraformLevel({ habit: 0 }), 0);
  assert.equal(terraformLevel({ habit: 0.5 }), 2);
});
