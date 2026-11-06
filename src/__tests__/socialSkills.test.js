// Social skills (systems/socialSkills.js, systems/locks.js, data/skillPacks/social.json):
// Stealth, Lockpicking, Haggling, Persuasion and Leadership as practised levels;
// the old flat player.skills numbers kept in step; locks on chests and barred doors.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { Locks } from '../systems/locks.js';
import { Containers } from '../systems/containers.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

const world = (day = 3) => ({ day, generationParams: { seed: 4242 }, kingdoms: [], getKingdom: () => null, getTile: () => null });
const player = (skills = {}) => ({ gold: 500, inventory: {}, skills: { stealth: 1, diplomacy: 1, leadership: 1, commerce: 1, ...skills }, reputation: { k1: 0 } });

describe('the old flat skills become levels and stay in step', () => {
    it('migrates stealth / diplomacy / leadership once (haggling starts fresh)', () => {
        const p = player({ stealth: 3.5, diplomacy: 6, leadership: 2, commerce: 8 });
        SocialSkills.sync(p);
        expect(PracticeSkills.level(p, 'stealth')).toBe(3);
        expect(PracticeSkills.progress(p, 'stealth').share).toBeCloseTo(0.5, 1);
        expect(PracticeSkills.level(p, 'persuasion')).toBe(6);
        expect(PracticeSkills.level(p, 'leadership')).toBe(2);
        expect(PracticeSkills.level(p, 'haggling')).toBe(1); // commerce stays its own number
        // the old number now mirrors the level
        expect(Math.floor(p.skills.stealth)).toBe(3);
        expect(p.skills.diplomacy).toBeGreaterThanOrEqual(6);
        // a second sync changes nothing
        const xp = PracticeSkills.xp(p, 'stealth');
        SocialSkills.sync(p);
        expect(PracticeSkills.xp(p, 'stealth')).toBe(xp);
    });

    it('a rise of the old number by another system is XP; the level-up is queued', () => {
        const p = player({ diplomacy: 1 });
        SocialSkills.sync(p);
        p.skills.diplomacy += 1; // a festival's +1
        const ups = SocialSkills.sync(p);
        expect(PracticeSkills.level(p, 'persuasion')).toBe(2);
        expect(ups.length).toBe(1);
        expect(SocialSkills.drain(p).map(e => e.skill)).toEqual(['persuasion']);
        expect(SocialSkills.drain(p)).toEqual([]);
    });

    it('train() keeps the old number in step and announces through the queue', () => {
        const p = player();
        SocialSkills.train(p, 'stealth', PracticeSkills.xpForLevel(4));
        expect(PracticeSkills.level(p, 'stealth')).toBe(4);
        expect(Math.floor(p.skills.stealth)).toBe(4);
        expect(SocialSkills.drain(p)[0].text).toMatch(/Stealth rose to level 4/);
    });
});

describe('Stealth', () => {
    const bankChest = { worldQ: 5, worldR: 7, q: 3, r: 2, furnitureType: 'chest', building: { type: 'bank', q: 40, r: 41, name: 'Bank' }, inSettlement: true, kingdom: 'k1' };
    it('a higher level lowers the odds of being caught, and onlookers weigh less', () => {
        const lo = player();
        const hi = player();
        PracticeSkills.setLevel(hi, 'stealth', 8);
        const scene = { hour: 12, witnesses: 2, guards: 1 };
        const a = Containers.stealOdds(lo, bankChest, 'candles', 1, scene);
        const b = Containers.stealOdds(hi, bankChest, 'candles', 1, scene);
        expect(b.chance).toBeLessThan(a.chance);
        const w = p => p.parts.find(x => /nearby/.test(x.label)).delta;
        expect(w(b)).toBeLessThan(w(a));
    });

    it('a theft got away with teaches stealth', () => {
        const p = player();
        const w = world();
        Utils.setSeed(7);
        const before = PracticeSkills.xp(p, 'stealth');
        Containers.stealGoods(p, w, { ...bankChest, building: { type: 'house', q: 1, r: 1 } }, 'candles', 1, { hour: 2 });
        expect(PracticeSkills.xp(p, 'stealth')).toBeGreaterThan(before);
    });

    it('a stealthy player is seen from less far off', () => {
        const victim = { id: 'v', q: 0, r: 0 };
        const npcs = [victim, { id: 'b', q: 6, r: 0, type: 'villager', state: 'idle' }];
        expect(StreetCrime.selectWitnesses(npcs, { q: 0, r: 0, indoors: false }, victim).length).toBe(1);
        expect(StreetCrime.selectWitnesses(npcs, { q: 0, r: 0, indoors: false, sightCut: 2 }, victim).length).toBe(0);
    });
});

describe('Lockpicking', () => {
    const w = world();
    const box = q => ({ worldQ: 5, worldR: 7, q, r: 2, furnitureType: 'chest', building: { type: 'manor', q: 40, r: 41, name: 'Manor' }, inSettlement: true, kingdom: 'k1' });

    it('some chests in other folks\' buildings are locked, the same way each look; never your own, never a crate', () => {
        const locked = [];
        for (let q = 0; q < 40; q++) if (Locks.lockOf(w, box(q))) locked.push(q);
        expect(locked.length).toBeGreaterThan(20); // a manor locks most
        expect(Locks.lockOf(w, box(locked[0]))).toEqual(Locks.lockOf(w, box(locked[0])));
        const d = Locks.lockOf(w, box(locked[0])).difficulty;
        expect(d).toBeGreaterThanOrEqual(4);
        expect(d).toBeLessThanOrEqual(7);
        expect(Locks.lockOf(w, { ...box(locked[0]), furnitureType: 'crate' })).toBeNull();
        expect(Locks.lockOf(w, { ...box(locked[0]), building: { type: 'player_manor', q: 40, r: 41, isPlayerOwned: true } })).toBeNull();
    });

    it('the chance rises with level and falls with the lock; beyond reach you cannot try', () => {
        const lo = player();
        const hi = player();
        PracticeSkills.setLevel(hi, 'lockpicking', 7);
        expect(Locks.chance(hi, 3)).toBeGreaterThan(Locks.chance(lo, 3));
        expect(Locks.chance(hi, 6)).toBeLessThan(Locks.chance(hi, 3));
        expect(Locks.chance(lo, 9)).toBe(0); // level 1 reaches difficulty 4
        expect(Locks.chance(hi, 9)).toBeGreaterThan(0);
        expect(Locks.minutes(hi)).toBeLessThan(Locks.minutes(lo));
    });

    it('a picked box opens for the period; a botched try teaches too and may be heard', () => {
        const p = player();
        PracticeSkills.setLevel(p, 'lockpicking', 10);
        let q = 0;
        while (!Locks.lockOf(w, box(q))) q++;
        const ctx = box(q);
        Utils.setSeed(3);
        let res;
        for (let i = 0; i < 20 && !(res && res.ok); i++) res = Locks.pickBox(p, w, ctx, {});
        expect(res.ok).toBe(true);
        expect(Locks.lockedBox(p, w, ctx)).toBeNull();
        expect(Locks.lockedBox(p, world(3 + 14 * 2), ctx) || Locks.lockOf(world(3 + 14 * 2), ctx) === null).toBeTruthy();

        const novice = player();
        const before = PracticeSkills.xp(novice, 'lockpicking');
        Utils.setSeed(11);
        const heard = Locks.noticeChance(novice, { witnesses: 3, guards: 1 });
        expect(heard).toBeGreaterThan(Locks.noticeChance(novice, {}));
        const r = Locks.attempt(novice, 3, { witnesses: 3, guards: 1 });
        expect(PracticeSkills.xp(novice, 'lockpicking')).toBeGreaterThan(before);
        expect(typeof r.noticed).toBe('boolean');
    });

    it('a seat\'s door has a lock', () => {
        expect(Locks.doorLock({ type: 'manor' }).difficulty).toBe(5);
        expect(Locks.doorLock({ type: 'house' })).toBeNull();
    });
});

describe('Haggling', () => {
    const town = { name: 'Varrholt', q: 3, r: 4, type: 'town', kingdom: null };
    it('the edge grows with level against the town\'s merchants, never below nothing', () => {
        const lo = player();
        const hi = player();
        PracticeSkills.setLevel(hi, 'haggling', 10);
        expect(SocialSkills.hagglingBonus(lo, town)).toBe(0);
        const h = SocialSkills.haggle(hi, town);
        expect(h.bonus).toBeGreaterThan(0.1);
        expect(h.merchants).toBe(SocialSkills.merchantLevel(town)); // the same merchants each time
        expect(PlayerEffects.tradeBonus(hi, town)).toBeGreaterThan(PlayerEffects.tradeBonus(lo, town));
    });
});

describe('Persuasion', () => {
    it('talking the watch round gets likelier with level and harder against a glib guard', () => {
        const lo = player();
        const hi = player();
        PracticeSkills.setLevel(hi, 'persuasion', 8);
        expect(SocialSkills.talkOutChance(hi, 1)).toBeGreaterThan(SocialSkills.talkOutChance(lo, 1));
        expect(SocialSkills.talkOutChance(hi, 6)).toBeLessThan(SocialSkills.talkOutChance(hi, 1));
    });

    it('nobles talk back: a higher persuasion level makes them harder to talk round', () => {
        const noble = { id: 'n1', name: 'Lord Aldric', type: 'noble', age: 50 };
        const beggar = { id: 'b1', name: 'Tom', type: 'beggar', age: 30 };
        expect(SocialSkills.npcLevel(noble, 'persuasion')).toBeGreaterThan(SocialSkills.npcLevel(beggar, 'persuasion'));
        expect(SocialSkills.npcResistance(noble)).toBeGreaterThan(0);
    });
});

describe('Leadership', () => {
    it('perks grow with level', () => {
        const p = player();
        PracticeSkills.setLevel(p, 'leadership', 10);
        expect(SocialSkills.frac(p, 'leadership', 'power')).toBeCloseTo(0.2);
        expect(SocialSkills.perk(p, 'leadership', 'crew')).toBe(10);
        expect(SocialSkills.frac(player(), 'leadership', 'power')).toBe(0);
    });
});

describe('NPCs', () => {
    it('merchants haggle, thieves sneak, nobles persuade, captains lead', () => {
        const lv = (role, id) => { const h = {}; PracticeSkills.seedNpc(h, { key: `t|${role}`, role, age: 35 }); return PracticeSkills.level(h, id); };
        expect(lv('merchant', 'haggling')).toBeGreaterThanOrEqual(5);
        expect(lv('thief', 'stealth')).toBeGreaterThanOrEqual(6);
        expect(lv('noble', 'persuasion')).toBeGreaterThanOrEqual(5);
        expect(lv('captain', 'leadership')).toBeGreaterThanOrEqual(6);
        expect(lv('villager', 'lockpicking')).toBeLessThan(lv('thief', 'lockpicking'));
    });
});
