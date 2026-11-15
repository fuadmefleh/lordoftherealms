// Troop kits with the new leg, foot and hand slots (systems/arms.js,
// data/arms.json troops): boots for most soldiers, leg harness and gloves
// for the heavier, all small extras on top of the core four — a Common iron
// kit still fights at about 1, and an older save's kit record (no legs, feet
// or hands) at exactly what it did. The realms' armouries keep boots too
// (world/realmArms.js), and the beaten leave theirs on the field.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadData } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { Grades } from '../core/grades.js';
import { Arms } from '../systems/arms.js';
import { RealmArms } from '../world/realmArms.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => Utils.setSeed(1357));

function fighter(over = {}) {
    return {
        name: 'Tester', gold: 2000, health: 100, maxHealth: 100, strength: 6, intelligence: 5, charisma: 5, luck: 5,
        inventory: {}, maxInventory: 80, skills: { combat: 3, leadership: 1 }, army: [], ...over,
    };
}

/** What a kit was worth before the extras: the core four by the spec's weights. */
function coreFactor(unit) {
    const spec = Arms.kitSpec(unit.type);
    let sum = 0;
    for (const s of ['main', 'off', 'head', 'body']) {
        const w = spec.slots[s];
        const def = w && Arms.item(unit.kit[s]);
        if (def) sum += w.w * def.tier * Grades.effectMult(unit.kit.g && unit.kit.g[s] != null ? unit.kit.g[s] : Grades.COMMON);
    }
    return Math.round(Math.min(Arms.config().maxFactor, spec.bare + (1 - spec.bare) * sum) * 100) / 100;
}

describe('troop kits: legs, feet and hands', () => {
    it('most soldiers are issued boots; the heavier leg harness and gloves too, with modest weights', () => {
        const kits = Arms.config().kits;
        const withBoots = Object.values(kits).filter(k => k.slots && k.slots.feet).length;
        expect(withBoots / Object.keys(kits).length).toBeGreaterThan(0.8);
        for (const [id, k] of Object.entries(kits)) {
            const core = ['main', 'off', 'head', 'body'].reduce((t, s) => t + (k.slots[s] ? k.slots[s].w : 0), 0);
            expect(core, id).toBeCloseTo(1, 5);
            const extra = Arms.KIT_EXTRA_SLOTS.reduce((t, s) => t + (k.slots[s] ? k.slots[s].w : 0), 0);
            expect(extra, id).toBeLessThanOrEqual(0.2);
        }
        expect(kits.soldier.slots.feet.classes).toContain('leather');
        expect(kits.knight.slots.legs.classes).toEqual(expect.arrayContaining(['mail', 'plate']));
        expect(Arms.config().market.feet).toEqual(['boots']);
    });

    it('a Common iron kit with boots stays about 1; chausses, boots and gloves a little above', () => {
        const base = { main: 'weapons', off: 'shield', head: 'helmet', body: 'chainmail', g: {}, cond: 100 };
        const plain = { type: 'soldier', kit: { ...base } };
        const booted = { type: 'soldier', kit: { ...base, feet: 'boots' } };
        const full = { type: 'soldier', kit: { ...base, legs: 'padded_chausses', feet: 'boots', hands: 'leather_gloves' } };
        const f0 = Arms.unitFactor(plain);
        expect(Arms.unitFactor(booted)).toBeGreaterThan(f0);
        expect(Arms.unitFactor(booted) - f0).toBeLessThan(0.04);
        expect(Arms.unitFactor(full) - f0).toBeLessThan(0.08);
        // (a gambeson, the munition kit, is about 1 with boots)
        expect(Arms.unitFactor({ type: 'soldier', kit: { ...base, body: 'gambeson', feet: 'boots' } })).toBeGreaterThan(0.95);
        expect(Arms.unitFactor({ type: 'soldier', kit: { ...base, body: 'gambeson', feet: 'boots' } })).toBeLessThan(1.05);
    });

    it('an older save\'s kit record (no legs, feet or hands) fights exactly as it did, and is not "short of arms"', () => {
        const old = { type: 'knight', strength: 20, kit: { main: 'iron_sword', off: 'kite_shield', head: 'steel_helm', body: 'chainmail', g: { main: 1, body: 2 }, cond: 80 } };
        // (at full condition the old formula, at 80 the same worn)
        const fresh = { ...old, kit: { ...old.kit, cond: 100 } };
        expect(Arms.unitFactor(fresh)).toBeCloseTo(coreFactor(fresh), 5);
        expect(Arms.kitGaps(old, { core: true })).toEqual([]);
        expect(Arms.kitGaps(old)).toEqual(['legs', 'feet', 'hands']);
        expect(Arms.kitLabel(old)).not.toMatch(/Boots/);
        // ...and it survives a save untouched
        const back = JSON.parse(JSON.stringify(old));
        expect(Arms.unitFactor(back)).toBe(Arms.unitFactor(old));
    });

    it('issues the missing boots from the packs to an old kit, keeping what he has; he hands them back on dismissal', () => {
        const p = fighter({ inventory: { boots: 2, leather_gloves: 1 } });
        const unit = { type: 'soldier', strength: 10, level: 1, kit: { main: 'weapons', off: 'shield', head: 'helmet', body: 'gambeson', g: {}, cond: 100 } };
        const before = Arms.unitFactor(unit);
        p.army.push(unit);
        const r = Arms.armArmy(p, {});
        expect(r.units).toBe(1);
        expect(unit.kit.feet).toBe('boots');
        expect(unit.kit.hands).toBe('leather_gloves');
        expect(unit.kit.main).toBe('weapons');
        expect(p.inventory.boots).toBe(1);
        expect(Arms.unitFactor(unit)).toBeGreaterThan(before);
        expect(Arms.kitView(unit).feet).toBe('boots');
        // the mending bill counts the boots
        unit.kit.cond = 50;
        const withBoots = Arms.kitMendQuote(p).fee;
        const bare = { ...unit, kit: { ...unit.kit, feet: undefined, hands: undefined } };
        expect(withBoots).toBeGreaterThan(Arms.kitMendQuote(fighter({ army: [bare] })).fee);
        const back = Arms.returnKit(p, unit);
        expect(back.boots).toBe(1);
        expect(p.inventory.boots).toBe(2);
    });

    it('a fresh recruit\'s quote picks boots out of the packs (worn boots stay on the player)', () => {
        const p = fighter({ inventory: { weapons: 1, shield: 1, helmet: 1, gambeson: 1, boots: 1 }, equipment: { feet: { id: 'boots', cond: 100 } } });
        const q = Arms.kitQuote(p, 'soldier');
        expect(q.slots.feet.from).toBe(null);
        p.inventory.boots = 2;
        const q2 = Arms.kitQuote(p, 'soldier');
        expect(q2.slots.feet).toMatchObject({ from: 'pack', id: 'boots' });
        expect(q2.factor).toBeGreaterThan(q.factor);
    });
});

describe('the realms\' boots and the field\'s spoils', () => {
    it('an armoury needs boots for every man; one without them (an older save) fights as it did', () => {
        const k = { id: 77, isAlive: true, military: 400, armoury: null };
        const need = RealmArms.need(k);
        expect(need.slots.feet).toBeCloseTo(need.kits, 5);
        RealmArms.state(k);
        expect(k.armoury.stock.boots).toBeGreaterThan(0);
        const withBoots = RealmArms.factor(k);
        const old = { ...k, armoury: { ...k.armoury, stock: { ...k.armoury.stock } } };
        delete old.armoury.stock.boots;
        const without = RealmArms.factor(old);
        expect(withBoots).toBeGreaterThan(without);
        expect(withBoots - without).toBeLessThan(0.05);
        expect(without).toBeGreaterThan(0.95);
        expect(RealmArms.deficits(old).feet).toBe(Math.floor(need.kits + 0.5));
    });

    it('the beaten leave their boots on the field', () => {
        const p = fighter();
        const from = { weapons: 3, spear: 2, shield: 2, boots: 5 };
        const got = Arms.battleSpoils(p, 200, from);
        expect(got.boots).toBeGreaterThan(0);
        expect(from.boots).toBe(5 - got.boots);
        expect(p.inventory.boots).toBe(got.boots);
    });
});
