# Espionage

> Developer reference. Player-facing rules live in
> [`GAMEPLAY_MANUAL.md` §14](../../GAMEPLAY_MANUAL.md). For the architecture
> rules referenced below (no domain globals, seedable RNG), see
> [`docs/architecture-globals.md`](../architecture-globals.md).

## 1. Overview

Espionage lets the player build and run a shadow network of spies against rival
kingdoms. In code it is a plain-object singleton (`Espionage`) assembled by
`Object.assign` from split module files onto a shared `_ref.js` object. It owns a
spy roster and an active-mission queue stored on `player.espionage`, gated behind
researching the `espionage` technology. Each in-game day the game loop calls
`Espionage.processDaily(player, world)` to pay upkeep, decay loyalty, advance
mission progress, resolve completed missions, tick rebellions, and expire
fog-of-war reveals. Mission resolution is a probabilistic roll (`Utils.random()`)
that mutates target-kingdom state (treasury, military, territory, ruler) and
player state (gold, tech, renown, karma, revealed tiles, rumors). All tuning
constants come from `data/espionage.json`.

## 2. Code map

| File | Role |
|------|------|
| `src/systems/espionage.js` | Barrel — `export { Espionage } from './espionage/index.js'`. |
| `src/systems/espionage/index.js` | Assembles the domain: imports `_ref`, `spies.js`, `missions.js`; re-exports `Espionage`. |
| `src/systems/espionage/_ref.js` | Declares the shared empty `Espionage = {}` singleton both member files augment. |
| `src/systems/espionage/_imports.js` | Centralized re-exports of cross-domain deps (`DataLoader`, `Utils`, `Technology`, `Hex`, `Tavern`, `Characters`). |
| `src/systems/espionage/spies.js` | `CONFIG` defaults, data-access helpers, `initPlayer`, `hasEspionageTech`, spy generation/recruitment, mission assignment/recall. |
| `src/systems/espionage/missions.js` | Daily processing, the resolution engine, per-mission resolvers, consequences, save/load, summary helpers. |
| `src/core/dataLoader.js` (419–431) | Loads `espionage.json` into `DataLoader.espionage` and mirrors config/tables onto the `Espionage` object. |
| `src/ui/actionMenu/titlesEspionage.js` | The espionage UI — `showEspionageMenu`, recruit/manage/mission/target panels. |
| `src/player/actions/settlementActions.js` (100–121) | Exposes the `espionage_menu` (cities only) and `manage_spies` (anywhere) actions, gated by `hasEspionageTech`. |
| `src/ui/game/endDay.js` (122–123, 311–340) | Turn-loop hooks: `applySpyVision` after visibility reset, `processDaily` + `prepareForSave` at end-of-day. |
| `src/systems/saveLoad.js` (257–258, 378–379) | Persists `player.espionage` and calls `Espionage.loadState`. |

> **Barrel convention:** import `Espionage` from `@systems` / `src/systems`, not
> from the split files under `espionage/`.

## 3. Data files

Primary: **`data/espionage.json`**. Key sections:

- **`config`** — global tuning: `maxSpies` (8), `baseRecruitCost` (300),
  `baseUpkeep` (15), `maxActiveMissions` (5), `spyCaptureBaseChance` (0.08),
  `loyaltyDecayPerDay` (0.1), `loyaltyMinBeforeBetrayal` (20),
  `experiencePerMission` (50), `levelUpThreshold` (150), `maxSpyLevel` (5),
  `requiredTech` (`"espionage"`), `fogRevealRadius` (4), `fogRevealDuration` (30).
- **`spyNames`** — male/female/surname pools for name generation.
- **`spySkills`** — the four skills: `infiltration`, `sabotage`, `gathering`,
  `combat` (display metadata only).
- **`spyTraits`** — 10 traits, each an `id` + `effect` object (skill bonuses plus
  modifiers like `captureResist`, `recruitCostReduction`, `upkeepReduction`,
  `loyaltyBonus`/`loyaltyPenalty`, `betrayalRisk`, `assassinBonus`,
  `techStealBonus`).
- **`missions`** — 7 types: `gather_intel`, `steal_technology`,
  `incite_rebellion`, `infiltrate_territory`, `sabotage`, `counter_espionage`,
  `assassinate`. Each has `primarySkill`, `baseDuration`, `baseDifficulty`,
  `goldCost`, `apCost`, `rewards`, `captureChance`, `failChance`,
  `requiredLevel`, and optional `effects`/`consequences`.
- **`missionOutcomes`** — 5 tiers (`criticalSuccess`, `success`,
  `partialSuccess`, `failure`, `captured`), each with `experienceMultiplier` and
  `bonusRewards`.
- **`levelTitles`** — level 1–5 titles/icons (Novice Agent → Spymaster Elite).
- **`rebellionEffects`** — `small`/`medium`/`large` severities with
  `treasuryLoss`, `militaryLoss`, `territoryLoss`, `duration`.

**Linked data:** `tavern.json`/`gossip.json` drive the rumor objects produced by
`gather_intel`; `technology.json` defines the `espionage` tech (900 gold + 10
iron, 18 days) and the pool `steal_technology` draws from; `titles.json` /
`characters.json` define the `spymaster` title that grants a success bonus.

## 4. State shape

All persistent state lives under **`player.espionage`** (created by `initPlayer`,
`spies.js:112`):

- **`spies`** — array. Each spy: `id`, `name`, `gender`, `skills`
  `{infiltration, sabotage, gathering, combat}`, `traits` (trait-id array),
  `loyalty`, `status` (`idle`/`on_mission`/`captured`/`dead`/`deserted`),
  `currentMission` (id or null), `recruitDay`, `location` `{q,r}`,
  `missionsCompleted`, `experience`, `level`, `upkeep`, `recruitCost`.
- **`activeMissions`** — array: `id`, `spyId`, `type`, `targetKingdom`,
  `startDay`, `duration`, `progress`, `difficulty`, `captureChance`.
- **`completedMissions`**, **`totalSpiesRecruited`** — counters.
- **`revealedTiles`** — `{ q, r, expiresDay }[]` for spy fog-of-war lifting.
- **`rebellions`** — `{ kingdomId, severity, startDay, duration, daysRemaining }[]`.
- **`_nextSpyId`** — persisted id counter (mirrors module-level `Espionage._nextSpyId`).

**Written on `player` (outside `espionage`):** `gold`, `renown`, `karma`,
`reputation[kingdomId]`, `technology.researched`,
`technology.currentResearch.progress`. **Reads:** `player.intelligence`,
`player.currentTitle`, `player.allegiance`, `player.q`/`player.r`, and calls
`player.learnAboutKingdom(...)`.

**Written on `world`/kingdoms:** per-tile `tile.explored`/`tile.visible`/
`tile.kingdom`; per-kingdom `kingdom.treasury`, `kingdom.military`,
`kingdom.territory` (tiles spliced out), `kingdom.ruler`/`kingdom.characterData`
(assassination succession), `kingdom.relations[player.allegiance]`. **Reads:**
`world.day`, `world.kingdoms`, `world.getTile`, `world.getKingdom`.

## 5. Lifecycle

**Initialization**

- `Espionage.initPlayer(player)` — `spies.js:112`. Lazily creates/backfills
  `player.espionage`; called defensively at the top of nearly every public
  method.
- `DataLoader` load path (`dataLoader.js:419-431`) merges `espionage.json` into
  `Espionage.CONFIG`/tables at game-data load.
- `Espionage.hasEspionageTech(player)` — `spies.js:131`. Gate checking
  `Technology.getTechStatus(player, 'espionage')` is `researched`/`implemented`.
- `Espionage.loadState(player)` — `missions.js:716`. On load restores
  `_nextSpyId` (or recomputes from the max existing spy id).

**Per-turn advance** (all in `endDay.js`, the end-of-day handler):

- `Espionage.applySpyVision(player, world)` — `endDay.js:123`
  (`missions.js:115`): re-applies persistent revealed tiles after the normal
  visibility reset.
- `Espionage.processDaily(player, world)` — `endDay.js:312` (`missions.js:13`):
  pays upkeep, applies `loyaltyDecayPerDay`, runs desertion/betrayal checks,
  increments each mission's `progress` and resolves via `_resolveMission` when
  `progress >= duration`, ticks rebellions (`_applyRebellionDailyEffect`), and
  prunes expired `revealedTiles`. Returns a results object the UI turns into
  notifications.
- `Espionage.prepareForSave(player)` — `endDay.js:339` (`missions.js:710`):
  writes `_nextSpyId` back onto state.

## 6. Key rules & formulas

**Assignment** (`assignMission`, `spies.js:341-394`)

- Effective difficulty:
  `clamp(baseDifficulty − skillModifier − levelModifier, 0.05, 0.95)`, where
  `skillModifier = (primarySkill − 5) * 0.05` (`spies.js:369`) and
  `levelModifier = (level − 1) * 0.05` (`spies.js:370`).
- Duration: `max(3, baseDuration − floor(primarySkill * 0.3))` (`spies.js:374`).
- Guards: max active missions (`:356`), gold cost (`:360`), spy must be `idle`
  and meet `requiredLevel` (`:350-353`).

**Resolution** (`_resolveMission`, `missions.js:136-228`)

- `baseSuccess = 1 − mission.difficulty` (`:142`).
- `successChance = min(0.95, baseSuccess + primarySkill*0.04 + (level−1)*0.05) * (loyalty/100)` (`:143-146`).
- `+ player.intelligence * 0.01` if present (`:150`); `+0.10` if
  `player.currentTitle === 'spymaster'` (`:154`).
- Two independent `Utils.random()` rolls: `roll` (outcome) and `captureRoll`
  (capture) at `:159`, `:163`.
- Capture: `captureChance = mission.captureChance`, reduced by each trait's
  `captureResist` down to a 0.01 floor (`:170-172`); captured if
  `captureRoll < captureChance` (`:175`).
- Outcome bands (`:179-189`): captured+failed → `captured`;
  `roll < successChance*0.3` → `criticalSuccess`; `roll < successChance` →
  `success`; `roll < successChance + 0.15` → `partialSuccess`; else `failure`.
- XP: `floor((mission.rewards.experience || config.experiencePerMission) * outcome.experienceMultiplier)` (`:203`).
  Level-up when `experience >= level * levelUpThreshold` (150) and
  `level < maxSpyLevel` (5) (`:208-209`). Captured spies are removed from the
  roster (`:223-224`).

**Upkeep / loyalty / betrayal** (`missions.js:24-61`): daily `upkeep` per living
spy; if unpayable, loyalty −5 and desertion at loyalty ≤ 0. Loyalty decays
`loyaltyDecayPerDay` (0.1). Below `loyaltyMinBeforeBetrayal` (20), betrayal roll
uses `_getSpyBetrayalRisk` = 0.02 base + trait `betrayalRisk` (`:620-628`).
Recall costs −5 loyalty (`spies.js:415`).

**Steal-technology** (`_resolveStealTechnology`, `missions.js:343-399`): builds a
pool of `Technology.TECHS` the player lacks, filtered by a simulated kingdom tier
`min(5, floor(kingdom.military/200)+1)` vs `tech.tier` (`:361-368`); picks one
via `Utils.randPick`, pushes to `player.technology.researched`. Empty-pool
success → steal `Utils.randInt(100,300)` gold (`:380`). Partial → advance current
research by 3 days (`:388-393`).

**Incite-rebellion** (`missions.js:401-474`): severity `large` on critical
success, else `medium`; partial → `small`. Applies `treasuryLoss`/`militaryLoss`
fractions and removes up to `territoryLoss` non-capital tiles (capped at 10% of
territory); pushes a rebellion record.

**Assassination** (`missions.js:574-615`): success replaces the ruler via
`Characters.generateCharacter` and applies military −30% / treasury −20%; partial
wounds the ruler (military −10%).

**Diplomatic consequences** (`_applyDiplomaticConsequences`, `missions.js:631-648`):
on capture, or on successful missions defining `consequences`, worsens
`kingdom.relations[player.allegiance]` and `player.reputation[kingdom.id]` by
`diplomaticPenalty` (×1.5 on capture).

## 7. Interactions

- **Technology** — gates the whole system (`hasEspionageTech` →
  `Technology.getTechStatus`); `steal_technology` reads `Technology.TECHS`,
  writes `player.technology.researched`, and can advance current research.
- **Tavern / Gossip** — `gather_intel` calls `Tavern._generateRumor(...)` and
  `Tavern._storeRumors(...)` to inject high-accuracy intel into the rumor system.
- **Kingdoms / Diplomacy** — resolvers mutate
  `kingdom.treasury/military/territory/ruler/characterData/relations`; reads
  `kingdom.isAlive` and `player.allegiance` to exclude the player's own kingdom
  (except `counter_espionage`); also touches `player.reputation`.
- **Player knowledge** — `gather_intel` calls
  `player.learnAboutKingdom(kingdomId, categories)`
  (`player/core/lifecycle.js:212`) to unlock military/economy/diplomacy intel.
- **Fog-of-war / Cartography** — `infiltrate_territory` uses `Hex.hexesInRange`
  to reveal tiles and records `revealedTiles`; `applySpyVision` re-marks them
  each turn until `expiresDay`.
- **Characters** — assassination succession uses `Characters.generateCharacter`.
- **Titles** — the `spymaster` court title grants +10% mission success.
- **Save/Load** — `saveLoad.js` persists `player.espionage` and calls
  `loadState`.

## 8. Extension points

- **Add a mission type** — add an entry under `missions` in
  `data/espionage.json` (`primarySkill`, `baseDuration`, `baseDifficulty`,
  `goldCost`, `apCost`, `captureChance`, `failChance`, `requiredLevel`, optional
  `rewards`/`effects`/`consequences`). It auto-appears in `getAvailableMissions`
  (`spies.js:289`) and the UI. For custom effects, add a `case '<id>':` in
  `_applyMissionOutcome` (`missions.js:246-277`) plus a `_resolve<Name>` resolver
  matching the signature
  `(player, spy, kingdom, isSuccess, isPartial, outcome, world, result)`.
  Missions without a case fall through to default success/fail text (`:275`).
- **Tweak odds/costs** — edit `data/espionage.json` `config` and per-mission
  fields; no code change (the `spies.js` `CONFIG` block is only a fallback). Note
  the formula constants themselves (skill 0.04/0.05 weights, the
  `successChance*0.3` crit band, the `+0.15` partial band) are hardcoded in
  `_resolveMission` (`missions.js:143-186`) and `assignMission`
  (`spies.js:369-375`).
- **Add a trait** — append to `spyTraits`; generation applies skill bonuses
  generically (`spies.js:176-206`), and resolution reads
  `captureResist`/`betrayalRisk`. Note `assassinBonus`/`techStealBonus` are
  defined in data but **not yet consumed** in code — natural hook points.
- **Add a rebellion severity / outcome tier** — extend `rebellionEffects` /
  `missionOutcomes` in the JSON.

## Determinism & globals notes

All randomness routes through `Utils.random()` (and `Utils.randInt`,
`Utils.randPick`, which build on it) — never `Math.random`. `Utils.setSeed(seed)`
swaps in a seeded stream, so espionage outcomes are reproducible under a seeded
game: spy generation (`spies.js:148-205`), mission-id jitter (`spies.js:378`),
outcome/capture rolls (`missions.js:159,163`), betrayal (`missions.js:51`), tech
pick (`missions.js:371`), and territory-loss tile selection (`missions.js:425`).
The module honors the no-globals rule: all game state is threaded through
`player`/`world` parameters, cross-domain deps come via `_imports.js` (never off
`window`), and call sites guard with `typeof Espionage !== 'undefined'`.
