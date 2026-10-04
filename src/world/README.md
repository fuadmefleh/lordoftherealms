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
| `economy/` | ~1200 | Settlement markets, production chains, trade networks |
| `innerMap/` | ~2000 | Inner-map model: tile generation, object/building placement, pathfinding |
| `kingdom.js` | ~440 | Kingdom templates, placement, initial relations |
| `kingdomAI.js` | ~700 | Kingdom decision-making, expansion, diplomacy AI |
| `kingdomNavy.js` | ~330 | `KingdomNavy`: royal fleets. Ports set the cap, the treasury pays for building and upkeep, fleets battle and blockade in kingdom wars (income, sieges, port markets), and the fleets near a ship's position can intercept it. All rolls are deterministic hashes with no RNG draws |
| `kingdomAtlas.js` | ~240 | `KingdomAtlas`: royal cartography of NPC realms — court cartographer, archive charts of rivals (war bonus / target choice), atlas skill and accuracy |
| `kingdomState.js` | ~300 | `KingdomBonuses` (ruler/advisor + NPC lord + tradition bonuses combined), `LordInfluence` (lord stats and goal modifiers read by the kingdom AI) and `KingdomStability` (0-100 stat, drift, rebellion risk) |
| `npcLords.js` | ~600 | Kingdom lords: generation, traits → goals, daily goal actions (trade, faith, justice, domination, fear, survive, …), succession |
| `settlementGenerator.js` | ~800 | Settlement generation: size, buildings, population |
| `terrain/` | ~1680 | Terrain types, world map generation (noise-based), rivers |
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
- `terrain/generation.js` uses layered Perlin noise to produce elevation, temperature, and moisture maps. Biomes are assigned from a lookup table, not hardcoded per-tile.
- The inner map (`innerMap/`) is a separate high-resolution grid generated lazily when the player enters a settlement hex. It is not part of the main `world.tiles` grid.
