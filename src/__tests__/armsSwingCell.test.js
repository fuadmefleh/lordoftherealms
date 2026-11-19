// A one-handed weapon's blows drawn whole (ui/innerMapCharacters.js HAND_PROPS / WIDE_CELL):
// the weapon sheets (scripts/make_arms_layers.py) are 128px cells round the 64px figure, and at
// the far end of a blow — the mace's head out at arm's length in Legacy - Swing's side-on
// frames — the weapon reaches past the 64px frame. A look that cropped every cell to 64px cut
// the head off and left a stick in the hand; the blows of a look with a hand weapon keep a
// 96px cell, which holds the whole weapon.
import fs from 'fs';
import zlib from 'zlib';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Arms } from '../systems/arms.js';

let C;
beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ({ InnerMapCharacters: C } = await import('../ui/innerMapCharacters.js'));
});

const ROOT = 'assets/lpc/Characters/';

/** An 8-bit RGBA, non-interlaced PNG's alpha: { w, h, a(x, y) }. */
function readAlpha(path) {
    const buf = fs.readFileSync(path);
    let off = 8, w = 0, h = 0, type = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const tag = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; expect(data[8]).toBe(8); expect(data[12]).toBe(0); }
        if (tag === 'IDAT') idat.push(data);
        off += 12 + len;
    }
    expect(type).toBe(6);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = 4, stride = w * bpp;
    const px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[y * stride + x - bpp] : 0;
            const b = y ? px[(y - 1) * stride + x] : 0;
            const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
            let v = src[x];
            if (f === 1) v += a;
            else if (f === 2) v += b;
            else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[y * stride + x] = v & 255;
        }
    }
    return { w, h, a: (x, y) => px[y * stride + x * bpp + 3] };
}

/** Opaque pixels of a 128px-cell weapon sheet outside the middle `win` px of each cell, per cell. */
function outside(path, win) {
    const s = readAlpha(path);
    const lo = (128 - win) / 2, hi = lo + win;
    const out = [];
    for (let r = 0; r < s.h / 128; r++) {
        for (let i = 0; i < s.w / 128; i++) {
            let n = 0;
            for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
                if (s.a(i * 128 + x, r * 128 + y) && (x < lo || x >= hi || y < lo || y >= hi)) n++;
            }
            out.push({ r, i, n });
        }
    }
    return out;
}

describe('a hand weapon\'s blows keep a wide cell', () => {
    const hand = () => Object.keys(Arms.config().items).filter(id => {
        const s = Arms.spriteOf(id);
        return s && s.layer && /^Props\//.test(s.layer) && !/Shield|Bow|Crossbow/.test(s.layer) && !C.LONG_PROPS.test(s.layer);
    });

    it('every one-handed weapon\'s layers are hand props: its blows composited at the wide cell', () => {
        const ids = hand();
        expect(ids).toEqual(expect.arrayContaining(['iron_mace', 'flanged_mace', 'iron_axe', 'iron_dagger', 'steel_arming_sword']));
        for (const id of ids) {
            const s = Arms.spriteOf(id);
            expect(C.HAND_PROPS.test(s.layer), s.layer).toBe(true);
            if (s.behind) expect(C.HAND_PROPS.test(s.behind), s.behind).toBe(true);
        }
        // a long weapon keeps its own 128px cell; shields are no hand weapon
        expect(C.HAND_PROPS.test('Props/Dane Axe/Iron')).toBe(false);
        expect(C.HAND_PROPS.test('Props/Shield 03 - Round Shield/Base')).toBe(false);
        expect([...C.WIDE_ANIMS].sort()).toEqual(['halfslash', 'slash', 'swing']);
    });

    it('the mace\'s head is past the 64px frame in the swing\'s side-on frames, and whole in the wide cell', () => {
        for (const metal of ['Bronze', 'Iron', 'Steel']) {
            const p = `${ROOT}Props/Mace/${metal}/Legacy - Swing.png`;
            // the blow at arm's length (frame 4), facing left and right: most of the mace past 64px
            const cut = outside(p, 64).filter(c => (c.r === 1 || c.r === 3) && c.i === 4);
            for (const c of cut) expect(c.n, `${metal} row ${c.r}`).toBeGreaterThan(30);
            // none of it past the wide cell
            for (const c of outside(p, C.WIDE_CELL)) expect(c.n, `${metal} row ${c.r} frame ${c.i}`).toBeLessThanOrEqual(2);
        }
    });

    it('the made weapons\' swing and slash fit the wide cell, front and behind', () => {
        for (const w of ['Mace', 'Axe', 'Dagger']) {
            for (const anim of ['Legacy - Swing', 'Combat 1h - Slash']) {
                for (const layer of [`${w}/Iron`, `${w}/_Behind/Iron`]) {
                    for (const c of outside(`${ROOT}Props/${layer}/${anim}.png`, C.WIDE_CELL)) {
                        expect(c.n, `${layer} ${anim} row ${c.r} frame ${c.i}`).toBeLessThanOrEqual(2);
                    }
                }
            }
        }
    });

    it('a look with a hand weapon composites its blows at the wide cell and the rest at 64px; drawn about the same middle', () => {
        const made = [];
        const spy = vi.spyOn(C, '_compositeAnimation').mockImplementation((layers, anim, w, h, cell) => {
            made.push({ anim, cell, w, h });
            return { anim, cell };
        });
        const pk = vi.spyOn(C, '_compositePicked').mockImplementation(() => null);
        try {
            const layers = Arms.lookLayers(C._presets && C._presets.male_guard ? C._presets.male_guard.layers
                : ['Body/Body 02 - Masculine, Thin/Peach', 'Props/Sword 01 - Arming Sword/Steel'], { main: 'iron_mace' });
            expect(layers.some(l => l.startsWith('Props/Mace/'))).toBe(true);
            C._compositePreset('__swingTest', { layers });
            const e = C._composited.get('__swingTest');
            expect(e.cell).toBe(64);
            expect(e.cells).toEqual({ slash: 96, halfslash: 96, swing: 96 });
            const of = (file) => made.find(m => m.anim === file);
            expect(of('Legacy - Swing').cell).toBe(96);
            expect(of('Legacy - Swing').w).toBe(6 * 96);
            expect(of('Combat 1h - Slash').cell).toBe(96);
            expect(of('Combat 1h - Halfslash').cell).toBe(96);
            expect(of('Walk').cell).toBe(64);
            expect(of('Idle').cell).toBe(64);
            expect(of('Sitting').cell).toBe(64);
            // drawn: the swing's 96px cell scaled about the 64px box's middle; the walk at 64
            const calls = [];
            const ctx = { drawImage: (...a) => calls.push(a) };
            e.swing = { w: 'swing' };
            e.walk = { w: 'walk' };
            C.drawCharacter(ctx, '__swingTest', 'swing', 1, 4.5 / 12, 100, 100, 64, 64);
            expect(calls[0].slice(1, 5)).toEqual([4 * 96, 96, 96, 96]);
            expect(calls[0].slice(5)).toEqual([84, 84, 96, 96]);
            C.drawCharacter(ctx, '__swingTest', 'walk', 1, 0, 100, 100, 64, 64);
            expect(calls[1].slice(1, 5)).toEqual([0, 64, 64, 64]);
            // an unarmed look stays at 64px throughout
            made.length = 0;
            C._compositePreset('__swingTest2', { layers: layers.filter(l => !l.startsWith('Props/')) });
            expect(C._composited.get('__swingTest2').cells).toBe(null);
            expect(made.every(m => m.cell === 64)).toBe(true);
        } finally {
            spy.mockRestore();
            pk.mockRestore();
            C._composited.delete('__swingTest');
            C._composited.delete('__swingTest2');
        }
    });
});
