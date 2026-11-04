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
        return (await LlmClient.probe()).ok;
    },

    /**
     * Ask the server's /health how it is, uncached. Never throws. Resolves
     * { ok, state, detail }: state 'ready' | 'loading' (llama-server answers
     * 503 while it loads the model) | 'error' (any other status) |
     * 'unreachable' (nothing answered: not running, wrong address, blocked)
     * | 'timeout'. The result also refreshes the isAvailable cache.
     */
    async probe() {
        const t = nowMs();
        let out;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), Math.min(config.timeoutMs, 3000));
        try {
            const res = await fetch(`${config.endpoint}/health`, { method: 'GET', signal: ctrl.signal });
            if (res && res.ok) out = { ok: true, state: 'ready', detail: `${config.endpoint} is up` };
            else if (res && res.status === 503) out = { ok: false, state: 'loading', detail: 'the server is still loading its model' };
            else out = { ok: false, state: 'error', detail: `the server answered http ${res ? res.status : '?'}` };
        } catch (e) {
            out = (e && e.name === 'AbortError')
                ? { ok: false, state: 'timeout', detail: `${config.endpoint} did not answer in time` }
                : { ok: false, state: 'unreachable', detail: `nothing is listening at ${config.endpoint}` };
        } finally {
            clearTimeout(timer);
        }
        availability = { ok: out.ok, checkedAt: t, state: out.state, detail: out.detail };
        return out;
    },

    /** The last health probe's result: { ok, state, detail, checkedAt } (state null if never probed). */
    lastProbe() {
        return { ok: availability.ok, state: availability.state || null, detail: availability.detail || '', checkedAt: availability.checkedAt };
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

    /**
     * A chat completion streamed token by token (`stream: true`, the
     * OpenAI-style server-sent events llama-server emits). `onDelta(textSoFar)`
     * is called as text arrives. Resolves like chat(): { ok:true, text,
     * streamed } or { ok:false, reason } — never throws. When the response
     * can't be read as a stream (no readable body, a server that ignores
     * `stream`), it falls back to reading it whole; if the stream breaks after
     * some text arrived, the text so far is returned.
     */
    async chatStream(messages, opts = {}, onDelta = null) {
        if (!Array.isArray(messages) || messages.length === 0) {
            return { ok: false, reason: 'no messages' };
        }
        const timeoutMs = opts.timeoutMs || config.timeoutMs;
        const ctrl = new AbortController();
        // The timer guards the wait for the first byte and every gap after it
        let timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), timeoutMs); };
        let text = '';
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
                    stream: true,
                }),
            });
            if (!res || !res.ok) {
                clearTimeout(timer);
                return { ok: false, reason: `http ${res ? res.status : 'no-response'}` };
            }
            const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
            const type = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';
            if (!reader || (type && !/event-stream/i.test(type))) {
                // Not a stream after all: read the whole answer
                const data = await res.json();
                clearTimeout(timer);
                const whole = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (typeof whole !== 'string') return { ok: false, reason: 'malformed response' };
                if (onDelta) { try { onDelta(whole.trim()); } catch { /* the caller's problem */ } }
                return { ok: true, text: whole.trim(), streamed: false };
            }
            const decoder = new TextDecoder();
            let buf = '';
            let done = false;
            while (!done) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bump();
                buf += decoder.decode(chunk.value, { stream: true });
                let nl;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (payload === '[DONE]') { done = true; break; }
                    let obj = null;
                    try { obj = JSON.parse(payload); } catch { continue; }
                    const c = obj && obj.choices && obj.choices[0];
                    const piece = c && ((c.delta && c.delta.content) || (c.message && c.message.content));
                    if (typeof piece === 'string' && piece) {
                        text += piece;
                        if (onDelta) { try { onDelta(text); } catch { /* the caller's problem */ } }
                    }
                }
            }
            clearTimeout(timer);
            if (done && typeof reader.cancel === 'function') { try { reader.cancel(); } catch { /* closed already */ } }
            if (!text.trim()) return { ok: false, reason: 'empty stream' };
            return { ok: true, text: text.trim(), streamed: true };
        } catch (e) {
            clearTimeout(timer);
            if (text.trim()) return { ok: true, text: text.trim(), streamed: true, partial: true };
            return { ok: false, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network error' };
        }
    },

    /** Test helper — restore defaults. */
    _reset() {
        config = { ...DEFAULTS };
        availability = { ok: false, checkedAt: -Infinity };
    },
};
