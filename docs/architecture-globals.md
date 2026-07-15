# Globals policy

The game engine is imperative and canvas-based; the React shell only mirrors a
display copy of state. To keep the simulation layers unit-testable, there is a
strict rule about how code may reach the live `Game` instance.

## No `window.game`

The live `Game` instance is **not** published to `window.game` (Phase 6 removed
that binding). Dynamically-built panel HTML that used to call
`onclick="window.game.ui.doThing()"` / `onclick="ActionMenu.X(window.game)"` now
uses `data-ui-act` / `data-am-act` attributes routed through a single delegated
listener in `src/ui/ui.js` (`routeDelegatedClick`), which holds the game
reference internally. The router is unit-tested (`unit.delegation.test.js`).

Remaining UI globals (out of scope, deferred): `actionMenu.js` still defines
~196 `window.<handler> = (…) => {…}` closures used by its other inline-onclick
buttons. Those close over their own `game`/`player` — they do **not** read a
game global — so they don't affect the rule below. Converting them to delegation
is a further optional cleanup.

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
as an **error**. `src/ui/**` and `src/components/**` are exempt (they legitimately
hold the game reference and wire the delegated UI listeners).

Determinism companion: all randomness in the domain layer flows through the
seedable RNG in `src/core/utils.js` (`Utils.setSeed` / `Utils.random`), never
`Math.random()` directly, so tests can reproduce outcomes.
