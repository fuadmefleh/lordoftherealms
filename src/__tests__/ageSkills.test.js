/**
 * Age shapes practised skills (systems/practiceSkills.js, data/skillPacks/age.json):
 * the young learn faster, the body's skills fade after 55 (an effective level;
 * XP kept), a seasoned mind's trades rise a level from 50, NPCs by their age,
 * and a milestone year is told once.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Diving } from '../player/diving.js';
import { Player } from '../player/player.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Relationships } from '../systems/relationships/index.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const aged = (age) => {
    const p = new Player();
    p.age = age;
    return p;
};

describe('learning by age', () => {
    it('the young learn faster, the old body slower, the mind keeps learning', () => {
        expect(PracticeSkills.learnMult(aged(18), 'diving')).toBe(1.5);
        expect(PracticeSkills.learnMult(aged(22), 'medicine')).toBe(1.25);
        expect(PracticeSkills.learnMult(aged(30), 'diving')).toBe(1);
        expect(PracticeSkills.learnMult(aged(60), 'diving')).toBe(0.65);
        expect(PracticeSkills.learnMult(aged(60), 'medicine')).toBe(1);
        expect(PracticeSkills.learnMult(aged(70), 'climbing')).toBeLessThan(PracticeSkills.learnMult(aged(70), 'smithing'));
        // age unknown: as in their prime
        expect(PracticeSkills.learnMult({}, 'diving')).toBe(1);
    });

    it('the same work is more XP to the young', () => {
        const young = aged(18), prime = aged(30), old = aged(66);
        for (const p of [young, prime, old]) PracticeSkills.gain(p, 'climbing', 20);
        expect(PracticeSkills.xp(young, 'climbing')).toBeCloseTo(30);
        expect(PracticeSkills.xp(prime, 'climbing')).toBeCloseTo(20);
        expect(PracticeSkills.xp(old, 'climbing')).toBeCloseTo(10);
    });
});

describe('effective level', () => {
    it('the body fades after 55, a level per 6 years, never below 1; XP is kept', () => {
        const p = aged(30);
        PracticeSkills.setLevel(p, 'diving', 8);
        const xp = PracticeSkills.xp(p, 'diving');
        const lv = (age) => { p.age = age; return PracticeSkills.level(p, 'diving'); };
        expect(lv(54)).toBe(8);
        expect(lv(55)).toBe(7);
        expect(lv(61)).toBe(6);
        expect(lv(70)).toBe(5);
        expect(lv(90)).toBe(4);   // capped at −4
        expect(PracticeSkills.xp(p, 'diving')).toBe(xp);
        expect(PracticeSkills.trainedLevel(p, 'diving')).toBe(8);
        const low = aged(80);
        PracticeSkills.setLevel(low, 'swimming', 2);
        expect(PracticeSkills.level(low, 'swimming')).toBe(1);
    });

    it('perks read the effective level: an old diver holds less breath', () => {
        const young = aged(30), old = aged(70);
        PracticeSkills.setLevel(young, 'diving', 8);
        PracticeSkills.setLevel(old, 'diving', 8);
        expect(PracticeSkills.perk(old, 'diving', 'breath')).toBe(PracticeSkills.perkAt('diving', 'breath', 5));
        expect(Diving.breath(old)).toBeLessThan(Diving.breath(young));
    });

    it('a seasoned mind is a level better from 50; hard work fades later and less', () => {
        const p = aged(52);
        PracticeSkills.setLevel(p, 'medicine', 6);
        PracticeSkills.setLevel(p, 'mining', 6);
        expect(PracticeSkills.level(p, 'medicine')).toBe(7);
        expect(PracticeSkills.level(p, 'mining')).toBe(6);
        p.age = 75;
        expect(PracticeSkills.level(p, 'mining')).toBe(4);   // −2 cap
        expect(PracticeSkills.level(p, 'medicine')).toBe(7);
        // fishing, stealth: untouched by the years
        PracticeSkills.setLevel(p, 'stealth', 5);
        expect(PracticeSkills.level(p, 'stealth')).toBe(5);
    });

    it('the panel sees both: trained level and the level with age', () => {
        const p = aged(70);
        PracticeSkills.setLevel(p, 'climbing', 7);
        const row = PracticeSkills.list(p).find(s => s.id === 'climbing');
        expect(row).toMatchObject({ level: 7, effective: 4, ageShift: -3 });
        const sum = PracticeSkills.ageSummary(p);
        expect(sum.age).toBe(70);
        expect(sum.lines[0]).toMatch(/learning/);
        expect(sum.lines.join(' ')).toMatch(/body skills −3 levels/);
        expect(PracticeSkills.ageSummary(aged(18)).lines[0]).toMatch(/×1.5/);
        expect(PracticeSkills.ageSummary({})).toBe(null);
    });

    it('a level-up tells what it gives at the holder\'s age', () => {
        const p = aged(70);
        PracticeSkills.setLevel(p, 'diving', 7);
        const ev = PracticeSkills.gain(p, 'diving', PracticeSkills.stepXp(7) * 3);
        expect(ev.to).toBe(8);
        const want = PracticeSkills.gainsBetween('diving', 4, 5);
        expect(ev.gains).toEqual(want);
    });
});

describe('NPCs by their age', () => {
    it('seeding stamps the age; an old fisher dives below his XP, an old healer above', () => {
        const old = {}, young = {};
        PracticeSkills.seedNpc(old, { key: 'f', role: 'fisher', age: 68, coastal: true });
        PracticeSkills.seedNpc(young, { key: 'f', role: 'fisher', age: 30, coastal: true });
        expect(PracticeSkills.ageOf(old)).toBe(68);
        expect(PracticeSkills.ageShift(old, 'diving')).toBe(-3);
        expect(PracticeSkills.ageShift(old, 'medicine')).toBe(1);
        expect(PracticeSkills.ageShift(young, 'diving')).toBe(0);
        // notable() names them at their effective level
        PracticeSkills.setLevel(old, 'diving', 9);
        const n = PracticeSkills.notable(old).find(s => s.id === 'diving');
        expect(n.level).toBe(6);
        expect(n.trained).toBe(9);
    });

    it('a season of work keeps the age current', () => {
        const p = {};
        PracticeSkills.seedNpc(p, { key: 's', role: 'sailor', age: 40 });
        PracticeSkills.growNpc(p, { key: 's', role: 'sailor', age: 56 }, 1);
        expect(PracticeSkills.ageOf(p)).toBe(56);
    });

    it('an NPC with its own age (a walking NPC) uses it', () => {
        const npc = { age: 61, practiceSkills: {} };
        PracticeSkills.setLevel(npc, 'blades', 6);
        expect(PracticeSkills.level(npc, 'blades')).toBe(4);
    });
});

describe('milestones and saves', () => {
    it('a milestone year is told once, as the year turns', () => {
        const p = aged(55);
        const ev = PracticeSkills.birthday(p);
        expect(ev).toBeTruthy();
        expect(ev.text).toMatch(/knees/);
        expect(p._skillUps).toContain(ev);
        p.age = 56;
        expect(PracticeSkills.birthday(p)).toBe(null);
    });

    it('the yearly ageing tells the milestone', () => {
        const p = aged(54);
        p.maxLifespan = 90;
        const world = { day: Relationships._getHeirSettings().daysPerYear };
        Relationships.processAging(p, world);
        expect(p.age).toBe(55);
        expect((p._skillUps || []).some(e => e.age === 55)).toBe(true);
    });

    it('save and load keep XP and age, so the effective level is the same', () => {
        const p = aged(70);
        PracticeSkills.setLevel(p, 'diving', 8);
        PracticeSkills.gain(p, 'diving', 5);
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.age).toBe(70);
        expect(PracticeSkills.xp(back, 'diving')).toBeCloseTo(PracticeSkills.xp(p, 'diving'));
        expect(PracticeSkills.level(back, 'diving')).toBe(5);
    });
});
