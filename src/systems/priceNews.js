// ============================================
// PRICE NEWS — word of the markets travels at the pace of travellers
// ============================================
// The player's price book (systems/priceKnowledge.js) holds what they have
// seen or been told. This system is how distant prices reach anyone at all:
//
//   News of the markets   Once a week (scanEvery) every town's market is
//               looked over for notable moves in the staple goods: a dearth
//               (scarcity at or over dearAt: a famine, a road shut by war, a
//               lost caravan) or a glut (at or under glutAt). A notable move
//               becomes a piece of news that starts in that town and spreads
//               outward at news.hexesPerDay, as far as `reach` hexes, until it
//               is maxAgeDays old. A town "knows" a piece of news once the
//               travellers carrying it could have walked there (no per-town
//               state: it is worked out from the distance and the day).
//   Who acts on it        NPC merchants know only the news that has reached
//               their town. A merchant caravan leaving a town that has heard
//               a market is dear sets out on that road sooner (selectLinks
//               score) and carries a little of that good beyond the usual
//               lot (extraCargo; the destination pays for it on arrival, as
//               for any cargo). Glut news turns caravans away from a road.
//               News runs (runCandidates → MerchantCaravans._newsRuns): every
//               few days the freshest dear news sends a caravan from the town
//               within runRange that heard it and has the good most to spare,
//               not only along the usual trade links.
//               The player who hears first gets there first.
//   The player hears it   standing in a town that knows the news (word on
//               the road, source 'r', with a trust that may be wrong), or
//               orders it by post:
//                 - a price letter by courier: the request rides out with a
//                   courier house serving the town they stand in (or their
//                   own rider), a clerk in the far town writes the prices of
//                   the day it reaches him, and it rides back (source 'l');
//                 - a merchant's letter: the town's merchants copy the next
//                   letter from a trading partner within merchantRange; it
//                   is written today there and travels at a merchant's pace;
//                 - correspondents: a paid hand in a town who writes the
//                   prices every 7, 14 or 30 days to wherever the player is
//                   (source 'k'); unpaid twice running they stop writing.
//   False news           A rival merchant house or rival House with a grudge
//               can plant false talk ("grain is dear in X") in a town near
//               the player; it spreads like any news and is marked as word
//               on the road, from where it was heard. Acting on it costs the
//               player the trip. The player can plant false talk of their own
//               (a fee to the town's talkers) to lure the rival houses and
//               the caravans: a rival house that hears it loses on the trip
//               (lureDays later), the caravans carry goods where none are
//               wanted; but the player may be caught in the act or traced
//               later: heat with the underworld of the realm, a 'whisperer'
//               rumour (reputation), the rival houses' anger. Any claim is
//               put to the test by a visit, a factor or steward's report, a
//               letter or a correspondent: a lie found out is told to the
//               player, with who likely put it about.
//
// Coin: every fee lands in a purse. A courier's postage is the courier
// house's (Couriers.recordLetter); a clerk's fee is paid into the far town;
// your own rider, a merchant's letter and the talkers are paid into the town
// where you stand; a correspondent's wage into their town. A rival's plant
// is paid from its capital or purse into the town where it was planted.
// Amounts are whole cents (Utils.cents).
//
// State: world.priceNews (the news abroad: saved world-side) and
// player.priceLetters (letters on the road, correspondents, what the player
// heard and planted: saved player-side), systems/saveLoad.js. The daily tick
// draws from its own stream (world seed + day); the player's own actions draw
// from Utils.random. Coarse by design: the scan is weekly, the daily part
// reads a short list. Tuned in data/priceKnowledge.json → news.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Economy } from '../world/economy.js';
import { Ledger } from './ledger.js';
import { PriceKnowledge } from './priceKnowledge.js';
import { Couriers } from './couriers.js';
import { MerchantHouses } from './merchantHouses.js';
import { Underworld } from './underworld.js';
import { Gossip } from './gossip.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);
const _key = (q, r) => `${q},${r}`;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
    return (p && p.seed) || 0;
}

const SIZE = { village: 0, town: 0.1, city: 0.2, capital: 0.3 };

const DEFAULTS = {
    scanEvery: 7, dearAt: 1.7, glutAt: 0.65, dearEnds: 1.4, glutEnds: 0.8, perScan: 3, maxNews: 24, maxAgeDays: 45, actDays: 21,
    hexesPerDay: 2.5, reach: 18, plantReach: 12,
    goods: ['grain', 'flour', 'bread', 'fish', 'meat', 'beer', 'wine', 'salt', 'wood', 'iron', 'tools', 'wool', 'textiles', 'leather', 'horses'],
    caravans: { dearBoost: 0.8, glutDamp: 0.5, extraShare: 0.12, extraMax: 40, spareBelow: 1.35, runEvery: 2, runsPerDay: 1, runOverCap: 3, runsPerNews: 2, runGap: 6, runRange: 14, runMinDist: 3, runMinStock: 10, runShare: 0.25, runMax: 60, runSpread: 1.3 },
    letters: { maxInTransit: 4, clerkFee: 1.5, riderFee: 6, riderPerHex: 0.4, riderHexes: 4, riderReliability: 0.85, merchantFee: 3, merchantPerHex: 0.15, merchantHexesPerDay: 2, merchantRange: 16, merchantReliability: 0.92 },
    correspondents: { max: 4, wage: { village: 2, town: 3, city: 4, capital: 5 }, every: [7, 14, 30], quitUnpaid: 2, hexesPerDay: 3 },
    trust: { v: 100, f: 95, h: 95, l: 90, k: 90, c: 70, t: 40, r: 55, rumourJitter: 10, corroborate: 15, fadePerDay: 0.5, min: 5 },
    plant: { fee: { village: 8, town: 15, city: 25, capital: 40 }, dearMult: 1.8, glutMult: 0.55, caughtChance: 0.08, tracedChance: 0.25, tracedPerLured: 0.05, heat: 12, lureDays: 14, rivalLoss: 0.03, rivalLossMax: 600, rivalryOnTrace: 15, reputationOnTrace: 5, cooldownDays: 14, minDist: 3, maxDist: 20 },
    rivalPlants: { everyDays: 14, chance: 0.35, minRivalry: 30, minFeud: 30, fee: 20, dearMult: [1.6, 2.1], minDist: 4, maxDist: 14, maxActive: 1, nearTown: 6 },
    maxHeard: 40,
};

let _cfg = null;
let _cfgSrc = null;

export const PriceNews = {
    config() {
        const gd = DataLoader._gamedata;
        const d = (gd && gd.priceKnowledge && gd.priceKnowledge.news) || {};
        // (built once per data object: it is read many times a day, and a data reload swaps the object)
        if (_cfg && _cfgSrc === d) return _cfg;
        _cfgSrc = d;
        _cfg = PriceNews._buildConfig(d);
        return _cfg;
    },

    _buildConfig(d) {
        const out = { ...DEFAULTS, ...d };
        for (const k of ['caravans', 'letters', 'correspondents', 'trust', 'plant', 'rivalPlants']) out[k] = { ...DEFAULTS[k], ...(d[k] || {}) };
        out.correspondents.wage = { ...DEFAULTS.correspondents.wage, ...((d.correspondents && d.correspondents.wage) || {}) };
        out.plant.fee = { ...DEFAULTS.plant.fee, ...((d.plant && d.plant.fee) || {}) };
        return out;
    },

    // ── State ──────────────────────────────────────────────

    _blankWorld() {
        return { nextId: 1, lastScan: null, lastRivalPlant: null, news: [], stats: { found: 0, planted: 0, rivalPlanted: 0, acted: 0, runs: 0, lured: 0 } };
    },

    state(world) {
        if (!world) return PriceNews._blankWorld();
        let st = world.priceNews;
        if (!st || typeof st !== 'object' || Array.isArray(st)) st = world.priceNews = PriceNews._blankWorld();
        if (!Array.isArray(st.news)) st.news = [];
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        if (st.lastScan === undefined) st.lastScan = null;
        if (st.lastRivalPlant === undefined) st.lastRivalPlant = null;
        if (!st.stats || typeof st.stats !== 'object') st.stats = PriceNews._blankWorld().stats;
        return st;
    },

    serialize(world) {
        return world && world.priceNews ? JSON.parse(JSON.stringify(world.priceNews)) : null;
    },

    restore(saved, world) {
        if (!world) return;
        world.priceNews = saved && typeof saved === 'object' ? JSON.parse(JSON.stringify(saved)) : null;
        if (world.priceNews) PriceNews.state(world);
        PriceNews._viewCache = null;
    },

    _blankPlayer() {
        return { nextId: 1, letters: [], corr: [], heard: [], planted: [], lastPlant: null, stats: { letters: 0, lost: 0, heard: 0, liesFound: 0, planted: 0, traced: 0 } };
    },

    /** The player's post of prices (created on first use; older saves backfill). */
    playerState(player) {
        if (!player) return PriceNews._blankPlayer();
        let st = player.priceLetters;
        if (!st || typeof st !== 'object' || Array.isArray(st)) st = player.priceLetters = PriceNews._blankPlayer();
        for (const k of ['letters', 'corr', 'heard', 'planted']) if (!Array.isArray(st[k])) st[k] = [];
        if (!Number.isFinite(st.nextId)) st.nextId = 1;
        if (st.lastPlant === undefined) st.lastPlant = null;
        if (!st.stats || typeof st.stats !== 'object') st.stats = PriceNews._blankPlayer().stats;
        return st;
    },

    serializePlayer(player) {
        return player && player.priceLetters ? JSON.parse(JSON.stringify(player.priceLetters)) : null;
    },

    loadPlayer(player) {
        if (player && player.priceLetters) PriceNews.playerState(player);
    },

    // ── Where news has reached ─────────────────────────────

    _dist(world, a, b) {
        const W = world && world.width;
        return W ? Hex.wrappingDistance(a.q, a.r, b.q, b.r, W) : Hex.distance(a.q, a.r, b.q, b.r);
    },

    /** The day a piece of news reaches (q, r), or Infinity beyond its reach. */
    arrives(world, n, q, r) {
        if (!n) return Infinity;
        if (n.oq === q && n.or === r) return n.d;
        const d = PriceNews._dist(world, { q: n.oq, r: n.or }, { q, r });
        if (d > _num(n.reach, PriceNews.config().reach)) return Infinity;
        return n.d + Math.ceil(d / Math.max(0.1, PriceNews.config().hexesPerDay));
    },

    /** Has a piece of news reached (q, r) by `day`? */
    knownAt(world, n, q, r, day = _day(world)) {
        return day >= PriceNews.arrives(world, n, q, r);
    },

    /** The news abroad that has reached (q, r) by `day`. */
    newsAt(world, q, r, day = _day(world)) {
        const st = world && world.priceNews;
        if (!st || !Array.isArray(st.news)) return [];
        return st.news.filter(n => PriceNews.knownAt(world, n, q, r, day));
    },

    // ── The weekly look over the markets ───────────────────

    _goods() {
        const C = PriceNews.config();
        const gd = DataLoader._gamedata;
        const G = (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
        return (C.goods || []).filter(id => SettlementMarket.tracks(id) && G[String(id).toUpperCase()]);
    },

    _base(id) {
        const gd = DataLoader._gamedata;
        const G = (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
        const g = G[String(id).toUpperCase()];
        return (g && g.basePrice) || 0;
    },

    _live(world, q, r) {
        const t = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        return t && t.settlement ? { tile: t, s: t.settlement } : null;
    },

    _towns(world) {
        if (!world) return [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() || [] : [];
        return views.filter(v => v && Number.isFinite(v.q));
    },

    /** Look over every market for notable moves; mark true news whose cause has passed. → news found */
    scan(world) {
        const C = PriceNews.config();
        const st = PriceNews.state(world);
        const day = _day(world);
        const goods = PriceNews._goods();
        const open = new Map();
        for (const n of st.news) if (!n.f && n.ended == null) open.set(`${n.q},${n.r}:${n.g}`, n);
        const cands = [];
        for (const v of PriceNews._towns(world)) {
            const L = PriceNews._live(world, v.q, v.r);
            if (!L || !L.s.market || !L.s.market.stock) continue;
            for (const id of goods) {
                const sc = SettlementMarket.scarcity(L.s, id);
                const was = open.get(`${v.q},${v.r}:${id}`);
                if (was) {
                    // (the dearth or the glut is over: the news still travels, now out of date)
                    if ((was.k === 'dear' && sc < C.dearEnds) || (was.k === 'glut' && sc > C.glutEnds)) was.ended = day;
                    continue;
                }
                if (!SettlementMarket.stock(L.s, id) && sc < C.dearAt) continue;
                const kind = sc >= C.dearAt ? 'dear' : sc <= C.glutAt ? 'glut' : null;
                if (!kind) continue;
                // Newsworthy: how far from normal, how sudden (against the stock's moving
                // average: a fresh dearth is news, a chronic one less so), how great the town
                const avg = SettlementMarket.curve(_num(L.s.market.trend && L.s.market.trend[id], 1), SettlementMarket.uses(L.s, id));
                const score = Math.abs(Math.log(Math.max(0.01, sc))) + 2 * Math.abs(Math.log(Math.max(0.01, sc) / Math.max(0.01, avg))) + _num(SIZE[L.s.type]);
                cands.push({ L, v, id, kind, sc, score });
            }
        }
        cands.sort((a, b) => b.score - a.score || (_key(a.v.q, a.v.r) + a.id < _key(b.v.q, b.v.r) + b.id ? -1 : 1));
        let found = 0;
        for (const c of cands.slice(0, Math.max(0, C.perScan))) {
            const worth = SettlementMarket.value(world, c.L.s, c.L.tile, c.id, PriceNews._base(c.id));
            if (!(worth > 0)) continue;
            PriceNews._add(world, {
                q: c.v.q, r: c.v.r, n: c.L.s.name || 'a town', t: c.L.s.type || null, g: c.id, k: c.kind,
                w: Math.round(worth * 100) / 100, sc: Math.round(c.sc * 100) / 100, d: day,
                oq: c.v.q, or: c.v.r, on: c.L.s.name || 'a town', reach: C.reach, f: 0, by: null,
            });
            found++;
        }
        st.stats.found += found;
        PriceNews._prune(world);
        return found;
    },

    _add(world, n) {
        const st = PriceNews.state(world);
        const item = { id: st.nextId++, ended: null, ...n };
        st.news.push(item);
        PriceNews._viewCache = null;
        return item;
    },

    _prune(world) {
        const C = PriceNews.config();
        const st = PriceNews.state(world);
        const day = _day(world);
        st.news = st.news.filter(n => day - _num(n.d) <= C.maxAgeDays);
        if (st.news.length > C.maxNews) {
            // (the oldest true news is forgotten first; planted talk runs its course)
            const drop = st.news.filter(n => !n.f).sort((a, b) => a.d - b.d || a.id - b.id).slice(0, st.news.length - C.maxNews).map(n => n.id);
            const set = new Set(drop);
            st.news = st.news.filter(n => !set.has(n.id));
        }
        PriceNews._viewCache = null;
    },

    // ── NPC merchants act on what they know ────────────────

    _viewCache: null,

    /** News fresh enough to act on, by the town it is about: Map 'q,r' → [news]. Cached per day. */
    _view(world, day) {
        const st = world && world.priceNews;
        if (!st || !Array.isArray(st.news) || !st.news.length) return null;
        const c = PriceNews._viewCache;
        if (c && c.world === world && c.day === day && c.n === st.news.length && c.last === st.nextId) return c.map;
        const C = PriceNews.config();
        const map = new Map();
        for (const n of st.news) {
            if (day - _num(n.d) > C.actDays) continue;
            const k = _key(n.q, n.r);
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(n);
        }
        PriceNews._viewCache = { world, day, n: st.news.length, last: st.nextId, map };
        return map;
    },

    /** The news about `to` that merchants in `from` have heard (fresh enough to act on). */
    heardOf(world, from, to, day = _day(world)) {
        const map = PriceNews._view(world, day);
        if (!map || !from || !to) return [];
        const list = map.get(_key(to.q, to.r));
        if (!list) return [];
        return list.filter(n => PriceNews.knownAt(world, n, from.q, from.r, day));
    },

    /**
     * How much likelier merchants are to send a caravan along the link a–b:
     * dear news of either end heard at the other draws them; glut news of
     * either end turns them away. 1 without news.
     */
    linkFactor(world, a, b, day = _day(world)) {
        if (!PriceNews._view(world, day)) return 1;
        const C = PriceNews.config().caravans;
        const heard = [...PriceNews.heardOf(world, a, b, day), ...PriceNews.heardOf(world, b, a, day)];
        if (!heard.length) return 1;
        if (heard.some(n => n.k === 'dear')) return 1 + _num(C.dearBoost);
        return Math.max(0.1, 1 - _num(C.glutDamp));
    },

    /**
     * A caravan setting out from `from` to `to`: the goods its merchants
     * heard are dear at `to`, taken from `from`'s stalls where it has them
     * to spare. → [{ good, qty, cost }] (the stock is already taken out;
     * cost is what the lot is worth at `from`, owed on arrival).
     */
    extraCargo(world, from, to, day = _day(world)) {
        const heard = PriceNews.heardOf(world, from, to, day).filter(n => n.k === 'dear');
        if (!heard.length || !from || !from.market) return [];
        const C = PriceNews.config().caravans;
        const st = PriceNews.state(world);
        const out = [];
        const seen = new Set();
        const tile = typeof world.getTile === 'function' ? world.getTile(from.q, from.r) : null;
        for (const n of heard) {
            if (seen.has(n.g)) continue;
            seen.add(n.g);
            if (SettlementMarket.scarcity(from, n.g) >= C.spareBelow) continue;
            const want = Math.floor(Math.min(SettlementMarket.stock(from, n.g) * C.extraShare, C.extraMax));
            if (!(want >= 1)) continue;
            const got = SettlementMarket.take(from, n.g, want);
            if (!(got > 0)) continue;
            const unit = SettlementMarket.value(world, from, tile, n.g, PriceNews._base(n.g));
            out.push({ good: n.g, qty: got, cost: Utils.cents(got * unit), news: n.id });
            st.stats.acted++;
            if (n.f) n.lured = _num(n.lured) + 1;
        }
        return out;
    },

    /**
     * News runs: for the freshest dear news (true or planted), the town within
     * caravans.runRange of it that has heard the news and has the good most to
     * spare (scarcity under spareBelow, at least runMinStock in its stalls, and
     * the price the news names at least runSpread times its own). Nothing is
     * taken here: MerchantCaravans._newsRuns finds the road and loads the lot.
     * → [{ n, from: settlement, to: settlement, good, qty, unitFrom, unitTo }]
     * (at most `limit`; each piece of news runs at most runsPerNews caravans,
     * runGap days apart).
     */
    runCandidates(world, day = _day(world), limit = 1) {
        const st = world && world.priceNews;
        if (!st || !Array.isArray(st.news) || !st.news.length || !(limit > 0)) return [];
        const C = PriceNews.config();
        const K = C.caravans;
        const maxRuns = _num(K.runsPerNews, 3);
        const gap = _num(K.runGap, 6);
        const news = st.news
            .filter(n => n.k === 'dear' && day - _num(n.d) <= C.actDays && _num(n.runs) < maxRuns && !(day - _num(n.lastRun, -1e9) < gap))
            .sort((a, b) => _num(a.runs) - _num(b.runs) || b.d - a.d || a.id - b.id);
        if (!news.length) return [];
        const towns = PriceNews._towns(world);
        const out = [];
        const used = new Set();
        for (const n of news) {
            if (out.length >= limit) break;
            const L = PriceNews._live(world, n.q, n.r);
            if (!L || !L.s.market) continue;
            let best = null, bestV = 0;
            for (const v of towns) {
                if (v.q === n.q && v.r === n.r) continue;
                const d = PriceNews._dist(world, v, n);
                if (d < _num(K.runMinDist, 3) || d > _num(K.runRange, 14)) continue;
                if (!PriceNews.knownAt(world, n, v.q, v.r, day)) continue;
                const F = PriceNews._live(world, v.q, v.r);
                if (!F || !F.s.market || used.has(_key(v.q, v.r))) continue;
                const sc = SettlementMarket.scarcity(F.s, n.g);
                if (sc >= K.spareBelow) continue;
                const stock = SettlementMarket.stock(F.s, n.g);
                if (!(stock >= _num(K.runMinStock, 10))) continue;
                const val = stock / Math.max(0.2, sc) / (1 + d / 6);
                if (val > bestV) { bestV = val; best = { F, d, stock, q: v.q, r: v.r }; }
            }
            if (!best) continue;
            const unitFrom = SettlementMarket.value(world, best.F.s, best.F.tile, n.g, PriceNews._base(n.g));
            // (they act on the price the news names: a lie lures them as well as the truth)
            if (!(unitFrom > 0) || !(_num(n.w) >= unitFrom * _num(K.runSpread, 1.3))) continue;
            const qty = Math.floor(Math.min(best.stock * _num(K.runShare, 0.25), _num(K.runMax, 60)));
            if (!(qty >= 1)) continue;
            const unitTo = SettlementMarket.value(world, L.s, L.tile, n.g, PriceNews._base(n.g));
            used.add(_key(best.q, best.r));
            out.push({ n, from: best.F.s, to: L.s, good: n.g, qty, unitFrom, unitTo: unitTo > 0 ? unitTo : unitFrom });
        }
        return out;
    },

    /** A news run set out: counted on the news (and a lie's lure). */
    noteRun(world, n, day = _day(world)) {
        const st = PriceNews.state(world);
        n.runs = _num(n.runs) + 1;
        n.lastRun = day;
        st.stats.runs = _num(st.stats.runs) + 1;
        st.stats.acted++;
        if (n.f) n.lured = _num(n.lured) + 1;
    },

    // ── Trust ──────────────────────────────────────────────

    /** 0..100: how far to trust a quote, by its source and age (a rumour keeps its own). */
    trust(src, age, stored = null) {
        return PriceKnowledge.trust(src, age, stored);
    },

    agoText(days) {
        const d = Math.max(0, Math.round(_num(days)));
        return d === 0 ? 'today' : d === 1 ? 'a day ago' : `${d} days ago`;
    },

    trustWord(t) {
        return t >= 85 ? 'sure' : t >= 65 ? 'likely' : t >= 45 ? 'doubtful' : 'idle talk';
    },

    // ── The player hears ───────────────────────────────────

    _hear(world, player, n, out) {
        const P = PriceNews.playerState(player);
        const C = PriceNews.config();
        const T = C.trust;
        const day = _day(world);
        // A rumour's trust: what it is, a little luck in the telling, more when it agrees with what you knew
        let trust = _num(T.r) + ((_hash(`${_seed(world)}:pnTrust:${n.id}`) % (2 * T.rumourJitter + 1)) - T.rumourJitter);
        const had = PriceKnowledge.quote(player, world, n.q, n.r, n.g);
        if (had && ((n.k === 'dear' && had.scarcity >= 1.3) || (n.k === 'glut' && had.scarcity <= 0.8))) trust += T.corroborate;
        trust = Math.round(_clamp(trust, T.min, 95));
        const via = n.oq === n.q && n.or === n.r ? `talk out of ${n.n}` : `talk heard in ${n.on}`;
        const ok = PriceKnowledge.learn(player, world, { q: n.q, r: n.r, name: n.n, type: n.t || null }, n.g, n.w, n.d, 'r', null, { trust, via, news: n.id });
        P.heard.push({ id: n.id, q: n.q, r: n.r, n: n.n, g: n.g, k: n.k, d: n.d, hd: day, f: n.f ? 1 : 0, by: n.by || null, on: n.on, open: n.by === 'player' ? 0 : 1 });
        if (P.heard.length > C.maxHeard) P.heard.splice(0, P.heard.length - C.maxHeard);
        P.stats.heard++;
        if (ok && n.by !== 'player') out.heard.push(n);
        return ok;
    },

    /** A claim put to the test: a reliable quote of that town and good, as fresh as the hearing. */
    _checkHeard(world, player, out) {
        const P = PriceNews.playerState(player);
        for (const h of P.heard) {
            if (!h.open) continue;
            const qt = PriceKnowledge.quote(player, world, h.q, h.r, h.g);
            if (!qt || !['v', 'f', 'h', 'l', 'k'].includes(qt.src) || qt.day < h.hd) continue;
            h.open = 0;
            if (!h.f) continue;
            P.stats.liesFound++;
            const what = `${PriceNews._goodName(h.g)} ${h.k === 'dear' ? 'dear' : 'cheap'} in ${h.n}`;
            out.notices.push({
                icon: '🗣️', title: 'False Price Talk',
                text: `The talk of ${what} was a lie: the market says otherwise. It was put about in ${h.on}${h.by ? `, by all signs by men of ${h.by}` : ''}.`,
                type: 'warning',
            });
        }
    },

    _goodName(id) {
        const gd = DataLoader._gamedata;
        const G = (gd && gd.playerEconomy && gd.playerEconomy.GOODS) || {};
        const g = G[String(id).toUpperCase()];
        return g ? String(g.name).toLowerCase() : String(id);
    },

    // ── The day ────────────────────────────────────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:priceNews:${_day(world)}`) % 233279) + 1);
    },

    /**
     * The day's news: the weekly look over the markets, rival plants, the
     * player's letters and correspondents, what they hear where they stand,
     * claims put to the test, planted talk run its course. With no player
     * (the world turning on its own) only the world's half runs.
     * → { notices, heard: [news], letters: [letters arrived] }
     */
    processDay(world, player = null) {
        const out = { notices: [], heard: [], letters: [] };
        if (!world || typeof world.getTile !== 'function') return out;
        const C = PriceNews.config();
        const st = PriceNews.state(world);
        const day = _day(world);
        Utils.withRng(PriceNews._dayRng(world), () => {
            if (st.lastScan === null || day - st.lastScan >= C.scanEvery) {
                st.lastScan = day;
                PriceNews.scan(world);
                if (player) PriceNews._rivalPlant(world, player, out);
                if (player) PriceNews._resolvePlanted(world, player, out);
            }
            if (!player) return;
            PriceNews._correspondents(world, player, out);
            PriceNews._letters(world, player, out);
        });
        if (!player) return out;
        // What the town the player stands in has heard
        const here = Number.isFinite(player.q) ? world.getTile(player.q, player.r) : null;
        if (here && here.settlement && !player.boardedShip && st.news.length) {
            const P = PriceNews.playerState(player);
            const had = new Set(P.heard.map(h => h.id));
            for (const n of st.news) {
                // (the player's own lies are not news to them)
                if (n.by === 'player' || had.has(n.id) || !PriceNews.knownAt(world, n, player.q, player.r, day)) continue;
                PriceNews._hear(world, player, n, out);
            }
        }
        if (player.priceLetters) PriceNews._checkHeard(world, player, out);
        if (out.heard.length) {
            const top = out.heard.slice(0, 2).map(n => `${PriceNews._goodName(n.g)} is ${n.k === 'dear' ? 'dear' : 'cheap'} in ${n.n} (${PriceNews.agoText(day - n.d)})`);
            out.notices.push({ icon: '🗣️', title: 'Word on the Road', text: `They say ${top.join('; ')}${out.heard.length > 2 ? `, and ${out.heard.length - 2} more` : ''}. Talk may be wrong.`, type: 'default' });
        }
        return out;
    },

    // ── Letters ────────────────────────────────────────────

    _payPlayer(player, amount, cat) {
        const a = Utils.cents(amount);
        if (!(a > 0)) return 0;
        player.gold = Utils.cents(_num(player.gold) - a);
        if (cat) Ledger.record(player, cat, -a);
        return a;
    },

    /** The town the player stands in: { q, r, key, s, name, type, kingdomId } or null. */
    _here(world, player) {
        if (!world || !player || !Number.isFinite(player.q) || typeof world.getTile !== 'function') return null;
        const t = world.getTile(player.q, player.r);
        if (!t || !t.settlement) return null;
        const s = t.settlement;
        return { q: player.q, r: player.r, key: _key(player.q, player.r), s, name: s.name || 'a town', type: s.type || 'village', kingdomId: s.kingdom || null };
    },

    /**
     * Ways to get a town's prices by post from where the player stands:
     * [{ id, kind, name, icon, price, days, reliability, ok, why }].
     */
    letterOptions(player, world, q, r) {
        const C = PriceNews.config().letters;
        const here = PriceNews._here(world, player);
        if (!here) return [];
        const L = PriceNews._live(world, q, r);
        if (!L || (q === here.q && r === here.r)) return [];
        const to = { q, r };
        const dist = PriceNews._dist(world, here, to);
        const out = [];
        const clerk = Utils.cents(C.clerkFee);
        for (const c of Couriers.servingAt(world, here.key, here.kingdomId)) {
            const qt = Couriers.quote(world, c, here, to, _key(q, r));
            out.push({
                id: c.id, kind: 'courier', name: qt.name, icon: qt.icon, out: qt.days, back: qt.days, days: qt.days * 2,
                postage: Utils.cents(qt.price * 2), price: Utils.cents(qt.price * 2 + clerk), reliability: Math.round(qt.reliability * qt.reliability * 1000) / 1000, ok: true,
            });
        }
        const rd = Couriers.travelDays(world, here, to, C.riderHexes);
        const fee = Utils.cents(C.riderFee + dist * C.riderPerHex);
        out.push({ id: 'own', kind: 'courier', name: 'Your own rider', icon: '🐴', out: rd, back: rd, days: rd * 2, postage: fee, price: Utils.cents(fee + clerk), reliability: C.riderReliability, ok: true });
        const md = Couriers.travelDays(world, to, here, C.merchantHexesPerDay);
        const mOk = !!here.s.market && dist <= C.merchantRange;
        out.push({
            id: 'merchant', kind: 'merchant', name: "A merchant's letter", icon: '📜', out: 0, back: md, days: md,
            postage: 0, price: Utils.cents(C.merchantFee + dist * C.merchantPerHex), reliability: C.merchantReliability,
            ok: mOk, why: mOk ? null : (here.s.market ? `${L.s.name || 'That town'} is too far for the merchants here to deal with (${C.merchantRange} hexes at most).` : 'No merchants here keep letters.'),
        });
        return out;
    },

    /** Order a price letter from (q, r) by option `optId`. → { success, letter, text } | { success: false, reason } */
    orderLetter(player, world, q, r, optId) {
        const C = PriceNews.config().letters;
        const P = PriceNews.playerState(player);
        const here = PriceNews._here(world, player);
        if (!here) return { success: false, reason: 'You must be in a town to send for prices.' };
        const L = PriceNews._live(world, q, r);
        if (!L) return { success: false, reason: 'There is no market there.' };
        if (P.letters.filter(x => x.kind !== 'corr').length >= C.maxInTransit) return { success: false, reason: `${C.maxInTransit} price letters are already on the road.` };
        const opt = PriceNews.letterOptions(player, world, q, r).find(o => String(o.id) === String(optId));
        if (!opt) return { success: false, reason: 'Choose how to send for it.' };
        if (!opt.ok) return { success: false, reason: opt.why || 'Not possible from here.' };
        if (_num(player.gold) < opt.price) return { success: false, reason: `You need ${Utils.formatGold(opt.price)} gold.` };
        const day = _day(world);
        PriceNews._payPlayer(player, opt.price, 'postage');
        if (opt.kind === 'merchant') Economy.payTown(here.s, opt.price);
        else {
            // (the clerk who writes the prices is paid in his own town; the postage is the courier's)
            Economy.payTown(L.s, Utils.cents(opt.price - opt.postage));
            if (opt.id === 'own') Economy.payTown(here.s, opt.postage);
            else Couriers.recordLetter(world, opt.id, opt.postage);
        }
        const letter = {
            id: P.nextId++, kind: opt.kind, via: opt.name, courierId: opt.id, q, r, n: L.s.name || 'a town',
            fq: here.q, fr: here.r, fn: here.name, orderDay: day, writeDay: day + opt.out, arriveDay: day + opt.out + opt.back,
            rel: opt.reliability, snap: null, price: opt.price,
        };
        P.letters.push(letter);
        if (opt.out === 0) PriceNews._write(world, letter);
        return {
            success: true, letter,
            text: opt.kind === 'merchant'
                ? `📜 The merchants of ${here.name} will copy you their next letter from ${letter.n}: the prices of today there, due in about ${opt.back} day${opt.back === 1 ? '' : 's'}.`
                : `✉️ Your request rides to ${letter.n} with ${opt.name}. A clerk will write the prices of the day it arrives; the letter is due back in about ${opt.days} days.`,
        };
    },

    /** The prices of a letter's town on the day it is written (as a visit would see them). */
    _write(world, letter) {
        const L = PriceNews._live(world, letter.q, letter.r);
        if (!L) { letter.snap = { g: {} }; return; }
        const tmp = {};
        PriceKnowledge.observe(tmp, world, L.s, letter.kind === 'corr' ? 'k' : 'l');
        const t = tmp.priceBook && tmp.priceBook.towns[_key(letter.q, letter.r)];
        letter.snap = { g: (t && t.g) || {}, t: L.s.type || null };
        letter.writeDay = _day(world);
    },

    _letters(world, player, out) {
        const P = PriceNews.playerState(player);
        if (!P.letters.length) return;
        const day = _day(world);
        for (const L of P.letters.slice()) {
            if (!L.snap && day >= L.writeDay) PriceNews._write(world, L);
            if (day < L.arriveDay || !L.snap) continue;
            P.letters.splice(P.letters.indexOf(L), 1);
            const lost = Utils.random() >= _num(L.rel, 1);
            if (lost) {
                P.stats.lost++;
                out.notices.push({ icon: '✉️', title: 'A Letter Lost', text: `Your price letter from ${L.n} (${L.via}) never came.`, type: 'warning' });
                continue;
            }
            const n = PriceKnowledge.putQuotes(player, world, { q: L.q, r: L.r, name: L.n, type: L.snap.t }, L.snap.g);
            P.stats.letters++;
            out.letters.push(L);
            out.notices.push({ icon: L.kind === 'corr' ? '🖋️' : '✉️', title: L.kind === 'corr' ? 'Your Correspondent Writes' : 'Price Letter', text: `Prices from ${L.n}, as they stood ${PriceNews.agoText(day - L.writeDay)} (${n} goods). See the Merchant's Ledger.`, type: 'default' });
        }
    },

    // ── Correspondents ─────────────────────────────────────

    correspondents(player) {
        return player && player.priceLetters ? PriceNews.playerState(player).corr : [];
    },

    wage(type) {
        const C = PriceNews.config().correspondents;
        return Utils.cents(_num(C.wage[type], C.wage.town));
    },

    /** Take on a correspondent in the town the player stands in (or change how often they write). */
    hireCorrespondent(player, world, every = 14) {
        const C = PriceNews.config().correspondents;
        const P = PriceNews.playerState(player);
        const here = PriceNews._here(world, player);
        if (!here) return { success: false, reason: 'You must be in a town to take on a correspondent.' };
        if (!here.s.market) return { success: false, reason: 'There is no market here to write about.' };
        const ev = (C.every || []).includes(Number(every)) ? Number(every) : C.every[1] || 14;
        const old = P.corr.find(c => c.q === here.q && c.r === here.r);
        if (old) { old.every = ev; return { success: true, text: `🖋️ Your correspondent in ${here.name} will now write every ${ev} days.` }; }
        if (P.corr.length >= C.max) return { success: false, reason: `You keep ${C.max} correspondents already.` };
        const day = _day(world);
        P.corr.push({ id: P.nextId++, q: here.q, r: here.r, n: here.name, t: here.type, every: ev, nextDay: day + ev, unpaid: 0, since: day, letters: 0 });
        return { success: true, text: `🖋️ A clerk in ${here.name} will write you its prices every ${ev} days, for ${Utils.formatGold(PriceNews.wage(here.type))}g a letter.` };
    },

    dismissCorrespondent(player, id) {
        const P = PriceNews.playerState(player);
        const i = P.corr.findIndex(c => String(c.id) === String(id));
        if (i < 0) return { success: false, reason: 'No such correspondent.' };
        const [c] = P.corr.splice(i, 1);
        return { success: true, text: `Your correspondent in ${c.n} writes no more.` };
    },

    _correspondents(world, player, out) {
        const P = player.priceLetters ? PriceNews.playerState(player) : null;
        if (!P || !P.corr.length) return;
        const C = PriceNews.config().correspondents;
        const day = _day(world);
        for (const c of P.corr.slice()) {
            if (day < c.nextDay) continue;
            c.nextDay = day + c.every;
            const L = PriceNews._live(world, c.q, c.r);
            if (!L) { P.corr.splice(P.corr.indexOf(c), 1); continue; }
            const wage = PriceNews.wage(L.s.type || c.t);
            if (_num(player.gold) < wage) {
                c.unpaid++;
                if (c.unpaid >= C.quitUnpaid) {
                    P.corr.splice(P.corr.indexOf(c), 1);
                    out.notices.push({ icon: '🖋️', title: 'A Correspondent Quits', text: `Unpaid, your correspondent in ${c.n} writes no more.`, type: 'warning' });
                }
                continue;
            }
            c.unpaid = 0;
            PriceNews._payPlayer(player, wage, 'postage');
            Economy.payTown(L.s, wage);
            c.letters++;
            const to = Number.isFinite(player.q) ? { q: player.q, r: player.r } : { q: c.q, r: c.r };
            const days = Couriers.travelDays(world, { q: c.q, r: c.r }, to, C.hexesPerDay);
            const letter = { id: P.nextId++, kind: 'corr', via: `your correspondent in ${c.n}`, courierId: null, q: c.q, r: c.r, n: c.n, orderDay: day, writeDay: day, arriveDay: day + days, rel: 0.97, snap: null, price: wage };
            PriceNews._write(world, letter);
            P.letters.push(letter);
        }
    },

    // ── False news ─────────────────────────────────────────

    /** What it costs to put false talk about in the town the player stands in. */
    plantFee(world, player) {
        const here = PriceNews._here(world, player);
        if (!here) return null;
        const F = PriceNews.config().plant.fee;
        return Utils.cents(_num(F[here.type], F.town));
    },

    /** Can the player plant false talk of (q, r)'s `good` here? → { ok, why, fee } */
    canPlant(player, world, q, r, good, kind = 'dear') {
        const C = PriceNews.config().plant;
        const here = PriceNews._here(world, player);
        if (!here) return { ok: false, why: 'Only in a town, where the talkers are.' };
        const fee = PriceNews.plantFee(world, player);
        const P = PriceNews.playerState(player);
        if (P.lastPlant != null && _day(world) - P.lastPlant < C.cooldownDays) return { ok: false, why: `The talkers here would smell it; wait ${C.cooldownDays - (_day(world) - P.lastPlant)} more days.`, fee };
        if (!['dear', 'glut'].includes(kind)) return { ok: false, why: 'Dear or cheap?', fee };
        if (!PriceNews._goods().includes(good)) return { ok: false, why: 'Nobody would believe talk of that good.', fee };
        const L = PriceNews._live(world, q, r);
        if (!L || !L.s.market) return { ok: false, why: 'No market there.', fee };
        const d = PriceNews._dist(world, here, { q, r });
        if (d < C.minDist) return { ok: false, why: 'Too near: anyone could walk over and see.', fee };
        if (d > C.maxDist) return { ok: false, why: 'Too far for anyone here to care.', fee };
        if (_num(player.gold) < fee) return { ok: false, why: `You need ${Utils.formatGold(fee)} gold.`, fee };
        return { ok: true, fee };
    },

    /**
     * Put false talk about: "good is dear (or cheap) in the town at (q, r)".
     * It spreads from here like any news; rival houses that hear it lose on
     * the trip, caravans that hear it carry goods where none are wanted.
     * → { success, text, caught } | { success: false, reason }
     */
    plant(player, world, q, r, good, kind = 'dear') {
        const can = PriceNews.canPlant(player, world, q, r, good, kind);
        if (!can.ok) return { success: false, reason: can.why };
        const C = PriceNews.config().plant;
        const P = PriceNews.playerState(player);
        const here = PriceNews._here(world, player);
        const L = PriceNews._live(world, q, r);
        const day = _day(world);
        PriceNews._payPlayer(player, can.fee, 'informants');
        Economy.payTown(here.s, can.fee);
        const real = SettlementMarket.value(world, L.s, L.tile, good, PriceNews._base(good)) || PriceNews._base(good);
        const w = Math.round(real * (kind === 'dear' ? C.dearMult : C.glutMult) * 100) / 100;
        const n = PriceNews._add(world, {
            q, r, n: L.s.name || 'a town', t: L.s.type || null, g: good, k: kind, w, sc: kind === 'dear' ? 2 : 0.5, d: day,
            oq: here.q, or: here.r, on: here.name, reach: PriceNews.config().plantReach, f: 1, by: 'player', lured: 0,
        });
        PriceNews.state(world).stats.planted++;
        const rec = { newsId: n.id, day, q, r, n: n.n, g: good, k: kind, oq: here.q, or: here.r, on: here.name, kid: here.kingdomId, traced: 0, resolved: 0 };
        P.planted.push(rec);
        if (P.planted.length > 12) P.planted.splice(0, P.planted.length - 12);
        P.lastPlant = day;
        P.stats.planted++;
        // (the player's own act draws from the main stream)
        const caught = Utils.random() < C.caughtChance;
        let text = `🗣️ For ${Utils.formatGold(can.fee)}g the talkers of ${here.name} will say ${PriceNews._goodName(good)} is ${kind === 'dear' ? 'dear' : 'going cheap'} in ${n.n}.`;
        if (caught) text += ' ' + PriceNews._traced(world, player, rec);
        return { success: true, text, caught, news: n };
    },

    /** The player's false talk traced back to them. → a line of text */
    _traced(world, player, rec) {
        const C = PriceNews.config().plant;
        const P = PriceNews.playerState(player);
        if (rec.traced) return '';
        rec.traced = 1;
        P.stats.traced++;
        if (rec.kid) Underworld.addHeat(player, rec.kid, C.heat, world);
        Gossip.accuse(player, world, 'whisperer', { q: rec.oq, r: rec.or, victim: `the merchants of ${rec.n}`, credibility: 0.7 });
        const company = MerchantHouses.company(player);
        if (company) company.reputation = _clamp(_num(company.reputation) - C.reputationOnTrace, 0, 100);
        for (const r of MerchantHouses.activeRivals(player)) r.rivalry = _clamp(_num(r.rivalry) + C.rivalryOnTrace, 0, 100);
        return `Word gets out that you paid for the lie about ${rec.n}: the watch, the merchants and the rival houses know your name for it.`;
    },

    /** Planted talk that has run lureDays: rival houses that heard it lose on the trip; it may be traced. */
    _resolvePlanted(world, player, out) {
        const P = player.priceLetters ? PriceNews.playerState(player) : null;
        if (!P || !P.planted.length) return;
        const C = PriceNews.config().plant;
        const st = PriceNews.state(world);
        const day = _day(world);
        for (const rec of P.planted) {
            if (rec.resolved || day - rec.day < C.lureDays) continue;
            rec.resolved = 1;
            const n = st.news.find(x => x.id === rec.newsId) || { id: rec.newsId, oq: rec.oq, or: rec.or, d: rec.day, reach: PriceNews.config().plantReach };
            const lured = [];
            for (const r of MerchantHouses.activeRivals(player)) {
                const spots = [r.seat, ...(r.posts || [])].filter(p => p && Number.isFinite(p.q));
                if (!spots.some(p => PriceNews.knownAt(world, n, p.q, p.r, day))) continue;
                const loss = Utils.cents(Math.min(_num(r.capital) * C.rivalLoss, C.rivalLossMax));
                if (!(loss > 0)) continue;
                // (the wasted trip's carters, tolls and the goods sold off cheap: paid into the rival's towns)
                const delta = MerchantHouses._rivalTrade(world, r, -loss);
                r.capital = Math.max(0, _num(r.capital) + delta);
                lured.push({ name: r.name, loss: -delta });
            }
            const carts = _num(n.lured);
            rec.lured = lured.length + carts;
            st.stats.lured += lured.length;
            if (lured.length || carts) {
                out.notices.push({
                    icon: '🗣️', title: 'The Lure Worked',
                    text: `Your talk of ${PriceNews._goodName(rec.g)} ${rec.k === 'dear' ? 'dear' : 'cheap'} in ${rec.n} drew ${[lured.length ? lured.map(l => `${l.name} (${Utils.formatGold(l.loss)}g lost)`).join(', ') : null, carts ? `${carts} caravan${carts === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')} on a fool's errand.`,
                    type: 'success',
                });
            }
            if (!rec.traced && Utils.random() < C.tracedChance + C.tracedPerLured * rec.lured) {
                out.notices.push({ icon: '🐍', title: 'Traced to You', text: PriceNews._traced(world, player, rec), type: 'warning' });
            }
        }
    },

    /** A rival merchant house or rival House with a grudge plants false talk near the player. */
    _rivalPlant(world, player, out) {
        const R = PriceNews.config().rivalPlants;
        const st = PriceNews.state(world);
        const day = _day(world);
        if (st.lastRivalPlant != null && day - st.lastRivalPlant < R.everyDays) return null;
        if (st.news.filter(n => n.f && n.by && n.by !== 'player').length >= R.maxActive) return null;
        if (!Number.isFinite(player.q)) return null;
        const fee = Utils.cents(R.fee);
        const who = [];
        for (const r of MerchantHouses.activeRivals(player)) if (_num(r.rivalry) >= R.minRivalry && _num(r.capital) > fee * 10) who.push({ kind: 'merchant', r, name: r.name });
        const house = player.house && player.house.rivals;
        for (const h of Object.values(house || {})) if (h && !h.extinct && _num(h.feud) >= R.minFeud && _num(h.gold) > fee * 10) who.push({ kind: 'house', r: h, name: h.name || 'a rival House' });
        if (!who.length) return null;
        st.lastRivalPlant = day;
        if (Utils.random() >= R.chance) return null;
        const by = who[Math.floor(Utils.random() * who.length)];
        const towns = PriceNews._towns(world).map(v => ({ v, d: PriceNews._dist(world, player, v) }));
        const near = towns.filter(t => t.d <= R.nearTown).sort((a, b) => a.d - b.d || (_key(a.v.q, a.v.r) < _key(b.v.q, b.v.r) ? -1 : 1))[0];
        const far = towns.filter(t => t.d >= R.minDist && t.d <= R.maxDist).sort((a, b) => (_key(a.v.q, a.v.r) < _key(b.v.q, b.v.r) ? -1 : 1));
        if (!near || !far.length) return null;
        const target = far[Math.floor(Utils.random() * far.length)];
        const T = PriceNews._live(world, target.v.q, target.v.r);
        const O = PriceNews._live(world, near.v.q, near.v.r);
        if (!T || !O || !T.s.market) return null;
        const goods = PriceNews._goods().filter(g => SettlementMarket.scarcity(T.s, g) < 1.2);
        if (!goods.length) return null;
        const g = goods[Math.floor(Utils.random() * goods.length)];
        const real = SettlementMarket.value(world, T.s, T.tile, g, PriceNews._base(g)) || PriceNews._base(g);
        const mult = R.dearMult[0] + Utils.random() * (R.dearMult[1] - R.dearMult[0]);
        // The talkers are paid from the rival's coffers, in the town where the talk starts
        if (by.kind === 'merchant') { by.r.capital = Math.max(0, _num(by.r.capital) - fee); MerchantHouses._rivalSpend(world, by.r, fee, near.v); } else { by.r.gold = Utils.cents(_num(by.r.gold) - fee); Economy.payTown(O.s, fee); }
        const n = PriceNews._add(world, {
            q: target.v.q, r: target.v.r, n: T.s.name || 'a town', t: T.s.type || null, g, k: 'dear', w: Math.round(real * mult * 100) / 100, sc: 2, d: day,
            oq: near.v.q, or: near.v.r, on: O.s.name || 'a town', reach: PriceNews.config().plantReach, f: 1, by: by.name, lured: 0,
        });
        st.stats.rivalPlanted++;
        return n;
    },

    // ── The panel ──────────────────────────────────────────

    /** What the Merchant's Ledger shows of the post and the talk. */
    view(player, world) {
        const P = PriceNews.playerState(player);
        const day = _day(world);
        return {
            letters: P.letters.map(L => ({ ...L, due: Math.max(0, L.arriveDay - day) })).sort((a, b) => a.arriveDay - b.arriveDay),
            corr: P.corr.map(c => ({ ...c, wage: PriceNews.wage(c.t), due: Math.max(0, c.nextDay - day) })),
            heard: P.heard.slice().reverse().slice(0, 12).map(h => ({ ...h, age: day - h.d, checked: !h.open })),
            planted: P.planted.slice().reverse(),
            here: PriceNews._here(world, player),
            stats: { ...P.stats },
        };
    },
};
