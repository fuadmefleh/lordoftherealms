// Worlds since terrainGen 15 (Terrain._mineralFields, data/terrain.json mineralFields): what
// is mined (iron, coal, copper, silver, gold, gems, salt, oil) lies in a few ore fields, so
// one land has what another lacks and they trade; stone, timber, fish, farmland and herds
// stay everywhere. The hinterland's hidden veins and prospecting keep to the same fields.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { World } from '../world/world.js';
import { Hinterland } from '../world/hinterland.js';

const MINERALS = ['iron', 'coal', 'copper', 'silver', 'gold_ore', 'gems', 'salt', 'oil'];
const make = (gen, seed = 4711) => {
    const w = new World(120, 80);
    w.generate({ seed, kingdomCount: 6, terrainGen: gen, riverCount: 40 });
    return w;
};
const count = (w, id) => w.tiles.flat().filter(t => t.resource && t.resource.id === id).length;

let w14, w15;
beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    w14 = make(14);
    w15 = make(15);
});

describe('Ore fields (terrainGen 15)', () => {
    it('puts each mineral in clusters, not one here and one there', () => {
        const flat = w15.tiles.flat();
        for (const m of ['iron', 'coal', 'copper']) {
            const hexes = flat.filter(t => t.resource && t.resource.id === m);
            expect(hexes.length).toBeGreaterThan(5);
            const near = hexes.filter(t => hexes.some(o => o !== t && Hex.wrappingDistance(t.q, t.r, o.q, o.r, w15.width) <= 3)).length;
            expect(near / hexes.length).toBeGreaterThan(0.7);
        }
    });

    it('keeps the hard-rock minerals to a few places: far less of the hill country has iron or coal within reach', () => {
        const isOre = (w, t, ore, kindId) => {
            if (t.resource && t.resource.id === ore) return true;
            const k = !t.resource && Hinterland.kindFor(t, w);
            return !!k && (k === kindId || (Hinterland.kind(k) && Hinterland.kind(k).ore === ore));
        };
        // the hills and mountains with a hex of the ore within 2 (what a town there could dig)
        const reach = (w, ore, kindId) => {
            const hard = w.tiles.flat().filter(t => ['hills', 'mountain', 'highlands'].includes(t.terrain.id));
            const src = w.tiles.flat().filter(t => isOre(w, t, ore, kindId));
            return hard.filter(t => src.some(o => Hex.wrappingDistance(t.q, t.r, o.q, o.r, w.width) <= 2)).length / hard.length;
        };
        expect(reach(w15, 'iron', 'iron_mine')).toBeLessThan(reach(w14, 'iron', 'iron_mine') * 0.6);
        expect(reach(w15, 'coal', 'coal_pit')).toBeLessThan(reach(w14, 'coal', 'coal_pit') * 0.6);
    });

    it('finds hidden veins only inside their own fields', () => {
        for (const t of w15.tiles.flat()) {
            if (t.resource) continue;
            const k = Hinterland.kindFor(t, w15);
            const ore = k && Hinterland.kind(k) && Hinterland.kind(k).ore;
            if (ore) expect(t.ores[ore]).toBeGreaterThan(0);
        }
        // and prospecting near any town offers no mine whose ore is not in the hex
        for (const s of w15.getSettlementViews().slice(0, 10)) {
            for (const hx of Hinterland.prospectHexes(w15, s)) {
                const t = w15.getTile(hx.q, hx.r);
                for (const id of Object.keys(hx.weights)) {
                    const ore = Hinterland.kind(id) && Hinterland.kind(id).ore;
                    if (ore) expect(t.ores[ore]).toBeGreaterThan(0);
                }
            }
        }
    });

    it('gives each part of the world different minerals, so they have something to trade', () => {
        // (by thirds of the world's breadth: lands may touch, so compare regions, not bodies)
        const thirds = [0, 1, 2].map(i => new Set(w15.tiles.flat()
            .filter(t => Math.floor(t.q * 3 / w15.width) === i && t.resource && MINERALS.includes(t.resource.id))
            .map(t => t.resource.id)));
        // no third has every mineral, and some mineral is in one third and not another
        for (const l of thirds) expect(l.size).toBeLessThan(MINERALS.length);
        const differ = MINERALS.filter(m => thirds.some(l => l.has(m)) && thirds.some(l => !l.has(m)));
        expect(differ.length).toBeGreaterThan(2);
    });

    it('leaves stone, timber, fish and farmland everywhere as before', () => {
        expect(count(w15, 'timber')).toBeGreaterThan(count(w14, 'timber') * 0.85);
        expect(count(w15, 'stone')).toBeGreaterThanOrEqual(count(w14, 'stone') * 0.9);
        expect(count(w15, 'fish')).toBeGreaterThan(count(w14, 'fish') * 0.85);
        expect(count(w15, 'wheat')).toBeGreaterThan(count(w14, 'wheat') * 0.85);
    });

    it('scales its fields with the land: an Epic map has more of each, still in clusters', () => {
        const big = new World(350, 240);
        big.generate({ seed: 4711, kingdomCount: 16, terrainGen: 15, riverCount: 40 });
        for (const m of ['iron', 'coal']) expect(count(big, m)).toBeGreaterThan(count(w15, m) * 2);
    }, 120000);

    it('is the same world from the same seed, and older worlds carry no ore fields', () => {
        const sig = (w) => w.tiles.flat().map(t => (t.resource ? t.resource.id[0] : '-')).join('');
        expect(sig(make(15, 99))).toBe(sig(make(15, 99)));
        expect(w14.tiles.flat().some(t => t.ores)).toBe(false);
        expect(['copper', 'silver'].some(m => count(w14, m) > 0)).toBe(false);
    });
});

describe('Editor data saved in the browser', () => {
    it('cannot take away a resource added to the game after it was saved', () => {
        const res = DataLoader._gamedata.terrain.resources;
        const old = Object.fromEntries(Object.entries(res).filter(([k]) => k !== 'COPPER' && k !== 'SILVER'));
        old.IRON = { ...res.IRON, name: 'Bog Iron' };
        DataLoader._mergeEditorData({ terrain: { resources: old } });
        const now = DataLoader._gamedata.terrain.resources;
        expect(now.COPPER && now.COPPER.id).toBe('copper');
        expect(now.SILVER && now.SILVER.id).toBe('silver');
        expect(now.IRON.name).toBe('Bog Iron');
        now.IRON = res.IRON;
    });
});
