# Cell stage look overhaul

Branch `cell-look` (not yet merged or pushed).

- **Water** (`gfx/ocean.js`): depth gradient, slanted light shafts, faint caustics, hazy distant cells, three layers of glowing plankton. Takes the homeworld's water colour via `setPlanet`.
- **Whole-screen look** (`gfx/post.js`): bloom, soft edges with a little colour split, teal/warm grade, vignette, faint wobble, grain. Red edge flash when the player is hurt, soft green pulse when eating.
- **Cells** (`gfx/cellskin.js`): see-through jelly skin with an inked cartoon rim and glossy highlights, a bioluminescent aura, and real 3D organelles (nucleus, vacuoles, mitochondria, Golgi, ribosomes). Other cells get a lighter set (nucleus, one vacuole, one mitochondrion) unless on high quality.
- **Quality**: low keeps the original background and plain render; medium and high use the new look. The cell editor keeps the original look so handles and painting stay readable.
- **Glow speckle fix** (`gfx/soft-textures.js`): iOS canvases corrupt the faint edge of soft gradients into coloured speckle. Glows are now built from raw numbers (DataTexture): background glow/plankton, city lights (Civilisation), the intro/galaxy glow.
- `Spore.html` import map gains `three/addons/`; the dev check scripts serve those files from node_modules.

Still on canvas gradients (not seen to speckle yet): nebula/cloud puffs in `galaxy/start.js` and `galaxy/ui.js`, creature eyes, orb pickups.
