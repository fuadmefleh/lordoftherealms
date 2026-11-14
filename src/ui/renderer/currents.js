// Renderer — the set of the sea on the world map (world/oceanCurrents.js):
// faint pale streaks drifting the way each charted sea hex's current runs,
// more and brighter where it runs strong, with small arrowheads in the map
// modes data/currents.json `display.modes` boosts (the trade map: where ships
// go). Only hexes on screen; each hex's current and streak layout cached
// (the current never changes for a world). Off with display.enabled false.
import { Renderer } from './core.js';
import { Hex } from './_imports.js';
import { OceanCurrents } from '../../world/oceanCurrents.js';
import { DataLoader } from '../../core/dataLoader.js';

const DISPLAY_DEFAULTS = {
    enabled: true,
    minZoom: 0.3,
    color: '220,236,255',
    alpha: 0.28,
    streaks: 3,
    length: 0.55,
    speed: 0.22,
    modes: { trade: 2.2 },
    arrowsInModes: true,
};

/** data/currents.json `display`, over the defaults. */
export function currentsDisplay() {
    const src = DataLoader._gamedata && DataLoader._gamedata.currents;
    const d = src && src.display;
    return d ? { ...DISPLAY_DEFAULTS, ...d, modes: { ...DISPLAY_DEFAULTS.modes, ...(d.modes || {}) } } : DISPLAY_DEFAULTS;
}

// A stable 0..1 per hex and index
function rnd(q, r, i) {
    let n = (Math.imul(q, 73856093) ^ Math.imul(r, 19349663) ^ Math.imul(i + 1, 83492791)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const frac = x => x - Math.floor(x);

Object.assign(Renderer.prototype, {
    /** The current of (wq, r) and where its streaks lie, cached per world. */
    _currentCell(world, wq, r) {
        if (this._curCacheWorld !== world || this._curCacheCfg !== OceanCurrents.config()) {
            this._curCacheWorld = world;
            this._curCacheCfg = OceanCurrents.config();
            this._curCache = new Map();
        }
        const key = r * (world.width || 1) + wq;
        let c = this._curCache.get(key);
        if (c === undefined) {
            const cur = OceanCurrents.at(world, wq, r);
            c = cur && cur.strength > 0.02 ? { cur, seeds: [0, 1, 2, 3, 4].map(i => [rnd(wq, r, i), rnd(wq, r, i + 7), rnd(wq, r, i + 13)]) } : null;
            this._curCache.set(key, c);
        }
        return c;
    },

    renderOceanCurrents(ctx) {
        const world = this.world;
        if (!world || !world.tiles) return;
        const D = currentsDisplay();
        if (!D.enabled || !OceanCurrents.config().enabled) return;
        const zoom = this.camera.zoom;
        if (zoom < (D.minZoom || 0)) return;
        const boost = (D.modes && D.modes[this.mapMode]) || 1;
        const arrows = D.arrowsInModes && boost > 1;

        const bounds = this.camera.getVisibleBounds();
        const size = this.hexSize;
        const s = size * zoom;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const minR = Math.max(0, Math.floor(bounds.top / rowHeight) - 1);
        const maxR = Math.min(world.height - 1, Math.ceil(bounds.bottom / rowHeight) + 1);
        const t = this.time || 0;
        const len = (D.length || 0.55) * s;
        const baseA = Math.min(1, (D.alpha || 0.28) * boost);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, 1.6 * zoom * (arrows ? 1.3 : 1));
        // Streaks batched by brightness (a few alpha steps), one stroke each
        const buckets = [[], [], [], []];
        const heads = [];
        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const q0 = Math.floor((bounds.left - offsetX) / hexWidth) - 1;
            const q1 = Math.ceil((bounds.right - offsetX) / hexWidth) + 1;
            for (let q = q0; q <= q1; q++) {
                const wq = Hex.wrapQ(q, world.width);
                const tile = world.tiles[r][wq];
                if (!tile || !tile.explored) continue;
                const cell = this._currentCell(world, wq, r);
                if (!cell) continue;
                const { cur, seeds } = cell;
                const pos = this.getHexPixelPos(q, r);
                const c = this.camera.worldToScreen(pos.x, pos.y);
                const cy = c.y + 0.13 * s;
                const n = Math.max(1, Math.min(seeds.length, Math.round((D.streaks || 3) * (0.4 + cur.strength))));
                const speed = (D.speed || 0.22) * (0.4 + cur.strength);
                // (dimmer out of sight)
                const lit = tile.visible ? 1 : 0.55;
                for (let i = 0; i < n; i++) {
                    const [a, b, ph] = seeds[i];
                    // Drift along the current through the hex: p 0..1 from upstream edge to downstream
                    const p = frac(ph + t * speed);
                    const along = (p - 0.5) * 1.3 * s;
                    const across = (a - 0.5) * 1.1 * s;
                    const x0 = c.x + cur.x * along - cur.y * across;
                    const y0 = cy + cur.y * along + cur.x * across * 0.6;
                    const l = len * (0.6 + 0.6 * b) * (0.5 + cur.strength * 0.7);
                    // fades in and out over its run
                    const fade = Math.sin(p * Math.PI) * lit * (0.45 + 0.55 * cur.strength);
                    const k = Math.min(3, Math.floor(fade * 4));
                    if (k <= 0) continue;
                    buckets[k].push(x0 - cur.x * l * 0.5, y0 - cur.y * l * 0.5, x0 + cur.x * l * 0.5, y0 + cur.y * l * 0.5);
                    if (arrows && i === 0) heads.push(x0 + cur.x * l * 0.5, y0 + cur.y * l * 0.5, cur.x, cur.y, k);
                }
            }
        }
        for (let k = 1; k < 4; k++) {
            const b = buckets[k];
            if (!b.length) continue;
            ctx.strokeStyle = `rgba(${D.color},${(baseA * (k / 3)).toFixed(3)})`;
            ctx.beginPath();
            for (let i = 0; i < b.length; i += 4) { ctx.moveTo(b[i], b[i + 1]); ctx.lineTo(b[i + 2], b[i + 3]); }
            ctx.stroke();
        }
        if (heads.length) {
            const h = 0.12 * s;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(${D.color},${baseA.toFixed(3)})`;
            for (let i = 0; i < heads.length; i += 5) {
                const x = heads[i], y = heads[i + 1], dx = heads[i + 2], dy = heads[i + 3];
                ctx.moveTo(x - dx * h - dy * h * 0.6, y - dy * h + dx * h * 0.6);
                ctx.lineTo(x, y);
                ctx.lineTo(x - dx * h + dy * h * 0.6, y - dy * h - dx * h * 0.6);
            }
            ctx.stroke();
        }
        ctx.restore();
    },
});
