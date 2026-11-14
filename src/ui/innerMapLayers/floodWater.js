// The river in flood on the street map (mixed into InnerMapRenderer).
//
// While the hex the street map shows is in a spring flood (systems/
// riverLife.js floodAt), the river stands over its banks: a band of brown-grey
// water over the ground beside every river cell, as wide as the flood is high
// (data/riverLife.json floods.bankCells at full height), paler at its edge,
// with slow light bands sliding over it. Cosmetic only: the ground stays as
// it is underneath (you wade it as before).
//
// Drawn by InnerMapRenderer._renderWaterFx (innerMapLayers/waterFx.js) first,
// over the ground and under every sprite. The distance of each cell from the
// river is worked out once per map (a Uint8Array on a WeakMap by the tiles
// array); a frame walks only the cells on screen and allocates nothing.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapRiverDrift } from '../innerMapRiverDrift.js';
import { RiverLife } from '../../systems/riverLife.js';

const _dists = new WeakMap();
const MAX_REACH = 6;
const FILL = ['', 'rgba(96,86,58,0.62)', 'rgba(104,94,64,0.5)', 'rgba(112,102,72,0.4)', 'rgba(120,110,80,0.32)', 'rgba(128,118,88,0.26)', 'rgba(136,126,96,0.2)'];

const _isRiver = t => !!(t && t._wet && t._waterKind === 'river');
const _isWet = t => !!(t && (t._wet || t._sea));

/** Cells' distance from the river (1 = touching it; 0 = water, or too far): once per map */
function _distMap(tiles) {
    let m = _dists.get(tiles);
    if (m) return m;
    const H = tiles.length, W = H ? tiles[0].length : 0;
    const d = new Uint8Array(W * H);
    let frontier = [];
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) if (_isRiver(tiles[r][q])) frontier.push(r * W + q);
    }
    const seen = new Uint8Array(W * H);
    for (const i of frontier) seen[i] = 1;
    for (let k = 1; k <= MAX_REACH && frontier.length; k++) {
        const next = [];
        for (const i of frontier) {
            const q = i % W, r = (i - q) / W;
            const nb = [q > 0 ? i - 1 : -1, q < W - 1 ? i + 1 : -1, r > 0 ? i - W : -1, r < H - 1 ? i + W : -1];
            for (const j of nb) {
                if (j < 0 || seen[j]) continue;
                seen[j] = 1;
                const t = tiles[(j / W) | 0][j % W];
                if (_isWet(t)) continue;
                d[j] = k;
                next.push(j);
            }
        }
        frontier = next;
    }
    m = { d, W, H };
    _dists.set(tiles, m);
    return m;
}

Object.assign(InnerMapRenderer, {
    _floodKey: null,
    _floodSev: 0,

    /** How high the flood stands on the street map's hex today (0: none) — asked once a day per hex */
    _floodHere() {
        const world = InnerMapRiverDrift._world;
        if (!world || InnerMap.worldQ == null) return 0;
        const day = world.day | 0;
        const q = InnerMap.worldQ, r = InnerMap.worldR;
        if (this._floodKey && this._floodKey.q === q && this._floodKey.r === r && this._floodKey.day === day && this._floodKey.world === world) return this._floodSev;
        this._floodKey = { q, r, day, world };
        this._floodSev = RiverLife.floodAt(world, q, r, day);
        return this._floodSev;
    },

    _renderFloodWater(ctx, camera) {
        const tiles = InnerMap.tiles;
        if (!tiles || !tiles.length || InnerMap._insideBuilding || InnerMap._deck) return;
        const sev = this._floodHere();
        if (!(sev > 0)) return;
        const banks = Number(RiverLife.config().floods.bankCells) || 3;
        const reach = Math.max(1, Math.min(MAX_REACH, Math.round(banks * sev + 0.49)));
        const { d, W, H } = _distMap(tiles);
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const fr = this._frameRange;
        if (!fr) return;
        const qMin = Math.max(0, fr.qMin), qMax = Math.min(W - 1, fr.qMax);
        const rMin = Math.max(0, fr.rMin), rMax = Math.min(H - 1, fr.rMax);
        const origin = camera.worldToScreenFast(fr.qMin * T, fr.rMin * T);
        const now = typeof this._waterFxNow === 'function' ? this._waterFxNow() : performance.now() / 1000;
        ctx.save();
        for (let k = 1; k <= reach; k++) {
            // (the band's edge reads paler and thinner, the water deepest by the river)
            ctx.fillStyle = FILL[k];
            for (let r = rMin; r <= rMax; r++) {
                const row = r * W;
                const y = origin.y + (r - fr.rMin) * ds;
                for (let q = qMin; q <= qMax; q++) {
                    if (d[row + q] !== k) continue;
                    ctx.fillRect(origin.x + (q - fr.qMin) * ds, y, ds + 0.5, ds + 0.5);
                }
            }
        }
        // Slow bands of light sliding over the flood
        ctx.fillStyle = 'rgba(214,226,232,0.16)';
        const band = Math.max(1, ds * 0.12);
        for (let r = rMin; r <= rMax; r++) {
            const row = r * W;
            const ph = (now * 0.35 + r * 0.37) % 3;
            if (ph > 1) continue;
            const y = origin.y + (r - fr.rMin) * ds + ph * (ds - band);
            for (let q = qMin; q <= qMax; q++) {
                const v = d[row + q];
                if (!v || v > reach) continue;
                ctx.fillRect(origin.x + (q - fr.qMin) * ds, y, ds + 0.5, band);
            }
        }
        ctx.restore();
    },
});
