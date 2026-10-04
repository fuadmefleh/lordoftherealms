// Kingdom cartography: court cartographers chart rival realms; charts win
// battles and pick war targets; the archive buys (and sometimes spots) your maps.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { KingdomAtlas } from '../world/kingdomAtlas.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Cartography } from '../systems/cartography.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function kingdom(id, extra = {}) {
    return {
        id, name: id.toUpperCase(), isAlive: true, capital: { q: 1, r: 1 },
        treasury: 0, wars: [], allies: [], relations: {}, traits: [],
        territory: [{ q: 1, r: 1 }], military: 100, population: 0, ...extra,
    };
}

function makeWorld(kingdoms, day = 0) {
    const tiles = new Map();
    return {
        width: 20, height: 20, day, kingdoms, events: [],
        getKingdom: (id) => kingdoms.find(k => k.id === id) || null,
        getTile(q, r) {
            if (r < 0 || r >= 20) return null;
            const key = `${q},${r}`;
            if (!tiles.has(key)) tiles.set(key, { q, r, terrain: { id: 'grassland', passable: true }, kingdom: null });
            return tiles.get(key);
        },
    };
}

describe('KingdomAtlas growth', () => {
    it('data config is loaded from cartography.json', () => {
        expect(KingdomAtlas.CONFIG.hireTreasury).toBe(5000);
        expect(KingdomAtlas.CONFIG.skillGrowth).toBeCloseTo(0.9);
    });

    it('a rich realm hires a cartographer, pays upkeep and an empty treasury dismisses him', () => {
        const a = kingdom('a', { treasury: 6000 });
        const world = makeWorld([a, kingdom('b')]);
        KingdomAtlas.processDay(a, world);
        expect(a.cartography.cartographerHired).toBe(true);
        expect(a.treasury).toBe(6000 - KingdomAtlas.CONFIG.hireCost);
        a.treasury = 0;
        KingdomAtlas.processDay(a, world);
        expect(a.cartography.cartographerHired).toBe(false);
    });

    it('an employed cartographer charts rivals deterministically, enemies at war first, without RNG draws', () => {
        const a = kingdom('a', { treasury: 1e6, wars: ['c'] });
        const world = makeWorld([a, kingdom('b'), kingdom('c')]);
        KingdomAtlas.ensure(a).cartographerHired = true;
        Utils.setSeed(5);
        const before = Utils.random();
        Utils.setSeed(5);
        let drawn = [];
        for (let d = 0; d < 200; d++) {
            world.day = d;
            const res = KingdomAtlas.processDay(a, world);
            if (res) drawn.push(res.subject.id);
        }
        expect(Utils.random()).toBe(before); // stream untouched
        expect(drawn[0]).toBe('c');
        expect(drawn).toContain('b');
        expect(a.cartography.mapsMade).toBe(drawn.length);
        expect(KingdomAtlas.getChart(a, 'c')).toBeTruthy();
        expect(KingdomAtlas.skill(a)).toBeGreaterThan(KingdomAtlas.CONFIG.baseSkill);
    });

    it('skill grows with maps drawn and explorer rulers; accuracy follows, capped', () => {
        const a = kingdom('a');
        KingdomAtlas.ensure(a);
        const acc0 = KingdomAtlas.chartAccuracy(a);
        a.cartography.mapsMade = 25;
        expect(KingdomAtlas.chartAccuracy(a)).toBeGreaterThan(acc0);
        const explorer = kingdom('e', { characterBonuses: { visionRadius: 0.2 } });
        KingdomAtlas.ensure(explorer);
        expect(KingdomAtlas.skill(explorer)).toBeCloseTo(KingdomAtlas.skill(kingdom('x', { cartography: { mapsMade: 0 } })) + 2);
        expect(KingdomAtlas.drawInterval(explorer)).toBeLessThan(KingdomAtlas.drawInterval(a));
        a.cartography.mapsMade = 10000;
        expect(KingdomAtlas.chartAccuracy(a)).toBe(KingdomAtlas.CONFIG.maxAccuracy);
    });

    it('the archive keeps one chart per realm, capped', () => {
        const a = kingdom('a');
        for (let i = 0; i < 12; i++) KingdomAtlas.recordChart(a, { kingdomId: `k${i}`, accuracy: 0.6, day: i });
        KingdomAtlas.recordChart(a, { kingdomId: 'k11', accuracy: 0.9, day: 20 });
        expect(a.cartography.mapsOwned.length).toBe(KingdomAtlas.CONFIG.maxCharts);
        expect(a.cartography.mapsOwned.filter(c => c.kingdomId === 'k11').length).toBe(1);
        expect(KingdomAtlas.getChart(a, 'k0')).toBeNull();
    });
});

describe('Charts at war', () => {
    it('a good chart raises battle power; lies lower it', () => {
        const a = kingdom('a');
        expect(KingdomAtlas.campaignMultiplier(a, 'b')).toBe(1);
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.95, day: 0 });
        expect(KingdomAtlas.campaignMultiplier(a, 'b')).toBeCloseTo(1 + KingdomAtlas.CONFIG.campaignBonus);
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.6, day: 1, lies: 3 });
        expect(KingdomAtlas.campaignMultiplier(a, 'b')).toBeLessThan(1);
    });

    it('simulateBattle: an even fight goes to the side that charted the enemy', () => {
        const run = (chart) => {
            Utils.setSeed(11);
            let wins = 0;
            for (let i = 0; i < 200; i++) {
                const a = kingdom('a', { territory: [{ q: 1, r: 1 }] });
                const b = kingdom('b', { territory: [{ q: 2, r: 1 }, { q: 3, r: 1 }], capital: { q: 3, r: 1 } });
                if (chart) KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.95, day: 0 });
                const world = makeWorld([a, b]);
                world.getTile(2, 1).kingdom = 'b';
                world.getTile(3, 1).kingdom = 'b';
                KingdomAI.simulateBattle(a, b, world);
                if (a.territory.length > 1) wins++;
            }
            return wins;
        };
        expect(run(true)).toBeGreaterThan(run(false));
    });

    it('considerWar marches on a charted rival', () => {
        const picks = new Set();
        for (let s = 1; s <= 20; s++) {
            Utils.setSeed(s);
            const a = kingdom('a', { military: 1000, relations: { b: -80, c: -80, d: -80 } });
            const ks = [a, kingdom('b'), kingdom('c'), kingdom('d')];
            KingdomAtlas.recordChart(a, { kingdomId: 'c', accuracy: 0.7, day: 0 });
            KingdomAI.considerWar(a, makeWorld(ks));
            for (const w of a.wars) picks.add(w);
        }
        expect([...picks]).toEqual(['c']);
    });

    it('redrawing a doctored chart exposes it and the archive distrusts the seller', () => {
        const a = kingdom('a');
        const world = makeWorld([a, kingdom('b')], 400);
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.6, day: 0, lies: 2, source: 'player' });
        const res = KingdomAtlas.drawMap(a, world);
        expect(res.exposed).toBe(2);
        expect(KingdomAtlas.getChart(a, 'b').lies).toBe(0);
        expect(a.cartography.distrust).toBe(1);
        expect(world.events.some(e => /doctored/.test(e.text))).toBe(true);
    });
});

describe('Royal archive and the player', () => {
    const mapOf = (subject, extra = {}) => ({
        name: `Map of ${subject}`, type: 'kingdom', kingdomId: subject, accuracy: 0.8, value: 100,
        centerQ: 1, centerR: 1, deliberateErrors: [], ...extra,
    });

    it('pays for a better chart of a foreign realm, little for one it has, nothing for its own lands', () => {
        const a = kingdom('a');
        const world = makeWorld([a, kingdom('b')]);
        expect(Cartography.archiveOffer(mapOf('a'), a, world).price).toBe(0);
        const fresh = Cartography.archiveOffer(mapOf('b'), a, world);
        expect(fresh.improves).toBe(true);
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.9, day: 0 });
        const stale = Cartography.archiveOffer(mapOf('b'), a, world);
        expect(stale.improves).toBe(false);
        expect(stale.price).toBeLessThan(fresh.price);
        a.wars = ['b'];
        a.cartography.mapsOwned = [];
        expect(Cartography.archiveOffer(mapOf('b'), a, world).price).toBeGreaterThan(fresh.price);
    });

    it('selling an honest map files it as their chart and pays you', () => {
        const a = kingdom('a');
        const world = makeWorld([a, kingdom('b')], 9);
        const player = { gold: 0, maps: [mapOf('b')], skills: {}, reputation: {} };
        const res = Cartography.sellMapToArchive(player, 0, a, world);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(res.gold);
        expect(player.maps.length).toBe(0);
        expect(KingdomAtlas.getChart(a, 'b')).toMatchObject({ accuracy: 0.8, source: 'player', lies: 0, day: 9 });
    });

    it('a doctored map slips past a poor archive and plants its lies in their war maps', () => {
        const a = kingdom('a', { cartography: { mapsMade: 0 } });
        a.cartography.mapsMade = 0;
        const world = makeWorld([a, kingdom('b')]);
        const lies = [{ q: 1, r: 1, type: 'path' }, { q: 2, r: 2, type: 'path' }, { q: 3, r: 3, type: 'path' }];
        // Find a seed where a skill-1 archive misses the forgery
        let sold = null;
        for (let s = 1; s < 50 && !sold; s++) {
            Utils.setSeed(s);
            a.cartography = null;
            KingdomAtlas.ensure(a);
            const player = { gold: 0, maps: [mapOf('b', { deliberateErrors: lies })], skills: {}, reputation: {} };
            const res = Cartography.sellMapToArchive(player, 0, a, world);
            if (res.success) sold = res;
        }
        expect(sold.planted).toBe(3);
        expect(KingdomAtlas.campaignMultiplier(a, 'b')).toBeLessThan(1);
    });

    it('a skilled archive spots most forgeries: reputation and trust suffer', () => {
        const a = kingdom('a');
        KingdomAtlas.ensure(a).mapsMade = 100;
        expect(KingdomAtlas.spotChance(a, 3)).toBeGreaterThan(0.8);
        expect(KingdomAtlas.spotChance(a, 0)).toBe(0);
        const world = makeWorld([a, kingdom('b')]);
        let caught = 0;
        for (let s = 1; s <= 10; s++) {
            Utils.setSeed(s);
            const player = { gold: 0, maps: [mapOf('b', { deliberateErrors: [{ q: 1, r: 1, type: 'path' }, { q: 2, r: 2, type: 'path' }] })], skills: {}, reputation: {} };
            a.cartography.distrust = 0;
            const res = Cartography.sellMapToArchive(player, 0, a, world);
            if (res.caught) {
                caught++;
                expect(player.reputation.a).toBe(-15);
                expect(player.maps.length).toBe(1);
            }
        }
        expect(caught).toBeGreaterThan(5);
        a.cartography.distrust = KingdomAtlas.CONFIG.distrustLimit;
        expect(Cartography.archiveOffer(mapOf('b'), a, world).price).toBe(0);
    });

    it('a capital sells archive copies of its charts, and official maps match the atlas accuracy', () => {
        const a = kingdom('a');
        const b = kingdom('b', { capital: { q: 5, r: 5 } });
        const world = makeWorld([a, b]);
        KingdomAtlas.ensure(a).mapsMade = 49; // skill 1 + 0.9×7 = 7.3
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.85, day: 3 });
        const tile = { q: 1, r: 1, kingdom: 'a', settlement: { type: 'capital', name: 'Acity' } };
        Utils.setSeed(3);
        const offers = Cartography.getAvailableMapsForSale(tile, world);
        const official = offers.find(o => o.map.id === 'sale_kingdom_a');
        expect(official.map.accuracy).toBe(Math.round(KingdomAtlas.chartAccuracy(a) * 100) / 100);
        const copy = offers.find(o => o.map.fromArchive);
        expect(copy.map.kingdomId).toBe('b');
        expect(copy.map.accuracy).toBe(0.85);
        // Doctored charts are not copied out
        KingdomAtlas.recordChart(a, { kingdomId: 'b', accuracy: 0.85, day: 4, lies: 1 });
        expect(Cartography.getArchiveCopiesForSale(a, world)).toEqual([]);
    });
});
