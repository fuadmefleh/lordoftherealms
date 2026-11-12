// ============================================
// WEBLLM WORKER — the in-browser model's own thread
// ============================================
// WebLLM's engine lives here so that loading weights and generating tokens
// never stall the game's canvas. The main thread talks to it through
// WebWorkerMLCEngine (systems/llm/webllmProvider.js), which builds this file
// with `new Worker(new URL('./webllm.worker.js', import.meta.url))` — the
// pattern Vite recognises and bundles as its own chunk.
//
// A worker alone is not enough: WebLLM compiles most of the model's GPU
// kernels synchronously on its first reply, and Chrome does that on the GPU
// process's main thread, freezing every frame of the page for tens of
// seconds on a cold shader cache. installShaderPrep (./shaderPrep.js) makes
// each load compile them asynchronously, one at a time, before it resolves.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';
import { installShaderPrep } from './shaderPrep.js';

const handler = new WebWorkerMLCEngineHandler();
installShaderPrep(handler.engine, {
    log: (r) => { try { console.info('[webllm worker] GPU kernels prepared', r); } catch { /* no console */ } },
});
self.onmessage = (msg) => handler.onmessage(msg);
