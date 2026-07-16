// ============================================
// LLM CLIENT — transport to a local llama.cpp server (Spec 2)
// ============================================
// A tiny, dependency-free HTTP client for a local `llama-server` exposing the
// OpenAI-compatible endpoint. Renderer-side fetch — works in Electron, the Vite
// dev server, and the web build alike.
//
// Contract: this module NEVER throws and NEVER blocks the game loop's critical
// path (callers await it off the tick). Every failure — offline, timeout,
// non-200, malformed — resolves to a graceful { ok:false, reason } so the
// caller can fall back to deterministic/templated behaviour. It is inert until
// configured and is off by default (see NpcBrain / settings).

const DEFAULTS = {
    endpoint: 'http://127.0.0.1:8080',
    model: 'local',
    temperature: 0.7,
    maxTokens: 200,
    timeoutMs: 8000,
    availabilityTtlMs: 15000,   // cache health-probe result this long
};

let config = { ...DEFAULTS };
let availability = { ok: false, checkedAt: -Infinity };

function nowMs() {
    // Normal runtime code (not a workflow script) — Date.now is available.
    return Date.now();
}

export const LlmClient = {

    configure(opts = {}) {
        config = { ...config, ...opts };
        // Invalidate the cached probe so the next call re-checks.
        availability = { ok: false, checkedAt: -Infinity };
        return { ...config };
    },

    getConfig() {
        return { ...config };
    },

    /** Cheap health probe, cached for availabilityTtlMs. Never throws. */
    async isAvailable(force = false) {
        const t = nowMs();
        if (!force && (t - availability.checkedAt) < config.availabilityTtlMs) {
            return availability.ok;
        }
        let ok = false;
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), Math.min(config.timeoutMs, 3000));
            const res = await fetch(`${config.endpoint}/health`, { method: 'GET', signal: ctrl.signal });
            clearTimeout(timer);
            ok = !!(res && res.ok);
        } catch {
            ok = false;
        }
        availability = { ok, checkedAt: t };
        return ok;
    },

    /**
     * Send a chat completion. `messages` is an OpenAI-style array
     * [{ role, content }]. Resolves { ok:true, text } or { ok:false, reason }.
     * Never throws.
     */
    async chat(messages, opts = {}) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return { ok: false, reason: 'no messages' };
        }
        const timeoutMs = opts.timeoutMs || config.timeoutMs;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctrl.signal,
                body: JSON.stringify({
                    model: opts.model || config.model,
                    messages,
                    temperature: opts.temperature != null ? opts.temperature : config.temperature,
                    max_tokens: opts.maxTokens || config.maxTokens,
                    stream: false,
                }),
            });
            clearTimeout(timer);
            if (!res || !res.ok) {
                return { ok: false, reason: `http ${res ? res.status : 'no-response'}` };
            }
            const data = await res.json();
            const text = data && data.choices && data.choices[0]
                && data.choices[0].message && data.choices[0].message.content;
            if (typeof text !== 'string') return { ok: false, reason: 'malformed response' };
            return { ok: true, text: text.trim() };
        } catch (e) {
            clearTimeout(timer);
            return { ok: false, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network error' };
        }
    },

    /** Test helper — restore defaults. */
    _reset() {
        config = { ...DEFAULTS };
        availability = { ok: false, checkedAt: -Infinity };
    },
};
