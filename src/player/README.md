# player/

Everything controlled by or owned by the player character. This is the player's domain — state, economy, military, actions, and personal systems.

## Subfolders & Files

| Path | Lines | Description |
|------|-------|-------------|
| `core/` | ~1175 | Core `Player` class: state, attributes, movement, needs, visibility |
| `actions/` | ~1065 | Contextual action builder — what the player can do on any given tile |
| `economy/` | ~2206 | Properties, crafting, trade routes, caravans, auctions |
| `military/` | ~1498 | Army recruitment, formation combat, sieges, mercenaries |
| `tavern/` | ~2017 | Intelligence gathering, rumors, informants, Sims-style needs |
| `playerReligion.js` | 379 | Found a religion, build holy sites, perform miracles |
| `inventory.js` | — | Carrying capacity (`maxInventory` slots) and the `addItem` gain path |
| `index.js` | — | Barrel re-export of all public player APIs |

## Key Objects

```js
// The player instance (single object per game)
const player = new Player(profile);

// Player state shape (key fields):
{
  q, r,                    // world-map hex position
  gold, karma, renown,
  health, stamina, actionPoints,
  strength, charisma, intelligence, faith, luck,
  skills: { commerce, combat, leadership, diplomacy, stealth, cartography },
  needs: { hunger, energy, social, fun, hygiene, comfort },  // 0–100
  army, properties, caravans, tradeRoutes, ships,
  relationships, spouse, children, dynasty, heir,
  allegiance, kingdomTitle,
}
```

## Integration Points

- **Depends on**: `core/hex.js`, `core/utils.js`, `systems/technology.js`, `systems/religion.js`, `systems/infrastructure.js`, `systems/titles.js`
- **Used by**: `ui/game.js` (action dispatch), `context/GameContext.jsx` (state access), `systems/saveLoad.js` (serialization)

## Notes

- The `Player` class is a plain object with methods — no React state. All mutations go through methods or `PlayerActions`.
- `PlayerActions.getAvailableActions(player, tile, world)` is the single entry point for the contextual action menu. It returns a flat array of action descriptors.
- `PlayerEconomy`, `PlayerMilitary`, and `PlayerReligion` are plain objects (not classes) mixed into the game via direct calls: `PlayerEconomy.purchaseProperty(player, ...)`.
