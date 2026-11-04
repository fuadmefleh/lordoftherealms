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
        for (let d = 0; d < 120 * 25; d++) {
            world.advanceDay(null, {});
            if (world.day % 120 === 0) {
                const s = world.getAllSettlements();
                log.push(`y${world.year}: clans ${clans(world).length} villages ${s.filter(x => x.type === 'village').length} towns ${s.filter(x => x.type === 'town').length} realms ${world.kingdoms.filter(k => k.isAlive).length} roads ${roads(world)}`);
            }
        }
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
    }, 120000);

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
