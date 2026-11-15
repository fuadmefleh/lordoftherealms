// A capital on the world's first day (2026-11-15, from a browser playthrough:
// Sanctum's market purse fell from ~21.9k to ~12k at the end of day one, and it
// had no guilds).
//
// 1. The institutions that were there before the game began — the underwriters'
//    guilds (systems/underwriting.js) and the rival merchant houses
//    (systems/merchantHouses.js) — are set up on the first day's turn, the same
//    morning the towns open their purses. Their capital was raised out of the
//    seat realm's towns by population, up to 30% (underwriters) and 10% (each
//    house) of each purse: the capital, holding most of the realm's people, paid
//    ~25–45% of its coin. Now, at the opening, that capital is part of the
//    world's opening coin, as the towns' first purses are, and is booked
//    (MoneySupply.leak 'endowment'); later foundings still raise it from purses.
// 2. A town's guilds form at the monthly weighing, every fourth week on the
//    town's weekly slot. The game opens on day 2, so a town on slot 0 or 1 —
//    a capital among them — had no guild until day 28/29. Now a town never yet
//    weighed is weighed on the first day.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Economy } from '../world/economy.js';
import { Guilds } from '../systems/guilds.js';
import { Underwriting } from '../systems/underwriting.js';
import { MerchantHouses } from '../systems/merchantHouses.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

let logSpy, warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

function bigTowns(world) {
    const out = [];
    for (const v of world.getSettlementViews()) {
        const s = world.getTile(v.q, v.r).settlement;
        if (s && (s.type === 'capital' || s.type === 'city') && s.kingdom != null) out.push(s);
    }
    return out;
}

const SEEDS = [101, 202, 303];

describe("a capital's purse on day one", () => {
    for (const seed of SEEDS) {
        it(`seed ${seed}: no capital loses more than 15% of its opening purse on the first day`, () => {
            const g = newGame(seed, { kingdomCount: 4 });
            const caps = bigTowns(g.world).filter(s => s.type === 'capital');
            expect(caps.length).toBeGreaterThan(0);
            // (the purse each opens with: Economy.initSettlement's, which the first day's turn gives it)
            const opening = new Map(caps.map(s => [s, Economy.initSettlement({ type: s.type, population: s.population }).economy.gold]));
            endDay(g);
            for (const s of caps) {
                const open = opening.get(s);
                expect(open).toBeGreaterThan(0);
                expect(s.economy.gold, `${s.name}: ${Math.round(s.economy.gold)} of ${open}`).toBeGreaterThan(open * 0.85);
            }
            // The underwriters and rival houses still stand with their capital, booked as opening coin
            const uw = Underwriting.state(g.player).guilds.filter(x => x.status === 'open');
            const rivals = MerchantHouses.rivals(g.player);
            const endowed = uw.reduce((a, x) => a + x.baseCapital, 0) + rivals.reduce((a, r) => a + r.capital, 0);
            expect(rivals.length).toBeGreaterThan(0);
            for (const r of rivals) expect(r.capital).toBeGreaterThan(0);
            for (const x of uw) expect(x.capital).toBeGreaterThan(0);
            // (the houses have traded a day on theirs since: the books hold what they opened with)
            const booked = g.world.money.leaks.endowment;
            expect(booked).toBeGreaterThanOrEqual(uw.reduce((a, x) => a + x.baseCapital, 0));
            expect(Math.abs(booked - endowed)).toBeLessThan(endowed * 0.05);
        });
    }
});

describe("the great towns' guilds", () => {
    for (const seed of [101, 202, 303, 404, 505]) {
        it(`seed ${seed}: every capital and city has its guilds after the first day, and they are weighed once`, () => {
            const g = newGame(seed, { kingdomCount: 4 });
            endDay(g);
            for (const s of bigTowns(g.world)) {
                const eligible = Object.values(Guilds.defs()).filter(d => Guilds.eligible(s, d));
                if (!eligible.length) continue;
                const gs = Guilds.townGuilds(s) || {};
                expect(Object.keys(gs).length, `${s.name} (${s.type}, slot ${Guilds.slot(s.q, s.r)})`).toBeGreaterThan(0);
                // (only guilds its trades fit)
                for (const id of Object.keys(gs)) expect(eligible.map(d => d.id)).toContain(id);
            }
            // Villages hold none, and a weighed town is not weighed again each day
            const minRank = SettlementMarket._rank(Guilds.config().minType);
            for (const v of g.world.getSettlementViews()) {
                const s = g.world.getTile(v.q, v.r).settlement;
                if (s && SettlementMarket._rank(s.type) < minRank) expect(s.guilds).toBeFalsy();
            }
            const spy = vi.spyOn(Guilds, 'ensureTown');
            endDay(g);
            // (day 3 is a weighing week: only today's slot is weighed)
            const turn = g.world.day % 7;
            for (const call of spy.mock.calls) expect(Guilds.slot(call[1].q, call[1].r)).toBe(turn);
            spy.mockRestore();
        });
    }
});
