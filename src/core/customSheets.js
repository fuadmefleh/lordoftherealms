// ============================================
// CUSTOM SHEETS — resolve editor-imported spritesheet paths
// ============================================
// The terrain / interior / sprite editors store sheets a
// modder imports under made-up `custom/<stamp>_<file>.png` paths, with the
// image itself kept as a data URL in the mod store (meta `customSheets_*`).
// Tiles painted from those sheets carry the `custom/` path, which does not
// exist on disk, so every image loader routes its src through resolve().

const CUSTOM_PREFIX = 'custom/';
const MODERN_DIR = 'assets/modern/';

/**
 * The painted (modern) replacement of an LPC detail sheet, if it has one.
 * data/innerMapRenderer.json `modernSheets` lists the sheets repainted at 4x in
 * their original layout (scripts/terrain_modern/build_details.py): original path
 * -> the original's width in px. The repaint lives at assets/modern/<the path
 * under assets/>; ui/sheetScale.js scales cell addresses by the width ratio, so
 * data keeps addressing the original's 32px cells.
 * @param {string} path      sheet path as data names it (e.g. 'assets/lpc/…/Doorframe A.png')
 * @param {object} [gamedata] DataLoader._gamedata
 * @returns {string} the path to load
 */
export function modernSheet(path, gamedata) {
    const list = gamedata && gamedata.innerMapRenderer && gamedata.innerMapRenderer.modernSheets;
    if (!list || typeof path !== 'string' || !path.startsWith('assets/') || path.startsWith(MODERN_DIR)) return path;
    return Object.prototype.hasOwnProperty.call(list, path)
        ? MODERN_DIR + path.slice('assets/'.length) : path;
}

/** The original's width for a loaded modern sheet's src (0 if it is not one). */
export function modernBaseWidth(src, gamedata) {
    const list = gamedata && gamedata.innerMapRenderer && gamedata.innerMapRenderer.modernSheets;
    const i = typeof src === 'string' ? src.indexOf(MODERN_DIR) : -1;
    if (!list || i < 0) return 0;
    const w = list['assets/' + src.slice(i + MODERN_DIR.length)];
    return Number(w) || 0;
}
/**
 * Point an image at a sheet, preferring its modern repaint: if the repaint fails
 * to load (missing file), it falls back to the original sheet, so a listed but
 * absent repaint never leaves the art blank. onError runs only when the sheet
 * itself (or the original, after a failed repaint) cannot be loaded.
 * @param {{src:string,onerror:any}} img   an Image (or anything with src/onerror)
 * @param {string} path                     sheet path as data names it
 * @param {object} [gamedata]               DataLoader._gamedata
 * @param {function} [onError]
 */
// Sheets of this many pixels or more are uploaded to the graphics card as they load
const WARM_PX = 2e6;
let _warm = null;
/** Draw a pixel of a big sheet into a scratch canvas: the browser uploads it now, not at its first use. */
export function warmSheet(img) {
    try {
        const w = img && (img.naturalWidth || img.width), h = img && (img.naturalHeight || img.height);
        if (!(w * h >= WARM_PX) || typeof document === 'undefined') return;
        if (!_warm) {
            const c = document.createElement('canvas');
            c.width = 1; c.height = 1;
            _warm = c.getContext('2d');
        }
        if (_warm) _warm.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    } catch { /* (no canvas here: nothing to warm) */ }
}

export function loadSheetInto(img, path, gamedata, onError) {
    const modern = modernSheet(path, gamedata);
    const fail = () => { if (onError) onError(); };
    if (modern === path) {
        img.onerror = fail;
    } else {
        img.onerror = () => {
            console.warn(`[sheets] repaint missing, using the original: ${modern}`);
            img.onerror = fail;
            img.src = CustomSheets.resolve(path);
        };
    }
    // A repainted sheet runs to millions of pixels (a door sheet 3584x4096), and the first
    // draw from it uploads the whole of it to the graphics card: a fifth of a second, which
    // left to the street map stalls the first frame a house with that door comes on screen.
    // Decoded and drawn once as it loads instead, so the cost falls in the loading.
    const loaded = img.onload;
    if (typeof loaded === 'function' && typeof img.decode === 'function') {
        img.onload = function (...a) {
            img.onload = null;
            const done = () => { warmSheet(img); loaded.apply(this, a); };
            img.decode().then(done, done);
        };
    }
    img.src = CustomSheets.resolve(modern);
}

const _sources = new Map(); // assetPath → dataUrl

export const CustomSheets = {
    /** Meta keys the editors persist their imported sheets under. */
    STORE_KEYS: ['customSheets_terrain', 'customSheets_interior', 'customSheets_sprite'],

    /** Add entries ({ assetPath, dataUrl }) — later entries win on a clash. */
    register(entries) {
        let n = 0;
        for (const e of entries || []) {
            if (!e || typeof e.assetPath !== 'string' || typeof e.dataUrl !== 'string') continue;
            _sources.set(e.assetPath, e.dataUrl);
            n++;
        }
        return n;
    },

    /** The loadable src for a sheet path: its data URL if it is a known custom sheet. */
    resolve(path) {
        if (typeof path !== 'string' || !path.startsWith(CUSTOM_PREFIX)) return path;
        return _sources.get(path) || path;
    },

    has(path) {
        return _sources.has(path);
    },

    get size() {
        return _sources.size;
    },

    clear() {
        _sources.clear();
    },
};
