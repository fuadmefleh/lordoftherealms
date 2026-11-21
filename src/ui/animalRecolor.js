// ============================================
// ANIMAL RECOLOUR — one sheet worn as another beast (drawing only)
// ============================================
// A species may borrow another's sheet and wear its own colours over it
// (data/animals.json species.recolor). The pheasant walks on the brown hen's
// sheet: recoloured once per sheet into a cached canvas, it is a cock pheasant
// — copper body, a dark bottle-green head where the hen's comb was, the red
// face wattle kept, a white ring round the neck — and InnerMapAnimals draws its
// long barred tail beside it (species.tail, drawTail).
//
//   recolorPixels(data, w, h, fw, fh, upRow, cfg)  the pure per-pixel pass (RGBA in place)
//   sheet(img, key, sp, upRow)                      the recoloured canvas, built once per key (null in node)
//   drawTail(ctx, facing, fx, fy, k, ax, ay, tail) its tail, in sheet px about the frame's anchor

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _hex = (s, d) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s || ''));
    if (!m) return d;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const _cache = new Map();

/** Is this pixel the hen's red comb or wattle? */
const _red = (r, g, b) => r > 110 && g < r * 0.36 && b < r * 0.36;
/** Beak and legs (yellow-orange): left as they are. */
const _horn = (r, g, b) => r > 140 && g > r * 0.55 && b < g * 0.85;

export const AnimalRecolor = {
    /**
     * Recolour a sheet's RGBA pixels in place, cell by cell (fw × fh cells). Per cell the
     * hen's red finds the head: within headR of the red's middle (lower, seen from behind:
     * row upRow) it turns `head`; the red above the middle (the comb; all of it from behind)
     * turns the head colour too, the red below (the face wattle) stays; a band `ring` wide
     * just outside the head, below its middle, turns `ringColor`; the rest is the body,
     * scaled by `body` [r, g, b] with its darkest shading deepened to the pheasant's scallops.
     */
    recolorPixels(data, w, h, fw, fh, upRow, cfg = {}) {
        const head = _hex(cfg.head, [31, 74, 50]);
        const ringC = _hex(cfg.ringColor, [238, 234, 222]);
        const body = Array.isArray(cfg.body) ? cfg.body : [1.2, 0.95, 0.78];
        const R = _num(cfg.headR, 9), ring = _num(cfg.ring, 2.2), R2 = R * R, RR2 = (R + ring) * (R + ring);
        const cols = Math.floor(w / fw), rows = Math.floor(h / fh);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x0 = col * fw, y0 = row * fh;
                let sx = 0, sy = 0, n = 0;
                for (let y = 0; y < fh; y++) {
                    for (let x = 0; x < fw; x++) {
                        const i = ((y0 + y) * w + x0 + x) * 4;
                        if (data[i + 3] > 40 && _red(data[i], data[i + 1], data[i + 2])) { sx += x; sy += y; n++; }
                    }
                }
                const back = row === upRow;
                const cx = n ? sx / n : -1e9, cyRed = n ? sy / n : -1e9;
                const cy = back ? cyRed + R * 0.6 : cyRed;
                for (let y = 0; y < fh; y++) {
                    for (let x = 0; x < fw; x++) {
                        const i = ((y0 + y) * w + x0 + x) * 4;
                        if (data[i + 3] === 0) continue;
                        const r = data[i], g = data[i + 1], b = data[i + 2];
                        if (_horn(r, g, b)) continue;
                        const L = (r + g + b) / 3;
                        const shade = Math.min(1.35, L / 95);
                        if (_red(r, g, b)) {
                            if (back || y < cyRed) {
                                data[i] = head[0] * shade; data[i + 1] = head[1] * shade; data[i + 2] = head[2] * shade;
                            }
                            continue;
                        }
                        const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
                        // (the comb's reddish rim, just outside the head above its middle: the head too)
                        const rim = (back || y < cyRed - 1) && d2 < (R + 4) * (R + 4) && g < r * 0.52;
                        if (d2 < R2 || rim) {
                            // the head: bottle green, a purple sheen on its brightest feathers
                            const sheen = L > 120 ? 0.25 : 0;
                            data[i] = head[0] * shade + sheen * 60; data[i + 1] = head[1] * shade; data[i + 2] = head[2] * shade + sheen * 70;
                        } else if (d2 < RR2 && y >= cy - 1) {
                            const s = Math.min(1, 0.75 + L / 400);
                            data[i] = ringC[0] * s; data[i + 1] = ringC[1] * s; data[i + 2] = ringC[2] * s;
                        } else if (L < 42) {
                            data[i] = r * 0.6; data[i + 1] = g * 0.55; data[i + 2] = b * 0.6;
                        } else {
                            data[i] = Math.min(255, r * body[0] + 6); data[i + 1] = Math.min(255, g * body[1]); data[i + 2] = Math.min(255, b * body[2]);
                        }
                    }
                }
            }
        }
        return data;
    },

    /**
     * The recoloured sheet for `img` (a loaded image) under `key`, built once and kept;
     * null where there is no canvas (node), so the caller draws the sheet as it is.
     */
    sheet(img, key, sp, upRow) {
        if (_cache.has(key)) return _cache.get(key);
        let out = null;
        try {
            if (typeof document === 'undefined' || !img || !img.naturalWidth) return null;
            const fw = _num(sp.frameW, 112), fh = _num(sp.frameH, 112);
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const g = c.getContext('2d', { willReadFrequently: true });
            if (!g || typeof g.getImageData !== 'function') return null;
            g.drawImage(img, 0, 0);
            const id = g.getImageData(0, 0, c.width, c.height);
            if (!id || !id.data || id.data.length < c.width * c.height * 4) return null;
            AnimalRecolor.recolorPixels(id.data, c.width, c.height, fw, fh, upRow, sp.recolor || {});
            g.putImageData(id, 0, 0);

            out = c;
        } catch (e) {
            out = null;
        }
        _cache.set(key, out);
        return out;
    },

    /**
     * Its long barred tail, drawn before the body seen from the side or the front (it trails
     * behind) and after it seen from behind (it comes toward you). (fx, fy): the feet on
     * screen; k: screen px per sheet px; (ax, ay): the frame's anchor; tail: species.tail
     * { len, width, color, bar, side: [x, y] base seen facing left, front: [x, y], back: [x, y] }.
     */
    drawTail(ctx, facing, fx, fy, k, ax, ay, tail) {
        if (!tail || !ctx || typeof ctx.beginPath !== 'function') return;
        const len = _num(tail.len, 48), wid = _num(tail.width, 7);
        let bx, by, tx, ty;
        if (facing === 'left' || facing === 'right') {
            const s = Array.isArray(tail.side) ? tail.side : [104, 62];
            const m = facing === 'left' ? 1 : -1;
            bx = ax + (s[0] - ax) * m; by = s[1];
            tx = bx + m * len; ty = by + len * 0.12;
        } else if (facing === 'up') {
            const s = Array.isArray(tail.back) ? tail.back : [64, 78];
            bx = s[0]; by = s[1]; tx = bx + 2; ty = by + len * 0.55;
        } else {
            const s = Array.isArray(tail.front) ? tail.front : [68, 44];
            bx = s[0]; by = s[1]; tx = bx + 8; ty = by - len * 0.9;
        }
        const X = (x) => fx + (x - ax) * k, Y = (y) => fy + (y - ay) * k;
        const ux = tx - bx, uy = ty - by, L = Math.hypot(ux, uy) || 1;
        const nx = -uy / L, ny = ux / L;
        ctx.save();
        ctx.fillStyle = tail.color || '#9a5a2a';
        ctx.beginPath();
        ctx.moveTo(X(bx + nx * wid / 2), Y(by + ny * wid / 2));
        ctx.lineTo(X(tx), Y(ty));
        ctx.lineTo(X(bx - nx * wid / 2), Y(by - ny * wid / 2));
        ctx.closePath();
        ctx.fill();
        // dark bars across it, closer toward the tip
        ctx.strokeStyle = tail.bar || '#3b2414';
        ctx.lineWidth = Math.max(1, k * 1.2);
        for (let t = 0.18; t < 0.95; t += 0.16) {
            const w2 = (wid / 2) * (1 - t) + 0.4;
            const px = bx + ux * t, py = by + uy * t;
            ctx.beginPath();
            ctx.moveTo(X(px + nx * w2), Y(py + ny * w2));
            ctx.lineTo(X(px - nx * w2), Y(py - ny * w2));
            ctx.stroke();
        }
        ctx.restore();
    },

    /** Forget the built sheets (tests). */
    _reset() { _cache.clear(); },
};
