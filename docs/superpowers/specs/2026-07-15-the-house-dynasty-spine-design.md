# The House — Dynasty Spine (Design Spec)

**Date:** 2026-07-15
**Status:** Approved design, ready for implementation planning
**Spec:** 1 of 2 (this) — the deterministic dynasty spine. Spec 2 (the local
llama.cpp "NPC Brain") layers on top and is designed separately.

---

## 1. Problem

*Lord of the Realms* has 31 documented systems yet **feels shallow**. The player
who reported it confirmed all four symptoms at once: systems don't interact,
there's no tension or stakes, decisions are shallow, and there's no long-term
pull.

Diagnosis — one root cause, not four problems: **nearly every system outputs the
same fungible resource (gold), and gold buys everything.** With one currency and
no directed opposition:

- Systems can't interact — they're 31 parallel pipes into one bucket, not a web.
- Nothing creates tension — the bucket only fills; world events are random
  *weather*, not an antagonist with intent.
- Decisions are shallow — one currency + no scarcity ⇒ a dominant strategy and
  no real opportunity cost.
- No pull — "rise from nothing to rule" is stated but nothing in the loop
  escalates toward it. Day 500 plays like day 50 with bigger numbers.

The fix is **not** a 32nd system. It's a **spine plus scarcity** so the existing
31 systems feed *each other* and start feeling *threatened*.

## 2. The chosen spine: Dynasty & legacy

The dominant feeling of the game should be **dynasty & legacy** — an arc that
spans generations, where each character is one chapter and the pull is what you
leave behind. The scarce non-gold currency writes itself: **the standing of your
bloodline, spent against the pressure of your own mortality.**

### Key discovery that shapes the design

NPC kingdoms **already run a full dynasty model** (`src/world/characters/`):
`characterData.dynasty` with a **`prestige`** field, bloodline, members, ruler,
spouse, children, **advisors with assignable roles**, traits, loyalty,
`maxLifespan`, aging, illness, natural death, **succession crises** (civil war /
pretender / nobles' revolt / regency), and diplomatic marriages between houses.

The **player**, by contrast, is a lone character with `renown` and a thin "heir
inherits 75% gold" rule. That asymmetry is the opportunity: **we promote the
player to a first-class House inside the dynastic system the NPCs already
inhabit.** Less new code, consistent behavior, and rival Houses become
meaningful because they are peers playing the same game as the player.

## 3. Goals & non-goals

**Goals**
- Turn the player into the persistent **head of a House** that outlives
  individual characters.
- Introduce **Prestige**, a scarce dynastic currency fed by *every* existing
  system and spent on things gold cannot buy.
- Give the game a **multi-generational pull** (Ambitions) and **directed
  opposition** (rival Houses).
- Make **succession** a real event with stakes, replacing the flat gold-percent
  handoff.
- Do all of this **deterministically and testably**, honoring the repo's two
  hard rules.

**Non-goals (deferred)**
- The local LLM / "NPC Brain" — that is **Spec 2** (authority level already
  decided: *voice + proposals*; LLM suggests from a validated menu, the
  deterministic engine stays authoritative). Spec 1 only leaves clean seams.
- Cadet branches / multiple simultaneous player Houses.
- Deep intrigue plots, scheming trees, dialogue-driven conspiracies.
- Naval dynasties or any brand-new subsystem.

## 4. The six pillars

### Pillar 1 — The House entity *(the container)*

A persistent `House` object that survives the death of any single character:

- **Identity** — surname chosen at founding (→ "House Ashborne"), motto, sigil
  (color/icon), founding day.
- **Prestige** — the dynastic currency (Pillar 2).
- **Members** — the family tree of living relatives, generated/managed via the
  existing `Characters` model. Each has age, traits, skills, loyalty, and an
  optional role.
- **Head** — the currently-played character. On death, headship passes to the
  heir and play continues.
- **Holdings ledger** — the assets that transfer on succession: properties,
  houses, titles, religion/holy sites, army. (Already tracked on the player;
  now framed as House assets.)
- **History chronicle** — an append-only log of notable deeds per generation.
  Feeds legacy scoring now and the LLM's memory in Spec 2.

### Pillar 2 — Prestige: the connective currency *(scarcity & tradeoffs)*

A second axis, distinct from gold and from personal `renown`.

- **Sources (every existing system feeds it):** battles won, mercenary
  contracts, titles held, founding a religion, followers gained, artifacts
  reforged, prestigious marriages, quests completed, holding settlements,
  completing Ambition milestones. Military and religion now contribute to the
  *same* dynastic score — that is how they come to relate.
- **Sinks (gold cannot buy these):**
  - Press a **claim** on a title or settlement (legitimize a conquest or
    inheritance).
  - Arrange a **prestigious marriage** (better matches cost Prestige).
  - **Secure a contested succession** (bypass a crisis, install a chosen heir).
  - **Legitimize** an unconventional heir; **call in a favor** from an allied
    House.
- **Decay:** Prestige slowly erodes if the House records no notable deed for a
  configured window — use-it-or-lose-it pressure so you cannot sit on a pile.

**The core tradeoff created:** gold is for *now* (armies, buildings), Prestige
is for the *dynasty* (claims, marriages, succession). Constantly choosing
between enriching the current character and elevating the House *is* the
dynasty fantasy, and it is the opportunity cost the game currently lacks.

### Pillar 3 — Ambitions: the multi-generational pull

The House carries **one active Ambition** — a grand goal spanning one to three
lifetimes, chosen at founding and replaced when fulfilled. Each has
**milestones** (interim rewards + Prestige) and a **capstone** that serves as a
soft win-condition for the run. Starter set:

- **Seat of Power** — hold a throne (form your own kingdom).
- **Bloodline of Kings** — marry your blood into 3 ruling Houses.
- **Faith Eternal** — found a religion + temples across N kingdoms + X
  followers.
- **Merchant Dynasty** — dominate trade (profit + routes + a monopoly).
- **The Great House** — reach a Prestige threshold + N holdings + survive Y
  generations.

Because milestones span generations, the Ambition is **inherited work** — the
heir resumes it. That is "legacy" expressed mechanically, and the reason the
next hour matters more than the last.

### Pillar 4 — Succession with stakes *(the tension)*

Death becomes the game's central pressure rather than a soft handoff.

- **Aging** — the played character ages; past a threshold, stats soften and
  death-chance climbs. Port the NPC `_ageCharacters` logic
  (`src/world/characters/succession.js`) to the player.
- **What can go wrong at death:**
  - **No adult heir** → a **regency** with restricted actions, or **game over**
    if the House has no living blood.
  - **Disputed succession** → a rival House or a passed-over relative presses a
    claim; **spend Prestige to secure it**, or fight and risk **holdings
    fragmenting** (lose some properties/titles).
  - **Inheritance cost** → each succession sheds some gold/holdings — the *real*
    cost that replaces the flat "75% of gold."
- **Grooming (the counter-play):** invest in an heir now — tutor them, assign a
  role, marry them well — for a smoother transition later. The signature dynasty
  tradeoff: spend on the future instead of yourself.

### Pillar 5 — Family roles *(living family — essential slice of "B")*

Relatives become **assignable agents**, mirroring the NPC `advisors` roles that
already exist:

- Appoint a family member as **Steward** (property income), **Marshal** (army),
  **Chancellor** (diplomacy/reputation), **Spymaster** (espionage), or groom
  them as **Heir**.
- Each has traits, skills that scale the bonus, and **loyalty** that drifts
  based on treatment and — critically — whether they are passed over for
  inheritance.
- **Downside seam:** a disloyal, ambitious relative is a claimant-in-waiting.
  Spec 1 provides the deterministic hook (loyalty + ambition thresholds trigger
  a claim at succession). Dialogue and scheming are Spec 2's job.

### Pillar 6 — Rival Houses *(the antagonist)*

Select 2–3 existing kingdom dynasties (or seed a couple of independent noble
Houses) as **persistent rivals** that:

- Grow across the player's generations and **remember** — a running feud score
  with the player's House.
- Chase the same Prestige prizes (titles, holy sites, marriages).
- Exploit the player's weakest moment — succession — to press a claim.

In Spec 1 they behave deterministically (feud + ambition driven). Spec 2's LLM
gives them a voice and smarter proposals. This is the directed opposition the
game currently lacks.

## 5. How the six pillars resolve the four symptoms

| Symptom | Resolved by |
|---|---|
| Systems don't interact | Prestige (every system feeds one dynastic score) + Ambitions (goals that require multiple systems) |
| No tension / stakes | Succession-with-stakes + Rival Houses (a remembering antagonist) + Prestige decay |
| Shallow decisions | Gold-vs-Prestige opportunity cost + grooming (now vs. future) + heir/loyalty tradeoffs |
| No long-term pull | Multi-generational Ambitions + inherited, unfinished work |

## 6. Architecture & integration (honors CLAUDE.md)

- **New system module:** `src/systems/house.js` (barrel-exported via the
  `systems` `index.js`). No import-time side effects. Explicit
  `initialize(player, world)` and a `processDay(world, player)`-style daily
  tick, called from the game loop like the other systems.
- **Reuse, don't reinvent:** generate House members with the existing
  `src/world/characters/*` model; reuse the `dynasty` object shape (it already
  carries `prestige`, `bloodline`, `members`). Reuse the advisor-role concept
  for family roles and the `_ageCharacters` / `handleSuccession` logic as the
  template for the player's own aging and succession.
- **Player state:** add a `house` reference on `src/player/core/state.js`. The
  player's existing `renown` stays as *personal fame*; **Prestige is a distinct
  House-level axis** — do not merge them.
- **Determinism (hard rule #2):** all randomness via `Utils`
  (`setSeed`/`random`/`randInt`). No `Math.random()`.
- **No domain globals (hard rule #1):** thread `game` / `world` / `player` /
  `day` as explicit parameters. No bare/`window.game` reads in
  `core`/`world`/`systems`/`player`.
- **Save/Load:** extend `src/systems/saveLoad.js` to serialize and restore the
  House (identity, Prestige, members, roles, Ambition + progress, holdings
  ledger, history chronicle, rival feud scores).
- **Golden tests:** these characterization snapshots freeze exact output for a
  fixed seed. New deterministic outputs (member generation, Prestige awards,
  succession results) will change some snapshots — update them intentionally
  and document why.

### Seams reserved for Spec 2 (the LLM "NPC Brain")

Design these as plain serializable data now so Spec 2 plugs in without rework:

- **House `history` chronicle** and **member/rival opinion + feud state** — the
  read-context the LLM will consume.
- **Claim / succession / rival-action hooks** — the points where, in Spec 2, the
  LLM returns a *proposal from a fixed menu of valid actions* that the
  deterministic engine validates and executes (authority level: *voice +
  proposals*). In Spec 1 these hooks are driven by deterministic rules; the
  interface shape should not assume determinism so the LLM can slot in.
- Keep every LLM-facing decision **behind an interface with a deterministic
  default implementation**, so tests always run with the LLM stubbed and the
  golden suite stays valid.

## 7. Scope guardrails for Spec 1

- One active Ambition at a time.
- ~5 family roles (Steward, Marshal, Chancellor, Spymaster, Heir) — not a full
  court.
- Rival Houses stay **deterministic** — no LLM, no deep scheming.
- Defer: cadet branches, multiple player Houses, intrigue plots, naval
  dynasties.
- No new fungible resource beyond Prestige.

## 8. Testing

- Unit tests (vitest/node) for: Prestige award/spend/decay math; Ambition
  milestone/capstone evaluation; aging + death-chance; succession outcomes
  (normal / no-heir / disputed / fragmentation); family-role bonus application;
  loyalty drift and claim-trigger thresholds; rival feud accrual.
- All tests set a seed and assert reproducible outcomes.
- Update affected **golden** snapshots deliberately; leave a note in the test or
  PR describing the intended output change.
- Run `npm run lint && npm test` before finishing — lint failure on domain
  globals or raw randomness blocks the change by design.

## 9. Follow-on specs

- **Spec 2 — The NPC Brain:** local `llama.cpp` (`llama-server`) managed by the
  Electron host, reached over `localhost` HTTP; **voice + proposals** authority;
  **tiered** (only major characters — family, rival heads, rulers, whoever the
  player is engaging — get LLM brains, on-demand and prioritized); response
  caching; async (never blocks the game loop); **graceful degradation** to
  templated text when the server is offline; web build runs LLM-less.
- **Spec 3 (optional) — Deepened family & intrigue:** expand Pillar 5 into full
  court drama once the House and the Brain both exist.
