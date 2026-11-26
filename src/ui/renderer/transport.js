// Renderer — the roads' state on the world map (world/transport.js): a line
// over each explored road coloured and sized by its tier and repair (a pale
// broad highway, a thin dashed track, orange where rutted, red and broken
// where ruined, ice-blue where a pass is snowed shut), ⛴️ / 🌊 where a
// bridge is down, 💰 at a toll gate, 🚧 where public works are under way,
// and the canals as blue water lines between their towns. Drawn above the
// road sprites from data/transport.json render.minZoom up.
import { Renderer } from './core.js';
import { Transport } from '../../world/transport.js';

Object.assign(Renderer.prototype, {
    /**
     * A road segment's hexes (its towns' at the ends) and their box in world pixels, kept
     * while its path is the same; offView(camera, w, h, pad) is true when no hex of it can
     * be within pad screen px of the view (the world wraps east-west: the box is measured
     * the short way round from the camera, and one across the seam is never ruled out).
     */
    _segGeom(world, seg) {
        if (!this._segGeoms || this._segGeomsWorld !== world) { this._segGeoms = new WeakMap(); this._segGeomsWorld = world; }
        let g = this._segGeoms.get(seg);
        if (g && g.path === seg.path && g.n === seg.path.length && g.a === seg.a && g.b === seg.b) return g;
        const pts = [seg.a];
        for (const i of seg.path) pts.push(Transport.hexOf(world, i));
        pts.push(seg.b);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pts) {
            const w = this.getHexPixelPos(p.q, p.r);
            if (w.x < x0) x0 = w.x;
            if (w.x > x1) x1 = w.x;
            if (w.y < y0) y0 = w.y;
            if (w.y > y1) y1 = w.y;
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
        g = {
            path: seg.path, n: seg.path.length, a: seg.a, b: seg.b, pts,
            offView(cam, w, h, pad) {
                const z = cam.zoom || 1;
                const wpw = cam.worldPixelWidth;
                if (wpw > 0 && hw * 2 >= wpw / 2) return false;
                let dx = cx - cam.x;
                if (wpw > 0) dx = ((dx % wpw) + wpw * 1.5) % wpw - wpw / 2;
                const mx = (w / 2 + pad) / z + hw, my = (h / 2 + pad) / z + hh;
                return Math.abs(dx) > mx || Math.abs(cy - cam.y) > my;
            },
        };
        this._segGeoms.set(seg, g);
        return g;
    },

    renderRoadState(ctx) {
        const world = this.world;
        if (!world || !world.transport) return;
        const R = Transport.config().render;
        const z = this.camera.zoom;
        if (z < (R.minZoom || 0.45)) return;
        const segs = Transport.segments(world);
        if (!segs.length) return;
        const W = this.canvas.width, H = this.canvas.height;
        const size = this.hexSize * z;
        const scr = (q, r) => { const p = this.getHexPixelPos(q, r); return this.camera.worldToScreen(p.x, p.y); };
        const off = (s) => s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80;
        const icons = [];
        ctx.save();
        ctx.lineCap = 'round';
        for (const seg of segs) {
            const st = Transport.segState(world, seg);
            const band = Transport.band(st);
            const tier = Transport.tier(st.t);
            // The plain road in good repair is the road sprite already
            if (band === 'good' && st.t === 'road' && !st.toll && (st.x === 'bridge' || !st.x)) continue;
            // (its hexes and the box round them in world pixels, kept per segment: most of the
            // realm's roads are off screen, and mapping every one of them each frame cost the map)
            const gm = this._segGeom(world, seg);
            if (gm.offView(this.camera, W, H, 80)) continue;
            const pts = gm.pts;
            const sp = pts.map(p => scr(p.q, p.r));
            if (sp.every(off)) continue;
            const explored = (p) => { const t = world.getTile(p.q, p.r); return !!(t && t.explored); };
            ctx.strokeStyle = band === 'closed' ? R.closed : band === 'ruined' ? R.ruined : band === 'worn' ? R.worn : tier.color;
            ctx.lineWidth = Math.max(1, (tier.width || 2) * z);
            ctx.globalAlpha = band === 'good' ? 0.75 : 0.9;
            ctx.setLineDash(band === 'ruined' ? [4 * z, 4 * z] : st.t === 'track' ? [6 * z, 3 * z] : []);
            ctx.beginPath();
            for (let i = 1; i < pts.length; i++) {
                if (!explored(pts[i - 1]) || !explored(pts[i]) || Math.abs(pts[i].q - pts[i - 1].q) > 2) continue;
                ctx.moveTo(sp[i - 1].x, sp[i - 1].y);
                ctx.lineTo(sp[i].x, sp[i].y);
            }
            ctx.stroke();
            if (band === 'closed') {
                const mid = pts[Math.floor(pts.length / 2)];
                if (explored(mid)) icons.push([scr(mid.q, mid.r), st.cl === 'snow' ? 'snowflake' : 'wave']);
            }
            for (const i of seg.rivers) {
                const p = Transport.hexOf(world, i);
                if (st.x !== 'bridge' && explored(p)) icons.push([scr(p.q, p.r), st.x === 'ferry' ? 'boat' : 'wave']);
            }
            if (st.toll && seg.gate >= 0) {
                const p = Transport.hexOf(world, seg.gate);
                if (explored(p)) icons.push([scr(p.q, p.r), 'coins']);
            }
        }
        ctx.setLineDash([]);
        // Canals: water lines between their towns
        const tr = world.transport;
        ctx.strokeStyle = R.canal;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = Math.max(2, 4 * z);
        for (const key of Object.keys(tr.canals || {})) {
            const [a, b] = key.split('|').map(k => k.split(',').map(Number));
            const ta = world.getTile(a[0], a[1]), tb = world.getTile(b[0], b[1]);
            if (!ta || !tb || !ta.explored || !tb.explored || Math.abs(a[0] - b[0]) > world.width / 2) continue;
            const sa = scr(a[0], a[1]), sb = scr(b[0], b[1]);
            if (off(sa) && off(sb)) continue;
            ctx.beginPath();
            ctx.moveTo(sa.x, sa.y);
            ctx.lineTo(sb.x, sb.y);
            ctx.stroke();
        }
        // Works under way
        for (const w of tr.works || []) {
            if (!w || (w.status !== 'building' && w.status !== 'stalled')) continue;
            const t = world.getTile(w.q, w.r);
            if (t && t.explored) icons.push([scr(w.q, w.r), 'barrier']);
        }
        ctx.globalAlpha = 1;
        for (const [s, icon] of icons) {
            if (off(s)) continue;
            this.drawMapMarker(ctx, icon, s.x + size * 0.28, s.y - size * 0.28, Math.max(9, size * 0.22));
        }
        ctx.restore();
    },
});
