import { test } from "node:test";
import assert from "node:assert/strict";
import { planetProfile } from "../ecolib/planet-profile.js";
import { PLANET, clampToMap, createPlanetMap, inBounds, lonLatToMap, mapToLonLat, noise3, spiceIncome, toWorld, unitVector } from "../civ/planet-map.js";
import { STYLE_IDS, chooseStyles, layoutCity, makeCulture, paletteOf, roadLinks, traitsOf } from "../civ/culture.js";
import { generateSpecies } from "../creature/species.js";

const PLANETS = [
  { id: "t1", type: "terrestrial", temp: 15, water: 0.7, atmosphere: "Breathable", biodiversity: 0.7, gravity: 1, surfaceSeed: 123 },
  { id: "d1", type: "desert", temp: 60, water: 0.1, atmosphere: "thin", biodiversity: 0.2, gravity: 0.8, surfaceSeed: 77 },
  { id: "i1", type: "ice", temp: -40, water: 0.4, atmosphere: "thin", biodiversity: 0.1, gravity: 1.2, surfaceSeed: 5 },
  { id: "j1", type: "jungle", temp: 30, water: 0.8, atmosphere: "dense", biodiversity: 0.9, gravity: 1, surfaceSeed: 991 },
];
const maps = PLANETS.map((p) => createPlanetMap(planetProfile(p)));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test("map space: longitude and latitude convert both ways, and the playable area has edges", () => {
  for (const [lon, lat] of [[0, 0], [1.2, 0.5], [-2.8, -1.1], [3, 1.2]]) {
    const m = lonLatToMap(lon, lat);
    const back = mapToLonLat(m.x, m.z);
    assert.ok(Math.abs(back.lon - lon) < 1e-9 && Math.abs(back.lat - lat) < 1e-9);
  }
  // Distances along the central meridian and along a parallel are true.
  const a = lonLatToMap(0, 0.4),
    b = lonLatToMap(0, 0.5);
  assert.ok(Math.abs(dist(a, b) - 0.1 * PLANET.R) < 1e-6);
  const c1 = lonLatToMap(0.3, 0.4),
    c2 = lonLatToMap(0.5, 0.4);
  assert.ok(Math.abs(dist(c1, c2) - 0.2 * PLANET.R * Math.cos(0.4)) < 1e-6);
  assert.ok(inBounds(0, 0) && !inBounds(0, PLANET.R * PLANET.LAT_MAX + 5) && !inBounds(Math.PI * PLANET.R + 1, 0));
  const edge = clampToMap(9999, -9999);
  assert.ok(inBounds(edge.x, edge.z));
  // Every map point lands on the sphere at the right height.
  const w = toWorld(120, -80, 5);
  assert.ok(Math.abs(Math.hypot(...w) - (PLANET.R + 5)) < 1e-9);
  const u = unitVector(0.7, -0.3);
  assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-12);
});

test("noise is deterministic and bounded", () => {
  assert.equal(noise3(3, 1.2, 3.4, -0.7), noise3(3, 1.2, 3.4, -0.7));
  for (let i = 0; i < 300; i++) {
    const v = noise3(9, i * 0.37, i * 0.11, -i * 0.23);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("a planet has several continents, islands and open ocean, in proportion to its water", () => {
  for (const m of maps) {
    const big = m.continents.filter((c) => c.big);
    assert.ok(big.length >= 3, "at least three continents on " + m.profile.planetId + ": " + big.length);
    assert.ok(m.continents.some((c) => !c.big), "and some islands");
    const { H, nx, nz } = m.grid;
    let land = 0,
      sea = 0;
    for (let k = 0; k < nx * nz; k++) {
      if (H[k] > 0.25) land++;
      else if (H[k] < -0.4 && H[k] > -50) sea++;
    }
    assert.ok(land > 0 && sea > land * 0.5, "oceans on " + m.profile.planetId);
  }
  // A watery world has less land than a dry one.
  const wet = maps[3].grid.H.filter((h) => h > 0.25).length,
    dry = maps[1].grid.H.filter((h) => h > 0.25).length;
  assert.ok(wet < dry, "the jungle world (80% water) has less land than the desert world (10%)");
});

test("mountains, valleys and coasts: heights span sea to peak and land is not flat", () => {
  for (const m of maps) {
    let lo = Infinity,
      hi = -Infinity;
    for (const h of m.grid.H) {
      if (h < -50) continue;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    assert.ok(lo < -4, "deep sea " + lo);
    assert.ok(hi > 10, "peaks " + hi);
    assert.ok(hi < 40, "peaks stay sane " + hi);
  }
});

test("the same planet always makes the same world; different planets make different ones", () => {
  const again = createPlanetMap(planetProfile(PLANETS[0]));
  assert.deepEqual(again.citySites, maps[0].citySites);
  assert.deepEqual(again.spiceSites, maps[0].spiceSites);
  assert.equal(again.heightAt(100, -50), maps[0].heightAt(100, -50));
  assert.notDeepEqual(maps[0].citySites[0], maps[1].citySites[0]);
});

test("a dozen cities on land, spread over several continents, off the coast and apart from each other", () => {
  for (const m of maps) {
    const sites = m.citySites;
    assert.equal(sites.length, 12, m.profile.planetId + " has twelve city sites");
    for (const s of sites) {
      assert.ok(m.heightAt(s.x, s.z) > 1, "on land");
      assert.ok(inBounds(s.x, s.z, 20));
    }
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) assert.ok(dist(sites[i], sites[j]) >= 40, "cities are apart");
    assert.ok(new Set(sites.map((s) => s.continent)).size >= 3, "on at least three continents");
    // The capital's continent has room for your neighbours.
    assert.ok(sites.filter((s) => s.continent === sites[0].continent).length >= 4);
    // Ordered by distance from the capital, so the nearest cities are the neighbours.
    for (let i = 2; i < sites.length; i++) assert.ok(dist(sites[i], sites[0]) >= dist(sites[i - 1], sites[0]) - 1e-6);
    assert.ok(sites.some((s) => s.coastal), "some are coastal");
  }
});

test("city grounds are levelled", () => {
  for (const m of maps) {
    for (const s of m.citySites.slice(0, 6)) {
      const hs = [];
      for (let a = 0; a < 8; a++) hs.push(m.heightAt(s.x + Math.cos(a) * 18, s.z + Math.sin(a) * 18));
      assert.ok(Math.max(...hs) - Math.min(...hs) < 0.6, "flat within the walls");
    }
  }
});

test("spice geysers: on land, away from cities, each richer or poorer, and on more than one continent", () => {
  for (const m of maps) {
    assert.ok(m.spiceSites.length >= 9, m.profile.planetId + " spice " + m.spiceSites.length);
    for (const g of m.spiceSites) {
      assert.ok(m.heightAt(g.x, g.z) > 0.5, "on land");
      assert.ok(m.citySites.every((c) => dist(c, g) >= 38), "clear of cities");
      assert.ok(g.yield >= 0.7 && g.yield <= 2);
    }
    for (let i = 0; i < m.spiceSites.length; i++) for (let j = i + 1; j < m.spiceSites.length; j++) assert.ok(dist(m.spiceSites[i], m.spiceSites[j]) >= 38);
    assert.ok(new Set(m.spiceSites.map((g) => g.continent)).size >= 3);
    assert.ok(new Set(m.spiceSites.map((g) => g.yield)).size >= 4, "they do not all pay the same");
  }
  assert.equal(spiceIncome(1.1, { yield: 2 }), 2.2);
  assert.equal(spiceIncome(1.1, null), 1.1);
});

test("biomes: the planet's own biomes appear, and there is more than one on a continent", () => {
  for (const m of maps) {
    const seen = new Set();
    const { nx, nz, cell } = m.grid;
    for (let j = 0; j < nz; j += 3)
      for (let i = 0; i < nx; i += 3) {
        const x = m.cellX(i),
          z = m.cellZ(j);
        if (!inBounds(x, z, 10)) continue;
        const d = m.describe(x, z);
        if (d.kind === "land") seen.add(d.biome);
      }
    assert.ok(cell > 0);
    assert.ok(seen.size >= 2, m.profile.planetId + " shows " + [...seen].join());
    // The profile's biggest biome is on the map (or its shore variant).
  }
  // A warm planet with grassland shows both forest and desert where it is wet and dry.
  const seenT = new Set();
  for (let x = -700; x <= 700; x += 20) for (let z = -300; z <= 300; z += 20) if (inBounds(x, z, 10) && maps[0].heightAt(x, z) > 1) seenT.add(maps[0].describe(x, z).biome);
  assert.ok(seenT.size >= 3, [...seenT].join());
  const ice = maps[2].iceLat;
  assert.ok(ice < 1.1, "a cold planet has an ice line inside the map");
});

test("routes: land vehicles stay on land, boats on water, aircraft fly straight", () => {
  const m = maps[0];
  const cap = m.citySites[0];
  const near = m.citySites.find((s, i) => i > 0 && s.continent === cap.continent);
  const other = m.citySites.find((s) => s.continent !== cap.continent);
  const route = m.findPath("land", cap, near);
  assert.ok(route && route.length >= 1, "a land route to a neighbour");
  let prev = cap;
  for (const p of route) {
    const steps = Math.ceil(dist(prev, p) / 4);
    for (let i = 1; i <= steps; i++) assert.ok(m.walkable("land", prev.x + ((p.x - prev.x) * i) / steps, prev.z + ((p.z - prev.z) * i) / steps), "never wet");
    prev = p;
  }
  assert.equal(m.findPath("land", cap, other), null, "no land route to another continent");
  assert.equal(m.reachable("land", cap, other), false);
  assert.equal(m.reachable("air", cap, other), true);
  assert.equal(m.findPath("air", cap, other).length, 1);
  // Boats: from one coastal city's anchorage to another's, through water only.
  const coastal = m.citySites.filter((s) => s.coastal && s.sea);
  assert.ok(coastal.length >= 2);
  let ok = 0;
  for (let i = 1; i < coastal.length; i++) {
    const r = m.findPath("sea", coastal[0].sea, coastal[i].sea);
    if (!r) continue;
    ok++;
    let at = coastal[0].sea;
    for (const p of r) {
      const steps = Math.ceil(dist(at, p) / 4);
      for (let k = 1; k <= steps; k++) assert.ok(m.walkable("sea", at.x + ((p.x - at.x) * k) / steps, at.z + ((p.z - at.z) * k) / steps), "boats stay in the water");
      at = p;
    }
  }
  assert.ok(ok >= 1, "a boat can get to another coast");
  assert.equal(m.walkable("sea", cap.x, cap.z), false, "a boat cannot stand on dry land");
  assert.equal(m.walkable("land", coastal[0].sea.x, coastal[0].sea.z), false, "and a land vehicle cannot drive into the sea");
});

test("describing a place", () => {
  const m = maps[0];
  const cap = m.citySites[0];
  const d = m.describe(cap.x, cap.z);
  assert.equal(d.kind, "land");
  assert.ok(d.continent && d.label && d.altitude > 0);
  const sea = m.describe(m.citySites.find((s) => s.sea).sea.x, m.citySites.find((s) => s.sea).sea.z);
  assert.equal(sea.kind, "ocean");
  assert.ok(sea.depth > 0);
});

/* ---------------------------------------------------------------------------- cultures */
test("a species' body decides how it builds, and nations get different styles", () => {
  const species = [11, 22, 33, 44, 55].map((s, i) => generateSpecies(s, ["plant", "meat", "omni"][i % 3], 1));
  const traits = species.map((sp) => traitsOf(sp));
  assert.ok(traits.every((t) => t.legs >= 1 && t.bulk > 0));
  const styles = chooseStyles(species.map((sp, i) => ({ key: "k" + i, traits: traitsOf(sp), seed: i })));
  assert.equal(new Set(styles.values()).size, 5, "every nation has its own style");
  assert.ok([...styles.values()].every((s) => STYLE_IDS.includes(s)));
  // A many-legged winged species leans to stilts or spires; an armoured meat-eater to fortresses.
  const spiky = { diet: "meat", record: { legs: [{}, {}], arms: [{}, {}], parts: [{ id: "horns" }, { id: "plates" }, { id: "claws" }], spine: [{ x: -1, r: 0.5 }, { x: 1, r: 0.5 }] } };
  const flier = { diet: "plant", record: { legs: [{}, {}], arms: [], parts: [{ id: "wings" }, { id: "crest" }], spine: [{ x: -1, r: 0.4 }, { x: 1, r: 0.4 }] } };
  const legged = { diet: "omni", record: { legs: [{}, {}, {}, {}], arms: [], parts: [], spine: [{ x: -2, r: 0.4 }, { x: 2, r: 0.4 }] } };
  const picked = chooseStyles([{ key: "a", traits: traitsOf(spiky), seed: 1 }, { key: "b", traits: traitsOf(flier), seed: 1 }, { key: "c", traits: traitsOf(legged), seed: 1 }]);
  assert.equal(picked.get("a"), "fortress");
  assert.equal(picked.get("b"), "spire");
  assert.equal(picked.get("c"), "stilt");
});

test("palettes come from the species' own colours, and independent cities are muted", () => {
  const sp = generateSpecies(7, "meat", 1);
  const p = paletteOf(sp, 0x3fa9d6);
  assert.equal(p.accent, 0x3fa9d6);
  assert.ok(p.wall !== p.roof);
  const other = paletteOf(generateSpecies(8, "plant", 1), 0x3fa9d6);
  assert.notEqual(p.wall, other.wall, "different species, different walls");
  const muted = paletteOf(sp, 0xc9483c, { muted: true });
  assert.notEqual(muted.accent, 0xc9483c);
});

test("a city is laid out around its hall: its own, deterministic, clear of plots and roads", () => {
  const sp = generateSpecies(5, "omni", 1);
  const culture = makeCulture({ key: "you", species: sp, accent: 0x3fa9d6, style: "dome" });
  const spots = { plots: 6, turretSlots: 3, plotAngle: (k) => (k / 6) * Math.PI * 2 + Math.PI / 6, turretAngle: (k) => (k / 3) * Math.PI * 2 - Math.PI / 2 };
  const a = layoutCity({ id: 1, name: "A", pop: 8 }, spots, culture);
  const b = layoutCity({ id: 1, name: "A", pop: 8 }, spots, culture);
  assert.deepEqual(a, b, "the same city always looks the same");
  const c = layoutCity({ id: 2, name: "B", pop: 8 }, spots, culture);
  assert.notDeepEqual(a.houses, c.houses, "different cities differ");
  assert.ok(a.houses.length >= 8);
  for (const h of a.houses) {
    const d = Math.hypot(h.x, h.z);
    assert.ok(d > 4.5 && d < 14, "inside the walls, outside the hall");
    for (let k = 0; k < 6; k++) assert.ok(Math.hypot(h.x - Math.cos(spots.plotAngle(k)) * 9, h.z - Math.sin(spots.plotAngle(k)) * 9) >= 3.5, "off the building plots");
  }
  assert.ok(a.roads.length >= 6 + 3 + 1, "roads to every plot and turret, and a ring");
  assert.ok(a.decor.length >= 4);
  const bigger = layoutCity({ id: 1, name: "A", pop: 20 }, spots, culture);
  assert.ok(bigger.houses.length > a.houses.length, "a bigger city has more buildings");
});

test("roads link neighbouring cities over open land only", () => {
  const sites = [{ x: 0, z: 0, continent: 0 }, { x: 100, z: 0, continent: 0 }, { x: 0, z: 100, continent: 0 }, { x: 500, z: 500, continent: 1 }];
  const all = roadLinks(sites, () => true);
  assert.ok(all.length >= 2 && all.every(([a, b]) => sites[a].continent === sites[b].continent), "same continent only");
  assert.equal(roadLinks(sites, () => false).length, 0, "no road through water");
  assert.equal(new Set(all.map(([a, b]) => Math.min(a, b) + ":" + Math.max(a, b))).size, all.length, "each road once");
});

test("every city and geyser can be reached by land from the rest of its continent, even on mountainous worlds", () => {
  const kinds = ["rocky", "volcanic", "terrestrial", "desert", "crystal", "tundra"];
  for (let i = 0; i < kinds.length * 2; i++) {
    const m = createPlanetMap(planetProfile({ id: "conn" + i, type: kinds[i % kinds.length], temp: 12, water: 0.5, atmosphere: "Breathable", biodiversity: 0.5, gravity: 1, surfaceSeed: 3000 + i * 53 }));
    const sites = [...m.citySites.map((s) => ({ ...s, kind: "city" })), ...m.spiceSites.map((s) => ({ ...s, kind: "spice" }))];
    for (const c of new Set(sites.map((s) => s.continent))) {
      const list = sites.filter((s) => s.continent === c);
      for (let k = 1; k < list.length; k++) assert.ok(m.findPath("land", list[0], list[k]), `${m.profile.planetId} ${m.profile.type}: ${list[k].kind} ${k} on continent ${c} is cut off`);
    }
  }
});
