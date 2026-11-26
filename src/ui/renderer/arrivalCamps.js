// Renderer — the newcomers' camps, marked on the world map (systems/arrivalCamps.js).
//
// A town with newcomers camped on its outskirts shows a little canvas tent at
// the right of its hex (two when the camp is big), drawn in canvas shapes.
// Only explored hexes, only what is in view; the list of towns is the day's
// (world._arrivalCampKeys, kept by ArrivalCamps.processDay; after a load it is
// found once from the towns' records).
import { Renderer } from './core.js';

Object.assign(Renderer.prototype, {
    renderArrivalCamps(ctx) {
        const world = this.world;
        if (!world || typeof world.getTile !== 'function') return;
        if (!Array.isArray(world._arrivalCampKeys)) {
            const keys = [];
            const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() || [] : [];
            for (const v of views) {
                const t = world.getTile(v.q, v.r);
                if (t && t.settlement && t.settlement.growth && t.settlement.growth.camp) keys.push(`${v.q},${v.r}`);
            }
            world._arrivalCampKeys = keys;
        }
        if (!world._arrivalCampKeys.length) return;
        const size = this.hexSize * this.camera.zoom;
        if (size < 10) return;
        for (const key of world._arrivalCampKeys) {
            const [q, r] = key.split(',').map(Number);
            const tile = world.getTile(q, r);
            const camp = tile && tile.explored && tile.settlement && tile.settlement.growth && tile.settlement.growth.camp;
            if (!camp) continue;
            const pos = this.getHexPixelPos(q, r);
            const sc = this.camera.worldToScreen(pos.x, pos.y);
            if (sc.x < -40 || sc.x > this.canvas.width + 40 || sc.y < -40 || sc.y > this.canvas.height + 40) continue;
            const n = camp.n - camp.housed > 40 ? 2 : 1;
            ctx.save();
            for (let i = 0; i < n; i++) {
                const w = size * (0.26 - i * 0.05);
                const x = sc.x + size * (0.62 + i * 0.2);
                const y = sc.y + size * (0.4 - i * 0.12);
                // the tent: a canvas triangle, its door flap darker
                ctx.beginPath();
                ctx.moveTo(x - w / 2, y);
                ctx.lineTo(x, y - w * 0.8);
                ctx.lineTo(x + w / 2, y);
                ctx.closePath();
                ctx.fillStyle = '#e6dcc2';
                ctx.fill();
                ctx.lineWidth = Math.max(1, size * 0.02);
                ctx.strokeStyle = '#3a2c1c';
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x - w * 0.12, y);
                ctx.lineTo(x, y - w * 0.45);
                ctx.lineTo(x + w * 0.12, y);
                ctx.closePath();
                ctx.fillStyle = '#7a6448';
                ctx.fill();
            }
            // a wisp of the camp fire's smoke
            if (size >= 18) {
                ctx.fillStyle = 'rgba(200,200,200,0.55)';
                ctx.beginPath();
                ctx.arc(sc.x + size * 0.84, sc.y + size * 0.24, size * 0.035, 0, Math.PI * 2);
                ctx.arc(sc.x + size * 0.87, sc.y + size * 0.17, size * 0.028, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    },
});
