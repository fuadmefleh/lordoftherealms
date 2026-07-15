# Implementation Plan — The Forge Minigame

**Spec:** `docs/superpowers/specs/2026-07-15-forge-minigame-design.md`
**Date:** 2026-07-15
**Branch:** work on `refactor/testability` (current) or a fresh `feat/forge-minigame`.

## How to use this plan

Work top to bottom. Each phase ends with a **verification gate** that must pass
before moving on. Check boxes as you go. After every phase that touches `src/`,
run `npm run lint && npm test`.

Guiding constraints from the repo:
- New code lives in `src/ui/minigames/` (the `ui/` layer — may import from
  `@systems`, `@core`; must never be imported *by* them).
- Reward flow is unchanged: the game's only output is a `0–100` score passed to
  the existing `_laborReward(game, tile, job, scorePercent)`.
- Pure logic uses no `Math.random()` and no bare `game`/`window.game` globals so it
  is deterministic and testable. Cosmetic randomness (sparks) may use `Utils`.
- 4-space indent, single quotes, semicolons. Import from folder barrels, not files.

## Pre-flight (decide the 3 open questions)

Lock the minor tuning calls from the spec before coding the logic:

- [ ] **Combo break:** only a **Miss** breaks the combo; a **Weak** hit adds no
      heat but does not reset it. (Spec's leaning — confirm.)
- [ ] **Masterwork bonus:** flat `+25%` applied to the final aggregate score,
      independent of heat.
- [ ] **Starting tuning values:** `baseSpeed`, `shrinkRate`, heat multiplier
      `0.15` — start with spec values, tune in Phase 6.

---

## Phase 1 — Pure logic module + tests (no DOM, no rendering)

Build the deterministic core first, test-driven. Nothing here touches the browser.

**Files**
- `src/ui/minigames/forge/forgeLogic.js` (new)
- `src/__tests__/minigame.forge.test.js` (new)

**Steps**
- [ ] Write `src/__tests__/minigame.forge.test.js` first with failing cases for:
  - `computeZones(str, round)` — Perfect/Good/Weak half-widths increase with
    `str`; shrink across rounds; never below the floor (`* 0.35`).
  - `classifyStrike(position, zones, { charged })` — returns
    `{ tier, quality, distToCenter }`; exact boundary positions land in the
    expected tier; `charged: true` halves the Perfect window.
  - `updateHeat(heat, tier)` — +1 on `'perfect'`/`'good'`, unchanged on `'weak'`,
    reset to 0 on `'miss'`; clamped 0–5.
  - `strikePoints(quality, heat, { charged })` — monotonic in `quality` and
    `heat`; `charged` doubles the result.
  - `masterworkBonus(tier)` — bonus only for the finale tier per the decision.
  - `aggregateScore(strikes)` — returns integer `0–100`; all-Perfect+max-heat run
    approaches 100; all-Miss run is 0.
  - **Property test:** a strictly better-timed run scores `>=` a worse run.
- [ ] Implement `forgeLogic.js` to make the tests pass. Pure functions only; no
      imports of DOM, `game`, or `Math.random`. Export via named exports.
- [ ] Add `src/ui/minigames/forge/` to nothing else yet — logic stands alone.

**Verification gate**
- [ ] `npm test` — the new suite passes; existing suites unaffected.
- [ ] `npm run lint` — clean (no globals, no raw randomness).

---

## Phase 2 — Reusable effects layer (canvas juice primitives)

Pure-ish rendering helpers that draw onto a supplied canvas 2D context. Game-agnostic.

**Files**
- `src/ui/minigames/effects.js` (new)

**Steps**
- [ ] Implement a small `Effects` module/class managing:
  - **Particles:** `spawn(x, y, opts)` (count, speed, spread, color, gravity,
    life); `update(dt)`; `render(ctx)`. Spark preset for anvil hits.
  - **Screen shake:** `shake(amount)`; `update(dt)` decays it; expose current
    `{ ox, oy }` offset for the game to translate the ctx by.
  - **Floating text:** `popText(x, y, text, opts)` (rise + fade); `update`/`render`.
  - **Hit-stop:** `hitStop(ms)` + an `isFrozen()` / remaining accessor the host
    loop consults to skip `update` while still rendering.
- [ ] Respect reduced motion: accept a `reducedMotion` flag that damps shake and
      caps particle counts.
- [ ] Cosmetic randomness (spark angles/speeds) draws from `Utils` (imported from
      `@core`) to honor the repo convention, or documents why `Math.random` is
      acceptable in this render-only layer.

**Verification gate**
- [ ] `npm run lint` clean. (Effects has no dedicated unit test — it is visual; it
      is exercised via the game in Phase 5. Optionally add a tiny smoke test that
      `update(dt)` ages/reaps particles.)

---

## Phase 3 — MinigameHost shell (canvas + rAF + input + teardown)

The reusable foundation every labor game can adopt.

**Files**
- `src/ui/minigames/MinigameHost.js` (new)

**Steps**
- [ ] `MinigameHost` opens by calling `game.ui.showCustomPanel(title, '<root>')`
      once, then locates the `.custom-panel-body` and injects a single `<canvas>`
      sized to the panel (with devicePixelRatio scaling for crispness).
- [ ] Owns one `requestAnimationFrame` loop with delta-time (`dt`), clamped to a
      max step. Each frame: if not hit-stopped, call `gameModule.update(dt)`; then
      `effects.update(dt)`; then clear + `gameModule.render(ctx)` + `effects.render(ctx)`
      under the current shake translation.
- [ ] Input: bind `keydown` (Space → strike; hold detection for charged swing),
      canvas `click`, and `touchstart`; forward normalized intents
      (`strike`, `chargeStart`, `chargeRelease`) to `gameModule`.
- [ ] Juice helpers proxying `effects` + audio: `shake`, `spawnParticles`,
      `hitStop`, `popText`, `playSFX(type)` (thin wrapper over `audioManager`
      imported from `@systems/audio`; guard with `typeof`/existence like `panels.js`).
- [ ] **Teardown** (`close()`): cancel the rAF handle, remove all listeners, drop
      the canvas. Also hook the panel's existing close affordance so closing the
      modal tears down the loop (fixes the current `setInterval` leak).
- [ ] Lifecycle API: `start(gameModule)` where `gameModule` implements
      `{ init(host), update(dt), render(ctx), onInput(intent), isDone(), result() }`.

**Verification gate**
- [ ] `npm run lint` clean.
- [ ] Manual: temporary throwaway "game module" that draws a moving square renders
      smoothly in `npm run dev`, and closing the panel stops the loop (verify via a
      console log in the rAF callback that it ceases).

---

## Phase 4 — Add Forge SFX

**Files**
- `src/systems/audio/sfx.js` (edit)

**Steps**
- [ ] Add `_sfxForgePerfect()` — a bright, short chime (triangle/sine, quick
      high-note flourish), following the existing procedural-WebAudio pattern.
- [ ] Add `_sfxForgeCharge()` — a rising riser (frequency ramp up) for arming a
      charged swing.
- [ ] Register `'forge_perfect'` and `'forge_charge'` in the `playSFX` switch and
      the JSDoc `@param` union.

**Verification gate**
- [ ] `npm run lint && npm test` clean (audio is stubbed in tests; ensure no import
      errors). Manual: trigger both in dev.

---

## Phase 5 — The Forge game (scene + round flow) on the host

Wire the pure logic + effects + host into the actual smithing game.

**Files**
- `src/ui/minigames/forge/forgeGame.js` (new)
- `src/ui/minigames/index.js` (new barrel)

**Steps**
- [ ] `forgeGame.js` implements the `gameModule` interface. It holds run state
      (round index, heat, accumulated strikes, cursor position/direction/speed,
      charged flag) and delegates every scoring decision to `forgeLogic`.
- [ ] `update(dt)`: advance the sweeping cursor (bounce at edges) at the
      round's speed.
- [ ] `render(ctx)`: draw the workshop scene — anvil, glowing ingot (glow tracks
      heat), smith/hammer, drifting embers — plus the heat-gauge bar with the three
      nested zones and the cursor, and a compact HUD (`Strike n/6`, score, heat).
- [ ] `onInput('strike')`: classify via `forgeLogic.classifyStrike`, update heat,
      accumulate points, fire juice (shake/particles/hit-stop/popText/SFX scaled to
      tier), advance round; on the 6th round run the Masterwork presentation.
- [ ] Charged swing: `chargeStart` arms (play `forge_charge`, show tell);
      `chargeRelease`/next strike applies `{ charged: true }`.
- [ ] On finish: compute `scorePercent = forgeLogic.aggregateScore(strikes)`,
      show a win screen (rating + stars consistent with existing `_laborReward`
      output style), then invoke the completion callback.
- [ ] Export `startForge(game, tile, job, onComplete)` (or similar) from the barrel
      `index.js`.

**Verification gate**
- [ ] `npm run lint` clean.
- [ ] Manual playthrough in `npm run dev`: all four mechanics present (combo/heat,
      shrinking zones, Masterwork, charged swing); smooth frame rate; no leaked
      loop after closing mid-round.

---

## Phase 6 — Integrate with jobs.js + tune

**Files**
- `src/ui/actionMenu/jobs.js` (edit `_laborStrength`)
- `src/ui/actionMenu/_imports.js` (edit only if a barrel export is needed)

**Steps**
- [ ] Replace the body of `_laborStrength(game, tile, job)` with a thin delegate:
      construct the Forge on a `MinigameHost`, and on completion call the
      **unchanged** `ActionMenu._laborReward(game, tile, job, scorePercent)`.
- [ ] Preserve the Skip path: `showOddJobsMenu`'s `onSkip` still calls
      `_laborReward(..., 40)` — no change needed, verify it still routes correctly.
- [ ] Import the minigame barrel (from `@ui/minigames` or relative). If importing
      `audioManager`/the game into `jobs.js` directly, add to `_imports.js` barrel
      consistent with existing pattern.
- [ ] **Tuning pass:** play at low Strength (≈2), mid (≈5), high (≈8). Adjust
      `baseSpeed`, `shrinkRate`, and heat multiplier until it feels fair-but-hard
      low and rewarding high. Keep changes inside `forgeLogic` constants so tests
      stay meaningful (update expected values if constants move).
- [ ] Remove the old `_laborStrength` inline power-bar implementation once the
      delegate works (it now lives, reimagined, in `forgeGame.js`).

**Verification gate**
- [ ] `npm run lint && npm test` both green.
- [ ] Manual: full loop from settlement → Day Labor → Strength job → Forge →
      reward screen → day ends; gold/renown/skill-up behave exactly as before.

---

## Phase 7 — Polish, accessibility & final review

**Steps**
- [ ] Wire `prefers-reduced-motion` into the host/effects (damp shake, cap particles).
- [ ] Verify teardown on every exit path (win screen close, mid-round close, ESC).
- [ ] Confirm keyboard + mouse + touch all strike.
- [ ] Run the `verify` skill / manual end-to-end drive of the flow.
- [ ] Optional: run `/code-review` on the diff.
- [ ] Update `GAMEPLAY_MANUAL.md` if it documents the labor minigames.

**Final verification gate**
- [ ] `npm run lint && npm test` green.
- [ ] All success criteria in the spec met (smooth, no leaks, four polish goals
      visible, Strength matters, reward flow identical, shell reusable).

---

## Rollback / safety

- All new behavior is additive under `src/ui/minigames/` plus one delegated method
  and one audio file edit. If the Forge misbehaves, `_laborStrength` can be
  reverted to the old inline implementation (kept in git history) without touching
  the economy or other games.

## Definition of done

- The Forge is the Strength labor game, running on `MinigameHost`, scored by the
  tested `forgeLogic`, feeding the unchanged reward pipeline.
- `MinigameHost` + `effects.js` are game-agnostic and documented enough that a
  second labor game could adopt them with no shell changes.
- Lint and the full vitest suite (unit + golden) pass.
