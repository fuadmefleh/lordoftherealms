# Recipe: Add a technology

> **Read first — two copies of the tech data exist.** `data/technology.json` is
> the authoritative source (8 categories, ~45 techs).
> `src/systems/technology/data.js` is a **stale hardcoded fallback** (~28 techs)
> that is overwritten wholesale at runtime by `dataLoader.js:369-381`. You
> normally edit only the JSON. Because the game and the test suite both fetch the
> merged `data/gamedata.json`, **editing `technology.json` has no effect until you
> run `npm run build:data`.**

## One `TECHS` entry

Under the top-level `"TECHS"` object in `data/technology.json`:

```json
"IRRIGATION": {
  "id": "irrigation", "name": "Irrigation Systems", "icon": "💧",
  "category": "agriculture", "cost": 200, "days": 8,
  "requires": ["crop_rotation"], "tier": 2,
  "description": "Channel water to fields for consistent irrigation.",
  "effects": { "farmProductionBonus": 0.30, "unlockBuilding": "IRRIGATED_FARM" },
  "flavorText": "Where water flows, life follows."
}
```

Fields: `id` (snake_case — the runtime key used in `researched`/`implemented`,
`requires`, `requiredTech`), `name`/`icon`/`description`/`flavorText` (display),
`category` (must match a `CATEGORIES` id: agriculture, industry, military,
infrastructure, commerce, naval, culture, medicine), `tier` (1–4; controls UI sort
**and** the number of parts to implement), `requires` (array of tech ids),
`effects` (the bonus payload — see below).

Related structures the `effects` may reference: `RESEARCH_COSTS` (real
gold/materials/days, keyed by tech `id`), `TECH_BUILDINGS` / `TECH_UNITS` /
`TECH_RECIPES` (each has a `requiredTech` field backing the
`unlockBuilding`/`unlockUnit`/`unlockRecipe` effects).

## How effects are applied (the key part)

There is **no switch keyed by tech id.** Effects apply by **effect-field name**,
two mechanisms, both in `src/systems/technology/queries.js`:

- **Numeric bonuses** — aggregator getters loop over
  `player.technology.implemented` and read a specific `effects.<field>`, e.g.
  `getProductionBonus` (`:67`, reads `farmProductionBonus`,
  `mineProductionBonus`, …), `getUnitStrengthBonus` (`:101`),
  `getBuildingCostReduction` (`:122`), `getTradeProfitBonus` (`:136`),
  `getMovementBonus`/`getVisionBonus`/`getDefenseBonus`/`getStorageBonus`
  (`:151-193`). Consumed by `player/playerEconomy/property.js`,
  `player/playerMilitary/recruitment.js`, `player/core/lifecycle.js`,
  `ui/actionMenu/trade.js`.
- **Unlock effects** — `getUnlockedBuildings/Units/Recipes` (`:207-239`) iterate
  `TECH_BUILDINGS/UNITS/RECIPES` and include any whose `requiredTech` is
  implemented. The real link is the `requiredTech` field on the unlocked entity;
  the `unlockBuilding: "X"` string in `effects` is display metadata.

> **⚠️ Dormant effect keys.** Many keys in `technology.json` have no getter and no
> consumer — pure flavor today: `settlementGrowthBonus`, `plagueResistance`,
> `researchBonus`, `tradePriceDiscount`, `navalCombatBonus`, `explorationBonus`,
> `diplomacyBonus`, `unlockInfrastructure`, etc. Reusing one displays a number (if
> listed in the UI) but changes nothing in gameplay unless you add a getter +
> consumer.

Effects only take hold once a tech reaches `player.technology.implemented`
(research → craft parts → implement; lifecycle in
`src/systems/technology/research.js`).

---

## Case A — pure data (reuse a supported effect key or an unlock)

1. **Add the tech** to `"TECHS"` in `data/technology.json`: `id`, `name`, `icon`,
   `category` (must match a `CATEGORIES` id), `tier`, `requires` (existing ids),
   `description`, `flavorText`, and an `effects` object using **only
   already-supported keys** (getters in `queries.js` + the display list in
   `techTreasury.js:210-224`).
2. **Add a research cost** to `RESEARCH_COSTS` keyed by the tech `id` (`gold`,
   `materials`, `days`). Optional but recommended — otherwise it falls back to
   `cost*3` / `days*2`.
3. **If it unlocks something**, add a `TECH_BUILDINGS`/`TECH_UNITS`/`TECH_RECIPES`
   entry with `requiredTech` = your tech `id`, and reference it via
   `unlockBuilding`/`unlockUnit`/`unlockRecipe` in `effects`. (For
   `unlockInfrastructure`, the type must exist in `data/infrastructure.json`.)
4. **Run `npm run build:data`** (required for both game and tests to see it).
5. **Run `npm test`** — `systems.test.js` tech assertions should stay green
   (`TECHS` must keep `>= 20` entries; every `TECH_BUILDINGS` entry needs a
   `name`).

The tech auto-surfaces in the tech tree (`src/ui/ui/techTreasury.js`,
`getTechsByCategory`) and its effects auto-apply — no UI or system code needed.

## Case B — new effect *type* (a numeric key with no existing getter)

Do Case A, plus, **before** the build step:

1. **Add the aggregator** in `src/systems/technology/queries.js` — a new
   `getMyNewBonus(player)` that loops `player.technology.implemented` reading
   `tech.effects.myNewBonus`, or an `if (e.myNewBonus) …` line inside an existing
   getter (e.g. the `getProductionBonus` switch at `:74`).
2. **Wire the getter into the gameplay system** that should honor it (consumers
   today: `playerEconomy/property.js`, `playerMilitary/recruitment.js`,
   `player/core/lifecycle.js`, `ui/actionMenu/trade.js`). Without this the number
   is dormant.
3. **Add a UI display line** in `src/ui/ui/techTreasury.js:210-224`
   (`if (e.myNewBonus) effectParts.push(...)`) so players see it.
4. **(Recommended) add a test** near `src/__tests__/systems.test.js:54` asserting
   the getter aggregates correctly for an implemented tech.

## Case C — new category

Case A/B plus, in `data/technology.json`: add to `CATEGORIES`, `LAB_CONFIG` (so a
property type can research it — gating at `research.js:182`), `CATEGORY_PARTS`, and
`PARTS_CRAFTING` (so parts can be crafted/implemented). The category tab renders
automatically.

---

## Notes

- **No per-tech registry** — techs are discovered by iterating `Technology.TECHS`;
  `'technology'` is already in the `build-gamedata.js` `topLevel` list, so a new
  tech needs no build-script change.
- **Always rebuild before testing** — tests load data through a mocked `fetch` →
  `gamedata.json` (`src/__tests__/setup.js:20-36`); a stale `gamedata.json` tests
  stale data.
- There are **no golden/snapshot tests over technology data**.
