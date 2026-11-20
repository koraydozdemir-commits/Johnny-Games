import { test } from "node:test";
import assert from "node:assert/strict";
import { FADE, MUSIC_BASE, TRACKS, resolveRequest, startAt, trackUrl } from "../music.js";

test("every track has a file in the bucket and one-shots hand over to a real track", () => {
  for (const [id, t] of Object.entries(TRACKS)) {
    assert.ok(/^Spore OST\/.+\.mp3$/.test(t.file), id);
    assert.ok(t.gain > 0 && t.gain <= 1, id);
    if (!t.loop) assert.ok(TRACKS[t.then], id + " hands over");
  }
  // The ten files actually in the bucket (listed from R2, Nov 2026).
  const inBucket = ["At Your Nest", "Cell Stage", "Civilisation Stage Relaxed", "Civilisation War", "Creature Mating", "Creature Stage Roaming", "Entering Land", "Founding A Tribe", "Main Menu", "Sporepedia", "Tribal Stage Relaxed"].map((n) => "Spore OST/" + n + ".mp3");
  for (const t of Object.values(TRACKS)) assert.ok(inBucket.includes(t.file), t.file);
});

test("track URLs are encoded per segment", () => {
  assert.equal(trackUrl("nest"), MUSIC_BASE + "Spore%20OST/At%20Your%20Nest.mp3");
  assert.equal(trackUrl("nope"), "");
});

test("themes pick up where they left off, if it was recent", () => {
  const mem = { creature: { pos: 42, duration: 200, at: 100 }, mating: { pos: 30, duration: 60, at: 100 } };
  assert.equal(startAt("creature", mem, 130), 42);
  assert.equal(startAt("creature", mem, 100 + FADE.resumeWithin + 1), 0, "too long ago");
  assert.equal(startAt("mating", mem, 110), 0, "courtship always starts fresh");
  assert.equal(startAt("creature", { creature: { pos: 198, duration: 200, at: 100 } }, 101), 0, "near the end starts over");
  assert.equal(startAt("nest", {}, 5), 0);
});

test("war themes hold a while before the calm one returns", () => {
  assert.equal(resolveRequest("civ", "civWar", 100, 105), "civWar");
  assert.equal(resolveRequest("civ", "civWar", 100, 125), "civ");
  assert.equal(resolveRequest("tribe", "tribeWar", 0, 3), "tribeWar");
  assert.equal(resolveRequest("menu", "tribeWar", 0, 3), "menu", "leaving the stage isn't held up");
  assert.equal(resolveRequest("creature", "creature", 0, 1), "creature");
  assert.equal(resolveRequest(null, "cell", 0, 1), null);
});
