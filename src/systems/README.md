# systems/

World simulation systems. Each system manages a distinct aspect of the game world and is called by the main game loop each day.

## Files

| File | Lines | Description |
|------|-------|-------------|
| `achievements.js` | ~197 | 30+ achievements; checked after player actions |
| `audio/` | ~1100 | Procedural Web Audio API music & SFX — no external files |
| `bountyHunting.js` | ~305 | Criminal tracking, bounty boards, capture mechanics |
| `cartography/` | ~950 | Map making, map trading, propaganda maps, stolen maps |
| `companions.js` | ~1050 | Travel companions with values & approval (react to deeds, rulings, piracy, karma, battles, wages), mood-scaled bonuses, raise demands/desertion/betrayal, personal quests (`data/companions.json`), bonds, death in battle |
| `councils.js` | ~412 | Parliament voting — taxes, war declarations, faction management |
| `culture.js` | — | Cultural spread, assimilation, hybrid traditions |
| `delves.js` | ~880 | Delves into ruins and caves: 3–6 chambers per kind (sunken/tomb/ruins/mine/cave) from `data/delves.json`, choices tested by stats/skills/gear/companions/traits, depth-scaled loot through the inventory cap, fragments, lore, injuries, a cursed idol and awakened guardians; `processDay(world, player)` |
| `espionage.js` | — | Spy networks, sabotage, counterintelligence |
| `festivals.js` | — | Festival hosting, contests, diplomatic events |
| `gossip.js` | — | Settlement gossip propagation |
| `housing.js` | — | Player-owned houses, upgrades, condition decay |
| `infrastructure.js` | — | Roads, bridges, improvements, travel bonuses |
| `legendaryArtifacts.js` | — | Artifact discovery and recovery quests |
| `marketDynamics.js` | — | Supply/demand shifts, price volatility |
| `modStore.js` | — | Mod loading and custom asset injection |
| `npcFamily/` | ~1280 | Inner-map NPC families, bonds, social ripple effects |
| `npcDisposition.js` | ~360 | What inner-map NPC disposition does: prices, threats, secrets, family grudges |
| `petitions.js` | ~600 | Court petitions: data-driven dilemmas (`data/petitions.json`) at the player's holdings; chained follow-ups, expiry costs, court reputation |
| `peoples/` | ~1900 | 30 tribal cultures, settlement demographics, cultural history; `effects.js` turns values/traits/arts/cuisine/customs/homeland/lore into settlement & kingdom modifiers (tables in `data/peoples.json` → `effects`) |
| `quests.js` | ~650 | Dynamic quest generation, tracking, rewards |
| `relationships/` | ~1700 | Courtship, marriage, children, dynasty, heir succession |
| `religion.js` | ~750 | World religions, holy sites, heresies, pilgrimages |
| `rivals.js` | ~1350 | Rival adventurers: 6–9 named NPCs (`data/rivals.json`) created lazily on the first daily tick, who travel abstractly and delve sites first (full or partial loot read by `delves.js`), claim your bounties, take quest offers, enter your contests, back throne claimants; attitude/memory toward the player, duels (via `PlayerEffects`), team-ups, hires, races, sabotage, nemesis ambushes and slander (Gossip), deaths and newcomers; Hall of Heroes leaderboard + news; `processDay(world, player)` |
| `saveLoad.js` | ~650 | Game state serialization / deserialization (save & load) |
| `ships.js` | ~1650 | Ship building, crews (hire/wages/morale), naval combat, war-galley escorts, exploration, trade, blockaded port markets, interception by hostile royal fleets |
| `technology/` | ~1200 | Research tree, labs, parts crafting, tech bonuses |
| `tiledExport.js` | — | Export maps to Tiled-compatible format |
| `throne.js` | ~1400 | Claims & Crowns: claims on thrones (royal marriage, forgery, office, conquest, heralds), succession crises, civil wars to press a claim, ruling a realm (levy, policies via `kingdom.crown`, diplomacy), founding a kingdom (`data/throne.json`) |
| `titles.js` | ~620 | Nobility titles, duties, rank requirements |
| `traits.js` | ~430 | Earned character traits: deed counters → traits (data/traits.json), opposites, erosion, effects, dynasty echo on succession |
| `underworld.js` | ~1180 | The Underworld: per-kingdom heat (guard searches, wanted posters/warrants via Gossip), the Thieves' Guild (ranks, jobs, heists, rackets, Guildmaster's cut), contraband by culture/faith (`data/underworld.json`), black market, hot goods and fences |

## Turn Processing

Each system that ticks daily exposes a function called by `ui/game.js`:

```js
// Called once per game day
Religion.processDay(world, player);
Relationships.processDay(player, world);
Technology.processDay(player);
// etc.
```

## Integration Points

- **Depends on**: `core/`, `world/` (read-only access to tiles/kingdoms/settlements)
- **Used by**: `player/` (player path systems), `ui/game.js` (turn loop)

## Notes

- Systems never directly mutate `world.tiles` — they call world-layer functions or emit events.
- `saveLoad.js` serializes the entire game by reading from all system singletons. Any new system state must be registered there.
- Audio is entirely procedural — the `AudioManager` singleton in `audio/` generates sound via oscillators. No `<audio>` elements or external files are used.
