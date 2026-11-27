// Alien empires, first slice. Pure data and rules, no drawing: who lives where, how they feel about you, and what
// each of your acts does to that. The ten archetypes here are stand-ins to swap for the full build's space/archetype.js.
import { rng32, hashSeed } from "../galaxy/names.js";

export const ARCHETYPES = {
  Bard: { start: 20, likes: "wave", sells: 1, buysSpecimens: 1.2, text: "sings every greeting" },
  Diplomat: { start: 26, likes: "wave", sells: 1, buysSpecimens: 1, text: "weighs every word" },
  Ecologist: { start: 10, likes: "gift", sells: 1, buysSpecimens: 1.9, text: "guards living worlds" },
  Explorer: { start: 10, likes: "wave", sells: 1, buysSpecimens: 1.3, text: "chases the next horizon" },
  Knight: { start: 0, likes: "strength", sells: 0.9, buysSpecimens: 1, text: "keeps a code of honour" },
  Scientist: { start: 5, likes: "gift", sells: 1, buysSpecimens: 1.7, text: "studies everything twice" },
  Shaman: { start: 6, likes: "wave", sells: 1, buysSpecimens: 1.2, text: "listens to the stars" },
  Trader: { start: 15, likes: "gift", sells: 1.35, buysSpecimens: 1.1, text: "prices everything" },
  Warrior: { start: -24, likes: "strength", sells: 0.8, buysSpecimens: 0.9, text: "respects only strength" },
  Zealot: { start: -14, likes: "strength", sells: 0.9, buysSpecimens: 1, text: "serves a single idea" },
};
const KINDS = ["Concord", "Dominion", "Accord", "Collective", "Union", "Hegemony", "Covenant", "Kin"];
const COLORS = ["#ff7a5c", "#5cc8ff", "#7ee08a", "#c48cff", "#ffd36a", "#ff8fc8", "#6ff0d8", "#ffa14a", "#9fb0ff", "#e0e0e0"];
const furious = new URL("../img/faces/furious.png", import.meta.url).href;
const annoyed = new URL("../img/faces/annoyed.png", import.meta.url).href;
const neutral = new URL("../img/faces/neutral.png", import.meta.url).href;
const friendly = new URL("../img/faces/friendly.png", import.meta.url).href;
const allied = new URL("../img/faces/allied.png", import.meta.url).href;
// The five faces and colours are the creature stage's own (creature/relations.js), so the scale reads the same everywhere.
export const BANDS = [
  { id: "enemy", name: "Furious", max: -60, face: furious, color: "#ef4b48" },
  { id: "shunned", name: "Annoyed", max: -20, face: annoyed, color: "#f08a3c" },
  { id: "neutral", name: "Neutral", max: 20, face: neutral, color: "#b9c3c9" },
  { id: "liked", name: "Friendly", max: 60, face: friendly, color: "#4fa3f0" },
  { id: "allied", name: "Allied", max: 101, face: allied, color: "#3fc26e" },
];
export const band = (score) => BANDS.find((b) => score < b.max) || BANDS[BANDS.length - 1];
export const TERRITORY = 0.07; // galaxy units, about 6,300 light years

export function makeEmpires(galaxy, homeId) {
  const stars = galaxy.stars;
  const empires = [];
  const homes = galaxy.starts.filter((id) => id !== homeId);
  // More empires to meet: a few close to your home so they are easy to find, the rest spread over the arms.
  const rr = rng32(hashSeed("empires+", galaxy.seed));
  const okKind = new Set(["yellow", "orange", "white", "red", "binary"]);
  const dist = (a, b) => Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y);
  const chosen = [...homes, homeId];
  const tryPick = (filter, want) => {
    let got = 0;
    for (let tries = 0; tries < 60000 && got < want; tries++) {
      const id = Math.floor(rr() * stars.length), s = stars[id];
      if (!okKind.has(s.kind) || s.sector === "Galactic Core" || Math.hypot(s.x, s.y) < 0.26 || Math.hypot(s.x, s.y) > 0.97) continue;
      if (!filter(id) || chosen.some((c) => dist(c, id) < 0.1)) continue;
      chosen.push(id); homes.push(id); got++;
    }
  };
  tryPick((id) => dist(id, homeId) < 0.2, 4); // near neighbours
  tryPick((id) => dist(id, homeId) < 0.45, 8);
  tryPick(() => true, 22);
  const arch = Object.keys(ARCHETYPES);
  homes.forEach((id, i) => {
    const r = rng32(hashSeed("empire", galaxy.seed, id));
    const a = arch[Math.floor(r() * arch.length)];
    const star = stars[id];
    empires.push({
      id: "e" + id, home: id, archetype: a, name: `${star.name}an ${KINDS[Math.floor(r() * KINDS.length)]}`, short: star.name + "ans",
      color: i < COLORS.length ? COLORS[i] : `hsl(${(i * 47) % 360} 80% 66%)`, seed: Math.floor(r() * 1e9), mood: Math.round((r() - 0.5) * 16),
      species: ["Hexapod", "Glider", "Lurker", "Strider", "Crested", "Horned"][Math.floor(r() * 6)],
    });
  });
  // The Keis: the galaxy's centre. Never marked; players find them.
  const keis = { id: "keis", home: -1, archetype: "Keis", name: "The Keis", short: "Keis", color: "#ffc21a", seed: 7, mood: 0, keis: true };
  // Territory: a star belongs to the nearest empire home within range.
  const owner = new Int16Array(stars.length).fill(-1);
  for (let s = 0; s < stars.length; s++) {
    const st = stars[s];
    if (Math.hypot(st.x, st.y) < 0.12) { owner[s] = empires.length; continue; }
    let best = -1, bd = TERRITORY;
    empires.forEach((e, k) => {
      const h = stars[e.home], d = Math.hypot(st.x - h.x, st.y - h.y);
      if (d < bd) (bd = d), (best = k);
    });
    owner[s] = best;
  }
  const all = [...empires, keis];
  return { empires: all, owner, of: (starId) => (owner[starId] >= 0 ? all[owner[starId]] : null) };
}

/** Everything you've done to them, as reasons with weights, so the face can explain itself. */
export function createRelations(empire) {
  const baseline = empire.keis ? -100 : (ARCHETYPES[empire.archetype].start + empire.mood);
  return { id: empire.id, met: false, allied: false, war: !!empire.keis, route: false, gifts: 0, sold: 0, praised: 0,
    reasons: [{ t: empire.keis ? "Keis hate every other species" : `${empire.archetype}: ${ARCHETYPES[empire.archetype].text}`, w: baseline }], baseline };
}
export const score = (rel) => Math.max(-100, Math.min(100, Math.round(rel.reasons.reduce((a, r) => a + r.w, 0))));
export function addReason(rel, t, w, { merge = true } = {}) {
  const ex = merge && rel.reasons.find((r) => r.t === t);
  if (ex) ex.w += w;
  else rel.reasons.push({ t, w });
  // Reasons fade a little only if they are nothing but small bumps; the first is the baseline and stays.
  return score(rel);
}
