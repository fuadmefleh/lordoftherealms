/**
 * Fishing rods (player/fishingRods.js, data/skillPacks/food.json
 * skills.fishing.tackle): the cast's reach by rod and Fishing level, the best
 * rod used, the cap, a long cast fishing deeper, wear and the fallback to the
 * next rod; the rods as goods (made, sold, weighed); and the float landing
 * out to the reach on the street map (ui/mapTasks/wildTasks.js CastLines).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { FoodSkills } from '../systems/foodSkills.js';
import { FishingRods } from '../player/fishingRods.js';
import { PlayerInventory } from '../core/inventory.js';
import { Crafting } from '../player/crafting.js';
import { InnerMap } from '../world/innerMap.js';
import { CastLines } from '../ui/mapTasks/wildTasks.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});
beforeEach(() => Utils.setSeed(4242));

const angler = (level = 1, inventory = {}) => {
    const p = { name: 'A', inventory: { ...inventory }, skills: {}, practiceSkills: {} };
    if (level > 1) p.practiceSkills.fishing = PracticeSkills.xpForLevel(level);
    return p;
};

describe('reach', () => {
    it('a cut pole and no practice cast 3 tiles, as before', () => {
        const p = angler(1);
        expect(FishingRods.best(p)).toBeNull();
        expect(FishingRods.reach(p)).toBe(3);
        expect(FishingRods.describe(p)).toBe('your cut pole casts 3 tiles');
    });

    it('each rod adds its reach', () => {
        expect(FishingRods.reach(angler(1, { ash_rod: 1 }))).toBe(4);
        expect(FishingRods.reach(angler(1, { greenheart_rod: 1 }))).toBe(5);
        expect(FishingRods.reach(angler(1, { master_rod: 1 }))).toBe(7);
    });

    it('the Fishing level adds +1 at a mid level and +2 at a high one', () => {
        expect(FishingRods.skillReach(angler(4))).toBe(0);
        expect(FishingRods.skillReach(angler(5))).toBe(1);
        expect(FishingRods.skillReach(angler(8))).toBe(2);
        expect(FishingRods.reach(angler(5, { ash_rod: 1 }))).toBe(5);
        expect(FoodSkills.fishing(angler(8)).reach).toBe(2);
    });

    it('is capped', () => {
        const cap = FishingRods.cfg().maxReach;
        expect(cap).toBe(8);
        expect(FishingRods.reach(angler(10, { master_rod: 1 }))).toBe(cap);
        expect(FishingRods.reach(angler(5, { master_rod: 1 }))).toBe(cap);
    });

    it('the best rod in the packs is the one used, with its small edge', () => {
        const p = angler(1, { ash_rod: 2, greenheart_rod: 1 });
        expect(FishingRods.best(p).id).toBe('greenheart_rod');
        const a = FishingRods.angler(p);
        const bare = FoodSkills.fishing(p);
        expect(a.rodName).toBe('greenheart rod');
        expect(a.bites).toBeCloseTo(bare.bites + 0.04);
        expect(a.land).toBeCloseTo(bare.land + 0.06);
        expect(FishingRods.describe(p)).toBe('your greenheart rod casts 5 tiles');
    });
});

describe('a long cast fishes deeper', () => {
    const far = () => FishingRods.cfg().longCast.offshore;
    it('shallow → mid far out from the bank, not near it', () => {
        const p = angler(1);
        expect(FishingRods.castDepth(p, 'shallow', far() - 1)).toBe('shallow');
        expect(FishingRods.castDepth(p, 'shallow', far())).toBe('mid');
    });
    it('mid → deep only with the deep-water perk; deep stays deep', () => {
        expect(FishingRods.castDepth(angler(1), 'mid', far())).toBe('mid');
        expect(FishingRods.castDepth(angler(6), 'mid', far())).toBe('deep');
        expect(FishingRods.castDepth(angler(10), 'deep', far() + 3)).toBe('deep');
    });
});

describe('wear', () => {
    it('each cast wears the rod, a lost fish more; worn out it breaks and the next rod takes over', () => {
        const p = angler(1, { ash_rod: 1, greenheart_rod: 1 });
        const dur = FishingRods.rod('greenheart_rod').durability;
        expect(FishingRods.wear(p).wear).toBe(1);
        expect(FishingRods.wear(p, { lost: true }).wear).toBe(3);
        let res;
        for (let i = 0; i < dur && !(res && res.broke); i++) res = FishingRods.wear(p);
        expect(res.broke).toBe(true);
        expect(res.rod).toBe('greenheart_rod');
        expect(res.next).toBe('ash_rod');
        expect(p.inventory.greenheart_rod).toBeUndefined();
        expect(FishingRods.best(p).id).toBe('ash_rod');
        expect(FishingRods.condition(p).wear).toBe(0);
        expect(FishingRods.reach(p)).toBe(4);
    });

    it('the last rod broken, you fish on with a cut pole', () => {
        const p = angler(1, { ash_rod: 1 });
        p.rodWear = { ash_rod: FishingRods.rod('ash_rod').durability - 1 };
        const res = FishingRods.wear(p);
        expect(res.broke).toBe(true);
        expect(res.next).toBeNull();
        expect(res.nextName).toBe('cut pole');
        expect(FishingRods.reach(p)).toBe(3);
        expect(FishingRods.wear(p).rod).toBeNull();
    });
});

describe('rods as goods', () => {
    const goods = () => DataLoader.get('playerEconomy').GOODS;
    it('are priced, weighed, made by a trade from real inputs and sold on a stall', () => {
        const g = DataLoader._gamedata;
        const recipes = g.markets.recipes;
        const stalls = Object.values(g.marketStalls.trades);
        for (const id of FishingRods.ids()) {
            expect(goods()[id.toUpperCase()].basePrice, id).toBeGreaterThan(0);
            expect(PlayerInventory.itemWeight(id), id).toBeGreaterThan(0);
            expect(g.markets.goods[id], id).toBeTruthy();
            expect(g.markets.supply[id], `${id} is not made from nothing`).toBeUndefined();
            const r = recipes.find(x => x.out && x.out[id]);
            expect(r, id).toBeTruthy();
            for (const inp of Object.keys(r.in)) expect(goods()[inp.toUpperCase()], inp).toBeTruthy();
            expect(stalls.some(s => s && Array.isArray(s.goods) && s.goods.includes(id)), id).toBe(true);
            expect(Crafting.recipes('craft').some(c => c.result && c.result[id]), id).toBe(true);
        }
    });

    it('an ash rod crafts from wood and cord, and sells for more than they cost', () => {
        const rec = Crafting.recipe('ash_rod_craft');
        const cost = Object.entries(rec.ingredients).reduce((s, [id, n]) => s + goods()[id.toUpperCase()].basePrice * n, 0);
        expect(goods().ASH_ROD.basePrice).toBeGreaterThan(cost);
        const p = { name: 'C', intelligence: 8, strength: 6, skills: {}, inventory: { wood: 10, rope: 10 } };
        let made = false;
        for (let i = 0; i < 8 && !made; i++) made = Crafting.craft(p, 'ash_rod_craft').success && (p.inventory.ash_rod || 0) > 0;
        expect(made).toBe(true);
    });
});

describe('the float on the street map', () => {
    // a bank on the left, open water out to the right (x >= 2)
    const lake = (w = 14, h = 7) => {
        const tiles = [];
        for (let r = 0; r < h; r++) {
            tiles.push([]);
            for (let q = 0; q < w; q++) {
                tiles[r].push(q >= 2 ? { q, r, subTerrain: { id: 'lake_water', passable: false } } : { q, r, subTerrain: { id: 'grass', passable: true } });
            }
        }
        return tiles;
    };
    let saved;
    beforeEach(() => {
        saved = { tiles: InnerMap.tiles, width: InnerMap.width, height: InnerMap.height, q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        InnerMap.tiles = lake();
        InnerMap.width = 14;
        InnerMap.height = 7;
        InnerMap.playerInnerQ = 1;
        InnerMap.playerInnerR = 3;
    });
    const restore = () => Object.assign(InnerMap, { tiles: saved.tiles, width: saved.width, height: saved.height, playerInnerQ: saved.q, playerInnerR: saved.r });

    it('lands within the reach, farther with a longer one', () => {
        try {
            const rng = Utils.random.bind(Utils);
            const lands = (reach) => {
                let most = 0;
                for (let i = 0; i < 20; i++) {
                    const to = CastLines.castTo({ reach, rng });
                    const d = Math.max(Math.abs(to.q - 1), Math.abs(to.r - 3));
                    expect(d).toBeLessThanOrEqual(reach);
                    most = Math.max(most, d);
                }
                return most;
            };
            expect(lands(3)).toBe(3);
            expect(lands(8)).toBe(8);
            // and farther out over open water is farther offshore
            expect(CastLines.offshore({ q: 2, r: 3 })).toBe(0);
            expect(CastLines.offshore({ q: 8, r: 3 })).toBe(6);
        } finally { restore(); }
    });

    it('a chosen tile beyond the reach is not cast to; within it, it is', () => {
        try {
            const rng = () => 0;
            expect(CastLines.castTo({ reach: 3, rng, castTarget: { q: 7, r: 3 } })).not.toEqual({ q: 7, r: 3 });
            expect(CastLines.castTo({ reach: 6, rng, castTarget: { q: 7, r: 3 } })).toEqual({ q: 7, r: 3 });
            expect(CastLines.nearestWater({ q: 1, r: 3 }, 8)).toEqual({ q: 2, r: 3 });
        } finally { restore(); }
    });
});
