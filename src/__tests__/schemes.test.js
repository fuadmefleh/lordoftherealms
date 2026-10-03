// Rival schemes: rival Houses hatch plots against the player's holdings,
// which can be revealed, countered, or strike.

import { describe, it, expect, afterEach } from 'vitest';
import { House } from '../systems/house.js';
import { Schemes } from '../systems/schemes.js';
import { Utils } from '../core/utils.js';

function makeWorld(day = 1) {
    const tiles = new Map();
    const world = {
        day,
        kingdoms: [
            { id: 'k1', name: 'Varr', isAlive: true, military: 500 },
            { id: 'k2', name: 'Osk', isAlive: true, military: 300 },
            { id: 'k3', name: 'Lune', isAlive: true, military: 100 },
        ],
        getTile: (q, r) => tiles.get(`${q},${r}`) || null,
        _tiles: tiles,
    };
    return world;
}

function makePlayer(world) {
    const player = {
        id: 'p1', lastName: 'Ashborne', gold: 1000, renown: 10,
        reputation: { k1: 0, k2: 0 }, properties: [], colonies: [], children: [],
    };
    House.initialize(player, world);
    House.seedRivals(player, world, 2);
    return player;
}

function addProperty(world, player, q, r, type, extra = {}) {
    const prop = { type, level: 2, storage: 30, ...extra };
    world._tiles.set(`${q},${r}`, { playerProperties: [prop] });
    player.properties.push({ q, r, type });
    return prop;
}

afterEach(() => House.resetBrain());

describe('Schemes', () => {
    it('only offers schemes the rival is angry enough for and that have a target', () => {
        const world = makeWorld();
        const player = makePlayer(world);
        expect(Schemes.eligibleTypes(player, world, 5)).toEqual([]);
        expect(Schemes.eligibleTypes(player, world, 25)).toEqual(['slander', 'theft']);
        addProperty(world, player, 1, 1, 'farm');
        expect(Schemes.eligibleTypes(player, world, 45)).toEqual(['slander', 'theft', 'sabotage', 'raid_property']);
        player.children.push({ id: 'c1', firstName: 'Ada', isAlive: true });
        expect(Schemes.eligibleTypes(player, world, 70)).toContain('assassin');
    });

    it('a hidden scheme strikes on its due day; sabotage halts the property', () => {
        Utils.setSeed(7);
        const world = makeWorld(10);
        const player = makePlayer(world);
        const prop = addProperty(world, player, 1, 1, 'farm');
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'sabotage');
        expect(scheme.revealed).toBe(false);
        expect(scheme.dueDay).toBeGreaterThanOrEqual(18);

        world.day = scheme.dueDay;
        const r = Schemes._resolve(player, world, scheme);
        expect(r.outcome).toBe('struck');
        expect(prop.sabotagedDays).toBe(12);
        expect(Schemes.active(player)).toHaveLength(0);
    });

    it('a raid downgrades the property and carries off its stock', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        const prop = addProperty(world, player, 1, 1, 'mine');
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'raid_property');
        Schemes._resolve(player, world, scheme);
        expect(prop.level).toBe(1);
        expect(prop.storage).toBe(0);
        expect(prop.sabotagedDays).toBe(20);
    });

    it('guarding requires a revealed plot and gold, and can foil it', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'theft');
        expect(Schemes.guard(player, world, scheme.id).success).toBe(false); // not revealed
        scheme.revealed = true;
        const res = Schemes.guard(player, world, scheme.id);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(960);

        // Force the guard roll to succeed.
        const orig = Utils.random;
        Utils.random = () => 0;
        try {
            const r = Schemes._resolve(player, world, scheme);
            expect(r.outcome).toBe('foiled');
        } finally { Utils.random = orig; }
        expect(player.gold).toBe(960);
    });

    it('slander cannot be guarded but can be bought off, cooling the feud', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        player.house.rivals.k1.feud = 40;
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'slander');
        scheme.revealed = true;
        expect(Schemes.guard(player, world, scheme.id).success).toBe(false);
        const cost = Schemes.bribeGoldCost(player, scheme);
        expect(Schemes.bribe(player, world, scheme.id, 'gold').success).toBe(true);
        expect(player.gold).toBe(1000 - cost);
        expect(player.house.rivals.k1.feud).toBe(25);
        expect(Schemes.active(player)).toHaveLength(0);
    });

    it('sending a spy needs an idle spy and is one attempt per plot', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        const scheme = Schemes.hatch(player, world, player.house.rivals.k1, 'slander');
        scheme.revealed = true;
        expect(Schemes.sendSpy(player, world, scheme.id).success).toBe(false);
        player.espionage = { spies: [{ name: 'Wren', status: 'idle', level: 1, loyalty: 60 }] };
        const orig = Utils.random;
        Utils.random = () => 0.99; // spy fails
        try {
            expect(Schemes.sendSpy(player, world, scheme.id)).toMatchObject({ success: true, foiled: false });
        } finally { Utils.random = orig; }
        expect(Schemes.sendSpy(player, world, scheme.id).success).toBe(false);
    });

    it('revealAll exposes hidden plots (counter-espionage)', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        Schemes.hatch(player, world, player.house.rivals.k1, 'slander');
        expect(Schemes.known(player)).toHaveLength(0);
        expect(Schemes.revealAll(player)).toHaveLength(1);
        expect(Schemes.known(player)).toHaveLength(1);
    });

    it('envy grows feud as the House rises', () => {
        const world = makeWorld(30);
        const player = makePlayer(world);
        player.house.prestige = 60;
        player.currentTitle = 'baron';
        expect(Schemes.envyAmount(player, world)).toBe(4);
        Schemes.processDaily(player, world);
        expect(player.house.rivals.k1.feud).toBe(4);
    });

    it('replaces a rival whose kingdom has fallen', () => {
        const world = makeWorld(5);
        const player = makePlayer(world);
        world.kingdoms[0].isAlive = false;
        const out = Schemes.processDaily(player, world);
        expect(out.replaced).toHaveLength(1);
        expect(player.house.rivals.k1).toBeUndefined();
        expect(player.house.rivals.k3).toBeDefined();
    });

    it('an aggrieved rival plots on cadence, and the brain picks the type', () => {
        Utils.setSeed(1);
        const world = makeWorld(Schemes.CONFIG.plotCadence);
        const player = makePlayer(world);
        player.house.rivals.k1.feud = 100;
        House.setBrain({ chooseScheme: () => 'theft' });
        const orig = Utils.random;
        Utils.random = () => 0.1;
        let out;
        try { out = Schemes.processDaily(player, world); } finally { Utils.random = orig; }
        expect(out.hatched).toMatchObject({ type: 'theft', rivalId: 'k1' });
    });

    it('rejects an off-menu brain choice', () => {
        const world = makeWorld(Schemes.CONFIG.plotCadence);
        const player = makePlayer(world);
        player.house.rivals.k1.feud = 25;
        House.setBrain({ chooseScheme: () => 'assassin' });
        const orig = Utils.random;
        Utils.random = () => 0.1;
        let out;
        try { out = Schemes.processDaily(player, world); } finally { Utils.random = orig; }
        expect(['slander', 'theft']).toContain(out.hatched.type);
    });

    it('schemes survive a House save/load round-trip', () => {
        const world = makeWorld(10);
        const player = makePlayer(world);
        Schemes.hatch(player, world, player.house.rivals.k1, 'slander');
        const data = House.serialize(player.house);
        const fresh = { id: 'p1', lastName: 'Ashborne' };
        House.deserialize(fresh, world, data);
        expect(Schemes.active(fresh)).toHaveLength(1);
        expect(fresh.house._nextSchemeId).toBe(2);
    });
});
