/**
 * Minting and debasement (2026-11; world/moneySupply.js, world/coinage.js,
 * systems/finance.js, systems/mints.js): coin is struck only against the
 * metal the mint takes in; a debasement lowers the mint's standard at once but
 * the coin in hand only week by week, as the old finer pieces are restruck (the
 * crown keeps the extra pieces), so prices rise gradually; people hoard the
 * good old coin meanwhile; clippers shave the pieces and sell the silver; the
 * changers' spread is friction on trade across the border; a coin people do
 * not trust sours the towns; a recoinage ends it all at a cost; crowns debase
 * and recoin by their temper, the player's treasurers only when allowed; and
 * all of it saves and loads.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Coinage } from '../world/coinage.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Mints } from '../systems/mints.js';
import { Finance } from '../systems/finance.js';
import { CoinCensus } from '../systems/coinCensus.js';
import { loadData, newGame, endDay, roundTrip } from './playtest/harness.js';

beforeAll(async () => {
    await loadData();
});

let _saved = null;
function patch(path, value) {
    if (!_saved) _saved = JSON.parse(JSON.stringify(DataLoader._gamedata.mints));
    const d = JSON.parse(JSON.stringify(DataLoader._gamedata.mints));
    const keys = path.split('.');
    let o = d;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    DataLoader._gamedata.mints = d;
}
afterEach(() => {
    if (_saved) DataLoader._gamedata.mints = _saved;
    _saved = null;
});

const realm = (id, name, pop, extra = {}) => ({
    id, name, isAlive: true, population: pop, treasury: 10000, wars: [], capital: null, territory: [], stability: 50,
    finance: { purity: 1, debt: [], debtRatio: 0, missed: 0, unpaid: 0, defaults: 0, lastDefaultDay: null }, ...extra,
});

function bare(realms, day = 7) {
    const tiles = new Map();
    return {
        day, kingdoms: realms, generationParams: { seed: 4242 },
        getKingdom(id) { return this.kingdoms.find(k => k.id === id); },
        getSettlementViews() { return [...tiles.values()].filter(t => t.settlement).map(t => t.settlement); },
        getTile(q, r) { return tiles.get(`${q},${r}`) || null; },
        _tiles: tiles,
    };
}

let _seq = 0;
function town(w, k, gold, opts = {}) {
    const q = 200 + (_seq++), r = 0;
    const s = { name: `${k.name} ${q}`, type: opts.type || 'town', population: opts.pop || k.population, kingdom: k.id, q, r, economy: { gold } };
    if (opts.market) SettlementMarket.ensure(s);
    w._tiles.set(`${q},${r}`, { q, r, kingdom: k.id, terrain: { id: 'plains' }, settlement: s });
    k.territory.push({ q, r });
    if (opts.capital) k.capital = { q, r };
    return s;
}

function pair(ga = 20000, gb = 20000) {
    const ka = realm('a', 'Aster', 10000), kb = realm('b', 'Brenn', 10000);
    const w = bare([ka, kb]);
    const ta = town(w, ka, ga), tb = town(w, kb, gb);
    return { w, ka, kb, ta, tb };
}

function weeks(world, n, ctx = {}) {
    for (let i = 0; i < n; i++) {
        world.day += 7;
        MoneySupply.processDay(world, ctx);
    }
}

/** Every coin flow but the ones under test switched off. */
function quiet() {
    patch('mint.remint', 0);
    patch('wear', 0);
    patch('drift', 0);
    patch('trade.hume', 0);
    patch('gresham.rate', 0);
}

describe('striking coin', () => {
    it('makes coin only against the metal it takes in, at any standard (fine / purity), and the world\'s coin grows by exactly that', () => {
        quiet();
        patch('clip.rate', 0);
        const k = realm('a', 'Aster', 20000);
        k.finance.purity = 0.8;
        const w = bare([k, realm('b', 'Brenn', 20000)]);
        town(w, w.kingdoms[1], 30000);
        const s = town(w, k, 30000, { market: true, capital: true, pop: 20000, type: 'capital' });
        s.market.stock.gold_ore = SettlementMarket.target(s, 'gold_ore') + 40;
        s.market.stock.silver_ore = SettlementMarket.target(s, 'silver_ore') + 60;
        const ore0 = { gold: s.market.stock.gold_ore, silver: s.market.stock.silver_ore };
        const total0 = CoinCensus.total(w, null).total;
        weeks(w, 1);
        const M = MoneySupply.config().mint;
        const fine = (ore0.gold - s.market.stock.gold_ore) * M.fine.gold_ore + (ore0.silver - s.market.stock.silver_ore) * M.fine.silver_ore;
        expect(fine).toBeGreaterThan(0);
        const made = CoinCensus.total(w, null).total - total0;
        // (the seigniorage is struck whole: within a coin of fine / purity)
        expect(Math.abs(made - fine / 0.8)).toBeLessThan(1.01);
        expect(MoneySupply.realm(w, 'a').mint.lastStruck).toBeCloseTo(made, 0);
    });
});

describe('debasement', () => {
    it('raises prices week by week as the old coin is restruck; the crown\'s gains add up to the extra pieces the silver makes', () => {
        quiet();
        patch('clip.rate', 0);
        const { w, ka } = pair(20000, 20000);
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        const c0 = R.coin, t0 = ka.treasury;
        expect(Coinage.purityFactor(ka, w)).toBe(1);
        Finance.debase(w, { finance: null, gold: 0 }, ka);
        expect(Coinage.purity(ka)).toBeCloseTo(0.9, 6);
        const mults = [Coinage.purityFactor(ka, w)];
        for (let i = 0; i < 30; i++) {
            weeks(w, 1);
            mults.push(Coinage.purityFactor(ka, w));
        }
        // At once only a part of the rise; then up, week on week, to the full purity term
        const full = 1 + 0.1 * Coinage.config().elasticity;
        expect(mults[0]).toBeGreaterThan(1);
        expect(mults[0]).toBeLessThan(full - 0.04);
        for (let i = 1; i < mults.length; i++) expect(mults[i]).toBeGreaterThanOrEqual(mults[i - 1] - 1e-9);
        expect(mults[mults.length - 1]).toBeCloseTo(full, 2);
        // The holders kept their pieces; the crown's gains are the extra pieces the same silver makes
        expect(R.coin).toBeCloseTo(c0, 1);
        const gained = ka.treasury - t0;
        const extra = (t0 + c0) * (1 / 0.9 - 1);
        expect(gained).toBeGreaterThan(extra * 0.97);
        expect(gained).toBeLessThanOrEqual(extra + 1);
        expect(R.tot.debase).toBeCloseTo(gained, 0);
        // The realm's prices, not its neighbour's
        expect(Coinage.priceMultiplier(w, { kingdom: 'b' })).toBeCloseTo(MoneySupply.level(w, 'b'), 6);
    });

    it('while the old finer coin is about, people hoard it (Gresham at home: velocity falls), and spend it again once it is gone', () => {
        quiet();
        patch('clip.rate', 0);
        const { w, ka } = pair(20000, 20000);
        weeks(w, 1);
        Finance.debase(w, { finance: null, gold: 0 }, ka);
        weeks(w, 3);
        const R = MoneySupply.realm(w, 'a');
        expect(R.vel).toBeLessThan(0.99);
        expect(MoneySupply.realm(w, 'b').vel).toBeCloseTo(1, 3);
        weeks(w, 60);
        expect(R.vel).toBeGreaterThan(0.995);
    });

    it('a better standard (new silver) mixes into the coin in hand gradually, with no gain for the crown', () => {
        quiet();
        patch('clip.rate', 0);
        const { w, ka } = pair();
        ka.finance.purity = 0.7;
        weeks(w, 1);
        const t0 = ka.treasury;
        MoneySupply.setStandard(w, ka, 1);
        expect(MoneySupply.fineness(w, ka).circulating).toBeCloseTo(0.7, 6);
        weeks(w, 5);
        const mid = MoneySupply.fineness(w, ka).circulating;
        expect(mid).toBeGreaterThan(0.7);
        expect(mid).toBeLessThan(1);
        weeks(w, 60);
        expect(MoneySupply.fineness(w, ka).circulating).toBeGreaterThan(0.99);
        expect(ka.treasury).toBe(t0);
    });
});

describe('clipped coin', () => {
    it('the clippers shave the pieces in hand; the silver goes to market as ore (no metal lost, no coin made), and badly clipped coin dears the prices', () => {
        quiet();
        patch('clip.rate', 0.01);
        // (the mint buys no ore this time: the shavings stay in the market to be weighed)
        patch('mint.weeklyFine', 0);
        const ka = realm('a', 'Aster', 10000), kb = realm('b', 'Brenn', 10000);
        const w = bare([ka, kb]);
        const s = town(w, ka, 30000, { market: true, pop: 6000 });
        const s2 = town(w, ka, 10000, { market: true, pop: 2000 });
        for (const t of [s, s2]) { t.market.stock.silver_ore = 0; t.market.stock.gold_ore = 0; }
        town(w, kb, 30000);
        weeks(w, 1);
        const gold0 = s.economy.gold;
        weeks(w, 8);
        const R = MoneySupply.realm(w, 'a');
        expect(R.clip).toBeGreaterThan(0.05);
        expect(s.economy.gold).toBeCloseTo(gold0, 6); // the pieces are as many as before
        // The shaved silver is in the markets (and the carry): the same fine value, shared by their people
        const fine = (s.market.stock.silver_ore + s2.market.stock.silver_ore + R.silverCarry) * MoneySupply.config().mint.fine.silver_ore;
        expect(fine).toBeCloseTo(R.shaved, 0);
        expect(s2.market.stock.silver_ore).toBeGreaterThan(0);
        expect(s.market.stock.silver_ore / s2.market.stock.silver_ore).toBeCloseTo(3, 0);
        // Past the tolerance a piece is worth less: dearer prices, less trust
        expect(MoneySupply.fineness(w, ka).effective).toBeLessThan(0.99);
        expect(Coinage.purityFactor(ka, w)).toBeGreaterThan(1);
        expect(R.trust).toBeLessThan(100);
    });

    it('stops at the cap, and a recoinage ends it: full weight, nothing old, nothing clipped — at a cost set by the coin in hand', () => {
        patch('wear', 0);
        patch('drift', 0);
        const { w, ka, ta } = pair(20000, 20000);
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        R.clip = 0.13;
        const eff = MoneySupply.fineness(w, ka).effective;
        expect(eff).toBeCloseTo(1 - (0.13 - MoneySupply.config().clip.tolerance), 6);
        const q = Mints.recoinQuote(w, ka);
        expect(q.ok).toBe(true);
        expect(q.cost).toBe(Math.ceil(ta.economy.gold * (1 - eff) * 0.5));
        const t0 = ka.treasury, g0 = ta.economy.gold, total0 = CoinCensus.total(w, null).total, rc0 = R.wk.recoin;
        const res = Mints.recoin(w, ka);
        expect(res.success).toBe(true);
        expect(ka.treasury).toBe(t0 - q.cost);
        // Conservation: the mint's wages move into the town's purse; only the melted coin and the
        // towns' cut leave the world (their silver is in the new coin), and every piece is booked
        const L = MoneySupply.config().recoinage.labour;
        expect(res.labour).toBe(Math.floor(q.cost * L));
        expect(res.melted + res.labour).toBeCloseTo(q.cost, 6);
        expect(ta.economy.gold).toBeCloseTo(g0 - res.cut + res.labour, 6);
        expect(CoinCensus.total(w, null).total - total0).toBeCloseTo(-(res.cut + res.melted), 1);
        expect(R.wk.recoin - rc0).toBeCloseTo(-(res.cut + res.melted), 1);
        expect(R.mint.melted).toBeCloseTo(res.melted, 6);
        expect(R.clip).toBe(0);
        expect(R.lag).toBe(0);
        expect(Coinage.purityFactor(ka, w)).toBe(1);
        // The clipping cap
        patch('clip.rate', 0.05);
        weeks(w, 10);
        expect(R.clip).toBeLessThanOrEqual(MoneySupply.config().clip.max + 1e-9);
    });
});

describe('no coin from nothing', () => {
    it('a debasement with no coin counted in hand gains only the restriking of the crown\'s own chests: every new piece is made from silver already struck', () => {
        const k = realm('a', 'Aster', 10000, { treasury: 900 });
        const w = bare([k, realm('b', 'Brenn', 10000)]);
        town(w, k, 0);
        const total0 = CoinCensus.total(w, null).total;
        const res = Finance.debase(w, { finance: null, gold: 0 }, k);
        expect(res.success).toBe(true);
        expect(res.gain).toBe(100); // 900 x (1 / 0.9 - 1)
        expect(k.treasury).toBe(1000);
        expect(CoinCensus.total(w, null).total - total0).toBeCloseTo(100, 6);
        expect(MoneySupply.realm(w, 'a').wk.debase).toBe(100);
        // An empty chest and no coin in hand: nothing at all
        const k2 = realm('c', 'Corve', 10000, { treasury: 0 });
        const w2 = bare([k2]);
        const r2 = Finance.debase(w2, { finance: null, gold: 0 }, k2);
        expect(r2.gain).toBe(0);
        expect(k2.treasury).toBe(0);
    });
});

describe('the changers and the people', () => {
    it('the changers\' spread between two coins is friction on the NPC trade across the border, none between sound coins', () => {
        quiet();
        const { w, ka } = pair();
        weeks(w, 1);
        const l1 = { a: { kingdom: 'a' }, b: { kingdom: 'b' }, valAB: 0, valBA: 0 };
        MoneySupply.collectTrade(w, [l1]);
        expect(l1.changers || 0).toBe(0);
        ka.finance.purity = 0.8;
        weeks(w, 1);
        MoneySupply.collectTrade(w, [l1]);
        const E = MoneySupply.config().exchange;
        expect(l1.changers).toBeCloseTo(Math.min(E.max, 0.2 * E.perPurity), 6);
        expect(Mints.exchangeFee(w, 'a', 'b')).toBeCloseTo(l1.changers, 6);
        // (inside one realm: no changers)
        const l2 = { a: { kingdom: 'a' }, b: { kingdom: 'a' }, valAB: 0, valBA: 0 };
        MoneySupply.collectTrade(w, [l2]);
        expect(l2.changers || 0).toBe(0);
    });

    it('a coin the people do not trust sours its towns, week by week; a sound one leaves them be', () => {
        quiet();
        const { w, ka, ta, tb } = pair();
        ta.happiness = 60;
        tb.happiness = 60;
        ka.finance.purity = 0.6;
        weeks(w, 10);
        expect(MoneySupply.realm(w, 'a').trust).toBeLessThan(50);
        expect(ta.happiness).toBeLessThan(57);
        expect(tb.happiness).toBe(60);
    });
});

describe('the crowns and the coin', () => {
    it('a warlike crown in crisis clips its coin far more readily than a merchant crown', () => {
        const count = (traits) => {
            Utils.setSeed(99);
            const k = realm('x', 'Xan', 10000, { traits });
            const w = bare([k]);
            town(w, k, 20000);
            const player = { finance: null, gold: 0 };
            const st = Finance.state(player);
            let n = 0;
            for (let i = 0; i < 300; i++) {
                const f = Finance.kingdomState(k);
                f.purity = 1;
                f.levy = null;
                f.debt = [{ bankId: 'none', owed: 1000, apr: 0.1 }];
                if (Finance._crownCrisis(w, player, st, k, null) === 'debase') n++;
            }
            return n;
        };
        const war = count(['aggressive']), trade = count(['mercantile']);
        expect(war).toBeGreaterThan(trade * 2);
        expect(trade).toBeGreaterThan(0);
    });

    it('a crown out of trouble recoins its clipped coin by itself; the realm the player rules only when its treasurers are allowed', () => {
        const ka = realm('a', 'Aster', 10000, { treasury: 1e6 });
        const kb = realm('b', 'Brenn', 10000, { treasury: 1e6 });
        const w = bare([ka, kb]);
        town(w, ka, 20000);
        town(w, kb, 20000);
        weeks(w, 1);
        MoneySupply.realm(w, 'a').clip = 0.12;
        MoneySupply.realm(w, 'b').clip = 0.12;
        const player = { q: -99, r: -99, gold: 0, inventory: {}, throne: { ruling: { kingdomId: 'b' } } };
        w.day += 7;
        Mints.processDay(w, player);
        expect(MoneySupply.realm(w, 'a').clip).toBe(0);
        expect(MoneySupply.realm(w, 'b').clip).toBeGreaterThan(0.1);
        // Allowed: the treasurers recoin too (and the ruler hears of it)
        expect(Mints.setTreasurersCoin(player, w, true).success).toBe(true);
        expect(Mints.treasurersCoin(player, w)).toBe(true);
        w.day += 7;
        const out = Mints.processDay(w, player);
        expect(MoneySupply.realm(w, 'b').clip).toBe(0);
        expect(out.notices.some(n => n.title === 'The Treasurers Recoin')).toBe(true);
    });

    it('the player\'s treasurers debase in a crisis only if allowed', () => {
        const k = realm('a', 'Aster', 10000, { treasury: 0 });
        const w = bare([k]);
        town(w, k, 20000);
        weeks(w, 1);
        const player = { q: -99, r: -99, gold: 0, inventory: {}, throne: { ruling: { kingdomId: 'a' } } };
        const out = { notices: [] };
        const f = Finance.kingdomState(k);
        f.missed = 5;
        // (the crisis branch of the crowns' day, as the daily tick reaches it)
        expect(f.treasurersCoin).not.toBe(true);
        Mints.setTreasurersCoin(player, w, true);
        const res = Finance._treasurersDebase(w, player, k, out);
        expect(res.success).toBe(true);
        expect(Coinage.purity(k)).toBeCloseTo(0.9, 6);
        expect(out.notices.length).toBe(1);
        expect(f.missed).toBe(0);
    });
});

describe('saving the coin', () => {
    it('round-trips the coin in hand (lag, clipping, trust) and the treasurers\' leave', () => {
        const game = newGame(515);
        for (let d = 0; d < 9; d++) endDay(game);
        const { world } = game;
        const k = world.kingdoms.find(x => x.isAlive !== false && MoneySupply.realm(world, x.id));
        expect(k).toBeTruthy();
        const R = MoneySupply.realm(world, k.id);
        R.lag = 0.05;
        R.clip = 0.04;
        R.trust = 77;
        Finance.kingdomState(k).treasurersCoin = true;
        const g2 = roundTrip(game);
        const R2 = MoneySupply.realm(g2.world, k.id);
        expect(R2.lag).toBe(0.05);
        expect(R2.clip).toBe(0.04);
        expect(R2.trust).toBe(77);
        expect(g2.world.getKingdom(k.id).finance.treasurersCoin).toBe(true);
        expect(MoneySupply.fineness(g2.world, g2.world.getKingdom(k.id)).effective).toBeCloseTo(MoneySupply.fineness(world, k).effective, 9);
        // An older record: no coin-in-hand fields, backfilled to sound coin
        const w = bare([realm('a', 'Aster', 10000)]);
        MoneySupply.restore({ lastDay: 0, realms: { a: { coin: 500 } } }, w);
        expect(MoneySupply.realm(w, 'a').lag).toBe(0);
        expect(MoneySupply.realm(w, 'a').clip).toBe(0);
        expect(MoneySupply.fineness(w, w.kingdoms[0]).effective).toBe(1);
    }, 120000);
});

describe('the panels', () => {
    it('the Treasury\'s crown tab shows the coin (standard, in hand, clipped, prices, trust) with debase, recoin and the treasurers\' leave; the market notes a debased coin', async () => {
        const savedDocument = globalThis.document;
        const el = () => ({
            style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, querySelector() { return el(); }, querySelectorAll() { return []; },
            setAttribute() {}, getAttribute() { return null; }, remove() {}, insertAdjacentHTML() {},
        });
        globalThis.document = { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, body: el() };
        try {
            const { ActionMenu } = await import('../ui/actionMenu.js');
            const game = newGame(7);
            for (let d = 0; d < 8; d++) endDay(game);
            const { world, player } = game;
            const k = world.kingdoms.find(x => x.isAlive && x.capital && MoneySupply.realm(world, x.id));
            player.q = k.capital.q;
            player.r = k.capital.r;
            player.throne = player.throne || {};
            player.throne.ruling = { kingdomId: k.id, policies: { tax: 'standard', stance: 'defensive', faith: 'devout' } };
            const panels = [];
            game.ui = new Proxy({ showCustomPanel: (t, h) => panels.push(String(h)), _panelNav: null },
                { get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => {}); } });
            MoneySupply.realm(world, k.id).clip = 0.08;
            ActionMenu.showTreasury(game, 'crown');
            const html = panels[panels.length - 1];
            for (const s of ['The coin', 'Mint strikes', 'In hand', 'Clipped', 'Trust', 'Debase to 90% silver', 'Proclaim a recoinage', 'Leave the coin to the treasurers']) expect(html).toContain(s);
            ActionMenu.treasuryAct(game, 'coin', 'leave', 1);
            expect(k.finance.treasurersCoin).toBe(true);
            expect(panels[panels.length - 1]).toContain('Forbid the treasurers the coin');
            ActionMenu.treasuryAct(game, 'coin', 'debase');
            expect(Coinage.purity(k)).toBeCloseTo(0.9, 6);
            const note = Mints.coinNote(world, k);
            expect(note && note.text).toContain('the mint strikes at 90% silver');
            expect(note.text).toContain('clipped');
            // A sound coin at full weight has no note
            const sound = world.kingdoms.find(x => x.isAlive && x !== k && MoneySupply.realm(world, x.id));
            MoneySupply.realm(world, sound.id).clip = 0;
            expect(Mints.coinNote(world, sound)).toBe(null);
        } finally {
            globalThis.document = savedDocument;
        }
    }, 120000);
});
