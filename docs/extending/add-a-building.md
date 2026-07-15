# Recipe: Add a building / property type

> There are **three unrelated "building" systems** in the codebase. Pick the one
> you mean — the files are completely different. Most of the time you want
> **System A** (an economic buildable property). All three share one rule:
> `data/*.json` is only read after `npm run build:data` merges it into
> `data/gamedata.json` — the game fetches only `gamedata.json`
> (`src/core/dataLoader.js:109`).

---

## System A — Economic "Property" (farm, mine, workshop, tavern…) — most common

The "Build Property" menu. Data lives in `data/playerEconomy.json` under
`PROPERTY_TYPES`. See also the [Economy system doc](../systems/economy.md).

**One `PROPERTY_TYPES` entry** (`data/playerEconomy.json`; object key is
UPPERCASE, `id` is lowercase):

```json
"MINE": {
  "id": "mine", "name": "Mine", "icon": "⛏️",
  "cost": 1000, "constructionDays": 10,
  "produces": "iron", "productionRate": 5, "upkeep": 15,
  "requiredResource": ["iron", "gold_ore", "gems", "stone"],
  "description": "Extracts valuable resources for sale. Upkeep: 15g/day"
}
```

Fields: `id` (lowercase, used everywhere as `property.type`), `name`, `icon`,
`cost`, `constructionDays` (0 = instant), `produces` (good id or `null`),
`productionRate`, `upkeep`, optional `requiredTerrain[]`, `requiredResource[]`,
`requiredSettlement` (bool), and recipe-building extras
`recipeChangeCost`/`retoolingDays`/`allowedRecipes[]`.

### Checklist

1. **Add the entry** to `data/playerEconomy.json` → `PROPERTY_TYPES`. (Also mirror
   it into the hardcoded default `PROPERTY_TYPES` in
   `src/player/playerEconomy/routes.js:10` — the JSON overwrites the code
   defaults only for keys it defines, so keeping both in sync avoids surprises.)
2. **Run `npm run build:data`** so it lands in `data/gamedata.json` (loaded into
   `PlayerEconomy.PROPERTY_TYPES` at `src/core/dataLoader.js:385`).
3. **Wire the inner-map sprite** — add your `id` to `PROPERTY_SPRITES` in
   `src/world/innerMap/state.js:158-168` (falls back to
   `buildings/villageSmall00.png` if missing).
4. **Wire the inner-map label/actions** — add your `id` to
   `PROPERTY_BUILDING_DEFS` in `src/world/innerMap/state.js:173-183`
   (`{ name, icon, actions: [...] }`). Without this the building gets no on-map
   label or interaction.
5. **Preload the art** — add the `.png` filename(s) to the building-sprite
   preload array in `src/ui/renderer/assets.js:204+`; new art must physically
   exist under `assets/tiles/buildings/`.
6. **Recipe/processing building only** (workshop/brewery style) — add its `id` to
   all three gate lists:
   - `RECIPE_BUILDINGS` — `src/player/playerEconomy/property.js:275-280`
   - `RECIPE_BUILDING_TYPES` — `src/ui/actionMenu/trade.js:131-136`
   - `ADJACENT_OK_TYPES` (if buildable next to a settlement) —
     `src/player/playerEconomy/property.js:72-78`

   Add any new recipe rows to `RECIPES` (`data/playerEconomy.json`) and their
   outputs to `GOODS`.
7. **Custom placement only if needed** — special rules (like `FISHING_WHARF`) are
   hardcoded in `src/player/playerEconomy/property.js:29-58`. A plain
   terrain/resource/settlement-gated property needs nothing here.
8. **No enum/index registration.** The build menu iterates
   `Object.entries(PlayerEconomy.PROPERTY_TYPES)`
   (`src/ui/actionMenu/build.js:26`); production/collection/caravans iterate owned
   properties generically. All pick it up automatically.
9. **Test awareness** — `src/__tests__/player.test.js:68-70` asserts
   `PROPERTY_TYPES` count `>= 7` (adding keeps it green);
   `src/__tests__/playerEconomy.structure.test.js:11` asserts the top-level
   keys exist. No golden snapshot covers the property list.

> **Gate behind research?** Tech-unlocked buildings come from
> `Technology.TECH_BUILDINGS` (`data/technology.json`), merged with properties in
> `src/systems/technology/queries.js:207-218` and rendered at
> `src/ui/actionMenu/build.js:62-119`. Add it there with a `requiredTech` field
> instead of (or in addition to) `PROPERTY_TYPES`. See
> [add-a-technology.md](add-a-technology.md).

---

## System B — Player home ("Housing": shack, cottage, manor…)

A house the player buys in a settlement for renown/stat bonuses. Data:
`data/housing.json`, system: `src/systems/housing.js`.

1. Add an entry to `data/housing.json` → `houseTypes` (`id`, `name`, `icon`,
   `description`, `baseCost`, `maintenanceCost`, `renownBonus`, `reputationBonus`,
   `staminaBonus`, `healthRegenBonus`, `maxUpgradeSlots`, `availableIn[]`,
   `requiredRenown`). Optionally add `upgrades[]` referencing the new id.
2. `npm run build:data` (loaded to `DataLoader.housing`,
   `src/core/dataLoader.js:402-405`).
3. **Nothing else.** `Housing` reads everything dynamically via `_getHouseTypes()`
   and the buy/upgrade/bonus/daily logic is fully data-driven. No UI enum, no test
   snapshot.

---

## System C — Inner-map visual "Building" structures

Multi-tile sprite structures authored in the in-repo building editor and rendered
on the settlement inner map. Data: `data/buildings.json` (a JSON **array**).

1. Author/add the object to the `data/buildings.json` array (normally produced by
   the building editor `src/ui/buildingCreator/` + `editor.html`, which also
   persists to IndexedDB via `ModStore`). Each entry: `id`, `name`,
   `buildingType`, `tags[]`, `tileW`/`tileH`, `width`/`height`, `layers`
   (`floor`/`walls`/`roof`/`overlay` cell arrays of
   `{q,r,sheetPath,sx,sy,sw,sh}`), `meta` (`{q,r,impassable,door}`), `bounds`.
2. `npm run build:data` (merged as `gamedata.buildings`). Note the loader also
   merges editor-authored buildings from browser IndexedDB at runtime
   (`src/core/dataLoader.js:129,157-161`), so in-editor buildings appear without a
   rebuild — but committing to the repo requires the JSON + rebuild.
3. **No enum registration.** `src/world/customBuildings.js` and
   `src/world/innerMap/buildings.js:205` scatter them generically; rendering is
   `src/ui/innerMapLayers/objectsBuildings.js`.

---

## After any change

Run **`npm run build:data && npm run lint && npm test`**. The rebuild is
mandatory whenever you touch a `data/*.json` file — including for the test suite,
which loads the same merged `gamedata.json`.
