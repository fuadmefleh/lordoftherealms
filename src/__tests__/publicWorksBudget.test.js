/**
 * A public work's budget (systems/publicWorks.js, 2026-11-25). The player's
 * report: "I'll add thousands of coins to a project budget and they will be
 * spent by the next day." A work's budget is held by its paymaster and drawn
 * down at the work's pace — the day's wages into the site town, the day's
 * stone and timber bought from the markets — never past what the work still
 * needs (Add funds takes at most what is left to do, with the reserve), and
 * what is left comes back on completion or abandonment. Every coin is in the
 * work's books: funded = spent + refunded + budget left; spent = wages +
 * materials = what the towns were paid.
 *
 * A small hand-built world as transport.test.js: four towns on one road along
 * r = 5, a river at (11,5) between B and C.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Transport } from '../world/transport.js';
import { PublicWorks } from '../systems/publicWorks.js';
import { SettlementMarket } from '../world/settlementMarket.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
});
beforeEach(() => Transport.setEnabled(true));

const PLAINS = { id: 'plains', passable: true, moveCost: 2 };

// (the crown's chests below the roads' upkeep floor: its weekly upkeep stays out of the sums)
function makeWorld() {
    const W = 24, H = 12;
    const tiles = [];
    for (let r = 0; r < H; r++) {
        const row = [];
        for (let q = 0; q < W; q++) row.push({ q, r, terrain: PLAINS, regionId: 1, kingdom: 'k1', elevation: 0.5 });
        tiles.push(row);
    }
    for (let q = 2; q <= 20; q++) tiles[5][q].hasRoad = true;
    tiles[5][11].hasRiver = true;
    const kingdom = { id: 'k1', name: 'Testland', isAlive: true, treasury: 300, wars: [], finance: { debtRatio: 0, missed: 0 } };
    const mk = (name, q, type, population) => {
        const s = { name, q, r: 5, type, population, kingdom: 'k1', economy: { tradeIncome: 0, gold: 2000 } };
        tiles[5][q].settlement = s;
        return s;
    };
    const towns = [mk('Aston', 2, 'town', 3000), mk('Brill', 8, 'town', 3000), mk('Cobb', 14, 'village', 600), mk('Dunn', 20, 'village', 500)];
    const world = {
        width: W, height: H, day: 40, tiles, units: [], kingdoms: [kingdom], events: [],
        generationParams: { seed: 'pw-budget' },
        getTile(q, r) { return r < 0 || r >= H ? null : tiles[r][((q % W) + W) % W]; },
        getSettlementViews() { return towns; },
        getAllSettlements() { return towns; },
        getKingdom(id) { return id === 'k1' ? kingdom : null; },
    };
    for (const s of towns) SettlementMarket.ensure(s);
    for (const s of towns) { s.market.stock.stone = 80; s.market.stock.wood = 80; s.market.stock.iron = 20; }
    return { world, kingdom, towns };
}

/** All the coin in this little world: the player, the towns, the crown, the works' budgets. */
const coin = (g, player) => player.gold + g.towns.reduce((a, t) => a + t.economy.gold, 0) + g.kingdom.treasury
    + PublicWorks.works(g.world).reduce((a, w) => a + (w.budget || 0), 0);

function canal(g, player) {
    const res = PublicWorks.commission(g.world, player, 'canal', '8,5|14,5', { by: 'player' });
    expect(res.success).toBe(true);
    return res.work;
}

const day = (g, player, d) => { g.world.day = d; PublicWorks.processDay(g.world, player); };

describe('a public work draws its budget at its pace', () => {
    it('thousands put into a canal are not spent by the next day: a day takes about a day\'s wages and materials', () => {
        const g = makeWorld();
        const player = { gold: 20000, financeToday: {} };
        const w = canal(g, player);
        // (its first budget all but run out: the player tops it up with thousands)
        const back = w.budget - 5;
        player.gold += back;
        w.budget = 5;
        w.book.funded -= back;
        const add = PublicWorks.fund(g.world, player, w.id, 3000);
        expect(add.success).toBe(true);
        expect(add.amount).toBeGreaterThan(2000);
        const held = w.budget;
        const o = PublicWorks.outlook(g.world, w);
        for (let d = 41; d <= 43; d++) day(g, player, d);
        const spent3 = held - w.budget;
        // (a day of the canal: its hands' wages and a 150th of its stone — not thousands)
        expect(spent3).toBeGreaterThan(0);
        expect(spent3).toBeLessThan(3 * o.daily * 1.6 + 1);
        expect(w.budget / held).toBeGreaterThan(0.95);
        // The books say where it went: wages to the site town, stone from the markets
        const b = w.book;
        expect(b.days).toHaveLength(3);
        expect(b.days[0].wageTown).toBe('Brill');
        expect(b.days[0].goods.some(x => x.g === 'stone' && x.n > 0 && x.gold > 0)).toBe(true);
        // ...and how long the budget lasts at that burn: months, and it covers the rest of the work
        const o2 = PublicWorks.outlook(g.world, w);
        expect(o2.burn).toBeGreaterThan(0);
        expect(o2.lastsDays).toBeGreaterThan(100);
        expect(o2.covers).toBe(true);
    });

    it('Add funds takes no more than what is left to do (with the reserve): overfunding is impossible', () => {
        const g = makeWorld();
        const player = { gold: 100000, financeToday: {} };
        const w = canal(g, player);
        const room = PublicWorks.fundRoom(g.world, w);
        // (the commission's budget already holds the estimate and its reserve)
        expect(room).toBeLessThan(w.est * 0.2);
        const gold0 = player.gold;
        const res = PublicWorks.fund(g.world, player, w.id, 50000);
        if (room > 0) {
            expect(res.success).toBe(true);
            expect(res.amount).toBe(room);
            expect(gold0 - player.gold).toBe(room);
        }
        const again = PublicWorks.fund(g.world, player, w.id, 50000);
        expect(again.success).toBe(false);
        expect(w.budget).toBeLessThanOrEqual(Math.ceil(PublicWorks.outlook(g.world, w).toFinish * 1.15) + 1);
    });

    it('a stalled work takes what it needs, and builds again at its pace', () => {
        const g = makeWorld();
        const player = { gold: 20000, financeToday: {} };
        const w = canal(g, player);
        // (the money run out)
        const back = w.budget;
        player.gold += back;
        w.budget = 0;
        w.book.funded -= back;
        day(g, player, 41);
        expect(w.status).toBe('stalled');
        expect(w.stall).toBe('funds');
        const res = PublicWorks.fund(g.world, player, w.id, 1000);
        expect(res.success).toBe(true);
        expect(w.status).toBe('building');
        day(g, player, 42);
        expect(w.status).toBe('building');
        expect(w.budget).toBeGreaterThan(1000 - PublicWorks.outlook(g.world, w).daily * 2);
    });
});

describe('every coin of a work is accounted for', () => {
    it('to completion: funded = spent + refunded; spent = wages + materials = paid into the towns; the coin closes', () => {
        const g = makeWorld();
        const player = { gold: 5000, financeToday: {} };
        const seg = Transport.segments(g.world).find(s => (s.a.s === g.towns[0] && s.b.s === g.towns[1]) || (s.a.s === g.towns[1] && s.b.s === g.towns[0]));
        const c0 = coin(g, player);
        const res = PublicWorks.commission(g.world, player, 'upgrade_highway', seg.key, { by: 'player' });
        expect(res.success).toBe(true);
        const w = res.work;
        PublicWorks.fund(g.world, player, w.id, 40);
        for (let d = 41; d < 41 + w.days * 3 && w.status !== 'done'; d++) day(g, player, d);
        expect(w.status).toBe('done');
        const b = w.book;
        expect(w.budget).toBe(0);
        expect(b.funded).toBeCloseTo(w.spent + b.refunded, 2);
        const goodsGold = Object.values(b.goods).reduce((a, e) => a + e.gold, 0);
        expect(b.wages + goodsGold).toBeCloseTo(w.spent, 1);
        expect(Object.values(b.towns).reduce((a, v) => a + v, 0)).toBeCloseTo(w.spent, 1);
        // (the estimate held: it spent about what was quoted, never the reserve and more)
        expect(w.spent).toBeLessThanOrEqual(b.funded);
        expect(coin(g, player)).toBeCloseTo(c0, 2);
    });

    it('abandoned: what is left of the budget comes back, funded = spent + refunded, the coin closes', () => {
        const g = makeWorld();
        const player = { gold: 20000, financeToday: {} };
        const c0 = coin(g, player);
        const w = canal(g, player);
        PublicWorks.fund(g.world, player, w.id, 500);
        for (let d = 41; d <= 45; d++) day(g, player, d);
        const left = w.budget;
        const res = PublicWorks.abandon(g.world, player, w.id);
        expect(res.success).toBe(true);
        expect(w.book.refunded).toBeCloseTo(left, 2);
        expect(w.book.funded).toBeCloseTo(w.spent + w.book.refunded, 2);
        expect(coin(g, player)).toBeCloseTo(c0, 2);
    });

    it('waiting on materials only a skeleton crew is paid (idleWage of the day\'s wages)', () => {
        const g = makeWorld();
        const player = { gold: 20000, financeToday: {} };
        const w = canal(g, player);
        for (const s of g.towns) { s.market.stock.stone = 0; s.market.stock.wood = 0; s.market.stock.iron = 0; }
        let idle = null;
        for (let d = 41; d < 80 && !idle; d++) {
            day(g, player, d);
            if (w.stall === 'materials') idle = w.book.days[w.book.days.length - 1];
        }
        expect(idle).not.toBe(null);
        const full = PublicWorks.outlook(g.world, w).wageDay;
        expect(idle.wages).toBeCloseTo(full * Transport.config().build.idleWage, 1);
    });
});
