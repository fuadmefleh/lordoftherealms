// ============================================
// HI-DPI — the world canvas drawn at the screen's real resolution
// The engine thinks in CSS pixels everywhere (canvas.width for culling and
// centring, mouse coordinates, every draw call). Rather than thread a scale
// through all of it, the canvas keeps reporting its CSS size through
// `width`/`height`, while its backing store is that size × devicePixelRatio and
// its context carries the matching transform. Without this a 150% display
// stretches a 1× canvas and every label and glyph on the map goes soft.
// ============================================

// (Absent under the node test runner, where the canvas is a stub)
const proto = typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null;
const WIDTH = proto && Object.getOwnPropertyDescriptor(proto, 'width');
const HEIGHT = proto && Object.getOwnPropertyDescriptor(proto, 'height');

/** Backing pixels per CSS pixel; capped, since fill cost grows with its square. */
function ratio() {
    return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Give a canvas a backing store at the device's pixel ratio. Reads and writes
 * of `width`/`height` stay in CSS pixels; `canvas.pixelRatio` is the scale, for
 * the few readers of raw pixels (drawImage from this canvas, getImageData).
 */
export function installHiDpi(canvas) {
    if (!canvas || canvas.pixelRatio || !WIDTH || !HEIGHT || !(canvas instanceof HTMLCanvasElement)) return canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx || !ctx.setTransform) return canvas;
    let cssW = WIDTH.get.call(canvas);
    let cssH = HEIGHT.get.call(canvas);
    let k = 1;
    const apply = () => {
        k = ratio();
        WIDTH.set.call(canvas, Math.round(cssW * k));
        HEIGHT.set.call(canvas, Math.round(cssH * k));
        // Resizing resets the context, transform included
        ctx.setTransform(k, 0, 0, k, 0, 0);
    };
    Object.defineProperty(canvas, 'pixelRatio', { get: () => k, configurable: true });
    Object.defineProperty(canvas, 'width', {
        configurable: true,
        get: () => cssW,
        set: (v) => { cssW = Math.max(0, Math.round(v)); apply(); },
    });
    Object.defineProperty(canvas, 'height', {
        configurable: true,
        get: () => cssH,
        set: (v) => { cssH = Math.max(0, Math.round(v)); apply(); },
    });
    apply();
    // Moving the window to another screen (or browser zoom) changes the ratio
    const watch = () => {
        const mq = window.matchMedia && window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        if (!mq || !mq.addEventListener) return;
        mq.addEventListener('change', () => { apply(); watch(); }, { once: true });
    };
    watch();
    return canvas;
}

/**
 * Put the context back on its device-pixel transform. A frame starts here so a
 * layer that left a stray transform (or the inner map, which shares the
 * canvas) can't shift or blur the next one.
 */
export function resetCanvasTransform(ctx) {
    const k = (ctx.canvas && ctx.canvas.pixelRatio) || 1;
    if (ctx.setTransform) ctx.setTransform(k, 0, 0, k, 0, 0);
}
