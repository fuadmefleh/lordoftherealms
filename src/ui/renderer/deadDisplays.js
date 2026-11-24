// Renderer — the dead on show, marked on the world map (systems/gibbets.js,
// world/deadDisplays.js).
//
// A town with a head over its gate or a gibbet at its crossroads shows a small
// pike with a skull on it at the left of its hex (two or more: a pair of
// pikes). Drawn in canvas shapes, no sprite; the head darkens as the display
// rots to bones. Only explored hexes, only what is in view.
import { Renderer } from './core.js';
import { DeadDisplays } from '../../world/deadDisplays.js';

const HEAD = { fresh: '#c99a7a', rotting: '#8a9068', bones: '#e4dcc0' };

Object.assign(Renderer.prototype, {
    renderDeadDisplays(ctx) {
        const world = this.world;
        const g = world && world.gibbets;
        if (!g || !Array.isArray(g.towns) || !g.towns.length) return;
        const day = Number.isFinite(world.day) ? world.day : 0;
        const size = this.hexSize * this.camera.zoom;
        if (size < 9) return;
        for (const key of g.towns) {
            const [q, r] = key.split(',').map(Number);
            const tile = world.getTile(q, r);
            if (!tile || !tile.explored || !tile.settlement) continue;
            const up = DeadDisplays.standing(tile.settlement, day);
            if (!up.length) continue;
            const pos = this.getHexPixelPos(q, r);
            const sc = this.camera.worldToScreen(pos.x, pos.y);
            if (sc.x < -40 || sc.x > this.canvas.width + 40 || sc.y < -40 || sc.y > this.canvas.height + 40) continue;
            const n = Math.min(2, up.length);
            ctx.save();
            for (let i = 0; i < n; i++) {
                const d = up[up.length - 1 - i];
                const st = DeadDisplays.stage(d, day);
                const x = sc.x - size * (0.55 - i * 0.14);
                const base = sc.y + size * 0.1;
                const h = size * 0.5;
                const w = Math.max(1.5, size * 0.045);
                // the pike
                ctx.fillStyle = '#1a120c';
                ctx.fillRect(x - w / 2 - 1, base - h - 1, w + 2, h + 2);
                ctx.fillStyle = '#6e5238';
                ctx.fillRect(x - w / 2, base - h, w, h);
                // the head
                const hr = Math.max(2.2, size * 0.085);
                ctx.beginPath();
                ctx.arc(x, base - h - hr * 0.4, hr, 0, Math.PI * 2);
                ctx.fillStyle = HEAD[st ? st.id : 'bones'] || HEAD.bones;
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#1a120c';
                ctx.stroke();
                // the eyes
                if (size >= 18) {
                    ctx.fillStyle = '#1a120c';
                    ctx.fillRect(x - hr * 0.5, base - h - hr * 0.55, Math.max(1, hr * 0.32), Math.max(1, hr * 0.32));
                    ctx.fillRect(x + hr * 0.18, base - h - hr * 0.55, Math.max(1, hr * 0.32), Math.max(1, hr * 0.32));
                }
            }
            ctx.restore();
        }
    },
});
