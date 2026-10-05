# systems/

World simulation systems. Each system manages a distinct aspect of the game world and is called by the main game loop each day.

## Files

| File | Lines | Description |
|------|-------|-------------|
| `ailments.js` | ~1140 | Wounds, sickness and medicine: wounds from fights/delves (attribute, skill, movement and battle-power penalties, healing time, infection, permanent Scarred/Lame traits), staged diseases from exposure, raw food, swamps, plague, the lean season and long voyages; contagion to companions and ship crews; physicians, temple rites, remedies, prayer (`data/ailments.json`); `processDay(world, player, ctx)` reports death, the UI triggers it |
| `achievements.js` | ~197 | 30+ achievements; checked after player actions |
| `audio/` | ~1100 | Procedural Web Audio API music & SFX — no external files |
| `bountyHunting.js` | ~305 | Criminal tracking, bounty boards, capture mechanics |
| `cartography/` | ~950 | Map making, map trading, propaganda maps, stolen maps |
| `companions.js` | ~1050 | Travel companions with values & approval (react to deeds, rulings, piracy, karma, battles, wages), mood-scaled bonuses, raise demands/desertion/betrayal, personal quests (`data/companions.json`), bonds, death in battle |
| `councils.js` | ~412 | Parliament voting — taxes, war declarations, faction management |
| `culture.js` | — | Cultural spread, assimilation, hybrid traditions |
| `delves.js` | ~880 | Delves into ruins and caves: 3–6 chambers per kind (sunken/tomb/ruins/mine/cave) from `data/delves.json`, choices tested by stats/skills/gear/companions/traits, depth-scaled loot through the inventory cap, fragments, lore, injuries, a cursed idol and awakened guardians; `processDay(world, player)` |
| `discovery.js` | ~1270 | Uncharted lands: remote islands, hidden coves, lost valleys and sunken reefs picked lazily from the generated map by a seed hash (no RNG, no world-gen change); found at sea (sightings from `processDay`, expeditions that end in open sea via `startExpedition`), by `exploreOcean` (wraps Ships'), on foot, from tavern rumours (`tavernRumors`) and ancient/treasure maps (`chartFromMap`, from `Cartography.applyMap`), or first by rivals; naming (renown, Prestige, House chronicle), exotic goods (`data/discovery.json` → goods, merged into GOODS, stocked by no market), natives, ruins (delve sites), hazards, archive sales, colonies and naval contests; state on `player.discovery`; `processDay(world, player)` |
| `espionage.js` | — | Spy networks, sabotage, counterintelligence |
| `festivals.js` | — | Festival hosting, contests, diplomatic events |
| `gossip.js` | — | Settlement gossip propagation |
| `heirs.js` | ~190 | Placing grown children: alliance marriages, royal matches (claim via `Throne.grantClaim`) and wardships at a ruler's court (`data/upbringing.json` placements) |
| `holdings.js` | ~1170 | Holdings development: building projects in the player's settlements (slots by population tier, `data/holdings.json`), cached as `settlement.holding.fx` and read by Taxation, Economy, PlayerMilitary, RealmWars, Ships, Colonization and Petitions; governors (companion/family/steward, loyalty and skim), garrisons, unrest, rebellion and bandit raids; `processDay(player, world)` |
| `housing.js` | — | Player-owned houses, upgrades, condition decay |
| `infrastructure.js` | — | Roads, bridges, improvements, travel bonuses |
| `legacy.js` | ~300 | The House Chronicle: one record per reign (years, traits, titles, crowns, battles, wars, delves, rivals bested, petitions, highlights) measured as deltas of existing counters; epitaph + legacy score when the line ends |
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
| `sagas.js` | ~1360 | Sagas: world storylines in 3–5 chapters (`data/sagas.json`: the wyrm, the Grey Cough, the Lost Heir, the Long Winter, Sea Reavers, the Sundering Faith, the Iron Company, the Comet) staged on existing systems (timed events, plague/famine, saga world units, delve sites, heresies, throne crises, petitions via `Petitions.spawnCustom`, quests, rivals); chapters turn on time, flags and player actions, ignored sagas resolve themselves; first starts day 60–120 by a seed hash (no RNG before), at most two at once; tavern rumours, journal actions, end-of-day notices; `processDay(world, player)` |
| `saveLoad.js` | ~650 | Game state serialization / deserialization (save & load) |
| `sieges.js` | ~950 | Sieges as operations: investing a settlement (garrison, walls with integrity, food stores by size/season/granaries, morale), a daily tick for both sides (stores, starvation, town disease; camp forage + packs, camp disease via `Ailments`, boredom, desertion), stances (blockade / siege works: ram, tower, trebuchet gated by tech / sapping), storm via `PlayerMilitary.combat` + `conquerSettlement`, sack, terms (surrender, ransom, tribute) weighed by traits and court reputation, relief hosts out of the realm's army, naval blockades of ports, civil-war towns declaring for the pretender (`data/military.json` → `sieges`); `processDay(world, player)` draws nothing without a siege |
| `ships.js` | ~1700 | Ship building, crews (hire/wages/morale), naval combat, war-galley escorts, exploration, trade, port markets on the land price scale (sale caps against asks on the tile and next door, `nearbyAsks`), blockaded port markets, interception by hostile royal fleets |
| `shipVoyages.js` | ~730 | Mixed into `Ships`: provisions (crews eat from the hold away from port; hunger, then scurvy, then desertion), voyages that take real days along a BFS sea route (`startVoyage`, `_voyageDay` from `processDaily`, `heaveTo`), the voyage log, and data-driven events at sea with choices (`data/ships.json` → `voyageEvents`, `resolveVoyageEvent`) |
| `technology/` | ~1200 | Research tree, labs, parts crafting, tech bonuses |
| `tiledExport.js` | — | Export maps to Tiled-compatible format |
| `throne.js` | ~1400 | Claims & Crowns: claims on thrones (royal marriage, forgery, office, conquest, heralds), succession crises, civil wars to press a claim, ruling a realm (levy, policies via `kingdom.crown`, diplomacy), founding a kingdom (`data/throne.json`) |
| `titles.js` | ~620 | Nobility titles, duties, rank requirements |
| `traits.js` | ~430 | Earned character traits: deed counters → traits (data/traits.json), opposites, erosion, effects, dynasty echo on succession |
| `upbringing.js` | ~560 | Raising heirs (ages 6–16): education focus, court/companion tutors, data-driven childhood dilemmas, trait seeds from focus/tutor/events/parent → adult traits at 16 (`Traits.grantTraits` on succession), ward returns; `processDay(player, world)` |
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
