/**
 * Goods on the inner map as pixel sprites, not emoji (ui/itemSprites.js,
 * data/itemSprites.json): every good resolves to a cell on a sheet that
 * exists and holds that rect; goods without a cell of their own fall back by
 * rule to a generic sack / crate / barrel / bundle / chest / basket; arms
 * keep their own picture; drawing fits the sprite and clips what is afloat.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let DataLoader, itemSpriteSource, itemSpriteKind, drawItemSprite, drawItemAfloat;

// A PNG's size, from its IHDR
const pngSize = (p) => {
    const b = fs.readFileSync(p);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

beforeAll(async () => {
    globalThis.Image = class {
        set src(v) { this._src = v; this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; }
        get src() { return this._src; }
    };
    ({ DataLoader } = await import('../core/dataLoader.js'));
    DataLoader._gamedata = DataLoader._gamedata || {};
    DataLoader._gamedata.itemSprites = JSON.parse(fs.readFileSync('data/itemSprites.json', 'utf8'));
    ({ itemSpriteSource, itemSpriteKind, drawItemSprite, drawItemAfloat } = await import('../ui/itemSprites.js'));
});

describe('item sprites', () => {
    it('every good has a sprite, inside a sheet that exists', () => {
        const econ = JSON.parse(fs.readFileSync('data/playerEconomy.json', 'utf8'));
        const goods = Object.values(econ.GOODS || {});
        expect(goods.length).toBeGreaterThan(100);
        const sizes = new Map();
        for (const g of goods) {
            const s = itemSpriteSource(g.id);
            expect(s, g.id).toBeTruthy();
            expect(fs.existsSync(s.src), s.src).toBe(true);
            if (!s.sw) continue; // a whole picture (arms)
            if (!sizes.has(s.src)) sizes.set(s.src, pngSize(s.src));
            const { w, h } = sizes.get(s.src);
            expect(s.sx >= 0 && s.sy >= 0 && s.sw > 0 && s.sh > 0, g.id).toBe(true);
            expect(s.sx + s.sw <= w && s.sy + s.sh <= h, `${g.id} in ${s.src}`).toBe(true);
        }
    });

    it('goods without their own cell fall back to a generic kind', () => {
        expect(itemSpriteKind('cabbage_seed')).toBe('sack');
        expect(itemSpriteKind('pelts')).toBe('bundle');
        expect(itemSpriteKind('honey')).toBe('barrel');
        expect(itemSpriteKind('gold')).toBe('chest');
        expect(itemSpriteKind('no_such_thing')).toBe('crate');
        const cfg = DataLoader._gamedata.itemSprites;
        expect(itemSpriteSource('goat_hide_nobody_drew')).toMatchObject({ sx: cfg.kinds.bundle[1], sy: cfg.kinds.bundle[2] });
        // the PixelLab-made goods: their own cell, a small thing scaled down
        expect(itemSpriteSource('pelts')).toMatchObject({ src: cfg.sheets.goods, sx: cfg.items.pelts[1] });
        expect(itemSpriteSource('enchanted_ring').scale).toBeLessThan(1);
        // its own cell wins over the rule
        expect(itemSpriteSource('wheat_seed')).toMatchObject({ sx: cfg.items.wheat_seed[1] });
    });

    it('arms with a picture of their own draw that picture whole', () => {
        expect(itemSpriteSource('iron_sword')).toMatchObject({ src: 'assets/items/arms/iron_sword.png', sw: 0 });
    });

    it('draws fitted to its box, foot on the ground; afloat, clipped at the waterline', () => {
        const calls = [];
        const ctx = new Proxy({ imageSmoothingEnabled: true, globalAlpha: 1 }, {
            get(t, k) { return k in t ? t[k] : (...a) => calls.push([k, ...a]); },
            set(t, k, v) { t[k] = v; return true; },
        });
        expect(drawItemSprite(ctx, 'bread', 100, 200, 30)).toBe(true);
        const d = calls.find(c => c[0] === 'drawImage');
        const [, , , , sw, sh, dx, dy, dw, dh] = d;
        expect(Math.max(dw, dh)).toBe(30);
        expect(dy + dh).toBe(200);
        expect(Math.abs(dx + dw / 2 - 100)).toBeLessThanOrEqual(1);
        expect(dw / dh).toBeCloseTo(sw / sh, 1);
        calls.length = 0;
        expect(drawItemAfloat(ctx, 'fish', 100, 200, 30)).toBe(true);
        expect(calls.filter(c => c[0] === 'clip').length).toBe(2); // above the line, and the ghost below
        expect(calls.filter(c => c[0] === 'drawImage').length).toBe(2);
    });
});
