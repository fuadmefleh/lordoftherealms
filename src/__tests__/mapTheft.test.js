/**
 * Map theft (systems/mapTheft.js): named owners hashed from the town, odds
 * per mark, a caught thief jailed, a theft that worked remembered, found out
 * on later days on its own seeded stream (bounties, heat), and the
 * accusation when the player walks back into the owner's town.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { MapTheft } from '../systems/mapTheft.js';
import { Cartography } from '../systems/cartography.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld() {
    const tiles = new Map();
    const kingdom = { id: 'k1', name: 'Arden', capital: { q: 10, r: 10 }, territory: [] };
    const getTile = (q, r) => {
        const key = `${q},${r}`;
        if (!tiles.has(key)) {
            const water = q === 11 && r === 10;
            tiles.set(key, { q, r, kingdom: 'k1', terrain: { id: water ? 'coast' : 'plains', passable: !water }, settlement: null });
        }
        return tiles.get(key);
    };
    const w = { width: 60, height: 60, day: 20, generationParams: { seed: 3 }, units: [], kingdoms: [kingdom], getTile, getKingdom: (id) => (id === 'k1' ? kingdom : null) };
    w.getTile(10, 10).settlement = { name: 'Harbourwick', type: 'town', kingdom: 'k1', population: 900 };
    return w;
}

function makePlayer(over = {}) {
    return {
        name: 'Ash', q: 10, r: 10, gold: 500, actionPoints: 10, karma: 0, renown: 10, health: 100, charisma: 5, luck: 5,
        inventory: {}, reputation: { k1: 0 }, skills: { stealth: 3, diplomacy: 2, cartography: 1 }, maps: [],
        ...over,
    };
}

describe('marks', () => {
    it('a coastal town has a cartographer, a captain and the archive, named the same every time', () => {
        const world = makeWorld();
        const tile = world.getTile(10, 10);
        const p = makePlayer();
        const t = MapTheft.targets(p, world, tile);
        expect(t.map(x => x.id).sort()).toEqual(['archive', 'captain', 'cartographer']);
        expect(MapTheft.targets(p, world, tile).map(x => x.name)).toEqual(t.map(x => x.name));
        for (const x of t) {
            expect(x.chance).toBeGreaterThan(0);
            expect(x.chance).toBeLessThan(1);
        }
        // The archive is the hardest mark
        expect(t.find(x => x.id === 'archive').chance).toBeLessThan(t.find(x => x.id === 'cartographer').chance);
    });

    it('a theft that works yields maps, is remembered and the owner is on guard', () => {
        Utils.setSeed(5);
        const world = makeWorld();
        const tile = world.getTile(10, 10);
        const p = makePlayer({ skills: { stealth: 10, diplomacy: 2, cartography: 1 }, luck: 15 });
        let res;
        for (let i = 0; i < 20 && !(res && res.success); i++) {
            p.jailState = null;
            p.mapGrudges = [];
            res = MapTheft.steal(p, world, tile, 'cartographer');
        }
        expect(res.success).toBe(true);
        expect(p.maps.length).toBeGreaterThan(0);
        expect(p.maps[0].isStolen).toBe(true);
        expect(p.mapGrudges[0].status).toBe('unaware');
        expect(MapTheft.targets(p, world, tile).find(x => x.id === 'cartographer').can).toBe(false);
        Cartography.applyMap(p, p.maps[0], world);
    });

    it('caught in the act: jail in the town', () => {
        Utils.setRng(() => 0.5);
        const world = makeWorld();
        const p = makePlayer({ skills: { stealth: 1 } });
        const res = MapTheft.steal(p, world, world.getTile(10, 10), 'archive');
        expect(res.caught).toBe(true);
        expect(p.jailState).toBeTruthy();
        expect(p.jailState.offense).toBe('map theft');
        expect(p.jailState.settlement).toBe('Harbourwick');
    });
});

describe('the owner follows up', () => {
    function stolen(world, p, targetId, status = 'unaware') {
        p.mapGrudges = [{
            id: 'mg_1', ownerKey: `10,10:${targetId}`, targetId, owner: 'Master Aldric Vell', settlement: 'Harbourwick', q: 10, r: 10,
            kingdom: 'k1', mapIds: ['m1'], value: 50, day: 10, discoverDay: 12, discoverChance: 1, status,
        }];
        p.maps = [{ id: 'm1', name: 'Stolen Chart' }];
    }

    it('the captain finds out and posts a bounty; the archive brings heat too', () => {
        const world = makeWorld();
        const p = makePlayer({ q: 0, r: 0 });
        stolen(world, p, 'captain');
        const out = MapTheft.processDay(world, p);
        expect(out.notices.length).toBe(1);
        expect(p.mapGrudges[0].status).toBe('bounty');
        expect(p.gossip.bounties.some(b => b.grudgeId === 'mg_1')).toBe(true);
        const p2 = makePlayer({ q: 0, r: 0 });
        stolen(world, p2, 'archive');
        MapTheft.processDay(world, p2);
        expect(p2.underworld.heat.k1).toBeGreaterThan(0);
    });

    it('the follow-up draws from its own stream', () => {
        const world = makeWorld();
        const p = makePlayer({ q: 0, r: 0 });
        stolen(world, p, 'cartographer');
        p.mapGrudges[0].discoverChance = 0.5;
        Utils.setSeed(9);
        const before = Utils.random();
        Utils.setSeed(9);
        MapTheft.processDay(world, p);
        expect(Utils.random()).toBe(before);
    });

    it('the cartographer waits in his town: pay restitution and it is closed', () => {
        const world = makeWorld();
        const p = makePlayer();
        stolen(world, p, 'cartographer', 'discovered');
        const g = MapTheft.pendingAccusation(p, world);
        expect(g).toBeTruthy();
        const v = MapTheft.accusationView(p, world, g);
        expect(v.options.map(o => o.id)).toEqual(['pay', 'deny', 'bribe', 'flee']);
        const gold = p.gold;
        const out = MapTheft.answer(p, world, g.id, 'pay');
        expect(out.ok).toBe(true);
        expect(p.gold).toBe(gold - MapTheft.restitution(g));
        expect(p.maps.length).toBe(0);
        MapTheft.processDay(world, p);
        expect(p.mapGrudges.length).toBe(0);
    });

    it('walking off an accuser sends him to the watch', () => {
        const world = makeWorld();
        const p = makePlayer();
        stolen(world, p, 'cartographer', 'discovered');
        MapTheft.answer(p, world, 'mg_1', 'ignore');
        expect(p.mapGrudges[0].status).toBe('bounty');
        expect(p.gossip.bounties.length).toBe(1);
        expect(MapTheft.pendingAccusation(p, world)).toBeNull(); // not twice in a day
    });

    it('a failed denial lands you in jail', () => {
        Utils.setRng(() => 0.99);
        const world = makeWorld();
        const p = makePlayer();
        stolen(world, p, 'cartographer', 'discovered');
        const out = MapTheft.answer(p, world, 'mg_1', 'deny');
        expect(out.jailed).toBeGreaterThan(0);
        expect(p.jailState).toBeTruthy();
    });

    it('the steal and accusation scenes render without throwing', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const world = makeWorld();
        const p = makePlayer();
        const panels = [];
        const game = { player: p, world, endDay() {}, ui: { showCustomPanel: (t, h) => panels.push(h), hideCustomPanel() {}, showNotification() {}, updateStats() {} } };
        ActionMenu._pendingAP = 2;
        ActionMenu.attemptStealMap(game, world.getTile(10, 10));
        expect(game._scene.kind).toBe('steal_map');
        ActionMenu.sceneAct(game, 'cartographer');
        expect(game._scene).toBeNull();
        p.jailState = null;
        stolen(world, p, 'captain', 'bounty');
        const { checkMapAccusation } = await import('../ui/actionMenu/treasureScenes.js');
        expect(checkMapAccusation(game)).toBe(true);
        ActionMenu.sceneAct(game, 'flee');
        for (const h of panels) expect(h).not.toMatch(/undefined|NaN|\[object Object\]/);
    });
});
