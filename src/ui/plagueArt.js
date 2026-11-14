// ============================================
// PLAGUE ART — the pestilence's marks on the street map, in pixels
// ============================================
// Small pixel-art pieces drawn by ui/innerMapPlague.js: planks nailed across a
// plague house's door (and a shop's shutters barred), a sackcloth thrown over
// a stall's wares, the open grave in the churchyard with its lime and shrouded
// dead, and the trestle barrier across a road at a shut gate. Each is drawn
// with fillRect alone on a grid of `u` screen pixels (one art pixel), so it
// stays crisp at any zoom and matches the LPC art about it. No state, no
// allocation beyond the call: the caller hands in the place and the size.

const WOOD = ['#3b2614', '#6b4524', '#8a5d33', '#a87a48'];   // outline, dark, base, light
const NAIL = '#262626';
const CLOTH = ['#4a3b28', '#8d7650', '#a68c60', '#bea478'];
const EARTH = ['#2a1d12', '#4a3320', '#6a4a2e', '#8a6640'];
const LIME = ['#bdb8a8', '#dedad0', '#f2efe6'];
const SHROUD = ['#5d574c', '#c9c2b0', '#e4ddcb'];
const CROSS = '#a8161a';

function _px(ctx, x, y, u, c, w = 1, h = 1) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w * u), Math.ceil(h * u));
}

/** One plank, `len` art pixels long, from (x, y) stepping (dx, dy) art pixels a pixel along (two wide). */
function _plank(ctx, x, y, u, len, dx, dy) {
    for (let i = 0; i < len; i++) {
        const px = x + i * dx * u, py = y + i * dy * u;
        _px(ctx, px, py - 2 * u, u, WOOD[0], 2, 1);
        _px(ctx, px, py - u, u, WOOD[3], 2, 1);
        _px(ctx, px, py, u, i % 5 === 2 ? WOOD[1] : WOOD[2], 2, 1);
        _px(ctx, px, py + u, u, WOOD[1], 2, 1);
        _px(ctx, px, py + 2 * u, u, WOOD[0], 2, 1);
    }
}

export const PlagueArt = {
    /**
     * Planks across a door centred at (cx, cy), `u` screen px a pixel.
     * kind 'x' — two crossed planks (a plague house shut up); 'bar' — two
     * level boards (a shop's shutters barred).
     */
    boards(ctx, cx, cy, u, kind = 'x') {
        const half = 6;
        if (kind === 'bar') {
            for (const oy of [-3, 2]) {
                const y = cy + oy * u;
                for (let i = -half; i <= half; i++) {
                    _px(ctx, cx + i * u, y - u, u, WOOD[0]);
                    _px(ctx, cx + i * u, y, u, (i + 9) % 4 === 0 ? WOOD[1] : WOOD[2]);
                    _px(ctx, cx + i * u, y + u, u, WOOD[3]);
                    _px(ctx, cx + i * u, y + 2 * u, u, WOOD[0]);
                }
                _px(ctx, cx - (half - 1) * u, y, u, NAIL);
                _px(ctx, cx + (half - 1) * u, y, u, NAIL);
            }
            return;
        }
        _plank(ctx, cx - half * u, cy - half * u, u, half * 2 + 1, 1, 1);
        _plank(ctx, cx - half * u, cy + half * u, u, half * 2 + 1, 1, -1);
        _px(ctx, cx - (half - 1) * u, cy - (half - 1) * u, u, NAIL);
        _px(ctx, cx + (half - 1) * u, cy + (half - 1) * u, u, NAIL);
        _px(ctx, cx - (half - 1) * u, cy + (half - 1) * u, u, NAIL);
        _px(ctx, cx + (half - 1) * u, cy - (half - 1) * u, u, NAIL);
    },

    /** A red cross daubed over the planks (in pixels, for the shut-up house). */
    cross(ctx, cx, cy, u) {
        for (let i = -5; i <= 5; i++) _px(ctx, cx - u, cy + i * u, u, CROSS, 2, 1);
        for (let i = -4; i <= 4; i++) _px(ctx, cx + i * u, cy - 2 * u, u, CROSS, 1, 2);
        // a drip or two of the paint
        _px(ctx, cx + 3 * u, cy, u, CROSS);
        _px(ctx, cx - 4 * u, cy, u, CROSS);
    },

    /** Sackcloth thrown over a stall's counter: (x, y) its top left, w × h screen px. */
    stallCloth(ctx, x, y, w, h, u) {
        const cols = Math.max(4, Math.floor(w / u)), rows = Math.max(3, Math.floor(h / u));
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const edge = j === 0 || i === 0 || i === cols - 1;
                const hem = j === rows - 1 && (i % 3 !== 1);
                if (j === rows - 1 && !hem) continue;   // a ragged hem
                const fold = (i + Math.floor(j / 2)) % 6 === 0;
                const c = edge || hem ? CLOTH[0] : fold ? CLOTH[1] : j < 2 ? CLOTH[3] : CLOTH[2];
                _px(ctx, x + i * u, y + j * u, u, c);
            }
        }
        // a stone on it against the wind
        _px(ctx, x + Math.floor(cols / 2) * u, y + u, u, '#5d5d5d', 2, 1);
    },

    /**
     * The open grave in the churchyard: a trench `len` tiles long from (x, y)
     * (its top left, screen px; `t` px a tile), lime over it, the shrouded dead
     * laid side by side (`dead`, at most what fits), a heap of earth at one end.
     */
    trench(ctx, x, y, t, len, dead, u) {
        const W = Math.floor((len * t) / u), H = Math.max(9, Math.floor((t * 0.8) / u));
        // the heap of earth thrown up behind, rounded
        for (let i = 0; i < W; i++) {
            const k = i / Math.max(1, W - 1);
            const hh = Math.round(2 + 4 * Math.sin(Math.PI * k)) + ((i * 7) % 5 === 0 ? 1 : 0);
            for (let j = 0; j < hh; j++) _px(ctx, x + i * u, y - j * u, u, j === hh - 1 ? EARTH[0] : j === hh - 2 ? EARTH[3] : EARTH[2]);
        }
        // the pit
        const top = y + u;
        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {
                const rim = j === 0 || i === 0 || i === W - 1 || j === H - 1;
                _px(ctx, x + i * u, top + j * u, u, rim ? EARTH[0] : j < 3 ? EARTH[0] : j < 5 ? EARTH[1] : EARTH[2]);
            }
        }
        // the dead in their shrouds, laid side by side across it
        const per = 6;
        const fit = Math.max(0, Math.floor((W - 2) / per));
        const n = Math.min(fit, Math.max(0, dead));
        const bh = H - 3;
        const body = new Set();
        for (let k = 0; k < n; k++) {
            const i0 = 1 + k * per + 1, bx = x + i0 * u, by = top + 2 * u;
            for (let j = 0; j < bh; j++) {
                const w = j < 3 ? 3 : 4;          // the head narrower
                const off = j < 3 ? 0.5 : 0;
                for (let i = 0; i < w; i++) {
                    const edge = i === 0 || i === w - 1 || j === 0 || j === bh - 1;
                    _px(ctx, bx + (i + off) * u, by + j * u, u, edge ? SHROUD[0] : (i === 1 ? SHROUD[2] : SHROUD[1]));
                    body.add(`${i0 + i},${j + 2}`);
                }
            }
            _px(ctx, bx + u, by + 3 * u, u, SHROUD[0], 2, 1);
            _px(ctx, bx + u, by + (bh - 3) * u, u, SHROUD[0], 2, 1);
        }
        // lime thrown over the bottom between them
        for (let i = 1; i < W - 1; i++) {
            for (let j = 4; j < H - 1; j++) {
                if (body.has(`${i},${j}`)) continue;
                const h = (i * i * 13 + j * 29 + i * j * 7) % 9;
                if (h === 0) _px(ctx, x + i * u, top + j * u, u, LIME[1]);
                else if (h === 3) _px(ctx, x + i * u, top + j * u, u, LIME[0]);
            }
        }
        // a spade stood in the heap
        const sx = x + (W - 4) * u, sy = y - 12 * u;
        for (let j = 0; j < 8; j++) _px(ctx, sx, sy + j * u, u, WOOD[1]);
        _px(ctx, sx - u, sy - u, u, WOOD[0], 3, 1);
        _px(ctx, sx - u, sy + 8 * u, u, '#8d8d8d', 3, 3);
        _px(ctx, sx - u, sy + 11 * u, u, '#4d4d4d', 3, 1);
    },

    /** A trestle barrier across a road at a shut gate, centred at (cx, cy), `t` px a tile. */
    barrier(ctx, cx, cy, t, u) {
        const W = Math.floor((t * 1.6) / u);
        const x0 = cx - Math.floor(W / 2) * u;
        // the legs, crossed at each end
        for (const lx of [x0 + 2 * u, x0 + (W - 5) * u]) {
            for (let j = 0; j < 11; j++) {
                _px(ctx, lx + Math.round(j * 0.3) * u, cy - 6 * u + j * u, u, WOOD[0]);
                _px(ctx, lx + Math.round(3 - j * 0.3) * u, cy - 6 * u + j * u, u, WOOD[1]);
            }
        }
        // the rails, banded red and pale
        for (const ry of [cy - 4 * u, cy]) {
            for (let i = 0; i < W; i++) {
                const band = Math.floor(i / 3) % 2 === 0;
                _px(ctx, x0 + i * u, ry - u, u, WOOD[0]);
                _px(ctx, x0 + i * u, ry, u, band ? '#9b2a22' : '#d9cfb6');
                _px(ctx, x0 + i * u, ry + u, u, band ? '#6e1d17' : '#a99f86');
                _px(ctx, x0 + i * u, ry + 2 * u, u, WOOD[0]);
            }
        }
    },
};
