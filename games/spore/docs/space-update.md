# Johnny Spore — Space Stage (first playable)

Page: `games/Spore Space.html`, code in `games/spore/space/`. Reached from the Civilization victory card
("Go to Space"); "Back to Spore" on its title screen returns.

## What is in it
- **Flying**: the Peis system in 3D (planets, rings, belt, comet, cities), ship, autopilot, laser, mining beam, photo mode.
- **Star map**: all 38,900 stars of the main-menu galaxy (seed 77) are visitable systems (ids 0-1399 are the named stars
  from `space/galaxy/gen.js`; 1400+ are the menu's stars from `space/backdrop.js`, same rng so positions match).
  The view stays anchored to the ship. Only stars inside the drive radius can be selected; each jump is one direct hop,
  takes seconds, costs charge and is followed by a short unannounced pause. The galaxy is spread 2.4x wide.
- **Empires** (`empires.js`): 43 species plus the Keis at the core (not marked). Radio signals show on the map only
  for empires near the ship. A hail card over the minimap (species picture, name, radio) appears in an alien system.
- **Communications** (`comms.js`, `portrait.js`, `voice.js`): Spore-style screen; the portrait is the empire's real
  species built with `creature/body3d.js` and talks while the voice (R2 `Spore OST/<Archetype> Voice.mp3`) plays.
  Your lines are spoken replies in your archetype's voice. Relationship uses the five creature-stage faces.
  Trade, Diplomacy (compliment once), Missions (pay 0.5x at worst to 1.4x at best, never refused), Repair, Recharge,
  drive upgrades (3 levels), contact with your own empire (from your home system).
- **Your species**: `player.js` reads the Creature Stage save (`johnny-spore-creature-stage`) for your portrait and name,
  and turns your instinct into an archetype (apex→Warrior, pack hunter→Knight, territorial→Zealot, symbiotic→Ecologist,
  nurturing→Diplomat, elusive→Explorer, adaptable→Trader, scavenger→Scientist).
- **Danger** (`raiders.js`): pirates in about a third of empty systems and warships of empires at war with you.
  Hull at zero tows you home (hull 40, 15% of credits lost). Hunt jobs pay for clearing them.
- Music: SpaceTheme1 and SpaceTheme2 stream from R2 and duck while someone speaks.

## Saves
`johnny-spore-space-test` (flight) and `johnny-spore-empires-test` (relations, credits, hull, charge, drive level).
These are not yet part of the slot/universe save system (`slots.js`): they are not parked per slot.

## Not done / next
- Archetypes are ten stand-ins in `empires.js`; species are generated per empire seed, not from the universe.
- Home star is Peis (id 1046), not the universe's chosen home star (`galaxy/start.js`).
- The Space galaxy generator (`space/galaxy/`) carries the arm shaping the main menu uses; `galaxy/gen.js` on main
  predates it, so the two should be merged.
- Planets (colonising, terraforming, abducting), black holes, a Keis chase, branching conversations.
- Not tested on a real iPad (38,900 stars plus the 2.4x galaxy are the performance risk).
- Not in `sw.js`/`games.json`: it is only reached from the Civilization victory card.

## Tests
`tests/space.test.mjs` (galaxy determinism and every star real, empire homes and territory, relations and bands).
