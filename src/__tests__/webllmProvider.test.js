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
    hasModelInCache: (...args) => mlc.hasModelInCache(...args),
    deleteModelAllInfoInCache: (...args) => mlc.deleteModelAllInfoInCache(...args),
}));

import { LlmClient } from '../systems/llmClient.js';
import { WebLlm } from '../systems/llm/webllmProvider.js';
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

    it('falls back to the main thread when no worker can be made', async () => {
        WebLlm._setSeams({ workerFactory: () => { throw new Error('no workers'); } });
        expect(await WebLlm.load(MODEL)).toEqual({ ok: true });
        expect(mlc.create.mock.calls[0][0]).toBe(null);
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
