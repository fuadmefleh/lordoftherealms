// ============================================
// BARTER — the world before coin, and how coin comes into it
// ============================================
//
// A world begun at the Dawn of Man (world.barter, set by Dawn.seed) has no
// coin at all: goods are traded for goods. Coin isn't given by the calendar;
// it EMERGES when barter breaks down — when the world's people and the goods
// its towns barter grow too many for barter to work (data/dawn.json
// barter.coinEmerges: world population, the season's barter trade, the
// number of towns trading). The first coin is struck at the busiest trading
// hub (the town whose barter strained first), from the gold and silver of
// its stores and its realm's; it SPREADS along the trade roads — a barter
// town that traded enough with coin towns in a season takes up coin the
// next (its purse seeded from its own metal, struck). For a while the world
// is mixed: coin in the trade centres, barter in the hinterland. Once every
// town has coin, barter is over (world.barter.allCoin). A late fallback year
// (coinEmerges.fallbackYear) strikes the first coin regardless, so a world
// whose trade never thickens isn't kept from coin for ever. Worlds begun at
// or after the dawn year have no world.barter: coin everywhere, as always.
//
//   • Each town: settlement.coinSince (the day it took up coin) — a town
//     without it barters. Its season's barter trade on market.trade.bv
//     (goods moved in kind), and the part of it with coin towns on .bvc.
//   • NPC trade (SettlementMarket.flows, flowOpts): a link with a barter
//     town on either end is goods for goods; between coin towns coin, and
//     in kind for what a purse can't pay.
//   • The player: while the world is not all coin, `player.gold` is an
//     accessor (install / syncPlayer; never saved). Standing in a barter
//     town (or in the wild after one) it reads the worth of the goods the
//     player carries (base prices), and writing it settles the difference
//     in goods: paying hands over goods of that worth (cheapest and most
//     plentiful first, food last, change back in the payee's goods), being
//     paid takes goods of that worth out of the payer's stock (the market
//     of the town where the player stands, or withParty) — never from
//     nothing. Standing in a coin town it is the player's real coin (kept
//     on the accessor; coin is not taken in barter places, so it waits in
//     the purse untouched until the player is somewhere coin is used). So
//     every `player.gold -= cost` / `player.gold >= cost` keeps working.
//   • The market of a barter town is a barter table (ui/actionMenu/trade.js,
//     trade()): what you ask for against what you offer, valued at the
//     town's supply-and-demand prices, with the market's cut.
//   • Coin that appears is struck from metal taken out of real stock and
//     booked as new coin (MoneySupply.registerNew 'mint'); while no town
//     has coin the money supply counts 0 and mints nothing.
//
// Pure world model: no RNG (orders are by value, then name), no globals —
// world and player passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Grades } from '../core/grades.js';
import { PlayerInventory } from '../core/inventory.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from './settlementMarket.js';
import { MoneySupply } from './moneySupply.js';
import { Economy } from './economy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _r2 = (v) => Math.round(v * 100) / 100;
const _fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const _byName = (a, b) => (String(a.name || '') < String(b.name || '') ? -1 : String(a.name || '') > String(b.name || '') ? 1 : 0);
const EPS = 1e-6;
const WATER = new Set(['deep_ocean', 'ocean', 'coast', 'sea', 'lake']);

/** Goods eaten from the packs, handed over last (with the markets' food group). */
const FOOD = new Set(['bread', 'grain', 'flour', 'meat', 'fish', 'cheese', 'berries', 'mushrooms', 'vegetables',
    'dried_meat', 'preserved_fish', 'small_fish', 'large_fish', 'cooked_meal', 'cooked_fish', 'cooked_meat',
    'meat_pie', 'honey', 'honey_cake', 'jam', 'sausage', 'pickles']);

const DEFAULTS = {
    cut: 0.12,
    keep: 0.35,
    startKit: { grain: 0.2, meat: 0.15, hide: 0.2, wool: 0.15, tools: 0.2, salt: 0.1 },
    notTender: [],
    hintGood: 'grain',
    coinEmerges: { checkDays: 30, popPerLand: 53, tradePerLand: 40, tradingShare: 0.5, minTradingTowns: 4, hubTrade: 1500, fallbackYear: 600 },
    spread: { minValue: 100, perSeason: 4, adoptAtCoin: 40 },
    firstCoin: { share: 0.6, keep: 0.25, fine: { gold_ore: 36, silver_ore: 16 } },
    lines: {
        noCoin: 'There is no coin here: offer goods.',
        firstCoin: 'Barter has outgrown itself at {hub}: too many people, too many goods to weigh one against another. Its chiefs strike the first coin from their gold and silver, {coin} in all. Coin will follow the trade roads.',
        firstCoinFallback: 'At {hub} the first coin is struck, {coin} in all, from the gold and silver of its stores.',
        spread: 'Coin has reached {towns}: their markets now buy and sell for coin.',
        allCoin: 'The last barter markets have taken up coin: the whole world buys and sells for coin now.',
        playerCoin: 'Coin is used here: your coin buys, and your goods sell for coin.',
    },
};

export const Barter = {
    // ──────────── CONFIG ────────────

    config() {
        const g = DataLoader._gamedata;
        const b = (g && g.dawn && g.dawn.barter) || {};
        return {
            ...DEFAULTS, ...b,
            coinEmerges: { ...DEFAULTS.coinEmerges, ...(b.coinEmerges || {}) },
            spread: { ...DEFAULTS.spread, ...(b.spread || {}) },
            firstCoin: { ...DEFAULTS.firstCoin, ...(b.firstCoin || {}) },
            lines: { ...DEFAULTS.lines, ...(b.lines || {}) },
        };
    },

    /** A world begun at the dawn: barter until coin emerges (Dawn.seed calls it) */
    fresh(world) {
        world.barter = { since: _num(world.day), coinDay: null, hub: null, allCoin: null, adopted: 0, struck: 0, lastCheck: null, season: null, news: null };
        return world.barter;
    },

    /**
     * A save from before barter (a world begun at the dawn, kept without a
     * barter record): bring barter in, once (the record it makes marks it).
     *   • If the world is already past where coin would have come by the
     *     present rules (its people over the threshold; the old save kept no
     *     barter books, so trade can't be weighed), coin is marked as having
     *     come at its most populous town, everywhere: it stays on coin.
     *   • Else the world goes back to barter: the towns' purses and the crowns'
     *     chests are emptied — a one-time migration that drops the coin the old
     *     rules made from nothing, as no store of goods stands behind it — the
     *     barter towns are stamped, and the player's coin is turned into a
     *     start kit's goods when the player is restored (migratePlayer:
     *     SaveLoad.restorePlayer → beginPlayer).
     * `params`: the world's generation params. → { kind: 'coin' | 'barter', dropped } or null
     */
    migrate(world, params) {
        // (only a world the dawn's clans made: world.dawn — not a custom world given an early year)
        if (!world || world.barter || !world.dawn) return null;
        const g = DataLoader._gamedata;
        const dawnYear = _num(g && g.dawn && g.dawn.dawnYear, 200);
        const start = Math.floor(Number(params && params.startYear));
        if (!(Number.isFinite(start) && start >= 1 && start < dawnYear)) return null;
        const rec = Barter.fresh(world);
        rec.migrated = _num(world.day);
        const st = Barter.strain(world);
        const T = Barter.thresholds(world, st.towns);
        if (st.hub && st.population >= T.population) {
            rec.coinDay = rec.allCoin = _num(world.day);
            rec.coinYear = _num(world.year);
            rec.hub = { q: st.hub.q, r: st.hub.r, name: st.hub.s.name || 'a town', why: 'migrated' };
            return { kind: 'coin', dropped: 0 };
        }
        let dropped = 0;
        for (const t of Barter._towns(world)) {
            const e = t.s.economy;
            if (e && _num(e.gold) > 0) { dropped += _num(e.gold); e.gold = 0; }
        }
        for (const k of world.kingdoms || []) { dropped += Math.max(0, _num(k.treasury)); Barter.coinlessRealm(k); }
        Barter.stamp(world);
        rec.migratePlayer = true;
        return { kind: 'barter', dropped: _r2(dropped) };
    },

    /** Did this world begin before coin (it has a barter record)? */
    bornInBarter(world) {
        return !!(world && world.barter);
    },

    /** Is coin used in this town? (Always, in a world that began with coin) */
    hasCoin(world, settlement) {
        if (!world || !world.barter || world.barter.allCoin != null) return true;
        return !!(settlement && settlement.coinSince != null);
    },

    /**
     * A chiefdom whose seat barters keeps its treasury in kind: its chests are
     * a reckoning of the chief's stores at the seat. What the crown spends
     * before coin (a feast, a tournament, an envoy's gifts — character events
     * that take from the treasury unconditionally) leaves the chests below
     * nothing; each day the shortfall is drawn out of the seat's market as
     * goods (its most plentiful first, never below `keep` of its needs) and
     * the chests are put back at 0 — what the stores can't cover the chief
     * goes without. Nothing at the dawn expects coin from it.
     * → [{ kingdom, drawn }] for the realms that spent
     */
    chiefsInKind(world) {
        const out = [];
        for (const k of world.kingdoms || []) {
            if (!k || k.isAlive === false || !(_num(k.treasury) < 0) || !k.capital) continue;
            const t = world.getTile(k.capital.q, k.capital.r);
            const seat = t && t.settlement;
            if (!seat || Barter.hasCoin(world, seat)) continue;
            const drawn = Barter._draw(seat, -_num(k.treasury));
            k.treasury = 0;
            out.push({ kingdom: k.id, drawn });
        }
        return out;
    },

    /** Take goods worth `value` out of a town's spare stock (most plentiful first) → the worth taken */
    _draw(settlement, value) {
        if (!settlement || !settlement.market || !settlement.market.stock) return 0;
        const keep = _num(Barter.config().keep, 0.35);
        let rem = _num(value), got = 0;
        const cands = SettlementMarket.config().goodIds
            .map(id => ({ id, unit: Barter.unitValue(id), spare: Barter._spare(settlement, id, keep), ratio: SettlementMarket.stock(settlement, id) / Math.max(0.01, SettlementMarket.target(settlement, id)) }))
            .filter(c => c.unit > 0 && c.spare > 0)
            .sort((a, b) => (b.ratio - a.ratio) || (a.id < b.id ? -1 : 1));
        for (const c of cands) {
            if (!(rem > 0.01)) break;
            const k = Math.min(c.spare, Math.ceil(rem / c.unit - EPS));
            const took = Math.floor(SettlementMarket.take(settlement, c.id, k) + 1e-9);
            got += took * c.unit;
            rem -= took * c.unit;
        }
        return _r2(got);
    },

    /** A realm risen among barter towns keeps no coin in its chests or its royal bank */
    coinlessRealm(kingdom) {
        if (!kingdom) return;
        kingdom.treasury = 0;
        if (kingdom.royalBank) kingdom.royalBank.treasury = 0;
    },

    /**
     * Barter rather than coin: with a settlement, does that town barter;
     * without, is the whole world still without coin?
     */
    active(world, settlement) {
        if (!world || !world.barter || world.barter.allCoin != null) return false;
        if (settlement !== undefined) return !Barter.hasCoin(world, settlement);
        return world.barter.coinDay == null;
    },

    /** Is barter still somewhere in the world (the player's purse in kind stays on)? */
    lingering(world) {
        return !!(world && world.barter && world.barter.allCoin == null);
    },

    /**
     * How NPC trade between towns is paid (SettlementMarket.flows opts), or
     * null in a world that began with coin: { inKind(settlement) → barters, short: true }
     */
    flowOpts(world) {
        if (!Barter.bornInBarter(world)) return null;
        return { inKind: (s) => !Barter.hasCoin(world, s), short: true };
    },

    /** The reason a coin-only thing can't be done in a barter place */
    noCoinReason() {
        return Barter.config().lines.noCoin;
    },

    // ──────────── WORTH ────────────

    /** Base worth of one unit of a good (data/playerEconomy.json GOODS basePrice; 0 = not a trade good) */
    unitValue(goodId) {
        return PlayerInventory.goodValue(goodId);
    },

    isFood(goodId) {
        const g = SettlementMarket.good(goodId);
        return FOOD.has(goodId) || !!(g && g.group === 'food');
    },

    /** The goods the player can pay with: [{ id, qty, unit, food }] (whole units with a worth) */
    tender(player) {
        const inv = player && player.inventory;
        const out = [];
        if (!inv || typeof inv !== 'object') return out;
        const not = Barter.config().notTender || [];
        for (const id of Object.keys(inv)) {
            if (id === 'gold' || not.includes(id)) continue;
            const qty = Math.floor(_num(inv[id]) + 1e-9);
            if (!(qty > 0)) continue;
            const unit = Barter.unitValue(id);
            if (!(unit > 0)) continue;
            out.push({ id, qty, unit, food: Barter.isFood(id) ? 1 : 0 });
        }
        return out;
    },

    /** The worth of the goods the player carries (what `player.gold` reads in a barter place) */
    purse(player) {
        let v = 0;
        for (const t of Barter.tender(player)) v += t.qty * t.unit;
        return Math.floor(v + 1e-9);
    },

    /** The player's real coin (kept aside while the purse in kind is on) */
    coinOf(player) {
        if (!player) return 0;
        if (Barter.installed(player)) return _num(player._inKind.coin);
        return _num(player.gold);
    },

    // ──────────── THE PLAYER'S PURSE ────────────

    installed(player) {
        return !!(player && player._inKind);
    },

    /**
     * Does the player deal in kind now? Where they stand decides: a barter
     * town in kind, a coin town in coin; in the wild, as where they last
     * stood (in kind until they have stood in a coin town).
     */
    inKind(player) {
        const k = player && player._inKind;
        if (!k) return false;
        const world = k.world;
        if (!Barter.lingering(world)) return false;
        const t = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        if (t && t.settlement) k.lastCoin = Barter.hasCoin(world, t.settlement);
        return !k.lastCoin;
    },

    /**
     * Put the purse in kind on: `player.gold` reads and pays in goods in a
     * barter place, and is the player's coin (kept aside) in a coin town.
     * → true when it was put on now
     */
    install(player, world) {
        if (!player || typeof player !== 'object') return false;
        if (Barter.installed(player)) { if (world) player._inKind.world = world; return false; }
        const coin = _num(player.gold);
        Object.defineProperty(player, '_inKind', { value: { world: world || null, coin, lastCoin: false, party: [] }, configurable: true, enumerable: false, writable: true });
        Object.defineProperty(player, 'gold', {
            configurable: true,
            enumerable: false,
            get() { return Barter.inKind(player) ? Barter.purse(player) : player._inKind.coin; },
            set(v) {
                if (Barter.inKind(player)) Barter._set(player, v);
                else { const n = Number(v); if (Number.isFinite(n)) player._inKind.coin = n; }
            },
        });
        return true;
    },

    /** Take the purse in kind off: `player.gold` the player's coin again */
    uninstall(player) {
        if (!Barter.installed(player)) return false;
        const coin = _num(player._inKind.coin);
        delete player.gold;
        delete player._inKind;
        player.gold = coin;
        return true;
    },

    /**
     * Run `fn` with `party` (a settlement, or null for nobody) as the one the
     * player pays and is paid by in kind — a quest giver's town, a payer that
     * isn't where the player stands. → fn's result.
     */
    withParty(player, party, fn) {
        if (!Barter.installed(player)) return fn();
        const st = player._inKind.party;
        st.push(party || null);
        try {
            return fn();
        } finally {
            st.pop();
        }
    },

    /** Who the player deals with: the party given, else the town where they stand, else nobody */
    _party(player) {
        const k = player && player._inKind;
        if (!k) return null;
        if (k.party.length) return k.party[k.party.length - 1];
        const world = k.world;
        if (!world || typeof world.getTile !== 'function') return null;
        const t = world.getTile(player.q, player.r);
        return (t && t.settlement) || null;
    },

    _set(player, v) {
        const want = Number(v);
        if (!Number.isFinite(want)) return;
        const d = want - Barter.purse(player);
        if (d <= -0.01) Barter.pay(player, -d, Barter._party(player));
        else if (d >= 0.01) Barter.receive(player, d, Barter._party(player));
    },

    _give(player, party, t, k, out) {
        Grades.remove(player, t.id, k, { order: 'worst' });
        t.qty -= k;
        out.goods[t.id] = (out.goods[t.id] || 0) + k;
        out.paid = _r2(out.paid + k * t.unit);
        if (party && party.market && SettlementMarket.tracks(t.id)) SettlementMarket.add(party, t.id, k);
    },

    /**
     * Pay `value` in goods to `party` (a settlement: into its market; null:
     * to whoever is paid, out of the world's books). Cheapest and most
     * plentiful first, food last; an overpayment gets its change back in
     * the party's goods where it has any. → { paid, goods, change }
     */
    pay(player, value, party = null) {
        const out = { paid: 0, goods: {}, change: 0 };
        let rem = _num(value);
        if (!(rem > 0) || !player) return out;
        const list = Barter.tender(player).sort((a, b) => (a.food - b.food) || (a.unit - b.unit) || (b.qty - a.qty) || (a.id < b.id ? -1 : 1));
        for (const t of list) {
            if (rem < t.unit - EPS) continue;
            const k = Math.min(t.qty, Math.floor(rem / t.unit + EPS));
            if (k > 0) { Barter._give(player, party, t, k, out); rem -= k * t.unit; }
        }
        // What's left is less than any whole unit: one more of the cheapest (food last)
        while (rem > 0.01) {
            const t = list.find(x => x.qty > 0);
            if (!t) break;
            Barter._give(player, party, t, 1, out);
            rem -= t.unit;
        }
        if (rem < -0.5 && party) out.change = Barter.receive(player, -rem, party).got;
        return out;
    },

    /** Units a town can spare of a good (above `keep` of its target) */
    _spare(settlement, goodId, keep) {
        const stock = SettlementMarket.stock(settlement, goodId);
        const floor = SettlementMarket.target(settlement, goodId) * keep;
        return Math.max(0, Math.floor(stock - floor + 1e-9));
    },

    /**
     * Be paid `value` in goods out of `party`'s stock (a settlement's market:
     * what it has most of, never below `keep` of its needs). Nothing from
     * nobody. → { got, goods }
     */
    receive(player, value, party = null) {
        const out = { got: 0, goods: {} };
        let rem = _num(value);
        if (!(rem > 0) || !player || !party || !party.market || !party.market.stock) return out;
        const keep = _num(Barter.config().keep, 0.35);
        const cands = [];
        for (const id of SettlementMarket.config().goodIds) {
            const unit = Barter.unitValue(id);
            if (!(unit > 0)) continue;
            const spare = Barter._spare(party, id, keep);
            if (!(spare > 0)) continue;
            const target = SettlementMarket.target(party, id);
            cands.push({ id, unit, spare, ratio: SettlementMarket.stock(party, id) / Math.max(0.01, target) });
        }
        cands.sort((a, b) => (b.ratio - a.ratio) || (a.unit - b.unit) || (a.id < b.id ? -1 : 1));
        const take = (c, k) => {
            if (!(k > 0)) return;
            const got = Math.floor(SettlementMarket.take(party, c.id, k) + 1e-9);
            if (!(got > 0)) return;
            PlayerInventory.addItem(player, c.id, got, { force: true });
            c.spare -= got;
            out.goods[c.id] = (out.goods[c.id] || 0) + got;
            out.got = _r2(out.got + got * c.unit);
            rem -= got * c.unit;
        };
        // A spread of what the town has most of (each good a third at first), then the rest
        const third = rem / 3;
        for (const c of cands) {
            if (rem < c.unit - EPS) continue;
            take(c, Math.min(c.spare, Math.floor(Math.min(rem, Math.max(third, c.unit)) / c.unit + EPS)));
        }
        for (const c of cands) {
            if (rem < c.unit - EPS || !(c.spare > 0)) continue;
            take(c, Math.min(c.spare, Math.floor(rem / c.unit + EPS)));
        }
        return out;
    },

    /** What a town can pay in kind (its spare stock's worth) */
    stockValue(settlement) {
        if (!settlement || !settlement.market || !settlement.market.stock) return 0;
        const keep = _num(Barter.config().keep, 0.35);
        let v = 0;
        for (const id of SettlementMarket.config().goodIds) {
            const unit = Barter.unitValue(id);
            if (unit > 0) v += Barter._spare(settlement, id, keep) * unit;
        }
        return Math.floor(v);
    },

    /** Does this town pay the player in kind (the player's purse is in kind and the town barters)? */
    paysInKind(player, settlement) {
        const k = player && player._inKind;
        return !!(k && settlement && !Barter.hasCoin(k.world, settlement));
    },

    /** A barter town pays the player `amount` in kind (wages, a reward) → the worth received */
    townPays(player, settlement, amount) {
        return Barter.receive(player, Math.min(_num(amount), Barter.stockValue(settlement)), settlement).got;
    },

    /** The start kit's goods for `value` of coin: { goodId: qty } */
    kitFor(value) {
        const out = {};
        for (const [id, share] of Object.entries(Barter.config().startKit || {})) {
            const unit = Barter.unitValue(id);
            if (!(unit > 0) || !(share > 0)) continue;
            const q = Math.floor(_num(value) * share / unit);
            if (q > 0) out[id] = q;
        }
        return out;
    },

    /** Give the player the kit for `value` → { goodId: qty } */
    giveKit(player, value) {
        const kit = Barter.kitFor(value);
        for (const [id, q] of Object.entries(kit)) PlayerInventory.addItem(player, id, q, { force: true });
        return kit;
    },

    /**
     * A new game in a world without coin: the start purse (coin nobody has
     * yet) is given as the start kit's goods, and the purse in kind goes on.
     * → the goods given, or null (coin is used here).
     */
    beginPlayer(player, world) {
        if (!player || !Barter.active(world)) return null;
        const coin = _num(player.gold);
        player.gold = 0;
        Barter.install(player, world);
        return coin > 0 ? Barter.giveKit(player, coin) : {};
    },

    /**
     * Daily (and after a load): the purse in kind on while barter lingers
     * anywhere, off once every town has coin. → true when it came off.
     */
    syncPlayer(world, player) {
        if (!player) return false;
        if (Barter.lingering(world)) { Barter.install(player, world); return false; }
        return Barter.uninstall(player);
    },

    // ──────────── HOW COIN COMES ────────────

    _towns(world) {
        const out = [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        for (const v of views) {
            const t = typeof world.getTile === 'function' ? world.getTile(v.q, v.r) : null;
            const s = t && t.settlement;
            if (s) out.push({ s, q: t.q, r: t.r });
        }
        return out;
    },

    /** Note goods traded in kind at a town (the player's barter: SettlementMarket.flows notes the NPCs') */
    note(settlement, value, withCoin = false) {
        const m = settlement && settlement.market;
        if (!m || !m.trade || !(value > 0)) return;
        m.trade.bv = _r2(_num(m.trade.bv) + value);
        if (withCoin) m.trade.bvc = _r2(_num(m.trade.bvc) + value);
    },

    /**
     * The strain on barter: the world's people, the season's barter trade,
     * the towns trading, and the busiest town. Reads the last season's books
     * (market.trade.bvLast / bvcLast).
     */
    strain(world) {
        let pop = 0, trade = 0, trading = 0, hub = null;
        for (const t of Barter._towns(world)) {
            pop += Math.max(0, _num(t.s.population));
            const m = t.s.market;
            const v = m && m.trade ? _num(m.trade.bvLast) : 0;
            trade += v;
            if (v > 0) trading++;
            if (!Barter.hasCoin(world, t.s) && (!hub || v > hub.v || (v === hub.v && _num(t.s.population) > _num(hub.t.s.population)))) hub = { t, v };
        }
        return { population: Math.round(pop), trade: _r2(trade), trading, towns: Barter._towns(world).length, hub: hub ? hub.t : null, hubTrade: hub ? hub.v : 0 };
    },

    /** The world's land (passable, not water): what its people spread over, counted once */
    land(world) {
        const rec = world.barter;
        if (rec && rec.land > 0) return rec.land;
        let n = 0;
        for (const row of world.tiles || []) for (const t of row) if (t && t.terrain && t.terrain.passable && !WATER.has(t.terrain.id)) n++;
        n = Math.max(1, n);
        if (rec) rec.land = n;
        return n;
    },

    /**
     * The strain at which barter breaks down in this world: thresholds per
     * land tile (coinEmerges popPerLand, tradePerLand), so a small island and
     * a wide continent reach coin at the same stage of their growth; the
     * towns trading as a share of all (tradingShare, at least minTradingTowns);
     * the hub's own season (hubTrade) is a town's, the same everywhere.
     * (Older data: worldPopulation / tradeValuePerSeason / minTradingTowns as
     * absolute numbers.) → { population, trade, trading, hubTrade }
     */
    thresholds(world, towns = null) {
        const E = Barter.config().coinEmerges;
        const land = Barter.land(world);
        const n = towns != null ? towns : Barter._towns(world).length;
        return {
            population: E.popPerLand != null ? _num(E.popPerLand) * land : _num(E.worldPopulation, Infinity),
            trade: E.tradePerLand != null ? _num(E.tradePerLand) * land : _num(E.tradeValuePerSeason, Infinity),
            trading: Math.max(_num(E.minTradingTowns, 0), E.tradingShare != null ? Math.ceil(_num(E.tradingShare) * n) : 0),
            hubTrade: _num(E.hubTrade, 0),
        };
    },

    /** Has barter broken down? → 'strain' | 'fallback' | null */
    _due(world, st) {
        const E = Barter.config().coinEmerges;
        const T = Barter.thresholds(world, st.towns);
        if (st.population >= T.population && st.trade >= T.trade && st.trading >= T.trading && st.hubTrade >= T.hubTrade) return 'strain';
        if (Number.isFinite(E.fallbackYear) && _num(world.year) >= E.fallbackYear) return 'fallback';
        return null;
    },

    /**
     * Daily from World._advanceDay. Every `checkDays` the season's barter
     * books close; then, while no town has coin, coin emerges at the busiest
     * hub if barter has broken down; once it has, it spreads to the barter
     * towns that traded most with coin towns. → the day's news ({ kind, text }) or null.
     */
    processDay(world) {
        const rec = world && world.barter;
        if (!rec || rec.allCoin != null) return null;
        // Before the first coin nobody on the roads carries any: the bands and
        // traders the world spawns (WorldUnit inventory themes) carry goods only
        if (rec.coinDay == null) for (const u of world.units || []) if (u && u.inventory && _num(u.inventory.gold) > 0) u.inventory.gold = 0;
        Barter.stamp(world);
        Barter.chiefsInKind(world);
        const E = Barter.config().coinEmerges;
        const every = Math.max(1, Math.floor(_num(E.checkDays, 30)));
        const day = _num(world.day);
        if (day % every !== 0 || rec.lastCheck === day) return null;
        rec.lastCheck = day;
        // Close the season's books
        const towns = Barter._towns(world);
        for (const t of towns) {
            const tr = t.s.market && t.s.market.trade;
            if (!tr) continue;
            tr.bvLast = _r2(_num(tr.bv));
            tr.bvcLast = _r2(_num(tr.bvc));
            tr.bv = 0;
            tr.bvc = 0;
        }
        let news = null;
        if (rec.coinDay == null) {
            const st = Barter.strain(world);
            rec.season = { day, population: st.population, trade: st.trade, trading: st.trading, towns: st.towns };
            const why = st.hub ? Barter._due(world, st) : null;
            if (why) news = Barter.emerge(world, st.hub, why);
        } else {
            news = Barter.spread(world, towns);
        }
        if (towns.length && towns.every(t => Barter.hasCoin(world, t.s))) {
            rec.allCoin = day;
            Barter.stamp(world);
            const text = Barter.config().lines.allCoin;
            if (Array.isArray(world.events)) world.events.push({ text: `⚖️ ${text}`, type: 'economy' });
            news = { kind: 'allCoin', text: news ? `${news.text} ${text}` : text };
        }
        if (news) rec.news = { day, ...news };
        return news;
    },

    /**
     * Strike coin at a town from the gold and silver it holds (and `more`
     * towns' metal brought to it): the metal leaves their stores, the coin
     * goes into this town's purse, booked as new coin in its realm. → coin struck
     */
    _strike(world, s, more = []) {
        const F = Barter.config().firstCoin;
        let coin = 0;
        for (const from of [s, ...more]) {
            if (!from || !from.market || !from.market.stock) continue;
            for (const [g, per] of Object.entries(F.fine || {})) {
                if (!(per > 0) || !SettlementMarket.tracks(g)) continue;
                const take = Math.floor(Barter._spare(from, g, _num(F.keep, 0.25)) * _num(F.share, 0.6));
                if (take > 0) coin += SettlementMarket.take(from, g, take) * per;
            }
        }
        coin = _r2(coin);
        if (!(coin > 0)) return 0;
        if (!s.economy) Economy.initSettlement(s, { fresh: true });
        s.economy.gold = _r2(_num(s.economy.gold) + coin);
        if (s.kingdom != null) MoneySupply.registerNew(world, s.kingdom, coin, 'mint');
        world.barter.struck = _r2(_num(world.barter.struck) + coin);
        return coin;
    },

    /**
     * Stamp the towns that barter (settlement.inKind: Economy.payTown takes no
     * coin into them — whoever paid there paid in goods), and clear the stamp
     * from the towns that use coin.
     */
    stamp(world) {
        for (const t of Barter._towns(world)) {
            const barters = !Barter.hasCoin(world, t.s);
            if (barters && !t.s.inKind) t.s.inKind = true;
            else if (!barters && t.s.inKind) delete t.s.inKind;
        }
    },

    _adopt(world, s) {
        delete s.inKind;
        s.coinSince = _num(world.day);
        world.barter.adopted = _num(world.barter.adopted) + 1;
    },

    /**
     * The first coin, at the hub (its own metal, and its realm's towns'
     * brought to it as tribute). → { kind: 'firstCoin', text, hub, coin }
     */
    emerge(world, hubTown, why = 'strain') {
        const C = Barter.config();
        const s = hubTown.s;
        const rec = world.barter;
        const realm = s.kingdom != null ? Barter._towns(world).filter(t => t.s !== s && t.s.kingdom === s.kingdom).map(t => t.s) : [];
        Barter._adopt(world, s);
        const coin = Barter._strike(world, s, realm);
        rec.coinDay = _num(world.day);
        rec.coinYear = _num(world.year);
        rec.hub = { q: hubTown.q, r: hubTown.r, name: s.name || 'a town', why };
        const text = _fill(why === 'fallback' ? C.lines.firstCoinFallback : C.lines.firstCoin, { hub: s.name || 'a town', coin: Math.round(coin).toLocaleString('en-US') });
        if (Array.isArray(world.events)) world.events.push({ text: `⚖️ ${text}`, type: 'economy' });
        return { kind: 'firstCoin', text, hub: rec.hub, coin };
    },

    /**
     * Coin follows the trade roads: the barter towns that traded at least
     * spread.minValue with coin towns last season take up coin (the busiest
     * first, up to perSeason), their purses seeded from their own metal; and
     * every barter town that has come to hold adoptAtCoin or more in real coin
     * (carried in by the crown's wages or a realm's payments) takes it up too.
     * → { kind: 'spread', text, towns } or null
     */
    spread(world, towns = Barter._towns(world)) {
        const S = Barter.config().spread;
        const cands = towns.filter(t => !Barter.hasCoin(world, t.s) && t.s.market && t.s.market.trade
            && _num(t.s.market.trade.bvcLast) >= _num(S.minValue, 100))
            .sort((a, b) => (_num(b.s.market.trade.bvcLast) - _num(a.s.market.trade.bvcLast)) || _byName(a.s, b.s))
            .slice(0, Math.max(0, Math.floor(_num(S.perSeason, 3))));
        for (const t of cands) {
            Barter._adopt(world, t.s);
            Barter._strike(world, t.s);
        }
        // Coin carried in (the crown's wages, a realm's payments): a barter town that
        // has come to hold real coin past adoptAtCoin takes it up rather than sit on it
        const held = towns.filter(t => !Barter.hasCoin(world, t.s) && t.s.economy && _num(t.s.economy.gold) >= _num(S.adoptAtCoin, 40))
            .sort((a, b) => _byName(a.s, b.s));
        for (const t of held) Barter._adopt(world, t.s);
        const all = [...cands, ...held];
        if (!all.length) return null;
        const names = all.map(t => t.s.name || 'a town');
        const text = _fill(Barter.config().lines.spread, { towns: names.join(names.length > 2 ? ', ' : ' and ') });
        if (Array.isArray(world.events)) world.events.push({ text: `⚖️ ${text}`, type: 'economy' });
        return { kind: 'spread', text, towns: names };
    },

    /** The nearest coin town to a place (for "coin is used at …" hints), or null */
    nearestCoinTown(world, q, r) {
        if (!Barter.bornInBarter(world)) return null;
        let best = null;
        for (const t of Barter._towns(world)) {
            if (!Barter.hasCoin(world, t.s)) continue;
            const d = Hex.wrappingOffsetDistance(q, r, t.q, t.r, world.width);
            if (!best || d < best.d) best = { d, name: t.s.name, q: t.q, r: t.r };
        }
        return best;
    },

    // ──────────── THE BARTER TABLE ────────────

    /**
     * What the town asks for `qty` of a good it has (each unit dearer as the
     * stall empties), and what it gives for `qty` of a good the player
     * offers (each unit cheaper as its store fills): the market's
     * supply-and-demand worth, less or plus half the spread. `edge` (0..)
     * narrows the spread (the player's haggling).
     */
    askValue(world, settlement, tile, goodId, qty, edge = 0) {
        const base = Barter.unitValue(goodId);
        const q = Math.max(0, Math.floor(_num(qty)));
        if (!(base > 0) || !(q > 0)) return 0;
        const s0 = SettlementMarket.stock(settlement, goodId);
        let sum = 0;
        for (let j = 0; j < q; j++) sum += SettlementMarket.value(world, settlement, tile, goodId, base, SettlementMarket.tracks(goodId) ? Math.max(0, s0 - j - 1) : null);
        return sum * (1 + Barter._half(edge));
    },

    offerValue(world, settlement, tile, goodId, qty, edge = 0) {
        const base = Barter.unitValue(goodId);
        if (!(base > 0)) return 0;
        return SettlementMarket.lotValue(world, settlement, tile, goodId, base, qty) * (1 - Barter._half(edge));
    },

    _half(edge) {
        return Math.max(0, _num(Barter.config().cut, 0.12) / 2 - Math.max(0, _num(edge)));
    },

    /** "≈ 12 grain": a worth told in the hint good at this town */
    inUnitsOf(world, settlement, tile, value) {
        const id = Barter.config().hintGood || 'grain';
        const u = SettlementMarket.value(world, settlement, tile, id, Barter.unitValue(id));
        if (!(u > 0) || !(value > 0)) return '';
        const n = value / u;
        return `≈ ${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} ${id}`;
    },

    /** Sum a basket { goodId: qty } with a valuer → worth */
    _basket(list, fn) {
        let v = 0;
        for (const [id, q] of Object.entries(list || {})) if (q > 0) v += fn(id, q);
        return v;
    },

    /**
     * Weigh a barter: { ask, offer, short } — the worth the town asks for
     * `want`, the worth it gives for `offer`, and how much more the offer
     * must be worth (0 when it covers the ask).
     */
    weigh(world, player, settlement, tile, want, offer, edge = 0) {
        const ask = Barter._basket(want, (id, q) => Barter.askValue(world, settlement, tile, id, q, edge));
        const give = Barter._basket(offer, (id, q) => Barter.offerValue(world, settlement, tile, id, q, edge));
        return { ask: _r2(ask), offer: _r2(give), short: _r2(Math.max(0, ask - give)) };
    },

    /**
     * Strike a barter at a town's market: `want` ({ goodId: qty } of its
     * stock) for `offer` ({ goodId: qty } of the player's goods). It goes
     * through when the offer's worth covers the ask (the market's cut
     * included): the goods move both ways, no coin anywhere.
     * → { success, reason?, ask, offer, got, gave }
     */
    trade(world, player, settlement, tile, want = {}, offer = {}, edge = 0) {
        const w = Object.fromEntries(Object.entries(want || {}).map(([id, q]) => [id, Math.floor(_num(q))]).filter(([, q]) => q > 0));
        const o = Object.fromEntries(Object.entries(offer || {}).map(([id, q]) => [id, Math.floor(_num(q))]).filter(([, q]) => q > 0));
        const fail = (reason) => ({ success: false, reason, ask: 0, offer: 0, got: {}, gave: {} });
        if (!player || !settlement) return fail('There is nobody to trade with.');
        if (!Object.keys(w).length) return fail('Choose what you want from the stalls.');
        if (!Object.keys(o).length) return fail('Choose what you offer for it.');
        for (const [id, q] of Object.entries(w)) {
            if (o[id]) return fail('You cannot ask for and offer the same good.');
            if (SettlementMarket.tracks(id) && SettlementMarket.available(settlement, id) < q) return fail(`The stalls don't have ${q} ${id}.`);
            if (!SettlementMarket.tracks(id)) return fail(`Nobody here trades ${id}.`);
        }
        const inv = player.inventory || {};
        for (const [id, q] of Object.entries(o)) if (Math.floor(_num(inv[id]) + 1e-9) < q) return fail(`You don't have ${q} ${id}.`);
        // Room in the packs for new kinds (the goods offered free their slots only when all are given)
        const freed = Object.entries(o).filter(([id, q]) => Math.floor(_num(inv[id]) + 1e-9) === q).length;
        const fresh = Object.keys(w).filter(id => !(_num(inv[id]) > 0)).length;
        if (fresh - freed > PlayerInventory.getFreeSlots(player)) return fail(PlayerInventory.fullMessage(player));
        const v = Barter.weigh(world, player, settlement, tile, w, o, edge);
        if (v.short > 0.005) return fail(`Your offer falls short by about ${Math.ceil(v.short)}: offer more.`);
        for (const [id, q] of Object.entries(o)) {
            Grades.remove(player, id, q, { order: 'sale' });
            if (SettlementMarket.tracks(id)) SettlementMarket.add(settlement, id, q);
        }
        for (const [id, q] of Object.entries(w)) {
            const got = SettlementMarket.take(settlement, id, q);
            if (got > 0) PlayerInventory.addItem(player, id, got, { force: true });
        }
        // (the town's barter books: what strains barter until coin comes)
        Barter.note(settlement, v.ask + v.offer);
        return { success: true, ask: v.ask, offer: v.offer, got: w, gave: o };
    },
};
