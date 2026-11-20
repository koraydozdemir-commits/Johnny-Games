# Civilization Stage overhaul — batch 3: the vehicle creator

This builds on batches 1–2 (the planet, and the village becoming a city). The vehicle editor already existed: you could add parts, move, turn, resize, mirror, colour, preview and save, and parts already set speed, health and power. This batch turns it into a real vehicle creator with categories, classes and a design library. Classes change how vehicles fight.

## Categories and classes

- **Category:** the editor's **Type & paint** tab now starts with a **Land / Sea / Air** choice. A design must move the way its category says: wheels or treads for land; propellers, sails or pontoons for sea; wings, jets or rotors for air. If they don't match, the editor says what to add and won't save.
- **Start from a template:** each category offers ready-made vehicles to start from. Applying one replaces the parts, and Undo brings them back.
- **Classes:** what a design carries decides its class. The editor shows the class with what it's good and weak at.

| Role | Land | Sea | Air |
|---|---|---|---|
| Military | Armoured car · Tank · Artillery | Warship · Torpedo boat | Fighter · Bomber |
| Economic | Freight truck | Transport ship | Transport aircraft |
| Religious | Mission van | Mission ship | Mission airship |

## New parts

- **Weapons** (a new palette tab):
  - **Artillery gun:** makes a land vehicle Artillery, or an aircraft a Bomber.
  - **Bomb bay:** the same.
  - **Torpedo tube:** makes a ship a Torpedo boat.
  - **Flak gun:** lets any military vehicle fight aircraft better.
- **Move:**
  - **Rotor:** air.
  - **Pontoon:** sea.
  - **Big wheel:** land; tougher than a normal wheel.
- **Decorations:** racing stripe, spoiler, exhaust, spotlight, emblem, antenna.

## Classes in play (`CLASS_COMBAT` in civ/rules.js)

| Class | Against cities | Against land / sea / air | Extra range |
|---|---|---|---|
| Armoured car | ×0.8 | ×1.25 / ×1 / ×0.5 | — |
| Tank | ×1 | ×1 / ×1 / ×0.35 | — |
| Artillery | ×1.7 | ×0.5 / ×0.6 / can't | +9 |
| Warship | ×1.2 | ×1 / ×1.1 / ×0.5 | +4 |
| Torpedo boat | ×0.6 | ×0.4 / ×2.2 / can't | — |
| Fighter | ×0.6 | ×0.9 / ×0.9 / ×2.2 | — |
| Bomber | ×1.9 | ×0.7 / ×0.7 / can't | — |

- Flak guns add to the "against air" figure on any class.
- A vehicle that can't fight a target won't take the order. The toast explains why, for example to build fighters or add flak guns.
- **Turrets:** they reach further against vehicles attacking their city. Artillery shells from beyond their close range, where turrets hit at about a third of their strength.
  - In testing, a tank sent alone at a city with three turrets was destroyed in about 22 seconds.
  - An artillery piece took the same city with about a third of its health left.
- Rival nations now build a mix of classes: mostly their main class, plus artillery, bombers and torpedo boats.

## The design library

- 🎨 **Designs** lists, for each role, the standard land, sea and air designs plus up to **6 designs of your own**.
  - **＋ New** opens the editor on a fresh design.
  - **⧉** copies a design.
  - **🗑** deletes one of your own. Vehicles built from it are refitted to the standard design.
- A city's build list shows **every design of its kind**, with class, cost, and why one can't be built (an inland city, too few cities for aircraft).
- If an edit changes how a design moves, it's saved as a new design of the other kind. Your standard design for that kind is no longer overwritten.
- Designs are saved with the game, and to the Sporepedia when a universe is loaded.

## Fixes

- **Harbours:** building a city filled in nearby water, so some cities' harbours ended up on land and boats couldn't reach them. The sea now stays sea outside a city's flat core, and harbours are always chosen beyond it.

## Tests

- **Unit tests:** every template is a working design of its class, and every class has a template. Also covered:
  - the class-combat relationships;
  - flak guns and artillery guns changing a class;
  - category validation;
  - harbours staying water after the cities are flattened.
- **Browser tests** (headless Chrome, phone-sized screen):
  - a new design built from a template in the editor;
  - the design library;
  - building a custom bomber at a city;
  - a tank against artillery at a defended city;
  - rival class mix;
  - designs saved;
  - boats reaching every harbour;
  - all earlier civilization checks;
  - no page errors.
