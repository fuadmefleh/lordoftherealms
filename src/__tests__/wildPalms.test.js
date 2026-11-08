// Palms in the wild (world/innerMap/palms.js): round a desert's water, along
// the beaches, over the islands; never on the water, a road or a town's map,
// and the same palms each time the hex is generated.
import { describe, it, expect, beforeAll } from 'vitest';

let InnerMap;

beforeAll(async () => {
    // (the props' sheets "load" at once under the test runner)
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const N = 60;
/** Sand, with a pond in the middle (cells within 4 of the centre). */
function sands() {
    const tiles = [];
    for (let r = 0; r < N; r++) {
        tiles[r] = [];
        for (let q = 0; q < N; q++) {
            const pond = Math.hypot(q - 30, r - 30) <= 4;
            tiles[r][q] = { q, r, subTerrain: pond ? { id: 'water', passable: false } : { id: 'sand', passable: true }, _wet: pond };
        }
    }
    return tiles;
}
const palmsOf = (tiles) => tiles.flat().filter(t => t.customObject && /^tp_palm/.test(t.customObject.defId));

describe('wild palms', () => {
    it('a desert grows them round its water, and rarely out in the sand', () => {
        const tiles = sands();
        const n = InnerMap._plantPalms(tiles, { terrain: { id: 'desert' } }, 3, 4, 7);
        expect(n).toBeGreaterThan(0);
        const palms = palmsOf(tiles);
        // (by the trunk, the middle of the palm's bottom row; the open sand is far bigger than
        //  the oasis ring, so count how thick they stand, not how many)
        const near = (t) => Math.hypot(t.q + 1 - 30, t.r - 30) <= 10;
        const nearWater = palms.filter(near).length;
        const ringArea = Math.PI * (10 * 10 - 4 * 4), sandArea = N * N - Math.PI * 10 * 10;
        const thickNear = nearWater / ringArea, thickFar = (palms.length - nearWater) / sandArea;
        expect(nearWater).toBeGreaterThan(0);
        expect(thickNear).toBeGreaterThan(thickFar * 5);
        expect(palms.every(t => !t._wet)).toBe(true);
    });

    it('the same hex grows the same palms; an island is thick with them; grassland none', () => {
        const a = sands(), b = sands();
        InnerMap._plantPalms(a, { terrain: { id: 'island' } }, 9, 9, 1);
        InnerMap._plantPalms(b, { terrain: { id: 'island' } }, 9, 9, 1);
        expect(palmsOf(a).map(t => `${t.q},${t.r}`)).toEqual(palmsOf(b).map(t => `${t.q},${t.r}`));
        expect(palmsOf(a).length).toBeGreaterThan(20);
        expect(InnerMap._plantPalms(sands(), { terrain: { id: 'grassland' } }, 9, 9, 1)).toBe(0);
    });

    it('not on a town’s map', () => {
        expect(InnerMap._plantPalms(sands(), { terrain: { id: 'island' }, settlement: { name: 'Port' } }, 9, 9, 1)).toBe(0);
    });
});
