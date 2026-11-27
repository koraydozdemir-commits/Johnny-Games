// Alien speech and the space music, streamed from the game's sound bucket.
const BASE = "https://pub-c7061cceb949469685093ccc3a5dd0ba.r2.dev/Spore%20OST/";
const url = (n) => BASE + encodeURIComponent(n + ".mp3");
// Archetypes with no recording of their own borrow the closest one.
const VOICE = { Bard: "Bard Voice", Diplomat: "Diplomat Voice", Scientist: "Scientist Voice", Trader: "Trader Voice", Zealot: "Zealot Voice", Keis: "Keis Voice",
  Ecologist: "Scientist Voice", Explorer: "Trader Voice", Knight: "Diplomat Voice", Shaman: "Bard Voice", Warrior: "Zealot Voice" };
const els = {};
const get = (name) => (els[name] ||= Object.assign(new Audio(url(name)), { preload: "auto" }));
let cur = null, fadeT = 0;

/** Speak a line: a stretch of the archetype's voice as long as the text suggests. Returns the seconds it will last. */
export function speak(archetype, text, seed = 0) {
  stopSpeech();
  const name = VOICE[archetype] || "Diplomat Voice";
  const sec = Math.max(1.3, Math.min(6, text.length * 0.055));
  const a = get(name);
  cur = a;
  const begin = () => {
    const d = a.duration && isFinite(a.duration) ? a.duration : 40;
    a.currentTime = ((Math.abs(seed * 9301 + text.length * 49297) % 1000) / 1000) * Math.max(0, d - sec - 1);
    a.volume = 0.9;
    a.play().catch(() => {});
    clearTimeout(fadeT);
    fadeT = setTimeout(() => { if (cur === a) fadeOut(a); }, sec * 1000);
  };
  if (a.readyState >= 1) begin();
  else a.addEventListener("loadedmetadata", begin, { once: true });
  return sec;
}
function fadeOut(a) {
  const iv = setInterval(() => { a.volume = Math.max(0, a.volume - 0.12); if (a.volume <= 0.02) { a.pause(); clearInterval(iv); } }, 40);
}
export function stopSpeech() { clearTimeout(fadeT); if (cur) { cur.pause(); cur = null; } }
export const preloadVoice = (archetype) => get(VOICE[archetype] || "Diplomat Voice");

// Space music: the two space themes in turn; quieter while someone is talking.
let music = null, mi = 0, started = false, duck = false;
export function startMusic() {
  if (started) return;
  started = true;
  const names = ["SpaceTheme1", "SpaceTheme2"];
  const next = () => {
    music = new Audio(url(names[mi++ % 2]));
    music.volume = duck ? 0.18 : 0.5;
    music.onended = next;
    music.play().catch(() => (started = false));
  };
  next();
}
export function duckMusic(on) { duck = on; if (music) music.volume = on ? 0.18 : 0.5; }
