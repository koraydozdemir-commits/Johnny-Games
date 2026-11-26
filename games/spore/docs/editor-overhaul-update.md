# Johnny Spore — The Ultimate Creator Overhaul

Spec: "The Ultimate Creator Overhaul" (Nov 2026). Earlier work: `pre-space-update.md`, `civ-*-update.md`.

## 1. Audit: what was there
| Editor | Where | Had | Gaps |
|---|---|---|---|
| Creature Creator | `creature/editor.js` | Spine handles, leg/arm grips, catalogue with thumbnails and stats, mouth comparison, paint swatches, a basic test walk, undo | One long panel for everything; no Paint or Test modes; separate mouse/touch handling; a selected part only had sliders; no search or filters; symmetry not switchable; no drafts; no confirmation before losing changes; half the phone screen taken by the panel |
| Building / Vehicle / Spaceship | `creations/editor.js` | Palette, select and drag on the ground plane, nudge toolbar, roles, templates, three colours, stats from `modular.js` | Tap-to-add only (no drag onto the model); no stacking; one pinch/orbit handler; swatches only; no test preview; parchment look unlike the other editors |
| Cell Creator | `main.js` + `Spore.html` | A specialised 2D editor: build/genome/paint tools, drag-on parts, symmetry, stacking, undo/redo, live DNA and stats | Paint on phones meant a long panel over the cell with small swatches |
| Tribal Outfitter | — | **Does not exist.** Tribe members are the creature body holding a tool; there are no clothing or accessory parts, slots or unlocks | — |
| Creation library | `pedia/` (Sporepedia) | Categories, search, sort, favourites, lazy thumbnails, rename, compare, export, "Open in editor" (which saves the result as a new entry) | No duplicate or delete; no "last changed" |

Saves: creature records (`creature/format.js`, v1) and modular designs (`creations/format.js`) are unchanged in shape; both gained one optional field (below), so old saves load as before and nothing is migrated or rewritten.

## 2. The shared foundation (`editor/`)
- **`history.js`**: one undo/redo history for every editor. A drag is a transaction: one step however many frames it ran, none if nothing changed. Labels ("Undid move part").
- **`gestures.js`**: one Pointer Events recogniser for every 3D viewport. Decides before anything moves: a touch on a part drags it, on empty space orbits; two fingers pinch and pan (a second finger ends a part drag first); right/middle button or Shift-drag pans; wheel and trackpad pinch zoom; tap, double tap and long press. Cancelled pointers, lost capture and window blur end a gesture cleanly; `detach()` removes every listener.
- **`picker.js` + `color.js`**: the colour picker (big saturation/brightness pad, thick hue strip, 38 px swatches, recent colours, hex field on keyboards, arrow keys), HSV maths, creature colour schemes.
- **`drafts.js`**: autosave a moment after each change (debounced) under a draft key tied to the creation it started from; flushed when the page hides. Opening the editor on the same creation after a reload offers **Recover / Discard**. Saving or discarding clears it. Drafts never overwrite saved creations.
- **`catalogue.js`**: search (names, categories, abilities, diets; unseen parts stay secret), filters (all / unlocked / locked / recent), sorting (catalogue order, name, DNA cost, strongest).
- **`chrome.js`**: the phone drawer (peek / half / full, drag or flick the handle), in-editor confirmations, first-time tips (touch or mouse wording, "Don't show tips"), camera easing, iOS viewport tracking (`visualViewport`, keyboard), page-gesture guard scoped to an open editor.
- **`editor.css`**: one design system for all creators, scoped to `.edRoot`: soft glass panels, gold for selected/go, 44 px targets, `100dvh` with fallback, safe-area insets, `touch-action` per surface, reduced motion.

Layouts: **phones** get a top bar (back, name, undo, redo, Save), a status line (DNA/cost, saved state), a bottom mode bar (Build · Paint · Test · Parts · More) and the catalogue in a drawer; **phones on their side** a side catalogue with the mode bar along the bottom; **tablets in portrait** the drawer with the mode pill at the top; **wide screens** a side catalogue, full stats on the right and the mode pill over the view. The creation is always framed in the free part of the screen.

## 3. Creature Creator
- **Build**: spine handles; a girth grip on the selected vertebra; **Quick shape** (length, bulk, head, rump, arch: one tap each) for players who'd rather not move vertebrae. Drag parts from the catalogue (touch: hold, then drag); they snap to sensible spots and can be dragged anywhere on the skin. A selected part gets a floating toolbar (**Copy**, **Mirror/Single**, **Adjust** for exact numbers, **Delete**) plus the size and turn grips; long press opens it with a nudge, double tap opens Adjust. Selecting a part on the body jumps the catalogue to its card.
- **Symmetry**: on by default with an obvious ON/OFF switch. Off, new flank parts are one-sided; any part can be switched between mirrored and single. Stored as `solo: true` on the part (optional; the twin was always only a look, so abilities and DNA are identical either way).
- **Catalogue**: search, filters, ability/diet narrowing, sorting; locked parts stay discoverable with their unlock requirements; recently used parts remembered.
- **Stats**: diet with the reason ("Herbivore because of the Grazing Beak…"), capability tags (Fighter, Socialite, Glider, Jumper, Swimmer), and all the existing numbers, live. On phones a pill that opens into a sheet.
- **Paint**: Base, Belly, Coat, Detail layers; the picker; copy/paste a colour between layers; reset a layer; five patterns with live previews; 14 schemes (Natural, Fantasy, Bright), recent schemes, and your own saved schemes.
- **Test**: Idle, Walk, Run, Sneak, Jump (& glide) and every ability the design has; never changes the design; Back to Build.
- Rebuilds are coalesced to once per frame and use a lighter mesh while dragging; a placed part bounces in.
- Keyboard: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+D, Delete, M (mirror), F (focus), 1/2/3 (modes), Esc.

## 4. Building, Vehicle and Spaceship Creators
- Same top bar, modes, drawer, tips, drafts, confirmations and gestures as the creature creator; Civilization's buildings and vehicles now use the shared editor look instead of the parchment one (the Civilization HUD itself is unchanged).
- **Drag a part from the catalogue onto the model**: it lands where you drop it, on top of whatever is there. Dragging a part on the model **stacks** it on parts it passes over. **Snap** on/off (grid and stacking vs free placement).
- Part toolbar (nudge, raise/lower, turn, resize, mirror, copy, exact numbers, delete), one slim scrolling row on phones; long press and double tap as in the creature creator.
- **Paint**: the three design colours with the picker, and a paint for any single part (`paint` on the part, optional: base, accent, trim, glass or metal). Stats are unaffected (tested).
- **Test**: vehicles drive, sail (on a pond) or fly a loop at a pace from their speed stat; buildings turn in moving sunlight; spaceships hover. Preview only.
- Stats still come from `designStats` in `modular.js`; no mechanics or balance changed.

## 5. Cell Creator
The specialised 2D editor stays (as the spec asks). Paint now opens the shared paint sheet: Membrane, Pattern and Accent layers with the picker and the five patterns; on upright phones the view slides up so the cell stays visible above the sheet. Each colour drag is one undo step.

## 6. Creation library (Sporepedia)
**Duplicate** for any of your creations (a separate "Copy of …" entry; the original never changes), **Delete** for your loose creations (sandbox edits, imports, duplicates; asks first), and **Last changed** / **Copied from** on the detail page. Editing a creation from the library still saves a new entry, so an edit never destroys an older version.

## 7. Tests
- Unit: **275 pass** (new `editor.test.mjs`, 12 tests: history grouping and limits, colour maths, recent lists, catalogue search/filter/sort, drafts and recovery, gesture arbitration (drag vs orbit vs pinch, cancel, double tap, long press, listener cleanup), symmetry flag round-trip and old saves, quick shape limits, single-part paint not changing stats, library duplicate/delete rules). Lint clean.
- Browser, `dev/editor-check.mjs` (headless Chrome with real touch input, also in CI, non-blocking): **207 pass** at phone 390×844, landscape phone 844×390, tablet 820×1180 and desktop 1440×900: buttons on screen, bars don't overlap, 40 px+ targets, 16 px inputs (no iOS focus zoom), creature framed in the free area; drag a part from the catalogue onto the body; move it (one undo step); undo/redo; orbit and pinch leave the design alone; symmetry off/on; copy; colour-pad paint (one step); schemes; Test leaves the design alone; leave-without-saving asks; draft kept, recovered after a reload; Save; library duplicate/delete; cell paint sheet, undo, cell kept in view; workshop drag-and-drop, move, single-part paint, test preview.
- The existing `dev/browser-check.mjs`: **53 pass**.

## 8. Not done / known limits
- **Tribal Outfitter**: not built. Nothing like it exists in the code (no clothing items, slots, effects or unlocks to preserve), and building one means designing new Tribal Stage gameplay. The shared editor pieces are ready for it once its items and rules are decided.
- **Spaceship**: the existing ship editor is on the new system; no new Space Stage gameplay.
- **Real devices**: checked in Chrome's mobile emulation with real touch events, not on a physical iPhone or iPad.
- **Mesh updates**: the creature body is still rebuilt as a whole on a change (now at most once a frame and lighter while dragging); per-part incremental updates would need body3d.js reworked.
- Not added: pattern intensity/scale (the skin texture has no such setting), regenerating library thumbnails, a per-creation version list (drafts, undo and edit-as-new-entry cover the safety side), new sounds (existing effects are used).
