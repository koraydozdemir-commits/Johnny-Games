/**
 * Procedural effects and ambience for both stages, plus streamed stage music.
 * Sound effects stay synthesised with Web Audio; the soundtrack streams from R2 so large MP3s
 * are not bundled into the game or the GitHub repository.
 */

const rand = (a, b) => a + Math.random() * (b - a);

const MUSIC_BASE = "https://pub-c7061cceb949469685093ccc3a5dd0ba.r2.dev/";
const MUSIC_FILES = {
  menu: "Spore OST/Main Menu.mp3",
  cell: "Spore OST/Cell Stage.mp3",
  creature: "Spore OST/Creature Stage Roaming.mp3",
  mating: "Spore OST/Creature Mating.mp3",
  land: "Spore OST/Entering Land.mp3",
  tribe: "Spore OST/Tribal Stage Relaxed.mp3",
  nest: "Spore OST/At Your Nest.mp3",
  civ: "Spore OST/Civilisation Stage Relaxed.mp3",
  civWar: "Spore OST/Civilisation War.mp3",
  pedia: "Spore OST/Sporepedia.mp3",
};

export function createAudio() {
  let ctx = null,
    master = null,
    sfxBus = null, // effects and voices
    ambBus = null, // ambience
    volume = { sfx: 1, ambience: 1 },
    enabled = true,
    noiseBuf = null,
    ambient = null,
    ambientKind = null,
    musicElement = null,
    musicTrack = null,
    musicVolume = 0.55,
    musicUnlocked = false;

  function ensure() {
    if (!enabled) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      // A gentle compressor keeps stacked sounds from clipping on phone speakers.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      // Separate volume controls for effects and ambience.
      sfxBus = ctx.createGain();
      ambBus = ctx.createGain();
      sfxBus.gain.value = volume.sfx;
      ambBus.gain.value = volume.ambience;
      sfxBus.connect(master);
      ambBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function ensureMusic() {
    if (musicElement) return musicElement;
    if (typeof Audio === "undefined") return null;
    musicElement = new Audio();
    musicElement.preload = "none";
    musicElement.loop = true;
    musicElement.volume = musicVolume;
    musicElement.crossOrigin = "anonymous";
    musicElement.addEventListener("error", () => {
      // Music is optional: a missing or temporarily unavailable track must never stop the game.
      console.warn("Spore soundtrack could not be loaded:", musicTrack);
    });
    return musicElement;
  }
  function startMusic() {
    const el = ensureMusic();
    if (!el || !musicUnlocked || !musicTrack) return;
    if (el.src !== musicTrack) {
      el.src = musicTrack;
      el.load();
    }
    if (el.paused) el.play().catch(() => {
      // iOS/Safari may still require a later direct user gesture.
    });
  }
  function setMusic(kind) {
    const file = MUSIC_FILES[kind];
    const next = file ? MUSIC_BASE + file.split("/").map(encodeURIComponent).join("/") : "";
    if (next === musicTrack) {
      startMusic();
      return;
    }
    musicTrack = next;
    const el = ensureMusic();
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    if (next) startMusic();
  }

  /* ---- building blocks ---- */
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(type, f0, f1, t, dur, peak, dest = sfxBus) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, Math.min(0.02, dur * 0.2), peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, peak, filterType, f0, f1 = f0, q = 1, dest = sfxBus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rand(0.8, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, Math.min(0.01, dur * 0.2), peak, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand(0, 1.5));
    src.stop(t + dur + 0.05);
  }
  /** A creature "voice": a buzzy source through two vowel formants, gliding in pitch. */
  function voice(t, f0, f1, dur, peak, vowel = 0) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const vib = ctx.createOscillator(),
      vg = ctx.createGain();
    vib.frequency.value = rand(5, 8);
    vg.gain.value = f0 * 0.03;
    vib.connect(vg).connect(o.frequency);
    const out = ctx.createGain();
    env(out, t, 0.03, peak, dur);
    const formants = [
      [700, 1150],
      [400, 2000],
      [300, 870],
      [600, 1000],
    ][vowel % 4];
    for (const [i, fq] of formants.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = fq;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0.5;
      o.connect(bp).connect(g).connect(out);
    }
    out.connect(sfxBus);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }
  const bell = (t, f, peak = 0.05, dur = 0.5) => {
    tone("sine", f, f, t, dur, peak);
    tone("sine", f * 2.76, f * 2.76, t, dur * 0.4, peak * 0.3);
  };

  /* ---- the sounds ---- */
  const SOUNDS = {
    click: (t) => tone("triangle", 520, 420, t, 0.06, 0.04),
    // Cell stage
    eat: (t) => {
      noise(t, 0.09, 0.08, "bandpass", 900, 300, 4);
      tone("sine", rand(380, 460), rand(700, 820), t + 0.02, 0.09, 0.07);
    },
    bite: (t) => {
      noise(t, 0.07, 0.12, "highpass", 2500, 1200, 0.7);
      tone("square", 140, 70, t, 0.08, 0.05);
    },
    damage: (t) => {
      noise(t, 0.16, 0.12, "lowpass", 1400, 300, 2);
      tone("sawtooth", 220, 90, t, 0.18, 0.05);
    },
    jet: (t) => {
      noise(t, 0.45, 0.13, "bandpass", 300, 1800, 1.2);
      tone("sine", 90, 50, t, 0.3, 0.08);
    },
    meteor: (t) => [660, 990, 1320].forEach((f, i) => bell(t + i * 0.07, f, 0.045)),
    unlock: (t) => [523, 659, 784, 1046].forEach((f, i) => bell(t + i * 0.06, f, 0.04, 0.35)),
    mate: (t) => {
      voice(t, 420, 620, 0.35, 0.06, 3);
      voice(t + 0.3, 560, 760, 0.4, 0.05, 1);
    },
    hatch: (t) => {
      noise(t, 0.06, 0.1, "bandpass", 1200, 1200, 3);
      [392, 523, 659].forEach((f, i) => bell(t + 0.05 + i * 0.08, f, 0.045));
    },
    death: (t) => {
      tone("sawtooth", 300, 60, t, 0.7, 0.05);
      noise(t, 0.5, 0.06, "lowpass", 800, 120, 1);
    },
    bubble: (t) => tone("sine", rand(500, 900), rand(1200, 1700), t, 0.05, 0.025),
    // Creature stage: abilities (pitch: 1 = medium creature, lower for big ones)
    sing: (t, o) => {
      const p = o.pitch;
      const notes = [1, 1.25, 1.5, 1.33].map((k) => 300 * p * k);
      notes.forEach((f, i) => voice(t + i * 0.18, f, f * rand(0.98, 1.06), 0.22, 0.06 * o.gain, i));
    },
    dance: (t, o) => {
      for (let i = 0; i < 4; i++) {
        tone("sine", 120 * o.pitch, 55, t + i * 0.16, 0.12, 0.09 * o.gain);
        if (i % 2) noise(t + i * 0.16, 0.05, 0.06 * o.gain, "highpass", 3000, 3000, 1);
      }
    },
    charm: (t, o) => {
      voice(t, 340 * o.pitch, 480 * o.pitch, 0.3, 0.05 * o.gain, 2);
      voice(t + 0.28, 480 * o.pitch, 380 * o.pitch, 0.35, 0.045 * o.gain, 2);
    },
    pose: (t, o) => {
      [1568, 2093, 2637].forEach((f, i) => bell(t + i * 0.05, f * Math.sqrt(o.pitch), 0.025 * o.gain, 0.4));
      noise(t, 0.3, 0.03 * o.gain, "highpass", 5000, 8000, 1);
    },
    strike: (t, o) => {
      noise(t, 0.12, 0.1 * o.gain, "bandpass", 3000, 800, 1.5);
      tone("sine", 160 * o.pitch, 70, t + 0.08, 0.1, 0.09 * o.gain);
    },
    charge: (t, o) => {
      voice(t, 180 * o.pitch, 110 * o.pitch, 0.5, 0.08 * o.gain, 0);
      for (let i = 0; i < 4; i++) tone("sine", 90, 45, t + 0.05 + i * 0.11, 0.09, 0.08 * o.gain);
    },
    spit: (t, o) => {
      noise(t, 0.1, 0.1 * o.gain, "bandpass", 1400, 600, 3);
      tone("sine", 500 * o.pitch, 200, t + 0.03, 0.08, 0.05 * o.gain);
    },
    creatureBite: (t, o) => {
      noise(t, 0.06, 0.12 * o.gain, "highpass", 2200, 1000, 0.8);
      tone("square", 120 * o.pitch, 60, t + 0.02, 0.07, 0.06 * o.gain);
    },
    step: (t, o) => noise(t, 0.07, 0.04 * o.gain, "lowpass", 300 * o.pitch + 80, 120, 1),
    splash: (t) => noise(t, 0.25, 0.07, "bandpass", 1500, 500, 0.8),
    roar: (t) => {
      voice(t, 90, 55, 1.4, 0.12, 0);
      noise(t, 1.2, 0.1, "lowpass", 500, 120, 1);
    },
    friend: (t) => {
      voice(t, 520, 700, 0.18, 0.05, 1);
      [784, 988, 1175].forEach((f, i) => bell(t + 0.15 + i * 0.07, f, 0.035));
    },
    snub: (t) => voice(t, 300, 200, 0.4, 0.05, 2),
    dig: (t) => {
      noise(t, 0.1, 0.06, "lowpass", 900, 300, 1);
      noise(t + 0.06, 0.05, 0.03, "bandpass", 2000, 2000, 2);
    },
    // Sneaking: a soft hush down; standing up again: a little rise.
    sneak: (t) => {
      noise(t, 0.35, 0.035, "lowpass", 1400, 300, 1);
      tone("sine", 330, 220, t, 0.25, 0.03);
    },
    unsneak: (t) => tone("sine", 220, 330, t, 0.18, 0.03),
    jump: (t, o) => {
      tone("sine", 260 * o.pitch, 620 * o.pitch, t, 0.16, 0.06);
      noise(t, 0.08, 0.03, "lowpass", 600, 300, 1);
    },
    land: (t, o) => {
      tone("sine", 110 * o.pitch, 50, t, 0.14, 0.09);
      noise(t, 0.1, 0.05, "lowpass", 500, 150, 1);
    },
    glide: (t) => {
      noise(t, 0.6, 0.05, "bandpass", 500, 1600, 0.9);
      tone("sine", 700, 900, t + 0.05, 0.3, 0.02);
    },
    ambush: (t) => {
      noise(t, 0.15, 0.13, "highpass", 3200, 900, 0.8);
      tone("square", 200, 60, t + 0.02, 0.2, 0.07);
      tone("sine", 70, 40, t + 0.04, 0.3, 0.1);
    },
    // A deep, rising rumble: something huge is coming (the cell stage's epic).
    looming: (t) => {
      tone("sawtooth", 45, 70, t, 1.6, 0.06);
      noise(t, 1.6, 0.07, "lowpass", 200, 600, 1.5);
      voice(t + 0.6, 70, 50, 1.1, 0.08, 0);
    },
    // Tribe: a horn call, an axe blow, a hut going up.
    horn: (t, o) => {
      tone("sawtooth", 196 * o.pitch, 262 * o.pitch, t, 0.5, 0.045);
      tone("triangle", 392 * o.pitch, 392 * o.pitch, t + 0.08, 0.45, 0.03);
    },
    chop: (t) => {
      noise(t, 0.07, 0.09, "bandpass", 1800, 700, 1.2);
      tone("triangle", 160, 80, t, 0.1, 0.06);
    },
    build: (t) => {
      [0, 0.14, 0.28].forEach((d) => noise(t + d, 0.06, 0.08, "bandpass", 900, 500, 2));
      bell(t + 0.42, 660, 0.05, 0.5);
    },
    // Growing a stage: a slow, rising swell of bells.
    growth: (t) => {
      noise(t, 1.8, 0.04, "bandpass", 300, 1400, 0.8);
      [262, 330, 392, 523, 659].forEach((f, i) => bell(t + 0.25 + i * 0.22, f, 0.04, 0.9));
    },
    shard: (t) => [880, 1175, 1568, 2093].forEach((f, i) => bell(t + i * 0.08, f, 0.05, 0.6)),
  };

  /* ---- ambience ---- */
  function startAmbient(kind) {
    stopAmbient();
    if (!ensure()) return;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(kind === "cell" ? 0.05 : 0.045, t + 2);
    bus.connect(ambBus);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = kind === "cell" ? 380 : 700;
    // Slow swell: underwater hush in the soup, waves breaking on the island.
    const lfo = ctx.createOscillator(),
      lg = ctx.createGain(),
      swell = ctx.createGain();
    lfo.frequency.value = kind === "cell" ? 0.08 : 0.12;
    lg.gain.value = 0.5;
    swell.gain.value = 0.6;
    lfo.connect(lg).connect(swell.gain);
    src.connect(f).connect(swell).connect(bus);
    src.start();
    lfo.start();
    const drone = kind === "cell" ? tone("sine", 55, 55, t, 1e5, 0.0001, bus) : null;
    if (drone) {
      const dg = ctx.createGain();
      dg.gain.value = 0.25;
      drone.disconnect();
      drone.connect(dg).connect(bus);
    }
    // Occasional bubbles underwater, birdsong on land.
    const timer = setInterval(
      () => {
        if (!enabled || !ctx) return;
        const now = ctx.currentTime;
        if (kind === "cell") tone("sine", rand(500, 900), rand(1200, 1700), now, 0.05, 0.025, ambBus);
        else if (Math.random() < 0.7) {
          const f = rand(2200, 3400);
          for (let i = 0; i < 3; i++) tone("sine", f, f * rand(1.1, 1.4), now + i * 0.11, 0.07, 0.012, ambBus);
        }
      },
      kind === "cell" ? 2600 : 4200,
    );
    ambient = { bus, src, lfo, drone, timer };
  }
  function stopAmbient() {
    if (!ambient) return;
    const a = ambient;
    ambient = null;
    clearInterval(a.timer);
    try {
      const t = ctx.currentTime;
      a.bus.gain.cancelScheduledValues(t);
      a.bus.gain.setValueAtTime(a.bus.gain.value, t);
      a.bus.gain.linearRampToValueAtTime(0.0001, t + 0.8);
      setTimeout(() => {
        a.src.stop();
        a.lfo.stop();
        a.drone?.stop();
        a.bus.disconnect();
      }, 900);
    } catch (e) {
      /* already stopped */
    }
  }

  return {
    /**
     * @param {string} kind
     * @param {{ pitch?: number, gain?: number }} [opts] pitch 1 = medium creature; gain scales loudness
     */
    play(kind, opts = {}) {
      if (!ensure()) return;
      const fn = SOUNDS[kind] || SOUNDS.click;
      try {
        fn(ctx.currentTime + 0.005, { pitch: opts.pitch ?? 1, gain: opts.gain ?? 1 });
      } catch (e) {
        /* audio is decoration */
      }
    },
    /** "cell", "land" or null. Takes effect on the next user gesture if audio is still locked. */
    setAmbient(kind) {
      ambientKind = kind;
      if (!enabled || !ctx) return;
      if (kind) startAmbient(kind);
      else stopAmbient();
    },
    /** Volumes 0..1 for effects and for ambience. */
    setVolume(v) {
      volume = { sfx: Math.max(0, Math.min(1, v.sfx ?? volume.sfx)), ambience: Math.max(0, Math.min(1, v.ambience ?? volume.ambience)) };
      if (!ctx) return;
      const t = ctx.currentTime;
      sfxBus.gain.setTargetAtTime(volume.sfx, t, 0.05);
      ambBus.gain.setTargetAtTime(volume.ambience, t, 0.05);
    },
    setEnabled(on) {
      enabled = on;
      if (!on) stopAmbient();
      else if (ambientKind) startAmbient(ambientKind);
    },
    /** Background soundtrack, hosted in R2 so the game bundle stays small. */
    setMusic,
    setMusicVolume(value) {
      musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
      const el = ensureMusic();
      if (el) el.volume = musicVolume;
    },
    /** Call from a user gesture to unlock audio and start pending ambience/music. */
    unlock() {
      ensure();
      musicUnlocked = true;
      if (ctx && ambientKind && !ambient) startAmbient(ambientKind);
      startMusic();
    },
  };
}
