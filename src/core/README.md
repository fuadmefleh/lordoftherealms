# core/

Low-level utilities shared by every other module. Has no dependencies on game systems.

## Files

| File | Description |
|------|-------------|
| `hex.js` | Hex grid math: coordinates, distance, neighbors, range, A* pathfinding, world-wrap. Contains a `MinHeap` for efficient pathfinding. |
| `utils.js` | General helpers: seeded RNG (`Utils.seededRandom`; `Utils.withRng(rng, fn)` runs fn on a separate seeded stream without disturbing the main one), Perlin noise, array shuffling, number formatting. |
| `dataLoader.js` | Loads `data/gamedata.json` (merged game data) and optional editor-override JSON files. All systems read config from here. |

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
