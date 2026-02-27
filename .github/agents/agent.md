# Agent Instructions — Lord of the Realms

## Project Overview

Lord of the Realms is a hex-grid strategy game built with **vanilla JavaScript, HTML Canvas, and CSS** — no frameworks. It runs as an Electron app or in the browser via a static file server.

## Architecture

- **No build step.** All JS/HTML/CSS is authored directly — no bundler, no transpiler.
- Entry point: `index.html` loads ~40+ scripts from `js/` and data from `data/`.
- Editors (`sprite_editor.html`, `editor.html`, `world_editor.html`, `interior_editor.html`, `spritesheet_editor.html`) are standalone HTML files, sometimes loaded inside iframes.
- `editor.html` is a tabbed wrapper that hosts `sprite_editor.html` (buildings/objects), `spritesheet_editor.html`, `interior_editor.html`, and a built-in resource editor inside iframes.
- Game data lives in `data/gamedata.json` and individual JSON files under `data/`.
- Tile sprites are PNGs in `assets/tiles/` and `assets/lpc/`.
- Persistence uses IndexedDB via `js/systems/modStore.js` (database: `lord_of_realms_mods`).

## Critical Rules

### DO NOT start an HTTP server after every code change.
The user runs their own server. Do not run `http-server`, `npx http-server`, `npx serve`, or any equivalent after making edits. Only start a server if the user explicitly asks for it.

### DO NOT run long terminal commands speculatively.
Avoid running PowerShell image-inspection loops, pixel-scanning scripts, or other slow commands unless the task requires it.

### DO NOT create summary/documentation markdown files after completing work.
Only create markdown files if the user explicitly requests one.

### DO NOT use `prompt()`, `alert()`, or `confirm()`.
Never use native browser dialogs. Always use styled modal dialogs that match the dark theme (`.te-modal` in terrain_editor, or equivalent). Each editor has `modalPrompt()`, `modalMultiPrompt()`, and `modalConfirm()` helpers — use those, or create equivalent ones for new editors.

## Code Conventions

- All game code is vanilla JS (ES2020+). No TypeScript, no JSX, no imports/exports (everything is script-tag loaded).
- CSS uses custom properties defined in `:root` (e.g. `--bg`, `--panel`, `--gold`, `--blue`).
- HTML files are self-contained with inline `<style>` and `<script>` blocks.
- Editor HTML files can be 2000–4000+ lines — use targeted searches/reads, not full-file reads.
- Canvas rendering uses 2D context with manual pan/zoom (`panX`, `panY`, `canvasZoom`).
- Tile grids use `"q,r"` string keys for tile coordinate lookups (e.g. `objTiles["3,2"]`).
- The hex world map uses axial coordinates (`q`, `r`) with east-west wrapping.

## Editor System

### Communication Architecture

```
editor.html (parent hub)
  ├── iframe: sprite_editor.html
  │     ↕ postMessage: loadGamedata / spriteDataChanged / spriteEditorReady
  │     ↕ sync pull: getExportData()
  ├── iframe: spritesheet_editor.html  (standalone, no parent comm)
  ├── iframe: interior_editor.html
  │     ↕ postMessage: loadGamedata / interiorDataChanged / interiorEditorReady
  │     ↕ sync pull: getExportData()
  ├── iframe: terrain_editor.html
  │     ↕ postMessage: loadGamedata / terrainEditorReady
  │     ↕ sync pull: getExportData()
  ├── iframe: world_editor.html
  │     ↕ postMessage: loadWorld / worldEditorReady
  └── inline: Resource Types Editor (no iframe)
```

- Data flows: `editor.html` → `postMessage('loadGamedata')` → sub-editors parse and populate their state.
- Save flow: sub-editors call `notifyParent()` → `postMessage('{type}DataChanged')` → editor.html merges into `_gamedata`.
- Export pull: `editor.html` calls `iframe.contentWindow.getExportData()` synchronously on each sub-editor.

### Common Patterns

- **Tile size:** 32px (`TILE=32`) everywhere except world editor (hex, `HEX_SIZE=18`)
- **Dark theme:** CSS vars `--bg:#0d1117`, `--panel:#161b22`, `--gold:#e6a817`, etc.
- **Toast notifications** for user feedback
- **Undo/Redo stacks** in sprite, interior, and terrain editors
- **3-column layout:** Palette | Canvas | Properties
- **LPC spritesheets** from `assets/lpc/` as primary art source
- **`gamedata.json`** as the unified data format

### editor.html — Master Editor Hub (~920 lines)

Parent wrapper that hosts all sub-editors via tabs and manages `gamedata.json` centrally.

**Key globals:**
- `_gamedata` — The entire `gamedata.json` object (single source of truth)
- `resources` — `{ KEY → { id, name, icon, color, category, baseValue, description } }`
- `resChanc` — `{ terrainId → [{ resource, chance }] }` (resource spawn chances per terrain)
- `dirty` — Unsaved changes flag

**Tabs:** Sprite Editor (eager iframe), Spritesheet Editor (lazy iframe), Interior Editor (lazy iframe), Terrain Editor (lazy iframe), Resource Types (inline, no iframe).

**Built-in Resource Types Editor:** Inline panel for defining ore/plant/animal resource types with terrain spawn probability assignments per biome.

### sprite_editor.html — Building & Object Sprite Composer (~3650 lines)

Dual-mode tile-based editor for composing custom buildings and objects from LPC spritesheet tiles.

**Key globals:**
- `TILE = 32`, `gridW`/`gridH` (building: 12×12, object: 8×8 default)
- `editorMode` — `'building'` | `'object'`
- `activeTool` — `'paint'` | `'select'` | `'erase'` | `'fill'` | `'eyedrop'` | `'impass'` | `'marker'` | `'origin'` | `'tbrush'`
- `layers = { floor:{}, walls:{}, roof:{}, overlay:{} }` (building mode)
- `buildings[]`, `objDefs[]` — Saved item lists
- `_tbrush_sets` — Terrain brush auto-tile sets
- `_objHealthStates`, `_objSeasonVariants`, `_objGrowthStates` — Object state systems
- `_objOriginQ/R`, `_bldOriginQ/R` — Origin/anchor tile positions
- `undoStack[]`, `redoStack[]`

**Modes:** Building mode (4 layers: floor/walls/roof/overlay) and Object mode (single tile layer + health states, season variants, growth states).

**Tools:** Paint, Select & Move, Erase, Flood Fill, Eyedropper, Block (impassable), Door/Interact Marker, Origin Pin, Terrain Brush (auto-tiling with corner/edge/mixed patterns).

**Features:** Stamp rotation (R/Shift+R), autofit grid (Shift+F), spritesheet palette with category tabs.

### spritesheet_editor.html — Spritesheet Extraction & Packing (~1580 lines)

Standalone utility for extracting sprite tiles from source images and packing them into new spritesheets. **No parent communication** — purely image-in, image-out.

**Key state (`state` object):**
- `state.img` — Loaded source Image
- `state.tileSize` (default 32), `state.zoom`
- `state.mode` — `'select'` | `'crop'`
- `state.sel` — Selection rect `{ x, y, w, h }`
- `state.extractions[]` — `[{ id, canvas, origTilesW, origTilesH, name }]`

**Features:**
- Drag-select tile regions on a source image with grid overlay
- Auto-trim empty tiles from extractions
- Retarget extraction to different tile size (nearest-neighbor scaling)
- Background removal via `@imgly/background-removal` (ONNX model)
- Pack all extractions into a single spritesheet PNG
- Paste from clipboard (Ctrl+V), drag-and-drop image loading

### interior_editor.html — Building Interior Layout Editor (~1300 lines)

Tile-based editor for designing interior layouts of buildings (taverns, houses, churches, etc.).

**Key globals:**
- `TILE = 32`, `gridW = 10`, `gridH = 8`
- `layers = { floor:{}, walls:{}, overlay:{} }` — 3 paint layers
- `meta = {}` — `"q,r" → { impassable?, door?, furniture?: { type, name, passable } }`
- `interiors[]` — Saved interior definitions
- `undoStack[]`, `redoStack[]` (max 40)

**Tools:** Paint, Erase, Fill, Eyedropper, Block (impassable), Door, Furniture.

**Building types:** house, tavern, blacksmith, church, temple, marketplace, town_hall, barracks, manor, etc.

**Furniture types:** table, chair, bed, chest, barrel, bookshelf, fireplace, candle, bar, forge, anvil, altar, pew.

**Palette:** LPC interior categories (Floors, Walls, Doors & Windows, Furniture, Interior Objects, Decorations).

### terrain_editor.html — LPC Terrain Map Editor (~2300 lines)

Square-grid map editor for painting terrain tiles with auto-tiling terrain sets.

**Key globals:**
- `TILE = 32`, `mapW`/`mapH` (default 32×24)
- `tiles[][]` — 2D array, `tiles[r][q] = { sheetPath, sx, sy }` or null
- `activeTool` — `'paint'` | `'terrain'` | `'erase'` | `'fill'` | `'pick'` | `'rect'`
- `brushSize` — Range 1–8
- `terrainSets[]` — Auto-tile terrain set definitions
- `zoom = 2`, `panX`, `panY`
- `undoStack[]`, `redoStack[]` (max 50)

**Tools:** Stamp Brush (B), Terrain Brush auto-tile (T), Eraser (E), Bucket Fill (G), Eyedropper (I), Shape Fill (R).

**Features:** Variable brush size (1–8), Brush Creator Modal for visually assigning tiles to terrain patterns (corner/edge/mixed), terrain fill mode with random selection, new/load/save map as JSON.

**Default terrain sets:** "LPC Ground" (corner type: Grass/Dirt/Sand/Water), "Paths" (edge type: Ground/Path).

### world_editor.html — Hex World Map Editor (~1310 lines)

Hex-grid world map editor for painting terrain and placing overlays (villages, castles, ruins, etc.).

**Key globals:**
- `HEX_SIZE = 18`, `mapW = 70`, `mapH = 45`
- `tiles[]` — Flat array `[r * mapW + q]` of terrain ID strings
- `overlays = {}` — `"q,r" → { type, name }`
- `activeTool` — `'paint'` | `'fill'` | `'rect'` | `'eyedrop'`
- `activeLayer` — `'terrain'` | `'overlay'`
- `brushRadius` — 1–20
- `useSprites` — Toggle between color fill and hex tile sprite rendering
- `TERRAIN_SPRITES` — Maps terrain IDs to hex tile PNG paths from `assets/tiles/`
- `spriteCache` — Loaded Image elements

**Hex terrains (~25):** deep_ocean, ocean, coast, sea, beach, lake, ice, snow, tundra, grassland, plains, woodland, boreal_forest, seasonal_forest, temperate_rainforest, tropical_rainforest, savanna, desert, hills, mountain, snow_peak, swamp, island, highlands.

**Overlay types:** village, town, city, castle, fort, ruins (with optional place names).

**Features:** Minimap with click-to-navigate, procedural terrain generation, deterministic sprite variant selection (hash-based), sprite rendering from `assets/tiles/`.

### debug.html — Script Loading Diagnostic (~106 lines)

Not an editor. Diagnostic page that sequentially loads all ~36 game JS files and reports success/failure, then attempts to create a `Game` instance. Terminal-style monospace green-on-black output.

## Testing

- Tests are in `tests/` — run with `npm test` (opens `tests/index.html` in browser).
- Test files: `test.hex.js`, `test.terrain.js`, `test.kingdom.js`, `test.player.js`, `test.systems.js`, `test.utils.js`, `test.data.js`.

## Running the Game

- **Browser:** `npm start` (serves on port 8081)
- **Electron:** `npm run electron`
- **Build:** `npm run dist` (Windows installer via electron-builder)
