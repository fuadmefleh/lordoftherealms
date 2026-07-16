# Impassable Nine-Tile Brush Cells + Procedural Inner-Map Water

**Date:** 2026-07-16
**Status:** Approved

## Problem

Nine-tile terrain brushes (`terrainNineTileBrushes`) are purely visual — each cell
is `{sheetPath, sx, sy}` with no flags, and the runtime applies them only as a
`tile.terrainDetail` overlay. There is no way to make part of a brush block
movement, and no water exists in inner-map terrain at all (water there is only a
visual tint category). We want:

1. Per-cell **impassable** marking on nine-tile brushes (general mechanism).
2. **Procedurally generated water** (ponds) in inner maps, where the water body
   blocks NPCs and the player while shore-edge tiles stay walkable.

## Decisions made

- Water **blocks** movement; shore edges stay walkable (author-controlled per cell).
- Water is placed by **procedural generation** only (no hand-painted layouts for now).
- Approach **C**: per-cell brush flags (mechanism) **plus** semantic water tagging
  on blocked cells so future systems (fishing, bridges, audio) can detect water.

## 1. Brush data format

Each brush cell gains an optional `"impassable": true` — the same Format-A
convention already used by object footprint tiles (`data/objects.json` meta).

```json
{
  "id": "ntb_...",
  "name": "Pond",
  "category": "water",
  "tiles": [
    [ {"sheetPath": "...", "sx": 0,  "sy": 0},                     {"...": "top edge"}, {"...": ""} ],
    [ {"...": "left edge"}, {"sheetPath": "...", "sx": 32, "sy": 32, "impassable": true}, {"...": ""} ],
    [ {"...": ""},          {"...": "bottom edge"},                 {"...": ""} ]
  ],
  "insideCorners": [ {"sheetPath": "...", "sx": 0, "sy": 0, "impassable": true}, null, null, null ],
  "seasonTiles": { "spring": "…", "summer": "…", "autumn": "…", "winter": "…" }
}
```

Rules:

- Flags live on the **default** grids only: `tiles` (3×3), `insideCorners` (4),
  and `seasonAltFills`/alt-fill entries. Seasonal variant grids carry **no**
  flags — passability is keyed by *slot position*, so a frozen winter pond is
  still blocked.
- New optional `"category"` field (`"terrain"` default, `"water"` for water
  brushes) lets the generator find water brushes. Fallback for existing data:
  name matching `/water|pond|lake|river/i`.
- Absent flags mean passable — all existing brushes are unaffected.

## 2. Editor (`terrain_editor.html`)

In the Nine-Tile Brush Editor modal:

- **⛔ Block toggle** per cell slot (3×3 grid, inside corners, alt fills),
  rendered as a small overlay badge on flagged cells. Same interaction pattern
  as `sprite_editor.html`'s existing Block tool for building footprints.
- **Category dropdown** (`terrain` / `water`) in the brush header.
- Flags and category round-trip through `ntbSave()`, `notifyParent()`
  (`terrainDataChanged` postMessage), IndexedDB autosave, and gamedata export.
  No changes needed in `editor.html` or `DataLoader` — the
  `terrainNineTileBrushes` key is already whitelisted in `_mergeEditorData`.

## 3. Runtime — procedural water pass

New `_paintWaterFeatures(...)` in `src/world/innerMap/terrain.js`, running
**after** base sub-terrain generation and the grass second-layer pass, and
**before** building/object placement and NPC spawning.

**Config** (data-driven, per parent terrain, in `data/innerMap.json`):

```json
"waterFeatures": { "chance": 0.5, "count": [1, 2], "size": [4, 10] }
```

- `chance`: probability this inner map gets water at all.
- `count`: min/max ponds. `size`: min/max tiles per pond blob.
- No config on a parent terrain → no water (deserts stay dry).
- All randomness through the seeded RNG (`Utils.random` / `Utils.randInt`) —
  never `Math.random()`.

**Blob generation:**

- Each pond grows as a compact seeded blob, then eroded with the same
  stub-erosion approach `_paintGrassSecondLayer` uses on its grass mask so the
  result always auto-tiles cleanly.
- Blobs never touch the map border, road tiles, or the player-start tile.
  Bounded interior blobs cannot disconnect the walkable map, so no
  connectivity/flood-fill guard is needed.

**Stamping:**

- Auto-tile the blob mask via the existing `_pickNineTileInfo`; write visuals
  into `tile.terrainDetail` (same shape as the grass pass:
  `{sheetPath, sx, sy, sw: 32, sh: 32}`).
- For each stamped tile whose brush slot is flagged `impassable`:
  - `tile.baseTerrain = 'water'`
  - `tile.subTerrain` replaced with a new water sub-terrain def from
    `data/innerMap.json`: `{id: 'pond_water', name: 'Water', icon: '💧', passable: false}`
- Unflagged (shore-edge) cells keep their original sub-terrain and stay walkable.

**No movement-code changes.** Player stepping (`movement.js:23,58`), A*
(`movement.js:569`), path-walk safety, and all NPC spawn/wander/path logic
already read `tile.subTerrain.passable`. Semantic queries use
`tile.subTerrain.id === 'pond_water'` or `tile.baseTerrain === 'water'`.

## 4. Data changes

- `data/innerMap.json`: add the `pond_water` sub-terrain def and per-parent
  `waterFeatures` config for terrains that should have ponds (grassland,
  forest, hills, etc. — none for desert/ice unless desired).
- Optionally ship a default pond brush in data; otherwise brushes come from the
  editor via IndexedDB / exported gamedata, as today.
- `npm run build:data` regenerates `data/gamedata.json`.

## 5. Testing

- **Unit tests** (fixed seed, vitest):
  - Water pass produces blocked water cells and walkable shore cells.
  - A* (`_findPath`) routes around a pond; direct step onto water is refused.
  - NPC spawn never lands on an impassable water tile.
  - Player-start tile remains passable; no pond touches the map border.
  - Terrain without `waterFeatures` config generates no water.
- **Brush format**: flags/category survive the editor save/export round-trip shape.
- **Golden tests**: the new RNG draws in inner-map generation will shift golden
  snapshots for terrains with water config. This is an intentional determinism
  change — snapshots are updated in the same change, once, after the pass is
  finalized.

## Out of scope

- Hand-painted / editor-authored inner-map water layouts.
- Streams, rivers, or border-touching water (would need connectivity guards).
- Seasonal passability changes (e.g., walkable frozen ponds in winter).
- Bridges, fishing, swimming — enabled later by the `pond_water` tag.
