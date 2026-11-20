# Civilization Stage overhaul — batch 4: RTS controls and combat

This builds on batch 3 (the vehicle creator). Vehicles could already be selected one by one or all at once and sent to a city, a geyser, an enemy vehicle or the ground. This batch adds group control, more orders, real projectiles and a proper occupation step when taking a city.

## Selecting

- **Tap** a vehicle (or its chip) to select or deselect it. **🚙 All** still selects everything.
- **Double-tap** a vehicle to select every vehicle of its class that's on screen.
- **Box select:**
  - On touch, tap **⬚** (left of your vehicle chips), then drag a box around a group. Two fingers still turn and zoom while it's on.
  - On a computer, **Shift-drag** does the same. Holding Shift adds to the selection.
- **Esc** cancels box mode, a pending patrol, targeting or the selection.

## The selection panel

When anything is selected, a panel opens above your vehicles:

- **One vehicle:** its design name, class and what it's doing (idle, moving, attacking a city, guarding…), a health bar with exact numbers, speed, attack per second and range (or trade or preaching), and what its class is good and weak at.
- **A group:** how many of each class, average health and what it's doing.

It also has these orders:

| Order | What it does |
|---|---|
| 🛡 Guard | Hold the group's current spot. Military vehicles fight anything hostile within reach, chase no further than 30 from their post, then return. |
| 🔁 Patrol | Tap the far end of the route: each vehicle goes back and forth between where it is and there, fighting anything hostile on the way. |
| ▤ Formation | Cycles **Line** (side by side, most guns forward), **Wedge** (an arrowhead) and **Ring** (a circle that holds from every side). Moving, guarding and patrolling groups take up the formation facing the way they travel. Each vehicle takes the nearest free spot, and a spot it can't stand on (a boat's spot on land) falls back to the middle. |
| 🎥 Follow | The camera follows the first selected vehicle. Tap again to stop. **F** still works on a keyboard. |
| ✋ Stop | Cancels their orders. |
| ✕ Deselect | Clears the selection. |

## Combat

- **Real projectiles** (`civ/projectiles.js`): shells, tracers, flak bursts, artillery shells on a high arc, missiles trailing smoke, bombs dropping from aircraft, torpedoes running along the water, and turret shells. Each class fires its own weapon at its own rate (`CLASS_WEAPON` and `weaponFor` in `civ/rules.js`):
  - Flak guns are used against aircraft.
  - Missile pods replace a tank's, car's, fighter's or warship's normal gun.
  - A torpedo boat uses its deck gun on anything that isn't a ship.
- **Damage lands on impact.** A shot carries the damage of the time since the last one. A target that dies before it lands takes no more, and shots home in on vehicles that drive away.
- **Turrets** take turns firing (flak at aircraft, shells at everything else). Artillery beyond their close range still takes reduced fire.
- Vehicles turn to face what they're shooting. Every hit blows up where it lands, scaled to the weapon.
- **Health bars** float over your selected vehicles, and over anything damaged when you're close enough to see it.

## Taking a city

- Military attacks still knock out a city's turrets, then its hall. Once its defences are down, **a land vehicle or a ship has to occupy it**. Aircraft can bomb a city defenceless but can't hold it, and the game tells you to send ground forces.
- A captured city keeps all its buildings, turrets and roads. It's rebuilt in its new owner's colours and joins their territory, as before.

## Other fixes

- More room is cleared of trees around each city, so vehicles parked outside the gate aren't hidden in a forest.

## Tests

- **Unit tests:** each class's weapon, flak against aircraft, missiles, the torpedo boat's deck gun, and that every weapon has projectile settings.
- **Browser tests** (headless Chrome, phone-sized screen):
  - box select with ⬚ and a drag;
  - the selection panel;
  - a formation move;
  - guards destroying an enemy that comes near and staying on post;
  - bombers taking a city's defences down without capturing it, then a tank occupying it;
  - every earlier civilization check;
  - no page errors.
