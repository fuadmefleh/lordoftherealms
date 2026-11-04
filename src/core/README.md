# core/

Low-level utilities shared by every other module. Has no dependencies on game systems.

## Files

| File | Description |
|------|-------------|
| `hex.js` | Hex grid math: coordinates, distance, neighbors, range, A* pathfinding, world-wrap. Contains a `MinHeap` for efficient pathfinding. |
| `utils.js` | General helpers: seeded RNG (`Utils.seededRandom`; `Utils.withRng(rng, fn)` runs fn on a separate seeded stream without disturbing the main one), Perlin noise, array shuffling, number formatting. |
| `dataLoader.js` | Loads `data/gamedata.json` (merged game data) and optional editor-override JSON files. All systems read config from here. |
| `dataPatch.js` | Mod patches: `createDataPatch` / `applyDataPatch` (diffs with `$delete` / `$replace`), `applySectionPatches` for the Game Data tab's per-section patches, and `mergeCustomTechs` for the Tech Tree tab. The editors carry a twin in `editor-core.js`. |
| `nineTile.js` | 9-tile brush auto-tiling: `pickNineTileSlot`, `resolveBrushSeason`, `resolveNineTileCell` (slot + tile + why it fell back), `erodeUntileableStubs`. InnerMap stamps brushes with it. The terrain editor paints and previews with its twin in `editor-core.js`, so both draw the same. |
| `customSheets.js` | `CustomSheets.resolve(path)`: maps the editors' imported-sheet paths (`custom/…`) to the data URLs kept in the mod store (meta `customSheets_*`). DataLoader registers them at startup, and every sheet image loader sets `img.src = CustomSheets.resolve(path)`, so tiles painted from imported sheets draw in game. |
| `tileSides.js` | Blocked tile sides (n/e/s/w): `sidesMask`, `sidesString`, `outerSidesForSlot`, `stepBlockedBySides`, `brushSlotSides` (a brush's sides for one painted cell). Hand-made and generated interiors put them on `tile.blockedSides`, and InnerMap movement (player steps, A*, walk animation) won't cross them. Editor twin in `editor-core.js`. |
| `settlementSize.js` | `SettlementSize.meets(def, settlement)`: is a settlement big enough for a definition carrying `minSettlement` (village/town/city/capital) and `minPopulation`? Used for recruitable units, properties and tech buildings. `SettlementSize.TIER` is the tier order. |
| `grades.js` | `Grades`: the five quality grades of made goods (poor, common, fine, excellent, masterwork; `data/craftGrades.json`: price and effect multipliers, the score thresholds). Graded units are counted beside the plain inventory (`holder.craftGrades[good] = { poor, fine, excellent, masterwork }`; Common is the rest), so `{ goodId: qty }` keeps working everywhere; plain removals are reconciled lazily (Common first, then Poor…). `add` after an increment, `take`/`remove` before a decrement (`order` best / sale / worst, or one `grade`), `peek`, `counts`, `bestIndex`/`bestOf`, `summary`/`tag`/`tagHtml` for the UI, `gradeable(good)`, `distribution`/`roll` (triangular noise on the seeded Utils RNG), `migrate` (old saves' averaged `craftQuality`) |
| `difficulty.js` | `Difficulty`: the game's difficulty and the scenario record on `player.scenario` (`{ id, difficulty, victory, guidedStart, victoryAchieved, startDay }`; `state(player)` backfills old saves as Wanderer/Normal/no goal). `mult(player, knob)` gives a level's multiplier (`startGold`, `buyPrice`, `sellPrice`, `hostility`, `enemyStrength`, `illness`; Normal is always 1). Read by `player/scenarios.js`, `playerEconomy/trading.js`, `systems/realmWars.js`, `playerMilitary/combat.js`, `fieldBattle.js` and `systems/ailments.js`. `carry(old, world)` passes the difficulty and goal on to a new life. Levels are in `data/scenarios.json` → `difficulty`. No RNG |

## Key APIs

```js
// Hex grid
Hex.distance(q1, r1, q2, r2)
Hex.hexesInRange(q, r, radius)          // returns [{q, r}, ...]
Hex.findPath(q1, r1, q2, r2, world)     // A* pathfinding

// Utilities
Utils.randInt(min, max)
Utils.seededRandom(seed)
Utils.perlin(x, y)

// Data loading
await DataLoader.load()                 // call once at startup
DataLoader.terrain                      // parsed terrain config
DataLoader.units                        // unit definitions
// ... etc.
```

## Notes

- `Hex` uses axial coordinates `(q, r)` throughout the codebase — **not** offset coordinates.
- `DataLoader` merges base `data/gamedata.json` with any editor overrides stored in `localStorage`. Always access game config through `DataLoader`, never hardcode data.
