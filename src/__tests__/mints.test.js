/**
 * Specie, Mints & the Price Level (world/moneySupply.js, systems/mints.js,
 * systems/coinCensus.js): each realm's coin is the real coin in its purses
 * (conservation inside a realm and across borders, the census equal to the
 * purses, new coin from the mint and the cheat panel, wear), its broad money, the price level
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
    id, name, isAlive: true, population: pop, treasury: 10000, wars: [], capital: null, territory: [],
    finance: { purity: 1, debt: [], debtRatio: 0, missed: 0, unpaid: 0, defaults: 0, lastDefaultDay: null }, ...extra,
});

/** A bare world of realms (no map): the money is what their towns' purses hold. */
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

let _townSeq = 0;
/** A town of realm k with a purse of `gold` (its people: the realm's, unless given). */
function town(w, k, gold, pop = null) {
    const q = 100 + (_townSeq++), r = 0;
    const s = { name: `${k.name} ${q}`, type: 'town', population: pop != null ? pop : k.population, kingdom: k.id, q, r, economy: { gold } };
    w._tiles.set(`${q},${r}`, { q, r, kingdom: k.id, terrain: { id: 'plains' }, settlement: s });
    k.territory.push({ q, r });
    return s;
}

/** Two realms of 10,000 people, each with one town holding `ga` / `gb`. */
function pair(ga = 20000, gb = 20000) {
    const ka = realm('a', 'Aster', 10000), kb = realm('b', 'Brenn', 10000);
    const w = bare([ka, kb]);
    const ta = town(w, ka, ga), tb = town(w, kb, gb);
    return { w, ka, kb, ta, tb };
}

/** Run the weekly pass `weeks` times. */
function weeks(world, n, ctx = {}) {
    for (let i = 0; i < n; i++) {
        world.day += 7;
        MoneySupply.processDay(world, ctx);
    }
}

/** Every flow but the one under test switched off. */
function quiet() {
    patch('mint.remint', 0);
    patch('wear', 0);
    patch('drift', 0);
    patch('trade.hume', 0);
}

/** A link between a town of realm a and one of realm b: `ab` / `ba` coin paid for goods each way today. */
const link = (a, b, ab, ba = 0) => ({ a: { kingdom: a }, b: { kingdom: b }, valAB: ab, valBA: ba });

describe('the money supply', () => {
    it('is the coin in the realm\'s purses: towns, townsfolk and the other holders; the chests, vaults and player\'s purse are broad money', () => {
        const { w, ka, ta } = pair(20000, 20000);
        ta.folk = { people: [{ id: 1, purse: 40 }, { id: 2, purse: 60 }, { id: 3 }, { id: 4, purse: 500, died: true }] };
        const holders = new Map([['a', { coin: 900, banks: 3000, player: 250 }]]);
        weeks(w, 1, { holders });
        const Ra = MoneySupply.realm(w, 'a');
        // (the week's flows ran after the count: wear is all that touched Aster's town)
        expect(Ra.coin).toBeCloseTo(ta.economy.gold + 100 + 900, 2);
        expect(Ra.towns).toBeCloseTo(ta.economy.gold, 2);
        expect(Ra.folk).toBe(100);
        expect(Ra.held).toBe(900);
        const broad = MoneySupply.broadMoney(w, ka);
        expect(broad.treasury).toBe(10000);
        expect(broad.banks).toBe(3000);
        expect(broad.player).toBe(250);
        expect(broad.broad).toBeCloseTo(Ra.coin + 13250, 5);
        // Equal coin per head: both near the world's norm
        expect(MoneySupply.level(w, 'a')).toBeCloseTo(1, 2);
        expect(MoneySupply.level(w, 'b')).toBeCloseTo(1, 2);
    });

    it('paying between purses inside a realm leaves its coin unchanged; paying across a border moves it between realms', () => {
        quiet();
        const { w, ka, kb, ta, tb } = pair(20000, 20000);
        const ta2 = town(w, ka, 5000, 0);
        weeks(w, 1);
        const a0 = MoneySupply.realm(w, 'a').coin, b0 = MoneySupply.realm(w, 'b').coin;
        expect(a0).toBe(25000);
        // A town pays another town of its own realm
        ta.economy.gold -= 3000;
        ta2.economy.gold += 3000;
        weeks(w, 1);
        expect(MoneySupply.realm(w, 'a').coin).toBe(a0);
        expect(MoneySupply.realm(w, 'a').last.other).toBe(0);
        // ...and one across the border
        ta.economy.gold -= 4000;
        tb.economy.gold += 4000;
        weeks(w, 1);
        expect(MoneySupply.realm(w, 'a').coin).toBe(a0 - 4000);
        expect(MoneySupply.realm(w, 'b').coin).toBe(b0 + 4000);
        expect(MoneySupply.realm(w, 'a').last.other).toBe(-4000);
        // Cross-border trade the market paid town to town is booked as trade, not 'other'
        ta.economy.gold += 1000;
        tb.economy.gold -= 1000;
        MoneySupply.collectTrade(w, [link('a', 'b', 1000, 0)]);
        weeks(w, 1);
        const Ra = MoneySupply.realm(w, 'a');
        expect(Ra.coin).toBe(a0 - 3000);
        expect(Ra.last.trade).toBe(1000);
        expect(Ra.last.other).toBe(0);
        expect(kb.id).toBe('b');
    });

    it('moves the price level with coin per head, smoothed and clamped, and folds it into the price multiplier', () => {
        quiet();
        const { w, ta } = pair(20000, 20000);
        weeks(w, 1);
        ta.economy.gold *= 3; // a flood of coin in Aster's purses
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

    it('the price-specie flow carries real coin from a trading partner\'s towns to the poorer realm\'s, and the coin is conserved', () => {
        patch('mint.remint', 0);
        patch('wear', 0);
        patch('drift', 0);
        const { w, ta, tb } = pair(10000, 30000);
        weeks(w, 1);
        for (let i = 0; i < 20; i++) {
            MoneySupply.collectTrade(w, [link('a', 'b', 100, 100)]); // they trade
            weeks(w, 1);
        }
        const Ra = MoneySupply.realm(w, 'a'), Rb = MoneySupply.realm(w, 'b');
        expect(ta.economy.gold).toBeGreaterThan(10000);
        expect(tb.economy.gold).toBeLessThan(30000);
        expect(ta.economy.gold + tb.economy.gold).toBeCloseTo(40000, 1);
        expect(Ra.tot.trade).toBeGreaterThan(0);
        expect(Rb.tot.trade).toBeLessThan(0);
        expect(Ra.coin).toBeCloseTo(ta.economy.gold, 2);
        // Without trade there are no partners and no such flow
        const q = pair(10000, 30000);
        weeks(q.w, 5);
        expect(q.ta.economy.gold).toBe(10000);
    });

    it('drift carries coin from the rich realm\'s towns to the poor realm\'s, all of it arriving', () => {
        patch('wear', 0);
        const { w, ta, tb } = pair(10000, 30000);
        weeks(w, 3);
        expect(ta.economy.gold).toBeGreaterThan(10000);
        expect(ta.economy.gold + tb.economy.gold).toBeCloseTo(40000, 1);
        expect(MoneySupply.realm(w, 'a').tot.drift).toBeCloseTo(-MoneySupply.realm(w, 'b').tot.drift, 1);
    });

    it('wear takes real coin out of the towns\' purses', () => {
        patch('drift', 0);
        const { w, ta } = pair(20000, 20000);
        weeks(w, 1);
        const g = ta.economy.gold;
        weeks(w, 1);
        const lost = g - ta.economy.gold;
        expect(lost).toBeCloseTo(g * MoneySupply.config().wear, 1);
        expect(MoneySupply.realm(w, 'a').last.wear).toBeCloseTo(-lost, 2);
        expect(MoneySupply.realm(w, 'a').coin).toBeCloseTo(ta.economy.gold, 2);
    });

    it('tribute moves treasury coin between the chests: booked on both realms, the coin in circulation untouched', () => {
        quiet();
        const { w, ka, kb } = pair(20000, 20000);
        weeks(w, 1);
        const a0 = MoneySupply.realm(w, 'a').coin;
        w.events = [];
        const t0 = ka.treasury + kb.treasury;
        KingdomAI.endWar(ka, kb, w, { victor: ka });
        expect(ka.treasury + kb.treasury).toBe(t0);
        expect(ka.treasury).toBeGreaterThan(10000);
        expect(MoneySupply.realm(w, 'a').wk.tribute).toBeCloseTo(ka.treasury - 10000, 6);
        expect(MoneySupply.realm(w, 'b').wk.tribute).toBeCloseTo(-(ka.treasury - 10000), 6);
        expect(MoneySupply.realm(w, 'a').coin).toBe(a0);
    });
});

describe('the mints', () => {
    /** A capital with a market, gold and silver ore stocked well above its target. */
    function withCapital(w, k, q = 3, r = 3) {
        const s = { name: `${k.name} Royal`, type: 'capital', population: 20000, kingdom: k.id, q, r, economy: { gold: 30000 } };
        SettlementMarket.ensure(s);
        s.market.stock.gold_ore = SettlementMarket.target(s, 'gold_ore') + 40;
        s.market.stock.silver_ore = SettlementMarket.target(s, 'silver_ore') + 60;
        w._tiles.set(`${q},${r}`, { q, r, kingdom: k.id, terrain: { id: 'plains' }, settlement: s });
        k.territory.push({ q, r });
        k.capital = { q, r };
        return s;
    }

    it('strikes coin from the bullion it buys: the selling town is paid in new coin, the crown keeps the seigniorage, and nothing else is made', () => {
        quiet();
        const k = realm('a', 'Aster', 20000);
        const w = bare([k, realm('b', 'Brenn', 20000)]);
        town(w, w.kingdoms[1], 30000);
        const s = withCapital(w, k);
        const g0 = s.economy.gold, t0 = k.treasury;
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        const M = MoneySupply.config().mint;
        expect(R.mint.lastStruck).toBeGreaterThan(0);
        expect(s.market.stock.gold_ore).toBeLessThan(SettlementMarket.target(s, 'gold_ore') + 40);
        // The mint adds exactly the coin it strikes: the town's new coin and the crown's
        expect((s.economy.gold - g0) + (k.treasury - t0)).toBeCloseTo(R.mint.lastStruck, 1);
        expect(Math.abs(R.mint.lastSeign - R.mint.lastStruck * M.policies.normal.seigniorage)).toBeLessThan(1);
        expect(R.tot.mint).toBeCloseTo(s.economy.gold - g0, 1);
        expect(R.coin).toBeCloseTo(s.economy.gold, 1);
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
        expect(clipped.lastStruck).toBeCloseTo(normal.lastStruck / 0.8, -1);
    });

    it('restrikes the foreign coin that comes in by trade for the same charge, drawn from the towns', () => {
        quiet();
        const { w, kb, tb } = pair(20000, 20000);
        weeks(w, 1);
        MoneySupply.collectTrade(w, [link('b', 'a', 1500, 0)]); // Brenn's towns were paid 1500 by Aster's
        const g0 = tb.economy.gold, t0 = kb.treasury;
        weeks(w, 1);
        const Rb = MoneySupply.realm(w, 'b');
        const charge = Math.floor(1500 * MoneySupply.config().mint.remint * 0.05);
        expect(Rb.mint.lastSeign).toBeCloseTo(charge, 0);
        expect(g0 - tb.economy.gold).toBeCloseTo(charge, 1);
        expect(kb.treasury - t0).toBeCloseTo(charge, 1);
    });

    it('debasement: the crown keeps the extra pieces in its chests, dearer markets, and Gresham drains the good coin abroad from the towns', () => {
        patch('wear', 0);
        patch('drift', 0);
        patch('mint.remint', 0);
        const { w, ka, ta, tb } = pair(20000, 20000);
        const player = { finance: null, gold: 0 };
        weeks(w, 1);
        const c0 = MoneySupply.realm(w, 'a').coin, t0 = ka.treasury;
        const mult0 = Coinage.priceMultiplier(w, { kingdom: 'a' });
        const res = Finance.debase(w, player, ka);
        expect(res.success).toBe(true);
        // The holders keep their pieces; the crown restrikes its chests and the first of the
        // old coin brought in (debasement.firstCall), and keeps the extra pieces
        expect(MoneySupply.realm(w, 'a').coin).toBe(c0);
        const first = MoneySupply.config().debasement.firstCall;
        expect(ka.treasury - t0).toBe(Math.floor(t0 * (1 / 0.9 - 1)) + Math.floor(c0 * 0.1 * first / 0.9));
        expect(MoneySupply.realm(w, 'a').wk.debase).toBe(ka.treasury - t0);
        expect(MoneySupply.realm(w, 'a').lag).toBeCloseTo(0.1 * (1 - first), 6);
        // Trade partners: the good coin goes to the sound realm, purse to purse
        MoneySupply.collectTrade(w, [link('a', 'b', 100, 100)]);
        weeks(w, 1);
        expect(MoneySupply.realm(w, 'a').last.gresham).toBeLessThan(0);
        expect(MoneySupply.realm(w, 'b').last.gresham).toBeGreaterThan(0);
        expect(ta.economy.gold).toBeLessThan(20000);
        expect(ta.economy.gold + tb.economy.gold).toBeCloseTo(40000, 1);
        expect(Coinage.priceMultiplier(w, { kingdom: 'a' })).toBeGreaterThan(mult0); // the purity term
    });

    it('a recoinage restores full weight, shrinks the towns\' coin (prices ease) and costs the crown', () => {
        patch('wear', 0);
        patch('drift', 0);
        const { w, ka, ta } = pair(20000, 20000);
        ka.finance.purity = 0.8;
        weeks(w, 1);
        const R = MoneySupply.realm(w, 'a');
        const c0 = ta.economy.gold, t0 = ka.treasury;
        const q = Mints.recoinQuote(w, ka);
        expect(q.ok).toBe(true);
        expect(q.cost).toBe(Math.ceil(c0 * 0.2 * 0.5));
        const res = Mints.recoin(w, ka);
        expect(res.success).toBe(true);
        expect(ka.finance.purity).toBe(1);
        expect(ka.treasury).toBe(t0 - q.cost);
        // (the mint's wages, recoinage.labour of the cost, are paid into the town's purse)
        const wages = Math.floor(q.cost * MoneySupply.config().recoinage.labour);
        expect(ta.economy.gold).toBeCloseTo(c0 * 0.9 + wages, 1);
        expect(R.coin).toBeCloseTo(c0 * 0.9 + wages, 1);
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
        town(w, ka, 20000);
        town(w, kb, 20000);
        w.day = 6;
        Mints.processDay(w, null);
        expect(ka.finance.purity).toBe(1);
        expect(kb.finance.purity).toBe(0.8);
    });
});

describe('coin from nothing', () => {
    it('the cheat panel\'s gold is booked as new coin in the realm, held in the player\'s purse, and raises prices once spent', () => {
        quiet();
        const { w, ka, ta } = pair(20000, 20000);
        w._tiles.set('1,1', { q: 1, r: 1, kingdom: 'a', terrain: { id: 'plains' }, settlement: null });
        const player = { q: 1, r: 1, gold: 100, inventory: {} };
        w.day = 6;
        Mints.processDay(w, player);
        const coin0 = MoneySupply.realm(w, 'a').coin;
        const lv0 = MoneySupply.level(w, 'a');
        // (what ui/ui/cheats.js cheatGold does)
        player.gold += 100000;
        MoneySupply.registerNew(w, CoinCensus.realmAt(w, player.q, player.r), 100000, 'cheat');
        expect(MoneySupply.realm(w, 'a').wk.cheat).toBe(100000);
        w.day += 7;
        Mints.processDay(w, player);
        // In the player's purse: broad money, not yet the coin about
        expect(MoneySupply.broadMoney(w, ka).player).toBe(100100);
        expect(MoneySupply.realm(w, 'a').coin).toBeCloseTo(coin0, 0);
        expect(MoneySupply.level(w, 'a')).toBeCloseTo(lv0, 2);
        // Spent in the realm's town: now it circulates, and prices rise
        player.gold -= 100000;
        Economy.payTown(ta, 100000);
        for (let i = 0; i < 6; i++) { w.day += 7; Mints.processDay(w, player); }
        expect(MoneySupply.realm(w, 'a').coin).toBeGreaterThan(coin0 + 90000);
        expect(MoneySupply.level(w, 'a')).toBeGreaterThan(lv0 + 0.05);
        expect(MoneySupply.realm(w, 'a').tot.cheat).toBe(100000);
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

    it('a purse assayed lately is not charged again at every crossing (exchange.cooldownDays)', () => {
        const { w, kb } = twoRealms();
        kb.finance.purity = 0.8;
        const E = MoneySupply.config().exchange;
        const player = { q: 1, r: 1, gold: 1000, inventory: {} };
        Mints.processDay(w, player); // in Aster
        player.q = 2;
        Mints.processDay(w, player); // into Brenn: the changers' fee
        const after = player.gold;
        expect(after).toBeLessThan(1000);
        player.q = 1;
        Mints.processDay(w, player); // straight back: the coin of the road, no new assay
        player.q = 2;
        Mints.processDay(w, player);
        expect(player.gold).toBe(after);
        w.day += (E.cooldownDays || 14) + 1;
        Mints.processDay(w, player); // (the realms' coin reckoned for the new day)
        kb.finance.purity = 0.8;
        player.q = 1;
        Mints.processDay(w, player); // weeks later: assayed again
        expect(player.gold).toBeLessThan(after);
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

    it('the realm coin is exactly what its purses hold after the weekly turn (no second ledger)', () => {
        const { world, player } = game;
        // (force the weekly turn now)
        MoneySupply.state(world).lastDay = null;
        Mints.processDay(world, player);
        const census = CoinCensus.count(world, player);
        for (const k of world.kingdoms.filter(x => x.isAlive)) {
            const R = MoneySupply.realm(world, k.id);
            expect(R.coin).toBeCloseTo(census.get(k.id).coin, 0);
            expect(MoneySupply.broadMoney(world, k).broad).toBeCloseTo(census.get(k.id).broad, 0);
        }
    });

    it('a new world starts with its money supply equal to the purses in each realm (seeded on its first day)', () => {
        const g = newGame(202);
        endDay(g);
        MoneySupply.state(g.world).lastDay = null;
        Mints.processDay(g.world, g.player);
        const census = CoinCensus.count(g.world, g.player);
        let sum = 0;
        for (const k of g.world.kingdoms.filter(x => x.isAlive)) {
            expect(MoneySupply.realm(g.world, k.id).coin).toBeCloseTo(census.get(k.id).coin, 0);
            expect(census.get(k.id).towns).toBeGreaterThan(0);
            sum += census.get(k.id).coin;
        }
        expect(sum).toBeGreaterThan(0);
    }, 120000);

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
        const ta = town(w, w.kingdoms[0], 7000);
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
        expect(R.counted).toBe(false);
        // ...and its abstract counter gives way to the purses at the next census, nothing booked
        w.day = 50;
        MoneySupply.processDay(w, {});
        expect(MoneySupply.realm(w, 'a').towns).toBeGreaterThan(6900);
        expect(MoneySupply.realm(w, 'a').last.other).toBe(0);
        expect(ta.economy.gold).toBeLessThanOrEqual(7000);
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
