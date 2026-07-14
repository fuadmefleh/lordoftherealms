# context/

React Context providing global game state to all components.

## Files

| File | Description |
|------|-------------|
| `GameContext.jsx` | Single context providing `gameState`, `setPhase`, `updatePlayerStats`, `updateTurn`, and `gameRef` |

## Usage

```jsx
import { useGame } from '../context/GameContext';

function MyComponent() {
  const { gameState, setPhase, gameRef } = useGame();
  // gameRef.current is the live Game instance (ui/game.js)
}
```

## State Shape

```js
{
  phase: 'title' | 'settings' | 'loading' | 'playing' | 'editor' | 'worldEditor',
  initialized: boolean,
  turn: { day, season, year },
  playerStats: { gold, karma, renown, movement, actions, food, hp },
}
```

## Notes

- `gameRef.current` holds the imperative `Game` object from `ui/game.js`. React components should call methods on it (e.g., `gameRef.current.endDay()`) rather than mutating game state directly.
- `playerStats` in context is a lightweight display copy. The canonical player state lives in `player/core/` — it is synced to context each frame by `ui/game.js`.
