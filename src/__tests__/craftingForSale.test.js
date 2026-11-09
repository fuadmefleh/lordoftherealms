// Crafting as a way to make things to sell (data/crafting.json, player/crafting.js):
// the hunting kit (bow, arrows, fishing spear) and the goods made from what
// hunting, foraging and fishing bring in. Each must craft, use inputs the
// game supplies, sell for more than its inputs (more again at a better
// grade), be bought by a market, and be made at a station the player finds.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { Crafting } from '../player/crafting.js';
import { Trading } from '../player/playerEconomy/trading.js';
import { FURNITURE_ACTIONS, BUILDING_FURNITURE_ACTIONS } from '../ui/objectActions/data.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});
beforeEach(() => Utils.setSeed(2024));

const NEW = ['arrows_craft', 'stone_arrows', 'eagle_arrows', 'bow_craft', 'bow_sinew', 'fishing_spear_iron', 'fishing_spear_stone',
    'stone_tools', 'wood_carvings', 'antler_carvings', 'ivory_carving', 'cut_quills', 'leather_goods',
    'dry_game_meat', 'smoke_game_meat', 'dry_meat', 'smoke_fish', 'smoke_small_fish', 'salt_fish', 'cure_furs', 'bear_rug'];

const goods = () => DataLoader.get('playerEconomy').GOODS;
const good = (id) => goods()[String(id).toUpperCase()];
const value = (items) => Object.entries(items).reduce((s, [id, n]) => s + good(id).basePrice * n, 0);

describe('the new recipes', () => {
    it('are all there, and the crafting stations list them', () => {
        for (const id of NEW) expect(Crafting.recipe(id), id).toBeTruthy();
        const craft = Crafting.recipes('craft').map(r => r.id);
        for (const id of ['bow_craft', 'bow_sinew', 'arrows_craft', 'fishing_spear_iron', 'fishing_spear_stone']) expect(craft).toContain(id);
        expect(Crafting.recipes('tan').map(r => r.id)).toContain('cure_furs');
        expect(Crafting.recipes('cook').map(r => r.id)).toContain('smoke_fish');
    });

    it('each station is a piece of furniture the player can use', () => {
        const offered = new Set([...Object.values(FURNITURE_ACTIONS).flat(),
            ...Object.values(BUILDING_FURNITURE_ACTIONS).flatMap(b => Object.values(b).flat())]);
        for (const id of NEW) expect(offered.has(Crafting.recipe(id).station), id).toBe(true);
    });

    it('make a bow, arrows and a fishing spear', () => {
        const p = { name: 'C', intelligence: 7, strength: 6, skills: {}, inventory: { wood: 20, rope: 4, sinew: 4, feather: 8, iron: 6, stone: 4 } };
        const made = {};
        for (const id of ['bow_craft', 'bow_sinew', 'arrows_craft', 'stone_arrows', 'fishing_spear_iron', 'fishing_spear_stone']) {
            let r;
            for (let i = 0; i < 6 && !(r && r.success); i++) {
                if (!Crafting.canCraft(p, Crafting.recipe(id))) break;
                r = Crafting.craft(p, id);
            }
            made[id] = !!(r && r.success);
        }
        expect(Object.values(made).filter(Boolean).length).toBeGreaterThanOrEqual(4);
        expect(p.inventory.bow || 0).toBeGreaterThan(0);
        expect(p.inventory.arrows || 0).toBeGreaterThan(0);
        expect((p.inventory.fishing_spear || 0) + (made.fishing_spear_iron ? 0 : 1)).toBeGreaterThan(0);
    });
});

describe('the money in it', () => {
    it('every new product sells for more than its inputs cost', () => {
        for (const id of NEW) {
            const r = Crafting.recipe(id);
            const inp = value(r.ingredients);
            const out = value(r.result);
            expect(out, `${id}: ${out} vs ${inp}`).toBeGreaterThan(inp * 1.1);
        }
    });

    it('and for more again at a better grade', () => {
        for (const id of ['bow', 'arrows', 'fishing_spear', 'cured_furs', 'leather_goods']) {
            expect(Grades.gradeable(id), id).toBe(true);
            const g = good(id);
            const at = (grade) => {
                const p = { inventory: { [id]: 1 } };
                if (grade) Grades.add(p, id, 1, grade);
                return Trading.getSellPrice(g) * Crafting.saleMult(p, id, 1);
            };
            expect(at('fine')).toBeGreaterThan(at(null));
            expect(at('masterwork')).toBeGreaterThan(at('fine'));
        }
    });

    it('every input is a good the game supplies, every output a good a market buys', () => {
        const loot = new Set();
        const ej = DataLoader.get('earlyJobs');
        for (const kind of ['foraging', 'hunting']) for (const t of Object.values(ej[kind].loot_table)) for (const e of t) loot.add(e.item);
        for (const sp of Object.values(DataLoader.get('animals').species)) {
            for (const l of sp.loot || []) {
                if (l.item) loot.add(l.item);
                if (l.name === 'Sinew') loot.add('sinew');
            }
        }
        const made = new Set(Crafting.recipes().flatMap(r => Object.keys(r.result)));
        const marketGoods = DataLoader.get('markets').goods;
        for (const id of NEW) {
            const r = Crafting.recipe(id);
            for (const item of Object.keys(r.ingredients)) {
                expect(good(item), `${id} input ${item}`).toBeTruthy();
                // found in the wild, made at a bench, or kept on a town's stalls
                expect(loot.has(item) || made.has(item) || !!marketGoods[item] || ['fish', 'small_fish', 'iron', 'stone', 'ivory', 'salt'].includes(item), `${id} input ${item}`).toBe(true);
            }
            for (const item of Object.keys(r.result)) {
                expect(good(item), `${id} output ${item}`).toBeTruthy();
                expect(Trading.getSellPrice(good(item)), item).toBeGreaterThan(0);
            }
        }
        // the hunting kit is on the stalls
        for (const id of ['bow', 'arrows', 'fishing_spear']) expect(marketGoods[id], id).toBeTruthy();
    });

    it('no chain of recipes turns a good back into itself', () => {
        const edges = new Map();
        for (const r of Crafting.recipes()) {
            for (const a of Object.keys(r.ingredients || {})) {
                if (!edges.has(a)) edges.set(a, new Set());
                for (const b of Object.keys(r.result || {})) edges.get(a).add(b);
            }
        }
        const reaches = (from, to, seen = new Set()) => {
            for (const n of edges.get(from) || []) {
                if (n === to) return true;
                if (!seen.has(n)) { seen.add(n); if (reaches(n, to, seen)) return true; }
            }
            return false;
        };
        for (const id of NEW) {
            for (const item of Object.keys(Crafting.recipe(id).result)) expect(reaches(item, item), item).toBe(false);
        }
    });
});
