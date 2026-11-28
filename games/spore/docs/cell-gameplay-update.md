# Cell stage gameplay update

Branch `cell-look` (on top of the graphical overhaul). Verified: eslint, 304 node tests, and a headless browser run that grows the cell a stage with no console errors. Not tried on a real iPad.

## Movement parts (cell/movement.js, shared by the player and every other cell)
- **Flagellum**: pure constant speed. Highest top speed, no surge-and-glide stroke, turns wide.
- **Cilia**: grip. Faster turning, snappier acceleration, a little extra speed.
- **Jet**: no longer an ability. It fires short bursts by itself while the cell is swimming. The Space key, boost button and stamina bar are gone.
- Cells have inertia: they take time to speed up and to turn (turn speed builds up), and slide a little after you stop pushing.
- The flagellum model is about half its old size.

## Combat parts
- **Electric**: a crackling field around the cell with lightning to everything inside it. It shocks on a tick and every few seconds an overload pulse stuns and shoves everything in range.
- **Poison**: a gland that releases drifting clouds behind the cell. Anything inside takes damage over time and prey panics. More glands, bigger and nastier clouds.
- **Spikes**: thorns hurt a cell that bites you, and ramming with spikes hurts more the faster you swim.
- **Armour** is now a percentage reduction instead of a flat amount.
- Other cells carry the same parts and use them the same way, including against you.

## Cell AI (cell/brain.js)
- Stamina: sprinting drains it, an exhausted cell is slow. Chases can be won or escaped by outlasting.
- Predators give up: after a limit, when you are out of sight, or when worn out, they lose interest for a few seconds and wander.
- Predators lunge: a short committed charge in a straight line when close and facing you. A well-timed sidestep makes it miss, and it needs a moment to recover.
- Prey curve away and sidestep a lunge instead of running in a straight line.
- Predator bites are much stronger (more for jaws, lunges and spikes) and cells have roughly double the health.

## Growth
- Stage sizes are now 1 / 2.3 / 4.8 / 9.5.
- Cutscene in three beats: the camera pulls right back, you swell far bigger than anything around you, then the camera settles a little closer than before.
- Last stage's cells are **mini-cells**: swallowed whole in one bite, no meat.
- The next stage's giants shrink to your size, and a new wave of three giants arrives when the growth ends.
- Food grows with you (less than you grow), speeds scale with size, camera zoom scales per stage.
- Old saves are lifted to the new stage size when loaded.

## To tune by feel
Poison and electric damage numbers, predator bite damage, giant boost (1.25), how fast the biggest stage swims compared with the screen size.
