# Player Actions (`src/player/actions/`)

Contextual action menu builder. Each turn, `PlayerActions.getAvailableActions(player, tile, world)` returns the list of actions the player can take on their current tile.

## Files

| File | Purpose | ~Lines |
|---|---|---|
| `index.js` | `PlayerActions` export — orchestrator, base actions (jail/servitude/rest/bounty), tile context, empty-colony early return | ~190 |
| `settlementActions.js` | Settlement-specific action block — trade, recruit, espionage, ships, housing, social/political, titles, tournaments | ~310 |
| `wildernessActions.js` | Wilderness & anywhere actions — meditate, fish, hunt, forage, build, infrastructure, colonization, cartography, combat | ~260 |

## Action Builder Pattern

`getAvailableActions` in `index.js` pushes to a flat `actions` array using private builder functions:

```js
// Tile context computed once
const ctx = { isCity, isVillage, isPlayerSettlement, playerSettlementCount, playerKingdom, hasPlayerFoundedKingdom };

// Delegated builders
if (isSettlement) addSettlementActions(actions, player, tile, world, ctx);
addWildernessActions(actions, player, tile, world);
```

Empty colonies (player colonies with < 10 population) get a restricted menu and `return` early — wilderness actions are **not** appended.

## Adding a New Action

1. Decide which file it belongs in (settlement only → `settlementActions.js`, anywhere → `wildernessActions.js`, base/gating → `index.js`)
2. Push an action descriptor `{ type, label, icon, description, [disabled] }` in the appropriate place
3. Handle the action type in `src/ui/game.js` `handleAction()` switch

## `endDay(player, world)`

Handles daily processing: jail sentences, indentured servitude, property production, faith income, army upkeep, caravans, research, culture, bounty timers, and title duties. Returns a `results` object consumed by the game UI.

## Barrel Re-export

`src/player/playerActions.js` re-exports `PlayerActions` from this folder so all existing import paths remain unchanged:

```js
export { PlayerActions } from './actions/index.js';
```
