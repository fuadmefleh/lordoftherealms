# Interior/Inner Map System - Technical Overview

## Data Structures

### Interior Definition (from CustomInteriors)
- **id**: unique interior identifier
- **name**: display name
- **buildingType**: which building type(s) this interior is for (tavern, house, blacksmith, etc.)
- **tags**: optional array of tags for filtering
- **variantGroup**: optional grouping for variants of same building type
- **tileW/tileH**: always 32
- **width/height**: dimensions of the interior grid
- **bounds**: `{minCol, minRow, maxCol, maxRow}` - coordinate offsets
- **layers**: object with floor/walls/furniture/overlay arrays
  - Each layer contains `{q, r, sheetPath, sx, sy, sw, sh}` tile definitions
- **meta**: array of per-tile metadata
  - Can have: `{q, r, impassable, door, furniture: {type, name, icon, passable}}`
- **placedObjects**: array of custom objects placed in the interior
- **brushGroupMap**: 9-tile brush mapping (for procedural walls/floors)
- **nineTileBrushes**: array of nine-tile brush definitions

### data/interiors.json
- Currently EMPTY (no default interiors loaded)
- Editor saves to gamedata.json under `custom_interiors.files['interiors.json'].interiors[]`

### data/innerMap.json
- Defines sub-terrains for outdoor tiles (not for building interiors)
- Format: `subTerrains.{terrainId}.{primary/encounters}`

### data/innerMapRenderer.json
- Sprite sheet paths (LPC assets)
- Fallback colors for rendering
- Overlay mappings (sub-terrain ID → layer)
- Fallback sprite definitions

### INTERIOR_LAYOUTS (hardcoded in innerMap.js)
Procedural interior definitions for building types:
- town_hall, marketplace, tavern, blacksmith, church, temple, barracks, house, manor, granary, warehouse, stable, well, barn, guard_tower, farm
- Each has: `{width, height, floor, wallColor, furniture: [{type, icon, name, q, r, passable}, ...]}`

## How Interiors Are Referenced

### From Buildings
- Building objects have `type` field (tavern, house, blacksmith, etc.)
- Interior is selected deterministically by `CustomInteriors.pickForBuilding(type, seed)`
- If building has `_customDefId`, searches for linked interior first
- Fallback: INTERIOR_LAYOUTS[building.type] for procedural generation

### Building Entry Mechanism
1. Player walks on a tile with `_doorMarker` metadata
2. `_doorMarker` contains `{anchorQ, anchorR, defId}`
3. Game calls `InnerMap.enterBuilding(building, game)` automatically
4. Or player can manually click "Enter" button on building UI

## Generation Process

### Custom Interior Path
1. `_generateCustomInterior(def, building)` called
2. For each tile position, looks up cell data in `def._layerMaps.{floor/walls/furniture/overlay}`
3. Creates tile with `_customTile` object containing spritesheet references
4. Applies meta flags (impassable, door, furniture)
5. Places any `placedObjects` from the interior definition

### Procedural Path (Fallback)
1. `_generateInterior(building, interiorKey)` checks for custom first
2. Falls back to `INTERIOR_LAYOUTS[building.type]`
3. Generates simple tile grid:
   - Walls on edges, door at bottom center
   - Checkerboard floor pattern
   - Places furniture from layout definition
4. Simple colored tiles (no spritesheet rendering)

### Interior Cache
- Cached by key: `{worldQ},{worldR}_{building.type}_{building.q}_{building.r}`
- Cached interiors persist for entire play session
- Restored when re-entering same building

## Rendering

### Custom Tile Rendering
- Tiles with `_customTile` property rendered via spritesheet
- Has separate layers: floor, walls, furniture, overlay
- LPC sprite assets used from data/innerMapRenderer.json paths

### Procedural Tile Rendering
- Simple colored fills (no spritesheet)
- Color from `subTerrain.color`
- Walls darker, floors lighter checkerboard

## Triggering Entry

### Auto-Entry (Door Tiles)
- Tile must have `_doorMarker` metadata set
- Automatically triggers when player steps on it
- Sets `InnerMap._insideBuilding` and swaps tile state

### Manual Entry
- Player clicks building UI → "Enter" button
- Calls `InnerMap.enterBuilding(building, game)`

## No Existing Auto-Generation Logic
- No procedural layout generation beyond INTERIOR_LAYOUTS
- Editor-based (interior_editor.html) for authoring custom interiors
- 9-tile brush system for auto-tiling walls/floors in editor
- No algorithmic room/corridor generation

## Key Files
- src/world/innerMap.js - main system, INTERIOR_LAYOUTS, generation
- src/world/customInteriors.js - loader, registry, API
- interior_editor.html - authoring tool
- src/ui/innerMapRenderer.js - rendering system
- src/ui/innerMapLayers.js - layer rendering helpers
