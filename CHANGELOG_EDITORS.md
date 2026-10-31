# Editor & Modding System — Changes Summary

## Overview

Editors are now accessible directly from the game's main menu. All editor data is persisted in the browser via IndexedDB. Players can design custom hex worlds and play on them.

---

## Tile generator: drawn at game resolution, not shrunk (2026-10-30)

Shrinking a ~1250px painting to 32px tiles lost outlines and turned detail into noise: the art was never drawn to be that small. New **Draw at game resolution (pixel grid)** option (on by default, every sheet kind):

- **The guide is the real sheet, magnified.** It is drawn at art resolution (e.g. 192×128 px for 6×4 tiles of 32px) and blown up so each art pixel is a flat 5×5 block (`layoutGuide(kind, cols, rows, tile, magnify)`). The prompt opens with a Resolution section: the sheet is only 192×128 real pixels, one art pixel per block, props at most 28×28 with a 1-pixel outline.
- **The art is read back, not resampled.** `sampleArtPixels` finds the block pitch (within ±3%) and phase from the image's edges, then takes the commonest colour of each block's middle, so you get the art pixels the model placed. Props are then laid out unscaled (`relayoutSprites(…, { keep: true })`): a prop wider than a tile takes more tiles instead of shrinking. Tile sheets are cut at art resolution.
- **Grey backdrop cleared.** The models tend to keep the guide's grey box behind each prop. `keyOutGuideFill` floods it away from the background, allowing for the pink tint JPEG gives it, plus any walled-in patch of the same grey (inside a bucket handle). Grey inside a sprite's outline stays.
- **Structures have a guide now** (3×3-tile plots), mainly to fix their pixel scale.

Tested with real calls: Pro props → 24 crisp sprites read at 6.6px blocks; Pro 9-tile cobblestone → 171×96 art px, fitted 5×3; Pro structures, floor and terrain clean. Nano Banana draws finer than one block and may leave soft grey shadows, so Pro is the one to use for this mode. Turn the option off for the old scale-down behaviour.

## Tile generator: results land on the grid (2026-10-30)

Tested against real Nano Banana / Nano Banana Pro output. The models ignore a described grid: they add margins, pick their own cell pitch, draw gutters or grid lines between cells, let props overflow their cells, paint each 9-tile cell as a separate rounded island, and use a dull pink (#D03090, #E0139E) with pink drop shadows instead of #FF00FF. Snapping the whole picture onto cols×rows put things across tile boundaries. Now:

- **Layout guide.** Tile kinds (terrain, 9-tile, floor, wall, props) send a picture first: magenta with grey shapes where each tile, patch, inside-corner notch or prop goes, padded to the aspect ratio requested. The prompt tells the model to repaint it in place, with each shape one continuous piece and hard edges. **⬇ Guide** saves it for use in AI Studio; an import with the guide's proportions is treated as guided.
- **Props and structures are found and laid out again.** After keying, each sprite is found (connected pixels, detached bits merged, specks dropped), then all of them are resampled at one common scale (native art-pixel size when it fits, else the largest fits 1 tile for props / 3 for structures) and placed centred on whole tiles in reading order. Structures now default to a 9-wide grid.
- **Tile sheets are cut from the guide's grid.** The grid region is re-fitted to where the drawn content actually is. Near each cell boundary, a gutter or drawn grid line (with its anti-aliased shoulders) is cut out, and each cell is snapped on its own. Hairline gaps left inside drawn areas are filled.
- **Clear pink shadows, fringes & grid lines** (on by default): it keys the border colour when it is pinkish, clears magenta-cast pixels and the faded pink fringe at sprite edges, removes grid lines that would glue sprites together, and removes unpainted guide grey.
- The result line says what happened, e.g. `24 sprites → 6×4 tiles` or `fitted to 5×3 (4 gutters dropped)`. The preview grid follows the laid-out sheet.
- New pure helpers in `spritesheet-tools.js`: `keyOutMagentaCast`, `keyOutGuideGrey`, `findSprites`, `removeGridLines`, `detectPixelSize`, `relayoutSprites`, `fitTilesToGrid`, `healHairlines`, `layoutGuide`. All are covered in `spritesheetTools.test.js`.

## Spritesheet editor & tile generator pass (2026-10-28)

- **Fix (game): imported sheets now work in game.** The terrain / interior / sprite editors save imported sheets under made-up `custom/…` paths, with the pixels in the mod store. The game loaded those paths as plain URLs, so every tile painted from an imported sheet drew nothing. `src/core/customSheets.js` now maps them to the stored images: DataLoader registers them at startup, and the inner map, custom interiors, buildings, objects and building creator resolve their sheet paths through it. `ModStore.exportAll/importAll` now include the sheets, so a shared mod keeps its art.
- **🎨 Inner Map Tile Generator** replaces the Roman-only "Nano Banana" dialog:
  - Sheet kinds that match what the inner map uses: seamless terrain fills, 9-tile terrain brushes (3×3 + 4 inside corners + 2 alt fills, the layout the 9-Tile Brush Editor's 3×3 / 2×2 drags expect), interior floor and wall brushes, props, and multi-tile structures. Choose a setting (medieval by default), a season for outdoor kinds, the grid and the tile size.
  - Uses the real Gemini image models (`gemini-2.5-flash-image`, `gemini-3-pro-image-preview`). The key goes in a request header, not the URL. It can send the open image as a style reference, and it asks for the aspect ratio nearest the grid.
  - **Clean-up:** models return opaque pictures that sit off any grid. Generated sheets sit on flat magenta, which is keyed out (tolerance, or Auto from the border colour). The image is then snapped by majority vote onto the exact cols×rows×tile grid, and the palette can be limited (median cut). A Raw/Grid toggle and this session's history are shown too.
  - **Import Result** runs the same clean-up on an image made by hand in AI Studio.
  - Results go to **Open in Editor**, **Send to Editors** or PNG.
- **📤 Send to Editors** (source image, packed sheet or generator result): adds the sheet to the terrain, interior and/or sprite editors' palettes. Editors already open pick it up straight away (BroadcastChannel `lotr-custom-sheets`).
- **▦ Slice Tiles:** every non-empty grid tile becomes its own extraction.
- **🔁 Tile Test** on each extraction: shows it repeated 3×3 and scores how well the left/right and top/bottom edges wrap.
- **Pack Sheet:** a new **Tile grid** layout (the default) starts every sprite on a tile boundary, which the tile painters need; the old padded shelf layout is still there as Tight. **Atlas JSON** export. The fill % now measures the retargeted canvases that are actually packed.
- **↶ Undo / Ctrl+Z** for open, wand and crop on the source image. Ctrl+C / Ctrl+V no longer switch to Crop / do nothing; shortcuts are ignored while a dialog is open.
- Pure logic lives in `spritesheet-tools.js` (`window.SheetTools`), tested in `spritesheetTools.test.js`; `customSheets.test.js` covers the resolver.

## Blocked edges for floors (2026-10-20)

Characters move tile by tile, so "the border of this tile isn't walkable" is a **blocked side**: you can stand on the tile, but nobody crosses that edge, in either direction.

- **Per brush slot** (interior editor, 9-Tile Brush Editor, floor brushes): each slot has four edge bars; click one to block that side. **Block outer edges** blocks TL→top+left, Top→top, … BR→bottom+right in one click. Saved as `brush.slotSides`.
  - Painted floors take their sides from the slot each cell uses, worked out from the painted cells, so erasing or repainting never leaves stale ones. Inside corners block nothing.
  - A side facing a door is never blocked, so a door can't be walled off.
- **Per tile** (⛔ Block tool): click near a tile's edge to block or unblock that side, or click the middle for the whole tile as before. Drag to do a row. The hover shows which one a click will change.
  - Unblocking a brush side records an opening on that tile (`meta.openSides`), e.g. a gap in a rug border.
  - Red bars are sides you set by hand; amber bars come from the brush.
- **Export:** `meta.blockSides` (by hand) and `meta.brushSides` (from brushes, with doors and openings applied).
- **Game:** `_generateCustomInterior` sets `tile.blockedSides`. `InnerMap.movePlayer`, `_findPath` and the walk animation refuse steps across them (`_stepBlocked`). Tests: `tileSides.test.js`.
- Generated (procedural) interiors use them too: the room's floor brush now lays its full 9-tile border along the walls (it used to fill the room with the centre tile only), and its edge slots block their outer sides, never the side toward the door.

## Tiling tools pass (2026-10-20)

- **One set of 9-tile rules.** The game (`InnerMap._stampNineTileMask`) and the terrain editor used to resolve brushes with separate copies of the logic, and they disagreed: the editor drew one-wide strips with edge tiles where the game used the centre, and showed blank tiles for seasons left empty where the game used the default grid. Both now use `src/core/nineTile.js` (editor twin: `EditorCore.resolveNineTileCell` & co.), checked against each other by `nineTile.test.js`.
- **Season fallback fix (game):** a season's inside corners and alternate fills now only win when they hold a tile. Before, a brush authored in spring lost its inside corners in the other seasons, because the editor saves an empty corner list for each season.
- **Live Preview in the 9-Tile Brush Editor** (terrain editor):
  - A test shape (Pond, Ring, Coast or Random 🎲) is painted with the brush as you assign slots, unsaved changes included, the way the game stamps it.
  - Pond and Ring between them use all 13 slots. Tiles that fall back are outlined: amber for a missing inside corner, red for an empty slot.
  - Hover a tile to see which slot it uses and why; click it to select that slot.
  - A coverage list shows N/13 slots filled, each empty slot as a link that selects it, and what it costs. It also says when a season has no tiles of its own and borrows another's, and warns about fully see-through tiles.
- **Fix:** the season dots on the side panel's brush cards always read 0. They now count the filled slots out of 13.

## Modding tools pass (2026-10-20)

- **📜 Game Data tab** (`editor.html`): edit any of the ~70 gamedata sections (quests, ailments, religions, units, chatter…) as JSON.
  - Sections list with a "changed" filter, and **Find anywhere** across every section's keys and text.
  - Entries list with breadcrumbs: click an entry to edit it, **›** to open what's inside. Gold dot = changed, green = added. Removed base entries stay listed (struck through); click one to restore it.
  - JSON box with line numbers, live validation that marks the bad line, auto-indent, Tab, `Ctrl+S` apply, `Ctrl+Shift+F` format. Warns when a value changes kind (object → list) from the base game.
  - **Duplicate** copies an entry under a new key and renames its `id` to match. There are also New, Delete and **Reset to base**.
  - Edits are stored as **patches** against `data/gamedata.json` (`_gamedata.dataPatches`, format in `src/core/dataPatch.js`), so game updates still reach fields you didn't touch. **Export / Import changes** shares just these patches. Export gamedata.json bakes them in.
  - Sections owned by other tabs (buildings, objects, interiors, terrain tiles…) aren't listed here.
- **Tech Tree tab now reaches the game.** `customTechs` used to be saved but never loaded. `DataLoader._mergeEditorData` now folds it into `technology`, and the Game Data patches go on top of that.
- **Hub:** 📄 New asks before wiping everything. `Ctrl+S` saves to the browser right away. ⬆ Import also accepts Game Data changes files and mod packs.
- **Overlay top bar** (`EditorOverlay.jsx`):
  - Modding Tools adds 📦 **Export Mod Pack** (all editor content plus worlds, one file), 📥 **Import Mod Pack** (asks first, then reloads the editor), and ⟲ **Base Game** (`ModStore.clearModData()`; saved worlds are kept). Back to Menu writes pending edits first.
  - World Editor: 💾 **Save World** updates the open world instead of adding a copy every time; renaming the map makes a new save. **Save As…** makes a separate copy, and the **Worlds** picker marks the open world and can delete one (two clicks). `Ctrl+S` in the world editor saves to the game's list (`Ctrl+Shift+S` exports a file).

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
