# Johnny Games Spore — Major Evolution Update

Working document for the multi-phase update (spec: "Major Evolution Update", Nov 2026).
Decisions from the owner:

- **Regions:** the creature world becomes a chain of regions. Each migration moves the species
  into the next region (coast → forest → swamp → badlands/desert → volcanic highlands).
  Earlier regions stay unlocked.
- **Order:** Phase 1 Creature Stage → Phase 2 Tribal Stage → Phase 3 cross-stage links.
- **Pushing:** publish the playable artifact after each phase; push to GitHub only when asked.

## 1. Audit (start of the update)

### Persistence (localStorage keys)
| Key | Owner | Notes |
|---|---|---|
| `johnny-spore-cell-stage` | main.js | cell run (versioned by fields) |
| `johnny-spore-cell-record` | cell-format.js | the cell design |
| `johnny-spore-creature-handoff` | cell-format.js | cell → creature hand-off |
| `johnny-spore-creature-stage` | creature/format.js | creature save; `worldVersion: 2` = open island |
| `johnny-spore-tribe-stage` | tribe/rules.js | tribe save (`readTribeSave` validates) |
| `johnny-spore-history` | main.js | species history entries |
| `johnny-spore-settings`, `-quality`, `-slot`, `-saved-at`, `-tips` | misc | settings, save slots, tips seen |

All loaders tolerate missing fields; new fields must keep doing so (no resets).

### Creature Stage — what exists
Working: open island (plains, beach, solid mountains, outcrops), 12 nests levelling with the brain,
alphas, rogues, epics, raids, herd migration, player migration, family + mating + generations,
pack (recruit allies), social call-and-answer (sing/dance/charm/pose), combat (bite/strike/charge/
spit), sneak/sprint/jump/glide/swim, stamina, hunger, fossils → parts, eggs, tree fruit, sleep at
night, UFOs, sea monster, minimap + island map, library, consequence card, history screen.

Gaps and bugs found:
- **Sight does nothing.** Eye parts grant `sight`, but no code reads it.
- **Combat numbers are ad hoc** (formulas inline in stage.js): no shared model, no hits-to-kill
  targets, NPC attacks land instantly (no wind-up), nothing prevents stun-locking.
- **Anatomy barely matters:** speed comes from one stat; leg count/length, mass, tails and fins
  do not affect movement; there is no hearing.
- **No ecosystem:** the only wildlife is nest members (plus epics/rogues). No prey herds,
  scavengers or predators hunting other species. Carcasses only come from the player's kills.
- **Personality = temper only** (hostile / wary / skittish / friendly).
- **No carrying:** food can't be picked up, dragged, brought home or given as a gift.
- **Family has no commands:** only "pack follows" and "send home".
- **Social:** four moves only; no intimidate, feed/gift or play; creatures ignore your size and
  your history with them beyond the nest relationship.
- **Editor:** part cap of 14 and DNA costs, but no total complexity budget and no stats readout
  of movement; test drive exists.

### Tribal Stage — what exists
Village with huts and fire, gathering, fishing, hunting herds, carrying food, babies, 8 tools
(fight / music / village kinds), call-and-answer music diplomacy, gifts, three rival tribes, raids,
torches and burning huts, healers, unit selection and commands, won sheet.

Gaps: labelled "early prototype"; three rivals with no distinct identity; no building placement,
upgrade or repair; no campaign structure; little rival simulation off screen; no recruitment;
no hut or flora editors; no customisation.

### Cross-stage — what exists
Cell → creature: `creatureFromCell` keeps colours, pattern and name. Creature → tribe: the creature
record becomes the tribe model. Consequence cards exist for cell and creature, but the tribe stage
does not read them. The history screen lists generations.

## 2. Plan

### Phase 1 — Creature Stage
- [x] 1.1 Data-driven balance model (`creature/balance.js`): hits-to-kill targets, wind-up and
      recovery for every attack, stagger immunity (no stun-lock), size and anatomy effects. Tested.
- [x] 1.2 Anatomy matters: legs/mass/tail → speed, acceleration, turning; sight → detection range;
      ears (hearing) → noticing sneakers and warnings; fins/webbing → swimming. Editor shows stats.
- [x] 1.3 Regions unlocked by migration: coast, forest, swamp, badlands, volcanic; each with its own
      terrain, props, hazards, nests and wildlife; per-region saves; map shows the regions.
- [x] 1.4 Ecosystem: wildlife archetypes (small prey, grazers, large herbivores, pack predators,
      ambush predators, scavengers, territorial guardians, apex), personality traits, needs-based
      AI with distance LOD, predators hunting prey, carcasses that rot and are scavenged.
- [x] 1.5 Food: carry fruit and meat (graspers/mouth), drag carcasses, bring food home, feed family,
      gift food as a social move.
- [x] 1.6 Family commands: Follow, Stay, Gather, Defend, Attack, Retreat.
- [x] 1.7 Social overhaul: intimidate, gift, play; reactions to your size, threat and history;
      readable sequences; visible posture reactions.
- [x] 1.8 Economy: DNA for discovery, exploration, new foods, migrations; part budget; brain-level
      milestones without difficulty spikes.

### Phase 2 — Tribal Stage
- [x] Done (see progress log). Campaign with five rival archetypes (Warriors, Traders, Defenders, Musicians, Hunters), building
placement/upgrade/repair, food economy, population, equipment tiers, diplomacy (music, gifts,
trade, alliances, reconciliation), RTS warfare (multi-select, formations, raids, retreat,
rebuild), rival background simulation, recruitment, hut editor, flora editor, customisation,
victory paths and transition. Remove all prototype labels.

### Phase 3 — One game
- [x] Done (see progress log). Species identity carried through all stages, consequence bonuses read by every later stage,
full species history screen, save migrations and cross-stage tests.

### After Phase 3 — Galaxy, Save Universe & Sporepedia (next update)
Spec saved as `docs/galaxy-update-spec.txt`. Deterministic galaxy (stars, systems, procedural planets
and ecosystems built from the creature part data), multiple independent universes (IndexedDB, versioned,
export/import), Sporepedia (creatures, species, planets, plants, discoveries, history). Phase 3's species
history must be stored so it can move into a per-universe save without migration pain.

## 3. Progress log
- Phase 1 started.
- 1.1 done: `creature/balance.js` (+ tests/balance.test.mjs). Wind-ups (crouch, dodge by stepping back),
  stagger cap + immunity, alphas ×1.6 HP / ×1.25 damage on their own kind.
- 1.2 done: `creature/anatomy.js` (+ tests). Body plan/legs/bulk/tail/fins → speed, accel, turn, swim,
  how far you're noticed, charge weight. Hearing stat (ears 4, antennae 2): warns of hunters behind you,
  shows them on the minimap. Sight: minimap range, fossil spotting, learning species from their nest.
  Editor shows a Movement section.
- 1.3 done: `creature/regions.js`; world.js region-aware (coast byte-identical to v2). Save v3:
  `region`, `homeRegion`, `unlockedRegions`, `regions{id:{nests,bonesTaken,epics,rogues}}`, `arrival`.
  Migration at each brain level leads to the next region's exit (far shore); main.js `onChangeRegion`
  restarts the stage in the new region. Map has region chips to travel back. Lava burns; badlands
  hunger ×1.35. Saving is suppressed while fading out (fixed an overwrite bug).
- 1.4 done: `creature/ecosystem.js` (+ tests/ecosystem.test.mjs, 5 tests). Archetypes: small prey, grazer,
  giant, scavenger, pack hunter, ambusher, guardian (apex = the region's epics). Modes: flee, hunt, pounce,
  eat, graze, curious, warn, lurk, rest, wander. Herd alarm, packs share a target, eat before hunting again,
  night rest. Groups far from the player are simulated abstractly; the live cap is by quality (10/14/22).
  Kills leave carcasses; groups respawn after 3–4.5 min. Wildlife remembers who hurt it.
- 1.5 done: F (or the hand button) picks up, stores, gives, eats or drops food. Small carcasses are
  dragged. Nest larder (shown as a food pile) feeds you and the family. Gifting food heals family, calms an
  angry nest and counts towards a social round.
- 1.6 done: family orders menu (O / 🐾 button): Follow, Stay, Gather (fetch food to the larder), Defend
  (guard the nest), Attack (your target), Retreat, Free. Saved.
- 1.7 done: species personalities (shy, proud, playful, fierce, curious) change how hard they are to
  impress and whether they fear big creatures; shown in the target panel. Pose on a hostile/wild creature
  intimidates (your might vs their nerve: cowed and flees, or angered). Rounds start warmer with history.
- 1.8 done: DNA for discovering species by sight (+3), first taste of a new food (+5), migration (+25).
  Part budget by brain level (8 → 14), shown on the Parts tab. Milestone toast on level-up. A migration is
  due at every brain level (fixes the volcanic region being unreachable).

### Phase 1 — not completed (recorded, not silently dropped)
- Posture reactions are limited to existing pops, crouch (wind-up) and head-look; no new full-body
  reaction animations.
- No new drinking or swimming animations (swimming changes speed only).
- Editor body plans are derived from leg count only; no spine-shape-based plans (e.g. serpentine gait).
- The social minigame keeps its call-and-answer core; "play" was not added as a separate move.

### Phase 1 tests
- Unit: 73 passing (`node --test tests/*.test.mjs`). Lint clean.
- Browser (headless Chromium, phone 390×844 touch): cell → editor → creature start; four migrations
  coast → forest → swamp → badlands → volcanic (home, nest, brain level and DNA carried); reload restores
  the volcanic region; DEV switch to Tribe and back. No page errors. Not playtested by a human.

### Phase 2 — Tribal Stage (done)
- `tribe/campaign.js` (+ tests/campaign.test.mjs, 7 tests): five rivals (Traders, Musicians, Hunters,
  Defenders, Warriors) with their own taste for music and gifts, trading, raiding, hut strength, arms and
  temper; hut levels and room; shack placement rules; food upkeep; bronze tier; peace, trade, recruiting;
  the rivals' background simulation (food, growth, hunger, cooling tempers, raids, warriors raiding other
  tribes); three victory paths with a trait each (Friendly / Aggressive / Industrious).
- Save v2 (`johnny-spore-tribe-stage`): tool tiers, hut level and strength, shack positions and strength,
  recruits' origin, rivals' food/war/peace, customisation, victory path, play time. v1 saves migrate (the
  three old tribes keep their places and status; tools become tier 1; shacks keep their old spots).
- Village: shacks are placed where you tap (validated: not too close, not wet, not overlapping); bronze
  upgrades (needs hut level 2; ×1.5 damage / music / gathering / healing); chief's hut levels 1–3 (+2 room
  each, tougher); raiders steal food and smash buildings when the pile is bare; repair by selecting members
  and tapping the hut or shack; every adult eats one food a minute (going short weakens, never kills).
- Rivals in the scene: traders visit your fire with goods (🧺); hunters hunt the herds and raid when hungry;
  defenders sit behind a palisade (×2 hut strength) and march on you if attacked; warriors raid you and the
  other tribes; musicians make music, listen longer and teach you an instrument when allied. Rivals grow
  new members from their food.
- Diplomacy: play (scaled by each rival's taste, bronze louder), gifts, trade (tool shacks for food, ally
  prices), make peace (food for a truce), recruit from allies (they keep their species' look), allies send
  fighters when you are raided. War: raid their food store (they get furious and fight), attack, burn.
- RTS: tap, All, ⬚ Box drag (or shift-drag with a mouse), formation marching (ranks, chief and armed in
  front), ↩ Retreat (no stopping to fight, loot is delivered home).
- Customisation: tribe name, colour, hut style (dome / cone / longhouse). "Prototype" labels removed.

### Phase 2 — not completed (recorded, not silently dropped)
- Hut editor is a style/colour picker, not a free-form part editor. No flora editor.
- Rival-versus-rival raids are simulated (food taken, a member may fall) rather than fought on screen.
- One formation shape (ranks); no formation picker.
- The Tribal Stage still uses the coast map; placing it in your home region belongs to Phase 3.

### Phase 2 tests
- Unit: 80 passing; lint clean.
- Browser, phone 390×844 touch: five rivals placed; tap placement (and refusal when too close); hut and
  bronze upgrades; trading; gifts; alliance → musicians' instrument gift; recruiting; peace; box select;
  formation move; raiding the hunters (food taken, relation −30, war); defenders' war party marching in; a
  bare-pile raid wrecking the hut; upkeep shortfall; customising; victory screen (balance path); save v2
  and reload; v1 save migration. Desktop 1280×720: Tribal Stage menu label, shift-drag box select, the
  music minigame with keys (Traders 10 → 53). No page errors. Not playtested by a human.

### Phase 3 — One game (done)
- `lineage.js` (+ tests/lineage.test.mjs, 5 tests): the Tribal Stage legacy from earlier cards (Cell:
  Feral +15% damage / Gentle gifts ×1.25 / Forager +1 carry; Creature: Predator starts with axes / Charmer
  rivals +15 and songs ×1.1 / Adaptable hut level 2), the tribe's own trait for later stages, and the
  species chronicle (`johnny-spore-chronicle`, v1, per save slot through the existing slot system; each
  moment keyed so it is recorded once; capped at 80 with the founding moments kept).
- Moments recorded: crawling ashore, each brain level, each migration, the creature trait, leaving the
  water (cell trait), founding the tribe (and where), each alliance and conquest, hut levels, the tribal
  victory. Saves from before the chronicle are seeded once from what they prove (cell trait, regions
  reached, brain level, creature trait, tribe founded, tribal victory).
- Continuity: the tribe settles in the species' home region (coast, forest, swamp, badlands or volcanic),
  keeps it in its save (v2 `region`), uses the creature design and name, and reads the cell and creature
  cards. The help sheet lists the legacy.
- Species history screen: the Tribe slot is live (settled count, then the earned trait), plus a Legacy
  section and the Chronicle timeline. Opened from the tribe's ☰ menu (📜 Species history) as well as the
  other stages; closing it resumes the stage.

### Phase 3 — not completed (recorded, not silently dropped)
- No side-by-side comparison of two generations (the lineage strip shows each design and its record).
- The chronicle lives in localStorage like the other saves; moving all saves into IndexedDB universes is
  part of the Galaxy & Save Universe update (the chronicle format was kept self-contained for that).

### Phase 3 tests
- Unit: 85 passing; lint clean.
- Browser, phone 390×844: fresh creature start → migration to the forest → Tribal Stage settles in the
  forest with Forager + Predator legacy (axe shack built, legacy listed); alliance recorded; history
  screen opened from the tribe menu (track, legacy, chronicle) and closed back into the game; an old save
  without a chronicle gets one seeded on reload; tribes founded in volcanic, badlands and swamp (valid
  fishing spots and building ground, region saved; volcanic checked visually through the real menu path,
  Adaptable hut level 2). No page errors. Not playtested by a human.

## Galaxy, Save Universe & Sporepedia update (done)
Spec: `docs/galaxy-update-spec.txt`.

### Architecture
- `galaxy/names.js`, `galaxy/gen.js`: one seed → the galaxy (1,400 stars in four spiral arms and a core,
  six star kinds incl. binaries, names, sectors). Lazy levels with their own sub-seeds: a star's system
  (planets, orbits) when opened; a planet's ecosystem when explored. Coherence: star light + orbit →
  temperature; temperature + water → type; no air → no life; plants → grazers (≈1 per plant) →
  predators (≈1 per 3 grazers); gravity changes leg length; biome palettes recolour creatures. Every
  organism is made by the creature stage's own species generator (real parts, anatomy, diet). 14 planet
  types, atmospheres, hazards, resources, moons, rings, habitability; terraform/colony fields stored for
  later stages. Galaxy ≈ 9 ms; an ecosystem ≈ 5 ms.
- `galaxy/planet-art.js`: deterministic painted planet portraits (continents, oceans, ice caps, gas bands,
  clouds, atmosphere, rings), cached; plant drawings by type.
- `universe/model.js` (pure): universe metadata, card summaries, export format (`johnny-spore-universe`
  v1) and import validation. `universe/store.js`: IndexedDB (meta, parked, pedia) with a memory fallback.
  `universe/manager.js`: boot + migration of old save slots, park/activate (commit verified before any
  localStorage key is removed; a failed load rolls back), create, duplicate, rename, delete (never the
  one in play), export, import (always a new universe). The game in play still uses its usual keys, so
  the stages are unchanged; settings stay shared.
- `pedia/model.js` (pure): entries, discovery rules (first time only; ordinary plants catalogued quietly;
  rare/dangerous/extreme/unusual firsts logged), planet status (undiscovered → discovered → explored →
  catalogued), favourites, renames, recents, search/filter/sort, compare rows, entry export
  (`johnny-spore-creation` v1, ready for online sharing later). `universe/session.js`: the runtime
  universe (lazy galaxy, Sporepedia saved shortly after each change and on page hide, exploration, play
  time, discovery notifications).
- Screens: `galaxy/ui.js` (map with drag/pinch/wheel/keys, star sheet, animated system, planet sheet,
  surface surveys), `pedia/ui.js` (+ `pedia/preview.js` 3D turntable), `universe/ui.js` (cards, create
  with optional seed, play, rename, duplicate, export, import, delete with a confirmation naming what is
  lost). Opened from the start screen, Settings, and the Sporepedia/galaxy cross-links.
- Integration (`main.js`): each universe has a home world (found from its seed) where the species lives;
  every generation (cell and creature, with designs), the player's species (traits, homeworld, timeline
  from the chronicle, generations), the chronicle as Evolution entries and the tribe's village are kept in
  the Sporepedia; the universe card shows the latest design. Creations reopen in the creature editor as a
  sandbox (saved as a new creation; the game in play is untouched).

### Not completed (recorded, not silently dropped)
- No landing on planets: exploration is the survey interface the spec asks for "for now".
- Plants are drawn as stylised portraits, not 3D; there is no plant editor yet to reuse them in.
- Cell-stage generations have portraits but no 3D turntable (cell designs use a different body format);
  creature generations and species turn in 3D.
- A "global collection" across universes is not built (each Sporepedia is per universe, as required).
- Galaxy-wide stats such as "discovered by" are always "You" (no online backend).

### Tests
- Unit: 99 passing (galaxy 5, universe model 3, Sporepedia 2, universe manager 4 incl. a storage-full
  rollback, plus all earlier suites). Lint clean.
- Browser, phone 390×844: start-screen links; galaxy map (zoom buttons, drag, home), star sheet, system
  (planet list), planet sheet, surveys with notifications; species detail with 3D turntable; universes:
  rename, create with seed 12345, independence (separate saves and Sporepedia), switching back intact,
  duplicate, export (downloaded file), delete with confirmation, import, refused bad file; old save slots
  migrated into universes in the browser; galaxy opens in ~10 ms; full cell → creature (4 migrations) →
  reload → tribe regression.
- Browser, desktop 1280×720: galaxy side panel, a planet surveyed to "Fully catalogued", Escape steps back
  out, Sporepedia search/sort/favourite/rename/compare/recent, sandbox editor from an owned creature.
- Fixed during testing: global `header` styles hid the screens' top bars in creature mode (now `div`s); the
  detail page sat under the list header; duplicate/export gave no feedback (now progress messages and
  disabled buttons); tabs overflowed on desktop (now wrap); survey order now mixes landmark/plant/creature.
- No page errors. Not playtested by a human.
