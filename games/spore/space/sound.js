// Small synthesised sounds; no files needed.
let ctx, master, engineGain, engineFilter, engineOsc, noiseBuf, beamGain;
export const sound = {
  muted: false,
  start() {
    if (ctx) return ctx.resume();
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = ctx.createBufferSource();
    loop.buffer = noiseBuf;
    loop.loop = true;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 200;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    loop.connect(engineFilter).connect(engineGain).connect(master);
    loop.start();
    engineOsc = ctx.createOscillator();
    engineOsc.type = "triangle";
    engineOsc.frequency.value = 48;
    engineOsc.connect(engineGain);
    engineOsc.start();
    // A quiet, slow chord under everything.
    const pad = ctx.createGain();
    pad.gain.value = 0.045;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    pad.connect(lp).connect(master);
    [110, 164.8, 220, 246.9, 329.6].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = f * (1 + (i - 2) * 0.0015);
      g.gain.value = 0.2;
      lfo.frequency.value = 0.03 + i * 0.017;
      lg.gain.value = 0.18;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(pad);
      o.start();
      lfo.start();
    });
    beamGain = ctx.createGain();
    beamGain.gain.value = 0;
    beamGain.connect(master);
    const b = ctx.createOscillator(), w = ctx.createOscillator(), wg = ctx.createGain();
    b.frequency.value = 330;
    w.frequency.value = 7;
    wg.gain.value = 60;
    w.connect(wg).connect(b.frequency);
    b.connect(beamGain);
    b.start();
    w.start();
  },
  mute(m) {
    this.muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  },
  engine(v) {
    if (!ctx) return;
    engineGain.gain.setTargetAtTime(0.015 + v * 0.14, ctx.currentTime, 0.1);
    engineFilter.frequency.setTargetAtTime(150 + v * 900, ctx.currentTime, 0.1);
    engineOsc.frequency.setTargetAtTime(40 + v * 70, ctx.currentTime, 0.1);
  },
  beam(on) {
    if (ctx) beamGain.gain.setTargetAtTime(on ? 0.09 : 0, ctx.currentTime, 0.08);
  },
  tone(f0, f1, dur, type = "square", vol = 0.1) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur);
  },
  boom(vol = 0.5) {
    if (!ctx) return;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
    s.buffer = noiseBuf;
    f.type = "lowpass";
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(60, t + 0.8);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + 1);
  },
};
