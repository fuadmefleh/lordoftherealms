# Military & Combat

> Developer reference. Player-facing rules live in
> [`GAMEPLAY_MANUAL.md` §9–10](../../GAMEPLAY_MANUAL.md). Architecture rules
> (no domain globals, seedable RNG) are in
> [`docs/architecture-globals.md`](../architecture-globals.md).

## 1. Overview

The military system lets the player recruit individual units into a `player.army`
array, hire temporary mercenary companies, take timed mercenary contracts, and
resolve battles against world units, settlements (raid/siege/conquest), and random
encounters. Combat resolution is a single stochastic function
(`PlayerMilitary.combat`) that multiplies total army "strength" by randomized
factors plus army-composition counters (cavalry/archer/pikeman rock-paper-
scissors), terrain modifiers, and morale, then compares player power vs. enemy
power to decide victory and casualties. Each day the system pays gold upkeep,
ticks mercenary wages/loyalty/contracts, advances any active contract, and
processes indentured servitude (the capture penalty for losing with no army). All
randomness flows through the seedable `Utils` RNG so battles are reproducible.
Unit/contract definitions load from `data/military.json` at startup; tech-gated
units come from the Technology system.

## 2. Code map

`PlayerMilitary` is a split-module object assembled onto a shared `_ref.js`:

| File | Role |
|------|------|
| `src/player/playerMilitary/index.js` | Assembles the module (recruitment + mercenaries + combat). |
| `src/player/playerMilitary/_ref.js` | Shared empty `PlayerMilitary` object. |
| `src/player/playerMilitary/_imports.js` | Re-exports `Utils` (RNG) and `Technology`. |
| `src/player/playerMilitary/recruitment.js` | `UNIT_TYPES`, composition/counter/terrain/morale helpers, `recruitUnit`, `getArmyStrength`, `getUpkeepCost`, `payUpkeep`. |
| `src/player/playerMilitary/mercenaries.js` | `CONTRACT_TYPES`, `MERCENARY_COMPANIES`, offers/hiring/wage-ticking, `acceptContract`, `updateContract`. |
| `src/player/playerMilitary/combat.js` | `combat()` resolution, `raidSettlement`, `attackSettlement` (siege/conquest), `attackUnit`, `getSettlementDefense`, indentured-servitude. |
| `src/player/playerMilitary.js` | Legacy monolith (superseded by the split folder). |
| `src/player/actions/index.js` (208) | `endDay(player, world)` per-day hub → `processServitude`, `payUpkeep`, `updateContract`. |
| `src/ui/game/endDay.js` (58) | Game-loop `endDay()` → `PlayerActions.endDay` then `world.advanceDay`. |
| `src/ui/actionMenu/combat.js` | Siege/attack UI, lord-audience diplomacy (military aid, demand tribute). |
| `src/ui/actionMenu/trade.js` (~1358) | Recruitment menu, mercenary hiring, contract acceptance. |
| `src/core/dataLoader.js` (291–294) | Loads `military.json` into `UNIT_TYPES`/`CONTRACT_TYPES`. |
| `src/systems/technology/queries.js` (101, 223) | `getUnitStrengthBonus`, `getUnlockedUnits` for tech buffs / tech units. |
| `src/world/{kingdom,kingdomAI,worldEvents,units}.js` | Enemy side: kingdom military, AI war decisions, world-unit spawns. |

## 3. Data files

- **`data/military.json`** (authoritative — overwrites code fallbacks at
  `dataLoader.js:293`):
  - `unitTypes` — 16 entries (MILITIA … SCOUT). Fields: `id`, `name`, `icon`,
    `cost`, `upkeep`, `strength`, `description`, plus optional `siegeBonus`,
    `defenseBonus`, `rangeBonus`, `specialAbility`, `domain`, `speed`,
    `sightRange`.
  - `contractTypes` — 12 mercenary contracts. Fields: `id`, `name`, `icon`,
    `payment`, `duration`, `minStrength`, optional `risk`.
- **`data/units.json`** — a **different** dataset: *world* traveling units
  (caravan, raider, patrol, ship, pirate, beast, monster, …) with `icon`, `name`,
  `speed`, `population`, `strength`, `inventoryTheme`, `domain`, plus
  `inventoryThemes` (loot tables). Drives the enemies the player fights via
  `attackUnit`, not the recruitable roster.
- **`data/technology.json`** — military techs (BASIC_TRAINING, ARCHERY_MASTERY,
  CAVALRY_TACTICS, SIEGE_ENGINEERING, FORTIFICATION) whose `effects` grant
  `unitStrengthBonus`/`archerStrengthBonus`/`knightStrengthBonus` and `unlockUnit`.

> **⚠️ Gate drift.** `military.json` unit entries carry **no**
> `minSettlement`/`minPopulation` — those recruitment gates exist only on the
> hardcoded `UNIT_TYPES` in `recruitment.js` (5 units). Since `dataLoader`
> replaces `UNIT_TYPES` wholesale, the loaded JSON loses tier gating, and
> `FORMATION_ROLES` covers only militia/soldier/pikeman/archer/knight — the extra
> JSON units default to the `pikeman` role.

## 4. State shape

**On `player`** (`src/player/core/state.js`, ~110-130):
- `player.army` — `{ type, name, icon, strength, upkeep, experience, level }[]`;
  mercenary units add `mercenary: true`, `mercenaryCompanyId`,
  `mercenaryCompanyName`, `upkeep: 0`.
- `player.mercenaryCompanies` — hired companies: `{ id, templateId, name, icon,
  reputation, settlementName, contractStartDay, daysRemaining, dailyWage,
  loyalty, outbidRisk, roster, initialHireCost, lastEvent }`.
- `player._mercenaryMarkets` — per-settlement offer cache keyed `"q,r"`.
- `player.activeContract` — `{ type, name, payment, daysRemaining, risk,
  settlement }` (one at a time).
- `player.indenturedServitude` — `{ captor, daysRemaining, totalDays, dailyWage,
  goldConfiscated, canBuyFreedom, freedomCost, escapeChance }`.
- `player._recruitedThisTurn` — daily counter (reset in `player.endDay()`,
  `player/core/lifecycle.js:68`).
- Combat also writes `player.gold`, `karma`, `renown`, `reputation[kingdomId]`,
  `skills.combat/leadership/stealth`, `allegiance`, `colonies`, `inventory`.

**On `world`:**
- `kingdom.military` — integer strength pool (init ~5–8% of population,
  `kingdom.js:237-238`; recomputed ~5% pop in `kingdomAI.js:248`). Decremented on
  conquest, boosted when a mercenary company switches sides.
- `kingdom.territory`, `capital`, `population`, `isAlive`, `treasury`, `wars`.
- `world.units` — traveling enemies `{ id, type, q, r, name, icon, strength,
  population, inventory, kingdom, destroyed }`.
- `settlement.population/type/kingdom/colony/marketStock`.
- `world.events` — battle log entries `{ text, type: 'military' }`.

## 5. Lifecycle

**Initialization:** `player.army/mercenaryCompanies/activeContract` set in the
Player constructor (`src/player/core/state.js:110-116`). Unit/contract data
loaded once at `dataLoader.js:291-294`. Mercenary sub-state lazily created by
`PlayerMilitary._ensureMercenaryState(player)` (`mercenaries.js:136`).

**Per-turn:** the daily hub is `PlayerActions.endDay(player, world)`
(`src/player/actions/index.js:208`), which in order:

1. `PlayerMilitary.processServitude(player, world)` (`combat.js:137`) — decrements
   servitude, locks movement, frees on completion.
2. `PlayerMilitary.payUpkeep(player, world)` (`recruitment.js:353`) — pays gold
   upkeep (drops units if unaffordable), then `_processMercenaryCompanies`
   (`mercenaries.js:299`) — wages, loyalty, `daysRemaining`, contract-expiry /
   outbid-switch rolls.
3. `PlayerMilitary.updateContract(player)` (`mercenaries.js:407`) — decrements
   `activeContract.daysRemaining`, pays out and applies casualties/XP on
   completion.

**Game-loop entry:** `src/ui/game/endDay.js:58` `endDay()` calls
`PlayerActions.endDay` (`:79`) then `world.advanceDay(player)` (`:114`) and
`player.endDay()` (`:115`, resets `_recruitedThisTurn`). The "End Turn" button
binds to `game.endDay()` in `src/ui/ui/hud.js:110`. Direct combat actions
(`performSiege`, `performAttack`) also call `game.endDay()` after resolving.

## 6. Key rules & formulas

**Combat resolution** (`combat.js`, `combat()`):
- `playerPower = playerStrength * Utils.randFloat(0.8,1.2) * counterMult *
  terrainMult * morale` (enemy symmetric) (`:33-34`) — the ±20% swing per side is
  the primary RNG.
- Victory = `playerPower > enemyPower` (`:47`).
- Morale break (`:37-45`): if `_checkMoraleBreak` fires, breaking side ×0.55,
  opponent ×1.12.
- Casualties (`:50-57`): win → `randFloat(0.05,0.15)`, loss →
  `randFloat(0.2,0.4)` of `army.length`; units `pop()`ed off.
- Rewards (`:64-81`): `loot = floor(enemyStrength * randFloat(2,5))`; survivors
  +5 XP (level at 100 XP, `strength *= 1.2`, cap level 5); `skills.combat += 0.3`
  (cap 10); `renown += floor(enemyStrength/10)`.
- Capture (`:84-98`): if `army.length===0` and `Utils.random() < 0.4` →
  servitude, `freedomCost = 200 + enemyStrength*2`,
  `escapeChance = 0.1 + stealth*0.03`.

**Composition counters** (`recruitment.js`):
- Roles: cavalry←knight, archer←archer, pikeman←pikeman/soldier/militia
  (`FORMATION_ROLES`, `:67`). RPS: cavalry>archer, archer>pikeman, pikeman>cavalry
  (`_counterScore`, `:133-145`).
- `_counterMultiplier` clamps to `[0.8, 1.25]` via `1 + score*0.75` (`:147-150`).
- Terrain (`:160-168`): hills `1 + archer*0.18`; plains `1 + cavalry*0.18`.
- Morale (`:170-175`): `1 - max(0,ratio-1)*0.34 + leadership`, clamp
  `[0.45,1.2]`; leadership `= skills.leadership*0.015 + festival` (`combat.js:28`).
- Morale-break chance (`:177-182`): only if outnumbered ≥1.8×,
  `clamp((ratio-1.6)*0.45 + (1-morale)*0.6, 0.05, 0.75)`.

**Recruitment** (`:268-311`): gate `player.gold >= unit.cost`; settlement tier via
`SETTLEMENT_TIER {village:1,town:2,city:3,capital:4}` and `minPopulation`; daily
cap `getRecruitmentCapacity = max(1, floor(pop/50))` (`:232-236`).

**Army strength** (`:316-335`): per unit `strength * (1+(level-1)*0.2) *
(1+combat*0.1) * (1+techBonus)`; tech bonus from
`Technology.getUnitStrengthBonus` (`queries.js:101-117`).

**Upkeep** (`:340-393`): `getUpkeepCost` = Σ unit `upkeep`; if unpayable, lose
`max(1, ceil(nonMercCount*0.1))` non-mercenary units. Mercenary wages are separate
daily gold.

**Mercenaries** (`mercenaries.js`): offers refresh every 4 days, hireCost
×`randFloat(0.92,1.08)`, wage ×`randFloat(0.9,1.1)`. `_processMercenaryCompanies`
(`:299-374`): paid → loyalty +1 else −12; passive −`randFloat(0.5,2.5)`/day;
switch-sides chance `clamp(outbidRisk + (0.22 if unpaid) + (45-loyalty)*0.012,
0.04, 0.82)`; on switch a rival kingdom gains `military += floor(strength*0.45)`.

**Siege/conquest** (`attackSettlement`, `combat.js:294-453`): requires 50+ army
strength; `garrison = floor(pop*0.03*defenseMult) + kingdomMilitary*share`
(capital 0.4, else 0.15), ×1.3 wall bonus for city/capital. Victory → plunder
`floor(pop*randFloat(1,3))`, pop ×0.7, territory transfer, karma −10, renown
+5/15/30/50 by tier, reputation −50 to previous kingdom, possible capital
relocation or kingdom destruction. `raidSettlement` (`:238`) is the lighter
version (30+ strength).

## 7. Interactions

- **Economy** — recruitment/upkeep/wages drain `player.gold`; loot/plunder/tribute
  add gold; unpayable upkeep destroys units (`recruitment.js:364-382`); contract
  payouts add gold (`mercenaries.js:436`).
- **Kingdoms / conquest** — combat reads `kingdom.military` for garrison, writes
  it on conquest (territory/military/population loss, capital relocation,
  `isAlive=false`). `player.reputation`/`player.allegiance` decide whether a
  conquered settlement joins the player or becomes an independent colony.
  `KingdomAI` grows `military` and decides wars. Lord audiences grant Levy units
  or extort gold (`actionMenu/combat.js`).
- **Technology** — military techs buff `getArmyStrength` and unlock tech units
  (LONGBOWMAN, CAVALRY, SIEGE_ENGINE via `unlockUnit` + `Technology.TECH_UNITS`),
  surfaced in the recruit UI (`trade.js:1402-1419`), gated by `isTechUnitAvailable`
  (`recruitment.js:255-263`).
- **Religion** — indirect: `player.festivals.moraleBoostValue` adds to the
  leadership/morale term (`combat.js:25-28`).

## 8. Extension points

- **Add a recruitable unit** — add an entry to `data/military.json` `unitTypes`
  (`id`/`name`/`icon`/`cost`/`upkeep`/`strength`). The recruit menu iterates
  `UNIT_TYPES` automatically. To join the counter/terrain system, map its `id`
  into `FORMATION_ROLES` (`recruitment.js:67`) — otherwise `_roleForUnitType`
  defaults it to `pikeman`. For tier gating, add `minSettlement`/`minPopulation`
  keys to the JSON **and** the `isUnitAvailable` logic (they're currently only
  honored on the code fallback map).
- **Add a tech-unlocked unit** — see
  [`docs/extending/add-a-technology.md`](../extending/add-a-technology.md); use
  `effects.unlockUnit` + a `TECH_UNITS` entry with a matching `requiredTech`.
- **Change combat math** — all resolution is in `combat.js:9-132`. Tunable
  helpers are isolated in `recruitment.js`: `_counterMultiplier`,
  `_terrainMultiplier`, `_moraleValue`, `_checkMoraleBreak`, and the composition
  inference functions. Casualty/loot/XP curves are inline in `combat()`.

## Determinism & globals notes

Keep all randomness on `Utils.random`/`randFloat`/`randInt`/`randPick`
(`src/core/utils.js:77-114`), which draw from the injectable `_rng` seeded via
`Utils.setSeed`. The ±0.8–1.2 power swing (`combat.js:33-34`), morale-break rolls,
capture roll, casualty rates, and mercenary offer/switch rolls all already use
this stream, so battles are deterministic under a fixed seed.

> **⚠️ Known non-determinism:** some diplomacy paths in `actionMenu/combat.js`
> (e.g. trade/tribute success) currently call `Math.random()` and are therefore
> *not* seed-reproducible. New code must not follow that pattern (it also fails
> the ESLint `no-restricted-syntax` rule if placed under
> `core/world/systems/player`).
