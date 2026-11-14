// The screen goes dark as the day ends on the street map, and comes back up on
// the new morning (ui/game/endDay.js): fadeOut(then) darkens, then runs `then`;
// fadeIn() lifts it. Without a document (tests) both just run through.

const ID = 'dayFadeVeil';
const OUT_MS = 450;
const IN_MS = 700;

function _veil() {
    if (typeof document === 'undefined' || !document.body) return null;
    let el = document.getElementById(ID);
    if (!el) {
        el = document.createElement('div');
        el.id = ID;
        el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:4000;transition:opacity 450ms ease;';
        document.body.appendChild(el);
    }
    return el;
}

/** Darken the screen, then run `then` once it is black. */
export function fadeOut(then) {
    const el = _veil();
    if (!el) { then(); return; }
    el.style.pointerEvents = 'auto';
    el.style.transition = `opacity ${OUT_MS}ms ease`;
    // (next frame, so the transition runs from 0)
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(then, OUT_MS + 30);
}

/** Lift the dark (after a short hold on black). */
export function fadeIn(holdMs = 250) {
    const el = typeof document !== 'undefined' ? document.getElementById(ID) : null;
    if (!el) return;
    setTimeout(() => {
        el.style.transition = `opacity ${IN_MS}ms ease`;
        el.style.opacity = '0';
        setTimeout(() => { el.style.pointerEvents = 'none'; }, IN_MS);
    }, holdMs);
}
