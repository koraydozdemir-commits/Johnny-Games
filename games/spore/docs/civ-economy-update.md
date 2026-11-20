# Civilization Stage overhaul — batch 5: economy

This builds on batch 4 (RTS controls and combat). Before it, a derrick paid a flat §1.1 a second, buying a vehicle made it appear instantly, and an economic vehicle parked next to a city and "delivered" while it sat there. Now spice is a resource of its own, vehicles are built over time by factories, and trade vehicles really travel back and forth.

## Spice

- **Spice is a second resource** (🌶 in the top bar, next to §).
  - Derricks pump it into your stockpile.
  - **Military vehicles need it to build**, alongside money: tanks about 8–10 spice, aircraft more. Economic and religious vehicles need none.
  - What you don't need, you **sell on the world market**.
- **Geysers differ:** each is *poor* (×0.6), *ordinary* (×1), *rich* (×1.5) or *very rich* (×2.2). The richness comes from the planet's seed, so it's the same every time you play that planet. Richer geysers have wider vents.
- **Extraction:**
  - Any vehicle that reaches a free geyser builds a level-1 derrick (0.4 spice/s on an ordinary geyser).
  - **Upgrade** it to level 2 (§90, ×1.7) or level 3 (§160, ×2.5). Upgraded derricks are taller and grow tanks.
- **Tap a geyser** for its sheet:
  - richness, owner, whose land it's on, its output, the market price;
  - upgrade (yours);
  - send your selected vehicles to claim it (free), or your military vehicles to wreck it (a rival's).
- **Competition:**
  - Rival nations send idle vehicles to the richest free geysers within reach. When they're at war with you, their military vehicles raid your derricks.
  - A wrecked derrick drops back to a free level-1 geyser.
  - **Taking a city takes every derrick on its land.**
- **Rivals** keep 40 spice for their army and sell the rest, which moves the same market price you sell at. A rival without the spice for a military vehicle has to wait.

## The market and the Economy sheet

- **Tap § / 🌶 at the top** for the Economy sheet:
  - money and spice, with income per second;
  - income broken down by cities, trade routes (with how many trade vehicles are on the road) and derricks;
  - **sell buttons** (25, half, all) showing what each sale would fetch;
  - a list of your derricks: tap one for its sheet.
- **The price** drifts around §3.2 a spice, between §1.2 and §7. Every 10 spice sold knocks 2% off, and it recovers over time. Spreading sales out pays better than dumping.

## Production

- **Vehicles are paid for when ordered and built over time** at the city.
  - Build time is the vehicle's cost divided by the city's output. Each factory adds output, and better factory designs add more.
  - With no factories a tank takes about 20 seconds; two factories cut that by more than half.
- Each city has a **queue of up to 3**. Its sheet shows progress, and tapping a queued vehicle cancels it for a full refund of money and spice.
- Vehicles being built count against how many vehicles your cities can support. A city that falls loses its queue.
- A finished vehicle pops up over the city and is selected if nothing else is.
- Buildings still cost money as before (houses §40, factories §60…). Factories now also mean faster production, as well as more money and less happiness.

## Trade routes

Send an economic vehicle to a city and it **runs a route**:

1. It loads at home (its own city, or your nearest city it can get to).
2. It drives to the partner and delivers.
3. It drives back to load again, until you give it other orders.

What each delivery does:
- **Pays both sides.** You get §(8 + 0.1 × route length + 0.8 × partner's population). The partner's owner gets half that.
- Moves the partnership on: about 6 deliveries complete it, and then you can buy the city as before.
- Raises relations with the partner nation.

Every established route also pays a little all the time, as before.

**Disruption:**
- Hostile military vehicles hunt trade vehicles.
- A city won't trade with a nation it's at war with.
- A trade vehicle **crossing the land of a nation at war with you is raided** and delivers only half its cargo.

Rival economic nations run their trade the same way, and buy cities when their partnership completes.

## Fixes

- The new floating health bars were picking up the colours of the relationship bars in sheets. They're always plain green (yours) or red (enemies) now.
- The selection panel hides while a sheet is open.

## Saves

The save now also holds:
- your spice and the market price;
- rival nations' spice;
- each city's build queue;
- each derrick's level.

Older saves load with 20 spice, empty queues and level-1 derricks.

## Tests

- **Unit tests:**
  - spice yields;
  - the market wandering within bounds and drifting back to its usual price;
  - selling (two half-sales are worth about one big sale);
  - spice costs, build times and delivery pay;
  - the save fields, including older saves.
- **Browser tests** (headless Chrome, phone-sized screen):
  - claiming a geyser and the spice flowing in;
  - upgrading through the sheet;
  - selling on the market;
  - queued vehicles being built over time, and cancelling for a refund;
  - the queue being saved;
  - a trade vehicle running three full loops and being paid each delivery;
  - every earlier civilization check;
  - no page errors.
