# World stability: kingdom survival (2026-10)

Kingdom survival on seeds 7–11 fell across the economy passes, from 45/50 to about 43–44/50. Seed 8 went from 8 to 7. This study looks for the cause, then tunes the wars so the world stops drifting toward more collapses.

## How it was measured

- **The sim.** A throwaway vitest file drove the playtest harness: `newGame(seed)` with `generate({ kingdomCount: 10 })` on an 80×60 world, then `endDay` for 1,080 days.
  - The player was kept fed every day: health 100, 40 bread, no starvation. Without that, the harness stops the day turn, and the markets with it.
  - Each seed ran in its own process, so one seed's RNG stream never touched another's.
- **What it recorded.**
  - Realms alive at the end (out of 10).
  - Wars declared, rebellions, and each fall (day, conqueror).
  - Each realm's stability terms from `KingdomStability.target`, every week.
- **Readers switched off one at a time.** Each was monkeypatched out in a code snapshot, so the rest of the game was unchanged:
  - `col`: `EconomyIndex.stabilityMod`, the 'Cost of living' term.
  - `warconf`: `EconomyIndex.warConfidence`.
  - `tpall`: the whole of `TradePolicy.processDay`: tariffs, embargoes, treaties, the 'Trade policy' term.
  - `hint`: `Concessions.processDay`, the hinterland.
  - `fin`: `Coinage.stabilityMod`, the 'Crown finances' term.
  - `allecon`: col, warconf, tpall and hint together.
- **Seeds.** 7–16 for the attribution, 7–26 for before and after.

## What drives the collapses

**Not the economy readers.** On seeds 7–16 (100 realms):

| Run | Alive | Falls | Wars |
|---|---|---|---|
| Baseline | 84 | 34 | 616 |
| All economy readers off (`allecon`) | 83 | 28 | 624 |
| Trade policy off (`tpall`) | 85 | 26 | 582 |
| Cost of living and war confidence off (`colwar`) | 82 | 29 | 618 |
| Hinterland off (`hint`) | 82 | 28 | 578 |
| Crown finances off (`fin`) | 83 | 36 | 587 |

- Every variant lands within ±2 realms of the baseline. Each seed's own count barely moves between variants: seed 12 keeps 6 or 7, seed 7 always keeps 10. Survival is set by each map's geography and its first wars, not by these terms.
- The terms are small averaged over all realm-weeks:

| Term | Average |
|---|---|
| Cost of living | −0.1 to −0.3 |
| Trade policy | +0.8 to +0.9 |
| Crown finances | −0.8 to −1.0 |

  Cost of living reaches its −6 cap only in a realm already hungry and at war.
- The 45 → 43–44 drift on seeds 7–11 is within run-to-run noise. A seed's count has a spread of about 1 realm, so the 50-realm sum has a spread of about 2.5. On seeds 7–11 the baseline was 44.

**The real cause: tiny realms with no protection.**
- Generated realms start with 1–3 towns.
- A realm falls when its last town does. That can happen at the first battle won on its capital: realms fell on days 8, 10, 15 and 17.
- 16 of the baseline's 61 falls (seeds 7–26) came within the first 60 days, before any economy system had measured anything.
- Most other falls were the same one- or two-town realms taken later in the run.

## What changed (`world/kingdomAI.js`, `KingdomAI.WAR`)

- **The first peace** (`foundingPeace: [45, 120]`). No realm declares war on another before a day between 45 and 120. The day is a hash of the pair, so the first wars come staggered and no RNG is drawn. The young realms found their villages first.
- **The last stand** (`lastStand: 1.5`). A realm's last town is defended at ×1.5 on top of its walls (capital ×1.5).
- **Capitulation** (`capitulate: 0.8`, `capitulateTribute: 0.4`).
  - When the attacker wins the battle for a realm's last town, the realm usually capitulates. The chance is 0.8 × (1 − 0.3 × the attacker's ambition + 0.2 × its honour), at most 0.9.
  - It pays 40% of its treasury, the war ends with the attacker as victor, and the usual truce follows.
  - Otherwise the town falls and the realm with it.

Tuning steps (seeds 7–16): last stand 1.3 with capitulation 0.5 gave 87; 1.4 with 0.7 gave 87; 1.5 with 0.8 gave 88; adding the first peace gave 91.

## Result (seeds 7–26, 1,080 days, with this pass's economy changes)

| | Alive (of 200) | Seeds 7–11 (of 50) | Falls | Falls in the first 60 days | Wars declared |
|---|---|---|---|---|---|
| Before | 166 (83%) | 44 | 61 | 16 | 978 (7–84 per run) |
| After | **181 (90.5%)** | **47** | 27 | 0 | 1,050 (2–96 per run) |

| Alive per seed | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 10 | 8 | 9 | 8 | 9 | 6 | 8 | 8 | 9 | 9 | 9 | 10 | 9 | 8 | 10 | 8 | 7 | 9 | 6 | 6 |
| After | 10 | 9 | 9 | 9 | 10 | 8 | 9 | 9 | 10 | 8 | 10 | 10 | 10 | 10 | 10 | 9 | 7 | 10 | 6 | 8 |

- Wars still happen, a few more than before: realms that capitulate live on to fight again.
- Realms still fall: 27 falls, and 19 realms are gone at the end. Restorations still bring some back.
- Seed 25 keeps 6. Its small realms sit beside one dominant, ambitious neighbour.
- Stability is unchanged: 7.4% of realm-weeks below the unrest line, before and after.

## Re-measuring

- Put a throwaway test in `src/__tests__/tmp/`. It should loop `newGame(seed)` and, each day, feed the player and call `endDay`, then count `world.kingdoms.filter(k => k.isAlive)`.
- `world.events` resets every day, so accumulate it day by day.
- Run each seed in its own process, in parallel: about 100 s per seed for 1,080 days.
- Delete the tmp directory before `npm test`.
- Compare at least 10 seeds. Five seeds can't tell a 2-realm change from noise.
