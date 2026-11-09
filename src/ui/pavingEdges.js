// Kerbs along a paved street's sides (world/townPlanner.js lays the paving:
// tile.paving + tile._pave 'main' | 'lane' | 'plaza'). Laid square tile by tile,
// a street used to stop dead against the dirt or grass beside it; here every side
// of a paved cell that meets unpaved ground (or a square meeting a street) gets a
// row of edge stones, a little shade inside it and a worn, ragged fringe of dirt
// just outside it, so the street reads as built.
//
// Drawn from innerMapLayers/terrainRoads.js after the ground and its grass, so the
// fringe can fall on the neighbouring tile. Each piece is drawn once per size and
// variant into an offscreen canvas and reused.

const SIDES = ['n', 'e', 's', 'w'];
const VARIANTS = 3;
const _cache = new Map();

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

/**
 * One side's piece, drawn for the north side; the others are this rotated.
 * The canvas is a tile wide and 1.5 tiles tall: the top half-tile is the fringe
 * outside the street, the rest is the tile itself (the kerb at its top).
 */
function _piece(size, variant) {
    const key = size + ':' + variant;
    let c = _cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const S = size, O = Math.round(S * 0.5);
    c.width = S; c.height = S + O;
    const g = c.getContext('2d');
    const rnd = _stream(variant * 7919 + 17);
    const kerb = Math.max(4, Math.round(S * 0.17));

    // worn dirt and grime just outside, ragged
    g.save();
    g.beginPath();
    g.moveTo(0, O);
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * S;
        const reach = S * (0.07 + rnd() * 0.1);
        g.lineTo(x, O - reach);
    }
    g.lineTo(S, O);
    g.closePath();
    const fr = g.createLinearGradient(0, O - S * 0.17, 0, O);
    fr.addColorStop(0, 'rgba(70, 52, 34, 0)');
    fr.addColorStop(1, 'rgba(62, 46, 30, 0.6)');
    g.fillStyle = fr;
    g.fill();
    g.restore();

    // the kerb stones: rounded blocks of slightly different sizes and tones
    const n = 3 + Math.floor(rnd() * 2);
    const gap = Math.max(1, Math.round(S / 48));
    let x = 0;
    for (let i = 0; i < n; i++) {
        const w = i === n - 1 ? S - x : Math.round((S / n) * (0.8 + rnd() * 0.4));
        const tone = 118 + Math.floor(rnd() * 30);
        const h = kerb - Math.round(rnd() * kerb * 0.15);
        const y0 = O + (kerb - h);
        const rad = Math.max(1, Math.round(h * 0.3));
        g.fillStyle = 'rgba(45, 38, 30, 0.55)';          // the joint and outline behind
        g.beginPath(); g.roundRect(x, O, w, kerb + gap, rad); g.fill();
        g.fillStyle = `rgb(${tone}, ${tone - 5}, ${tone - 14})`;
        g.beginPath(); g.roundRect(x + gap, y0 + gap, w - gap * 2, h - gap * 2, rad); g.fill();
        g.fillStyle = 'rgba(255, 248, 230, 0.3)';          // the lit top
        g.beginPath(); g.roundRect(x + gap, y0 + gap, w - gap * 2, Math.max(1, Math.round(h * 0.32)), rad); g.fill();
        g.fillStyle = 'rgba(30, 24, 18, 0.3)';             // the shaded foot
        g.fillRect(x + gap, y0 + h - gap - Math.max(1, Math.round(h * 0.22)), w - gap * 2, Math.max(1, Math.round(h * 0.22)));
        x += w;
    }
    // a dark line along the outer edge
    g.fillStyle = 'rgba(35, 28, 22, 0.7)';
    g.fillRect(0, O, S, Math.max(1, Math.round(S / 64)));

    // shade on the paving just inside the kerb
    const sh = g.createLinearGradient(0, O + kerb, 0, O + kerb + S * 0.08);
    sh.addColorStop(0, 'rgba(20, 15, 10, 0.25)');
    sh.addColorStop(1, 'rgba(20, 15, 10, 0)');
    g.fillStyle = sh;
    g.fillRect(0, O + kerb, S, S * 0.08);

    _cache.set(key, c);
    if (_cache.size > 64) _cache.delete(_cache.keys().next().value);
    return c;
}

/** Which sides of the cell at (q, r) want a kerb: `open(dq, dr)` says a neighbour isn't more of the same paving. */
export function kerbSides(open) {
    const out = [];
    if (open(0, -1)) out.push('n');
    if (open(1, 0)) out.push('e');
    if (open(0, 1)) out.push('s');
    if (open(-1, 0)) out.push('w');
    return out;
}

/** Draw the kerbs of a paved cell at screen (x, y), ds across. */
export function drawKerbs(ctx, open, q, r, x, y, ds) {
    if (typeof document === 'undefined') return;
    const sides = kerbSides(open);
    if (!sides.length) return;
    const S = Math.max(8, Math.round(ds));
    const O = Math.round(S * 0.5);
    const cx = Math.floor(x) + S / 2, cy = Math.floor(y) + S / 2;
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    for (const s of sides) {
        const i = SIDES.indexOf(s);
        const piece = _piece(S, _h(q, r, i) % VARIANTS);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * Math.PI / 2);
        ctx.drawImage(piece, -S / 2, -S / 2 - O);
        ctx.restore();
    }
    ctx.imageSmoothingEnabled = smooth;
}
