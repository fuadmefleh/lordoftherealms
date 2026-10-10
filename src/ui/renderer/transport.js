// Renderer — the roads' state on the world map (world/transport.js): a line
// over each explored road coloured and sized by its tier and repair (a pale
// broad highway, a thin dashed track, orange where rutted, red and broken
// where ruined, ice-blue where a pass is snowed shut), ⛴️ / 🌊 where a
// bridge is down, 🪙 at a toll gate, 🚧 where public works are under way,
// and the canals as blue water lines between their towns. Drawn above the
// road sprites from data/transport.json render.minZoom up.
import { Renderer } from './core.js';
import { Transport } from '../../world/transport.js';

Object.assign(Renderer.prototype, {
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
            const pts = [seg.a];
            for (const i of seg.path) pts.push(Transport.hexOf(world, i));
            pts.push(seg.b);
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
                if (explored(mid)) icons.push([scr(mid.q, mid.r), st.cl === 'snow' ? '❄️' : '🌊']);
            }
            for (const i of seg.rivers) {
                const p = Transport.hexOf(world, i);
                if (st.x !== 'bridge' && explored(p)) icons.push([scr(p.q, p.r), st.x === 'ferry' ? '⛴️' : '🌊']);
            }
            if (st.toll && seg.gate >= 0) {
                const p = Transport.hexOf(world, seg.gate);
                if (explored(p)) icons.push([scr(p.q, p.r), '🪙']);
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
            if (t && t.explored) icons.push([scr(w.q, w.r), '🚧']);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(11, size * 0.42)}px serif`;
        for (const [s, icon] of icons) {
            if (off(s)) continue;
            ctx.fillText(icon, s.x + size * 0.28, s.y - size * 0.28);
        }
        ctx.restore();
    },
});
