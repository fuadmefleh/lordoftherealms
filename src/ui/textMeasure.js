// ============================================
// Text widths remembered — the map's labels measured once, not every frame
// ============================================
// The world map measures each town name, label and atlas name every frame to keep them
// clear of each other; setting ctx.font and measuring is a real cost, and the answer is
// the same frame after frame. textWidth(ctx, font, text, spacing) sets the font (and the
// letter spacing) and measures only the first time it is asked; afterwards it answers from
// memory and leaves the context alone (the caller sets the font it draws with). Forgotten
// whenever a web font finishes loading (a name measured in the fallback face is wider or
// narrower than in its own), and while fonts are still loading nothing is kept.

const _widths = new Map();
const MAX = 4000;
let _watching = false;

function _watchFonts() {
    _watching = true;
    try {
        const fonts = typeof document !== 'undefined' && document.fonts;
        if (fonts && typeof fonts.addEventListener === 'function') {
            fonts.addEventListener('loadingdone', () => _widths.clear());
        }
    } catch { /* no font events: widths are kept as they are */ }
}

function _fontsSettled() {
    try {
        const fonts = typeof document !== 'undefined' && document.fonts;
        return !fonts || fonts.status !== 'loading';
    } catch { return true; }
}

/**
 * The width of `text` in `font` (with `spacing`, a CSS letter-spacing, when given and the
 * context has letterSpacing), as ctx.measureText gives it.
 */
export function textWidth(ctx, font, text, spacing = null) {
    if (!_watching) _watchFonts();
    const key = spacing ? `${font}|${spacing}|${text}` : `${font}||${text}`;
    const hit = _widths.get(key);
    if (hit !== undefined) return hit;
    ctx.font = font;
    const hasSpacing = 'letterSpacing' in ctx;
    if (hasSpacing) ctx.letterSpacing = spacing || '0px';
    const w = ctx.measureText(text).width;
    if (_fontsSettled() && Number.isFinite(w)) {
        if (_widths.size >= MAX) _widths.clear();
        _widths.set(key, w);
    }
    return w;
}

/** Forget every width (the specs; a font swapped at run time). */
export function clearTextWidths() {
    _widths.clear();
}
