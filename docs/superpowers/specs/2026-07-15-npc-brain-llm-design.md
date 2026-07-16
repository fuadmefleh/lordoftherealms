# The NPC Brain — Local LLM (Design Spec)

**Date:** 2026-07-15
**Status:** Approved direction (from the dynasty brainstorm); ready to build.
**Spec:** 2 of 2. Builds on Spec 1 (The House) via the `House.setBrain()` seam.

---

## 1. Goal

Give the game's *major* characters a living voice and smarter, in-character
behaviour using a **local llama.cpp** model — without breaking determinism,
blocking the game loop, or requiring the LLM to be present at all.

Authority level (decided in the brainstorm): **voice + proposals.** The LLM
narrates and proposes actions from a fixed menu; the deterministic engine
validates and executes. The simulation stays authoritative and testable.

## 2. Key architectural decisions

- **Renderer-side HTTP, not Electron IPC.** Electron runs with
  `contextIsolation: true` and no preload, and the game already runs in a plain
  browser too. So the brain talks to a local **`llama-server`** directly over
  `fetch('http://127.0.0.1:<port>/v1/chat/completions')` (llama.cpp's
  OpenAI-compatible endpoint). This works identically in Electron, the Vite dev
  server, and the web build.
- **Off by default.** The brain is disabled unless the player enables it in
  settings and a server is reachable. The web build, CI, and every test run
  LLM-less. This is what keeps determinism intact.
- **Never blocks the loop.** LLM calls take seconds; the game tick is
  synchronous. So:
  - The **engine seam** (`decideRivalAction`, `narrate`) stays synchronous and
    reads a **cache**. A background async worker fills the cache for major
    characters. Cache miss → deterministic default / templated text.
  - **Dialogue voice** is on-demand async: opening a conversation kicks off a
    request; the line streams in when ready, with a templated fallback shown
    immediately and kept if the model is slow or offline.
- **Tiered ("all NPCs" done sanely).** Only *major* characters get LLM
  attention: rival-House heads, family members holding an office, kingdom
  rulers, and whoever the player is currently talking to. Everyone else keeps
  cheap deterministic behaviour. Plus response caching and per-tick budget caps.
- **Graceful degradation everywhere.** An availability probe gates all calls;
  any error, timeout, or malformed response falls back to the deterministic
  path. The game is fully playable with the model off.

## 3. Determinism & testing (hard rules preserved)

- The LLM lives entirely behind the Spec-1 brain interface. `House._brain`
  stays the deterministic default unless the player opts in at runtime.
- Tests never contact a server: they mock `fetch` to simulate success, offline,
  timeout, and malformed responses, and assert the fallback path. Golden suites
  are unaffected because the LLM is never wired in during tests.
- No new randomness enters the simulation. The LLM only *narrates* and
  *proposes*; the engine still draws every `Utils` RNG value and validates every
  proposal against a fixed menu of legal actions before applying it.

## 4. Components

```
src/systems/llmClient.js   LlmClient  — config, availability probe, chat() over HTTP,
                                        timeout, graceful failure. Zero game deps.
src/systems/npcBrain.js    NpcBrain   — tiering gate, prompt building from House/game
                                        context, JSON proposal parse + validation,
                                        response cache, async populate, and
                                        asHouseBrain() implementing decideRivalAction/
                                        narrate for the Spec-1 seam. Also
                                        generateNpcLine() for dialogue voice.
electron-main.js           (optional) spawn/stop a bundled llama-server child process
                                        when configured; degrade silently if absent.
settings                   'lord_of_realms_settings' gains: llmEnabled, llmEndpoint,
                                        llmModel, llmTemperature.
```

### LlmClient
- `configure({ endpoint, model, temperature, timeoutMs })`.
- `isAvailable()` — cached health probe (`GET /health` or a cheap `/models`),
  re-checked on an interval; returns false fast when offline.
- `chat(messages, opts)` → `{ ok, text }` or `{ ok:false, reason }`. Wraps
  `fetch` with an `AbortController` timeout. Never throws.

### NpcBrain
- `isMajor(entity, game)` — the tiering gate.
- `asHouseBrain()` → an object with the synchronous `decideRivalAction(ctx)` and
  `narrate(kind, ctx)` the House engine expects. Both read the cache and, on a
  miss, enqueue an async job; they return the deterministic default / null
  meanwhile, so behaviour is identical when the model is off or cold.
- **Proposals from a fixed menu:** the async job asks the model for a JSON object
  constrained to allowed fields (e.g. `{ act: boolean, type: "claim_threat" }`).
  `_validateProposal` rejects anything off-menu, out-of-range, or unparseable →
  fall back. The engine, not the model, executes.
- `generateNpcLine(npc, context)` → Promise of a line for dialogue, cached, with
  a templated fallback.

## 5. Prompts (voice + proposals)

Prompts are assembled from serializable state the House already exposes — the
generational **chronicle** (`house.history`), rival **feud** state, member
**loyalty/role**, plus the target character's traits and relationship to the
player. A tight system prompt fixes tone and forbids meta-talk; the user message
carries the context and, for proposals, the exact JSON schema and legal options.
No game object references leave the process — only plain text.

## 6. Scope & non-goals for Spec 2

**In:** LlmClient, NpcBrain (tiering, cache, prompts, proposal validation, the
House-seam adapter), dialogue-voice generation with fallback, settings, and
Electron server-spawn scaffolding.

**Deferred:** streaming token-by-token UI; model download/management UX; giving
the LLM authority beyond voice+proposals; per-NPC long-term memory beyond the
House chronicle; multi-model routing. These can follow once the core proves out.

## 7. Validation note

Real inference quality can only be judged with an actual `llama-server` + model
running locally — that is the player's to verify. Everything in this spec is
built and tested **offline-safe**: the architecture, caching, tiering, proposal
validation, fallbacks, and wiring are exercised with a mocked transport, and the
game is fully playable with the model absent.
