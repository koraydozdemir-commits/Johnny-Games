# Johnny Spore — Pre-Space Polish & Completion Update

Spec: "Pre-Space Stage Polish & Completion Update" (Nov 2026). Earlier work: `consequences-update.md`,
`progression-update.md`, `civ-*-update.md`, `soundtrack.md`.

## 1. What was already there (audit)
| Area | Already working | Gap found |
|---|---|---|
| Consequences | Cell diet card, 8 creature instincts (Creature and Tribal stages), tribe path, civ card, chronicle per universe | Civilization only read the old 3-colour creature card; no species-wide identity; chronicle trimmed turning points away |
| Species History | Evolution track, character, chronicle, lineage | No heritage view; chronicle one flat list |
| Civilization | Planet, cities, vehicles, diplomacy, trade, spice, victory, Keep playing, history button | **No minimap**; "world news" only from rival AI diplomacy, **no world events** |
| Galaxy | Galaxy start screen; New Game picks a star; Continue resumes the universe in play | Other saves only reachable through Load Game · Universes |
| Saves | Universes isolated in IndexedDB; import/export/duplicate; old slots migrated | — |
| Music | R2 soundtrack, two decks, crossfades, iOS unlock, per-stage tracks, volume persists | Civ war theme followed chronicle keys: turned off by one peace while another war went on, and stayed on after an enemy fell |
| Cell | Automatic growth, mating any time | Very long cells could fail to reach a mate (centre-distance check only) |
| Creature | Fossil fix, scaled carcass reach | Carcass/fruit picked the first in the list, not the nearest; fruit reach ignored body size |

## 2. What changed
### Consequences (`heritage.js`, pure and tested)
- **All eight instincts reach Civilization**, each with one upside and one downside, using existing modifiers:
  Apex (vehicles +12% damage, nations 8 warier) · Pack Hunter (+6% damage and health, trade/preach −5%) ·
  Territorial (turrets +25%, trade/preach −5%) · Symbiotic (nations 12 friendlier, trade +5%, damage −6%) ·
  Nurturing (happier cities, income −3%) · Elusive (vehicle health +12%, damage −6%) · Adaptable (income +6%,
  trade +3%, turrets −10%) · Scavenger (derricks +15% spice, nations 5 warier). A test keeps them balanced.
  Old saves without an instinct fall back to the classic card's bonus.
- **Rival leaders remember you**: their greeting adds a remark on your instinct (or your tribe's path).
- **Species identity**: diet → instinct → tribe → unification as tags and one summary sentence.
- **Turning points** (instinct earned, how the tribe won, how the world was united, with counts) are recorded
  as major chronicle entries; the victory entry now lists cities taken by force, bought and converted.
- Chronicle holds 120 moments and never trims founding moments or turning points.

### Species History
- New **Heritage** section: summary, stage tags, and what is carried into Civilization.
- The chronicle is a timeline in chapters (Cell / Creature / Tribal / Civilization); turning points stand out.
- The victory screen adds the species' lineage sentence.

### Galaxy as the save screen (`galaxy/start.js`, `main.js`)
- A **Your species** strip under the logo: every saved species (one per universe) with portrait, name and
  stage, plus **New species**. Each species' home star wears a ring in its stage's colour; tap the ring or the card.
- Choosing a species switches to its galaxy, flies to its home star and opens a panel: portrait, name, stage
  and detail, progress along Cell → Civ, identity tags, homeworld, universe, last played, time played, **Continue**.
- Continue on another species saves the game in play, swaps universes with the existing `activate()` (verified
  write before anything is removed), reloads and **goes straight back into that species' game**.
- New species always gets a galaxy (universe) of its own. "Load Game · Universes" is now **Manage universes**.

### Civilization
- **Planet minimap** (`civ/minimap.js`): an orthographic globe of the hemisphere in view (turns with the camera):
  land and sea in the planet's colours, cities and territory by owner, your capital, vehicles, derricks,
  attacked cities pulsing red, rings where world events happened. Tap to fly there. Folds to a button (remembered).
- **World events** (`civ/events.js`): spice shortage, economic boom, natural disaster, political unrest, rival
  expansion, diplomatic breakthrough, trade opportunity, cultural movement, military tensions, change of heart.
  Weighted by the world (unrest needs an unhappy city, tensions need two rivals…), first after 4 min, then every
  ~3–5 min, never twice in a row. Real effects; a flash on the planet, a card with Look, the news, and (for
  disasters and breakthroughs) the chronicle. Saved; old saves load without any.
- War music now follows whether you are actually at war.

### Fixes
- Cell: mating also measured surface to surface, so long cells reach their mate.
- Creature: the nearest carcass or fruit in reach is chosen; fruit reach grows with body size.

## 3. Tests
- Unit: **263 pass** (new: `heritage` 6, `civ-world` 5; chronicle cap test updated). Lint clean.
- Browser (`dev/browser-check.mjs`, headless Chrome, repeatable; also a non-blocking CI job): **53 pass** at
  phone 390×844, tablet 820×1180 and desktop 1440×900 — galaxy opens; both species listed; 44 px targets;
  panel details; galaxy switches seed; home marked; no overlap; Continue loads the other universe and resumes;
  other species' save untouched; Civilization reads Pack Hunter (not the old card); Warlike tribe → military
  start; greetings carry history; Species History heritage and turning points; minimap drawn and tap-to-fly;
  disaster damages a city and reaches the news; boom raises income; no page errors.
- Screenshots checked at phone, landscape phone and desktop (minimap moved below the top bar in landscape).

## 4. Known issues / not done
- Not tested on a real iPhone: Safari behaviour was checked in Chrome's mobile emulation only.
- Environmental storytelling beyond the event flashes and minimap (e.g. visibly declining cities) not added.
- Tribal and Creature stages were audited by reading code; no new villager behaviours were added.
- Space Stage: unification is recorded and the victory screen says Space comes later; nothing more is built.
