// Winter on the street map's object sprites (ui/spriteSnow.js): tents, market stalls, the
// well and a Guild Age landmark's belltower take snow on their roof band alone — not on the
// flags and poles above it, nor the goods, counter and walls below — kept to the sprite's
// own pixels, a dusting at level 1 and full cover at 3.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { snowWeight, snowPixels, cellSpan, objectSnowBand, SpriteSnow } from '../ui/spriteSnow.js';

const read = f => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data', f), 'utf8'));
const PROPS = read('townProps.json');
const SPIRES = read('townEras.json').art.spires;

/** An RGBA sprite w x h of one colour, `alpha` everywhere. */
function sprite(w, h, rgb, alpha = 255) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = alpha; }
    return d;
}
const lumAt = (d, w, x, y) => { const i = (y * w + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };

describe('snow on the object sprites', () => {
    it('lies over the roof band only, thinning toward its foot', () => {
        const band = [0.2, 0.6];
        expect(snowWeight(0.1, band, 3)).toBe(0);        // a flag over the tent
        expect(snowWeight(0.3, band, 3)).toBe(1);
        expect(snowWeight(0.58, band, 3)).toBeGreaterThan(0);
        expect(snowWeight(0.58, band, 3)).toBeLessThan(1);
        expect(snowWeight(0.7, band, 3)).toBe(0);        // the counter, the walls
        expect(snowWeight(0.3, band, 0)).toBe(0);        // no snow, none
        // a dusting keeps to the band's upper part; full cover reaches its foot
        expect(snowWeight(0.55, band, 1)).toBe(0);
        expect(snowWeight(0.55, band, 3)).toBeGreaterThan(0);
    });

    it('whitens the roof pixels, deeper at a higher level, never touching alpha or the empty pixels', () => {
        const w = 4, h = 10, red = [180, 40, 40];
        const one = sprite(w, h, red), three = sprite(w, h, red);
        // a transparent column: nothing to snow on
        for (let y = 0; y < h; y++) { one[(y * w + 3) * 4 + 3] = 0; three[(y * w + 3) * 4 + 3] = 0; }
        const rowF = y => (y + 0.5) / h;
        const n1 = snowPixels(one, w, h, 1, [0, 0.6], rowF);
        snowPixels(three, w, h, 3, [0, 0.6], rowF);
        expect(n1).toBeGreaterThan(0);
        expect(lumAt(one, w, 1, 2)).toBeGreaterThan(0.3 * 180 + 0.59 * 40 + 0.11 * 40);
        expect(lumAt(three, w, 1, 2)).toBeGreaterThan(lumAt(one, w, 1, 2));
        // the colour is drained toward a bluish white, not painted over flat
        const i = (2 * w + 1) * 4;
        expect(three[i + 2]).toBeGreaterThan(three[i + 1] - 1);
        expect(three[i]).toBeLessThan(255);
        // below the band, and the transparent column, untouched; alpha kept everywhere
        expect([...one.slice((8 * w + 1) * 4, (8 * w + 1) * 4 + 4)]).toEqual([...red, 255]);
        for (let y = 0; y < h; y++) {
            expect(one[(y * w + 3) * 4]).toBe(180);
            expect(one[(y * w + 1) * 4 + 3]).toBe(255);
        }
    });

    it('keeps a dark doorway mostly dark, and lies brightest along the top edge', () => {
        const w = 1, h = 8;
        const door = sprite(w, h, [12, 10, 8]);
        snowPixels(door, w, h, 3, [0, 1], y => (y + 0.5) / h, 1);
        expect(lumAt(door, w, 0, 4)).toBeLessThan(110);
        const roof = sprite(w, h, [120, 90, 60]);
        roof[3] = 0;   // the row above the roof is empty: row 1 is its top edge
        snowPixels(roof, w, h, 2, [0, 1], y => (y + 0.5) / h, 1);
        expect(lumAt(roof, w, 0, 1)).toBeGreaterThan(lumAt(roof, w, 0, 3));
    });

    it('snows a stall’s canopy cells, not its counter nor the goods set on it', () => {
        const def = { id: 'tp_stall', bounds: { minCol: 0, maxCol: 2, minRow: -4, maxRow: 0 } };
        const band = PROPS.snowRoofs.tp_stall;
        // (the canopy stands over the counter, rows -2 and -1 of five; the sheet's empty top above it)
        const span = cellSpan(def, { localRow: -2, sh: 32 }, band, 3);
        expect(span[0]).toBeCloseTo(0.4);
        expect(span[1]).toBeCloseTo(0.6);
        expect(cellSpan(def, { localRow: -1, sh: 32 }, band, 3)).not.toBeNull();
        expect(cellSpan(def, { localRow: -4, sh: 32 }, band, 3)).toBeNull();
        expect(cellSpan(def, { localRow: 0, sh: 32 }, band, 3)).toBeNull();
        // a ware drawn smaller on the counter
        expect(cellSpan(def, { localRow: -1, sh: 32, scale: 0.72 }, band, 3)).toBeNull();
    });

    it('names a roof band for the camp tents, the stall and the well, each a real prop', () => {
        const ids = new Set(PROPS.props.map(p => p.id));
        const S = PROPS.snowRoofs;
        for (const id of ['tp_stall', 'tp_well', ...PROPS.camps.dawn, ...PROPS.camps.colony]) expect(S[id], id).toBeTruthy();
        for (const [id, b] of Object.entries(S)) {
            expect(ids.has(id), id).toBe(true);
            expect(b[0]).toBeGreaterThanOrEqual(0);
            expect(b[1]).toBeGreaterThan(b[0]);
            expect(b[1]).toBeLessThanOrEqual(1);
        }
        // a fountain or a lamp has no roof
        expect(S.tp_fountain).toBeUndefined();
        expect(objectSnowBand({ id: 'tp_lamp_a' })).toBeNull();
    });

    it('gives every belltower style a cap band below its finial', () => {
        for (const style of SPIRES.styles) {
            const b = SpriteSnow.spireBand(SPIRES, style);
            expect(b, style).toBeTruthy();
            expect(b[0]).toBeGreaterThan(0);
            expect(b[1]).toBeLessThan(0.7);   // the tower's walls and its bell take none
        }
    });

    it('draws a cell plain with no snow, and keeps nothing for a cell out of the band', () => {
        const def = { id: 'tp_stall', bounds: { minRow: -4, maxRow: 0 } };
        expect(SpriteSnow.cell(def, { localRow: -2, sx: 0, sy: 0, sw: 32, sh: 32 }, null, 1, 0)).toBeNull();
        expect(SpriteSnow.cell({ id: 'tp_lamp_a', bounds: { minRow: -2, maxRow: 0 } }, { localRow: -2 }, null, 1, 3)).toBeNull();
    });
});
