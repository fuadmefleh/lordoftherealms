// ============================================
// WORLD PREVIEW CLIENT — seeds, request keys and the preview worker
// ============================================
//
// What the New Game screen's world preview (WorldPreview.jsx) needs that is
// not drawing: a fresh seed (UI-level randomness: the world itself is drawn
// from the seeded RNG, world/worldPreview.js), the key of the settings that
// shape the world (so a new name or look does not regenerate it), and a
// client that asks the preview worker for the land, or makes it here when no
// worker can be had.

import { newWorldParams } from '../ui/game/worldParams.js';
import { WorldPreview } from '../world/worldPreview.js';
import { DataLoader } from '../core/dataLoader.js';

const SEED_WORDS = ['Dragon', 'Storm', 'Crown', 'Sword', 'Iron', 'Gold', 'Frost', 'Shadow', 'Dawn', 'Raven',
    'Wolf', 'Oak', 'Fire', 'Stone', 'Moon', 'Ember', 'Thorn', 'Tide', 'Ash', 'Briar', 'Hollow', 'Vale'];

/** A new seed such as "Raven4821", never `prev` */
export function randomSeed(prev = '', rand = Math.random) {
    for (let i = 0; i < 20; i++) {
        const word = SEED_WORDS[Math.floor(rand() * SEED_WORDS.length) % SEED_WORDS.length];
        const seed = `${word}${100 + Math.floor(rand() * 9900)}`;
        if (seed !== prev) return seed;
    }
    return `${prev || 'Seed'}${Date.now() % 10000}`;
}

/** The part of the New Game settings that shapes the land (worldParams.js), as a string key */
export function previewKey(settings) {
    const { width, height, params } = newWorldParams(settings);
    return JSON.stringify({ width, height, params });
}

/**
 * Asks for previews one at a time, the latest wins: a request made while
 * another is being made supersedes it (its promise rejects with
 * `superseded`). A job only just begun is let finish and its answer dropped
 * (the worker keeps the game data it loaded); one that has run long (a Huge
 * or Epic map) is cut short by ending the worker and starting a new one.
 * Without workers (or if the worker cannot load) the land is made on this thread.
 */
const SUPERSEDED = () => Object.assign(new Error('superseded'), { superseded: true });
const CUT_SHORT_MS = 1500;

export class PreviewClient {
    constructor() {
        this._worker = null;
        this._busy = null;    // the job the worker is on: { id, settings, resolve, reject, start, stale }
        this._pending = null; // the next one, waiting for a stale job to finish
        this._seq = 0;
        this._noWorker = typeof Worker === 'undefined';
    }

    /** @returns {Promise<Object>} the WorldPreview summary for these New Game settings */
    request(settings) {
        const id = ++this._seq;
        if (this._pending) { this._pending.reject(SUPERSEDED()); this._pending = null; }
        if (this._busy && !this._busy.stale) {
            this._busy.reject(SUPERSEDED());
            this._busy.stale = true;
            if (Date.now() - this._busy.start > CUT_SHORT_MS) { this._busy = null; this._endWorker(); }
        }
        if (this._noWorker) return this._inline(id, settings);
        return new Promise((resolve, reject) => {
            const job = { id, settings, resolve, reject, start: 0, stale: false };
            if (this._busy) this._pending = job;
            else this._run(job);
        });
    }

    dispose() {
        if (this._pending) this._pending.reject(SUPERSEDED());
        if (this._busy && !this._busy.stale) this._busy.reject(SUPERSEDED());
        this._pending = null;
        this._busy = null;
        this._endWorker();
    }

    _run(job) {
        const w = this._ensureWorker();
        if (!w) { this._inline(job.id, job.settings).then(job.resolve, job.reject); return; }
        job.start = Date.now();
        this._busy = job;
        w.postMessage({ id: job.id, settings: job.settings });
    }

    _ensureWorker() {
        if (this._worker) return this._worker;
        try {
            const w = new Worker(new URL('./worldPreview.worker.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => {
                const msg = e.data || {};
                const job = this._busy;
                if (!job || job.id !== msg.id) return;
                this._busy = null;
                if (!job.stale) {
                    if (msg.ok) job.resolve(msg.preview);
                    else job.reject(new Error(msg.error || 'preview failed'));
                }
                const next = this._pending;
                this._pending = null;
                if (next) this._run(next);
            };
            // A worker that cannot load (an old browser, a file:// page): make the land here instead
            w.onerror = (e) => {
                if (e && e.preventDefault) e.preventDefault();
                console.warn('[WorldPreview] worker failed, previewing on the main thread', e && e.message);
                this._noWorker = true;
                const job = this._pending || (this._busy && !this._busy.stale ? this._busy : null);
                this._busy = null;
                this._pending = null;
                this._endWorker();
                if (job) this._inline(job.id, job.settings).then(job.resolve, job.reject);
            };
            this._worker = w;
            return w;
        } catch (err) {
            console.warn('[WorldPreview] no worker, previewing on the main thread', err);
            this._noWorker = true;
            return null;
        }
    }

    _endWorker() {
        if (this._worker) this._worker.terminate();
        this._worker = null;
    }

    async _inline(id, settings) {
        if (!this._dataReady) this._dataReady = DataLoader.initializeAll().catch((err) => { this._dataReady = null; throw err; });
        await this._dataReady;
        // (a breath first, so the spinner is drawn before the main thread is busy)
        await new Promise(r => setTimeout(r, 30));
        if (id !== this._seq) throw SUPERSEDED();
        const { width, height, params } = newWorldParams(settings);
        return WorldPreview.build(width, height, params);
    }
}
