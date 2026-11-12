// The in-browser LLM provider (systems/llm/webllmProvider.js) behind
// LlmClient's 'webllm' provider. @mlc-ai/web-llm is mocked: the test env is
// node (no WebGPU, no Worker), so every path is a mocked engine. The contract
// under test is llmClient's: never throw, degrade to { ok:false, reason }.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mlc = vi.hoisted(() => ({
    engine: null,
    create: null,
    hasModelInCache: null,
    deleteModelAllInfoInCache: null,
}));

vi.mock('@mlc-ai/web-llm', () => ({
    prebuiltAppConfig: { model_list: [] },
    CreateWebWorkerMLCEngine: (...args) => mlc.create(...args),
    CreateMLCEngine: (...args) => mlc.create(null, ...args),
    // The main-thread fallback builds the engine itself (to prep its kernels) and reloads it
    MLCEngine: function MLCEngine(cfg) {
        const e = mlc.engine;
        e.reload = vi.fn(async (id) => { await mlc.create(null, id, cfg); });
        return e;
    },
    hasModelInCache: (...args) => mlc.hasModelInCache(...args),
    deleteModelAllInfoInCache: (...args) => mlc.deleteModelAllInfoInCache(...args),
}));

import { LlmClient } from '../systems/llmClient.js';
import { WebLlm, throttleProgress, progressText, LOAD_NOTICE } from '../systems/llm/webllmProvider.js';
import { prepareShaders, installShaderPrep } from '../systems/llm/shaderPrep.js';
import { makeLimiter } from '../systems/llm/gpuPacing.js';
import { NpcBrain } from '../systems/npcBrain.js';

const GPU = { requestAdapter: async () => ({ features: new Set() }) };
const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

function fakeEngine(reply = '{"action":"claim_threat"}') {
    return {
        chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { role: 'assistant', content: `  ${reply}  ` } }] })) } },
        interruptGenerate: vi.fn(),
        unload: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        setInitProgressCallback: vi.fn(),
    };
}

beforeEach(() => {
    WebLlm._reset();
    LlmClient._reset();
    mlc.engine = fakeEngine();
    mlc.create = vi.fn(async () => mlc.engine);
    mlc.hasModelInCache = vi.fn(async () => true);
    mlc.deleteModelAllInfoInCache = vi.fn(async () => {});
    WebLlm._setSeams({ gpu: GPU, workerFactory: () => ({ fake: 'worker' }) });
    LlmClient.configure({ provider: 'webllm', model: MODEL });
});

afterEach(() => {
    WebLlm._reset();
    LlmClient._reset();
});

describe('WebLLM provider — support', () => {
    it('a missing navigator.gpu is unsupported, not a throw', async () => {
        WebLlm._setSeams({ gpu: () => undefined });
        const p = await LlmClient.probe();
        expect(p).toMatchObject({ ok: false, state: 'unsupported' });
        expect(await LlmClient.isAvailable(true)).toBe(false);
        expect(await WebLlm.load(MODEL)).toEqual({ ok: false, reason: 'unsupported' });
        expect(mlc.create).not.toHaveBeenCalled();
    });

    it('the real node navigator (no gpu) is handled by the default seam', async () => {
        WebLlm._reset();   // default gpu source: globalThis.navigator?.gpu
        const p = await WebLlm.probe(MODEL);
        expect(p.ok).toBe(false);
        expect(p.state).toBe('unsupported');
    });

    it('a navigator.gpu that throws, or hands out no adapter, is unsupported', async () => {
        WebLlm._setSeams({ gpu: () => { throw new Error('boom'); } });
        expect((await WebLlm.probe()).state).toBe('unsupported');
        WebLlm._reset();
        WebLlm._setSeams({ gpu: { requestAdapter: async () => null } });
        expect((await WebLlm.probe()).state).toBe('unsupported');
        WebLlm._reset();
        WebLlm._setSeams({ gpu: { requestAdapter: async () => { throw new Error('denied'); } } });
        expect((await WebLlm.probe()).state).toBe('unsupported');
    });

    it('unsupported → chat falls back gracefully and NpcBrain says why', async () => {
        WebLlm._setSeams({ gpu: () => undefined });
        const res = await LlmClient.chat([{ role: 'user', content: 'hi' }]);
        expect(res.ok).toBe(false);
        const t = await NpcBrain.testConnection({ provider: 'webllm', model: MODEL });
        expect(t).toMatchObject({ ok: false, stage: 'health', state: 'unsupported' });
        expect(t.hint).toMatch(/WebGPU/);
    });

    it('nothing loaded yet is "notloaded", and never downloads on its own', async () => {
        const p = await LlmClient.probe();
        expect(p).toMatchObject({ ok: false, state: 'notloaded' });
        await LlmClient.chat([{ role: 'user', content: 'hi' }]);
        expect(mlc.create).not.toHaveBeenCalled();
    });
});

describe('WebLLM provider — loading', () => {
    it('while the model downloads it is loading (with progress), not ready', async () => {
        let finish;
        mlc.create = vi.fn((worker, id, cfg) => new Promise((resolve) => {
            cfg.initProgressCallback({ progress: 0.43, text: 'Fetching param cache', timeElapsed: 1 });
            finish = () => resolve(mlc.engine);
        }));
        const seen = [];
        WebLlm.onStatus((st) => seen.push(st.state));
        const loading = WebLlm.load(MODEL);
        await vi.waitFor(() => expect(mlc.create).toHaveBeenCalled());
        const p = await LlmClient.probe();
        expect(p.ok).toBe(false);
        expect(p.state).toBe('loading');
        expect(p.progress).toBeCloseTo(0.43);
        expect(await LlmClient.isAvailable()).toBe(false);
        expect((await LlmClient.chat([{ role: 'user', content: 'x' }])).ok).toBe(false);
        finish();
        expect(await loading).toEqual({ ok: true });
        expect(await LlmClient.isAvailable()).toBe(true);
        expect(seen).toContain('loading');
        expect(seen[seen.length - 1]).toBe('ready');
        // the engine was built in the worker
        expect(mlc.create.mock.calls[0][0]).toEqual({ fake: 'worker' });
        expect(mlc.create.mock.calls[0][1]).toBe(MODEL);
    });

    it('falls back to the main thread when no worker can be made, and says which it took', async () => {
        WebLlm._setSeams({ workerFactory: () => { throw new Error('no workers'); } });
        expect(await WebLlm.load(MODEL)).toEqual({ ok: true });
        expect(mlc.create.mock.calls[0][0]).toBe(null);
        expect(WebLlm.enginePath()).toBe('main');
    });

    it('records that the engine runs in the worker', async () => {
        expect(WebLlm.enginePath()).toBe(null);
        await WebLlm.load(MODEL);
        expect(WebLlm.enginePath()).toBe('worker');
    });

    it('a worker whose script fails to load is an error, not a hang', async () => {
        const listeners = {};
        const worker = {
            addEventListener: (type, fn) => { listeners[type] = fn; },
            removeEventListener: vi.fn(),
            terminate: vi.fn(),
        };
        WebLlm._setSeams({ workerFactory: () => worker });
        mlc.create = vi.fn(() => new Promise(() => {}));   // WebLLM waits for a worker that never answers
        const loading = WebLlm.load(MODEL);
        await vi.waitFor(() => expect(mlc.create).toHaveBeenCalled());
        listeners.error({ message: 'Failed to fetch module' });
        const r = await loading;
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/worker failed to start/);
        expect(worker.terminate).toHaveBeenCalled();
        expect(WebLlm.status().state).toBe('error');
    });

    it('throttles load progress to the listeners, and a late tick never undoes Ready', async () => {
        mlc.create = vi.fn(async (worker, id, cfg) => {
            for (let i = 1; i <= 200; i++) cfg.initProgressCallback({ progress: i / 200, text: `Fetching param cache[${i}/200]` });
            return mlc.engine;
        });
        const seen = [];
        WebLlm.onStatus((st) => seen.push(st));
        expect(await WebLlm.load(MODEL)).toEqual({ ok: true });
        await new Promise((r) => setTimeout(r, 150));
        const ticks = seen.filter((st) => st.state === 'loading' && /Fetching/.test(st.text));
        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks.length).toBeLessThan(5);
        expect(seen[seen.length - 1].state).toBe('ready');
        expect(WebLlm.status().state).toBe('ready');
    });

    it('says the kernel compile in the game\'s words, and what a load is like', () => {
        expect(progressText('Preparing GPU kernels [3/31]')).toMatch(/graphics card \(3\/31\).*pause briefly/);
        expect(progressText('Fetching param cache[1/8]')).toBe('Fetching param cache[1/8]');
        expect(progressText(undefined)).toBe('');
        expect(WebLlm.LOAD_NOTICE).toBe(LOAD_NOTICE);
        expect(LOAD_NOTICE).toMatch(/up to a minute the first time/);
    });

    it('a failed load is an error state, not a throw', async () => {
        mlc.create = vi.fn(async () => { throw new Error('out of GPU memory'); });
        const r = await WebLlm.load(MODEL);
        expect(r.ok).toBe(false);
        expect((await LlmClient.probe())).toMatchObject({ ok: false, state: 'error' });
    });

    it('warmUp loads a cached model but never downloads an uncached one', async () => {
        mlc.hasModelInCache = vi.fn(async () => false);
        expect((await LlmClient.warmUp()).ok).toBe(false);
        expect(mlc.create).not.toHaveBeenCalled();
        mlc.hasModelInCache = vi.fn(async () => true);
        expect((await LlmClient.warmUp()).ok).toBe(true);
        expect(mlc.create).toHaveBeenCalledTimes(1);
    });

    it('deleteModel unloads and clears the cache', async () => {
        await WebLlm.load(MODEL);
        expect(await WebLlm.deleteModel(MODEL)).toEqual({ ok: true });
        expect(mlc.engine.unload).toHaveBeenCalled();
        expect(mlc.deleteModelAllInfoInCache).toHaveBeenCalledWith(MODEL, expect.objectContaining({ cacheBackend: expect.any(String) }));
        expect(WebLlm.status().state).toBe('idle');
    });
});

describe('WebLLM provider — generation', () => {
    it('passes a JSON-mode request through to the engine', async () => {
        await WebLlm.load(MODEL);
        const res = await LlmClient.chat([{ role: 'user', content: 'Decide.\n/no_think' }], { json: true, maxTokens: 60, temperature: 0.2 });
        expect(res).toEqual({ ok: true, text: '{"action":"claim_threat"}' });
        const req = mlc.engine.chat.completions.create.mock.lastCall[0];
        expect(req.response_format).toMatchObject({ type: 'json_object' });
        expect(JSON.parse(req.response_format.schema)).toEqual({ type: 'object' });
        expect(req.stream).toBe(false);
        expect(req.max_tokens).toBe(60);
        expect(req.temperature).toBe(0.2);
        // Qwen2.5 would read Qwen3's /no_think switch as text: it is dropped
        expect(req.messages[0].content).toBe('Decide.');
    });

    it('uses its own token default when the caller gives none', async () => {
        await WebLlm.load(MODEL);
        await LlmClient.chat([{ role: 'user', content: 'hi' }]);
        expect(mlc.engine.chat.completions.create.mock.lastCall[0].max_tokens).toBe(WebLlm.catalog().maxTokens);
    });

    it('a generation past its timeout resolves ok:false and interrupts the engine', async () => {
        await WebLlm.load(MODEL);
        mlc.engine.chat.completions.create = vi.fn(() => new Promise(() => {}));
        const res = await LlmClient.chat([{ role: 'user', content: 'hi' }], { timeoutMs: 30 });
        expect(res).toEqual({ ok: false, reason: 'timeout' });
        expect(mlc.engine.interruptGenerate).toHaveBeenCalled();
    });

    it('an engine error resolves ok:false', async () => {
        await WebLlm.load(MODEL);
        mlc.engine.chat.completions.create = vi.fn(async () => { throw new Error('device lost'); });
        const res = await LlmClient.chat([{ role: 'user', content: 'hi' }]);
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/device lost/);
    });

    it('streams deltas through chatStream', async () => {
        await WebLlm.load(MODEL);
        mlc.engine.chat.completions.create = vi.fn(async () => (async function* () {
            yield { choices: [{ delta: { content: 'Well ' } }] };
            yield { choices: [{ delta: { content: 'met.' } }] };
        })());
        const parts = [];
        const res = await LlmClient.chatStream([{ role: 'user', content: 'hi' }], {}, (t) => parts.push(t));
        expect(res).toMatchObject({ ok: true, text: 'Well met.', streamed: true });
        expect(parts).toEqual(['Well ', 'Well met.']);
        expect(mlc.engine.chat.completions.create.mock.lastCall[0].stream).toBe(true);
    });

    it('runs one generation at a time', async () => {
        await WebLlm.load(MODEL);
        let active = 0;
        let peak = 0;
        mlc.engine.chat.completions.create = vi.fn(async () => {
            active++; peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return { choices: [{ message: { content: 'ok' } }] };
        });
        const all = await Promise.all([1, 2, 3].map(() => LlmClient.chat([{ role: 'user', content: 'x' }])));
        expect(all.every((r) => r.ok)).toBe(true);
        expect(peak).toBe(1);
    });
});

describe('WebLLM provider — load warms the model up', () => {
    it('runs a one-token reply before calling itself ready', async () => {
        await WebLlm.load(MODEL);
        const first = mlc.engine.chat.completions.create.mock.calls[0][0];
        expect(first.max_tokens).toBe(1);
        expect(WebLlm.status().state).toBe('ready');
    });

    it('the curated list comes from data/llmModels.json', async () => {
        const cat = await WebLlm.loadCatalog();
        expect(cat.models.length).toBeGreaterThanOrEqual(3);
        expect(cat.models.map((m) => m.id)).toContain(cat.defaultModel);
        expect(WebLlm.resolveModel('')).toBe(cat.defaultModel);
        expect(WebLlm.resolveModel('local')).toBe(cat.defaultModel);
    });
});

describe('WebLLM provider — progress throttle', () => {
    function fakeTime() {
        let now = 0;
        const timers = [];
        return {
            clock: () => now,
            timer: {
                set: (fn, ms) => { const t = { fn, at: now + ms, live: true }; timers.push(t); return t; },
                clear: (t) => { t.live = false; },
            },
            advance(ms) {
                now += ms;
                for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); }
            },
        };
    }

    it('passes the first report at once, holds the rest, and delivers the last one held', () => {
        const ft = fakeTime();
        const out = [];
        const th = throttleProgress((r) => out.push(r), 100, ft);
        th(1);
        expect(out).toEqual([1]);
        ft.advance(10); th(2);
        ft.advance(10); th(3);
        expect(out).toEqual([1]);
        ft.advance(80);
        expect(out).toEqual([1, 3]);
        ft.advance(200); th(4);
        expect(out).toEqual([1, 3, 4]);
    });

    it('cancel() drops a held report', () => {
        const ft = fakeTime();
        const out = [];
        const th = throttleProgress((r) => out.push(r), 100, ft);
        th('a');
        ft.advance(5); th('b');
        th.cancel();
        ft.advance(500);
        expect(out).toEqual(['a']);
    });
});

describe('WebLLM shader prep — async kernel compiles before the first reply', () => {
    /** A stand-in for an MLCEngine whose first reply asks for kernels the way TVM does (ctx.createShader). */
    function fakeLoaded({ kernels = ['matmul', 'rms_norm', 'chunk_lse'], asyncFails = [] } = {}) {
        const calls = [];
        const ctx = {
            createShader: vi.fn((finfo) => { calls.push(`sync:${finfo.name}`); return (...a) => calls.push(`run-sync:${finfo.name}:${a.join(',')}`); }),
            createShaderAsync: vi.fn(async (finfo) => {
                calls.push(`async:${finfo.name}`);
                if (asyncFails.includes(finfo.name)) throw new Error('compile failed');
                return (...a) => calls.push(`run:${finfo.name}:${a.join(',')}`);
            }),
        };
        const funcs = new Map();
        const engine = {
            initProgressCallback: vi.fn(),
            loadedModelIdToPipeline: new Map([[MODEL, { tvm: { lib: { webGPUContext: ctx } } }]]),
            reload: vi.fn(async () => {}),
            resetChat: vi.fn(async () => {}),
            chat: { completions: { create: vi.fn(async () => {
                // TVM asks for each kernel once (lazily), then dispatches it
                for (const k of kernels) {
                    if (!funcs.has(k)) funcs.set(k, ctx.createShader({ name: k }, `code ${k}`));
                    funcs.get(k)(1, 2);
                }
                return { choices: [{ message: { content: 'x' } }] };
            }) } },
        };
        return { engine, ctx, calls, funcs };
    }

    it('compiles every kernel the dry run asks for asynchronously, dispatching nothing meanwhile', async () => {
        const { engine, ctx, calls, funcs } = fakeLoaded();
        const reports = [];
        const r = await prepareShaders(engine, MODEL, { report: (x) => reports.push(x), pacing: { concurrency: 1, gapMs: 0 } });
        expect(r).toEqual({ ok: true, kernels: 3, failed: 0 });
        expect(calls.filter((c) => c.startsWith('sync:'))).toEqual([]);
        expect(calls.filter((c) => c.startsWith('run'))).toEqual([]);     // the dry run dispatched nothing
        expect(ctx.createShaderAsync).toHaveBeenCalledTimes(3);
        expect(engine.resetChat).toHaveBeenCalled();
        expect(reports[reports.length - 1]).toEqual({ done: 3, total: 3 });
        // Afterwards the stand-ins TVM kept run the real (async-built) kernels
        funcs.get('chunk_lse')(7);
        expect(calls[calls.length - 1]).toBe('run:chunk_lse:7');
    });

    it('a kernel first asked for after the prep, or whose async compile failed, is built the old way', async () => {
        const { engine, ctx, calls, funcs } = fakeLoaded({ asyncFails: ['rms_norm'] });
        const r = await prepareShaders(engine, MODEL, { pacing: { concurrency: 2, gapMs: 0 } });
        expect(r).toMatchObject({ ok: true, kernels: 3, failed: 1 });
        funcs.get('rms_norm')(1);
        expect(calls).toContain('sync:rms_norm');
        expect(calls[calls.length - 1]).toBe('run-sync:rms_norm:1');
        const late = ctx.createShader({ name: 'apply_bitmask' }, 'code');
        late(5);
        expect(calls).toContain('sync:apply_bitmask');
    });

    it('missing WebLLM internals leave the load as it was, without throwing', async () => {
        expect(await prepareShaders({}, MODEL)).toMatchObject({ ok: false });
        expect(await prepareShaders(null, MODEL)).toMatchObject({ ok: false });
        expect(await prepareShaders({ loadedModelIdToPipeline: new Map([[MODEL, {}]]) }, MODEL)).toMatchObject({ ok: false });
    });

    it('a dry run that throws (garbage logits, grammar) still finishes the prep', async () => {
        const { engine, calls } = fakeLoaded();
        const create = engine.chat.completions.create;
        engine.chat.completions.create = vi.fn(async (req) => { await create(req); throw new Error('grammar rejected token'); });
        const r = await prepareShaders(engine, MODEL, { pacing: { concurrency: 1, gapMs: 0 } });
        expect(r).toMatchObject({ ok: true, kernels: 3 });
        expect(calls.filter((c) => c.startsWith('sync:'))).toEqual([]);
    });

    it('installShaderPrep wraps reload once and reports progress through the engine callback', async () => {
        const { engine } = fakeLoaded();
        const realReload = engine.reload;
        expect(installShaderPrep(engine, { pacing: { concurrency: 1, gapMs: 0 } })).toBe(true);
        const wrapped = engine.reload;
        expect(installShaderPrep(engine)).toBe(true);
        expect(engine.reload).toBe(wrapped);
        await engine.reload(MODEL);
        expect(realReload).toHaveBeenCalledWith(MODEL);
        const reports = engine.initProgressCallback.mock.calls.map((c) => c[0]);
        expect(reports[reports.length - 1]).toMatchObject({ progress: 1, text: 'Preparing GPU kernels [3/3]' });
        expect(installShaderPrep(null)).toBe(false);
    });
});

describe('GPU pacing limiter', () => {
    it('runs at most `concurrency` jobs at once and passes results and errors through', async () => {
        const lim = makeLimiter({ concurrency: 2, gapMs: 0 });
        let active = 0;
        let peak = 0;
        const job = (v) => async () => {
            active++; peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            if (v === 'bad') throw new Error('bad');
            return v;
        };
        const res = await Promise.allSettled(['a', 'b', 'bad', 'c', 'd'].map((v) => lim.run(job(v))));
        expect(peak).toBe(2);
        expect(res.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
        expect(res[3].value).toBe('c');
        expect(lim.stats.finished).toBe(5);
    });

    it('waits gapMs between jobs', async () => {
        const waits = [];
        const lim = makeLimiter({ concurrency: 1, gapMs: 16, wait: async (ms) => { waits.push(ms); } });
        await Promise.all([1, 2, 3].map((v) => lim.run(async () => v)));
        expect(waits).toEqual([16, 16, 16]);
    });
});
