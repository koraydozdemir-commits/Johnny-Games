# Johnny Games Spore — Tribes and Tribulations

Spec: "Tribes and Tribulations: Complete Tribal Stage Overhaul" (Nov 2026). Earlier work:
`docs/progression-update.md`, `docs/consequences-update.md`. Goal: **the tribe feels alive even when
the player does nothing**, without turning the stage into a city builder.

## 1. Audit (start of the update)

| Area | Already there | Gap |
|---|---|---|
| Food | Fruit from bushes, fishing spots, hunting two grazer herds, carcass hauling, one food stock, upkeep 1/adult/min | No foraging; no tree fruit; no dangerous prey; loads invisible; pile of identical spheres |
| AI | Player orders per member; roles free / gather / guard; rivals with raids, war parties, traders | Free members stood still; no routines, social life, sleep, work, training, patrols |
| Village | Chief's hut (3 levels), placed tool shacks, dwellings, totem, banner, flowers, one fire | Nothing grew by itself; nothing reflected the species beyond hut colour and shape |
| World | Day/night clock in `world.js`, fruit trees that can be shaken | Tribal Stage ignored the clock |

## 2. What was built

### New modules
- `tribe/life.js` (pure, 15 tests): food sources by diet, **jobs** (Unassigned, Hunter, Gatherer,
  Fisher, Defender, Worker — `free`/`gather`/`guard` keep their old ids), **food priorities**, the
  day phases, food mood, **activity weights** (what an idle member wants to do), expedition rules,
  the **village plan** (what the village builds at a population), **species style**, the tribe's
  **character** (Fierce, Peaceful, Watchful, Prosperous) and save parsing for the new fields.
- `tribe/village.js`: everything the village builds for itself, in the species' style; the food
  store; forage patches; campfire seats; loads carried on members' backs; the list of solid things
  members walk round. Static parts of each building are merged into one mesh per material.
- `tribe/villagers.js`: the autonomous life of your members, parties and reactions.

### Food gathering
- **Four activities, one store.** Hunting, fishing, fruit and **foraging** (mushrooms, roots, nuts and
  edible plants for plant eaters; grubs and eggs for meat eaters) all feed the same `T.food`.
  Diet rules are unchanged (plant eaters don't hunt, fish or touch carcasses; meat eaters don't pick fruit).
- **Visible work and loads:** crouching at the waterline then a lunge, a fish leaping into the
  fisher's grasp; tree shaking when bushes are bare, picking fallen fruit off the ground; digging at
  forage patches; butchering. Every load (fruit, fish, meat, mushrooms, roots, nuts, herbs, grubs,
  eggs, stolen loot) rides on the carrier's back until it reaches the store.
- **Hunting with risk:** a third herd of **big game** (huge horned grazers, 150 hp, 30 meat) far inland
  turns on its attackers and gores them. The tribe only goes after it in a party of three or more.
- **Autonomous gathering** with start → work → return states; one load per trip, then a new decision.
  Members spread across sources (crowding lowers a choice's weight), patches are claimed, fishing spots
  hold three, unreachable or bare targets are marked and skipped for a while.
- **Food store** (replaces the pile): baskets, then a drying rack, then a granary on stilts as the tribe
  grows. Its contents show the actual supply and the kinds of food recently brought in; baskets tip over
  and the rack is bare when stores run out.
- **Balance:** autonomous gathering drives hard when food is short, eases off at "plenty" (6+ minutes of
  food), and almost stops when full (12+ minutes): stores level out instead of running away.

### Player control (🧭 Tribe button, new)
- **Food priority:** Balanced / Hunting / Fishing / Fruit / Foraging (only the ones the diet allows).
  It steers unassigned members and workers strongly, other food jobs mildly; nobody ignores danger.
- **Everyone back to the village:** recalls every member and keeps expeditions home for 45 seconds.
- **Jobs** with − / +, moved here from Build. Assignments are priorities: anyone defends the village.
- **Right now:** a live tally of what the tribe is doing. Member chips also show each one's activity.
- Orders still come first: a member you send somewhere stays there 25 seconds before resuming its life.

### Living tribe members
Idle members choose from: work (repairs first, crafting at the workbench, carrying supplies, tending
the fire, tidying), training (dummy practice, sparring in pairs, weapon drills), patrols round the
village, keeping watch (sweeping the horizon, from a lookout if built), chatting in small groups (turns
talking, gestures, laughs), the campfire (sitting, eating, singing, dancing, warming up), resting at
the shelters, play (chase with tagging, play fights), sleep at night in the village's own shelters, and
investigating strangers or big game that wander close. New rig moves: **talk, eat, dig, wave**; new
emotes: chatter, sleep, alarm, worry.

### Day and night
Loose routine from the world clock: work by day, home and the fire in the evening, sleep at night with
defenders keeping watch. The village fire burns higher and lights the huts at night. Rival tribes keep
the same hours (round their fire, then asleep by their hut).

### Reactive village
Danger wakes the village: an alarm, everyone up, workers drop food runs within 65 m and come back,
defenders and the armed form up between the danger and the village, the rest close in, children and the
badly hurt shelter by the huts. Members help any of their own who are attacked (fights they joined on
their own are given up if they drag them 24 m off). Hunters home with meat are met by the village;
the chief coming home is welcomed; a hatching draws a little crowd; alliances and conquests bring
everyone out; a plentiful evening becomes a feast. Food shortage shows as worried members, slower
walking and an empty store. No new pop-up text was added for any of it.

### Group expeditions
Hunting parties (big game needs three or more) and forage trips to a rich grove far inland travel
together (followers fall in behind the leader) and turn for home when it gets dark, when there's
danger at home, when anyone is badly hurt, after about two minutes, or past 120 m.

### Village development and identity
- **Automatic:** shelters (one per two or three members beyond what the hut and dwellings sleep; tier 2
  and 3 with the hut), the store (3 tiers), seats round the fire, a weapon rack showing the tribe's
  actual weapons, a workbench (5+), a training ground (8+, or 5+ for a fierce or watchful tribe),
  fence runs with gaps (9+), trophies from big hunts, gardens for plant eaters, a gathering ring for
  social tribes, decorations by population. Positions are saved; a reload rebuilds the same village.
- **Optional (Build):** Lookout, Garden (a forage patch the tribe tends) and Dancing ground, besides
  the existing dwellings and decorations.
- **Species style** from the creature itself: diet and fighting parts (predators: hide tents, skulls,
  trophies, stake fences), plant eaters (leaf domes, turfed dens, gardens, hedges), social species
  (streamers, drums, lanterns, gathering ring), armless species dig **dens** instead of building,
  spiky species add thorns, body size scales and spaces everything (small: compact and packed close;
  large: big and spread out), tall species build taller, and the creature's own colours paint roofs,
  bands, ribbons and banners.
- **Character** from how the tribe lives (kills, conquests, songs, gifts, allies, guard time, repairs,
  defended raids, time in plenty, births, feasts) shifts decorations, training and patrol frequency,
  social life, and shows in the Tribe sheet.

### Navigation and performance
- Members steer round huts, shacks, shelters, fences, the fire and rival huts and are pushed out if
  they clip one. Anyone walking without progress sidesteps; after three tries it gives up (a food run
  is marked unreachable for a while; an order ends with a "?").
- Decisions on staggered timers (0.4 to 1.4 s), shared state twice a second, personality every 5 s,
  village growth every 4 s. Bodies far from the camera switch to low detail.

## 3. Save compatibility
New fields (`priority`, `culture`, `auto`) are optional; old saves gain defaults. Roles keep their
old ids. A version-1 save and a pre-update version-2 save (damaged hut and shack, old roles,
dwellings) were loaded and played: both ran clean, and the older tribe repaired its own buildings.

## 4. Tests
- Unit: 228 passing (15 new in `tests/life.test.mjs`). Also fixed two failures that predated this
  update (settings test missing the music volume; `Audio` not declared for ESLint). Lint clean.
- Browser (Playwright, headless Chrome, phone 390×844 touch and desktop 1280×720), simulated play:
  - 12 members, full day: all four sources delivered; nobody inside a building or stranded; food rose
    from 40 to "plenty" (~110–140) and levelled off; evening: 11 of 12 at the fire; night: sleeping
    with a watch.
  - Night raid: all sleepers woke, 8 fought, no losses. Daytime Warriors raid: 3 losses (original code
    in the same scenario: 1–3).
  - Fish priority: unassigned members fishing went from 0% to 38%. A Fisher fished 49 of 60 samples; a
    Defender patrolled, worked and kept watch.
  - Big game: a party of 3 set out, the beast turned on them, fell in 45 s, no losses, trophy counted.
  - Grove: a 3-member forage expedition; nobody left outside the village at night.
  - Lookout, garden and dancing ground placed; the garden became a forage patch; an order to move was
    kept; "Everyone back to the village" brought 9/9 home with no food runs left out.
  - Save → reload: same village pieces in the same spots, priority, culture and roles kept.
  - Three species side by side (herbivore, predator, armless omnivore) plus a small and a large
    species produced visibly different villages.
  - 26 members: 1.7 ms average per update (logic only). The village adds about 250 meshes at that size
    (down from about 450 before merging).
  - Creature Stage smoke test with the extended rig and emotes: clean.

## 5. Not done (recorded)
- Not playtested by a human or timed on a real phone; the software renderer used for tests says
  nothing reliable about frame rate.
- The tribe's character is a light layer (decor, weights, a line in the Tribe sheet), by design.
- Population shrinking doesn't tear buildings down: an empty shelter stays.

## 6. Follow-up patch: minimap and the founding cutscene
- **Tribal Stage minimap** (bottom right; reuses the Creature Stage map): every rival village coloured
  by relations (green allies, orange wary, red at war, crossed out when conquered), your village, your
  members, and raiders (on the rim when off the map). Tap for the labelled island map.
- **Creature → Tribal cutscene, timed to "Founding A Tribe"** (134 s: 120 s stick throw + 13 s
  campfire, plus loading): the family gathers; the stick is picked up, held high and thrown; it climbs
  into the sky and hangs there turning while **the sun's glare** (a blazing disc behind the stick, a
  wash, a streak and lens-flare rings) fills the picture, cutting between the sky, the thrower's
  upturned face, the watching family and a view from above; then it falls **straight back onto the
  thrower's head** (a flash of the hit, 💫, a dazed wobble, the family's reaction), it shakes it off
  and poses anyway; white-out into the campfire. Starts in the morning so it stays daylight. Skip
  still works throughout; the song plays on into the Tribal Stage and hands over to its theme.
