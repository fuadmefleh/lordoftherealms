// Shields and helms for a realm at peace (world/realmArms.js buying out of
// its towns' stock; data/markets.json: the shieldwright, the helm-smith and
// the charcoal helm-forge). A crown stripped of every shield and helm re-arms
// within a few years out of its own towns' armourers, from the towns' own
// iron, coal, firewood, planks and hides, paying the towns' purses for every
// piece, and the shields' and helms' prices neither crash nor soar.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData, newGame } from './playtest/harness.js';
import { Utils } from '../core/utils.js';
import { RealmArms } from '../world/realmArms.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { MarketDynamics, Taxation } from '../systems/marketDynamics.js';
import { Fiscal } from '../systems/fiscal.js';

beforeAll(async () => {
    await loadData();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => vi.restoreAllMocks());

const DAYS_A_YEAR = 120;

/** The world's day as the realms and their towns live it: the AI, the markets, the crowns' dues (harness endDay's order). */
function day(world, player) {
    world.advanceDay(player);
    MarketDynamics.updatePrices(world, null);
    Fiscal.processDay(world, null);
    if (world.day % 7 === 0) Taxation.collectTaxes(player, world);
}

function priceRatio(k, world, id) {
    const good = RealmArms._good(id);
    const r = [];
    for (const t of RealmArms._towns(k, world)) {
        if (!SettlementMarket.uses(t.s, id)) continue;
        r.push(Economy.marketPrice(good, t.s, t.tile, world) / good.basePrice);
    }
    r.sort((a, b) => a - b);
    return r.length ? r[Math.floor(r.length / 2)] : 1;
}

describe('a realm at peace keeps its army in shields and helms', () => {
    it('stripped of every shield and helm, it re-arms within three years out of its own towns, at a real cost', () => {
        Utils.setSeed(101);
        const game = newGame(101);
        const { world, player } = game;
        // A world at peace: no realm opens a war, the wars of the start are ended
        vi.spyOn(KingdomAI, 'considerWar').mockImplementation(() => {});
        vi.spyOn(KingdomAI, 'considerPlayerRealm').mockImplementation(() => {});
        for (const k of world.kingdoms) if (k) k.wars = [];
        // A few days for the markets to open and the armies to settle
        for (let d = 0; d < 8; d++) day(world, player);
        const towns = (k) => RealmArms._towns(k, world).filter(t => t.s.type !== 'village');
        const k = world.kingdoms.filter(x => x && x.isAlive && towns(x).length >= 2)
            .sort((a, b) => towns(b).reduce((s, t) => s + t.s.population, 0) - towns(a).reduce((s, t) => s + t.s.population, 0))[0];
        expect(k).toBeTruthy();
        const a = RealmArms.state(k);
        a.stock.shield = 0;
        a.stock.helmet = 0;
        const spent0 = Number(a.stats.spent) || 0;
        const bought = { shield: 0, helmet: 0 };
        let full = null;
        for (let d = 0; d < 3 * DAYS_A_YEAR && full == null; d++) {
            for (const x of world.kingdoms) if (x && (x.wars || []).length) x.wars = [];
            const before = { shield: Number(a.stock.shield) || 0, helmet: Number(a.stock.helmet) || 0 };
            day(world, player);
            // (what came into the armoury: bought, since a peace has no field to strip)
            for (const id of ['shield', 'helmet']) bought[id] += Math.max(0, (Number(a.stock[id]) || 0) - before[id]);
            const need = RealmArms.need(k);
            const held = RealmArms.held(k);
            if (held.off.n >= need.slots.off * 0.95 && held.head.n >= need.kits * 0.95) full = d;
        }
        // Kitted again within the three years (a year is 120 days)
        expect(full).not.toBe(null);
        expect(full).toBeLessThan(3 * DAYS_A_YEAR);
        // ...every piece bought from its towns (or abroad), paid out of the treasury
        expect(bought.shield + bought.helmet).toBeGreaterThan(0);
        expect((Number(a.stats.spent) || 0) - spent0).toBeGreaterThan(bought.helmet * 30);
        // A year on at peace: the army stays kitted (its wear made good), and the towns'
        // shields and helms, dear while the crown bought them up, neither crash nor soar
        for (let d = 0; d < DAYS_A_YEAR; d++) {
            for (const x of world.kingdoms) if (x && (x.wars || []).length) x.wars = [];
            day(world, player);
        }
        const need = RealmArms.need(k);
        const held = RealmArms.held(k);
        expect(held.off.n).toBeGreaterThan(need.slots.off * 0.9);
        expect(held.head.n).toBeGreaterThan(need.kits * 0.9);
        for (const id of ['shield', 'helmet']) {
            const p = priceRatio(k, world, id);
            expect(p, id).toBeGreaterThan(0.75);
            expect(p, id).toBeLessThan(1.5);
        }
    }, 600000);
});
