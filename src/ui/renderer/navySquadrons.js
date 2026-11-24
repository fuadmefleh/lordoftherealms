// Renderer — royal squadrons on the world map (world/navySquadrons.js).
//
// Each squadron in sight (its hex visible) is drawn as a little knot of
// ships — a hull and a sail in its realm's colour, one to three of them by
// its size — with its name at a readable zoom. A blockade is tied to the
// port it holds by a dashed line; a patrol shows the way it is heading.
// The list is the day's cached one (no work per frame beyond the cull);
// trading ships are world units and draw with the other units.
import { Renderer } from './core.js';
import { NavySquadrons } from '../../world/navySquadrons.js';

function _ship(ctx, x, y, s, sail, flip) {
    const d = flip ? -1 : 1;
    ctx.fillStyle = 'rgba(52,36,24,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - s * d, y);
    ctx.lineTo(x + s * d, y);
    ctx.lineTo(x + s * 0.7 * d, y + s * 0.42);
    ctx.lineTo(x - s * 0.8 * d, y + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = sail;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.05 * d, y - s * 1.35);
    ctx.lineTo(x - s * 0.05 * d, y - s * 0.08);
    ctx.lineTo(x - s * 0.85 * d, y - s * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(240,232,212,0.95)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.12 * d, y - s * 1.1);
    ctx.lineTo(x + s * 0.12 * d, y - s * 0.08);
    ctx.lineTo(x + s * 0.7 * d, y - s * 0.15);
    ctx.closePath();
    ctx.fill();
}

Object.assign(Renderer.prototype, {
    renderNavySquadrons(ctx) {
        if (!this.world) return;
        const list = NavySquadrons.list(this.world);
        if (!list.length) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.save();
        for (const sq of list) {
            const tile = this.world.getTile(sq.q, sq.r);
            if (!tile || !tile.visible) continue;
            const pos = this.getHexPixelPos(sq.q, sq.r);
            const s = this.camera.worldToScreen(pos.x, pos.y);
            if (s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80) continue;
            // Which way she is heading: toward the next hex of her route (a blockade faces its port)
            let toX = s.x - 1;
            if (sq.kind === 'blockade' && sq.port) {
                const pp = this.getHexPixelPos(sq.port.q, sq.port.r);
                const ps = this.camera.worldToScreen(pp.x, pp.y);
                toX = ps.x;
                if (Math.abs(ps.x - s.x) < size * 4) {
                    ctx.strokeStyle = 'rgba(255,120,90,0.7)';
                    ctx.lineWidth = Math.max(1, 1.4 * z);
                    ctx.setLineDash([size * 0.12, size * 0.1]);
                    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(ps.x, ps.y); ctx.stroke();
                    ctx.setLineDash([]);
                }
            } else if (Array.isArray(sq.route) && sq.route.length > 1) {
                const i = sq.route.findIndex(h => h.q === sq.q && h.r === sq.r);
                const next = sq.route[i + 1] || sq.route[i - 1];
                if (next) toX = this.camera.worldToScreen(this.getHexPixelPos(next.q, next.r).x, 0).x;
            }
            const flip = toX < s.x;
            const n = Math.min(3, sq.ships);
            const ss = Math.max(4, size * 0.2);
            const t = (this.time || 0);
            for (let i = 0; i < n; i++) {
                const ox = (i - (n - 1) / 2) * ss * 1.7;
                const oy = (i % 2 ? ss * 0.5 : 0) + Math.sin(t * 1.5 + i) * ss * 0.06;
                _ship(ctx, s.x + ox, s.y + oy + ss * 0.3, ss, sq.color || '#8fb8ea', flip);
            }
            if (sq.kind === 'blockade') {
                ctx.strokeStyle = 'rgba(230,80,60,0.85)';
                ctx.lineWidth = Math.max(1, 1.6 * z);
                ctx.beginPath(); ctx.arc(s.x, s.y, size * 0.62, 0, Math.PI * 2); ctx.stroke();
            }
            if (z > 0.5) {
                const label = sq.kind === 'blockade' ? `Blockade · ${sq.kingdomName}` : sq.name;
                this.addLabel(label, s.x, s.y + size * 0.55, 3, {
                    font: `600 ${Math.max(8, 10 * z)}px 'Inter', sans-serif`,
                    fillStyle: sq.kind === 'blockade' ? '#ff9a80' : '#9ecbff',
                    shadowColor: 'rgba(0,0,0,0.7)', textAlign: 'center', textBaseline: 'top',
                });
            }
        }
        ctx.restore();
    },
});
