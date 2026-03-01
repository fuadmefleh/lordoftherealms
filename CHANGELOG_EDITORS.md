# Editor & Modding System — Changes Summary

## Overview

Editors are now accessible directly from the game's main menu. All editor data is persisted in the browser via IndexedDB. Players can design custom hex worlds and play on them.

---

## New Files

### `world_editor.html`
A full hex tile map editor, standalone HTML loaded in an iframe.

- **Canvas-based hex grid** — pointy-top, even-row offset coordinates (matches the game's renderer exactly)
- **24 terrain types** with correct colors/icons in a left-side palette (Deep Ocean → Highlands)
- **Tools**: Paint (brush size 1–20), Flood Fill, Rectangle, Eyedropper
- **Procedural generation** — noise-based terrain with seed control (elevation + moisture + heat → biome)
- **Minimap** with viewport indicator
- **Camera**: scroll-wheel zoom, middle-click/Alt+click pan, Fit button, keyboard shortcuts (`P`/`F`/`R`/`I` for tools, `+`/`-` for zoom)
- **Right panel**: world name/author/seed, hovered hex info, terrain statistics
- **Export API**: `getExportData()` returns `{name, author, seed, width, height, tiles[]}` for parent iframe communication
- **Import**: listens for `postMessage({type:'loadWorld', world})` to load saved worlds

### `src/systems/modStore.js`
IndexedDB persistence layer for all editor/mod data.

- **Database**: `lord_of_realms_mods`, version 1
- **Stores**: `moddata` (editor gamedata), `worlds` (custom hex worlds), `meta` (timestamps)
- **API**:
  - `ModStore.init()` — open DB on boot
  - `saveModData(data)` / `loadModData()` / `hasModData()` — editor gamedata blobs
  - `saveWorld(id, worldData)` / `loadWorld(id)` / `listWorlds()` / `deleteWorld(id)` — custom worlds
  - `exportAll()` / `importAll(blob)` — full export/import for sharing mods

---

## Modified Files

### `index.html`
- **Title screen**: added 3 secondary buttons below New Game / Continue:
  - 🛠 **Modding Tools** (`#btnModTools`)
  - 🗺 **World Editor** (`#btnWorldEditor`)
  - 🎮 **Play Custom World** (`#btnPlayCustom`)
- **Editor overlay** (`#editorOverlay`): full-screen hidden div (z-index 2500) with top bar (Save / Close) + iframe for `editor.html`
- **World editor overlay** (`#worldEditorOverlay`): same pattern, top bar (Save World / Load / Close) + iframe for `world_editor.html`
- **Script tag**: loads `src/systems/modStore.js` (via Vite module bundling)

### `styles.css`
- `#titleButtonsSecondary` — flex row for secondary buttons
- `.title-btn.secondary` — smaller, subtler gold-outline style
- `#editorOverlay`, `#worldEditorOverlay` — fixed fullscreen, dark background, z-index 2500
- `.editor-bar-title`, `.editor-bar-btn`, `.editor-bar-spacer` — top bar styling
- `#editorFrame`, `#worldEditorFrame` — borderless iframes filling the overlay

### `src/ui/game.js`
New methods added to the `Game` class:

| Method | Purpose |
|--------|---------|
| `_initEditorOverlays()` | Binds all editor button click handlers, initializes ModStore |
| `openEditorOverlay()` | Shows mod tools overlay, loads `editor.html` into iframe |
| `closeEditorOverlay()` | Hides overlay, unloads iframe |
| `openWorldEditorOverlay()` | Shows world editor overlay, loads `world_editor.html` |
| `closeWorldEditorOverlay()` | Hides overlay, unloads iframe |
| `saveEditorData()` | Pulls data from editor iframe → saves to ModStore |
| `saveWorldData()` | Pulls world data from world editor iframe → saves to ModStore |
| `showWorldLoadDialog()` | Lists saved worlds, loads selected one into the editor |
| `showCustomWorldPicker()` | Lists saved worlds, starts game on selected one |
| `startCustomWorld(data)` | Full game boot from custom world data (like `_doStartNewGame` but uses editor tiles) |
| `_editorFlashButton()` | Brief "Saved!" / "Error" feedback on bar buttons |

### `src/world/world.js`
New methods on the `World` class:

| Method | Purpose |
|--------|---------|
| `loadFromEditorData(editorData, kingdomCount)` | Converts flat `tiles[]` string array into full game tile objects (`{q, r, elevation, temperature, moisture, terrain, resource, ...}`), assigns resources, places kingdoms, runs all post-generation initialization (roads, settlements, religions, culture, history, units) |
| `_estimateElevation(terrainType)` | Maps terrain → plausible elevation value |
| `_estimateHeat(terrainType, latRatio)` | Maps terrain + latitude → temperature |
| `_estimateMoisture(terrainType)` | Maps terrain → moisture value |
| `_assignResources()` | Rolls resources per tile using `Terrain.RESOURCE_CHANCES` |

---

## User Flow

```
Title Screen
  ├─ 🛠 Modding Tools  →  editor overlay (editor.html in iframe)
  │                        └─ 💾 Save  →  ModStore.saveModData()
  │
  ├─ 🗺 World Editor   →  world editor overlay (world_editor.html in iframe)
  │                        ├─ Paint/fill/generate terrain on hex grid
  │                        ├─ 💾 Save World  →  ModStore.saveWorld()
  │                        └─ 📂 Load  →  ModStore.listWorlds() → pick → loadWorld()
  │
  └─ 🎮 Play Custom World  →  pick from saved worlds
                               └─ World.loadFromEditorData() → full game session
```

---

## Technical Notes

- **Coordinate system**: both the world editor and game use **even-row offset** hex coordinates with pointy-top hexagons
- **Storage**: IndexedDB (`lord_of_realms_mods` database), survives browser refresh, no server needed
- **Iframe isolation**: editors run in iframes, communicate via `postMessage` and direct `contentWindow.getExportData()` calls
- **Terrain matching**: the world editor's 24 terrain types exactly match `Terrain.TYPES` in `src/world/terrain.js`
- **Resource assignment**: custom worlds get resources via the same probability tables used by procedural generation (`Terrain.RESOURCE_CHANCES`)
