/**
 * Vitest global setup — mock browser APIs that game modules expect.
 */
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Mock fetch() — resolve /data/... paths to local filesystem ──
globalThis.fetch = vi.fn(async (url) => {
    // Strip leading slash, resolve from project root
    const rel = typeof url === 'string' ? url.replace(/^\//, '') : String(url);
    const filePath = path.resolve(ROOT, rel);

    if (!fs.existsSync(filePath)) {
        return { ok: false, status: 404, statusText: 'Not Found' };
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => JSON.parse(text),
        text: async () => text,
    };
});

// ── Minimal DOM stubs (some modules reference document/window at import time) ──
if (typeof document === 'undefined') {
    globalThis.document = {
        getElementById: () => null,
        createElement: () => ({
            getContext: () => ({}),
            addEventListener: () => {},
            appendChild: () => {},
            style: {},
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        }),
        addEventListener: () => {},
        querySelectorAll: () => [],
        body: { appendChild: () => {}, innerHTML: '' },
    };
}

// ── Stub window properties some modules check ──
globalThis.window = globalThis.window || globalThis;
globalThis.window.gameOptions = {};

// ── Stub Image constructor ──
if (typeof Image === 'undefined') {
    globalThis.Image = class Image {
        constructor() {
            this.src = '';
            this.onload = null;
            this.onerror = null;
            this.width = 0;
            this.height = 0;
        }
    };
}

// ── Stub requestAnimationFrame / cancelAnimationFrame ──
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));

// ── Stub performance.now ──
globalThis.performance = globalThis.performance || { now: () => Date.now() };

// ── Stub AudioContext ──
globalThis.AudioContext = globalThis.AudioContext || class AudioContext {
    constructor() { this.state = 'suspended'; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createMediaElementSource() { return { connect() {} }; }
    resume() { return Promise.resolve(); }
};

// ── Stub indexedDB — ModStore relies on it during DataLoader init ──
if (typeof globalThis.indexedDB === 'undefined') {
    const _stores = {};
    globalThis.indexedDB = {
        open(name, version) {
            const req = {
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null,
            };
            // Simulate async open
            setTimeout(() => {
                const objectStoreNames = { contains: (n) => !!_stores[n] };
                const db = {
                    objectStoreNames,
                    createObjectStore(n) { _stores[n] = {}; },
                    transaction(storeNames, mode) {
                        const sn = Array.isArray(storeNames) ? storeNames[0] : storeNames;
                        return {
                            objectStore(name) {
                                return {
                                    put(val, key) { _stores[sn] = _stores[sn] || {}; _stores[sn][key] = val; },
                                    get(key) {
                                        const r = { onsuccess: null, onerror: null, result: (_stores[sn] || {})[key] };
                                        setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                        return r;
                                    },
                                    getAll() {
                                        const r = { onsuccess: null, onerror: null, result: Object.values(_stores[sn] || {}) };
                                        setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                        return r;
                                    },
                                    delete(key) { if (_stores[sn]) delete _stores[sn][key]; },
                                    getAllKeys() {
                                        const r = { onsuccess: null, onerror: null, result: Object.keys(_stores[sn] || {}) };
                                        setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                                        return r;
                                    },
                                };
                            },
                            oncomplete: null,
                        };
                    },
                };
                // Fire onupgradeneeded, then onsuccess
                if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
                req.result = db;
                if (req.onsuccess) req.onsuccess({ target: { result: db } });
            }, 0);
            return req;
        },
    };
}

// ── Stub indexedDB (ModStore) — noop implementation ──
if (typeof indexedDB === 'undefined') {
    globalThis.indexedDB = {
        open() {
            return {
                onupgradeneeded: null, onsuccess: null, onerror: null,
                result: {
                    objectStoreNames: { contains: () => true },
                    createObjectStore: () => {},
                    transaction: () => ({
                        objectStore: () => ({
                            put: () => ({ onsuccess: null, onerror: null }),
                            get: () => ({ result: undefined, onsuccess: null, onerror: null }),
                            getAllKeys: () => ({ result: [], onsuccess: null, onerror: null }),
                            getAll: () => ({ result: [], onsuccess: null, onerror: null }),
                            delete: () => ({ onsuccess: null, onerror: null }),
                        }),
                        oncomplete: null,
                        onerror: null,
                    }),
                },
                // Auto-fire onsuccess
                _fire() {
                    if (this.onsuccess) this.onsuccess({ target: this });
                },
            };
        },
    };
}
