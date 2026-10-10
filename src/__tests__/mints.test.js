/**
 * Specie, Mints & the Price Level (world/moneySupply.js, systems/mints.js):
 * each realm's coin in circulation and its broad money, the price level
 * following the coin per head (clamped, folded into Coinage.priceMultiplier
 * with the purity term), trade deficits draining coin (deflation) and the
 * price-specie flow bringing it back, the mints striking bullion (fine /
 * purity) and keeping the seigniorage, debasement now swelling the coin,
 * recoinage shrinking it, the money changers' fee on a purity gap, Gresham's
 * law, counterfeiting's risk, no money loops at the mint, saving and
 * backfill, determinism, and the realms' survival terms staying bounded.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { MoneySupply } from '../world/moneySupply.js';
import { Coinage } from '../world/coinage.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { EconomyIndex } from '../world/economyIndex.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { Economy } from '../world/economy.js';
import { Mints } from '../systems/mints.js';
import { Finance } from '../systems/finance.js';
import { Underworld } from '../systems/underworld.js';
import { Ledger } from '../systems/ledger.js';
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
    id, name, isAlive: true, population: pop, treasury: 10000, wars: [], capital: null,
    finance: { purity: 1, debt: [], debtRatio: 0, missed: 0, unpaid: 0, defaults: 0, lastDefaultDay: null }, ...extra,
});

/** A bare world of realms (no map): the money model runs on the realms alone. */
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

/** Run the weekly pass `weeks` times. */
function weeks(world, n, ctx = {}) {
    for (let i = 0; i < n; i++) {
        world.day += 7;
        MoneySupply.processDay(world, ctx);
    }
}

/** A link between a town of realm a and one of realm b carrying `ab` and `ba` gold of goods today. */
const link = (a, b, ab, ba = 0) => ({ a: { kingdom: a }, b: { kingdom: b }, valAB: ab, valBA: ba });

describe('the money supply', () => {
    it('seeds each realm with coinPerHead × its people and keeps broad money apart', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 5000)]);
        weeks(w, 1);
        const C = MoneySupply.config();
        const Ra = MoneySupply.realm(w, 'a');
        expect(Ra.coin).toBeGreaterThan(C.coinPerHead * 10000 * 0.99);
        expect(Ra.coin).toBeLessThanOrEqual(C.coinPerHead * 10000);
        const broad = MoneySupply.broadMoney(w, w.kingdoms[0], 3000);
        expect(broad.treasury).toBe(10000);
        expect(broad.banks).toBe(3000);
        expect(broad.broad).toBeCloseTo(Ra.coin + 13000, 5);
        // Equal coin per head: both at the world's norm
        expect(MoneySupply.level(w, 'a')).toBeCloseTo(1, 3);
        expect(MoneySupply.level(w, 'b')).toBeCloseTo(1, 3);
    });

    it('moves the price level with coin per head, smoothed and clamped, and folds it into the price multiplier', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        weeks(w, 1);
        MoneySupply.realm(w, 'a').coin *= 3; // a flood of coin in Aster
        weeks(w, 1);
        const one = MoneySupply.level(w, 'a');
        expect(one).toBeGreaterThan(1);
        weeks(w, 30);
        const L = MoneySupply.config().level;
        const la = MoneySupply.level(w, 'a'), lb = MoneySupply.level(w, 'b');
        expect(la).toBeGreaterThan(one); // smoothed: it got there over weeks
        expect(la).toBeLessThanOrEqual(L.max + 1e-9);
        expect(lb).toBeGreaterThanOrEqual(L.min - 1e-9);
        expect(lb).toBeLessThan(1);
        // One multiplier: the purity term × the level
        expect(Coinage.priceMultiplier(w, { kingdom: 'a' })).toBeCloseTo(la, 6);
        w.kingdoms[0].finance.purity = 0.8;
        expect(Coinage.priceMultiplier(w, { kingdom: 'a' })).toBeCloseTo(Coinage.purityFactor(w.kingdoms[0]) * la, 6);
        // Switched off, every reader is neutral
        patch('enabled', false);
        expect(MoneySupply.level(w, 'a')).toBe(1);
        expect(MoneySupply.incomeFactor(w, w.kingdoms[0])).toBe(1);
    });

    it('a persistent trade deficit drains coin and deflates, and the price-specie flow holds the gap', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        weeks(w, 1);
        const b0 = MoneySupply.realm(w, 'b').coin;
        for (let i = 0; i < 40; i++) {
            MoneySupply.collectTrade(w, [link('a', 'b', 300, 100)]); // Aster sells Brenn more than it buys
            weeks(w, 1);
        }
        const Ra = MoneySupply.realm(w, 'a'), Rb = MoneySupply.realm(w, 'b');
        expect(Rb.coin).toBeLessThan(b0);
        expect(Rb.tot.trade).toBeLessThan(0);
        expect(Ra.tot.trade).toBeGreaterThan(0);
        expect(Rb.level).toBeLessThan(1); // deflation in the deficit realm: its goods are cheaper
        expect(Ra.level).toBeGreaterThan(1);
        // ...but the cheap realm wins coin back: the gap settles inside the clamp
        const L = MoneySupply.config().level;
        expect(Rb.level).toBeGreaterThan(L.min);
        expect(Ra.level).toBeLessThan(L.max);
        // A realm's own internal trade moves no specie
        const before = Rb.coin;
        MoneySupply.collectTrade(w, [link('b', 'b', 5000, 0)]);
        expect(w.money.trade).toEqual({});
        expect(Rb.coin).toBe(before);
    });

    it('tribute and crown loans move coin between realms, capped, and the coin is conserved', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        weeks(w, 1);
        const total = () => MoneySupply.realm(w, 'a').coin + MoneySupply.realm(w, 'b').coin;
        const t0 = total();
        const moved = MoneySupply.transfer(w, 'a', 'b', 1e9, 'tribute');
        const T = MoneySupply.config().transfers;
        expect(moved).toBeCloseTo(t0 / 2 * T.maxShare, 0);
        expect(total()).toBeCloseTo(t0, 6);
        expect(MoneySupply.realm(w, 'b').wk.tribute).toBeCloseTo(moved, 6);
        // KingdomAI's peace with a victor pays tribute out of the coin too
        const before = MoneySupply.realm(w, 'b').coin;
        w.events = [];
        KingdomAI.endWar(w.kingdoms[0], w.kingdoms[1], w, { victor: w.kingdoms[0] });
        expect(MoneySupply.realm(w, 'b').coin).toBeLessThan(before);
    });
});

describe('the mints', () => {
    /** A capital with a market, gold and silver ore stocked well above its target. */
    function withCapital(w, k, q = 3, r = 3) {
        const s = { name: `${k.name} Royal`, type: 'capital', population: 20000, kingdom: k.id, q, r };
        SettlementMarket.ensure(s);
        s.market.stock.gold_ore = SettlementMarket.target(s, 'gold_ore') + 40;
        s.market.stock.silver_ore = SettlementMarket.target(s, 'silver_ore') + 60;
        w._tiles.set(`${q},${r}`, { q, r, kingdom: k.id, terrain: { id: 'plains' }, settlement: s });
        k.capital = { q, r };
        return s;
    }

    it('strikes coin from the bullion it buys in the markets and keeps the seigniorage', () => {
        const k = realm('a', 'Aster', 20000);
        const w = bare([k, realm('b', 'Brenn', 20000)]);
        const s = withCapital(w, k);
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        const M = MoneySupply.config().mint;
        expect(R.mint.lastStruck).toBeGreaterThan(0);
        expect(s.market.stock.gold_ore).toBeLessThan(SettlementMarket.target(s, 'gold_ore') + 40);
        // fine / purity: honest coin strikes its fine worth; the crown keeps 5%
        const pol = M.policies.normal;
        expect(R.mint.lastSeign).toBeCloseTo(R.mint.lastStruck * pol.seigniorage, 1);
        expect(k.treasury).toBeGreaterThanOrEqual(10000 + Math.floor(R.mint.lastSeign) - 1);
        expect(R.tot.mint).toBeCloseTo(R.mint.lastStruck - R.mint.lastSeign, 1);
    });

    it('a greedy mint keeps more of each piece and draws less bullion; a debased mint strikes more coin from the same', () => {
        const run = (policy, purity) => {
            const k = realm('a', 'Aster', 20000);
            k.finance.purity = purity;
            const w = bare([k, realm('b', 'Brenn', 20000)]);
            withCapital(w, k);
            MoneySupply.ensureRealm(w, k).mint.policy = policy;
            weeks(w, 1);
            return MoneySupply.realm(w, 'a').mint;
        };
        const normal = run('normal', 1), high = run('high', 1), clipped = run('normal', 0.8);
        expect(high.lastSeign / high.lastStruck).toBeCloseTo(0.1, 2);
        expect(normal.lastSeign / normal.lastStruck).toBeCloseTo(0.05, 2);
        expect(clipped.lastStruck).toBeCloseTo(normal.lastStruck / 0.8, 0);
    });

    it('restrikes the foreign coin that comes in for the same charge', () => {
        const w = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        weeks(w, 1);
        const moved = MoneySupply.transfer(w, 'a', 'b', 1500, 'tribute', 1);
        expect(moved).toBe(1500);
        weeks(w, 1);
        const Rb = MoneySupply.realm(w, 'b');
        expect(Rb.mint.lastSeign).toBeCloseTo(1500 * MoneySupply.config().mint.remint * 0.05, 0);
    });

    it('debasement recoins the circulating coin: more coin, dearer markets, and Gresham drains the good coin abroad', () => {
        const ka = realm('a', 'Aster', 10000), kb = realm('b', 'Brenn', 10000);
        const w = bare([ka, kb]);
        const player = { finance: null, gold: 0 };
        weeks(w, 1);
        const c0 = MoneySupply.realm(w, 'a').coin;
        const mult0 = Coinage.priceMultiplier(w, { kingdom: 'a' });
        const res = Finance.debase(w, player, ka);
        expect(res.success).toBe(true);
        expect(MoneySupply.realm(w, 'a').coin).toBeCloseTo(c0 / 0.9, 0);
        expect(MoneySupply.realm(w, 'a').tot.debase).toBeGreaterThan(0);
        // Trade partners: the good coin goes to the sound realm
        MoneySupply.collectTrade(w, [link('a', 'b', 100, 100)]);
        weeks(w, 1);
        expect(MoneySupply.level(w, 'a')).toBeGreaterThan(1); // the swollen coin
        expect(MoneySupply.realm(w, 'a').last.gresham).toBeLessThan(0);
        expect(MoneySupply.realm(w, 'b').last.gresham).toBeGreaterThan(0);
        weeks(w, 6);
        expect(Coinage.priceMultiplier(w, { kingdom: 'a' })).toBeGreaterThan(mult0 * 1.05);
        // ...while the good coin keeps leaving, the clipped realm's level sinks back
        expect(MoneySupply.realm(w, 'a').tot.gresham).toBeLessThan(0);
    });

    it('a recoinage restores full weight, shrinks the coin (prices ease) and costs the crown', () => {
        const ka = realm('a', 'Aster', 10000);
        ka.finance.purity = 0.8;
        const w = bare([ka, realm('b', 'Brenn', 10000)]);
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        const c0 = R.coin, t0 = ka.treasury;
        const q = Mints.recoinQuote(w, ka);
        expect(q.ok).toBe(true);
        expect(q.cost).toBe(Math.ceil(c0 * 0.2 * 0.5));
        const res = Mints.recoin(w, ka);
        expect(res.success).toBe(true);
        expect(ka.finance.purity).toBe(1);
        expect(ka.treasury).toBe(t0 - q.cost);
        expect(R.coin).toBeCloseTo(c0 * 0.9, 0);
        expect(MoneySupply.news(w).some(h => h.kind === 'recoinage' && h.kingdomId === 'a')).toBe(true);
        expect(Mints.recoinQuote(w, ka).ok).toBe(false); // full weight now (and on cooldown)
        weeks(w, 10);
        expect(MoneySupply.level(w, 'a')).toBeLessThan(1);
    });

    it('a crown out of trouble proclaims a recoinage by itself; one in crisis does not', () => {
        const ka = realm('a', 'Aster', 10000, { treasury: 1e6 });
        const kb = realm('b', 'Brenn', 10000, { treasury: 1e6 });
        ka.finance.purity = 0.8;
        kb.finance.purity = 0.8;
        kb.finance.debtRatio = 0.9;
        const w = bare([ka, kb]);
        w.day = 6;
        Mints.processDay(w, null);
        expect(ka.finance.purity).toBe(1);
        expect(kb.finance.purity).toBe(0.8);
    });
});

describe('the player and the coin', () => {
    function twoRealms() {
        const ka = realm('a', 'Aster', 10000), kb = realm('b', 'Brenn', 10000);
        const w = bare([ka, kb]);
        w._tiles.set('1,1', { q: 1, r: 1, kingdom: 'a', terrain: { id: 'plains' }, settlement: null });
        w._tiles.set('2,1', { q: 2, r: 1, kingdom: 'b', terrain: { id: 'plains' }, settlement: null });
        weeks(w, 1);
        return { w, ka, kb };
    }

    it('the money changers charge for a purity gap at the border, and only then', () => {
        const { w, kb } = twoRealms();
        const player = { q: 1, r: 1, gold: 1000, inventory: {} };
        Mints.processDay(w, player); // in Aster
        player.q = 2;
        Mints.processDay(w, player); // into Brenn: same purity, no fee
        expect(player.gold).toBe(1000);
        kb.finance.purity = 0.8;
        player.q = 1;
        Mints.processDay(w, player);
        const E = MoneySupply.config().exchange;
        const fee = Math.round(1000 * Math.min(E.max, 0.2 * E.perPurity));
        expect(player.gold).toBe(1000 - fee);
        expect(player.mints.stats.exchangeFees).toBe(fee);
        expect(Ledger.today(player).expenses.exchange).toBe(fee);
        // A day standing still costs nothing more
        Mints.processDay(w, player);
        expect(player.gold).toBe(1000 - fee);
    });

    it('counterfeiting is a gamble: some batches pass and swell the coin, some are caught and cost stake, fine and heat', () => {
        const ka = realm('a', 'Aster', 10000);
        const w = bare([ka, realm('b', 'Brenn', 10000)]);
        const s = { name: 'Asterford', type: 'town', population: 4000, kingdom: 'a', q: 4, r: 4 };
        const tile = { q: 4, r: 4, kingdom: 'a', terrain: { id: 'plains' }, settlement: s };
        w._tiles.set('4,4', tile);
        weeks(w, 1);
        const player = { q: 4, r: 4, gold: 100000, inventory: {}, skills: {} };
        expect(Mints.counterfeitQuote(player, w, tile, 300).ok).toBe(false); // not in the guild
        const uw = Underworld.ensure(player);
        uw.guild.member = true;
        uw.guild.rank = 1;
        let passed = 0, caught = 0, net = 0;
        const C = MoneySupply.config().counterfeit;
        for (let i = 0; i < 60; i++) {
            w.day += C.cooldown;
            player.jailState = null;
            const g0 = player.gold;
            const q = Mints.counterfeitQuote(player, w, tile, 300);
            expect(q.ok).toBe(true);
            expect(q.chance).toBeGreaterThan(0);
            const res = Mints.counterfeit(player, w, tile, 300);
            expect(res.success).toBe(true);
            if (res.caught) { caught++; expect(player.gold).toBeLessThan(g0); } else { passed++; expect(player.gold).toBe(g0 + q.gain); }
            net += player.gold - g0;
            // (a hot name is caught more often, and cooled for the next)
            Underworld.addHeat(player, 'a', -100, w);
        }
        expect(passed).toBeGreaterThan(0);
        expect(caught).toBeGreaterThan(0);
        expect(MoneySupply.realm(w, 'a').tot.counterfeit).toBeGreaterThan(0);
        // At most the gain per batch: no fortune in it
        expect(net).toBeLessThan(60 * 300 * C.gain);
        // Too soon for another batch
        expect(Mints.counterfeitQuote(player, w, tile, 300).ok).toBe(false);
        // The same rolls on the same day and count
        const p2 = JSON.parse(JSON.stringify(player));
        const w2 = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        w2._tiles.set('4,4', tile);
        w2.day = w.day + 30;
        const w3 = bare([realm('a', 'Aster', 10000), realm('b', 'Brenn', 10000)]);
        w3._tiles.set('4,4', tile);
        w3.day = w.day + 30;
        const p3 = JSON.parse(JSON.stringify(player));
        expect(Mints.counterfeit(p2, w2, tile, 300).caught).toBe(Mints.counterfeit(p3, w3, tile, 300).caught);
    });
});

describe('in the game', () => {
    let game;
    beforeAll(() => {
        game = newGame(101);
        for (let d = 0; d < 30; d++) endDay(game);
    }, 120000);

    it('ticks weekly from the daily turn: every living realm has coin, a level inside the clamp, and an index row', () => {
        const { world } = game;
        const L = MoneySupply.config().level;
        for (const k of world.kingdoms.filter(x => x.isAlive)) {
            const R = MoneySupply.realm(world, k.id);
            expect(R).toBeTruthy();
            expect(R.coin).toBeGreaterThan(0);
            expect(R.level).toBeGreaterThanOrEqual(L.min);
            expect(R.level).toBeLessThanOrEqual(L.max);
            expect(R.hist.length).toBeGreaterThan(2);
            const f = MoneySupply.incomeFactor(world, k);
            expect(f).toBeGreaterThanOrEqual(MoneySupply.config().income.min);
            expect(f).toBeLessThanOrEqual(MoneySupply.config().income.max);
            expect(KingdomAI.incomeMultiplier(k, world)).toBeGreaterThan(0);
        }
        const row = EconomyIndex.latest(world, world.kingdoms.find(x => x.isAlive).id);
        expect(row.level).toBeGreaterThan(0);
        expect(row.coin).toBeGreaterThan(0);
    });

    it('the mint pays no more than the market asks: buying ore here to sell to the mint never pays', () => {
        const { world, player } = game;
        for (const k of world.kingdoms.filter(x => x.isAlive)) {
            const tile = world.getTile(k.capital.q, k.capital.r);
            for (const g of ['gold_ore', 'silver_ore']) {
                const q = Mints.bullionQuote(player, world, tile, g);
                const ask = Economy.marketAsk(world, tile, g);
                if (ask != null) expect(q.unit).toBeLessThanOrEqual(ask * MoneySupply.config().mint.askCap + 1e-6);
            }
        }
    });

    it('selling bullion to a mint pays its price, up to its weekly room, and the mint strikes it', () => {
        const { world, player } = game;
        const k = world.kingdoms.find(x => x.isAlive);
        const tile = world.getTile(k.capital.q, k.capital.r);
        player.inventory = player.inventory || {};
        player.inventory.silver_ore = 400;
        const q = Mints.bullionQuote(player, world, tile, 'silver_ore');
        expect(q.ok).toBe(true);
        const g0 = player.gold;
        const res = Mints.sellBullion(player, world, tile, 'silver_ore', 400);
        expect(res.success).toBe(true);
        expect(res.qty).toBe(Math.min(400, q.room));
        expect(player.gold - g0).toBe(Math.floor(q.unit * res.qty));
        expect(Mints.bullionQuote(player, world, tile, 'silver_ore').room).toBe(q.room - res.qty);
        expect(MoneySupply.realm(world, k.id).mint.pending.silver_ore).toBe(res.qty);
        delete player.inventory.silver_ore;
        // Not a mint: a town that is no capital
        const caps = new Set(world.kingdoms.filter(x => x.capital).map(x => `${x.capital.q},${x.capital.r}`));
        const other = world.getSettlementViews().find(s => s.kingdom && !caps.has(`${s.q},${s.r}`));
        expect(Mints.bullionQuote(player, world, world.getTile(other.q, other.r), 'gold_ore').ok).toBe(false);
    });

    it('a mint lease costs its share of the seigniorage up front and pays it back weekly', () => {
        const { world, player } = game;
        const k = world.kingdoms.find(x => x.isAlive && MoneySupply.avgSeign(MoneySupply.realm(world, x.id)) > 0);
        if (!k) return;
        const tile = world.getTile(k.capital.q, k.capital.r);
        const q = Mints.leaseQuote(player, world, tile);
        expect(q.fee).toBeGreaterThanOrEqual(MoneySupply.config().concession.minFee);
        player.gold = Math.max(player.gold, q.fee + 10);
        const t0 = k.treasury;
        const res = Mints.leaseMint(player, world, tile);
        expect(res.success).toBe(true);
        expect(k.treasury).toBe(t0 + q.fee);
        expect(Mints.leaseQuote(player, world, tile).ok).toBe(false);
        player.mints.lease = null;
        MoneySupply.realm(world, k.id).mint.lease = null;
    });

    it('saves and loads the coin and the player\'s dealings; older saves start afresh', () => {
        const { world } = game;
        game.player.mints = Mints.state(game.player);
        game.player.mints.stats.exchangeFees = 7;
        const g2 = roundTrip(game);
        expect(JSON.stringify(g2.world.money)).toBe(JSON.stringify(world.money));
        expect(g2.player.mints.stats.exchangeFees).toBe(7);
        // An older save: no money record, no player record
        const w = bare([realm('a', 'Aster', 10000)]);
        MoneySupply.restore(undefined, w);
        expect(w.money).toBe(null);
        expect(MoneySupply.level(w, 'a')).toBe(1);
        weeks(w, 1);
        expect(MoneySupply.realm(w, 'a').coin).toBeGreaterThan(0);
        const p = {};
        Mints.loadState(p);
        expect(p.mints).toBeUndefined();
        // A record from an older version is backfilled
        MoneySupply.restore({ lastDay: 0, realms: { a: { coin: 500, level: 1.02 } } }, w);
        const R = MoneySupply.realm(w, 'a');
        expect(R.mint.policy).toBe('normal');
        expect(R.tot.trade).toBe(0);
        expect(R.level).toBe(1.02);
    });

    it('is deterministic: the same seed makes the same coin', () => {
        const run = () => {
            const g = newGame(303);
            for (let d = 0; d < 22; d++) endDay(g);
            return JSON.stringify(g.world.money);
        };
        const a = run();
        expect(run()).toBe(a);
    }, 120000);
});
