// ============================================
// NIGHT SIGHT — how far folk see on the street in the dark
// ============================================
// The street map's darkness (ui/lightSystem.js) and whether the player
// carries a light are set here once a frame by ui/innerMapNight.js; the
// systems that weigh who saw a deed (StreetCrime.selectWitnesses, a theft
// from a container) read the tiles it cuts from their sight radius. A light
// carried cuts nothing: the lantern shows you to all. No imports, so any
// system may read it without a cycle; the numbers live in
// data/nightStreets.json → dark (passed in by NightStreets).

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const NightSight = {
    _darkness: 0,
    _lit: true,
    _maxCut: 4,
    _minDark: 0.25,

    /**
     * Tiles darkness takes off a witness's sight: none in the light (or with a
     * light carried), up to maxCut at full dark.
     */
    cutFor(darkness, lit, maxCut = 4, minDark = 0.25) {
        const d = _num(darkness);
        if (lit || d <= minDark) return 0;
        const t = Math.min(1, (d - minDark) / Math.max(0.01, 1 - minDark));
        return Math.round(t * _num(maxCut, 4));
    },

    /** The street map's darkness now, and whether the player carries a light (from the UI). */
    set(darkness, lit, maxCut = null, minDark = null) {
        this._darkness = _num(darkness);
        this._lit = !!lit;
        if (maxCut != null) this._maxCut = _num(maxCut, 4);
        if (minDark != null) this._minDark = _num(minDark, 0.25);
    },

    /** Off the street map: no darkness counts. */
    clear() {
        this._darkness = 0;
        this._lit = true;
    },

    /** The tiles cut from sight on the street right now. */
    cut() {
        return NightSight.cutFor(this._darkness, this._lit, this._maxCut, this._minDark);
    },

    darkness() {
        return this._darkness;
    },
};
