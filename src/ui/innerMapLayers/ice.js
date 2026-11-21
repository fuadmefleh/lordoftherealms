// InnerMapRenderer — the marks of the winter ice (after the season's footprints)
//
//   • _renderIceFx — the skate marks scored behind a skater, cracks running
//     out from under the player's feet on thin ice (wider the longer they
//     stand on it, and fresh each time it creaks), and the splash and the
//     shards where the ice gave way.
//
// The thin ice itself (darker, cracked), the solid ice and a broken hole's
// rim are the season's ground pass (innerMapLayers/streetSeasons.js); a
// refrozen hole is thin ice there. State: ui/innerMapIce.js (_fx, _trail).
// Looks only: the cracks are hashed, no randomness drawn.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapIce } from '../innerMapIce.js';
import { ssHash } from '../../world/streetSeasons.js';

const TRAIL_LIFE = 25000;   // ms a skate mark lasts
const SPLASH_LIFE = 1800;

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

Object.assign(InnerMapRenderer, {
    _iceThinSince: 0,
    _iceThinCell: null,

    _renderIceFx(ctx, camera) {
        if (!InnerMap._ss || InnerMap._insideBuilding || InnerMap._underwater || !InnerMap.tiles) return;
        const T = this.TILE_SIZE || 32;
        const ds = T * camera.zoom;
        const p = Math.max(1, Math.round(ds / 16));
        const now = _now();
        this._iceTrail(ctx, camera, now, p);
        this._iceUnderfoot(ctx, camera, now, T, ds, p);
        this._iceSplash(ctx, camera, now, T, ds, p);
    },

    /** Skate marks: pale scored lines fading behind the skater. */
    _iceTrail(ctx, camera, now, p) {
        const tr = InnerMapIce._trail;
        if (!tr || tr.length < 2) return;
        ctx.lineWidth = Math.max(1, p * 0.6);
        for (let i = 1; i < tr.length; i++) {
            const a = tr[i - 1], b = tr[i];
            if (b.cut) continue;
            const age = now - b.at;
            if (age > TRAIL_LIFE) continue;
            const al = 0.5 * (1 - age / TRAIL_LIFE);
            const s0 = camera.worldToScreenFast(a.x, a.y);
            const x0 = s0.x, y0 = s0.y;
            const s1 = camera.worldToScreenFast(b.x, b.y);
            // two blades a hand apart
            ctx.strokeStyle = `rgba(255, 255, 255, ${al.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(x0 - p, y0); ctx.lineTo(s1.x - p, s1.y);
            ctx.moveTo(x0 + p, y0 + p); ctx.lineTo(s1.x + p, s1.y + p);
            ctx.stroke();
        }
    },

    /** Thin ice under the player: cracks running out from their feet. */
    _iceUnderfoot(ctx, camera, now, T, ds, p) {
        const q = InnerMap.playerInnerQ, r = InnerMap.playerInnerR;
        const t = InnerMap.tiles[r] && InnerMap.tiles[r][q];
        const key = `${q},${r}`;
        if (!t || t._iced !== 1) { this._iceThinCell = null; return; }
        if (this._iceThinCell !== key) { this._iceThinCell = key; this._iceThinSince = now; }
        const fx = InnerMapIce._fx && InnerMapIce._fx.crack;
        const fresh = fx && fx.q === q && fx.r === r ? Math.max(0, 1 - (now - fx.at) / 900) : 0;
        const grow = Math.min(1, (now - this._iceThinSince) / 2500);
        const reach = ds * (0.35 + 0.55 * grow + 0.3 * fresh);
        const c = camera.worldToScreenFast(q * T + T / 2, r * T + T * 0.7);
        const cx = c.x, cy = c.y;
        const rays = 5 + Math.floor(ssHash(q, r, 7) * 3);
        ctx.lineWidth = Math.max(1, p * (fresh > 0 ? 1 : 0.7));
        for (let i = 0; i < rays; i++) {
            let a = (i / rays) * Math.PI * 2 + ssHash(q, r, i) * 0.8;
            let x = cx, y = cy;
            const steps = 4;
            ctx.strokeStyle = `rgba(20, 52, 76, ${(0.55 + 0.35 * fresh).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let k = 0; k < steps; k++) {
                a += (ssHash(q * 7 + i, r, k) - 0.5) * 0.9;
                const len = reach / steps * (0.7 + ssHash(i, k, q, r) * 0.6);
                x += Math.cos(a) * len; y += Math.sin(a) * len * 0.6;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // a glint along the fresh cracks
        if (fresh > 0) {
            ctx.fillStyle = `rgba(235, 248, 255, ${(0.7 * fresh).toFixed(3)})`;
            for (let i = 0; i < rays; i++) {
                const a = (i / rays) * Math.PI * 2 + ssHash(q, r, i) * 0.8;
                ctx.fillRect(Math.round(cx + Math.cos(a) * reach * 0.5), Math.round(cy + Math.sin(a) * reach * 0.3), p, p);
            }
        }
    },

    /** Where the ice gave way: rings on the black water, shards of ice thrown up. */
    _iceSplash(ctx, camera, now, T, ds, p) {
        const fx = InnerMapIce._fx && InnerMapIce._fx.splash;
        if (!fx) return;
        const age = now - fx.at;
        if (age > SPLASH_LIFE) { InnerMapIce._fx.splash = null; return; }
        const k = age / SPLASH_LIFE;
        const c = camera.worldToScreenFast(fx.q * T + T / 2, fx.r * T + T / 2);
        const cx = c.x, cy = c.y;
        ctx.lineWidth = Math.max(1, p);
        for (let i = 0; i < 3; i++) {
            const kk = k - i * 0.18;
            if (kk <= 0) continue;
            ctx.strokeStyle = `rgba(225, 242, 252, ${(0.7 * (1 - kk)).toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(cx, cy, ds * (0.2 + kk * 0.6), ds * (0.1 + kk * 0.3), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        // shards and spray: up and falling back
        const n = 9;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + ssHash(fx.q, fx.r, i) * 0.5;
            const out = ds * (0.2 + 0.5 * k) * (0.6 + ssHash(i, fx.q, fx.r) * 0.6);
            const up = Math.sin(Math.min(1, k * 1.4) * Math.PI) * ds * 0.5 * (0.5 + ssHash(fx.r, i, fx.q));
            ctx.fillStyle = i % 3 === 0 ? `rgba(190, 224, 240, ${(1 - k).toFixed(3)})` : `rgba(250, 253, 255, ${(1 - k).toFixed(3)})`;
            ctx.fillRect(Math.round(cx + Math.cos(a) * out), Math.round(cy + Math.sin(a) * out * 0.5 - up), p * (i % 2 ? 2 : 1), p);
        }
    },
});
