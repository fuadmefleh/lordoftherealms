# Economy & Trade

> Developer reference. Player-facing rules live in
> [`GAMEPLAY_MANUAL.md` §4–7](../../GAMEPLAY_MANUAL.md). Architecture rules
> (no domain globals, seedable RNG) are in
> [`docs/architecture-globals.md`](../architecture-globals.md).

## 1. Overview

The economy spans two loosely-coupled halves. The **settlement/kingdom economy**
(`src/world/economy.js`) computes per-day gold/food/goods production for AI-owned
settlements from settlement type, population, and nearby terrain resources, then
aggregates to kingdom totals. The **player economy**
(`src/player/playerEconomy/`) is a much larger production-chain simulation: the
player buys/builds properties (farms, mines, workshops, taverns — ~40 building
types), runs recipe-based crafting, stores/collects ~90 goods, and moves goods to
market via one-shot **caravans**, persistent **trade/smuggling routes**, or
**auctions**. A regional pricing layer (`src/systems/marketDynamics.js`) maintains
per-settlement supply/demand and dynamic prices, alongside **Banking** (loans) and
**Taxation**. Constants come from `data/*.json` loaded at startup by
`src/core/dataLoader.js`. Everything advances one game day via `endDay()` and
`World.advanceDay()`.

## 2. Code map

| File | Role |
|------|------|
| `src/world/economy.js` | `Economy` (settlement production, trade routes, wealth) and `TradeRoutes` (AI kingdom route discovery). |
| `src/systems/marketDynamics.js` | `MarketDynamics` (regional supply/demand/price sim), `Banking` (loans), `Taxation` (tax policy + collection) — all three in one file. |
| `src/player/playerEconomy.js` | Barrel re-exporting `./playerEconomy/index.js`. |
| `src/player/playerEconomy/index.js` | Assembles `PlayerEconomy` from member modules; exports `PlayerEconomy` and `Trading`. |
| `src/player/playerEconomy/_ref.js` | Shared empty `PlayerEconomy = {}` all modules `Object.assign` onto. |
| `src/player/playerEconomy/_imports.js` | Shared imports (Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure). |
| `src/player/playerEconomy/routes.js` | Defines `PROPERTY_TYPES`, `GOODS`, `RECIPES`; persistent route CRUD, dispatch, prosperity. |
| `src/player/playerEconomy/property.js` | Build/validate properties; `produceGoods` (daily production, recipes, tavern income, upkeep); `collectGoods`. |
| `src/player/playerEconomy/caravans.js` | `startCaravan`, `startStorageCaravan`, `updateCaravans`, `spawnTravelingMerchant`, fishing boats. |
| `src/player/playerEconomy/trading.js` | `Trading`: settlement market stock, `calculatePrice`, `buyGoods`, `sellGoods`. |
| `src/player/playerEconomy/auctions.js` | Auction lot generation, bidding, daily resolution. |
| `src/player/actions/index.js` (252, 265) | `PlayerActions.endDay` calls `produceGoods` and `updateCaravans` each turn. |
| `src/world/kingdomAI.js` (77) | `KingdomAI.updateEconomy` drives settlement `produceDaily`/`processTrade`. |
| `src/ui/game/endDay.js` | Turn orchestrator: `MarketDynamics.updatePrices`, `Banking.processLoans`, `Taxation.collectTaxes`, finance recording. |
| `src/ui/game/gameSetup.js` (454) | `MarketDynamics.initialize()`. |
| `src/ui/actionMenu/trade.js` | Market/buy/sell/caravan/collect menus. |
| `src/core/dataLoader.js` (269–387) | Injects JSON constants into the objects. |

## 3. Data files

- **`data/economy.json`** — settlement tuning. `productionRates` (per settlement
  type: `baseGold`, `baseFood`, `baseGoods`) and `resourceBonuses` (per terrain
  resource → multipliers). Loaded into `Economy.PRODUCTION_RATES` /
  `Economy.RESOURCE_BONUSES` (`dataLoader.js:271-272`).
- **`data/playerEconomy.json`** — player-side content. `PROPERTY_TYPES` (`id`,
  `name`, `icon`, `cost`, `constructionDays`, `produces`, `productionRate`,
  `upkeep`, `requiredTerrain`/`requiredResource`/`requiredSettlement`, optional
  `allowedRecipes`/`recipeChangeCost`/`retoolingDays`); `GOODS` (`id`, `name`,
  `icon`, `basePrice`); `RECIPES` (`input`, `inputQty`, `output`, `outputQty`).
  Loaded into `PlayerEconomy.*` (`dataLoader.js:385-387`).
- **`data/market.json`** — `taxRates` (VERY_LOW…VERY_HIGH → `Taxation.TAX_RATES`)
  and `loanOptions` (small/medium/large → `Banking._loanOptions`)
  (`dataLoader.js:341-344`).
- `data/tavern.json` — adjacent economy (informant/intel costs).

> **⚠️ Content is defined twice.** The authoritative full lists (~40 property
> types, ~90 goods, ~40 recipes) are **hardcoded defaults** in
> `routes.js`; `data/playerEconomy.json` ships a *smaller subset*.
> `dataLoader.js:385-387` overwrites the code defaults **only for keys present in
> the JSON**. When adding content, keep both in mind.

## 4. State shape

**Per settlement** (`settlement.economy`, via `Economy.initSettlement`): `gold`,
`food`, `goods`, `production` (`{gold, food, goods, breakdown}`), `tradeRoutes[]`,
`resources[]`, `stockpile{}`, plus `population`, `happiness`, `growthRate`, and
`marketStock{}` (per-good "bought" counters used by `Trading`).

**On `world`:** `world.units[]` holds physical `caravan`/`fishing_boat`
WorldUnits; `world.day`, `world.width` for timing/distance.

**On tiles:** `tile.playerProperties[]` (and legacy `tile.playerProperty`);
`tile.resource`, `tile.terrain`, `tile.settlement`, `tile.temperature`. Each
property object: `type`, `name`, `produces`, `productionRate`, `upkeep`, `level`,
`daysOwned`, `storage`, `inputStorage`, `activeRecipe`, `autoSell`, `hasLab`,
`underConstruction`, `constructionDaysLeft/Total`, `retooling`/`retoolingDaysLeft`,
plus tavern-specific `beerStock`/`liquorStock`/`gamblingTables`/`todayIncome`.

**On `player`** (`src/player/core/state.js`): `gold` (starts 10000),
`inventory`, `skills.commerce`, `properties[]`, `caravans[]`, `tradeRoutes[]`,
and lazily `smugglingRoutes[]`, `auctions{}`, `loans{}`, `taxRate`,
`landTaxBonus`, `karma`, `criminalRecord{}`, `reputation{}`, `financeHistory[]`,
`settlements[]`. `PlayerEconomy.ensureEconomyState(player)` (`routes.js:502`)
guarantees the route/auction fields exist.

**MarketDynamics** keeps a **module-global** `regionalMarkets` keyed `"q-r"` →
`{supply{}, demand{}, prices{}, priceHistory{}}` — NOT stored on `world` (reset
via `initialize()`).

## 5. Lifecycle

**Initialization:** `MarketDynamics.initialize()` (`gameSetup.js:454`);
`Economy.initSettlement` (`economy.js:39`, lazy);
`MarketDynamics.getOrCreateSettlementMarket` (`marketDynamics.js:26`, seeds from
`GOODS.basePrice`); `PlayerEconomy.ensureEconomyState`; `DataLoader` injection at
load (`dataLoader.js:269-387`).

**Per-turn** — `Game.endDay()` (`src/ui/game/endDay.js`) orchestrates:

1. `PlayerActions.endDay(player, world)` → `PlayerEconomy.produceGoods` (`:252`),
   `PlayerMilitary.payUpkeep`, `PlayerEconomy.updateCaravans` (`:265`, which also
   ticks persistent routes and auctions).
2. `world.advanceDay(player)` (`world/world/runtime.js:25`) → per kingdom
   `KingdomAI.processTurn` → `KingdomAI.updateEconomy` (`kingdomAI.js:77`) →
   `Economy.produceDaily` + `Economy.processTrade` per settlement; AI routes via
   `TradeRoutes.establishRoutes`.
3. Back in `endDay.js`: `MarketDynamics.updatePrices(world)` (`:292`),
   `Banking.processLoans` (`:355`), `Taxation.collectTaxes` every 7 days (`:369`),
   `PlayerEconomy.spawnTravelingMerchant` (`:416`), finance-history recording
   (`:569-626`).

## 6. Key rules & formulas

**Settlement production** (`src/world/economy.js`):
- Population modifier: `popMod = 1 + (population/10000)*0.5` (`:58`).
- Base output = `PRODUCTION_RATES[type].base* × popMod`; resource bonuses at 1.0
  (direct tile) or 0.5 (within 2-hex radius) (`:73-99`).
- Food consumption `population*0.1/day`; growth capped 0.1%/day on surplus,
  shrink `×0.999` on severe shortage (`:188-197`).
- Trade route profit: `max(5, floor(50/(1+distance*0.1)))` (`:214, :302`).
- Wealth: `gold + goods*2` (`:249`).

**Regional pricing** (`marketDynamics.js`, `updatePrices`):
- Demand from population `floor(population/100)`, scaled per good (`:98-104`).
- Supply/demand smoothing `0.7×old + 0.3×new` (`:108-109`).
- `ratio = demand/max(1,supply)`, `newPrice = floor(basePrice×ratio)`, clamped
  **40%–400%** of base (`:119`), then smoothed `0.85×old + 0.15×new` (`:122`).
  History capped at 30 days; trend uses ±10% vs 5-day avg (`:186-188`).

**Caravan profit** (`caravans.js`, `updateCaravans`, `:285-320`):
- `marketValue = Σ getPrice(good)×qty`; `distanceMultiplier = 1 + dist×0.05`
  (`:293`); settlement multiplier capital ×1.5 / city ×1.2 (`:298-300`); route
  `prosperityBonus = 1+prosperity×0.04`, `roadBonus = 1+roadQuality×0.06`
  (`:308-309`); smuggling `×(1.35 + prosperity×0.05)` (`:313`); commerce
  `×(1 + commerce×0.05)` (`:319`).
- Smuggling caught chance:
  `clamp(0.06..0.62, 0.28 + dist×0.01 − stealth×0.02 − protection×0.03)`
  (`:325-327`); confiscates 35–55% + fine (`:331-335`).
- Flat cost 200 gold, max distance 20, 2 tiles/day (`:11, :31, :73`).

**Property/recipe production** (`property.js`, `produceGoods`):
- `amount = productionRate × (1+(level-1)×0.1) × (1+commerce×0.05)` × tech bonus
  × irrigation bonus; logging on timber ×1.5 (`:243-266`).
- Recipe runs: `min(floor(amount/outputQty), floor(inputStorage/inputQty))`
  (`:300-303`). Upkeep = `upkeep × level`, paid before production (`:318-321`).
  Auto-sell yields 50% of basePrice (`:343`).
- Tavern income: base 15 (town 25 / capital 35) `+2g/100 pop`, ×level,
  ×commerce, beer ×1.3 / liquor ×1.2 / gambling (`:200-235`).

**Banking** (`marketDynamics.js`): loans 10/15/20% interest;
`dailyPayment = floor(amount×(1+rate)/duration)`; 5% penalty on miss (`:368`);
property seized if `daysTaken > remainingDays×1.5` (`:373`). Max 3 loans/kingdom.

**Taxation:** `taxBase = floor(population×0.1)`,
`collected = floor(taxBase × rate × (1+landTaxBonus))`, every 7 days
(`:486-488`, `endDay.js:369`).

**Persistent routes:** creation cost legal 280 / smuggling 220; dispatch 120 / 95
(`routes.js:492-500`); prosperity `+0.18` per success (cap 6), `−0.35` per raid
(`:733-744`).

## 7. Interactions

- **Military** — caravans spawn `WorldUnit`s that can be raided/destroyed → route
  loss; `payUpkeep` competes for the same `player.gold`; weapons/military_parts
  goods bridge to recruitment.
- **Technology** — `Technology.getProductionBonus(player, propertyType)`
  multiplies property output (`property.js:257`); parts goods are crafted/consumed
  by tech; `hasLab` flag enables research.
- **Infrastructure** — `Infrastructure.getIrrigationBonus(tile)` boosts farms
  (`property.js:263`); roads affect route `roadQuality`.
- **Kingdoms / AI** — `KingdomAI.updateEconomy` aggregates settlement economy into
  kingdom gold/food; `TradeRoutes.establishRoutes` for AI.
- **Councils** — `Councils.canRaiseTaxes` gates tax increases
  (`marketDynamics.js:526`).
- **Quests** — `Quests.trackCaravanCompleted` (`caravans.js:361`).
- **Weather** — `world.weather`/`tile.temperature` drive firewood/clothes demand
  in `Trading.calculatePrice` (`trading.js:81-99`).
- **Gossip/Reputation/Karma** — smuggling penalties adjust `player.karma`,
  `criminalRecord`, `reputation` (`caravans.js:336-342`).

## 8. Extension points

- **Add a good** — add to `GOODS` in `data/playerEconomy.json` (and the canonical
  default `GOODS` in `routes.js:367`) with `id`, `name`, `icon`, `basePrice`. It
  flows into markets/trading/caravans/inventory automatically. To have settlements
  sell it, add an `addGood(...)` call in `Trading.getAvailableGoods`
  (`trading.js:29-59`); to shape regional demand curves, extend the demand block
  at `marketDynamics.js:98-104`.
- **Add a property type** — see the full recipe:
  [`docs/extending/add-a-building.md`](../extending/add-a-building.md).
- **Add a recipe** — add to `RECIPES` in `routes.js:457` (and JSON) with `input`,
  `inputQty`, `output`, `outputQty`, then reference it in a property's
  `allowedRecipes`.
- **Tweak pricing** — settlement/AI tuning in `data/economy.json`; base prices in
  `data/playerEconomy.json`; dynamic price band/smoothing hardcoded at
  `marketDynamics.js:119-122`; caravan multipliers at `caravans.js:293-319`;
  static buy/sell at `trading.js:66-111` / `sellGoods` (0.7× base, `:166`);
  tax/loan tables in `data/market.json`.
- **Change turn hooks** — register daily processing in `src/ui/game/endDay.js`
  (main orchestrator) or `src/player/actions/index.js` (`PlayerActions.endDay`).
