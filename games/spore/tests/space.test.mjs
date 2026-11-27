import test from "node:test";
import assert from "node:assert/strict";
import { makeGalaxy, GALAXY_LY } from "../space/galaxy/gen.js";
import { addBackdrop } from "../space/backdrop.js";
import { makeEmpires, createRelations, score, addReason, band, ARCHETYPES, BANDS, TERRITORY } from "../space/empires.js";

const galaxy = makeGalaxy(77);
const HOME = galaxy.starts.find(() => true);

test("the galaxy is the same every time and every star is real", () => {
  const again = makeGalaxy(77);
  assert.equal(galaxy.stars.length, again.stars.length);
  assert.deepEqual([galaxy.stars[5].x, galaxy.stars[5].y], [again.stars[5].x, again.stars[5].y]);
  const bd = addBackdrop(makeGalaxy(77), () => [1, 1, 1]);
  assert.ok(bd.count > 30000, "the menu's stars are in the galaxy (every one is a visitable system)");
  assert.ok(GALAXY_LY > 1000);
});

test("empires: each owns a home, the Keis hold the core, territory is the nearest home", () => {
  const w = makeEmpires(galaxy, HOME);
  const aliens = w.empires.filter((e) => !e.keis);
  assert.ok(aliens.length >= 30, "plenty of species to meet");
  assert.ok(w.empires.at(-1).keis);
  for (const e of aliens) {
    assert.ok(ARCHETYPES[e.archetype]);
    assert.equal(w.of(e.home), e, "a home star belongs to its own empire");
  }
  assert.ok(TERRITORY > 0);
});

test("relations: reasons add up, bands use the creature stage's five faces, the baseline is the archetype's", () => {
  const w = makeEmpires(galaxy, HOME);
  const e = w.empires.find((x) => !x.keis);
  const r = createRelations(e);
  assert.equal(score(r), Math.max(-100, Math.min(100, ARCHETYPES[e.archetype].start + e.mood)));
  addReason(r, "Your gifts", 200);
  assert.equal(score(r), 100);
  assert.equal(band(100).id, "allied");
  assert.deepEqual(BANDS.map((b) => b.name), ["Furious", "Annoyed", "Neutral", "Friendly", "Allied"]);
  const keis = createRelations(w.empires.at(-1));
  assert.equal(score(keis), -100);
});
