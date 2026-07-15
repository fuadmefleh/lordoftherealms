# The House — Dynasty Spine (Implementation Plan)

**Date:** 2026-07-15
**Design spec:** `docs/superpowers/specs/2026-07-15-the-house-dynasty-spine-design.md`
**Scope:** Spec 1 only (deterministic). Spec 2 = local llama.cpp NPC brain, planned separately.

---

## 0. Guiding principles

- **Extend, don't reinvent.** Two dynasty systems already exist:
  - `src/systems/relationships/family.js` — the **player's** family, heir,
    aging, and succession (`processAging`, `getEligibleHeirs`, `designateHeir`,
    `succeedAsHeir`, `_getHeirSettings`).
  - `src/world/characters/*` — **NPC kingdom** dynasties (`characterData.dynasty`
    with `prestige`, bloodline, members, advisor roles, `handleSuccession`,
    `_ageCharacters`, `_triggerSuccessionCrisis`).
  The House layer sits **on top of** these, wiring them together and adding the
  new currency/goals/stakes.
- **Honor the two hard rules** (`eslint.config.js` enforces both as errors on
  `src/{core,world,systems,player}`): all randomness via `Utils.*`; no domain
  globals — thread `player`/`world`/`day` as parameters.
- **Determinism preserved.** Every new outcome is seed-reproducible. LLM-facing
  decisions live behind an interface with a deterministic default (Spec 2 swaps
  the implementation). Tests always run LLM-stubbed.
- **Each phase ends green.** `npm run lint && npm test` passes at every phase
  boundary. Golden snapshots are updated deliberately, with a note on the
  intended change.

## 1. Key integration points (verified in code)

| Concern | Existing hook | What we do |
|---|---|---|
| Daily tick | `src/ui/game/endDay.js` (the `endDay()` orchestrator) | Add one `House.processDaily(player, world)` call near the relationships block (~line 260) |
| Player aging/death | `Relationships.processAging()` → `agingResult.died` → `game._triggerDeath()` (`src/ui/game/combat.js:230`) | Route death through House succession before the death screen |
| Heir handoff | `Relationships.succeedAsHeir(player, childId, world)` | Extend to transfer the House (Prestige, holdings, ambition, rivalries) + apply succession stakes |
| Inheritance numbers | `Relationships._getHeirSettings()` | Reuse; add House-specific fields (inheritance cost, fragmentation) |
| NPC dynasties | `Characters` (`src/world/characters/`) | Reference as rival Houses; reuse member generation |
| Persistence | `SaveLoad.serializePlayer()` / deserialize (`src/systems/saveLoad.js`) | Serialize/restore `player.house` |
| Module registry | `src/systems/index.js` barrel | Export the new `House` system |
| Player state | `src/player/core/state.js` | Add `this.house = null` (set at founding) |

## 2. Data model

New module `src/systems/house.js` (barrel-exported). Plain serializable data:

```
player.house = {
  id, name, motto, sigil: { icon, color }, foundedDay,
  prestige: 0,                 // the dynastic currency
  prestigeLog: [],             // {day, delta, reason} — recent, capped
  lastNotableDay: 0,           // for decay ("idle" detection)
  headId,                      // current played character (mirrors player identity)
  ambition: {                  // one active ambition
    id, milestones: [{id, done, day}], capstoneDone, chosenDay
  },
  roles: {                     // family-member assignments (memberId or null)
    steward: null, marshal: null, chancellor: null, spymaster: null, heir: null
  },
  holdings: { /* derived snapshot for scoring + succession fragmentation */ },
  rivals: { [houseKey]: { feud: 0, lastActedDay } },  // feud score per rival
  history: [],                 // {day, generation, text, tags[]} chronicle (LLM memory seam)
  generation: 1,
}
```

- **Members** stay owned by `Relationships` (player family) — the House `roles`
  reference member ids; House does not duplicate the family tree.
- **Rivals** key off existing kingdom `dynasty` identities where possible; a
  small number may be seeded as independent noble Houses.
- **`ambition` catalog** and **role/bonus tables** live in `data/*.json`
  (per the data-driven convention), merged by `build:data`, read via
  `DataLoader`. Prestige tuning constants also go in data.

## 3. Phases

### Phase 0 — Scaffolding (no behavior yet)
- Create `src/systems/house.js` with `House` object: `initialize(player, world)`,
  `processDaily(player, world)` (no-op stub returning `{}`), `serialize`,
  `deserialize`. No import-time side effects.
- Export from `src/systems/index.js`; add `this.house = null` in
  `player/core/state.js`.
- Wire `House.processDaily` into `endDay.js`; wire serialize/deserialize into
  `saveLoad.js` (guarded like other optional systems).
- **Test checkpoint:** new `src/__tests__/house.test.js` — module initializes,
  round-trips through serialize/deserialize, and a day tick is a no-op. Lint + all
  existing tests still green (golden unchanged — no behavior yet).

### Phase 1 — House entity + Prestige core
- **Founding:** `House.found(player, world, { name, motto, sigil })`. Decide
  trigger: auto-found at game start from the player's surname, with rename
  allowed. Populate `player.house`.
- **Prestige API:** `award(house, amount, reason, day)`,
  `spend(house, amount, reason, day)` (returns false if insufficient),
  `applyDecay(house, day)` (erode if `day - lastNotableDay > IDLE_WINDOW`).
  Every award updates `lastNotableDay` + pushes to `prestigeLog` + `history`.
- `processDaily` calls `applyDecay`.
- **Test checkpoint:** award/spend/decay math is seed-deterministic; decay only
  fires after the idle window; spend guards insufficient balance.

### Phase 2 — Prestige sources & sinks
- **Sources (instrument existing outcomes to also award Prestige):** hook the
  result paths already surfaced in `endDay.js` / player systems — battles won,
  contracts completed, titles held, religion founded / followers, artifacts
  reforged, quests completed, settlement held, prestigious marriage. Keep each
  hook tiny (a single `House.award(...)` at the existing success site).
- **Sinks:** `pressClaim`, `arrangePrestigiousMarriage`, `callInFavor`,
  `secureSuccession` (used by Phase 4). Each validates cost then `spend`s.
- **Test checkpoint:** each source awards the expected Prestige for a seeded
  scenario; each sink debits correctly and refuses when too poor. Update any
  golden snapshot touched by the new award side effects, with a note.

### Phase 3 — Ambitions
- Ambition catalog in `data/ambitions.json` (5 starters from the spec), each with
  milestones + capstone predicates expressed as data-driven conditions evaluated
  against `player`/`world`.
- `House.chooseAmbition(house, id)`, `House.evaluateAmbition(player, world)` in
  `processDaily`: mark milestones done (award Prestige + `history` entry), detect
  capstone → surface a soft "win" notification, allow choosing a new ambition.
- **Test checkpoint:** milestone/capstone predicates flip exactly when conditions
  are met for a seeded world; completing one awards Prestige once (idempotent).

### Phase 4 — Succession with stakes
Extend the existing player succession rather than replacing it.
- In `Relationships.succeedAsHeir` (or a House wrapper it calls): after the
  current stat transfer, **transfer the House** to the heir (Prestige,
  ambition + progress, roles, rivals, history), increment `generation`, append a
  succession `history` entry.
- **Inheritance cost:** replace/augment the flat gold/renown percentages with a
  House inheritance cost (shed a fraction of gold and, on a bad roll, a holding).
- **What can go wrong** (all seed-deterministic, via `Utils`):
  - *No adult heir* → `getEligibleHeirs` empty → regency state (restricted
    actions for N days) if any minor blood exists, else existing game-over path.
  - *Disputed succession* → if a rival feud or a passed-over disloyal relative
    crosses a threshold, trigger a claim: offer `secureSuccession` (spend
    Prestige) or resolve deterministically → **holdings fragmentation** (lose
    some properties/titles). Reuse the shape of
    `Characters._triggerSuccessionCrisis`.
- Route this from the death flow: `processAging`'s `died` branch and
  `_triggerDeath` consult House succession before showing the death/continue UI.
- **Test checkpoint:** heir inherits House state; inheritance cost applied;
  no-heir → regency vs game-over branches; disputed path both resolves via
  Prestige and via fragmentation. Golden updates noted.

### Phase 5 — Family roles
- `House.assignRole(house, roleId, memberId)` / `clearRole`; validate the member
  is living family of eligible age.
- **Bonuses:** `House.getRoleBonuses(player)` returns modifiers (steward → %
  property income, marshal → % army upkeep/strength, chancellor → diplomacy/rep,
  spymaster → espionage). Apply at the existing calculation sites (mirror how
  `kingdom.characterBonuses` is applied for NPCs).
- **Loyalty drift** (in `processDaily`, periodic like the NPC advisor drift):
  influenced by treatment + being passed over for heir; below threshold + high
  ambition sets a `claimant` flag consumed by Phase 4.
- **Test checkpoint:** bonuses apply/remove with assignment; loyalty drift is
  deterministic; passed-over + disloyal → claimant flag set.

### Phase 6 — Rival Houses
- Seed rivals at world init: pick 2–3 kingdom dynasties (and/or seed independent
  noble Houses) into `house.rivals`.
- `processDaily`: accrue `feud` from competing outcomes (a rival wins a
  title/holy site/marriage the player also contests; player raids their kingdom;
  etc.), decay slowly otherwise. Feud feeds Phase 4 disputed-succession.
- Keep behavior deterministic and rule-based (no LLM). Expose the rival's
  intent/opinion as plain data (Spec 2 LLM seam).
- **Test checkpoint:** feud accrues on contested outcomes and influences
  succession disputes for a seeded scenario.

### Phase 7 — UI surface
- A **House panel** (reuse existing panel patterns in `src/ui/ui/panels*.js`):
  identity/sigil, Prestige + recent log, active Ambition + milestone progress,
  family roles (assign/reassign), heir + grooming, rivals + feud, and the
  generational history chronicle.
- Add Prestige to the relevant HUD/stat surface (distinct from gold and renown).
- Founding/rename dialog; ambition-choice dialog; role-assignment dialog.
- **Note:** `src/ui/**` is exempt from the domain-globals rule (legacy inline
  onclicks); follow the existing HUD/panel idioms there.
- **Test checkpoint:** manual/`/run` walkthrough — found a House, earn/spend
  Prestige, assign a role, advance a milestone, trigger a succession. Unit tests
  cover the underlying calls; UI itself is exercised via the app.

### Phase 8 — Confirm LLM seams (Spec 2 readiness)
- Verify `history`, rival intent/opinion, and member ambition/loyalty are all
  plain serializable data.
- Ensure the claim/succession/rival-action decision points call through a small
  interface (e.g. `House.decideRivalAction(ctx)`) whose default is the
  deterministic rule engine, so Spec 2 can inject a "voice + proposals" provider
  without touching call sites.
- **Test checkpoint:** swapping in a stub provider that returns a fixed proposal
  changes behavior at exactly those seams and nowhere else; default path
  unchanged.

## 4. Testing strategy

- New `src/__tests__/house.*.test.js` suites, seeded per `setup.js`.
- Cover Prestige math, ambition predicates, succession branches, role bonuses,
  loyalty/claim thresholds, rival feud accrual.
- **Golden discipline:** run the suite after each phase; any golden diff must be
  intentional and explained (new deterministic awards/succession outputs). If a
  diff is unexpected, determinism broke — fix before proceeding.
- `npm run lint && npm test` green at every phase boundary.

## 5. Open tuning knobs (decide during implementation, not blocking)

- Prestige source amounts, sink costs, `IDLE_WINDOW`, decay rate.
- Ambition milestone thresholds (the `N`/`X`/`Y` in the spec).
- Inheritance cost fraction; fragmentation severity; regency duration.
- Loyalty drift rates and claim thresholds; feud accrual weights.
- Number/identity of seeded rival Houses.

## 6. Risks

- **Golden churn:** many small Prestige hooks touch shared code paths. Mitigate
  by landing sources in one reviewable phase (2) and updating snapshots once.
- **Death-flow coupling:** succession threads through `processAging`,
  `succeedAsHeir`, and `_triggerDeath` across `systems/` and `ui/`. Keep the
  House logic in `systems/house.js` + `relationships/family.js`; `ui/` only
  routes and renders.
- **Scope creep into Spec 2:** rival/family "intelligence" stays deterministic
  here; resist adding real scheming until the LLM spec.
```
