# Health check — November 2026

Two parts:

1. **Engagement audit.** The headless playtest bot played 4 seeds (101, 202, 303, 404) for 1,200 days each, 4,800 simulated days in all, and every daily tick was instrumented.
2. **Hollow-mechanics re-sweep** (pass 23) of everything shipped since the 2026-10-21 sweep.

## How to re-run the audit

```bash
AUDIT=1 npx vitest run src/__tests__/audit.health.test.js
# knobs: AUDIT_SEEDS=101,202  AUDIT_DAYS=1200  AUDIT_SAMPLE=40  AUDIT_OUT=path/to/report.json
```

Without `AUDIT`, `src/__tests__/audit.health.test.js` is skipped. It wraps every `processDay` / `processDaily` / `processTurn`-style method exported from `src/systems`, `src/world` and `src/player`. For each one it records calls, time and returned notices. On sampled days (every 40th) it also records which top-level `player.*` / `world.*` keys the call changed, using an md5 of each key before and after the call.

It also records:
- world events, achievements, quests and sagas
- every ledger row
- the gold, net-worth and prestige curve
- decision density: distinct action types offered each week, and pending choices per day
- novelty: the first time anything happens

The wrappers draw no RNG, so a run plays exactly as the soak does. A run costs about 15 minutes per seed, mostly the state hashing. Run the seeds in parallel processes.

### Caveats

- Run 1 used the code as it stood **before** the fixes below.
- The four seeds ran in parallel, so the ms figures are about 1.5× a quiet machine.
- "Never changed state" comes from 120 sampled days. A system on a monthly or yearly cadence can be missed (e.g. `Relationships.processAging`).
- The harness leaves out some calls that `ui/game/endDay.js` makes: `Townsfolk.processDay`, `CourierRiders.processDay` and `Victory.check`. The audit adds them after the harness day.
- The harness ledger also lacks `armyUpkeep`, `mercenaryWages` and `propertyUpkeep`, which `endDay.js` books from `player.endDay`'s results. See *Recommendations*.
- Everything below is what **the bot** does. The bot is a scripted player, and many "never fires" rows mean "the bot never tries". Those rows are still the cheapest pointer to content that a real player may not reach either.

---

## Part 1: Engagement audit

### Headline numbers

| | 101 | 202 | 303 | 404 |
|---|---|---|---|---|
| Survived 1,200 days | yes | yes | yes | yes |
| Gold, day 1200 | 2,334 | 5,316 | 3,652 | 1,848 |
| Net worth, peak → day 1200 | 34.6k → 5.0k | 25.7k → 22.3k | 94.2k (still rising) | 63.6k → 7.4k |
| Prestige, day 1200 | 482 | 50 | 547 | 207 |
| Crowned | King by day 100 | never (stayed "Citizen") | King by day 100 | King by day 900 |
| Quests completed | 1 | 1 | 1 | 2 |
| Achievements unlocked (of 101) | 33 | 34 | 35 | 29 |
| Sagas started / joined / won | 15/12/1 | 16/7/0 | 14/13/3 | 15/13/1 |

Across all seeds, 43 of 101 achievements fired at least once.

### Flat periods and novelty

Novelty means a first-ever thing in a run: a notice title, a world-event type, an achievement, a ledger category, a bot action or an offered action type. A flat week has no novelty at all.

| Days | Novel things (avg of 4 seeds) | Flat weeks (of ~28) | Distinct actions offered / week | Pending choices / day | Notices / week |
|---|---|---|---|---|---|
| 0–199 | 326 | 1–3 | 44–60 | 4.6–5.1 | 12–13 |
| 200–399 | 55 | 5–10 | 47–54 | 4.6–5.3 | 11–15 |
| 400–599 | 30 | 8–15 | 48–55 | 4.7–4.8 | 11–14 |
| 600–799 | 22 | 14–19 | 49–56 | 4.6–4.8 | 9–14 |
| 800–999 | 23 | 11–22 | 47–58 | 4.5–4.8 | 12–15 |
| 1000–1199 | 19 | 16–22 | 47–57 | 4.6–5.1 | 12–15 |

- **The run goes flat from about day 400.** By days 600–1,200, 55–75% of weeks bring nothing new.
- The longest flat stretches were 8–12 weeks, ending on day 791, 791, 847 and 1,113.
- After day 600, the new things are mostly world-driven, not choices. They are saga chapters, Bourse manias, a new town's "Whispers in X", and late achievements (`IMMORTAL` at day 1000 is just a clock).
- **Decision density stays level** at about 50 distinct action types per week, so choices don't run out. What runs out is *new kinds* of consequence.
- Pending choices hold at about 4.7 a day. Most of these are court letters: 700 letters arrived and 695 went unanswered. The bot ignores them, and the game does nothing much when they lapse.

### Never fires, or never changes state (4 × 1,200 days)

| Tick / content | Evidence | Reading |
|---|---|---|
| `Bills`, `Devotion`, `SoulPact`, `Mail`, `MapTheft`, `Housing`, `LegendaryArtifacts`, `Tavern.processInformants` / `expireOldIntel` | 0 / 120 sampled days changed any state | Opt-in systems the bot never enters. No pressure or offer pulls a player into them. |
| `Upbringing.processDay`, `Relationships.syncFolk`, `Relationships.processAging` | 0 / 120 | **The bot never marries or has children.** The whole dynasty spine (heirs, regency, upbringing, succession) is unexercised in 4,800 days. Aging may be a cadence miss. |
| `Sieges`, `HoldingSieges`, `KingdomAI.processRestorations` | 0 / 120 (one seed bought off 2 holding sieges) | Rare by design, but nothing in 1,200 days. |
| `Victory.check` | 0 / 120 | No goal was set; the harness doesn't apply scenarios. The goal path is untested at run length. |
| Quests | 1–2 completed per run | The board is barely used after the starter quest. Weak pull. |
| 58 of 101 achievements | never: TYCOON, GENERAL, HOLY, DIVINE, LANDLORD, MOGUL, MERCHANT_PRINCE, ROAD_WARRIOR, MASTER_BUILDER, BOUNTY_HUNTER, TREASURE_SEEKER, SPYMASTER, QUEST_MASTER, GLOBE_TROTTER, DUELIST, BLOOD_FEUD, KINGMAKER, LONG_REIGN, ADMIRAL, WYRMSLAYER, … | Mostly content the bot skips (duels, bounties, faith, building). TYCOON and MOGUL show the money ceiling (see below). |
| 52 of ~110 ledger categories | never: `caravans`, `caravanTrade`, `seaTrade`, `contracts`, `storeRooms`, `forwardPenalties`, `mintLease`, `taxFarms`, `tariffs`, `bribes`, `bail`, `benevolence`, `crownLoan`, `faith`, `culture`, `diplomacy`, `tournament`, `gambling`, `busking`, `bounties`, `ransoms`, `plunder`, `armyUpkeep`*, `mercenaryWages`*, `propertyUpkeep`*, `holdings`, `coalitionTerms`, `feast`, `festival`, `donation`, `housing`, `courting`, … | *= a harness gap, not the game. The rest are untaken activities. `bail` is also a bot gap: the bot pays bail by hand without booking it. |
| Timed world events | 18 kinds fired, most of them 1–4 times in 4,800 days (plague, gold rush, earthquake, succession crisis 1 each) | The world's big moments are rare. A run sees each about once. |

### Rarely fires (fires, but under 10% of sampled days)

`Achievements` (7/120), `Delves` (3), `Demands` (4), `FirstSteps` (4, by design), `MarketFairs` (9), `Espionage.applySpyVision` (7). `Coalitions` formed 2–3 leagues per crowned seed and none in the citizen seed. They work; they are a late-game event.

### Notice spam (counts over 4,800 days)

| Notice | Count | Per run-day |
|---|---|---|
| Heralds: "The Heralds Cry" | 2,327 | 0.48 |
| MerchantHouses: "Contract Posted" | 884 | 0.18 |
| CourtLetters: "A Letter Arrives" / "Unanswered" | 700 / 695 | 0.15 each |
| Mints: "Money Changers" | 302 | 0.06 *(fixed, see below)* |
| Relationships: "A Matter Left" | 289 | 0.06 |
| Guilds: "Guild Sabotage" | 280 | 0.06, all in one or two seeds: a feud that never cools |
| MerchantHouses: "A Royal Venture" | 187 | 0.04 |
| Rivals: "Champion Crowned" | 156 | 0.03 |

Heralds alone is half of all notices. It should be batched into the morning brief or rate-limited.

### Dominant strategies and money loops

All four seeds, in gold:

| Source / sink | In | Out | Note |
|---|---|---|---|
| `royalLevy` (Throne) | **210,085** | – | The biggest income by far, in the 3 crowned seeds only. Seed 303's Throne paid 148k. **Seizing a throne early is the dominant strategy**: the bot was King by day 100 in 2 of 4 seeds. |
| `properties` | 136,475 | – | Steady. |
| `theft` + `racket` + `guild` (crime) | 230,053 | – | Crime is the second pillar: heists, rackets and the Guildmaster's cut. `racket` and `guild` were unnamed ledger categories *(fixed)*. |
| `industry` (MerchantPrince works) | 94,894 | – | |
| `company` (trading company) | 33,818 | **117,814** | **The trading company lost money in every seed** (net −84k). It is a sink, not a business, at least as the bot runs it. |
| `patronage` | – | 68,735 | Prestige sink, working as meant. |
| `exchange` (money changers) | – | **48,092** | The largest single drain in two seeds (38k in 202): up to 5% of the purse at every border crossing *(fixed)*. |
| `schemeLosses` | – | 28,027 | Rival schemes bite. |
| `companions` | – | 25,741 | |

- Net worth collapses late in 2 of 4 seeds: 101 went from 34.6k to 2.9k by day 1000, and 404 from 63.6k to 7.4k. Properties dropped from 4 to 0. "Works Seized/Expropriated" (38) and holding losses are the likely cause.
- **Gold never compounds.** End gold is 1.8k–5.3k after 1,200 days. TYCOON and MOGUL never fire. The economy is a treadmill, which keeps it from running away but also gives the player no sense of growth.

### Performance (ms per simulated day; total ≈ 77 under 4× contention, about 50 when quiet; bot ≈ 18)

| Tick | ms/day | Calls | ms/call |
|---|---|---|---|
| `KingdomAI.processTurn` | 15.5 | 43,797 | 1.69 |
| `MarketDynamics.updatePrices` | 12.1 | 4,800 | 12.1 |
| `Peoples.processTurn` | 4.2 | 4,800 | 4.2 |
| `Labour.processDay` | 3.5 | 4,800 | 3.5 |
| `Concessions.processDay` | 2.2 | 4,800 | 2.2 |
| `Heralds.processDay` | 1.7 | 4,800 | 1.7 |
| `PriceKnowledge`, `Colonization`, `Guilds`, `NPCLords.processLordActions` | ~1.5 each | | |
| `MerchantHouses`, `Fiscal`, `PlayerActions.endDay`, `Mints`, `OutlawLairs`, `MoneySupply`, `Achievements`, `Whispers`, `Rivals`, `PuttingOut`, `Underwriting`, `EconomyChronicle`, `CourierRiders` | 1.0–1.5 each | | |

`KingdomAI.processTurn` and `MarketDynamics.updatePrices` together are a third of the daily turn. Market pricing runs every settlement every day. `Heralds` at 1.7 ms/day for a notice feed is out of proportion. `Achievements.checkAchievements` (1.1 ms) re-checks all 101 conditions every day.

---

## Part 2: Hollow-mechanics re-sweep (pass 23)

Swept since 2026-10-21:
- First Steps
- Origins, difficulty and victory
- Annals
- Coalitions and rival agents
- hospitality
- afterlife and interregnum
- world-editor custom maps
- everything the audit flagged

### Fixed (with tests in `src/__tests__/healthCheck.fixes.test.js`; mints in `mints.test.js`)

| # | What was hollow | Fix (file) |
|---|---|---|
| 1 | A forming league's letter named one price (`c.terms`); `concede` charged a fresh re-quote from the weekly `lastPower`. The letter button could fail or overcharge. `c.terms` was write-only after sending. | While forming, `concede` honours `c.terms` (`systems/coalitions.js`). |
| 2 | Ceding a holding gave `cede.reputation` and then `buyoff.reputation` (25, not 15). | Offset like the resolve already was (`coalitions.js`). |
| 3 | `threat.personality.*.war` in `data/coalitions.json` was read by nothing. | `Coalitions.warWill(k)` scales each member's share of the league's starting resolve: warlike lords make a stiffer league (`coalitions.js`). |
| 4 | `agents.kinds.informant.leakResolve` was ignored (hard-coded 3). | Read from data (`Coalitions._leakResolve`). |
| 5 | Interregnum days ran down a forming league's ultimatum. The returning heir was declared on the first morning with a disbanded army. | Days the House didn't tick push `dueDay` forward (`st.seenDay`, `coalitions.js`). |
| 6 | A won goal had `victory` tag weight 1, under the Annals' `minWeight` 4, so it never reached the book the victory scene points to. | `"victory": 10` in `data/annals.json` tagWeights. |
| 7 | Changing goal erased a goal already won; switching back re-fired the victory scene. `scenario.startDay` was write-only. | `Victory.setGoal` keeps the win in `pastVictories` and restores it on switching back (this life only, via `startDay`: `Victory.wonThisLife`). The Ambition panel labels this life's wins "Won earlier in this life" (`systems/victory.js`, `ui/actionMenu/scenario.js`). |
| 8 | An heir could resume the founder's First Steps; the card then vanished next day. | `canResume` refuses for a later generation (`systems/firstSteps.js`). |
| 9 | Difficulty `buyPrice` was missing from the guild-contract pay cap. On Easy, buying at 0.9× ask and delivering at up to ask−1 was a **money loop**. | `systems/guilds.js` applies `Difficulty.mult(player,'buyPrice')`. |
| 10 | The factor's buy quote ignored `buyPrice`, though the purchase charged it. | `MerchantHouses.factorBuyUnit` (`systems/merchantHouses.js`). |
| 11 | The Trade panel showed the list price; the purchase charged `Trading.buyCost` (discounts and difficulty). On Hard, a listed 100 cost about 110. | The buy list shows and checks affordability with `Trading.buyCost` (`ui/actionMenu/trade.js`). |
| 12 | "Tougher / softer foes" skipped sea fights and mercenary contracts. | `Difficulty.againstFoe` in `Pirates` odds (`systems/pirates.js`) and `MercContracts.winChance` (+ its panel quote) (`player/mercContracts.js`, `trade.js`). Exact on Normal, so golden tests are unchanged. |
| 13 | Custom (world-editor) maps started with no House, so prestige, rival Houses, demands, rival agents and leagues never ran, and a reload invented a blank House. They also had no First Steps. | `startCustomWorld` runs `House.initialize` / `seedRivals` and `FirstSteps.initialize` as `gameSetup` does (`ui/game/editorUI.js`). |
| 14 | No autosave during the interregnum: years of "let it run" could be lost. | `passInterregnumDays` autosaves when the wait crosses an autosave day (`ui/actionMenu/afterlife.js`). |
| 15 | *(audit)* Money changers took up to 5% of the purse at **every** border crossing: 302 notices and 48k gold, the largest drain in two seeds. | `exchange.cooldownDays: 14`: a purse assayed in the last two weeks isn't charged again (`systems/mints.js`, `data/mints.json`). |
| 16 | *(audit)* PEACEKEEPER ("positive relations with all kingdoms", gold tier) fired on day 2 for every bot, because a stranger's 0 counted. | Requires reputation > 0 everywhere (`systems/achievements.js`). |
| 17 | *(audit)* The `racket` and `guild` (Guildmaster's cut) ledger categories had no definition, so they showed as nameless "other" rows. | Named in `data/chronicle.json` under labour. |

### Left open (other agents' areas at the time of the sweep, or design calls)

| Where | Finding | Suggested fix |
|---|---|---|
| `systems/hospitality.js`, `systems/saveLoad.js` | **A booked room is lost on save/load.** `player.lodging`, `_restTypeOverride` and `_lastRestType` aren't serialized. `_lastRestType` is also read by `ailments.js:392` and `worldEvents.js:887`. | Add to `EXTRA_PLAYER_FIELDS` (hospitality owner). |
| `systems/ships.js:1151` | `huntPirates` enemy power is not scaled by `enemyStrength`. | `Difficulty.againstFoe` as done for `Pirates` (ships owner). |
| `player/playerEconomy/caravans.js`, `routes.js` | Indirect sales skip `sellPrice`: on Brutal, caravans pay full price. | Multiply by `Difficulty.mult(player,'sellPrice')`. |
| `ui/actionMenu/annals.js` | The scribe cache `game._annalsScribe` is keyed only by chapter id. The live chapter's prose freezes, and it survives loading another save. | Key by chapter text or day; clear on new game or load (Annals owner). |
| `player/afterlife.js` WORLD_DAY | About 19 player-keyed systems no-op with `player=null`: Finance, Bourse, MerchantHouses, Sagas, Whispers, OutlawLairs, Throne, Kingship, … Their state freezes during an interregnum, yet the header promises "rivals' banks and caravans" run. | Pass the estate to the world-side systems, or correct the promise. |
| `player/afterlife.js` `becomeStranger` | A new life leaves the old league's coalition embargo on the crown until the crowns' weekly turn. `_leave` never runs. | End the league (`Coalitions._end(…, endWars)`) when a new life begins. |
| `systems/coalitions.js` | `_end('humbled' / 'broken')` keeps member wars alive with no league resolve left to end them. This may be by design. Write-only: `c.activeDay`, `c.cb`, `m.why`, `m.leftDay`, and history `why` / `casusBelli`. | Show "why" in Past leagues, or drop the fields. |
| `ui/actionMenu/threats.js` | The league card says members "levy 25%… will not receive you" while the league is still *forming* (only the leader refuses then). | Text by `c.stage` (threats.js was being edited by another agent). |
| `systems/rivalAgents.js` | `agents.kinds.*.deed` and `agents.suspicion.afterAct` are unread. `stats.recruited`, `leaks` and `inquiries`, plus `a.turnedDay`, `scheme.leakedBy` and `h.bribed.rivalId`, are write-only. | Read them in the panel or drop them (rival-agents owner). |
| `components/SettingsScreen.jsx` | The New Game sheet imports `data/scenarios.json` directly, so modded origins and difficulties aren't offered. `Scenarios.choices()` (DataLoader-based) is unused. | Build the lists from `Scenarios.choices()`. |
| `core/difficulty.js` | `illness` scales only the deadliness of an illness, not how often you catch one, so "gentler sickness" is half true. `player.scenario.realm` is write-only. | Scale `_tryCatch` too; read `realm` in crown-goal progress. |
| `data/annals.json` | The `piety` theme tag is never emitted. `DEFAULTS.faithTraits` (`annals.js:44`) is unread. | Emit `piety` from devotion chronicle lines, or drop it. |

---

## Recommendations (in priority order)

1. **Give the mid-game new kinds of consequence.** Novelty falls from about 326 per 200 days to about 20 after day 400, while the actions on offer stay level. That is the "shallowness" the dynasty-spine project targets. Concretely:
   - put Coalitions, holding sieges and sagas on a timer that scales with the player's power, not on rare rolls;
   - make the 58 never-seen achievements and the unused ledger categories into Counsel nudges ("you have never held a feast; the court notices");
   - make an unanswered court letter cost something. 695 of 700 lapsed with no felt consequence.
2. **Rebalance the crown.** `royalLevy` (210k) outearns every other source put together. Seizing a throne by day 100 is too easy for a scripted bot. Raise the claim and battle bar, or tie the levy to stability and upkeep.
3. **Make the trading company able to pay.** It was a net −84k across 4 seeds. Either the bot plays it badly (look at `bot.js company()`), or its overhead (factors, rent, robbery, ventures) is too high for its margins. The Merchant's Ledger should show the player why.
4. **Let wealth compound a little.** End gold was 1.8–5.3k after 1,200 days. TYCOON and MOGUL are unreachable. Gold sinks (patronage, companions, schemes, the company) scale with income, so nothing accumulates.
5. **Notice hygiene.** Batch Heralds (2,327), Contract Posted (884) and Guild Sabotage (280 in a single feud) into the morning brief. Cap repeats per week.
6. **Teach the bot a family.** Courtship, marriage and children would exercise House, heirs, upbringing and succession in the soak, which currently run zero times. Let it also answer letters, set a victory goal and take quests, so the audit sees those paths.
7. **Close the harness gaps.** Mirror `Townsfolk`, `CourierRiders` and `Victory.check`, and book `armyUpkeep`, `mercenaryWages` and `propertyUpkeep` into `Ledger.fromResults`, so the soak ledger matches the game's.
8. **Perf.** `MarketDynamics.updatePrices` (12 ms/day) and `KingdomAI.processTurn` (15 ms/day) are the targets:
   - stagger per-settlement repricing (a third of the towns per day);
   - memoise kingdom AI lookups;
   - `Heralds` (1.7 ms) and `Achievements` (1.1 ms, 101 checks a day) can run weekly or on dirty flags.
