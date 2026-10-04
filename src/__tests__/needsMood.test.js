/**
 * Needs & mood — the needs system is on by default, needs actually decay on
 * both the world map (daily) and the inner map (hourly), and the mood effects
 * getMood() promises (combat, charisma, reputation) are read by gameplay.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Player } from '../player/player.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { Trading } from '../player/playerEconomy.js';
import { WORLD_DAY_DECAY, DAILY_RATION_HUNGER } from '../player/core/needs.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { InnerMapCombat } from '../ui/innerMapCombat.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

const NEEDS = ['hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort'];

function setAllNeeds(player, value) {
    for (const n of NEEDS) player.needs[n] = value;
}

function ecstatic() {
    const p = new Player();
    setAllNeeds(p, 100);
    return p;
}

function miserable() {
    const p = new Player();
    setAllNeeds(p, 20);
    return p;
}

describe('needs system — on by default', () => {
    it('a new player has the needs system enabled', () => {
        expect(new Player().needsEnabled).toBe(true);
    });

    it('inner-map hours decay needs and count toward the day', () => {
        const p = new Player();
        p.decayNeedsPerHour({});
        expect(p.needs.hunger).toBeLessThan(100);
        expect(p.needs.energy).toBeLessThan(100);
        expect(p._needHoursToday).toBe(1);
    });

    it('a world-map day drains needs; inner-map hours are not charged twice', () => {
        const p = new Player();
        expect(p.decayNeedsForDay()).toBe(1);
        expect(p.needs.energy).toBe(100 - WORLD_DAY_DECAY.energy);

        const q = new Player();
        for (let i = 0; i < 8; i++) q.decayNeedsPerHour({});
        const before = q.needs.social;
        expect(q.decayNeedsForDay()).toBeCloseTo(0.5);
        expect(q.needs.social).toBeCloseTo(before - WORLD_DAY_DECAY.social * 0.5);
    });

    it('turning the system off freezes needs and silences mood', () => {
        const p = new Player();
        p.needsEnabled = false;
        p.decayNeedsPerHour({});
        p.decayNeedsForDay();
        expect(p.needs.hunger).toBe(100);
        setAllNeeds(p, 5);
        expect(p.getMood().effects).toEqual({});
        expect(PlayerEffects.moodCombatMultiplier(p)).toBe(1);
    });

    it('a fed player resting at an inn holds steady; neglect drifts down but stays playable', () => {
        const p = new Player();
        p.inventory = { bread: 30 };
        for (let d = 0; d < 7; d++) {
            p._restTypeOverride = 'inn';
            p.endDay();
        }
        // ration cancels the day; the night's −15 sits on top of a capped bar
        expect(p.needs.hunger).toBeGreaterThanOrEqual(80);
        expect(p.needs.energy).toBeGreaterThanOrEqual(95);
        // social / fun slip without taverns or company — real, but not a crisis
        expect(p.needs.social).toBeLessThan(40);
        expect(p.needs.social).toBeGreaterThan(0);
        expect(p.getMood().score).toBeGreaterThanOrEqual(30);
    });

    it('the daily ration offsets the day and night hunger drain', () => {
        const p = new Player();
        p.inventory = { bread: 5 };
        p.needs.hunger = 50;
        p.endDay();
        // −20 day, +35 ration, −15 night
        expect(p.needs.hunger).toBe(50 - WORLD_DAY_DECAY.hunger + DAILY_RATION_HUNGER - 15);
        expect(p._needHoursToday).toBe(0);
    });

    it('ending the day in a settlement counts as rough lodgings, not the roadside', () => {
        const p = new Player();
        p.inventory = { bread: 5 };
        const world = { getTile: () => ({ settlement: { name: 'Town' } }) };
        p.endDay(world);
        expect(p._lastRestType).toBe('camp');
        p.endDay(null);
        expect(p._lastRestType).toBe('outdoors');
    });

    it('eatMeal eats the best food in the pack', () => {
        const p = new Player();
        p.inventory = { grain: 2, cooked_meat: 1 };
        p.needs.hunger = 40;
        const r = p.eatMeal();
        expect(r.success).toBe(true);
        expect(r.food).toBe('cooked_meat');
        expect(p.needs.hunger).toBe(80);
        expect(p.inventory.cooked_meat).toBeUndefined();
        p.inventory = {};
        expect(p.eatMeal().success).toBe(false);
    });
});

describe('needs — save/load', () => {
    it('old saves without the flag load with needs on; explicit opt-out is kept', () => {
        const legacy = SaveLoad.serializePlayer(new Player());
        delete legacy.needsEnabled;
        delete legacy._needHoursToday;
        const p = new Player();
        SaveLoad.restorePlayer(legacy, p);
        expect(p.needsEnabled).toBe(true);
        expect(p._needHoursToday).toBe(0);

        const off = new Player();
        off.needsEnabled = false;
        const data = SaveLoad.serializePlayer(off);
        expect(data.needsEnabled).toBe(false);
        const p2 = new Player();
        SaveLoad.restorePlayer(data, p2);
        expect(p2.needsEnabled).toBe(false);
    });
});

describe('mood effects are read', () => {
    it('mood combat multiplier: ±5%', () => {
        expect(ecstatic().getMood().effects.combatBonus).toBe(1);
        expect(PlayerEffects.moodCombatMultiplier(ecstatic())).toBeCloseTo(1.05);
        expect(PlayerEffects.moodCombatMultiplier(miserable())).toBeCloseTo(0.95);
        const fine = new Player();
        setAllNeeds(fine, 60);
        expect(PlayerEffects.moodCombatMultiplier(fine)).toBe(1);
    });

    it('a happy commander wins more close battles than a miserable one (same seeds)', () => {
        const army = () => Array.from({ length: 10 }, (_, i) => (
            { type: 'militia', name: `Militia ${i}`, strength: 5, level: 1, upkeep: 1, experience: 0 }));
        let happyWins = 0;
        let sadWins = 0;
        for (let seed = 1; seed <= 150; seed++) {
            const h = ecstatic();
            h.army = army();
            const s = miserable();
            s.army = army();
            const enemy = PlayerMilitary.getArmyStrength(h);
            Utils.setSeed(seed);
            if (PlayerMilitary.combat(h, enemy, 'Bandits').victory) happyWins++;
            Utils.setSeed(seed);
            if (PlayerMilitary.combat(s, enemy, 'Bandits').victory) sadWins++;
        }
        expect(happyWins).toBeGreaterThan(sadWins);
    });

    it('personal inner-map damage scales with mood', () => {
        const h = ecstatic();
        const s = miserable();
        h.strength = s.strength = 10;
        h.luck = s.luck = 5;
        expect(InnerMapCombat._computePlayerDamage(h)).toBeGreaterThan(InnerMapCombat._computePlayerDamage(s));
    });

    it('charisma moves trade prices and diplomacy', () => {
        const h = ecstatic();
        const s = miserable();
        expect(PlayerEffects.tradeBonus(h, null)).toBeCloseTo(PlayerEffects.tradeBonus(s, null) + 0.06);
        expect(PlayerEffects.effectiveDiplomacy(h)).toBe(PlayerEffects.effectiveDiplomacy(s) + 2);

        // Buying the same goods costs a happy trader less
        const good = { id: 'bread', price: 100, quantity: 50 };
        h.gold = s.gold = 100000;
        const settlement = { marketStock: {} };
        const a = Trading.buyGoods(h, good, 10, settlement);
        const b = Trading.buyGoods(s, good, 10, settlement);
        expect(a.spent).toBeLessThan(b.spent);
    });

    it('a good mood boosts reputation gains', () => {
        const h = ecstatic();
        const fine = new Player();
        setAllNeeds(fine, 60);
        expect(PlayerEffects.moodReputationMultiplier(h)).toBeCloseTo(1.1);
        expect(PlayerEffects.scaleReputationGain(h, 100)).toBeGreaterThan(PlayerEffects.scaleReputationGain(fine, 100));
        // Losses are never scaled
        expect(PlayerEffects.scaleReputationGain(h, -10)).toBe(-10);
    });
});
