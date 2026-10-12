// Title backdrop — an endless painted realm drifting under the menus.
// A procedural hex land drawn with the game's own terrain sprites, a slow
// camera, cloud shadows sliding over the ground, high cloud passing nearer
// the eye, and motes of light rising. Presentation only: hashed noise, no
// game state, no game RNG. Mounted by components/TitleBackdrop.jsx.
import { cloudTexture, drawCloudLayer } from './cloudTexture.js';

const T = 'assets/tiles/';
const P = T + 'pop_center_images/';
const seq = (prefix, from, to, pad = 2) => {
    const out = [];
    for (let i = from; i <= to; i++) out.push(`${prefix}${String(i).padStart(pad, '0')}.png`);
    return out;
};

const SPRITES = {
    ocean: seq(T + 'ocean/hexOceanCalm', 0, 3),
    calm: seq(T + 'ocean/hexLake', 0, 3),
    plains: seq(T + 'hexPlains', 1, 3),
    scrub: seq(T + 'hexScrublands', 1, 3),
    marsh: seq(T + 'hexMarsh', 0, 3),
    forest: [...seq(T + 'hexForestBroadleaf', 1, 3), ...seq(T + 'hexWoodlands', 1, 3)],
    pine: seq(T + 'cold/hexForestPine', 0, 3),
    hills: seq(T + 'hexHills', 1, 3),
    highlands: seq(T + 'hexHighlands', 1, 3),
    mountain: seq(T + 'hexMountain', 1, 3),
    snowpeak: seq(T + 'cold/hexMountainSnow', 0, 3),
    farm: seq(P + 'hexPlainsFarm', 0, 3),
    village: [...seq(P + 'hexPlainsVillage', 0, 3), ...seq(P + 'hexPlainsVillageSmall', 0, 3)],
    seat: [P + 'hexPlainsCastle00.png', P + 'hexPlainsWalledCity00.png', P + 'hexPlainsTemple00.png', P + 'hexPlainsInn00.png'],
    woodhold: [P + 'hexForestElvenLodge00.png', P + 'hexForestBroadleafForester00.png', P + 'hexForestCastleRuins00.png'],
    fortress: [P + 'hexMountainFortress00.png', P + 'hexMountainDwarfFortress00.png', P + 'hexMountainCastle00.png'],
    mine: seq(P + 'hexHillsMine', 0, 3),
    isle: [T + 'ocean/hexIslandSandy00.png', T + 'ocean/hexIslandRockyTower00.png', T + 'ocean/hexOceanShipWreck00.png', T + 'ocean/hexIslandSandyTemple00.png'],
};

// ── Noise (hashed, unbounded) ──────────────────────────────────────────
function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + s * 974634431) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, s) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s);
    const c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s) {
    let v = 0, amp = 0.5, n = 0;
    for (let o = 0; o < 4; o++) {
        v += amp * vnoise(x, y, s + o * 31);
        n += amp;
        amp *= 0.5;
        x *= 2.03;
        y *= 2.03;
    }
    return v / n;
}

/** Which sprite (if any) stands on hex (q, r) of the endless realm. */
function spriteFor(q, r, seed, cache) {
    const key = q + ',' + r;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const x = q + (r & 1 ? 0 : 0.5);
    const y = r * 0.866;
    const e = fbm(x * 0.07, y * 0.07, seed);
    const m = fbm(x * 0.11 + 40, y * 0.11 - 17, seed + 7);
    const cold = fbm(x * 0.035 - 90, y * 0.035 + 33, seed + 13);
    const civ = fbm(x * 0.09 + 300, y * 0.09 + 111, seed + 23);
    const h = hash(q, r, seed + 99);
    const pick = (list) => list[Math.floor(hash(q, r, seed + 5) * list.length)];

    let kind;
    if (e < 0.4) kind = h < 0.01 ? 'isle' : 'ocean';
    else if (e < 0.45) kind = 'calm';
    else if (e > 0.7) kind = cold > 0.52 || e > 0.76 ? 'snowpeak' : 'mountain';
    else if (e > 0.64) kind = m > 0.55 ? 'highlands' : 'hills';
    else if (m > 0.6) kind = cold > 0.55 ? 'pine' : 'forest';
    else if (m < 0.36) kind = 'scrub';
    else if (m > 0.55 && e < 0.53) kind = 'marsh';
    else kind = 'plains';

    // Settlements gather where the "civ" field runs high
    if (civ > 0.6) {
        if (kind === 'plains') {
            if (h < 0.035) kind = 'seat';
            else if (h < 0.2) kind = 'village';
            else if (h < 0.5) kind = 'farm';
        } else if (kind === 'forest' && h < 0.06) kind = 'woodhold';
        else if (kind === 'mountain' && h < 0.12) kind = 'fortress';
        else if (kind === 'hills' && h < 0.15) kind = 'mine';
    }

    const src = pick(SPRITES[kind]);
    if (cache.size > 6000) cache.clear();
    cache.set(key, src);
    return src;
}

/**
 * Start the backdrop on a canvas. Returns a stop() function.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {(ready:boolean)=>void} [opts.onReady] called once the sprites have loaded
 */
export function startTitleBackdrop(canvas, { onReady } = {}) {
    const ctx = canvas.getContext('2d');
    // A fresh realm each visit, but always open over land (the title sits on a coast or a kingdom, not mid-ocean)
    let seed = 1 + Math.floor(Math.random() * 9999);
    for (let tries = 0; tries < 200 && fbm(10 * 0.07, 5 * 0.866 * 0.07, seed) < 0.55; tries++) seed++;
    const images = new Map();
    const tileCache = new Map();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const shadowTex = cloudTexture({ size: 256, seed: 11, rgb: '6,10,22', lo: 0.45, hi: 0.8, base: 3 });
    const cloudTex = cloudTexture({ size: 256, seed: 29, rgb: '226,232,242', lo: 0.5, hi: 0.86, base: 3 });

    let dpr = 1, W = 0, H = 0, size = 48;
    const resize = () => {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = canvas.clientWidth || window.innerWidth;
        H = canvas.clientHeight || window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        size = Math.max(34, Math.min(66, W / 30));
    };
    resize();
    window.addEventListener('resize', resize);

    // Motes of light drifting up out of the land
    const motes = Array.from({ length: 46 }, (_, i) => ({
        x: hash(i, 1, seed), y: hash(i, 2, seed),
        v: 0.012 + hash(i, 3, seed) * 0.03,
        r: 0.6 + hash(i, 4, seed) * 1.8,
        ph: hash(i, 5, seed) * Math.PI * 2,
    }));

    // Load every sprite the realm can use
    const all = [...new Set(Object.values(SPRITES).flat())];
    let pending = all.length;
    let ready = false;
    for (const src of all) {
        const img = new Image();
        img.onload = img.onerror = () => {
            if (img.naturalWidth) images.set(src, img);
            if (--pending === 0) {
                ready = true;
                onReady?.(true);
                if (reduceMotion) frame(performance.now());
            }
        };
        img.src = src;
    }

    const start = performance.now();
    let raf = 0;
    let stopped = false;

    function drawLand(camX, camY) {
        const W3 = Math.sqrt(3) * size;   // hex width
        const rowH = W3 * 0.75;
        const spriteH = W3 * 1.5;          // 256×384 sprites scaled to hex width
        const r0 = Math.floor(camY / rowH) - 2;
        const r1 = Math.ceil((camY + H) / rowH) + 3;
        const q0 = Math.floor(camX / W3) - 2;
        const q1 = Math.ceil((camX + W) / W3) + 2;
        for (let r = r0; r <= r1; r++) {
            const off = (r & 1) === 0 ? W3 / 2 : 0;
            const sy = r * rowH - camY;
            for (let q = q0; q <= q1; q++) {
                const img = images.get(spriteFor(q, r, seed, tileCache));
                if (!img) continue;
                const sx = q * W3 + off - camX;
                ctx.drawImage(img, sx - W3 / 2, sy + size - spriteH, W3, spriteH);
            }
        }
    }

    function frame(now) {
        if (stopped) return;
        const t = (now - start) / 1000;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, W, H);

        if (ready) {
            // A slow aerial pass with a gentle sway
            const camX = t * 16 + Math.sin(t * 0.05) * 60;
            const camY = t * 7 + Math.cos(t * 0.04) * 40;
            drawLand(camX, camY);

            // Dusk grade
            ctx.fillStyle = 'rgba(8, 12, 28, 0.28)';
            ctx.fillRect(0, 0, W, H);

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            // Cloud shadows ride with the ground plus the wind
            drawCloudLayer(ctx, shadowTex, (-camX - t * 10) * dpr, (-camY - t * 4) * dpr, 4.2 * dpr, 0.55);
            // Low sun from the upper left
            const g = ctx.createRadialGradient(canvas.width * 0.18, -canvas.height * 0.1, 0, canvas.width * 0.18, -canvas.height * 0.1, canvas.width * 0.9);
            g.addColorStop(0, 'rgba(255, 196, 110, 0.28)');
            g.addColorStop(0.5, 'rgba(255, 170, 90, 0.08)');
            g.addColorStop(1, 'rgba(255, 170, 90, 0)');
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
            // High cloud passes nearer the eye, faster than the land
            drawCloudLayer(ctx, cloudTex, (-camX * 1.7 - t * 14) * dpr, (-camY * 1.7 - t * 5) * dpr, 5.5 * dpr, 0.32);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // Keep the centre quiet enough to read the title
        const plate = ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, Math.max(W, H) * 0.55);
        plate.addColorStop(0, 'rgba(8, 11, 20, 0.62)');
        plate.addColorStop(0.55, 'rgba(8, 11, 20, 0.3)');
        plate.addColorStop(1, 'rgba(8, 11, 20, 0.05)');
        ctx.fillStyle = plate;
        ctx.fillRect(0, 0, W, H);

        // Motes
        for (const m of motes) {
            const y = (((m.y - t * m.v) % 1) + 1) % 1;
            const x = m.x + Math.sin(t * 0.6 + m.ph) * 0.008;
            const a = 0.25 + 0.35 * Math.sin(t * 1.3 + m.ph) ** 2;
            ctx.fillStyle = `rgba(255, 214, 120, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x * W, y * H, m.r, 0, Math.PI * 2);
            ctx.fill();
        }

        if (!reduceMotion) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return function stop() {
        stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
    };
}
