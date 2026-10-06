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
| **Industry shares** (works funded in a town, new) | — | One level repays in 41–63 days in a great town (bakehouse 640g → about 15 g/day). Spread towns take 58–164 days; extra levels saturate (3 levels of a bakehouse: 61 days) | Capital investment, sized by the town's spare inputs and appetite. Tithe, seizure, expropriation and raids are the risk |
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

**Industry: one level, foreign town, 40% share less a 10% tithe.**

| Works | Price (gold + materials) | Great towns: g/day median (p25–p75) | Payback median (p25) | Spread towns: payback median |
|---|---|---|---|---|
| Bakehouse | 640 + 10 wood, 15 stone | 15.3 (9.7–22.9) | **43** (28) | 58 |
| Brewhouse | 540 + 20 wood, 5 stone | 12.6 (9.4–18.7) | **44** (30) | 128 |
| Charcoal kilns | 240 + 10 stone | 5.7 (3.4–9.2) | **44** (29) | idle in wooded country |
| Distillery | 310 + 10 wood, 2 iron | 7.5 (5.3–9.0) | **41** (36) | 121 |
| Armoury | 260 + 10 stone, 6 iron | 7.0 (3.8–8.1) | **41** (33) | 164 |
| Grain mill | 160 + 10 wood, 5 stone | 3.8 (2.0–6.0) | **47** (34) | flour has a small market |
| Creamery | 150 + 10 wood, 5 stone | 3.1 (2.5–4.9) | **49** (32) | |
| Tailors' hall | 210 + 10 wood, 3 textiles | 4.6 (3.8–6.8) | **50** (35) | |
| Jewellers' row | 300 + 10 stone, 3 tools | 5.0 (4.3–6.0) | **63** (53) | |
| Weaving shed | 200 + 15 wood | 1.5 (1.0–2.0) | 132 (103) | starved of wool unless you bring it |
| Smithy | 200 + 10 stone, 4 iron | 0.7 (0.1–2.5) | 358 (82) | starved of iron unless you bring it |

- **Levels saturate.** Three levels of a bakehouse (2,670g) in a great town pay a median of 43.7 g/day, about 61 days to pay back. A brewhouse takes 93 days and a mill 214. More capacity than the town's stores can feed or absorb stands idle.
- **Not offered.** The forge (iron + 2 firewood → 0.8 tools) adds no value at base prices, and the chandlery's rock oil is too rare.
- **Why it is not a money loop.**
  - The works can only process what the town has to spare: at least half the input's target stays for the townsfolk.
  - Each run is valued at the town's own scarcity curve, so the works drive their own margin down. Their output gluts the stalls (and stops at twice its target), and their inputs grow dear.
  - The crown's tithe (more at war or in a crisis), seizure, expropriation, raids and sieges put the stake at risk.
  - Selling a stake back returns 40% of the price.
  - The test suite checks that three weeks of a great town's bakehouse and brewhouse repay well under the stake.
- **In the soak** (800 days, 5 seeds), the bot funded 6–16 works for 3,600–8,300g and drew 6,900–51,500g from them over the run. That is a season-scale payback, then a steady income, like properties.

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

## Re-measuring

- **Long soak.** `SOAK=1 SOAK_VERBOSE=1 npx vitest run playtest.soak` prints each
  run's gold ledger by system.
- **Focused strategies.** Write a throwaway test next to the harness, as this pass did:
  `newGame(seed)`, a scripted daily loop, then `endDay`.
- **Settle formulas first.** Start with the payback-days column. A building that repays
  itself in under 20 days at Commerce 0, or a repeatable action paying over 300 g a day
  without real risk, is an outlier.
