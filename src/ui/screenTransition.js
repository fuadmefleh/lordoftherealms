// ============================================
// Screen transitions — through a door, onto and off the street map
// ============================================
// The game loop (ui/game/gameLoop.js) tells it, once a frame, where the player is
// (sceneKey: the world map, a street map, a room and its floor); when that changes it
// plays a short reveal drawn over the canvas after the scene:
//   street → a building: a door-opening wipe (two dark leaves parting from the middle) ~360 ms
//   a building → the street, world ↔ street map: a fade up from black ~300 ms
//   up or down the stairs: a quicker fade ~220 ms
// The switch itself has already happened (enterBuilding etc. are synchronous), so nothing
// waits on it and it never takes input: it is paint over the canvas, below every panel,
// in canvas pixels (so any UI zoom is the same), and the camera's fit on entering a room
// goes on underneath it. Walking off a street map's edge onto the next hex is not faded.
// Off with Settings → Display → Screen transitions; with the system's reduced-motion
// preference the door wipe is a plain fade.

const _num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const TRANSITION_MS = { door: 360, fade: 300, stairs: 220 };

/** Where the player is, as a key: 'world' | 'street:q,r' | 'in:type@q,r#floor'. */
export function sceneKey(innerMap) {
    const M = innerMap || {};
    if (!M.active) return 'world';
    const t = M.currentWorldTile || {};
    const street = `street:${_num(t.q)},${_num(t.r)}`;
    const b = M._insideBuilding;
    if (!b) return street;
    return `in:${b.type}@${_num(b.q)},${_num(b.r)}#${_num(M._floor)}`;
}

/** The transition from one key to the next: 'door' | 'fade' | 'stairs' | null (none). */
export function transitionKind(from, to) {
    if (!from || !to || from === to) return null;
    const kindOf = (k) => (k === 'world' ? 'world' : k.startsWith('street:') ? 'street' : 'in');
    const a = kindOf(from), b = kindOf(to);
    if (a === 'street' && b === 'in') return 'door';
    if (a === 'in' && b === 'in') {
        // the same building, another floor
        return from.split('#')[0] === to.split('#')[0] ? 'stairs' : 'fade';
    }
    if (a === 'street' && b === 'street') return null;   // (onto the next hex at the edge: no fade)
    return 'fade';
}

const _smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

function _prefersReducedMotion() {
    try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { return false; }
}

export const ScreenTransition = {
    enabled: true,
    reducedMotion: null,   // null: ask the system (prefers-reduced-motion)
    _key: null,
    _kind: null,
    _t: 0,                 // ms into the transition
    _dur: 0,
    _fresh: false,         // started this frame: its first frame is drawn fully covered

    /** From the settings (ui/ui/propertiesSettings.js applySettings). */
    configure(opts = {}) {
        if (opts.enabled !== undefined) this.enabled = opts.enabled !== false;
        if (opts.reducedMotion !== undefined) this.reducedMotion = opts.reducedMotion;
        if (!this.enabled) this._end();
    },

    /** Once a frame: `dt` real seconds. Starts a transition when the place changed. */
    update(game, innerMap, dt) {
        // (between two street maps at a hex edge: hold the old key, so no fade)
        if (game && game._crossingEdge) { this._advance(dt); return; }
        const key = sceneKey(innerMap);
        if (this._key !== null && key !== this._key) {
            const kind = transitionKind(this._key, key);
            if (kind) this.start(kind);
        }
        this._key = key;
        this._advance(dt);
    },

    start(kind) {
        if (!this.enabled) return;
        const reduced = this.reducedMotion == null ? _prefersReducedMotion() : !!this.reducedMotion;
        this._kind = kind === 'door' && reduced ? 'fade' : kind;
        this._dur = TRANSITION_MS[this._kind] || TRANSITION_MS.fade;
        this._t = 0;
        this._fresh = true;
    },

    _advance(dt) {
        if (!this._kind) return;
        if (this._fresh) { this._fresh = false; return; }
        this._t += Math.max(0, _num(dt)) * 1000;
        if (this._t >= this._dur) this._end();
    },

    _end() {
        this._kind = null;
        this._t = 0;
        this._dur = 0;
        this._fresh = false;
    },

    /** Whether a transition is playing. */
    get active() { return !!this._kind; },

    /** 0..1 through the transition (1 when none). */
    progress() {
        return this._kind ? Math.max(0, Math.min(1, this._t / (this._dur || 1))) : 1;
    },

    /** Input is never held: the transition is paint only (specs check this). */
    blocksInput() { return false; },

    /** Draw it over the canvas (after the scene, before the next frame). */
    draw(ctx, canvas) {
        if (!this._kind || !ctx || !canvas) return;
        const W = canvas.width, H = canvas.height;
        const p = _smooth(this.progress());
        try {
            ctx.save();
            if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            if (this._kind === 'door') {
                // two leaves swinging open from the middle, darkest at the start
                const half = W / 2;
                const open = half * p;
                ctx.fillStyle = `rgba(8,6,4,${(1 - 0.4 * p).toFixed(3)})`;
                ctx.fillRect(0, 0, Math.ceil(half - open), H);
                ctx.fillRect(Math.floor(half + open), 0, Math.ceil(half - open) + 1, H);
                // the room fades up behind them
                ctx.fillStyle = `rgba(0,0,0,${(0.55 * (1 - p)).toFixed(3)})`;
                ctx.fillRect(Math.ceil(half - open), 0, Math.ceil(open * 2), H);
            } else {
                ctx.fillStyle = `rgba(0,0,0,${(1 - p).toFixed(3)})`;
                ctx.fillRect(0, 0, W, H);
            }
            ctx.restore();
        } catch { /* drawing is best-effort */ }
    },
};
