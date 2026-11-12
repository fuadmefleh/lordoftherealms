// What the Inventory window lists, under which filter, and in what order
// (ui/inventoryView.js — pure; the categories from data/inventory.json).
import { describe, it, expect } from 'vitest';
import { catalogOf, categoryOf, buildEntries, filterSort, categoryCounts, defaultDir } from '../ui/inventoryView.js';
import fs from 'fs';
import path from 'path';

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/inventory.json'), 'utf8'));
const catalog = catalogOf(data);

const GOODS = {
    bread: { name: 'Bread', icon: '🍞', basePrice: 15 },
    wood: { name: 'Wood', icon: '🌲', basePrice: 4 },
    gems: { name: 'Gems', icon: '💎', basePrice: 120 },
    iron_sword: { name: 'Iron Sword', icon: '⚔️', basePrice: 60 },
    holy_water: { name: 'Holy Water', icon: '💧', basePrice: 40 },
    turnip_seed: { name: 'Turnip Seed', icon: '🌱', basePrice: 2 },
};
const ctx = {
    goodOf: (id) => GOODS[id] || null,
    isArms: (id) => id === 'iron_sword' || id === 'odd_blade',
    isFood: (id) => id === 'bread' || id === 'odd_pie',
    isTreasure: (id) => id === 'holy_water' || id === 'odd_relic',
};

describe('inventory view', () => {
    it('the data names the filters, each good under one', () => {
        expect(catalog.categories.map(c => c.id)).toEqual(['food', 'materials', 'tools', 'arms', 'clothing', 'physic', 'seeds', 'trade', 'valuables']);
        expect(catalog.fallback).toBe('trade');
        const seen = new Map();
        for (const c of data.categories) for (const id of c.items) {
            expect(seen.has(id), `${id} listed under ${seen.get(id)} and ${c.id}`).toBe(false);
            seen.set(id, c.id);
        }
    });

    it('a good falls under its listed kind, else by what it is', () => {
        expect(categoryOf('bread', catalog, ctx)).toBe('food');
        expect(categoryOf('holy_water', catalog, ctx)).toBe('physic');   // listed beats the treasure rule
        expect(categoryOf('odd_blade', catalog, ctx)).toBe('arms');
        expect(categoryOf('odd_pie', catalog, ctx)).toBe('food');
        expect(categoryOf('odd_relic', catalog, ctx)).toBe('valuables');
        expect(categoryOf('turnip_seed', catalog, ctx)).toBe('seeds');
        expect(categoryOf('mystery', catalog, ctx)).toBe('trade');
        // no data at all: the built-in filters still work
        expect(categoryOf('odd_blade', catalogOf(null), ctx)).toBe('arms');
    });

    it('lists the goods carried (not coin, not empty stacks) with name, icon and worth', () => {
        const entries = buildEntries({ bread: 3, gold: 99, wood: 0, gems: 2, strange_thing: 1 }, catalog, ctx);
        expect(entries.map(e => e.id).sort()).toEqual(['bread', 'gems', 'strange_thing']);
        const bread = entries.find(e => e.id === 'bread');
        expect(bread).toMatchObject({ name: 'Bread', icon: '🍞', qty: 3, unitValue: 15, value: 45, category: 'food' });
        expect(entries.find(e => e.id === 'strange_thing')).toMatchObject({ name: 'Strange Thing', icon: '📦', unitValue: 0, category: 'trade' });
        expect(categoryCounts(entries)).toEqual({ all: 3, food: 1, valuables: 1, trade: 1 });
    });

    const inv = { bread: 10, wood: 40, gems: 2, iron_sword: 1, turnip_seed: 5 };
    const entries = buildEntries(inv, catalog, ctx);
    const ids = (list) => list.map(e => e.id);

    it('filters by kind and by a search on name, id or the kind', () => {
        expect(ids(filterSort(entries, { category: 'food' }, catalog))).toEqual(['bread']);
        expect(ids(filterSort(entries, { query: 'SWORD' }, catalog))).toEqual(['iron_sword']);
        expect(ids(filterSort(entries, { query: 'turnip_' }, catalog))).toEqual(['turnip_seed']);
        expect(ids(filterSort(entries, { query: 'valuab' }, catalog))).toEqual(['gems']);
        expect(filterSort(entries, { category: 'food', query: 'wood' }, catalog)).toEqual([]);
    });

    it('sorts by kind, name, quantity, worth and price each — and reverses', () => {
        expect(ids(filterSort(entries, { sort: 'category' }, catalog))).toEqual(['bread', 'wood', 'iron_sword', 'turnip_seed', 'gems']);
        expect(ids(filterSort(entries, { sort: 'name' }, catalog))).toEqual(['bread', 'gems', 'iron_sword', 'turnip_seed', 'wood']);
        expect(ids(filterSort(entries, { sort: 'name', dir: 'desc' }, catalog))[0]).toBe('wood');
        expect(ids(filterSort(entries, { sort: 'qty' }, catalog))).toEqual(['wood', 'bread', 'turnip_seed', 'gems', 'iron_sword']);
        expect(ids(filterSort(entries, { sort: 'value' }, catalog))).toEqual(['gems', 'wood', 'bread', 'iron_sword', 'turnip_seed']);
        expect(ids(filterSort(entries, { sort: 'unitValue' }, catalog))[0]).toBe('gems');
        expect(ids(filterSort(entries, { sort: 'unitValue', dir: 'asc' }, catalog))[0]).toBe('turnip_seed');
        expect(defaultDir('name')).toBe('asc');
        expect(defaultDir('qty')).toBe('desc');
    });
});
