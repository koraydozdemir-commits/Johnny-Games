import { test } from "node:test";
import assert from "node:assert/strict";
import { R, arc, createPlanet, frameAt, fromLatLon, offsetDir, seedOf, step, towards } from "../civ/planet.js";

const len = (v) => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const PLANETS = ["region:coast", "region:forest", "planet:42", "planet:7"].map((n) => createPlanet(seedOf(n)));

test("surface coordinates: frames are orthonormal, offsets and steps move the right distance", () => {
  for (const d of [fromLatLon(0.3, 1.2), fromLatLon(-1.2, -2), fromLatLon(1.55, 0)]) {
    const f = frameAt(d);
    for (const v of [f.up, f.east, f.north]) assert.ok(Math.abs(len(v) - 1) < 1e-9);
    assert.ok(Math.abs(dot(f.up, f.east)) < 1e-9 && Math.abs(dot(f.up, f.north)) < 1e-9 && Math.abs(dot(f.east, f.north)) < 1e-9);
    const e = offsetDir(d, 10, 0, f);
    assert.ok(Math.abs(arc(d, e) - 10) < 0.05, "10 units east is ~10 units of arc");
    assert.ok(dot(towards(d, e), f.east) > 0.99);
    const s = step(d, f.north, 25);
    assert.ok(Math.abs(arc(d, s.d) - 25) < 1e-6);
    assert.ok(Math.abs(dot(s.fwd, s.d)) < 1e-9, "the heading stays tangent after a step");
  }
});

test("the same seed makes the same planet; different seeds differ", () => {
  const a = createPlanet(seedOf("planet:42")),
    b = PLANETS[2];
  const d = fromLatLon(0.4, 0.9);
  assert.equal(a.rawHeight(d), b.rawHeight(d));
  assert.notEqual(PLANETS[0].rawHeight(d), PLANETS[1].rawHeight(d));
});

test("every planet has continents and oceans, and room for eleven cities apart from each other", () => {
  for (const P of PLANETS) {
    const land = P.nav.land.reduce((s, x) => s + x, 0) / P.nav.count;
    assert.ok(land > 0.18 && land < 0.45, "land share " + land);
    const sites = P.citySites(11, 3);
    assert.equal(sites.length, 11);
    for (const s of sites) assert.ok(P.isLand(s.d), "cities stand on land");
    // A few cities share your continent; others are overseas.
    assert.ok(sites.filter((s) => s.landmass === sites[0].landmass).length >= 3);
    assert.ok(sites.some((s) => s.landmass !== sites[0].landmass));
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) assert.ok(arc(sites[i].d, sites[j].d) > 40, "cities stand apart");
    for (const s of sites.filter((x) => x.coastal)) assert.ok(s.anchor && !P.isLand(s.anchor), "a coastal city has a harbour at sea");
    assert.equal(P.spiceSites(sites, 12).length, 12);
  }
});

test("routes: land stays on land, can't cross the sea; air flies straight; sea stays at sea", () => {
  for (const P of PLANETS) {
    const sites = P.citySites(11, 3);
    const home = sites.filter((s) => s.landmass === sites[0].landmass);
    const r = P.route("land", home[0].d, home[1].d);
    assert.ok(r && r.length >= 1);
    for (const d of r.slice(0, -1)) assert.ok(P.rawHeight(d) > 0, "land route over land");
    const far = sites.find((s) => s.landmass !== sites[0].landmass);
    assert.equal(P.route("land", sites[0].d, far.d), null);
    assert.deepEqual(P.route("air", sites[0].d, far.d), [far.d]);
    const ports = sites.filter((s) => s.coastal);
    const pair = ports.find((p) => p !== ports[0] && p.ocean === ports[0].ocean);
    if (pair) {
      const sr = P.route("sea", ports[0].anchor, pair.anchor);
      assert.ok(sr);
      for (const d of sr.slice(0, -1)) assert.ok(!P.isLand(d), "sea route over water");
    }
  }
});

test("flattening makes level ground for a city", () => {
  const P = createPlanet(seedOf("planet:7"));
  const s = P.citySites(11, 3)[0];
  P.flatten(s.d, 23);
  const h0 = P.height(s.d);
  for (const [x, z] of [[10, 0], [0, -15], [-12, 8]]) assert.ok(Math.abs(P.height(offsetDir(s.d, x, z)) - h0) < 0.6);
  assert.ok(R > 100);
});

test("harbours stay open water once the cities are built", () => {
  for (const name of ["region:coast", "planet:42", "planet:977"]) {
    const P = createPlanet(seedOf(name));
    const sites = P.citySites(11, 3);
    for (const s of sites) P.flatten(s.d, 23);
    for (const s of sites.filter((x) => x.coastal)) assert.ok(P.height(s.anchor) < -0.3, name + ": harbour of city at " + JSON.stringify(s.d) + " is " + P.height(s.anchor));
  }
});
