import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGS, ROLES, STARTER_DESIGNS, designStats, partOf, vehicleMode } from "../creations/modular.js";
import { validateModular } from "../creations/format.js";

test("catalogs are well formed and every role has a starter design", () => {
  for (const [kind, list] of Object.entries(CATALOGS)) {
    const ids = new Set();
    for (const p of list) {
      assert.ok(!ids.has(p.id), "unique id " + p.id);
      ids.add(p.id);
      assert.equal(p.size.length, 3);
      assert.ok(["base", "accent", "trim", "glass", "metal"].includes(p.paint), p.id);
      assert.equal(partOf(kind, p.id), p);
    }
  }
  for (const kind of ["building", "vehicle"])
    for (const role of Object.keys(ROLES[kind])) {
      const d = STARTER_DESIGNS[kind][role];
      assert.ok(d, kind + " " + role);
      const r = designStats(validateModular(d, kind));
      assert.equal(r.ok, true, kind + " " + role + ": " + r.problems.join(" "));
    }
  assert.equal(designStats(STARTER_DESIGNS.ship.explorer).ok, true);
});

test("design changes the numbers: armour, engines, propulsion", () => {
  const tank = STARTER_DESIGNS.vehicle.military;
  const base = designStats(tank);
  const armoured = designStats({ ...tank, parts: [...tank.parts, { id: "armour", x: 0, y: 1, z: -0.5 }, { id: "armour", x: 0, y: 1.2, z: 0.5 }] });
  assert.ok(armoured.stats.health > base.stats.health, "armour adds health");
  assert.ok(armoured.stats.speed < base.stats.speed, "and costs speed");
  const gunned = designStats({ ...tank, parts: [...tank.parts, { id: "missiles", x: 0, y: 1.3, z: -0.6 }] });
  assert.ok(gunned.stats.power > base.stats.power && gunned.cost > base.cost, "more weapons, more power, more cost");
  assert.equal(vehicleMode(tank), "land");
  assert.equal(vehicleMode({ kind: "vehicle", parts: [{ id: "hull" }, { id: "propeller" }] }), "sea");
  assert.equal(vehicleMode({ kind: "vehicle", parts: [{ id: "fuselage" }, { id: "wingPart", mirror: true }, { id: "jet" }] }), "air");
  const plane = designStats({ kind: "vehicle", role: "military", parts: [{ id: "fuselage" }, { id: "wingPart", mirror: true }, { id: "jet" }, { id: "cannonV" }] });
  assert.ok(plane.cost > base.cost, "aircraft cost more");
});

test("bad designs say what's missing", () => {
  const p = (role, parts) => designStats({ kind: "vehicle", role, parts }).problems.join(" ");
  assert.match(p("military", [{ id: "wheel" }]), /chassis/);
  assert.match(p("military", [{ id: "body" }]), /move with/);
  assert.match(p("economic", [{ id: "body" }, { id: "wheel" }]), /cargo/);
  assert.match(p("religious", [{ id: "body" }, { id: "wheel" }, { id: "cannonV" }]), /loudspeaker/);
  assert.match(designStats({ kind: "building", role: "turret", parts: [{ id: "tower" }] }).problems.join(), /cannon/);
  assert.match(designStats({ kind: "building", role: "house", parts: [{ id: "roof" }] }).problems.join(), /body part/);
  assert.match(designStats({ kind: "ship", parts: [{ id: "laser" }] }).problems.join(), /hull/);
});
