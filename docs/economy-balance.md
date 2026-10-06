# Economy balance — baseline (2026-10 pass)

This is the first side-by-side comparison of the game's income sources. Use it as a
baseline: re-measure against these numbers before you add or retune a source.

## How it was measured

- **Harness.** Throwaway vitest scripts drove the headless harness
  (`src/__tests__/playtest/harness.js`) with scripted, focused strategies. The random
  bot was not used. The player was kept fed so each run measured income rather than
  survival.
- **Seeds and length.** Seeds 101, 202 and 303 (plus 404 and 505 for the company).
  Properties ran for 120 days (one game year), the trading company for 360.
- **Early vs late.** "Early" is a fresh character. "Late" is a seasoned one: Commerce,
  Combat and Stealth 6, the main stats 7.
- **Units.**
  - **g/day** is gold per day of the player's time. For passive sources (properties,
    contracts) it is net gold per day of ownership.
  - **Payback** is build cost ÷ net g/day.
  - The player has 10 AP a day; a full-day job uses the whole day.
- **Sources too UI-bound to script.** Odd jobs, busking, the minigames, tournaments and
  smuggling by hand are worked out from their formulas, with a typical 60% minigame
  score.
- **Noise.** A weak early character on the road gets robbed, which adds noise to
  passive runs. Where a run was distorted that way, the table uses the formula, which
  the clean runs matched to within about 10%.

## Target progression

| Tier | Examples | g/day of player time |
|---|---|---|
| Early, safe | Odd jobs, busking, foraging, fishing, planting contracts | 10–60 |
| Skilled or risky | Delves, sea trade, bounties, guild heists, piracy | 100–350, with real risk |
| Capital investment | Properties, taverns, caravans, the trading company | Repays the stake over a season or more (30–60 days early, 22–50 days late), not in days |
| Endgame | Holdings, royal levy, sieges | Large but slow, and costly to reach |

Two further rules: nothing dominates everything, and nothing is useless.

## Results

Notes on reading the table:
- Payback is in days; one game year is 120 days and one season is 30.
- A **bold** source was changed in this pass.

| Source | Before | After | Rationale |
|---|---|---|---|
| Odd jobs (village / town / capital) | 15–20 / 25–35 / 45–60 g/day | unchanged | Day labour, scaled by town size |
| Busking (village / town / capital) | 10 / 23 / 40 g/day early, about 60 late at a capital | unchanged | Same band as odd jobs |
| Foraging / hunting / fishing | 5–40 g per outing (3–4 AP) | unchanged | Early filler. The minigames are being reworked separately |
| Planting contracts | 8–15 g advance plus 45–100 g at harvest, up to 3 a spring | unchanged | A small seasonal bonus |
| **Raw producers** (farm, apiary, salt pans, pasture, …) | Repaid in **3–20 days**: apiary 66–77 g/day for 255 g, salt pans 55–75 g/day | Repaid in **30–55 days** early, **22–50** late: apiary 22 g/day (28 late) for about 850 g, salt pans 14–15 g/day for about 740 g | A 300 g building was repaid in under a week and dominated everything. Build costs are up 1.4–3.3×, output is down 25–60%, and some upkeep went up (`data/playerEconomy.json`) |
| **Mine** | Iron 55 g/day, gems about 200 g/day, for 1,000 g | 3/day for 1,800 g: iron about 27 g/day (about 50 days), gold ore about 70, gems about 110 | Gem and gold mines stay the prize sites. Stone and coal belong in a quarry |
| **Processing buildings** (outliers) | Tannery, winery, fletcher, dye works and weaver repaid in **7–10 days** | Repaid in about **25–45 days** | Lower output per day and higher cost. Arrows: 4 per run, was 8. Workshop rate 3, apothecary 2, brewery 4 |
| **Tavern** (capital / town / village) | 70–88 / 26–35 / about 7 g/day for 900 g, repaid in about 12 days at a capital | About 31 / 19–27 / 8 g/day for 1,200 g, repaid in **35–60 days** at a town or capital. A village tavern is a slow investment (about 140 days) | Lower takings: 14 / 18 / 22 g base, and +2 per 250 people up to +16 (`property.js`). Upkeep is down from 12 g to 8 g so a village tavern still pays its way |
| **Caravans (one-off and routes)** | **Crashed on arrival.** `MarketDynamics.getPrice` was called with no world. The formula paid 2–3× the cargo's whole value | Pays what the destination market pays (70% of its price) × (1 + 2.5%/hex) × 1.2 at a capital or 1.1 at a city: about +50% on a long capital-to-capital haul, about break-even on a short one | Fixes the crash, and removes a money loop the crash had hidden |
| **Caravans** (settlement-market pass, see below) | as the row above | 70% of what the load is worth at the destination's stock (a big load is valued as it floods the stalls) × (1 + **1%**/hex) × size × Commerce. Measured on 50-unit loads, capital to capital: median **+15–30%** net of the 200 g hire (+132 to +315 g on 500–1,000 g) early, +20–75% late. A glut-to-dearth haul pays +100–165% (fish or bread to a starving capital) until the loads fill the dearth | The regional price gap now does the work the flat 2.5%/hex premium did. That premium on top of real scarcity paid up to 3.7× on bread |
| **Land trading** (buy here, sell there) | Loses about 12% except on resource-cheap goods and with the season | A greedy trader within 8 hexes: **+3 to +4 g/day** (8–27 trips in 120 days). The best single lots return +136–154%, but a village's or town's stock is shallow. Seasonal grain, bought at a town just after the harvest (day 88) and sold in the lean weeks (day 115): **+84%** at the dearest market within 6 hexes, +2 to +30% in the same town, and −15% in a glutted region | Prices follow each town's real stock, so the arbitrage is regional and seasonal. Buying pushes the price up and selling pushes it down along the same curve, so a trip's margin shrinks as it grows. Same-tile buy→sell-back stays impossible |
| **Sea trade** (cog, best-margin route; re-measured 2026-10, port prices follow stock) | 66–161 g/day early, 76–154 late | Median 116–169 g/day per port, p75 250–320, a tail to 400–700 on glut→dearth pairs | Skilled and capital-heavy, with ship upkeep and wages. The median is in the right band; the tail is left open (a port prices a whole lot at one unit's price). See [Merchant Prince](#merchant-prince-2026-10) |
| **Industry shares** (works funded in a town, new; re-measured 2026-10 with the works' share of the town's trade) | — | One level repays in 33–57 days in a great town (bakehouse 640g → about 17 g/day, 40 days; 22–42 days once the towns have grown). Spread towns take 52–400 days; extra levels saturate (3 levels of a bakehouse: 65 days). The weaving shed and smithy stay starved of inputs (121 and 381 days) | Capital investment, sized by the town's trade, spare inputs and appetite. Tithe, seizure, expropriation and raids are the risk |
| **Warehouses** (new) | — | Harvest-to-lean grain speculation: median +9% to +48% in 30 days (p25 −49% to +20%) on a small stake | Speculation, not income. A same-tile buy→sell loses |
| **Forward contracts** (new) | — | +3% + 0.2%/day over today's sale price (at most 15%), capped at the buy-back price. Failure costs 25% and reputation | A hedge or bet on the town's price. Filling one at once from the same stalls loses |
| **Trading company** (scripted: one capital post, seasonal bread, only contracts the posts can source, expanding to a market that sells a contract's good) | 5 seeds over 360 days on 5,000 capital: +336, +112, −1,028, +1,979, +2,343 (mean **+750**) | +5,102, −501, +4,126, −837, +1,459 (mean **+1,870**, about +5 g/day) | See [The trading company](#the-trading-company) |
| Royal ventures | Expected return about 1.11–1.14× over 30–80 days | unchanged | A modest gamble, as designed |
| Delves | About 140–180 g per delve early (gold plus items), 230–360 late | unchanged | Risky, limited sites, one day each. Right where risky play should be |
| Bounty hunting | 175–305 g per capture at difficulty 3, rising with rank; about 50–80 g/day including the travel | unchanged | |
| Thieves' guild jobs | Pickpocket about 5 g/day net, burglary −8 to +6 g/day, after fines and jail | **Burglary pays 30–90 g** (was 20–70). Pickpocketing unchanged | Petty crime stays poor. Heat and jail are the price. Rackets, heists and the guildmaster's cut are where the guild pays |
| Heists | Royal treasury 600–1,400 g against a plan of up to 460 g | unchanged | |
| **Smuggling by hand** (Underworld → Smuggle) | Fixed price list × 2.5: gems sold for 200 g against 54 g in the square, with success up to 104% as Stealth rose. **A same-tile money loop** | 1.3× the black-market price, capped at the open-sale cap (`Underworld.openSaleCap`, half the local ask). Success capped at 90% | Closes the loop with the same rule as the fence and black market |
| Smuggling routes | ×1.35 on the route formula, with catch risk | Inherits the new caravan formula | |
| **Tournaments** | Fee 200/300 g, pool 4× the fee, repeatable **every day**. With Combat 8 or more you always win: **+500 to +900 g/day** | Pool 3× the fee, once every 10 days (`player.lastTournamentDay`, saved) | A daily jackpot for a strong fighter dominated every other source |
| Festivals | Always a net gold cost (260–820 g) | unchanged | A prestige and diplomacy sink, by design |
| **Mercenary contracts** | Passive while you do other things: guard duty about 23 g/day, monster hunt about 70, **assassination 308 g/day with a 15-strength army** | Assassination 400 g over 6 days, needs 45 strength: about 40 g/day. Others unchanged | Assassination paid 4× the next contract and stacked with everything else |
| **Holdings: taxes** | 0.1 g per head a week × rate: a 2,000-person town at moderate tax gave about 30 g a week, which did not cover a governor | 0.25 g per head (`Taxation.TAX_PER_HEAD`): about 75 g a week | A holding should at least pay its steward. Projects (market square +12% and so on) scale from here |
| Holdings: projects | Market square 300 g, +12% tax, +4% sale price | unchanged | |
| Royal levy (ruling) | 15% of the treasury's daily gain, at most 200 g/day. The bot averaged about 73 g/day over 800 days | unchanged | The endgame payoff for taking a crown |
| Throne and claims | Royal match 500 g, forged claim 300 g, pressing a claim 300 g | unchanged | Sinks priced against the levy |
| Discoveries | Exotic gather about 4 units × 115 × 0.7, about 320 g a good, regrowing 1 per 4 days. Charts 150–400 g, once per realm | unchanged | One-off exploration rewards |
| Sieges | Ransom about population × 1.06 g; storm plunder population × 1–3; sack population × 3–6, which costs karma and reputation | unchanged | War booty behind an army big enough to win |
| Piracy / pirate hunting | Piracy 50–300 g per 10 AP, costing reputation with every realm; hunting about 65 g loot plus a prize chance | unchanged | |

## The trading company

The bot's companies lost 25,000–48,000 g over 800 days. Its own strategy caused most
of that:
- three posts with random standing orders that sold at +15% and so rarely sold;
- royal ventures and monopoly lobbying;
- robbery of stock left sitting in guild towns.

**A sensible strategy did make money before this pass, but thinly.** The strategy:
- one post at a capital (0.8× prices);
- bread bought below 76% of the capital's price after the harvest and sold in the lean
  months, for about 3.6 g a loaf;
- only the contracts a post can source at a profit.

It made a mean of +750 g over 360 days, and 1 of 5 seeds lost money.

**What held it back.**
- **Few contracts could be sourced.** Every market sells grain and bread, and towns sell
  wood, stone and tools. Contracts only ask for goods the town can't buy at home or next
  door, so nearly every contract good (rope, hemp, clay, candles, shields, …) was
  something no market sells.
- **Thin margins.** Robbery (7.5% a week in guild towns, which is most towns, taking
  25–60% of the stock) and 8 g of rent a week ate the seasonal margin.

**Changes** (`data/merchantHouses.json`, with matching code defaults):
- **Contracts** can also ask for goods some markets sell but the contract town can't
  buy:
  - meat for famine and siege relief;
  - rock oil for the fleet;
  - horses and coal for the war;
  - gems and liquor for a court wedding.

  This gives the company a real "move goods" business. Contract pay is still capped
  below anything bought on the spot (`contractUnitPay`).
- **Robbery:**

  | | Before | After |
  |---|---|---|
  | Base chance a week | 3.5% | 3% |
  | Extra in a guild town | +4% | +2% |
  | Stock taken | 25–60% | 20–50% |
- **Post rent:** 8 g a week, now 5 g.
- **Factor volume:** 20 + 8 × skill, now 30 + 8 × skill.
- **A rival in town** now leaves the factor 75% of his selling volume (was 60%).

**Result:** a mean of +1,870 g over 360 days on 5,000 g, about 12% a year. Two of five
seeds still lose money in a year with no sourceable contracts.

**What did not change:**
- Every same-tile and adjacent arbitrage cap: `Trading.saleUnitCap`,
  `Ships.nearbyAsks`, `Underworld.openSaleCap`, factors buying and selling by the
  player's own prices, `contractUnitPay`.
- The soak's arbitrage probe stays green.

## Banks, Credit & Coin

`systems/finance.js`, with tunables in `data/finance.json` and the loan products in
`market.json` → `loanOptions`. This section was measured on seeds 101, 202 and 303 for
one game year (120 days), with the finance tick running alone and 20,000 g in hand. The
world numbers come from 5 seeds × 720 days with the bot.

**The rule.** Deposits and bonds are a safe, slow return, well below every capital
investment above. Loans are a leverage tool that pays when the money goes into
something that earns, and that really hurts when it doesn't.

| Instrument | Return or cost | Compare |
|---|---|---|
| **Deposit** | 4.05% a year at a house with full reserves, compounded daily: 5,000 g became 5,176–5,212 g in a year. The rate runs from 3% to 7.5% as reserves fall | Trading company about 12% a year. A raw producer repays itself in 30–55 days, roughly 200–400% a year |
| **Royal bond** (healthy crown) | 6.0% a year: a 5,000 g bond for 120 days paid 289 g in coupons, plus +10 reputation and +12 Prestige | Up to 20% for a crown in debt or with debased coin, with real default risk: coupons can be missed, repayment put off and the principal cut |
| **Small loan** (500 g, 30 days) | 9.4% flat at a fresh score of 560, 8.1% at 647 | |
| **Medium loan** (2,000 g, 60 days) | 14.1% / 12.2% | Builds two raw producers that repay themselves inside the term |
| **Large loan** (5,000 g, 90 days) | 18.8% / 16.3%. Needs a score of 600 | |
| **Great loan** (15,000 g, 120 days) | 26.3% / 22.7%. Needs a score of 680 | |

**Interest on loans** is a flat charge for the term. The credit factor is 1 at a score of
600, about 0.67 at 800 and 1.33 at 400. A house whose reserves have fallen below 80%
charges up to 60% more. The techs still cut it: Merchant Guild by 25% and Banking
Systems by 20%.

**Borrowing limit:** (60% of collateral + gold) × a score factor (0.25–1.75), plus 300 g
for a clean name. A fresh character with 20,000 g in hand had a limit of about 19,500 g.

**The downside is real.**
- A missed day adds a quarter of the daily payment and a day to the term.
- **7 days overdue:** bailiffs take goods at half their value.
- **14 days, then weekly:** the lender seizes deposits, the most valuable property, a
  docked ship or the company's capital, all at half their value.
- **30 days:** a write-off. You lose 15 reputation in the realm and 20 Prestige plus
  0.5% of the debt, and that house will lend nothing more until you make the debt good.
  Debts of 1,500 g or more put a bounty of a quarter of the debt (at most 3,000 g) on
  you. Debts of 4,000 g or more add the debtors' prison: a 20% daily arrest chance in
  the realm's towns, 5–20 days inside.

**Crowns.** Kingdom treasuries already grow by thousands of gold a day, so crown finance
is relative to each crown's own income:
- War spending is 1.6 × the smoothed daily income.
- The reserve is 30 days of income.
- Capacity is 25 days of income. A crown is in crisis above 1.2 × capacity, after two
  missed weekly payments, or after 14 days of unpaid armies.
- Houses lend to crowns only while their own reserves stay at 60% or more.

Over 720 days per seed:

| Seed | Crown loans | Highest debt ratio | Crises and events | Houses failed |
|---|---|---|---|---|
| 101 | 73 | 1.49 | 3 debasements, 2 levies, 1 run | 0 |
| 202 | 160 | 4.40 | 6 debasements, 3 levies, 1 run | 0 |
| 303 | 85 | 1.24 | 1 crown default, 1 debasement, 1 royal seizure, 6 runs, 1 silver find | 0 |
| 404 | 144 | 1.85 | 3 crown defaults, 3 debasements, 3 levies, 4 runs | 0 |
| 505 | 5 | 1.47 | 1 levy, 1 run | 0 |

Coin purity recovered to 1.0 everywhere but one realm (0.86) by the end. Bank failures
are rare by design: a run fails with about 10% odds at 60% reserves, rising as the vaults
empty. None failed in these ten world-years. The tests force failures.

**Debasement** takes 0.1 of the silver out per step, down to a floor of 0.5. Each step
raises prices by 9% in every market of that realm, through `Coinage.priceMultiplier`,
which is one multiplier in `Economy.marketPrice`. Buying and selling in the same market
rise together, so the same-tile arbitrage caps hold.

**Soak.** `SOAK=1 npx vitest run src/__tests__/playtest.soak.test.js` passes: 5 seeds ×
800 days, with the bot depositing, borrowing, repaying and buying bonds.

## Settlement markets (2026-10)

Every settlement keeps one goods store (`world/settlementMarket.js`, `data/markets.json`). It is filled by its land and resources, emptied by its people, and balanced by NPC trade between linked towns. Buy and sell prices, caravans, ports, factors and tavern talk all read the same store. See [the manual](../GAMEPLAY_MANUAL.md#town-markets-stock-scarcity-and-trade).

**How it was measured.** These are throwaway harness scripts (seeds 101, 202 and 404) that keep the player fed, plus a world survey (seed 101, 240 days):
- the greedy land trader;
- seasonal grain;
- capital-to-capital 50-unit caravans by the `updateCaravans` formula.

**World health (seed 101, days 30–240).**
- No town is in dearth.
- Average scarcity by good:
  - Grain swings with the year, from 0.7 after the harvest to 1.1–1.3 in spring.
  - Fish is 1.4–1.6 (inland towns import it).
  - Firewood and wood are 0.65–0.7 (most land is wooded).
  - Tools, clothes, horses and salt drift up to 1.2–1.9 as towns grow.
- Market mood is about 0 on average. Plenty and cold hearths are local, not universal.

**Food the player buys.** The bot's food bill over 150 days was 926–1,287 g, against 790–1,032 g before:
- Village stalls are shallow (each aims to hold at least 50 grain and 20 bread).
- A 25–30 unit purchase climbs the curve.
- Spring prices carry both the season and the stores running down.

The harness bot now buys with `Trading.affordable`.

**Kingdom trade income.**

| | Trade income across the world | Kingdom treasuries |
|---|---|---|
| Before (flat 5–50 g per route a day) | About 26,000 g/day by day 120, growing without limit as routes piled up | 60,000–820,000 g at day 120 |
| Now (half each of the value gap of the goods moved × 6) | 7,000–9,000 g/day, steady | 30,000–330,000 g at day 240 |

Kingdom survival in the 1,080-day multi-seed sim is unchanged (see below).

**Kingdom survival (seeds 7–11, 1,080 days).**

| | Alive (of 10) | Wars |
|---|---|---|
| Before | 10, 8, 9, 8, 10 | 45, 84, 68, 23, 40 |
| After | 9, 9, 9, 8, 10 | 53, 89, 75, 40, 36 |

**Cost per day.** Measured on the harness world (80×60, about 70–80 towns, the player kept alive, median over 150 days):

| | Old supply/demand tick | New market tick |
|---|---|---|
| Market tick | 4.4–5.5 ms (every town's production worked out every day) | 1.4–2.5 ms (each market every 4th day, production profiles every 20 days, links every 30) |
| `world.advanceDay` | about 6–10 ms | unchanged |

**What did not change.**
- Same-tile and next-door caps: a sale never pays more than buying the same units back here, at the stock the sale leaves (`Trading.saleUnitCap` walks the same curve), or next door.
- Fences, the black market, ports and contracts are still capped by `Ships.nearbyAsks` / `Underworld.openSaleCap`.
- The soak's arbitrage probe stays green.

## Merchant Prince (2026-10)

These are the player's levers on the settlement economy: industry, warehouses, forward contracts and fairs (`systems/merchantPrince.js`, `systems/marketFairs.js`, `data/merchantPrince.json`). See [the manual](../GAMEPLAY_MANUAL.md#merchant-prince-industry-warehouses-and-contracts).

**How it was measured.** These are throwaway harness scripts on seeds 101, 202 and 303, with the player kept fed:
- **Industry.** After 20 days, one level of a works was funded in each of 8 towns per seed, and the player's share (after the crown's 10% tithe) was banked for 120 days. "Great towns" means the 8 most populous towns that have the trade. "Spread" means 8 towns spaced evenly by size. Payback is gold invested ÷ g/day.
- **Warehouses.** A store-room at every city and capital bought up to 100 grain on day 85 of the year (after the harvest) and sold it on day 115 (the lean weeks), net of key fee, rent and spoilage.
- **Sea trade.** Every 15 days, each port's best route (a cog, 40 units, 3 hexes a day, upkeep and 8 sailors' wages) was priced from `Ships.getPortMarket`, which now reads each town's stock.

**Industry: one level, foreign town, 52% share less a 10% tithe and the hands' wages** (re-measured 2026-10, after the labour pass, with the works taking their share of the town's trade — see below). "Took" is the share of the works' capacity that came from the town's own trade. "Before" is the same measurement on the code before this pass. "Late" funds the works on day 200 instead of day 20.

| Works | Price (gold + materials) | Great towns: g/day median (p25–p75) | Payback median (p25) | Took | Before: payback | Late: payback | Spread towns: payback |
|---|---|---|---|---|---|---|---|
| Bakehouse | 640 + 10 wood, 15 stone | 16.8 (12.3–18.4) | **40** (35) | 65% | 46 | 34 | 52 |
| Brewhouse | 540 + 20 wood, 5 stone | 11.2 (9.8–13.9) | **49** (39) | 36% | 50 | 38 | 129 |
| Grain mill | 160 + 10 wood, 5 stone | 4.2 (2.4–5.2) | **44** (31) | 5% | 44 | 32 | 400 |
| Distillery | 310 + 10 wood, 2 iron | 7.4 (5.8–8.7) | **44** (36) | 11% | 45 | 39 | 93 |
| Charcoal kilns | 240 + 10 stone | 6.4 (3.6–8.3) | **41** (29) | 17% | 50 | 37 | idle in wooded country |
| Tannery | **400** (was 260) + 10 wood, 5 stone | 7.0 (6.4–7.7) | **57** (52) | 45% | 43 | 22 | about 320 |
| Jewellers' row | 300 + 10 stone, 3 tools | 6.0 (5.0–7.2) | **52** (42) | 0 | 52 | idle (gems bought up) | 52 (cities only) |
| Armoury | 260 + 10 stone, 6 iron | 6.8 (2.7–8.3) | **38** (31) | 0 | 39 | 42 | 137 |
| Creamery | 150 + 10 wood, 5 stone | 4.9 (3.1–5.7) | **33** (27) | 2% | 43 | 26 | 72 |
| Tailors' hall | 210 + 10 wood, 3 textiles | 4.1 (3.7–5.6) | **53** (37) | 0 | 53 | 29 | 78 |
| Weaving shed | 200 + 15 wood | 1.7 (1.0–2.1) | 121 (96) | 0 | 121 | idle | 649 — starved of wool unless you bring it |
| Smithy | 200 + 10 stone, 4 iron | 0.7 (0.0–2.3) | 381 (86) | 0 | 381 | 304 | 667 — starved of iron unless you bring it |

- **The works take a share of the town's trade** (`data/markets.json` works.capture, `SettlementMarket._runWorks`). On market day a works first takes over `capture` × its runs ÷ (its runs + the trade's capacity) of the runs the town's own trade made that turn, valued at the town's prices after the trade's work (a run must still clear `minMargin` and its hands' wages). The stores end exactly as the trade left them: only the margin changes hands. Then it runs on top as before, on the town's spare inputs. So a level of a big, busy trade (bread, beer, leather in a great town) earns even while the town's own trade keeps its goods at target and there is no room to run on top, and a works in a small or idle trade earns little. The craft works (jewellers, armoury, tailors, smithy, weavers) take nothing: their towns' own trades rarely run, and those works live on the spare inputs as before.
- **Before this pass** the payback was already 39–53 days in the great towns for ten of the twelve works (table's "Before" column, the code at the labour commit). The labour pass's note that bakehouses and brewhouses stood idle (median 0 g/day) and the craft works took 66–134 days did not reproduce under this methodology, with the works funded one kind at a time or all twelve together in the 8 largest cities. With all twelve together the grain works share the town's spare grain, and the brewhouse and distillery slow to 58–64 days, before and after (the bakehouse, 38 days, takes most of its runs from the town's bakers). The capture makes the income robust to the town's own trade filling its goods: without it a works stands idle whenever the trade leaves no room on top (tested).
- **The tannery** became the outlier with the capture (leather grows dearer as the towns grow: 15 days late at 260g). Its price is up to 400g: 57 days early, 22 late.
- **Right town, wrong town.** In the spread towns (8 spaced evenly by size) the brewhouse, mill, distillery, tannery and armoury take 90–400 days, and the charcoal kilns stand idle in wooded country. The bakehouse stays good anywhere with grain (52 days).
- **Open.** The weaving shed and the smithy are still starved of wool and iron in every kind of town; they pay only when you sell those inputs into the town. The jewellers' row stands idle late in the game, when the nobles' and merchants' baskets (data/labour.json) have bought up the gems.
- **Levels saturate.** Three levels of a bakehouse (2,670g) in a great town pay a median of 43.6 g/day, about 65 days to pay back (69 before). A brewhouse takes 94 days (97), a mill 165 (182) and a tannery about 170. The capture's share shrinks as the works grow against the trade, and more capacity than the town's stores can feed or absorb stands idle.
- **Not offered.** The forge (iron + 2 firewood → 0.8 tools) adds no value at base prices, and the chandlery's rock oil is too rare.
- **Why it is not a money loop.**
  - The works can only process what the town has to spare: at least half the input's target stays for the townsfolk. The runs they take over from the town's trade move no goods at all: they only pay the investor a share of a margin the trade made anyway.
  - Each run is valued at the town's own scarcity curve, so the works drive their own margin down. Their output gluts the stalls (and stops at twice its target), and their inputs grow dear.
  - The crown's tithe (more at war or in a crisis), seizure, expropriation, raids and sieges put the stake at risk.
  - Selling a stake back returns 40% of the price.
  - The test suite checks that three weeks of a great town's bakehouse and brewhouse repay well under the stake.
- **In the soak** (800 days, 5 seeds), the bot funded 6–16 works for 3,600–8,300g and drew 6,900–51,500g from them over the run. Re-run with the works' share of the trade: 6–12 works, and the Merchant Prince ledger (works, store-rooms and forwards together) took in 11,400–88,400g, against 5–14 works and 23,600–102,900g for the code before (the bot's runs diverge, so compare the ranges). The short soak's seed 202 then found the bot on an island capital whose grain was in dearth and whose bread the Bakers' Guild holds by monopoly: it starved with 2,600g in its purse. The bot now buys fish when there is no grain or bread to be had. That is a season-scale payback, then a steady income, like properties.

**Warehouses: harvest → lean-weeks grain, about 100 units, 30 days.**

| Seed | ROI after key fee, rent and spoilage (p25 / median / p75) |
|---|---|
| 101 | −49% / +9% / +47% |
| 202 | +19% / +43% / +143% |
| 303 | +20% / +48% / +151% |

- It is real speculation. A town that stays glutted into spring loses money.
- The stake is small (100 grain is 300–600g), so the gold per day is 1–10. It belongs in the "skilled or risky" trading tier, not as an income source on its own.
- Buying into store and selling straight back always loses: the curve and the 70% share see to it (tested).
- Thefts (1–6% a week) and spoiling bread, fish and meat are the downside.

**Forward contracts.**
- The premium for the wait is 3% + 0.2% a day, at most 15%: about 9% on a 30-day contract, priced to the copper.
- The price is capped at buying the lot back here (`Trading.saleUnitCap`). At capitals, which already buy close to their ask, the cap usually binds, so the premium is mostly paid in towns and villages.
- Filling a fresh contract with goods bought on the spot loses (tested).
- The forward pays when the town's price falls before delivery, or when you bring the goods from a glut. Missing the day forfeits 25% of the undelivered value and 4–8 reputation in the realm.

**Fairs.**
- A fair puts 30–50% of a target's worth of each fair good into the town's stores.
- For 6–7 days it cuts the stalls' ask by 6–8% and raises what they pay to 75–76% of worth. Same-tile sales stay capped (tested).

**Sea trade, re-measured.** Port prices now follow the town's stock (`Ships.getPortMarket` reads `SettlementMarket.value`). Each port's best cog route, net of upkeep and wages, in g/day:

| Seed | p25 | Median | p75 | p90 |
|---|---|---|---|---|
| 101 | 100 | 169 | 322 | 682 |
| 202 | 78 | 116 | 255 | 522 |
| 303 | 108 | 166 | 252 | 392 |

- The median sits in the skilled band, as before (66–161).
- The tail is new. A port that exports a good from a glut and a port that imports it in a dearth can pay 400–700 g/day on paper, because a port prices a whole 40-unit lot at one unit's price.
- **Left open:** walk port lots along the curve as town sales do.

**Fuel and plenty** (`data/markets.json`, `_tuning2026_10b`).
- **Fuel.**
  - Firewood now holds at most 2× its target (was 4×), burns 3× in the cold (was 2.5×; coal 2×), and the land yields less of it.
  - A fuel shortage (gauge above 0.1) went from 0.03% to 1.1% of town-days in a temperate world (seed 101). That is 7% of its cold days.
  - In a cold world (seed 202) it went from 11.8% to 15.6% of town-days.
- **Plenty.**
  - Brewers now brew ahead of need while grain is in glut (`fill` 1.25), and `plentyMood` is 2.5.
  - Mood is up by more than 0.25 on 22–30% of town-days: 42–53% in winter and 10–20% in spring.
  - The mean lift is 0.1–0.4 points.

## Town guilds (2026-10)

Craft and merchant guilds (`systems/guilds.js`, `data/guilds.json`; see [the manual](../GAMEPLAY_MANUAL.md#town-guilds)). Measured with throwaway harness runs on seeds 101, 202 and 303 (400 days, player kept fed) and the 800-day soak (5 seeds).

- **The world.**
  - 19–23 towns hold 159–177 guilds, about 8 per town. Each hall holds about 190–200g on average.
  - 11–20 guilds win a royal charter and 16–19 win a guild monopoly by lobbying foreign crowns.
- **Strikes.** With `strikeAt` 1.2, a 90-day cooldown and a 50% roll, there were 22–84 strikes per 400 days. That is 0.5–2% of guild-days on strike. Each strike idles the trade for 10–18 days, and bread, beer or tools run really short in that town.
- **Player money flows.** In the soak (the bot joins after day 100), the bot joins 2 guilds and rises 0–4 ranks.
  - Fees, masterpiece goods and contracts net −2,387 to +1,263g over the run.
  - Dues, loans and stipends net −102 to −1,168g over 800 days.
  - The quality mark (+8%) and untolled sales show up in sale prices, not as a separate line.
  - Guilds are a modest cost of doing business in a town, not an income source.
- **The faucets are small and bounded.**
  - A guildmaster's stipend is at most 30g a week from the hall.
  - A lobbying purse is at most 200g, with one guild petition pending at a time.
  - A charter's fee comes from the guild's hall. A guild founded by charter starts with an empty hall, so charter-then-abolish pays nothing (tested).
- **No money loops (tested).**
  - Buying at guild rates and selling back loses.
  - A guild contract pays 85% of worth, below what the goods cost to buy here after every discount.
  - The master's premium still sits under `Trading.saleUnitCap`, whose buy-back side now includes the guild floor and guild rates.
- **Cost.** About 0.3 ms a day for the guild tick alone, warm (the fairs tick was about 0.12 ms on the same machine). In the full day loop it is about 0.65–0.9 ms against 5–8 ms for `MarketDynamics.updatePrices`. Each town's guilds take a weekly turn on its slot, and the industry check (formation and decline) runs monthly.

## Leftovers and the price book (2026-10)

**Caravan trade income on arrival.** A link whose goods travel as a caravan or trading ship no longer banks its trade income when the goods leave. The margin rides on the unit (`unit.margin`, from `link.goldAB/BA` in `SettlementMarket.flows`): half to each town on arrival, nothing when raiders, lairs or the player rob it, and the whole of it to the seizing realm's market when a warring realm seizes it. Unembodied flows and lots too small for the road are credited at once, as before. The world's total trade income is the same, less what is lost on the road and a few days later.

**Leather** (`data/markets.json`, `data/playerEconomy.json`, `data/merchantPrince.json`).
- A new market good, `leather` (base 18g, 0.0003 a head a day). The craftsmen supply little of it (0.15 of need, +0.1 on pasture). The rest comes from the town's **tannery** recipe: 1.5 hides → 1 leather, 0.25 runs a day per 1,000 people, in every settlement.
- Hides had to rise to feed the tanners: the land now gives 2.6× need (+2.0 on pasture, +0.8 in forest), was 0.7 / 0.8 / 0.4. Hides are cheaper than before; leather armour (still made from hides) costs a crafter less.
- The player's Tannery property gains **Tan Leather** (3 hides → 2 leather).
- **Tannery works** (merchant prince): 260g (400g since the works took a share of the town's trade — see [Merchant Prince](#merchant-prince-2026-10)) + 10 wood, 5 stone, 2 runs a day a level. Measured like the other works (seeds 101, 202, 303; one level in each of the 8 largest towns, 120 days, 40% share less the 10% tithe): a median of about 5.9 g/day, so **about 44 days** to repay; 3 of 24 towns sat nearly idle where the town's own tanners used up the hides. Before the hide change the works stood idle almost everywhere (a median under 0.1 g/day), starved of hides like the smithy is of iron.

**Holdings' bandit raids** that get in now burn half as large a share of the market's stores as of the granary (15%), and that damages any works in town through `SettlementMarket.loot`, as a sack or a lair's raid already did.

**The playtest bot** (`src/__tests__/playtest/bot.js`). Changes to make it sensible rather than to make the game easier:
- **Seed 404.** With a slightly different run of luck (12 perturbations of the bot's dice measured), one run in 12 died broke on day 203. The bot had taken a 5,000g loan at about 5,000g in hand, spent it at once on a Great Work and a store-room, and spent 85 days repaying 70g a day while its guild jobs landed it in jail. It went to 1 gold and starved foraging barren ground. The bot now borrows at most half its purse and raises no Great Work while it owes a loan. All 12 perturbations of 404 then survive (and 11 of 12 on 101, 202, 303 and 505, the twelfth a late pauper's death the soak allows).
- **Speculation** now buys only goods its price book knows sell for more than 1.2× today's ask within 8 days' travel, and holds goods it bought until a market pays their average cost (or its purse runs under 500g or its packs fill). It lost 13,000–36,000g over 800 days buying at random and selling wherever it stood.
- **The trading company** waits until day 40 unless the bot has 9,000g: founding it from the starting purse left the bot short of bread money.
- **Ships.** The bot leaves room in its hold for provisions when it buys a port's exports, sells cargo the port takes when the hold is too full to victual, and tries the other nearby ports when one can't be victualled for. With the hold full of trade goods it had stopped making voyages.
- **Caravans.** The bot now takes escort jobs (a caravan within 4 hexes, an army of 10+, 20% a day) and, as a guild member with 2.5× the caravan's strength and little heat, robs one now and then. Over the 5-seed, 800-day soak it hired on 39 times, was paid every time and robbed 4 caravans. The long soak checks `escortsHired`, `escortsPaid` and `caravansRobbed`.

**The price book** (`systems/priceKnowledge.js`) changes no prices. It caps itself at 30 towns, 10 towns' history of 10 samples and 20 P&L routes; a book filled from every town of a harness world is under 40KB of save.

## Labour, classes and migration (2026-10)

Each town's people are split into five classes with their own baskets, a labour market per sector (land, craft, trade) with floating wages, welfare, crime, weekly migration and refugees (`world/townLabour.js`, `systems/labour.js`, `data/labour.json`). See [the manual](../GAMEPLAY_MANUAL.md#labour-classes-and-migration).

**How it was measured.** Throwaway harness scripts (player kept fed, no bot) on seeds 101, 202 and 303, with the labour day switched off for the "before" runs. The kingdom survival sim ran `advanceDay` + `MarketDynamics.updatePrices` + `Labour.processDay` for 1,080 days, `generate({ kingdomCount: 10 })`.

**Demand stays balanced.** A town with the usual class mix for its size has every good's need factor exactly 1 (tested). Deviations come from peoples, works, migration and refugees; the median town's mix stays within a few points of the usual one.

**The labour market at rest** (days 40–360, every market turn):

| | p10 | median | p90 |
|---|---|---|---|
| Hands idle (all sectors) | 0% | 0.4–1% | 4–5% |
| Craft wage ÷ base | 0.81–0.85 | 0.97–0.99 | 1.08–1.18 |
| Town welfare | 0.82–0.86 | 0.87–0.89 | 0.90 |
| Crime | 0 | 0 | 0.01–0.02 |
| Labour mood (happiness points) | −0.5 | 0 | +0.2 |

Idle hands, crime and the mood bite only where something happened: a flood of refugees, a lost harvest, a town grown past its land, a trade road cut by war.

**Population and migration (360 days).**

| Seed | Population before → with labour | Moved (migration + refugees) | Refugees cried |
|---|---|---|---|
| 101 | 149,359 → 146,845 (−1.7%) | 1,394 | 101 |
| 202 | 141,990 → 137,739 (−3.0%) | 5,286 | 700 |
| 303 | 150,016 → 146,710 (−2.2%) | 4,946 | 978 |

Migration moves about 1% of the world's people a year in peacetime; wars and famines add refugee columns. People flowing from small fast-growing villages to bigger towns, and refugees crowding safe towns, trim the world's growth a little (it still grows about 15–20% over the year). Total population is conserved by every move.

**Kingdom survival (seeds 7–11, 1,080 days).**

| | Alive (of 10) | Wars | Population at the end |
|---|---|---|---|
| Without labour | 10, 9, 9, 8, 10 | 54, 89, 80, 40, 36 | 175,600–206,200 |
| With labour | 10, 8, 9, 8, 10 | 52, 85, 80, 23, 46 | 184,800–200,300 (0–3,200 refugees per run) |

**Works payback (re-measured under the current economy).** One level funded in each of the 8 most populous towns with the trade, 3 seeds, 120 days, foreign town, after the tithe. The "before" column is the code before labour (40% share, no wages, no labour day); "with labour" pays the hands (`data/labour.json` works.hands at the town's craft wage, only for the runs made; a run must also earn its wages) out of a share raised to **52%** (72% in your own towns).

| Works | Before: g/day median (payback) | With labour: g/day median (payback) | Wages as a share of value added |
|---|---|---|---|
| Jewellers' row | 4.6 (66 days) | 4.9 (61) | 14% |
| Armoury | 3.6 (72) | 4.2 (62) | 19% |
| Creamery | 1.7 (91) | 2.1 (73) | 15% |
| Tailors' hall | 2.3 (95) | 2.4 (87) | 25% |
| Charcoal kilns | 1.8 (134) | 1.6 (151) | 26% |
| Bakehouse | 0 (median idle; p75 4.1) | 1.6 (398; p25 139) | 25% |
| Brewhouse | 0 (median idle; p75 3.3) | 1.5 (366; p25 145) | 25% |
| Distillery | 0 (median idle) | 0.8 (376) | 22% |
| Grain mill | 0 (median idle) | 0.3 (468) | 20% |

- Labour leaves the works where they were, or slightly better: the share rise more than covers the wages, and wages fall where artisans are idle.
- **Superseded.** The "with labour" column above did not reproduce when re-measured on the labour commit itself (same method: 8 most populous towns with the trade, seeds 101/202/303, funded on day 20 or day 0, one kind at a time or all together): the great towns' bakehouse and brewhouse paid 12–14 g/day (46–50 days) and the craft works 39–53 days. The re-measured table and the works' new share of the town's trade are in [Merchant Prince](#merchant-prince-2026-10).

**Properties.** Half of a property's upkeep is its wage bill at the hiring town's base wage, floating with the local wage. Re-measured (seeds 101, 202, 303, 120 days; one property each beside the 12 largest and the 12 smallest settlements: apiary, orchard, tannery, workshop, quarry, mine, herb garden):

| Hiring town | Upkeep against its base, p10 / median / p90 | Staffing (output), p10 / median |
|---|---|---|
| The 12 largest | 0.98 / 1.03 / 1.10 | 0.99 / 1.00 |
| The 12 smallest (villages) | 1.07 / 1.09 / 1.12 | 0.89 / 0.93 |

- Beside a great town a property's net moves by about 1%. Beside a village it pays about 9% more upkeep and works 7% short-handed, so an apiary (about 22 g/day net for 850g, 39 days) nets about 19.5 (44 days). The paybacks in the table at the top stay in the 30–55 day band, a few days slower in the villages.
- Several properties beside one village overwhelm its labour market: seven of them beside each of six villages paid +30% upkeep (p90 +58%) at 53% staffing (p10). Build beside a town that has the hands.

**Cost per day** (harness, 80×60, 59–101 towns, 150 days): the labour day costs 0.6 ms on a quiet run (market tick 1.6 ms beside it, unchanged by labour) and 0.6–1.0 ms median, 1.0–1.3 ms mean, on a loaded machine (market 1.9–2.7 ms). Most of it is the market-day turns of a quarter of the towns (about 12 µs each); the weekly migration pass adds 2–3 ms once a week. See [Daily tick cost](#daily-tick-cost-2026-10) for the pass that trimmed it.

## Daily tick cost (2026-10)

Measured with the harness's per-step timing (`mark`), the playtest bot playing seeds 101, 202 and 303 for 200 days, three runs each, before and after (ms per day, averaged over the runs; days 10–200):

| Step | Before: median / mean / p90 | After: median / mean / p90 |
|---|---|---|
| Whole day turn (sum of steps) | 19.1 / 20.2 / 26.7 | 18.2 / 19.1 / 25.4 |
| `MarketDynamics.updatePrices` | 2.57 / 3.10 / 5.04 | 2.18 / 2.66 / 4.48 |
| `Labour.processDay` | 0.90 / 1.20 / 2.29 | 0.75 / 1.00 / 1.90 |
| `Guilds.processDay` | 0.41 / 0.50 / 0.92 | 0.39 / 0.47 / 0.83 |
| `MarketFairs.processDay` | 0.18 / 0.25 / 0.47 | 0.07 / 0.11 / 0.18 |
| `PriceKnowledge.processDay` | 0.54 / 0.86 / 2.32 | 0.43 / 0.78 / 2.22 |
| `world.advanceDay` (untouched) | 8.4 / 9.0 / 12.4 | 8.5 / 9.2 / 12.6 |

What was cut (a CPU profile of the day turn, then each change checked to leave the game identical: a hash of every town's market, labour and guilds, the player and the realms' treasuries after 150–200 bot days on seeds 101, 202 and 303 matched the old code's, and golden/soak tests are unchanged):
- **The settlement scan.** Outside `advanceDay` every `getSettlementViews` rescanned the 4,800-tile map (about 50–90 µs, 23 times a day). The day turn now holds the scan advanceDay made until its systems are done (`World.holdSettlementScan`/`releaseSettlementScan`, in `ui/game/endDay.js` and the harness). Founding a settlement already invalidates it, and a vanished one is noticed, as inside advanceDay. The caravan cap also counts the towns the market tick already listed.
- **The need table** (`SettlementMarket._shape`, read about 1,000 times a day) returns at once while the town's labour record and mix key are unchanged, without asking for the class demand again.
- **NPC trade** (`SettlementMarket.flows`) skips a good before pricing it when neither town has a surplus for the other's shortfall (the checks after the prices would skip it anyway). Half of its time was `Math.pow` on goods that could not move.
- **The labour turn** reads base wages and working shares from tables built with the config; the weekly strike check works out the artisans' real wage only where their welfare is low enough to strike.
- **Left as they are.** The rest of the market tick (each town's turn, about 15–40 µs; trade along about 120 links) and the guilds' weekly turn are spread over many small costs with no single hot spot. The weekly migration pass costs about 1.5 ms (was about 2 ms).

## Re-measuring

- **Long soak.** `SOAK=1 SOAK_VERBOSE=1 npx vitest run playtest.soak` prints each
  run's gold ledger by system.
- **Focused strategies.** Write a throwaway test next to the harness, as this pass did:
  `newGame(seed)`, a scripted daily loop, then `endDay`.
- **Settle formulas first.** Start with the payback-days column. A building that repays
  itself in under 20 days at Commerce 0, or a repeatable action paying over 300 g a day
  without real risk, is an outlier.
