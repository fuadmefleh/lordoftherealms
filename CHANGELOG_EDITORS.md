# Editor & Modding System — Changes Summary

## Overview

Editors are now accessible directly from the game's main menu. All editor data is persisted in the browser via IndexedDB. Players can design custom hex worlds and play on them.

---

## New Files

### `world_editor.html` (+ `world-editor-tools.js`)
A hex world editor, standalone HTML loaded in an iframe. Its pure map logic (hex math, sculpting, generator, map check) lives in the classic script `world-editor-tools.js` (`window.WorldTools`), tested by `src/__tests__/worldEditorTools.test.js`.

- **Three layers** (tabs, keys `1`/`2`/`3`):
  - **Terrain** — 24 terrains in searchable groups, plus recently used swatches.
  - **Places** — towns, roads, **rivers**, landmarks, the **Player Start** and an eraser.
  - **Realms** — seat each realm's **capital**, paint its **lands**, and **⤢ Grow lands** from the capital. You can rename a realm, recolour it, change its culture or add a realm of your own.
- **Tools**:
  - Brush `B`, Fill `G`, Rectangle `R` and Line `L` (drag previews), Pick `I` (or right-click).
  - Sculpting: **Raise** `E` and **Lower** `D` step through sea → shore → land → hills → mountains; **Smooth** `S`.
  - Brush size (`[` `]`), **density** (scatter painting) and **mirror** painting (east-west, north-south, four ways, 180°).
- **Undo / redo** (`Ctrl+Z` / `Ctrl+Y`, 80 steps).
- **✨ Generate…** opens a dialog with a live preview. You set the shape (continents, pangaea, archipelago, isles, highlands), land %, mountains, climate, rainfall, rivers and seed. Generated worlds wrap seamlessly east-west, like the game map, and rivers run downhill to the sea. **Continents and Pangaea are built by plate tectonics**: the crust is cut into irregular fragments that join into a dozen drifting plates, and separately into continents of varied size. Where plates collide, ranges rise inside a continent; ocean crust diving under a continent raises a coastal range; two oceans meeting raise an island arc; spreading plates open rifts and mid-ocean ridges; hotspots add lone volcanic isles. Rainfall follows Earth's belts (wet equator, desert belts near 30°, temperate westerlies), continental interiors dry out, and ranges cast rain shadows downwind. **Beaches** go only where sand would gather: low, warm shores (none on tundra, snow, swamp or under hills and mountains, which make cliffs), sheltered bays rather than exposed headlands, and river mouths that bring sediment, in stretches with rocky gaps between. With the Continents shape you can set how many continents (1–12, or any); each comes out as its own landmass, parted by sea, and the map edge is turned to fall in open water.
- **🏝 Coastline** re-shapes the seas (coastal waters, ocean, the deep); **Smooth all** smooths the whole map once.
- **View**:
  - Hex grid `H`, tile art toggle, and **wrap preview** `W` (paint across the seam).
  - A zoomed-out fast mode, so huge maps stay smooth.
  - Space/middle-drag pan, arrow keys, and a minimap you can click or drag.
- **Map check** panel: errors, warnings and info, each clickable to jump to the hex (e.g. a town on water, a realm with lands but no capital).
- **Rules in play**: random realm count, wild villages, ruins frequency, auto roads, and whether realms found extra towns.
- **Files**: autosaves to `localStorage` and offers to restore on open. Export/import `.json` (or drag a file onto the map), and export a `.png` picture of the whole map.
- **API**: `getExportData()` returns `{name, author, seed, width, height, tiles[], overlays, roadOverlays, rivers, realms, territory, playerStart, rules}`. `loadWorldData(data)` and `postMessage({type:'loadWorld', world})` load worlds; older worlds still load. `prepareForPlaytest()` autosaves and returns the data.
- **▶ Playtest** (in `EditorOverlay.jsx`) starts a game on the map at once. The editor picks the map back up afterwards.

### Custom worlds in play (`World.loadFromEditorData`)
Everything placed in the editor now reaches the game. Before this change only the terrain did:
- Towns, cities and ports keep their names.
- Landmarks become points of interest; ruins, dungeons and caves can be delved.
- Painted roads and rivers are kept.
- Realms are seated on their capitals and painted lands (unknown ids become new realms).
- The player begins at the Player Start.

Custom worlds now also get land/water **regions**, so auto roads, caravans and region names work. The editor data is stored in `generationParams.customWorld`, so **resuming a saved custom-world game rebuilds the same map** (it used to regenerate a random one). Tests: `src/__tests__/customWorld.test.js`.

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
