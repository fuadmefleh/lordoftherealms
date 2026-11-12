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

describe('the market stall\'s produce follows the season', () => {
    const stall = { worldQ: 5, worldR: 7, q: 3, r: 2, furnitureType: 'stall', building: null, inSettlement: false };
    const marketCrate = { ...bankChest, furnitureType: 'crate', building: { type: 'marketplace', q: 20, r: 21, name: 'Market Hall' }, inSettlement: false };
    // Days of the year: spring 1-30, summer 31-60, autumn 61-90, winter 91-120 (a period starting in it)
    const SEASON_DAY = { Spring: 1, Summer: 43, Autumn: 71, Winter: 99 };
    const seen = (base, day) => {
        const out = new Set();
        for (let i = 0; i < 120; i++) for (const id of Object.keys(Containers.stocked(world(day), { ...base, q: i }))) out.add(id);
        return out;
    };

    it('no generic fruit: stalls and the market hall hold named produce the market trades', () => {
        const rows = [...Containers.data().loot.stall, ...Containers.data().byBuilding.marketplace.crate];
        expect(rows.map(r => r[0])).not.toContain('fruit');
        for (const [pool, bySeason] of Object.entries(Containers.data().pools)) {
            for (const [season, list] of Object.entries(bySeason)) {
                for (const [id] of list) expect(SettlementMarket.tracks(id), `${pool}.${season}: ${id}`).toBe(true);
            }
        }
        for (const base of [stall, marketCrate]) {
            const ids = seen(base, SEASON_DAY.Autumn);
            expect(ids.has('fruit')).toBe(false);
            expect([...ids].some(id => id.startsWith('@'))).toBe(false);
            for (const id of ids) expect(Containers.good(id).basePrice, id).toBeGreaterThan(0);
        }
    });

    it('apples and pears after the harvest, cherries and plums in summer, no cherries in winter', () => {
        expect(Containers.periodSeason(world(SEASON_DAY.Autumn))).toBe('Autumn');
        const autumn = seen(stall, SEASON_DAY.Autumn), summer = seen(stall, SEASON_DAY.Summer), winter = seen(stall, SEASON_DAY.Winter);
        expect(autumn.has('apples')).toBe(true);
        expect(summer.has('cherries') || summer.has('plums')).toBe(true);
        expect(winter.has('cherries')).toBe(false);
        expect(winter.has('plums')).toBe(false);
        // The same box holds the same things all period (the season of the period's first day)
        const ctx = { ...stall, q: 7 };
        expect(Containers.stocked(world(SEASON_DAY.Summer), ctx)).toEqual(Containers.stocked(world(SEASON_DAY.Summer + 2), ctx));
    });

    it('in a town the stallholder buys the produce from the market: none in the market, none on the stall', () => {
        const s = { name: 'Varrholt', type: 'town', population: 2000, kingdom: 'k1', q: 5, r: 7, economy: { gold: 500 } };
        SettlementMarket.ensure(s);
        const tile = { q: 5, r: 7, settlement: s };
        const w = { ...world(SEASON_DAY.Autumn), getTile: (q, r) => (q === 5 && r === 7 ? tile : null) };
        const inTown = { ...stall, inSettlement: true };
        let ctx = null;
        for (let i = 0; i < 80 && !ctx; i++) if (Containers.stocked(w, { ...inTown, q: i }).apples) ctx = { ...inTown, q: i };
        expect(ctx).not.toBeNull();
        const apples = SettlementMarket.stock(s, 'apples');
        const n = Containers.contents(null, w, ctx).apples;
        expect(n).toBeGreaterThan(0);
        expect(SettlementMarket.stock(s, 'apples')).toBeCloseTo(apples - n, 5);
        const s2 = { ...s, larders: {}, market: { ...s.market, stock: { ...s.market.stock, apples: 0 } } };
        const w2 = { ...w, getTile: (q, r) => (q === 5 && r === 7 ? { ...tile, settlement: s2 } : null) };
        expect(Containers.contents(null, w2, ctx).apples).toBeUndefined();
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
