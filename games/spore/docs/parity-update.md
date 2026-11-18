# Complete Spore Parity Update — audit and plan

Spec: `docs/parity-spec.txt`. Earlier work: `docs/major-update.md` (creature/tribe overhaul, galaxy,
universes, Sporepedia).

## 1. Audit (what actually works today, checked in code and in the browser)

| Area | State |
|---|---|
| Cell Stage | Four tiers, DNA, cell editor (symmetry, rotation, colour), 12 parts incl. filter/jaw/proboscis, cilia/flagellum/jet, spike/poison/electric, eye, mito, armour; meteors with parts; predators and prey; mates; diet card from real eating. **Missing:** depth zones, scavenging as a distinct food, a multicellular transition beat, cell designs stored as reopenable data. |
| Creature Stage | Open 3D island in five regions, migration, ecosystem (7 archetypes), balance tables, anatomy-driven movement, social (personalities, intimidation), carrying, family orders, generations, cards. **Missing:** wings/gliding, vocal parts, environmental events, rare encounters beyond epics. |
| Tribal Stage | Five rivals with their own AI, placement/upgrade/repair, hut levels, bronze tier, upkeep, trade, peace, recruit, raids, war parties, box select, formations, victory paths. **Missing:** decorations, housing, assignable roles beyond tools, trait names matching the spec (Diplomatic/Industrious/Warlike). |
| Civilization Stage | **None.** |
| Space Stage | **None.** |
| Galaxy | Seeded galaxy (1,400 stars), systems, 14 planet types, ecosystems from creature data, planet art, exploration surveys. **Missing:** rare discoveries, seed sharing UI, player location/navigation (needs Space Stage). |
| Universes | IndexedDB universes, unlimited, slot migration, switch with rollback, duplicate/rename/delete/export/import. **Missing:** seed sharing, preserve-or-remove choice for a deleted universe's creations. |
| Sporepedia | Per-universe, 10 categories, search/sort/rarity, favourites, recents, compare, export, 3D turntable, sandbox editor for creatures. **Missing:** Cells, Buildings, Vehicles, Spaceships, Civilisations, Empires categories; Global Sporepedia; creation import. |
| Consequences | Cell (3) → Tribal legacy; Creature (3) → Tribal legacy; Tribal trait recorded. **Missing:** Civilization and Space archetypes and their effects. |

## 2. Phases (spec order)
1. Foundation gaps: shared creation format, Global Sporepedia (+ delete-universe choice), galaxy seed
   sharing, cell designs as real data (Cells category), creation import.
2. Finish existing stages: cell depth zones + scavenging; creature wings/gliding + vocal + events;
   tribal decorations/roles + trait naming; consequence system across all stages.
3. Civilization Stage: cities, building editor, vehicle editor, military/economic/religious paths,
   rival nations, conquest, superweapons, archetype card.
4. Space Stage: spaceship editor, interstellar travel (energy, range, wormholes), alien empires,
   diplomacy, colonies, terraforming, missions, Galactic Core.
5. Galaxy and Sporepedia completion: rare discoveries, Planetpedia ecosystem history, homeworld revisit.
6. Polish: aquatic extension, environmental events, verified development-vision features, performance,
   full regression.

## 3. Progress log
### Phase 1 — foundation (done)
- `creations/format.js`: one versioned envelope (`johnny-spore-creation` v2) for cells, creatures, plants,
  buildings, vehicles and spaceships, with validation per kind (modular designs: name, colours, parts in
  3D, numbers clamped). Reads v1 Sporepedia exports. Sporepedia exports designs in this format.
- Global Sporepedia (`universe/global.js`, IndexedDB store `global`, DB v2): every creation from every
  universe, kept when a universe is deleted unless the player ticks "Also remove its creations". Global
  favourites and renames survive updates. The Sporepedia has a "This universe / All universes" switch;
  global creations can be copied into the current universe or reopened in their editor.
- Galaxy seed sharing: SPORE- share codes (copy button on each universe card), typed into New universe;
  seed files import as a fresh universe in the same galaxy. Discoveries stay per player.
- Cells: each generation stores its real design; the current cell is a live entry; Cells category; cell
  designs reopen in the cell editor as a sandbox (Accept saves a new creation; the real cell, DNA and
  generation count are restored). Creation files import into the Sporepedia (bad files refused with the
  reason).
- Tests: 102 unit tests (creation format round-trips for every kind, seed codes/files, global collection
  incl. delete with and without removal). Browser (phone): cells stored, sandbox edit, global scope,
  export → import, damaged file refused, seed code → friend's universe with the same galaxy and home
  world and a separate Sporepedia. Fixed during testing: the sandbox counted as a new generation.
- Not done: cell sandbox only opens from the Cell Stage (the cell editor is part of the cell scene).

### Phase 2 — finish the existing stages (done)
- Cell Stage (`cell/zones.js`, 2 tests): the microscopic ocean has depth. Swim away from where life began
  and it gets deeper: Sunlit Shallows → Kelp Drift / Thermal Vents → Twilight Zone → Abyssal Trench. Each
  zone changes the plant/meat mix, how many hunters live there, DNA per bite (×1 → ×1.6), and light (a
  darkening shade). Deep zones carry drifting remains to scavenge; scavenging is counted. First visits
  give DNA; the trench is recorded in the chronicle. Zone pill in the header.
- Creature Stage (`creature/events.js` + `creature/weather.js`, 2 tests): regional climate. Rain and
  thunderstorms (rain streaks, closer fog, lightning) make others notice you from less far; heatwaves
  (badlands/volcanic, by day) make you hungry 1.8× faster; night meteor showers end with a meteorite
  that holds one of the rarest parts you lack (+20 DNA, chronicle); volcanic eruptions throw lava bombs
  with warning rings. Wings/gliding, jumping, sneaking, swimming and vocal parts already worked.
- Tribal Stage: clubs (cheap first weapon); dwellings (+2 room each, up to 3) and decorations (totems,
  banners, flower beds: +15% healing at home each) placed where you tap, saved; roles (gatherers fetch
  food on their own, guards hold the fire and fight within 18 m) set from the Build sheet, shown on member
  chips, saved. Old shack positions are unchanged (a fixed arc order).
- Consequence names match the spec: Creature Social / Aggressive / Adaptable; Tribal Diplomatic /
  Industrious / Warlike (ids unchanged, so saves are untouched).
- Tests: 107 unit tests; lint clean. Browser (phone): zones by depth (label, shade, DNA, toasts); every
  weather event incl. a meteorite dug for a part and lava-bomb damage; dwellings/decorations/roles incl.
  auto-gathering and guarding, persisted through reload; full cell → creature (4 migrations) → tribe
  regression. Fixed during testing: depth shade too faint; weather chip overlapped the objective panel
  on phones; lava blast filled the screen.
- Not done: NPC cells don't scavenge (only you do); Civilization/Space effects of the consequence chain
  arrive with those stages.

### Phase 3 — Civilization Stage (done; not playtested by a human)
- Creation layer (`creations/modular.js`, `mesh.js`, `editor.js`): one part catalogue shape for buildings
  (20 parts), vehicles (20) and spaceships (17); a design's stats come only from its parts and role
  (armour = tougher but slower, more weapons = more power and cost, the propulsion decides land/sea/air).
  One phone-first 3D editor for all three: tap a part to add it (stacked on the selection, wheels and
  engines go on the sides mirrored), tap to select, drag to slide, tool bar to raise/lower, turn, resize,
  mirror, copy, delete; role picker, three colours, live stats and "what's missing", undo/redo, keyboard
  shortcuts on desktop. It uses the game's renderer (no second WebGL context).
- Rules (`civ/rules.js`, 11 tests): city economy (houses → people, factories → money but unhappiness,
  entertainment, temples → faith; riots cut income), design strength scales every building's effect,
  turrets then hall, repair, conversion vs faith, trade routes paying both sides, buyouts, vehicle stats
  from designs, rival-nation AI, relations, superweapons (original names: Sky Hammer, Golden Handshake,
  Great Revelation), victory and the Military / Economic / Religious card, a tolerant save reader.
- Stage (`civ/stage.js`): the home island with 11 cities (yours, two for each of three rival nations,
  four independent), 9 spice geysers, land/sea/air vehicles (boats keep to the water and reach coastal
  cities only; aircraft after 3 cities), turrets firing at attackers, nations that build, trade, preach,
  declare war and take independent cities, gifts and peace, a 4-minute grace period, superweapon
  targeting, win and loss screens, autosave. Earlier cards carry over: the tribal trait sets the first
  city's kind and a bonus; the cell and creature cards each give one more (shown in How to play).
- Wiring: "Begin the Civilization Stage" on the tribal victory sheet and in the tribe menu once won; DEV
  switch; "Continue your civilization" on the title screen; species history shows the civ card; saved
  designs go into the Sporepedia; universe cards and save slots show the Civilization Stage.
- Tests: 120 unit tests; lint clean. Browser: the editor on phone and desktop for all three kinds;
  city building, vehicle purchase, a military capture (war declared, card counted), a religious
  conversion, superweapon, victory sheet, save/reload, tribe → civ → tribe → civ round trip, editing a
  building design from the stage. Long AI runs (8 game minutes, fast-forwarded) used to tune balance:
  first runs lost the capital in 90 s, so conversion was slowed, nations wait 90 s before moving and
  leave you alone for 4 minutes, and rivals can no longer buy your cities.
- Not done: no road/route graphics for trade, no city-to-city happiness from neighbours, nations don't
  fight each other, no unique buildings per city type, no Civilization → Space transition (Phase 4).

### Galaxy start screen and homeworld selection (separate spec; not playtested by a human)
- The game now opens on its galaxy (`galaxy/start.js`, drawn with the game's renderer and frame loop,
  disposed on leaving): a 3D spiral with a white-gold core glow, violet/indigo/blue nebula ribbons
  along four arms, dark dust lanes, 20–55k twinkling stars (by quality setting), a fixed far starfield,
  and a very slow spin. Drag to pan, pinch or scroll to zoom, two-finger twist or right-drag to turn,
  + / − / ⤢ buttons, arrow keys.
- Menu: logo, Continue (when this universe has a game; resumes the furthest stage), New Game, Load
  Game (the universe list, now showing each universe's homeworld and creation date), settings. The
  settings panel gained "Main menu", which saves and reloads into the galaxy (so there is never a
  second renderer or loop).
- Starting systems (`gen.js`): ten stars between 50% and 90% of the radius, spread over the arms,
  of varied kinds, spaced apart, never in the core. Each has exactly one T3 homeworld (breathable air,
  -6 to 34 °C, 30–86% ocean, rich and stable life, no hazards; terrestrial, jungle, oceanic, wetland
  or boreal) with its own name, climate and description. Terraforming levels T0–T5 are computed for
  every planet (natural worlds reach T3). The core is stored as future Grox territory; tapping it
  gives a hint, nothing more. 1 new test (4 seeds).
- Selecting a starting star flies the camera in, shows the star with its light and the homeworld on
  its orbit, and a panel with the star's data and the planet (T3 badge, type, climate, temperature,
  atmosphere, moons, oceans, life, description) with a globe you can drag to turn. ◀ ▶ cycles through
  the starting systems. "Begin life on …" opens the NEW CIVILIZATION confirmation.
- Begin Evolution: the camera dives to the star (it flares) and onto the planet until it fills the
  screen, fades to its ocean colour; a new universe is created (or the untouched one in play is used)
  with the galaxy seed, the chosen star and planet (planet seed = its surface seed), then the page
  reloads into the existing Cell Stage: the homeworld's name shows over the ocean, the hatch begins,
  and the chronicle records where life began. A game in progress is parked safely first.
- Older games: universes made before this keep their saves; their home world is the one found for
  them before (shown as "born on …"), and Continue works. Old save slots were already turned into
  universes at start-up.
- Tested in the browser (phone and desktop): opens on the galaxy with the cell HUD hidden; all ten
  starting systems selectable and showing T3; previews turn; New Game → Begin → Cell Stage; seed,
  star and planet persist through reload; Continue resumes; a second New Game makes a separate
  universe and parks the first intact; Load Game lists both; an old localStorage-only save gets a
  universe and a homeworld; pinch zoom works; no page errors.
- Not done: the Creature Stage island doesn't yet take its look from the homeworld type; no frame
  timing on a real iPhone or iPad (only a software renderer here), so performance there is unmeasured.
