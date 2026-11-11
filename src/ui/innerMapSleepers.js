// ============================================
// INNER MAP — folk asleep in their beds
// ============================================
// Someone abed (world/innerMap/floors.js lays them in a bed of the floor
// they sleep on: npc._asleep) is drawn lying in it: their head on the
// pillow, the blanket drawn up over them, rising and falling with their
// breath, and a z or two drifting up. More sleepers than beds: the rest
// lie on bedrolls on the floor.

import { InnerMapCharacters } from './innerMapCharacters.js';

export const InnerMapSleepers = {
    /**
     * Draw a sleeper on their bed tile, centred at (sx, sy), a tile ds px across. `art`: the
     * piece they lie on (data interiorArt.furniture) — its own blanket colour (a straw pallet's
     * rough wool), never a bed's red covers; a piece with blanket 'none' leaves them uncovered.
     * opts.still: someone laid there senseless (no z's).
     */
    draw(ctx, npc, sx, sy, ds, now = performance.now() / 1000, art = null, opts = {}) {
        const top = sy - ds / 2, left = sx - ds / 2;
        const breath = Math.sin(now * 1.6 + (npc.id || 0)) * ds * 0.012;
        const roll = !!(npc._asleep && npc._asleep.bedroll);
        ctx.save();
        // On a bedroll (no bed for them): a straw mat on the boards
        if (roll) {
            ctx.fillStyle = '#b89a62';
            ctx.fillRect(left + ds * 0.1, top + ds * 0.08, ds * 0.8, ds * 0.86);
            ctx.strokeStyle = 'rgba(80,60,30,0.45)';
            ctx.lineWidth = Math.max(1, ds * 0.02);
            ctx.strokeRect(left + ds * 0.1, top + ds * 0.08, ds * 0.8, ds * 0.86);
        }
        ctx.beginPath();
        ctx.rect(left, top, ds, ds);
        ctx.clip();
        // The head on the pillow (only head and shoulders show above the blanket)
        const useSprite = npc.preset && InnerMapCharacters.isReady() && InnerMapCharacters.getComposited(npc.preset);
        const scale = npc.type === 'child' ? 0.6 : 0.78;
        const cw = ds * 1.2 * scale, ch = ds * 1.8 * scale;
        const headY = top + ds * 0.31;
        if (useSprite) {
            InnerMapCharacters.drawCharacter(ctx, npc.preset, 'idle', InnerMapCharacters.DIR_DOWN, 0, sx - cw / 2, headY - ch * 0.36, cw, ch);
        } else {
            ctx.fillStyle = '#e0b48a';
            ctx.beginPath();
            ctx.arc(sx, headY, ds * 0.13, 0, Math.PI * 2);
            ctx.fill();
        }
        // The blanket: the piece's own (a pallet's rough wool, no sheet), a bed's red with its sheet
        // turned down at the top, a bedroll's brown
        const bx = left + ds * 0.13, bw = ds * 0.74;
        const by = top + ds * 0.47 - breath, bh = ds * 0.53 + breath;
        const own = art && art.blanket;
        if (own) {
            if (own !== 'none') this.drawWool(ctx, left + ds * 0.17, by, ds * 0.66, bh - ds * 0.03, own, ds, npc.id || 0);
        } else {
            ctx.fillStyle = roll ? '#6f5a44' : '#9c3a33';
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(bx, by + bh * 0.45, bw, bh * 0.08);
            ctx.fillStyle = '#efe6d2';
            ctx.fillRect(bx, by, bw, ds * 0.07);
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(bx, by + ds * 0.07, bw, ds * 0.02);
        }
        ctx.restore();
        // (out cold, not asleep: no z's)
        if (!opts.still) this.drawZs(ctx, npc, sx, headY, ds, now);
    },

    /**
     * A plain blanket of coarse wool (a poor home's, over someone on straw): flat and unbleached,
     * a darker weave across it, a ragged hem, its top edge folded once — no linen sheet.
     */
    drawWool(ctx, x, y, w, h, colour, ds, seed = 0, flat = false) {
        ctx.save();
        const px = Math.max(1, Math.round(ds / 32));
        // a soft, lumpy shape over the body (rounded, a little narrower at the feet), not a box
        const r = Math.min(w, h) * 0.22;
        const foot = w * 0.08;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w - foot, y + h - r);
        ctx.quadraticCurveTo(x + w - foot, y + h, x + w - foot - r, y + h);
        ctx.lineTo(x + foot + r, y + h);
        ctx.quadraticCurveTo(x + foot, y + h, x + foot, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.save();
        ctx.clip();
        // the body under it: lit down the middle, falling away to the sides
        // (flat: lying low over them, only its edges falling away)
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0, flat ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.28)');
        g.addColorStop(flat ? 0.15 : 0.45, flat ? 'rgba(255,235,205,0.05)' : 'rgba(255,235,205,0.10)');
        if (flat) g.addColorStop(0.85, 'rgba(255,235,205,0.03)');
        g.addColorStop(1, flat ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.32)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        // creases where it rucks over knees and hips (a hash of who: no two alike)
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = px;
        for (let i = 0; i < 3; i++) {
            const t = 0.3 + 0.22 * i + (((seed * 13 + i * 7) % 5) - 2) * 0.02;
            ctx.beginPath();
            ctx.moveTo(x + w * 0.18, y + h * t);
            ctx.quadraticCurveTo(x + w * 0.5, y + h * (t + 0.07), x + w * 0.8, y + h * (t - 0.02));
            ctx.stroke();
        }
        // flecks of the coarse weave
        ctx.fillStyle = 'rgba(255,240,215,0.10)';
        for (let i = 0; i < 7; i++) {
            const a = ((seed * 37 + i * 61) % 97) / 97, b = ((seed * 17 + i * 43) % 89) / 89;
            ctx.fillRect(x + w * (0.1 + 0.8 * a), y + h * (0.15 + 0.75 * b), px, px);
        }
        ctx.restore();
        // the top edge turned back once under the chin, and the outline
        ctx.fillStyle = 'rgba(255,240,215,0.16)';
        ctx.fillRect(x + r * 0.6, y + px, w - r * 1.2, Math.max(px, ds * 0.035));
        ctx.strokeStyle = 'rgba(30,20,12,0.55)';
        ctx.lineWidth = px;
        ctx.stroke();
        ctx.restore();
    },

    /** Z… z… drifting up from the pillow at (sx, headY). */
    drawZs(ctx, npc, sx, headY, ds, now = performance.now() / 1000) {
        ctx.save();
        ctx.fillStyle = '#cfe3ff';
        ctx.textAlign = 'center';
        for (let i = 0; i < 2; i++) {
            const t = ((now * 0.45 + i * 0.5 + (npc.id || 0) * 0.13) % 1);
            ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
            ctx.font = `bold ${Math.max(8, Math.round(ds * (0.16 + t * 0.12)))}px sans-serif`;
            ctx.fillText('z', sx + ds * (0.2 + t * 0.25), headY - ds * (0.15 + t * 0.55));
        }
        ctx.restore();
    },
};
