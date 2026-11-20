# Civilization Stage overhaul — batch 6: communications

This builds on batch 5 (economy). Before it, a nation's sheet showed its relation to you with two buttons, Gift and Offer peace. Now every rival nation has a leader with a face and a personality. You can talk to them, they contact you on their own, and everything agreed changes what the simulation does.

## Leaders

- Each rival nation has a leader: a title and name, and a **portrait** of the nation's species drawn from its creature record. A face badge shows their mood.
  - The leader is the same every time you play that planet, because it comes from the planet's seed.
- Each leader has a **personality** that suits the nation's kind:
  - military: Aggressive or Cautious
  - economic: Greedy, Friendly or Cautious
  - religious: Devout or Friendly

| Personality | What it does in the simulation |
|---|---|
| 🔥 Aggressive (Warlord) | Declares war at relations −30. Relations settle 10 lower. Answers threats with war. Never pays tribute. Demands tribute from weaker nations. Sells cities only to close friends, at 1.5× the price. |
| 🌼 Friendly (First Speaker) | War only below −75. Relations settle 15 higher. Allies at 35, signs trade agreements at 0. Offers alliances itself. |
| 💰 Greedy (Grand Treasurer) | Gifts count 1.5×. Trade agreements from −10. Sells cities cheapest (0.85×). Proposes agreements and "protection fees". |
| 🕯 Devout (High Prophet) | Warms to nations with temples and religious cities. Sends missionaries to those without. Invites you to its faith. |
| 🛡 Cautious (Steward) | Only starts a war if its military is at least 1.2× yours. Backs down under threat from a stronger nation. Allies more readily with a strong friend. |

**Military strength** is shown in the conversation, for them and for you. It counts armed vehicles (damage and toughness) and city turrets, and it decides how threats, demands and peace go.

## Talking to a leader

- **Tap a nation's flag at the top** (or **📡 Contact** on any of its cities) to open the conversation. It shows:
  - the leader's portrait, title, personality and mood;
  - your relations and status (allied, trade agreement, at war, cowed, preaching to you);
  - their last words in a speech bubble;
  - the outcome of what you just said.
- **What you can say depends on the situation:**
  - **Before you meet:** only 👋 Introduce yourselves.
  - **At war:** only 🕊 Negotiate peace (the price depends on personality and who's winning) and 🎁 Send a gift.
  - **Otherwise:** 🎁 gift, 🤝 propose a trade agreement, 🛡 request an alliance (or 🚨 ask for assistance once allied), 🕯 discuss beliefs, 🏙 buy a city, 💸 demand tribute and ⚠ threaten (not with allies), ⚔ declare war.
  - Options you can't use right now are greyed out with the reason, such as cost, a cooldown or nothing for sale.
- **📜 History** shows the whole conversation, with the outcome of each exchange.

## What agreements actually do

- **Alliance:**
  - The ally never declares war on you, and its relations with you settle higher.
  - **Its vehicles and turrets fight the nations at war with you.** Hostility now covers your allies' units against your enemies.
  - The alliance ends if relations drop below 20, or if you attack the ally (which ends any trade agreement too).
- **Assistance (allies):**
  - Up to three of the ally's military vehicles that can reach your most threatened city go and guard it for three minutes. If it has none, it sends money instead.
  - The leader says which it's doing, and it does that. Cooldown 2 minutes.
- **Trade agreement:**
  - Every delivery between you pays 1.5×.
  - Your passive route income with that nation pays 1.5×.
  - An economic partner's traders seek out your cities.
- **Buy a city:** their cheapest city that isn't their last, at a premium over a trade buyout. It joins your nation at once.
- **Demand tribute:** paid if your military is stronger by enough for their personality (Cautious 1.2×, Devout and Friendly 1.5×, Greedy 2×, never Aggressive). It costs relations.
- **Threaten:** a stronger nation (1.3×) cows any non-aggressive leader. A cowed nation won't target your cities or declare war for 4 minutes.
- **Discuss beliefs:** devout leaders warm to believers. Without faith, they send missionaries to preach to your cities for a while.
- **Declare war / make peace:** war makes their military hostile at once. Peace stands their vehicles down.

## Leaders who contact you

- Leaders send messages on their own. You get a toast, and their flag pulses with 📨.
- **What they send:**
  - first contact, once your cities or vehicles come near theirs;
  - alliance offers (friendly or high relations);
  - trade agreement proposals (greedy or friendly);
  - tribute demands (aggressive or greedy, when their military is bigger than yours);
  - invitations to their faith (devout);
  - peace offers when they're losing a war;
  - war declarations, which also offer "🕊 Talk peace".
- **Answering:** tap the flag to answer with real choices. A message left unanswered for 45 seconds counts as a refusal, with the same consequences.
- **History:** **☰ → 📨 Messages** lists everything every leader has said to you and you to them, newest first, plus any messages still waiting.

## Saves

Each nation's personality, whether you've met, alliance, trade agreement, cowed and preaching timers, and its last 12 messages are saved. Older saves load with personalities assigned from the planet, and every nation still to be met.

## Tests

- **Unit tests** (`tests/civ-leaders.test.mjs`):
  - fitting personalities and names;
  - options by situation (unmet, war, allied, last city, money, cooldowns);
  - every personality's different answers, and that agreements come back as effects;
  - incoming messages and their answers;
  - personality changing `nationPlan`: cautious leaders won't start losing wars, allies and cowed nations never declare war, devout nations send missionaries.
- **Browser tests** (headless Chrome, phone-sized screen):
  - meeting a leader;
  - signing a trade agreement and an alliance;
  - an ally counting as hostile to your enemy;
  - asking for assistance;
  - the history;
  - an aggressive leader's demand arriving, with a pulsing flag, and being paid;
  - the save;
  - every earlier civilization check;
  - no page errors.
