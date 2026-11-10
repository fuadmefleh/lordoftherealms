// ============================================
// GANGS — the criminal organisations of the towns
// ============================================
// Every town, city and capital has its underworld (settlement.underworld,
// saved with its tile):
//
//   gangs  — one to three per town: a boss (or the player), crew, named
//            lieutenants with loyalty and ambition, a purse, a stash of
//            goods, a share of the streets (turf), gambling dens, and
//            rackets: protection, smuggling, fencing. Gangs feud and go to
//            war; a war ends when one side is broken or buys a truce.
//   watch  — the town's watch captain and magistrate (each may be on a
//            gang's payroll), and the crackdown (0-100): what the town's
//            crime has stirred up. A hot crackdown raids gangs that haven't
//            bought the captain, and hardens the watch against the player.
//
// The player can join a gang (a tavern contact first), run its errands,
// rise from hanger-on to lieutenant, challenge the boss for the gang, or
// found a crew of their own; a boss sets the cut, hires, pays or purges
// lieutenants, buys the watch, opens dens, runs contraband, makes war or
// truce, and draws on the purse. Lieutenants left unpaid or squeezed betray:
// they inform, split off with crew and coin, or move against the boss.
//
// The coin is real (data/underworld.json → gangs):
//   town purse → gang  protection, dens, kidnap ransoms, black-market and
//                      fenced-goods sales to the townsfolk (Economy.drawTown)
//   gang → town purse  crew wages, recruits, bonuses, a new den, and what the
//                      bought watch spends (Economy.payTown)
//   gang → another town  contraband bought out of that town's market stock
//                      (SettlementMarket.take) at its asking price
//   gang ↔ player      the boss's cut, a member's pay, withdrawals and
//                      deposits, goods the player sells to the fence and
//                      the black market (Underworld)
//   gang → crown       the licence on dens where vice is licensed (Laws)
//   gang → the jail    springing a member (player/prison.js): a bribed gaoler
//                      (into the town), the crew's pay for a breakout (spent in
//                      town), the kept magistrate's fee (his purse)
// Every one of these is booked (Gangs._book → g.books: this week, last week,
// all time, taken and paid by kind), and the Streets tab shows each gang's.
// The townsfolk spend at most blackMarket.purseShare of the town's purse a
// week at the gangs' black market; the rest of the stash waits.
// Goods: smuggled goods leave a market's stock; contraband in a stash is
// used up by the town's people as it is sold; fenced goods go back into the
// town's market stock once cold. Black-market prices follow the stash in
// town against the town's need (blackScarcity).
//
// Crime money is dirty (player.underworld.dirty): the watch seizes it on a
// search or an arrest, a big dirty purse draws heat, and a front (a tavern,
// inn, trading post... you own in the town, or your gang's dens) launders it
// for a fee that goes to the town.
//
// The week runs on its own seeded stream (Utils.withRng), and a town's gangs
// are named and seeded from a hash of the world and the town, so nothing
// here reshuffles anyone else's dice. Explicit params; no globals.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { CrownBooks } from '../world/crownBooks.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';
import { Traits } from './traits.js';

const GANG_TYPES = ['town', 'city', 'capital'];

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _r2 = v => Math.round(v * 100) / 100;
const _day = world => _num(world && world.day);
const _label = id => String(id).replace(/_/g, ' ');
const _key = (q, r) => `${q},${r}`;

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || (world && world.seed) || 0;
}

function _rng(world, tag) {
    return Utils.seededRandom((_hash(`${_seed(world)}:gangs:${tag}`) % 233279) + 1);
}

function _pick(arr) {
    return arr && arr.length ? arr[Math.floor(Utils.random() * arr.length)] : null;
}

function _range(pair, d) {
    const [lo, hi] = Array.isArray(pair) ? pair : d;
    return Utils.randInt(Math.round(lo), Math.round(hi));
}

// The kinds of coin a gang's books keep (g.books): what it took and what it paid out
const BOOK_LABELS = {
    in: {
        protection: 'Protection', dens: 'Dice dens', blackMarket: 'Black market', fence: 'Fenced goods resold',
        collections: 'Collection rounds', ransoms: 'Ransoms', tribute: 'Tribute', plunder: 'A broken rival\'s purse',
        deposits: 'Put in by you', founding: 'Its first purse',
    },
    out: {
        wages: 'Wages', recruits: 'Recruits', bribes: 'Bribes to the watch', smuggling: 'Contraband bought abroad',
        tithes: 'Tithes to the guild', spending: 'The boss living high', denOpen: 'Dens opened', bonuses: 'Bonuses',
        tribute: 'Tribute', seized: 'Seized in raids', toYou: 'Paid to you', purchases: 'Goods bought from you',
        springing: 'Springing you from jail', split: 'Carried off by a split',
    },
};

export const Gangs = {
    BOOK_LABELS,

    // ──────────── CONFIG ────────────

    cfg() {
        const uw = Underworld.data();
        return _obj(uw.gangs) || {};
    },

    /** One block of the config with fallbacks. */
    c(section, fallback = {}) {
        const v = Gangs.cfg()[section];
        if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;
        if (typeof fallback === 'number') return _num(v, fallback);
        return { ...fallback, ...(_obj(v) || {}) };
    },

    ranks() {
        const r = Gangs.cfg().ranks;
        return Array.isArray(r) && r.length ? r : [
            { id: 'hanger_on', name: 'Hanger-on', icon: '🪶', standing: 0, weeklyPay: 4 },
            { id: 'soldier', name: 'Soldier', icon: '🗡️', standing: 15, weeklyPay: 8 },
            { id: 'enforcer', name: 'Enforcer', icon: '👊', standing: 40, weeklyPay: 14 },
            { id: 'lieutenant', name: 'Lieutenant', icon: '🎖️', standing: 80, weeklyPay: 22 },
            { id: 'boss', name: 'Boss', icon: '👑', standing: 0, weeklyPay: 0 },
        ];
    },

    BOSS_RANK() { return Gangs.ranks().length - 1; },

    // ──────────── TOWNS ────────────

    /** Can gangs live here (a town, city or capital)? */
    hasGangs(settlement) {
        return !!settlement && GANG_TYPES.includes(settlement.type);
    },

    _tileOf(world, q, r) {
        return world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
    },

    _settlementAt(world, q, r) {
        const t = Gangs._tileOf(world, q, r);
        return t && t.settlement ? t.settlement : null;
    },

    _kingdom(world, settlement) {
        if (!settlement || settlement.kingdom == null || !world || typeof world.getKingdom !== 'function') return null;
        return world.getKingdom(settlement.kingdom) || null;
    },

    /**
     * The town's underworld (settlement.underworld), seeded the first time it
     * is needed. `tile` is a { q, r, settlement } (a map tile). Null where no
     * gang can live.
     */
    town(world, tile) {
        const s = tile && tile.settlement;
        if (!Gangs.hasGangs(s)) return null;
        const st = s.underworld;
        if (st && typeof st === 'object' && Array.isArray(st.gangs) && st.watch) return st;
        return Gangs._seedTown(world, s, tile.q, tile.r);
    },

    _seedTown(world, s, q, r) {
        const out = Utils.withRng(_rng(world, `seed:${q},${r}`), () => {
            const st = { gangs: [], watch: null, next: 1, log: [] };
            const N = Gangs.c('names', {});
            st.watch = {
                captain: { name: _pick(N.captain) || 'the watch captain', bribedBy: null, purse: 0 },
                magistrate: { name: _pick(N.magistrate) || 'the magistrate', bribedBy: null, purse: 0 },
                crackdown: Utils.randInt(5, 25),
            };
            const [lo, hi] = Gangs.c('perType', {})[s.type] || [1, 1];
            const n = Utils.randInt(lo, hi);
            for (let i = 0; i < n; i++) st.gangs.push(Gangs._newGang(world, s, q, r, st, {}));
            Gangs._normaliseTurf(st);
            return st;
        });
        s.underworld = out;
        return out;
    },

    _name(st) {
        const N = Gangs.c('names', {});
        for (let tries = 0; tries < 8; tries++) {
            const name = `${_pick(N.gangA) || 'The Black'} ${_pick(N.gangB) || 'Hands'}`;
            if (!st.gangs.some(g => g.name === name)) return name;
        }
        return `The ${st.next}th Street Crew`;
    },

    _person() {
        const N = Gangs.c('names', {});
        return `${_pick(N.first) || 'Bran'} ${_pick(N.epithet) || 'the Knife'}`;
    },

    _lieutenant(st, loyalty = null) {
        const roles = Gangs.c('lieutenants', {}).roles || ['muscle'];
        return {
            id: `lt${st.next++}`,
            name: Gangs._person(),
            role: _pick(roles),
            loyalty: loyalty != null ? loyalty : Utils.randInt(45, 80),
            ambition: Math.round(Utils.random() * 100) / 100,
            skill: Utils.randInt(2, 8),
        };
    },

    /**
     * A new gang in a town. Its first purse is coin it has already taken from
     * the town (drawn out of the town's purse now), its stash goods it has
     * already lifted from the town's market. opts: { crew, purse, turf, name,
     * boss, player, lieutenants, stash: false }.
     */
    _newGang(world, s, q, r, st, opts = {}) {
        const S = Gangs.c('start', {});
        const pop = _num(s.population, 1000);
        // A real town not yet given its purse gets it first (as its first day would), so the gang's coin is drawn from it
        if (!s.economy && pop > 0) Economy.initSettlement(s);
        const crewPer = _range(S.crewPerThousand, [2, 4]);
        const crew = opts.crew != null ? opts.crew : Math.max(_num(S.crewMin, 4), Math.round(pop / 1000 * crewPer));
        const want = opts.purse != null ? opts.purse
            : Math.min(_num(S.purseMax, 900), _num(Economy.townPurse(s), pop * 2) * _num(S.purseShareOfTown, 0.03));
        const purse = want > 0 ? Economy.drawTown(s, want) : 0;
        const [tlo, thi] = S.turf || [0.25, 0.6];
        const g = {
            id: `g${st.next++}`,
            name: opts.name || Gangs._name(st),
            boss: opts.player ? { name: opts.boss || 'you', player: true, might: 5 } : { name: opts.boss || Gangs._person(), might: Utils.randInt(3, 9) },
            crew: Math.max(1, Math.round(crew)),
            lieutenants: [],
            purse: _r2(purse),
            stash: {},
            fenced: [],
            turf: opts.turf != null ? opts.turf : Math.round((tlo + Utils.random() * (thi - tlo)) * 100) / 100,
            dens: opts.dens != null ? opts.dens : (Utils.random() < 0.5 ? 1 : 0),
            smuggling: opts.smuggling != null ? opts.smuggling : Utils.random() < 0.6,
            cut: 0.25,
            wars: {},
            truces: {},
            banned: false,
            founded: _day(world),
            week: null,
            stats: { taken: 0, paid: 0, raids: 0 },
        };
        Gangs._book(g, 'in', 'founding', purse);
        const nLt = opts.lieutenants != null ? opts.lieutenants : _range(S.lieutenants, [2, 3]);
        for (let i = 0; i < nLt; i++) g.lieutenants.push(Gangs._lieutenant(st));
        if (opts.stash !== false) {
            // What they have already lifted off the town's market
            for (const good of (S.stashGoods || []).slice(0, 2)) {
                const want2 = _range(S.stashQty, [2, 6]);
                const got = SettlementMarket.take(s, good, want2);
                if (got > 0) g.stash[good] = _r2(_num(g.stash[good]) + got);
            }
        }
        return g;
    },

    /** Keep the gangs' shares of the streets within the whole. */
    _normaliseTurf(st) {
        const live = st.gangs.filter(g => !g.dissolved);
        const total = live.reduce((a, g) => a + Math.max(0, g.turf), 0);
        if (total > 1) for (const g of live) g.turf = Math.round(Math.max(0, g.turf) / total * 100) / 100;
        for (const g of live) g.turf = _clamp(_num(g.turf), 0, 1);
    },

    // ──────────── THE BOOKS ────────────

    /** A gang's books: { cur, last, all } each { in: {kind: g}, out: {kind: g} }, and the weeks closed. */
    books(g) {
        if (!g) return null;
        const b = _obj(g.books);
        if (b && _obj(b.cur) && _obj(b.all)) return b;
        g.books = { cur: { in: {}, out: {} }, last: null, all: { in: {}, out: {} }, weeks: 0 };
        return g.books;
    },

    /**
     * Book `amount` of coin to a gang: dir 'in' (taken) or 'out' (paid), by
     * kind (BOOK_LABELS). The week's and all-time tallies, and the old
     * stats.taken / stats.paid totals. → amount booked.
     */
    _book(g, dir, kind, amount) {
        const a = _num(amount);
        if (!g || !(a > 0) || (dir !== 'in' && dir !== 'out')) return 0;
        const b = Gangs.books(g);
        b.cur[dir][kind] = _r2(_num(b.cur[dir][kind]) + a);
        b.all[dir][kind] = _r2(_num(b.all[dir][kind]) + a);
        if (!_obj(g.stats)) g.stats = { taken: 0, paid: 0, raids: 0 };
        if (dir === 'in') g.stats.taken = _r2(_num(g.stats.taken) + a);
        else g.stats.paid = _r2(_num(g.stats.paid) + a);
        return a;
    },

    /** The week's books close (at the end of the gang's week): this week becomes last week. */
    _closeWeek(g) {
        const b = Gangs.books(g);
        b.last = b.cur;
        b.cur = { in: {}, out: {} };
        b.weeks = _num(b.weeks) + 1;
    },

    /** Totals of a side of the books ({ kind: g }). */
    bookTotal(side) {
        return _r2(Object.values(_obj(side) || {}).reduce((a, v) => a + _num(v), 0));
    },

    /** The books for the panel: last week, this week so far and all time, each { in, out, took, paid }. */
    bookView(g) {
        const b = Gangs.books(g);
        const side = s => (s ? { in: { ...s.in }, out: { ...s.out }, took: Gangs.bookTotal(s.in), paid: Gangs.bookTotal(s.out) } : null);
        return { last: side(b.last), cur: side(b.cur), all: side(b.all), weeks: _num(b.weeks) };
    },

    gangsAt(world, tile) {
        const st = Gangs.town(world, tile);
        return st ? st.gangs.filter(g => !g.dissolved) : [];
    },

    gang(world, tile, gangId) {
        return Gangs.gangsAt(world, tile).find(g => g.id === gangId) || null;
    },

    /** Every town that has an underworld already, with its tile: [{ q, r, settlement, st }]. */
    _towns(world) {
        const out = [];
        const all = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : world && typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        for (const v of all) {
            const t = Gangs._tileOf(world, v.q, v.r);
            if (t && t.settlement && Gangs.hasGangs(t.settlement)) out.push({ q: v.q, r: v.r, settlement: t.settlement, tile: t });
        }
        return out;
    },

    // ──────────── THE WATCH ────────────

    watch(world, tile) {
        const st = Gangs.town(world, tile);
        return st ? st.watch : null;
    },

    crackdown(world, tile) {
        const w = Gangs.watch(world, tile);
        return w ? _num(w.crackdown) : 0;
    },

    /** Raise (or ease) the town's crackdown. */
    addCrackdown(world, q, r, amount) {
        const tile = Gangs._tileOf(world, q, r);
        if (!tile || !Gangs.hasGangs(tile.settlement) || !amount) return 0;
        const w = Gangs.watch(world, { q, r, settlement: tile.settlement });
        if (!w) return 0;
        w.crackdown = _r2(_clamp(_num(w.crackdown) + amount, 0, 100));
        return w.crackdown;
    },

    /** A bribe (or a fine's worth) handed to the watch captain: his purse, spent in town later. */
    payCaptain(world, tile, amount) {
        const w = Gangs.watch(world, tile);
        if (!w || !(amount > 0)) {
            if (tile && tile.settlement) Economy.payTown(tile.settlement, amount);
            return amount;
        }
        w.captain.purse = _r2(_num(w.captain.purse) + amount);
        return amount;
    },

    /** The player's gang here (the one they belong to), or null. */
    myGang(player, world, tile) {
        const m = Gangs.membership(player, tile);
        return m ? Gangs.gang(world, tile, m.gangId) : null;
    },

    /** What the player's gang has bought of the watch here: { captain, magistrate }. */
    bought(player, world, tile) {
        const g = player && tile && tile.settlement && Gangs.hasGangs(tile.settlement) ? Gangs.myGang(player, world, tile) : null;
        const w = g ? Gangs.watch(world, tile) : null;
        return { captain: !!(w && w.captain.bribedBy === g.id), magistrate: !!(w && w.magistrate.bribedBy === g.id) };
    },

    /** Odds modifier on the player's crimes here: the crackdown hurts, a bought captain helps. */
    jobModifier(player, world, tile) {
        if (!tile || !Gangs.hasGangs(tile.settlement)) return 0;
        const W = Gangs.c('watch', {});
        let m = -Gangs.crackdown(world, tile) * _num(W.crackdownJobPenalty, 0.002);
        if (Gangs.bought(player, world, tile).captain) m += _num(W.boughtJobBonus, 0.06);
        return m;
    },

    /** Multiplier on the chance the gate guards search the player here. */
    searchMult(player, world, tile) {
        if (!tile || !Gangs.hasGangs(tile.settlement)) return 1;
        const W = Gangs.c('watch', {});
        let m = 1 + Gangs.crackdown(world, tile) * _num(W.crackdownSearchPer, 0.006);
        if (Gangs.bought(player, world, tile).captain) m *= _num(W.boughtSearchMult, 0.3);
        return m;
    },

    // ──────────── THE BLACK MARKET ────────────

    /** Contraband the town's gangs hold of a good (the black market's supply). */
    blackStock(world, tile, goodId) {
        return Gangs.gangsAt(world, tile).reduce((a, g) => a + _num(g.stash[goodId]), 0);
    },

    /** The stock the black market here would call plenty (the town's need of it). */
    blackTarget(tile, goodId) {
        const s = tile && tile.settlement;
        const B = Gangs.c('blackMarket', {});
        let t = SettlementMarket.tracks(goodId) ? SettlementMarket.target(s, goodId) : 0;
        if (!(t > 0)) t = _num(B.fallbackTarget, 6) * Math.max(0.5, _num(s && s.population, 1000) / 1000);
        return Math.max(1, t);
    },

    /**
     * Supply and demand on the black market: the gangs' stash in town against
     * the town's need. Dear when the stash is empty, cheap when it's full.
     */
    blackScarcity(world, tile, goodId, extra = 0) {
        if (!tile || !Gangs.hasGangs(tile.settlement)) return 1;
        const B = Gangs.c('blackMarket', {});
        const ratio = (Gangs.blackStock(world, tile, goodId) + extra + 1) / Gangs.blackTarget(tile, goodId);
        return _clamp(Math.pow(ratio, -_num(B.elasticity, 0.6)), _num(B.min, 0.6), _num(B.max, 2.6));
    },

    /** The gang that buys from the player here (the richest; the player's own gang last). */
    buyer(player, world, tile) {
        const mine = Gangs.myGang(player, world, tile);
        const list = Gangs.gangsAt(world, tile).slice().sort((a, b) => b.purse - a.purse);
        return list.find(g => g !== mine) || list[0] || null;
    },

    /**
     * A gang buys `qty` of a good from the player at `price` each: coin from
     * its purse, goods into its stash (hot goods to the fence's pile until
     * cold). → units it could pay for (all of them where no gang lives here:
     * the town's own fences pay from the town purse).
     */
    buyFromPlayer(player, world, tile, goodId, qty, price, { hot = false } = {}) {
        if (!(qty > 0)) return { qty: 0, paid: 0, gang: null };
        const g = Gangs.buyer(player, world, tile);
        if (!g) {
            const paid = Economy.drawTown(tile && tile.settlement, qty * price);
            const n = price > 0 ? Math.min(qty, Math.floor(paid / price + 1e-9)) : qty;
            if (paid > n * price) Economy.payTown(tile.settlement, paid - n * price);
            return { qty: n, paid: n * price, gang: null };
        }
        const n = price > 0 ? Math.min(qty, Math.floor(g.purse / price + 1e-9)) : qty;
        if (n <= 0) return { qty: 0, paid: 0, gang: g };
        g.purse = _r2(g.purse - n * price);
        Gangs._book(g, 'out', 'purchases', n * price);
        if (hot) g.fenced.push({ good: goodId, qty: n, day: _day(world) });
        else g.stash[goodId] = _r2(_num(g.stash[goodId]) + n);
        return { qty: n, paid: n * price, gang: g };
    },

    // ──────────── MEMBERSHIP ────────────

    _pst(player) {
        const uw = Underworld.ensure(player);
        if (!_obj(uw.gangs)) uw.gangs = {};
        if (!Number.isFinite(uw.dirty)) uw.dirty = 0;
        if (!_obj(uw.laundered)) uw.laundered = {};
        return uw;
    },

    membership(player, tile) {
        if (!player || !tile) return null;
        const uw = player.underworld;
        const m = uw && _obj(uw.gangs) ? uw.gangs[_key(tile.q, tile.r)] : null;
        return m || null;
    },

    rankDef(i) {
        const r = Gangs.ranks();
        return r[_clamp(Math.floor(_num(i)), 0, r.length - 1)];
    },

    isBoss(player, world, tile) {
        const g = Gangs.myGang(player, world, tile);
        return !!(g && g.boss && g.boss.player);
    },

    /** The towns where the player is boss: [{ q, r, town, gang }]. */
    bossTowns(player, world) {
        const out = [];
        const uw = player && player.underworld;
        if (!uw || !_obj(uw.gangs)) return out;
        for (const [k, m] of Object.entries(uw.gangs)) {
            const [q, r] = k.split(',').map(Number);
            const tile = Gangs._tileOf(world, q, r);
            if (!tile || !tile.settlement) continue;
            const g = Gangs.gang(world, tile, m.gangId);
            if (g && g.boss && g.boss.player) out.push({ q, r, town: tile.settlement.name, gang: g });
        }
        return out;
    },

    _log(st, world, text) {
        if (!Array.isArray(st.log)) st.log = [];
        st.log.push({ day: _day(world), text });
        if (st.log.length > 16) st.log.splice(0, st.log.length - 16);
    },

    _gainStanding(player, world, tile, m, amount) {
        if (!m || !(amount > 0)) return null;
        m.standing = _num(m.standing) + amount;
        const ranks = Gangs.ranks();
        let promoted = null;
        while (m.rank < Gangs.BOSS_RANK() - 1 && m.standing >= _num(ranks[m.rank + 1].standing)) {
            m.rank++;
            promoted = ranks[m.rank];
        }
        // the underworld at large hears of it too
        Underworld._gainStanding(player, world, Math.max(1, Math.round(amount / 2)));
        return promoted;
    },

    /** Join a gang here (a guild contact first). */
    join(player, world, tile, gangId) {
        const uw = Gangs._pst(player);
        if (!uw.guild.contactMet && !uw.guild.member) return { success: false, reason: 'Nobody here will vouch for you. Find a contact first: ask a barkeep about "special work".' };
        if (Gangs.membership(player, tile)) return { success: false, reason: 'You already run with a crew in this town.' };
        const g = Gangs.gang(world, tile, gangId);
        if (!g) return { success: false, reason: 'No such crew here.' };
        if (g.banned) return { success: false, reason: `${g.name} would sooner cut your throat.` };
        uw.gangs[_key(tile.q, tile.r)] = { gangId: g.id, rank: 0, standing: 0, joinedDay: _day(world) };
        Traits.recordDeeds(player, { deceit: 0.5, cunning: 0.5 });
        const text = `${g.boss.name} looks you over and nods. You run with ${g.name} now, as a ${Gangs.rankDef(0).name}.`;
        Gangs._log(Gangs.town(world, tile), world, `${player.name || 'A newcomer'} joined ${g.name}.`);
        return { success: true, text };
    },

    /** Leave the gang here (a boss hands it to the most loyal lieutenant). */
    leave(player, world, tile) {
        const uw = Gangs._pst(player);
        const k = _key(tile.q, tile.r);
        const m = uw.gangs[k];
        if (!m) return { success: false, reason: 'You run with no crew here.' };
        const g = Gangs.gang(world, tile, m.gangId);
        delete uw.gangs[k];
        if (g && g.boss && g.boss.player) Gangs._succeed(world, tile, g, 'stepped aside');
        return { success: true, text: g ? `You walk away from ${g.name}.` : 'You walk away.' };
    },

    /** A new boss from the lieutenants when the old one is gone. */
    _succeed(world, tile, g, why) {
        const st = Gangs.town(world, tile);
        const heir = g.lieutenants.slice().sort((a, b) => (b.skill + b.ambition * 5) - (a.skill + a.ambition * 5))[0];
        if (heir) {
            g.lieutenants = g.lieutenants.filter(l => l !== heir);
            g.boss = { name: heir.name, might: _clamp(heir.skill, 2, 9) };
        } else {
            g.boss = { name: Utils.withRng(_rng(world, `heir:${g.id}:${_day(world)}`), () => Gangs._person()), might: 4 };
        }
        if (st) Gangs._log(st, world, `${g.boss.name} took over ${g.name} (${why}).`);
        return g.boss;
    },

    /** Found a crew of your own here (Prowler or above in the guild): seed coin from your purse, crew hired in town. */
    found(player, world, tile, name = null) {
        const uw = Gangs._pst(player);
        const F = Gangs.c('found', {});
        const st = Gangs.town(world, tile);
        if (!st) return { success: false, reason: 'A crew needs a town to work.' };
        if (Gangs.membership(player, tile)) return { success: false, reason: 'You already run with a crew in this town.' };
        if (!uw.guild.member || uw.guild.rank < _num(F.minGuildRank, 2)) return { success: false, reason: `Nobody follows a nobody: you need the guild's rank of ${(Underworld.ranks()[_num(F.minGuildRank, 2)] || {}).name || 'Prowler'}.` };
        if (Gangs.gangsAt(world, tile).length >= 4) return { success: false, reason: 'The streets here are spoken for four times over.' };
        const seed = _num(F.seed, 200);
        const fee = _num(Gangs.cfg().recruitFee, 25);
        const crew = _num(F.crew, 4);
        if (_num(player.gold) < seed + fee * crew) return { success: false, reason: `You need ${seed + fee * crew}g: ${seed}g for the purse and ${fee}g a head to sign ${crew} men.` };
        player.gold -= seed + fee * crew;
        Ledger.record(player, 'gang', -(seed + fee * crew));
        Gangs._dirtyFollowsGold(player);
        // The signing fees go to the men, who spend them in town
        Economy.payTown(tile.settlement, fee * crew);
        const g = Gangs._newGang(world, tile.settlement, tile.q, tile.r, st, {
            name, player: true, boss: player.name || 'you', crew, purse: 0, turf: _num(F.turf, 0.15), dens: 0, smuggling: false, lieutenants: 1, stash: false,
        });
        g.purse = seed;
        Gangs._book(g, 'in', 'deposits', seed);
        st.gangs.push(g);
        Gangs._normaliseTurf(st);
        uw.gangs[_key(tile.q, tile.r)] = { gangId: g.id, rank: Gangs.BOSS_RANK(), standing: 0, joinedDay: _day(world) };
        // The biggest crew in town takes it ill
        const big = st.gangs.filter(x => x !== g && !x.dissolved).sort((a, b) => b.crew - a.crew)[0];
        if (big) big.feud = _num(big.feud) + 20;
        Traits.recordDeeds(player, { cunning: 1, dread: 0.5 });
        Gangs._log(st, world, `${player.name || 'A newcomer'} founded ${g.name}.`);
        return { success: true, gang: g, text: `${g.name} is yours: ${crew} men, a lieutenant and ${seed}g in the purse. ${big ? `${big.name} won't like it.` : ''}`.trim() };
    },

    // ──────────── ERRANDS ────────────

    errandDef(id) {
        return _obj((Gangs.cfg().errands || {})[id]);
    },

    _strength(player, g) {
        const lts = g.lieutenants.reduce((a, l) => a + _num(l.skill), 0) / 2;
        const boss = g.boss && g.boss.player
            ? _num(player && player.skills && player.skills.combat, 1) + _num(player && player.skills && player.skills.leadership, 1)
            : _num(g.boss && g.boss.might, 4);
        return Math.max(1, g.crew + lts + boss);
    },

    rivals(world, tile, g) {
        return Gangs.gangsAt(world, tile).filter(x => x !== g);
    },

    atWar(g, other) {
        return !!(g && other && g.wars && g.wars[other.id]);
    },

    errandOdds(player, world, tile, id) {
        const e = Gangs.errandDef(id);
        if (!e) return 0;
        const o = Underworld.cfg('odds');
        const m = Gangs.membership(player, tile);
        const stealth = _num(player.skills && player.skills.stealth, 1);
        const stat = _num(player[e.stat], 5);
        const kingdom = Gangs._kingdom(world, tile.settlement);
        return _clamp(_num(e.base, 0.6)
            + stealth * _num(o.stealthPerPoint, 0.04) * 0.75
            + (stat - 5) * _num(o.statPerPoint, 0.015)
            + _num(m && m.rank) * 0.03
            + Underworld.traitBonus(player)
            - Underworld.guardStrength(tile.settlement, kingdom) * _num(o.guardPenaltyPerPoint, 0.06) * 0.5
            + Gangs.jobModifier(player, world, tile), 0.05, 0.95);
    },

    /** The gang's errands here, with odds and why one is locked. */
    errands(player, world, tile) {
        const m = Gangs.membership(player, tile);
        const g = m ? Gangs.gang(world, tile, m.gangId) : null;
        const uw = player.underworld || {};
        const out = [];
        for (const [id, e] of Object.entries(Gangs.cfg().errands || {})) {
            let locked = null;
            if (!g) locked = 'Run with a crew here first';
            else if (m.rank < _num(e.rank)) locked = `Requires ${Gangs.rankDef(e.rank).name}`;
            else if (uw.lyingLow && uw.lyingLow.kingdom === tile.settlement.kingdom) locked = 'You are lying low';
            else if (id === 'hit' && !Gangs.rivals(world, tile, g).some(x => Gangs.atWar(g, x))) locked = 'Only in a gang war';
            else if (id === 'forge') {
                for (const [good, n] of Object.entries(e.needs || {})) if (_num(player.inventory && player.inventory[good]) < n) locked = `Needs ${n} ${_label(good)} in your packs`;
            } else if (id === 'run_cargo' && !Gangs._smuggleChoice(world, tile)) locked = 'Nothing banned here worth running in';
            out.push({ id, ...e, odds: g ? Gangs.errandOdds(player, world, tile, id) : 0, locked });
        }
        return out;
    },

    _spendAP(player, ap) {
        if (_num(player.actionPoints) < ap) return false;
        player.actionPoints -= ap;
        return true;
    },

    /** Gang money to the player: dirty coin, on the Ledger. */
    _payPlayer(player, amount, cat = 'gang') {
        const a = Math.floor(_num(amount));
        if (!(a > 0)) return 0;
        player.gold = _num(player.gold) + a;
        Ledger.record(player, cat, a);
        Gangs.addDirty(player, a);
        Underworld.ensure(player).stats.earned += a;
        return a;
    },

    /** Run one of the gang's errands here. */
    doErrand(player, world, tile, id) {
        const offer = Gangs.errands(player, world, tile).find(e => e.id === id);
        if (!offer) return { success: false, reason: 'No such job.' };
        if (offer.locked) return { success: false, reason: offer.locked };
        if (!Gangs._spendAP(player, _num(offer.ap, 2))) return { success: false, reason: `This takes ${offer.ap} action points.` };
        const s = tile.settlement;
        const st = Gangs.town(world, tile);
        const m = Gangs.membership(player, tile);
        const g = Gangs.gang(world, tile, m.gangId);
        const where = { kingdom: s.kingdom, q: tile.q, r: tile.r };
        const won = Utils.random() < offer.odds;
        if (offer.karma && won) player.karma = Math.max(-100, _num(player.karma) + offer.karma);
        Gangs.addCrackdown(world, tile.q, tile.r, _num(offer.crackdown) * (won ? 1 : 1.5));
        if (!won) {
            const caught = Utils.random() < 0.45;
            Underworld.recordCrime(player, world, offer.heatCrime || 'theft', { ...where, caught, scale: caught ? 1 : 0.5 });
            if (id === 'run_cargo') {
                // The gang's coin is spent and the load is lost at the border
                const run = Gangs._smuggleRun(world, tile, g, { dryRun: false, lose: true });
                return { success: true, outcome: caught ? 'caught' : 'empty', text: `The cargo was taken at the border${run ? ` (${run.units} ${_label(run.good)}, ${run.cost}g of the gang's coin)` : ''}.${caught ? ` ${Gangs._caught(player, world, tile, offer.name)}` : ''}` };
            }
            if (id === 'hit') player.health = Math.max(1, _num(player.health, 100) - 15);
            return { success: true, outcome: caught ? 'caught' : 'empty', text: caught ? `${offer.name}: it went wrong. ${Gangs._caught(player, world, tile, offer.name)}` : `${offer.name}: it went sour; you got away with nothing.` };
        }
        Underworld.recordCrime(player, world, offer.heatCrime || 'theft', where);
        let text = '';
        if (id === 'collect') {
            const want = Math.max(5, _num(Economy.townPurse(s), _num(s.population, 1000) * 2) * _num(offer.purseShare, 0.004) * Math.max(0.2, g.turf * 2));
            const took = Economy.drawTown(s, want);
            const mine = Math.floor(took * _num(offer.share, 0.2));
            g.purse = _r2(g.purse + took - mine);
            Gangs._book(g, 'in', 'collections', took);
            Gangs._book(g, 'out', 'toYou', mine);
            Gangs._payPlayer(player, mine);
            text = `You walk the rounds: ${Math.floor(took)}g from the shops of ${s.name}. ${mine}g is yours.`;
        } else if (id === 'holdout') {
            g.turf = _r2(Math.min(1, g.turf + _num(offer.turf, 0.05)));
            Gangs._normaliseTurf(st);
            Traits.recordDeeds(player, { cruelty: 1, dread: 1 });
            text = `The holdout pays now, and so will his neighbours. ${g.name} holds ${Math.round(g.turf * 100)}% of the streets.`;
        } else if (id === 'forge') {
            for (const [good, n] of Object.entries(offer.needs || {})) Underworld._removeGoods(player, good, n);
            const made = {};
            for (const [good, n] of Object.entries(offer.makes || {})) {
                const res = PlayerInventory.addItem(player, good, n);
                if (res && res.success) made[good] = n;
            }
            text = Object.keys(made).length ? `Seals, signatures, a passable hand: ${PlayerInventory.describe(made)}. Contraband everywhere; the black market pays well.` : 'You made the papers, but your packs were too full to carry them.';
        } else if (id === 'run_cargo') {
            const run = Gangs._smuggleRun(world, tile, g, {});
            if (run) {
                const worth = run.units * Underworld._baseValue(run.good) * Gangs.blackScarcity(world, tile, run.good);
                const mine = Math.min(Math.floor(g.purse), Math.floor(worth * _num(offer.share, 0.15)));
                g.purse = _r2(g.purse - mine);
                Gangs._book(g, 'out', 'toYou', mine);
                Gangs._payPlayer(player, mine);
                text = `You bring ${run.units} ${_label(run.good)} in from ${run.from}, bought for ${run.cost}g of the gang's coin. Your cut: ${mine}g.`;
            } else {
                text = 'The run comes to nothing: no seller over the border, or no coin in the purse.';
            }
        } else if (id === 'hit') {
            const foe = Gangs.rivals(world, tile, g).filter(x => Gangs.atWar(g, x)).sort((a, b) => b.crew - a.crew)[0];
            const losses = Math.min(foe.crew, Utils.randInt(2, 4));
            foe.crew -= losses;
            const shift = Math.min(foe.turf, _num(Gangs.c('war', {}).turfShift, 0.08));
            foe.turf = _r2(foe.turf - shift);
            g.turf = _r2(g.turf + shift);
            Gangs._normaliseTurf(st);
            Traits.recordDeeds(player, { cruelty: 1, dread: 1 });
            text = `You hit ${foe.name} where it hurts: ${losses} of theirs won't walk again, and their streets are yours.`;
            if (foe.crew <= _num(Gangs.c('war', {}).endCrew, 3)) text += ` ${Gangs._endWar(world, tile, st, g, foe)}`;
        } else if (id === 'kidnap') {
            const want = Math.min(_num(offer.ransomMax, 450), _num(Economy.townPurse(s), _num(s.population, 1000) * 2) * _num(offer.purseShare, 0.04));
            const ransom = Economy.drawTown(s, Math.max(20, want));
            const mine = Math.floor(ransom * _num(offer.share, 0.3));
            g.purse = _r2(g.purse + ransom - mine);
            Gangs._book(g, 'in', 'ransoms', ransom);
            Gangs._book(g, 'out', 'toYou', mine);
            Gangs._payPlayer(player, mine);
            text = `The family pays ${Math.floor(ransom)}g and gets their child back. ${mine}g is yours; the rest is the gang's.`;
        }
        const promoted = Gangs._gainStanding(player, world, tile, m, _num(offer.standing, 2));
        if (Utils.random() < 0.08 && player.skills) player.skills.stealth = Math.min(10, _num(player.skills.stealth, 1) + 1);
        if (promoted) text += ` You rise to ${promoted.icon} ${promoted.name} of ${g.name}.`;
        return { success: true, outcome: 'success', promoted, text };
    },

    /** The watch takes you: a fine to the town and maybe a cell. */
    _caught(player, world, tile, what) {
        const s = tile.settlement;
        const guard = Underworld.guardStrength(s, Gangs._kingdom(world, s));
        const fine = Math.min(_num(player.gold), Math.round(20 * guard * Laws.punishment(world, s.kingdom).fine));
        player.gold -= fine;
        if (fine > 0) {
            Ledger.record(player, 'fines', -fine);
            Economy.payTown(s, fine);
            Gangs._dirtyFollowsGold(player);
        }
        const arrest = Underworld._maybeArrest(player, world, s, _label(what));
        return `Fined ${fine}g.${arrest ? ` ${arrest.text}` : ' You slipped the cells.'}`;
    },

    /** Move against the boss (a lieutenant): win, and the gang is yours. */
    challengeOdds(player, world, tile) {
        const g = Gangs.myGang(player, world, tile);
        const m = Gangs.membership(player, tile);
        if (!g || !m) return 0;
        const C = Gangs.c('challenge', {});
        const loyal = g.lieutenants.filter(l => l.loyalty < 40).length;
        return _clamp(_num(C.base, 0.4)
            + _num(player.skills && player.skills.combat, 1) * _num(C.combat, 0.05)
            + _num(player.skills && player.skills.leadership, 1) * _num(C.leadership, 0.04)
            + _num(m.standing) * _num(C.standingPer, 0.002)
            + loyal * _num(C.lieutenantLoyal, 0.05)
            - _num(g.boss.might, 5) * _num(C.bossMight, 0.04), 0.1, 0.85);
    },

    challengeBoss(player, world, tile) {
        const g = Gangs.myGang(player, world, tile);
        const m = Gangs.membership(player, tile);
        if (!g || !m) return { success: false, reason: 'You run with no crew here.' };
        if (g.boss.player) return { success: false, reason: 'You are the boss.' };
        if (m.rank < Gangs.BOSS_RANK() - 1) return { success: false, reason: `Only a ${Gangs.rankDef(Gangs.BOSS_RANK() - 1).name} can move against the boss.` };
        if (!Gangs._spendAP(player, 4)) return { success: false, reason: 'This takes 4 action points.' };
        const odds = Gangs.challengeOdds(player, world, tile);
        const st = Gangs.town(world, tile);
        const old = g.boss.name;
        Gangs.addCrackdown(world, tile.q, tile.r, 6);
        if (Utils.random() < odds) {
            g.boss = { name: player.name || 'you', player: true, might: 5 };
            m.rank = Gangs.BOSS_RANK();
            // The boss's own men remember
            for (const l of g.lieutenants) l.loyalty = _clamp(l.loyalty + (l.loyalty < 40 ? 15 : -10), 0, 100);
            Traits.recordDeeds(player, { cruelty: 1, dread: 2 });
            player.karma = Math.max(-100, _num(player.karma) - 3);
            Underworld.recordCrime(player, world, 'murder', { kingdom: tile.settlement.kingdom, scale: 0.4 });
            Gangs._log(st, world, `${player.name || 'A lieutenant'} put ${old} in the river and took ${g.name}.`);
            return { success: true, outcome: 'success', text: `${old} won't trouble anyone again. ${g.name} is yours.` };
        }
        const uw = Gangs._pst(player);
        delete uw.gangs[_key(tile.q, tile.r)];
        g.banned = true;
        player.health = Math.max(1, _num(player.health, 100) - _num(Gangs.c('challenge', {}).failHealth, 25));
        Gangs._log(st, world, `${old} beat off a challenge from ${player.name || 'a lieutenant'}.`);
        return { success: true, outcome: 'failed', text: `${old} was ready for you. You crawl out bleeding, and ${g.name} will kill you on sight now.` };
    },

    // ──────────── THE BOSS ────────────

    retainer(world, tile, who) {
        const W = Gangs.c('watch', {});
        const guard = Underworld.guardStrength(tile.settlement, Gangs._kingdom(world, tile.settlement));
        const per = who === 'magistrate' ? _num(W.magistrateRetainerPerGuard, 14) : _num(W.captainRetainerPerGuard, 18);
        return Math.round(per * guard);
    },

    crewCap(settlement) {
        return Math.max(6, Math.floor(_num(settlement && settlement.population, 1000) * _num(Gangs.cfg().crewPerPopMax, 0.01)));
    },

    weeklyWages(g) {
        const ranks = Gangs.ranks();
        // (a lieutenant's wage; the player's own pay is their rank's weeklyPay)
        const ltPay = _num(Gangs.cfg().lieutenantWage, _num((ranks[Gangs.BOSS_RANK() - 1] || {}).weeklyPay, 22));
        return Math.round(g.crew * _num(Gangs.cfg().wagePerCrew, 3) + g.lieutenants.length * ltPay);
    },

    /** The boss's hand: op is cut/hire/bonus/purge/captain/magistrate/den/smuggle/war/truce/withdraw/deposit. */
    bossAct(player, world, tile, op, arg = null) {
        const g = Gangs.myGang(player, world, tile);
        if (!g || !g.boss || !g.boss.player) return { success: false, reason: 'Only the boss gives that order.' };
        const s = tile.settlement;
        const st = Gangs.town(world, tile);
        const L = Gangs.c('lieutenants', {});
        switch (op) {
            case 'cut': {
                const cuts = Gangs.c('cuts', [0.1, 0.25, 0.4]);
                const v = cuts[_clamp(Math.floor(_num(Number(arg))), 0, cuts.length - 1)];
                g.cut = v;
                return { success: true, text: `You will take ${Math.round(v * 100)}% of the week's take.${v > _num(L.fairCut, 0.25) ? ' Your lieutenants mutter.' : ''}` };
            }
            case 'hire': {
                const n = Math.max(1, Math.min(5, Math.floor(_num(Number(arg), 2))));
                const fee = _num(Gangs.cfg().recruitFee, 25);
                const room = Gangs.crewCap(s) - g.crew;
                if (room <= 0) return { success: false, reason: `${s.name} has no more hard men to sign (${Gangs.crewCap(s)} at most).` };
                const k = Math.min(n, room);
                if (g.purse < fee * k) return { success: false, reason: `Signing ${k} costs ${fee * k}g; the purse holds ${Math.floor(g.purse)}g.` };
                g.purse = _r2(g.purse - fee * k);
                Gangs._book(g, 'out', 'recruits', fee * k);
                Economy.payTown(s, fee * k);
                g.crew += k;
                return { success: true, text: `${k} new ${k === 1 ? 'face' : 'faces'} sign on for ${fee}g a head. Crew: ${g.crew}.` };
            }
            case 'bonus': {
                const lt = g.lieutenants.find(l => l.id === arg);
                const cost = _num(L.bonusCost, 50);
                if (!lt) return { success: false, reason: 'No such lieutenant.' };
                if (g.purse < cost) return { success: false, reason: `A bonus is ${cost}g; the purse is short.` };
                g.purse = _r2(g.purse - cost);
                Gangs._book(g, 'out', 'bonuses', cost);
                Economy.payTown(s, cost);
                lt.loyalty = _clamp(lt.loyalty + _num(L.bonusLoyalty, 15), 0, 100);
                return { success: true, text: `${lt.name} weighs the purse and grins. (Loyalty ${Math.round(lt.loyalty)})` };
            }
            case 'purge': {
                const lt = g.lieutenants.find(l => l.id === arg);
                if (!lt) return { success: false, reason: 'No such lieutenant.' };
                g.lieutenants = g.lieutenants.filter(l => l !== lt);
                for (const l of g.lieutenants) l.loyalty = _clamp(l.loyalty + _num(L.purgeFear, -6), 0, 100);
                g.crew = Math.max(1, g.crew - 1);
                Gangs.addCrackdown(world, tile.q, tile.r, _num(L.purgeCrackdown, 10));
                player.karma = Math.max(-100, _num(player.karma) - 4);
                Traits.recordDeeds(player, { cruelty: 2, dread: 2 });
                Underworld.recordCrime(player, world, 'murder', { kingdom: s.kingdom, scale: 0.3 });
                Gangs._log(st, world, `${lt.name} of ${g.name} was found in the river.`);
                return { success: true, text: `${lt.name} is found in the river. The others watch you differently now.` };
            }
            case 'captain':
            case 'magistrate': {
                const w = st.watch[op];
                if (w.bribedBy === g.id) {
                    w.bribedBy = null;
                    return { success: true, text: `You stop paying ${w.name}.` };
                }
                const fee = Gangs.retainer(world, tile, op);
                if (g.purse < fee * 2) return { success: false, reason: `${w.name} wants ${fee}g a week, and two weeks up front.` };
                if (w.bribedBy && Gangs.gang(world, tile, w.bribedBy)) {
                    // Outbid a rival: it costs double, and they will know
                    const rival = Gangs.gang(world, tile, w.bribedBy);
                    if (g.purse < fee * 4) return { success: false, reason: `${w.name} is on ${rival.name}'s payroll. To turn him costs ${fee * 4}g.` };
                    g.purse = _r2(g.purse - fee * 2);
                    Gangs._book(g, 'out', 'bribes', fee * 2);
                    w.purse = _r2(_num(w.purse) + fee * 2);
                    rival.feud = _num(rival.feud) + 25;
                }
                g.purse = _r2(g.purse - fee * 2);
                Gangs._book(g, 'out', 'bribes', fee * 2);
                w.purse = _r2(_num(w.purse) + fee * 2);
                w.bribedBy = g.id;
                Traits.recordDeed(player, 'deceit', 1);
                return { success: true, text: op === 'captain'
                    ? `${w.name} is yours at ${fee}g a week: fewer searches at the gate, no raids on ${g.name}, and the watch slower on your heels.`
                    : `${w.name} is yours at ${fee}g a week: if you're taken in ${s.name}, the case falls apart.` };
            }
            case 'den': {
                const D = Gangs.c('dens', {});
                const max = _num((D.maxByType || {})[s.type], 1);
                const total = Gangs.gangsAt(world, tile).reduce((a, x) => a + x.dens, 0);
                if (total >= max + 1 || g.dens >= max) return { success: false, reason: `${s.name} can't keep another den.` };
                const cost = _num(D.openCost, 220);
                if (g.purse < cost) return { success: false, reason: `Fitting out a den costs ${cost}g of the gang's coin.` };
                g.purse = _r2(g.purse - cost);
                Gangs._book(g, 'out', 'denOpen', cost);
                Economy.payTown(s, cost);
                g.dens++;
                return { success: true, text: `A cellar, a few tables, dice and a doorman: ${g.name} runs ${g.dens} den${g.dens === 1 ? '' : 's'} now.` };
            }
            case 'smuggle':
                g.smuggling = !g.smuggling;
                return { success: true, text: g.smuggling ? `${g.name} will run contraband over the border each week.` : `${g.name} stops its runs over the border.` };
            case 'war': {
                const foe = Gangs.gang(world, tile, arg);
                if (!foe || foe === g) return { success: false, reason: 'No such crew.' };
                if (Gangs.atWar(g, foe)) return { success: false, reason: 'You are already at war.' };
                if (_num(g.truces[foe.id]) > _day(world)) return { success: false, reason: `There's a truce with ${foe.name} until day ${g.truces[foe.id]}.` };
                Gangs._declare(world, g, foe);
                Gangs._log(st, world, `${g.name} went to war with ${foe.name}.`);
                return { success: true, text: `It's war with ${foe.name}. Every week your crews clash in the streets; send your best to hit them.` };
            }
            case 'truce': {
                const foe = Gangs.gang(world, tile, arg);
                if (!foe || !Gangs.atWar(g, foe)) return { success: false, reason: 'You are not at war with them.' };
                const tribute = Math.ceil(g.purse * _num(Gangs.c('war', {}).tributeShare, 0.3));
                const theirs = Gangs._strength(null, foe);
                const ours = Gangs._strength(player, g);
                if (theirs > ours * 1.2 && tribute < 50) return { success: false, reason: `${foe.boss.name} laughs: you have nothing to pay with.` };
                g.purse = _r2(g.purse - tribute);
                foe.purse = _r2(foe.purse + tribute);
                Gangs._book(g, 'out', 'tribute', tribute);
                Gangs._book(foe, 'in', 'tribute', tribute);
                Gangs._peace(world, g, foe);
                return { success: true, text: `${foe.boss.name} takes ${tribute}g and the truce holds until day ${g.truces[foe.id]}.` };
            }
            case 'withdraw': {
                const want = Math.min(Math.floor(g.purse), Math.max(1, Math.floor(_num(Number(arg), 100))));
                if (want <= 0) return { success: false, reason: 'The purse is empty.' };
                g.purse = _r2(g.purse - want);
                Gangs._book(g, 'out', 'toYou', want);
                Gangs._payPlayer(player, want);
                // The men notice when the boss empties the purse
                if (want > Gangs.weeklyWages(g) * 2) for (const l of g.lieutenants) l.loyalty = _clamp(l.loyalty - 3, 0, 100);
                return { success: true, text: `You take ${want}g from ${g.name}'s purse. It's dirty money.` };
            }
            case 'deposit': {
                const want = Math.min(Math.floor(_num(player.gold)), Math.max(1, Math.floor(_num(Number(arg), 100))));
                if (want <= 0) return { success: false, reason: 'You have nothing to put in.' };
                player.gold -= want;
                Ledger.record(player, 'gang', -want);
                Gangs._dirtyFollowsGold(player);
                g.purse = _r2(g.purse + want);
                Gangs._book(g, 'in', 'deposits', want);
                return { success: true, text: `You put ${want}g into ${g.name}'s purse.` };
            }
            default:
                return { success: false, reason: 'Unknown order.' };
        }
    },

    _declare(world, a, b) {
        const day = _day(world);
        a.wars[b.id] = { since: day };
        b.wars[a.id] = { since: day };
    },

    _peace(world, a, b) {
        const until = _day(world) + _num(Gangs.c('war', {}).truceDays, 60);
        delete a.wars[b.id];
        delete b.wars[a.id];
        a.truces[b.id] = until;
        b.truces[a.id] = until;
        a.feud = 0;
        b.feud = 0;
    },

    /** A gang broken in war: its streets, purse and stash go to the victor. */
    _endWar(world, tile, st, winner, loser) {
        winner.turf = _r2(Math.min(1, winner.turf + loser.turf));
        winner.purse = _r2(winner.purse + loser.purse);
        Gangs._book(winner, 'in', 'plunder', loser.purse);
        for (const [good, n] of Object.entries(loser.stash)) winner.stash[good] = _r2(_num(winner.stash[good]) + n);
        winner.crew += Math.floor(loser.crew / 2);
        loser.dissolved = true;
        loser.purse = 0;
        loser.stash = {};
        loser.turf = 0;
        for (const g of st.gangs) {
            delete g.wars[loser.id];
            delete g.truces[loser.id];
        }
        // A bought watch answers to nobody now
        for (const who of ['captain', 'magistrate']) if (st.watch[who].bribedBy === loser.id) st.watch[who].bribedBy = null;
        st.gangs = st.gangs.filter(g => !g.dissolved);
        Gangs._normaliseTurf(st);
        Gangs._log(st, world, `${loser.name} is finished; ${winner.name} holds their streets.`);
        return `${loser.name} is finished: their streets, purse and stash are ${winner.name}'s.`;
    },

    // ──────────── SMUGGLING ────────────

    /** A good banned or tariffed here that is traded somewhere (a run's cargo), or null. */
    _smuggleChoice(world, tile) {
        const kingdom = Gangs._kingdom(world, tile.settlement);
        if (!kingdom) return null;
        const list = Underworld.contrabandList(kingdom);
        const goods = [...list.illegal, ...list.tariff].filter(id => SettlementMarket.tracks(id));
        if (!goods.length) return null;
        // The dearest on the black market here first
        return goods.sort((a, b) => Gangs.blackScarcity(world, tile, b) * Underworld._baseValue(b) - Gangs.blackScarcity(world, tile, a) * Underworld._baseValue(a))[0];
    },

    /** The nearest town over the border where the good is legal and in stock: { tile, s, ask }. */
    _source(world, tile, good) {
        const R = _num(Gangs.c('smuggling', {}).sourceRadius, 14);
        let best = null;
        let bd = Infinity;
        const all = world && typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : world && typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : [];
        for (const v of all) {
            if (v.kingdom === tile.settlement.kingdom) continue;
            const t = Gangs._tileOf(world, v.q, v.r);
            const s = t && t.settlement;
            if (!s) continue;
            const k = Gangs._kingdom(world, s);
            if (Underworld.contrabandStatus(k, good) !== 'legal') continue;
            if (SettlementMarket.available(s, good) < 1) continue;
            const d = world.width ? Hex.wrappingDistance(tile.q, tile.r, v.q, v.r, world.width) : Math.abs(tile.q - v.q) + Math.abs(tile.r - v.r);
            if (d > R || d >= bd) continue;
            bd = d;
            best = { tile: t, s, d };
        }
        if (!best) return null;
        const ask = Economy.marketAsk(world, best.tile, good);
        best.ask = Math.max(1, Math.round(ask != null && ask > 0 ? ask : Underworld._baseValue(good)));
        return best;
    },

    /**
     * A run over the border: the gang buys contraband from a foreign town's
     * market (its stock down, its purse paid) and brings it to the stash.
     * lose: the load is seized at the border (bought, never arrives).
     */
    _smuggleRun(world, tile, g, { lose = false } = {}) {
        const good = Gangs._smuggleChoice(world, tile);
        if (!good) return null;
        const S = Gangs.c('smuggling', {});
        if (_num(g.stash[good]) >= _num(S.maxStashPerGood, 30)) return null;
        const src = Gangs._source(world, tile, good);
        if (!src) return null;
        const want = Math.min(_range(S.runUnits, [3, 6]), Math.floor(g.purse / src.ask), SettlementMarket.available(src.s, good));
        if (!(want > 0)) return null;
        const got = SettlementMarket.take(src.s, good, want);
        const cost = Math.round(got * src.ask);
        g.purse = _r2(g.purse - cost);
        Gangs._book(g, 'out', 'smuggling', cost);
        Economy.payTown(src.s, cost);
        if (!lose) g.stash[good] = _r2(_num(g.stash[good]) + got);
        return { good, units: got, cost, from: src.s.name };
    },

    // ──────────── DIRTY COIN ────────────

    dirty(player) {
        const uw = player && player.underworld;
        return uw ? Math.min(_num(uw.dirty), Math.max(0, _num(player.gold))) : 0;
    },

    addDirty(player, amount) {
        if (!player || !(amount > 0)) return 0;
        const uw = Gangs._pst(player);
        uw.dirty = _r2(Math.min(_num(uw.dirty) + amount, Math.max(0, _num(player.gold))));
        return uw.dirty;
    },

    /** Spending: what's left of the purse can't be dirtier than the purse. */
    _dirtyFollowsGold(player) {
        const uw = player && player.underworld;
        if (uw && _num(uw.dirty) > Math.max(0, _num(player.gold))) uw.dirty = Math.max(0, Math.floor(_num(player.gold)));
    },

    /**
     * The watch takes `share` of the dirty coin the player carries (a search,
     * an arrest), into the town's coffers. → gold seized.
     */
    seizeDirty(player, settlement, share) {
        const d = Gangs.dirty(player);
        const take = Math.floor(d * _clamp(_num(share), 0, 1));
        if (!(take > 0)) return 0;
        player.gold -= take;
        player.underworld.dirty = _r2(d - take);
        Ledger.record(player, 'fines', -take);
        if (settlement) Economy.payTown(settlement, take);
        return take;
    },

    /** What fronts here can wash this week: { total, left, fronts: [{ name, cap }] }. */
    launderCapacity(player, world, tile) {
        const Lc = Gangs.c('launder', {});
        const caps = _obj(Lc.frontCapacity) || {};
        const fronts = [];
        for (const p of (tile && tile.playerProperties) || []) {
            if (!p || p.underConstruction) continue;
            fronts.push({ name: `your ${_label(p.type)}`, cap: _num(caps[p.type], _num(caps._default, 60)) });
        }
        const g = Gangs.myGang(player, world, tile);
        if (g && g.boss && g.boss.player && g.dens > 0) fronts.push({ name: `${g.name}'s dens`, cap: g.dens * _num(Lc.denCapacity, 150) });
        const total = fronts.reduce((a, f) => a + f.cap, 0);
        const uw = Gangs._pst(player);
        const week = Math.floor(_day(world) / 7);
        const rec = uw.laundered[_key(tile.q, tile.r)];
        const used = rec && rec.week === week ? _num(rec.amount) : 0;
        return { total, left: Math.max(0, total - used), fronts, fee: _num(Lc.fee, 0.15) };
    },

    /** Wash dirty coin through your fronts here: the fee is paid out to the town (the books' false trade). */
    launder(player, world, tile, amount) {
        const cap = Gangs.launderCapacity(player, world, tile);
        if (!cap.fronts.length) return { success: false, reason: 'You own no front here: a tavern, an inn, a trading post, a shop, or your gang\'s dens.' };
        const d = Gangs.dirty(player);
        const want = Math.min(d, cap.left, Math.max(1, Math.floor(_num(Number(amount), d))));
        if (!(want > 0)) return { success: false, reason: d <= 0 ? 'Your coin is clean.' : 'Your fronts here have washed all they can this week.' };
        const fee = Math.ceil(want * cap.fee);
        player.gold -= fee;
        Ledger.record(player, 'laundering', -fee);
        Economy.payTown(tile.settlement, fee);
        const uw = Gangs._pst(player);
        uw.dirty = _r2(Math.max(0, d - want));
        Gangs._dirtyFollowsGold(player);
        const week = Math.floor(_day(world) / 7);
        const k = _key(tile.q, tile.r);
        const rec = uw.laundered[k];
        uw.laundered[k] = { week, amount: (rec && rec.week === week ? _num(rec.amount) : 0) + want };
        return { success: true, text: `${want}g goes through the books of ${cap.fronts.map(f => f.name).join(' and ')} as honest takings. The fee: ${fee}g.` };
    },

    // ──────────── THE GUILD'S TITHE ────────────

    /** Draw up to `amount` from the gangs' purses everywhere (their tithe to the guild). → gold drawn. */
    tithe(world, amount) {
        const want = _num(amount);
        if (!(want > 0)) return 0;
        const share = _num(Gangs.cfg().guildTithe, 0.05);
        const gangs = [];
        for (const t of Gangs._towns(world)) {
            const st = t.settlement.underworld;
            if (!st || !Array.isArray(st.gangs)) continue;
            for (const g of st.gangs) if (!g.dissolved && !(g.boss && g.boss.player) && g.purse > 0) gangs.push(g);
        }
        const pool = gangs.reduce((a, g) => a + g.purse * share, 0);
        if (!(pool > 0)) return 0;
        const k = Math.min(1, want / pool);
        let got = 0;
        for (const g of gangs) {
            const take = Math.floor(g.purse * share * k * 100) / 100;
            g.purse = _r2(g.purse - take);
            Gangs._book(g, 'out', 'tithes', take);
            got += take;
        }
        return Math.floor(got);
    },

    // ──────────── THE WEEK ────────────

    /**
     * Daily: on the week's day, every town's underworld turns (its own seeded
     * stream). The player's dirty purse can't outgrow the purse, and draws
     * heat when it's big. → { notices: [{ icon, title, text, type }] }.
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world) return out;
        if (player && player.underworld) Gangs._dirtyFollowsGold(player);
        const day = _day(world);
        if (day <= 0 || day % 7 !== 3) return out;
        Utils.withRng(_rng(world, `week:${day}`), () => Gangs._week(world, player, out));
        return out;
    },

    _note(out, text, type = 'info', title = 'The Underworld') {
        out.notices.push({ icon: '🗝️', title, text, type });
    },

    _week(world, player, out) {
        for (const t of Gangs._towns(world)) {
            const st = Gangs.town(world, t.tile);
            if (st) Gangs._weekTown(world, t, st, player, out);
        }
        // A big dirty purse is talked about where you stand
        if (player && player.underworld) {
            const D = Gangs.c('dirty', {});
            const d = Gangs.dirty(player);
            const here = Gangs._tileOf(world, player.q, player.r);
            const kid = here && (here.kingdom || (here.settlement && here.settlement.kingdom));
            if (kid && d >= _num(D.unexplainedFrom, 1500)) {
                Underworld.addHeat(player, kid, _num(D.unexplainedHeat, 3) * Math.min(3, d / _num(D.unexplainedFrom, 1500)), world);
                Gangs._note(out, `Tongues wag about where your ${Math.floor(d)}g of dirty coin came from. Launder it through a front.`, 'warning');
            }
        }
    },

    _weekTown(world, t, st, player, out) {
        const s = t.settlement;
        const tile = t.tile;
        const kingdom = Gangs._kingdom(world, s);
        const W = Gangs.c('watch', {});
        const L = Gangs.c('lieutenants', {});
        const P = Gangs.c('protection', {});
        const D = Gangs.c('dens', {});
        const B = Gangs.c('blackMarket', {});
        const viceId = s.kingdom != null ? (Laws.value(world, s.kingdom, 'vice') || 'tolerated') : 'tolerated';
        const vice = { den: 1, crackdown: 0, licence: 0, ...((Gangs.c('vice', {}))[viceId] || {}) };
        const pun = Laws.punishment(world, s.kingdom);
        const pop = _num(s.population, 1000);
        const day = _day(world);
        const watch = st.watch;
        const key = _key(t.q, t.r);
        const m = player && player.underworld && _obj(player.underworld.gangs) ? player.underworld.gangs[key] : null;
        const live = () => st.gangs.filter(g => !g.dissolved);

        // A gang the player bossed, with no player (a new life) or the membership gone: a lieutenant takes it
        for (const g of live()) {
            if (g.boss && g.boss.player && (!m || m.gangId !== g.id)) Gangs._succeed(world, tile, g, 'the old boss is gone');
        }

        for (const g of live()) {
            g.week = { protection: 0, dens: 0, sales: 0, resale: 0, wages: 0, smuggled: null, raided: 0 };
            // ── Income: the town's coin ──
            const purseNow = _num(Economy.townPurse(s), pop * 2);
            const prot = Math.min(_num(P.max, 400), purseNow * _num(P.shareOfPurse, 0.012) + pop * _num(P.perHead, 0.03))
                * g.turf * Math.max(0.2, 1 - _num(watch.crackdown) / _num(P.crackdownRelief, 150));
            g.week.protection = Economy.drawTown(s, prot);
            if (g.dens > 0) {
                // The gamblers' coin: a share of what the town has, and of its people
                const want = g.dens * Math.min(_num(D.max, 160), pop * _num(D.perHead, 0.012) + _num(Economy.townPurse(s), 0) * _num(D.shareOfPurse, 0)) * _num(vice.den, 1);
                const took = Economy.drawTown(s, want);
                const licence = Math.floor(took * _num(vice.licence));
                if (licence > 0 && kingdom) {
                    kingdom.treasury = _num(kingdom.treasury) + licence;
                    CrownBooks.note(kingdom, 'other', licence);
                }
                g.week.dens = took - licence;
                watch.crackdown = _clamp(_num(watch.crackdown) + g.dens * (_num(D.crackdown, 2) + _num(vice.crackdown)), 0, 100);
            }
            // Fenced goods, cold now: contraband to the stash, the rest back into the town's market
            const cool = _num(Gangs.c('fence', {}).coolDays, 10);
            const keep = [];
            for (const f of g.fenced || []) {
                if (day - _num(f.day) < cool) { keep.push(f); continue; }
                const status = Underworld.contrabandStatus(kingdom, f.good);
                if (status === 'legal' && SettlementMarket.tracks(f.good)) {
                    const value = Math.round(f.qty * Underworld._baseValue(f.good) * _num(Gangs.c('fence', {}).resaleShare, 0.8));
                    const paid = Economy.drawTown(s, value);
                    SettlementMarket.add(s, f.good, f.qty);
                    g.week.resale += paid;
                } else {
                    g.stash[f.good] = _r2(_num(g.stash[f.good]) + f.qty);
                }
            }
            g.fenced = keep;
            // The black market: the town's people buy from the stash at supply-and-demand prices,
            // with what they can spare of the town's coin (purseShare a week, shared among the gangs)
            const share = live().length > 1 ? 1 / live().length : 1;
            let budget = B.purseShare != null ? _num(Economy.townPurse(s), pop * 2) * _num(B.purseShare) * share : Infinity;
            for (const [good, n] of Object.entries(g.stash)) {
                if (!(n > 0)) { delete g.stash[good]; continue; }
                const status = Underworld.contrabandStatus(kingdom, good);
                const need = SettlementMarket.tracks(good) ? Math.max(SettlementMarket.need(s, good), SettlementMarket.refNeed(s, good)) : Gangs.blackTarget(tile, good) / 30;
                let units = Math.min(n, Math.max(1, need * _num(B.weeklyDemandDays, 7) * _num(B.consumeShare, 0.6) * share));
                if (status === 'legal') {
                    // Legal goods sell to the town's market at its price: as many as the town pays for
                    const unit = Underworld._baseValue(good) * 0.8;
                    if (unit > 0) units = Math.min(units, Math.max(0, budget) / unit);
                    const paid = Economy.drawTown(s, units * unit);
                    const sold = unit > 0 ? Math.min(units, paid / unit) : units;
                    if (SettlementMarket.tracks(good)) SettlementMarket.add(s, good, sold);
                    g.stash[good] = _r2(n - sold);
                    if (g.stash[good] <= 0.01) delete g.stash[good];
                    g.week.resale += paid;
                    budget -= paid;
                    continue;
                }
                const mult = _num(Underworld.cfg('blackMarket')[status], 1.5);
                const price = Underworld._baseValue(good) * mult * Gangs.blackScarcity(world, tile, good);
                if (price > 0) units = Math.min(units, Math.max(0, budget) / price);
                const paid = units > 0 ? Economy.drawTown(s, units * price) : 0;
                const sold = price > 0 ? Math.min(units, paid / price) : 0;
                g.stash[good] = _r2(n - sold);
                if (g.stash[good] <= 0.01) delete g.stash[good];
                g.week.sales += paid;
                budget -= paid;
            }
            const income = g.week.protection + g.week.dens + g.week.sales + g.week.resale;
            g.purse = _r2(g.purse + income);
            Gangs._book(g, 'in', 'protection', g.week.protection);
            Gangs._book(g, 'in', 'dens', g.week.dens);
            Gangs._book(g, 'in', 'blackMarket', g.week.sales);
            Gangs._book(g, 'in', 'fence', g.week.resale);

            // ── The boss's cut and the player's pay ──
            if (g.boss && g.boss.player && m && m.gangId === g.id && player) {
                const cut = Math.min(Math.floor(g.purse), Math.floor(income * _num(g.cut, 0.25)));
                if (cut > 0) {
                    g.purse = _r2(g.purse - cut);
                    Gangs._book(g, 'out', 'toYou', cut);
                    Gangs._payPlayer(player, cut);
                }
                g.week.bossCut = cut;
            } else if (m && m.gangId === g.id && player) {
                const pay = Math.min(Math.floor(g.purse), _num(Gangs.rankDef(m.rank).weeklyPay, 4));
                if (pay > 0) {
                    g.purse = _r2(g.purse - pay);
                    Gangs._book(g, 'out', 'toYou', pay);
                    Gangs._payPlayer(player, pay);
                }
                m.standing = _num(m.standing) + 1;
            }

            // ── Wages: the crew spend them in town ──
            const wages = Gangs.weeklyWages(g);
            const paid = Math.min(Math.max(0, g.purse), wages);
            g.purse = _r2(g.purse - paid);
            Economy.payTown(s, paid);
            g.week.wages = paid;
            Gangs._book(g, 'out', 'wages', paid);
            const unpaid = paid < wages - 0.5;
            const squeeze = g.boss && g.boss.player ? Math.max(0, _num(g.cut, 0.25) - _num(L.fairCut, 0.25)) * 10 * _num(L.loyaltyCutPer10, -2) : 0;
            for (const l of g.lieutenants) {
                l.loyalty = _clamp(l.loyalty + (unpaid ? _num(L.loyaltyUnpaid, -6) : _num(L.loyaltyPaid, 2)) + squeeze, 0, 100);
            }
            if (unpaid) {
                const gone = Math.max(1, Math.ceil(g.crew * 0.15));
                g.crew = Math.max(1, g.crew - gone);
                if (m && m.gangId === g.id && g.boss.player) Gangs._note(out, `${g.name} couldn't meet its wages in ${s.name}: ${gone} of the crew walked.`, 'warning');
            }
            // The watch on the payroll
            for (const who of ['captain', 'magistrate']) {
                const w = watch[who];
                if (w.bribedBy !== g.id) continue;
                const fee = Gangs.retainer(world, tile, who);
                if (g.purse >= fee) {
                    g.purse = _r2(g.purse - fee);
                    Gangs._book(g, 'out', 'bribes', fee);
                    w.purse = _r2(_num(w.purse) + fee);
                } else {
                    w.bribedBy = null;
                    if (m && m.gangId === g.id) Gangs._note(out, `${w.name} of ${s.name} is off ${g.name}'s payroll: the purse couldn't pay him.`, 'warning');
                }
            }

            // ── Contraband over the border (each week, if the gang runs it) ──
            if (g.smuggling && g.purse > wages) g.week.smuggled = Gangs._smuggleRun(world, tile, g, {});

            // ── A boss's ambitions (not the player's: they give their own orders) ──
            if (!(g.boss && g.boss.player)) Gangs._npcBoss(world, tile, st, g, s);
        }

        // ── Wars ──
        Gangs._wars(world, tile, st, player, m, out);

        // ── The watch: the crackdown, raids, what the bought men spend ──
        watch.crackdown = _clamp(_num(watch.crackdown) - _num(W.crackdownDecay, 4) * (pun.jail > 1 ? 0.75 : pun.jail < 1 ? 1.25 : 1), 0, 100);
        for (const g of live()) {
            if (watch.crackdown < _num(W.raidFrom, 35)) break;
            const boughtMult = watch.captain.bribedBy === g.id ? _num(W.boughtRaidMult, 0.25) : 1;
            const p = (watch.crackdown - _num(W.raidFrom, 35)) * _num(W.raidChancePer, 0.012) * boughtMult * pun.fine;
            if (!(Utils.random() < p)) continue;
            const R = _obj(W.raid) || {};
            const seized = Math.floor(g.purse * _num(R.purseShare, 0.3));
            g.purse = _r2(g.purse - seized);
            Gangs._book(g, 'out', 'seized', seized);
            Economy.payTown(s, seized);
            for (const good of Object.keys(g.stash)) {
                g.stash[good] = _r2(g.stash[good] * (1 - _num(R.stashShare, 0.5)));
                if (g.stash[good] <= 0.01) delete g.stash[good];
            }
            const taken = Math.floor(g.crew * _num(R.crewShare, 0.2) * pun.jail);
            g.crew = Math.max(1, g.crew - taken);
            g.stats.raids = _num(g.stats.raids) + 1;
            g.week.raided = seized;
            watch.crackdown = _clamp(watch.crackdown - 10, 0, 100);
            Gangs._log(st, world, `The watch raided ${g.name}: ${seized}g and ${taken} men taken.`);
            if (m && m.gangId === g.id && player) {
                Underworld.addHeat(player, s.kingdom, g.boss.player ? 8 : 4, world);
                Gangs._note(out, `The watch raided ${g.name} in ${s.name}: ${seized}g of the purse and ${taken} of the crew taken, the stash half burned.`, 'warning');
            }
        }
        for (const who of ['captain', 'magistrate']) {
            const w = watch[who];
            const spend = Math.floor(_num(w.purse) * _num(W.spendShare, 0.25) * 100) / 100;
            if (spend > 0) {
                w.purse = _r2(w.purse - spend);
                Economy.payTown(s, spend);
            }
        }

        // ── Lieutenants: betrayal ──
        for (const g of live()) Gangs._betrayals(world, tile, st, g, player, m, out);

        // ── New blood: a town short of gangs grows one ──
        const [lo] = Gangs.c('perType', {})[s.type] || [1, 1];
        if (live().length < lo && Utils.random() < 0.1) {
            const g = Gangs._newGang(world, s, t.q, t.r, st, { crew: 3, purse: 0, turf: 0.15, dens: 0, smuggling: false, lieutenants: 1, stash: false });
            st.gangs.push(g);
            Gangs._log(st, world, `${g.name} started working the streets.`);
        }
        Gangs._normaliseTurf(st);
        // The week's books close: errands since the last turn and this turn are last week now
        for (const g of live()) Gangs._closeWeek(g);
    },

    _npcBoss(world, tile, st, g, s) {
        const wages = Gangs.weeklyWages(g);
        const fee = _num(Gangs.cfg().recruitFee, 25);
        if (g.purse > wages * 6 && g.crew < Gangs.crewCap(s)) {
            const k = Math.min(3, Gangs.crewCap(s) - g.crew, Math.floor((g.purse - wages * 4) / fee));
            if (k > 0) {
                g.purse = _r2(g.purse - fee * k);
                Gangs._book(g, 'out', 'recruits', fee * k);
                Economy.payTown(s, fee * k);
                g.crew += k;
            }
        }
        const D = Gangs.c('dens', {});
        const maxDens = _num((D.maxByType || {})[s.type], 1);
        if (g.dens < maxDens && g.purse > _num(D.openCost, 220) * 2 + wages * 2 && Utils.random() < 0.15) {
            g.purse = _r2(g.purse - _num(D.openCost, 220));
            Gangs._book(g, 'out', 'denOpen', _num(D.openCost, 220));
            Economy.payTown(s, _num(D.openCost, 220));
            g.dens++;
        }
        const w = st.watch.captain;
        const fee2 = Gangs.retainer(world, tile, 'captain');
        if (!w.bribedBy && _num(st.watch.crackdown) > 40 && g.purse > fee2 * 4 + wages) {
            g.purse = _r2(g.purse - fee2 * 2);
            Gangs._book(g, 'out', 'bribes', fee2 * 2);
            w.purse = _r2(_num(w.purse) + fee2 * 2);
            w.bribedBy = g.id;
        }
        if (g.lieutenants.length < 2 && g.crew > 5) {
            g.lieutenants.push(Gangs._lieutenant(st, 55));
            g.crew--;
        }
        // War: a stronger gang moves on a weaker one
        const W = Gangs.c('war', {});
        for (const other of Gangs.rivals(world, tile, g)) {
            if (Gangs.atWar(g, other) || _num(g.truces[other.id]) > _day(world)) continue;
            const ratio = Gangs._strength(null, g) / Math.max(1, Gangs._strength(null, other));
            const chance = _num(W.declareChance, 0.12) * (1 + _num(g.feud) / 50);
            if (ratio >= _num(W.declareRatio, 1.35) && Utils.random() < chance) {
                Gangs._declare(world, g, other);
                Gangs._log(st, world, `${g.name} went to war with ${other.name}.`);
            }
        }
        g.feud = Math.max(0, _num(g.feud) - 2);
        // The boss and his men live high on what the purse holds beyond a war chest: spent in town
        const reserve = wages * _num(Gangs.cfg().reserveWeeks, 8) + _num(D.openCost, 220);
        if (g.purse > reserve) {
            const spend = Math.floor((g.purse - reserve) * _num(Gangs.cfg().spendExcess, 0.3));
            g.purse = _r2(g.purse - spend);
            Gangs._book(g, 'out', 'spending', spend);
            Economy.payTown(s, spend);
        }
    },

    _wars(world, tile, st, player, m, out) {
        const W = Gangs.c('war', {});
        const done = new Set();
        for (const a of st.gangs.slice()) {
            if (a.dissolved) continue;
            for (const bid of Object.keys(a.wars || {})) {
                const b = st.gangs.find(x => x.id === bid && !x.dissolved);
                if (!b) { delete a.wars[bid]; continue; }
                const pair = [a.id, b.id].sort().join('|');
                if (done.has(pair)) continue;
                done.add(pair);
                const pA = player && a.boss.player ? player : null;
                const pB = player && b.boss.player ? player : null;
                const sa = Gangs._strength(pA, a);
                const sb = Gangs._strength(pB, b);
                const lossA = Math.min(a.crew, Math.round(sb * _num(W.skirmishLoss, 0.12) * (0.5 + Utils.random())));
                const lossB = Math.min(b.crew, Math.round(sa * _num(W.skirmishLoss, 0.12) * (0.5 + Utils.random())));
                a.crew = Math.max(0, a.crew - Math.min(lossA, Math.max(0, a.crew - 1)));
                b.crew = Math.max(0, b.crew - Math.min(lossB, Math.max(0, b.crew - 1)));
                const [win, lose] = sa >= sb ? [a, b] : [b, a];
                const shift = Math.min(lose.turf, _num(W.turfShift, 0.08));
                lose.turf = _r2(lose.turf - shift);
                win.turf = _r2(win.turf + shift);
                const L = Gangs.c('lieutenants', {});
                for (const l of win.lieutenants) l.loyalty = _clamp(l.loyalty + _num(L.warWin, 2), 0, 100);
                for (const l of lose.lieutenants) l.loyalty = _clamp(l.loyalty + _num(L.warLoss, -4), 0, 100);
                st.watch.crackdown = _clamp(_num(st.watch.crackdown) + 6, 0, 100);
                const mine = m && (m.gangId === a.id || m.gangId === b.id);
                if (lose.crew <= _num(W.endCrew, 3)) {
                    const text = Gangs._endWar(world, tile, st, win, lose);
                    if (mine) Gangs._note(out, `${tile.settlement.name}: ${text}`, m.gangId === win.id ? 'success' : 'error');
                    if (mine && m.gangId === lose.id && player) {
                        delete player.underworld.gangs[_key(tile.q, tile.r)];
                    }
                } else if (mine) {
                    const us = m.gangId === a.id ? a : b;
                    Gangs._note(out, `The war in ${tile.settlement.name}: ${us === win ? 'your crew had the better of the week' : 'your crew took a beating this week'} (${us.crew} men left, ${Math.round(us.turf * 100)}% of the streets).`, us === win ? 'info' : 'warning');
                }
                // A beaten NPC gang sues for peace
                if (!lose.dissolved && !(lose.boss && lose.boss.player) && lose.crew < win.crew / 2 && Utils.random() < 0.3) {
                    const tribute = Math.floor(lose.purse * _num(W.tributeShare, 0.3));
                    lose.purse = _r2(lose.purse - tribute);
                    win.purse = _r2(win.purse + tribute);
                    Gangs._book(lose, 'out', 'tribute', tribute);
                    Gangs._book(win, 'in', 'tribute', tribute);
                    Gangs._peace(world, win, lose);
                    Gangs._log(st, world, `${lose.name} paid ${win.name} ${tribute}g for a truce.`);
                    if (mine) Gangs._note(out, `${lose.name} paid ${win.name} ${tribute}g for a truce in ${tile.settlement.name}.`, 'info');
                }
            }
        }
    },

    _betrayals(world, tile, st, g, player, m, out) {
        const L = Gangs.c('lieutenants', {});
        const s = tile.settlement;
        for (const lt of g.lieutenants.slice()) {
            if (lt.loyalty >= _num(L.betrayBelow, 30)) continue;
            const p = (_num(L.betrayBelow, 30) - lt.loyalty) / 100 * (0.5 + lt.ambition) * _num(L.betrayChance, 0.35) * 2;
            if (!(Utils.random() < p)) continue;
            const mine = !!(m && m.gangId === g.id && player);
            const bossIsPlayer = !!(g.boss && g.boss.player && mine);
            const roll = Utils.random();
            if (lt.ambition > 0.6 && roll < 0.5) {
                // A move on the boss
                const ours = bossIsPlayer
                    ? _num(player.skills && player.skills.combat, 1) * 2 + _num(player.skills && player.skills.leadership, 1) + g.lieutenants.filter(l => l !== lt && l.loyalty >= 50).length * 3
                    : _num(g.boss.might, 5) * 2;
                const theirs = lt.skill * 2 + lt.ambition * 6 + g.lieutenants.filter(l => l !== lt && l.loyalty < 40).length * 3;
                if (Utils.random() < theirs / (theirs + ours)) {
                    const old = g.boss.name;
                    g.lieutenants = g.lieutenants.filter(l => l !== lt);
                    g.boss = { name: lt.name, might: _clamp(lt.skill, 2, 9) };
                    Gangs._log(st, world, `${lt.name} overthrew ${old} and took ${g.name}.`);
                    if (bossIsPlayer) {
                        // You're out, and lucky to be alive
                        delete player.underworld.gangs[_key(tile.q, tile.r)];
                        g.banned = true;
                        player.health = Math.max(1, _num(player.health, 100) - 20);
                        Gangs._note(out, `${lt.name} turned ${g.name} against you in ${s.name}. You got out with your life, not your gang.`, 'error', 'Betrayed');
                    } else if (mine) {
                        Gangs._note(out, `${lt.name} took ${g.name} from ${old}.`, 'info');
                    }
                } else {
                    g.lieutenants = g.lieutenants.filter(l => l !== lt);
                    Gangs._log(st, world, `${lt.name} moved against the boss of ${g.name}, and failed.`);
                    if (bossIsPlayer) Gangs._note(out, `${lt.name} moved against you in ${s.name}, and is in the river for it.`, 'warning', 'Betrayal');
                }
            } else if (roll < 0.75) {
                // To the watch
                st.watch.crackdown = _clamp(_num(st.watch.crackdown) + 25, 0, 100);
                lt.loyalty = 40;
                if (mine) {
                    Underworld.addHeat(player, s.kingdom, bossIsPlayer ? 15 : 8, world);
                    Gangs._note(out, `Someone in ${g.name} has been talking to the watch in ${s.name}. The crackdown is on.`, 'warning', 'An informer');
                }
            } else {
                // Off with a share of the crew and coin
                const crew = Math.max(2, Math.floor(g.crew * 0.3));
                const coin = Math.floor(g.purse * 0.25);
                g.crew = Math.max(1, g.crew - crew);
                g.purse = _r2(g.purse - coin);
                g.lieutenants = g.lieutenants.filter(l => l !== lt);
                const split = Gangs._newGang(world, s, tile.q, tile.r, st, { boss: lt.name, crew, purse: 0, turf: Math.min(g.turf, 0.1), dens: 0, smuggling: false, lieutenants: 1, stash: false });
                split.purse = coin;
                Gangs._book(g, 'out', 'split', coin);
                Gangs._book(split, 'in', 'founding', coin);
                g.turf = _r2(Math.max(0, g.turf - split.turf));
                st.gangs.push(split);
                Gangs._declare(world, g, split);
                Gangs._log(st, world, `${lt.name} split from ${g.name} with ${crew} men: ${split.name}.`);
                if (mine) Gangs._note(out, `${lt.name} walked out of ${g.name} with ${crew} men and ${coin}g, and calls them ${split.name}. It's war.`, 'warning', 'A split');
            }
        }
        // A gang short of lieutenants raises one from the crew
        if (g.lieutenants.length < 1 && g.crew > 4) {
            g.lieutenants.push(Gangs._lieutenant(st, 55));
            g.crew--;
        }
    },

    // ──────────── THE CRIME LORD (advanced start) ────────────

    /**
     * The Crime Lord: boss of the biggest gang of a great city, taking over a
     * gang the world already has (its crew, purse and stash were the town's
     * own coin and goods). o: data/scenarios.json → origins.crime_lord.
     * → vars for the welcome, or null.
     */
    setupCrimeLord(player, world, o, towns, from) {
        const cands = towns.filter(t => t.s.type === 'city');
        const pool = cands.length ? cands : towns.filter(t => GANG_TYPES.includes(t.s.type));
        if (!pool.length) return null;
        const dist = t => (world.width ? Hex.wrappingDistance(t.q, t.r, from.q, from.r, world.width) : 0);
        const home = pool.slice().sort((a, b) => _num(b.s.population) - _num(a.s.population)).slice(0, 5).sort((a, b) => dist(a) - dist(b))[0];
        const tile = world.getTile(home.q, home.r);
        const st = Gangs.town(world, tile);
        if (!st) return null;
        // There is a rival: a town with one gang grows a second
        while (st.gangs.length < 2) st.gangs.push(Utils.withRng(_rng(world, `rival:${home.q},${home.r}`), () => Gangs._newGang(world, tile.settlement, home.q, home.r, st, {})));
        const g = st.gangs.slice().sort((a, b) => b.crew - a.crew)[0];
        const rival = st.gangs.filter(x => x !== g).sort((a, b) => b.crew - a.crew)[0];
        const oldBoss = g.boss.name;
        g.boss = { name: player.name || 'you', player: true, might: 5 };
        g.crew = Math.max(g.crew, Math.floor(_num(o.crew, 12)));
        g.turf = _num(o.turf, 0.6);
        g.dens = Math.max(g.dens, Math.floor(_num(o.dens, 1)));
        g.smuggling = true;
        // The hidden stash: what the old boss squirrelled away came out of the town's coffers and market
        const top = Math.max(0, _num(o.purse, 700) - g.purse);
        if (top > 0) {
            const got = Economy.drawTown(tile.settlement, top);
            g.purse = _r2(g.purse + got);
            Gangs._book(g, 'in', 'founding', got);
        }
        for (const [good, n] of Object.entries(_obj(o.stash) || {})) {
            const got = SettlementMarket.take(tile.settlement, good, n);
            if (got > 0) g.stash[good] = _r2(_num(g.stash[good]) + got);
        }
        while (g.lieutenants.length < 3) g.lieutenants.push(Utils.withRng(_rng(world, `lt:${g.id}:${g.lieutenants.length}`), () => Gangs._lieutenant(st)));
        // One of them has ideas of his own
        const schemer = g.lieutenants[g.lieutenants.length - 1];
        schemer.ambition = Math.max(schemer.ambition, 0.75);
        schemer.loyalty = Math.min(schemer.loyalty, 45);
        if (rival) {
            rival.crew = Math.max(rival.crew, Math.floor(_num(o.rivalCrew, 10)));
            rival.turf = Math.min(rival.turf, 0.35);
            if (o.rivalWar !== false) Gangs._declare(world, g, rival);
        }
        Gangs._normaliseTurf(st);
        // The captain is bought; the magistrate is not
        st.watch.captain.bribedBy = g.id;
        st.watch.magistrate.bribedBy = null;
        st.watch.crackdown = _num(o.crackdown, 35);
        // The underworld at large knows the name
        const uw = Gangs._pst(player);
        uw.guild.contactMet = true;
        uw.guild.member = true;
        uw.guild.joinedDay = _day(world);
        uw.guild.rank = Math.max(uw.guild.rank, Math.floor(_num(o.guildRank, 4)));
        uw.guild.standing = Math.max(uw.guild.standing, _num(o.standing, 200));
        uw.guild.exposed = true;
        uw.gangs[_key(home.q, home.r)] = { gangId: g.id, rank: Gangs.BOSS_RANK(), standing: _num(o.standing, 200), joinedDay: _day(world) };
        if (tile.settlement.kingdom != null) Underworld.addHeat(player, tile.settlement.kingdom, _num(o.heat, 30), world);
        uw.dirty = Math.min(_num(player.gold), _num(o.dirty, 0));
        Gangs._log(st, world, `${oldBoss} is dead; ${player.name || 'a new boss'} runs ${g.name}.`);
        return {
            tile, gang: g, rival, oldBoss,
            vars: {
                oldBoss, gang: g.name, town: tile.settlement.name, crew: g.crew, lieutenants: g.lieutenants.length,
                turf: Math.round(g.turf * 100), purse: Math.floor(g.purse), captain: st.watch.captain.name,
                magistrate: st.watch.magistrate.name, rival: rival ? rival.name : 'rival crews',
            },
        };
    },

    // ──────────── UI ────────────

    /** Everything the Gangs tab shows for the town on `tile`. */
    view(player, world, tile) {
        const st = Gangs.town(world, tile);
        if (!st) return null;
        const m = Gangs.membership(player, tile);
        const mine = m ? Gangs.gang(world, tile, m.gangId) : null;
        const gangs = st.gangs.filter(g => !g.dissolved).map(g => ({
            id: g.id, name: g.name, boss: g.boss.name, bossIsYou: !!g.boss.player, crew: g.crew,
            turf: g.turf, dens: g.dens, smuggling: g.smuggling, strength: Math.round(Gangs._strength(g.boss.player ? player : null, g)),
            atWarWithYou: !!(mine && Gangs.atWar(mine, g)), wars: Object.keys(g.wars || {}).length, banned: !!g.banned,
            ownsCaptain: st.watch.captain.bribedBy === g.id, ownsMagistrate: st.watch.magistrate.bribedBy === g.id,
            truceUntil: mine ? _num(mine.truces[g.id]) : 0,
            raids: _num(g.stats && g.stats.raids),
            purse: Math.floor(_num(g.purse)),
            books: Gangs.bookView(g),
        }));
        return {
            gangs, watch: st.watch, crackdown: Math.round(_num(st.watch.crackdown)), log: (st.log || []).slice(-6).reverse(),
            membership: m, gang: mine, rank: m ? Gangs.rankDef(m.rank) : null, next: m && m.rank < Gangs.BOSS_RANK() - 1 ? Gangs.rankDef(m.rank + 1) : null,
            boss: !!(mine && mine.boss.player), wages: mine ? Gangs.weeklyWages(mine) : 0, crewCap: Gangs.crewCap(tile.settlement),
            retainer: { captain: Gangs.retainer(world, tile, 'captain'), magistrate: Gangs.retainer(world, tile, 'magistrate') },
            dirty: Gangs.dirty(player), launder: Gangs.launderCapacity(player, world, tile),
            bossTowns: Gangs.bossTowns(player, world).map(b => b.town),
        };
    },
};
