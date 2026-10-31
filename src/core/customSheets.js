// ============================================
// CUSTOM SHEETS — resolve editor-imported spritesheet paths
// ============================================
// The terrain / interior / sprite editors store sheets a
// modder imports under made-up `custom/<stamp>_<file>.png` paths, with the
// image itself kept as a data URL in the mod store (meta `customSheets_*`).
// Tiles painted from those sheets carry the `custom/` path, which does not
// exist on disk, so every image loader routes its src through resolve().

const CUSTOM_PREFIX = 'custom/';
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
