# Globals policy

The game engine is imperative and canvas-based; the React shell only mirrors a
display copy of state. To keep the simulation layers unit-testable, there is a
strict rule about how code may reach the live `Game` instance.

## The one sanctioned global

`window.game` is bound in exactly one place — the composition root in
`src/components/GameView.jsx` (where the `Game` is constructed). It exists solely
as an adapter for the **legacy inline-onclick handler surface** in `src/ui/**`
(HTML strings like `onclick="window.game.ui.doThing()"` and the
`window.<handler> = (…) => {…}` closures in `actionMenu.js`).

That inline-handler pattern is a UI-rendering concern. Retiring it (delegated /
React event listeners) is tracked as an optional, deferred cleanup and has no
bearing on domain testability.

## The rule

Domain / simulation code — everything under `src/core`, `src/world`,
`src/systems`, and `src/player` — must **never** read `window.game` or a bare
`game` global. It receives what it needs (`game`, `world`, `player`, `day`) as
explicit parameters, threaded from the layer that owns them (typically
`Game.endDay` / the UI action handlers).

Why: hidden global reach makes a function impossible to exercise in isolation —
you have to stand up a whole `Game` and a `window` to call it. Explicit
parameters let a test pass a small hand-built `world`/`player` fixture and assert
on the result.

## Enforcement

`eslint.config.js` applies `no-restricted-globals` (bare `game`) and
`no-restricted-syntax` (`window.game.*`) to `src/{core,world,systems,player}/**`
as an **error**. `src/ui/**` and `src/components/**` are exempt — that is where
the sanctioned binding and its consumers live.

Determinism companion: all randomness in the domain layer flows through the
seedable RNG in `src/core/utils.js` (`Utils.setSeed` / `Utils.random`), never
`Math.random()` directly, so tests can reproduce outcomes.
