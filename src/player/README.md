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
| `afterlife.js` | ~800 | `Afterlife`: after death. `begin` starts the interregnum (`player.interregnum`, saved). `passDay(world, estate)` is the world's day with no player (the world systems of ui/game/endDay.js), with the House's children growing up; keep its list in step with endDay. `heirsReady` / `futureHeirs` / `returnAsHeir` handle the line; `candidates(world, reroll)` lists people to become (deterministic, no shared RNG); `townChoices(world)` lists every living settlement (at the dawn, its villages and wandering clans) by realm with size, culture and tongue, and `candidatesAt(world, at, reroll)` offers people of the one chosen: its own grown townsfolk first (`Townsfolk.seed` gives a never-visited town its roster), then locals named for its culture, and a newcomer from another town with a mother tongue of their own (`newcomer` in the data); at the dawn, children born into that clan or village. `becomeStranger` ends the House, `escheat`s its world holdings to crowns and towns, and builds the new Player at the candidate's town with a mother tongue (`Languages.initialize`; a local also knows their realm), refusing a town that is no more (it keeps the difficulty and victory goal: `Difficulty.carry`). Tuned in `data/afterlife.json`; UI in `ui/actionMenu/afterlife.js` |
| `scenarios.js` | ~330 | `Scenarios`: the Origins (`data/scenarios.json` → `origins`). `apply(player, world, { origin, difficulty, victory, guidedStart })` runs after House/Titles/Councils setup (`ui/game/gameSetup.js`; hand-made maps use the defaults) and before onboarding. It sets `player.scenario` and shapes the player through the real APIs: the Disinherited (a `blood` claim via `Throne.grantClaim`, Prestige, a feuding elder sibling on `house.rivals`), the Guild Journeyman (`Guilds.join`, then journeyman rank, an indenture as a guild loan, the guild's goods), the Exiled Monarch (a strong claim, `Throne.startCrisis`, soldiers), the Pirate's Widow (a crewed sloop at a port, `Pirates.addInfamy`), the Sellsword Captain (a company, a crown debt through `Finance.migrateLegacyLoans`, `mercRep`). Then it scales gold by the difficulty's `startGold`. The Wanderer changes nothing and draws no RNG. `choices()` lists the options for a picker |
| `causes.js` | ~430 | `Causes`: the read-only "Why?" explainer. `price(world, settlement, good, player)` splits the market's asking price into the engine's own steps (`Economy.marketAskBase`'s `parts` collector: size, fair, cold, resource, season, events, monopoly, coinage, fashion) and the stock's scarcity or a guild floor, each with its `mult` and a gold `delta` (log-share, so base + Σ delta + rest + rounding = the listed price); `drivers` behind the stock (harvest, dearth, roads cut, export bans, duties, embargoes, lost caravans, strikes, fashions, the player's own trading this season) and `you` (what the player pays and is paid after their standing, guild, duty, difficulty, quality). `lordOpinion(world, lordOrKingdom, player)` mirrors `NPCLords.getLordOpinion` part by part (each remembered deed shown) plus trait/underworld standing and reputation; `stability(kingdom, world)` (`KingdomStability.target`'s parts); `tax(world, player, settlement)` (`Taxation.collectTaxes`'s weekly take and the mood target). Draws no RNG, writes nothing; held to the engine's numbers by `__tests__/causes.test.js`. UI: `ui/whyPopover.js` |
| `seasonalWork.js` | ~210 | `SeasonalWork`: spring planting contracts (paid at harvest, × the town's real harvest — `world/harvests.js`), seasonal odd jobs, winter fur trapping and ice fishing. (The player's farms, orchards and herds follow their region's harvest, soil and rotation in `playerEconomy/property.js` via `Harvests.propertyFactor`.) |
| `fieldBattle.js` | ~560 | `FieldBattle`: the player's own battles in three phases (opening, melee, pursuit) with a stance before each (aggressive, hold the line, feigned retreat, commit reserves), withdraw between phases, casualties from each phase's force ratio, rout; `estimate()` / `preview()` forecast the odds on a private seeded stream. Shares `PlayerMilitary._applyCasualties` / `_battleSpoils` and `attackUnit({ combatResult })`. Tuning: `data/military.json` → `fieldBattle` |
| `coastalRaids.js` | ~250 | `CoastalRaids`: raids from the sea — troops landed from the ships' boats (`troopsPerShip` a ship a day, strongest first; galleys bombard) on a coastal town or village (`targets`, `quote`, `raid(player, world, q, r, 'plunder' \| 'burn')`). An unready town turns out a share of its garrison; a realm whose coast is on alarm (`systems/landings.js`) a larger one. Plunder: gold and the best market stores to the hold (a boat-load per ship); burn: stores and granary torched. Karma, reputation, traits, lord memory, House feud, sea infamy; the realm's coast raised on alarm. Combat via `PlayerMilitary.combat` with the army cut to the landing party, on its own seeded stream. Tuning: `Landings.config().raid` |
| `roadEncounters.js` | ~650 | `RoadEncounters`: a hostile closes in — `options()` (flee, toll / throw food, parley / fire, hide, fight, each with its odds), `resolve()` (skills trained, gold to the band and the Ledger, renown, deeds, a respite via `unit.sparedUntilDay`), and `ambush()`, the old automatic resolution the headless paths keep. Tuning: `data/military.json` → `encounters` |
| `prison.js` | ~470 | `Prison`: the jail as a loop on `jailState.prison` (created on first look): named cellmates by archetype (smuggler → tools, informant → snitch or the guards' rounds, old soldier → companion on release, fence → guild contact), talk / share food once a day, guard bribes priced by town, sentence and record (look away / tools / lost papers; refusals report you), tunnel progress with tools, labour that counts double, jailbreak once a night (slip / rush / tunnel; escape → Underworld `jailbreak` heat, a Gossip bounty, reputation), `release`/`postBail`/`releaseServed`; `processDay` (from `PlayerActions.endDay`, own seeded stream, only with a prison sub-state). Servitude: `bribeOverseer`, `servitudeWork`, once-a-day escape. `data/underworld.json` → `prison` |
| `crafting.js` | ~440 | `Crafting`: personal crafting at furniture stations — recipes from `data/crafting.json`, each in a craft skill (`skillOf`: smithing, carpentry, tailoring, leatherwork, cooking, brewing, alchemy, jewellery, pottery — `data/craftGrades.json`; levels 0–10 on `player.skills`, trained by crafting xp through `OddJobs.gainXp`, old saves seeded once from the old rank), the overall crafting rank (`player.crafting.xp`), failure that wastes inputs, and the grade of the work (Poor → Masterwork, `core/grades.js`) rolled on the seeded RNG from the skill, workshop, tools (`toolsFor`: steel tools help more, a tool's grade scales its help and its wear), the inputs' grade, attribute, difficulty and the Forge minigame score (`odds` gives the odds of each grade). Graded goods held (`player.craftGrades`) set sale price (`saleMult`, `takeForSale`), nourishment and healing (`consume`, the best first), armour and blades (`effectMult`: the best held) |
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
