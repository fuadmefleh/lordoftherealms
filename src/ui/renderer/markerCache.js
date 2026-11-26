// Renderer — the world map's markers kept as pictures.
//
// A marker (ui/mapInk.js drawMapMarker: a struck plate with a soft shadow, a gradient and a
// rim, and a glyph on it) is a dozen canvas calls and a blurred shadow, drawn for every
// resource, town, site and lair in view, every frame. Here each marker of a size is drawn
// once into a small canvas at the map's pixel ratio and copied in after that, at the device
// pixel nearest its place (what moves is under half a pixel; the picture is the same
// drawing). Only where copying is the same as drawing: a glyph from the set (an emoji's
// look can change as pixel icons load), the context unrotated and unscaled but for its
// pixel ratio, fully opaque, no shadow or filter of its own. A size is kept once it has been
// asked for a few frames running, so a zoom gliding through sizes draws straight as before.

import { Renderer } from './core.js';
import { drawMapMarker, drawMarkerPlate } from '../mapInk.js';
import { drawIcon, glyphFor, GLYPHS } from '../icons.js';

const SEEN_TO_KEEP = 3;
const MAX_SPRITES = 400;

Object.assign(Renderer.prototype, {
    /**
     * A map marker: the struck plate with a glyph on it. `icon` is a glyph name
     * or an emoji from data (ui/icons.js glyphFor maps it).
     * opts: rim (plate rim colour), color (glyph colour).
     */
    drawMapMarker(ctx, icon, x, y, r, opts = {}) {
        if (!this._drawCachedMarker(ctx, icon, x, y, r, opts)) drawMapMarker(ctx, icon, x, y, r, opts);
    },

    _drawCachedMarker(ctx, icon, x, y, r, opts) {
        if (typeof document === 'undefined' || !ctx || typeof ctx.getTransform !== 'function') return false;
        const name = glyphFor(icon);
        if (!name || !GLYPHS[name] || !(r > 0)) return false;
        if (ctx.globalAlpha !== 1 || ctx.globalCompositeOperation !== 'source-over' || ctx.shadowBlur !== 0
            || (ctx.filter && ctx.filter !== 'none')) return false;
        const m = ctx.getTransform();
        const s = m.a;
        if (m.b !== 0 || m.c !== 0 || m.d !== s || !(s > 0)) return false;
        const rim = opts.rim || 'rgba(232, 192, 112, 0.75)';
        const color = opts.color || '#ecd9a8';
        const key = `${name}|${r}|${rim}|${color}|${s}`;
        let mc = this._markers;
        if (!mc) mc = this._markers = { sprites: new Map(), seen: new Map(), frame: -1 };
        let spr = mc.sprites.get(key);
        if (!spr) {
            // (kept only once asked for frames running: a glide through sizes is drawn straight)
            const t = this.time;
            const seen = mc.seen.get(key);
            if (!seen || seen.t !== t) {
                const n = seen ? seen.n + 1 : 1;
                if (mc.seen.size > 4000) mc.seen.clear();
                mc.seen.set(key, { n, t });
                if (n < SEEN_TO_KEEP) return false;
            } else if (seen.n < SEEN_TO_KEEP) return false;
            spr = this._makeMarker(name, r, rim, color, s);
            if (!spr) return false;
            if (mc.sprites.size >= MAX_SPRITES) mc.sprites.clear();
            mc.sprites.set(key, spr);
            mc.seen.delete(key);
        }
        const X = Math.round(m.a * x + m.e - spr.cx), Y = Math.round(m.d * y + m.f - spr.cy);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(spr.c, X, Y);
        ctx.restore();
        return true;
    },

    /** The marker drawn into a canvas of its own at `s` device pixels a unit, centred on (cx, cy). */
    _makeMarker(name, r, rim, color, s) {
        try {
            // the plate's shadow (blur r·0.6 and drop r·0.12 device px, as canvas shadows are not
            // scaled) and its rim reach past r; the glyph stays within 0.65 r
            const half = Math.ceil((r * 1.2) * s + r * 0.75 + 4);
            const size = half * 2;
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const g = c.getContext('2d');
            if (!g) return null;
            g.setTransform(s, 0, 0, s, half, half);
            drawMarkerPlate(g, 0, 0, r, rim);
            drawIcon(g, name, 0, 0, r * 1.3, color, 2.1);
            return { c, cx: half, cy: half };
        } catch { return null; }
    },
});
