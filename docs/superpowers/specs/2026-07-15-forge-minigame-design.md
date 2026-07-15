# The Forge — Polished Strength Labor Minigame

**Date:** 2026-07-15
**Status:** Approved design — ready for implementation planning
**Layer:** `src/ui/` (with a pure, testable logic module)

## Summary

Take the existing Strength "power-bar" day-labor minigame in
`src/ui/actionMenu/jobs.js` (`_laborStrength`) and rebuild it as **"The Forge"** —
a professional, polished smithing timing game. The rebuild ships on a **new
reusable minigame shell** (`MinigameHost`) so the other five labor games can adopt
the same foundation later, and it extracts all scoring/difficulty math into a
**pure, deterministic, unit-tested logic module**.

The work satisfies four goals set during brainstorming:

1. **Game feel / juice** — screen shake, spark particles, hit-stop, combo meter,
   floating score pops, escalating audio.
2. **Visual redesign** — a themed canvas workshop scene (anvil, glowing ingot,
   smith, embers) instead of a bare bar on a blank panel.
3. **Deeper mechanics** — combo/heat meter, shrinking zones, a Masterwork finale,
   and an optional risk-reward charged swing.
4. **Clean, reusable code** — a canvas + `requestAnimationFrame` shell replacing
   the per-frame `innerHTML` rewrite, plus DOM-free testable logic.

## Motivation & root-cause findings

- **The current jank has a root cause.** Every labor game re-renders its entire
  HTML string through `game.ui.showCustomPanel(...)` on a timer (the Strength bar
  every 20 ms). You cannot screen-shake or particle-spark an `innerHTML` rewrite.
  Real polish requires a **persistent `<canvas>` animated with
  `requestAnimationFrame`**, updating pixels rather than rebuilding DOM.
- **A `setInterval` leak exists.** If the panel is closed mid-round, the current
  loops keep running. The new host owns teardown and cancels its rAF loop on close.
- **Audio is ready.** `audioManager.playSFX(type)` (imported singleton from
  `@systems/audio`) already offers procedurally-generated `build` (anvil hammer),
  `success`, `level_up`, and `gold`. We add two forge-specific sounds.
- **Reward hookup is clean & unchanged.** Everything funnels through
  `_laborReward(game, tile, job, scorePercent)`. As long as the game produces a
  `0–100` score, gold / renown / skill-up / end-of-day all work with **zero
  economy changes**. The Skip path (mediocre 40% baseline) is preserved.

## Scope

**In scope**

- New reusable shell `MinigameHost` + a reusable canvas effects layer.
- Fully rebuilt Strength game ("The Forge") on top of the shell.
- Pure, deterministic, unit-tested logic module for zone/scoring/combo math.
- Two new SFX in `src/systems/audio/sfx.js`.
- `_laborStrength` in `jobs.js` becomes a thin delegate (signature unchanged).

**Out of scope (deliberately deferred)**

- Migrating the other five labor games (Intelligence, Combat, Stealth, Stamina,
  Charisma) or the gambling/foraging games. The shell is *designed* so they can
  drop in later, but none are ported in this pass.
- Any change to reward amounts, economy, quest tracking, or the
  `_laborReward` / `_showMinigamePrompt` contracts.
- Persisting high scores or new save-game fields.

## Game design — "The Forge"

The Strength job is reframed as smithing at a forge. Timing-precision maps
naturally to striking hot metal on an anvil, and the theme reads instantly.

### Scene (canvas)

A dark workshop: an anvil with a glowing ingot, the smith and hammer, embers
drifting upward. The ingot **glows hotter/brighter as heat rises** and dims on a
miss. A compact HUD shows round (e.g. `Strike 3 / 6`), current score, and the
heat/combo meter.

### Core loop — the strike bar

A horizontal **heat gauge** with a cursor sweeping left↔right (bouncing). Instead
of today's binary green/red, three nested zones centered on the bar:

| Zone | Visual | Reward |
|------|--------|--------|
| Perfect | narrow gold core (dead center) | full points + spark burst + hit-stop |
| Good | green band around Perfect | solid points (scaled toward 1.0 near center) |
| Weak | amber outer band | few points |
| Miss | outside all zones | zero points; the metal cools, combo breaks |

**Input:** Spacebar **or** click **or** touch triggers a strike at the cursor's
current position.

**Strength stat scaling** (`str` = player Strength, 0–10) widens the zones, so a
stronger character genuinely smiths better — preserving the existing design
intent.

### Zone math (half-widths, in % of bar)

Base (round 0):

- Perfect ≈ `4 + str · 0.4`
- Good ≈ `12 + str · 1.0`
- Weak ≈ `22 + str · 1.0`

Per round `r` (0-indexed), both difficulty ramps apply **independently**:

- **Shrink:** widths multiply by `max(0.35, 1 − r · shrinkRate)`, where
  `shrinkRate = (9 − str · 0.5) / 100` (Strength softens the shrink).
- **Speed:** cursor speed = `baseSpeed + r · 0.35` (+ optional per-job difficulty
  term). Tuned in %-per-second against a delta-time rAF loop so it is
  frame-rate independent.

### Scoring

Per-strike quality `q ∈ [0, 1]`:

- Perfect → `1.0`
- Good → `0.6 + 0.4 · (1 − distToCenter / goodHalfWidth)` (rewards being near center)
- Weak → `0.3`
- Miss → `0.0`

**Heat / combo:** each Perfect or Good raises heat by 1 (clamped 0–5); a Miss (or
Weak, see open question) resets heat to 0. Points for a strike scale by heat:

```
strikePoints = q · (1 + heat · 0.15)
```

**Charged swing (risk-reward):** the player may arm a charged strike before
swinging. When charged, the **Perfect window halves** but landing points
**double** (`strikePoints · 2`). Purely player-elected each round.

**Masterwork finale (round 6):** a single fast strike with a small window and a
dramatic presentation:

- Perfect → "⚒️ MASTERWORK!" + finishing bonus (e.g. `+25%` to the final score).
- Good → "Fine work" (small bonus).
- Miss → "Flawed" (no bonus).

**Final score → `scorePercent`:**

```
scorePercent = clamp(0, 100, round( sum(strikePoints) / theoreticalMax · 100 ))
```

`theoreticalMax` = the total achievable with all Perfects at full heat (plus the
Masterwork bonus), so a flawless combo run approaches 100 and a sloppy run lands
low. The result is passed unchanged to `_laborReward(game, tile, job, scorePercent)`.

### Juice (per strike, scaled by quality)

- **Screen shake** proportional to quality (biggest on Perfect / Masterwork).
- **Spark particles** emitted at the hit point on the anvil.
- **Hit-stop**: a brief (~60–90 ms) freeze on Perfect for impact.
- **Floating text pop**: `+N`, `PERFECT!`, `MASTERWORK!`, `MISS`.
- **Audio**: anvil clang (`build`) pitched up with combo; `forge_perfect` chime on
  Perfect; `forge_charge` riser while arming a charged swing; `level_up`/`success`
  on the win screen.
- The ingot's glow intensity tracks the heat meter.

### Accessibility & robustness

- Keyboard (Space), mouse (click), and touch all strike.
- Respect `prefers-reduced-motion`: damp/disable screen shake and heavy particles.
- The existing **Skip** button (base 40% reward) remains available.
- Guaranteed teardown: closing the panel cancels the rAF loop and removes input
  listeners (fixes the current leak).

## Architecture

New folder `src/ui/minigames/` with a barrel `index.js`. Dependency direction is
respected (`ui/` may import from `@systems/audio` and `@core`).

```
src/ui/minigames/
  index.js            # barrel export
  MinigameHost.js     # reusable shell (canvas + rAF + input + juice helpers + teardown)
  effects.js          # reusable canvas effects: particles, screen shake, floating text
  forge/
    forgeGame.js      # The Forge: scene rendering, round flow, input handling (uses host)
    forgeLogic.js     # PURE: zone math, classification, heat/combo, score aggregation
```

### `MinigameHost` responsibilities

- Inject a single `<canvas>` into the existing `#customPanel` `.custom-panel-body`
  (via `game.ui.showCustomPanel` to open the shell, then take over the body).
- Own one `requestAnimationFrame` loop with delta-time; call the active game's
  `update(dt)` and `render(ctx)`.
- Own input: bind Space / click / touch, forward a normalized "strike"/"charge"
  intent to the game; unbind on teardown.
- Provide juice helpers backed by `effects.js`: `shake(amount)`,
  `spawnParticles(x, y, opts)`, `hitStop(ms)`, `popText(x, y, text, opts)`,
  `playSFX(type)` (thin wrapper over `audioManager`).
- Lifecycle: `start(gameModule)`, `close()` — cancels rAF, removes listeners,
  restores/hides the panel.

### `forgeLogic.js` (pure, testable)

DOM-free, deterministic functions — the professional/testable core:

- `computeZones(str, round)` → `{ perfect, good, weak }` half-widths.
- `classifyStrike(position, zones, { charged })` → `{ tier, quality, distToCenter }`.
- `updateHeat(heat, tier)` → new heat (0–5).
- `strikePoints(quality, heat, { charged })` → number.
- `masterworkBonus(tier)` → multiplier/points.
- `aggregateScore(strikes)` → `scorePercent` (0–100).

RNG: the timing game is **skill-based and deterministic given input timing**, so
the logic module needs no randomness. Any cosmetic randomness (spark angles) lives
in the render/effects layer; if determinism is ever wanted there, it draws from
`Utils` (per the repo's seedable-RNG convention) rather than `Math.random()`.

### Integration points

- `src/ui/actionMenu/jobs.js`: `_laborStrength(game, tile, job)` becomes a thin
  delegate that constructs the Forge game on a `MinigameHost` and, on completion,
  calls the **unchanged** `_laborReward(game, tile, job, scorePercent)`.
- `src/systems/audio/sfx.js`: add `forge_perfect` (bright chime) and `forge_charge`
  (riser); register them in the `playSFX` switch.

## Testing

- New spec `src/__tests__/minigame.forge.test.js` (vitest/node, no DOM) exercising
  `forgeLogic`:
  - Zone widths scale up with Strength and shrink across rounds (bounded by the
    floor).
  - `classifyStrike` boundaries: exact edges of Perfect/Good/Weak/Miss; charged
    halves the Perfect window.
  - Heat increments on Perfect/Good, resets on Miss; clamped 0–5.
  - `strikePoints` monotonic in quality and heat; charged doubles.
  - Masterwork bonus applies only to the final tier as specified.
  - **Monotonicity property:** a run with better-timed strikes yields a
    `scorePercent` ≥ a strictly worse run.
- `npm run lint && npm test` must both pass. The logic module and tests contain no
  bare `game`/`window.game` globals and no `Math.random()` in domain logic.

## Open questions (minor — resolve during implementation)

1. Does a **Weak** hit break the combo, or only a **Miss**? (Leaning: only Miss
   breaks it; Weak simply doesn't add heat — gentler, more encouraging.)
2. Exact Masterwork bonus size and whether it stacks with heat (leaning: `+25%`
   flat on the final aggregate, independent of heat).
3. Final tuning pass on `baseSpeed`, `shrinkRate`, and heat multiplier to hit a
   difficulty curve that feels fair at low Strength and rewarding at high.

## Success criteria

- The Forge plays at a smooth frame rate with no `innerHTML`-per-frame rewrites and
  no leaked loops after closing.
- All four polish goals are visibly present (juice, redesigned scene, the four
  depth mechanics, clean modular code).
- Strength stat still meaningfully improves outcomes.
- Reward flow is identical to before (only the score's *provenance* changes).
- `MinigameHost` + `effects.js` are game-agnostic enough that porting a second
  labor game later needs no shell changes.
- Lint and tests green.
