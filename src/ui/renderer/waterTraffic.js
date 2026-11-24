// Renderer — the working boats on the world map: the ferries over the great
// rivers (world/ferries.js: a rope across the river and the raft on it) and
// across the straits (a dashed crossing between the two ports, the ferry on
// it), the fishing boats off the port towns (systems/ports.js fleet: a few
// sails on the water beside the town, on its fishing grounds where it has
// them — none while a storm or the ice keeps them in), the punts on the
// rivers by the river towns, and the barges carrying the river trade
// (systems/barges.js: the turn's biggest lot on a river link, moving along
// the river between the towns). Cheap: a few strokes each, only explored hexes
// on screen, each town's fleet worked out once a day. Drawn above the roads
// from MIN_ZOOM up.
import { Renderer } from './core.js';
import { Hex } from './_imports.js';
import { Ferries } from '../../world/ferries.js';
import { Ports } from '../../systems/ports.js';
import { Barges } from '../../systems/barges.js';

const MIN_ZOOM = 0.5;
const WATER = new Set(['ocean', 'deep_ocean', 'coast', 'sea', 'lake']);

function rnd(q, r, i) {
    let n = (Math.imul(q, 73856093) ^ Math.imul(r, 19349663) ^ Math.imul(i + 1, 83492791)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

Object.assign(Renderer.prototype, {
    /** The fishing boats of each town, worked out once a day: Map key → { boats, kept, spots: [{q, r}], river } */
    _fleetCache(world) {
        const day = world.day || 0;
        if (this._wtWorld !== world || this._wtDay !== day) {
            this._wtWorld = world;
            this._wtDay = day;
            this._wtFleets = new Map();
        }
        return this._wtFleets;
    },

    _townFleet(world, s) {
        const cache = this._fleetCache(world);
        const k = `${s.q},${s.r}`;
        if (cache.has(k)) return cache.get(k);
        let out = null;
        try {
            const fl = Ports.fleet(world, s.q, s.r, world.day || 0);
            if (fl && fl.boats > 0) {
                const spots = [];
                if (fl.water !== 'river') {
                    // the water beside the town, its fishing grounds first
                    const ns = Hex.neighbors(s.q, s.r).map(n => ({ q: Hex.wrapQ(n.q, world.width), r: n.r }))
                        .map(n => ({ ...n, t: world.getTile(n.q, n.r) }))
                        .filter(n => n.t && n.t.terrain && WATER.has(n.t.terrain.id));
                    ns.sort((a, b) => (typeof b.t.fishing === 'number' ? b.t.fishing : 0) - (typeof a.t.fishing === 'number' ? a.t.fishing : 0));
                    for (const n of ns.slice(0, 2)) spots.push({ q: n.q, r: n.r });
                } else {
                    for (const n of Hex.neighbors(s.q, s.r)) {
                        const t = world.getTile(Hex.wrapQ(n.q, world.width), n.r);
                        if (t && t.hasRiver && !t.settlement) { spots.push({ q: Hex.wrapQ(n.q, world.width), r: n.r }); break; }
                    }
                }
                out = { boats: Math.min(3, Math.ceil(fl.boats / 2)), kept: fl.kept, spots, river: fl.water === 'river' };
            }
        } catch (e) { out = null; }
        cache.set(k, out);
        return out;
    },

    renderWaterTraffic(ctx) {
        const world = this.world;
        if (!world || !world.tiles || !(world.width > 0)) return;
        const z = this.camera.zoom;
        if (z < MIN_ZOOM) return;
        const W = this.canvas.width, H = this.canvas.height;
        const size = this.hexSize * z;
        const t = this.time || 0;
        const scr = (q, r) => { const p = this.getHexPixelPos(q, r); return this.camera.worldToScreen(p.x, p.y); };
        const off = (p) => p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60;
        const seen = (q, r) => { const tl = world.getTile(Hex.wrapQ(q, world.width), r); return !!(tl && tl.explored); };
        ctx.save();
        ctx.lineCap = 'round';

        // ── River ferries: a rope across the river, the raft on it ──
        for (const f of Ferries.riverFerries(world)) {
            if (!seen(f.q, f.r)) continue;
            const c = scr(f.q, f.r);
            if (off(c)) continue;
            const tl = world.getTile(f.q, f.r);
            // across the river's run: perpendicular to the way it flows out of the hex
            let ang = 0;
            if (tl && Number.isInteger(tl.riverDir)) {
                const n = Hex.neighbors(f.q, f.r)[tl.riverDir];
                const d = scr(n.q, n.r);
                ang = Math.atan2(d.y - c.y, d.x - c.x) + Math.PI / 2;
            }
            const dx = Math.cos(ang) * size * 0.45, dy = Math.sin(ang) * size * 0.45;
            ctx.strokeStyle = 'rgba(60,40,20,0.9)';
            ctx.lineWidth = Math.max(1, 1.2 * z);
            ctx.beginPath(); ctx.moveTo(c.x - dx, c.y - dy); ctx.lineTo(c.x + dx, c.y + dy); ctx.stroke();
            const k = (Math.sin(t * 0.25 + f.q) + 1) / 2;
            const px = c.x - dx + 2 * dx * k, py = c.y - dy + 2 * dy * k;
            ctx.fillStyle = '#7a5530';
            ctx.strokeStyle = '#3e2a14';
            ctx.lineWidth = Math.max(1, z);
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(ang + Math.PI / 2);
            ctx.fillRect(-size * 0.13, -size * 0.09, size * 0.26, size * 0.18);
            ctx.strokeRect(-size * 0.13, -size * 0.09, size * 0.26, size * 0.18);
            ctx.restore();
            if (z >= 1.1) {
                ctx.font = `${Math.max(9, Math.round(size * 0.16))}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(30,20,10,0.85)';
                ctx.fillText(`⛴ ${f.fare}g`, c.x, c.y + size * 0.42);
            }
        }

        // ── Strait ferries: the crossing dashed between the ports, the ferry on it ──
        ctx.setLineDash([5 * z, 4 * z]);
        for (const f of Ferries.straits(world)) {
            if (!seen(f.a.q, f.a.r) || !seen(f.b.q, f.b.r)) continue;
            if (Math.abs(f.a.q - f.b.q) > world.width / 2) continue;
            const a = scr(f.a.q, f.a.r), b = scr(f.b.q, f.b.r);
            if (off(a) && off(b)) continue;
            ctx.strokeStyle = 'rgba(235,225,190,0.7)';
            ctx.lineWidth = Math.max(1, 1.5 * z);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const k = (Math.sin(t * 0.12 + f.a.q * 0.7) + 1) / 2;
            this._wtSail(ctx, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, size * 0.85, '#d8c8a0', t);
        }
        ctx.setLineDash([]);

        // ── Fishing boats off the towns; punts on the rivers ──
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const s of views) {
            if (!s || !seen(s.q, s.r)) continue;
            const c = scr(s.q, s.r);
            if (off(c)) continue;
            const fl = this._townFleet(world, s);
            if (!fl || fl.kept || !fl.spots.length) continue;
            for (let i = 0; i < fl.boats; i++) {
                const sp = fl.spots[i % fl.spots.length];
                if (!seen(sp.q, sp.r)) continue;
                const p = scr(sp.q, sp.r);
                const jx = (rnd(sp.q, sp.r, i) - 0.5) * size * 0.6 + Math.sin(t * 0.3 + i * 2) * size * 0.06;
                const jy = (rnd(sp.q, sp.r, i + 5) - 0.5) * size * 0.45;
                if (fl.river) this._wtPunt(ctx, p.x + jx * 0.5, p.y + jy * 0.5, size, t + i);
                else this._wtSail(ctx, p.x + jx, p.y + jy, size * 0.7, '#8a5a3a', t + i);
            }
        }

        // ── Barges with the river trade ──
        const day = world.day || 0;
        for (const b of Barges.list(world)) {
            const pos = Barges.positionAt(b, day + 0.5);
            if (!pos || !seen(pos.q, pos.r)) continue;
            const a = scr(pos.q, pos.r);
            let n = scr(pos.nq, pos.nr);
            if (Math.abs(pos.q - pos.nq) > world.width / 2) n = a;
            const x = a.x + (n.x - a.x) * pos.f, y = a.y + (n.y - a.y) * pos.f;
            if (off({ x, y })) continue;
            this._wtBarge(ctx, x, y, Math.atan2(n.y - a.y, n.x - a.x), size, t);
            if (z >= 1.3) {
                ctx.font = `${Math.max(9, Math.round(size * 0.15))}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(20,30,40,0.85)';
                ctx.fillText(`${b.qty} ${String(b.good).replace(/_/g, ' ')} → ${b.to.name}`, x, y - size * 0.25);
            }
        }
        ctx.restore();
    },

    _wtSail(ctx, x, y, size, sail, t) {
        const bob = Math.sin(t * 1.3) * size * 0.015;
        ctx.fillStyle = '#5e3e20';
        ctx.beginPath();
        ctx.moveTo(x - size * 0.12, y + bob);
        ctx.lineTo(x + size * 0.12, y + bob);
        ctx.lineTo(x + size * 0.08, y + size * 0.05 + bob);
        ctx.lineTo(x - size * 0.08, y + size * 0.05 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = sail;
        ctx.beginPath();
        ctx.moveTo(x, y - size * 0.17 + bob);
        ctx.lineTo(x + size * 0.09, y - size * 0.01 + bob);
        ctx.lineTo(x, y - size * 0.01 + bob);
        ctx.closePath();
        ctx.fill();
    },

    _wtPunt(ctx, x, y, size, t) {
        ctx.fillStyle = '#5e4024';
        ctx.fillRect(x - size * 0.09, y - size * 0.025 + Math.sin(t) * size * 0.01, size * 0.18, size * 0.05);
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath(); ctx.arc(x - size * 0.03, y - size * 0.04, size * 0.022, 0, Math.PI * 2); ctx.fill();
    },

    _wtBarge(ctx, x, y, ang, size, t) {
        ctx.save();
        ctx.translate(x, y + Math.sin(t * 0.8) * size * 0.01);
        ctx.rotate(ang);
        ctx.fillStyle = '#4e3620';
        ctx.fillRect(-size * 0.18, -size * 0.06, size * 0.36, size * 0.12);
        ctx.fillStyle = '#c2ac7c';
        ctx.fillRect(-size * 0.1, -size * 0.04, size * 0.07, size * 0.08);
        ctx.fillStyle = '#9a7444';
        ctx.fillRect(-size * 0.01, -size * 0.04, size * 0.07, size * 0.08);
        ctx.strokeStyle = '#6b4a26';
        ctx.lineWidth = Math.max(1, size * 0.012);
        ctx.beginPath(); ctx.moveTo(-size * 0.16, 0); ctx.lineTo(-size * 0.3, size * 0.1); ctx.stroke();
        ctx.restore();
    },
});
