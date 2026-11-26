// Renderer — the terrain kept in a canvas of its own.
//
// The terrain pass (renderer/world.js _terrainPass) is the map's costliest: a sprite, a
// river, a road for each of the hundreds of hexes in view, the lakes' shores, the faces out
// of sight darkened. Most frames it draws just what it drew the frame before. So while the
// zoom holds, it is drawn once into a canvas the size of the map's and copied in each frame
// (one drawImage instead of a thousand):
//   - the camera moves: the canvas is shifted by whole device pixels into a second one and
//     only the strip bared at the edge drawn, clipped to it (what a full pass would put
//     there: every hex whose art reaches into it, in the same order), so a pan costs its
//     edge, not the map; the shift's leftover (under half a pixel) is the only difference
//     from drawing it straight;
//   - anything a hex is drawn from changes (explored, in sight, terrain, river, road,
//     bridge, a town on it, a realm's tint): each hex in view is checked against the
//     signature it had when drawn, and any change redraws the canvas;
//   - the zoom moves, a map mode is on, the canvas is resized, a terrain sprite finishes
//     loading (until all have: the sites' sprites loaded later are not drawn here), territories are shown or hidden: drawn hex by hex again (while zooming) or
//     afresh.
// The frontier's cloud banks (renderer/fog.js) are still noted each frame from the camera.

import { Renderer } from './core.js';

/** A hex never drawn into the canvas (renderer/world.js _terrainPass). */
export const TILE_SIG_UNSEEN = 0x7fffffff;

// Strings interned to small numbers for the signatures (terrain ids, road tiers, realms)
const _ids = new Map();
function _id(s) {
    if (s == null || s === '') return 0;
    let n = _ids.get(s);
    if (n === undefined) { n = _ids.size + 1; _ids.set(s, n); }
    return n;
}
const _mix = (h, v) => (Math.imul(h ^ (v | 0), 0x01000193) + 0x9e3779b9) | 0;

Object.assign(Renderer.prototype, {
    /**
     * What the terrain pass draws a hex from, as one number: its flags, terrain, river,
     * road and bridge, the town on it (roads run to towns), and its realm while
     * territories are shown. Neighbours count through their own signatures (the pass
     * checks every hex about the view).
     */
    _tileSig(t) {
        if (!t) return 0;
        let f = (t.explored ? 1 : 0) | (t.visible ? 2 : 0) | (t.hasRiver ? 4 : 0) | (t.hasRoad ? 8 : 0)
            | (t.settlement ? 16 : 0) | (t._reef ? 32 : 0) | (t._fjord ? 64 : 0) | (t._skerry ? 128 : 0)
            | (t._canyon ? 256 : 0) | (t.riverSource ? 512 : 0);
        const inf = t.infrastructure;
        if (inf) f |= 1024 | (inf.underConstruction ? 2048 : 0);
        let h = _mix(0x811c9dc5, f);
        h = _mix(h, _id(t.terrain && t.terrain.id));
        if (t.hasRiver) {
            h = _mix(h, Number.isInteger(t.riverDir) ? t.riverDir + 1 : -1);
            h = _mix(h, Number.isInteger(t.riverBranch) ? t.riverBranch + 1 : -1);
        }
        if (t.hasRoad) {
            h = _mix(h, Number.isInteger(t.roadLinks) ? t.roadLinks + 1 : -1);
            h = _mix(h, _id(t.roadTier));
        }
        if (inf) h = _mix(h, _id(inf.id));
        if (this.showTerritories) h = _mix(h, _id(t.kingdom == null ? '' : String(t.kingdom)));
        return h === TILE_SIG_UNSEEN ? 0 : h;
    },

    /** Off the cache: drawn hex by hex from now on (and dropped), as in the tests' stand-ins. */
    _terrainCacheUsable(ctx) {
        if (this._tcOff || this.mapMode !== 'normal' || !this.world) return false;
        if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
        if (!(this.canvas instanceof HTMLCanvasElement) || !ctx || ctx.canvas !== this.canvas) return false;
        return typeof ctx.setTransform === 'function' && typeof ctx.drawImage === 'function';
    },

    _tcCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        return g ? { c, g } : null;
    },

    /**
     * The terrain from the cache, brought up to the camera: true when drawn so, false when
     * the caller must draw it hex by hex (zooming, a map mode, no canvas).
     */
    drawTerrainCached(ctx) {
        if (!this._terrainCacheUsable(ctx)) { this._tc = null; return false; }
        const cam = this.camera;
        const z = cam.zoom;
        const lastZ = this._tcLastZoom;
        this._tcLastZoom = z;
        const W = this.canvas.width, H = this.canvas.height;
        const k = this.canvas.pixelRatio || 1;
        const dw = Math.round(W * k), dh = Math.round(H * k);
        if (!(dw > 0 && dh > 0 && z > 0)) return false;
        const kingdoms = this.world.kingdoms;
        const key = `${dw}x${dh}|${W}x${H}|${k}|${this.hexSize}|${this.showTerritories ? 1 : 0}|${this.imagesLoaded ? 'all' : this.tileSprites.size}|${kingdoms ? kingdoms.length : 0}|${this.world.width}x${this.world.height}`;
        let tc = this._tc;
        const same = !!(tc && tc.valid && tc.key === key && tc.world === this.world);
        const sameZoom = same && Math.abs(z - tc.z) <= z * 1e-4;
        // Zooming: hex by hex until the zoom comes to rest (it eases in: a frame's step this small leaves
        // under a tenth of a pixel to go at the map's edge, so the canvas drawn now is good to the end)
        const settled = lastZ !== undefined && Math.abs(z - lastZ) <= z * 1e-5;
        if (!sameZoom && !settled) { if (tc) tc.valid = false; return false; }

        if (!tc || tc.dw !== dw || tc.dh !== dh) {
            let a = null, b = null;
            try { a = this._tcCanvas(dw, dh); b = this._tcCanvas(dw, dh); } catch { a = b = null; }
            if (!a || !b) { this._tcOff = true; this._tc = null; return false; }
            tc = this._tc = { a, b, dw, dh, valid: false, sigs: null };
        }
        const N = this.world.width * this.world.height;
        if (!tc.sigs || tc.sigs.length !== N || tc.world !== this.world) {
            tc.sigs = new Int32Array(N).fill(TILE_SIG_UNSEEN);
            tc.valid = false;
        }

        let rebuild = !sameZoom;
        if (!rebuild) {
            // The camera's move since the canvas was drawn, in whole device pixels
            const zc = tc.z;
            let dx = tc.ox - cam.x;
            const wpw = cam.worldPixelWidth;
            if (wpw > 0) dx = ((dx % wpw) + wpw * 1.5) % wpw - wpw / 2;
            const sx = Math.round(dx * zc * k), sy = Math.round((tc.oy - cam.y) * zc * k);
            if (Math.abs(sx) > dw * 0.6 || Math.abs(sy) > dh * 0.6) rebuild = true;
            else if (sx || sy) {
                if (!this._tcScroll(tc, sx, sy, k)) rebuild = true;
            }
            // Anything about a hex in view changed since it was drawn: draw it all afresh. All
            // the view is checked when the player has moved or a day has passed (what is in sight
            // changes then), else a quarter of its rows a frame, in turn
            if (!rebuild) {
                const p = this.player;
                const stamp = `${p ? p.q : ''},${p ? p.r : ''},${this.world.day}`;
                const all = stamp !== tc.stamp;
                tc.stamp = stamp;
                tc.turn = ((tc.turn || 0) + 1) & 3;
                if (this._tcChanged(tc, all ? -1 : tc.turn)) rebuild = true;
            }
        }
        if (rebuild) this._tcBuild(tc, k, key);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(tc.a.c, 0, 0);
        ctx.restore();
        // The frontier's cloud banks, from where the camera is (renderer/fog.js)
        this._terrainPass(ctx, null, true);
        return true;
    },

    /** Draw the whole canvas afresh at the camera's place and zoom. */
    _tcBuild(tc, k, key) {
        const cam = this.camera;
        const g = tc.a.g;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, tc.dw, tc.dh);
        g.setTransform(k, 0, 0, k, 0, 0);
        g.imageSmoothingEnabled = true;
        tc.ox = cam.x;
        tc.oy = cam.y;
        tc.z = cam.zoom;
        tc.key = key;
        tc.world = this.world;
        const v = { ox: tc.ox, oy: tc.oy, z: tc.z, x0: 0, x1: this.canvas.width, y0: 0, y1: this.canvas.height, sigs: tc.sigs, changed: false };
        g.save();
        this._terrainPass(g, v);
        this.renderFogFaces(g);
        g.restore();
        tc.valid = true;
        tc.stamp = null;
        tc.builds = (tc.builds || 0) + 1;
    },

    /**
     * Shift the canvas by (sx, sy) device pixels (the map moved that way) and draw the
     * strips bared at its edges. False when a hex drawn in a strip had changed (the rest of
     * the canvas would be stale about it): the caller draws all afresh.
     */
    _tcScroll(tc, sx, sy, k) {
        const src = tc.a, dst = tc.b;
        const g = dst.g;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, tc.dw, tc.dh);
        g.drawImage(src.c, sx, sy);
        tc.a = dst;
        tc.b = src;
        // The canvas now shows the map about a point moved by the whole pixels shifted
        tc.ox -= sx / (k * tc.z);
        tc.oy -= sy / (k * tc.z);
        const wpw = this.camera.worldPixelWidth;
        if (wpw > 0) tc.ox = ((tc.ox % wpw) + wpw) % wpw;
        const W = this.canvas.width, H = this.canvas.height;
        // The bared strips in CSS pixels (device-pixel exact under the k transform)
        const strips = [];
        if (sx > 0) strips.push([0, 0, sx / k, H]);
        else if (sx < 0) strips.push([W + sx / k, 0, W, H]);
        // (the corner the column strip already covers is left out of the row's)
        const cx0 = sx > 0 ? sx / k : 0, cx1 = sx < 0 ? W + sx / k : W;
        if (sy > 0) strips.push([cx0, 0, cx1, sy / k]);
        else if (sy < 0) strips.push([cx0, H + sy / k, cx1, H]);
        let changed = false;
        g.setTransform(k, 0, 0, k, 0, 0);
        g.imageSmoothingEnabled = true;
        for (const [x0, y0, x1, y1] of strips) {
            if (!(x1 > x0 && y1 > y0)) continue;
            const v = { ox: tc.ox, oy: tc.oy, z: tc.z, x0, x1, y0, y1, sigs: tc.sigs, changed: false };
            g.save();
            g.beginPath();
            g.rect(x0, y0, x1 - x0, y1 - y0);
            g.clip();
            this._terrainPass(g, v);
            this.renderFogFaces(g);
            g.restore();
            if (v.changed) changed = true;
        }
        tc.scrolls = (tc.scrolls || 0) + 1;
        return !changed;
    },

    /**
     * Whether a hex in view (and one about it) is no longer as it was drawn: every row, or
     * (part 0..3) every fourth.
     */
    _tcChanged(tc, part = -1) {
        const world = this.world;
        const W = world.width, Hh = world.height;
        const sigs = tc.sigs;
        const hexWidth = Math.sqrt(3) * this.hexSize;
        const rowHeight = hexWidth * 0.75;
        const z = tc.z;
        const halfW = this.canvas.width / 2 / z, halfH = this.canvas.height / 2 / z;
        const left = tc.ox - halfW, right = tc.ox + halfW, top = tc.oy - halfH, bottom = tc.oy + halfH;
        const minR = Math.max(0, Math.floor(top / rowHeight) - 1);
        const maxR = Math.min(Hh - 1, Math.ceil(bottom / rowHeight) + 1);
        for (let r = minR; r <= maxR; r++) {
            if (part >= 0 && (r & 3) !== part) continue;
            const row = world.tiles[r];
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const q0 = Math.floor((left - offsetX) / hexWidth) - 1;
            const q1 = Math.ceil((right - offsetX) / hexWidth) + 1;
            for (let q = q0; q <= q1; q++) {
                const wq = ((q % W) + W) % W;
                const i = r * W + wq;
                const s = sigs[i];
                if (s !== TILE_SIG_UNSEEN && s !== this._tileSig(row[wq])) return true;
            }
        }
        return false;
    },
});
