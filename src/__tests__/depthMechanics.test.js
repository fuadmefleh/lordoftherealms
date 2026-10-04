// Mechanics added so advertised bonuses have something to act on:
// property storage limits (Granary), administrative overhead (Writing) and
// diplomacy (skill + House Chancellor).

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Technology } from '../systems/technology.js';
import { House } from '../systems/house.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { SettlementServices } from '../player/settlementServices.js';

afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

function makePlayer(techs = [], extra = {}) {
    const p = {
        gold: 100000, q: 3, r: 4, properties: [], inventory: {}, reputation: {},
        skills: { commerce: 0, combat: 0, diplomacy: 0 }, ...extra,
    };
    Technology.initPlayer(p);
    p.technology.implemented = techs;
    return p;
}

function farmSetup(player) {
    const tile = { q: 3, r: 4, terrain: { id: 'plains', passable: true }, settlement: null, resource: null, hasRiver: false, playerProperties: null, playerProperty: null };
    const world = { tile, getTile: (q, r) => (q === 3 && r === 4 ? tile : null), width: 50 };
    expect(PlayerEconomy.buildProperty(player, 'FARM', tile, world).success).toBe(true);
    const farm = PlayerEconomy.findPropertyAt(tile, PlayerEconomy.PROPERTY_TYPES.FARM.id);
    farm.underConstruction = false;
    return { farm, world };
}

describe('property storage limits', () => {
    it('holds 100 goods per level, more with a Granary', () => {
        const prop = { level: 2 };
        expect(PlayerEconomy.getStorageCapacity(makePlayer(), prop)).toBe(200);
        expect(Technology.getStorageBonus(makePlayer(['granary_construction']))).toBeGreaterThan(0);
        expect(PlayerEconomy.getStorageCapacity(makePlayer(['granary_construction']), prop))
            .toBe(Math.floor(200 * (1 + Technology.getStorageBonus(makePlayer(['granary_construction'])))));
    });

    it('production beyond capacity is lost', () => {
        const player = makePlayer();
        const { farm, world } = farmSetup(player);
        const cap = PlayerEconomy.getStorageCapacity(player, farm);
        farm.storage = cap - 1;
        PlayerEconomy.produceGoods(player, world);
        expect(farm.storage).toBe(cap);
        expect(farm.wastedToday).toBeGreaterThan(0);
    });
});

describe('administrative overhead', () => {
    const props = (n) => Array.from({ length: n }, () => ({}));

    it('is free up to six properties, then grows 3% each, capped at +60%', () => {
        expect(PlayerEconomy.getAdministrationMultiplier(makePlayer([], { properties: props(6) }))).toBe(1);
        expect(PlayerEconomy.getAdministrationMultiplier(makePlayer([], { properties: props(10) }))).toBeCloseTo(1.12);
        expect(PlayerEconomy.getAdministrationMultiplier(makePlayer([], { properties: props(60) }))).toBeCloseTo(1.6);
    });

    it('Writing halves the overhead and raises upkeep accordingly', () => {
        const writer = makePlayer(['writing'], { properties: props(10) });
        expect(PlayerEconomy.getAdministrationMultiplier(writer)).toBeCloseTo(1.06);
        const p = makePlayer([], { properties: props(16) });
        expect(PlayerEconomy.getPropertyUpkeep(p, { upkeep: 10, level: 2 })).toBe(Math.round(20 * 1.3));
    });
});

describe('diplomacy', () => {
    it('scales reputation gains, not losses', () => {
        const p = makePlayer([], { skills: { diplomacy: 10 } });
        expect(PlayerEffects.reputationGainMultiplier(p)).toBeCloseTo(1.5);
        expect(PlayerEffects.scaleReputationGain(p, 10)).toBe(15);
        expect(PlayerEffects.scaleReputationGain(p, -10)).toBe(-10);
        expect(PlayerEffects.negotiationBonus(p)).toBeCloseTo(0.2);
    });

    it('tribute earns more standing for a skilled diplomat', () => {
        const novice = makePlayer([], { skills: { diplomacy: 0 } });
        const envoy = makePlayer([], { skills: { diplomacy: 10 } });
        const town = { type: 'town', kingdom: 'k1' };
        SettlementServices.payTribute(novice, town, 400);
        SettlementServices.payTribute(envoy, town, 400);
        expect(novice.reputation.k1).toBe(16);
        expect(envoy.reputation.k1).toBe(24);
    });

    it("a House Chancellor adds to effective diplomacy", () => {
        const p = makePlayer([], { skills: { diplomacy: 2 }, house: {} });
        vi.spyOn(House, 'getRoleBonuses').mockReturnValue({ diplomacyBonus: 3 });
        expect(PlayerEffects.effectiveDiplomacy(p)).toBe(5);
        expect(PlayerEffects.scaleReputationGain(p, 20)).toBe(25);
    });
});
