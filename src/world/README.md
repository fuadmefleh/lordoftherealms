# world/

The world model: terrain generation, kingdoms, settlements, economy, NPCs, and events. This is the data layer — it defines what exists in the game world.

## Files

| File | Lines | Description |
|------|-------|-------------|
| `characters.js` | ~400 | NPC generation, name tables, procedural traits |
| `colonization.js` | ~550 | Settlement founding, colonization mechanics |
| `customBuildings.js` | ~310 | Inner-map building registry (sprite definitions, types) |
| `customInteriors.js` | ~380 | Interior layout definitions (houses, shops, dungeons) |
| `customObjects.js` | ~410 | Inner-map object registry (trees, rocks, crates, etc.) |
| `economy.js` | ~840 | `Economy`: settlement production (`calculateDetailedProduction`), the food model and lean season, what a market lists (`marketGoods`) and asks (`marketAskBase` × the store's scarcity = `marketPrice`), resource bonuses, monopolies, kingdom trade routes (`TradeRoutes`; `processTrade` banks the trade income NPC goods flows earned) |
| `innerMap/` | ~2000 | Inner-map model: tile generation, object/building placement, pathfinding |
| `kingdom.js` | ~440 | Kingdom templates, placement, initial relations |
| `kingdomAI.js` | ~700 | Kingdom decision-making, expansion, diplomacy AI |
| `kingdomNavy.js` | ~330 | `KingdomNavy`: royal fleets. Ports set the cap, the treasury pays for building and upkeep, fleets battle and blockade in kingdom wars (income, sieges, port markets), and the fleets near a ship's position can intercept it. All rolls are deterministic hashes with no RNG draws |
| `kingdomAtlas.js` | ~240 | `KingdomAtlas`: royal cartography of NPC realms — court cartographer, archive charts of rivals (war bonus / target choice), atlas skill and accuracy |
| `kingdomState.js` | ~300 | `KingdomBonuses` (ruler/advisor + NPC lord + tradition bonuses combined), `LordInfluence` (lord stats and goal modifiers read by the kingdom AI) and `KingdomStability` (0-100 stat, drift, rebellion risk; its target reads `Coinage.stabilityMod`) |
| `coinage.js` | ~90 | `Coinage`: the read side of crown finance on `kingdom.finance` — coin purity, `priceMultiplier(world, settlement)` (read by `Economy.marketPrice`; exactly 1 for pure coin), `stabilityMod` (debased coin, war levy, recent default, heavy debt), trust. Pure, no RNG; written by `systems/finance.js` |
| `npcLords.js` | ~600 | Kingdom lords: generation, traits → goals, daily goal actions (trade, faith, justice, domination, fear, survive, …), succession |
| `settlementGenerator.js` | ~800 | Settlement generation: size, buildings, population |
| `terrain/` | ~1680 | Terrain types, world map generation (noise-based), rivers |
| `settlementMarket.js` | ~950 | `SettlementMarket`: every settlement's one goods store (`settlement.market`: stock, trend, shortage gauges, production profile, trade links — saved with the tile). Production from land/resources (`production`), local industry (recipes), consumption with substitutes, spoilage; the one price model (`scarcity` = (stock ÷ need × days)^-e, `value` = base × scarcity × season × cold × events × coin — `Economy.marketPrice` adds size, local-resource discount and monopoly markup); stock moves (`take`/`add`/`loot`); NPC `flows` between linked towns paying `economy.tradeIncome` (an `embody` link leaves its goods on `link.cargoAB/BA` and its margin on `link.goldAB/BA` for a caravan that pays both towns on arrival — `systems/merchantCaravans.js`); shortage effects read by `Economy.produceDaily` (`foodStrain`, `toolFactor`), `Kingship.hunger` (`inDearth`), market mood (a trade's `fill` brews ahead of need while its inputs glut). Player-funded works (`market.works`: `setWorks`/`works`/`damageWorks`, run by `_runWorks` after the town's trades: first a share of the trade's own runs (works.capture), then on top of it, value added at the town's scarcity; `loot` damages them) and fairs (`market.fair`: `fair`/`fairAsk`, read by `Economy.marketAskBase`) — `systems/merchantPrince.js`, `systems/marketFairs.js`. A trade on strike (`market.idle[recipeId]` = until-day, set by `systems/guilds.js`) stands idle and its goods' production stops. Pure, no RNG; tuned in `data/markets.json` |
| `townLabour.js` | ~650 | `TownLabour`: every town's people split into five strata (`settlement.labour.sh`: peasants & labourers, artisans, merchants, clergy, nobility — shares of `population`, derived from size, peoples, works and a workshop quarter, drifting back after migration). Class baskets scale the market's need of each good (`demandMults`, read by `SettlementMarket._shape`; the usual mix buys exactly the old flat need). Jobs and hands per sector (land / craft / trade; workshops sized by the slow `base` population, the land by its fertility and capacity), output caps (`factors`, read by `processSettlement`: land goods, trades and works), floating wages, per-stratum welfare (basket met — `market.met` —, work, real wage, safety, famine, taxes), crime, the labour mood (`settlement.labourMood`). Moves people (`moveStratum`, `moveMix`) and prices the player's hands (`worksWageBill`, `worksWagePerRun`, `wageUpkeep`, `staffing`). Readers: `crimeOdds` (Underworld jobs), `theftBonus` (warehouses), `unrestPressure` (holdings). Pure, no RNG; ticked by `systems/labour.js`; tuned in `data/labour.json` |
| `hinterland.js` | ~520 | `Hinterland`: the rural sites around the towns (`world.hinterland.sites`): each hex within `reach` belongs to its nearest settlement, which works its best hexes by resource, a hidden vein in the hills (hash) or its land (sheep). Derived from the terrain only (no RNG; old saves derive on load), re-synced for new towns. `output` (yield × land hands × a lease's rate), `deplete` (finite reserves, yield falls past the knee, `exhausted`), `deliver` (half to home, half to the market town), `strike` (new veins and deposits), readers `sites`/`siteAt`/`sitesOf`/`sitesNear`/`yieldOf`/`reserveFrac`/`daysLeft`/`handsAt`/`describe`/`recent`, news on `history`. Pure; driven by `systems/concessions.js`; `data/hinterland.json` |
| `seasons.js` | ~330 | `Seasons`: the agricultural year — production curves (yearly mean 1), seasonal food/fur prices and trend arrows, the lean season, campaign season, seasonal event weights, the season outlook. Pure, draws no RNG; tuned in `data/economy.json` "seasons" |
| `units.js` | ~500 | Military unit definitions, combat formulas |
| `weather.js` | ~650 | Weather simulation, seasonal effects on movement/production |
| `world.js` | ~900 | `World` class: tile grid, kingdom list, turn processing orchestration |
| `worldEvents.js` | ~850 | Random world events (plagues, floods, rebellions, etc.) |

## Key Objects

```js
// The world (single instance per game)
const world = new World(width, height, seed);

// Tile shape:
{
  q, r,                          // axial coordinates
  terrain: { id, passable, ... },
  resource: null | { id, ... },
  settlement: null | { type, name, population, ... },
  kingdom: null | kingdomId,
  improvements: [],
  explored: false,
  visible: false,
}

// Kingdom shape:
{
  id, name, color,
  capital: { q, r },
  relations: { [otherId]: score },  // -100..100
  ...
}
```

## Integration Points

- **Depends on**: `core/hex.js`, `core/utils.js`, `core/dataLoader.js`
- **Used by**: `systems/` (read-only tile/kingdom access), `player/` (tile lookups, movement), `ui/renderer.js` (rendering), `ui/innerMap/` (inner-map model)

## Notes

- `world.js` is the orchestrator — it holds `world.tiles[][]`, `world.kingdoms[]`, and calls each system's `processDay()` at turn end.
- **Per-day caches** (`world/runtime.js`): while `advanceDay` runs, the settlement scan behind `getAllSettlements()` is shared (code that founds a settlement calls `world.invalidateSettlements()`), and `world.dayMemo(name, q, r, compute)` memoises lookups that can't change mid-day (resources around a hex, road reach). Outside `advanceDay` nothing is cached, so tests and UI code may edit tiles freely. `getAllSettlements()` still returns fresh copies; `getSettlementViews()` returns the live objects for read-only scans and `getSettlementsOf(kingdomId)` copies only one realm's.
- **World units are saved** with the world (`SaveLoad.serializeWorld` → `units`) and restored without running the `WorldUnit` constructor (no RNG draws); saves from before that regenerate them.
- `terrain/generation.js` uses layered Perlin noise to produce elevation, temperature, and moisture maps. Biomes are assigned from a lookup table, not hardcoded per-tile.
- The inner map (`innerMap/`) is a separate high-resolution grid generated lazily when the player enters a settlement hex. It is not part of the main `world.tiles` grid.
