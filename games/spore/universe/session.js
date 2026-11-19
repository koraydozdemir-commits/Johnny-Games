/**
 * The universe in play, at runtime: its galaxy (made lazily from its seed), its Sporepedia (loaded
 * from IndexedDB, saved shortly after every change and when the page is hidden), discovery rules,
 * exploration, and play time. The screens and the stages all go through this one object.
 */
import { findHomeWorld, makeEcosystem, makeGalaxy, makeSystem, PLANET_TYPES, STAR_KINDS } from "../galaxy/gen.js";
import { discover, emptyPedia, logEvent, milestone, nameOf, setPlanetStatus, upsert } from "../pedia/model.js";
import { pedia as pediaStore } from "./pedia-store.js";
import { planetProfile } from "../ecolib/planet-profile.js";

/**
 * @param {{ store:object, meta:object, onEvent?:(ev:object)=>void, onSaveState?:(state:string)=>void, onOwned?:(entry:object)=>void }} o
 */
export async function createSession(o) {
  const { store } = o;
  const meta = o.meta;
  let pedia = (await pediaStore.get(store, meta.id).catch(() => null)) || emptyPedia(meta.seed);
  let galaxy = null;
  const systems = new Map(),
    ecos = new Map();
  const listeners = new Set();
  let saveTimer = 0;
  const emit = (ev) => {
    if (!ev) return;
    o.onEvent?.(ev);
    listeners.forEach((fn) => fn(ev));
  };

  function save(now = false) {
    clearTimeout(saveTimer);
    const run = () => {
      o.onSaveState?.("saving");
      pediaStore
        .put(store, meta.id, pedia)
        .then(() => o.onSaveState?.("saved"))
        .catch(() => o.onSaveState?.("error"));
    };
    if (now) run();
    else saveTimer = setTimeout(run, 700);
  }
  const flush = () => save(true);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

  const S = {
    meta,
    store,
    get pedia() {
      return pedia;
    },
    galaxy() {
      return (galaxy ??= makeGalaxy(meta.seed));
    },
    system(starId) {
      if (!systems.has(starId)) systems.set(starId, makeSystem(meta.seed, S.galaxy().stars[starId]));
      return systems.get(starId);
    },
    planet(planetId) {
      const [starId, idx] = String(planetId).split(":").map(Number);
      return S.galaxy().stars[starId] ? S.system(starId).planets[idx] || null : null;
    },
    ecosystem(planet) {
      if (!ecos.has(planet.id)) ecos.set(planet.id, makeEcosystem(meta.seed, planet));
      return ecos.get(planet.id);
    },
    /** The universe's home world, where its species began (stored once found). */
    home() {
      if (!pedia.home) {
        pedia.home = findHomeWorld(S.galaxy());
        save();
      }
      return pedia.home;
    },
    /**
     * The home world's environment profile: generated the first time it is needed and then stored with the
     * universe, so the same world keeps its colours, biomes and ecosystem for good.
     */
    homeProfile() {
      const home = S.home();
      if (!home.profile) {
        const planet = S.planet(home.planetId);
        if (!planet) return null;
        home.profile = planetProfile(planet, { star: S.galaxy().stars[home.starId], seed: meta.seed });
        save();
      }
      return home.profile;
    },
    /** Any planet's profile (deterministic from the universe seed; only the home world's is stored). */
    planetProfile(planet) {
      return planetProfile(planet, { star: S.galaxy().stars[planet.starId], seed: meta.seed });
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    save,
    flush,
    /** A name as the player sees it (their rename, if any). */
    nameFor(id, fallback) {
      return nameOf(pedia.entries[id]) || fallback;
    },

    /* ---- discovery ------------------------------------------------------------------------ */
    visitStar(star) {
      const sys = S.system(star.id);
      const ev = discover(pedia, { id: "star:" + star.id, kind: "star", name: star.name, sub: STAR_KINDS[star.kind].name, starKind: star.kind, sector: star.sector, planets: sys.planets.length, starId: star.id });
      save();
      emit(ev);
      return pedia.entries["star:" + star.id];
    },
    visitPlanet(planet) {
      const star = S.galaxy().stars[planet.starId];
      if (!pedia.entries["star:" + star.id]) S.visitStar(star);
      const ev = discover(
        pedia,
        {
          id: "planet:" + planet.id,
          kind: "planet",
          name: planet.name,
          sub: PLANET_TYPES[planet.type].name,
          type: planet.type,
          status: "discovered",
          planetId: planet.id,
          temp: planet.temp + " °C",
          gravity: planet.gravity + " g",
          atmosphere: planet.atmosphere,
          water: Math.round(planet.water * 100) + "%",
          biodiversity: Math.round(planet.biodiversity * 100) + "%",
          danger: planet.danger,
          rarity: planet.type === "crystal" ? "Unique" : planet.habitability === "Easily habitable" ? "Rare" : "Common",
          place: S.nameFor("star:" + star.id, star.name),
        },
        { place: star.name },
      );
      emit(ev);
      // Firsts worth remembering, once per universe.
      if (planet.temp > 120) emit(milestone(pedia, "hot", "First visit to a scorching world: " + planet.name + " (" + planet.temp + " °C).", "🔥"));
      if (planet.temp < -120) emit(milestone(pedia, "cold", "First visit to a frozen world: " + planet.name + " (" + planet.temp + " °C).", "🧊"));
      if (planet.type === "crystal" || planet.type === "toxic") emit(milestone(pedia, "strange:" + planet.type, "An unusual world: " + planet.name + ", a " + PLANET_TYPES[planet.type].name.toLowerCase() + " planet.", "✨"));
      if (planet.type === "gas") emit(milestone(pedia, "gas", "First gas giant charted: " + planet.name + ".", "🪐"));
      save();
      return pedia.entries["planet:" + planet.id];
    },
    /**
     * Everything a planet holds, in the order a survey turns it up.
     */
    surveyList(planet) {
      const eco = S.ecosystem(planet);
      const spOrder = [...eco.species].sort((a, b) => (a.rarity === "Rare") - (b.rarity === "Rare"));
      // Mixed rounds: a landmark, a plant, a creature, and again; rare creatures come last.
      const lists = [[...eco.landmarks], [...eco.plants], spOrder],
        out = [];
      while (lists.some((l) => l.length)) for (const l of lists) if (l.length) out.push(l.shift());
      return out;
    },
    found(planet) {
      return S.surveyList(planet).filter((x) => pedia.entries[entryId(x)]);
    },
    /** One survey of a planet's surface: turns up the next thing not yet found. */
    survey(planet) {
      S.visitPlanet(planet);
      const all = S.surveyList(planet);
      const next = all.find((x) => !pedia.entries[entryId(x)]);
      setPlanetStatus(pedia, planet.id, "explored");
      if (!next) return null;
      const place = S.nameFor("planet:" + planet.id, planet.name);
      let ev;
      if (next.kind === "landmark") ev = discover(pedia, { id: entryId(next), kind: "landmark", name: cap(next.name), place, planetId: planet.id }, { place });
      else if (next.kind === "plant")
        ev = discover(pedia, { id: entryId(next), kind: "plant", name: next.name, sub: next.type, type: next.type, habitat: next.habitat, fruit: next.fruit, needs: next.needs, rarity: next.rarity, place, planetId: planet.id, ref: next.id }, { place });
      else
        ev = discover(
          pedia,
          { id: entryId(next), kind: "species", name: next.name, sub: next.role, diet: dietWord(next.diet), role: next.role, size: next.size + " m", danger: next.danger, rarity: next.rarity, habitat: next.habitat, temperament: next.temperament, place, planetId: planet.id, ref: next.id },
          { place, danger: next.danger },
        );
      emit(ev);
      if (all.every((x) => pedia.entries[entryId(x)]) && setPlanetStatus(pedia, planet.id, "catalogued")) emit(logEvent(pedia, { key: "catalogued:" + planet.id, text: place + " is fully catalogued.", icon: "📗", entry: "planet:" + planet.id }));
      save();
      return next;
    },
    /** The generated object behind a Sporepedia entry (a planet's species or plant). */
    resolve(entry) {
      if (!entry?.ref || !entry.planetId) return null;
      const planet = S.planet(entry.planetId);
      if (!planet) return null;
      const eco = S.ecosystem(planet);
      return [...eco.species, ...eco.plants].find((x) => x.id === entry.ref) || null;
    },
    /** The player's own creations and history, kept in step with the stages. */
    record(entry) {
      const e = upsert(pedia, entry);
      save();
      // The player's own creations are also kept in the Global Sporepedia.
      if (e?.owned) o.onOwned?.(e);
      return e;
    },
    log(ev) {
      emit(logEvent(pedia, ev));
      save();
    },
  };
  return S;
}
export const entryId = (x) => (x.kind === "landmark" ? "landmark:" + x.id : x.kind === "plant" ? "plant:" + x.id : "species:" + x.id);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const dietWord = (d) => (d === "meat" ? "Carnivore" : d === "plant" ? "Herbivore" : "Omnivore");
