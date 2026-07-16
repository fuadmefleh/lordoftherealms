# The NPC Brain — Local LLM (Implementation Plan)

**Design:** `docs/superpowers/specs/2026-07-15-npc-brain-llm-design.md`
**Builds on:** Spec 1's `House.setBrain()` / `House._brain` seam.

## Principles
- Off by default; every test and the web build run LLM-less.
- Never throw, never block the loop; any failure → deterministic/template path.
- LLM only narrates + proposes; engine draws all RNG and validates all proposals.
- All new code honours the two hard rules (Utils RNG, no domain globals).
- Each phase ends green (`npm run lint && npm test`).

## Phase A — LlmClient (`src/systems/llmClient.js`)
- `configure`, `isAvailable` (cached probe), `chat(messages, opts)` over
  `fetch` + `AbortController` timeout; returns `{ok,text}`/`{ok:false,reason}`,
  never throws.
- **Tests** (mock `fetch`): success parse, offline → unavailable, timeout,
  non-200, malformed JSON. All return graceful results.

## Phase B — NpcBrain core (`src/systems/npcBrain.js`)
- `isMajor(entity, game)` tiering gate.
- Response cache with keys derived from context; per-tick budget cap.
- `_buildRivalPrompt`, `_buildNarratePrompt` from House chronicle/feud state.
- `_validateProposal(raw, schema)` — fixed-menu validation.
- `asHouseBrain()` → sync `decideRivalAction`/`narrate` (cache read + async
  populate; deterministic default / null on miss).
- **Tests** (mock LlmClient): cache hit returns model value; miss returns
  default and enqueues; invalid proposal rejected → default; tiering gate;
  disabled brain is inert.

## Phase C — Dialogue voice
- `NpcBrain.generateNpcLine(npc, context)` async, cached, template fallback.
- Wire one entry point in `src/ui/npcDialog/**`: request a line on open, show
  fallback immediately, replace when resolved. Guarded by `llmEnabled`.
- **Tests**: line returned on success; fallback on offline/malformed.

## Phase D — Wiring, settings, Electron
- Settings: `llmEnabled/llmEndpoint/llmModel/llmTemperature` in
  `lord_of_realms_settings`; applied on load; when enabled + available, call
  `House.setBrain(NpcBrain.asHouseBrain())`, else `House.resetBrain()`.
- Settings UI toggle + fields (follow existing settings panel patterns).
- `electron-main.js`: optional `child_process` spawn of `llama-server` from a
  configured binary/model path; stop on quit; silent no-op if unset/missing.
- **Tests**: settings→brain wiring toggles `House._brain`; default path intact.

## Risks
- Can't validate real inference here → build/test offline-safe; the user
  verifies quality with a live server.
- CSP/mixed-content for localhost fetch in the built app — use `127.0.0.1`,
  document any CSP allowance needed.
