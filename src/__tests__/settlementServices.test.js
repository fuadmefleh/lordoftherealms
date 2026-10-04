/**
 * Settlement building services (blacksmith, temple, stable, guards, town hall)
 * and the formerly hollow player effects they sit beside: miracle blessings,
 * trade agreements, armour, cooked food and daily stamina.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { SettlementServices, SERVICE_CONFIG } from '../player/settlementServices.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { PlayerReligion } from '../player/playerReligion.js';
import { Player } from '../player/player.js';
import { Housing } from '../systems/housing.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const town = { name: 'Ashford', type: 'town', kingdom: 'k1' };

function makePlayer(overrides = {}) {
    return {
        gold: 1000, karma: 0, inventory: {}, blessings: {}, reputation: {},
        skills: { combat: 1, commerce: 1, leadership: 1, diplomacy: 1, stealth: 1 },
        army: [], mount: null, criminalRecord: {},
        ...overrides,
    };
}

function soldier() {
    return { type: 'militia', strength: 10, level: 1, upkeep: 1, experience: 0 };
}

describe('blacksmith — hone arms', () => {
    it('charges per soldier and raises army strength while active', () => {
        const player = makePlayer({ army: [soldier(), soldier()] });
        const before = PlayerMilitary.getArmyStrength(player);
        const res = SettlementServices.honeArms(player, town);
        expect(res.success).toBe(true);
        expect(player.gold).toBe(1000 - SettlementServices.honeArmsCost(player, town));
        expect(PlayerMilitary.getArmyStrength(player)).toBe(Math.floor(before * 1.15));
    });

    it('wears off after its duration', () => {
        const player = makePlayer({ army: [soldier()] });
        SettlementServices.honeArms(player, town);
        for (let d = 0; d < SERVICE_CONFIG.honedArms.days; d++) PlayerReligion.updateBlessings(player);
        expect(SettlementServices.armyStrengthMultiplier(player)).toBe(1);
    });

    it('refuses without an army', () => {
        expect(SettlementServices.honeArms(makePlayer(), town).success).toBe(false);
    });
});

describe('temple blessing and mounts add daily movement', () => {
    it('blessing grants movement, healing and karma', () => {
        const player = makePlayer();
        expect(SettlementServices.seekBlessing(player, town).success).toBe(true);
        expect(SettlementServices.movementBonus(player)).toBe(SERVICE_CONFIG.blessing.movementBonus);
        expect(SettlementServices.healthRegenBonus(player)).toBe(SERVICE_CONFIG.blessing.healthRegen);
        expect(player.karma).toBe(1);
    });

    it('buying a horse gives one mount; a second is refused', () => {
        Utils.setSeed(7);
        const player = makePlayer();
        expect(SettlementServices.buyMount(player, town, 3).success).toBe(true);
        expect(player.mount.name).toBeTruthy();
        expect(SettlementServices.movementBonus(player)).toBe(SERVICE_CONFIG.mount.movementBonus);
        expect(SettlementServices.buyMount(player, town, 3).success).toBe(false);
    });

    it('a tamed horse can be saddled, and mounts resell at half price', () => {
        const player = makePlayer({ inventory: { horse: 1 } });
        expect(SettlementServices.saddleTamedHorse(player, 0).success).toBe(true);
        expect(player.inventory.horse).toBeUndefined();
        const gold = player.gold;
        const sale = SettlementServices.sellMount(player);
        expect(sale.gold).toBe(Math.round(SERVICE_CONFIG.mount.price * SERVICE_CONFIG.mount.resaleRate));
        expect(player.gold).toBe(gold + sale.gold);
        expect(player.mount).toBeNull();
    });

    it('the daily rest applies the mount bonus to movement', () => {
        const player = new Player();
        player.mount = { name: 'Bramble', price: 160 };
        player.endDay();
        expect(player.movementRemaining).toBeGreaterThanOrEqual(player.maxStamina + SERVICE_CONFIG.mount.movementBonus);
    });
});

describe('guard tower and town hall', () => {
    it('paying fines clears the record and improves standing', () => {
        const player = makePlayer({ criminalRecord: { pickpocket: 2, smuggling: 1 } });
        const fine = SettlementServices.fineAmount(player, town);
        expect(fine).toBe(3 * SERVICE_CONFIG.fines.perOffense);
        expect(SettlementServices.payFines(player, town).success).toBe(true);
        expect(SettlementServices.offenseCount(player)).toBe(0);
        expect(player.reputation.k1).toBe(SERVICE_CONFIG.fines.reputationGain);
    });

    it('tribute buys reputation, capped at the maximum', () => {
        const player = makePlayer({ reputation: { k1: 98 } });
        const res = SettlementServices.payTribute(player, town, 150);
        expect(res.success).toBe(true);
        expect(player.reputation.k1).toBe(100);
        expect(SettlementServices.payTribute(player, town, 50).success).toBe(false);
    });
});

describe('formerly hollow effects', () => {
    it('Prosperity doubles property income; Protection blocks harm', () => {
        const player = makePlayer();
        expect(PlayerEffects.propertyIncomeMultiplier(player)).toBe(1);
        player.blessings.prosperity = 5;
        expect(PlayerEffects.propertyIncomeMultiplier(player)).toBe(2);
        player.blessings.protection = 3;
        expect(PlayerEffects.casualtyMultiplier(player)).toBe(0);
        expect(PlayerEffects.scaleDamage(player, 20)).toBe(0);
    });

    it('crafted armour reduces personal damage', () => {
        const player = makePlayer({ inventory: { leather_armor: 1, shield: 1 } });
        expect(PlayerEffects.scaleDamage(player, 100)).toBe(Math.round(100 * 0.8 * 0.85));
        expect(PlayerEffects.scaleDamage(makePlayer(), 10)).toBe(10);
    });

    it('trade agreements apply in their kingdom and expire on schedule', () => {
        const player = makePlayer({ tradeAgreements: { k1: { kingdom: 'Westmarch', expires: 90 } } });
        expect(PlayerEffects.tradeBonus(player, town)).toBeCloseTo(0.10);
        expect(PlayerEffects.tradeBonus(player, { kingdom: 'k2' })).toBe(0);
        expect(PlayerEffects.expireTradeAgreements(player, 89)).toEqual([]);
        expect(PlayerEffects.expireTradeAgreements(player, 90)).toEqual(['Westmarch']);
        expect(PlayerEffects.tradeBonus(player, town)).toBe(0);
    });

    it('cooked food feeds the player and is eaten first', () => {
        const player = new Player();
        player.inventory = { bread: 1, cooked_fish: 1 };
        expect(player.getFoodCount()).toBe(2);
        expect(player.consumeFood()).toBe(true);
        expect(player.inventory.cooked_fish).toBeUndefined();
        expect(player.inventory.bread).toBe(1);
    });

    it('a raised maxStamina (tamed horse) lengthens the next day', () => {
        const player = new Player();
        const base = player.maxStamina;
        player.maxStamina += 2;
        player.endDay();
        expect(player.stamina).toBe(base + 2);
    });

    it('house upgrades grant their stat bonuses, and selling removes them', () => {
        const player = makePlayer({ strength: 5 });
        Housing._applyUpgradeStats(player, { strengthBonus: 1, combatSkillBonus: 2 }, 1);
        expect(player.strength).toBe(6);
        expect(player.skills.combat).toBe(3);
        Housing._applyUpgradeStats(player, { strengthBonus: 1, combatSkillBonus: 2 }, -1);
        expect(player.strength).toBe(5);
        expect(player.skills.combat).toBe(1);
    });
});
