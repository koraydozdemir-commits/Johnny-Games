/* global queueMicrotask, setImmediate */
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

/* ---- The soundtrack in play: every moment the patch list named, with hooks repeating every 0.1 s ---- */

import { mock } from "node:test";
import { createMusic, stageTrack } from "../music.js";

/** A stand-in <audio>: loads at once, plays when asked, and its clock runs with the test's. */
class FakeAudio {
  static all = [];
  static lengths = {};
  constructor() {
    this.attrs = {};
    this.listeners = {};
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.readyState = 0;
    this.volume = 1;
    this.muted = false;
    this.loop = false;
    FakeAudio.all.push(this);
  }
  set src(v) {
    this.attrs.src = v;
    this.readyState = 0;
    this.currentTime = 0;
  }
  get src() {
    return this.attrs.src || "";
  }
  set crossOrigin(v) {
    this.attrs.crossorigin = v;
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  removeEventListener(t, f) {
    this.listeners[t] = (this.listeners[t] || []).filter((g) => g !== f);
  }
  load() {
    const name = decodeURIComponent(this.src.split("/").pop() || "").replace(/\.mp3$/, "");
    this.duration = FakeAudio.lengths[name] ?? 180;
    queueMicrotask(() => {
      this.readyState = 4;
      (this.listeners.canplay || []).slice().forEach((f) => f());
    });
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

/** A music player on a fake clock. `at(t)` runs the game to t seconds, calling `each` every 0.1 s. */
function rig() {
  FakeAudio.all = [];
  globalThis.Audio = FakeAudio;
  let clock = 1000;
  const realPerf = globalThis.performance;
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock * 1000 }, configurable: true, writable: true });
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const music = createMusic({ context: () => null });
  let t = 0;
  const playing = () => {
    const live = FakeAudio.all.filter((a) => !a.paused && !a.muted && a.src.includes(".mp3"));
    return live.map((a) => decodeURIComponent(a.src.split("/").pop()).replace(".mp3", ""));
  };
  return {
    music,
    playing,
    /** The track you'd hear: whichever deck the player counts as current and is playing. */
    heard: () => music.state.decks.filter((d) => d && !d.paused && d.level > 0.5).map((d) => d.id),
    async at(until, each = null) {
      while (t < until - 1e-9) {
        t = +(t + 0.05).toFixed(3);
        clock += 0.05;
        for (const a of FakeAudio.all) if (!a.paused) a.currentTime = Math.min(a.duration || Infinity, a.currentTime + 0.05);
        if (each && Math.round(t * 100) % 10 === 0) each(t);
        mock.timers.tick(50);
        for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
      }
    },
    done() {
      music.dispose();
      mock.timers.reset();
      Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });
      delete globalThis.Audio;
    },
  };
}

test("one track for each moment on screen", () => {
  assert.equal(stageTrack({ stage: "creature", courting: true, atNest: true }), "mating", "courtship beats the nest");
  assert.equal(stageTrack({ stage: "creature", intro: true, atNest: true }), "land", "the crawl-out plays Entering Land");
  assert.equal(stageTrack({ stage: "creature", editor: true, courting: true }), "creature");
  assert.equal(stageTrack({ stage: "creature", founding: true, atNest: true }), "founding");
  assert.equal(stageTrack({ stage: "creature", atNest: true }), "nest");
  assert.equal(stageTrack({ stage: "creature" }), "creature");
  assert.equal(stageTrack({ stage: "cell", mating: true }), "mating", "cell mating has its track");
  assert.equal(stageTrack({ stage: "cell" }), "cell");
  assert.equal(stageTrack({ stage: "civ", danger: true }), "civWar", "closing a menu mid-war gives the war back");
  assert.equal(stageTrack({ stage: "tribe", danger: true }), "tribeWar");
  assert.equal(stageTrack({ stage: "tribe" }), "tribe");
  assert.equal(stageTrack({ menu: true, stage: "civ", danger: true }), "menu");
});

test("a request repeated every 0.1 s still changes the track", async () => {
  const r = rig();
  try {
    r.music.request("creature");
    r.music.unlock();
    await r.at(4);
    assert.deepEqual(r.heard(), ["creature"]);
    await r.at(8, () => r.music.request("nest"));
    assert.deepEqual(r.heard(), ["nest"], "walking up to the nest plays its theme");
    await r.at(12, () => r.music.request("creature"));
    assert.deepEqual(r.heard(), ["creature"], "and leaving it brings roaming back");
  } finally {
    r.done();
  }
});

test("leaving the water plays Entering Land through the crawl-out, then hands over", async () => {
  FakeAudio.lengths = { "Entering Land": 40 };
  const r = rig();
  const moment = { stage: "creature", editor: true, atNest: false, intro: false };
  try {
    r.music.request(stageTrack(moment));
    r.music.unlock();
    await r.at(3, () => r.music.request(stageTrack(moment)));
    // Save the design: the crawl-out begins (main.js asks for the track again on the next HUD tick too).
    Object.assign(moment, { editor: false, intro: true });
    await r.at(10.5, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["land"], "the crawl-out has its track");
    // The 7.5 s crawl-out ends right below the nest.
    Object.assign(moment, { intro: false, atNest: true });
    await r.at(30, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["land"], "the nest doesn't cut it short");
    await r.at(50, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["nest"], "it hands over once it ends");
  } finally {
    FakeAudio.lengths = {};
    r.done();
  }
});

test("courtship keeps the mating track while the nest asks for its own", async () => {
  const r = rig();
  const moment = { stage: "creature", atNest: true, courting: false };
  try {
    r.music.request(stageTrack(moment));
    r.music.unlock();
    await r.at(3, () => r.music.request(stageTrack(moment)));
    moment.courting = true;
    await r.at(12, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["mating"]);
    moment.courting = false;
    await r.at(16, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["nest"]);
  } finally {
    r.done();
  }
});

test("the founding cue isn't cut short by the nest", async () => {
  const r = rig();
  const moment = { stage: "creature", atNest: true, founding: false };
  try {
    r.music.request(stageTrack(moment));
    r.music.unlock();
    await r.at(3, () => r.music.request(stageTrack(moment)));
    moment.founding = true;
    r.music.request("founding", { now: true });
    await r.at(15, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["founding"]);
  } finally {
    r.done();
  }
});

test("Cell Stage mating plays the mating track, then the cell theme returns", async () => {
  const r = rig();
  const moment = { stage: "cell", mating: false };
  try {
    r.music.request(stageTrack(moment));
    r.music.unlock();
    await r.at(3, () => r.music.request(stageTrack(moment)));
    moment.mating = true;
    await r.at(8, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["mating"]);
    moment.mating = false;
    await r.at(13, () => r.music.request(stageTrack(moment)));
    assert.deepEqual(r.heard(), ["cell"]);
  } finally {
    r.done();
  }
});

test("war music survives a trip to the Sporepedia", async () => {
  for (const stage of ["civ", "tribe"]) {
    const r = rig();
    const moment = { stage, danger: true };
    try {
      r.music.request(stageTrack(moment));
      r.music.unlock();
      await r.at(3, () => r.music.request(stageTrack(moment)));
      const war = stage + "War";
      assert.deepEqual(r.heard(), [war]);
      r.music.request("pedia");
      await r.at(8);
      assert.deepEqual(r.heard(), ["pedia"]);
      await r.at(14, () => r.music.request(stageTrack(moment)));
      assert.deepEqual(r.heard(), [war], stage + ": still at war after closing the menu");
    } finally {
      r.done();
    }
  }
});
