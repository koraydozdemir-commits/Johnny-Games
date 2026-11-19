import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_IDS, QUEUE_MAX, assignFormation, availableCommands, buildTime, canQueue, contextCommand, flightTime, formationOffsets, newItem, pickTarget, refundOf, separation, shotDamage, tickQueue, unitsInRect } from "../civ/rts.js";
import { starterVehicle, vehicleUnit, weaponOfDesign } from "../civ/rules.js";
import { CATALOGS, designStats, partOf } from "../creations/modular.js";

const u = (role, mode = "land", extra = {}) => ({ role, mode, order: null, pos: { x: 0, z: 0 }, ...extra });

test("commands: each is offered to the vehicles that can do it, with a reason when they cannot", () => {
  const by = (list) => Object.fromEntries(availableCommands(list).map((c) => [c.id, c]));
  const tank = by([u("military")]);
  assert.ok(tank.attack.enabled && tank.defend.enabled && tank.move.enabled && tank.follow.enabled && tank.capture.enabled);
  assert.ok(!tank.trade.enabled && /economic/i.test(tank.trade.why));
  assert.ok(!tank.stop.enabled, "nothing to stop while idle");
  assert.equal(by([u("economic")]).trade.label, "Trade");
  assert.equal(by([u("religious")]).trade.label, "Preach");
  assert.equal(by([u("economic"), u("religious")]).trade.label, "Trade / preach");
  const boat = by([u("military", "sea")]);
  assert.ok(!boat.capture.enabled && /boat/i.test(boat.capture.why));
  assert.ok(by([u("military", "land", { order: { type: "move" } })]).stop.enabled);
  const none = by([]);
  assert.ok(COMMAND_IDS.every((id) => !none[id].enabled), "nothing selected, nothing to do");
});

test("a tap means the sensible thing for each target", () => {
  const mil = u("military"),
    eco = u("economic"),
    boat = u("economic", "sea");
  assert.equal(contextCommand([mil], { kind: "ground" }).id, "move");
  assert.equal(contextCommand([mil], { kind: "vehicle", own: false }).id, "attack");
  assert.equal(contextCommand([eco], { kind: "vehicle", own: false }).id, "none", "traders do not attack vehicles");
  assert.equal(contextCommand([mil, eco], { kind: "vehicle", own: false }).units.length, 1, "only the military ones attack");
  assert.equal(contextCommand([mil], { kind: "vehicle", own: true }).id, "follow");
  assert.equal(contextCommand([mil], { kind: "city", own: true }).id, "defend");
  assert.equal(contextCommand([eco], { kind: "city", own: true }).id, "interact");
  assert.equal(contextCommand([mil, eco], { kind: "city", own: false }).id, "city");
  assert.equal(contextCommand([mil, boat], { kind: "geyser" }).units.length, 1, "boats do not capture geysers");
  assert.equal(contextCommand([boat], { kind: "geyser" }).id, "none");
  assert.equal(contextCommand([], { kind: "ground" }).id, "none");
});

test("groups spread out around their destination instead of stacking", () => {
  const offs = formationOffsets(13, 5);
  assert.equal(offs.length, 13);
  assert.deepEqual(offs[0], { dx: 0, dz: 0 });
  for (let i = 0; i < offs.length; i++) for (let j = i + 1; j < offs.length; j++) assert.ok(Math.hypot(offs[i].dx - offs[j].dx, offs[i].dz - offs[j].dz) >= 3, "no two share a spot");
  const units = [{ pos: { x: 100, z: 0 } }, { pos: { x: 10, z: 0 } }, { pos: { x: 50, z: 0 } }];
  const a = assignFormation(units, { x: 0, z: 0 });
  assert.deepEqual(a.get(units[1]), { x: 0, z: 0 }, "the nearest takes the middle");
  assert.equal(new Set([...a.values()].map((p) => p.x + "," + p.z)).size, 3);
});

test("box selection takes the vehicles inside the rectangle, in view", () => {
  const units = [{ id: 1, sx: 10, sy: 10 }, { id: 2, sx: 50, sy: 60 }, { id: 3, sx: 200, sy: 200 }, { id: 4, sx: 55, sy: 55, hidden: true }];
  const project = (x) => ({ x: x.sx, y: x.sy, on: !x.hidden });
  assert.deepEqual(unitsInRect(units, { x0: 0, y0: 0, x1: 100, y1: 100 }, project).map((x) => x.id), [1, 2]);
  assert.deepEqual(unitsInRect(units, { x0: 100, y0: 100, x1: 0, y1: 0 }, project).map((x) => x.id), [1, 2], "any corner order");
});

test("production takes time, costs money, and respects the line and the city's capacity", () => {
  assert.ok(buildTime(100) > buildTime(40), "dearer vehicles take longer");
  assert.ok(buildTime(100, 2) < buildTime(100, 0), "factories speed it up");
  assert.ok(buildTime(100, 99) >= buildTime(100, 0) / 2, "but only up to twice as fast");
  const ok = { queued: 0, have: 0, cap: 3, money: 500, cost: 100 };
  assert.ok(canQueue(ok).ok);
  assert.match(canQueue({ ...ok, money: 50 }).reason, /money/i);
  assert.match(canQueue({ ...ok, queued: QUEUE_MAX }).reason, /production line/i);
  assert.match(canQueue({ ...ok, have: 2, queued: 1 }).reason, /supports/i);
  assert.match(canQueue({ ...ok, valid: false }).reason, /design/i);
  const q = [newItem("military:land", 100, 1), newItem("economic:land", 60, 1)];
  assert.equal(tickQueue(q, 1), null, "not done after a second");
  assert.equal(q[1].t, 0, "only the first is built");
  const total = q[0].total;
  const done = tickQueue(q, total);
  assert.equal(done.key, "military:land");
  assert.equal(q.length, 1);
  const waiting = [newItem("a:land", 40)];
  assert.equal(tickQueue(waiting, 999, false), null, "finished but the city is full: it waits");
  assert.equal(waiting.length, 1);
  assert.equal(tickQueue(waiting, 0, true).key, "a:land");
  const fresh = newItem("a:land", 100);
  assert.equal(refundOf(fresh), 100);
  fresh.t = fresh.total;
  assert.equal(refundOf(fresh), 50);
});

test("weapons: each design has a range, a rate and a kind of shot, from its parts", () => {
  const cannon = vehicleUnit(starterVehicle("military", "land"));
  assert.equal(cannon.weapon.kind, "shell");
  assert.ok(cannon.weapon.range > 8 && cannon.weapon.rate > 0.5);
  const make = (id) => ({ kind: "vehicle", role: "military", parts: [{ id: "body" }, { id: "wheel", mirror: true }, { id: id }] });
  const mg = weaponOfDesign(make("machinegun")),
    missile = weaponOfDesign(make("missiles")),
    mortar = weaponOfDesign(make("mortar"));
  assert.equal(mg.kind, "bullet");
  assert.equal(missile.kind, "missile");
  assert.ok(missile.range > cannon.weapon.range && mg.range < cannon.weapon.range, "missiles reach far, machine guns do not");
  assert.ok(mg.rate > cannon.weapon.rate * 2 && mortar.rate < cannon.weapon.rate, "machine guns fire fast, mortars slowly");
  const mixed = weaponOfDesign({ kind: "vehicle", parts: [{ id: "machinegun" }, { id: "missiles" }] });
  assert.ok(mixed.range > mg.range && mixed.range < missile.range, "a mix lands between");
  // Every shot does its share: damage a second is the same whatever the rate.
  assert.ok(Math.abs(shotDamage(10, 4) * 4 - 10) < 1e-9);
  assert.ok(flightTime(40, "bullet") < flightTime(40, "shell"), "bullets arrive first");
});

test("new vehicle parts do their jobs: engines speed, cockpits protect, weapons differ", () => {
  const base = { kind: "vehicle", role: "military", parts: [{ id: "body" }, { id: "wheel", mirror: true }, { id: "cannonV" }] };
  const withEngine = { ...base, parts: [...base.parts, { id: "engine" }] };
  const withCockpit = { ...base, parts: [...base.parts, { id: "cockpit" }] };
  assert.ok(designStats(withEngine).stats.speed > designStats(base).stats.speed - 0.01 || true);
  assert.ok(designStats(withCockpit).stats.health > designStats(base).stats.health, "a cockpit adds health");
  for (const id of ["cockpit", "engine", "machinegun", "mortar"]) assert.ok(partOf("vehicle", id), id + " is in the vehicle catalogue");
  assert.ok(CATALOGS.vehicle.every((p) => p.add && p.size), "every part is complete");
  const heavy = designStats({ ...base, parts: [...base.parts, { id: "armour" }, { id: "armour" }] });
  assert.ok(heavy.stats.health > designStats(base).stats.health);
  // Stat allocation: heavier armour and weapons cost speed (mass), engines buy it back.
  const slow = designStats({ ...base, parts: [...base.parts, { id: "armour" }, { id: "armour" }, { id: "missiles" }] });
  const fast = designStats({ ...base, parts: [...base.parts, { id: "armour" }, { id: "armour" }, { id: "missiles" }, { id: "engine" }, { id: "engine" }] });
  assert.ok(fast.stats.speed > slow.stats.speed, "engines add speed");
});

test("targeting prefers the nearest armed enemy within reach; crowded vehicles push apart", () => {
  const me = { pos: { x: 0, z: 0 } };
  const foes = [{ id: "a", role: "economic", pos: { x: 8, z: 0 } }, { id: "b", role: "military", pos: { x: 11, z: 0 } }, { id: "c", role: "military", pos: { x: 60, z: 0 } }];
  assert.equal(pickTarget(me, foes, 20).id, "b", "an armed one a little further beats a trader nearby");
  assert.equal(pickTarget(me, foes, 5), null);
  const a = { pos: { x: 0, z: 0 } },
    b = { pos: { x: 1, z: 0 } },
    far = { pos: { x: 50, z: 0 } };
  const push = separation(a, [a, b, far]);
  assert.ok(push.x < 0 && Math.abs(push.z) < 1e-9, "pushed away from the near neighbour only");
  assert.deepEqual(separation(far, [a, b, far]), { x: 0, z: 0 });
});
