/**
 * Food skills (systems/foodSkills.js, data/skillPacks/food.json): farming,
 * fishing and cooking as practised skills — their perks read where the work
 * is done (crops, the fishing draw, the craft roll, eating, inns), XP for the
 * work, old saves' continuous skills adopted, NPCs seeded by trade.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { FoodSkills } from '../systems/foodSkills.js';
import { Crops } from '../systems/crops.js';
import { Crafting } from '../player/crafting.js';
import { Player } from '../player/player.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

beforeEach(() => Utils.setSeed(1234));

const fresh = () => {
    const p = new Player();
    p.inventory = {};
    p.skills = {};
    return p;
};

const world = (season, day = 10) => ({ season, day, weather: { getWeather: () => ({ type: 'clear' }) }, getTile: () => null });

describe('the skills are defined', () => {
    it('farming, fishing and cooking are practised skills with perks for every level', () => {
        for (const id of FoodSkills.IDS) {
            const d = PracticeSkills.def(id);
            expect(d, id).toBeTruthy();
            for (const p of Object.values(d.perks)) expect(p.levels.length).toBe(PracticeSkills.maxLevel());
        }
    });

    it('every level of each gives something new', () => {
        for (const id of FoodSkills.IDS) {
            for (let L = 1; L < PracticeSkills.maxLevel(); L++) {
                expect(PracticeSkills.gainsBetween(id, L, L + 1).length, `${id} ${L}->${L + 1}`).toBeGreaterThan(0);
            }
        }
    });
});

describe('farming', () => {
    const sow = (p, cropId = 'cabbage') => {
        const crop = Crops.crop(cropId) || Crops.list()[0];
        p.inventory[crop.seed] = 5;
        Crops.markTilled(p, 0, 0, 1, 1);
        const season = crop.sow[0];
        expect(Crops.plant(p, world(season), 0, 0, 1, 1, crop.id).ok).toBe(true);
        return crop;
    };

    it('a practised farmer brings in more', () => {
        const cell = { crop: Crops.list()[0].id, days: 10, wetDays: 10 };
        const total = (lv) => {
            const p = fresh();
            PracticeSkills.setLevel(p, 'farming', lv);
            Utils.setSeed(7);
            let n = 0;
            for (let i = 0; i < 200; i++) n += Crops.yieldFor(p, cell);
            return n;
        };
        expect(total(10)).toBeGreaterThan(total(1) * 1.4);
    });

    it('crops bear more dry days by level before they wilt', () => {
        const dryDaysToWilt = (lv) => {
            const p = fresh();
            PracticeSkills.setLevel(p, 'farming', lv);
            const crop = sow(p);
            const season = crop.sow[0];
            let d = 0;
            while (!Crops.cell(p, 0, 0, 1, 1).dead && d < 40) {
                d++;
                Crops.processDay(world(season, 10 + d), p);
                if (Crops.isRipe(Crops.cell(p, 0, 0, 1, 1))) break;
            }
            return Crops.cell(p, 0, 0, 1, 1).dead ? d : 99;
        };
        expect(dryDaysToWilt(10)).toBeGreaterThan(dryDaysToWilt(1));
    });

    it('a tender crop lives through a few frost days for a practised farmer', () => {
        const frostDeath = (lv) => {
            const p = fresh();
            PracticeSkills.setLevel(p, 'farming', lv);
            const crop = Crops.list().find(c => !c.hardy);
            p.inventory[crop.seed] = 1;
            Crops.markTilled(p, 0, 0, 1, 1);
            Crops.plant(p, world(crop.sow[0]), 0, 0, 1, 1, crop.id);
            const wet = { season: 'Winter', weather: { getWeather: () => ({ type: 'rain' }) }, getTile: () => null };
            let d = 0;
            while (!Crops.cell(p, 0, 0, 1, 1).dead && d < 20) { d++; Crops.processDay({ ...wet, day: 100 + d }, p); }
            return d;
        };
        expect(frostDeath(1)).toBe(1);
        expect(frostDeath(10)).toBe(1 + FoodSkills.farmFrostDays((() => { const p = fresh(); PracticeSkills.setLevel(p, 'farming', 10); return p; })()));
    });

    it('field work is quicker by level and earns XP', () => {
        const p = fresh();
        expect(FoodSkills.farmWorkMult(p)).toBe(1);
        PracticeSkills.setLevel(p, 'farming', 6);
        expect(FoodSkills.farmWorkMult(p)).toBeLessThan(0.8);
        const q = fresh();
        let up = null;
        for (let i = 0; i < 30 && !up; i++) up = FoodSkills.farmWork(q, 'till');
        expect(up && up.skill).toBe('farming');
        expect(up.text).toMatch(/Farming rose to level 2/);
    });

    it("an old save's farming skill becomes XP", () => {
        const p = fresh();
        p.skills.farming = 3.5;
        expect(FoodSkills.level(p, 'farming')).toBe(4);
        expect(PracticeSkills.progress(p, 'farming').share).toBeCloseTo(0.5, 1);
    });
});

describe('fishing', () => {
    it('deep-water fish come only to a practised angler', () => {
        const all = FoodSkills.fishTable('mid', 10).map(f => f.name);
        const novice = FoodSkills.fishTable('mid', 1).map(f => f.name);
        expect(all).toContain('swordfish');
        expect(novice).not.toContain('swordfish');
        expect(FoodSkills.lockedFish('mid', 1).length).toBeGreaterThan(0);
        expect(FoodSkills.lockedFish('mid', 10).length).toBe(0);
    });

    it('a practised angler gets more bites, lands more, draws less junk and bigger fish', () => {
        const a = fresh(), b = fresh();
        PracticeSkills.setLevel(b, 'fishing', 10);
        const lo = FoodSkills.fishing(a), hi = FoodSkills.fishing(b);
        expect(hi.bites).toBeGreaterThan(lo.bites);
        expect(hi.land).toBeGreaterThan(lo.land);
        expect(hi.casts).toBeGreaterThan(lo.casts);
        expect(hi.deepReach).toBe(true);
        expect(lo.deepReach).toBe(false);
        const draw = (p) => {
            const rng = Utils.createRng ? Utils.createRng(5) : (() => { let s = 5; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
            const out = { junk: 0, bigger: 0, value: 0 };
            for (let i = 0; i < 2000; i++) {
                const f = FoodSkills.rollFish(p, 'shallow', rng, 5);
                if (f.rarity === 'junk') out.junk++;
                if (f.bigger) out.bigger++;
                out.value += f.value;
            }
            return out;
        };
        const n = draw(a), m = draw(b);
        expect(m.junk).toBeLessThan(n.junk * 0.6);
        expect(n.bigger).toBe(0);
        expect(m.bigger).toBeGreaterThan(100);
        expect(m.value).toBeGreaterThan(n.value);
    });

    it('deep water from a sea shore once practised', () => {
        const a = fresh(), b = fresh();
        PracticeSkills.setLevel(b, 'fishing', 6);
        expect(FoodSkills.canFishDeep(a, false, true)).toBe(false);
        expect(FoodSkills.canFishDeep(b, false, true)).toBe(true);
        expect(FoodSkills.canFishDeep(b, false, false)).toBe(false);
    });

    it('casts and catches earn XP, a rare fish most', () => {
        const a = fresh(), b = fresh();
        FoodSkills.fishXp(a, { casts: 4, catches: [{ rarity: 'common' }] });
        FoodSkills.fishXp(b, { casts: 4, catches: [{ rarity: 'rare' }] });
        expect(PracticeSkills.xp(b, 'fishing')).toBeGreaterThan(PracticeSkills.xp(a, 'fishing'));
        const c = fresh();
        let up = null;
        for (let i = 0; i < 20 && !up; i++) up = FoodSkills.fishXp(c, { casts: 3, catches: [{ rarity: 'common' }, { rarity: 'uncommon' }] });
        expect(up && up.text).toMatch(/Fishing rose to level 2/);
    });
});

describe('cooking', () => {
    it('the Cook modal works cooking as a practised craft', () => {
        const p = fresh();
        PracticeSkills.setLevel(p, 'cooking', 5);
        expect(Crafting.skillLevel(p, 'cooking')).toBeCloseTo(4, 5);
        expect(Crafting.skillInfo(p, 'cooking').practiceLevel).toBe(5);
    });

    it("an old save's cooking skill migrates", () => {
        const p = fresh();
        p.skills.cooking = 2.5;
        expect(Crafting.skillLevel(p, 'cooking')).toBeCloseTo(2.5, 1);
        expect(PracticeSkills.level(p, 'cooking')).toBe(3);
    });

    it('cooking a dish earns cooking XP and finer odds by level', () => {
        const p = fresh();
        p.inventory = { fish: 20 };
        for (let i = 0; i < 10; i++) Crafting.craft(p, 'cooked_fish');
        expect(PracticeSkills.xp(p, 'cooking')).toBeGreaterThan(0);
        const r = Crafting.recipe('cooked_fish');
        const a = fresh(), b = fresh();
        PracticeSkills.setLevel(b, 'cooking', 9);
        expect(Crafting.odds(b, r).score).toBeGreaterThan(Crafting.odds(a, r).score);
        expect(Crafting.odds(b, r).fail).toBeLessThan(Crafting.odds(a, r).fail);
    });

    it('a cooked dish fills a practised cook more, and leaves them well fed', () => {
        const p = fresh();
        expect(FoodSkills.heartyMult(p, 'cooked_meal')).toBe(1);
        PracticeSkills.setLevel(p, 'cooking', 8);
        expect(FoodSkills.heartyMult(p, 'cooked_meal')).toBeGreaterThan(1.2);
        expect(FoodSkills.heartyMult(p, 'grain')).toBe(1);
        const fed = FoodSkills.afterEating(p, 'cooked_meal');
        expect(fed.slower).toBeGreaterThan(0);
        expect(FoodSkills.hungerDrainMult(p)).toBeLessThan(1);
        const hours = fed.hours;
        for (let h = 0; h < hours; h++) FoodSkills.tickWellFed(p, 1);
        expect(FoodSkills.hungerDrainMult(p)).toBe(1);
    });

    it('a well-fed player loses less hunger in an hour', () => {
        const hungerAfterHour = (lv) => {
            const p = fresh();
            p.needsEnabled = true;
            if (!p.needs) return null;
            p.needs.hunger = 80;
            PracticeSkills.setLevel(p, 'cooking', lv);
            FoodSkills.afterEating(p, 'cooked_meal');
            p.decayNeedsPerHour({});
            return p.needs.hunger;
        };
        const a = hungerAfterHour(1), b = hungerAfterHour(10);
        if (a != null) expect(b).toBeGreaterThan(a);
    });

    it("an inn's meals are as hearty as its keeper's cooking", () => {
        const c = FoodSkills.innCook({ id: 'inn-1', keeper: 'Brom' });
        expect(c.level).toBeGreaterThanOrEqual(4);
        expect(c.mult).toBeGreaterThan(1);
        expect(FoodSkills.innCook({ id: 'inn-1', keeper: 'Brom' }).level).toBe(c.level);
    });
});

describe('NPCs', () => {
    it('farmers farm, fishers fish, innkeepers cook', () => {
        const farmer = {}, fisher = {}, keeper = {}, noble = {};
        PracticeSkills.seedNpc(farmer, { key: 'f', role: 'farmer', age: 40 });
        PracticeSkills.seedNpc(fisher, { key: 'x', role: 'fisher', age: 40, coastal: true });
        PracticeSkills.seedNpc(keeper, { key: 'k', role: 'innkeeper', age: 40 });
        PracticeSkills.seedNpc(noble, { key: 'n', role: 'noble', age: 40 });
        expect(PracticeSkills.level(farmer, 'farming')).toBeGreaterThan(PracticeSkills.level(noble, 'farming'));
        expect(PracticeSkills.level(fisher, 'fishing')).toBeGreaterThan(PracticeSkills.level(noble, 'fishing'));
        expect(PracticeSkills.level(keeper, 'cooking')).toBeGreaterThan(PracticeSkills.level(noble, 'cooking'));
    });

    it('a farmer grows in farming by their work', () => {
        const h = {};
        const who = { key: 'g', role: 'farmer', age: 30 };
        PracticeSkills.seedNpc(h, who);
        const before = PracticeSkills.xp(h, 'farming');
        PracticeSkills.growNpc(h, who, 30);
        expect(PracticeSkills.xp(h, 'farming')).toBeGreaterThan(before);
    });
});
