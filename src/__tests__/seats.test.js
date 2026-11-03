/**
 * Lords' seats on the town map (world/innerMap/seats.js): manors and the
 * castle keep guards at their doors, are barred when nobody's home, turn the
 * player away by night or with a warrant; the castle has its own interior.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';

let InnerMap, DataLoader, Utils;

beforeAll(async () => {
    globalThis.HTMLImageElement = globalThis.HTMLImageElement || class {};
    globalThis.Image = class extends globalThis.HTMLImageElement {
        set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
        get src() { return this._src; }
    };
    const { loadData } = await import('./playtest/harness.js');
    await loadData();
    ({ InnerMap } = await import('../world/innerMap.js'));
    ({ DataLoader } = await import('../core/dataLoader.js'));
    ({ Utils } = await import('../core/utils.js'));
    const { CustomBuildings } = await import('../world/customBuildings.js');
    const { CustomObjects } = await import('../world/customObjects.js');
    CustomBuildings.reset(); await CustomBuildings.loadAll();
    CustomObjects.reset(); await CustomObjects.loadAll();
}, 120000);

function enter(type = 'capital', player = {}) {
    const settlement = { name: 'Kingsford', type, population: 9000, q: 5, r: 6, kingdom: 'k1' };
    const worldTile = { q: 5, r: 6, terrain: { id: 'grassland' }, elevation: 0.5, temperature: 0.5, moisture: 0.5, settlement };
    const world = {
        day: 1, season: 'Spring', baseYear: 853, generationParams: { seed: 31 }, activeEvents: [],
        getTile: () => worldTile, getSettlementViews: () => [settlement], getKingdom: () => null,
    };
    const game = { world, player, settlement };
    InnerMap.timeOfDay = 10;
    InnerMap.enter(game, 5, 6);
    InnerMap.timeOfDay = 10;
    return game;
}

const castleOf = () => InnerMap.buildings.find(b => b.type === 'castle');
const manorOf = () => InnerMap.buildings.find(b => b.type === 'manor');

beforeEach(() => {
    InnerMap.initialize(DataLoader._gamedata.innerMap || JSON.parse(fs.readFileSync('data/innerMap.json', 'utf8')));
    InnerMap._cache = {};
    InnerMap._interiorCache = {};
    Utils.setSeed(7);
});

describe('Lords\' seats', () => {
    it('a capital stands a castle, with a lord and four guards at its gate', () => {
        enter('capital');
        const c = castleOf();
        expect(c).toBeTruthy();
        expect(c.ownerId).not.toBeUndefined();
        const guards = InnerMap.seatGuards(c);
        expect(guards.length).toBe(4);
        for (const g of guards) {
            expect(InnerMap.getTile(g.q, g.r).subTerrain.passable).toBe(true);
            expect(Math.abs(g.r - c.r)).toBeLessThanOrEqual(3);
        }
        // The lord lives at his seat
        const lord = InnerMap.npcs.find(n => n.id === c.ownerId);
        expect(lord._home).toBe(c);
    });

    it('door guards keep their door instead of walking the beat', () => {
        enter('capital');
        const g = InnerMap.seatGuards(castleOf())[0];
        g.q = g.prevQ = g._doorPost.q + 3;
        InnerMap._townPickActivity(g);
        const end = g.path ? g.path[g.path.length - 1] : { q: g.q, r: g.r };
        expect(end).toEqual({ q: g._doorPost.q, r: g._doorPost.r });
    });

    it('a manor with nobody home is barred', () => {
        const game = enter('capital');
        const m = manorOf();
        expect(m).toBeTruthy();
        for (const n of InnerMap.whoIsHome(m)) n.state = 'idle';
        const v = InnerMap.seatEntry(m, game);
        expect(v.ok).toBe(false);
        expect(v.why).toMatch(/away|barred/);
        expect(InnerMap.enterBuilding(m, game)).toBe(false);
        expect(InnerMap._entryRefused.why).toMatch(/away|barred/);
        expect(InnerMap._insideBuilding).toBeFalsy();
    });

    it('guards admit by day, refuse by night or with a warrant; the holder always walks in', () => {
        const game = enter('capital');
        const c = castleOf();
        expect(InnerMap.seatEntry(c, game)).toMatchObject({ ok: true, why: 'admit' });
        InnerMap.timeOfDay = 23;
        expect(InnerMap.seatEntry(c, game)).toMatchObject({ ok: false, why: 'night' });
        InnerMap.timeOfDay = 10;
        game.player.gossip = { warrants: { k1: true } };
        expect(InnerMap.seatEntry(c, game)).toMatchObject({ ok: false, why: 'warrant' });
        game.player.throne = { ruling: { kingdomId: 'k1' } };
        expect(InnerMap.seatEntry(c, game).ok).toBe(true);
    });

    it('with its guards knocked down, a seat with someone home lets you in', () => {
        const game = enter('capital');
        const c = castleOf();
        InnerMap.timeOfDay = 23;
        for (const g of InnerMap.seatGuards(c)) g.state = 'unconscious';
        expect(InnerMap.seatEntry(c, game)).toMatchObject({ ok: true, why: 'unguarded' });
    });

    it('the castle inside: gatehouse, courtyard, keep with a throne, private rooms, a garrison and household', () => {
        const game = enter('capital');
        const c = castleOf();
        expect(InnerMap.enterBuilding(c, game)).toBe(true);
        expect(InnerMap.width).toBe(InnerMap.CASTLE_SIZE.width);
        const at = InnerMap.CASTLE_SPOTS.throne;
        expect(InnerMap.getTile(at.q, at.r)._furniture.type).toBe('throne');
        // The player stands in the gate passage, and can walk to the foot of the throne
        const path = InnerMap._findPath(InnerMap.playerInnerQ, InnerMap.playerInnerR, at.q, at.r + 1);
        expect(path && path.length).toBeGreaterThan(10);
        // The lord's rooms are a zone the guards keep
        let priv = 0;
        for (const row of InnerMap.tiles) for (const t of row) if (t._zone === 'castle_private') priv++;
        expect(priv).toBeGreaterThan(20);
        expect(InnerMap.zoneAllows('castle_private')).toBe(false);
        expect(InnerMap.zoneWarden('castle_private')).toBeTruthy();
        expect(InnerMap.zoneRule('castle_private').warn.length).toBeGreaterThan(0);
        expect(InnerMap.npcs.filter(n => n._castleGuard).length).toBeGreaterThanOrEqual(4);
        expect(InnerMap.npcs.filter(n => n._castleStaff).length).toBeGreaterThanOrEqual(4);
        // Out again, the town's folk are back
        expect(InnerMap.exitBuilding(game)).toBe(true);
        expect(InnerMap.npcs.some(n => n._castleFolk)).toBe(false);
    });
});
