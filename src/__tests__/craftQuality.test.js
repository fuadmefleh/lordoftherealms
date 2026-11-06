// Quality grades of made goods (core/grades.js), the craft skills that set
// them (player/crafting.js), graded market stalls (world/marketGrades.js)
// and the new goods and recipes (data/crafting.json, data/markets.json).
// All seeded.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { Crafting } from '../player/crafting.js';
import { Player } from '../player/player.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Trading } from '../player/playerEconomy/trading.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketGrades } from '../world/marketGrades.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Commissions } from '../systems/commissions.js';
import { Duels } from '../systems/duels.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});

beforeEach(() => Utils.setSeed(777));

function crafter(over = {}) {
    return {
        gold: 1000, health: 60, maxHealth: 100, strength: 5, intelligence: 5, charisma: 5, faith: 5, luck: 5,
        renown: 0, karma: 0, inventory: {}, maxInventory: 40, reputation: {},
        skills: { commerce: 1, combat: 1, leadership: 1, diplomacy: 1, stealth: 1, cartography: 0 },
        ...over,
    };
}

function town(over = {}) {
    const s = { name: 'Testford', type: 'town', population: 3000, kingdom: null, q: 3, r: 4, ...over };
    SettlementMarket.ensure(s);
    return s;
}

const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

describe('the five grades', () => {
    it('poor, common, fine, excellent, masterwork — dearer and better in that order, from data', () => {
        const gs = Grades.list();
        expect(gs.map(g => g.id)).toEqual(['poor', 'common', 'fine', 'excellent', 'masterwork']);
        for (let i = 1; i < gs.length; i++) {
            expect(gs[i].price).toBeGreaterThan(gs[i - 1].price);
            expect(gs[i].effect).toBeGreaterThan(gs[i - 1].effect);
        }
        expect(Grades.priceMult('common')).toBe(1);
        expect(Grades.effectMult('common')).toBe(1);
        expect(DataLoader._gamedata.craftGrades.grades.length).toBe(5);
    });

    it('the odds of each grade sum to one and move up with the score', () => {
        const lo = Grades.distribution(0.8, 0.9);
        const hi = Grades.distribution(3.2, 0.9);
        expect(lo.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
        expect(hi.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
        expect(lo[0]).toBeGreaterThan(hi[0]);
        expect(hi[3] + hi[4]).toBeGreaterThan(lo[3] + lo[4]);
    });
});

describe('crafting skills drive the grade', () => {
    const roll = (level, n = 150) => {
        Utils.setSeed(1234);
        const counts = [0, 0, 0, 0, 0];
        for (let i = 0; i < n; i++) {
            const p = crafter({ inventory: { leather: 2 }, skills: { smithing: 0, leatherwork: level } });
            const r = Crafting.craft(p, 'boots_craft', { building: { type: 'workshop' } });
            if (r.success) counts[r.tier]++;
        }
        return counts;
    };

    it('recipes belong to craft skills; the skill is read from player.skills', () => {
        expect(Crafting.skillOf(Crafting.recipe('weapons_forge'))).toBe('smithing');
        expect(Crafting.skillOf(Crafting.recipe('brew_ale'))).toBe('brewing');
        expect(Crafting.skillOf(Crafting.recipe('sew_clothes'))).toBe('tailoring');
        for (const r of Crafting.recipes()) expect(Crafting.skills()[Crafting.skillOf(r)], r.id).toBeTruthy();
        expect(Crafting.skillLevel(crafter({ skills: { smithing: 4.5 } }), 'smithing')).toBe(4.5);
    });

    it('a master makes better work and less poor work than a novice (seeded)', () => {
        const novice = roll(0);
        const master = roll(9);
        const avg = (c) => c.reduce((s, n, i) => s + n * i, 0) / Math.max(1, total(c));
        expect(avg(master)).toBeGreaterThan(avg(novice) + 1);
        expect(master[0] / Math.max(1, total(master))).toBeLessThan(novice[0] / Math.max(1, total(novice)));
        expect(master[2] + master[3] + master[4]).toBeGreaterThan(novice[2] + novice[3] + novice[4]);
        expect(novice[0]).toBeGreaterThan(0);
        expect(master[3] + master[4]).toBeGreaterThan(0);
    });

    it('is reproducible for a seed', () => {
        expect(roll(5, 40)).toEqual(roll(5, 40));
    });

    it('the odds rise with skill, a workshop, good tools and good inputs', () => {
        const r = Crafting.recipe('chainmail_forge');
        const base = Crafting.odds(crafter({ inventory: { iron_ingot: 2, leather: 1 } }), r, {});
        const skilled = Crafting.odds(crafter({ inventory: { iron_ingot: 2, leather: 1 }, skills: { smithing: 8 } }), r, {});
        expect(skilled.score).toBeGreaterThan(base.score + 1.5);
        expect(skilled.fail).toBeLessThan(base.fail);
        const tooled = crafter({ inventory: { iron_ingot: 2, leather: 1, tools: 1 } });
        const steel = crafter({ inventory: { iron_ingot: 2, leather: 1, steel_tools: 1 } });
        expect(Crafting.odds(steel, r, {}).score).toBeGreaterThan(Crafting.odds(tooled, r, {}).score);
        Grades.add(steel, 'steel_tools', 1, 'masterwork');
        const fineTools = Crafting.odds(steel, r, {}).score;
        expect(fineTools).toBeGreaterThan(Crafting.odds(crafter({ inventory: { iron_ingot: 2, leather: 1, steel_tools: 1 } }), r, {}).score);
        const fineLeather = crafter({ inventory: { iron_ingot: 2, leather: 1 } });
        Grades.add(fineLeather, 'leather', 1, 'excellent');
        expect(Crafting.odds(fineLeather, r, {}).score).toBeGreaterThan(base.score);
        expect(Crafting.odds(crafter(), r, { building: { type: 'blacksmith', isPlayerOwned: true } }).score).toBeGreaterThan(base.score);
    });

    it('crafting trains the recipe\'s skill', () => {
        const p = crafter({ inventory: { wood: 60 } });
        for (let i = 0; i < 20; i++) Crafting.craft(p, 'saw_planks');
        expect(p.skills.carpentry).toBeGreaterThan(0);
        expect(p.skills.smithing).toBeUndefined();
        expect(p.crafting.xp).toBeGreaterThan(0);
    });

    it('an old save\'s single crafting rank seeds the new skills once', () => {
        const p = crafter({ crafting: { xp: 400 } });
        expect(Crafting.skillLevel(p, 'smithing')).toBeGreaterThan(5);
        p.skills.carpentry = 2;
        expect(Crafting.skillLevel(p, 'carpentry')).toBe(2);
        // a practised craft (systems/tradeSkills.js) keeps its XP: an old value never lowers it
        const before = Crafting.skillLevel(p, 'smithing');
        p.skills.smithing = 2;
        expect(Crafting.skillLevel(p, 'smithing')).toBe(before);
    });
});

describe('graded stacks beside the plain inventory', () => {
    it('common is what is left; plain removals use Common first, then Poor', () => {
        const p = crafter({ inventory: { tools: 5 } });
        Grades.add(p, 'tools', 0, 'fine'); // nothing
        p.inventory.tools = 5;
        Grades.add(p, 'tools', 2, 'fine');
        Grades.add(p, 'tools', 1, 'poor');
        expect(Grades.counts(p, 'tools')).toEqual({ poor: 1, common: 2, fine: 2, excellent: 0, masterwork: 0 });
        // an army takes three the plain way: two Common, then the Poor one
        p.inventory.tools = 2;
        expect(Grades.counts(p, 'tools')).toEqual({ poor: 0, common: 0, fine: 2, excellent: 0, masterwork: 0 });
        // you use the best first
        expect(Crafting.consume(p, 'tools', 1)).toBeCloseTo(Grades.effectMult('fine'));
        p.inventory.tools = 1;
        expect(Grades.counts(p, 'tools').fine).toBe(1);
        p.inventory.tools = 0;
        expect(Grades.hasGraded(p, 'tools')).toBe(false);
    });

    it('an old save\'s averaged quality record converts to graded units', () => {
        const p = crafter({ inventory: { weapons: 4, bread: 2 }, craftQuality: { weapons: { n: 4, t: 12 }, bread: { n: 2, t: 0 } } });
        expect(Grades.counts(p, 'weapons').masterwork).toBe(4);
        expect(Grades.counts(p, 'bread').poor).toBe(2);
        expect(p.craftQuality).toBeUndefined();
    });

    it('survives a save and load', () => {
        const p = new Player();
        p.inventory = { chainmail: 3, beer: 6 };
        Grades.add(p, 'chainmail', 1, 'masterwork');
        Grades.add(p, 'chainmail', 1, 'fine');
        Grades.add(p, 'beer', 2, 'poor');
        p.skills.smithing = 4.2;
        const json = JSON.parse(JSON.stringify(SaveLoad.serializePlayer(p)));
        const back = new Player();
        SaveLoad.restorePlayer(json, back);
        expect(back.inventory.chainmail).toBe(3);
        expect(Grades.counts(back, 'chainmail')).toEqual({ poor: 0, common: 1, fine: 1, excellent: 0, masterwork: 1 });
        expect(Grades.counts(back, 'beer').poor).toBe(2);
        expect(back.skills.smithing).toBe(4.2);
    });

    it('a masterwork mail shirt guards better, a fine meal feeds more, fine clothes stay fresh longer', () => {
        const plain = crafter({ inventory: { chainmail: 1 } });
        const mw = crafter({ inventory: { chainmail: 1 } });
        Grades.add(mw, 'chainmail', 1, 'masterwork');
        expect(PlayerEffects.personalDamageMultiplier(mw)).toBeLessThan(PlayerEffects.personalDamageMultiplier(plain));
        expect(Duels.playerArmour(mw, 0, PlayerEffects.craftedQuality(mw))).toBeGreaterThan(Duels.playerArmour(plain, 0, PlayerEffects.craftedQuality(plain)));
        const sword = crafter({ inventory: { steel_sword: 1 } });
        expect(Duels.playerWeapon(sword).id).toBe('steel_sword');
        const meal = crafter({ inventory: { meat_pie: 2 } });
        Grades.add(meal, 'meat_pie', 1, 'excellent');
        expect(Crafting.consume(meal, 'meat_pie', 1)).toBeCloseTo(Grades.effectMult('excellent'));
        const a = new Player();
        a.needsEnabled = true;
        a.inventory = { clothes: 1 };
        const b = new Player();
        b.needsEnabled = true;
        b.inventory = { clothes: 1 };
        Grades.add(b, 'clothes', 1, 'excellent');
        a.clothesFreshness = 100; b.clothesFreshness = 100;
        a.soilClothes(20); b.soilClothes(20);
        expect(b.getClothesFreshness()).toBeGreaterThan(a.getClothesFreshness());
    });
});

describe('soap', () => {
    it('a cake of soap is used up by a wash, and a better one cleans more', () => {
        const a = new Player();
        a.inventory = { soap: 1 };
        const b = new Player();
        b.inventory = { soap: 1 };
        Grades.add(b, 'soap', 1, 'masterwork');
        const sa = a.useSoap(), sb = b.useSoap();
        expect(sa.hygiene).toBeGreaterThan(0);
        expect(sb.hygiene).toBeGreaterThan(sa.hygiene);
        expect(a.inventory.soap).toBeUndefined();
        expect(a.useSoap()).toBeNull();
    });
});

describe('graded goods at market', () => {
    it('a sale fetches the grade\'s price', () => {
        const s = town();
        const sell = (grade) => {
            const p = crafter({ inventory: { tools: 1 } });
            if (grade) Grades.add(p, 'tools', 1, grade);
            const before = JSON.parse(JSON.stringify(s.market));
            const r = Trading.sellGoods(p, 'tools', 1, s, null, grade);
            s.market = before;
            return r;
        };
        const common = sell(null).earned;
        const fine = sell('fine').earned;
        const mw = sell('masterwork').earned;
        expect(common).toBeGreaterThan(0);
        expect(fine / common).toBeCloseTo(Grades.priceMult('fine'), 1);
        expect(mw / common).toBeCloseTo(Grades.priceMult('masterwork'), 1);
        // You can't sell a grade you don't have
        expect(Trading.sellGoods(crafter({ inventory: { tools: 1 } }), 'tools', 1, s, null, 'fine').success).toBe(false);
    });

    it('a sold graded unit goes on the stall as what it is', () => {
        const s = town();
        const p = crafter({ inventory: { tools: 1 } });
        Grades.add(p, 'tools', 1, 'excellent');
        const avail = SettlementMarket.available(s, 'tools');
        const before = MarketGrades.lots(s, 'tools', avail, 0).excellent;
        expect(Trading.sellGoods(p, 'tools', 1, s, null, 'excellent').success).toBe(true);
        expect(MarketGrades.lots(s, 'tools', SettlementMarket.available(s, 'tools'), 0).excellent).toBe(before + 1);
    });

    it('stalls stock mostly Common, some Poor and Fine; buying a grade costs its price and gives that grade', () => {
        const s = town({ type: 'city', population: 20000 });
        const goods = Trading.getAvailableGoods(s, null, { day: 0 });
        const entry = goods.find(g => g.id === 'tools');
        expect(entry && entry.lots).toBeTruthy();
        const L = entry.lots;
        expect(L.common).toBeGreaterThan(L.poor + L.fine + L.excellent + L.masterwork);
        expect(L.poor + L.fine).toBeGreaterThan(0);
        const grade = L.fine > 0 ? 'fine' : 'poor';
        const had = L[grade];
        const p = crafter({ gold: 5000 });
        const commonCost = Trading.buyGradeCost(p, entry, 1, s, 'common');
        const cost = Trading.buyGradeCost(p, entry, 1, s, grade);
        expect(cost).toBe(Math.ceil(commonCost * Grades.priceMult(grade)));
        const r = Trading.buyGoods(p, entry, 1, s, grade);
        expect(r.success).toBe(true);
        expect(r.spent).toBe(cost);
        expect(Grades.counts(p, 'tools')[grade]).toBe(1);
        // the lot went down by one
        expect(MarketGrades.lots(s, 'tools', SettlementMarket.available(s, 'tools'), 0)[grade]).toBe(had - 1);
        // ...and no more of a grade than the stall holds
        expect(Trading.buyGoods(p, entry, 999, s, 'masterwork').success).toBe(false);
    });

    it('towns differ in craftsmanship, and better craftsmen stock more Fine and less Poor', () => {
        const names = ['Ashford', 'Brightwater', 'Coldmere', 'Dunhallow', 'Eastmarch', 'Fairhaven', 'Greywick', 'Highcliff'];
        const levels = names.map((name, i) => MarketGrades.level({ name, type: 'town', q: i, r: i * 2 }));
        expect(new Set(levels).size).toBeGreaterThan(3);
        expect(MarketGrades.level({ name: 'X', type: 'capital', q: 0, r: 0 })).toBeGreaterThan(MarketGrades.level({ name: 'X', type: 'village', q: 0, r: 0 }));
        const lo = MarketGrades.mix(1), hi = MarketGrades.mix(8);
        expect(hi.fine).toBeGreaterThan(lo.fine);
        expect(hi.poor).toBeLessThan(lo.poor);
        expect(lo.masterwork).toBe(0);
        expect(hi.excellent + hi.masterwork).toBeGreaterThan(0);
        expect(hi.excellent + hi.masterwork).toBeLessThan(0.15);
        // the player's works raise the town's craftsmanship for what they make
        const s = town();
        const before = MarketGrades.level(s, 'tools');
        SettlementMarket.setWorks(s, 'smithy', { cap: 1, lvl: 3 });
        expect(MarketGrades.level(s, 'tools')).toBeGreaterThan(before);
        // the lots are a deterministic function of the town, the good and the week
        const a = town(), b = town();
        expect(MarketGrades.lots(a, 'clothes', 200, 3)).toEqual(MarketGrades.lots(b, 'clothes', 200, 3));
    });

    it('hired work comes out in the town\'s grades', () => {
        const s = town({ type: 'city', population: 30000, name: 'Grandmarket' });
        const p = crafter();
        const g = Commissions.gradesFor(p, s, { iron: 100 }, { tools: 200 });
        expect(g.tools).toBeTruthy();
        expect(total(g.tools)).toBeLessThan(200);
        expect(total(g.tools)).toBeGreaterThan(0);
    });
});

describe('the new goods and recipes', () => {
    it('every recipe\'s inputs and products are goods with a price; products are worth making', () => {
        const G = PlayerEconomy.GOODS;
        for (const r of Crafting.recipes()) {
            for (const id of [...Object.keys(r.ingredients), ...Object.keys(r.result)]) {
                expect(G[id.toUpperCase()], `${r.id}: ${id}`).toBeTruthy();
            }
            for (const id of Object.keys(r.result)) expect(G[id.toUpperCase()].basePrice, id).toBeGreaterThan(0);
            expect(r.difficulty, r.id).toBeGreaterThanOrEqual(1);
        }
        expect(Crafting.recipes().length).toBeGreaterThanOrEqual(70);
        // the new recipes add value: what they make is worth more than what goes in
        const ids = ['saw_planks', 'joinery', 'smelt_steel', 'chainmail_forge', 'plate_forge', 'steel_sword_forge', 'boots_craft', 'wool_cloak',
            'fine_garments', 'brew_ale', 'brew_mead', 'press_cider', 'sausage', 'meat_pie', 'make_soap', 'bind_book', 'silver_jewellery', 'gold_jewellery', 'tonic'];
        const worth = (o) => Object.entries(o).reduce((s, [id, n]) => s + G[id.toUpperCase()].basePrice * n, 0);
        for (const id of ids) {
            const r = Crafting.recipe(id);
            expect(r, id).toBeTruthy();
            expect(worth(r.result), id).toBeGreaterThan(worth(r.ingredients));
        }
    });

    it('the markets keep the new goods, and the towns\' new trades use goods the markets keep', () => {
        for (const id of ['planks', 'joinery', 'candles', 'soap', 'rope', 'pottery', 'boots', 'wool_cloak', 'mead', 'cider', 'sausage', 'steel', 'chainmail', 'book']) {
            expect(SettlementMarket.tracks(id), id).toBe(true);
            expect(PlayerEconomy.GOODS[id.toUpperCase()], id).toBeTruthy();
        }
        const recipes = DataLoader._gamedata.markets.recipes;
        for (const id of ['sawyer', 'joiner', 'cobbler', 'butcher', 'steelworks', 'mailer']) {
            const rc = recipes.find(r => r.id === id);
            expect(rc, id).toBeTruthy();
            for (const g of [...Object.keys(rc.in), ...Object.keys(rc.out)]) expect(SettlementMarket.tracks(g), `${id}: ${g}`).toBe(true);
        }
        const s = town({ type: 'city', population: 20000 });
        const listed = Trading.getAvailableGoods(s, null, null).map(g => g.id);
        for (const id of ['planks', 'candles', 'boots', 'glassware']) expect(listed, id).toContain(id);
    });

    it('made goods come in grades; raw goods do not', () => {
        for (const id of ['tools', 'weapons', 'chainmail', 'boots', 'beer', 'joinery', 'meat_pie', 'leather']) expect(Grades.gradeable(id), id).toBe(true);
        for (const id of ['grain', 'iron', 'wood', 'herbs', 'iron_ingot']) expect(Grades.gradeable(id), id).toBe(false);
    });
});
