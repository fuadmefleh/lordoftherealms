// ============================================
// NPC BRAIN — voice + proposals over a local LLM (Spec 2)
// ============================================
// Sits between the deterministic engine and the LlmClient. Responsibilities:
//   - Tiering: only *major* characters get LLM attention.
//   - Caching + a per-tick concurrency budget so we never flood the model.
//   - Prompt building from the House's serializable state.
//   - Proposal validation: the model may only choose from a fixed menu; anything
//     off-menu is rejected and the deterministic default stands.
//   - asHouseBrain(): a SYNCHRONOUS adapter for the Spec-1 House seam. It reads
//     the cache instantly and enqueues an async job on a miss, so the game tick
//     never blocks and behaviour is identical when the model is off or cold.
//
// Off by default. Determinism is preserved: the LLM only narrates and proposes;
// the engine draws every RNG value and validates every proposal.

import { LlmClient } from './llmClient.js';

const ALLOWED_RIVAL_TYPES = ['claim_threat'];

let enabled = false;
const cache = new Map();      // key -> { kind, value }
const pending = new Map();    // key -> Promise (in-flight async jobs)
const settings = { maxConcurrent: 3, maxCache: 200 };

function cacheSet(key, entry) {
    cache.set(key, entry);
    if (cache.size > settings.maxCache) {
        // Evict oldest insertion.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
}

export const NpcBrain = {

    // ── Lifecycle ───────────────────────────────────────────────

    enable(v) { enabled = !!v; },
    isEnabled() { return enabled; },

    /** Configure the transport + brain tuning. */
    configure(opts = {}) {
        const { maxConcurrent, maxCache, ...clientOpts } = opts;
        if (maxConcurrent != null) settings.maxConcurrent = maxConcurrent;
        if (maxCache != null) settings.maxCache = maxCache;
        if (Object.keys(clientOpts).length) LlmClient.configure(clientOpts);
    },

    // ── Tiering ─────────────────────────────────────────────────

    /** Only major characters warrant LLM attention. */
    isMajor(entity) {
        if (!entity) return false;
        if (entity.isRuler || entity.isRival || entity.major) return true;
        const type = (entity.type || '').toLowerCase();
        return ['noble', 'lord', 'ruler', 'priest'].includes(type);
    },

    // ── House-seam adapter (synchronous) ────────────────────────

    /** An object shaped for House.setBrain(): sync decide/narrate that read the
     *  cache and populate it asynchronously. */
    asHouseBrain() {
        return {
            decideRivalAction: (ctx) => NpcBrain._decideRivalActionSync(ctx),
            narrate: (kind, ctx) => NpcBrain._narrateSync(kind, ctx),
        };
    },

    _defaultRivalDecision(ctx) {
        const feud = (ctx.rival && ctx.rival.feud) || 0;
        const cfg = ctx.config || {};
        const act = feud >= (cfg.rivalClaimFeud || 60) && ctx.roll < feud / 200;
        return { act, type: 'claim_threat' };
    },

    _decideRivalActionSync(ctx) {
        const fallback = NpcBrain._defaultRivalDecision(ctx);
        if (!enabled) return fallback;
        const key = NpcBrain._rivalKey(ctx);
        const cached = cache.get(key);
        if (cached && cached.kind === 'rival' && cached.value) return cached.value;
        NpcBrain._enqueue(key, () => NpcBrain._genRival(ctx, key));
        return fallback;
    },

    _narrateSync(kind, ctx) {
        if (!enabled) return null;
        const key = NpcBrain._narrateKey(kind, ctx);
        const cached = cache.get(key);
        if (cached && cached.kind === 'narrate') return cached.value;
        NpcBrain._enqueue(key, () => NpcBrain._genNarrate(kind, ctx, key));
        return null;
    },

    // ── Async generation ────────────────────────────────────────

    _enqueue(key, fn) {
        if (!enabled) return;
        if (pending.has(key)) return;
        if (pending.size >= settings.maxConcurrent) return; // per-tick budget cap
        const p = Promise.resolve().then(fn).catch(() => {}).finally(() => pending.delete(key));
        pending.set(key, p);
    },

    async _genRival(ctx, key) {
        if (!enabled || !(await LlmClient.isAvailable())) return;
        const res = await LlmClient.chat(NpcBrain._buildRivalPrompt(ctx), { maxTokens: 60, temperature: 0.2 });
        if (!res.ok) return;
        const proposal = NpcBrain._validateRival(res.text);
        if (proposal) cacheSet(key, { kind: 'rival', value: proposal });
    },

    async _genNarrate(kind, ctx, key) {
        if (!enabled || !(await LlmClient.isAvailable())) return;
        const res = await LlmClient.chat(NpcBrain._buildNarratePrompt(kind, ctx), { maxTokens: 60 });
        if (!res.ok) return;
        const line = NpcBrain._sanitizeLine(res.text);
        if (line) cacheSet(key, { kind: 'narrate', value: line });
    },

    // ── Dialogue voice (on-demand async) ────────────────────────

    /** Generate a spoken line for an NPC. Resolves the model's line, a cached
     *  one, or context.fallback (used immediately by the UI when offline/slow). */
    async generateNpcLine(npc, context = {}) {
        const fallback = context.fallback != null ? context.fallback : null;
        if (!enabled) return fallback;
        const key = NpcBrain._lineKey(npc, context);
        const cached = cache.get(key);
        if (cached && cached.kind === 'line') return cached.value;
        if (!(await LlmClient.isAvailable())) return fallback;
        const res = await LlmClient.chat(NpcBrain._buildLinePrompt(npc, context), { maxTokens: 80 });
        if (!res.ok) return fallback;
        const line = NpcBrain._sanitizeLine(res.text);
        if (!line) return fallback;
        cacheSet(key, { kind: 'line', value: line });
        return line;
    },

    // ── Prompt building ─────────────────────────────────────────

    _recentChronicle(house, n = 4) {
        return ((house && house.history) || []).slice(-n).map(h => `- ${h.text}`).join('\n');
    },

    _buildRivalPrompt(ctx) {
        const house = ctx.house || {};
        const rival = ctx.rival || {};
        return [
            { role: 'system', content: 'You role-play a rival noble House in a medieval strategy game. Reply with ONLY a JSON object, no prose.' },
            { role: 'user', content:
                `Your House feuds with ${house.name || 'the player\'s House'} (feud ${rival.feud || 0}/100).\n`
                + `Recent events:\n${NpcBrain._recentChronicle(house)}\n\n`
                + `Decide whether to threaten a claim on their holdings now. Respond as JSON: `
                + `{"act": true|false, "type": "claim_threat"}.` },
        ];
    },

    _buildNarratePrompt(kind, ctx) {
        const house = ctx.house || {};
        const rival = ctx.rival || {};
        return [
            { role: 'system', content: 'You are a terse medieval chronicler. Reply with ONE vivid sentence, no quotes, no preamble.' },
            { role: 'user', content:
                `Event: ${kind}. Rival House ${rival.name || 'a rival'} menaces ${house.name || 'the House'}.\n`
                + `Recent events:\n${NpcBrain._recentChronicle(house)}\n\nWrite the chronicle line.` },
        ];
    },

    _buildLinePrompt(npc, context) {
        const name = (npc && (npc.firstName || npc.name)) || 'the stranger';
        const disposition = context.disposition != null ? context.disposition : 'neutral';
        const topic = context.topic || 'a greeting';
        const traits = (npc && npc.traits ? npc.traits.map(t => t.name || t).join(', ') : '') || 'unremarkable';
        return [
            { role: 'system', content: 'You voice a medieval townsperson. Reply with ONE short line of in-character dialogue, no quotes, no narration.' },
            { role: 'user', content: `You are ${name} (${traits}), feeling ${disposition} toward the player. Say ${topic}.` },
        ];
    },

    // ── Validation & sanitizing ─────────────────────────────────

    _extractJson(text) {
        if (typeof text !== 'string') return null;
        const s = text.indexOf('{');
        const e = text.lastIndexOf('}');
        if (s < 0 || e <= s) return null;
        try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
    },

    /** Validate a rival proposal against the fixed menu. Returns null if off-menu. */
    _validateRival(text) {
        const obj = NpcBrain._extractJson(text);
        if (!obj || typeof obj !== 'object') return null;
        if (typeof obj.act !== 'boolean') return null;
        const type = obj.type || 'claim_threat';
        if (!ALLOWED_RIVAL_TYPES.includes(type)) return null;
        return { act: obj.act, type };
    },

    _sanitizeLine(text) {
        if (typeof text !== 'string') return null;
        let s = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').split('\n')[0].trim();
        if (!s) return null;
        if (s.length > 240) s = s.slice(0, 240);
        return s;
    },

    // ── Keys ────────────────────────────────────────────────────

    _rivalKey(ctx) {
        const r = ctx.rival || {};
        return `rival:${r.kingdomId || r.name || '?'}:${r.feud || 0}`;
    },
    _narrateKey(kind, ctx) {
        const r = ctx.rival || {};
        const h = ctx.house || {};
        return `narrate:${kind}:${r.name || ''}:${h.generation || 0}`;
    },
    _lineKey(npc, ctx) {
        return `line:${(npc && (npc.id || npc.firstName)) || 'npc'}:${ctx.topic || 'greet'}`;
    },

    // ── Test helpers ────────────────────────────────────────────

    _flush() { return Promise.allSettled([...pending.values()]); },
    _cacheSize() { return cache.size; },
    _reset() {
        enabled = false;
        cache.clear();
        pending.clear();
        settings.maxConcurrent = 3;
        settings.maxCache = 200;
    },
};
