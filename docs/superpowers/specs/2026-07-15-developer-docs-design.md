# Developer Documentation Set — Design

**Date:** 2026-07-15
**Status:** Approved (first pass)

## Goal

A **developer-facing** reference explaining how each game system is *implemented*
and how to *extend* it — so a contributor can go from "how does espionage work?"
to editing the right files with confidence. This is distinct from the existing
docs:

- `GAMEPLAY_MANUAL.md` — player-facing ("how to play").
- Per-layer `src/**/README.md` — file maps ("what lives in this folder").
- `docs/architecture-globals.md` — the no-globals rule.

The new docs are the missing **deep concept references**: per-system
implementation detail plus task-oriented extension recipes.

## Form

Plain **markdown under `docs/`**. No static-site generator, no build step. Read
on GitHub or in-editor, versioned with the code. Precedent already exists
(`docs/architecture-globals.md`).

## Organization — hybrid, concept-first

One reference per **gameplay system** (matching the manual's sections), but each
doc cross-references the actual **code modules** and **`data/*.json`** files
behind it, even when a system spans `world/` + `systems/` + `player/` + `ui/`.
Concept-first is how a developer asks the question; the code/data cross-links
keep it from drifting into stale narrative and make the extension recipes fall
out naturally.

## Layout

```
docs/
  systems/
    index.md              # catalog of all systems, one line + link each
    economy.md            # exemplar — data-heavy world system
    espionage.md          # exemplar — turn-based systems/ + cross-system
    military.md           # exemplar — player state + combat resolution
    ...                   # remaining ~27 systems, rolled out after review
  extending/
    add-a-building.md      # recipe
    add-a-technology.md    # recipe
    add-a-world-event.md   # recipe
```

## Per-system template (8 sections)

Every `docs/systems/<system>.md` answers the same eight questions:

1. **Overview** — what the system does, at a code level (the mental model).
2. **Code map** — the modules/files that implement it (`world/…`, `systems/…`,
   `player/…`, `ui/…`), one-line role each, linking to source.
3. **Data files** — which `data/*.json` drive it and what the key fields mean.
4. **State shape** — the important objects/fields it reads and writes (on
   `world`, `player`, settlements, kingdoms).
5. **Lifecycle** — how it's initialized (`init`/`initialize`) and how it advances
   each turn (`processDay`-style), i.e. where the game loop calls in.
6. **Key rules & formulas** — the actual mechanics/constants that matter (costs,
   odds, thresholds), pointing at where they live.
7. **Interactions** — which other systems it touches.
8. **Extension points** — the seams where you'd add or modify behavior (leads
   into the recipes).

Sections are scaled to the system; a section with nothing to say is kept short,
not padded.

## Recipes

Each `docs/extending/<task>.md` is a short **ordered step-list** — "to add X,
touch these files, in this order," distinguishing the pure-data case from the
case that needs new code.

## First-pass deliverables

1. `docs/systems/index.md` — catalog covering **all** systems (so the structure
   is complete even before every doc is filled in).
2. **3 exemplar system docs** at full 8-section depth, chosen as different
   shapes to stress-test the template:
   - **Economy** — data-heavy world system.
   - **Espionage** — turn-based `systems/` module with heavy cross-system reach.
   - **Military** — `player` state plus combat resolution / RNG.
3. **3 recipes**: `add-a-building`, `add-a-technology`, `add-a-world-event`.

Every code/data reference is verified against the source as it's written.

## Rollout (after review)

Once the exemplars' style and depth are approved, roll out the remaining ~27
systems against the same template. Each new doc is checked against the code as
it's written. The `index.md` catalog is the checklist.

## Non-goals

- No player-facing content (that's `GAMEPLAY_MANUAL.md`).
- No site generator / tooling.
- No refactoring of game code — docs only.
