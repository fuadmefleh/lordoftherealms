// "Why?" explanations (player/causes.js) hold to the engine's own numbers:
// for every market good in every town, across seeds and played days, the
// price decomposition's base + Σ delta + rest + rounding is the listed price
// (Trading.getAvailableGoods), and the factors are the engine's steps; a
// lord's opinion parts sum to NPCLords.getLordOpinion; a realm's stability
// parts to KingdomStability.target; a town's tax factors to
// Taxation.collectTaxes. And explaining changes nothing: the RNG stream and
// the state are untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import { Utils } from '../core/utils.js';
import { Causes } from '../player/causes.js';
import { Trading } from '../player/playerEconomy.js';
import { Economy } from '../world/economy.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomStability } from '../world/kingdomState.js';
import { Taxation } from '../systems/marketDynamics.js';
import { WorldEvents } from '../world/worldEvents.js';
import { loadData, newGame, endDay } from './playtest/harness.js';

const SEEDS = [11, 23, 57];
const games = {};

beforeAll(async () => {
    await loadData();
    for (const seed of SEEDS) {
        const g = newGame(seed);
        for (let i = 0; i < 12; i++) endDay(g);
        games[seed] = g;
    }
}, 120000);

function sumPrice(e) {
    return e.base + e.factors.reduce((s, f) => s + f.delta, 0) + e.rest + e.rounding;
}

function checkTown(world, player, view) {
    const tile = world.getTile(view.q, view.r);
    const s = tile && tile.settlement;
    if (!s) return 0;
    let n = 0;
    for (const entry of Trading.getAvailableGoods(s, tile, world)) {
        const e = Causes.price(world, s, entry.id, player, tile);
        expect(e).toBeTruthy();
        expect(e.price).toBe(entry.price);
        expect(sumPrice(e)).toBeCloseTo(entry.price, 6);
        // the ask base is the product of the reported steps
        const parts = [];
        const ab = Economy.marketAskBase(Economy._goods()[entry.id.toUpperCase()], s, tile, world, parts);
        expect(ab).toBe(entry.askBase);
        expect(parts.reduce((p, f) => p * f.mult, entry.basePrice)).toBe(ab);
        expect(e.you.buy).toBe(Trading.buyCost(player, entry, 1, s));
        expect(e.summary).not.toMatch(/undefined|NaN/);
        n++;
    }
    return n;
}

describe('Causes.price', () => {
    it('sums to the listed price for every good in every town, across seeds', () => {
        for (const seed of SEEDS) {
            const { world, player } = games[seed];
            let n = 0;
            for (const v of world.getSettlementViews()) n += checkTown(world, player, v);
            expect(n).toBeGreaterThan(50);
        }
    });

    it('holds with a fair, a monopoly, debased coin, an event and a guild floor in play', () => {
        const { world, player } = games[SEEDS[0]];
        const v = world.getSettlementViews().find(x => x.kingdom != null) || world.getSettlementViews()[0];
        const tile = world.getTile(v.q, v.r);
        const s = tile.settlement;
        const k = world.getKingdom(s.kingdom);
        const saved = { market: JSON.stringify(s.market.fair || null), mono: s.monopolies, fin: k && k.finance, ev: world.activeEvents };
        s.market.fair = { name: 'Midsummer Fair', ask: 0.9, sell: 0.8, until: world.day + 5 };
        s.monopolies = { grain: { holder: 'crown', holderName: 'The crown', markup: 0.25 } };
        if (k) k.finance = { ...(k.finance || {}), purity: 0.7 };
        world.activeEvents = [...(world.activeEvents || []), { id: 'drought', name: 'Drought', icon: '☀️', effects: { foodPrices: 0.3, prices: 0.05 }, kingdomId: null, daysLeft: 5, text: 'Drought' }];
        try {
            expect(checkTown(world, player, v)).toBeGreaterThan(3);
            const e = Causes.price(world, s, 'grain', player, tile);
            const ids = e.factors.map(f => f.id);
            expect(ids).toEqual(expect.arrayContaining(['fair', 'monopoly', 'events']));
            if (k) expect(ids).toContain('coinage');
            expect(e.factors.find(f => f.id === 'events').label).toMatch(/Drought/);
        } finally {
            s.market.fair = JSON.parse(saved.market);
            if (!s.market.fair) delete s.market.fair;
            s.monopolies = saved.mono;
            if (k) k.finance = saved.fin;
            world.activeEvents = saved.ev;
        }
    });

    it('draws no RNG and writes nothing', () => {
        const { world, player } = games[SEEDS[1]];
        const v = world.getSettlementViews()[0];
        const tile = world.getTile(v.q, v.r);
        const before = JSON.stringify(tile.settlement) + JSON.stringify(player.reckoning || null);
        Utils.setSeed(99);
        const r0 = Utils.random();
        Utils.setSeed(99);
        for (const entry of Trading.getAvailableGoods(tile.settlement, tile, world)) Causes.price(world, tile.settlement, entry.id, player, tile);
        for (const k of world.kingdoms) {
            if (k.lord) Causes.lordOpinion(world, k, player);
            Causes.stability(k, world);
        }
        expect(Utils.random()).toBe(r0);
        expect(JSON.stringify(tile.settlement) + JSON.stringify(player.reckoning || null)).toBe(before);
    });
});

describe('Causes.lordOpinion', () => {
    it('mirrors getLordOpinion part by part, with deeds, kin, a coalition and the clamp', () => {
        for (const seed of SEEDS) {
            const { world, player } = games[seed];
            const lords = world.kingdoms.filter(k => k.isAlive !== false && k.lord);
            expect(lords.length).toBeGreaterThan(0);
            const trials = [
                { karma: 0, renown: 0, gold: 100 },
                { karma: 30, renown: 250, gold: 12000 },
                { karma: -40, renown: 990, gold: 250000 },
            ];
            const saved = { karma: player.karma, renown: player.renown, gold: player.gold, spouse: player.spouse, mak: player.marriageAllianceKingdom, coal: player.coalitions };
            const mem = lords.map(k => k.lord.memory ? JSON.parse(JSON.stringify(k.lord.memory)) : undefined);
            try {
                const deeds = Object.keys(NPCLords.deedDefs());
                lords.forEach((k, i) => {
                    if (deeds.length) NPCLords.rememberDeed(world, k.lord, deeds[i % deeds.length], { day: world.day - 3 });
                    if (deeds.length > 1) NPCLords.rememberDeed(world, k.lord, deeds[(i * 7 + 3) % deeds.length], { day: world.day - 40, note: 'at the ford' });
                });
                player.spouse = { name: 'Ada' };
                player.marriageAllianceKingdom = lords[0].id;
                player.coalitions = { active: { members: { [lords[lords.length - 1].id]: { chill: 12 } } } };
                for (const t of trials) {
                    Object.assign(player, t);
                    for (const k of lords) {
                        const e = Causes.lordOpinion(world, k, player);
                        const want = NPCLords.getLordOpinion(k.lord, player, world);
                        expect(e.opinion).toBe(want);
                        expect(e.factors.reduce((s, f) => s + f.delta, 0)).toBeCloseTo(want, 6);
                        expect(e.total).toBeCloseTo(want + e.bonus + e.reputation, 6);
                        expect(e.summary).not.toMatch(/undefined|NaN/);
                    }
                }
                const e0 = Causes.lordOpinion(world, lords[0], player);
                expect(e0.factors.some(f => f.id === 'kin')).toBe(true);
                const eN = Causes.lordOpinion(world, lords[lords.length - 1], player);
                if (lords.length > 1) expect(eN.factors.some(f => f.id === 'coalition')).toBe(true);
            } finally {
                Object.assign(player, { karma: saved.karma, renown: saved.renown, gold: saved.gold, spouse: saved.spouse, marriageAllianceKingdom: saved.mak, coalitions: saved.coal });
                lords.forEach((k, i) => { k.lord.memory = mem[i]; });
            }
        }
    });
});

describe('Causes.stability and Causes.tax', () => {
    it('stability parts sum to the target', () => {
        for (const seed of SEEDS) {
            const { world } = games[seed];
            for (const k of world.kingdoms) {
                const e = Causes.stability(k, world);
                const t = KingdomStability.target(k, world);
                expect(e.target).toBe(t.value);
                expect(e.base + e.factors.reduce((s, f) => s + f.delta, 0)).toBeCloseTo(t.value, 0);
            }
        }
    });

    it('a town\'s tax factors sum to what collectTaxes would take', () => {
        for (const seed of SEEDS) {
            const { world, player } = games[seed];
            const views = world.getSettlementViews().slice(0, 4);
            const saved = { settlements: player.settlements, rate: player.taxRate, ev: world.activeEvents };
            try {
                player.settlements = views.map(v => ({ q: v.q, r: v.r }));
                world.activeEvents = [...(world.activeEvents || []), { id: 'gold_rush', name: 'Gold rush', effects: { taxIncome: 0.2 }, kingdomId: null, daysLeft: 3, text: 'Gold rush' }];
                for (const rate of ['very_low', 'moderate', 'very_high']) {
                    player.taxRate = rate;
                    const dry = Taxation.collectTaxes(player, world, { dryRun: true });
                    for (const entry of dry.settlements) {
                        const s = world.getTile(entry.q, entry.r).settlement;
                        const e = Causes.tax(world, player, s);
                        expect(e.amount).toBe(entry.collected);
                        expect(e.rated + e.factors.reduce((a, f) => a + f.delta, 0) + e.rest + e.rounding).toBeCloseTo(entry.collected, 6);
                        expect(e.moodParts.reduce((a, p) => a + p.delta, 0)).toBeCloseTo(e.moodTargetExact, 6);
                        expect(e.summary).not.toMatch(/undefined|NaN/);
                    }
                }
            } finally {
                player.settlements = saved.settlements;
                player.taxRate = saved.rate;
                world.activeEvents = saved.ev;
            }
        }
    });
});

it('WorldEvents stays importable here (the event factor reads it)', () => {
    expect(typeof WorldEvents.getModifier).toBe('function');
});
