// Renderer — the old roads of terrainGen 17+ (world/landHistory.js): a faint
// dotted line along each ancient way between ruins and to the passes, over
// explored hexes only, from data/landHistory.json oldRoads.render.minZoom up.
import { Renderer } from './core.js';
import { LandHistory } from '../../world/landHistory.js';

Object.assign(Renderer.prototype, {
    renderOldRoads(ctx) {
        const world = this.world;
        if (!world || !Array.isArray(world.oldRoads) || !world.oldRoads.length) return;
        const R = LandHistory.cfg().oldRoads.render || {};
        const z = this.camera.zoom;
        if (z < (R.minZoom || 0.45)) return;
        const W = this.canvas.width, H = this.canvas.height;
        const scr = (q, r) => { const p = this.getHexPixelPos(q, r); return this.camera.worldToScreen(p.x, p.y); };
        const off = (s) => s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80;
        const dash = Array.isArray(R.dash) ? R.dash : [2, 5];
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = R.color || '#8a7350';
        ctx.globalAlpha = R.alpha || 0.55;
        ctx.lineWidth = Math.max(1, (R.width || 1.5) * z);
        ctx.setLineDash(dash.map(x => x * z));
        ctx.beginPath();
        for (const road of world.oldRoads) {
            const pts = road.path;
            for (let i = 1; i < pts.length; i++) {
                const [aq, ar] = pts[i - 1], [bq, br] = pts[i];
                if (Math.abs(bq - aq) > 2) continue; // (across the wrap seam)
                const ta = world.getTile(aq, ar), tb = world.getTile(bq, br);
                if (!ta || !tb || !ta.explored || !tb.explored || !(ta._oldRoad || tb._oldRoad)) continue;
                const sa = scr(aq, ar), sb = scr(bq, br);
                if (off(sa) && off(sb)) continue;
                ctx.moveTo(sa.x, sa.y);
                ctx.lineTo(sb.x, sb.y);
            }
        }
        ctx.stroke();
        ctx.restore();
    },
});
