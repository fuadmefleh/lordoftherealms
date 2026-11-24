// Renderer — the weather at sea on the world map (world/seaWinds.js,
// systems/seaPassage.js): storms crossing the sea drawn as turning bands of
// cloud over charted water, the major ports' lighthouses as a slow-turning
// beam, and — aboard ship — an arrow by the player for the wind (the way it
// blows, its length its strength). data/seaWinds.json `display`.
import { Renderer } from './core.js';
import { SeaWinds, SeaStorms } from '../../world/seaWinds.js';
import { SeaPassage } from '../../systems/seaPassage.js';
import { DataLoader } from '../../core/dataLoader.js';

function display() {
    const src = DataLoader._gamedata && DataLoader._gamedata.seaWinds;
    return { enabled: true, storms: true, lights: true, arrow: true, ...((src && src.display) || {}) };
}

Object.assign(Renderer.prototype, {
    /** Screen position of hex (q, r), the copy nearest the player on a wrapping map. */
    _seaScreen(q, r) {
        const W = this.world.width || 0;
        let qq = q;
        if (W && this.player) {
            const d = q - this.player.q;
            qq = q - Math.round(d / W) * W;
        }
        const pos = this.getHexPixelPos(qq, r);
        return this.camera.worldToScreen(pos.x, pos.y);
    },

    renderSeaWeather(ctx) {
        const world = this.world;
        if (!world || !world.tiles) return;
        const D = display();
        if (!D.enabled || !SeaWinds.active(world)) return;
        const zoom = this.camera.zoom;
        const hexW = Math.sqrt(3) * this.hexSize * zoom;
        const t = this.time || 0;
        const cw = ctx.canvas ? ctx.canvas.width : 4000;
        const ch = ctx.canvas ? ctx.canvas.height : 4000;
        const onScreen = (p, m) => p.x > -m && p.y > -m && p.x < cw + m && p.y < ch + m;
        ctx.save();
        try {
            // Storms: turning arcs of cloud, over sea the player has charted
            if (D.storms) {
                for (const st of SeaStorms.active(world, world.day)) {
                    const tile = world.getTile(st.q, st.r);
                    if (!tile || !tile.explored) continue;
                    const c = this._seaScreen(st.q, st.r);
                    const R = (st.radius + 0.6) * hexW;
                    if (!onScreen(c, R)) continue;
                    const spin = (st.south ? -1 : 1) * t * 0.6;
                    const a = Math.min(0.55, 0.22 + 0.2 * st.intensity) * (tile.visible ? 1 : 0.6);
                    const g = ctx.createRadialGradient(c.x, c.y, R * 0.1, c.x, c.y, R);
                    g.addColorStop(0, `rgba(70,78,92,${a})`);
                    g.addColorStop(1, 'rgba(70,78,92,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.lineCap = 'round';
                    for (let k = 0; k < 4; k++) {
                        const rr = R * (0.3 + 0.17 * k);
                        const s0 = -spin * (1.4 - k * 0.2) + k * 1.7;
                        ctx.strokeStyle = `rgba(225,230,240,${(a * 0.9).toFixed(3)})`;
                        ctx.lineWidth = Math.max(1, 2.2 * zoom);
                        ctx.beginPath();
                        ctx.arc(c.x, c.y, rr, s0, s0 + 1.9);
                        ctx.stroke();
                    }
                    // the eye
                    ctx.fillStyle = `rgba(20,24,30,${(a * 0.8).toFixed(3)})`;
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, Math.max(2, hexW * 0.12), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            // Lighthouses: a beacon and its turning beam at the major ports
            if (D.lights && zoom >= 0.35) {
                for (const l of SeaPassage.lighthouses(world, this.player)) {
                    const tile = world.getTile(l.q, l.r);
                    if (!tile || !tile.explored) continue;
                    const c = this._seaScreen(l.q, l.r);
                    if (!onScreen(c, hexW * 2)) continue;
                    const x = c.x + hexW * 0.32, y = c.y - hexW * 0.3;
                    const ang = t * 1.1 + (l.q * 7 + l.r * 3);
                    const len = hexW * 1.1;
                    ctx.strokeStyle = 'rgba(255,236,160,0.28)';
                    ctx.lineWidth = Math.max(1, 3 * zoom);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.6);
                    ctx.moveTo(x, y);
                    ctx.lineTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len * 0.6);
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(255,240,170,0.95)';
                    ctx.beginPath();
                    ctx.arc(x, y, Math.max(1.5, 2.6 * zoom), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            // The wind, by the player aboard ship
            if (D.arrow && this.player && this.player.boardedShip != null) {
                const w = SeaWinds.at(world, this.player.q, this.player.r, world.day);
                const c = this._seaScreen(this.player.q, this.player.r);
                const x = c.x - hexW * 0.75, y = c.y - hexW * 0.55;
                const len = hexW * (0.25 + 0.45 * w.strength);
                const x1 = x - w.x * len / 2, y1 = y - w.y * len / 2;
                const x2 = x + w.x * len / 2, y2 = y + w.y * len / 2;
                ctx.strokeStyle = 'rgba(235,245,255,0.9)';
                ctx.fillStyle = 'rgba(235,245,255,0.9)';
                ctx.lineWidth = Math.max(1.2, 2 * zoom);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                // feathers at the tail, one for every quarter of strength
                const fl = hexW * 0.12;
                for (let i = 0; i < Math.max(1, Math.ceil(w.strength * 4)); i++) {
                    const fx = x1 + w.x * i * fl * 0.6, fy = y1 + w.y * i * fl * 0.6;
                    ctx.moveTo(fx, fy);
                    ctx.lineTo(fx - w.x * fl * 0.5 - w.y * fl, fy - w.y * fl * 0.5 + w.x * fl);
                }
                ctx.stroke();
                const h = hexW * 0.13;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - w.x * h - w.y * h * 0.6, y2 - w.y * h + w.x * h * 0.6);
                ctx.lineTo(x2 - w.x * h + w.y * h * 0.6, y2 - w.y * h - w.x * h * 0.6);
                ctx.closePath();
                ctx.fill();
            }
        } finally {
            ctx.restore();
        }
    },
});
