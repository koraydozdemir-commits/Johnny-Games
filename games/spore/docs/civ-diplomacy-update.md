# Civilization Stage overhaul — batch 7: diplomacy and rival AI

This builds on batch 6 (communications). Before it, rival nations only had a relationship with *you*. They ignored each other, so the planet only changed when you touched it. Now every pair of rivals has a relationship of its own. Rivals go to war with each other, make peace, ally and sign trade agreements, and gang up on whoever grows too strong, whether that's you or one of them.

## Every nation runs itself

Each rival nation already had its own cities, territory, capital (its first city), economy, military, colours and designs, and leader personality (batch 6). Its preferred conquest strategy follows its kind: military, economic or religious. New in this batch:

- **Military vehicles** go after the cities of nations they're at war with (rivals as well as you), as well as free cities.
- **Traders** run routes to any nation they're at peace with, and rivals buy each other's cities when a partnership completes.
- **Missionaries** preach to the cities of nations they dislike, rivals included, and convert them.
- **Every nation defends its cities:** idle military vehicles go after anyone hostile attacking a city of theirs. Before, only yours did.
- **Turrets** of rival cities fire on vehicles of nations they're at war with.
- When a rival nation loses its last city, to you *or to another rival*, it falls and its vehicles are gone.

## Relations between rivals

- Every pair of rivals has relations from −100 to 100, plus war, alliance and trade agreement. Relations start from both leaders' personalities, plus a little chance from the planet's seed.
- **Relations drift** toward a resting point. These move it down:
  - **sharing a continent**, −12;
  - being, or fearing, **the dominant power** (below), −20.

  These move it up:
  - a **trade agreement**, +8;
  - an **alliance**, +12;
  - **trading**, +5;
  - a **common enemy**, +15;
  - a **common threat**, +15.
- **Real events move them too:**
  - **Each trade delivery** between them: +1.
  - **Preaching** to the other's cities: worse over time.
  - **Claiming spice on the other's land:** −8. If you do it, that nation likes you 6 less.
  - **Taking a city** on a continent where others have cities: −10 with each of them, −25 with the nation that lost it.
  - **Declaring war:** −20. The victim's allies like the aggressor 25 less.
- **Decisions** (`pairDecision` in `civ/leaders.js`, checked every 5 seconds once the first 4 minutes are over):
  - **War:** started by the warlike side (military or aggressive), when relations drop below its personality's war threshold. A cautious nation only attacks one it outguns by 1.2×. Nobody starts a war while a dominant power threatens them both.
  - **Peace:** after at least 90 seconds of war, when one side is losing badly or tempers have cooled.
  - **Alliance and trade agreement:** when relations clear both personalities' thresholds.
  - **A soured alliance breaks** (below 10).

## Alliances act like alliances

- **When a rival declares war on another**, each ally of the victim likes the aggressor 25 less and joins the war 60% of the time.
- **Your allies:** if a rival attacks one of them, the ally asks you to join (a 📨 message). Saying yes declares war on the attacker and raises your ally's opinion of you by 15. Saying no, or not answering, lowers it by 8.
- **Their allies:** a nation that isn't at war with you, isn't your ally and likes you less than 30 may join its ally's war against you. It tells you with a message, and you can answer by talking peace.
- **Attacking an ally of a nation hurts badly:** that nation likes you 25 less, and **ends its alliance with you** if it had one. Nations already at war with your target like you 10 more.

## Coalitions against a rising power

When any nation, **you or a rival**, holds **40% of the planet's cities**, everyone else starts to unite against it:
- Their relations with each other rise, and they ally more readily.
- Their relations with the dominant power fall.
- They stop fighting each other while the threat lasts.

The 🌐 World sheet warns you when this is happening.

## Seeing it all

- **📰 News:** toasts announce rival wars, peace, alliances, trade agreements, cities taken, bought or converted between rivals (or from the free cities), and nations falling.
- **🌐 The world** (☰ menu, or the button in any conversation) shows:
  - every nation with its leader, personality, cities, strength and attitude to you (tap one to talk);
  - every pair of rivals (⚔ war, 🛡 allies, 🤝 trade agreement, and relations);
  - the dominant-power warning;
  - the news log.
- A leader's conversation now says who they're at war with and allied to.

## Saves

The save now also holds every rival pair (relations, war, alliance, trade agreement, how long they've been at war) and the last 20 news items. Older saves start the rivals' relations fresh from their personalities.

## Tests

- **Unit tests:**
  - what moves a pair's resting relations (neighbours, common enemy, common threat, fear);
  - who starts a war (the aggressive side; a cautious nation only against the weak; never between allies or under a common threat);
  - peace only after a while and when one side is losing;
  - alliances forming sooner against a common threat;
  - soured alliances breaking.
- **Browser tests** (headless Chrome, phone-sized screen):
  - a 25-minute simulated game with the player doing nothing. The rivals expanded into free cities, bought, converted and fought over each other's cities, declared wars, made peace and signed trade agreements, and the planet kept changing hands.
  - Attacking a nation's ally dropped that nation's opinion of you by 25.
  - Every earlier civilization check.
  - No page errors.
- **Speed:** the simulation ran at about a quarter of a second of computer time per simulated minute.
