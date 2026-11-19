# Johnny Games Spore — Progression & Immersion Mini-Update

Spec: "Progression & Immersion Mini-Update" (Nov 2026), with the owner's screenshot of Spore's brain
growth (a rounded grey bubble beside the head, a dotted line to it, a small brain inside; the final
growth breaks out of the box). Earlier work: `docs/consequences-update.md`.

## What changed

### Cell Stage
- **Automatic mini-stages.** A full growth bar now grows the cell into the next stage by itself: no
  mating, no editor. The world is kept (no reset): the next stage's giants become equals and last
  stage's residents become prey; currents, clouds and meteors are topped up for the new stage.
- **Growth animation.** The cell swells over the first two thirds while the camera pulls back (so the
  cells around it seem to shrink), then settles in close at the new scale; growth sound, bursts, no
  bites mid-growth, one at a time. Gameplay size is the visible size every frame (collisions, reach,
  bites and AI all read `state.scale`). Reward parts are announced once it is over; if the page closes
  mid-growth, loading grants every reached stage's rewards.
- **Mating any time.** ♡ opens a new generation in the editor whenever you like; growth carries on.
- **The final stage needs a mate.** At 100% in the last stage, mating asks "Leave the water?" (no
  accidental transitions), then: trait card → surfacing → **Creature Editor** → the creature crawls
  onto land. (Older saves that already had the Land button keep it.)
- **Advanced cells.** Up to two of the next stage's cells roam each area. They hunt and bite (capped
  so they are dangerous, not unfair) but can't be hurt until you reach their stage ("Too big").

### Creature Stage
- **Automatic brain growth.** A full brain bar grows the brain by itself (mating not needed). Spore's
  presentation: a grey rounded bubble pops up beside the head with a dotted line to it; the brain
  swells inside in heartbeats while the camera closes in, and the creature's body grows with it. New
  mouths, the brain-level hint and (at brain 5) the instinct card come once the growth is over.
- **The final growth** (one more bar at brain 5) **bursts the box**: it cracks into four shards that fly
  apart and the glowing brain fills the space. Then the mate button reads "🔥 Mate · found a tribe".
- **Mating any time at the nest** opens a new generation in the editor; only the final one founds the
  tribe. The ☰ shortcut to the Tribal Stage now shows only once a tribe exists (or in developer mode).
- Saves sitting on a full bar grow on load; a brain growth still makes a migration due, as before.

### Cutscenes (letterbox, title, flash, Skip; saved before each starts)
- **Creature → Tribal: the stick.** At the nest, the family gathers in a half circle; the creature
  picks up a stick (in a hand if it has arms, otherwise in its jaws), raises it, and throws it high;
  slow motion at the top while the camera tilts up after it (filmed from the most open side so trees
  don't block the sky); white-out. In the Tribal Stage the stick falls out of the sky into the first
  campfire, the fire flares, and the camera circles the whole tribe gathered round it before settling.
- **Tribal → Civilization: the city rises.** Night falls on the village; one by one the huts and
  shacks rise taller and turn to stone, a wall with towers rises round the village and a banner tower
  where the fire burns; dawn, and the camera cranes up over the walled city; a cool white-out, then
  the Civilization Stage camera comes down out of the bright sky onto the capital.
- The stages' help panels wait until their arrival scene is over; Skip works throughout.

### Fossils
- **Five models:** a horned skull, a ribcage, a spine of vertebrae, a clawed limb and a toothed jaw,
  each with its own scale, rotation and mound size. Kinds come from their own seed and avoid repeating
  next to each other; the island layout and fossil spots are exactly as before (old saves' dug fossils
  still line up).
- **Tribal and Civilization stages:** no fossils at all (no mesh, marker, glint or dig spot).
- **The unearthing bug, found:** the Charge move's timer counted down past zero and stayed at a tiny
  negative number; digging required it to be exactly zero (`!charging`), so **after charging once,
  no fossil could be dug until a reload**. Fixed by clamping the timer and testing `<= 0`. Also fixed:
  a big creature could reach two fossils at once and dug whichever was later in the list, not the one
  under it; it now digs the nearest. Distance is measured on the ground (height plays no part) and
  reach already scales with body size and proportions.

### Developer menu
- The DEV tab is gone. **Tapping the credits line at the bottom of Settings seven times** (each tap
  within 1.5 s of the last) switches developer mode on for that browser; a Developer section then
  appears in Settings: jump to any stage; fill the growth or brain bar; the stick throw; the city rise;
  a rival, a lost youngster, a predator migration or a lean season on demand. "Turn off developer
  mode" hides it again.
- By the owner's choice there is no password: it is hidden, not secured (the game runs entirely in the
  player's browser and every tool only changes that player's own save).

## Tests
- Unit: 213 passing (new: cutscene timelines and beats; fossils: five distinct kinds, varied
  neighbours, none in later stages, layout unchanged and stable). Lint clean.
- Browser, phone 390×844 touch: Cell automatic growth (no editor, smooth swell), giants unhurt, mating
  any time (editor, same stage), final stage waits, confirm → card → Creature Editor first → crawl-out;
  brain growth 1→5 with the bubble, then the final burst; mate → stick throw → campfire → Tribal; city
  rise → Civilization arrival; five body shapes (tall, stubby, long, big, small) each dug a different
  fossil kind after charging; developer menu (no DEV tab, 6 taps nothing, 7 on, tools work, off again).
  Regression: ecosystem, encounters, old-save compatibility and desktop/Tribal suites from the previous
  update. No page errors.
- Fixed during testing: the old stage was rendered after handing over mid-frame; a reward card and a
  new-mouth card covered the growth moments; a global style turned the bottom letterbox bar into a
  rounded panel; the joystick showed during cutscenes; the stick was hard to see and trees blocked the
  look up; the Civ and Tribal help panels covered the arrival scenes; seven fast taps overran a fixed
  4-second window on slower devices.

## Not done (recorded)
- No new creature animations: picking up and throwing use the existing crouch, pose and bite moves.
- Not playtested by a human or timed on a real phone (tested in a software renderer, which runs the
  game clock at about a fifth of real speed).
