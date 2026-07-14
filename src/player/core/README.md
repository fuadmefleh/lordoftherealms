# player/core/

Core `Player` class definition split across logical files and assembled via prototype mixins.

## Files

| File | Description |
|------|-------------|
| `state.js` | `Player` class with constructor (all initial state) and `placeInWorld()` |
| `movement.js` | Movement methods: `moveTo`, `stepAlongPath`, `revealArea`, `getReachableHexes`, etc. |
| `needs.js` | Sims-style needs system: `decayNeedsPerHour`, `getMood`, `modifyNeed`, `restOvernight` |
| `lifecycle.js` | Daily turn: `endDay`, food consumption, kingdom allegiance, world discovery |
| `index.js` | Assembles the class by `Object.assign`-ing all method groups onto `Player.prototype` |

## How the mixin pattern works

```js
// index.js applies all method groups to the prototype at module load time:
Object.assign(Player.prototype, PlayerMovementMethods, PlayerNeedsMethods, PlayerLifecycleMethods);

// External code still calls methods naturally:
player.moveTo(q, r, world);
player.endDay();
player.getMood();
```

Each mixin file exports a plain object of methods. Methods use `this` to access player state — they behave exactly like class methods because they are assigned to the prototype.

## Import path

```js
import { Player } from '../player/core/index.js';
// or from the player barrel:
import { Player } from '../player/index.js';
```

## Notes

- `state.js` does **not** import from `systems/` — the constructor has zero dependencies.
- `lifecycle.js` imports `Technology` and `Religion` for `endDay()` bonuses and `discoverNearbyHolySites()`.
- `movement.js` imports `Infrastructure` and `Titles` for movement cost and title hooks.
- Needs are currently **disabled** (`decayNeedsPerHour` returns early). The system code is preserved but inactive.
