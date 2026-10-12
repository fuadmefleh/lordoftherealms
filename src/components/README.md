# components/

React UI components. These are pure display/interaction shells — they read from `GameContext` and dispatch actions; they do not contain game logic.

## Files

| File | Description |
|------|-------------|
| `EditorOverlay.jsx` | Full-screen iframe wrapper for the world editor and modding tools |
| `GameView.jsx` | Main game canvas container; mounts and starts the game loop |
| `LoadingOverlay.jsx` | Loading spinner shown during world generation |
| `SettingsScreen.jsx` | New game setup: character creation, world seed, difficulty |
| `TitleScreen.jsx` | Title screen with New Game / Load Game / Editor buttons |
| `Icon.jsx` | `<Icon name="…" />` — one engraved glyph from `ui/icons.js`, used across the HUD chrome |
| `TitleBackdrop.jsx` | Canvas for `ui/titleBackdrop.js`; mounted once by `App` across title → settings → loading so the flight never cuts |
| `TopBar.jsx` | In-game top bar: player stats, turn info, quick-access buttons |

## Notes

- All components use `useGame()` from `context/GameContext.jsx` for state access.
- Canvas rendering happens in `ui/` — these components only provide the DOM shells that house the canvases.
- `GameView.jsx` is responsible for creating the `Game` instance (from `ui/game.js`) and calling `game.init()` once the canvas is mounted.
