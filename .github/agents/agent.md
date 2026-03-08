# Agent Instructions — Lord of the Realms

## Project Overview

Lord of the Realms is a hex-grid strategy game built with **React, Vite, and HTML Canvas**. It runs as an Electron app or in the browser via Vite's dev server.

## Architecture

- **Vite** build tool with `@vitejs/plugin-react`. Dev server on port 8081, production output in `dist-web/`.
- **React 19** renders the UI shell; the core game logic lives in plain ES modules under `src/`.
- Entry point: `index.html` → `src/main.jsx` → `<App />` → `<GameView />` (instantiates the `Game` class).
- All game source code is ES modules in `src/` with named imports/exports — path aliases: `@core`, `@world`, `@player`, `@systems`, `@ui`, `@components`.
- Editors (`sprite_editor.html`, `editor.html`, `world_editor.html`, `interior_editor.html`, `terrain_editor.html`, `spritesheet_editor.html`) are standalone HTML files with inline `<style>`/`<script>` blocks, built as Vite MPA inputs.
- `editor.html` is a tabbed wrapper that hosts sub-editors inside iframes.
- Game data lives in individual JSON files under `data/`, merged into `data/gamedata.json` by `npm run build:data`.
- `data/gamedata.json` is a generated build artifact (gitignored) — do NOT edit it directly.
- Tile sprites are PNGs in `assets/tiles/` and `assets/lpc/`.
- Persistence uses IndexedDB via `src/systems/modStore.js` (database: `lord_of_realms_mods`).
- `editor-modstore.js` at root is a standalone IIFE copy of ModStore for editor HTML files (copied to `dist-web/` by a Vite plugin).

## Critical Rules

### DO NOT start an HTTP server after every code change.
The user runs their own dev server (`npm run dev`). Do not run `http-server`, `npx http-server`, `npx serve`, or any equivalent after making edits. Only start a server if the user explicitly asks for it.

### DO NOT run long terminal commands speculatively.
Avoid running PowerShell image-inspection loops, pixel-scanning scripts, or other slow commands unless the task requires it.

### DO NOT create summary/documentation markdown files after completing work.
Only create markdown files if the user explicitly requests one.

### DO NOT use `prompt()`, `alert()`, or `confirm()`.
Never use native browser dialogs. Always use styled modal dialogs that match the dark theme (`.te-modal` in terrain_editor, or equivalent). Each editor has `modalPrompt()`, `modalMultiPrompt()`, and `modalConfirm()` helpers — use those, or create equivalent ones for new editors.

## Code Conventions

- Game source code is ES modules (ES2020+) in `src/` with named imports/exports.
- React components are in `src/components/` (JSX).
- CSS uses custom properties defined in `:root` (e.g. `--bg`, `--panel`, `--gold`, `--blue`). Main stylesheet: `styles.css` (imported via `src/App.css`).
- Editor HTML files are self-contained with inline `<style>` and `<script>` blocks (no ES modules — they use global scope with `onclick` attributes).
- Editor HTML files can be 2000–4000+ lines — use targeted searches/reads, not full-file reads.
- Canvas rendering uses 2D context with manual pan/zoom (`panX`, `panY`, `canvasZoom`).
- Tile grids use `"q,r"` string keys for tile coordinate lookups (e.g. `objTiles["3,2"]`).
- The hex world map uses axial coordinates (`q`, `r`) with east-west wrapping.

## Source Layout

```
src/
  main.jsx          — React entry point
  App.jsx / App.css — Root component, imports styles.css
  components/       — React components (GameView.jsx, TitleScreen.jsx, etc.)
  context/          — React context providers
  core/             — dataLoader.js, hex.js, utils.js
  world/            — terrain.js, kingdom.js, world.js, economy.js, etc.
  player/           — player.js, playerActions.js, playerEconomy.js, etc.
  systems/          — modStore.js, quests.js, religion.js, technology.js, etc.
  ui/               — game.js (Game class), innerMapRenderer.js, etc.
  __tests__/        — Vitest test files
```

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

### interior_editor.html — Building Interior Layout Editor (~1300 lines)

Tile-based editor for designing interior layouts of buildings (taverns, houses, churches, etc.).

### terrain_editor.html — LPC Terrain Map Editor (~2300 lines)

Square-grid map editor for painting terrain tiles with auto-tiling terrain sets.

### world_editor.html — Hex World Map Editor (~1310 lines)

Hex-grid world map editor for painting terrain and placing overlays (villages, castles, ruins, etc.).

## Testing

- Tests are in `src/__tests__/` — run with `npm test` (Vitest).
- Test files: `utils.test.js`, `hex.test.js`, `data.test.js`, `terrain.test.js`, `kingdom.test.js`, `player.test.js`, `systems.test.js`.
- Setup file `src/__tests__/setup.js` mocks `fetch()`, DOM, `indexedDB`, etc. for Node environment.
- Watch mode: `npm run test:watch`.

## Running the Game

- **Dev server:** `npm run dev` (Vite, port 8081)
- **Build:** `npm run build` (outputs to `dist-web/`)
- **Build data:** `npm run build:data` (merges `data/*.json` → `data/gamedata.json`)
- **Electron:** `npm run electron` (loads `dist-web/index.html`)
- **Package:** `npm run dist` (Windows installer via electron-builder)

## Self-Learning

After completing any non-trivial task (bug fix, new feature, refactor, or architectural change), update this file with lessons learned so future sessions benefit. Append new entries to the relevant section below — never remove existing entries.

### Pitfalls & Gotchas

- **Vite HMR kills the game loop.** React Fast Refresh re-runs effect cleanups, including the `[]` effect in `GameView.jsx` that sets `isRunning = false`. The fix uses a module-level `_hmrGame` variable to persist the `Game` instance across HMR and a recovery effect that re-attaches and restarts the loop.
- **Building footprint tiles must default to impassable.** Custom buildings mark footprint tiles via `customBuildingPart` but originally left `subTerrain.passable` unchanged. This let the player walk through buildings. Fix: block all footprint tiles by default in both `innerMap.js` and `settlementGenerator.js`, then let `door` meta re-enable passability.
- **Loop-based time advancement overwrites instead of accumulating.** A `for` loop that sets `_timeAccumulator = TIME_SCALE` on each iteration only advances 1 hour regardless of the loop count. Fix: directly modify `timeOfDay += hours` with proper 24-hour wrapping.
- **Auto-enter door checks must be narrow.** Using `customBuildingPart && passable` as a door heuristic is too broad — it treats every passable building tile as a door. Only tiles with an explicit `_doorMarker` (set via the editor's Door tool) should trigger auto-enter.
- **`data/gamedata.json` is a generated build artifact.** Never edit it directly — edit individual JSON files under `data/` and run `npm run build:data`.
- **Editor HTML files use global scope, not ES modules.** They have inline `<script>` blocks with `onclick` attributes. Don't try to use `import`/`export` in them.
- **Never use `prompt()`, `alert()`, or `confirm()`.** Use the editor's `modalPrompt()`, `modalMultiPrompt()`, `modalConfirm()` helpers instead.

### Architectural Patterns

- **Module-level singletons for HMR resilience:** Store critical instances (like the `Game` object) in module-level variables outside React's lifecycle so they survive Hot Module Replacement. Add recovery effects that detect and re-attach orphaned instances.
- **Inner map tile structure:** Each tile has `subTerrain.passable` for pathfinding, `customBuilding` on anchor tiles, `customBuildingPart` on non-anchor footprint tiles, `_doorMarker` on door tiles, and optional `building` for legacy sprite buildings.
- **Pathfinding uses `subTerrain.passable` exclusively.** The A* algorithm in `InnerMap._findPath` only checks `tile.subTerrain.passable` — any other blocking mechanism must funnel through this flag.
- **Building placement order matters:** (1) mark anchor with `customBuilding`, (2) mark footprint with `customBuildingPart` + block passability, (3) apply meta overrides (impassable/door). Door meta must come last so it can re-enable passability on specific tiles.
- **Fire-and-forget async patterns:** `enterInnerMap()` is called without `await` from `_doStartNewGame()` to avoid blocking the React loading overlay. Use `_enteringInnerMap` guard flag to prevent double-entry during the async gap.
- **Camera systems:** World map uses `Camera` with hex wrapping; inner map uses `innerMapCamera` with pixel bounds and no X-wrap. Interior mode reconfigures zoom/bounds via `_configureInnerMapCamera('interior')`.
- **NPC building entry lifecycle:** NPCs path to a passable tile adjacent to a building, then enter `inside_building` state (hidden outdoors). When the player enters that building, matching NPCs are placed on interior tiles and rendered. When an NPC's timer expires inside an interior the player is viewing, it transitions to `leaving_building` state (removed from interior, restored to outdoor idle in `_outerMapState`). The `_outerMapState` preserves all outdoor NPCs while the player is in a building interior.

### Common Debugging Strategies

- **Game loop stops unexpectedly:** Check all code paths that set `isRunning = false` (constructor, React cleanup effects). Also check for unhandled exceptions in the loop body — wrap critical sections in try/catch.
- **Player walks through solid objects:** Verify `subTerrain.passable` is being set to `false` at placement time. Check the order of operations — meta overrides (door) may re-enable passability after blocking.
- **Inner map rendering blank:** Check `InnerMap.active`, `InnerMap.tiles` array dimensions, camera zoom/position, and `InnerMapRenderer.whenLoaded()` completion.
- **Editor data not saving:** Verify `notifyParent()` sends the correct postMessage type, and that `editor.html` has a matching handler that merges into `_gamedata`.
