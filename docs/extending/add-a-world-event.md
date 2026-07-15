# Recipe: Add a world event

> **Read first — there are two parallel "world event" systems, and they are not
> connected.**
>
> 1. A **data catalog** in `data/worldEvents.json` under `eventTemplates`
>    (DROUGHT, PLAGUE, FLOOD, …) with rich `effects`/`chance`/`severity`/
>    `duration` fields. **This is currently dead data** — only the `categories`
>    object from that file is ever loaded (`src/core/dataLoader.js:366-367`).
>    Nothing in `src/` reads `eventTemplates`.
> 2. A **hardcoded runtime generator** in `src/world/worldEvents.js` that actually
>    produces the events players see. Effects are hand-written inside `switch`
>    blocks; it does not consult the JSON templates at all.
>
> So "add a world event" means different work depending on which you target.

## How the runtime system works

- Fires from `World.advanceDay` → `WorldEvents.generateEvents(this)`
  (`src/world/world/runtime.js:60-61`), which rolls `Utils.random()` against fixed
  per-category probabilities (political 0.3, economic 0.2, military 0.15, natural
  0.1, religious 0.15) at `worldEvents.js:86-120`.
- Each category generator (`generatePoliticalEvent` `:125`, `…Economic` `:203`,
  `…Military` `:285`, `…Natural` `:343`, `…Religious` `:439`) picks a subtype via
  `Utils.randPick(eventTypes)` and runs a **`switch (type)`** that both applies
  effects inline (mutating `kingdom`/`world`/`settlement`) and returns an event
  object `{ category, text, kingdom|kingdoms, impact }`.
- Player-side effect resolution is `WorldEvents.applyPlayerEffects` (`:513-530`),
  keyed only off `event.impact` (`positive`/`negative`) — there are no
  per-effect-type branches.
- Events surface as **notifications**, not dialogs:
  `src/ui/game/endDay.js:541-546` shows any `world.events` entry with `.text`;
  the event log (`src/ui/ui/propertiesSettings.js:431-449`) lists them. No UI edit
  needed for a normal event. **There is no player-choice concept in the schema or
  code.**

---

## Case A — pure catalog data (no behavior)

Adds flavor/catalog data only; because `eventTemplates` is not wired to runtime
logic, **it will not actually fire in-game.**

1. Add an entry under `eventTemplates` in `data/worldEvents.json`:

   ```json
   "DROUGHT": {
     "id": "drought", "name": "Severe Drought", "icon": "☀️",
     "category": "natural", "severity": "moderate",
     "duration": { "min": 10, "max": 30 }, "chance": 0.02,
     "effects": { "farmProduction": -0.40, "foodPrices": 0.50 },
     "description": "A prolonged drought scorches the land...",
     "text": "A terrible drought grips {region}."
   }
   ```

   `category` must match a value in `categories`. `effects` keys are declarative
   only (no consumer). `text` placeholder tokens (`{region}`, `{kingdom}`, …) are
   **not** currently substituted.
2. If you need a new category, add it to `categories` **and** update
   `src/__tests__/systems.test.js:170-171` if it asserts on the set.
3. `npm run build:data`.

## Case B — an event that actually fires (the real path — needs code)

1. In `src/world/worldEvents.js`, pick the category generator
   (`generatePolitical/Economic/Military/Natural/ReligiousEvent`).
2. Add your subtype string to that generator's `eventTypes` array (e.g. the
   natural list at `worldEvents.js:347-354`).
3. Add a matching `case` in that generator's `switch (type)` that (a) applies the
   effect inline by mutating `kingdom`/`world`/`settlement` state, and (b)
   `return`s an event object:
   ```js
   return {
     category: WorldEvents.CATEGORIES.NATURAL,
     text: '…',
     kingdom: kingdom.id,
     impact: 'negative' // 'positive' | 'negative' | 'neutral'
   };
   ```
4. Only if you introduce genuinely new player-facing `impact` handling — edit
   `WorldEvents.applyPlayerEffects` (`:513-530`).
5. Adjust the category firing probability in `generateEvents` (`:88-118`) if
   desired.
6. **No UI change** — the notification and event-log paths pick up any
   `world.events` entry with `.text` automatically.
7. **No `build:data`** needed for pure code changes (only if you also touched
   JSON).
8. If your change alters deterministic scenarios, update
   `src/__tests__/unit.combat.test.js:55` (`world.events` length) and/or
   regenerate the snapshot `src/__tests__/__snapshots__/golden.units.test.js.snap`
   (`golden.units.test.js:58`).

> Keep all randomness on `Utils.random`/`randPick` — never `Math.random()` — so
> events stay reproducible under a seed (the generators already do this).

## Case C — an interactive event with player choices

**Not supported today.** There is no `choices` schema field, no choice-resolution
code, and no modal UI (events only use `ui.showNotification`). This would require
extending the JSON schema, adding resolution logic (new code), and building a new
dialog component — a design task, not a recipe.

---

## Files touched (recap)

`data/worldEvents.json` · `src/world/worldEvents.js` ·
`src/world/world/runtime.js` (:60-61) · `src/core/dataLoader.js` (:365-367 load) ·
`scripts/build-gamedata.js` (`worldEvents` already registered at :24) ·
`src/ui/game/endDay.js` (:541-546) · `src/ui/ui/propertiesSettings.js` (:431-449)
· tests: `systems.test.js`, `unit.combat.test.js` (:55), `golden.units.test.js`
(:58).
