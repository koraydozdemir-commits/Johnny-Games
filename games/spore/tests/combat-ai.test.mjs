import { test } from "node:test";
import assert from "node:assert/strict";
import { RECOVER_TIME, RETREAT_TIME, STATES, assignPack, chaseLimit, courageOf, decide, dodgeChance, flankPoint, isStuck, outmatched, retreatThreshold } from "../creature/combat-ai.js";

const base = { state: "idle", hostile: false, engaged: false, defending: false, d: 10, reach: 1.5, aggro: 9, hpFrac: 1, courage: 0.7, power: 1, homeD: 4, chaseD: 0, leash: 40, winding: false, backT: 0, incoming: false, dodgeCool: 0, retreated: false, retreatT: 0 };
const run = (o) => decide({ ...base, ...o });

test("every state decide() can return is a documented state", () => {
  const seen = new Set();
  const cases = [{}, { hostile: true }, { hostile: true, d: 1 }, { hostile: true, d: 5 }, { hostile: true, d: 1, winding: true }, { hostile: true, d: 2, backT: 1 }, { hostile: true, engaged: true, hpFrac: 0.05 }, { retreatT: 2 }, { state: "returning", homeD: 20 }, { hostile: true, incoming: true, d: 2 }, { defending: true, d: 6 }, { d: 11 }];
  for (const c of cases) seen.add(run(c).state);
  for (const s of seen) assert.ok(STATES.includes(s), s);
  assert.equal(STATES.length, 9);
  for (const s of ["idle", "alert", "approaching", "engaging", "attacking", "dodging", "defending", "retreating", "returning"]) assert.ok(STATES.includes(s), s);
});

test("a creature that is not in a fight stays idle, and goes alert when you are close", () => {
  assert.equal(run({ d: 40 }).state, "idle");
  assert.equal(run({ d: 11 }).state, "alert");
  assert.equal(run({ d: 11 }).intent, "watch");
});

test("a hostile creature approaches, engages in range, and attacks when winding up", () => {
  assert.equal(run({ hostile: true, d: 7 }).state, "approaching");
  assert.equal(run({ hostile: true, d: 7 }).intent, "approach");
  assert.equal(run({ hostile: true, d: 1.2 }).state, "engaging");
  assert.equal(run({ hostile: true, d: 1.2 }).intent, "strike");
  assert.equal(run({ hostile: true, d: 1.2, winding: true }).state, "attacking");
  // Repositioning after a strike: it circles for a new angle rather than standing or running off.
  assert.deepEqual([run({ hostile: true, d: 2, backT: 0.8 }).state, run({ hostile: true, d: 2, backT: 0.8 }).intent], ["engaging", "circle"]);
});

test("a fight commits: a healthy, evenly matched creature does not run away", () => {
  for (const courage of [0.5, 0.65, 0.8, 1]) for (const hp of [1, 0.8, 0.6, 0.45]) {
    const r = run({ hostile: true, engaged: true, d: 3, courage, hpFrac: hp, power: 1 });
    assert.notEqual(r.state, "retreating", `courage ${courage} at ${hp} health retreated`);
    assert.equal(r.startRetreat, false);
  }
});

test("it retreats only when genuinely low on health, and bolder creatures hold on longer", () => {
  assert.ok(retreatThreshold(0.2) > retreatThreshold(0.5) && retreatThreshold(0.5) > retreatThreshold(0.8) && retreatThreshold(0.8) > retreatThreshold(1));
  assert.ok(retreatThreshold(1) <= 0.1 && retreatThreshold(0.2) < 0.5, "no creature breaks while healthy");
  const timid = run({ hostile: true, engaged: true, d: 3, courage: 0.2, hpFrac: retreatThreshold(0.2) - 0.02 });
  assert.equal(timid.state, "retreating");
  assert.equal(timid.startRetreat, true);
  const brave = run({ hostile: true, engaged: true, d: 3, courage: 1, hpFrac: retreatThreshold(0.2) - 0.02 });
  assert.notEqual(brave.state, "retreating", "an apex creature fights on at a health that sends a timid one home");
});

test("it falls back once per fight, not repeatedly", () => {
  const second = run({ hostile: true, engaged: true, d: 3, courage: 0.3, hpFrac: 0.05, retreated: true });
  assert.notEqual(second.state, "retreating");
  assert.equal(second.startRetreat, false);
});

test("a hopelessly outmatched creature falls back even at full health; a brave one needs a bigger gap", () => {
  assert.equal(outmatched(1, 0.7), false);
  assert.equal(outmatched(2.5, 0.2), true);
  assert.equal(outmatched(2.5, 0.9), false);
  assert.equal(outmatched(6, 0.9), true);
  assert.equal(run({ hostile: true, engaged: true, d: 3, courage: 0.3, hpFrac: 1, power: 3 }).startRetreat, true);
});

test("a retreat is short and bounded, then it walks home and goes quiet", () => {
  assert.ok(RETREAT_TIME[0] >= 2 && RETREAT_TIME[1] <= 6, "retreats last seconds, not minutes");
  assert.ok(RECOVER_TIME >= 5 && RECOVER_TIME <= 15);
  assert.equal(run({ retreatT: 2.5, state: "retreating", hostile: true, d: 3 }).state, "retreating");
  assert.equal(run({ state: "retreating", retreatT: 0, homeD: 25, hostile: false }).state, "returning");
  assert.equal(run({ state: "returning", homeD: 25 }).intent, "return");
  assert.equal(run({ state: "returning", homeD: 3 }).state, "idle", "back in its territory it settles");
});

test("chase boundaries: nobody chases without limit, and bolder fighters go further", () => {
  assert.ok(chaseLimit(1) > chaseLimit(0.2));
  assert.ok(chaseLimit(0.9, { rogue: true }) > chaseLimit(0.9) && chaseLimit(0.9, { epic: true }) >= chaseLimit(0.9, { rogue: true }));
  assert.ok(chaseLimit(1) <= 50 && chaseLimit(1, { epic: true }) <= 80, "finite");
  const far = run({ hostile: true, engaged: true, d: 6, homeD: 60, leash: 40 });
  assert.equal(far.state, "returning");
  const dragged = run({ hostile: true, engaged: true, d: 6, homeD: 10, chaseD: 60, leash: 40 });
  assert.equal(dragged.state, "returning", "it gives up a chase that has taken it too far from where it began");
  assert.equal(run({ hostile: true, engaged: true, d: 6, homeD: 10, chaseD: 5 }).state, "approaching");
});

test("a creature that has lost you walks home instead of standing there", () => {
  assert.equal(run({ hostile: true, engaged: true, d: 30, aggro: 9 }).state, "returning");
});

test("it sidesteps a blow it can see coming, then the dodge is on cooldown", () => {
  assert.equal(run({ hostile: true, d: 1.5, incoming: true }).state, "dodging");
  assert.equal(run({ hostile: true, d: 1.5, incoming: true }).intent, "sidestep");
  assert.notEqual(run({ hostile: true, d: 1.5, incoming: true, dodgeCool: 2 }).state, "dodging");
  assert.equal(dodgeChance(0.7, true), 0, "a staggered creature cannot dodge");
  assert.ok(dodgeChance(1) > dodgeChance(0) && dodgeChance(1) < 0.25, "dodging is occasional, never constant");
});

test("a creature defending a friend commits to the fight", () => {
  const r = run({ hostile: false, defending: true, d: 5 });
  assert.equal(r.state, "defending");
  assert.equal(r.intent, "approach");
  assert.equal(run({ defending: true, d: 1, hostile: false }).state, "defending");
});

test("courage reflects the role: prey is timid, apex fearless, alphas lead", () => {
  const c = (o) => courageOf(o);
  assert.ok(c({ role: "prey" }) < c({ role: "grazer" }) && c({ role: "grazer" }) < c({ role: "standard" }) && c({ role: "standard" }) < c({ role: "predator" }));
  assert.equal(c({ epic: true }), 1);
  assert.ok(c({ rogue: true }) > 0.9);
  assert.ok(c({ role: "standard", alpha: true }) > c({ role: "standard" }));
  assert.ok(c({ role: "standard", brave: 1 }) > c({ role: "standard", brave: 0 }));
  for (const role of ["prey", "grazer", "standard", "kin", "predator", "ambusher", "guardian", "giant"]) assert.ok(c({ role }) >= 0 && c({ role }) <= 1);
});

test("attackers fan out round a target instead of piling onto one point", () => {
  const target = { x: 0, z: 0 };
  const from = { x: 20, z: 0 };
  const pts = [0, 1, 2, 3].map((i) => flankPoint(target, from, i, 4, 3));
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.z) - 3) < 1e-6, "all on the ring");
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > 1.2, "spread out");
  // A lone attacker goes straight in on its own side.
  const solo = flankPoint(target, from, 0, 1, 3);
  assert.ok(solo.x > 2.9 && Math.abs(solo.z) < 1e-6);
});

test("a pack shares out its targets: nearest threat first, at most two on one", () => {
  const members = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 1, z: 0 }, { id: "c", x: 2, z: 0 }, { id: "d", x: 3, z: 0 }];
  const threats = [{ id: "t1", x: 10, z: 0 }, { id: "t2", x: 14, z: 0 }];
  const plan = assignPack(members, threats, 2);
  assert.equal(plan.size, 4);
  const count = (id) => [...plan.values()].filter((v) => v.target.id === id).length;
  assert.ok(count("t1") <= 2 && count("t2") <= 2 && count("t1") + count("t2") === 4, "two and two");
  for (const v of plan.values()) assert.ok(v.slot < v.slots);
  // One threat: everyone helps (nobody is idle just because of the cap).
  const one = assignPack(members, [threats[0]], 2);
  assert.equal([...one.values()].filter((v) => v.target.id === "t1").length, 4);
  assert.equal(assignPack(members, []).size, 0);
});

test("stuck detection: wanting to go far but barely moving", () => {
  assert.equal(isStuck(0.1, 12), true);
  assert.equal(isStuck(3, 12), false);
  assert.equal(isStuck(0.1, 1.5), false, "close to where it wants to be is not stuck");
});

test("a fight plays out: a mid-health brawler engages, and only a long losing fight sends it home once", () => {
  // Simulate the decisions as health drops from 100% to 0, with the fight lasting throughout.
  let state = "idle";
  let retreated = false,
    retreats = 0,
    retreatSeen = false;
  const log = [];
  for (let hp = 1; hp > 0; hp -= 0.04) {
    const r = run({ state, hostile: true, engaged: true, d: 2.5, courage: 0.65, hpFrac: hp, retreated });
    if (r.startRetreat) {
      retreated = true;
      retreats++;
    }
    state = r.state;
    log.push(state);
    if (state === "retreating") retreatSeen = true;
  }
  assert.ok(log.slice(0, 15).every((s) => s !== "retreating"), "no retreat in the first 60% of the fight");
  assert.equal(retreats, 1, "one retreat per fight");
  assert.ok(retreatSeen);
});
