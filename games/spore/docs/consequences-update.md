# Johnny Games Spore — Consequences & Immersion Update

Spec: "Consequences & Immersion Update" (Nov 2026). Earlier work: `docs/major-update.md`,
`docs/parity-update.md`. Design rule throughout: **show, don't tell**.

## 1. Audit (start of the update)

| Asked for | Already there | Gap |
|---|---|---|
| Behaviour tracking | Cell: plants/meat, kills, scavenging. Creature: alliances, extinctions, per-species friends/kills, foods tried. | No record of hunting wildlife, escapes, gifts, defending kin, sneaking, intimidation, scavenging on land, migrations. |
| Trait cards | 3 cell cards (diet), 3 creature cards (alliances vs extinctions), 3 tribal, 3 civ. Cards give an ability and a tribal legacy. | One-axis rules; no downsides; no "why"; cell card had no passive effect on land; pop-up toast, not a reveal. |
| Consequences | Nest anger (40 s), wildlife remembers hurt (30 s), alpha cowing. | Nothing long-term: every grudge expired, herds always refilled, kindness was forgotten. |
| Living ecosystem | 7 wildlife archetypes, needs-based AI, distance LOD, abstract off-screen groups, carcasses, scavengers, packs. | Populations fixed; no predator/prey balance; no migration of wildlife; no seasons. |
| World events | Weather per region (rain, storm, heat, meteors, eruption). | No ecological events (migrations in, blooms, shortages, sickness, clashes). |
| Decision events | None. | — |
| Tutorials | Tip engine (cell) and `tipOnce` toasts (creature, 39 of them), mostly full sentences in a big centre toast. | Too wordy; no struggle hints; no optional reference. |
| History | Chronicle (keyed moments), lineage, library, evolution track. | Few behaviour-driven moments; no view of the species' character. |
| Immersion | Sleep at night, herds, packs, nests, fossils, UFOs. | No mourning, no young, no individual habits, carcasses vanished without trace, extinct nests looked alive. |

## 2. What was built

### Phase 1 — Evolutionary identity and consequences
- `creature/identity.js` (pure, tested): a **ledger** of 22 kinds of act; a **profile** on seven axes
  (predation, sociality, caution, dominance, breadth, care, scavenging/roaming); a live **reputation**
  (fear, trust) that only builds once there is a real record; **eight instinct cards**: Apex Predator,
  Pack Hunter, Territorial (red), Symbiotic, Nurturing, Elusive (green), Adaptable, Scavenger (blue).
  Each has upsides *and* downsides, both on land and in the Tribal Stage, and lists the acts that
  earned it. Two predators can differ (Apex vs Pack Hunter vs Territorial).
- Save compatibility: the instinct's colour **is** the classic creature card id (`predator` /
  `charmer` / `adaptable`), so tribe/civ saves and legacies are unchanged. Old saves that already hold a
  card get the instinct of that colour their record fits best; old saves without a ledger have one
  rebuilt from what they prove (`seedLedger`).
- Cell card passives on land (one up, one down each): Carnivore bites +10% / plant eaters scatter
  sooner; Herbivore social +, plants heal more / bites −8%; Omnivore slower hunger / meals heal less.
- What it changes in play: damage (alone/with pack/at home), social round opening, intimidation, how
  far prey flees and how far you are noticed, how far hunters pick a fight, hunger, healing from food
  and carrion, sprint stamina, family regrowth, raid frequency, allies joining your fights.
- `creature/memory.js` (pure, tested): every nest and wild herd keeps a **grudge** and **trust** that
  fade, but never below a floor set by big acts (killing an alpha, rescuing them). A nest your kind
  wronged turns hostile on sight; a gift of food mends part of it. Trusted herds keep grazing beside
  you; wronged ones keep further off; grudging hunters come for you.
- Allies come to your aid: a befriended member of another nest nearby may join a fight against
  whatever is hunting you (Symbiotic species can count on it).
- Escapes are counted when a hunter loses you; fleeing while badly hurt counts as retreating.
- Chronicle: first times (first kill, first friend, first escape, first scavenge…), milestones (10 and
  30 kills, 10 friends, 5 escapes…), and shifts in character ("Other creatures began to fear your
  kind."). Places read naturally ("on the Sunlit Coast", "in the Deepwood Forest").
- UI: an end-of-stage **trait card reveal** (flips over; name, colour, blurb, "Earned by", + and −,
  "Later"), shown leaving the water and at brain 5 (queued until the editor closes). The species'
  forming character rides as a small icon on the ◈ history button and glows when it shifts. History
  screen: a **Character** section (card, reasons, effects, six leaning bars); turning points stand out
  in the chronicle timeline.
- Tutorials: all 37 creature tips cut to a few words and moved to a quiet hint pill (the big centre
  toast is kept for events). Dying the same way twice gives one practical pointer. A ❔ **Field guide**
  in the menu is the optional reference. Cell Stage tips shortened the same way.

### Phase 2 — Living ecosystem
- `creature/populations.js` (pure, tested): the slow half of the ecosystem. Each wild group has a
  sustainable population; the region has a food level (lush). Prey grow logistically with food;
  predators grow on plentiful prey and starve without; off-screen predation thins herds. Your kills
  add hunting pressure: a hard-pressed herd **abandons its ground**, a hunted-out one **leaves the
  region**, and comes back once the land recovers; starving hunters leave too.
- Ecological events, one at a time, weighted by the situation, never twice in a row: season of plenty
  (fruit grows back fast), lean season (most ripe fruit withers, hunters get hungry and bold), predator
  migration (a pack **walks in from the coast** to a new home range), newcomers (a herd), sickness (a
  crowded herd coughs, slows and thins), territorial clash (two predator groups fight; the loser moves).
- Shown, not told: a short hint appears only once you have witnessed the change (e.g. "New hunters in
  the area." when the arriving pack comes into view). The chronicle records each.
- Deaths ripple: prey near any death scatter; members of a herd that see you kill one of them remember
  it (fighters come for you). Killing a predator that was hunting a herd earns that herd's trust.
- Curious creatures investigate new things (a fallen meteorite, a fresh carcass).
- Saved per region: herd homes, memories, the ecology, and groups that migrated in.

### Phase 3 — Decisions and immersion
- `creature/encounters.js` (pure, tested): rare moments with a real choice (first after 6–9 min in a
  region, then 10–16 min apart; never during raids, migrations, courtship or at night).
  - **A rival at the nest**: a meat-eater from a nearby nest (or a guardian/hunter herd) walks in,
    claims the ground round your nest with displays and eyes the larder. Choices appear only when you
    are there: *Defend the nest* (fight it, or stare it down with Pose; its kind remembers),
    *Move the nest* (safe, but the larder is lost and the family treks to a new site; the rival keeps
    the old nest), *Let it stay* (it settles beside your nest as a **neighbour**: fights raiders, and
    helps itself to your food now and then; saved). Ignore it and it raids the larder.
  - **A lost youngster**: a young grazer cries between you and its herd. *Lead it home* (it follows
    you; its herd remembers), or *Hunt it*. Leave it and it finds its own way.
- Family: new hatchlings are **young** (small, grow up over 2.5 min) and tag along behind an adult;
  in a raid, adults stand between the raiders and the young.
- Kin **mourn**: when a nest member or a family member dies, kin nearby gather at the spot, heads
  bowed, then go back to their lives.
- Habits: nest members are curious (come for a look), shy (keep off), playful (chase a nestmate) or
  calm; all sniff the ground now and then.
- Environmental storytelling: carcasses that rot or are picked clean leave **bones** for a few minutes;
  an **extinct nest** goes dark and empty, with a skeleton beside it, for good.

## 3. Not completed (recorded, not silently dropped)
- The Cell Stage card now explains itself and has passives on land, but cell behaviour beyond diet,
  kills and scavenging is not tracked, and cell NPCs have no memory.
- No new body animations: habits, mourning and displays use the existing crouch, act and pop
  vocabulary. No scratching or drinking animation; no new sound files (creature calls reuse voices).
- Wildlife herds scatter at deaths but do not mourn; the young/mourning/habit behaviours are for nests
  and your family.
- Two decision encounters (rival, lost youngster). Discovery/evolution-themed decisions not built.
- The Civilization Stage still reads the classic creature card, not the instinct (the Tribal Stage
  reads both).
- Not playtested by a human; frame timing on a real phone is unmeasured (tested in a software
  renderer).

## 4. Tests
- Unit: 210 passing (`node --test tests/*.test.mjs`): new suites `identity` (10: instinct choice,
  differing predators, every card has pros and cons in both stages, old-save seeding, bad data,
  reputation, modifiers, chronicle moments, tribe legacy, memory), `populations` (7: balance left alone,
  overhunting → migrate → leave, return, starving hunters, seasons, events, save/restore), `encounters`
  (3). Lint clean.
- Browser, phone 390×844 touch: cell card reveal → crawl-out → creature; hunting forms the Apex
  leaning (badge glows, chronicle); field guide; history Character section; brain 5 instinct reveal
  after the editor; saved instinct/ledger/memory. Ecosystem: a herd hunted out and leaving, a pack
  migrating in (hint on sight), a lean season withering fruit, save + reload restoring arrivals, gone
  groups and grudges. Encounters: rival choices shown on arrival, coexist → neighbour steals and
  survives reload; defend by fighting; move (rival keeps the old nest, larder lost, family treks);
  stray led home (herd trust, defended). Bones, mourning, abandoned nest, habits.
- Browser, desktop 1280×720: choice buttons, field guide, history; Tribal Stage regression (legacy).
- An old creature save (card already earned, none of the new fields) loads with progress intact and
  gains the matching instinct. No page errors in any run.
