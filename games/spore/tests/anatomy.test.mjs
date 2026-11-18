import test from "node:test";
import assert from "node:assert/strict";
import { movementOf, bulkOf } from "../creature/anatomy.js";
import { abilitiesOf } from "../creature/parts.js";
import { creaturePartIds, validateCreature } from "../creature/format.js";

const spine = (r) => [-0.9, -0.3, 0.3, 0.9].map((x) => ({ x, y: 0, r }));
const make = (legs, parts = [], r = 0.5, length = 1) =>
  validateCreature({
    name: "Test",
    spine: spine(r),
    legs: Array.from({ length: legs }, (_, i) => ({ t: 0.3 + i * 0.25, length, spread: 0.5, foot: "pads" })),
    parts: parts.map((id) => ({ id, t: 0.5, angle: 1.2, side: 1 })),
    colors: { base: "#88aa66", accent: "#ffcc44", belly: "#eeeecc" },
    pattern: "plain",
  });
const mv = (rec) => movementOf(rec, abilitiesOf(creaturePartIds(rec), rec.legs.length));

test("body plans trade top speed for acceleration", () => {
  const [slug, biped, quad, hexa] = [0, 1, 2, 3].map((n) => mv(make(n)));
  assert.equal(slug.plan, "legless");
  assert.equal(hexa.plan, "hexapod");
  assert.ok(biped.top > quad.top && quad.top > hexa.top && hexa.top > slug.top, "bipeds are fastest");
  assert.ok(hexa.accel > quad.accel && quad.accel > biped.accel, "more legs get going quicker");
  assert.ok(hexa.turn > biped.turn);
});

test("long legs run faster; bulk slows you, hits harder, and gets you noticed", () => {
  const short = mv(make(2, [], 0.5, 0.7)),
    long = mv(make(2, [], 0.5, 1.8));
  assert.ok(long.top > short.top);
  const slim = make(2, [], 0.35),
    fat = make(2, ["shell"], 0.85);
  assert.ok(bulkOf(fat) > bulkOf(slim));
  assert.ok(mv(fat).top < mv(slim).top, "heavy is slow");
  assert.ok(mv(fat).chargeMult > mv(slim).chargeMult, "but charges hard");
  assert.ok(mv(fat).notice > mv(slim).notice, "and is spotted sooner");
});

test("fins, webbing and tentacles swim; ears hear", () => {
  assert.ok(mv(make(2, ["fanFins"])).swim > mv(make(2)).swim);
  assert.ok(mv(make(2, ["tentacles"])).swim > mv(make(2)).swim);
  assert.equal(abilitiesOf(["ears"]).hearing, 4);
  assert.equal(abilitiesOf(["eyes"]).hearing, 1, "everyone hears a little");
});
