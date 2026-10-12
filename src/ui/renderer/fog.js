// Renderer — the uncharted world. Unexplored land is a sea of moonlit cloud
// drifting on the wind (drawn beneath the map), and the edge of what you know
// dissolves into banks of cloud (drawn over the frontier hexes) rather than
// ending on hard hex edges. Presentation only.
import { Renderer } from './core.js';
import { cloudTexture, drawCloudLayer } from '../cloudTexture.js';

const PUFF_VARIANTS = 4;

/** Soft round cloud banks, cut from the cloud texture with a radial falloff. */
function makePuffs() {
    const puffs = [];
    for (let i = 0; i < PUFF_VARIANTS; i++) {
        const tex = cloudTexture({ size: 128, seed: 101 + i * 7, rgb: '132,147,176', lo: 0.16, hi: 0.58, base: 2 });
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        g.drawImage(tex, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        const mask = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        mask.addColorStop(0, 'rgba(0,0,0,1)');
        mask.addColorStop(0.45, 'rgba(0,0,0,0.95)');
        mask.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = mask;
        g.fillRect(0, 0, 128, 128);
        puffs.push(c);
    }
    return puffs;
}

const hash01 = (q, r) => {
    let h = Math.imul(q, 374761393) + Math.imul(r, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

Object.assign(Renderer.prototype, {
    /** The cloud sea under everything — what lies beyond the charted land. */
    renderUncharted(ctx) {
        if (!this._fogTex) {
            this._fogTex = {
                deep: cloudTexture({ size: 256, seed: 41, rgb: '44,56,78', lo: 0.38, hi: 0.82, base: 3 }),
                wisp: cloudTexture({ size: 256, seed: 57, rgb: '118,132,160', lo: 0.55, hi: 0.9, base: 4 }),
            };
        }
        const cam = this.camera;
        const zoom = cam.zoom;
        // Anchor the layers to the world so they pan with the map; make the
        // tile divide the world's width so the wrap seam lines up.
        const worldW = cam.worldPixelWidth || 1;
        const fit = (desired) => worldW / Math.max(1, Math.round(worldW / desired));
        const originX = this.canvas.width / 2 - cam.x * zoom;
        const originY = this.canvas.height / 2 - cam.y * zoom;
        const t = this.time;

        const deepTile = fit(1400);
        drawCloudLayer(ctx, this._fogTex.deep, originX + t * 6 * zoom, originY + t * 2 * zoom, (deepTile * zoom) / 256, 0.95);
        const wispTile = fit(900);
        drawCloudLayer(ctx, this._fogTex.wisp, originX + t * 14 * zoom, originY + t * 5 * zoom, (wispTile * zoom) / 256, 0.4);
    },

    /** Mark an unexplored hex as frontier if any neighbour is explored (called from renderHexGrid). */
    noteFrontierHex(q, r, wq, sx, sy) {
        const world = this.world;
        const even = (r & 1) === 0;
        // Even rows sit half a hex right (see renderHexGrid), so their diagonal neighbours lean right
        const d = even ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
            : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
        for (const [dq, dr] of d) {
            const nr = r + dr;
            if (nr < 0 || nr >= world.height) continue;
            const nq = ((wq + dq) % world.width + world.width) % world.width;
            if (world.tiles[nr][nq].explored) {
                this._frontier.push(sx, sy, wq, r);
                return;
            }
        }
    },

    /** Banks of cloud over the frontier, softening the edge of the known world. */
    renderFrontierFog(ctx) {
        const f = this._frontier;
        if (!f || f.length === 0) return;
        if (!this._fogPuffs) this._fogPuffs = makePuffs();
        const s = this.hexSize * this.camera.zoom;
        const t = this.time;
        ctx.save();
        for (let i = 0; i < f.length; i += 4) {
            const h = hash01(f[i + 2], f[i + 3]);
            const puff = this._fogPuffs[Math.floor(h * PUFF_VARIANTS)];
            const breathe = 1 + 0.05 * Math.sin(t * 0.45 + h * 40);
            const R = 1.55 * s * breathe;
            const x = f[i] + Math.sin(t * 0.25 + h * 20) * 0.08 * s;
            // Sprite hexes are drawn with their visual centre slightly below the grid point
            const y = f[i + 1] + 0.13 * s + Math.cos(t * 0.2 + h * 30) * 0.05 * s;
            ctx.globalAlpha = 0.72 + 0.18 * h;
            ctx.drawImage(puff, x - R, y - R, R * 2, R * 2);
        }
        ctx.restore();
    },
});
