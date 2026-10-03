// Kingdoms at war with the player: ultimatums, war hosts, sieges, peace.

import { describe, it, expect } from 'vitest';
import { RealmWars } from '../systems/realmWars.js';
import { House } from '../systems/house.js';
import { WorldUnit } from '../world/units.js';
import { Utils } from '../core/utils.js';

function makeWorld(day = 10) {
    const tiles = new Map();
    const plains = { id: 'plains', passable: true };
    for (let q = 0; q < 12; q++) {
        for (let r = 0; r < 12; r++) tiles.set(`${q},${r}`, { q, r, terrain: plains });
    }
    const kingdom = { id: 'k1', name: 'Varr', isAlive: true, military: 1000, territory: [], population: 5000 };
    const enemySettlement = { name: 'Varrholt', q: 9, r: 9, kingdom: 'k1', population: 2000 };
    tiles.get('9,9').settlement = enemySettlement;
    return {
        day,
        width: 12,
        kingdoms: [kingdom],
        units: [],
        events: [],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        getKingdom: (id) => (id === 'k1' ? kingdom : null),
        getAllSettlements: () => [enemySettlement],
    };
}

function makePlayer(world) {
    const player = { id: 'p1', name: 'Ash', lastName: 'Ashborne', gold: 5000, reputation: { k1: 0 }, properties: [], colonies: [] };
    House.initialize(player, world);
    return player;
}

function addFarm(world, player, q, r, level = 1) {
    const prop = { type: 'farm', level, storage: 10 };
    world.getTile(q, r).playerProperties = [prop];
    player.properties.push({ q, r, type: 'farm' });
    return prop;
}

describe('RealmWars', () => {
    it('hostility combines bad reputation and rival feud; the liege is never hostile', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        player.reputation.k1 = -50;
        player.house.rivals = { k1: { kingdomId: 'k1', feud: 40 } };
        expect(RealmWars.hostility(player, world.kingdoms[0])).toBe(90);
        player.allegiance = 'k1';
        expect(RealmWars.hostility(player, world.kingdoms[0])).toBe(0);
    });

    it('a hostile kingdom issues an ultimatum, then declares war when it is ignored', () => {
        const world = makeWorld(RealmWars.CONFIG.checkCadence);
        const player = makePlayer(world);
        addFarm(world, player, 2, 2);
        player.reputation.k1 = -1000;
        const out = RealmWars.processDaily(player, world);
        expect(out.ultimatums).toHaveLength(1);
        const u = out.ultimatums[0];
        expect(u.tribute).toBe(800);

        world.day = u.dueDay;
        const later = RealmWars.processDaily(player, world);
        expect(later.declared).toHaveLength(1);
        expect(RealmWars.atWarWith(player, 'k1')).toBe(true);
    });

    it('paying tribute averts war and grants a truce', () => {
        const world = makeWorld(RealmWars.CONFIG.checkCadence);
        const player = makePlayer(world);
        addFarm(world, player, 2, 2);
        player.reputation.k1 = -1000;
        RealmWars.processDaily(player, world);
        const res = RealmWars.payTribute(player, world, 'k1');
        expect(res.success).toBe(true);
        expect(player.gold).toBe(4200);
        expect(RealmWars.ultimatums(player)).toHaveLength(0);
        world.day += RealmWars.CONFIG.checkCadence;
        expect(RealmWars.processDaily(player, world).ultimatums).toHaveLength(0);
    });

    it('a war host marches on the nearest holding and razes a level-1 property', () => {
        Utils.setSeed(3);
        const world = makeWorld(50);
        const player = makePlayer(world);
        addFarm(world, player, 7, 7);
        const war = RealmWars.declareWar(player, world, world.kingdoms[0]);
        world.day += RealmWars.CONFIG.hostCadence;
        const out = RealmWars.processDaily(player, world);
        expect(out.marching).toHaveLength(1);
        expect(world.kingdoms[0].military).toBe(940);
        const unit = world.units.find(u => u.type === 'war_host');
        expect(unit.strength).toBe(60);

        // March it home on its target.
        for (let i = 0; i < 5 && !(unit.q === 7 && unit.r === 7); i++) unit.update(world, player);
        expect([unit.q, unit.r]).toEqual([7, 7]);
        world.day += 1;
        const hit = RealmWars.processDaily(player, world);
        expect(hit.struck).toHaveLength(1);
        expect(player.properties).toHaveLength(0);
        expect(world.getTile(7, 7).playerProperties).toHaveLength(0);
        expect(war.score).toBe(RealmWars.CONFIG.scorePerHoldingLost);
        expect(unit.destroyed).toBe(true);
    });

    it('breaking a host raises the war score and allows demanding peace', () => {
        const world = makeWorld(50);
        const player = makePlayer(world);
        addFarm(world, player, 7, 7, 2);
        const war = RealmWars.declareWar(player, world, world.kingdoms[0]);
        world.day += RealmWars.CONFIG.hostCadence;
        RealmWars.processDaily(player, world);
        const unit = world.units.find(u => u.type === 'war_host');
        unit.destroyed = true;
        RealmWars.onHostDefeated(player, world, unit);
        expect(war.score).toBe(30);
        expect(RealmWars.demandPeace(player, world, 'k1').success).toBe(false);
        war.score = 60;
        const res = RealmWars.demandPeace(player, world, 'k1');
        expect(res.success).toBe(true);
        expect(RealmWars.atWarWith(player, 'k1')).toBe(false);
        expect(player.house.prestige).toBeGreaterThan(0);
    });

    it('hosts lost on save/load are re-spawned from their records', () => {
        const world = makeWorld(50);
        const player = makePlayer(world);
        addFarm(world, player, 2, 2);
        RealmWars.declareWar(player, world, world.kingdoms[0]);
        world.day += RealmWars.CONFIG.hostCadence;
        RealmWars.processDaily(player, world);
        const id = world.units[0].id;
        const saved = JSON.parse(JSON.stringify(player.realmWars));
        world.units = [];
        player.realmWars = saved;
        world.day += 1;
        RealmWars.processDaily(player, world);
        expect(world.units.some(u => u.id === id && u.type === 'war_host')).toBe(true);
    });

    it('a colony can be stormed and changes hands', () => {
        const world = makeWorld(50);
        const player = makePlayer(world);
        const tile = world.getTile(3, 3);
        tile.settlement = { name: 'Newhope', population: 100, colony: { isPlayerColony: true, loyalty: 50, garrisonStrength: 5 } };
        player.colonies.push({ q: 3, r: 3, name: 'Newhope' });
        const war = RealmWars.declareWar(player, world, world.kingdoms[0]);
        const rec = { id: 'h1', name: 'Varr War Host', q: 3, r: 3, targetQ: 3, targetR: 3, target: { kind: 'colony', q: 3, r: 3, name: 'Newhope' }, strength: 100 };
        war.hosts.push(rec);
        const unit = new WorldUnit('war_host', 3, 3, 3, 3);
        const text = RealmWars._strike(player, world, world.kingdoms[0], war, rec, unit);
        expect(text).toMatch(/storms/);
        expect(tile.settlement.kingdom).toBe('k1');
        expect(player.colonies).toHaveLength(0);
    });

    it('war ends when the enemy kingdom falls', () => {
        const world = makeWorld(50);
        const player = makePlayer(world);
        RealmWars.declareWar(player, world, world.kingdoms[0]);
        world.kingdoms[0].isAlive = false;
        const out = RealmWars.processDaily(player, world);
        expect(out.ended).toHaveLength(1);
        expect(RealmWars.atWarWith(player, 'k1')).toBe(false);
    });
});
