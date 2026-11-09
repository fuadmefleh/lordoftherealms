// The edges and wear of an unpaved road: a village's dirt lanes and the tracks
// beyond a town's cobbles (world/townPlanner.js lays them: tile.isRoad with no
// tile.paving), and the country roads between (world/innerMap/npcs.js).
//
// The grass brush meets a lane in a clean line along each tile, so a lane read
// as cut out of the turf with a ruler. Here every side of a lane cell that meets
// grass gets a ragged run of tufts spilling over the dirt (cut from the season's
// own grass, so it is green in spring and snow in winter), a little shade under
// them, and a darker, trodden verge just inside; and every lane cell gets some
// wear on its dirt: paler packed patches, darker damp ones and a few pebbles.
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
    if (_cache.size > 160) _cache.delete(_cache.keys().next().value);
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

/**
 * The tufts along one side of a lane cell. The canvas is the cell with a margin
 * M all round (the tufts start a little into the grass cell beyond the edge, to
 * hide its straight line); the shapes are laid out for the north side and turned,
 * the shade always falls down the screen.
 */
function _tufts(S, side, variant, grass) {
    const key = `t:${S}:${side}:${variant}:${grass.img.src}:${grass.sx},${grass.sy}`;
    const hit = _cache.get(key);
    if (hit) return hit;
    const M = Math.round(S * 0.25);
    const c = document.createElement('canvas');
    c.width = c.height = S + 2 * M;
    const g = c.getContext('2d');
    const rnd = _stream(variant * 7919 + SIDES.indexOf(side) * 104729 + 11);
    const tone = _tone(grass);

    // the grass texture, at the cell's size
    const tex = document.createElement('canvas');
    tex.width = tex.height = S;
    tex.getContext('2d').drawImage(grass.img, grass.sx, grass.sy, grass.sw, grass.sw, 0, 0, S, S);
    const pat = g.createPattern(tex, 'repeat');

    // the run of clumps along the edge (north frame: the edge is y = 0, the lane is y > 0)
    const clumps = [];
    let x = -S * 0.5 + rnd() * S * 0.06;
    while (x < S * 0.5 + S * 0.04) {
        const rad = S * (0.035 + rnd() * 0.06);
        clumps.push({ x, y: S * (-0.03 + rnd() * 0.08), rad });
        x += rad * (1.1 + rnd() * 0.7);
    }
    // a few long blades poking further out
    const blades = [];
    const nb = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < nb; i++) {
        const bx = -S * 0.48 + rnd() * S * 0.96;
        blades.push({ x: bx, len: S * (0.08 + rnd() * 0.1), lean: (rnd() - 0.5) * S * 0.08, w: S * (0.014 + rnd() * 0.012) });
    }
    const path = (ctx, grow = 0) => {
        ctx.beginPath();
        for (const k of clumps) {
            ctx.moveTo(k.x + k.rad + grow, k.y);
            ctx.arc(k.x, k.y, k.rad + grow, 0, Math.PI * 2);
        }
        for (const b of blades) {
            ctx.moveTo(b.x - b.w - grow, 0);
            ctx.quadraticCurveTo(b.x + b.lean * 0.4, b.len * 0.6, b.x + b.lean, b.len + grow);
            ctx.quadraticCurveTo(b.x + b.lean * 0.4 + b.w, b.len * 0.5, b.x + b.w + grow, 0);
            ctx.closePath();
        }
    };
    const rot = SIDES.indexOf(side) * Math.PI / 2;
    const cx = M + S / 2, cy = M + S / 2;
    const frame = (ctx, dx = 0, dy = 0) => {
        ctx.setTransform(1, 0, 0, 1, cx + dx, cy + dy);
        ctx.rotate(rot);
        ctx.translate(0, -S / 2);
    };

    // the shade the tufts throw on the dirt, down the screen and a little soft
    frame(g, 0, S * 0.03);
    g.fillStyle = 'rgba(45, 30, 15, 0.16)';
    path(g, S * 0.02); g.fill();
    frame(g, 0, S * 0.018);
    g.fillStyle = 'rgba(40, 26, 12, 0.22)';
    path(g); g.fill();

    // the tufts themselves, then a darker underside and a lit top on each clump
    frame(g);
    g.fillStyle = pat;
    path(g); g.fill();
    for (const k of clumps) {
        const gr = g.createRadialGradient(k.x - k.rad * 0.3, k.y - k.rad * 0.4, k.rad * 0.1, k.x, k.y, k.rad);
        gr.addColorStop(0, _rgba(tone, 1.15, 0.2));
        gr.addColorStop(0.6, _rgba(tone, 1, 0));
        gr.addColorStop(1, _rgba(tone, 0.6, 0.35));
        g.fillStyle = gr;
        g.beginPath(); g.arc(k.x, k.y, k.rad, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = _rgba(tone, 0.5, 0.55);
    g.lineWidth = Math.max(1, S / 96);
    for (const b of blades) {
        g.beginPath();
        g.moveTo(b.x, b.len * 0.15);
        g.quadraticCurveTo(b.x + b.lean * 0.4, b.len * 0.6, b.x + b.lean, b.len);
        g.stroke();
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

/**
 * The grass tufts spilling over a lane cell's grassy sides, along where the grass
 * beside it actually starts. `grassy(dq, dr)` gives the neighbour's overlay cell
 * ({ img, sx, sy, sw }) when it is turf; `grass` is a plain cell of the same turf.
 */
export function drawLaneTufts(ctx, grassy, q, r, x, y, ds, grass) {
    if (typeof document === 'undefined' || !grass || !grass.img) return;
    const S = _size(ds);
    const f = ds / S;
    const M = Math.round(S * 0.25);
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    for (const s of SIDES) {
        const [dq, dr] = _STEP[s];
        const cell = grassy(dq, dr);
        if (!cell || !cell.img) continue;
        const inset = _inset(cell, s);
        if (inset >= 0.6) continue;       // (no turf along that side: leave the brush's own edge)
        const i = SIDES.indexOf(s);
        const piece = _tufts(S, s, _h(q, r, i + 3) % VARIANTS, grass);
        const ox = dq * inset * ds, oy = dr * inset * ds;
        ctx.drawImage(piece, Math.floor(x) - M * f + ox, Math.floor(y) - M * f + oy, piece.width * f, piece.height * f);
    }
    ctx.imageSmoothingEnabled = smooth;
}
