# Source Architecture

Lord of the Realms is a medieval strategy RPG built with React + Vite. The `src/` directory is organized into focused modules:

## Module Map

| Folder | Purpose |
|--------|---------|
| [`core/`](core/README.md) | Low-level utilities: hex math, RNG, data loading |
| [`player/`](player/README.md) | Everything the player can do and own |
| [`systems/`](systems/README.md) | World simulation: relationships, technology, religion, audio, etc. |
| [`world/`](world/README.md) | World model: terrain generation, kingdoms, economy, NPCs |
| [`ui/`](ui/README.md) | Rendering: world renderer, inner map, HUD, dialogs |
| [`components/`](components/README.md) | React UI components (screens, overlays) |
| [`context/`](context/README.md) | React context providing global game state to components |

## Data Flow

```
data/*.json  ──►  core/dataLoader.js  ──►  (injected into all systems at init)

world/world.js  (world generation)
      │
      ▼
world/terrain.js + world/kingdom.js + world/characters.js ...
      │
      ▼
systems/*.js  (processTurn() called each game day)
      │
      ▼
player/*.js  (player actions and state mutations)
      │
      ▼
ui/*.js  (renders world + HUD on each animation frame)
      │
      ▼
components/*.jsx  (React screens, overlays, top bar)
      │
      ▼
context/GameContext.jsx  (glues game engine to React)
```

## Key Conventions

- **Data-driven**: Game content lives in `data/*.json`; systems read it via `DataLoader`.
- **Barrel exports**: Every subfolder exposes an `index.js` that re-exports its public API. Import from the folder, not the individual file.
- **No circular deps**: `core/` ← `world/` ← `systems/` ← `player/` ← `ui/`. Never import upward.
- **No side effects on import**: Systems are initialized explicitly via `init(world)` or `initialize(player)` calls. Nothing runs at module load time.
- **Turn processing**: Each system that needs time-based updates exports a `processDay(world, player)` (or similar) function called by the main game loop in `ui/game.js`.

## Entry Points

| File | Role |
|------|------|
| `main.jsx` | React root mount |
| `App.jsx` | Top-level React component, routes between screens |
| `context/GameContext.jsx` | Game engine lifecycle (init, save/load, turn loop) |
| `ui/game.js` | Main game loop (animation frame, input, camera) |
| `ui/renderer.js` | Hex world renderer |
| `ui/innerMap/` | Inner-map (settlement exploration) renderer |
