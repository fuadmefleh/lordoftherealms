// The wild skills (data/skillPacks/wild.json): Woodcutting and Mining &
// Quarrying (player/gathering.js), Foraging and Hunting & Butchering
// (player/foraging.js) as practised skills in levels, their perks felt, the
// old trips migrated once, and NPC woodcutters / miners / herbalists seeded.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Gathering } from '../player/gathering.js';
import { Foraging, Hunting, FORAGE_RANKS } from '../player/foraging.js';
import { InnerMap } from '../world/innerMap.js';
import { OddJobs } from '../player/oddJobs.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

const TREE = { id: 'large_tree_1', objectType: 'tree', resource: { type: 'wood', amount: 50 } };
const ROCK = { id: 'rock_boulder_grey', objectType: 'rock', resource: { type: 'stone', amount: 8 }, resistance: 40 };
const CHAIR = { id: 'chair', objectType: 'furniture' };
const at = (id, L) => ({ practiceSkills: { [id]: PracticeSkills.xpForLevel(L) }, strength: 5, luck: 5, intelligence: 5 });

describe('the wild skills are in the data', () => {
    it('each has ten levels of perks and shows on the sheet', () => {
        for (const id of ['woodcutting', 'mining', 'foraging', 'hunting']) {
            const d = PracticeSkills.def(id);
            expect(d, id).toBeTruthy();
            for (const p of Object.values(d.perks)) expect(p.levels).toHaveLength(10);
            // every level gives something
            for (let L = 1; L < 10; L++) expect(PracticeSkills.gainsBetween(id, L, L + 1).length, `${id} ${L}`).toBeGreaterThan(0);
            expect(PracticeSkills.list({}).some(s => s.id === id)).toBe(true);
        }
    });

    it('the rock objects are in the objects data, bound to bare rock and giving stone', () => {
        const rocks = DataLoader._gamedata.objects.filter(o => o.objectType === 'rock');
        expect(rocks.length).toBeGreaterThan(0);
        for (const r of rocks) {
            expect(r.resource.type).toBe('stone');
            expect(r.terrainBindings).toContain('rocks');
            expect(Gathering.skillFor(r)).toBe('mining');
        }
    });
});

describe('Woodcutting and Mining (player/gathering.js)', () => {
    it('a tree trains woodcutting, a rock mining, a chair nothing', () => {
        expect(Gathering.skillFor(TREE)).toBe('woodcutting');
        expect(Gathering.skillFor(ROCK)).toBe('mining');
        expect(Gathering.skillFor(CHAIR)).toBeNull();
        expect(Gathering.damageMult(at('woodcutting', 1), CHAIR)).toBe(1);
    });

    it('a practised hand fells in fewer swings', () => {
        const base = InnerMap._computeObjectDamage({ strength: 5, luck: 5 }, TREE);
        const swings = (p) => Math.ceil(100 / (base * Gathering.damageMult(p, TREE)));
        expect(swings(at('woodcutting', 10))).toBeLessThan(swings(at('woodcutting', 1)));
        expect(Gathering.damageMult(at('mining', 5), ROCK)).toBeGreaterThan(1);
    });

    it('each swing tires you (less with practice) and teaches the skill', () => {
        const mk = (L) => {
            const p = at('woodcutting', L);
            p.needs = { energy: 50 };
            p.modifyNeed = function (k, d) { this.needs[k] += d; };
            return p;
        };
        const novice = mk(1), master = mk(10);
        Gathering.swing(novice, TREE);
        Gathering.swing(master, TREE);
        expect(novice.needs.energy).toBeLessThan(50);
        expect(master.needs.energy).toBeGreaterThan(novice.needs.energy);
        expect(PracticeSkills.xp(novice, 'woodcutting')).toBeGreaterThan(0);
    });

    it('a felled tree is XP, and a master often brings extra logs', () => {
        Utils.setSeed(3);
        let extraNovice = 0, extraMaster = 0;
        for (let i = 0; i < 200; i++) {
            if (Gathering.felled(at('woodcutting', 1), TREE, TREE.resource).extra) extraNovice++;
            if (Gathering.felled(at('woodcutting', 10), TREE, TREE.resource).extra) extraMaster++;
        }
        expect(extraNovice).toBe(0);
        expect(extraMaster).toBeGreaterThan(60);
        const p = {};
        const res = Gathering.felled(p, TREE, TREE.resource);
        expect(res.amount).toBe(50);
        expect(res.levelUps).toHaveLength(0);
        expect(PracticeSkills.xp(p, 'woodcutting')).toBeGreaterThan(10);
    });

    it('a broken rock may give up ore or gems, more often for a master, by the terrain', () => {
        Utils.setSeed(11);
        const count = (L) => {
            let n = 0;
            for (let i = 0; i < 400; i++) if (Gathering.felled(at('mining', L), ROCK, ROCK.resource, 'mountain').rare) n++;
            return n;
        };
        const lo = count(1), hi = count(10);
        expect(lo).toBeGreaterThan(0);
        expect(hi).toBeGreaterThan(lo * 3);
        const items = new Set();
        for (let i = 0; i < 300; i++) {
            const r = Gathering.felled(at('mining', 10), ROCK, ROCK.resource, 'mountain').rare;
            if (r) items.add(r.item);
        }
        expect(items.has('ore')).toBe(true);
    });

    it('enough felling raises a level, announced with what it gives', () => {
        const p = {};
        let up = null;
        for (let i = 0; i < 10 && !up; i++) up = Gathering.felled(p, TREE, TREE.resource).levelUps[0] || null;
        expect(up).toBeTruthy();
        expect(up.text).toMatch(/Woodcutting rose to level 2/);
    });

    it('is deterministic under a seed', () => {
        const run = () => {
            Utils.setSeed(42);
            const p = at('mining', 6);
            return Array.from({ length: 20 }, () => JSON.stringify(Gathering.felled(p, ROCK, ROCK.resource, 'hills')));
        };
        expect(run()).toEqual(run());
    });
});

describe('Foraging and Hunting & Butchering (player/foraging.js)', () => {
    it('the levels make the craft rank, and its perks do the work', () => {
        expect(Foraging.skill(at('foraging', 1)).level).toBe(0);
        expect(Foraging.skill(at('foraging', 10)).level).toBe(FORAGE_RANKS.length - 1);
        const lo = at('foraging', 1), hi = at('foraging', 10);
        expect(Foraging.findMultiplier(hi)).toBeGreaterThan(Foraging.findMultiplier(lo));
        expect(Foraging.qtyBonusChance(hi)).toBeGreaterThan(Foraging.qtyBonusChance(lo));
        expect(Foraging.searches(hi)).toBeGreaterThan(Foraging.searches(lo));
        const h1 = at('hunting', 1), h9 = at('hunting', 9);
        expect(Hunting.stalk(h9)).toBeGreaterThan(Hunting.stalk(h1));
        expect(Hunting.hitThreshold(h9)).toBeLessThan(Hunting.hitThreshold(h1));
        expect(Hunting.butcherTimeMult(h9)).toBeLessThan(1);
    });

    it('a bow\'s Archery aim and the Hunting aim do not stack: the better governs', () => {
        const both = { practiceSkills: { hunting: PracticeSkills.xpForLevel(10), archery: PracticeSkills.xpForLevel(10) }, strength: 5, luck: 5 };
        const hunt = Hunting.perk(both, 'aim');
        const arch = PracticeSkills.perk(both, 'archery', 'aim');
        expect(hunt).toBeGreaterThan(0);
        // the whole aim on a shot = what hitThreshold takes off + what the bow adds
        const base = { strength: 5, luck: 5 };
        const total = (Hunting.hitThreshold(base) - Hunting.hitThreshold(both)) + Hunting.bowAim(both, arch);
        expect(total).toBe(Math.max(hunt, arch));
        // a hunter with no archery still gets the hunter's aim; an archer no hunting the archer's
        const hunter = at('hunting', 10);
        expect(Hunting.bowAim(hunter, 0)).toBe(0);
        expect(Hunting.hitThreshold(base) - Hunting.hitThreshold(hunter)).toBe(hunt);
        const archer = at('archery', 10);
        expect(Hunting.bowAim(archer, arch)).toBe(arch);
    });

    it('an old save\'s trips become XP once, never twice', () => {
        const p = { foragingTrips: 15 };
        const L = Foraging.skill(p).practice;
        expect(L).toBeGreaterThan(3);
        const xp = PracticeSkills.xp(p, 'foraging');
        Foraging.skill(p);
        expect(PracticeSkills.xp(p, 'foraging')).toBe(xp);
        // a new forager's trips are not taken for old ones
        const n = { inventory: {} };
        Foraging.finishTrip(n, []);
        Foraging.finishTrip(n, []);
        expect(PracticeSkills.xp(n, 'foraging')).toBeLessThan(27.5);
    });

    it('a butchered carcass is Hunting XP by its weight', () => {
        const a = { inventory: {} }, b = { inventory: {} };
        Hunting.finishTrip(a, []);
        Hunting.finishTrip(b, [], { butcherKg: 120 });
        expect(PracticeSkills.xp(b, 'hunting')).toBeGreaterThan(PracticeSkills.xp(a, 'hunting'));
    });

    it('beasts notice a practised stalker nearer', () => {
        const a = { species: 'deer' };
        const far = InnerMap.animalNoticeRadius(a, { stealth: 1 });
        const near = InnerMap.animalNoticeRadius(a, { stealth: 1, stalk: Hunting.stalk(at('hunting', 10)) });
        expect(near).toBeLessThan(far * 0.6);
    });
});

describe('NPC woodcutters, miners and herbalists', () => {
    it('a village has some, with the levels of their trade, growing by their work', () => {
        let wood = 0, best = 0;
        for (let i = 0; i < 400; i++) {
            const who = { key: `v${i}`, role: 'villager', age: 35 };
            if (PracticeSkills.craftOf(who) !== 'woodcutter') continue;
            wood++;
            const h = {};
            PracticeSkills.seedNpc(h, who);
            const L = PracticeSkills.level(h, 'woodcutting');
            best = Math.max(best, L);
            const before = PracticeSkills.xp(h, 'woodcutting');
            PracticeSkills.growNpc(h, who, 30);
            if (L < PracticeSkills.maxLevel()) expect(PracticeSkills.xp(h, 'woodcutting')).toBeGreaterThan(before);
        }
        expect(wood).toBeGreaterThan(5);
        expect(best).toBeGreaterThanOrEqual(PracticeSkills.config().npc.notableLevel);
    });
});

describe('odd jobs train the wild skills', () => {
    const jobs = () => {
        const o = DataLoader._gamedata.earlyJobs.oddJobs;
        return [...Object.values(o.settlement_jobs).flat(), ...Object.values(o.seasonal_jobs || {}).flat()];
    };

    it("a woodcutter's day is Woodcutting XP, a herb picker's Foraging", () => {
        for (const [jobId, skill] of [['woodcutter', 'woodcutting'], ['herb_picker', 'foraging'], ['farm_hand', 'farming'], ['cargo_hauler', 'endurance']]) {
            const job = jobs().find(j => j.id === jobId);
            expect(job, jobId).toBeTruthy();
            const p = { strength: 5, intelligence: 5, skills: {} };
            const g = OddJobs.train(p, job, 80).find(x => x.kind === 'practice' && x.id === skill);
            expect(g, jobId).toBeTruthy();
            expect(PracticeSkills.xp(p, skill)).toBeCloseTo(g.by, 5);
        }
    });

    it("an old save's foraging trips are counted before the job's XP is added", () => {
        const job = jobs().find(j => j.id === 'herb_picker');
        const p = { strength: 5, intelligence: 5, skills: {}, foragingTrips: 10 };
        const g = OddJobs.train(p, job, 80).find(x => x.kind === 'practice');
        const rate = PracticeSkills.def('foraging').xp.migrateTrips;
        expect(PracticeSkills.xp(p, 'foraging')).toBeCloseTo(10 * rate + g.by, 5);
    });
});
