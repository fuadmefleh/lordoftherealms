// Renderer — the fate of prisoners on the world map (world/warStakes.js,
// player/prisonerFates.js).
//
// A FOREST OF STAKES: each hex of a stake line in sight is drawn as a little
// grove of leaning poles, each with its burden, darker and fewer as the line
// rots (WarStakes.fresh 1 → 0; then only bare poles until it is gone). The
// player's own lines carry their name at a readable zoom; a realm's are
// labelled by who raised them. A BLINDED COLUMN walking home is a file of grey
// figures, one led by another, on its hex. Drawn in sight only (tile.visible),
// culled to the screen; no work per frame beyond the cull.
import { Renderer } from './core.js';
import { WarStakes } from '../../world/warStakes.js';

function _stakes(ctx, x, y, s, fresh, seed) {
    const n = 5;
    for (let i = 0; i < n; i++) {
        const a = ((seed * 7 + i * 13) % 11) / 11;
        const ox = (i - (n - 1) / 2) * s * 0.36 + (a - 0.5) * s * 0.12;
        const oy = ((i % 2) ? s * 0.18 : 0) + (a - 0.5) * s * 0.08;
        const lean = (a - 0.5) * 0.35;
        const h = s * (0.9 + a * 0.3);
        const bx = x + ox, by = y + oy + s * 0.3;
        const tx = bx + lean * h, ty = by - h;
        ctx.strokeStyle = 'rgba(70,46,28,0.95)';
        ctx.lineWidth = Math.max(1, s * 0.07);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        // (the burden: a dark shape near the top while the line is fresh; bones, then nothing, as it rots)
        if (fresh > 0.05) {
            ctx.fillStyle = fresh > 0.5 ? 'rgba(92,24,22,0.95)' : 'rgba(120,104,84,0.9)';
            ctx.beginPath();
            ctx.ellipse(tx - lean * h * 0.18, ty + h * 0.2, s * 0.09 * (0.6 + fresh * 0.5), s * 0.2 * (0.6 + fresh * 0.4), lean, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // (crows over a fresh line)
    if (fresh > 0.4) {
        ctx.strokeStyle = 'rgba(20,20,24,0.85)';
        ctx.lineWidth = Math.max(1, s * 0.05);
        for (let i = 0; i < 2; i++) {
            const cx = x + (i ? s * 0.4 : -s * 0.3), cy = y - s * (1.25 + i * 0.15);
            ctx.beginPath(); ctx.moveTo(cx - s * 0.12, cy); ctx.lineTo(cx, cy + s * 0.05); ctx.lineTo(cx + s * 0.12, cy); ctx.stroke();
        }
    }
}

function _column(ctx, x, y, s) {
    // (drawn larger than a stake grove, outlined: grey figures vanish on grass and forest otherwise)
    s *= 1.7;
    ctx.fillStyle = 'rgba(196,190,178,0.98)';
    ctx.strokeStyle = 'rgba(30,28,26,0.95)';
    ctx.lineWidth = Math.max(1, s * 0.035);
    for (let i = 0; i < 4; i++) {
        const px = x + (i - 1.5) * s * 0.3, py = y + (i % 2) * s * 0.06;
        ctx.beginPath(); ctx.arc(px, py - s * 0.32, s * 0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillRect(px - s * 0.06, py - s * 0.24, s * 0.12, s * 0.3);
        ctx.strokeRect(px - s * 0.06, py - s * 0.24, s * 0.12, s * 0.3);
        // (a dark band across the eyes)
        ctx.fillStyle = 'rgba(70,20,18,0.95)';
        ctx.fillRect(px - s * 0.08, py - s * 0.35, s * 0.16, s * 0.04);
        ctx.fillStyle = 'rgba(196,190,178,0.98)';
        // (each with a hand on the shoulder of the man ahead)
        if (i > 0) { ctx.beginPath(); ctx.moveTo(px - s * 0.05, py - s * 0.18); ctx.lineTo(px - s * 0.25, py - s * 0.2); ctx.stroke(); }
    }
}

Object.assign(Renderer.prototype, {
    renderWarStakes(ctx) {
        const world = this.world;
        if (!world || !world.prisonerFates) return;
        const stakes = WarStakes.stakes(world);
        const cols = WarStakes.columns(world);
        if (!stakes.length && !cols.length) return;
        const z = this.camera.zoom;
        const size = this.hexSize * z;
        const W = this.canvas.width, H = this.canvas.height;
        const day = world.day || 0;
        const ss = Math.max(4, size * 0.32);
        const onScreen = (q, r) => {
            const tile = world.getTile(q, r);
            if (!tile || !tile.visible) return null;
            const pos = this.getHexPixelPos(q, r);
            const p = this.camera.worldToScreen(pos.x, pos.y);
            return p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60 ? null : p;
        };
        ctx.save();
        for (const st of stakes) {
            const fresh = WarStakes.fresh(st, day);
            const tiles = Array.isArray(st.tiles) && st.tiles.length ? st.tiles : [{ q: st.q, r: st.r }];
            let first = null;
            ctx.globalAlpha = 0.55 + fresh * 0.45;
            for (let i = 0; i < tiles.length; i++) {
                const p = onScreen(tiles[i].q, tiles[i].r);
                if (!p) continue;
                // (the label on a hex of open road: a town's own name would crowd it out)
                const t = world.getTile(tiles[i].q, tiles[i].r);
                if (!first || (first.town && !(t && t.settlement))) first = { x: p.x, y: p.y, town: !!(t && t.settlement) };
                _stakes(ctx, p.x, p.y, ss, fresh, (st.id || 1) + i);
            }
            ctx.globalAlpha = 1;
            if (first && z > 0.5) {
                // (short: a long label beside a town is crowded out by the town's name)
                const label = st.byPlayer ? `${st.men} on stakes` : `Stakes of ${st.by || 'a realm'}`;
                this.addLabel(label, first.x, first.y + (first.town ? size * 0.5 + 34 : size * 0.5), 3, {
                    font: `600 ${Math.max(8, 10 * z)}px 'Inter', sans-serif`,
                    fillStyle: fresh > 0 ? '#e08a7a' : '#b8aa98',
                    shadowColor: 'rgba(0,0,0,0.75)', textAlign: 'center', textBaseline: 'top',
                });
            }
        }
        for (const c of cols) {
            const p = onScreen(c.q, c.r);
            if (!p) continue;
            _column(ctx, p.x, p.y + size * 0.1, ss);
            if (z > 0.5) {
                // (set out from a town: below its name, not on it)
                const ct = world.getTile(c.q, c.r);
                this.addLabel(`${c.men} blinded men`, p.x, p.y + (ct && ct.settlement ? size * 0.5 + 34 : size * 0.5), 3, {
                    font: `600 ${Math.max(8, 10 * z)}px 'Inter', sans-serif`,
                    fillStyle: '#cfc8bc', shadowColor: 'rgba(0,0,0,0.75)', textAlign: 'center', textBaseline: 'top',
                });
            }
        }
        ctx.restore();
    },
});
