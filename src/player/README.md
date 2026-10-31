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
| `wilds.js` | ~600 | `Wilds`: wilderness and minor-POI encounters (`data/innerMap.json` → `encounters`, `poiEncounters`): choices with delve-style odds (attributes, skills, craft rank, gear, companions, traits) and gates, outcomes through existing systems (inventory cap, forage/hunt tables, ailments, Ledger, traits/deeds, lore, maps, reveal, PriceKnowledge, Gossip deeds, Discovery leads); resolved slots per hex on `player.wilds` (saved) |
| `foraging.js` | ~290 | `Foraging` / `Hunting`: every forage and hunt roll for the quick paths and the minigames (seeded, qty ranges, int/luck/combat bonuses), paid in goods via `PlayerInventory.addItem`; craft ranks from `foragingTrips` / `huntingTrips`; wild foods are edible |
| `afterlife.js` | ~430 | `Afterlife`: after death. `begin` starts the interregnum (`player.interregnum`, saved). `passDay(world, estate)` is the world's day with no player (the world systems of ui/game/endDay.js), with the House's children growing up; keep its list in step with endDay. `heirsReady` / `futureHeirs` / `returnAsHeir` handle the line; `candidates(world, reroll)` lists people to become (deterministic, no shared RNG). `becomeStranger` ends the House, `escheat`s its world holdings to crowns and towns, and builds the new Player (it keeps the difficulty and victory goal: `Difficulty.carry`). Tuned in `data/afterlife.json`; UI in `ui/actionMenu/afterlife.js` |
| `scenarios.js` | ~330 | `Scenarios`: the Origins (`data/scenarios.json` → `origins`). `apply(player, world, { origin, difficulty, victory, guidedStart })` runs after House/Titles/Councils setup (`ui/game/gameSetup.js`; hand-made maps use the defaults) and before onboarding. It sets `player.scenario` and shapes the player through the real APIs: the Disinherited (a `blood` claim via `Throne.grantClaim`, Prestige, a feuding elder sibling on `house.rivals`), the Guild Journeyman (`Guilds.join`, then journeyman rank, an indenture as a guild loan, the guild's goods), the Exiled Monarch (a strong claim, `Throne.startCrisis`, soldiers), the Pirate's Widow (a crewed sloop at a port, `Pirates.addInfamy`), the Sellsword Captain (a company, a crown debt through `Finance.migrateLegacyLoans`, `mercRep`). Then it scales gold by the difficulty's `startGold`. The Wanderer changes nothing and draws no RNG. `choices()` lists the options for a picker |
| `seasonalWork.js` | ~210 | `SeasonalWork`: spring planting contracts (paid at harvest, × the town's real harvest — `world/harvests.js`), seasonal odd jobs, winter fur trapping and ice fishing. (The player's farms, orchards and herds follow their region's harvest, soil and rotation in `playerEconomy/property.js` via `Harvests.propertyFactor`.) |
| `fieldBattle.js` | ~560 | `FieldBattle`: the player's own battles in three phases (opening, melee, pursuit) with a stance before each (aggressive, hold the line, feigned retreat, commit reserves), withdraw between phases, casualties from each phase's force ratio, rout; `estimate()` / `preview()` forecast the odds on a private seeded stream. Shares `PlayerMilitary._applyCasualties` / `_battleSpoils` and `attackUnit({ combatResult })`. Tuning: `data/military.json` → `fieldBattle` |
| `roadEncounters.js` | ~650 | `RoadEncounters`: a hostile closes in — `options()` (flee, toll / throw food, parley / fire, hide, fight, each with its odds), `resolve()` (skills trained, gold to the band and the Ledger, renown, deeds, a respite via `unit.sparedUntilDay`), and `ambush()`, the old automatic resolution the headless paths keep. Tuning: `data/military.json` → `encounters` |
| `prison.js` | ~470 | `Prison`: the jail as a loop on `jailState.prison` (created on first look): named cellmates by archetype (smuggler → tools, informant → snitch or the guards' rounds, old soldier → companion on release, fence → guild contact), talk / share food once a day, guard bribes priced by town, sentence and record (look away / tools / lost papers; refusals report you), tunnel progress with tools, labour that counts double, jailbreak once a night (slip / rush / tunnel; escape → Underworld `jailbreak` heat, a Gossip bounty, reputation), `release`/`postBail`/`releaseServed`; `processDay` (from `PlayerActions.endDay`, own seeded stream, only with a prison sub-state). Servitude: `bribeOverseer`, `servitudeWork`, once-a-day escape. `data/underworld.json` → `prison` |
| `crafting.js` | ~330 | `Crafting`: personal crafting at furniture stations — recipes from `data/crafting.json`, crafting rank (`player.crafting.xp`), failure that wastes inputs, quality tiers (Crude → Masterwork) from rank, workshop, tools, attribute and the Forge minigame score; quality of goods held (`player.craftQuality`) scales sale price, nourishment, healing and armour |
| `oddJobs.js` | ~190 | `OddJobs`: day-labour pay by the town's going wage (`world/townLabour.js`) and the harvest, attribute/skill training (`player.attrXp` / `skillXp`), labour that stocks a short-handed town's market, instant board notices (seeded) — all into the Ledger |
| `mercContracts.js` | ~300 | `MercContracts`: mercenary contracts fought against a rolled opposition — ambush/desertion/plunder events on the march, victory by force ratio, casualties, employer reneging, sellsword reputation per realm (`player.mercRep`); tuned in `data/mercenaryContracts.json` |
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
