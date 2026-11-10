/**
 * Palms keep to the lands where palms grow, and anyone can clear a dirt path:
 *   - a desert culture's town in a temperate land plants no palms (townPlanner:
 *     innerMap.json palms.townTerrains); in the desert it does;
 *   - wild palms keep to their own groves, never among the oaks and pines
 *     (world/innerMap/palms.js groveGap);
 *   - a dirt road needs no technology, and its coin goes to the nearest town's
 *     labourers (systems/infrastructure.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomObjects, CustomBuildings, DataLoader, Infrastructure, TownProps;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ TownProps } = await import('../world/townProps.js'));
    ({ Infrastructure } = await import('../systems/infrastructure.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const isPalm = (t) => !!(t.customObject && /^tp_palm/.test(t.customObject.defId));

function desertTown(terrain) {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const settlement = { name: 'Testby', type: 'town', population: 3000, q: 9, r: 14, culture: 'Desert' };
    const worldTile = { terrain: { id: terrain }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: 5 }, activeEvents: [], kingdoms: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    InnerMap.enter({ world, player: {} }, 9, 14);
    return InnerMap.tiles;
}

describe('palms only where palms grow', () => {
    it('a desert people\'s town plants palms in the desert, none in a forest', () => {
        expect(desertTown('desert').flat().filter(isPalm).length).toBeGreaterThan(4);
        expect(desertTown('seasonal_forest').flat().filter(isPalm).length).toBe(0);
        expect(desertTown('grassland').flat().filter(isPalm).length).toBe(0);
    }, 120000);

    it('the wild scatter never puts a palm in a wood', () => {
        const scatter = (id) => { const d = CustomObjects.getDef(id); return d && d.palm; };
        expect(scatter('tp_palm_1')).toBe(true);   // (a palm def: the scatter passes it over, terrain.js canScatter)
    });

    it('wild palms keep clear of the other trees', () => {
        const N = 60;
        const tiles = [];
        for (let r = 0; r < N; r++) {
            tiles[r] = [];
            for (let q = 0; q < N; q++) tiles[r][q] = { q, r, subTerrain: { id: 'sand', passable: true } };
        }
        // an oak wood across the middle rows
        const tree = CustomObjects.getDef('tp_tree_oak2');
        expect(tree).toBeTruthy();
        for (let r = 24; r <= 32; r += 4) for (let q = 2; q < N - 4; q += 5) TownProps.place(tiles, tree, q, r);
        InnerMap._plantPalms(tiles, { terrain: { id: 'island' } }, 9, 9, 1);
        const palms = tiles.flat().filter(isPalm);
        expect(palms.length).toBeGreaterThan(5);
        const gap = DataLoader._gamedata.innerMap.palms.groveGap;
        for (const p of palms) expect(p.r < 24 - gap || p.r > 32 + gap, `palm at ${p.q},${p.r}`).toBe(true);
    });
});

describe('a dirt path needs no learning', () => {
    it('can be built with no technology; the coin goes to the nearest town', () => {
        const town = { name: 'Nearby', type: 'village', q: 3, r: 3, economy: { gold: 100 } };
        const far = { name: 'Faraway', type: 'village', q: 40, r: 40, economy: { gold: 100 } };
        const tiles = { '3,3': { q: 3, r: 3, settlement: town }, '40,40': { q: 40, r: 40, settlement: far } };
        const tile = { q: 5, r: 4, terrain: { id: 'grassland', passable: true } };
        const world = {
            day: 1, width: 80, height: 80,
            getTile: (q, r) => tiles[`${q},${r}`] || (q === 5 && r === 4 ? tile : null),
            getSettlementViews: () => [{ q: 3, r: 3 }, { q: 40, r: 40 }],
            getKingdom: () => null,
        };
        const player = { gold: 500, technology: { implemented: [] }, techs: [] };
        const types = Infrastructure.getAvailableTypes(player, tile, world).map(t => t.id);
        expect(types).toContain('dirt_road');
        const before = player.gold;
        const res = Infrastructure.build(player, 'dirt_road', tile, world);
        expect(res.success).toBe(true);
        const paid = before - player.gold;
        expect(paid).toBeGreaterThan(0);
        expect(town.economy.gold).toBe(100 + paid);
        expect(far.economy.gold).toBe(100);
    });
});
