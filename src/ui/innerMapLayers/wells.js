// InnerMapRenderer — a foul well marked on the street map (mixed in via
// Object.assign; which wells are foul: ui/innerMapWater.js fouledHere over
// systems/water.js). Drawn over the sprites: a dark green-brown scum in the
// well's mouth, flies circling over it, and planks laid across with a rag tied
// on — the town's own sign that it is not to be drunk from.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapWater } from '../innerMapWater.js';

let _game = null;

/** The game the layer reads its world from (set by the inner map's update). */
export function setWellsGame(game) {
    _game = game;
    InnerMapWater.update(game);
}

Object.assign(InnerMapRenderer, {
    _renderFouledWells(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater || !_game) return;
        const WS = InnerMap._wellState;
        const foul = WS && WS.foul;
        if (!foul || !foul.size) return;
        const T = this.TILE_SIZE;
        const cs = T * camera.zoom;
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        ctx.save();
        for (const key of foul) {
            const [q, r] = key.split(',').map(Number);
            const tile = InnerMap.getTile(q, r);
            if (!tile || !tile.explored) continue;
            // The well's mouth sits at the middle of its 2×2 footprint (a fountain's 3×3)
            const big = tile.customObject && tile.customObject.defId === 'tp_fountain';
            const cx = (q + (big ? 1.5 : 1)) * T;
            const cy = (r + (big ? 1.4 : 0.9)) * T;
            const p = camera.worldToScreenFast(cx, cy);
            const art = Math.max(1, cs / 32);
            // scum in the mouth
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = '#3d4a1f';
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, cs * 0.28, cs * 0.14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#5c6b2a';
            ctx.beginPath();
            ctx.ellipse(p.x - cs * 0.08, p.y - cs * 0.02, cs * 0.09, cs * 0.04, 0, 0, Math.PI * 2);
            ctx.fill();
            // planks across it, a rag tied on
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#6b4a26';
            ctx.lineWidth = Math.max(2, art * 3);
            ctx.beginPath();
            ctx.moveTo(p.x - cs * 0.34, p.y - cs * 0.1);
            ctx.lineTo(p.x + cs * 0.34, p.y + cs * 0.06);
            ctx.moveTo(p.x - cs * 0.3, p.y + cs * 0.08);
            ctx.lineTo(p.x + cs * 0.32, p.y - cs * 0.12);
            ctx.stroke();
            ctx.fillStyle = '#b8372b';
            ctx.fillRect(p.x - art * 2, p.y - cs * 0.05, art * 4, art * 7);
            // flies
            ctx.fillStyle = '#111';
            for (let i = 0; i < 5; i++) {
                const a = now * (2.2 + i * 0.4) + i * 1.7;
                const fx = p.x + Math.cos(a) * cs * (0.16 + 0.05 * i % 0.2);
                const fy = p.y - cs * 0.3 + Math.sin(a * 1.3) * cs * 0.1;
                ctx.fillRect(fx, fy, Math.max(1, art), Math.max(1, art));
            }
        }
        ctx.restore();
    },
});
