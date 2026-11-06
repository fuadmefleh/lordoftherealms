/**
 * Modern detail sheets — the LPC doors, windows, signs, emblems and props a
 * town is built from are repainted at 4x in the painted style, in their
 * original layout, under assets/modern/. Data keeps naming the original sheet
 * and its 32px cells; the loaders fetch the repaint and sheetScale() scales the
 * cell addresses by the width ratio.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { modernSheet, modernBaseWidth } from '../core/customSheets.js';
import { sheetScale } from '../ui/sheetScale.js';
import { DataLoader } from '../core/dataLoader.js';

const ROOT = path.resolve(__dirname, '..', '..');
const renderer = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'innerMapRenderer.json'), 'utf8'));
const GD = { innerMapRenderer: renderer };
const DOOR = 'assets/lpc/Structure/Doors/32x64px Doors/Doorframe A.png';

describe('modern detail sheets', () => {
    beforeEach(() => { DataLoader._gamedata = GD; });

    it('maps a listed sheet to its repaint and leaves others alone', () => {
        expect(modernSheet(DOOR, GD)).toBe('assets/modern/lpc/Structure/Doors/32x64px Doors/Doorframe A.png');
        expect(modernSheet('assets/lpc/Terrain/terrain_summer.png', GD)).toBe('assets/lpc/Terrain/terrain_summer.png');
        expect(modernSheet('custom/1_mud.png', GD)).toBe('custom/1_mud.png');
        expect(modernSheet(DOOR, null)).toBe(DOOR);
        expect(modernSheet(DOOR, { innerMapRenderer: {} })).toBe(DOOR);
    });

    it('every listed repaint exists, 4x its original, which has the listed width', () => {
        const list = renderer.modernSheets;
        const keys = Object.keys(list).filter(k => !k.startsWith('_'));
        expect(keys.length).toBeGreaterThan(10);
        for (const k of keys) {
            expect(fs.existsSync(path.join(ROOT, k)), k).toBe(true);
            const m = path.join(ROOT, modernSheet(k, GD));
            expect(fs.existsSync(m), m).toBe(true);
            // PNG width: bytes 16..19 of the IHDR
            const w = f => fs.readFileSync(f).readUInt32BE(16);
            expect(w(path.join(ROOT, k)), k).toBe(list[k]);
            expect(w(m), m).toBe(list[k] * 4);
        }
    });

    it('sheetScale scales a loaded repaint by its width over the original', () => {
        const src = 'http://localhost:8082/' + encodeURI(modernSheet(DOOR, GD));
        expect(modernBaseWidth(decodeURI(src), GD)).toBe(384);
        expect(sheetScale({ src, naturalWidth: 384 * 4 })).toBe(4);
        expect(sheetScale({ src: 'http://localhost:8082/' + encodeURI(DOOR), naturalWidth: 384 })).toBe(1);
    });
});
