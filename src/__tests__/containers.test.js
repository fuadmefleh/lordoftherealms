// What's inside chests, crates and shelves (systems/containers.js), and
// helping yourself: free in the wilds, theft in someone else's house — caught
// costs a fine and standing, got away leaves the goods hot.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Containers } from '../systems/containers.js';
import { Underworld } from '../systems/underworld.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

const world = (day = 3) => ({ day, generationParams: { seed: 4242 }, kingdoms: [], getKingdom: () => null, getTile: () => null });
const player = () => ({ gold: 500, inventory: {}, skills: { stealth: 1 }, reputation: { k1: 0 } });
const bankChest = { worldQ: 5, worldR: 7, q: 3, r: 2, furnitureType: 'chest', building: { type: 'bank', q: 40, r: 41, name: 'Bank' }, inSettlement: true, kingdom: 'k1', settlementName: 'Varrholt' };

/** A context whose container holds something under this world's seed. */
function stockedCtx(base, w) {
    for (let i = 0; i < 50; i++) {
        const ctx = { ...base, q: base.q + i };
        if (Object.keys(Containers.contents(null, w, ctx)).length) return ctx;
    }
    throw new Error('no stocked container found');
}

describe('container contents', () => {
    it('the same chest holds the same things until it restocks, then something new', () => {
        const w = world(3);
        const ctx = stockedCtx(bankChest, w);
        const a = Containers.contents(null, w, ctx);
        expect(Containers.contents(null, world(5), ctx)).toEqual(a);
        let differs = false;
        for (let p = 1; p < 8 && !differs; p++) {
            differs = JSON.stringify(Containers.contents(null, world(3 + p * 14), ctx)) !== JSON.stringify(a);
        }
        expect(differs).toBe(true);
    });

    it('draws only goods the market knows, from the building\'s own table', () => {
        const w = world();
        const goods = new Set(Object.values(Containers.data().loot).flat().map(r => r[0]));
        const bank = new Set(Containers.data().byBuilding.bank.chest.map(r => r[0]));
        for (let i = 0; i < 30; i++) {
            for (const id of Object.keys(Containers.contents(null, w, { ...bankChest, q: i }))) {
                expect(bank.has(id)).toBe(true);
                expect(Containers.good(id).basePrice).toBeGreaterThan(0);
            }
        }
        expect(goods.size).toBeGreaterThan(5);
    });

    it('rolling contents leaves the game\'s dice alone', () => {
        Utils.setSeed(9);
        const before = Utils.random();
        Utils.setSeed(9);
        Containers.contents(null, world(), bankChest);
        expect(Utils.random()).toBe(before);
    });
});

describe('who may take what', () => {
    it('own, free and steal', () => {
        expect(Containers.access({ ...bankChest, building: { type: 'player_house' } })).toBe('own');
        expect(Containers.access({ ...bankChest, building: { type: 'house', isPlayerOwned: true } })).toBe('own');
        expect(Containers.access({ ...bankChest, building: null, inSettlement: false })).toBe('free');
        expect(Containers.access({ ...bankChest, building: { type: 'ruin' } })).toBe('free');
        expect(Containers.access(bankChest)).toBe('steal');
        expect(Containers.access({ ...bankChest, building: null })).toBe('steal');
    });

    it('free goods are simply taken, and stay taken this period', () => {
        const w = world();
        const p = player();
        const ctx = stockedCtx({ ...bankChest, building: null, inSettlement: false, furnitureType: 'crate' }, w);
        const [id, n] = Object.entries(Containers.contents(p, w, ctx))[0];
        const res = Containers.take(p, w, ctx, id, n);
        expect(res.ok).toBe(true);
        expect(p.inventory[id]).toBe(n);
        expect(Containers.contents(p, w, ctx)[id]).toBeUndefined();
        expect(Containers.take(p, w, ctx, id, 1).ok).toBe(false);
        expect(Containers.take(p, w, bankChest, id, 1).ok).toBe(false);
    });
});

describe('stealing', () => {
    it('watchers, guards and the owner raise the odds; night and stealth lower them', () => {
        const p = player();
        const quiet = Containers.stealOdds(p, bankChest, 'candles', 1, { hour: 12 }).chance;
        expect(Containers.stealOdds(p, bankChest, 'candles', 1, { hour: 12, witnesses: 2 }).chance).toBeGreaterThan(quiet);
        expect(Containers.stealOdds(p, bankChest, 'candles', 1, { hour: 12, guards: 1 }).chance).toBeGreaterThan(quiet);
        expect(Containers.stealOdds(p, bankChest, 'candles', 1, { hour: 12, ownerInside: true }).chance).toBeGreaterThan(quiet);
        expect(Containers.stealOdds(p, bankChest, 'candles', 1, { hour: 2 }).chance).toBeLessThan(quiet);
        expect(Containers.stealOdds({ ...p, skills: { stealth: 6 } }, bankChest, 'candles', 1, { hour: 12 }).chance).toBeLessThan(quiet);
        expect(Containers.stealOdds(p, bankChest, 'gold_bar', 1, { hour: 12 }).chance).toBeGreaterThan(quiet);
    });

    it('getting away: the goods are yours, hot, and the realm grows warmer', () => {
        const w = world();
        const p = player();
        const ctx = stockedCtx(bankChest, w);
        const [id] = Object.keys(Containers.contents(p, w, ctx));
        Utils.setRng(() => 0.999);
        const res = Containers.steal(p, w, ctx, id, 1, { hour: 2 });
        Utils.resetRng();
        expect(res.ok).toBe(true);
        expect(p.inventory[id]).toBe(1);
        expect(Underworld.hotQty(p, id, w.day)).toBe(1);
        expect(Underworld.getHeat(p, 'k1')).toBeGreaterThan(0);
    });

    it('caught: nothing gained, a fine, lost standing — and the watch from the third time', () => {
        const w = world();
        const p = player();
        const ctx = stockedCtx(bankChest, w);
        const [id, n] = Object.entries(Containers.contents(p, w, ctx))[0];
        Utils.setRng(() => 0);
        const first = Containers.steal(p, w, ctx, id, 1, { hour: 12, witnesses: 3 });
        expect(first.caught).toBe(true);
        expect(p.inventory[id]).toBeUndefined();
        expect(p.gold).toBeLessThan(500);
        expect(p.reputation.k1).toBeLessThan(0);
        expect(Containers.contents(p, w, ctx)[id]).toBe(n);
        expect(p.jailState).toBeUndefined();
        Containers.steal(p, w, ctx, id, 1, {});
        const third = Containers.steal(p, w, ctx, id, 1, {});
        Utils.resetRng();
        expect(third.jailDays).toBeGreaterThan(0);
        expect(p.jailState && p.jailState.offense).toBe('theft');
        expect(p.criminalRecord.theft).toBe(3);
    });
});
