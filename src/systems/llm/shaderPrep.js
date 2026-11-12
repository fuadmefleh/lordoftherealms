// ============================================
// SHADER PREP — compile the in-browser model's GPU kernels without freezing the page
// ============================================
// Why: WebLLM 0.2.86 prebuilds (asynchronously) only the handful of sampler
// kernels it finds first; the ~20 kernels that run the model itself are made
// lazily, the first time each one runs, with WebGPU's *synchronous*
// createComputePipeline. Chrome compiles a synchronous pipeline on its GPU
// process's main thread — the thread that paints every tab — so the first
// reply after a load (our 1-token warm-up) froze the whole page for ~30 s on
// a cold shader cache, even though the engine lives in a Web Worker. The
// same kernels compiled with createComputePipelineAsync compile off that
// thread and the page keeps painting (measured: 22 kernels, the slowest
// ~45 s, while frames kept coming).
//
// What this does, inside the worker, right after WebLLM's reload():
//   1. Swaps the WebGPU context's createShader (what TVM's lazy-kernel hook,
//      'wasm.WebGPUCreateShader', calls) for one that starts an *async*,
//      paced compile and hands back a stand-in. (The hook itself can't be
//      re-registered: the wasm module looked it up once when it was made.)
//   2. Runs a throwaway "dry" generation (plain and JSON-mode) to make the
//      model ask for every kernel it uses. While dry, the stand-ins dispatch
//      nothing (the output is discarded; buffers are zeroed, so sampling
//      stays valid).
//   3. Waits for every compile (reporting progress), resets the chat, and
//      from then on each stand-in calls its real kernel.
// A kernel first asked for later still works: it compiles the old way.
// Every step is guarded: if WebLLM's internals are not what we expect, the
// load simply goes on as before. Nothing here throws.

import { makeLimiter, PACING_DEFAULTS } from './gpuPacing.js';

const MARK = '__lotrShaderPrep';

/** The dry run's requests: plain (decode steps too: ignore_eos) and JSON mode (the grammar mask kernel). */
export const DRY_REQUESTS = [
    { messages: [{ role: 'user', content: 'Hi' }], max_tokens: 3, ignore_eos: true, stream: false, temperature: 0.7, frequency_penalty: 0.1, presence_penalty: 0.1 },
    { messages: [{ role: 'user', content: 'Reply with JSON.' }], max_tokens: 2, stream: false, response_format: { type: 'json_object', schema: JSON.stringify({ type: 'object' }) } },
];

/** The pieces of a loaded WebLLM pipeline this needs, or null when they are not there. */
export function pipelineParts(engine, modelId) {
    try {
        const map = engine && engine.loadedModelIdToPipeline;
        if (!map || typeof map.get !== 'function') return null;
        const pl = map.get(modelId) || (map.size === 1 ? [...map.values()][0] : null);
        const tvm = pl && pl.tvm;
        const ctx = tvm && tvm.lib && tvm.lib.webGPUContext;
        if (!tvm) return null;
        if (!ctx || typeof ctx.createShaderAsync !== 'function' || typeof ctx.createShader !== 'function') return null;
        return { pipeline: pl, tvm, ctx };
    } catch {
        return null;
    }
}

/**
 * Compile one loaded model's kernels asynchronously (see the header).
 * `report({ done, total })` is called as compiles finish. Resolves
 * { ok, kernels, failed, reason? }; never throws.
 */
export async function prepareShaders(engine, modelId, { report, pacing = PACING_DEFAULTS, requests = DRY_REQUESTS } = {}) {
    const parts = pipelineParts(engine, modelId);
    if (!parts) return { ok: false, kernels: 0, failed: 0, reason: 'webllm internals not found' };
    const { ctx } = parts;
    // The context's own (synchronous) createShader, for anything asked for after the prep
    if (!ctx[MARK]) ctx[MARK] = ctx.createShader;
    const syncCreate = ctx[MARK].bind(ctx);
    const limiter = makeLimiter(pacing);
    const pending = [];
    let dry = true;
    let done = 0;
    let failed = 0;
    const tell = () => { if (report) { try { report({ done, total: pending.length }); } catch { /* the caller's problem */ } } };

    const hook = (finfo, code) => {
        const k = { real: null };
        if (dry) {
            const p = limiter.run(() => ctx.createShaderAsync(finfo, code))
                .then((fn) => { k.real = fn; }, () => { failed++; })
                .finally(() => { done++; tell(); });
            pending.push(p);
        } else {
            // Asked for after the prep: the old (synchronous) way
            k.real = syncCreate(finfo, code);
        }
        const standIn = (...args) => {
            if (k.real) return k.real(...args);
            if (dry) return undefined;                  // dry run: found, not dispatched
            k.real = syncCreate(finfo, code);           // its async compile failed
            return k.real(...args);
        };
        return standIn;
    };

    try {
        ctx.createShader = hook;
    } catch (e) {
        return { ok: false, kernels: 0, failed: 0, reason: `could not hook kernels: ${(e && e.message) || e}` };
    }

    // The dry run: the model asks for each kernel it uses
    for (const req of requests) {
        try { await engine.chat.completions.create({ ...req }); } catch { /* garbage in, garbage out: only the kernels matter */ }
    }
    tell();
    await Promise.all(pending);
    dry = false;
    try { await engine.resetChat(); } catch { /* nothing to reset */ }
    return { ok: true, kernels: pending.length, failed };
}

/**
 * Wrap engine.reload (an MLCEngine, the worker handler's) so every load
 * prepares its kernels before it resolves. Progress goes to
 * `opts.onProgress({ progress, timeElapsed, text })`, or else through the
 * engine's own init-progress callback (which the worker forwards to the page).
 * Idempotent; returns true when installed.
 */
export function installShaderPrep(engine, opts = {}) {
    if (!engine || typeof engine.reload !== 'function') return false;
    if (engine.reload[MARK]) return true;
    const realReload = engine.reload.bind(engine);
    const progress = (report) => {
        const cb = opts.onProgress || ((r) => {
            const f = engine.initProgressCallback;
            if (typeof f === 'function') f(r);
        });
        try { cb(report); } catch { /* the caller's problem */ }
    };
    const wrapped = async (modelId, ...rest) => {
        const r = await realReload(modelId, ...rest);
        const ids = Array.isArray(modelId) ? modelId : [modelId];
        const t0 = Date.now();
        for (const id of ids) {
            const res = await prepareShaders(engine, id, {
                ...opts,
                report: ({ done, total }) => progress({
                    progress: total ? done / total : 1,
                    timeElapsed: Math.round((Date.now() - t0) / 1000),
                    text: `Preparing GPU kernels [${done}/${total}]`,
                }),
            });
            if (opts.log) { try { opts.log(res); } catch { /* ignore */ } }
        }
        return r;
    };
    wrapped[MARK] = true;
    engine.reload = wrapped;
    return true;
}
