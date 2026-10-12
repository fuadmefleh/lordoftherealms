// Cloud textures — tileable value-noise canvases for drifting cloud and
// cloud-shadow layers (the title backdrop and the map's unexplored fog).
// Pure presentation: hashed, not drawn from the game RNG, so the same
// texture comes back every time and no simulation state is touched.

const cache = new Map();

function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Periodic value noise: `cells` lattice cells across, wrapping seamlessly. */
function periodicNoise(x, y, cells, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const w = (v) => ((v % cells) + cells) % cells;
    const a = hash2(w(x0), w(y0), seed);
    const b = hash2(w(x0 + 1), w(y0), seed);
    const c = hash2(w(x0), w(y0 + 1), seed);
    const d = hash2(w(x0 + 1), w(y0 + 1), seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * A square, seamlessly tiling cloud canvas.
 * @param {object} o
 * @param {number} [o.size=256]   pixel size of the texture
 * @param {number} [o.seed=1]
 * @param {string} [o.rgb='230,236,244'] cloud colour as "r,g,b"
 * @param {number} [o.lo=0.42]    noise level where cloud begins
 * @param {number} [o.hi=0.78]    noise level where cloud is opaque
 * @param {number} [o.base=4]     lattice cells of the broadest octave
 * @returns {HTMLCanvasElement}
 */
export function cloudTexture({ size = 256, seed = 1, rgb = '230,236,244', lo = 0.42, hi = 0.78, base = 4 } = {}) {
    const key = [size, seed, rgb, lo, hi, base].join('|');
    if (cache.has(key)) return cache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx && ctx.createImageData ? ctx.createImageData(size, size) : null;
    // Headless (tests) or a context without pixel access: a blank texture draws as nothing
    if (!img || !img.data) {
        cache.set(key, canvas);
        return canvas;
    }
    const [r, g, b] = rgb.split(',').map(Number);
    const octaves = 5;

    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            let v = 0, amp = 0.5, norm = 0, cells = base;
            for (let o = 0; o < octaves; o++) {
                v += amp * periodicNoise((px / size) * cells, (py / size) * cells, cells, seed + o * 17);
                norm += amp;
                amp *= 0.5;
                cells *= 2;
            }
            v /= norm;
            const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
            const i = (py * size + px) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = Math.round(smooth(t) * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    cache.set(key, canvas);
    return canvas;
}

/**
 * Fill the whole canvas with a scrolling, scaled cloud layer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} tex   from cloudTexture()
 * @param {number} ox  scroll offset x (screen px)
 * @param {number} oy  scroll offset y (screen px)
 * @param {number} scale  texture magnification
 * @param {number} alpha
 */
export function drawCloudLayer(ctx, tex, ox, oy, scale, alpha) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    // Whole-pixel tiles and offsets, so neighbouring copies meet without a hairline seam
    const tile = Math.max(1, Math.round(tex.width * scale));
    const sx = Math.round(((ox % tile) + tile) % tile) - tile;
    const sy = Math.round(((oy % tile) + tile) % tile) - tile;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    for (let y = sy; y < h; y += tile) {
        for (let x = sx; x < w; x += tile) {
            ctx.drawImage(tex, x, y, tile, tile);
        }
    }
    ctx.restore();
}
