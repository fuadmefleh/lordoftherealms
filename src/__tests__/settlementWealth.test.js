// A town's wealth decides what its buildings are made of (world/settlementWealth.js,
// data/architecture.json `wealth` and each culture's `tiers`), and a building is
// inside what it is outside: its walls of its outside walls' stuff, its floor and
// furnishing of its wealth. The tiers change no plan: the same buildings stand in
// the same places, only their materials differ.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

let InnerMap, CustomBuildings, CustomObjects, DataLoader, SettlementWealth;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ CustomBuildings } = await import('../world/customBuildings.js'));
    ({ CustomObjects } = await import('../world/customObjects.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ SettlementWealth } = await import('../world/settlementWealth.js'));
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

const CULTURES = ['Imperial', 'Religious', 'Arcane', 'Woodland', 'Swamp', 'Nordic', 'Mountain', 'Nomadic', 'Desert', 'Maritime'];

function town(culture, settlementIn, gen = 6, q = 9, r = 14) {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    const settlement = { name: 'Testby', q, r, culture, ...settlementIn };
    const worldTile = { terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.55, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31, terrainGen: gen }, activeEvents: [], kingdoms: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    InnerMap.enter({ world, player: {} }, q, r);
    const buildings = [];
    for (const row of InnerMap.tiles) for (const t of row) {
        if (t.customBuilding) buildings.push({ q: t.q, r: t.r, def: CustomBuildings.getBuilding(t.customBuilding.defId) });
    }
    return { tiles: InnerMap.tiles, buildings, settlement };
}

const inside = (def) => {
    const room = InnerMap._generateInterior({ type: def.buildingType, name: def.name, q: 3, r: 4, _customDefId: def.id }, `w_${def.id}`);
    const flat = (room.tiles || room).flat();
    return {
        wall: flat.find(t => t.baseTerrain === 'wall')._wallMaterial,
        floor: flat.find(t => t.baseTerrain !== 'wall' && !t._isDoor).baseTerrain,
        furniture: flat.filter(t => t._furniture).map(t => t._furniture),
    };
};

describe('what a place can afford', () => {
    it('a hamlet is poor, a middling town middling, a great capital rich; the purse moves it', () => {
        const tier = s => SettlementWealth.tierOf(SettlementWealth.score(s));
        expect(tier({ type: 'village', population: 120 })).toBe('poor');
        expect(tier({ type: 'town', population: 1200 })).toBe('mid');
        expect(tier({ type: 'capital', population: 9000 })).toBe('rich');
        // (a village is never rich, however big; a capital never poor)
        expect(tier({ type: 'village', population: 100000, economy: { gold: 1e9 } })).not.toBe('rich');
        expect(tier({ type: 'capital', population: 50, economy: { gold: 0 } })).not.toBe('poor');
        const flush = SettlementWealth.score({ type: 'town', population: 1200, economy: { gold: 1200 * 16 } });
        const broke = SettlementWealth.score({ type: 'town', population: 1200, economy: { gold: 1200 * 0.25 } });
        expect(flush).toBeGreaterThan(broke);
    });

    it('no building outclasses its town by more than one tier', () => {
        // a poor village's core landmark (core + landmark + the best jitter) is middling at most
        for (let k = 0; k < 40; k++) {
            expect(SettlementWealth.buildingTier(0.34, { ring: 'core', landmark: true, key: `chapel${k}` })).not.toBe('rich');
        }
        expect(SettlementWealth.buildingTier(0.6, { ring: 'core', landmark: true, key: 'hall' })).toBe('rich');
    });

    it('a town keeps the wealth it was built with until it has been another tier for years', () => {
        const s = { type: 'town', population: 1200 };
        const first = SettlementWealth.standing(s, 10);
        s.population = 9000; s.type = 'capital';
        expect(SettlementWealth.standing(s, 20)).toBe(first);
        const days = SettlementWealth.rules().restampDays;
        expect(SettlementWealth.standing(s, 20 + days - 1)).toBe(first);
        expect(SettlementWealth.standing(s, 20 + days)).toBeGreaterThan(first);
    });
});

describe('each culture building as the poor, the middling and the rich build it', () => {
    it('every culture building has all three, on its own footprint', () => {
        for (const c of CULTURES) {
            const defs = ['house', 'tavern', 'church'].flatMap(t => CustomBuildings.getByCulture(c, t));
            expect(defs.length, c).toBeGreaterThan(0);
            for (const d of defs) {
                for (const tier of ['poor', 'mid', 'rich']) {
                    const v = CustomBuildings.tierVariant(d, tier);
                    expect(v.id, `${d.id} ${tier}`).toBe(`${d.id}~${tier}`);
                    expect(v.bounds).toEqual(d.bounds);
                    expect(v.meta).toEqual(d.meta);
                    expect(v.buildingType).toBe(d.buildingType);
                }
            }
            // (a tier never joins a pool a town draws from: its plan stays as it was)
            expect(CustomBuildings.getByCulture(c, 'house').some(d => d.tier)).toBe(false);
        }
    });

    it('thatch on the poor, wooden shingle on the middling, slate or tile on the rich; never thatch over dressed stone', () => {
        const kit = JSON.parse(fs.readFileSync('data/buildingKit.json', 'utf8')).kit;
        const flat = k => kit.roofs[k] && kit.roofs[k].kind === 'parapet';
        for (const c of CULTURES) {
            for (const d of CustomBuildings.getByCulture(c, 'house')) {
                const poor = CustomBuildings.tierVariant(d, 'poor');
                const mid = CustomBuildings.tierVariant(d, 'mid');
                const rich = CustomBuildings.tierVariant(d, 'rich');
                expect(poor.roof, poor.id).toMatch(/^(thatch|thatch_dark|turf)$/);
                if (!flat(mid.roof)) expect(mid.roof, mid.id).toMatch(/^shingle_/);
                if (!flat(rich.roof)) expect(rich.roof, rich.id).toMatch(/^(slate|clay)/);
                expect(poor.wall, poor.id).not.toMatch(/^(stone_|brick_)/);
                expect(rich.wall, rich.id).toMatch(/^(stone_|brick_|adobe_white|whitewash)/);
                // drawn of those stuffs: its wall cells on that wall's sheet
                const sheets = new Set(poor.layers.floor.map(x => x.sheetPath));
                expect([...sheets].some(p => p.includes(`walls_${poor.wall}.png`)), poor.id).toBe(true);
                expect([...sheets].some(p => p.includes(`roofs_${poor.roof}.png`)), poor.id).toBe(true);
            }
        }
    });
});

describe('a town stands in its wealth', () => {
    it('a poor village is all poor stuff; a rich capital mostly rich, its edge humbler', () => {
        const v = town('Mountain', { type: 'village', population: 120 });
        const vt = v.buildings.filter(b => b.def.culture).map(b => b.def.tier);
        expect(vt.length).toBeGreaterThan(3);
        expect(vt.every(t => t === 'poor')).toBe(true);
        expect(v.buildings.filter(b => b.def.tier === 'poor').every(b => b.def.roof.startsWith('thatch'))).toBe(true);
        const k = town('Mountain', { type: 'capital', population: 12000 });
        const kt = k.buildings.filter(b => b.def.culture).map(b => b.def.tier);
        expect(kt.filter(t => t === 'rich').length).toBeGreaterThan(kt.length / 2);
        expect(kt.includes('poor')).toBe(false);
    });

    it('wealth moves no building: the same plan, the same designs, in other stuff', () => {
        const plan = (s) => town('Woodland', s).buildings.map(b => `${(b.def._derivedFrom || b.def.id)}@${b.q},${b.r}`).sort().join(';');
        expect(plan({ type: 'town', population: 150 })).toBe(plan({ type: 'town', population: 9000, economy: { gold: 9000 * 20 } }));
    });

    it('since terrainGen 7 a poor town builds humbler houses than a rich one', () => {
        const tall = (t) => t.buildings.filter(b => b.def.buildingType === 'house').map(b => b.def.bounds.maxRow - b.def.bounds.minRow);
        const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
        const poor = town('Imperial', { type: 'town', population: 150 }, 7);
        const rich = town('Imperial', { type: 'town', population: 9000, economy: { gold: 9000 * 20 } }, 7);
        expect(avg(tall(poor))).toBeLessThan(avg(tall(rich)));
    });
});

describe('a poor square', () => {
    it('since terrainGen 7 a poor place draws water from a well, with no columns or street lamps', () => {
        const props = (t) => new Set(t.tiles.flat().filter(x => x.customObject).map(x => x.customObject.defId));
        const poor = props(town('Imperial', { type: 'village', population: 90 }, 7));
        expect(poor.has('tp_well')).toBe(true);
        expect([...poor].some(id => /fountain|column|lamp/.test(id))).toBe(false);
        const rich = props(town('Imperial', { type: 'capital', population: 9000 }, 7));
        expect(rich.has('tp_fountain')).toBe(true);
    });
});

describe('inside as outside', () => {
    it('the walls inside are the walls outside; the floor of the building\'s wealth', () => {
        const d = CustomBuildings.getByCulture('Woodland', 'house')[0];
        const poor = inside(CustomBuildings.tierVariant(d, 'poor'));
        expect(poor.floor).toBe('dirt_floor');
        expect(['adobe', 'logs', 'planks']).toContain(poor.wall);
        const mid = inside(CustomBuildings.tierVariant(d, 'mid'));
        expect(mid.floor).toBe('wood_floor');
        expect(['timber', 'whitewash', 'plaster']).toContain(mid.wall);
        const rich = inside(CustomBuildings.tierVariant(d, 'rich'));
        expect(rich.floor).toBe('herringbone_floor');
        expect(['brick', 'stone']).toContain(rich.wall);
        // every outside wall of every tier has an inside face drawn
        const art = DataLoader._gamedata.innerMapRenderer.interiorArt.walls;
        for (const c of CULTURES) for (const t of ['house', 'tavern']) for (const b of CustomBuildings.getByCulture(c, t)) {
            for (const tier of ['poor', 'mid', 'rich']) {
                const v = CustomBuildings.tierVariant(b, tier);
                expect(art[InnerMap._insideWallOf(v.wall)], `${v.id}: ${v.wall}`).toBeTruthy();
            }
        }
    });

    it('a rich hall of a culture with its own floor; a workshop keeps its own', () => {
        const desert = CustomBuildings.getByCulture('Desert', 'house')[0];
        expect(inside(CustomBuildings.tierVariant(desert, 'rich')).floor).toBe('tile_floor');
        const smith = CustomBuildings.getByCulture('Mountain', 'blacksmith')[0];
        if (smith) expect(inside(CustomBuildings.tierVariant(smith, 'rich')).floor).toBe(InnerMap.INTERIOR_LAYOUTS.blacksmith.floor);
    });

    it('the poor sleep on straw without finery; the rich have more, and the way in stays open', () => {
        const d = CustomBuildings.getByCulture('Imperial', 'house')[0];
        const poor = inside(CustomBuildings.tierVariant(d, 'poor'));
        const mid = inside(CustomBuildings.tierVariant(d, 'mid'));
        const rich = inside(CustomBuildings.tierVariant(d, 'rich'));
        expect(poor.furniture.some(f => f.type === 'rug' || f.type === 'candle')).toBe(false);
        expect(poor.furniture.filter(f => f.type === 'bed').every(f => f.art === 'straw')).toBe(true);
        expect(rich.furniture.length).toBeGreaterThan(mid.furniture.length);
        expect(mid.furniture.length).toBeGreaterThan(poor.furniture.length);
        // every walkable tile still reached from the door
        const room = InnerMap._generateInterior({ type: 'house', name: 'h', q: 3, r: 4, _customDefId: CustomBuildings.tierVariant(d, 'rich').id }, 'w_rich_reach');
        const tiles = room.tiles || room, h = tiles.length, w = tiles[0].length;
        const start = { q: Math.floor(w / 2), r: h - 1 };
        const seen = new Set([`${start.q},${start.r}`]), queue = [start];
        while (queue.length) {
            const { q, r } = queue.shift();
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const t = tiles[r + dr] && tiles[r + dr][q + dq];
                if (!t || seen.has(`${q + dq},${r + dr}`) || !t.subTerrain.passable) continue;
                seen.add(`${q + dq},${r + dr}`); queue.push({ q: q + dq, r: r + dr });
            }
        }
        for (const row of tiles) for (const t of row) if (t.subTerrain.passable) expect(seen.has(`${t.q},${t.r}`), `${t.q},${t.r}`).toBe(true);
    });

    it('the inside wall carries the outside wall\'s own colour; timber framing keeps its own', () => {
        const wallTile = (def) => {
            const room = InnerMap._generateInterior({ type: def.buildingType, name: def.name, q: 3, r: 4, _customDefId: def.id }, `c_${def.id}`);
            return (room.tiles || room).flat().find(t => t.baseTerrain === 'wall');
        };
        const W = DataLoader._gamedata.architecture.wealth;
        const d = CustomBuildings.getByCulture('Woodland', 'house')[0];
        const poor = CustomBuildings.tierVariant(d, 'poor');
        expect(wallTile(poor)._wallTint).toBe(W.wallColours[poor.wall]);
        const timbered = CustomBuildings.getByCulture('Woodland', 'house').map(x => CustomBuildings.tierVariant(x, 'mid')).find(x => /^timber/.test(x.wall));
        if (timbered) expect(wallTile(timbered)._wallTint).toBeUndefined();
        // every kit wall has its colour
        const kit = JSON.parse(fs.readFileSync('data/buildingKit.json', 'utf8')).kit.walls;
        for (const k of Object.keys(kit)) expect(W.wallColours[k], k).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('a poor bath-house has a dirt floor, a rich one marble', () => {
        const b = CustomBuildings.getByCulture('Imperial', 'bathhouse')[0];
        if (!b) return;
        expect(inside(CustomBuildings.tierVariant(b, 'poor')).floor).toBe('dirt_floor');
        expect(inside(CustomBuildings.tierVariant(b, 'rich')).floor).toBe('marble_floor');
    });

    it('a building of an older save, without a tier, is inside as it always was', () => {
        expect(inside(CustomBuildings.getByCulture('Nordic', 'house')[0])).toMatchObject({ wall: 'siding_red', floor: 'wood_floor' });
    });
});
