# Browser tests

End-to-end tests that drive the real game in headless Chromium (software rendering), through the debug hooks
that exist only when the page is opened with `?debug`. They need `playwright` (with its Chromium) and
`three@0.160.0` installed where Node can find them (`npm i playwright three@0.160.0`). No server is needed: the harness
serves the repository through Playwright's request routing and points the `three` CDN import at the local copy.

    node tests/e2e/e2e-civ.cjs            # one suite; prints PASS/FAIL lines and "n/m passed"

| Suite | What it covers |
|---|---|
| `e2e-progression` | Cell → Creature → Tribal → Civilization: transitions, homeworld/biome/species continuity, saves, resuming, corrupted saves |
| `e2e-planet` | The homeworld profile shared by every stage, persistence across reloads |
| `e2e-civ` | Planet, camera, selection, orders, routes, spice, level of detail |
| `e2e-civ2` | Touch (iPad and phone sizes), layout, saves and old saves |
| `e2e-civ5` | RTS controls, formations, combat, production, vehicle designs |
| `e2e-civ6` | City planner, economy, three conquests, diplomacy, offers, rival AI, victory |
| `e2e-regress`, `e2e-gameplay`, `e2e-batch3`, `e2e-pack` | Creature Stage: abilities, mouths, Social/Combat modes, combat AI, packs |
| `e2e-editor`, `e2e-touch`, `e2e-progress` | Creature editor, touch, unlock progression |
| `e2e-eco`, `e2e-eco-entry` | Ecosystem library browser and its entry points |
| `perf-stress` | Frame cost with 70+ vehicles, camera sweeps, GL memory (prints numbers, no pass/fail) |

The software renderer is slow, so the tests drive the simulation by calling the stage's `update(dt)` directly and wait on
conditions, not fixed delays. They are not a substitute for trying the game on a real iPad.
