// InnerMapRenderer — the player's fish traps in the edge water (mixed in via
// Object.assign; the state is systems/fishTraps.js, the map side
// ui/innerMapFishTraps.js).
//
// Drawn over the living water and under the sprites (innerMapRenderer.js,
// after the river's drift): each trap a long wicker basket lying half under
// the water, its funnelled mouth dark, rings spreading off it, a marker stake
// pushed in beside it with a rag tied on (a pale one when baited); a full one
// stirs with the fish in it; one fallen apart sags open. A poacher at a trap
// in the night is a dark crouched figure on the bank beside it.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapFishTraps } from '../innerMapFishTraps.js';
import { FishTraps } from '../../systems/fishTraps.js';
import { InnerMapTorchlight } from '../innerMapTorchlight.js';

const WICKER = { body: '#8a6a3a', hi: '#b8925a', lo: '#4e3a1e', mouth: '#1d150c', stake: '#4a3420' };

const _h = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
};

Object.assign(InnerMapRenderer, {
    _renderFishTraps(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater) return;
        const world = InnerMapFishTraps._world;
        if (!world) return;
        const traps = InnerMapFishTraps.here(world);
        if (!traps.length) return;
        const T = this.TILE_SIZE;
        const cs = T * camera.zoom;
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        const hour = Number.isFinite(InnerMapFishTraps._nowH) ? InnerMapFishTraps._nowH : 0;
        ctx.save();
        for (const trap of traps) this._drawFishTrap(ctx, camera, trap, T, cs, now, hour);
        const P = InnerMapFishTraps.poacher;
        if (P) this._drawTrapPoacher(ctx, camera, P, T, cs, now);
        ctx.restore();
    },

    _drawFishTrap(ctx, camera, trap, T, cs, now, hour) {
        const tile = InnerMap.getTile(trap.x, trap.y);
        if (!tile || !tile.explored) return;
        const p = camera.worldToScreenFast((trap.x + 0.5) * T, (trap.y + 0.55) * T);
        const art = Math.max(1, cs / 32);
        const seed = _h(trap.id);
        const ang = (seed - 0.5) * 1.2;
        const broken = FishTraps.isBroken(trap);
        const full = FishTraps.isFull(trap);
        const L = cs * 0.62, R = cs * 0.17;
        const bob = Math.sin(now * 1.3 + seed * 6) * art * 0.6;
        // rings spreading off it
        ctx.strokeStyle = '#dff3ff';
        ctx.lineWidth = Math.max(1, art);
        for (let i = 0; i < 2; i++) {
            const k = (now * 0.4 + seed + i * 0.5) % 1;
            ctx.globalAlpha = 0.35 * (1 - k);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + R * 0.3, L * (0.55 + k * 0.5), R * (0.9 + k * 0.8), ang, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.save();
        ctx.translate(p.x, p.y + bob);
        ctx.rotate(ang);
        // the basket: a long tapering body, half sunk
        ctx.globalAlpha = broken ? 0.55 : 0.92;
        ctx.fillStyle = WICKER.body;
        ctx.beginPath();
        ctx.moveTo(-L / 2, -R);
        ctx.quadraticCurveTo(L * 0.1, -R * 1.15, L / 2, -R * 0.35);
        ctx.lineTo(L / 2, R * 0.35);
        ctx.quadraticCurveTo(L * 0.1, R * 1.15, -L / 2, R);
        ctx.closePath();
        ctx.fill();
        // the weave: hoops across, and a light rib along the top
        ctx.strokeStyle = WICKER.lo;
        ctx.lineWidth = Math.max(1, art * 0.8);
        for (let i = 1; i < 5; i++) {
            const x = -L / 2 + (L * i) / 5;
            const hh = R * (1.05 - (i / 5) * 0.55);
            ctx.beginPath();
            ctx.moveTo(x, -hh);
            ctx.lineTo(x + (broken && i === 3 ? art * 3 : 0), hh);
            ctx.stroke();
        }
        ctx.strokeStyle = WICKER.hi;
        ctx.beginPath();
        ctx.moveTo(-L / 2 + art, -R * 0.55);
        ctx.quadraticCurveTo(L * 0.1, -R * 0.8, L / 2 - art, -R * 0.2);
        ctx.stroke();
        // the funnelled mouth, dark
        ctx.fillStyle = WICKER.mouth;
        ctx.beginPath();
        ctx.ellipse(-L / 2, 0, R * 0.35, R * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        // the lower half under the water
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#123247';
        ctx.fillRect(-L / 2 - R * 0.4, R * 0.1, L + R * 0.8, R * 1.2);
        ctx.restore();
        // a full trap stirs: a flick of silver at its side now and then
        if (full && ((now * 0.7 + seed) % 1) < 0.18) {
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = '#e8f2f4';
            ctx.beginPath();
            ctx.ellipse(p.x + Math.cos(ang) * L * 0.15, p.y - R * 0.2, art * 2.5, art, ang, 0, Math.PI * 2);
            ctx.fill();
        }
        // the marker stake, a rag tied on (pale when baited)
        const sx = p.x + Math.cos(ang) * (L / 2 + art * 2), sy = p.y + Math.sin(ang) * (L / 2 + art * 2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = WICKER.stake;
        ctx.lineWidth = Math.max(1.5, art * 1.6);
        ctx.beginPath();
        ctx.moveTo(sx, sy + R * 0.5);
        ctx.lineTo(sx, sy - cs * 0.42);
        ctx.stroke();
        const wave = Math.sin(now * 3 + seed * 9) * art * 1.5;
        ctx.fillStyle = FishTraps.baited(trap, hour) ? '#e9dfc4' : '#a33b2c';
        ctx.beginPath();
        ctx.moveTo(sx, sy - cs * 0.42);
        ctx.lineTo(sx + art * 6 + wave, sy - cs * 0.38);
        ctx.lineTo(sx, sy - cs * 0.32);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        // A lantern hung on the stake to keep poachers off (ui/innerMapTorchlight.js)
        if (trap.lantern) InnerMapTorchlight.drawTrapLantern(ctx, trap, sx, sy - cs * 0.42, cs, now, hour);
    },

    /** A dark crouched figure on the bank by the trap, an arm reaching to the water */
    _drawTrapPoacher(ctx, camera, P, T, cs, now) {
        const tile = InnerMap.getTile(P.x, P.y);
        if (!tile || !tile.explored) return;
        const p = camera.worldToScreenFast((P.x + 0.5) * T, (P.y + 0.6) * T);
        const s = cs / 32;
        const sway = Math.sin(now * 2.2) * s;
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 5 * s, 10 * s, 3.5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = '#1b1a22';
        // the hunched back and the hood
        ctx.beginPath();
        ctx.ellipse(p.x + sway * 0.3, p.y - 4 * s, 8 * s, 9 * s, -0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x + 5 * s + sway * 0.5, p.y - 13 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        // the arm, down into the water
        ctx.strokeStyle = '#1b1a22';
        ctx.lineWidth = Math.max(2, 3 * s);
        ctx.beginPath();
        ctx.moveTo(p.x + 4 * s, p.y - 6 * s);
        ctx.lineTo(p.x + 12 * s + sway, p.y + 4 * s);
        ctx.stroke();
        ctx.globalAlpha = 1;
    },
});
