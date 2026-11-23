// Renderer — the topographic map ('topo' map mode): the lie of the land.
// Every hex is painted by its height in bands (a hypsometric tint: lowland
// green through upland tan and brown to grey rock and white peaks; the sea
// in blues, darker with depth), lit from the north-west so slopes read as
// relief, with a contour line wherever a hex edge steps from one band to
// the next. Rivers are drawn as blue lines from hex to hex, so where water
// gathers, runs and pools in the hollows can be seen at a glance. The tile
// art is left off in this mode (renderSpriteHex), so nothing pokes over it.
import { Renderer } from './core.js';
import { Hex } from './_imports.js';

const WATER_IDS = new Set(['deep_ocean', 'ocean', 'coast', 'sea', 'lake']);

// Height bands above the shore (0 = the shore, 1 = the highest peak of the world)
const LAND_STOPS = [
    [0.00, [86, 140, 72]],
    [0.10, [122, 165, 86]],
    [0.22, [170, 190, 108]],
    [0.34, [214, 204, 128]],
    [0.46, [206, 168, 104]],
    [0.58, [178, 128, 80]],
    [0.70, [140, 100, 74]],
    [0.82, [150, 140, 134]],
    [0.92, [210, 206, 202]],
    [1.00, [252, 252, 255]],
];
const LAND_BANDS = 14;
const SEA_BANDS = 5;

const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (stops, t) => {
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
            const k = (t - t0) / Math.max(1e-6, t1 - t0);
            return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
        }
    }
    return stops[stops.length - 1][1];
};

Object.assign(Renderer.prototype, {
    /** The world's shore and peak heights (cached per world) */
    _topoRange() {
        const w = this.world;
        if (this._topoCache && this._topoCache.world === w) return this._topoCache;
        let shore = Infinity, top = -Infinity, deep = Infinity;
        for (const row of w.tiles) {
            for (const t of row) {
                const e = t.elevation ?? 0.5;
                if (WATER_IDS.has(t.terrain && t.terrain.id)) {
                    if (t.terrain.id !== 'lake' && e < deep) deep = e;
                    continue;
                }
                if (e < shore) shore = e;
                if (e > top) top = e;
            }
        }
        if (!Number.isFinite(shore)) shore = 0.42;
        if (!Number.isFinite(top) || top <= shore) top = shore + 0.5;
        if (!Number.isFinite(deep) || deep >= shore) deep = 0;
        this._topoCache = { world: w, shore, top, deep };
        return this._topoCache;
    },

    /** A hex's height band: land 0..LAND_BANDS-1, sea -1..-SEA_BANDS (lakes -1) */
    topoBand(tile) {
        if (!tile || !tile.terrain) return 0;
        const { shore, top, deep } = this._topoRange();
        const e = tile.elevation ?? 0.5;
        if (WATER_IDS.has(tile.terrain.id)) {
            if (tile.terrain.id === 'lake') return -1;
            const d = (shore - e) / Math.max(1e-6, shore - deep);
            return -1 - Math.min(SEA_BANDS - 1, Math.max(0, Math.floor(d * SEA_BANDS)));
        }
        const h = (e - shore) / (top - shore);
        return Math.min(LAND_BANDS - 1, Math.max(0, Math.floor(h * LAND_BANDS)));
    },

    /** The flat tint of a hex on the topographic map (also the minimap's colour) */
    topoColor(tile) {
        const b = this.topoBand(tile);
        if (tile.terrain && tile.terrain.id === 'lake') return 'rgb(96,170,224)';
        if (b < 0) {
            const k = (-b - 1) / (SEA_BANDS - 1);
            return `rgb(${Math.round(lerp(120, 22, k))},${Math.round(lerp(176, 48, k))},${Math.round(lerp(222, 110, k))})`;
        }
        const c = ramp(LAND_STOPS, (b + 0.5) / LAND_BANDS);
        return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
    },

    /**
     * Paint one hex of the topographic map, inside its clipped face path:
     * its band's tint, light from the north-west by the slope, contour lines
     * on the edges that step a band, and its river.
     */
    renderTopoHex(ctx, tile, corners, size) {
        const w = this.world;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = this.topoColor(tile);
        ctx.fill();

        const nbrs = Hex.neighbors(tile.q, tile.r).map(n =>
            (n.r < 0 || n.r >= w.height) ? null : w.tiles[n.r][Hex.wrapQ(n.q, w.width)]);
        const isWater = WATER_IDS.has(tile.terrain.id);

        // Relief: lit from the north-west (neighbours NW = 2, W = 3; SE = 5, E = 0)
        if (!isWater) {
            const e = tile.elevation ?? 0.5;
            const hOf = (t) => (t ? (WATER_IDS.has(t.terrain.id) ? this._topoRange().shore : (t.elevation ?? e)) : e);
            const up = (hOf(nbrs[2]) + hOf(nbrs[3])) / 2;
            const down = (hOf(nbrs[5]) + hOf(nbrs[0])) / 2;
            const slope = (down - up) * 9; // facing the light: + ; facing away: -
            const s = Math.max(-0.22, Math.min(0.22, slope));
            if (Math.abs(s) > 0.02) {
                ctx.fillStyle = s > 0 ? `rgba(255,250,235,${s})` : `rgba(20,14,30,${-s})`;
                ctx.fill();
            }
        }

        // Contours: the edges where the band steps (each edge drawn by the higher hex)
        // Edge i of the face (corners i..i+1) faces neighbour EDGE_NBR[i]
        const EDGE_NBR = [1, 0, 5, 4, 3, 2];
        const band = this.topoBand(tile);
        const zoomW = Math.max(0.8, size * 0.045);
        for (let i = 0; i < 6; i++) {
            const n = nbrs[EDGE_NBR[i]];
            if (!n) continue;
            const nb = this.topoBand(n);
            if (nb >= band) continue;
            const a = corners[i], b = corners[(i + 1) % 6];
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            const coast = band >= 0 && nb < 0;
            ctx.strokeStyle = coast ? 'rgba(20,40,70,0.9)' : band < 0 ? 'rgba(255,255,255,0.22)' : 'rgba(48,28,14,0.75)';
            ctx.lineWidth = coast ? zoomW * 2.2 : (band % 4 === 3 ? zoomW * 2.2 : zoomW * 1.3);
            ctx.stroke();
        }

        // River: from the middle of the face out to the edges it runs in by and out by
        if (tile.hasRiver || nbrs.some((n, i) => n && n.hasRiver && n.riverDir === (i + 3) % 6)) {
            const cx = (corners[1].x + corners[5].x) / 2;
            const cy = (corners[0].y + corners[3].y) / 2;
            const edgeMid = (dir) => {
                // the edge facing neighbour `dir` is the face edge i with EDGE_NBR[i] === dir
                const i = EDGE_NBR.indexOf(dir);
                const a = corners[i], b = corners[(i + 1) % 6];
                return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            };
            ctx.strokeStyle = 'rgb(38,92,200)';
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(1.2, size * 0.16);
            ctx.beginPath();
            if (tile.hasRiver && Number.isFinite(tile.riverDir)) {
                const m = edgeMid(tile.riverDir);
                ctx.moveTo(cx, cy);
                ctx.lineTo(m.x, m.y);
            }
            nbrs.forEach((n, i) => {
                if (n && n.hasRiver && n.riverDir === (i + 3) % 6) {
                    const m = edgeMid(i);
                    ctx.moveTo(m.x, m.y);
                    ctx.lineTo(cx, cy);
                }
            });
            ctx.stroke();
            if (tile.riverSource && !isWater) {
                ctx.fillStyle = 'rgb(38,92,200)';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.max(1.5, size * 0.14), 0, Math.PI * 2);
                ctx.fill();
            }
        }
    },

    /** The key's colours, sea (deepest first) to the highest peaks (for the HTML legend) */
    topoLegendColors() {
        const out = [];
        for (let i = 0; i < SEA_BANDS; i++) {
            const k = (SEA_BANDS - 1 - i) / (SEA_BANDS - 1);
            out.push(`rgb(${Math.round(lerp(120, 22, k))},${Math.round(lerp(176, 48, k))},${Math.round(lerp(222, 110, k))})`);
        }
        for (let b = 0; b < LAND_BANDS; b++) {
            const c = ramp(LAND_STOPS, (b + 0.5) / LAND_BANDS);
            out.push(`rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`);
        }
        return { colors: out, sea: SEA_BANDS };
    },
});
