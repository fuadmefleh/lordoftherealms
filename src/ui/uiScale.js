// ============================================
// UI SCALE — one interface size for the whole HUD
// ============================================
// The HUD, panels and dialogs are laid out in fixed CSS pixels for a ~1600×900
// screen; on a large or high-DPI screen they shrink to a sliver around the map.
// styles.css zooms every piece of interface chrome (never the map canvas) by
// --ui-zoom, which this module sets from the screen size and the player's
// "Interface Size" setting.
//
// Inside a zoomed element, vh/vw and JS-set pixel offsets are zoomed too: write
// viewport sizes as calc(80vh / var(--ui-zoom)) and convert mouse/rect
// positions with toUiPx().

const SETTINGS_KEY = 'lord_of_realms_settings';
const BASE_W = 1600;
const BASE_H = 900;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;

/** The interface sizes offered in Settings: 'auto' fits the screen. */
export const UI_SCALE_OPTIONS = [
    { value: 'auto', label: 'Auto (fit screen)' },
    { value: '0.85', label: '85%' },
    { value: '1', label: '100%' },
    { value: '1.15', label: '115%' },
    { value: '1.3', label: '130%' },
    { value: '1.5', label: '150%' },
    { value: '1.75', label: '175%' },
    { value: '2', label: '200%' },
];

let current = 1;
let preference = null;
let listening = false;

/** The zoom 'auto' picks for a viewport: grows with the screen, never below 100%. */
export function autoUiZoom(width, height) {
    const fit = Math.min(width / BASE_W, height / BASE_H);
    return Math.min(1.75, Math.max(1, fit));
}

/** The zoom for a stored preference ('auto' or a number) at a viewport size. */
export function resolveUiZoom(pref, width, height) {
    const n = parseFloat(pref);
    if (pref == null || pref === 'auto' || !Number.isFinite(n)) return autoUiZoom(width, height);
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

function readStoredPreference() {
    try {
        const json = localStorage.getItem(SETTINGS_KEY);
        if (json) return JSON.parse(json).uiScale ?? 'auto';
    } catch {
        // No storage (private window, tests): fall back to auto
    }
    return 'auto';
}

/** Set --ui-zoom from the preference (read from saved settings when omitted). */
export function applyUiScale(pref) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return 1;
    if (pref !== undefined) preference = pref;
    if (preference == null) preference = readStoredPreference();
    current = Math.round(resolveUiZoom(preference, window.innerWidth, window.innerHeight) * 1000) / 1000;
    document.documentElement.style.setProperty('--ui-zoom', String(current));
    if (!listening) {
        listening = true;
        window.addEventListener('resize', () => applyUiScale());
    }
    return current;
}

/** The zoom in effect now. */
export function uiZoom() {
    return current;
}

/** A viewport (rect/mouse) pixel value → the px to write inside a zoomed element. */
export function toUiPx(px) {
    return px / current;
}
