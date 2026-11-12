// ============================================
// GPU PACING — a small limiter for the in-browser model's shader compiles
// ============================================
// systems/llm/shaderPrep.js compiles the model's GPU kernels asynchronously
// before its first reply. Chrome runs those compiles in its GPU process —
// the same process that paints every tab — so firing ~30 of them at once
// competes with painting; one at a time, with a frame's breather between,
// keeps frames coming and costs about the same wall time.

/** The defaults: one compile at a time, a frame's breather after each. */
export const PACING_DEFAULTS = { concurrency: 1, gapMs: 16 };

/**
 * run(job) starts job() when fewer than `concurrency` are running, and waits
 * `gapMs` after one finishes before starting the next. `wait(ms)` is
 * injectable for tests. Returns { run, stats }; a job's rejection is passed
 * on to its own caller and never stalls the queue.
 */
export function makeLimiter({ concurrency = PACING_DEFAULTS.concurrency, gapMs = PACING_DEFAULTS.gapMs, wait } = {}) {
    const sleep = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const limit = Math.max(1, Math.floor(concurrency) || 1);
    const pending = [];
    const stats = { started: 0, finished: 0, active: 0, peak: 0 };
    const pump = () => {
        while (stats.active < limit && pending.length) {
            const { job, resolve, reject } = pending.shift();
            stats.active++;
            stats.started++;
            if (stats.active > stats.peak) stats.peak = stats.active;
            let p;
            try { p = Promise.resolve(job()); } catch (e) { p = Promise.reject(e); }
            p.then(resolve, reject).finally(async () => {
                stats.finished++;
                if (gapMs > 0) { try { await sleep(gapMs); } catch { /* go on */ } }
                stats.active--;
                pump();
            });
        }
    };
    return {
        run(job) {
            return new Promise((resolve, reject) => { pending.push({ job, resolve, reject }); pump(); });
        },
        stats,
    };
}
