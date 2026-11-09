// The edges and wear of an unpaved road: a village's dirt lanes and the tracks
// beyond a town's cobbles (world/townPlanner.js lays them: tile.isRoad with no
// tile.paving), and the country roads between (world/innerMap/npcs.js).
//
// The grass brush meets a lane in the same edge tile after tile (or, beside a
// plain grass cell, in a dead straight line), so a lane read as cut out of the
// turf with a ruler. Here every side of a lane cell that meets grass gets an edge
// that wanders in and out along where the turf starts, dirt biting into the grass
// and grass pushing onto the road, with a dark rim and tufts along it (cut from
// the season's own grass); a darker, trodden verge just inside; wear on the dirt
// (paler packed patches, darker damp ones, pebbles); and where a street's cobbles
// give out onto the dirt road, the paving frays out into loose stones instead of
// stopping at a kerb.
//
// Drawn from innerMapLayers/terrainRoads.js after the ground, so the tufts can lie
// over the grass cell's own edge. Each piece is drawn once per size, side, variant
// and season into an offscreen canvas and reused.

const SIDES = ['n', 'e', 's', 'w'];
const VARIANTS = 4;
const WEAR_VARIANTS = 6;
const _cache = new Map();
const _tones = new Map();

function _h(q, r, s) {
    let x = (q * 73856093) ^ (r * 19349663) ^ (s * 83492791);
    x = (x ^ (x >>> 13)) * 1274126177;
    return (x ^ (x >>> 16)) >>> 0;
}

/** A tiny seeded stream for one piece's look (a UI pattern, not game state). */
function _stream(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _remember(key, c) {
    _cache.set(key, c);
    if (_cache.size > 600) _cache.delete(_cache.keys().next().value);
    return c;
}

/** The grass cell's average colour (for the blades' dark and light), once per cell. */
function _tone(grass) {
    const key = grass.img.src + '|' + grass.sx + ',' + grass.sy;
    let t = _tones.get(key);
    if (t) return t;
    t = [96, 140, 60];
    try {
        const c = document.createElement('canvas');
        c.width = c.height = 8;
        const g = c.getContext('2d');
        g.drawImage(grass.img, grass.sx, grass.sy, grass.sw, grass.sw, 0, 0, 8, 8);
        const d = g.getImageData(0, 0, 8, 8).data;
        let r = 0, gg = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
        if (n) t = [r / n, gg / n, b / n];
    } catch { /* (a sheet from elsewhere: keep the plain green) */ }
    _tones.set(key, t);
    return t;
}

const _rgba = (c, k, a) => `rgba(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)}, ${a})`;

/** A cell of a sheet as a repeating pattern at S px a cell. */
function _pattern(g, cell, S) {
    const tex = document.createElement('canvas');
    tex.width = tex.height = S;
    tex.getContext('2d').drawImage(cell.img, cell.sx, cell.sy, cell.sw, cell.sw, 0, 0, S, S);
    return g.createPattern(tex, 'repeat');
}

/** The piece canvas for one side: the cell with a margin all round, drawn in the north frame. */
function _canvas(S, side) {
    const M = Math.round(S * 0.25);
    const c = document.createElement('canvas');
    c.width = c.height = S + 2 * M;
    const g = c.getContext('2d');
    const rot = SIDES.indexOf(side) * Math.PI / 2;
    // the north frame: the edge along y = 0 from x = -S/2 to S/2, the lane at y > 0
    const frame = (dx = 0, dy = 0) => {
        g.setTransform(1, 0, 0, 1, M + S / 2 + dx, M + S / 2 + dy);
        g.rotate(rot);
        g.translate(0, -S / 2);
    };
    return { c, g, frame };
}

/** Where a corner's edge line crosses it: one of three, shared by the cells either side. */
export const RAGGED_KNOTS = [-0.11, 0, 0.07];

/**
 * A wandering edge along where a lane meets turf: the line between dirt and grass
 * bends in and out along a profile that passes through each corner's shared
 * height, so a long road's side wanders on unbroken. Returns the shapes, in the
 * piece canvas's px (see _canvas): `grassPath`, the turf pushed onto the road (and
 * a little way back over the grass cell, to cover its straight line), and
 * `bitePath`, the dirt bitten into the grass; they are filled at draw time with the
 * very grass and dirt cells either side, so the textures run on without a seam.
 * And `overlay`: the shade under the turf, a dark rim along the line, and tufts of
 * blades on it leaning out over the road.
 */
function _ragged(S, side, kA, kB, variant, grass) {
    const key = `r:${S}:${side}:${kA}:${kB}:${variant}:${grass.img.src}:${grass.sx},${grass.sy}`;
    const hit = _cache.get(key);
    if (hit) return hit;
    const { c, g, frame } = _canvas(S, side);
    const M = Math.round(S * 0.25);
    const rnd = _stream(variant * 6151 + SIDES.indexOf(side) * 3571 + kA * 97 + kB * 13 + 5);
    const tone = _tone(grass);
    const knots = [RAGGED_KNOTS[kA], (rnd() - 0.55) * 0.3, (rnd() - 0.55) * 0.3, (rnd() - 0.55) * 0.3, RAGGED_KNOTS[kB]];
    const b = x => {             // the profile at x (-S/2 .. S/2), in px: < 0 into the grass, > 0 onto the road
        const t = Math.max(0, Math.min(3.9999, (x / S + 0.5) * 4));
        const i = Math.floor(t), f = t - i;
        const e = (1 - Math.cos(f * Math.PI)) / 2;
        return (knots[i] * (1 - e) + knots[i + 1] * e) * S;
    };
    const STEPS = 24;
    const xs = Array.from({ length: STEPS + 1 }, (_, i) => -S / 2 + (i / STEPS) * S);
    const BACK = -S * 0.06;

    // the shapes, laid out in the north frame and turned into the piece's px
    const m = new DOMMatrix().translate(M + S / 2, M + S / 2).rotate(SIDES.indexOf(side) * 90).translate(0, -S / 2);
    const gp = new Path2D();
    gp.moveTo(xs[0], BACK);
    for (const x of xs) gp.lineTo(x, Math.max(BACK, b(x)));
    gp.lineTo(xs[STEPS], BACK);
    gp.closePath();
    const bp = new Path2D();
    bp.moveTo(xs[0], 0.5);
    for (const x of xs) bp.lineTo(x, Math.min(0.5, b(x)));
    bp.lineTo(xs[STEPS], 0.5);
    bp.closePath();
    const grassPath = new Path2D();
    grassPath.addPath(gp, m);
    const bitePath = new Path2D();
    bitePath.addPath(bp, m);

    // the shade the turf throws on the road
    frame(0, S * 0.02);
    g.fillStyle = 'rgba(40, 26, 12, 0.22)';
    g.beginPath(); g.moveTo(xs[0], 0); for (const x of xs) g.lineTo(x, Math.max(0, b(x)) + S * 0.01); g.lineTo(xs[STEPS], 0); g.closePath(); g.fill();
    // the dark rim along the line, on the dirt side
    frame();
    g.strokeStyle = 'rgba(45, 32, 16, 0.32)';
    g.lineWidth = Math.max(1, S * 0.03);
    g.beginPath(); g.moveTo(xs[0], b(xs[0]) + S * 0.015); for (const x of xs) g.lineTo(x, b(x) + S * 0.015); g.stroke();
    // tufts along it: little fans of blades rooted on the line, leaning out over the road
    const pat = _pattern(g, grass, S);
    const blade = (bx, by, ang, len, w) => {
        const ex = bx + Math.sin(ang) * len, ey = by + Math.cos(ang) * len;
        const nx = Math.cos(ang) * w, ny = -Math.sin(ang) * w;
        g.moveTo(bx - nx, by - ny);
        g.quadraticCurveTo((bx + ex) / 2 - nx * 0.4, (by + ey) / 2 - ny * 0.4, ex, ey);
        g.quadraticCurveTo((bx + ex) / 2 + nx * 0.4, (by + ey) / 2 + ny * 0.4, bx + nx, by + ny);
        g.closePath();
    };
    let x = -S / 2 + rnd() * S * 0.06;
    while (x < S / 2) {
        const by = b(x) - S * 0.01;
        const n = 4 + Math.floor(rnd() * 5);
        const blades = [];
        for (let k = 0; k < n; k++) {
            blades.push([x + (rnd() - 0.5) * S * 0.05, by + rnd() * S * 0.01, (rnd() - 0.5) * 1.9, S * (0.04 + rnd() * 0.09), S * (0.008 + rnd() * 0.008)]);
        }
        frame(0, S * 0.016);                                        // their shade
        g.fillStyle = 'rgba(40, 26, 12, 0.22)';
        g.beginPath(); for (const bl of blades) blade(...bl); g.fill();
        frame();
        g.fillStyle = pat;
        g.beginPath(); for (const bl of blades) blade(...bl); g.fill();
        g.strokeStyle = _rgba(tone, 0.55, 0.5);
        g.lineWidth = Math.max(0.6, S / 160);
        g.stroke();
        g.fillStyle = _rgba(tone, 1.2, 0.18);                      // a lit tip or two
        g.beginPath(); for (const bl of blades.slice(0, 2)) blade(bl[0], bl[1], bl[2], bl[3], bl[4] * 0.5); g.fill();
        x += S * (0.05 + rnd() * 0.09);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return _remember(key, { overlay: c, grassPath, bitePath });
}

/**
 * Where a street's paving gives out onto a dirt road: the last stones worn and
 * sunk into the dirt (dirt over the paving's edge), and loose stones scattered on
 * the dirt beyond, thinning out, so the cobbles fray into the road instead of
 * stopping at a kerb. Drawn on the dirt cell; the paving is north in the frame.
 */
function _paveEnd(S, side, variant, pave, dirt) {
    const key = `p:${S}:${side}:${variant}:${pave.img.src}:${pave.sx},${pave.sy}:${dirt.sx},${dirt.sy}`;
    const hit = _cache.get(key);
    if (hit) return hit;
    const { c, g, frame } = _canvas(S, side);
    const rnd = _stream(variant * 92821 + SIDES.indexOf(side) * 68917 + 3);
    frame();
    // dirt worn over the paving's edge, ragged
    g.fillStyle = _pattern(g, dirt, S);
    g.beginPath();
    for (let x = -S / 2; x < S / 2 + S * 0.05; x += S * (0.06 + rnd() * 0.06)) {
        const rad = S * (0.05 + rnd() * 0.07);
        const y = -S * (0.02 + rnd() * 0.1);
        g.moveTo(x + rad, y); g.arc(x, y, rad, 0, Math.PI * 2);
    }
    g.rect(-S / 2, -S * 0.02, S, S * 0.03);
    g.fill();
    // loose stones on the dirt, fewer the further out
    const pat = _pattern(g, pave, S);
    const stones = [];
    for (let row = 0; row < 3; row++) {
        const y0 = -S * 0.08 + row * S * 0.19;
        const keep = 0.85 - row * 0.3;
        let x = -S / 2 + rnd() * S * 0.1;
        while (x < S / 2) {
            const w = S * (0.2 + rnd() * 0.1), h = S * (0.13 + rnd() * 0.06);
            if (rnd() < keep) stones.push({ x: x + rnd() * S * 0.04, y: y0 + rnd() * S * 0.05, w, h, a: (rnd() - 0.5) * 0.4 });
            x += w + S * (0.03 + rnd() * 0.1) + row * S * 0.08;
        }
    }
    for (const st of stones) {
        g.save();
        g.translate(st.x + st.w / 2, st.y + st.h / 2);
        g.rotate(st.a);
        const r = Math.min(st.w, st.h) * 0.35;
        g.fillStyle = 'rgba(35, 25, 15, 0.35)';                       // its shade on the dirt
        g.beginPath(); g.roundRect(-st.w / 2 + S * 0.008, -st.h / 2 + S * 0.016, st.w, st.h, r); g.fill();
        g.fillStyle = 'rgba(45, 38, 30, 0.75)';                       // the joint round it
        g.beginPath(); g.roundRect(-st.w / 2, -st.h / 2, st.w, st.h, r); g.fill();
        g.fillStyle = pat;
        g.beginPath(); g.roundRect(-st.w / 2 + 1, -st.h / 2 + 1, st.w - 2, st.h - 2, r); g.fill();
        g.fillStyle = 'rgba(255, 248, 230, 0.22)';                    // the lit top
        g.beginPath(); g.roundRect(-st.w / 2 + 1, -st.h / 2 + 1, st.w - 2, (st.h - 2) * 0.35, r); g.fill();
        g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return _remember(key, c);
}

/** The trodden, darker verge just inside a lane's side. */
function _verge(S, side) {
    const key = `v:${S}:${side}`;
    const hit = _cache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const d = S * 0.3;
    const [x0, y0, x1, y1] = { n: [0, 0, 0, d], s: [0, S, 0, S - d], w: [0, 0, d, 0], e: [S, 0, S - d, 0] }[side];
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(60, 40, 22, 0.2)');
    gr.addColorStop(1, 'rgba(60, 40, 22, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return _remember(key, c);
}

/** Wear on a lane cell's dirt: packed and damp patches, a few pebbles. */
function _wear(S, variant) {
    const key = `w:${S}:${variant}`;
    const hit = _cache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const rnd = _stream(variant * 15485863 + 7);
    const patches = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < patches; i++) {
        const px = S * (0.25 + rnd() * 0.5), py = S * (0.25 + rnd() * 0.5);
        const pr = S * (0.14 + rnd() * 0.12);
        const light = rnd() < 0.5;
        const gr = g.createRadialGradient(px, py, 0, px, py, pr);
        gr.addColorStop(0, light ? 'rgba(235, 205, 160, 0.13)' : 'rgba(70, 45, 22, 0.13)');
        gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = gr;
        g.save();
        g.translate(px, py); g.scale(1, 0.7 + rnd() * 0.5); g.translate(-px, -py);
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
        g.restore();
    }
    const pebbles = Math.floor(rnd() * 5);
    for (let i = 0; i < pebbles; i++) {
        const px = S * (0.1 + rnd() * 0.8), py = S * (0.1 + rnd() * 0.8);
        const rx = S * (0.012 + rnd() * 0.018), ry = rx * (0.6 + rnd() * 0.3);
        const t = 120 + Math.floor(rnd() * 50);
        g.fillStyle = 'rgba(40, 28, 16, 0.35)';
        g.beginPath(); g.ellipse(px, py + ry * 0.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgb(${t}, ${t - 8}, ${t - 20})`;
        g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255, 245, 225, 0.35)';
        g.beginPath(); g.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.45, ry * 0.4, 0, 0, Math.PI * 2); g.fill();
    }
    return _remember(key, c);
}

/**
 * How far in from its side facing the lane a grass cell's turf starts (0 = right at
 * the line, as a fraction of the cell); 1 when no turf shows along that side. The
 * brush's edge cells are painted whole, dirt and all, so this reads the colour: the
 * dirt is what the cell shows right at that side, and the turf starts where the
 * colour turns well away from it without darkening (so the brush's dark rim round
 * the grass is not the turf, and winter's snow on snow shows none). A plain fill
 * (`full`) is turf to its edge. Once per cell of the sheet and side.
 */
function _inset(cell, side) {
    if (cell.full) return 0;
    const key = `i:${cell.img.src}|${cell.sx},${cell.sy},${cell.sw}:${side}`;
    const hit = _tones.get(key);
    if (hit !== undefined) return hit;
    let inset = 1;
    try {
        const N = 32;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const g = c.getContext('2d');
        g.drawImage(cell.img, cell.sx, cell.sy, cell.sw, cell.sw, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        // `side` is the lane cell's side, so the grass cell faces it with the opposite one
        const at = (i, k) => {
            const [x, y] = side === 'n' ? [i, N - 1 - k] : side === 's' ? [i, k] : side === 'e' ? [k, i] : [N - 1 - k, i];
            const o = (y * N + x) * 4;
            return [d[o], d[o + 1], d[o + 2]];
        };
        const lum = p => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
        const ref = [0, 0, 0];
        for (let i = 2; i < N - 2; i++) for (let k = 0; k < 2; k++) { const p = at(i, k); ref[0] += p[0]; ref[1] += p[1]; ref[2] += p[2]; }
        for (let j = 0; j < 3; j++) ref[j] /= (N - 4) * 2;
        const refL = lum(ref);
        const depths = [];
        const lim = Math.round(N * 0.6);
        for (let i = 4; i < N - 4; i++) {
            let k = 0;
            for (; k < lim; k++) {
                const p = at(i, k);
                if (Math.hypot(p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]) > 35 && lum(p) > refL * 0.72) break;
            }
            depths.push(k);
        }
        depths.sort((x, y) => x - y);
        const m = depths[depths.length >> 1];
        inset = m >= lim ? 1 : m / N;
    } catch { inset = 1; }
    _tones.set(key, inset);
    return inset;
}

/** Which sides of a lane cell meet grass: `grassy(dq, dr)` says a neighbour is turf. */
export function laneSides(grassy) {
    const out = [];
    if (grassy(0, -1)) out.push('n');
    if (grassy(1, 0)) out.push('e');
    if (grassy(0, 1)) out.push('s');
    if (grassy(-1, 0)) out.push('w');
    return out;
}

const _size = ds => Math.max(8, Math.round(ds / 4) * 4);   // (drawn at a few sizes, scaled to the cell)
const _STEP = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/** The wear on a lane cell's dirt, and the verge along its grassy sides (under everything else). */
export function drawLaneGround(ctx, grassy, q, r, x, y, ds) {
    if (typeof document === 'undefined') return;
    const S = _size(ds);
    const sz = Math.ceil(ds) + 1;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(_wear(S, _h(q, r, 9) % WEAR_VARIANTS), Math.floor(x), Math.floor(y), sz, sz);
    for (const s of SIDES) {
        const [dq, dr] = _STEP[s];
        const cell = grassy(dq, dr);
        const inset = cell && cell.img ? _inset(cell, s) : 1;
        if (inset >= 0.6) continue;
        // (along where the turf really starts, in the grass cell's own painted dirt)
        ctx.drawImage(_verge(S, s), Math.floor(x) + dq * inset * ds, Math.floor(y) + dr * inset * ds, sz, sz);
    }
    ctx.imageSmoothingEnabled = smooth;
}

/** The corners each side's edge runs between, in the north frame's order (see _canvas). */
const _ENDS = { n: [[0, 0], [1, 0]], e: [[1, 0], [1, 1]], s: [[1, 1], [0, 1]], w: [[0, 1], [0, 0]] };

/**
 * The edges of a lane cell, drawn over the ground: a wandering edge along where
 * the turf beside it starts, and the paving fraying out where a street's cobbles
 * give out onto it. `grassy(dq, dr)` gives a turf neighbour's own ground cell
 * ({ img, sx, sy, sw, full? }: full when it is plain turf to its edges);
 * `grass` is a plain cell of the season's grass, `dirt` this lane cell's own
 * dirt; `paveOf(dq, dr)` gives a paved neighbour's paving cell.
 */
export function drawLaneTufts(ctx, grassy, q, r, x, y, ds, grass, dirt = null, paveOf = null) {
    if (typeof document === 'undefined' || !grass || !grass.img) return;
    const S = _size(ds);
    const f = ds / S;
    const M = Math.round(S * 0.25);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    const X0 = Math.floor(x) - M * f, Y0 = Math.floor(y) - M * f;
    for (const s of SIDES) {
        const [dq, dr] = _STEP[s];
        const i = SIDES.indexOf(s);
        const pave = paveOf && dirt && paveOf(dq, dr);
        if (pave && pave.img) {
            const piece = _paveEnd(S, s, _h(q, r, i + 7) % VARIANTS, pave, dirt);
            ctx.drawImage(piece, X0, Y0, piece.width * f, piece.height * f);
            continue;
        }
        const cell = grassy(dq, dr);
        if (!cell || !cell.img || !dirt) continue;
        const inset = _inset(cell, s);
        if (inset >= 0.6) continue;       // (no turf along that side: leave the brush's own edge)
        const [[aq, ar], [bq, br]] = _ENDS[s];
        const o = s === 'n' || s === 's' ? 1 : 2;
        const kA = _h(q + aq, r + ar, o) % RAGGED_KNOTS.length, kB = _h(q + bq, r + br, o) % RAGGED_KNOTS.length;
        const rg = _ragged(S, s, kA, kB, _h(q, r, i + 3) % VARIANTS, grass);
        const ox = dq * inset * S, oy = dr * inset * S;            // (piece px: along where the turf starts)
        // in the piece's px, this cell sits at (M, M) less the shift, its neighbour a cell over
        const rx = M - ox, ry = M - oy, nx = rx + dq * S, ny = ry + dr * S;
        const turf = cell.full ? cell : grass;
        ctx.save();
        ctx.translate(X0 + ox * f, Y0 + oy * f);
        ctx.scale(f, f);
        ctx.save();
        ctx.clip(rg.grassPath);
        ctx.drawImage(turf.img, turf.sx, turf.sy, turf.sw, turf.sw, nx, ny, S + 0.5, S + 0.5);
        ctx.drawImage(turf.img, turf.sx, turf.sy, turf.sw, turf.sw, rx, ry, S + 0.5, S + 0.5);
        ctx.restore();
        ctx.clip(rg.bitePath);
        ctx.drawImage(dirt.img, dirt.sx, dirt.sy, dirt.sw, dirt.sw, rx, ry, S + 0.5, S + 0.5);
        ctx.drawImage(dirt.img, dirt.sx, dirt.sy, dirt.sw, dirt.sw, nx, ny, S + 0.5, S + 0.5);
        ctx.restore();
        ctx.drawImage(rg.overlay, X0 + ox * f, Y0 + oy * f, rg.overlay.width * f, rg.overlay.height * f);
    }
    ctx.imageSmoothingEnabled = smooth;
}
