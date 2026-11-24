// Pixel icons in place of emoji (ui/pixelIcons.js): finding the mapped emoji
// in text (with or without FE0F, joined sequences, skin tones), splitting a
// line, and laying a canvas line out round them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PixelIcons } from '../ui/pixelIcons.js';

let saved;
beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
    saved = DataLoader._gamedata.pixelIcons;
    DataLoader._gamedata.pixelIcons = {
        sheet: 'assets/icons/pixel/icons.png', cell: 32, cols: 16,
        icons: { '⚔': 0, '💰': 1, '🏴‍☠': 2, '🏴': 3, '✋': 4 },
    };
    PixelIcons._reset();
    PixelIcons._build();
});
afterAll(() => {
    DataLoader._gamedata.pixelIcons = saved;
    PixelIcons._reset();
});

describe('finding the emoji', () => {
    it('finds a mapped emoji, with or without its variation selector', () => {
        expect(PixelIcons.has('⚔ War')).toBe(true);
        expect(PixelIcons.has('⚔️ War')).toBe(true);
        expect(PixelIcons.has('🍞 Bread')).toBe(false);
        expect(PixelIcons.has('plain words')).toBe(false);
    });

    it('splits a line into words and icons', () => {
        const parts = PixelIcons.split('Gold 💰 and ⚔️ war');
        expect(parts).toEqual(['Gold ', { emoji: '💰', cell: 1 }, ' and ', { emoji: '⚔️', cell: 0 }, ' war']);
    });

    it('takes a joined sequence whole before its first part', () => {
        const parts = PixelIcons.split('🏴‍☠️ Pirates and 🏴 rebels');
        expect(parts[0]).toEqual({ emoji: '🏴‍☠️', cell: 2 });
        expect(parts[2]).toEqual({ emoji: '🏴', cell: 3 });
    });

    it('swallows a skin tone after an emoji', () => {
        const parts = PixelIcons.split('✋\u{1F3FD} stop');
        expect(parts[0].cell).toBe(4);
        expect(parts[1]).toBe(' stop');
    });

    it('leaves an emoji with no icon as text', () => {
        expect(PixelIcons.split('🍞 Bread')).toEqual(['🍞 Bread']);
    });
});

describe('a canvas line', () => {
    /** A fake 2D context recording what is drawn; every character 6px wide. */
    function ctx(align = 'left', baseline = 'alphabetic') {
        const calls = [];
        return {
            font: '20px serif', textAlign: align, textBaseline: baseline, imageSmoothingEnabled: true, calls,
            drawImage: (...a) => calls.push(['img', ...a]),
        };
    }

    beforeAll(() => {
        PixelIcons._orig = {
            fillText(t, x, y) { this.calls.push(['fill', t, x, y, this.textAlign]); },
            strokeText(t, x, y) { this.calls.push(['stroke', t, x, y]); },
            measureText(t) { return { width: [...t].length * 6 }; },
        };
        PixelIcons._img = {};
    });

    it('draws the words left-aligned round the icon, which is a little over the font size', () => {
        const c = ctx('left', 'top');
        PixelIcons._drawLine(c, 'ab💰cd', 100, 50, false);
        const fills = c.calls.filter(k => k[0] === 'fill');
        const img = c.calls.find(k => k[0] === 'img');
        expect(fills.map(f => f[1])).toEqual(['ab', 'cd']);
        expect(fills[0][2]).toBe(100);
        // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
        expect(img[6]).toBe(112);              // after "ab"
        expect(img[7]).toBe(50);               // top baseline: the icon's top at y
        expect(img[8]).toBeCloseTo(22, 6);     // 20px font → 22px icon
        expect(fills[1][2]).toBeCloseTo(134, 6);
        expect(c.textAlign).toBe('left');
    });

    it('centres the whole line, icons included, and puts the alignment back', () => {
        const c = ctx('center', 'middle');
        PixelIcons._drawLine(c, '💰ab', 100, 50, false);
        const img = c.calls.find(k => k[0] === 'img');
        const w = 22 + 12;
        expect(img[6]).toBeCloseTo(100 - w / 2, 6);
        expect(img[7]).toBeCloseTo(50 - 11, 6);
        expect(c.textAlign).toBe('center');
    });

    it('a stroke outlines the words only, not the icons', () => {
        const c = ctx();
        PixelIcons._drawLine(c, 'ab💰', 0, 0, true);
        expect(c.calls.some(k => k[0] === 'img')).toBe(false);
        expect(c.calls.filter(k => k[0] === 'stroke').map(k => k[1])).toEqual(['ab']);
    });
});
