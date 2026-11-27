/**
 * The soundtrack. Tracks stream from the R2 bucket (the game bundle stays small) and play through two
 * decks so every change is a crossfade, never a hard cut:
 *  - a new track starts loading on the idle deck while the old one keeps playing, then they cross;
 *  - looping tracks crossfade into themselves near the end, so there's no gap at the seam;
 *  - one-shot cues ("Entering Land") play once and hand over to the stage theme;
 *  - a theme you come back to soon (roaming → nest → roaming) picks up where it left off;
 *  - quick back-and-forth requests (walking in and out of the nest) are smoothed out;
 *  - volume runs through Web Audio, so the music slider works on iPhones too (Safari ignores
 *    HTMLMediaElement.volume), with a fallback to element volume where Web Audio can't be used;
 *  - the music fades out while the page is hidden and back in when it returns.
 * The table and the cue rules are pure and unit tested; createMusic needs a browser.
 */

export const MUSIC_BASE = "https://pub-c7061cceb949469685093ccc3a5dd0ba.r2.dev/";
/**
 * Every track: its file in the bucket, how loud it sits against the others (they were mastered at
 * different levels), whether it loops or plays once and hands over, and whether coming back to it
 * picks up where it left off.
 */
export const TRACKS = {
  menu: { file: "Spore OST/Main Menu.mp3", gain: 0.85, loop: true, resume: true },
  cell: { file: "Spore OST/Cell Stage.mp3", gain: 1, loop: true, resume: true },
  // Plays through the crawl-out and on to its end; arriving at the nest doesn't cut it short either.
  land: { file: "Spore OST/Entering Land.mp3", gain: 1, loop: false, then: "creature", holdFor: ["nest"] },
  creature: { file: "Spore OST/Creature Stage Roaming.mp3", gain: 1, loop: true, resume: true },
  nest: { file: "Spore OST/At Your Nest.mp3", gain: 0.95, loop: true, resume: true },
  mating: { file: "Spore OST/Creature Mating.mp3", gain: 0.95, loop: true },
  // Starts with the Creature → Tribal cutscene and carries it; it hands over to the tribe's theme
  // shortly after the tribe arrives (maxPlay), rather than playing its full two minutes into the stage.
  founding: { file: "Spore OST/Founding A Tribe.mp3", gain: 1, loop: false, then: "tribe", maxPlay: 30 },
  tribe: { file: "Spore OST/Tribal Stage Relaxed.mp3", gain: 0.95, loop: true, resume: true },
  // Danger in the Tribal Stage borrows the war theme.
  tribeWar: { file: "Spore OST/Civilisation War.mp3", gain: 0.9, loop: true, resume: true, minHold: 20 },
  civ: { file: "Spore OST/Civilisation Stage Relaxed.mp3", gain: 0.95, loop: true, resume: true },
  civWar: { file: "Spore OST/Civilisation War.mp3", gain: 0.9, loop: true, resume: true, minHold: 20 },
  pedia: { file: "Spore OST/Sporepedia.mp3", gain: 0.75, loop: true, resume: true },
};
export const FADE = { cross: 2.4, quick: 1.2, loopOverlap: 3.5, settle: 0.9, resumeWithin: 240, loadTimeout: 20, retry: 4 };

/** The URL for a track id (each path segment encoded, so spaces are safe). */
export const trackUrl = (id, base = MUSIC_BASE) => (TRACKS[id] ? base + TRACKS[id].file.split("/").map(encodeURIComponent).join("/") : "");

/**
 * Where a track should start: where it was left if that was recent (and the track resumes), else
 * from the top. Positions near the very end start over.
 */
export function startAt(id, memory, now) {
  const t = TRACKS[id];
  const m = memory?.[id];
  if (!t?.resume || !m || now - m.at > FADE.resumeWithin) return 0;
  if (m.duration && m.pos > m.duration - FADE.loopOverlap - 1) return 0;
  return Math.max(0, m.pos);
}

/**
 * What should be playing after a request, given what is playing. Requests for the track already
 * playing change nothing; a war theme holds for its minimum time; a one-shot that has finished
 * gives way to the track it hands over to.
 * @returns {string|null} the track to play (null = silence)
 */
export function resolveRequest(requested, playing, playingSince, now) {
  if (requested === playing) return playing;
  const cur = TRACKS[playing];
  if (cur?.minHold && now - playingSince < cur.minHold && TRACKS[requested] && !TRACKS[requested].minHold && sameFamily(requested, playing)) return playing;
  return requested || null;
}
/** The calm theme a war theme falls back to. */
const sameFamily = (a, b) => (a === "civ" && b === "civWar") || (a === "tribe" && b === "tribeWar");

/**
 * The one track that fits what is on screen. main.js describes the moment; every hook (nest, courtship,
 * danger, closing a menu) asks this rather than picking a track itself, so they can't contradict each other.
 * @param {{ menu?:boolean, stage?:string, danger?:boolean, mating?:boolean, editor?:boolean, founding?:boolean, intro?:boolean, courting?:boolean, atNest?:boolean }} s
 * @returns {string}
 */
export function stageTrack(s) {
  if (s.menu) return "menu";
  if (s.stage === "civ") return s.danger ? "civWar" : "civ";
  if (s.stage === "tribe") return s.danger ? "tribeWar" : "tribe";
  if (s.stage === "cell") return s.mating ? "mating" : "cell";
  if (s.stage === "creature") {
    if (s.editor) return "creature";
    if (s.founding) return "founding";
    if (s.intro) return "land";
    if (s.courting) return "mating";
    return s.atNest ? "nest" : "creature";
  }
  return "menu";
}

/** A tenth of a second of silence as a WAV data URI: enough to unlock a deck without downloading a track. */
let silence = null;
function SILENCE() {
  if (silence) return silence;
  const n = 800,
    b = new Uint8Array(44 + n * 2),
    v = new DataView(b.buffer);
  const str = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let bin = "";
  b.forEach((x) => (bin += String.fromCharCode(x)));
  return (silence = "data:audio/wav;base64," + btoa(bin));
}

/**
 * @param {{ context: () => AudioContext|null }} o  the game's audio context, once it exists
 */
export function createMusic(o) {
  const decks = [makeDeck(), makeDeck()];
  let active = null; // the deck playing the current track
  let current = null, // track id playing (or loading to play)
    since = 0,
    wanted = null, // the latest request
    settleTimer = null,
    volume = 0.55,
    unlocked = false,
    hidden = typeof document !== "undefined" && document.hidden,
    bus = null,
    webAudio = true;
  const memory = {}; // id -> { pos, duration, at }
  const now = () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000);

  function makeDeck() {
    if (typeof Audio === "undefined") return null;
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    return { el, id: null, gain: null, source: null, level: 0, target: 0, rate: 1, ready: false, cors: true, onEnd: null };
  }
  /** Route a deck through Web Audio (once). Only after the track loaded with CORS, or it would be silent. */
  function route(d) {
    if (!webAudio || d.gain || !d.cors) return;
    const ctx = o.context();
    if (!ctx) return;
    try {
      if (!bus) {
        bus = ctx.createGain();
        bus.gain.value = hidden ? 0 : volume;
        bus.connect(ctx.destination);
      }
      d.source = ctx.createMediaElementSource(d.el);
      d.gain = ctx.createGain();
      d.gain.gain.value = d.level;
      d.source.connect(d.gain).connect(bus);
      d.el.volume = 1;
    } catch (e) {
      webAudio = false; // fall back to element volume for good
    }
  }
  /** The loudness a deck should have right now, through whichever path it uses. */
  function apply(d) {
    const g = TRACKS[d.id]?.gain ?? 1;
    if (d.gain) {
      d.gain.gain.value = d.level * g;
      if (bus) bus.gain.value = hidden ? 0 : volume;
    } else d.el.volume = Math.max(0, Math.min(1, d.level * g * (hidden ? 0 : volume)));
  }

  /** Load a track on a deck, at a position. Resolves when it can play (or fails). */
  function load(d, id, at) {
    return new Promise((resolve) => {
      const url = trackUrl(id);
      d.id = id;
      d.ready = false;
      d.el.loop = false; // looping is done by crossfading into the other deck
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        d.el.removeEventListener("canplay", onReady);
        d.el.removeEventListener("error", onError);
        d.ready = ok;
        resolve(ok);
      };
      const onReady = () => {
        try {
          if (at > 0 && Math.abs(d.el.currentTime - at) > 0.5) d.el.currentTime = at;
        } catch (e) {
          /* not seekable yet: start from the top */
        }
        finish(true);
      };
      const onError = () => {
        // The bucket allows the game's own site. Anywhere else (a preview, a local copy), try again
        // without CORS: it plays, just with element volume instead of Web Audio.
        if (d.cors && !d.gain) {
          d.cors = false;
          d.el.removeAttribute("crossorigin");
          d.el.src = url;
          d.el.load();
          return;
        }
        console.warn("Spore soundtrack could not be loaded:", url);
        finish(false);
      };
      const timer = setTimeout(() => finish(false), FADE.loadTimeout * 1000);
      d.el.addEventListener("canplay", onReady);
      d.el.addEventListener("error", onError);
      if (d.cors) d.el.crossOrigin = "anonymous";
      if (d.el.getAttribute("src") !== url) {
        d.el.src = url;
        d.el.load();
      } else if (d.el.readyState >= 3) return onReady();
      // Start right away, muted: on iOS the play() has to happen inside the tap that unlocked
      // audio, and it starts the download too. It's unmuted once it can play.
      d.el.muted = true;
      const p = d.el.play();
      if (p) p.catch(() => {});
    });
  }
  function remember(d) {
    if (!d?.id || !TRACKS[d.id]?.resume || !d.el.duration) return;
    memory[d.id] = { pos: d.el.currentTime, duration: d.el.duration, at: now() };
  }

  /** Switch to a track: load it on the idle deck while the other keeps playing, then cross. */
  let switchSeq = 0;
  async function switchTo(id, { fade = FADE.cross, from = null, loop = false } = {}) {
    const seq = ++switchSeq;
    if (id !== current) since = now(); // looping into itself doesn't restart the clock
    current = id;
    if (!unlocked || !decks[0]) return;
    const out = active;
    if (!loop && id && out && out.id === id) {
      // Already on the playing deck (e.g. back from a screen before its track had loaded): keep it,
      // bring it back up, and drop whatever was loading on the other deck.
      const other = out === decks[0] ? decks[1] : decks[0];
      if (other.level > 0) fadeDeck(other, 0, FADE.quick, true);
      else other.el.pause();
      fadeDeck(out, 1, FADE.quick);
      if (out.el.paused && !hidden) out.el.play().catch(() => {});
      return;
    }
    if (!id) {
      if (out) fadeDeck(out, 0, FADE.quick, true);
      active = null;
      return;
    }
    const d = out === decks[0] ? decks[1] : decks[0];
    if (d.id && d.level > 0) remember(d);
    d.el.pause();
    d.level = 0;
    const ok = await load(d, id, from ?? startAt(id, memory, now()));
    if (seq !== switchSeq) {
      // A newer request took over while this one loaded: don't leave it running (muted) behind.
      if (d !== active && d.level === 0 && d.id !== current) d.el.pause();
      return;
    }
    if (!ok) return failed(id, d);
    if (d.cors) route(d);
    apply(d);
    d.el.muted = false;
    try {
      await d.el.play();
    } catch (e) {
      // Still locked (iOS waits for a direct gesture): the next unlock() starts it.
      d.el.muted = true;
      stalled = true;
      return;
    }
    if (seq !== switchSeq) return;
    stalled = false;
    if (out && out !== d) {
      remember(out);
      fadeDeck(out, 0, fade, true);
    }
    active = d;
    fadeDeck(d, 1, out ? fade : FADE.quick);
  }
  /**
   * A track couldn't load (slow connection, timeout). Don't leave the old track playing on as if it
   * were the new one: forget the switch, and try again shortly if it's still wanted.
   */
  let retryTimer = null;
  function failed(id, d) {
    d.el.pause();
    d.id = null;
    current = active?.id ?? null;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if ((wanted || null) === id && current !== id) switchTo(id);
    }, FADE.retry * 1000);
  }
  let stalled = false;
  /** Fade a deck to a level over some seconds (pausing it at silence if asked). */
  function fadeDeck(d, level, seconds, pauseAtEnd = false) {
    d.target = level;
    d.rate = Math.abs(level - d.level) / Math.max(0.05, seconds);
    d.pauseAtEnd = pauseAtEnd;
  }

  /* ---- the clock: fades, seamless loops, one-shot hand-overs ------------------------------- */
  let last = now();
  function tick() {
    const t = now(),
      dt = Math.min(0.25, t - last);
    last = t;
    for (const d of decks) {
      if (!d) continue;
      if (d.level !== d.target) {
        const step = d.rate * dt;
        d.level = d.level < d.target ? Math.min(d.target, d.level + step) : Math.max(d.target, d.level - step);
        apply(d);
        if (d.level === 0 && d.pauseAtEnd) {
          d.el.pause();
          d.pauseAtEnd = false;
        }
      }
    }
    const a = active;
    // Only the track that's meant to be playing loops or hands over. If another one is loading to
    // replace it, looping here would cancel that switch and leave the old music on.
    if (a && a.ready && !a.el.paused && a.el.duration > 0 && a.id === current) {
      const left = a.el.duration - a.el.currentTime;
      const tr = TRACKS[a.id];
      if (tr?.loop && left < FADE.loopOverlap && !a.looping) {
        // Cross into itself: the other deck starts from the top as this one fades out.
        a.looping = true;
        memory[a.id] = { pos: 0, duration: a.el.duration, at: t };
        switchTo(a.id, { fade: FADE.loopOverlap * 0.9, from: 0, loop: true }).then(() => (a.looping = false));
      } else if (!tr?.loop && tr?.then && (left < FADE.cross || (tr.maxPlay && t - since > tr.maxPlay)) && !a.handing) {
        // A one-shot hands over to what the game wants now (or its own follow-on theme).
        a.handing = true;
        const next = wanted && wanted !== a.id ? wanted : tr.then;
        wanted = next; // so asking for the cue again later plays it again
        switchTo(next, { fade: FADE.cross * 1.5 }).then(() => (a.handing = false));
      }
    }
  }
  const clock = typeof setInterval !== "undefined" ? setInterval(tick, 50) : null;

  /** Requests settle briefly so flickering triggers (in and out of the nest) don't thrash. */
  function request(id, opts = {}) {
    id = id || null;
    // The same request again (hooks repeat theirs every frame or tenth of a second) changes nothing:
    // restarting the settle wait each time meant the change never happened.
    if (id === wanted && unlocked && !opts.now) return;
    wanted = id;
    clearTimeout(settleTimer);
    const first = (!current && !active) || opts.now;
    const go = () => {
      // A one-shot still playing keeps going if it's asked to hand over to what's wanted now.
      const cue = TRACKS[current];
      if (cue && !cue.loop && active?.id === current && (cue.then === wanted || cue.holdFor?.includes(wanted))) return;
      const next = resolveRequest(wanted, current, since, now());
      if (next !== current || (next && !active)) switchTo(next);
      // A held war theme: look again once the hold is over.
      else if (next !== wanted) settleTimer = setTimeout(go, 2000);
    };
    if (first || !unlocked) go();
    else settleTimer = setTimeout(go, FADE.settle * 1000);
  }

  function onVisibility() {
    hidden = document.hidden;
    for (const d of decks) if (d) apply(d);
    if (hidden) decks.forEach((d) => d && d.el.pause());
    else if (active && unlocked) active.el.play().catch(() => {});
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  return {
    request,
    /** 0..1 */
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      decks.forEach((d) => d && apply(d));
    },
    /** From a user gesture: playback is allowed now. */
    unlock() {
      if (unlocked) {
        if (hidden) return;
        // A track that was refused (iOS wanted a tap) or never started: start it in this tap.
        if (current && (stalled || !active || active.id !== current) && !decks.some((d) => d && d.id === current && !d.ready)) switchTo(current);
        else if (active && active.el.paused) active.el.play().catch(() => {});
        return;
      }
      unlocked = true;
      const id = wanted || current;
      if (id) switchTo(id); // plays the first deck inside this gesture
      // Prime every unused deck in the same gesture, muted, so a track asked for later (the galaxy
      // menu once the universe has loaded, a crossfade) is allowed to start it.
      for (const other of decks) {
        if (!other || other.el.getAttribute("src")) continue;
        other.el.src = SILENCE();
        other.el.muted = true;
        const p = other.el.play();
        if (p)
          p.then(() => {
            if (other !== active && !other.id) other.el.pause();
          }).catch(() => {});
      }
    },
    get state() {
      return {
        current,
        wanted,
        volume,
        webAudio: !!active?.gain,
        decks: decks.map((d) => d && { id: d.id, level: +d.level.toFixed(2), paused: d.el.paused, time: +d.el.currentTime.toFixed(1), cors: d.cors }),
      };
    },
    dispose() {
      clearInterval(clock);
      decks.forEach((d) => d && (d.el.pause(), d.el.removeAttribute("src")));
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
