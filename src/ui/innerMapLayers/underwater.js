// InnerMapRenderer — the view from under the water (mixed in via Object.assign).
//
// While the player is diving (ui/innerMapDiving.js, InnerMap._underwater):
//
//   • _renderUnderwaterFloor (over the ground, under every sprite): the water
//     cells sunk in a blue-green murk, light rippling across the bottom in
//     moving bands, and the finds lying there (Diving.bedFor: shells, weed,
//     shellfish, wood, junk; treasure glinting, a chest).
//   • _renderUnderwaterVeil (over the sprites): everything not under the water
//     — the land, the shallows, the folk on the shore — dimmed to a dark blur,
//     with shafts of light slanting down and motes drifting.
//
// Only cells on screen; nothing is drawn on the surface.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapDiving } from '../innerMapDiving.js';

function _now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/** A find on the bottom, drawn in the cell at (x, y), size ds. */
function _drawFind(ctx, f, x, y, ds, now) {
    const cx = x + ds / 2, cy = y + ds / 2;
    const j = (((f.q * 7919) ^ (f.r * 104729)) >>> 0) % 13 / 13; // a cell's own turn
    const s = ds * 0.32;
    ctx.save();
    // A soft shadow on the sand
    ctx.fillStyle = 'rgba(0, 20, 25, 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.45, s * 0.9, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    switch (f.look) {
    case 'shell': {
        ctx.translate(cx, cy);
        ctx.rotate(j * 2 - 1);
        ctx.fillStyle = '#efd9c0';
        ctx.beginPath();
        ctx.moveTo(0, s * 0.5);
        ctx.arc(0, s * 0.5, s * 0.8, -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b8957a';
        ctx.lineWidth = Math.max(1, ds / 48);
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(0, s * 0.5);
            ctx.lineTo(Math.sin(i * 0.3) * s * 0.75, s * 0.5 - Math.cos(i * 0.3) * s * 0.75);
            ctx.stroke();
        }
        break;
    }
    case 'weed': {
        ctx.strokeStyle = f.item === 'leeches' ? '#3b2a20' : '#3f8f4a';
        ctx.lineWidth = Math.max(1.5, ds / 18);
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            const bx = cx + (i - 1) * s * 0.45;
            ctx.beginPath();
            ctx.moveTo(bx, cy + s * 0.5);
            for (let k = 1; k <= 4; k++) ctx.lineTo(bx + Math.sin(now * 1.5 + k + i + j * 6) * s * 0.2, cy + s * 0.5 - k * s * 0.32);
            ctx.stroke();
        }
        break;
    }
    case 'mussel': {
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = f.item === 'oysters' ? '#9c968a' : '#2b3550';
            ctx.beginPath();
            ctx.ellipse(cx + (i - 1) * s * 0.5, cy + (i % 2) * s * 0.2, s * 0.35, s * 0.2, j + i * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        break;
    }
    case 'crab': {
        const red = f.item === 'lobster' ? '#b0302a' : f.item === 'crayfish' ? '#8a4a2a' : '#c2562e';
        const wig = Math.sin(now * 3 + j * 6) * s * 0.06;
        ctx.strokeStyle = red;
        ctx.lineWidth = Math.max(1, ds / 36);
        for (const side of [-1, 1]) {
            for (let k = 0; k < 3; k++) {
                ctx.beginPath();
                ctx.moveTo(cx + side * s * 0.3, cy + (k - 1) * s * 0.18);
                ctx.lineTo(cx + side * s * 0.7, cy + (k - 1) * s * 0.3 + wig);
                ctx.stroke();
            }
        }
        ctx.fillStyle = red;
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.45, s * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(cx + side * s * 0.55, cy - s * 0.45 + wig, s * 0.16, 0, Math.PI * 2);
            ctx.fill();
        }
        break;
    }
    case 'sponge': {
        ctx.fillStyle = '#d9b44a';
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.55, s * 0.42, j, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(110, 80, 20, 0.6)';
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(cx + Math.cos(i * 1.7 + j) * s * 0.25, cy + Math.sin(i * 1.7 + j) * s * 0.2, s * 0.07, 0, Math.PI * 2);
            ctx.fill();
        }
        break;
    }
    case 'lump': {
        ctx.fillStyle = '#8a6a4a';
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.6, s * 0.38, j, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    case 'wood': {
        ctx.translate(cx, cy);
        ctx.rotate(j * 2 - 1);
        ctx.fillStyle = '#5a4128';
        ctx.fillRect(-s * 0.9, -s * 0.16, s * 1.8, s * 0.32);
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(-s * 0.9, -s * 0.16, s * 1.8, s * 0.1);
        break;
    }
    case 'chest': {
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(cx - s * 0.7, cy - s * 0.35, s * 1.4, s * 0.8);
        ctx.fillStyle = '#7a5226';
        ctx.fillRect(cx - s * 0.7, cy - s * 0.5, s * 1.4, s * 0.3);
        ctx.fillStyle = '#d4a030';
        ctx.fillRect(cx - s * 0.7, cy - s * 0.22, s * 1.4, s * 0.08);
        ctx.fillRect(cx - s * 0.1, cy - s * 0.25, s * 0.2, s * 0.25);
        break;
    }
    case 'treasure': {
        ctx.fillStyle = '#e8c860';
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff6c8';
        ctx.beginPath();
        ctx.arc(cx - s * 0.1, cy - s * 0.1, s * 0.1, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    default: {
        // Junk: a dark, worn shape (a boot, a coil of rope, an old tool)
        ctx.fillStyle = '#4a4540';
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * 0.5, s * 0.3, j, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6a625a';
        ctx.fillRect(cx - s * 0.1, cy - s * 0.45, s * 0.22, s * 0.45);
    }
    }
    ctx.restore();
    // Treasure glints: a star that swells and fades
    if (f.rare) {
        const tw = (Math.sin(now * 3 + j * 9) + 1) / 2;
        const r = ds * (0.12 + tw * 0.16);
        const gx = cx + s * 0.35, gy = cy - s * 0.35;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 245, 200, ${0.35 + tw * 0.6})`;
        ctx.lineWidth = Math.max(1, ds / 30);
        ctx.beginPath();
        ctx.moveTo(gx - r, gy); ctx.lineTo(gx + r, gy);
        ctx.moveTo(gx, gy - r); ctx.lineTo(gx, gy + r);
        ctx.stroke();
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        g.addColorStop(0, `rgba(255, 240, 170, ${0.5 * tw + 0.2})`);
        g.addColorStop(1, 'rgba(255, 240, 170, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

Object.assign(InnerMapRenderer, {
    /** The bottom: the murk, the rippling light and the finds (under the sprites). */
    _renderUnderwaterFloor(ctx, camera) {
        if (!InnerMap._underwater || !InnerMap.tiles || InnerMap._insideBuilding) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const range = this._frameRange || this._getVisibleTileRange(camera);
        const now = _now();
        const r0 = Math.max(0, range.rMin), r1 = Math.min(InnerMap.height - 1, range.rMax);
        const q0 = Math.max(0, range.qMin), q1 = Math.min(InnerMap.width - 1, range.qMax);
        const sz = Math.ceil(ds) + 1;
        ctx.save();
        for (let r = r0; r <= r1; r++) {
            for (let q = q0; q <= q1; q++) {
                if (!InnerMap.isDivable(q, r)) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                ctx.fillStyle = 'rgba(8, 62, 70, 0.55)';
                ctx.fillRect(s.x, s.y, sz, sz);
                // Light rippling over the bottom: bands that drift and swell
                const wx = q * 0.9, wy = r * 0.7;
                const a = (Math.sin(wx + now * 1.3) + Math.sin(wy * 1.3 - now * 1.1) + Math.sin((wx + wy) * 0.6 + now * 0.7)) / 3;
                if (a > 0.15) {
                    ctx.fillStyle = `rgba(150, 230, 220, ${(a - 0.15) * 0.22})`;
                    ctx.fillRect(s.x, s.y, sz, sz);
                }
            }
        }
        ctx.restore();
        const bed = InnerMapDiving.bed();
        if (!bed) return;
        for (const f of bed.finds) {
            if (f.q < q0 || f.q > q1 || f.r < r0 || f.r > r1) continue;
            const s = camera.worldToScreenFast(f.q * T, f.r * T);
            _drawFind(ctx, f, s.x, s.y, ds, now);
        }
    },

    /** Above the water, dimmed; shafts of light and drifting motes (over the sprites). */
    _renderUnderwaterVeil(ctx, camera) {
        if (!InnerMap._underwater || !InnerMap.tiles || InnerMap._insideBuilding) return;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const range = this._frameRange || this._getVisibleTileRange(camera);
        const now = _now();
        const sz = Math.ceil(ds) + 1;
        ctx.save();
        ctx.fillStyle = 'rgba(3, 20, 28, 0.62)';
        for (let r = Math.max(0, range.rMin); r <= Math.min(InnerMap.height - 1, range.rMax); r++) {
            for (let q = Math.max(0, range.qMin); q <= Math.min(InnerMap.width - 1, range.qMax); q++) {
                if (InnerMap.isDivable(q, r)) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                ctx.fillRect(s.x, s.y, sz, sz);
            }
        }
        // Over all: a faint green-blue cast, shafts of light from above, motes
        const W = ctx.canvas.width, H = ctx.canvas.height;
        ctx.fillStyle = 'rgba(10, 70, 80, 0.12)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) {
            const x = ((i * 0.29 + 0.1) * W + Math.sin(now * 0.25 + i * 2) * W * 0.06);
            const w = W * (0.05 + (i % 2) * 0.04);
            const g = ctx.createLinearGradient(0, 0, 0, H);
            const alpha = 0.05 + 0.03 * Math.sin(now * 0.6 + i);
            g.addColorStop(0, `rgba(170, 235, 230, ${alpha})`);
            g.addColorStop(1, 'rgba(170, 235, 230, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + w, 0);
            ctx.lineTo(x + w + H * 0.35, H);
            ctx.lineTo(x + H * 0.35, H);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 40; i++) {
            const seed = (i * 2654435761) >>> 0;
            const fx = (seed % 1000) / 1000, fy = ((seed >>> 10) % 1000) / 1000;
            const x = ((fx * W + Math.sin(now * 0.4 + i) * 20) % W + W) % W;
            const y = ((fy * H - now * (6 + (i % 5) * 3)) % H + H) % H;
            ctx.fillStyle = `rgba(210, 240, 235, ${0.15 + (i % 4) * 0.06})`;
            ctx.fillRect(x, y, Math.max(1, ds / 32), Math.max(1, ds / 32));
        }
        ctx.restore();
    },
});
