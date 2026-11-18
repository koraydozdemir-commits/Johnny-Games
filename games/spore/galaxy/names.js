/**
 * Names for stars, planets, species and places: built from syllables that sound good together, by
 * seed, so the same seed always gives the same name. Different syllable sets for different things
 * keep stars, worlds and creatures from sounding alike.
 */

/** A small, fast seeded generator (mulberry32). */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mix several numbers into one 32-bit seed. Sub-seeds keep each system independent. */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  }
  return h >>> 0;
}

const SETS = {
  star: {
    start: ["Al", "Be", "Ca", "De", "Er", "Fo", "Ga", "Hy", "Is", "Ka", "Le", "Mi", "No", "Or", "Pe", "Qu", "Ri", "Sa", "Te", "Ul", "Ve", "Xa", "Ze", "Thu", "Sol", "Vy"],
    mid: ["ra", "ri", "de", "lo", "ne", "sti", "ga", "ma", "ru", "the", "va", "ci", "lu", "ndra", "ph", "rio", "sa"],
    end: ["n", "s", "x", "r", "on", "is", "ar", "us", "ia", "ae", "or", "ix", "a", "el"],
  },
  planet: {
    start: ["Ar", "Bo", "Cy", "Dra", "E", "Fa", "Gor", "Ha", "I", "Jo", "Ke", "Lu", "Mo", "Ny", "O", "Pra", "Ry", "Su", "Ta", "U", "Vo", "Wy", "Ya", "Zo"],
    mid: ["ka", "le", "mo", "na", "pe", "qui", "ro", "si", "tu", "va", "ze", "ndo", "rre", "lla", "th"],
    end: ["ra", "on", "a", "is", "e", "um", "ia", "os", "ar", "ine", "eth", "o", "an"],
  },
  species: {
    start: ["Gl", "Sn", "Bl", "Kr", "Pl", "Zw", "Fl", "Tr", "Gr", "Sk", "Wum", "Mo", "Bu", "Qu", "Dr", "Vr"],
    mid: ["o", "i", "a", "u", "ee", "oo", "y", "ai"],
    end: ["b", "rk", "mp", "x", "nt", "zle", "ggle", "nk", "th", "pper", "ster", "lo", "bit", "mox"],
  },
  plant: {
    start: ["Fern", "Moss", "Thorn", "Bloom", "Reed", "Vine", "Cap", "Frond", "Bulb", "Spine", "Glow", "Pod", "Tuft", "Kelp"],
    mid: ["", "", "a", "o", "i"],
    end: ["wort", "leaf", "bell", "cap", "root", "weed", "bloom", "stalk", "berry", "shade", "spire", "gourd"],
  },
};
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const roman = (n) => ROMAN[n] || String(n + 1);

/**
 * A name of a kind, from a seed.
 * @param {"star"|"planet"|"species"|"plant"} kind
 */
export function makeName(kind, seed) {
  const r = rng32(hashSeed(kind, seed));
  const s = SETS[kind];
  const pick = (list) => list[Math.floor(r() * list.length)];
  let name = pick(s.start);
  // Species and planet names always get a vowel in the middle: no "Snnt".
  const mids = kind === "plant" ? 1 : kind === "star" ? (r() < 0.55 ? 1 : r() < 0.8 ? 0 : 2) : kind === "species" ? 1 : r() < 0.75 ? 1 : 2;
  for (let i = 0; i < mids; i++) name += pick(s.mid);
  name += kind === "plant" ? pick(s.end) : pick(s.end);
  // Stars sometimes carry a catalogue-style suffix; it keeps a big galaxy's names apart.
  if (kind === "star" && r() < 0.18) name += " " + (2 + Math.floor(r() * 97));
  return name[0].toUpperCase() + name.slice(1);
}
