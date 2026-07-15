# Systems Reference — Developer Docs

Implementation-level references for every system in **Lord of the Realms** —
what the code does, where it lives, and how to extend it. This is the
*developer* counterpart to the player-facing
[`GAMEPLAY_MANUAL.md`](../../GAMEPLAY_MANUAL.md).

## How to read these

- Each system doc follows the same **8-section template**: Overview · Code map ·
  Data files · State shape · Lifecycle · Key rules & formulas · Interactions ·
  Extension points.
- Docs are **concept-first** (organized by gameplay system) but every one links
  back to the actual `src/**` modules and `data/*.json` files that implement it.
- For the folder-level "what file does what" view, see the per-layer
  [`src/**/README.md`](../../src/README.md) files. For the architecture rules
  every system obeys (no domain globals, seedable RNG), see
  [`docs/architecture-globals.md`](../architecture-globals.md).

## Extension recipes

Task-oriented "how do I add X" guides live in
[`docs/extending/`](../extending/):

- [Add a building / property type](../extending/add-a-building.md)
- [Add a technology](../extending/add-a-technology.md)
- [Add a world event](../extending/add-a-world-event.md)

## Catalog

Status: ✅ written · ⬜ planned (rolling out against the same template).

### Economy & production

| System | Status | Primary data | Doc |
|--------|--------|--------------|-----|
| Economy & Trade | ✅ | `economy.json`, `market.json`, `playerEconomy.json` | [economy.md](economy.md) |
| Properties & Production | ⬜ | `buildings.json`, `earlyJobs.json` | _planned_ |
| Crafting | ⬜ | `economy.json` | _planned_ |
| Caravans & Trade Routes | ⬜ | `economy.json`, `market.json` | _planned_ |
| Housing | ⬜ | `housing.json` | _planned_ |

### Military & conflict

| System | Status | Primary data | Doc |
|--------|--------|--------------|-----|
| Military & Combat | ✅ | `units.json`, `military.json` | [military.md](military.md) |
| Mercenary Contracts | ⬜ | `military.json` | _planned_ |
| Espionage | ✅ | `espionage.json`, `tavern.json`, `gossip.json` | [espionage.md](espionage.md) |
| Ships & Naval | ⬜ | `ships.json` | _planned_ |

### Faith, knowledge, infrastructure

| System | Status | Primary data | Doc |
|--------|--------|--------------|-----|
| Religion & Faith | ⬜ | `religion.json` | _planned_ |
| Technology & Research | ⬜ | `technology.json` | _planned_ |
| Infrastructure | ⬜ | `infrastructure.json` | _planned_ |

### Politics & people

| System | Status | Primary data | Doc |
|--------|--------|--------------|-----|
| Kingdoms & Diplomacy | ⬜ | `kingdoms.json`, `kingdomAI.json`, `npcLords.json` | _planned_ |
| Titles & Royal Office | ⬜ | `titles.json` | _planned_ |
| Relationships & Dynasty | ⬜ | `relationships.json`, `characters.json` | _planned_ |
| Culture | ⬜ | `culture.json`, `peoples.json` | _planned_ |
| Colonization | ⬜ | `colonization.json` | _planned_ |
| Tavern & Intelligence | ⬜ | `tavern.json`, `gossip.json` | _planned_ |

### World & progression

| System | Status | Primary data | Doc |
|--------|--------|--------------|-----|
| Movement & Exploration | ⬜ | `terrain.json` | _planned_ |
| Quests | ⬜ | `quests.json` | _planned_ |
| Achievements | ⬜ | `achievements.json` | _planned_ |
| World Events | ⬜ | `worldEvents.json` | _planned_ |
| Cartography | ⬜ | `cartography.json` | _planned_ |
| Legendary Artifacts | ⬜ | `artifacts.json` | _planned_ |

### Cross-cutting (engine)

| Topic | Status | Notes | Doc |
|-------|--------|-------|-----|
| Game loop & turn flow | ⬜ | `src/ui/game/` — how a day advances end-to-end | _planned_ |
| Saving & Loading | ⬜ | `src/systems/saveLoad` | _planned_ |
| Data pipeline | ⬜ | `scripts/build-gamedata.js` → `data/gamedata.json` via `DataLoader` | _planned_ |
