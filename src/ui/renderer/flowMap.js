// Renderer — the Currents & Rivers map ('flow' map mode): where the water goes.
// The tile art is left off (renderSpriteHex): the land is a quiet, muted wash
// (a little lighter on the heights) so the water reads; the sea is tinted by
// how strongly its current runs (deep slack water dark, a strong stream a
// bright teal), and every charted sea hex carries an arrow the way its
// current sets (world/oceanCurrents.js), longer and brighter the stronger it
// runs. Each river is one bright line with chevrons pointing downstream, so a
// river can be followed from its spring to the sea or a lake, broader the more
// river runs into it (_riverFeed); a river running out of a lake starts in the
// lake. Lakes are pale and still.
import { Renderer } from './core.js';
import { Hex } from './_imports.js';
import { OceanCurrents } from '../../world/oceanCurrents.js';
import { Rivers } from '../../world/rivers.js';

const SEA_IDS = new Set(['deep_ocean', 'ocean', 'coast', 'sea']);

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const SLACK = [14, 30, 58];       // still deep water
const STRONG = [38, 150, 170];    // a strong stream
const LAKE = [104, 168, 206];
const LOW = [70, 72, 60];         // the land, muted
const HIGH = [128, 122, 108];

Object.assign(Renderer.prototype, {
    /** The flat colour of a hex on the Currents & Rivers map (also the minimap's). */
    flowColor(tile) {
        const id = tile && tile.terrain && tile.terrain.id;
        if (id === 'lake') return rgb(LAKE);
        if (SEA_IDS.has(id)) {
            const cur = this.world ? OceanCurrents.at(this.world, tile.q, tile.r) : null;
            return rgb(mix(SLACK, STRONG, cur ? Math.min(1, cur.strength) : 0));
        }
        const e = Math.max(0, Math.min(1, ((tile.elevation ?? 0.5) - 0.42) / 0.5));
        return rgb(mix(LOW, HIGH, e));
    },

    /** Paint a hex's face for the Currents & Rivers map (the art is left off). */
    renderFlowHex(ctx, tile, corners) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = this.flowColor(tile);
        ctx.fill();
    },

    /**
     * How much river runs into each hex (the river hexes upstream of it, itself
     * counted), as a Float32Array by r * width + q — so a great river can be
     * drawn broader than a brook. The shared river grid (world/rivers.js),
     * worked out once for each world.
     */
    _riverFeed() {
        const g = Rivers.grid(this.world);
        return g ? g.feed : new Float32Array(0);
    },

    /**
     * The arrows of the Currents & Rivers map: the set of each charted sea hex
     * and the run of each river hex, over the painted faces. Only hexes on screen.
     */
    renderFlowArrows(ctx) {
        const world = this.world;
        if (!world || !world.tiles || this.mapMode !== 'flow') return;
        const zoom = this.camera.zoom;
        const bounds = this.camera.getVisibleBounds();
        const size = this.hexSize;
        const s = size * zoom;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const minR = Math.max(0, Math.floor(bounds.top / rowHeight) - 1);
        const maxR = Math.min(world.height - 1, Math.ceil(bounds.bottom / rowHeight) + 1);
        const W = world.width, H = world.height;
        const sea = [], river = [];
        const feed = this._riverFeed();
        const centre = (q, r) => {
            const p = this.getHexPixelPos(q, r);
            const c = this.camera.worldToScreen(p.x, p.y);
            return { x: c.x, y: c.y + 0.13 * s };
        };
        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const q0 = Math.floor((bounds.left - offsetX) / hexWidth) - 1;
            const q1 = Math.ceil((bounds.right - offsetX) / hexWidth) + 1;
            for (let q = q0; q <= q1; q++) {
                const wq = Hex.wrapQ(q, W);
                const tile = world.tiles[r][wq];
                if (!tile || !tile.explored) continue;
                const c = centre(q, r);
                if (tile.hasRiver && Number.isInteger(tile.riverDir) && tile.riverDir >= 0) {
                    // from the hex's middle (or the lake it leaves) over to the next hex downstream
                    const n = Hex.neighbors(q, r)[tile.riverDir];
                    const d = centre(n.q, n.r);
                    const o = this.lakeOutletDir ? this.lakeOutletDir(tile, wq, r, W, H) : -1;
                    let from = c;
                    if (o >= 0) { const u = Hex.neighbors(q, r)[o]; const uc = centre(u.q, u.r); from = { x: (uc.x + c.x) / 2, y: (uc.y + c.y) / 2 }; }
                    // (on to the next hex's middle, so the river is one unbroken line; into the
                    // sea or a lake only as far as the shore)
                    const dn = world.tiles[n.r] && world.tiles[n.r][Hex.wrapQ(n.q, W)];
                    const k = dn && !dn.hasRiver && dn.terrain && (SEA_IDS.has(dn.terrain.id) || dn.terrain.id === 'lake') ? 0.55 : 1;
                    // (broader the more river runs in: a brook 1, a great river about 2.4)
                    const wide = 1 + Math.min(1.4, Math.log2(feed[r * W + wq] || 1) / 4);
                    river.push([from.x, from.y, c.x + (d.x - c.x) * k, c.y + (d.y - c.y) * k, wide]);
                    // (a delta's second channel splits off here: drawn on to its own hex,
                    // the size of the river it leaves)
                    if (Number.isInteger(tile.riverBranch) && tile.riverBranch >= 0 && tile.riverBranch !== tile.riverDir) {
                        const b = Hex.neighbors(q, r)[tile.riverBranch];
                        const bc = centre(b.q, b.r);
                        river.push([c.x, c.y, bc.x, bc.y, wide]);
                    }
                    continue;
                }
                if (!SEA_IDS.has(tile.terrain && tile.terrain.id)) continue;
                const cur = OceanCurrents.at(world, wq, r);
                if (!cur || !(cur.strength > 0.02)) continue;
                const len = s * (0.28 + 0.5 * Math.min(1, cur.strength));
                sea.push([c.x - cur.x * len / 2, c.y - cur.y * len / 2, c.x + cur.x * len / 2, c.y + cur.y * len / 2, cur.strength]);
            }
        }
        const arrow = (x0, y0, x1, y1, head) => {
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            const a = Math.atan2(y1 - y0, x1 - x0);
            ctx.moveTo(x1 - Math.cos(a - 0.45) * head, y1 - Math.sin(a - 0.45) * head);
            ctx.lineTo(x1, y1);
            ctx.lineTo(x1 - Math.cos(a + 0.45) * head, y1 - Math.sin(a + 0.45) * head);
        };
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // the sea's arrows, by strength in three steps of brightness
        for (const [lo, hi, alpha] of [[0, 0.45, 0.45], [0.45, 0.75, 0.7], [0.75, 9, 0.95]]) {
            ctx.beginPath();
            for (const [x0, y0, x1, y1, k] of sea) if (k >= lo && k < hi) arrow(x0, y0, x1, y1, s * 0.16);
            ctx.strokeStyle = `rgba(226, 244, 255, ${alpha})`;
            ctx.lineWidth = Math.max(1, 1.5 * zoom);
            ctx.stroke();
        }
        // the rivers: a dark edge under a bright line, so they read on any ground; one
        // unbroken line, with a chevron half way along each hex's run pointing downstream
        const chevron = (x0, y0, x1, y1, head) => {
            const a = Math.atan2(y1 - y0, x1 - x0);
            const mx = x0 + (x1 - x0) * 0.6, my = y0 + (y1 - y0) * 0.6;
            ctx.moveTo(mx - Math.cos(a - 0.6) * head, my - Math.sin(a - 0.6) * head);
            ctx.lineTo(mx, my);
            ctx.lineTo(mx - Math.cos(a + 0.6) * head, my - Math.sin(a + 0.6) * head);
        };
        // (in three widths, by how much river runs in: brook, river, great river)
        for (const [lo, hi] of [[0, 1.45], [1.45, 1.9], [1.9, 9]]) {
            const part = river.filter(v => v[4] >= lo && v[4] < hi);
            if (!part.length) continue;
            const wide = part.reduce((a, v) => a + v[4], 0) / part.length;
            ctx.beginPath();
            for (const [x0, y0, x1, y1] of part) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); chevron(x0, y0, x1, y1, s * 0.2 * Math.sqrt(wide)); }
            ctx.strokeStyle = 'rgba(8, 22, 48, 0.85)';
            ctx.lineWidth = Math.max(2, (2 + 2.2 * wide) * zoom);
            ctx.stroke();
            ctx.strokeStyle = 'rgb(96, 190, 255)';
            ctx.lineWidth = Math.max(1.2, 2.2 * wide * zoom);
            ctx.stroke();
        }
        ctx.restore();
    },
});
