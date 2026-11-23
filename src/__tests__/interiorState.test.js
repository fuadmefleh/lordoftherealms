// Interiors by the hour, the season and what has happened (world/innerMap/interiorState.js,
// data/interiorState.json): a layer over the planned interior — fires lit and banked, candles,
// shutters, the table laid, a tavern's mugs, the marks of raids and fires, a town's fortunes,
// winter firewood and furs, feast garlands — deterministic, and taken off again leaving the
// plan as it was.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { InnerMap } from '../world/innerMap.js';
import { applyInteriorStateTo, revertInteriorState, interiorMarks, wealthTrend, inSpans } from '../world/innerMap/interiorState.js';
import { FurnitureActions } from '../player/furnitureActions.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}, 120000);

const SUMMER = 40, WINTER = 100, MIDWINTER = 105;

/** A planned interior, as interiors._generateInterior lays it. */
function plan(type, q = 3, r = 4, tier = null) {
    const base = InnerMap.INTERIOR_LAYOUTS[type];
    const kind = (DataLoader._gamedata.architecture.wealth.floors.work || []).includes(type) ? 'work' : 'home';
    const look = { wall: base.wall, floor: base.floor, tier, kind, tint: null };
    const key = `9,14_${type}_${q}_${r}`;
    const out = InnerMap._planInterior({ type, name: type, q, r }, key, base, look, null);
    if (tier === 'rich') InnerMap._addFinery(out.tiles, out.width, out.height, kind);
    InnerMap._joinPieces(out.tiles, out.width, out.height, { q: Math.floor(out.width / 2), r: out.height - 1 });
    InnerMap._decorateInterior(out.tiles, out.width, out.height, out.info);
    return { ...out, key, building: { type, name: type, q, r } };
}
const apply = (room, over = {}) => applyInteriorStateTo(room.tiles, room.width, room.height, { key: room.key, building: room.building, hour: 12, day: SUMMER, ...over });
const cells = (room) => room.tiles.flat();
const of = (room, type) => cells(room).filter(t => t._furniture && t._furniture.type === type);
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Everything on the tiles that the layer may touch, as a string. */
function snap(room) {
    return JSON.stringify(cells(room).map(t => [t._furniture ? { ...t._furniture } : null, t._decor || null, t._wallDecor || null, t._wallDecorFace || null,
        t._decorLit, t._wallDecorState, t._soot, t._garland, t.subTerrain && t.subTerrain.passable]));
}

/** Passable tiles reached from the door. */
function reached(room) {
    const { tiles, width: w, height: h } = room;
    const start = cells(room).find(t => t._isDoor) || { q: Math.floor(w / 2), r: h - 1 };
    const seen = new Set([`${start.q},${start.r}`]), queue = [[start.q, start.r]];
    while (queue.length) {
        const [q, r] = queue.shift();
        for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const t = tiles[r + dr] && tiles[r + dr][q + dq];
            if (!t || seen.has(`${q + dq},${r + dr}`) || !t.subTerrain.passable) continue;
            seen.add(`${q + dq},${r + dr}`); queue.push([q + dq, r + dr]);
        }
    }
    return seen;
}

describe('the hour', () => {
    it('spans run on past midnight', () => {
        expect(inSpans(23, [[22, 29]])).toBe(true);
        expect(inSpans(3, [[22, 29]])).toBe(true);
        expect(inSpans(12, [[22, 29]])).toBe(false);
    });

    it("a home's hearth: lit of a morning and evening, out by day, banked at night, lit all day in winter", () => {
        const room = plan('house');
        const fire = () => of(room, 'fireplace')[0]._furniture;
        expect(of(room, 'fireplace').length).toBeGreaterThan(0);
        apply(room, { hour: 7 }); expect(fire().lit).toBe(true);
        apply(room, { hour: 19 }); expect(fire().lit).toBe(true);
        apply(room, { hour: 13 }); expect(fire().lit).toBe(false); expect(fire().banked).toBeUndefined();
        apply(room, { hour: 1 }); expect(fire().lit).toBe(false); expect(fire().banked).toBe(true);
        apply(room, { hour: 13, day: WINTER, winter: true }); expect(fire().lit).toBe(true);
        // the player's own hearth is kept going
        apply(room, { hour: 1, ownHome: true }); expect(fire().lit).toBe(true);
        revertInteriorState(room.tiles);
        expect(fire().lit).toBeUndefined();
    });

    it("furniture actions: the fire is out when it's banked, warm when it's lit", () => {
        const room = plan('house');
        apply(room, { hour: 2 });
        const f = of(room, 'fireplace')[0]._furniture;
        const cold = FurnitureActions.check('warm', { furniture: f, player: {} });
        expect(cold.ok).toBe(false);
        expect(cold.reason).toMatch(/fire is out/i);
        apply(room, { hour: 18 });
        expect(FurnitureActions.check('warm', { furniture: of(room, 'fireplace')[0]._furniture, player: {} }).ok).toBe(true);
    });

    it("a tavern's fire burns all evening; a smithy's forge in working hours", () => {
        const tav = plan('tavern');
        apply(tav, { hour: 23 }); expect(of(tav, 'fireplace')[0]._furniture.lit).toBe(true);
        apply(tav, { hour: 1 }); expect(of(tav, 'fireplace')[0]._furniture.lit).toBe(true);
        apply(tav, { hour: 4 }); expect(of(tav, 'fireplace')[0]._furniture.lit).toBe(false);
        const smith = plan('blacksmith');
        apply(smith, { hour: 10, forgeHours: [[6, 19]] }); expect(of(smith, 'forge')[0]._furniture.lit).toBe(true);
        apply(smith, { hour: 22, forgeHours: [[6, 19]] }); expect(of(smith, 'forge')[0]._furniture.lit).toBe(false);
    });

    it('candles lit after dark, the shutters shut at night', () => {
        const room = plan('house', 5, 5, 'rich');
        const table = of(room, 'table')[0];
        table._decor = 'candles';
        apply(room, { hour: 20 });
        expect(table._decorLit).toBe(true);
        apply(room, { hour: 12 });
        expect(table._decorLit).toBe(false);
        const windows = cells(room).filter(t => t._wallDecor === 'window' || t._wallDecor === 'curtains');
        expect(windows.length).toBeGreaterThan(0);
        apply(room, { hour: 23 });
        expect(windows.every(t => t._wallDecorState === 'shut')).toBe(true);
        apply(room, { hour: 12 });
        expect(windows.some(t => t._wallDecorState === 'shut')).toBe(false);
    });

    it('the table laid at breakfast and supper, cleared after', () => {
        const room = plan('house');
        const before = snap(room);
        apply(room, { hour: 7 });
        expect(of(room, 'table').some(t => ids(t._decor).includes('bread'))).toBe(true);
        apply(room, { hour: 19 });
        expect(of(room, 'table').some(t => ids(t._decor).includes('plates') || ids(t._decor).includes('bowls'))).toBe(true);
        apply(room, { hour: 15 });
        revertInteriorState(room.tiles);
        expect(snap(room)).toBe(before);
    });

    it("a tavern's tables gather mugs as it fills of an evening, emptier of a morning", () => {
        const tav = plan('tavern', 7, 2);
        const mugs = () => cells(tav).filter(t => t._furniture && t._furniture.type === 'table' && ids(t._decor).includes('mugs')).length;
        apply(tav, { hour: 20 });
        const evening = mugs();
        apply(tav, { hour: 8 });
        const morning = mugs();
        expect(evening).toBeGreaterThan(morning);
        expect(morning).toBe(0);
        // (the crowd the scenes bring in drives it)
        apply(tav, { hour: 8, crowd: 1 });
        expect(mugs()).toBeGreaterThan(0);
    });
});

describe('what has happened', () => {
    /** A house that the raid reached (the raid takes a share of the town's houses). */
    function raided(day) {
        for (let i = 0; i < 40; i++) {
            const room = plan('house', i, 3, 'mid');
            const ctx = { key: room.key, building: room.building, day, settlement: { name: 'Oakby', lastRaidedDay: SUMMER - 2 } };
            if (interiorMarks(ctx).loot > 0) return { room, ctx };
        }
        return null;
    }

    it('a raid leaves broken furniture and stripped decor, fading over its days', () => {
        const hit = raided(SUMMER);
        expect(hit).not.toBeNull();
        const { room, ctx } = hit;
        const before = snap(room);
        const res = applyInteriorStateTo(room.tiles, room.width, room.height, { ...ctx, hour: 12 });
        expect(res.broken + res.removed).toBeGreaterThan(0);
        expect(cells(room).some(t => t._furniture && t._furniture.broken && /^Broken /.test(t._furniture.name))).toBe(true);
        // weeks later: gone
        const later = applyInteriorStateTo(room.tiles, room.width, room.height, { ...ctx, day: SUMMER + 60, hour: 12 });
        expect(later.broken + later.removed + later.stripped).toBe(0);
        revertInteriorState(room.tiles);
        expect(snap(room)).toBe(before);
        expect(interiorMarks({ ...ctx, day: SUMMER + 60 }).loot).toBe(0);
    });

    it('a rebuilt building is clean; a scorched one carries soot', () => {
        const { room, ctx } = raided(SUMMER);
        const fresh = applyInteriorStateTo(room.tiles, room.width, room.height, { ...ctx, hour: 12, outerBuilding: { rebuilt: SUMMER - 1 } });
        expect(fresh.broken + fresh.removed + fresh.stripped).toBe(0);
        const burnt = applyInteriorStateTo(room.tiles, room.width, room.height, { key: room.key, building: room.building, hour: 12, day: SUMMER, outerBuilding: { ruin: 'scorched' } });
        expect(burnt.soot).toBeGreaterThan(0);
        expect(cells(room).some(t => t._soot)).toBe(true);
        revertInteriorState(room.tiles);
        expect(cells(room).some(t => t._soot)).toBe(false);
    });

    it('a sack and a plague looting mark the houses too', () => {
        let sacked = 0, plagued = 0;
        for (let i = 0; i < 20; i++) {
            const b = { type: 'house', q: i, r: 2 };
            const s = { memory: { v: 1, seq: 1, marks: [{ id: 'm1', k: 'sack', d: SUMMER - 5 }] }, plague: { looted: { [`${i},2`]: SUMMER - 3 } } };
            const m = interiorMarks({ key: `k${i}`, building: b, day: SUMMER, settlement: s });
            if (m.why.includes('sack')) sacked++;
            if (m.why.includes('plague')) plagued++;
        }
        expect(sacked).toBeGreaterThan(10);
        expect(plagued).toBe(20);
    });

    it("a town gone poor strips its houses' finery; one grown rich adds to it", () => {
        let poorer = 0, richer = 0;
        for (let i = 0; i < 30; i++) {
            const room = plan('house', i, 9, 'rich');
            const poor = { name: 'Oakby', type: 'town', population: 300, economy: { gold: 10 }, buildWealth: { score: 0.85 } };
            const ctx = { key: room.key, building: room.building, day: SUMMER, hour: 12, settlement: poor };
            if (wealthTrend(ctx) < 0) {
                const res = applyInteriorStateTo(room.tiles, room.width, room.height, ctx);
                poorer += res.poorer;
            }
            const rich = { name: 'Oakby', type: 'city', population: 9000, economy: { gold: 90000 }, buildWealth: { score: 0.3 } };
            const ctx2 = { ...ctx, settlement: rich };
            if (wealthTrend(ctx2) > 0) richer += applyInteriorStateTo(room.tiles, room.width, room.height, ctx2).richer;
            revertInteriorState(room.tiles);
        }
        expect(poorer).toBeGreaterThan(0);
        expect(richer).toBeGreaterThan(0);
    });
});

describe('seasons and feasts', () => {
    it('winter stacks firewood by the hearths, never shutting a tile off from the door; furs on the beds', () => {
        let stacks = 0;
        for (const type of ['house', 'tavern', 'inn', 'manor']) {
            for (let i = 0; i < 6; i++) {
                const room = plan(type, i * 3, i + 1);
                const before = reached(room);
                const planned = of(room, 'firewood').length;
                const res = apply(room, { day: WINTER, winter: true, hour: 12 });
                stacks += res.firewood;
                const after = reached(room);
                for (const k of before) {
                    const [q, r] = k.split(',').map(Number);
                    const t = room.tiles[r][q];
                    if (t._furniture && t._furniture._seasonal) continue;
                    expect(after.has(k), `${type}@${i} ${k}`).toBe(true);
                }
                if (of(room, 'bed').length) expect(of(room, 'bed').every(t => t._furniture.furs)).toBe(true);
                revertInteriorState(room.tiles);
                expect(of(room, 'firewood').length).toBe(planned);
            }
        }
        expect(stacks).toBeGreaterThan(5);
        // no firewood in summer
        const room = plan('house');
        expect(apply(room).firewood).toBe(0);
    });

    it('feast days hang garlands and lay on extra food', () => {
        expect(InnerMap.interiorFeast(MIDWINTER, null)).toBe('midwinter');
        expect(InnerMap.interiorFeast(SUMMER + 1, null)).not.toBe('midwinter');
        let garlands = 0, food = 0;
        for (let i = 0; i < 6; i++) {
            const room = plan('house', i, 6);
            const res = apply(room, { day: MIDWINTER, winter: true, feast: 'midwinter', hour: 13 });
            garlands += res.garlands;
            food += res.feast;
            expect(cells(room).filter(t => t._garland).every(t => t._wallDecor === 'banner')).toBe(true);
        }
        expect(garlands).toBeGreaterThan(0);
        expect(food).toBeGreaterThan(0);
    });
});

describe('the layer itself', () => {
    it('is deterministic and leaves the plan as it was', () => {
        const a = plan('tavern', 4, 4, 'mid'), b = plan('tavern', 4, 4, 'mid');
        const base = snap(a);
        const ctx = { day: MIDWINTER, winter: true, feast: 'midwinter', hour: 20, settlement: { lastRaidedDay: MIDWINTER - 1 } };
        apply(a, ctx); apply(b, ctx);
        expect(snap(a)).toBe(snap(b));
        expect(snap(a)).not.toBe(base);
        // laid again (the hour turning back) it is the same, not piled on
        apply(a, { hour: 9 }); apply(a, ctx);
        expect(snap(a)).toBe(snap(b));
        revertInteriorState(a.tiles);
        expect(snap(a)).toBe(base);
        // and the planner, asked again, plans the same house
        expect(snap(plan('tavern', 4, 4, 'mid'))).toBe(base);
    });

    it('is laid on entering, again as the hour turns, and taken off on leaving', () => {
        const W = 12, H = 8, tiles = [];
        for (let r = 0; r < H; r++) { tiles[r] = []; for (let q = 0; q < W; q++) tiles[r][q] = { q, r, subTerrain: { id: 'grass', passable: true }, explored: true }; }
        Object.assign(InnerMap, { active: true, _insideBuilding: null, _outerMapState: null, tiles, width: W, height: H, buildings: [], roads: [], npcs: [], _interiorCache: {} });
        InnerMap.currentWorldTile = { q: 5, r: 6 };
        InnerMap._currentWorldTileRef = { q: 5, r: 6, settlement: { name: 'Oakby', type: 'town' } };
        InnerMap.worldDay = SUMMER;
        InnerMap.timeOfDay = 2;
        const house = { type: 'house', name: 'Cottage', q: 3, r: 4 };
        const g = { player: { technology: { researched: [], implemented: [] }, inventory: {} }, ui: { showNotification() {} } };
        expect(InnerMap.enterBuilding(house, g)).toBe(true);
        const fire = () => InnerMap.tiles.flat().find(t => t._furniture && t._furniture.type === 'fireplace')._furniture;
        expect(fire().lit).toBe(false);
        InnerMap.timeOfDay = 7;
        InnerMap.updateNPCs(0.016);
        expect(fire().lit).toBe(true);
        const inside = InnerMap.tiles;
        InnerMap.exitBuilding(g);
        expect(inside.flat().find(t => t._furniture && t._furniture.type === 'fireplace')._furniture.lit).toBeUndefined();
    });
});

beforeEach(() => { InnerMap._istate = null; });
