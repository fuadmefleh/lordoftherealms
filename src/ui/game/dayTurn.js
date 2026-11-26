// ============================================
// DAY TURN — a day's end run at once, or across frames
// ============================================
// The day's end (ui/game/endDay.js) is a generator of steps: the systems'
// processDay calls one after another, with a `yield` between them (and inside
// World.advanceDaySteps and SaveLoad.saveGameSteps). The steps and their order
// are the same either way:
//
//   • runSync drives it to the end in one go (tests, the headless harness, a
//     page without frames) — the day exactly as it always ran;
//   • runSliced drives it a time budget at a time, one slice a frame, so the
//     map keeps drawing while the world turns (a day used to stop the screen
//     for 100–400 ms; days back to back, travel or a wait, ran at 3–4 fps).
//     While it runs `game._dayTurning` is set (the travel loop waits, the map
//     takes no clicks): a shield over the page takes the pointer and the keys
//     (Escape still passes), and says "The day turns…" if the day is slow.
//
// The day's notices are logged as they come; their cards wait for the end and are
// shown together (the few that would stay on screen, the rest folded into "+N more").
//
// Timers the day's steps set for "after the day" (a panel to show) go through
// `later` and are started once the last step has run, as they were when the
// whole day ran in one task.

/** Milliseconds of steps run per frame (an ordinary day's end; travel). */
const BUDGET_MS = 8;
/** Days let pass back to back (ui/timeSkip.js): a larger slice, the wait is the point. */
const SKIP_BUDGET_MS = 14;
/** The shield's word shows once a day has taken this long. */
const LABEL_AFTER_MS = 250;
/** A hidden page draws no frames: a slice comes by timer then. */
const FALLBACK_MS = 120;

const SHIELD_ID = 'dayTurnShield';
let _shield = null;
let _labelTimer = 0;
let _keyBlock = null;

function _hasDom() {
    return typeof document !== 'undefined' && !!document.body && typeof document.createElement === 'function';
}

function _raise(mode) {
    if (!_hasDom()) return;
    try {
        _raiseShield(mode);
    } catch (e) {
        // (a stand-in document without the whole DOM: the day still turns, unshielded)
        _shield = null;
    }
}

function _raiseShield(mode) {
    if (!_shield || !_shield.isConnected) {
        _shield = document.createElement('div');
        _shield.id = SHIELD_ID;
        _shield.innerHTML = '<div class="day-turn-word" style="position:absolute;top:72px;left:50%;transform:translateX(-50%);'
            + 'padding:6px 16px;border-radius:14px;background:rgba(20,16,10,0.78);color:#f3e6c4;font:600 13px/1.4 Georgia,serif;'
            + 'letter-spacing:0.04em;box-shadow:0 2px 10px rgba(0,0,0,0.4);opacity:0;transition:opacity 200ms ease;pointer-events:none;">'
            + '🌙 The day turns…</div>';
        document.body.appendChild(_shield);
    }
    // (letting days pass: under the wait's own bar, z-index 9000, so Stop is still pressed)
    _shield.style.cssText = `position:fixed;inset:0;background:transparent;cursor:wait;z-index:${mode === 'skip' ? 8999 : 2147483000};`;
    const word = _shield.firstChild;
    if (word) word.style.opacity = '0';
    clearTimeout(_labelTimer);
    if (mode !== 'skip' && word) _labelTimer = setTimeout(() => { word.style.opacity = '1'; }, LABEL_AFTER_MS);
    if (!_keyBlock && typeof window !== 'undefined' && window.addEventListener) {
        _keyBlock = (e) => {
            if (e.key === 'Escape') return;
            e.stopImmediatePropagation();
            e.preventDefault();
        };
        window.addEventListener('keydown', _keyBlock, true);
    }
}

function _lower() {
    clearTimeout(_labelTimer);
    try {
        if (_shield) {
            _shield.style.display = 'none';
            const word = _shield.firstChild;
            if (word) word.style.opacity = '0';
        }
    } catch (e) { _shield = null; }
    if (_keyBlock && typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', _keyBlock, true);
        _keyBlock = null;
    }
}

/** The next slice: after the next frame is drawn (or by timer, the page hidden). */
function _nextSlice(fn) {
    let ran = false;
    const go = () => { if (!ran) { ran = true; fn(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, FALLBACK_MS);
}

export const DayTurn = {
    BUDGET_MS,
    SKIP_BUDGET_MS,

    /** Can a day be run across frames here? (a page with frames and a body) */
    canSlice() {
        return typeof requestAnimationFrame === 'function' && _hasDom();
    },

    /** Drive the steps to the end now; → the generator's return value. */
    runSync(gen) {
        let r = gen.next();
        while (!r.done) r = gen.next();
        return r.value;
    },

    /**
     * Drive the steps a budget at a time, one slice a frame.
     * opts: { budgetMs, mode: 'full' | 'skip' (the shield's place), onDone() }
     */
    runSliced(game, gen, opts = {}) {
        const budget = opts.budgetMs > 0 ? opts.budgetMs : BUDGET_MS;
        if (game) game._dayTurning = true;
        _raise(opts.mode);
        // The day's notices are logged as they come and their cards shown together at the end
        // (ui/ui/panels.js): one Activity Log refresh, one chime, no cards built only to be folded.
        // (Letting days pass collects them for its own digest: ui/timeSkip.js)
        const ui = game && game.ui;
        const hold = opts.mode !== 'skip' && ui && typeof ui.holdNotifications === 'function';
        if (hold) ui.holdNotifications();
        const t0 = performance.now();
        const stats = { slices: 0, longest: 0, ms: 0 };
        const finish = () => {
            if (game) {
                game._dayTurning = false;
                game._lastDayTurn = { slices: stats.slices, longest: +stats.longest.toFixed(1), ms: +stats.ms.toFixed(1), wall: +(performance.now() - t0).toFixed(1) };
            }
            _lower();
            if (hold) {
                try { ui.releaseNotifications(); } catch (e) { console.error('[DayTurn] notices', e); }
            }
            if (typeof opts.onDone === 'function') opts.onDone();
        };
        const slice = () => {
            const s = performance.now();
            let r = { done: false };
            try {
                do { r = gen.next(); } while (!r.done && performance.now() - s < budget);
            } catch (e) {
                // (endDay's own catch handles a failing system; this is the driver's last guard)
                console.error('[DayTurn] a step failed', e);
                r = { done: true };
            }
            const d = performance.now() - s;
            stats.slices++;
            stats.ms += d;
            if (d > stats.longest) stats.longest = d;
            if (r.done) finish();
            else _nextSlice(slice);
        };
        _nextSlice(slice);
    },
};
