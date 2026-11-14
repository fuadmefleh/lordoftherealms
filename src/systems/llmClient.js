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
//
// Providers: 'local' (llama-server), 'openai' (OpenAI's API) and 'webllm' — a
// model run inside the game on the player's GPU (systems/llm/webllmProvider.js,
// imported lazily). Callers never see the difference: chat / chatStream /
// probe keep the same shapes whichever provider answers.

import { WebLlm } from './llm/webllmProvider.js';

const DEFAULTS = {
    // 'local' (a llama.cpp llama-server, no key) or 'openai' (OpenAI's API, with an API key)
    provider: 'local',
    apiKey: '',
    endpoint: 'http://127.0.0.1:8080',
    model: 'local',
    temperature: 0.7,
    maxTokens: 200,
    timeoutMs: 8000,
    availabilityTtlMs: 15000,   // cache health-probe result this long
    // OpenAI reasoning models: how hard to think before answering ('none' = answer at once)
    reasoningEffort: 'none',
};

/** Where each provider lives and what it serves by default. */
export const LLM_PROVIDERS = {
    local: { endpoint: 'http://127.0.0.1:8080', model: 'local', label: 'Local (llama.cpp)' },
    openai: { endpoint: 'https://api.openai.com', model: 'gpt-6-luna', label: 'OpenAI' },
    // No address: the model runs in the page. '' = the default of data/llmModels.json
    webllm: { endpoint: '', model: '', label: 'In-browser (WebLLM)' },
};

function isWebLlm() {
    return config.provider === 'webllm';
}


function isOpenAI() {
    return config.provider === 'openai';
}

/** Request headers: the API key as a bearer token when there is one. */
function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
    return h;
}

/**
 * The chat request body. llama-server takes `max_tokens` and a temperature;
 * OpenAI's reasoning models take `max_completion_tokens` and a
 * `reasoning_effort` (and the temperature only with no reasoning).
 */
function chatBody(messages, opts, stream) {
    const temperature = opts.temperature != null ? opts.temperature : config.temperature;
    const maxTokens = opts.maxTokens || config.maxTokens;
    const body = { model: opts.model || config.model, messages, stream };
    // A reply that must be one JSON object (OpenAI and llama-server both honour this);
    // with opts.schema, one of that shape: OpenAI's json_schema, llama-server's
    // json_object + schema (turned into a grammar, so even a small model keeps to it)
    if (opts.schema && typeof opts.schema === 'object') {
        body.response_format = isOpenAI()
            ? { type: 'json_schema', json_schema: { name: opts.schemaName || 'reply', schema: opts.schema, strict: false } }
            : { type: 'json_object', schema: opts.schema };
    } else if (opts.json) body.response_format = { type: 'json_object' };
    if (isOpenAI()) {
        body.max_completion_tokens = maxTokens;
        const effort = opts.reasoningEffort || config.reasoningEffort;
        if (effort) body.reasoning_effort = effort;
        if (effort === 'none' && temperature != null) body.temperature = temperature;
    } else {
        body.temperature = temperature;
        body.max_tokens = maxTokens;
    }
    return JSON.stringify(body);
}

let config = { ...DEFAULTS };

/**
 * Options for the in-browser model: the caller's, else the client's
 * temperature; timeouts and token caps fall to WebLLM's own (slower GPUs,
 * data/llmModels.json) unless the caller set them.
 */
function webllmOpts(opts) {
    return {
        ...opts,
        temperature: opts.temperature != null ? opts.temperature : config.temperature,
    };
}
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
        // In-browser: a local state check, no network — always fresh
        if (isWebLlm()) return (await LlmClient.probe()).ok;
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
        if (isWebLlm()) {
            try { out = await WebLlm.probe(config.model); } catch { out = { ok: false, state: 'error', detail: 'WebLLM failed' }; }
            availability = { ok: out.ok, checkedAt: t, state: out.state, detail: out.detail, progress: out.progress };
            return out;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), Math.min(config.timeoutMs, 3000));
        try {
            if (isOpenAI()) {
                // OpenAI has no /health: ask for the model itself (a wrong key or model answers plainly)
                if (!config.apiKey) {
                    out = { ok: false, state: 'nokey', detail: 'no OpenAI API key is set' };
                } else {
                    const res = await fetch(`${config.endpoint}/v1/models/${encodeURIComponent(config.model)}`, { method: 'GET', headers: headers(), signal: ctrl.signal });
                    if (res && res.ok) out = { ok: true, state: 'ready', detail: `OpenAI serves ${config.model}` };
                    else if (res && (res.status === 401 || res.status === 403)) out = { ok: false, state: 'badkey', detail: `OpenAI refused the API key (http ${res.status})` };
                    else if (res && res.status === 404) out = { ok: false, state: 'nomodel', detail: `OpenAI has no model "${config.model}" for this key` };
                    else if (res && res.status === 429) out = { ok: false, state: 'error', detail: 'OpenAI says too many requests or no quota left (http 429)' };
                    else out = { ok: false, state: 'error', detail: `OpenAI answered http ${res ? res.status : '?'}` };
                }
                availability = { ok: out.ok, checkedAt: t, state: out.state, detail: out.detail };
                return out;
            }
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

    /** The in-browser provider itself (download / load / delete / status for the settings UI). */
    webllm: WebLlm,

    /**
     * Load the in-browser model in the background if it is already
     * downloaded (the UI calls this a little after a game has loaded). Never
     * downloads, never throws; a no-op for the other providers.
     */
    async warmUp() {
        if (!isWebLlm()) return { ok: false, reason: 'not webllm' };
        const r = await WebLlm.warmUp(config.model);
        availability = { ok: false, checkedAt: -Infinity };
        return r;
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
        if (isWebLlm()) {
            try { return await WebLlm.chat(messages, webllmOpts(opts)); } catch (e) { return { ok: false, reason: `webllm: ${(e && e.message) || String(e)}` }; }
        }
        const timeoutMs = opts.timeoutMs || config.timeoutMs;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
                method: 'POST',
                headers: headers(),
                signal: ctrl.signal,
                body: chatBody(messages, opts, false),
            });
            clearTimeout(timer);
            if (!res || !res.ok) {
                return { ok: false, reason: `http ${res ? res.status : 'no-response'}` };
            }
            const data = await res.json();
            const text = data && data.choices && data.choices[0]
                && data.choices[0].message && data.choices[0].message.content;
            if (typeof text !== 'string') return { ok: false, reason: 'malformed response' };
            // (it answered: it is up, whatever a health check said a moment ago)
            availability = { ok: true, checkedAt: nowMs(), state: 'ready', detail: `${config.endpoint} answered` };
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
        if (isWebLlm()) {
            try { return await WebLlm.chatStream(messages, webllmOpts(opts), onDelta); } catch (e) { return { ok: false, reason: `webllm: ${(e && e.message) || String(e)}` }; }
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
                headers: headers(),
                signal: ctrl.signal,
                body: chatBody(messages, opts, true),
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
