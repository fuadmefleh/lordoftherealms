// What's inside chests, crates and shelves (systems/containers.js), and
// helping yourself: free in the wilds, theft in someone else's house — caught
// costs a fine and standing, got away leaves the goods hot.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Containers } from '../systems/containers.js';
import { Underworld } from '../systems/underworld.js';
import { Utils } from '../core/utils.js';
import { loadData } from './playtest/harness.js';
import { SettlementMarket } from '../world/settlementMarket.js';

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

describe('a town\'s chests hold what their owners bought', () => {
    /** A town on (5, 7) with a market well stocked with ale, mead and liquor. */
    function townWorld(day = 3) {
        const s = { name: 'Varrholt', type: 'town', population: 2000, kingdom: 'k1', q: 5, r: 7, economy: { gold: 500 } };
        SettlementMarket.ensure(s);
        for (const id of ['beer', 'mead', 'liquor', 'wine', 'cheese']) s.market.stock[id] = 40;
        const tile = { q: 5, r: 7, settlement: s };
        return { day, generationParams: { seed: 4242 }, kingdoms: [], getKingdom: () => null, getTile: (q, r) => (q === 5 && r === 7 ? tile : null), s };
    }
    const tavernBarrel = { ...bankChest, furnitureType: 'barrel', building: { type: 'tavern', q: 10, r: 11, name: 'The Drowned Rat' } };
    const stocked = (w) => {
        for (let i = 0; i < 50; i++) {
            const ctx = { ...tavernBarrel, q: 3 + i };
            const probe = JSON.parse(JSON.stringify(w.s.market.stock));
            if (Object.keys(Containers.stocked(w, ctx)).length) { w.s.market.stock = probe; return ctx; }
        }
        throw new Error('no stocked barrel');
    };

    it('the owner fills the barrel out of the town\'s market stock, and the coin stays in town', () => {
        const w = townWorld();
        const ctx = stocked(w);
        const market = { ...w.s.market.stock };
        const gold = w.s.economy.gold;
        const inside = Containers.contents(null, w, ctx);
        expect(Object.keys(inside).length).toBeGreaterThan(0);
        for (const [id, n] of Object.entries(inside)) expect(w.s.market.stock[id]).toBeCloseTo(market[id] - n, 5);
        expect(w.s.economy.gold).toBe(gold);
        // Looking again takes nothing more
        const after = { ...w.s.market.stock };
        expect(Containers.contents(null, w, ctx)).toEqual(inside);
        expect(w.s.market.stock).toEqual(after);
    });

    it('a theft leaves the owner short; the next restock buys it again from the market', () => {
        const w = townWorld();
        const p = player();
        const ctx = stocked(w);
        const [id, n] = Object.entries(Containers.contents(p, w, ctx))[0];
        Utils.setRng(() => 0.999);
        const res = Containers.steal(p, w, ctx, id, n, { hour: 2 });
        Utils.resetRng();
        expect(res.ok).toBe(true);
        expect(Containers.contents(p, w, ctx)[id]).toBeUndefined();
        expect(w.s.larders[Containers.key(ctx)].stolen[id]).toBe(n);
        // Two weeks on, the owner buys it in again
        const w2 = { ...w, day: w.day + 14 };
        const market = w.s.market.stock[id];
        const again = Containers.contents(p, w2, ctx);
        const want = Containers.stocked(w2, ctx)[id] || 0;
        expect(again[id] || 0).toBe(want);
        expect(w.s.market.stock[id]).toBeCloseTo(market - want, 5);
    });

    it('an empty market leaves the owner\'s barrel empty', () => {
        const w = townWorld();
        const ctx = stocked(w);
        for (const id of Object.keys(w.s.market.stock)) w.s.market.stock[id] = 0;
        expect(Containers.contents(null, w, ctx)).toEqual({});
    });

    it('heirlooms no market trades are there from the first look, and never come back once taken', () => {
        const w = townWorld();
        const p = player();
        let ctx = null;
        for (let i = 0; i < 80 && !ctx; i++) {
            const c = { ...bankChest, q: i };
            if (Containers.contents(null, w, c).ancient_coin) ctx = c;
        }
        expect(ctx).not.toBeNull();
        const n = Containers.contents(p, w, ctx).ancient_coin;
        Utils.setRng(() => 0.999);
        expect(Containers.steal(p, w, ctx, 'ancient_coin', n, { hour: 2 }).ok).toBe(true);
        Utils.resetRng();
        for (let k = 1; k <= 4; k++) expect(Containers.contents(p, { ...w, day: w.day + 14 * k }, ctx).ancient_coin).toBeUndefined();
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
