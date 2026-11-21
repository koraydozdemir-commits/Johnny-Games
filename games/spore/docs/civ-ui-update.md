# Civilization Stage overhaul — batch 8: the interface gets its charm back

This batch changes how the Civilization Stage looks and feels. It doesn't change the rules: every system from batches 1–7 still works the same way. The old interface was dark, see-through, rectangular panels. Now it's warm and playful, and it's one design system across every screen.

## The design system (`civ/civ-ui.css`, `civ/icons.js`)

- **Surfaces:** warm cream panels with thick tan outlines, soft depth and organic corners (no two corners round the same).
- **Colour carries meaning, the same way everywhere:**
  - turquoise: the planet, looking and moving
  - leaf green: building, agreeing, good news
  - gold and orange: money, spice and important actions
  - red: danger and war
  - purple: faith
  - dark brown: text
- **Chunky tactile buttons:** a coloured lip underneath, a press that sinks the button, and a head-shake when a tap is refused (for example, when you can't afford something).
- **Icons:** a set of 40 two-tone SVG icons drawn for this game (coin, spice drop, city, buggy, planet, hammer, palette, and so on). They replace the generic emoji in the interface's controls.
- **Shared components:** sheet headers, stat chips, pip gauges, card grids, meters and notification cards.
- Everything is scoped to the Civilization HUD and the building and vehicle editors, so the other stages look exactly as before.

## Your designs, drawn (`civ/thumbs.js`)

Your real building and vehicle models are now rendered off screen as little pictures. Rendering is rationed to two pictures a frame, and each picture is cached until the design changes. You see them in:

- the city skyline;
- the building plots and build cards;
- the production queue;
- the vehicle row;
- the selection card;
- the designs sheet;
- "vehicle ready" notifications.

## Screen by screen

- **Top bar:**
  - Resource pills for money, spice, cities and vehicles.
  - When a total jumps, its pill bumps and shows a floating "+120" (the steady trickle of income doesn't trigger it).
  - The goal ribbon has a progress bar.
- **Rival leaders:** shown as faces, with a ring in your relationship colour and a mood badge. A leader with a message for you bounces.
- **The camera decides how much interface there is:**
  - From orbit, the vehicle row and the button labels step aside.
  - During the arrival cutscene, the HUD hides.
- **Tapping a city or a geyser:** a small card opens instead of the whole management sheet.
  - A city's card shows its people, happiness, income or turrets, and either its production or your trade with it. Its buttons are Open city, Details, Contact or Send.
  - A geyser's card shows richness, output and the market price. Its buttons are Upgrade, Claim or Wreck, and Details.
- **City:**
  - A postcard header: the city's skyline built from its real buildings, in its owner's colours.
  - Stat chips, and building plots colour-coded by family (residential, industrial, entertainment, religious, military, administrative).
  - Build cards show the building's picture, effect, design strength and cost. A new building pops into its plot with a sparkle and a sound; a refused card shakes and says how much more you need.
  - Vehicle cards show speed, health and power as gauges. Locked vehicles are hatched, with a lock and the reason.
  - The production queue shows the real vehicles, each filling a progress ring.
- **Talking to a leader:**
  - A big portrait takes centre stage, on rays in the nation's colour. It breathes, and holds itself according to its mood: a happy bounce, a wary sway, or seething.
  - Each answer gets a reaction: a joyful hop with hearts, a head-shake, a huff, rage with sparks, or cowering.
  - Speech bubbles, a relations slider with a "+15" or "−8" chip, and the outcome in green or red.
  - Every option is a card in its colour family, saying what it's for, or why it isn't available.
  - Each personality greets you in its own way.
- **Notifications:** small cards slide in with a portrait or icon, a title, the message, a colour for how important it is, and an action button (Answer, Defend, Look, Buy, World…). They time out, at most three show at once, and a repeated alert replaces its earlier card. They cover:
  - leaders' messages;
  - wars declared on you;
  - your city under attack;
  - a trade route raided;
  - a derrick wrecked;
  - a vehicle finished;
  - a new trade route;
  - a city ready to buy;
  - cities won or lost;
  - alliances ending;
  - world news.
- **Economy:**
  - an income-split bar;
  - trade routes drawn as animated lines with vehicles on the road, and disrupted routes in red;
  - a dial for the spice price;
  - big sell buttons.
- **The world:** a bar of who holds the planet, nation cards with faces and moods, and rival pairs.
- **Orders:** the selected vehicle's picture, with a health bar. A selected group is shown standing in its formation. The command buttons are bigger.
- **Victory:** the HUD steps aside and the planet turns slowly while confetti falls and a wave of your colour spreads across the screen. A celebration card shows:
  - your species' portrait and your card;
  - the final statistics;
  - your strategy ("4 of the 6 cities you won were bought, 2 taken by force");
  - **your story**: your first and latest milestones.

  A fanfare plays.
- **Vehicle and building editors:** cream-themed to match, with bouncy part cards, chunky tabs and chips, and gold stat pips.

## Layouts

- **Phone:** sheets are bottom sheets with a grab handle. Floating elements make way when a sheet is open.
- **Tablet and computer:** sheets dock to the right of the planet.
- **Landscape phone:** sheets are a side panel, and the action bar is compact.

## Sound

Synthesised interface sounds are added to the existing audio system, with no new files or services:

- panels opening and closing;
- selecting something;
- giving an order;
- a message arriving;
- an alarm;
- agreement and refusal;
- "done";
- a fanfare.

## Reduced motion

The game's reduced-motion setting, and the system preference, turn off the bouncing, spinning and confetti.

## Saves

The save now also keeps your last 30 milestones, for the victory screen. Older saves load with none. Nothing else in the save format changed.

## Tests

- **Unit tests:** 252 pass, including a new test that milestones are kept, cleaned and capped. Lint is clean.
- **Browser regression** (headless Chrome, driven by real clicks), 61 checks at each of phone (390×844), iPad (820×1180), desktop (1440×900) and landscape phone (844×390), all passing. They cover:
  - every action bar button and menu item;
  - every order command, and selecting from the vehicle row;
  - the zoom-dependent HUD;
  - the city card leading to city management;
  - building, demolishing and turrets;
  - ordering, cancelling and finishing a vehicle;
  - refusing a build you can't afford;
  - selling spice;
  - claiming a geyser from its card;
  - diplomacy: introduce, gift, trade agreement, war, reactions and relation changes;
  - opening a conversation from a rival's face;
  - notification actions;
  - victory and "keep playing";
  - the vehicle editor: open, add a part, cancel;
  - save and reload;
  - no overlapping controls and no tap targets under 32 px;
  - no page errors.
- **Simulated game:** 11 simulated minutes with the player doing nothing. It raised 20 notifications with no errors, at the same speed as before the redesign.
- **Other stages:** the creature editor and the Tribal Stage HUD were screenshotted and are unchanged.
