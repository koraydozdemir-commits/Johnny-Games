# Civilization Stage overhaul — batches 1 & 2: the planet, and the village becoming a city

This is the first part of the Civilization Stage overhaul. The spec asks for nine batches, built and tested one at a time so the game stays playable after each. This update covers **batch 1** (spherical planet, camera, atmosphere, coordinates) and **batch 2** (village → city, city hall, buildings, roads, population). It also moves all of the existing Civilization gameplay from the flat island onto the globe, so the stage is fully playable right now.

## Tribal → Civilization, automatically

- When every one of the other five tribes is **allied or conquered**, the Tribal Stage shows a toast with your path (Diplomatic / Industrious / Warlike). After four seconds it plays the village-to-city cutscene and opens the Civilization Stage. The "won" sheet no longer stops you there.
- A save whose tribal game was already won (from before this change) goes on to Civilization shortly after it loads.

## Batch 1 — the planet

- **`civ/planet.js`** (pure, unit tested): a seeded spherical world with radius 200. It has continents and oceans from fractal noise, mountain ridges, biomes (deep sea, sea, shallows, beach, grass, forest, desert, tundra, rock, snow), city flattening, and a navigation graph (a 10,242-node icosphere) with land and sea masks, connected landmasses and oceans, and A\* routes. Land routes stay on their continent and avoid high mountains. Sea routes stay in their ocean. Air flies straight.
- Every planet has **at least two real continents**. A seed that would give a single supercontinent gets nudged the same way every time, so there is always somewhere overseas.
- The planet comes from the **homeworld** when a universe is loaded (its terrain, water, sky and vegetation colours). Otherwise it comes from the tribe's region. The seed is saved, so the same planet comes back every time.
- **`civ/globe.js`** draws it: a vertex-coloured terrain sphere (detail 6, or detail 5 on low quality), a sea sphere, instanced forests, an atmosphere glow at the limb, a drifting cloud layer that fades as you come down, stars, and a sun that goes round (a 7-minute day). The day starts at noon over your capital.
- **Camera:** one continuous zoom from the whole planet down to street level, with no cuts. The view tilts toward the horizon as you come down. You can **drag** to turn the planet, **pinch or scroll** to zoom, **twist two fingers** (or Q/E) to rotate, and use WASD or the arrow keys to pan. **F** follows a selected vehicle. The new **🌍 Planet** button jumps between orbit and the ground.
- **Arrival:** the stage opens with a descent from orbit onto your new capital.
- **Territory:** each city's land is tinted in its owner's colour on the globe, with a stronger line at the border. It repaints when a city changes hands.
- **Night and distance:** cities glow with lights on the night side. From orbit each city shows a beacon in its owner's colour, and labels behind the planet are hidden.

## Batch 2 — village → city

- Your capital is built **where your village stood**. It uses your village's own pieces (shelters, stores, racks, gardens, decorations…), built with the Tribal Stage's village builder in your species' style and squeezed inside the new walls. The chief's hut stays beside the new **City Hall** as a monument.
- Each building you put up **replaces** the village pieces on its plot. New buildings and turrets **rise out of the ground**.
- **Roads** run from the hall to every building and turret, plus a gate road toward the nearest neighbouring city. They start as dirt and become paved once a city reaches six buildings and turrets.
- **Citizens** walk between the hall, the buildings and the plaza when you're close. How many you see depends on the city's population. Your own citizens wear your creature's colour.

## The old gameplay, on the globe

The rules are the same and unchanged in `rules.js`: three ways to take cities, spice, diplomacy, rival AI, superweapons and designs. What changed is that everything now stands on the sphere:

- There are 11 cities: yours, about three more on your own continent, and the rest overseas. Each rival nation holds two, and the rest are independent. There are 12 spice geysers.
- **Reach rules:** land vehicles can't leave their continent, boats need a coastal city and stay on their ocean, and aircraft go anywhere. An order a vehicle can't carry out is refused with a toast that says why. Rival nations build more boats and aircraft when they have nobody left to reach by land.
- Vehicles drive along the routes, turn smoothly, and never drive into the sea or onto land. Explosions and shots work as before. Taking a city rebuilds it in the new owner's colours.

## Saves

- The save format is now **version 2**. It adds the planet seed, the time of day, and each vehicle's position on the planet.
- **Version-1 saves (flat island) still load.** They keep their cities, buildings, money, nations, designs and captures in the same order. Their vehicles come back at their home cities. Nothing is erased.

## Not in this update (later batches)

3 vehicle creator expansion · 4 RTS controls polish · 5 conquest strategies depth · 6 leader communications · 7 diplomacy personalities · 8 world events and notifications, plus a planet minimap · 9 unification victory sequence.

## Tests

- `tests/civ-planet.test.mjs`: frames, offsets and steps; determinism; continents, city spacing and harbours; land, sea and air routes; flattening.
- `tests/civ.test.mjs`: version-2 save fields (seed, clock, vehicle directions) and version-1 compatibility.
- Browser checks (headless Chrome, mobile viewport):
  - The tribe-to-Civilization auto-advance and cutscene.
  - Arrival and the heritage village.
  - Building on a plot.
  - Reloading onto the same planet.
  - Planet view and dragging.
  - A land capture.
  - A boat staying at sea between ports.
  - An aircraft trading overseas.
  - Tapping a city on the globe.
  - No page errors.
