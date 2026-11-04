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
// noThink: append Qwen3's `/no_think` soft-switch to prompts. These tasks are
// format-constrained (JSON / one line) and don't need chain-of-thought, and
// leaving thinking on can consume the whole token budget before the answer.
const settings = { maxConcurrent: 3, maxCache: 200, noThink: true };

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
        const { maxConcurrent, maxCache, noThink, ...clientOpts } = opts;
        if (maxConcurrent != null) settings.maxConcurrent = maxConcurrent;
        if (maxCache != null) settings.maxCache = maxCache;
        if (noThink != null) settings.noThink = !!noThink;
        if (Object.keys(clientOpts).length) LlmClient.configure(clientOpts);
    },

    /** Append Qwen3's /no_think switch to a prompt when enabled. */
    _noThink(content) {
        // (a local Qwen-style switch; OpenAI models think by reasoning_effort, systems/llmClient.js)
        if (LlmClient.getConfig().provider === 'openai') return content;
        return settings.noThink ? `${content}\n/no_think` : content;
    },

    /** Strip reasoning blocks (e.g. Qwen3 <think>…</think>) some models emit
     *  before their answer, including an unclosed trailing block. */
    _stripReasoning(text) {
        if (typeof text !== 'string') return text;
        return text
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*$/i, '')
            .trim();
    },

    /**
     * Apply persisted game settings: configure the transport, enable/disable the
     * brain, and wire it into (or out of) the House seam. `House` is injected so
     * this module stays decoupled and testable. Returns whether it ended enabled.
     */
    applyFromSettings(s = {}, House) {
        const clientOpts = {};
        if (s.llmProvider) clientOpts.provider = s.llmProvider;
        if (s.llmApiKey != null) clientOpts.apiKey = String(s.llmApiKey || '').trim();
        if (s.llmEndpoint) clientOpts.endpoint = s.llmEndpoint;
        if (s.llmModel) clientOpts.model = s.llmModel;
        if (s.llmTemperature != null && s.llmTemperature !== '') clientOpts.temperature = Number(s.llmTemperature);
        if (Object.keys(clientOpts).length) NpcBrain.configure(clientOpts);

        const on = !!s.llmEnabled;
        NpcBrain.enable(on);
        if (House && typeof House.setBrain === 'function') {
            if (on) House.setBrain(NpcBrain.asHouseBrain());
            else House.resetBrain();
        }
        return on;
    },

    /**
     * Probe the server and send a one-word test query using the given (or
     * current) transport settings. Configures the client as a side effect so a
     * successful test leaves it ready. Never throws. Returns:
     *   { ok:true,  detail:<model reply> }
     *   { ok:false, stage:'health'|'query', detail:<reason> }
     */
    async testConnection(opts = {}) {
        const clientOpts = {};
        if (opts.provider) clientOpts.provider = opts.provider;
        if (opts.apiKey != null) clientOpts.apiKey = String(opts.apiKey || '').trim();
        if (opts.endpoint) clientOpts.endpoint = opts.endpoint;
        if (opts.model) clientOpts.model = opts.model;
        if (opts.temperature != null && opts.temperature !== '') clientOpts.temperature = Number(opts.temperature);
        if (Object.keys(clientOpts).length) LlmClient.configure(clientOpts);

        const available = await LlmClient.isAvailable(true);
        if (!available) {
            const p = LlmClient.lastProbe();
            const state = p.state || 'unreachable';
            return {
                ok: false, stage: 'health', state,
                detail: p.detail || `no response from ${LlmClient.getConfig().endpoint}`,
                hint: (LlmClient.getConfig().provider === 'openai' && (state === 'unreachable' || state === 'timeout'))
                    ? NpcBrain.HINTS.openaiUnreachable
                    : NpcBrain.HINTS[state] || NpcBrain.HINTS.unreachable,
            };
        }
        const res = await LlmClient.chat(
            [{ role: 'user', content: NpcBrain._noThink('Reply with exactly one short word to confirm you are working.') }],
            { maxTokens: 64, temperature: 0 },
        );
        if (!res.ok) return { ok: false, stage: 'query', detail: res.reason };
        return { ok: true, detail: NpcBrain._sanitizeLine(res.text) || res.text };
    },

    /** What to try next, by the health probe's state (shown under a failed test). */
    HINTS: {
        unreachable: 'Start llama-server (e.g. "llama-server -m your-model.gguf --port 8080") and check the endpoint address and port match.',
        timeout: 'The server is slow to answer — it may be busy or still starting. Wait a moment and test again.',
        loading: 'llama-server is running but still loading the model. Wait for it to finish, then test again.',
        error: 'Something answered, but not like llama-server. Check the endpoint points at llama-server\'s port.',
        openaiUnreachable: 'Could not reach api.openai.com: check your internet connection (and that nothing blocks it).',
        nokey: 'Paste your OpenAI API key (platform.openai.com → API keys) into the API Key box.',
        badkey: 'OpenAI turned the key down: check it was copied whole and is still active.',
        nomodel: 'Check the model name (e.g. gpt-6-luna) and that your OpenAI account can use it.',
    },

    /**
     * Where the brain stands, for the settings status line (no network call):
     * { enabled, state: 'off'|'unknown'|'ready'|'loading'|'unreachable'|'timeout'|'error',
     *   detail, checkedAt }. `unknown` = on, but not probed yet.
     */
    /** Probe the server now (only when the brain is on) and return status(). Never throws. */
    async refreshStatus() {
        if (enabled) await LlmClient.probe();
        return NpcBrain.status();
    },

    status() {
        const p = LlmClient.lastProbe();
        if (!enabled) return { enabled: false, state: 'off', detail: 'NPCs speak their written lines.', checkedAt: p.checkedAt };
        if (!p.state) return { enabled: true, state: 'unknown', detail: 'Not checked yet.', checkedAt: p.checkedAt };
        return { enabled: true, state: p.state, detail: p.detail, checkedAt: p.checkedAt };
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
            chooseErrand: (ctx) => NpcBrain._chooseFromMenuSync('errand', ctx),
            chooseScheme: (ctx) => NpcBrain._chooseFromMenuSync('scheme', ctx),
        };
    },

    // ── Proposal menus (rival heads) ────────────────────────────
    //
    // The engine hands the brain a menu of only the moves it can carry out
    // right now (ctx.options: ids — for an errand, those worth anything today;
    // for a plot, the eligible scheme types) and the deterministic pick it
    // would make itself (ctx.fallback). The model may only answer with one of
    // the ids; anything else is thrown away. The engine re-checks the answer
    // against its menu before acting on it, so a stale cached pick is harmless.

    _menuIds(ctx) {
        return ((ctx && ctx.options) || []).map(o => (typeof o === 'string' ? o : o && o.id)).filter(Boolean);
    },

    _chooseFromMenuSync(kind, ctx) {
        const ids = NpcBrain._menuIds(ctx);
        const fallback = ctx && ctx.fallback != null ? ctx.fallback : ids[0];
        if (!enabled || ids.length < 2) return fallback;
        const key = NpcBrain._menuKey(kind, ctx, ids);
        const cached = cache.get(key);
        if (cached && cached.kind === kind && ids.includes(cached.value)) return cached.value;
        NpcBrain._enqueue(key, () => NpcBrain._genMenuChoice(kind, ctx, ids, key));
        return fallback;
    },

    async _genMenuChoice(kind, ctx, ids, key) {
        if (!enabled || !(await LlmClient.isAvailable())) return;
        const res = await LlmClient.chat(NpcBrain._buildMenuPrompt(kind, ctx), { maxTokens: 60, temperature: 0.3 });
        if (!res.ok) return;
        const pick = NpcBrain._validateMenuChoice(res.text, ids);
        if (pick) cacheSet(key, { kind, value: pick });
    },

    /** The model's pick, if it names exactly one id on the menu (JSON {"choice": id} or a bare id). */
    _validateMenuChoice(text, ids) {
        const obj = NpcBrain._extractJson(text);
        let pick = obj && typeof obj === 'object' ? (obj.choice || obj.action || obj.errand || obj.scheme) : null;
        if (typeof pick !== 'string') {
            const cleaned = NpcBrain._stripReasoning(text);
            pick = typeof cleaned === 'string' ? cleaned.trim().replace(/^["'`]+|["'`.]+$/g, '') : null;
        }
        if (typeof pick !== 'string') return null;
        pick = pick.trim().toLowerCase();
        return ids.find(id => id.toLowerCase() === pick) || null;
    },

    _buildMenuPrompt(kind, ctx) {
        const rival = ctx.rival || {};
        const house = ctx.house || {};
        const menu = ((ctx && ctx.options) || []).map((o) => {
            if (typeof o === 'string') return `- ${o}`;
            return `- ${o.id}${o.about ? `: ${o.about}` : ''}`;
        }).join('\n');
        const memories = NpcBrain._memoryText(typeof ctx.memories === 'function' ? ctx.memories() : ctx.memories);
        const who = ctx.self ? `${ctx.self}\n` : '';
        const ask = kind === 'scheme'
            ? `Choose which plot to pay for against ${house.name || 'the player\'s House'}.`
            : 'Choose what you set out to do next.';
        return [
            { role: 'system', content: 'You play the head of a rival noble House in a medieval strategy game. You may only pick from the menu given. Reply with ONLY a JSON object, no prose.' },
            { role: 'user', content: NpcBrain._noThink(
                `${who}You are of ${rival.name || 'a rival House'}; your feud with ${house.name || 'the player\'s House'} stands at ${Math.round(rival.feud || 0)}/100.\n`
                + (memories ? `What you remember of them: ${memories}\n` : '')
                + `Recent events:\n${NpcBrain._recentChronicle(house)}\n\n`
                + `${ask} The menu:\n${menu}\n\nRespond as JSON: {"choice": "<one id from the menu>"}.`) },
        ];
    },

    _menuKey(kind, ctx, ids) {
        const r = (ctx && ctx.rival) || {};
        const feud = Math.round((r.feud || 0) / 10);
        return `${kind}:${r.kingdomId || r.name || '?'}:${ctx.head || ''}:${feud}:${ctx.mood || ''}:${ids.slice().sort().join(',')}`;
    },

    /** Memories (strings, or { text } / { label }) as one prompt line, strongest first, capped. */
    _memoryText(list, n = 5) {
        if (!Array.isArray(list) || !list.length) return '';
        return list.map(m => (typeof m === 'string' ? m : m && (m.text || m.label))).filter(Boolean).slice(0, n).join('; ');
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

    /**
     * Generate a spoken line for an NPC. Resolves the model's line, a cached
     * one, or context.fallback (used immediately by the UI when offline/slow).
     * context: { topic, disposition, fallback, worldContext, memories
     * (what this NPC remembers of the player — strings or { text }, strongest
     * first), onPartial(textSoFar) }. With onPartial the line is streamed and
     * onPartial is called as it grows (reasoning blocks hidden); a server that
     * can't stream answers whole, and the caller sees no difference.
     */
    async generateNpcLine(npc, context = {}) {
        const fallback = context.fallback != null ? context.fallback : null;
        if (!enabled) return fallback;
        const key = NpcBrain._lineKey(npc, context);
        const cached = cache.get(key);
        if (cached && cached.kind === 'line') return cached.value;
        if (!(await LlmClient.isAvailable())) return fallback;
        const prompt = NpcBrain._buildLinePrompt(npc, context);
        let res;
        if (typeof context.onPartial === 'function' && typeof LlmClient.chatStream === 'function') {
            let last = '';
            res = await LlmClient.chatStream(prompt, { maxTokens: 80 }, (soFar) => {
                const shown = NpcBrain._partialLine(soFar);
                if (!shown || shown === last) return;
                last = shown;
                try { context.onPartial(shown); } catch { /* the UI's problem, not the line's */ }
            });
        } else {
            res = await LlmClient.chat(prompt, { maxTokens: 80 });
        }
        if (!res.ok) return fallback;
        const line = NpcBrain._sanitizeLine(res.text);
        if (!line) return fallback;
        cacheSet(key, { kind: 'line', value: line });
        return line;
    },

    // ── The court scribe (on-demand async) ──────────────────────

    /**
     * Rewrite a chapter of the Annals (systems/annals.js) into prose. The
     * template text is the factual source; the model may only retell it.
     * opts: { title, system, user (with {title}/{text}), maxTokens, minLength,
     * maxLength }. Resolves { ok:true, text, cached } or { ok:false, reason }
     * — never throws; the caller keeps the template text on a failure.
     */
    async writeChronicle(sourceText, opts = {}) {
        if (!enabled) return { ok: false, reason: 'disabled' };
        if (typeof sourceText !== 'string' || !sourceText.trim()) return { ok: false, reason: 'nothing to write' };
        const key = `scribe:${NpcBrain._hash(`${opts.title || ''}\n${sourceText}`)}`;
        const cached = cache.get(key);
        if (cached && cached.kind === 'scribe') return { ok: true, text: cached.value, cached: true };
        if (!(await LlmClient.isAvailable())) return { ok: false, reason: 'unavailable' };
        const fill = (t) => String(t || '').replace('{title}', opts.title || 'the chapter').replace('{text}', sourceText);
        const res = await LlmClient.chat([
            { role: 'system', content: opts.system || 'You are a court scribe. Retell the notes as chronicle prose, inventing nothing.' },
            { role: 'user', content: NpcBrain._noThink(fill(opts.user || 'Write the chapter "{title}" from these annals:\n\n{text}')) },
        ], { maxTokens: opts.maxTokens || 700 });
        if (!res.ok) return { ok: false, reason: res.reason };
        let text = NpcBrain._stripReasoning(res.text);
        text = typeof text === 'string' ? text.replace(/^#+\s.*$/gm, '').trim() : '';
        if (text.length < (opts.minLength || 80)) return { ok: false, reason: 'too short' };
        const max = opts.maxLength || 6000;
        if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '') + '…';
        cacheSet(key, { kind: 'scribe', value: text });
        return { ok: true, text, cached: false };
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
            { role: 'user', content: NpcBrain._noThink(
                `Your House feuds with ${house.name || 'the player\'s House'} (feud ${rival.feud || 0}/100).\n`
                + `Recent events:\n${NpcBrain._recentChronicle(house)}\n\n`
                + `Decide whether to threaten a claim on their holdings now. Respond as JSON: `
                + `{"act": true|false, "type": "claim_threat"}.`) },
        ];
    },

    _buildNarratePrompt(kind, ctx) {
        const house = ctx.house || {};
        const rival = ctx.rival || {};
        return [
            { role: 'system', content: 'You are a terse medieval chronicler. Reply with ONE vivid sentence, no quotes, no preamble.' },
            { role: 'user', content: NpcBrain._noThink(
                `Event: ${kind}. Rival House ${rival.name || 'a rival'} menaces ${house.name || 'the House'}.\n`
                + `Recent events:\n${NpcBrain._recentChronicle(house)}\n\nWrite the chronicle line.`) },
        ];
    },

    _buildLinePrompt(npc, context) {
        const name = (npc && (npc.firstName || npc.name)) || 'the stranger';
        const disposition = context.disposition != null ? context.disposition : 'neutral';
        const topic = context.topic || 'a greeting';
        const traits = (npc && npc.traits ? npc.traits.map(t => t.name || t).join(', ') : '') || 'unremarkable';
        // The same world facts the template lines are chosen from (systems/chatter.js)
        const world = context.worldContext ? `\nWhat is going on around you: ${context.worldContext}\nLet it colour what you say.` : '';
        // What this NPC remembers of the player (lord memory, a rival's memory, past talks)
        const memories = NpcBrain._memoryText(context.memories);
        const memory = memories ? `\nWhat you remember of the player: ${memories}.\nYou may let a memory show if it fits; never invent others.` : '';
        const who = context.role || 'a medieval townsperson';
        return [
            { role: 'system', content: `You voice ${who}. Reply with ONE short line of in-character dialogue, no quotes, no narration.` },
            { role: 'user', content: NpcBrain._noThink(`You are ${name} (${traits}), feeling ${disposition} toward the player. Say ${topic}.${world}${memory}`) },
        ];
    },

    /** A growing streamed line as it may be shown: reasoning hidden, quotes and later lines dropped. */
    _partialLine(text) {
        if (typeof text !== 'string') return '';
        const s = NpcBrain._stripReasoning(text);
        if (typeof s !== 'string' || /^<[^>]*$/.test(s)) return ''; // a tag still arriving ("<thi…")
        return s.replace(/^["'“”]+/, '').split('\n')[0].trim().slice(0, 240);
    },

    // ── Validation & sanitizing ─────────────────────────────────

    _extractJson(text) {
        const cleaned = NpcBrain._stripReasoning(text);
        if (typeof cleaned !== 'string') return null;
        const s = cleaned.indexOf('{');
        const e = cleaned.lastIndexOf('}');
        if (s < 0 || e <= s) return null;
        try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return null; }
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
        const cleaned = NpcBrain._stripReasoning(text);
        if (typeof cleaned !== 'string') return null;
        let s = cleaned.trim().replace(/^["'“”]+|["'“”]+$/g, '').split('\n')[0].trim();
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
        // The world context is part of the key: when the news changes, so does the line
        const w = ctx.worldContext ? `:${NpcBrain._hash(ctx.worldContext)}` : '';
        // ...and so are the memories: a new deed remembered, a new line
        const memories = NpcBrain._memoryText(ctx.memories);
        const m = memories ? `:m${NpcBrain._hash(memories)}` : '';
        return `line:${(npc && (npc.id || npc.firstName)) || 'npc'}:${ctx.topic || 'greet'}${w}${m}`;
    },
    _hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
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
