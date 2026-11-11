// InnerMapRenderer — things adrift on the river, and the weirs that catch
// them (mixed in via Object.assign; the state is ui/innerMapRiverDrift.js).
//
// Drawn over the living water and under every sprite (innerMapRenderer.js,
// after waterFx): a weir across the river where the hex has one — a timber
// dam (two logs laid across on stakes) or a mill's stone weir — the water
// pooled dark above it and spilling white below; then each thing on the
// water as a small token bobbing in a ring of ripples (hidden going under a
// bridge), the ones on the weir crowded against it, the ones lost at sea
// sinking out of sight.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapRiverDrift } from '../innerMapRiverDrift.js';
import { RiverDrift } from '../../systems/riverDrift.js';
import { glyphFor, itemPicture } from '../icons.js';
import { drawMapMarker } from '../mapInk.js';

const TIMBER = { log: '#7a5230', hi: '#a77a4a', lo: '#4a2f18', end: '#c49a62', ring: '#6a4426', stake: '#3d2614' };
// Goods with a picture of their own (ui/icons.js itemPicture), loaded once
const _pics = new Map();
function _pic(id) {
    const src = itemPicture(id);
    if (!src) return null;
    let img = _pics.get(src);
    if (!img) {
        img = new Image();
        img.src = src;
        _pics.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}

const STONE = { log: '#8a8c86', hi: '#b3b5ae', lo: '#5b5d58', end: '#9fa199', ring: '#70726c', stake: '#4b4d48' };

Object.assign(InnerMapRenderer, {
    _renderRiverDrift(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding) return;
        const world = InnerMapRiverDrift._world;
        if (!world || !InnerMapRiverDrift.course()) return;
        const T = this.TILE_SIZE;
        const cs = T * camera.zoom;
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        ctx.save();
        const dam = InnerMapRiverDrift.damLine(world);
        if (dam) this._drawRiverDam(ctx, camera, dam, T, cs, now);
        for (const s of InnerMapRiverDrift._shown) this._drawDriftThing(ctx, camera, s, T, cs, now, 1, 0);
        for (const f of InnerMapRiverDrift._fading) {
            const k = f.t / f.life;
            // lost at sea: it goes under; out of sight downstream: it fades off the edge
            this._drawDriftThing(ctx, camera, f, T, cs, now, 1 - k, f.sea ? k : 0);
        }
        ctx.restore();
    },

    /** A thing on the water: ripples round it, the token bobbing (sink 0..1: going under) */
    _drawDriftThing(ctx, camera, s, T, cs, now, alpha, sink) {
        if (alpha <= 0.02) return;
        const tile = InnerMap.getTile(Math.round(s.x), Math.round(s.y));
        if (!tile || !tile.explored || !tile.visible) return;
        if (tile._bridge) return; // under the bridge
        const cfg = RiverDrift.config();
        const p = camera.worldToScreenFast((s.x + 0.5) * T, (s.y + 0.5) * T);
        const art = Math.max(1, cs / 32);
        const ph = (s.phase || 0) + now * (s.kind === 'drift' ? 2.4 : 1.4);
        const bob = Math.sin(ph) * cfg.bob * art - sink * cs * 0.35;
        const r = Math.max(7, cs * 0.2) * (1 - sink * 0.6);
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = '#dff3ff';
        ctx.lineWidth = Math.max(1, art);
        // two rings spreading off it
        for (let i = 0; i < 2; i++) {
            const k = ((now * 0.6 + (s.phase || 0) + i * 0.5) % 1);
            ctx.globalAlpha = alpha * 0.5 * (1 - k);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + r * 0.35, r * (0.8 + k * 0.9), r * (0.32 + k * 0.36), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = '#0b2236';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.35, r * 0.75, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        // The thing itself, riding low: its picture (or its emoji, as the packs show it),
        // the lower part under the water; a token only for a good with neither
        const it = s.item || {};
        const img = _pic(it.itemId);
        const emoji = !img && typeof it.icon === 'string' && it.icon && !/^[a-z_-]+$/i.test(it.icon) ? it.icon : null;
        if (img || emoji) {
            const size = Math.max(14, cs * 0.5) * (1 - sink * 0.5);
            const cx = p.x, top = p.y - size * 0.62 + bob;
            const line = p.y + r * 0.1 + bob * 0.3; // the waterline
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx - size, top - size, size * 2, line - top + size); // nothing below the water shows
            ctx.clip();
            // (rocking a little with the current)
            ctx.translate(cx, top + size / 2);
            ctx.rotate(Math.sin(ph * 0.7) * 0.12);
            if (img) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, -size / 2, -size / 2, size, size);
            } else {
                ctx.font = `${Math.round(size * 0.82)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(emoji, 0, 0);
            }
            ctx.restore();
            // the water lapping round it at the line
            ctx.globalAlpha = alpha * 0.7;
            ctx.strokeStyle = '#e8f7ff';
            ctx.lineWidth = Math.max(1, art);
            ctx.beginPath();
            ctx.ellipse(cx, line, size * 0.42, size * 0.1, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            drawMapMarker(ctx, glyphFor(it.icon) || 'satchel', p.x, p.y - r * 0.2 + bob, r);
        }
        ctx.globalAlpha = 1;
    },

    /**
     * The weir across the river: drawn turned to lie square across the flow
     * (local x across the river, local y downstream).
     */
    _drawRiverDam(ctx, camera, dam, T, cs, now) {
        const c = camera.worldToScreenFast((dam.x + 0.5) * T, (dam.y + 0.5) * T);
        // visible at all? (its middle cell)
        const t = InnerMap.getTile(Math.round(dam.x), Math.round(dam.y));
        if (!t || !t.explored) return;
        const P = dam.kind === 'mill' ? STONE : TIMBER;
        const x0 = dam.a * cs, x1 = dam.b * cs, w = x1 - x0;
        const art = Math.max(1, Math.round(cs / 32));
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(Math.atan2(dam.ny, dam.nx));
        // the water held back above it: darker, still
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#0d2a44';
        ctx.fillRect(x0 + cs * 0.3, -cs * 1.1, w - cs * 0.6, cs * 0.9);
        // the spill below: white water tumbling off it, running on downstream
        ctx.fillStyle = '#f2fbff';
        const n = Math.max(4, Math.floor(w / (art * 5)));
        for (let i = 0; i < n; i++) {
            const h = ((i * 0.618) % 1);
            const k = (now * (0.9 + h * 0.6) + h * 3) % 1;
            ctx.globalAlpha = 0.65 * (1 - k);
            const x = x0 + cs * 0.3 + (w - cs * 0.6) * ((i + 0.5) / n) + Math.sin(now * 2 + i) * art;
            ctx.fillRect(Math.round(x), Math.round(cs * 0.2 + k * cs * 0.6), art * 2, art * (2 + Math.round(2 * (1 - k))));
        }
        ctx.globalAlpha = 1;
        // stakes driven in below the logs
        ctx.fillStyle = P.stake;
        const stakes = Math.max(2, Math.round(w / (cs * 0.9)));
        for (let i = 0; i <= stakes; i++) {
            const x = x0 + (w - art * 3) * (i / stakes);
            ctx.fillRect(Math.round(x), Math.round(cs * 0.08), art * 3, art * 6);
        }
        // the logs (or the stone sill), two laid across, ends showing on the banks
        const lh = Math.max(art * 5, cs * 0.26);
        for (let j = 0; j < 2; j++) {
            const y = -lh * (j ? 0.15 : 1.15) - (j ? 0 : art);
            ctx.fillStyle = P.log;
            ctx.fillRect(Math.round(x0), Math.round(y), Math.round(w), Math.round(lh));
            ctx.fillStyle = P.hi;
            ctx.fillRect(Math.round(x0), Math.round(y), Math.round(w), art);
            ctx.fillStyle = P.lo;
            ctx.fillRect(Math.round(x0), Math.round(y + lh - art), Math.round(w), art);
            // a knot or a joint every so often
            ctx.fillStyle = P.lo;
            for (let x = x0 + cs * 0.55 + j * cs * 0.3; x < x1 - cs * 0.3; x += cs * (dam.kind === 'mill' ? 0.5 : 1.3)) {
                ctx.fillRect(Math.round(x), Math.round(y + art), art, Math.round(lh - art * 2));
            }
            // the ends
            ctx.fillStyle = P.end;
            ctx.fillRect(Math.round(x0), Math.round(y), art * 2, Math.round(lh));
            ctx.fillRect(Math.round(x1 - art * 2), Math.round(y), art * 2, Math.round(lh));
            ctx.fillStyle = P.ring;
            ctx.fillRect(Math.round(x0 + art * 0.5), Math.round(y + lh / 2 - art / 2), art, art);
            ctx.fillRect(Math.round(x1 - art * 1.5), Math.round(y + lh / 2 - art / 2), art, art);
        }
        ctx.restore();
    },
});
