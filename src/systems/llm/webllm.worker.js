// ============================================
// WEBLLM WORKER — the in-browser model's own thread
// ============================================
// WebLLM's engine lives here so that loading weights and generating tokens
// never stall the game's canvas. The main thread talks to it through
// WebWorkerMLCEngine (systems/llm/webllmProvider.js), which builds this file
// with `new Worker(new URL('./webllm.worker.js', import.meta.url))` — the
// pattern Vite recognises and bundles as its own chunk.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
