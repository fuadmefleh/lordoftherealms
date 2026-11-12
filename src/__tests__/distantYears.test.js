// Long waits made faster: the distant years of a long interregnum wait
// (player/afterlife.js passDay opts.distant → world._distant, read by
// SettlementMarket.span, Labour, Concessions, Peoples, KingdomStability,
// KingdomAI.updateMilitary, RealmArms, Economy.calculateProduction,
// Infrastructure.hasRoadConnection), and the time skip's view brought up to
// date once at its end (ui/timeSkip.js _settleUi). Timings: the env-gated
// skipSpeed.probe.test.js.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadData, newGame, endDay } from './playtest/harness.js';
import { Afterlife } from '../player/afterlife.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { MarketDynamics } from '../systems/marketDynamics.js';
import { TimeSkip } from '../ui/timeSkip.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Utils } from '../core/utils.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Colonization } from '../world/colonization.js';

beforeAll(async () => {
    await loadData();
}, 120000);

/** A dead player's world, waiting; the afterlife's days on their own seed. */
function interregnum(seed) {
    const game = newGame(seed);
    for (let i = 0; i < 5; i++) endDay(game);
    Afterlife.begin(game.player, game.world, 'test');
    Utils.setSeed(seed * 31 + 7);
    return game;
}

/** Towns' people, purses and stock, and the realms' treasuries, as one string. */
function digest(world) {
    const towns = world.getSettlementViews().map(v => {
        const s = world.getTile(v.q, v.r).settlement;
        const st = Object.values((s.market && s.market.stock) || {}).reduce((a, x) => a + (x > 0 ? x : 0), 0);
        return [v.q, v.r, s.population, Math.round(((s.economy || {}).gold || 0) * 100), Math.round(st * 100)];
    });
    return JSON.stringify([world.day, towns, world.kingdoms.map(k => [k.id, Math.round(k.treasury || 0), k.stability])]);
}

describe('the distant years (a long interregnum wait)', () => {
    it('reads the market span off the world, 0 in the ordinary day', () => {
        expect(SettlementMarket.span(null)).toBe(0);
        expect(SettlementMarket.span({})).toBe(0);
        expect(SettlementMarket.span({ _distant: { marketSpan: 8 } })).toBe(8);
        expect(SettlementMarket.span({ _distant: { marketSpan: 1 } })).toBe(0);
    });

    it('a long wait is distant; a short one is not', () => {
        const D = Afterlife.config().distant;
        expect(D.minDays).toBeGreaterThan(1);
        expect(Afterlife.isDistant(D.minDays)).toBe(true);
        expect(Afterlife.isDistant(D.minDays - 1)).toBe(false);
    });

    it('the markets turn once every span, all together, as that many days', () => {
        const { world } = newGame(5150);
        const span = Afterlife.config().distant.marketSpan;
        world._distant = { marketSpan: span };
        try {
            // (an off day: no market turn)
            world.day = span * 10 + 1;
            expect(MarketDynamics.updatePrices(world, null)).toBeNull();
            // (the span's day: every market at once, worked as `span` days)
            world.day = span * 10;
            expect(MarketDynamics.updatePrices(world, null)).not.toBeNull();
            const views = world.getSettlementViews().map(v => world.getTile(v.q, v.r).settlement).filter(s => s.market);
            expect(views.length).toBeGreaterThan(2);
            for (const s of views) expect(s.market.day).toBe(world.day);
        } finally {
            delete world._distant;
        }
    }, 120000);

    it('is deterministic (same seed, same years), never leaves its mark on the world, and keeps the world whole', () => {
        const a = interregnum(6161);
        for (let i = 0; i < 24; i++) Afterlife.passDay(a.world, a.player, { distant: true });
        expect(a.world._distant).toBeUndefined();
        const b = interregnum(6161);
        for (let i = 0; i < 24; i++) Afterlife.passDay(b.world, b.player, { distant: true });
        expect(digest(b.world)).toBe(digest(a.world));
        // The day by day wait from the same start is a different (but whole) world
        const c = interregnum(6161);
        for (let i = 0; i < 24; i++) Afterlife.passDay(c.world, c.player);
        expect(c.world.day).toBe(a.world.day);
        for (const v of a.world.getSettlementViews()) {
            const s = a.world.getTile(v.q, v.r).settlement;
            expect(s.population).toBeGreaterThan(0);
            for (const x of Object.values((s.market && s.market.stock) || {})) expect(Number.isFinite(x) && x >= 0).toBe(true);
            if (s.economy) expect(Number.isFinite(s.economy.gold)).toBe(true);
        }
    }, 180000);
    it('the coarser steps make and lose no coin (the full census: towns, folk, crowns, coffers, banks, rivals…)', () => {
        const game = interregnum(7171);
        const w = game.world;
        const total = () => CoinCensus.total(w, game.player).total;
        const span = Afterlife.config().distant.marketSpan;
        const every = Afterlife.config().distant.realmEvery;
        w._distant = { ...Afterlife.config().distant };
        w.holdSettlementScan();
        try {
            for (let turn = 0; turn < 3; turn++) {
                w.day = (Math.floor(w.day / span) + 1) * span;
                // A market turn of `span` days: goods for coin between towns, nothing minted or lost
                let before = total();
                MarketDynamics.updatePrices(w, null);
                expect(Math.abs(total() - before)).toBeLessThan(1);
                // A realm's week at once: output, food, armies, fleet, colonies — coin only moves
                before = total();
                for (const k of w.kingdoms) {
                    if (!k.isAlive) continue;
                    KingdomAI.updateEconomy(k, w, {}, every);
                    KingdomAI.updateMilitary(k, w, every);
                    KingdomNavy.updateFleet(k, w, every);
                    Colonization.processKingdomColonies(k, w, {}, null, every);
                }
                expect(Math.abs(total() - before)).toBeLessThan(1);
            }
        } finally {
            w.releaseSettlementScan();
            delete w._distant;
        }
    }, 180000);
});

describe('a time skip settles the view once, at its end (ui/timeSkip.js)', () => {
    it('reachable hexes, stats, minimap; the autosave a day of it was due', () => {
        const save = vi.spyOn(SaveLoad, 'saveGame').mockReturnValue({ success: true });
        try {
            const calls = [];
            const game = {
                world: { day: 9 },
                player: { getReachableHexes: () => { calls.push('reach'); return ['x']; } },
                renderer: {},
                minimap: { invalidate: () => calls.push('minimap') },
                ui: { updateStats: () => calls.push('stats'), showNotification: (t) => calls.push(t) },
            };
            TimeSkip._settleUi(game, { done: 3, saveDue: false });
            expect(calls).toEqual(['reach', 'stats', 'minimap']);
            expect(game.renderer.reachableHexes).toEqual(['x']);
            expect(save).not.toHaveBeenCalled();
            TimeSkip._settleUi(game, { done: 3, saveDue: true });
            expect(save).toHaveBeenCalledTimes(1);
            expect(calls).toContain('Auto-Saved');
            // (nobody to save for: dead)
            game.player._isDead = true;
            TimeSkip._settleUi(game, { done: 3, saveDue: true });
            expect(save).toHaveBeenCalledTimes(1);
        } finally {
            save.mockRestore();
        }
    });
});
