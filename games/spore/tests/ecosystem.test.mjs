import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createIsland } from "../creature/world.js";
import { ARCHETYPES, createEcosystem } from "../creature/ecosystem.js";

/** A stripped-down stage: the ecosystem's real decisions, with simple movement and no rendering. */
function sim(region = "coast", opts = {}) {
  const world = createIsland(new THREE.Scene(), "low", region);
  const npcs = new Set();
  const carcasses = [];
  let time = 0;
  const P = { pos: new THREE.Vector3(opts.px ?? 1000, 0, opts.pz ?? 1000), diet: opts.diet || "plant", aggro: 0, scale: 1, deadTimer: 0, target: null, hurt: 0 };
  const body = () => ({ setCrouch() {}, hit() {}, die() {}, setSleep() {} });
  const eco = createEcosystem({
    world,
    regionSeed: 12345,
    wildlife: opts.wildlife || world.region.wildlife,
    quality: "high",
    P,
    npcs,
    carcasses,
    spawnNPC(species, x, z, extra) {
      const n = { species, body: body(), scale: species.scale, maxHealth: species.maxHealth, health: species.maxHealth, pos: new THREE.Vector3(x, 0, z), heading: 0, speed: 0, cool: 0, windUp: 0, stun: 0, ...extra };
      npcs.add(n);
      return n;
    },
    despawnNPC: (n) => npcs.delete(n),
    act() {},
    voice() {},
    pop() {},
    dropCarcass: (x, z, bites) => carcasses.push({ x, z, bites, mesh: null, life: 90 }),
    hurtPlayer: (d) => (P.hurt += d),
    noticeHunter() {},
    noticeScale: () => 1,
    level: () => opts.level || 2,
    isNight: () => !!opts.night,
    now: () => time,
  });
  const step = (dt) => {
    time += dt;
    eco.simulate(dt);
    for (const n of npcs) {
      if (n.dead) continue;
      n.cool = Math.max(0, n.cool - dt);
      const d = Math.hypot(n.pos.x - P.pos.x, n.pos.z - P.pos.z);
      const { want, pace } = eco.think(n, dt, d);
      if (want) {
        const dx = want.x - n.pos.x,
          dz = want.z - n.pos.z,
          dd = Math.hypot(dx, dz);
        if (dd > 0.5) {
          n.heading = Math.atan2(-dz, dx);
          n.speed += (pace - n.speed) * Math.min(1, dt * 3);
        } else n.speed *= 0.8;
      } else n.speed *= 0.8;
      n.pos.x += Math.cos(n.heading) * n.speed * dt;
      n.pos.z -= Math.sin(n.heading) * n.speed * dt;
      const r = world.resolve(n.pos.x, n.pos.z, 0.6 * n.scale);
      n.pos.x = r.x;
      n.pos.z = r.z;
    }
  };
  return { world, eco, npcs, carcasses, P, step, get time() { return time; } };
}

test("each region gets wildlife groups from its own list, spread out on open ground", () => {
  for (const region of ["coast", "forest", "swamp", "badlands", "volcanic"]) {
    const s = sim(region);
    assert.ok(s.eco.groups.length >= 8, region + " has a population");
    const kinds = new Set(s.eco.groups.map((g) => g.arch));
    for (const k of kinds) assert.ok(s.world.region.wildlife.includes(k));
    for (const g of s.eco.groups) {
      assert.ok(s.world.isOpen(g.home.x, g.home.z, 2), "home range on open ground");
      assert.equal(g.species.role, ARCHETYPES[g.arch].role);
    }
  }
});

test("only groups near you have bodies, and never more than the cap", () => {
  const s = sim("coast", { px: 0, pz: 0 });
  s.eco.stream(0, 0, 80);
  const live = [...s.npcs].length;
  assert.ok(live > 0 && live <= 26);
  s.eco.stream(5000, 5000, 80); // walk far away
  assert.equal([...s.npcs].length, 0, "out of range: back to an abstract herd");
});

test("a hungry pack hunts a herd down and the kill feeds the food chain", () => {
  const s = sim("coast", { wildlife: ["grazer", "packHunter"] });
  const herd = s.eco.groups.find((g) => g.arch === "grazer");
  const pack = s.eco.groups.find((g) => g.arch === "packHunter");
  pack.home = pack.pos = { x: herd.home.x + 22, z: herd.home.z };
  pack.waypoint = { ...pack.pos };
  pack.hunger = 1;
  s.P.pos.set(herd.home.x, 0, herd.home.z + 40); // close enough to stream, too far to matter
  s.P.diet = "plant";
  let fled = false,
    hunted = false;
  for (let i = 0; i < 30 * 90 && !s.carcasses.length; i++) {
    if (i % 15 === 0) s.eco.stream(s.P.pos.x, s.P.pos.z, 90);
    s.step(1 / 30);
    for (const n of s.npcs) {
      if (n.wild === herd && n.wb.mode === "flee") fled = true;
      if (n.wild === pack && n.wb.mode === "hunt") hunted = true;
    }
  }
  assert.ok(hunted, "the pack went hunting");
  assert.ok(fled, "the herd ran");
  assert.ok(s.carcasses.length > 0, "a kill within 90 seconds");
  // The pack eats its fill from the carcass.
  for (let i = 0; i < 30 * 40; i++) s.step(1 / 30);
  assert.ok(pack.hunger < 0.5, "fed: " + pack.hunger.toFixed(2));
  // And the fallen grazer comes back in a few minutes.
  const gone = herd.members.find((m) => !m.alive);
  assert.ok(gone && gone.back > s.time);
});

test("herds bed down at night, and timid prey flee from a meat eater", () => {
  const s = sim("coast", { wildlife: ["grazer"], night: true });
  const herd = s.eco.groups[0];
  s.P.pos.set(herd.home.x, 0, herd.home.z + 60);
  s.eco.stream(s.P.pos.x, s.P.pos.z, 90);
  for (let i = 0; i < 60; i++) s.step(1 / 30);
  assert.ok([...s.npcs].every((n) => n.wb.mode === "rest"), "asleep");
  const day = sim("coast", { wildlife: ["smallPrey"], diet: "meat" });
  const prey = day.eco.groups[0];
  day.P.pos.set(prey.home.x + 8, 0, prey.home.z);
  day.eco.stream(day.P.pos.x, day.P.pos.z, 90);
  for (let i = 0; i < 30; i++) day.step(1 / 30);
  assert.ok([...day.npcs].some((n) => n.wb.mode === "flee"), "the meat eater scares them");
});

test("a guardian warns before it charges, and stays near its ground", () => {
  const s = sim("badlands", { wildlife: ["guardian"] });
  const g = s.eco.groups[0];
  s.P.pos.set(g.home.x + 30, 0, g.home.z);
  s.eco.stream(s.P.pos.x, s.P.pos.z, 90);
  s.P.pos.set(g.home.x + 6, 0, g.home.z); // step onto its ground
  const seen = new Set();
  for (let i = 0; i < 30 * 8; i++) {
    s.step(1 / 30);
    for (const n of s.npcs) seen.add(n.wb.mode);
  }
  assert.ok(seen.has("warn"), "a threat display first");
  assert.ok(seen.has("hunt"), "then it comes at you");
  assert.ok(s.P.hurt > 0, "and bites if you stay");
  s.P.pos.set(g.home.x + 200, 0, g.home.z); // you leave
  for (let i = 0; i < 30 * 15; i++) s.step(1 / 30);
  for (const n of s.npcs) assert.ok(Math.hypot(n.pos.x - g.home.x, n.pos.z - g.home.z) < 40, "back on its ground");
});
