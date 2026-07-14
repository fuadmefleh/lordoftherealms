# src/ui/game/

This folder contains the `Game` class split into focused modules. The class is assembled at runtime by `index.js` using the **mixin pattern** (`Object.assign(Game.prototype, ...)`).

## Files

| File | Lines | Responsibility |
|------|-------|----------------|
| `core.js` | ~180 | Class definition, constructor — sets up canvas, camera, renderer |
| `editorUI.js` | ~415 | `resumeGame`, settings screen, editor overlays, custom world picker |
| `gameSetup.js` | ~503 | Audio controls, title screen, randomize settings, `startNewGame`, `_doStartNewGame` |
| `gameLoop.js` | ~763 | Game loop tick, input handlers, `handleClick`, `handleDoubleClick` |
| `innerMap.js` | ~642 | Enter/exit inner map, inner map UI, Tiled export/import |
| `endDay.js` | ~643 | `onPlayerArrived`, full `endDay` turn processing |
| `combat.js` | ~432 | Food purchase modal, hostile encounters, `_triggerDeath`, end-day confirm |
| `index.js` | ~20 | Assembles all modules → exports `{ Game }` |
| `_gameImports.js` | ~50 | Re-exports all shared dependencies so each file uses a single import line |

## Mixin Pattern

Each method file exports its methods as **named functions** (e.g. `export function resumeGame() { ... }`). The `index.js` gathers them and applies them to `Game.prototype`:

```js
import * as editorUIMethods from './editorUI.js';
Object.assign(Game.prototype, editorUIMethods, ...);
```

Because module loading is synchronous, all methods exist on `Game.prototype` before any `new Game()` call — so the constructor can call `this.initTitleScreen()` etc. safely.

## Entry Point

The original `src/ui/game.js` is now a 2-line barrel:

```js
export { Game } from './game/index.js';
```

All existing consumers of `import { Game } from './game.js'` continue to work unchanged.
