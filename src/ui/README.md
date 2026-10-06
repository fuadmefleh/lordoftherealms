# ui/

Rendering and input handling. This layer reads game state and draws it — it does not own state.

## Files

| File | Lines | Description |
|------|-------|-------------|
| `actionMenu.js` | ~400 | Contextual action menu (renders action panel, handles clicks); panels in `actionMenu/*.js` — e.g. `merchantCaravans.js`: hail a caravan or trading ship on the road (trade, escort, rob); `merchantPrince.js`: the market's Invest / Warehouse / Contracts / Holdings sections (`showMerchantPrince`, `merchantPrinceAct`; opened from the trade window's tabs and the Counsel); `labour.js`: a town's People — classes, work and wages, welfare, crime, refugees, strikes, the player's hands there (`showTownPeople`; the trade window's 👥 tab, the holdings panel, the Counsel; `peopleLine` for the trade outlook and holdings summary) |
| `buildingCreator.js` | ~600 | In-world building placement UI |
| `camera.js` | ~350 | Camera: pan, zoom, pixel↔hex conversion for the world map |
| `companionsPanel.js` | ~150 | Travel-party roster (approval, mood, values, gripes, quests; talk/gift/pay/raise/dismiss), rendered inside `ActionMenu.showTravelPartyMenu` |
| `game.js` | ~1200 | **Main game loop**: `requestAnimationFrame`, input routing, day/turn control |
| `hotbar.js` | ~280 | Hotbar: quick-access tool buttons |
| `innerMap/` | ~4100 | Inner-map system: rendering layers, character compositing, combat |
| `innerMapCharacters.js` | ~480 | LPC-format character sprite compositing |
| `innerMapUI.js` | ~700 | Inner-map HUD overlay (health bars, interaction prompts) |
| `lightSystem.js` | ~600 | Dynamic light rendering (candles, torches, time-of-day) |
| `minimap.js` | ~450 | Minimap: renders a downscaled view of explored tiles |
| `npcDialog.js` | ~850 | NPC dialogue trees, conversation UI, relationship responses |
| `objectActions.js` | ~500 | Interaction handler for clickable world objects |
| `renderer.js` | ~900 | **World hex renderer**: draws terrain, settlements, fog of war, overlays |
| `ui.js` | ~1100 | Main HUD: stats panel, resource bars, kingdom info, turn button |

## Rendering Pipeline

```
ui/game.js  (rAF loop)
   ├── ui/renderer.js          → draws world hex map on canvas
   ├── ui/innerMap/index.js    → draws inner-map canvas (when active)
   ├── ui/ui.js                → draws HUD overlay
   └── ui/lightSystem.js       → draws light layer on top
```

## Integration Points

- **Depends on**: `world/`, `player/`, `systems/audio/`, `core/hex.js`
- **Used by**: `context/GameContext.jsx` (mounts the canvases and starts the loop)

## Notes

- All rendering is canvas-based (`<canvas>`), not DOM/CSS. React only handles the screen shells (title screen, settings, overlays).
- `ui/game.js` is the single source of truth for the game tick — it calls `world.processDay()` and all system `processDay()` functions in the correct order.
- `ui/innerMap/` merges the previously separate `innerMapLayers.js`, `innerMapRenderer.js`, and `innerMapCombat.js` into a cohesive subfolder. See `ui/innerMap/README.md`.
- Do not put game logic here — only reads state and dispatches to `PlayerActions` / system methods.
