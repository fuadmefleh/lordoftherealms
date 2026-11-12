// The Dawn of Man (world/dawn.js): a world begun before the dawn year has no
// realm, town or road — wandering clans that settle good ground, villages that
// grow into towns and bud new clans, and towns that gather villages into
// chiefdoms, until the world holds the realms it was made for.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { World } from '../world/world.js';
import { Dawn } from '../world/dawn.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Hex } from '../core/hex.js';
import { OutlawLairs } from '../systems/outlawLairs.js';

const W = 80, H = 60;
const GEN = { seed: 3131, kingdomCount: 4, startYear: 1, terrainGen: 3 };
const VERBOSE = !!(typeof process !== 'undefined' && process.env && process.env.DAWN_VERBOSE);

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function dawnWorld(gen = GEN) {
    Utils.setSeed(77);
    const world = new World(W, H);
    world.generate({ ...gen });
    return world;
}

const clans = (world) => world.units.filter(u => u.type === 'clan' && !u.destroyed);
const roads = (world) => world.tiles.flat().filter(t => t.hasRoad).length;

describe('a world begun at the dawn', () => {
    it('start years: 853 by default; before the dawn year is the dawn', () => {
        expect(Dawn.startYear({})).toBe(853);
        expect(Dawn.startYear({ startYear: 400 })).toBe(400);
        expect(Dawn.isDawnStart({})).toBe(false);
        expect(Dawn.isDawnStart({ startYear: 400 })).toBe(false);
        expect(Dawn.isDawnStart({ startYear: 1 })).toBe(true);
        expect(Dawn.isDawnStart({ startYear: 199 })).toBe(true);
    });

    it('a later start year only moves the calendar', () => {
        Utils.setSeed(5);
        const world = new World(W, H);
        world.generate({ seed: 3131, kingdomCount: 4, startYear: 500 });
        expect(world.baseYear).toBe(500);
        expect(world.year).toBe(500);
        expect(world.dawn).toBeNull();
        expect(world.kingdoms.length).toBe(4);
    });

    it('has no realm, town or road, only wandering clans — and a place for the player', () => {
        const world = dawnWorld();
        expect(world.year).toBe(1);
        expect(world.kingdoms).toEqual([]);
        expect(world.getAllSettlements()).toEqual([]);
        expect(roads(world)).toBe(0);
        expect(world.tiles.flat().some(t => t.improvement && ['ruins', 'shrine', 'monument'].includes(t.improvement.type))).toBe(false);
        expect(clans(world).length).toBeGreaterThanOrEqual(6);
        expect(world.playerStart).toBeTruthy();
        expect(world.tiles[world.playerStart.r][world.playerStart.q].terrain.passable).toBe(true);
        expect(Dawn.eraName(world)).toBe('the Dawn Age');
    });

    it('over the years clans settle, villages become towns, and chiefdoms become realms', () => {
        const world = dawnWorld();
        const log = [];
        const byYear = {};
        for (let d = 0; d < 120 * 50; d++) {
            world.advanceDay(null, {});
            if (world.day % 120 === 0) {
                const s = world.getAllSettlements();
                byYear[world.year] = { settlements: s.length, towns: s.filter(x => x.type !== 'village').length };
                log.push(`y${world.year}: clans ${clans(world).length} villages ${s.filter(x => x.type === 'village').length} towns ${s.filter(x => x.type === 'town').length} realms ${world.kingdoms.filter(k => k.isAlive).length} roads ${roads(world)}`);
            }
        }
        // The dawn unfolds over generations (data/dawn.json _pace): no town in the first decade,
        // the land far from full at year 12, still filling at year 30
        expect(byYear[10].towns).toBe(0);
        expect(byYear[12].settlements).toBeLessThan(byYear[40].settlements);
        expect(byYear[30].settlements).toBeLessThan(byYear[50].settlements + 1);
        if (VERBOSE) console.info(log.join('\n'));
        const st = world.dawn;
        expect(st.villagesFounded).toBeGreaterThan(5);
        expect(st.townsRisen).toBeGreaterThan(0);
        expect(st.realmsBorn).toBeGreaterThan(0);
        expect(roads(world)).toBeGreaterThan(0);
        for (const k of world.kingdoms) {
            expect(k.capital).toBeTruthy();
            expect(world.getTile(k.capital.q, k.capital.r).settlement.type).toBe('capital');
            expect(k.territory.length).toBeGreaterThan(0);
        }
    }, 400000);

    it('a village grows by its season\'s rate each season (checked every 30 days), tapering as it fills', () => {
        const world = dawnWorld();
        for (let d = 0; d < 120 * 2; d++) world.advanceDay(null, {});
        const live = world.getAllSettlements().map(s => world.getTile(s.q, s.r).settlement).find(s => s.dawnBorn && s.type === 'village');
        expect(live).toBeTruthy();
        const rate = Dawn.data().village.growthPerSeason;
        live.population = 200;
        Dawn._grow(world);
        // the full season's rate × (0.5…1.5) × the taper — not a third of it
        const taper = 1 - 200 / 1500;
        expect(live.population).toBeGreaterThanOrEqual(Math.floor(200 * (1 + rate * taper * 0.5)));
        expect(live.population).toBeLessThanOrEqual(Math.ceil(200 * (1 + rate * taper * 1.5)));
        live.population = 1500; // as much as a village can feed
        Dawn._grow(world);
        expect(live.population).toBe(1500);
    });

    it('a town standing alone for years becomes a realm of its own', () => {
        const world = dawnWorld();
        for (let d = 0; d < 120 * 2; d++) world.advanceDay(null, {});
        const K = Dawn.data().chiefdom;
        const radius = K.radius;
        const s = world.getAllSettlements().map(v => world.getTile(v.q, v.r)).find(t => t.settlement.dawnBorn && !t.kingdom);
        try {
            K.radius = 0; // no village near enough to gather
            s.settlement.type = 'town';
            s.settlement.founded = world.year - (K.minTownAgeYears + 1);
            const before = world.dawn.realmsBorn;
            Dawn._gatherRealms(world);
            expect(world.dawn.realmsBorn).toBe(before); // too young to stand alone
            s.settlement.founded = world.year - K.loneTownAgeYears;
            Dawn._gatherRealms(world);
            expect(world.dawn.realmsBorn).toBe(before + 1);
            expect(s.settlement.type).toBe('capital');
            expect(s.settlement.kingdom).toBeTruthy();
        } finally {
            K.radius = radius;
        }
    });

    it('no outlaw lair gathers round the free clan villages before the first realm', () => {
        const world = dawnWorld();
        for (let d = 0; d < 120 * 2; d++) world.advanceDay(null, {});
        expect(world.getAllSettlements().length).toBeGreaterThan(0);
        expect(world.kingdoms.filter(k => k.isAlive).length).toBe(0);
        expect(OutlawLairs.candidates(world, { lairs: [] })).toEqual([]);
    });

    it('is reproducible under a fixed seed', () => {
        const run = () => {
            const world = dawnWorld();
            for (let d = 0; d < 120 * 4; d++) world.advanceDay(null, {});
            return world.getAllSettlements().map(s => `${s.name}@${s.q},${s.r}`).join('|');
        };
        expect(run()).toBe(run());
    }, 60000);

    it('a save brings back the dawn, its villages and the paths between them', () => {
        const world = dawnWorld();
        for (let d = 0; d < 120 * 6; d++) world.advanceDay(null, {});
        const saved = JSON.parse(JSON.stringify(SaveLoad.serializeWorld(world)));
        const again = new World(W, H);
        again.generate(saved.generationParams);
        SaveLoad.restoreWorld(saved, again);
        expect(again.dawn).toEqual(world.dawn);
        expect(again.getAllSettlements().length).toBe(world.getAllSettlements().length);
        expect(roads(again)).toBe(roads(world));
        expect(again.kingdoms.map(k => k.id)).toEqual(world.kingdoms.map(k => k.id));
        expect(clans(again).length).toBe(clans(world).length);
    }, 60000);
});

describe('born into a clan at the dawn', () => {
    it('the player begins inside a wandering clan, with a father, a mother and siblings', async () => {
        const { newGame } = await import('./playtest/harness.js');
        const { Relationships } = await import('../systems/relationships.js');
        const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        const { player, world } = game;
        const clan = Dawn.kinClan(world, player);
        expect(clan).toBeTruthy();
        expect(clan.kinOfPlayer).toBe(true);
        expect([clan.q, clan.r]).toEqual([player.q, player.r]);
        // (a surname the player chose is kept; with none they are 'of the <clan>')
        expect(player.lastName).toBe('Harness');
        const kin = player.dawnKin.map(id => Relationships.getNPC(id));
        expect(kin.map(k => k.kin)).toEqual(expect.arrayContaining(['father', 'mother']));
        expect(kin.length).toBeGreaterThanOrEqual(3);
        for (const k of kin) {
            expect(k.dynasty).toBe(clan.clanName);
            expect(player.relationships[k.id].score).toBeGreaterThan(40);
        }
        expect(Relationships.getKnownNPCs(player).length).toBeGreaterThanOrEqual(kin.length);
    });

    it('the clan walks with the player, and makes camp for good where they choose', async () => {
        const { newGame } = await import('./playtest/harness.js');
        const { DawnBirth } = await import('../player/dawnBirth.js');
        const { Relationships } = await import('../systems/relationships.js');
        const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        const { player, world } = game;
        const clan = Dawn.kinClan(world, player);
        // The player walks two hexes off; the clan follows rather than wandering
        const start = world.getTile(player.q, player.r);
        const next = Hex.neighbors(player.q, player.r).map(n => world.getTile(n.q, n.r)).find(t => t && t.terrain.passable && t.regionId === start.regionId);
        player.q = next.q; player.r = next.r;
        world.advanceDay(player, {});
        expect([clan.q, clan.r]).toEqual([player.q, player.r]);
        expect(clan.destroyed).toBe(false);
        // Settle: find open ground near and make camp
        let ok = DawnBirth.canSettleHere(player, world) ? DawnBirth.settleHere(player, world) : { success: false };
        for (const h of Hex.hexesInRange(player.q, player.r, 3)) {
            if (ok.success) break;
            const t = world.getTile(h.q, h.r);
            if (!t || !t.terrain.passable || t.regionId !== start.regionId) continue;
            player.q = t.q; player.r = t.r; clan.q = t.q; clan.r = t.r;
            ok = DawnBirth.settleHere(player, world);
        }
        expect(ok.success).toBe(true);
        const home = world.getTile(player.q, player.r).settlement;
        expect(home && home.type).toBe('village');
        expect(home.playerKin).toBe(true);
        expect(clan.destroyed).toBe(true);
        expect(player.dawnClan).toBeNull();
        expect(player.dawnHome).toEqual({ q: player.q, r: player.r, name: home.name });
        for (const id of player.dawnKin) expect(Relationships.getNPC(id).settlementName).toBe(home.name);
        expect(DawnBirth.canSettleHere(player, world)).toBe(false);
    });

    it('a new life at the dawn is born into a clan too: its name, a family, the kin\'s pot', async () => {
        const { newGame } = await import('./playtest/harness.js');
        const { DawnBirth } = await import('../player/dawnBirth.js');
        const { Afterlife } = await import('../player/afterlife.js');
        const { Relationships } = await import('../systems/relationships.js');
        const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        const { player: old, world } = game;
        const oldClan = Dawn.kinClan(world, old);
        const oldKin = old.dawnKin.slice();
        // Every new life on offer is a child of a clan (or of a village a clan founded)
        const cands = Afterlife.candidates(world);
        expect(cands.length).toBeGreaterThan(0);
        for (const c of cands) {
            expect(c.dawn).toBeTruthy();
            expect(c.last).toMatch(/^of the /);
        }
        // Take one from another clan than the old life's, if there is one
        const cand = cands.find(c => c.dawn.clanId != null && c.dawn.clanId !== oldClan.id) || cands.find(c => c.dawn.clanId != null);
        expect(cand).toBeTruthy();
        Afterlife.begin(old, world, 'test');
        const res = Afterlife.becomeStranger(old, world, cand);
        expect(res.success).toBe(true);
        const p = res.player;
        const clan = Dawn.kinClan(world, p);
        expect(clan && clan.id).toBe(cand.dawn.clanId);
        expect(clan.kinOfPlayer).toBe(true);
        if (clan !== oldClan) expect(oldClan.kinOfPlayer).toBe(false);
        expect([p.q, p.r]).toEqual([clan.q, clan.r]);
        expect(p.lastName).toBe(`of the ${clan.clanName}`);
        expect(p.house.name).toContain(clan.clanName);
        const kin = p.dawnKin.map(id => Relationships.getNPC(id));
        expect(kin.map(k => k.kin)).toEqual(expect.arrayContaining(['father', 'mother']));
        for (const k of kin) {
            expect(oldKin).not.toContain(k.id);
            expect(k.dynasty).toBe(clan.clanName);
            expect(p.relationships[k.id].score).toBeGreaterThan(40);
        }
        expect(res.kin).toContain('your father');
        // ...and they feed their child at the camp
        p.inventory = {};
        expect(DawnBirth.kinHearth(p, world)).toBe('clan');
    });

    it('a new life in a dawn village a clan founded: kin at home there', async () => {
        const { DawnBirth } = await import('../player/dawnBirth.js');
        const { Player } = await import('../player/player.js');
        const { Relationships } = await import('../systems/relationships.js');
        const world = dawnWorld();
        const clan = clans(world)[0];
        const tile = world.getTile(clan.q, clan.r);
        Dawn.foundVillage(world, clan, tile);
        const p = new Player({ firstName: 'Wen', gender: 'female', age: 20 });
        Relationships.initialize(p);
        const res = DawnBirth.apply(p, world, { village: { q: tile.q, r: tile.r } });
        expect(res && res.village).toBe(tile.settlement);
        expect(p.dawnClan).toBeNull();
        expect(p.dawnHome).toEqual({ q: tile.q, r: tile.r, name: tile.settlement.name });
        expect(p.lastName).toBe(`of the ${clan.clanName}`);
        for (const id of p.dawnKin) expect(Relationships.getNPC(id).settlementName).toBe(tile.settlement.name);
        expect(DawnBirth.kinHearth(p, world)).toBe('home');
    });
});

describe('First Steps at the dawn', () => {
    it('a dawn start is guided by the clan, not the town; its steps tick as they are done', async () => {
        const { newGame } = await import('./playtest/harness.js');
        const { FirstSteps } = await import('../systems/firstSteps.js');
        const { DawnBirth } = await import('../player/dawnBirth.js');
        const game = newGame(808, { startYear: 1, terrainGen: 3, kingdomCount: 3 });
        const { player, world } = game;
        expect(player.firstSteps.set).toBe('dawn');
        const ids = FirstSteps.steps(player).map(s => s.id);
        expect(ids).toEqual(expect.arrayContaining(['clan_camp', 'make_camp', 'second_village']));
        expect(ids).not.toContain('market');
        player.dawnCampVisited = true;
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'clan_camp')).toBe(true);
        // make camp for good where the clan stands (or near)
        let ok = DawnBirth.settleHere(player, world);
        for (const h of Hex.hexesInRange(player.q, player.r, 3)) {
            if (ok.success) break;
            const t = world.getTile(h.q, h.r);
            if (!t || !t.terrain.passable) continue;
            const clan = Dawn.kinClan(world, player);
            player.q = t.q; player.r = t.r; clan.q = t.q; clan.r = t.r;
            ok = DawnBirth.settleHere(player, world);
        }
        expect(ok.success).toBe(true);
        FirstSteps.check(player, world);
        expect(FirstSteps.isDone(player, 'make_camp')).toBe(true);
        // a year-853 start keeps the town steps
        const later = newGame(808, { kingdomCount: 3 });
        expect(later.player.firstSteps.set).toBe('realms');
        expect(FirstSteps.steps(later.player).map(s => s.id)).toContain('market');
    });
});
