// The world map's terrain kept in a canvas (ui/renderer/terrainCache.js): what a hex's
// signature notices, and that without a real canvas the terrain is drawn hex by hex.
// The label widths remembered (ui/textMeasure.js).
import { describe, it, expect } from 'vitest';
import { Renderer } from '../ui/renderer.js';
import { TILE_SIG_UNSEEN } from '../ui/renderer/terrainCache.js';
import { textWidth, clearTextWidths } from '../ui/textMeasure.js';

const R = Renderer.prototype;
const tile = (o = {}) => ({ explored: true, visible: true, terrain: { id: 'plains' }, ...o });

describe('terrain cache — hex signatures', () => {
    it('is the same for the same hex and never the unseen mark', () => {
        const self = { showTerritories: false };
        const a = R._tileSig.call(self, tile());
        expect(R._tileSig.call(self, tile())).toBe(a);
        expect(a).not.toBe(TILE_SIG_UNSEEN);
    });

    it('changes with what the terrain pass draws a hex from', () => {
        const self = { showTerritories: false };
        const base = R._tileSig.call(self, tile());
        for (const o of [
            { visible: false }, { explored: false }, { terrain: { id: 'forest' } },
            { hasRiver: true, riverDir: 2 }, { hasRoad: true }, { hasRoad: true, roadLinks: 5 },
            { hasRoad: true, roadTier: 'highway' }, { settlement: { name: 'x' } },
            { infrastructure: { id: 'stone_road' } }, { infrastructure: { id: 'stone_road', underConstruction: true } },
        ]) expect(R._tileSig.call(self, tile(o))).not.toBe(base);
        expect(R._tileSig.call(self, tile({ hasRiver: true, riverDir: 1 }))).not.toBe(R._tileSig.call(self, tile({ hasRiver: true, riverDir: 2 })));
    });

    it('counts the realm only while territories are shown', () => {
        expect(R._tileSig.call({ showTerritories: false }, tile({ kingdom: 1 }))).toBe(R._tileSig.call({ showTerritories: false }, tile({ kingdom: 2 })));
        expect(R._tileSig.call({ showTerritories: true }, tile({ kingdom: 1 }))).not.toBe(R._tileSig.call({ showTerritories: true }, tile({ kingdom: 2 })));
    });

    it('draws hex by hex without a real canvas (the tests\' stand-ins)', () => {
        const self = Object.create(R);
        Object.assign(self, { mapMode: 'normal', world: { width: 1, height: 1, tiles: [[tile()]] }, canvas: { width: 10, height: 10 }, camera: { zoom: 1 } });
        expect(self.drawTerrainCached({ canvas: self.canvas })).toBe(false);
    });
});

describe('remembered text widths', () => {
    it('measures once per font and text', () => {
        clearTextWidths();
        let measured = 0;
        const ctx = { font: '', measureText: (t) => { measured++; return { width: t.length * 7 }; } };
        expect(textWidth(ctx, '12px serif', 'Hello')).toBe(35);
        expect(textWidth(ctx, '12px serif', 'Hello')).toBe(35);
        expect(measured).toBe(1);
        expect(textWidth(ctx, '14px serif', 'Hello')).toBe(35);
        expect(measured).toBe(2);
    });
});
