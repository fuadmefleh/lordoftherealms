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
    /** Draw a sleeper on their bed tile, centred at (sx, sy), a tile ds px across. */
    draw(ctx, npc, sx, sy, ds, now = performance.now() / 1000) {
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
        // The blanket, its sheet turned down at the top
        const bx = left + ds * 0.13, bw = ds * 0.74;
        const by = top + ds * 0.47 - breath, bh = ds * 0.53 + breath;
        ctx.fillStyle = roll ? '#6f5a44' : '#9c3a33';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by + bh * 0.45, bw, bh * 0.08);
        ctx.fillStyle = '#efe6d2';
        ctx.fillRect(bx, by, bw, ds * 0.07);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(bx, by + ds * 0.07, bw, ds * 0.02);
        ctx.restore();
        this.drawZs(ctx, npc, sx, headY, ds, now);
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
