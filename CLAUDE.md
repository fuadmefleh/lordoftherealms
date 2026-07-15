# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**Lord of the Realms** — a hex-grid strategy RPG. An imperative, canvas-based game
engine wrapped in a thin React + Vite shell. The engine owns simulation state and
renders to canvas; React only mirrors a display copy of that state for screens,
overlays, and the top bar.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:8082
npm test             # vitest run — the unit + golden suites
npm run test:watch   # vitest in watch mode
npm run lint         # eslint src  (see the guardrail below — this can FAIL a change)
npm run lint:fix     # eslint --fix
npm run format       # prettier --write src
npm run build        # vite build → dist-web/
npm run build:data   # node scripts/build-gamedata.js → data/gamedata.json
npm run electron     # run the built app in Electron
```

Before finishing any change to `src/`, run **`npm run lint && npm test`** — both
must pass. Lint failure on domain globals (below) blocks the change by design.

## Architecture

Source lives under `src/`, layered with a strict dependency direction —
**never import upward**:

```
core/  ←  world/  ←  systems/  ←  player/  ←  ui/  ←  components/
```

| Layer | Path | Role |
|-------|------|------|
| `core/` | hex math, seeded RNG/noise (`utils.js`), `dataLoader.js` | Pure utilities, no game deps |
| `world/` | terrain, kingdoms, economy, NPCs, world generation | World model |
| `systems/` | religion, technology, relationships, espionage, ships, saveLoad, … | Turn-based simulation |
| `player/` | player state, actions, economy, military, religion | What the player owns/does |
| `ui/` | `game.js` (loop), `renderer.js`, inner-map, HUD, dialogs | Canvas rendering + input |
| `components/` | `GameView.jsx`, screens, overlays, `TopBar` | React shell |
| `context/` | `GameContext.jsx` | Glues engine lifecycle to React |

Entry points: `main.jsx` (mount) → `App.jsx` (routes screens) → `GameView.jsx`
(**composition root**, constructs the `Game`) → `ui/game.js` (main loop).

Each subfolder has its own `README.md` with a file-level map — read it before
working in that layer. Every subfolder exposes a barrel `index.js`; **import
from the folder, not the individual file**. Systems have no import-time side
effects — they're initialized explicitly (`init(world)` / `initialize(player)`)
and advance time via a `processDay(world, player)`-style call from the game loop.

Content is **data-driven**: game content lives in `data/*.json`, merged into
`data/gamedata.json` by `build:data`, and read through `DataLoader`. Change
content in the JSON, not in code.

## Two hard rules (ESLint-enforced as errors)

These are the reason the codebase is testable. Both are enforced by
`eslint.config.js` on `src/{core,world,systems,player}/**`; violating either
fails `npm run lint`. Full rationale in `docs/architecture-globals.md`.

1. **No domain globals.** Code in `core/world/systems/player` must never read a
   bare `game` or `window.game`. It receives `game` / `world` / `player` / `day`
   as **explicit parameters**, threaded from the caller that owns them. The one
   sanctioned `window.game` binding lives in `components/GameView.jsx` and exists
   only for the legacy inline-onclick handlers in `src/ui/**` (which are exempt).

2. **No raw randomness.** All domain randomness flows through the seedable RNG in
   `core/utils.js` (`Utils.setSeed`, `Utils.random`, `Utils.randInt`, …) — never
   `Math.random()`. Tests set a seed and assert reproducible outcomes.

When adding domain logic, thread dependencies in as parameters and draw randomness
from `Utils`. If you find yourself wanting a global, that's the smell the rules
guard against.

## Tests

Specs live in `src/__tests__/` (`*.test.js`, run under vitest/node). `setup.js`
resets the RNG before each test and stubs the browser APIs game modules touch
(fetch→filesystem, DOM, `indexedDB`, `AudioContext`, rAF). **golden.\*** tests are
characterization snapshots freezing exact RNG/terrain/unit output for a fixed
seed — if you intentionally change that output, update the snapshot; if you
didn't mean to, you broke determinism.

## Conventions

- 4-space indent, single quotes, semicolons (see `.prettierrc`). Match
  surrounding style.
- Path aliases exist (`@core`, `@world`, `@player`, `@systems`, `@ui`,
  `@components`) — see `vite.config.js`.
- The `*.html` files at the repo root (`editor.html`, `sprite_editor.html`, …)
  are standalone tools, excluded from lint/build-as-source. `scripts/` and
  `electron-main.js` are also lint-exempt.
- `GAMEPLAY_MANUAL.md` documents every game system in depth — consult it for
  gameplay/mechanics questions.
