// ============================================
// WEBLLM PROVIDER — a language model run inside the game itself (WebGPU)
// ============================================
// The `webllm` provider behind systems/llmClient.js: WebLLM
// (@mlc-ai/web-llm) downloads a small quantised model once into the browser's
// storage and runs it on the player's GPU, so nobody has to start a
// llama-server. The package is imported dynamically — players who never pick
// this provider never download its ~6 MB of code — and the engine runs in a
// Web Worker (./webllm.worker.js) so generation never stalls the canvas.
//
// Same contract as llmClient: nothing here throws, nothing blocks the game
// loop, and every failure resolves to { ok:false, reason }. Nothing is ever
// downloaded unless the player presses Download / Load (load()) or the model
// is already cached and the UI asks for a background warm-up (warmUp()).
//
// The curated model list (ids from WebLLM's prebuiltAppConfig, sizes, notes,
// timeout and token defaults) is data: data/llmModels.json → `webllm`.

import { DataLoader } from '../../core/dataLoader.js';

const JSON_ANY_OBJECT = JSON.stringify({ type: 'object' });
const FALLBACK = { defaultModel: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', timeoutMs: 60000, maxTokens: 160, models: [] };

// ── Injectable seams (tests swap these; the game uses the defaults) ──
function defaultImporter() {
    return import('@mlc-ai/web-llm');
}
function defaultWorkerFactory() {
    // Vite bundles the worker from this exact `new URL(…, import.meta.url)` shape
    return new Worker(new URL('./webllm.worker.js', import.meta.url), { type: 'module' });
}
function defaultGpu() {
    return (typeof navigator !== 'undefined' && navigator) ? navigator.gpu : undefined;
}

let importer = defaultImporter;
let workerFactory = defaultWorkerFactory;
let gpuSource = defaultGpu;

// ── State ──
let lib = null;                // the imported module
let engine = null;             // WebWorkerMLCEngine (or MLCEngine on the main thread as a fallback)
let engineModel = null;        // the model id the engine has loaded
let loadPromise = null;
let support = null;            // Promise<{ ok, detail }>, checked once
let queue = Promise.resolve(); // one generation at a time
let status = { state: 'idle', progress: 0, text: '', model: null, detail: '' };
const listeners = new Set();

function setStatus(patch) {
    status = { ...status, ...patch };
    for (const fn of listeners) { try { fn({ ...status }); } catch { /* a listener's problem */ } }
}

function now() { return Date.now(); }

/** Where WebLLM keeps its downloads: the Cache API, or IndexedDB where the Cache API is missing (file:// pages). */
function cacheBackend() {
    try {
        if (typeof caches === 'undefined' || (typeof location !== 'undefined' && location.protocol === 'file:')) return 'indexeddb';
    } catch { /* fall through */ }
    return 'cache';
}

function appConfig() {
    return { ...lib.prebuiltAppConfig, cacheBackend: cacheBackend() };
}

async function ensureLib() {
    if (lib) return lib;
    lib = await importer();
    return lib;
}

/** WebLLM's Qwen3 thinks unless told not to; npcBrain appends /no_think for local models. Others would read it as text. */
function prepareMessages(messages, modelId) {
    if (/^Qwen3/i.test(modelId || '')) return messages;
    return messages.map((m) => (m && typeof m.content === 'string' && /\n?\/no_think\s*$/.test(m.content))
        ? { ...m, content: m.content.replace(/\n?\/no_think\s*$/, '') }
        : m);
}

function withTimeout(promise, ms, onTimeout) {
    let timer;
    const t = new Promise((resolve) => {
        timer = setTimeout(() => { try { onTimeout && onTimeout(); } catch { /* ignore */ } resolve({ ok: false, reason: 'timeout' }); }, ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(timer)), t]);
}

/** Run one generation after the ones before it; a job that waited past its timeout gives up as 'busy'. */
function enqueue(timeoutMs, job) {
    const queuedAt = now();
    const run = queue.then(async () => {
        if (now() - queuedAt > timeoutMs) return { ok: false, reason: 'busy' };
        return job();
    });
    // The next job waits for this one, but never longer than its timeout plus a grace period
    queue = Promise.race([
        run.catch(() => null),
        new Promise((r) => setTimeout(r, timeoutMs + 5000)),
    ]);
    return run.catch(() => ({ ok: false, reason: 'webllm error' }));
}

export const WebLlm = {

    // ── Catalogue ───────────────────────────────────────────────

    /** The curated models and defaults from data/llmModels.json (sync; FALLBACK before data loads). */
    catalog() {
        const d = DataLoader.get('llmModels');
        return { ...FALLBACK, ...((d && d.webllm) || {}) };
    },

    /** The same, loading the game data first if it isn't yet (the title screen). Never throws. */
    async loadCatalog() {
        try { await DataLoader.load('llmModels'); } catch { /* fallback below */ }
        return WebLlm.catalog();
    },

    /** A model id, or the catalogue default for an empty / placeholder one. */
    resolveModel(id) {
        return (id && id !== 'local' && id !== 'webllm') ? id : WebLlm.catalog().defaultModel;
    },

    // ── Support / status ────────────────────────────────────────

    /**
     * Whether this browser can run WebGPU at all: navigator.gpu exists and
     * hands out an adapter. Checked once. Resolves { ok, detail }; never throws.
     */
    checkSupport() {
        if (support) return support;
        support = (async () => {
            let gpu;
            try { gpu = gpuSource(); } catch { gpu = undefined; }
            if (!gpu || typeof gpu.requestAdapter !== 'function') {
                return { ok: false, detail: 'this browser has no WebGPU' };
            }
            try {
                const adapter = await withTimeout(Promise.resolve(gpu.requestAdapter()), 5000);
                if (!adapter || adapter.ok === false) return { ok: false, detail: 'WebGPU found no usable graphics adapter' };
                return { ok: true, detail: 'WebGPU is available' };
            } catch {
                return { ok: false, detail: 'WebGPU refused an adapter' };
            }
        })();
        return support;
    },

    /** The current state, sync: { state: idle|loading|ready|error|unsupported, progress 0..1, text, model, detail }. */
    status() {
        return { ...status };
    },

    /** Listen to status changes (download progress); returns an unsubscribe function. */
    onStatus(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    },

    /**
     * Health in llmClient.probe()'s shape, no network: { ok, state, detail, progress }.
     * state: 'unsupported' | 'notloaded' (nothing loaded yet) | 'loading' |
     * 'ready' | 'error'.
     */
    async probe(modelId) {
        const want = WebLlm.resolveModel(modelId);
        const sup = await WebLlm.checkSupport();
        if (!sup.ok) {
            setStatus({ state: 'unsupported', detail: sup.detail });
            return { ok: false, state: 'unsupported', detail: `unsupported: ${sup.detail}` };
        }
        if (status.state === 'loading') {
            const pct = Math.round((status.progress || 0) * 100);
            return { ok: false, state: 'loading', progress: status.progress || 0, detail: `loading ${status.model} (${pct}%)` };
        }
        if (engine && engineModel === want && status.state === 'ready') {
            return { ok: true, state: 'ready', detail: `${want} is loaded in the browser` };
        }
        if (status.state === 'error') return { ok: false, state: 'error', detail: status.detail || 'the model failed to load' };
        return { ok: false, state: 'notloaded', detail: `${want} is not loaded (Download / Load model in the AI settings)` };
    },

    // ── Download / load / cache ─────────────────────────────────

    /** Whether the model is already downloaded in this browser. Never throws. */
    async isCached(modelId) {
        const id = WebLlm.resolveModel(modelId);
        try {
            const sup = await WebLlm.checkSupport();
            if (!sup.ok) return false;
            await ensureLib();
            return !!(await lib.hasModelInCache(id, appConfig()));
        } catch {
            return false;
        }
    },

    /**
     * Download (first time) and load a model onto the GPU. Only ever called
     * on the player's say-so (or warmUp() for an already-cached model).
     * Resolves { ok:true } or { ok:false, reason }; never throws.
     */
    async load(modelId) {
        const id = WebLlm.resolveModel(modelId);
        if (engine && engineModel === id && status.state === 'ready') return { ok: true };
        if (loadPromise) {
            const r = await loadPromise;
            if (engineModel === id && r.ok) return r;
        }
        const p = (async () => {
            const sup = await WebLlm.checkSupport();
            if (!sup.ok) {
                setStatus({ state: 'unsupported', detail: sup.detail });
                return { ok: false, reason: 'unsupported' };
            }
            setStatus({ state: 'loading', progress: 0, text: 'Starting…', model: id, detail: '' });
            try {
                await ensureLib();
                const onProgress = (r) => setStatus({
                    state: 'loading',
                    progress: Math.max(0, Math.min(1, Number(r && r.progress) || 0)),
                    text: (r && r.text) || '',
                });
                if (engine) {
                    if (typeof engine.setInitProgressCallback === 'function') engine.setInitProgressCallback(onProgress);
                    await engine.reload(id);
                } else {
                    const cfg = { appConfig: appConfig(), initProgressCallback: onProgress };
                    let worker = null;
                    try { worker = workerFactory(); } catch { worker = null; }
                    engine = worker
                        ? await lib.CreateWebWorkerMLCEngine(worker, id, cfg)
                        // No workers here (some file:// hosts): run on the main thread rather than not at all
                        : await lib.CreateMLCEngine(id, cfg);
                }
                engineModel = id;
                // The first reply compiles the GPU pipelines (tens of seconds on
                // some machines): do it now, so the first real line isn't the slow one
                setStatus({ state: 'loading', progress: 1, text: 'Warming up the model…' });
                try {
                    await withTimeout(Promise.resolve(engine.chat.completions.create({
                        messages: [{ role: 'user', content: 'Hello' }], max_tokens: 1, stream: false,
                    })), 120000, () => { try { engine.interruptGenerate(); } catch { /* gone */ } });
                } catch { /* a failed warm-up only means the first line is slow */ }
                setStatus({ state: 'ready', progress: 1, text: 'Ready', model: id, detail: '' });
                return { ok: true };
            } catch (e) {
                engineModel = null;
                const msg = (e && e.message) ? String(e.message).slice(0, 200) : 'the model failed to load';
                setStatus({ state: 'error', detail: msg });
                return { ok: false, reason: msg };
            }
        })();
        loadPromise = p;
        try { return await p; } finally { if (loadPromise === p) loadPromise = null; }
    },

    /**
     * Load an already-downloaded model in the background (after the game is
     * up). Downloads nothing: an uncached model stays unloaded. Never throws.
     */
    async warmUp(modelId) {
        try {
            if (status.state === 'ready' || status.state === 'loading') return { ok: status.state === 'ready' };
            if (!(await WebLlm.isCached(modelId))) return { ok: false, reason: 'not downloaded' };
            return await WebLlm.load(modelId);
        } catch {
            return { ok: false, reason: 'webllm error' };
        }
    },

    /** Unload (if loaded) and delete a downloaded model from the browser's storage. Never throws. */
    async deleteModel(modelId) {
        const id = WebLlm.resolveModel(modelId);
        try {
            if (engine && engineModel === id) {
                try { await engine.unload(); } catch { /* deleting anyway */ }
                engineModel = null;
                setStatus({ state: 'idle', progress: 0, text: '', model: null, detail: '' });
            }
            await ensureLib();
            await lib.deleteModelAllInfoInCache(id, appConfig());
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && e.message) || 'could not delete' };
        }
    },

    // ── Generation ──────────────────────────────────────────────

    /** The OpenAI-style request WebLLM takes (the model is whichever is loaded). */
    _request(messages, opts, stream) {
        const cat = WebLlm.catalog();
        const req = {
            messages: prepareMessages(messages, engineModel),
            stream,
            max_tokens: opts.maxTokens || cat.maxTokens,
        };
        if (opts.temperature != null) req.temperature = opts.temperature;
        // One JSON object. WebLLM 0.2.86 compiles json_object's `schema` even when
        // there is none (and fails), so it always gets the loosest one
        if (opts.json) req.response_format = { type: 'json_object', schema: JSON_ANY_OBJECT };
        if (stream) req.stream_options = { include_usage: false };
        return req;
    },

    /** One whole reply. Resolves { ok:true, text } or { ok:false, reason }; never throws. */
    async chat(messages, opts = {}) {
        if (!engine || status.state !== 'ready') return { ok: false, reason: 'model not loaded' };
        const timeoutMs = opts.timeoutMs || WebLlm.catalog().timeoutMs;
        return enqueue(timeoutMs, () => withTimeout((async () => {
            try {
                const res = await engine.chat.completions.create(WebLlm._request(messages, opts, false));
                const text = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
                if (typeof text !== 'string') return { ok: false, reason: 'malformed response' };
                return { ok: true, text: text.trim() };
            } catch (e) {
                return { ok: false, reason: (e && e.message) ? `webllm: ${String(e.message).slice(0, 120)}` : 'webllm error' };
            }
        })(), timeoutMs, () => { try { engine.interruptGenerate(); } catch { /* gone */ } }));
    },

    /** A streamed reply; onDelta(textSoFar). Resolves like llmClient.chatStream; never throws. */
    async chatStream(messages, opts = {}, onDelta = null) {
        if (!engine || status.state !== 'ready') return { ok: false, reason: 'model not loaded' };
        const timeoutMs = opts.timeoutMs || WebLlm.catalog().timeoutMs;
        let text = '';
        let timedOut = false;
        return enqueue(timeoutMs, () => withTimeout((async () => {
            try {
                const chunks = await engine.chat.completions.create(WebLlm._request(messages, opts, true));
                for await (const chunk of chunks) {
                    if (timedOut) break;
                    const c = chunk && chunk.choices && chunk.choices[0];
                    const piece = c && c.delta && c.delta.content;
                    if (typeof piece === 'string' && piece) {
                        text += piece;
                        if (onDelta) { try { onDelta(text); } catch { /* the caller's problem */ } }
                    }
                }
                if (!text.trim()) return { ok: false, reason: 'empty stream' };
                return { ok: true, text: text.trim(), streamed: true };
            } catch (e) {
                if (text.trim()) return { ok: true, text: text.trim(), streamed: true, partial: true };
                return { ok: false, reason: 'webllm error' };
            }
        })(), timeoutMs, () => {
            timedOut = true;
            try { engine.interruptGenerate(); } catch { /* gone */ }
        })).then((r) => (r.reason === 'timeout' && text.trim())
            ? { ok: true, text: text.trim(), streamed: true, partial: true }
            : r);
    },

    // ── Test seams ──────────────────────────────────────────────

    _setSeams({ importer: imp, workerFactory: wf, gpu } = {}) {
        if (imp) importer = imp;
        if (wf) workerFactory = wf;
        if (gpu !== undefined) gpuSource = typeof gpu === 'function' ? gpu : () => gpu;
    },

    _reset() {
        importer = defaultImporter;
        workerFactory = defaultWorkerFactory;
        gpuSource = defaultGpu;
        lib = null;
        engine = null;
        engineModel = null;
        loadPromise = null;
        support = null;
        queue = Promise.resolve();
        status = { state: 'idle', progress: 0, text: '', model: null, detail: '' };
        listeners.clear();
    },
};
