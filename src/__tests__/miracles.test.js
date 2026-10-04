/**
 * Miracles — the six that used to spend karma and do nothing: Bountiful
 * Harvest, Divine Smite, Revelation, Holy Sanctuary, Resurrection and
 * Divine Plague. Targeted miracles must validate before karma is spent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { WorldUnit } from '../world/units.js';
import { SaveLoad } from '../systems/saveLoad.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makeWorld(size = 30) {
    const tiles = [];
    for (let r = 0; r < size; r++) {
        tiles.push([]);
        for (let q = 0; q < size; q++) {
            tiles[r].push({ q, r, terrain: { id: 'plains', passable: true }, regionId: 1, explored: false, visible: false });
        }
    }
    return {
        width: size,
        height: size,
        day: 10,
        tiles,
        units: [],
        events: [],
        getTile(q, r) {
            if (r < 0 || r >= size) return null;
            return tiles[r][((q % size) + size) % size];
        },
    };
}

function makePlayer(overrides = {}) {
    return {
        name: 'Ash', q: 15, r: 15, karma: 100, faith: 1, gold: 0,
        health: 50, maxHealth: 100, blessings: {}, reputation: {},
        religion: { followers: 0, influence: 0, buildings: [] },
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        army: [], colonies: [], allegiance: null,
        ...overrides,
    };
}

function hostile(type, q, r, strength) {
    const u = new WorldUnit(type, q, r);
    u.strength = strength;
    return u;
}

describe('miracle table', () => {
    it('all ten miracles are defined with the manual costs', () => {
        const costs = Object.fromEntries(Object.values(PlayerReligion.MIRACLES).map(m => [m.id, m.karmaCost]));
        expect(costs).toEqual({
            healing: 10, blessing: 15, protection: 20, conversion: 25, harvest: 12,
            smite: 30, revelation: 18, sanctuary: 22, resurrection: 40, plague: 35,
        });
    });
});

describe('Bountiful Harvest', () => {
    it('triples farm production for 3 days, then fades', () => {
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'HARVEST', makeWorld());
        expect(res.success).toBe(true);
        expect(player.karma).toBe(88);
        expect(PlayerEffects.farmProductionMultiplier(player)).toBe(3);
        for (let d = 0; d < 3; d++) PlayerReligion.updateBlessings(player);
        expect(PlayerEffects.farmProductionMultiplier(player)).toBe(1);
    });
});

describe('Divine Smite', () => {
    it('destroys the nearest hostile unit in range', () => {
        Utils.setSeed(7);
        const world = makeWorld();
        const far = hostile('raider', 17, 15, 10);
        const near = hostile('raider', 16, 15, 10);
        const caravan = new WorldUnit('caravan', 15, 15);
        world.units.push(far, near, caravan);
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'SMITE', world);
        expect(res.success).toBe(true);
        expect(res.target).toBe(near);
        expect(near.destroyed).toBe(true);
        expect(far.destroyed).toBe(false);
        expect(caravan.destroyed).toBe(false);
        expect(player.karma).toBe(70);
    });

    it('cripples a unit too strong to destroy outright', () => {
        Utils.setSeed(7);
        const world = makeWorld();
        const giant = hostile('monster', 14, 15, 200);
        world.units.push(giant);
        const res = PlayerReligion.performMiracle(makePlayer(), 'SMITE', world);
        expect(res.success).toBe(true);
        expect(giant.destroyed).toBe(false);
        expect(giant.strength).toBeLessThanOrEqual(80);
        expect(giant.strength).toBeGreaterThan(0);
    });

    it('is reproducible under a fixed seed', () => {
        const run = () => {
            Utils.setSeed(42);
            const world = makeWorld();
            const u = hostile('monster', 15, 16, 90);
            world.units.push(u);
            PlayerReligion.performMiracle(makePlayer(), 'SMITE', world);
            return u.strength;
        };
        expect(run()).toBe(run());
    });

    it('fails without spending karma when no enemy is within 3 hexes', () => {
        const world = makeWorld();
        world.units.push(hostile('raider', 25, 15, 10));
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'SMITE', world);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/No enemy/);
        expect(player.karma).toBe(100);
    });
});

describe('Revelation', () => {
    it('explores and reveals every tile within 10 hexes', () => {
        const world = makeWorld();
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'REVELATION', world);
        expect(res.success).toBe(true);
        expect(world.getTile(25, 15).explored).toBe(true);
        expect(world.getTile(15, 5).visible).toBe(true);
        expect(world.getTile(15, 15).explored).toBe(true);
        expect(world.getTile(26, 15).explored).toBe(false);
        expect(res.revealed).toBe(331); // 1 + 3·10·11 hexes
        expect(player.karma).toBe(82);
    });
});

describe('Holy Sanctuary', () => {
    it('consecrates the ground around the player for 5 days', () => {
        const world = makeWorld();
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'SANCTUARY', world);
        expect(res.success).toBe(true);
        expect(player.sanctuary).toEqual({ q: 15, r: 15, radius: 3, days: 5 });
        expect(PlayerReligion.isInSanctuary(player, 17, 15, world.width)).toBe(true);
        expect(PlayerReligion.isInSanctuary(player, 19, 15, world.width)).toBe(false);

        let expired = [];
        for (let d = 0; d < 5; d++) expired = PlayerReligion.updateBlessings(player);
        expect(expired).toContain('sanctuary');
        expect(player.sanctuary).toBeNull();
        expect(PlayerReligion.isInSanctuary(player, 15, 15, world.width)).toBe(false);
    });

    it('stops hostile units from hunting a player inside it', () => {
        const world = makeWorld();
        const player = makePlayer();
        const raider = hostile('raider', 15, 17, 10);
        world.units.push(raider);

        PlayerReligion.performMiracle(player, 'SANCTUARY', world);
        Utils.setSeed(3);
        raider.updateRaider(world, player);
        expect(raider._pursuingPlayer).toBeFalsy();

        // Same raider, no sanctuary: an adjacent-range hunter always engages
        player.sanctuary = null;
        raider.q = 15; raider.r = 16;
        Utils.setSeed(3);
        raider.updateRaider(world, player);
        expect(raider.targetQ).toBe(15);
        expect(raider.targetR).toBe(15);
    });

    it('survives a save round-trip', () => {
        const player = makePlayer({ sanctuary: { q: 1, r: 2, radius: 3, days: 4 }, fallenUnits: [{ name: 'Militia', strength: 10 }] });
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(player)));
        expect(json.sanctuary).toEqual({ q: 1, r: 2, radius: 3, days: 4 });
        expect(json.fallenUnits).toEqual([{ name: 'Militia', strength: 10 }]);
    });
});

describe('Resurrection', () => {
    it('battle casualties are remembered, capped at 10', () => {
        Utils.setSeed(11);
        const army = [];
        for (let i = 0; i < 14; i++) army.push({ type: 'militia', name: `Militia ${i}`, strength: 1, level: 1, upkeep: 1, experience: 0 });
        const player = makePlayer({ army });
        PlayerMilitary.combat(player, 5000, 'Horde');
        const lost = 14 - player.army.length;
        expect(lost).toBeGreaterThan(0);
        expect(player.fallenUnits.length).toBe(Math.min(10, lost));
    });

    it('restores the most recently fallen unit at full strength', () => {
        const player = makePlayer({
            fallenUnits: [
                { name: 'Old Guard', icon: '🛡️', strength: 12 },
                { name: 'Knights', icon: '🐴', strength: 4, maxStrength: 30 },
            ],
        });
        const res = PlayerReligion.performMiracle(player, 'RESURRECTION', makeWorld());
        expect(res.success).toBe(true);
        expect(player.army).toHaveLength(1);
        expect(player.army[0].name).toBe('Knights');
        expect(player.army[0].strength).toBe(30);
        expect(player.fallenUnits).toHaveLength(1);
        expect(player.karma).toBe(60);
    });

    it('fails without spending karma when no one has fallen', () => {
        const player = makePlayer();
        const res = PlayerReligion.performMiracle(player, 'RESURRECTION', makeWorld());
        expect(res.success).toBe(false);
        expect(player.karma).toBe(100);
    });
});

describe('Divine Plague', () => {
    it('kills 30% of an adjacent enemy settlement, at a reputation and karma cost', () => {
        const world = makeWorld();
        const own = { name: 'Homeburg', population: 1000, kingdom: 'k1' };
        const enemy = { name: 'Varrholt', population: 2000, kingdom: 'k2' };
        world.getTile(15, 15).settlement = own;
        world.getTile(16, 15).settlement = enemy;
        const player = makePlayer({ allegiance: 'k1', reputation: { k2: 10 } });

        const res = PlayerReligion.performMiracle(player, 'PLAGUE', world);
        expect(res.success).toBe(true);
        expect(own.population).toBe(1000);
        expect(enemy.population).toBe(1400);
        expect(res.populationLost).toBe(600);
        expect(player.reputation.k2).toBe(10 - PlayerReligion.MIRACLE_CONFIG.plagueReputationLoss);
        expect(player.karma).toBe(100 - 35 - PlayerReligion.MIRACLE_CONFIG.plagueKarmaLoss);
        expect(world.events.length).toBe(1);
    });

    it("spares the player's own colonies and fails without spending karma", () => {
        const world = makeWorld();
        world.getTile(15, 15).settlement = { name: 'New Hope', population: 500, kingdom: null };
        const player = makePlayer({ colonies: [{ q: 15, r: 15 }] });
        const res = PlayerReligion.performMiracle(player, 'PLAGUE', world);
        expect(res.success).toBe(false);
        expect(res.reason).toMatch(/No enemy settlement/);
        expect(player.karma).toBe(100);
        expect(world.getTile(15, 15).settlement.population).toBe(500);
    });
});

describe('original miracles still work', () => {
    it('healing restores health without needing a world', () => {
        const player = makePlayer();
        expect(PlayerReligion.performMiracle(player, 'HEALING').success).toBe(true);
        expect(player.health).toBe(100);
        expect(player.karma).toBe(90);
    });
});
